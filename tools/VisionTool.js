/**
 * Vision Tool — Maya Phase 4
 *
 * Analyzes images using Gemini Vision (gemini-2.0-flash).
 * Accepts base64-encoded image data from the Android app.
 *
 * Env vars required:
 *   GEMINI_API_KEY  — same key used by GeminiProvider
 */

const axios = require('axios');

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`;

const DEFAULT_PROMPTS = {
  object:   'What object or thing is in this image? Be concise, 2-3 sentences.',
  text:     'Read and transcribe all the text visible in this image.',
  scene:    'Describe this scene or place in 2-3 sentences.',
  document: 'Read this document and summarize the key information.',
  general:  'Describe what you see in this image in 2-3 sentences.',
};

function buildVisionPrompt(message) {
  const lower = message.toLowerCase();
  if (/read|text|ocr|what does it say|transcribe/.test(lower)) return DEFAULT_PROMPTS.text;
  if (/document|paper|form|letter|receipt|bill/.test(lower)) return DEFAULT_PROMPTS.document;
  if (/scene|place|where is this|describe/.test(lower)) return DEFAULT_PROMPTS.scene;
  if (/what is this|what is that|identify|object/.test(lower)) return DEFAULT_PROMPTS.object;
  // Use the user's actual question as the prompt
  return message.trim() || DEFAULT_PROMPTS.general;
}

async function analyze(message, imageBase64, mimeType = 'image/jpeg') {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { reply: 'Vision tool is not configured. Please add GEMINI_API_KEY.', toolUsed: 'vision' };
  }
  if (!imageBase64) {
    return { reply: 'No image provided. Please take a photo first.', toolUsed: 'vision' };
  }

  const prompt = buildVisionPrompt(message);

  try {
    const { data } = await axios.post(
      `${GEMINI_URL}?key=${apiKey}`,
      {
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
          ],
        }],
        generationConfig: { maxOutputTokens: 300, temperature: 0.3 },
      },
      { timeout: 20000 }
    );

    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!reply) return { reply: 'Could not analyze the image. Please try again.', toolUsed: 'vision' };

    return { reply, toolUsed: 'vision' };

  } catch (err) {
    console.error(`[VisionTool] Error: ${err.message}`);
    return { reply: 'Vision analysis failed. Please try again.', toolUsed: 'vision' };
  }
}

module.exports = { analyze };
