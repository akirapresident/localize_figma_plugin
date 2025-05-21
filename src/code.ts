// Define languages directly in the file for now
const languages = [
  { name: "Portuguese (Brazil)", code: "pt-BR" },
  { name: "English", code: "en" },
  { name: "Spanish", code: "es" },
  { name: "French", code: "fr" },
  { name: "German", code: "de" },
  { name: "Italian", code: "it" },
  { name: "Japanese", code: "ja" },
  { name: "Korean", code: "ko" },
  { name: "Chinese (Simplified)", code: "zh-CN" },
  { name: "Chinese (Traditional)", code: "zh-TW" },
  { name: "Russian", code: "ru" },
  { name: "Arabic", code: "ar" },
  { name: "Thai", code: "th" },
  { name: "Tamil", code: "ta" },
  { name: "Urdu", code: "ur" },
  { name: "Amharic", code: "am" },
  { name: "Belarusian", code: "be" },
  { name: "Georgian", code: "ka" },
  { name: "Malayalam", code: "ml" },
  { name: "Persian", code: "fa" },
];

// Store the API key directly in the code
const OPENAI_API_KEY = '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';

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
    const normalizedTargetLang = targetLang.split('-')[0];
    console.log("[DEBUG] normalizedTargetLang:", normalizedTargetLang);
    if (!languages.find(lang => lang.code === normalizedTargetLang)) {
      throw new Error(`[ERRO] Idioma não suportado: ${targetLang}`);
    }

    const langObj = languages.find(lang => lang.code === targetLang);
    const langName = langObj ? langObj.name : targetLang;

    console.log("[DEBUG] Usando langName no prompt:", langName);

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
            content: `You are a professional translator. Translate ALL of the following texts to ${langName}. The output must be in the ${langName} script, not English.
IMPORTANT RULES:
1. Preserve all placeholders in the format [UNTRANSLATABLE_X] or [NUMBER_X]
2. Return translations as a JSON array of strings
3. Keep the exact same order as the input
4. Do not add any explanations or additional text

Example input:
["Hello [UNTRANSLATABLE_0]", "You have [NUMBER_0] messages"]
`
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
      throw new Error(`API request failed: ${response.status} ${response.statusText}. Details: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json() as TranslationResponse;
    if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
      console.error('Invalid API response:', data);
      throw new Error('Invalid API response format');
    }

    console.log("[DEBUG] Resposta da OpenAI:", data);

    const translatedTexts = JSON.parse(data.choices[0].message.content) as string[];
    console.log("[DEBUG] Traduções recebidas:", translatedTexts);
    console.log(`Batch translation completed for ${translatedTexts.length} texts`);
    return translatedTexts;
  } catch (error) {
    console.error('Batch translation error:', error);
    throw error;
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
            const normalizedTargetLang = targetLang.split('-')[0];
            const translatedTexts = await translateBatch(textsToTranslate, normalizedTargetLang);

            // Update the text nodes with translations
            for (let i = 0; i < batch.length; i++) {
              const node = batch[i];
              const translatedText = translatedTexts[i];
              
              try {
                // Load the font first
                await figma.loadFontAsync(node.fontName as FontName);
                
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
          hasErrors = true;
          figma.notify(`Error translating to ${targetLang}: ${error.message}`, { error: true });
        }
      }
    }

    // Update translated frames count
    if (!hasErrors) {
      const newCount = translatedFramesCount + selectedFrames.length;
      await figma.clientStorage.setAsync('translatedFramesCount', newCount);
      updateStatusDisplay();
    }

    // Notify completion
    figma.notify(hasErrors ? 'Translation completed with errors' : 'Translation completed successfully');
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
  }
};