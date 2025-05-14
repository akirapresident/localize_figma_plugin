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
  { name: "Arabic", code: "ar" }
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

async function translateText(text: string, targetLang: string): Promise<string> {
  try {
    console.log(`Starting translation to ${targetLang}: "${text}"`);
    // Check if the text contains any placeholders
    const hasPlaceholders = /\[UNTRANSLATABLE_\d+\]|\[NUMBER_\d+\]/.test(text);
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
            content: hasPlaceholders 
              ? `You are a translator. Your task is to translate text while preserving specific placeholders.\n\nIMPORTANT RULES:\n1. ONLY preserve placeholders that are already in the input text\n2. DO NOT add any new placeholders to the translation\n3. Any text in the format [UNTRANSLATABLE_X] or [NUMBER_X] (where X is a number) MUST be kept EXACTLY as is in the translation\n4. DO NOT translate, modify, or change these placeholders in any way, including their brackets, underscores, or capitalization\n5. The placeholders should appear in the same position in the translated text\n6. If you see a placeholder like [UNTRANSLATABLE_X] or [NUMBER_X], you must keep it exactly as is, including all brackets and underscores, and do not translate or change it in any way\n\nExamples:\n- Input: "[UNTRANSLATABLE_0] your designs"\n- Output: "[UNTRANSLATABLE_0] seus designs"\n\n- Input: "Create [UNTRANSLATABLE_1] designs"\n- Output: "Criar [UNTRANSLATABLE_1] designs"\n\n- Input: "You have [NUMBER_0] new messages"\n- Output: "Você tem [NUMBER_0] novas mensagens"\n\nNow translate the following text to ${targetLang}. Remember to ONLY preserve placeholders that are already in the input text.`
              : `You are a translator. Translate the following text to ${targetLang}. \nRespond only with the translation, no explanations or additional text.`
          },
          {
            role: "user",
            content: text
          }
        ],
        temperature: 0.1,
        max_tokens: 1000
      })
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

    const translatedText = data.choices[0].message.content.trim();
    console.log(`Translation result: "${translatedText}"`);
    return translatedText;
  } catch (error) {
    console.error('Translation error:', error);
    throw error;
  }
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

    /*
    // PAYWALL DISABLED FOR TESTING - uncomment to re-enable
    if (!isSubscribed && remainingCredits === 0) {
      if (!figma.payments) {
        figma.notify('Payment system not available', { error: true });
        figma.ui.postMessage({ type: 'done' });
        return;
      }

      try {
        await figma.payments.initiateCheckoutAsync({
          interstitial: 'PAID_FEATURE'
        });

        if (figma.payments.status.type === 'UNPAID') {
          figma.notify('Please subscribe to continue translating frames', { error: true });
          figma.ui.postMessage({ type: 'done' });
          return;
        }
      } catch (error) {
        figma.notify('Please subscribe to continue translating frames', { error: true });
        figma.ui.postMessage({ type: 'done' });
        return;
      }
    }
    */

    let hasErrors = false;
    const firstFrameTranslationsY: number[] = [];
    
    // Process each selected frame
    for (const frame of selectedFrames) {
      const textNodes: TextNode[] = [];
      function findTextNodes(node: SceneNode) {
        if (node.type === 'TEXT') {
          textNodes.push(node);
        } else if ('children' in node) {
          for (const child of node.children) {
            findTextNodes(child);
          }
        }
      }
      findTextNodes(frame);
      
      if (textNodes.length === 0) {
        figma.notify(`No text nodes found in frame "${frame.name}"`, { error: true });
        continue;
      }

      for (let i = 0; i < targetLangs.length; i++) {
        const targetLang = targetLangs[i];
        try {
          const clonedFrame = frame.clone() as FrameNode;
          clonedFrame.name = `${frame.name} (${targetLang})`;
          clonedFrame.x = frame.x;
          
          if (frame === selectedFrames[0]) {
            const y = frame.y + frame.height + 50 + (i * (frame.height + 50));
            clonedFrame.y = y;
            firstFrameTranslationsY.push(y);
          } else {
            clonedFrame.y = firstFrameTranslationsY[i];
          }
          
          const clonedTextNodes: TextNode[] = [];
          function findTextNodesInClone(node: SceneNode) {
            if (node.type === 'TEXT') {
              clonedTextNodes.push(node);
            } else if ('children' in node) {
              for (const child of node.children) {
                findTextNodesInClone(child);
              }
            }
          }
          findTextNodesInClone(clonedFrame);
          
          // Translate all text nodes in parallel with concurrency limit
          await asyncPool(8, clonedTextNodes, async (textNode) => {
            const originalText = textNode.characters;
            if (!originalText.trim()) return;
            
            try {
              const fontNames = textNode.getRangeAllFontNames(0, textNode.characters.length);
              try {
                await Promise.all(fontNames.map(figma.loadFontAsync));
              } catch (fontError: any) {
                console.warn(`Font loading error: ${fontError.message}`);
                figma.notify('⚠️ Some fonts could not be loaded. Please temporarily change the font to Roboto or Inter, then change it back after translation.', { timeout: 10000 });
              }
              
              const languageName = languages.find(lang => lang.code === targetLang)?.name || targetLang;
              figma.notify(`Translating to ${languageName}...`);
              
              // Check if the text contains any excluded terms
              let { text: textToTranslate, placeholders, numberPlaceholders } = replaceWithPlaceholders(originalText, excludedTerms);
              
              // Translate the modified text
              let translatedText = await translateText(textToTranslate, targetLang);
              console.log('Raw translation result:', translatedText);
              
              // Restore excluded terms first
              for (const [placeholder, originalTerm] of Object.entries(placeholders)) {
                translatedText = translatedText.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), originalTerm);
              }
              // Restore numbers
              for (const [placeholder, originalNumber] of Object.entries(numberPlaceholders)) {
                translatedText = translatedText.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), originalNumber);
              }
              
              textNode.characters = translatedText;
            } catch (error: any) {
              console.error(`Error translating text node:`, error);
              figma.notify(`Error translating text: ${error.message}`, { error: true });
              hasErrors = true;
            }
          });
        } catch (error: any) {
          console.error(`Error translating to ${targetLang}:`, error);
          figma.notify(`Error translating to ${targetLang}: ${error.message}`, { error: true });
          hasErrors = true;
        }
      }
    }

    if (!isSubscribed) {
      await figma.clientStorage.setAsync('translatedFramesCount', translatedFramesCount + selectedFrames.length);
    }
    updateStatusDisplay();

    if (!hasErrors) {
      figma.notify('Translation completed successfully!');
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
  }
};