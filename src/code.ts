// Supported target languages, sorted alphabetically by display name.
const languages = [
  { name: "Afrikaans", code: "af" },
  { name: "Albanian", code: "sq" },
  { name: "Amharic", code: "am" },
  { name: "Arabic", code: "ar" },
  { name: "Armenian", code: "hy-AM" },
  { name: "Azerbaijani", code: "az-AZ" },
  { name: "Basque", code: "eu-ES" },
  { name: "Belarusian", code: "be" },
  { name: "Bengali", code: "bn-BD" },
  { name: "Bulgarian", code: "bg" },
  { name: "Burmese", code: "my-MM" },
  { name: "Catalan", code: "ca" },
  { name: "Chinese (Hong Kong)", code: "zh-HK" },
  { name: "Chinese (Simplified)", code: "zh-CN" },
  { name: "Chinese (Traditional)", code: "zh-TW" },
  { name: "Croatian", code: "hr" },
  { name: "Czech", code: "cs-CZ" },
  { name: "Danish", code: "da-DK" },
  { name: "Dutch", code: "nl-NL" },
  { name: "English", code: "en" },
  { name: "Estonian", code: "et" },
  { name: "Filipino", code: "fil" },
  { name: "Finnish", code: "fi-FI" },
  { name: "French", code: "fr" },
  { name: "Galician", code: "gl-ES" },
  { name: "Georgian", code: "ka-GE" },
  { name: "German", code: "de-DE" },
  { name: "Greek", code: "el-GR" },
  { name: "Gujarati", code: "gu" },
  { name: "Hebrew", code: "iw-IL" },
  { name: "Hindi", code: "hi-IN" },
  { name: "Hungarian", code: "hu-HU" },
  { name: "Icelandic", code: "is-IS" },
  { name: "Indonesian", code: "id" },
  { name: "Italian", code: "it-IT" },
  { name: "Japanese", code: "ja-JP" },
  { name: "Kannada", code: "kn-IN" },
  { name: "Kazakh", code: "kk" },
  { name: "Khmer", code: "km-KH" },
  { name: "Korean", code: "ko-KR" },
  { name: "Kyrgyz", code: "ky-KG" },
  { name: "Lao", code: "lo-LA" },
  { name: "Latvian", code: "lv" },
  { name: "Lithuanian", code: "lt" },
  { name: "Macedonian", code: "mk-MK" },
  { name: "Malay", code: "ms" },
  { name: "Malayalam", code: "ml-IN" },
  { name: "Marathi", code: "mr-IN" },
  { name: "Mongolian", code: "mn-MN" },
  { name: "Nepali", code: "ne-NP" },
  { name: "Norwegian", code: "no-NO" },
  { name: "Persian", code: "fa" },
  { name: "Polish", code: "pl-PL" },
  { name: "Portuguese", code: "pt" },
  { name: "Punjabi", code: "pa" },
  { name: "Romanian", code: "ro" },
  { name: "Romansh", code: "rm" },
  { name: "Russian", code: "ru" },
  { name: "Serbian", code: "sr" },
  { name: "Sinhala", code: "si-LK" },
  { name: "Slovak", code: "sk" },
  { name: "Slovenian", code: "sl" },
  { name: "Spanish", code: "es" },
  { name: "Swahili", code: "sw" },
  { name: "Swedish", code: "sv-SE" },
  { name: "Tamil", code: "ta-IN" },
  { name: "Telugu", code: "te-IN" },
  { name: "Thai", code: "th" },
  { name: "Turkish", code: "tr-TR" },
  { name: "Ukrainian", code: "uk" },
  { name: "Urdu", code: "ur" },
  { name: "Vietnamese", code: "vi" },
  { name: "Zulu", code: "zu" }
];

// API key from environment variable (injected at build time) or provided via UI
let OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// Add these types at the top of the file
type TranslationResponse = {
  choices: {
    message: {
      content: string
    }
  }[];
};

// Add excluded terms storage at the top with other constants
let excludedTerms: string[] = [];

// Optional translation context — describes the app/screen so the model
// produces less literal translations. Persisted in clientStorage.
let translationContext: string = '';

// Add this constant at the top with other constants
const BATCH_SIZE = 10; // Number of texts to translate in one API call

// Helper to replace numbers first, then excluded terms
function replaceWithPlaceholders(text: string, excludedTerms: string[]): { text: string, placeholders: {[key: string]: string}, numberPlaceholders: {[key: string]: string} } {
  const numberPlaceholders: {[key: string]: string} = {};
  let numberPlaceholderCount = 0;
  let textToTranslate = text;

  // 1. Replace numbers (including decimals and negative numbers) first
  const numberRegex = /-?\d+(\.\d+)?/g;
  textToTranslate = textToTranslate.replace(numberRegex, (match) => {
    const placeholder = `[NUMBER_${numberPlaceholderCount}]`;
    numberPlaceholders[placeholder] = match;
    numberPlaceholderCount++;
    return placeholder;
  });

  // 2. Replace excluded terms (longest first)
  const placeholders: {[key: string]: string} = {};
  let placeholderCount = 0;
  if (excludedTerms && excludedTerms.length > 0) {
    const sortedExcludedTerms = [...excludedTerms]
      .sort((a, b) => b.length - a.length)
      .filter(term => term.trim() !== '');
    for (const term of sortedExcludedTerms) {
      const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const termRegex = new RegExp(`\\b${escapedTerm}\\b`, 'g');
      textToTranslate = textToTranslate.replace(termRegex, (match) => {
        const placeholder = `[UNTRANSLATABLE_${placeholderCount}]`;
        placeholders[placeholder] = match;
        placeholderCount++;
        return placeholder;
      });
    }
  }

  return {
    text: textToTranslate,
    placeholders,
    numberPlaceholders
  };
}

type BatchResult =
  | { ok: true; translations: string[] }
  | { ok: false; reason: string; translations: string[]; retryAfterMs?: number };

const MAX_RETRIES = 4;

// Parse the "try again in 607ms" / "try again in 1.2s" hint from OpenAI's 429 body.
function parseRetryAfter(errorBody: string, retryAfterHeader: string | null): number | undefined {
  if (retryAfterHeader) {
    const seconds = parseFloat(retryAfterHeader);
    if (!isNaN(seconds)) return Math.ceil(seconds * 1000);
  }
  const msMatch = errorBody.match(/try again in\s+(\d+(?:\.\d+)?)\s*ms/i);
  if (msMatch) return Math.ceil(parseFloat(msMatch[1]));
  const sMatch = errorBody.match(/try again in\s+(\d+(?:\.\d+)?)\s*s/i);
  if (sMatch) return Math.ceil(parseFloat(sMatch[1]) * 1000);
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function translateBatchOnce(texts: string[], targetLang: string, langName: string, attempt: number, context: string): Promise<BatchResult> {
  let systemPrompt = `You are a professional translator. Translate ALL of the following texts to ${langName}.

CRITICAL: You MUST translate every single text that is not a placeholder. Do not leave any text in the original language.

The output must be in the ${langName} script, not English.`;

  if (context && context.trim().length > 0) {
    systemPrompt += `

CONTEXT — use this to produce natural, non-literal translations that fit the meaning rather than translating word-for-word:
${context.trim()}`;
  }

  if (targetLang.startsWith('zh')) {
    systemPrompt += ` For Chinese translations, use the appropriate script (Simplified for zh-CN, Traditional for zh-TW, Traditional for zh-HK).`;
  } else if (targetLang === 'km-KH') {
    systemPrompt += ` For Khmer translations, ensure proper use of Khmer script and numerals.`;
  } else if (targetLang === 'mn-MN') {
    systemPrompt += ` For Mongolian translations, use the Cyrillic script.`;
  }

  systemPrompt += `
IMPORTANT RULES:
1. Preserve all placeholders in the format [UNTRANSLATABLE_X] or [NUMBER_X]
2. Preserve any <C_X>...</C_X> color markers EXACTLY as written. Use literal characters: open with the four characters '<', 'C', '_', single uppercase letter, then '>'; close with '<', '/', 'C', '_', same letter, '>'. NEVER substitute '>' with ';' or any other character. NEVER omit the closing </C_X> tag. Translate the content INSIDE the markers as part of the sentence. The letter X (A, B, C, ...) must match between opening and closing tag.
3. Return translations as a JSON array of strings
4. Keep the exact same order as the input
5. Do not add any explanations or additional text

Example input:
["Create <C_A>Real Estate Videos</C_A> in [NUMBER_0] min", "You have [NUMBER_0] messages"]
Example output (Portuguese):
["Crie <C_A>Vídeos Imobiliários</C_A> em [NUMBER_0] min", "Você tem [NUMBER_0] mensagens"]`;

  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(texts) }
        ],
        temperature: 0.1,
        max_tokens: 2000
      })
    });
  } catch (error: any) {
    const reason = `network error: ${error?.message || String(error)}`;
    console.error(`[translate ${targetLang} attempt ${attempt}] ${reason}`);
    return { ok: false, reason, translations: texts };
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    const reason = `HTTP ${response.status} ${response.statusText} — ${errorBody.slice(0, 300)}`;
    console.error(`[translate ${targetLang} attempt ${attempt}] ${reason}`);
    const retryAfterMs = response.status === 429
      ? parseRetryAfter(errorBody, response.headers.get('retry-after'))
      : undefined;
    return { ok: false, reason, translations: texts, retryAfterMs };
  }

  let data: TranslationResponse;
  try {
    data = await response.json() as TranslationResponse;
  } catch (error: any) {
    const reason = `invalid JSON in API response: ${error?.message || String(error)}`;
    console.error(`[translate ${targetLang} attempt ${attempt}] ${reason}`);
    return { ok: false, reason, translations: texts };
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    const reason = `API response missing content: ${JSON.stringify(data).slice(0, 300)}`;
    console.error(`[translate ${targetLang} attempt ${attempt}] ${reason}`);
    return { ok: false, reason, translations: texts };
  }

  let translatedTexts: string[];
  try {
    translatedTexts = JSON.parse(content) as string[];
  } catch (error: any) {
    const reason = `model returned non-JSON content: ${content.slice(0, 200)}`;
    console.error(`[translate ${targetLang} attempt ${attempt}] ${reason}`);
    return { ok: false, reason, translations: texts };
  }

  if (!Array.isArray(translatedTexts) || translatedTexts.length !== texts.length) {
    const reason = `length mismatch: expected ${texts.length}, got ${Array.isArray(translatedTexts) ? translatedTexts.length : 'non-array'}`;
    console.error(`[translate ${targetLang} attempt ${attempt}] ${reason}`);
    return { ok: false, reason, translations: texts };
  }

  // Detect "all texts identical" — likely the model didn't translate
  const allIdentical = translatedTexts.every((t, i) => t === texts[i]);
  if (allIdentical && texts.some(t => t.trim().length > 0)) {
    const reason = `model returned all texts unchanged (no translation occurred)`;
    console.error(`[translate ${targetLang} attempt ${attempt}] ${reason}`);
    return { ok: false, reason, translations: translatedTexts };
  }

  return { ok: true, translations: translatedTexts };
}

async function translateBatch(texts: string[], targetLang: string, context: string = ''): Promise<BatchResult> {
  const langObj = languages.find(lang => lang.code === targetLang);
  if (!langObj) {
    const reason = `unsupported language code: ${targetLang}`;
    console.error(`[translate] ${reason}`);
    return { ok: false, reason, translations: texts };
  }

  console.log(`[translate ${targetLang}] starting batch of ${texts.length} texts (lang: ${langObj.name}${context ? ', with context' : ''})`);

  let lastResult: BatchResult = { ok: false, reason: 'no attempts made', translations: texts };
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    lastResult = await translateBatchOnce(texts, targetLang, langObj.name, attempt, context);
    if (lastResult.ok) {
      console.log(`[translate ${targetLang}] success on attempt ${attempt}`);
      return lastResult;
    }
    if (attempt < MAX_RETRIES) {
      // If the API told us how long to wait (rate limit), honor that + small margin.
      // Otherwise use exponential backoff.
      const hintedWait = !lastResult.ok ? lastResult.retryAfterMs : undefined;
      const fallbackBackoff = 500 * Math.pow(2, attempt - 1); // 500ms, 1s, 2s, 4s
      const waitMs = hintedWait !== undefined ? hintedWait + 250 : fallbackBackoff;
      console.log(`[translate ${targetLang}] retry ${attempt + 1}/${MAX_RETRIES} in ${waitMs}ms${hintedWait !== undefined ? ' (server-hinted)' : ''}`);
      await sleep(waitMs);
    }
  }

  console.error(`[translate ${targetLang}] FAILED after ${MAX_RETRIES} attempts. Last reason: ${lastResult.ok ? '' : lastResult.reason}`);
  return lastResult;
}

// Modify the existing translateText function to use the batch translation
async function translateText(text: string, targetLang: string): Promise<string> {
  const result = await translateBatch([text], targetLang);
  return result.translations[0];
}

// Scan a text node's character ranges and wrap non-dominant-color segments
// with <C_A>...</C_A> markers so the model preserves colored regions across
// translation. Returns the marked text plus a map from letter → fills array.
function extractColorSegments(node: TextNode): { text: string; colorMap: { [letter: string]: ReadonlyArray<Paint> } } {
  const text = node.characters;
  if (text.length === 0) return { text, colorMap: {} };

  // Group consecutive characters by their fills
  type Segment = { start: number; end: number; key: string; fills: ReadonlyArray<Paint> };
  const segments: Segment[] = [];
  let curStart = 0;
  let curKey = '';
  let curFills: ReadonlyArray<Paint> = [];

  for (let i = 0; i < text.length; i++) {
    const fills = node.getRangeFills(i, i + 1);
    if (typeof fills === 'symbol') {
      // Mixed fill on a single character — bail and skip color preservation
      return { text, colorMap: {} };
    }
    const key = JSON.stringify(fills);
    if (i === 0) {
      curKey = key;
      curFills = fills;
    } else if (key !== curKey) {
      segments.push({ start: curStart, end: i, key: curKey, fills: curFills });
      curStart = i;
      curKey = key;
      curFills = fills;
    }
  }
  segments.push({ start: curStart, end: text.length, key: curKey, fills: curFills });

  if (segments.length <= 1) {
    return { text, colorMap: {} }; // uniform color, no marking needed
  }

  // Pick the dominant fill (longest total run) — that one stays unmarked
  const lengthByKey: { [key: string]: number } = {};
  for (const seg of segments) {
    lengthByKey[seg.key] = (lengthByKey[seg.key] || 0) + (seg.end - seg.start);
  }
  const dominantKey = Object.keys(lengthByKey).sort((a, b) => lengthByKey[b] - lengthByKey[a])[0];

  // Assign letters to each non-dominant fill
  const keyToLetter: { [key: string]: string } = {};
  const colorMap: { [letter: string]: ReadonlyArray<Paint> } = {};
  let nextLetterIdx = 0;
  for (const seg of segments) {
    if (seg.key === dominantKey) continue;
    if (keyToLetter[seg.key] !== undefined) continue;
    if (nextLetterIdx >= 26) {
      keyToLetter[seg.key] = ''; // out of letters; this segment stays unmarked
      continue;
    }
    const letter = String.fromCharCode(65 + nextLetterIdx); // A, B, C, ...
    keyToLetter[seg.key] = letter;
    colorMap[letter] = seg.fills;
    nextLetterIdx++;
  }

  // Build marked text
  let marked = '';
  for (const seg of segments) {
    const segText = text.slice(seg.start, seg.end);
    const letter = keyToLetter[seg.key];
    if (letter) {
      marked += `<C_${letter}>${segText}</C_${letter}>`;
    } else {
      marked += segText;
    }
  }

  return { text: marked, colorMap };
}

// Apply translated text with color markers back to the node, parsing <C_X>
// markers into setRangeFills calls. Falls back to plain text if markers were
// dropped by the model.
function applyTranslatedTextWithColors(
  node: TextNode,
  translatedText: string,
  colorMap: { [letter: string]: ReadonlyArray<Paint> }
): void {
  if (Object.keys(colorMap).length === 0) {
    node.characters = translatedText;
    return;
  }

  // Permissive regex: accepts `<C_A>...</C_A>` and common malformations:
  //  - `>` substituted with `;` or `]`
  //  - `<` substituted with `[` (model "harmonizes" with [NUMBER_X] placeholders)
  //  - terminator omitted entirely
  // Open: `[<[]C_X` + optional [>;]], close: `[<[]/C_X` + optional [>;]].
  const markerRegex = /[<\[]C_([A-Z])[>;\]]?([\s\S]*?)[<\[]\/C_\1[>;\]]?/g;
  let cleanText = '';
  const ranges: { start: number; end: number; fills: ReadonlyArray<Paint> }[] = [];
  const recovered = new Set<string>();
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = markerRegex.exec(translatedText)) !== null) {
    cleanText += translatedText.slice(lastIndex, match.index);
    const rangeStart = cleanText.length;
    cleanText += match[2];
    const rangeEnd = cleanText.length;
    const letter = match[1];
    const fills = colorMap[letter];
    if (fills && rangeEnd > rangeStart) {
      ranges.push({ start: rangeStart, end: rangeEnd, fills });
      recovered.add(letter);
    }
    lastIndex = match.index + match[0].length;
  }
  cleanText += translatedText.slice(lastIndex);

  // Heuristic recovery: for any color whose pair wasn't found, look for a
  // malformed lone opener like `<C_X;` or `<C_X` and color the next word.
  for (const letter of Object.keys(colorMap)) {
    if (recovered.has(letter)) continue;
    const lonePattern = new RegExp(`[<\\[]C_${letter}[^A-Za-z]?(\\S*)`);
    const m = lonePattern.exec(cleanText);
    if (m && m[1]) {
      const wordStart = (m.index ?? 0) + m[0].length - m[1].length;
      const wordEnd = wordStart + m[1].length;
      // Remove the malformed opener from cleanText and adjust positions
      const beforeOpener = cleanText.slice(0, m.index);
      const afterOpener = cleanText.slice((m.index ?? 0) + m[0].length - m[1].length);
      cleanText = beforeOpener + afterOpener;
      const newStart = beforeOpener.length;
      const newEnd = newStart + m[1].length;
      const fills = colorMap[letter];
      if (fills && newEnd > newStart) {
        ranges.push({ start: newStart, end: newEnd, fills });
        recovered.add(letter);
        console.log(`[color] recovered malformed marker for ${letter} → colored next word "${m[1]}"`);
      }
    }
  }

  // Final strip: remove any remaining marker fragments (well-formed or not),
  // including bracket-substituted forms.
  cleanText = cleanText.replace(/[<\[]\/?C_[A-Z][>;,!\]]?/g, '');

  node.characters = cleanText;

  for (const r of ranges) {
    try {
      // Clamp ranges to actual text length in case strip removed chars
      const safeStart = Math.max(0, Math.min(r.start, cleanText.length));
      const safeEnd = Math.max(safeStart, Math.min(r.end, cleanText.length));
      if (safeEnd > safeStart) {
        node.setRangeFills(safeStart, safeEnd, r.fills as Paint[]);
      }
    } catch (err) {
      console.warn(`[color] failed to apply fills to range ${r.start}-${r.end}:`, err);
    }
  }

  const expected = Object.keys(colorMap).length;
  if (recovered.size < expected) {
    console.warn(`[color] expected ${expected} color range(s), recovered ${recovered.size}. Model may have dropped markers in: "${translatedText.slice(0, 80)}"`);
  }
}

// Measure the rendered width of a single word at a given font size, copying
// the source node's letterSpacing and textCase so the measurement matches what
// will actually be drawn (otherwise loose tracking or UPPERCASE hide-overflow).
async function measureWordWidth(
  word: string,
  fontName: FontName,
  fontSize: number,
  letterSpacing: LetterSpacing | typeof figma.mixed,
  textCase: TextCase | typeof figma.mixed
): Promise<number> {
  const temp = figma.createText();
  try {
    await figma.loadFontAsync(fontName);
    temp.fontName = fontName;
    temp.fontSize = fontSize;
    if (typeof letterSpacing !== 'symbol') temp.letterSpacing = letterSpacing;
    if (typeof textCase !== 'symbol') temp.textCase = textCase;
    temp.characters = word;
    return temp.width;
  } finally {
    temp.remove();
  }
}

// Shrink the text node's font size until it fits within its original bounding box
// AND no single word would be broken across lines (intra-word wrapping).
// Only works for textAutoResize modes where dimensions reflect content (HEIGHT, WIDTH_AND_HEIGHT).
async function fitTextToBox(node: TextNode, originalWidth: number, originalHeight: number, originalFontSize: number | symbol): Promise<void> {
  if (typeof originalFontSize === 'symbol') {
    // Mixed font sizes — would need per-range scaling; skip for now.
    return;
  }

  const autoResize = node.textAutoResize;
  if (autoResize !== 'HEIGHT' && autoResize !== 'WIDTH_AND_HEIGHT') {
    return;
  }

  const tolerance = 0.5;
  const minFontSize = Math.max(8, originalFontSize * 0.6);

  // Compute a font-size cap that ensures the WIDEST single word fits in the box.
  // We must check by measured width (not character count) because uppercase /
  // wide glyphs can make a shorter word visually wider.
  let wordCap = Infinity;
  let widestWord = '';
  let widestMeasured = 0;
  const fontName = node.fontName;
  const letterSpacing = node.letterSpacing;
  const textCase = node.textCase;
  if (fontName && typeof fontName !== 'symbol') {
    const words = node.characters.split(/\s+/).filter(w => w.length > 0);
    for (const word of words) {
      try {
        const w = await measureWordWidth(word, fontName as FontName, originalFontSize, letterSpacing, textCase);
        if (w > widestMeasured) {
          widestMeasured = w;
          widestWord = word;
        }
      } catch (err) {
        console.warn(`[fit] could not measure word "${word}":`, err);
      }
    }
    if (widestMeasured > originalWidth) {
      // Linear scale assumption with 5% safety margin for hinting/kerning.
      wordCap = (originalWidth / widestMeasured) * originalFontSize * 0.95;
    }
  }

  // Apply the word-fit cap up front so the shrink loop starts from a safe size.
  let currentSize = originalFontSize;
  if (wordCap < currentSize) {
    currentSize = Math.max(minFontSize, wordCap);
    node.fontSize = currentSize;
  }

  // Verify the widest word actually fits at the chosen size — if not (linear
  // assumption was off), iteratively shrink with re-measurement.
  if (widestWord && fontName && typeof fontName !== 'symbol' && currentSize > minFontSize) {
    let safetyIter = 0;
    while (safetyIter++ < 8 && currentSize > minFontSize) {
      try {
        const actualWidth = await measureWordWidth(widestWord, fontName as FontName, currentSize, letterSpacing, textCase);
        if (actualWidth <= originalWidth + tolerance) break;
        currentSize = Math.max(minFontSize, currentSize - Math.max(0.5, originalFontSize * 0.05));
        node.fontSize = currentSize;
      } catch {
        break;
      }
    }
  }

  const fits = (): boolean => {
    if (autoResize === 'HEIGHT') {
      return node.height <= originalHeight + tolerance;
    }
    return node.width <= originalWidth + tolerance && node.height <= originalHeight + tolerance;
  };

  const step = Math.max(0.5, originalFontSize * 0.05);
  while (currentSize > minFontSize && !fits()) {
    currentSize = Math.max(minFontSize, currentSize - step);
    node.fontSize = currentSize;
  }

  const preview = node.characters.slice(0, 30).replace(/\n/g, ' ');
  if (!fits()) {
    console.warn(`[fit] "${preview}..." still overflows at min ${minFontSize.toFixed(1)}pt (original ${originalFontSize}pt)`);
  } else if (currentSize < originalFontSize) {
    const reason = wordCap < originalFontSize ? ' (long word would break)' : '';
    console.log(`[fit] "${preview}..." shrunk from ${originalFontSize}pt to ${currentSize.toFixed(1)}pt${reason}`);
  }
}

// Helper to run async tasks with bounded concurrency. Each task removes
// itself from the executing set when it settles, so the pool stays full.
async function asyncPool<T, R>(poolLimit: number, array: T[], iteratorFn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const ret: R[] = [];
  const executing = new Set<Promise<void>>();
  for (let i = 0; i < array.length; i++) {
    const p: Promise<void> = Promise.resolve()
      .then(() => iteratorFn(array[i], i))
      .then(res => { ret[i] = res; });
    executing.add(p);
    p.finally(() => executing.delete(p));
    if (executing.size >= poolLimit) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
  return ret;
}

// Show the UI
figma.showUI(__html__, { width: 400, height: 600 });

// Initial check for selected frames
updateTextCount();

// Listen for selection changes
figma.on('selectionchange', () => {
  updateTextCount();
});

function updateTextCount() {
  const selectedNodes = figma.currentPage.selection;
  const selectedFrames = selectedNodes.filter((node): node is FrameNode => node.type === 'FRAME');
  let textNodeCount = 0;

  for (const frame of selectedFrames) {
    const textNodes = frame.findAll(node => node.type === 'TEXT');
    textNodeCount += textNodes.length;
  }

  figma.ui.postMessage({
    type: 'updateTextCount',
    count: textNodeCount
  });
}

// Handle messages from the UI
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'translate') {
    const { targetLangs } = msg;
    // Use context from message if provided, otherwise fall back to stored
    const contextForRun: string = (typeof msg.context === 'string' && msg.context.trim().length > 0)
      ? msg.context
      : translationContext;
    
    // Get all selected nodes
    const selectedNodes = figma.currentPage.selection;
    
    if (selectedNodes.length === 0) {
      figma.notify('Please select at least one frame', { error: true });
      return;
    }
    
    // Filter for frame nodes only
    const selectedFrames = selectedNodes.filter((node): node is FrameNode => node.type === 'FRAME');
    
    if (selectedFrames.length === 0) {
      figma.notify('Please select at least one frame', { error: true });
      return;
    }

    let hasErrors = false;
    const failedLanguages: { lang: string; reason: string }[] = [];

    // Helper function to process a single language for a frame
    async function processLanguage(frame: FrameNode, targetLang: string, langIndex: number): Promise<{ success: boolean; lang: string; reason?: string }> {
      try {
        const clonedFrame = frame.clone() as FrameNode;
        const languageName = languages.find(lang => lang.code === targetLang)?.name || targetLang;
        clonedFrame.name = `(${targetLang} - ${languageName}) ${frame.name}`;
        clonedFrame.x = frame.x;

        // Position the cloned frame
        const y = frame.y + frame.height + 50 + (langIndex * (frame.height + 50));
        clonedFrame.y = y;

        // Find all text nodes in the cloned frame
        const textNodes: TextNode[] = [];
        function findTextNodes(node: SceneNode) {
          if (node.type === 'TEXT') {
            if (node.characters.trim()) {
              textNodes.push(node);
            }
          } else if ('children' in node) {
            for (const child of node.children) {
              findTextNodes(child);
            }
          }
        }
        findTextNodes(clonedFrame);

        if (textNodes.length === 0) {
          console.log(`[${targetLang}] no text nodes in frame "${clonedFrame.name}"`);
          return { success: true, lang: targetLang };
        }

        // Create batches of text nodes
        const batches: TextNode[][] = [];
        for (let i = 0; i < textNodes.length; i += BATCH_SIZE) {
          batches.push(textNodes.slice(i, i + BATCH_SIZE));
        }

        console.log(`[${targetLang}] processing ${textNodes.length} text nodes in ${batches.length} batch(es)`);

        // Process each batch (sequentially within a language to avoid race conditions)
        for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
          const batch = batches[batchIdx];

          // Pre-process each node: wrap colored ranges, then add placeholder substitutions
          const nodeData = batch.map(node => {
            const { text: markedText, colorMap } = extractColorSegments(node);
            const { text: finalInputText, placeholders, numberPlaceholders } = replaceWithPlaceholders(markedText, excludedTerms);
            return { node, finalInputText, placeholders, numberPlaceholders, colorMap };
          });

          const textsToTranslate = nodeData.map(d => d.finalInputText);
          const result = await translateBatch(textsToTranslate, targetLang, contextForRun);

          if (!result.ok) {
            const reason = `batch ${batchIdx + 1}/${batches.length}: ${result.reason}`;
            console.error(`[${targetLang}] ${reason}`);
            return { success: false, lang: targetLang, reason };
          }

          // Update text nodes with translations
          for (let i = 0; i < nodeData.length; i++) {
            const { node, placeholders, numberPlaceholders, colorMap } = nodeData[i];
            const translatedText = result.translations[i];

            try {
              // Capture original dimensions BEFORE changing text, so we can detect overflow
              const originalWidth = node.width;
              const originalHeight = node.height;
              const originalFontSize = node.fontSize;

              // Load font
              if (!node.fontName || typeof node.fontName === 'symbol' || !node.fontName.family || !node.fontName.style) {
                await figma.loadFontAsync({ family: "Inter", style: "Regular" });
                node.fontName = { family: "Inter", style: "Regular" };
              } else {
                await figma.loadFontAsync(node.fontName as FontName);
              }

              // Restore placeholders (numbers + excluded terms) — color markers are still in finalText
              let finalText = translatedText;
              Object.entries(numberPlaceholders).forEach(([placeholder, value]) => {
                if (!finalText.includes(placeholder)) {
                  console.warn(`[${targetLang}] number placeholder ${placeholder}=${JSON.stringify(value)} was lost by the model in: "${finalText.slice(0, 80)}"`);
                }
                finalText = finalText.replace(placeholder, value);
              });
              Object.entries(placeholders).forEach(([placeholder, value]) => {
                if (!finalText.includes(placeholder)) {
                  console.warn(`[${targetLang}] term placeholder ${placeholder}=${JSON.stringify(value)} was lost by the model in: "${finalText.slice(0, 80)}"`);
                }
                finalText = finalText.replace(placeholder, value);
              });

              // Apply text + color ranges
              applyTranslatedTextWithColors(node, finalText, colorMap);
              await fitTextToBox(node, originalWidth, originalHeight, originalFontSize);
            } catch (error: any) {
              const reason = `font/text update failed on node "${node.name}": ${error?.message || String(error)}`;
              console.error(`[${targetLang}] ${reason}`, error);
              return { success: false, lang: targetLang, reason };
            }
          }
        }

        return { success: true, lang: targetLang };
      } catch (error: any) {
        const reason = `unexpected error: ${error?.message || String(error)}`;
        console.error(`[${targetLang}] ${reason}`, error);
        return { success: false, lang: targetLang, reason };
      }
    }

    // Process each frame
    for (let frameIndex = 0; frameIndex < selectedFrames.length; frameIndex++) {
      const frame = selectedFrames[frameIndex];

      // Process languages with bounded concurrency to stay under OpenAI's TPM limit.
      // 5 in flight at once works for Tier 1 (200k TPM) with ~2k tokens/request.
      const LANGUAGE_CONCURRENCY = 5;
      const results = await asyncPool(
        LANGUAGE_CONCURRENCY,
        targetLangs as string[],
        (targetLang: string, langIndex: number) => processLanguage(frame, targetLang, langIndex)
      );

      // Collect failed languages
      results.forEach(result => {
        if (!result.success && !failedLanguages.some(f => f.lang === result.lang)) {
          failedLanguages.push({ lang: result.lang, reason: result.reason || 'unknown' });
          hasErrors = true;
        }
      });
    }

    // Notify completion with failed languages if any
    if (failedLanguages.length > 0) {
      console.error('=== TRANSLATION FAILURES SUMMARY ===');
      failedLanguages.forEach(f => console.error(`  ${f.lang}: ${f.reason}`));
      const langList = failedLanguages.map(f => f.lang).join(', ');
      figma.notify(`Translation failed for: ${langList}. Check console for details.`, { error: true, timeout: 6000 });
    } else {
      figma.notify('Translation completed successfully');
    }
    figma.ui.postMessage({ type: 'done' });
  } else if (msg.type === 'updateExcludedTerms') {
    excludedTerms = msg.terms;
  } else if (msg.type === 'setApiKey') {
    OPENAI_API_KEY = msg.apiKey;
  } else if (msg.type === 'getContext') {
    const stored = await figma.clientStorage.getAsync('translationContext');
    translationContext = (typeof stored === 'string') ? stored : '';
    figma.ui.postMessage({ type: 'loadContext', context: translationContext });
  } else if (msg.type === 'setContext') {
    translationContext = typeof msg.context === 'string' ? msg.context : '';
    await figma.clientStorage.setAsync('translationContext', translationContext);
  }
};