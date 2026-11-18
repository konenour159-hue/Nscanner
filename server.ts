import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const OCR_MODEL = 'gemini-4-hydrogen';

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function parseDataUrl(input: string): { mimeType: string; data: string } {
  const match = input.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return {
      mimeType: match[1] || 'image/jpeg',
      data: match[2],
    };
  }
  return {
    mimeType: 'image/jpeg',
    data: input,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '30mb' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Multimodal OCR + Smart Naming & Tagging (French & English)
  app.post('/api/ocr', async (req, res) => {
    try {
      const { images, languageHint = 'auto' } = req.body as {
        images?: string[];
        languageHint?: 'auto' | 'fr' | 'en';
      };

      if (!Array.isArray(images) || images.length === 0) {
        res.status(400).json({ error: 'At least one image data URL is required.' });
        return;
      }

      const ai = getGenAIClient();
      const limitedImages = images.slice(0, 6);

      const languageInstruction =
        languageHint === 'fr'
          ? 'The document is primarily in French. Preserve all French diacritics (é, è, ê, à, ç, œ, etc.) accurately.'
          : languageHint === 'en'
          ? 'The document is primarily in English. Transcribe verbatim.'
          : 'Detect the document language automatically (French, English, or mixed French/English) and preserve all accents and punctuation verbatim.';

      const prompt = [
        'Perform high-accuracy OCR on the provided scanned document page image(s).',
        languageInstruction,
        'For each image (indexed 0..N-1):',
        '- Extract all readable text verbatim in natural reading order.',
        '- Detect page language: "fr", "en", or "mixed".',
        '- Provide normalized bounding blocks (x, y, width, height in 0..1 range relative to the image) for major text paragraphs/lines so the text can be embedded into a searchable PDF.',
        'Also generate:',
        '- 3 to 4 concise, descriptive document filename/title suggestions matching the document content and language (for example "Facture EDF - Nov 2026" or "Apex Consulting Agreement").',
        '- 2 to 4 short organizational tags (1-2 words each).',
      ].join('\n');

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
        { text: prompt },
      ];

      for (const img of limitedImages) {
        const parsed = parseDataUrl(img);
        parts.push({
          inlineData: {
            mimeType: parsed.mimeType,
            data: parsed.data,
          },
        });
      }

      const response = await ai.models.generateContent({
        model: OCR_MODEL,
        contents: [{ role: 'user', parts }],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              detectedLanguage: {
                type: Type.STRING,
                enum: ['fr', 'en', 'mixed'],
              },
              suggestedTitles: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              suggestedTags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              pages: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    pageIndex: { type: Type.INTEGER },
                    language: {
                      type: Type.STRING,
                      enum: ['fr', 'en', 'mixed'],
                    },
                    text: { type: Type.STRING },
                    blocks: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          text: { type: Type.STRING },
                          x: { type: Type.NUMBER },
                          y: { type: Type.NUMBER },
                          width: { type: Type.NUMBER },
                          height: { type: Type.NUMBER },
                        },
                        required: ['text', 'x', 'y', 'width', 'height'],
                      },
                    },
                  },
                  required: ['pageIndex', 'language', 'text', 'blocks'],
                },
              },
            },
            required: ['detectedLanguage', 'suggestedTitles', 'suggestedTags', 'pages'],
          },
        },
      });

      const rawJson = response.text;
      if (!rawJson) {
        throw new Error('OCR model returned an empty response.');
      }

      const parsedResult = JSON.parse(rawJson);
      const fullText = Array.isArray(parsedResult.pages)
        ? parsedResult.pages
            .map((p: { text?: string }) => p.text || '')
            .filter(Boolean)
            .join('\n\n--- Page Break ---\n\n')
        : '';

      res.json({
        detectedLanguage: parsedResult.detectedLanguage || 'en',
        suggestedTitles: parsedResult.suggestedTitles || [],
        suggestedTags: parsedResult.suggestedTags || [],
        pages: parsedResult.pages || [],
        fullText,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'OCR processing failed.';
      console.error('OCR endpoint error:', err);
      res.status(500).json({ error: message });
    }
  });

  // Smart Filename & Tag Suggestions from existing text or image
  app.post('/api/suggest-name', async (req, res) => {
    try {
      const { text, scanMode, image } = req.body as {
        text?: string;
        scanMode?: string;
        image?: string;
      };

      if (!text && !image) {
        res.status(400).json({ error: 'Provide either extracted text or an image.' });
        return;
      }

      const ai = getGenAIClient();
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
        {
          text: `Suggest 4 clean, professional filenames (without file extensions) and 3 short tags for this ${
            scanMode || 'scanned'
          } document. Support French and English matching the document language.${
            text ? `\n\nDocument text:\n${text.slice(0, 4000)}` : ''
          }`,
        },
      ];

      if (image) {
        const parsed = parseDataUrl(image);
        parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
      }

      const response = await ai.models.generateContent({
        model: OCR_MODEL,
        contents: [{ role: 'user', parts }],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              suggestedTitles: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              suggestedTags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['suggestedTitles', 'suggestedTags'],
          },
        },
      });

      const parsedResult = JSON.parse(response.text || '{}');
      res.json({
        suggestedTitles: parsedResult.suggestedTitles || [],
        suggestedTags: parsedResult.suggestedTags || [],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to suggest document names.';
      console.error('Suggest-name endpoint error:', err);
      res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NScanner server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
