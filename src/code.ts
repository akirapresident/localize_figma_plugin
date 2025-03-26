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

// Add these types at the top of the file
type TranslationResponse = {
  choices: {
    message: {
      content: string
    }
  }[];
};

async function translateText(text: string, apiKey: string, targetLang: string): Promise<string> {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `You are a translator. Translate the following text to ${targetLang}. Only respond with the translation, no explanations.`
          },
          {
            role: "user",
            content: text
          }
        ],
        temperature: 0.3 // Lower temperature for more consistent translations
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`API request failed: ${response.status} ${response.statusText}. Details: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json() as TranslationResponse;
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error('Translation error:', error);
    throw error;
  }
}

async function translateTextNodes(apiKey: string, targetLangs: string[]) {
  if (figma.currentPage.selection.length === 0) {
    figma.notify('Please select a frame first');
    return;
  }

  const selectedNode = figma.currentPage.selection[0];
  
  if (selectedNode.type !== 'FRAME' && selectedNode.type !== 'GROUP') {
    figma.notify('Please select a frame or group');
    return;
  }

  // Keep track of the last positioned frame
  let lastPositionedFrame = selectedNode;

  // Create a copy for each selected language
  for (const targetLang of targetLangs) {
    // Duplicate the frame
    const duplicatedNode = selectedNode.clone();
    
    // Position the duplicated frame below the last positioned frame
    duplicatedNode.y = lastPositionedFrame.y + lastPositionedFrame.height + 50; // 50px gap between frames
    
    // Update the name of the duplicated frame
    const languageName = languages.find(lang => lang.code === targetLang)?.name || targetLang;
    duplicatedNode.name = `[${languageName.toUpperCase()}] ${selectedNode.name}`;

    // Update the last positioned frame for the next iteration
    lastPositionedFrame = duplicatedNode;

    const textNodes: TextNode[] = [];
    
    function findAllTextNodes(node: SceneNode) {
      if (node.type === 'TEXT') {
        textNodes.push(node);
      } else if ('children' in node) {
        for (const child of node.children) {
          findAllTextNodes(child);
        }
      }
    }
    
    findAllTextNodes(duplicatedNode);
    
    if (textNodes.length === 0) {
      figma.notify('No text nodes found in the selected frame');
      continue;
    }

    figma.notify(`Translating to ${languageName}...`);
    
    for (const textNode of textNodes) {
      try {
        console.log(`Processing: "${textNode.characters}"`);

        if (textNode.hasMissingFont) {
          console.log(`Skipping "${textNode.characters}" - missing font`);
          continue;
        }

        // Load fonts before modifying text
        const fontNames = textNode.getRangeAllFontNames(0, textNode.characters.length);
        await Promise.all(fontNames.map(figma.loadFontAsync));

        // Translate the text
        const originalText = textNode.characters;
        const translatedText = await translateText(originalText, apiKey, targetLang);
        
        // Update the text node
        textNode.characters = translatedText;
        console.log(`Translated: "${originalText}" → "${translatedText}"`);
        
      } catch (error) {
        console.error(`Error processing "${textNode.characters}":`, error);
      }
    }
  }

  figma.notify('All translations completed!');
}

// Show the UI
figma.showUI(__html__, { width: 400, height: 608 });

// Handle messages from the UI
figma.ui.onmessage = async msg => {
  if (msg.type === 'translate') {
    try {
      await translateTextNodes(msg.apiKey, msg.targetLangs);
      figma.closePlugin();
    } catch (error: any) {
      figma.notify('Translation failed: ' + error.message);
    }
  }
};
