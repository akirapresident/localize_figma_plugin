// Define languages directly in the file for now
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
  { name: "English (Australia)", code: "en-AU" },
  { name: "English (Canada)", code: "en-CA" },
  { name: "English (Great Britain)", code: "en-GB" },
  { name: "English (India)", code: "en-IN" },
  { name: "English (U.S.)", code: "en-US" },
  { name: "Estonian", code: "et" },
  { name: "Filipino", code: "fil" },
  { name: "Finnish", code: "fi-FI" },
  { name: "French", code: "fr" },
  { name: "French (Canada)", code: "fr-CA" },
  { name: "French (France)", code: "fr-FR" },
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
  { name: "Malay (Malaysia)", code: "ms-MY" },
  { name: "Malayalam", code: "ml-IN" },
  { name: "Marathi", code: "mr-IN" },
  { name: "Mongolian", code: "mn-MN" },
  { name: "Nepali", code: "ne-NP" },
  { name: "Norwegian", code: "no-NO" },
  { name: "Persian", code: "fa" },
  { name: "Persian (Iran)", code: "fa-IR" },
  { name: "Polish", code: "pl-PL" },
  { name: "Portuguese (Brazil)", code: "pt-BR" },
  { name: "Portuguese (Portugal)", code: "pt-PT" },
  { name: "Punjabi", code: "pa" },
  { name: "Romanian", code: "ro" },
  { name: "Romansh", code: "rm" },
  { name: "Russian", code: "ru" },
  { name: "Russian (RU)", code: "ru-RU" },
  { name: "Serbian", code: "sr" },
  { name: "Sinhala", code: "si-LK" },
  { name: "Slovak", code: "sk" },
  { name: "Slovenian", code: "sl" },
  { name: "Spanish (Latin America)", code: "es-419" },
  { name: "Spanish (Mexico)", code: "es-MX" },
  { name: "Spanish (Spain)", code: "es-ES" },
  { name: "Spanish (United States)", code: "es-US" },
  { name: "Swahili", code: "sw" },
  { name: "Swedish", code: "sv-SE" },
  { name: "Tamil", code: "ta-IN" },
  { name: "Telugu", code: "te-IN" },
  { name: "Thai", code: "th" },
  { name: "Turkish", code: "tr-TR" },
  { name: "Ukrainian", code: "uk" },
  { name: "Urdu", code: "ur" },
  { name: "Vietnamese", code: "vi" },
  { name: "Zulu", code: "zu" },
  { name: "Malayalam (India)", code: "mi-IN" }
];

// API key from environment variable (injected at build time) or provided via UI
let OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// Constants for freemium feature
const FREE_FRAMES_LIMIT = 2;

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

// Add this constant at the top with other constants
const BATCH_SIZE = 10; // Number of texts to translate in one API call

// Function to update status display
async function updateStatusDisplay() {
  const translatedFramesCount = await figma.clientStorage.getAsync('translatedFramesCount') || 0;
  const remainingCredits = figma.payments?.status.type === 'PAID' ? '∞' : Math.max(0, FREE_FRAMES_LIMIT - translatedFramesCount);
  const isSubscribed = figma.payments?.status.type === 'PAID';

  figma.ui.postMessage({
    type: 'updateStatus',
    remainingCredits,
    isSubscribed
  });
}

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

// Add this new function after the translateText function
async function translateBatch(texts: string[], targetLang: string): Promise<string[]> {
  try {
    console.log(`Starting batch translation to ${targetLang} for ${texts.length} texts`);
    
    // Create a batch of texts with their indices
    const batchWithIndices = texts.map((text, index) => ({
      index,
      text,
      hasPlaceholders: /\[UNTRANSLATABLE_\d+\]|\[NUMBER_\d+\]/.test(text)
    }));

    console.log("[DEBUG] targetLang antes do batch:", targetLang);
    
    // Find the language object using the full language code
    const langObj = languages.find(lang => lang.code === targetLang);
    if (!langObj) {
      console.error(`[ERRO] Idioma não suportado: ${targetLang}`);
      return texts; // Return original texts instead of throwing error
    }

    const langName = langObj.name;
    console.log("[DEBUG] Usando langName no prompt:", langName);

    // Special handling for certain languages
    let systemPrompt = `You are a professional translator. Translate ALL of the following texts to ${langName}. 

CRITICAL: You MUST translate every single text that is not a placeholder. Do not leave any text in the original language.

The output must be in the ${langName} script, not English.`;
    
    // Add specific instructions for certain languages
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
2. Return translations as a JSON array of strings
3. Keep the exact same order as the input
4. Do not add any explanations or additional text

Example input:
["Hello [UNTRANSLATABLE_0]", "You have [NUMBER_0] messages"]`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: JSON.stringify(texts)
          }
        ],
        temperature: 0.1,
        max_tokens: 2000
      }, null, 2)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('API Error:', response.status, response.statusText, errorData);
      return texts; // Return original texts instead of throwing error
    }

    const data = await response.json() as TranslationResponse;
    if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
      console.error('Invalid API response:', data);
      return texts; // Return original texts instead of throwing error
    }

    console.log("[DEBUG] Resposta da OpenAI:", data);

    const translatedTexts = JSON.parse(data.choices[0].message.content) as string[];
    console.log("[DEBUG] Traduções recebidas:", translatedTexts);
    console.log(`Batch translation completed for ${translatedTexts.length} texts`);
    return translatedTexts;
  } catch (error) {
    console.error('Batch translation error:', error);
    return texts; // Return original texts instead of throwing error
  }
}

// Modify the existing translateText function to use the batch translation
async function translateText(text: string, targetLang: string): Promise<string> {
  const results = await translateBatch([text], targetLang);
  return results[0];
}

// Helper to run async tasks with concurrency limit
async function asyncPool<T, R>(poolLimit: number, array: T[], iteratorFn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const ret: R[] = [];
  const executing: Promise<void>[] = [];
  for (let i = 0; i < array.length; i++) {
    const p = Promise.resolve().then(() => iteratorFn(array[i], i)).then(res => { ret[i] = res });
    executing.push(p);
    if (executing.length >= poolLimit) {
      await Promise.race(executing);
      // Remove resolved promises
      for (let j = executing.length - 1; j >= 0; j--) {
        executing.splice(j, 1);
      }
    }
  }
  await Promise.all(executing);
  return ret;
}

// Show the UI
figma.showUI(__html__, { width: 400, height: 600 });

// Initial check for selected frames and status
updateTextCount();
updateStatusDisplay();

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

    // Check subscription status and credits
    const translatedFramesCount = await figma.clientStorage.getAsync('translatedFramesCount') || 0;
    const remainingCredits = Math.max(0, FREE_FRAMES_LIMIT - translatedFramesCount);
    const isSubscribed = figma.payments?.status.type === 'PAID';

    let hasErrors = false;
    const firstFrameTranslationsY: number[] = [];
    const failedLanguages: string[] = [];
    
    // Process each selected frame
    for (const frame of selectedFrames) {
      // Process each target language
      for (const targetLang of targetLangs) {
        try {
          const clonedFrame = frame.clone() as FrameNode;
          const languageName = languages.find(lang => lang.code === targetLang)?.name || targetLang;
          clonedFrame.name = `(${targetLang} - ${languageName}) ${frame.name}`;
          clonedFrame.x = frame.x;
          
          if (frame === selectedFrames[0]) {
            const y = frame.y + frame.height + 50 + (targetLangs.indexOf(targetLang) * (frame.height + 50));
            clonedFrame.y = y;
            firstFrameTranslationsY.push(y);
          } else {
            clonedFrame.y = firstFrameTranslationsY[targetLangs.indexOf(targetLang)];
          }

          // Find all text nodes in the cloned frame
          const textNodes: TextNode[] = [];
          function findTextNodes(node: SceneNode) {
            if (node.type === 'TEXT') {
              // Only add non-empty text nodes
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
            console.log(`No text nodes found in frame "${clonedFrame.name}"`);
            continue;
          }

          // Create batches of text nodes
          const batches: TextNode[][] = [];
          for (let i = 0; i < textNodes.length; i += BATCH_SIZE) {
            batches.push(textNodes.slice(i, i + BATCH_SIZE));
          }

          // Process each batch
          for (const batch of batches) {
            // Prepare texts for translation
            const textsToTranslate = batch.map(node => {
              const { text, placeholders, numberPlaceholders } = replaceWithPlaceholders(node.characters, excludedTerms);
              return text;
            });

            console.log("[DEBUG] Batch de textos:", textsToTranslate);

            // Translate the batch
            const translatedTexts = await translateBatch(textsToTranslate, targetLang);

            // Check if translation actually happened by comparing content
            const translationFailed = translatedTexts.length === textsToTranslate.length && 
              translatedTexts.every((translated, index) => translated === textsToTranslate[index]);
            
            if (translationFailed) {
              console.log(`[DEBUG] Translation failed for ${targetLang} - all texts returned unchanged`);
              failedLanguages.push(targetLang);
              continue;
            }

            // Update the text nodes with translations
            for (let i = 0; i < batch.length; i++) {
              const node = batch[i];
              const translatedText = translatedTexts[i];
              
              try {
                // Load the font first
                console.log("[DEBUG] Font name object:", JSON.stringify(node.fontName));
                console.log("[DEBUG] Font name type:", typeof node.fontName);
                console.log("[DEBUG] Font name properties:", Object.keys(node.fontName || {}));
                
                // Check if fontName is valid before loading
                if (!node.fontName || typeof node.fontName === 'symbol' || !node.fontName.family || !node.fontName.style) {
                  console.log("[DEBUG] Invalid font detected, using fallback font");
                  // Use a fallback font that's guaranteed to be available
                  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
                  // Update the node's font to the fallback
                  node.fontName = { family: "Inter", style: "Regular" };
                } else {
                  await figma.loadFontAsync(node.fontName as FontName);
                }
                
                // Restore placeholders
                let finalText = translatedText;
                const { placeholders, numberPlaceholders } = replaceWithPlaceholders(node.characters, excludedTerms);
                
                // Restore number placeholders
                Object.entries(numberPlaceholders).forEach(([placeholder, value]) => {
                  finalText = finalText.replace(placeholder, value);
                });
                
                // Restore excluded terms
                Object.entries(placeholders).forEach(([placeholder, value]) => {
                  finalText = finalText.replace(placeholder, value);
                });

                // Update the text node
                node.characters = finalText;
              } catch (error: any) {
                console.error(`Error updating text node:`, error);
                figma.notify(`Error updating text: ${error.message}`, { error: true });
                hasErrors = true;
              }
            }
          }

        } catch (error: any) {
          console.error(`Error translating to ${targetLang}:`, error);
          failedLanguages.push(targetLang);
          hasErrors = true;
        }
      }
    }

    // Update translated frames count
    if (!hasErrors) {
      const newCount = translatedFramesCount + selectedFrames.length;
      await figma.clientStorage.setAsync('translatedFramesCount', newCount);
      updateStatusDisplay();
    }

    // Notify completion with failed languages if any
    if (failedLanguages.length > 0) {
      figma.notify(`Translation completed with errors. Failed languages: ${failedLanguages.join(', ')}`, { error: true });
    } else {
      figma.notify('Translation completed successfully');
    }
    figma.ui.postMessage({ type: 'done' });
  } else if (msg.type === 'getStatus') {
    await updateStatusDisplay();
  } else if (msg.type === 'subscribe') {
    if (figma.payments) {
      try {
        await figma.payments.initiateCheckoutAsync({
          interstitial: 'PAID_FEATURE'
        });

        if (figma.payments.status.type === 'PAID') {
          figma.notify('Thank you for subscribing!');
          await figma.clientStorage.setAsync('translatedFramesCount', 0);
          await updateStatusDisplay();
        } else {
          figma.notify('Subscription cancelled', { error: true });
          await updateStatusDisplay();
        }
      } catch (error) {
        console.error('Subscription error:', error);
        figma.notify('Subscription cancelled', { error: true });
        await updateStatusDisplay();
      }
    }
  } else if (msg.type === 'updateExcludedTerms') {
    excludedTerms = msg.terms;
  } else if (msg.type === 'setApiKey') {
    OPENAI_API_KEY = msg.apiKey;
  }
};