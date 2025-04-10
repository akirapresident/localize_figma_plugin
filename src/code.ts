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

async function translateText(text: string, targetLang: string): Promise<string> {
  try {
    console.log(`Starting translation to ${targetLang}: "${text}"`);
    
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
            content: `You are a translator. Translate the following text to ${targetLang}. 
            CRITICAL: Any token in the format [UNTRANSLATABLE_123] MUST remain exactly as is.
            Only translate the parts that are not in [UNTRANSLATABLE_X] format.
            Respond only with the translation, no explanations or additional text.`
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
          
          for (const textNode of clonedTextNodes) {
            const originalText = textNode.characters;
            if (!originalText.trim()) continue;
            
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
              let textToTranslate = originalText;
              const placeholders: {[key: string]: string} = {};
              let placeholderCount = 0;
              
              if (excludedTerms && excludedTerms.length > 0) {
                console.log('Original text:', originalText);
                console.log('Excluded terms to preserve:', excludedTerms);
                
                // Sort excluded terms by length (longest first) to avoid partial matches
                const sortedExcludedTerms = [...excludedTerms]
                  .sort((a, b) => b.length - a.length)
                  .filter(term => term.trim() !== ''); // Remove empty terms
                
                // Process each excluded term individually
                for (const term of sortedExcludedTerms) {
                  // Escape special characters in the term
                  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  
                  // Create regex that matches the whole word with word boundaries
                  const termRegex = new RegExp(`\\b${escapedTerm}\\b`, 'gi'); // Added 'i' flag for case-insensitive matching
                  
                  // Replace each occurrence with a unique placeholder
                  textToTranslate = textToTranslate.replace(termRegex, (match) => {
                    const placeholder = `[UNTRANSLATABLE_${placeholderCount}]`;
                    placeholders[placeholder] = match; // Store the original casing
                    placeholderCount++;
                    console.log(`Replaced "${match}" with placeholder: ${placeholder}`);
                    return placeholder;
                  });
                }
                
                console.log('Text to be translated (with placeholders):', textToTranslate);
                console.log('Placeholder mappings:', placeholders);
              }
              
              // Translate the modified text
              let translatedText = await translateText(textToTranslate, targetLang);
              console.log('Raw translation result:', translatedText);
              
              // Restore excluded terms
              if (Object.keys(placeholders).length > 0) {
                // Sort placeholders by length (longest first) to avoid partial replacements
                const sortedPlaceholders = Object.entries(placeholders)
                  .sort(([a], [b]) => b.length - a.length);
                
                for (const [placeholder, originalTerm] of sortedPlaceholders) {
                  translatedText = translatedText.replace(placeholder, originalTerm);
                  console.log(`Restored "${originalTerm}" from placeholder: ${placeholder}`);
                }
                
                console.log('Final translation with restored terms:', translatedText);
              }
              
              textNode.characters = translatedText;
            } catch (error: any) {
              console.error(`Error translating text node:`, error);
              figma.notify(`Error translating text: ${error.message}`, { error: true });
              hasErrors = true;
            }
          }
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