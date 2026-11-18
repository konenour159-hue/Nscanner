import { OcrBlock, OcrLanguage } from '../types/scanner';

export interface OcrPageResult {
  pageIndex: number;
  language: OcrLanguage;
  text: string;
  blocks: OcrBlock[];
}

export interface OcrApiResponse {
  detectedLanguage: OcrLanguage;
  suggestedTitles: string[];
  suggestedTags: string[];
  pages: OcrPageResult[];
  fullText: string;
}

export interface SuggestNameResponse {
  suggestedTitles: string[];
  suggestedTags: string[];
}

/**
 * Downscales a data URL slightly for fast OCR upload while keeping text crisp.
 */
async function prepareImageForOcr(dataUrl: string, maxDim = 1600): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (w <= maxDim && h <= maxDim) {
        resolve(dataUrl);
        return;
      }
      const scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export async function runDocumentOcr(
  imageDataUrls: string[],
  languageHint: 'auto' | 'fr' | 'en' = 'auto'
): Promise<OcrApiResponse> {
  const preparedImages = await Promise.all(
    imageDataUrls.map((url) => prepareImageForOcr(url))
  );

  const response = await fetch('/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      images: preparedImages,
      languageHint,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `OCR request failed (${response.status})`);
  }

  return payload as OcrApiResponse;
}

export async function suggestDocumentNames(params: {
  text?: string;
  image?: string;
  scanMode?: string;
}): Promise<SuggestNameResponse> {
  const preparedImage = params.image
    ? await prepareImageForOcr(params.image, 1200)
    : undefined;

  const response = await fetch('/api/suggest-name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: params.text,
      image: preparedImage,
      scanMode: params.scanMode,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `Suggest-name request failed (${response.status})`);
  }

  return payload as SuggestNameResponse;
}
