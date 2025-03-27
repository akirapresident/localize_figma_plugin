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

// Function to update status display
async function updateStatusDisplay() {
  const translatedFramesCount = await figma.clientStorage.getAsync('translatedFramesCount') || 0;
  const remainingCredits = Math.max(0, FREE_FRAMES_LIMIT - translatedFramesCount);
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
            content: `You are a translator. Translate the following text to ${targetLang}. Only respond with the translation, no explanations or additional text.`
          },
          {
            role: "user",
            content: text
          }
        ],
        temperature: 0.3,
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
figma.showUI(__html__, { width: 400, height: 500 });

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
        // Show payment UI
        await figma.payments.initiateCheckoutAsync({
          interstitial: 'PAID_FEATURE'
        });

        // Check if user completed payment
        if (figma.payments.status.type === 'UNPAID') {
          figma.notify('Please subscribe to continue translating frames', { error: true });
          figma.ui.postMessage({ type: 'done' });
          return;
        }
      } catch (error) {
        // User closed the payment popup
        figma.notify('Please subscribe to continue translating frames', { error: true });
        figma.ui.postMessage({ type: 'done' });
        return;
      }
    }

    let hasErrors = false;
    const firstFrameTranslationsY: number[] = [];
    
    // Process each selected frame
    for (const frame of selectedFrames) {
      // Find all text nodes within the frame
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

      // Create one clone for each target language
      for (let i = 0; i < targetLangs.length; i++) {
        const targetLang = targetLangs[i];
        try {
          // Clone the frame for this translation
          const clonedFrame = frame.clone() as FrameNode;
          clonedFrame.name = `${frame.name} (${targetLang})`;
          
          // Position the cloned frame
          clonedFrame.x = frame.x;
          
          // If this is the first frame, calculate and store the Y positions
          if (frame === selectedFrames[0]) {
            // First translation starts 50px below the original frame
            const y = frame.y + frame.height + 50 + (i * (frame.height + 50));
            clonedFrame.y = y;
            firstFrameTranslationsY.push(y);
          } else {
            // For subsequent frames, use the same Y positions as the first frame
            clonedFrame.y = firstFrameTranslationsY[i];
          }
          
          // Find text nodes in the cloned frame
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
          
          // Translate each text node in the cloned frame
          for (const textNode of clonedTextNodes) {
            const originalText = textNode.characters;
            if (!originalText.trim()) continue;
            
            try {
              // Load fonts before modifying text
              const fontNames = textNode.getRangeAllFontNames(0, textNode.characters.length);
              try {
                await Promise.all(fontNames.map(figma.loadFontAsync));
              } catch (fontError: any) {
                console.warn(`Font loading error: ${fontError.message}`);
                figma.notify('⚠️ Some fonts could not be loaded. Please temporarily change the font to Roboto or Inter, then change it back after translation.', { timeout: 10000 });
                // Continue with translation despite font error
              }
              
              // Get the language name for the notification
              const languageName = languages.find(lang => lang.code === targetLang)?.name || targetLang;
              figma.notify(`Translating to ${languageName}...`);
              
              // Translate the text
              const translatedText = await translateText(originalText, targetLang);
              textNode.characters = translatedText;
              console.log(`Translated: "${originalText}" → "${translatedText}"`);
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

    // Update translated frames count and status display
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
        // Show payment UI
        await figma.payments.initiateCheckoutAsync({
          interstitial: 'PAID_FEATURE'
        });

        // Check if user completed payment
        if (figma.payments.status.type === 'PAID') {
          figma.notify('Thank you for subscribing!');
          // Reset credits when user subscribes
          await figma.clientStorage.setAsync('translatedFramesCount', 0);
          // Update UI with new status
          await updateStatusDisplay();
        } else {
          // User closed the payment popup without subscribing
          figma.notify('Subscription cancelled', { error: true });
          // Make sure we update UI to show user is not subscribed
          await updateStatusDisplay();
        }
      } catch (error) {
        // Handle any errors during subscription process
        console.error('Subscription error:', error);
        figma.notify('Subscription cancelled', { error: true });
        // Make sure we update UI to show user is not subscribed
        await updateStatusDisplay();
      }
    }
  }
};