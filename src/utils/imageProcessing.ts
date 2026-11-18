import {
  AdjustmentParams,
  FilterPreset,
  PageAnnotation,
  PageItem,
  QuadCorners,
} from '../types/scanner';

/**
 * Loads an image from a data URL or image source.
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error('Failed to load image: ' + e));
    img.src = src;
  });
}

/**
 * Creates a downscaled thumbnail from a data URL for fast previews and smooth UI.
 */
export async function createThumbnail(dataUrl: string, maxDimension = 320): Promise<string> {
  const img = await loadImage(dataUrl);
  let { width, height } = img;

  if (width > height) {
    if (width > maxDimension) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    }
  } else {
    if (height > maxDimension) {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.78);
}

/**
 * SHADOW & CREASE REMOVAL (Local Paper Illumination Normalization + Neutral White Balance):
 * Builds a coarse upper-quartile illumination map of the document sheet so hand shadows,
 * desk gradients, and warm indoor color casts normalize evenly toward crisp white paper
 * while dark ink and colored stamps stay vivid.
 */
function applyShadowRemovalInPlace(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  strength = 0.88
) {
  const mapW = Math.max(18, Math.min(84, Math.round(width / 14)));
  const mapH = Math.max(18, Math.min(84, Math.round((height * mapW) / width)));

  const bgMapR = new Float32Array(mapW * mapH);
  const bgMapG = new Float32Array(mapW * mapH);
  const bgMapB = new Float32Array(mapW * mapH);

  const cellW = width / mapW;
  const cellH = height / mapH;

  // 1. Sample upper-bright paper envelope per cell (averaging top bright samples avoids glare spikes)
  for (let my = 0; my < mapH; my++) {
    const yStart = Math.floor(my * cellH);
    const yEnd = Math.min(height, Math.ceil((my + 1) * cellH));
    for (let mx = 0; mx < mapW; mx++) {
      const xStart = Math.floor(mx * cellW);
      const xEnd = Math.min(width, Math.ceil((mx + 1) * cellW));

      const stepY = Math.max(1, Math.floor((yEnd - yStart) / 4));
      const stepX = Math.max(1, Math.floor((xEnd - xStart) / 4));

      const cellSamples: { lum: number; r: number; g: number; b: number }[] = [];
      for (let y = yStart; y < yEnd; y += stepY) {
        for (let x = xStart; x < xEnd; x += stepX) {
          const idx = (y * width + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          cellSamples.push({ lum, r, g, b });
        }
      }

      cellSamples.sort((a, b) => b.lum - a.lum);
      const topCount = Math.max(1, Math.min(4, Math.ceil(cellSamples.length * 0.28)));
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      for (let k = 0; k < topCount; k++) {
        sumR += cellSamples[k].r;
        sumG += cellSamples[k].g;
        sumB += cellSamples[k].b;
      }

      const mIdx = my * mapW + mx;
      bgMapR[mIdx] = Math.max(64, sumR / topCount);
      bgMapG[mIdx] = Math.max(64, sumG / topCount);
      bgMapB[mIdx] = Math.max(64, sumB / topCount);
    }
  }

  // 2. Smooth the paper illumination field with 3 passes of 3x3 box blur
  const smoothChannel = (src: Float32Array) => {
    let cur = new Float32Array(src);
    const next = new Float32Array(src.length);
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < mapH; y++) {
        for (let x = 0; x < mapW; x++) {
          let sum = 0;
          let count = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const ny = Math.min(mapH - 1, Math.max(0, y + dy));
            for (let dx = -1; dx <= 1; dx++) {
              const nx = Math.min(mapW - 1, Math.max(0, x + dx));
              sum += cur[ny * mapW + nx];
              count++;
            }
          }
          next[y * mapW + x] = sum / count;
        }
      }
      cur = new Float32Array(next);
    }
    return cur;
  };

  const smoothR = smoothChannel(bgMapR);
  const smoothG = smoothChannel(bgMapG);
  const smoothB = smoothChannel(bgMapB);

  // 3. Bilinearly divide out uneven illumination + subtle white-paper balance
  const targetPaper = 252;
  for (let y = 0; y < height; y++) {
    const gy = (y / height) * (mapH - 1);
    const y0 = Math.floor(gy);
    const y1 = Math.min(mapH - 1, y0 + 1);
    const fy = gy - y0;

    for (let x = 0; x < width; x++) {
      const gx = (x / width) * (mapW - 1);
      const x0 = Math.floor(gx);
      const x1 = Math.min(mapW - 1, x0 + 1);
      const fx = gx - x0;

      const i00 = y0 * mapW + x0;
      const i10 = y0 * mapW + x1;
      const i01 = y1 * mapW + x0;
      const i11 = y1 * mapW + x1;

      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      const bgR = smoothR[i00] * w00 + smoothR[i10] * w10 + smoothR[i01] * w01 + smoothR[i11] * w11;
      const bgG = smoothG[i00] * w00 + smoothG[i10] * w10 + smoothG[i01] * w01 + smoothG[i11] * w11;
      const bgB = smoothB[i00] * w00 + smoothB[i10] * w10 + smoothB[i01] * w01 + smoothB[i11] * w11;

      // Blend channel-specific background with luminance envelope to preserve natural photo color while fixing paper cast
      const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
      const refR = bgR * 0.65 + bgLum * 0.35;
      const refG = bgG * 0.65 + bgLum * 0.35;
      const refB = bgB * 0.65 + bgLum * 0.35;

      const idx = (y * width + x) * 4;
      const normR = Math.min(255, (data[idx] / Math.max(48, refR)) * targetPaper);
      const normG = Math.min(255, (data[idx + 1] / Math.max(48, refG)) * targetPaper);
      const normB = Math.min(255, (data[idx + 2] / Math.max(48, refB)) * targetPaper);

      data[idx] = data[idx] * (1 - strength) + normR * strength;
      data[idx + 1] = data[idx + 1] * (1 - strength) + normG * strength;
      data[idx + 2] = data[idx + 2] * (1 - strength) + normB * strength;
    }
  }
}

/**
 * SAUVOLA-INSPIRED ADAPTIVE THRESHOLDING:
 * Uses integral images for both local mean AND local standard deviation so crisp thin
 * pen/printed ink stays continuous and sharp while creased or dimmed paper disappears to pure white.
 */
function applyAdaptiveThresholdInPlace(
  data: Uint8ClampedArray,
  width: number,
  height: number
) {
  const total = width * height;
  const lum = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    lum[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }

  const stride = width + 1;
  const sat = new Float64Array(stride * (height + 1));
  const satSq = new Float64Array(stride * (height + 1));

  for (let y = 1; y <= height; y++) {
    let rowSum = 0;
    let rowSumSq = 0;
    for (let x = 1; x <= width; x++) {
      const v = lum[(y - 1) * width + (x - 1)];
      rowSum += v;
      rowSumSq += v * v;
      sat[y * stride + x] = sat[(y - 1) * stride + x] + rowSum;
      satSq[y * stride + x] = satSq[(y - 1) * stride + x] + rowSumSq;
    }
  }

  const radius = Math.max(10, Math.round(Math.min(width, height) / 24));
  const k = 0.22;
  const dynamicRange = 128;

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const count = (y1 - y0) * (x1 - x0);

      const sum =
        sat[y1 * stride + x1] -
        sat[y0 * stride + x1] -
        sat[y1 * stride + x0] +
        sat[y0 * stride + x0];
      const sumSq =
        satSq[y1 * stride + x1] -
        satSq[y0 * stride + x1] -
        satSq[y1 * stride + x0] +
        satSq[y0 * stride + x0];

      const mean = sum / count;
      const variance = Math.max(0, sumSq / count - mean * mean);
      const stdDev = Math.sqrt(variance);

      // Sauvola adaptive threshold with floor guard so empty white paper has zero salt noise
      const sauvola = mean * (1 + k * (stdDev / dynamicRange - 1));
      const threshold = Math.min(sauvola, mean * 0.93);

      const pxLum = lum[y * width + x];
      let val: number;
      if (stdDev < 7 && pxLum > 170) {
        // Uniform light paper region -> pure white
        val = 255;
      } else {
        // Smooth anti-aliased transition band (~14 lum levels) so typography stays crisp
        const diff = pxLum - threshold;
        if (diff <= -7) {
          val = 0;
        } else if (diff >= 7) {
          val = 255;
        } else {
          val = Math.round(((diff + 7) / 14) * 255);
        }
      }

      const idx = (y * width + x) * 4;
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
    }
  }
}

/**
 * Core image processing pipeline:
 * Applies rotation, strong illumination/shadow removal, real-world scanner presets
 * (Magic Color, B&W Pure Sauvola, Grayscale, Eco Light), S-curve contrast, and unsharp masking.
 */
export async function processImage(
  dataUrl: string,
  filter: FilterPreset,
  adjustments: AdjustmentParams,
  rotation = 0,
  targetMaxDimension = 2200
): Promise<string> {
  const img = await loadImage(dataUrl);

  let origWidth = img.naturalWidth || img.width;
  let origHeight = img.naturalHeight || img.height;

  if (targetMaxDimension && (origWidth > targetMaxDimension || origHeight > targetMaxDimension)) {
    if (origWidth > origHeight) {
      origHeight = Math.round((origHeight * targetMaxDimension) / origWidth);
      origWidth = targetMaxDimension;
    } else {
      origWidth = Math.round((origWidth * targetMaxDimension) / origHeight);
      origHeight = targetMaxDimension;
    }
  }

  const isRotated90or270 = rotation % 180 !== 0;
  const canvasWidth = isRotated90or270 ? origHeight : origWidth;
  const canvasHeight = isRotated90or270 ? origWidth : origHeight;

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return dataUrl;

  ctx.save();
  ctx.translate(canvasWidth / 2, canvasHeight / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, -origWidth / 2, -origHeight / 2, origWidth, origHeight);
  ctx.restore();

  const shadowRemovalEnabled =
    adjustments.shadowRemoval !== undefined
      ? adjustments.shadowRemoval
      : filter !== 'original';

  const isZeroAdjustments =
    adjustments.brightness === 0 &&
    adjustments.contrast === 0 &&
    adjustments.sharpness === 0 &&
    adjustments.warmth === 0 &&
    adjustments.saturation === 0;

  if (filter === 'original' && isZeroAdjustments && !shadowRemovalEnabled) {
    return canvas.toDataURL('image/jpeg', 0.93);
  }

  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const data = imageData.data;
  const len = data.length;

  // 0. LOCAL PAPER ILLUMINATION & SHADOW FLATTENING
  if (shadowRemovalEnabled) {
    const customStrength =
      adjustments.shadowStrength !== undefined
        ? Math.max(0, Math.min(1, adjustments.shadowStrength / 100))
        : null;
    const defaultStrength =
      filter === 'original'
        ? 0.65
        : filter === 'bw'
        ? 0.94
        : filter === 'magic'
        ? 0.92
        : 0.88;
    applyShadowRemovalInPlace(data, canvasWidth, canvasHeight, customStrength ?? defaultStrength);
  }

  const brightnessOffset = (adjustments.brightness / 100) * 128;
  const contrastFactor =
    adjustments.contrast >= 0
      ? 1 + (adjustments.contrast / 100) * 2.2
      : 1 + adjustments.contrast / 100;
  const redShift = (adjustments.warmth / 50) * 26;
  const blueShift = -(adjustments.warmth / 50) * 26;
  const satFactor = 1 + adjustments.saturation / 100;

  if (filter === 'bw') {
    if (adjustments.brightness !== 0 || adjustments.contrast !== 0) {
      for (let i = 0; i < len; i += 4) {
        data[i] = Math.min(255, Math.max(0, (data[i] + brightnessOffset - 128) * contrastFactor + 128));
        data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] + brightnessOffset - 128) * contrastFactor + 128));
        data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] + brightnessOffset - 128) * contrastFactor + 128));
      }
    }
    applyAdaptiveThresholdInPlace(data, canvasWidth, canvasHeight);
  } else {
    for (let i = 0; i < len; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      if (filter === 'magic') {
        // Real-world paper whitening + deep ink boost + chroma retention
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum >= 168) {
          // Smoothly push normalized off-white paper cleanly toward pure #FFFFFF
          const t = (lum - 168) / 87;
          const lift = Math.pow(t, 0.72) * (255 - lum) * 0.9;
          r = Math.min(255, r + lift);
          g = Math.min(255, g + lift);
          b = Math.min(255, b + lift);
        } else {
          // Deepen printed/handwritten ink proportionally so faint pen strokes pop
          const inkDepth = (168 - lum) / 168;
          const darken = 1 - Math.pow(inkDepth, 0.92) * 0.54;
          r = Math.max(0, r * darken);
          g = Math.max(0, g * darken);
          b = Math.max(0, b * darken);
        }
        // Rich color retention for signatures, stamps, IDs & highlighter ink
        const avg = (r + g + b) / 3;
        r = Math.min(255, Math.max(0, avg + (r - avg) * 1.24));
        g = Math.min(255, Math.max(0, avg + (g - avg) * 1.24));
        b = Math.min(255, Math.max(0, avg + (b - avg) * 1.24));
      } else if (filter === 'grayscale') {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        // High-legibility archival S-curve monochrome
        let mapped: number;
        if (lum >= 175) {
          mapped = Math.min(255, lum + ((lum - 175) / 80) * 38);
        } else {
          mapped = Math.max(0, (lum - 135) * 1.38 + 135);
        }
        r = mapped;
        g = mapped;
        b = mapped;
      } else if (filter === 'eco') {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum > 152) {
          r = 255;
          g = 255;
          b = 255;
        } else {
          // Clean dark-charcoal ink saving printer toner while staying legible
          const ink = Math.min(245, Math.max(32, lum * 0.72));
          r = ink;
          g = ink;
          b = ink;
        }
      }

      if (adjustments.warmth !== 0) {
        r += redShift;
        b += blueShift;
      }

      if (adjustments.brightness !== 0) {
        r += brightnessOffset;
        g += brightnessOffset;
        b += brightnessOffset;
      }

      if (adjustments.contrast !== 0) {
        r = (r - 128) * contrastFactor + 128;
        g = (g - 128) * contrastFactor + 128;
        b = (b - 128) * contrastFactor + 128;
      }

      if (adjustments.saturation !== 0 && filter !== 'grayscale') {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        r = gray + (r - gray) * satFactor;
        g = gray + (g - gray) * satFactor;
        b = gray + (b - gray) * satFactor;
      }

      data[i] = Math.min(255, Math.max(0, r));
      data[i + 1] = Math.min(255, Math.max(0, g));
      data[i + 2] = Math.min(255, Math.max(0, b));
    }
  }

  // Unsharp mask edge clarity (stronger response for real-world camera softness)
  if (adjustments.sharpness > 0 || filter === 'magic') {
    const sharpnessAmount =
      (adjustments.sharpness / 100) * 1.25 + (filter === 'magic' ? 0.34 : 0);
    applySharpness(imageData, canvasWidth, canvasHeight, sharpnessAmount);
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.93);
}

/**
 * 3x3 convolution kernel for unsharp mask text edge enhancement
 */
function applySharpness(
  imageData: ImageData,
  width: number,
  height: number,
  amount: number
) {
  if (amount <= 0) return;
  const src = new Uint8ClampedArray(imageData.data);
  const dst = imageData.data;

  const wCenter = 1 + 4 * amount;
  const wSide = -amount;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = src[((y - 1) * width + x) * 4 + c];
        const bottom = src[((y + 1) * width + x) * 4 + c];
        const left = src[(y * width + (x - 1)) * 4 + c];
        const right = src[(y * width + (x + 1)) * 4 + c];
        const center = src[idx + c];

        const val = center * wCenter + (top + bottom + left + right) * wSide;
        dst[idx + c] = Math.min(255, Math.max(0, val));
      }
    }
  }
}

/**
 * Composites normalized PageAnnotation[] onto a page image cleanly
 * without modifying originalDataUrl.
 */
export async function renderPageWithAnnotations(
  page: PageItem,
  outputMime: 'image/jpeg' | 'image/png' = 'image/jpeg',
  quality = 0.92
): Promise<string> {
  const baseUrl = page.processedDataUrl || page.originalDataUrl;
  const annotations = page.annotations || [];
  if (annotations.length === 0 && outputMime === 'image/jpeg') {
    return baseUrl;
  }

  const img = await loadImage(baseUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return baseUrl;

  ctx.drawImage(img, 0, 0, w, h);

  for (const ann of annotations) {
    await drawSingleAnnotation(ctx, ann, w, h);
  }

  return canvas.toDataURL(outputMime, quality);
}

async function drawSingleAnnotation(
  ctx: CanvasRenderingContext2D,
  ann: PageAnnotation,
  w: number,
  h: number
) {
  ctx.save();
  if ((ann.type === 'pen' || ann.type === 'highlighter') && ann.points && ann.points.length > 1) {
    ctx.globalAlpha = ann.opacity ?? (ann.type === 'highlighter' ? 0.38 : 1);
    ctx.strokeStyle = ann.color;
    ctx.lineWidth = Math.max(2, (ann.strokeWidth ?? (ann.type === 'highlighter' ? 0.022 : 0.005)) * w);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (ann.type === 'highlighter') {
      ctx.globalCompositeOperation = 'multiply';
    }
    ctx.beginPath();
    ctx.moveTo(ann.points[0].x * w, ann.points[0].y * h);
    for (let i = 1; i < ann.points.length; i++) {
      ctx.lineTo(ann.points[i].x * w, ann.points[i].y * h);
    }
    ctx.stroke();
  } else if (ann.type === 'text' && ann.text) {
    const px = (ann.x ?? 0.2) * w;
    const py = (ann.y ?? 0.2) * h;
    const fontSizePx = Math.max(14, Math.round(((ann.fontSize ?? 28) / 1000) * h));
    ctx.font = `600 ${fontSizePx}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = ann.color || '#242238';
    ctx.textBaseline = 'top';
    const lines = ann.text.split('\n');
    lines.forEach((line, idx) => {
      ctx.fillText(line, px, py + idx * fontSizePx * 1.25);
    });
  } else if (ann.type === 'stamp' && ann.text) {
    const sx = (ann.x ?? 0.5) * w;
    const sy = (ann.y ?? 0.5) * h;
    const sw = (ann.width ?? 0.26) * w;
    const sh = (ann.height ?? 0.07) * h;
    ctx.translate(sx + sw / 2, sy + sh / 2);
    ctx.rotate(-0.08);
    ctx.strokeStyle = ann.color || '#C94E5B';
    ctx.lineWidth = Math.max(2, w * 0.004);
    ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
    ctx.fillStyle = ann.color || '#C94E5B';
    const fontPx = Math.max(12, Math.round(sh * 0.44));
    ctx.font = `800 ${fontPx}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ann.text.toUpperCase(), 0, 0);
  } else if (ann.type === 'signature' && ann.signatureDataUrl) {
    try {
      const sigImg = await loadImage(ann.signatureDataUrl);
      const sx = (ann.x ?? 0.3) * w;
      const sy = (ann.y ?? 0.7) * h;
      const sw = (ann.width ?? 0.3) * w;
      const sh = (ann.height ?? 0.12) * h;
      ctx.drawImage(sigImg, sx, sy, sw, sh);
    } catch {
      // ignore unloadable signature
    }
  }
  ctx.restore();
}

/**
 * Performs Quad Warp / Perspective Crop from 4 arbitrary corner coordinates.
 * Normalized corners: 0 to 1 range.
 */
export async function perspectiveCrop(
  dataUrl: string,
  corners: QuadCorners,
  outputWidth?: number,
  outputHeight?: number
): Promise<string> {
  const img = await loadImage(dataUrl);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;

  const p0 = { x: corners.topLeft.x * srcW, y: corners.topLeft.y * srcH };
  const p1 = { x: corners.topRight.x * srcW, y: corners.topRight.y * srcH };
  const p2 = { x: corners.bottomRight.x * srcW, y: corners.bottomRight.y * srcH };
  const p3 = { x: corners.bottomLeft.x * srcW, y: corners.bottomLeft.y * srcH };

  const topDist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const bottomDist = Math.hypot(p2.x - p3.x, p2.y - p3.y);
  const leftDist = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const rightDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);

  let targetW = Math.max(64, Math.round(outputWidth || Math.max(topDist, bottomDist)));
  let targetH = Math.max(64, Math.round(outputHeight || Math.max(leftDist, rightDist)));

  const maxOutDim = 2200;
  if (!outputWidth && !outputHeight && (targetW > maxOutDim || targetH > maxOutDim)) {
    const scale = maxOutDim / Math.max(targetW, targetH);
    targetW = Math.max(64, Math.round(targetW * scale));
    targetH = Math.max(64, Math.round(targetH * scale));
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;

  // O(1) GPU-accelerated fast path for orthogonal rectangular paper bounds (~2ms vs triangle mesh)
  const isOrthogonalRect =
    Math.abs(corners.topLeft.x - corners.bottomLeft.x) < 0.003 &&
    Math.abs(corners.topRight.x - corners.bottomRight.x) < 0.003 &&
    Math.abs(corners.topLeft.y - corners.topRight.y) < 0.003 &&
    Math.abs(corners.bottomLeft.y - corners.bottomRight.y) < 0.003;

  if (isOrthogonalRect) {
    const sx = Math.max(0, Math.min(srcW - 2, p0.x));
    const sy = Math.max(0, Math.min(srcH - 2, p0.y));
    const sw = Math.max(2, Math.min(srcW - sx, p1.x - p0.x));
    const sh = Math.max(2, Math.min(srcH - sy, p3.y - p0.y));
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
    return canvas.toDataURL('image/jpeg', 0.93);
  }

  const meshCols = 8;
  const meshRows = 8;

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const srcCtx = srcCanvas.getContext('2d');
  if (!srcCtx) return dataUrl;
  srcCtx.drawImage(img, 0, 0);

  for (let r = 0; r < meshRows; r++) {
    for (let c = 0; c < meshCols; c++) {
      const u0 = c / meshCols;
      const v0 = r / meshRows;
      const u1 = (c + 1) / meshCols;
      const v1 = (r + 1) / meshRows;

      const sp0 = bilinearInterp(p0, p1, p3, p2, u0, v0);
      const sp1 = bilinearInterp(p0, p1, p3, p2, u1, v0);
      const sp2 = bilinearInterp(p0, p1, p3, p2, u0, v1);
      const sp3 = bilinearInterp(p0, p1, p3, p2, u1, v1);

      const dx0 = u0 * targetW;
      const dy0 = v0 * targetH;
      const dw = (u1 - u0) * targetW + 0.5;
      const dh = (v1 - v0) * targetH + 0.5;

      drawTriangle(ctx, srcCanvas, sp0, sp1, sp2, { x: dx0, y: dy0 }, { x: dx0 + dw, y: dy0 }, { x: dx0, y: dy0 + dh });
      drawTriangle(ctx, srcCanvas, sp1, sp3, sp2, { x: dx0 + dw, y: dy0 }, { x: dx0 + dw, y: dy0 + dh }, { x: dx0, y: dy0 + dh });
    }
  }

  return canvas.toDataURL('image/jpeg', 0.93);
}

function bilinearInterp(
  tl: { x: number; y: number },
  tr: { x: number; y: number },
  bl: { x: number; y: number },
  br: { x: number; y: number },
  u: number,
  v: number
) {
  const topX = tl.x + (tr.x - tl.x) * u;
  const topY = tl.y + (tr.y - tl.y) * u;
  const botX = bl.x + (br.x - bl.x) * u;
  const botY = bl.y + (br.y - bl.y) * u;
  return {
    x: topX + (botX - topX) * v,
    y: topY + (botY - topY) * v,
  };
}

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  s0: { x: number; y: number },
  s1: { x: number; y: number },
  s2: { x: number; y: number },
  d0: { x: number; y: number },
  d1: { x: number; y: number },
  d2: { x: number; y: number }
) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y);
  ctx.lineTo(d1.x, d1.y);
  ctx.lineTo(d2.x, d2.y);
  ctx.closePath();
  ctx.clip();

  const denom = s0.x * (s2.y - s1.y) - s1.x * s2.y + s2.x * s1.y + (s1.x - s2.x) * s0.y;
  if (Math.abs(denom) < 0.0001) {
    ctx.restore();
    return;
  }

  const a = -(s0.y * (d2.x - d1.x) - s1.y * d2.x + s2.y * d1.x + (s1.y - s2.y) * d0.x) / denom;
  const b = (s1.y * d2.y + s0.y * (d1.y - d2.y) - s2.y * d1.y + (s2.y - s1.y) * d0.y) / denom;
  const c = (s0.x * (d2.x - d1.x) - s1.x * d2.x + s2.x * d1.x + (s1.x - s2.x) * d0.x) / denom;
  const d = -(s1.x * d2.y + s0.x * (d1.y - d2.y) - s2.x * d1.y + (s2.x - s1.x) * d0.y) / denom;
  const e = (s0.x * (s2.y * d1.x - s1.y * d2.x) + s0.y * (s1.x * d2.x - s2.x * d1.x) + (s1.y * s2.x - s1.x * s2.y) * d0.x) / denom;
  const f = (s0.x * (s2.y * d1.y - s1.y * d2.y) + s0.y * (s1.x * d2.y - s2.x * d1.y) + (s1.y * s2.x - s1.x * s2.y) * d0.y) / denom;

  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(src, 0, 0);
  ctx.restore();
}

/**
 * RECTO-VERSO ID STITCHER:
 * Merges Front and Back scans onto a single clean A4 canvas or dual-card layout.
 */
export async function stitchRectoVerso(
  frontDataUrl: string,
  backDataUrl: string,
  format: 'a4_stacked' | 'side_by_side' = 'a4_stacked'
): Promise<string> {
  const frontImg = await loadImage(frontDataUrl);
  const backImg = await loadImage(backDataUrl);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return frontDataUrl;

  if (format === 'a4_stacked') {
    const a4W = 1240;
    const a4H = 1754;
    canvas.width = a4W;
    canvas.height = a4H;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, a4W, a4H);

    const cardW = Math.round(a4W * 0.72);
    const cardH = Math.round(cardW / 1.586);

    const frontX = (a4W - cardW) / 2;
    const frontY = Math.round(a4H * 0.16);
    const backX = frontX;
    const backY = Math.round(a4H * 0.54);

    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 2;

    ctx.save();
    roundRect(ctx, frontX, frontY, cardW, cardH, 16);
    ctx.clip();
    ctx.drawImage(frontImg, frontX, frontY, cardW, cardH);
    ctx.restore();
    roundRect(ctx, frontX, frontY, cardW, cardH, 16);
    ctx.stroke();

    ctx.fillStyle = '#64748B';
    ctx.font = '600 20px Inter, sans-serif';
    ctx.fillText('FRONT SIDE', frontX, frontY - 12);

    ctx.save();
    roundRect(ctx, backX, backY, cardW, cardH, 16);
    ctx.clip();
    ctx.drawImage(backImg, backX, backY, cardW, cardH);
    ctx.restore();
    roundRect(ctx, backX, backY, cardW, cardH, 16);
    ctx.stroke();

    ctx.fillStyle = '#64748B';
    ctx.fillText('BACK SIDE', backX, backY - 12);

    ctx.fillStyle = '#94A3B8';
    ctx.font = '500 16px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('IDENTIFICATION DOCUMENT SCAN · RECTO-VERSO', a4W / 2, 70);
  } else {
    const cardW = 856;
    const cardH = 540;
    const gap = 48;
    const margin = 48;
    canvas.width = cardW * 2 + gap + margin * 2;
    canvas.height = cardH + margin * 2;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.drawImage(frontImg, margin, margin, cardW, cardH);
    ctx.drawImage(backImg, margin + cardW + gap, margin, cardW, cardH);
  }

  return canvas.toDataURL('image/jpeg', 0.92);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * BOOK DUAL-PAGE SPLITTER:
 * Splits a single open book capture down the center spine into Left and Right pages.
 */
export async function splitBookPages(
  dataUrl: string,
  spineMarginPercent = 0.04
): Promise<{ leftPage: string; rightPage: string }> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  const halfW = Math.floor(w / 2);
  const marginPx = Math.floor(halfW * spineMarginPercent);

  const leftCanvas = document.createElement('canvas');
  leftCanvas.width = halfW - marginPx;
  leftCanvas.height = h;
  const leftCtx = leftCanvas.getContext('2d');
  if (leftCtx) {
    leftCtx.drawImage(img, 0, 0, halfW - marginPx, h, 0, 0, halfW - marginPx, h);
  }

  const rightCanvas = document.createElement('canvas');
  rightCanvas.width = halfW - marginPx;
  rightCanvas.height = h;
  const rightCtx = rightCanvas.getContext('2d');
  if (rightCtx) {
    rightCtx.drawImage(img, halfW + marginPx, 0, halfW - marginPx, h, 0, 0, halfW - marginPx, h);
  }

  return {
    leftPage: leftCanvas.toDataURL('image/jpeg', 0.92),
    rightPage: rightCanvas.toDataURL('image/jpeg', 0.92),
  };
}

export interface DetectedAreaResult {
  corners: QuadCorners;
  documentSurface: { x: number; y: number; width: number; height: number };
  textSurface?: { x: number; y: number; width: number; height: number };
  textBands: { x: number; y: number; width: number; height: number }[];
  confidence: number; // 0 to 1
  skewAngleDeg: number;
  avgLuminance?: number; // 0..255
  sharpnessScore?: number; // 0..1
  paperDetected?: boolean;
}

/**
 * Helper: trimmed median of sorted boundary samples so desk shadows/noise
 * do not pull a paper boundary out of alignment.
 */
function trimmedMedian(values: number[], fallback: number): { value: number; spread: number; valid: boolean } {
  if (values.length < 4) return { value: fallback, spread: 0, valid: false };
  const sorted = [...values].sort((a, b) => a - b);
  const lo = Math.floor(sorted.length * 0.2);
  const hi = Math.max(lo + 1, Math.ceil(sorted.length * 0.8));
  const core = sorted.slice(lo, hi);
  const median = core[Math.floor(core.length / 2)];
  const spread = core[core.length - 1] - core[0];
  return { value: median, spread, valid: true };
}

/**
 * FULL PAPER-SECTION ORTHOGONAL DOCUMENT DETECTOR:
 * 1. Samples outer desk surround vs inner sheet paper envelope (upper-quartile brightness
 *    so dark ink inside the document never pulls paper color down).
 * 2. Scans outer-inward along 24 rays per side to lock strictly onto the OUTER boundary
 *    of the physical paper sheet / card — NEVER collapsing inward around text paragraphs.
 * 3. Returns a crisp 90-degree orthogonal rectangle (`corners` & `documentSurface`) plus
 *    frame lighting & sharpness telemetry for real-world capture guidance.
 */
// Reusable offscreen analysis buffers to keep real-time live edge tracking allocation-free (~5-8ms/frame)
const ANALYSIS_SIZE = 200;
let cachedAnalysisCanvas: HTMLCanvasElement | null = null;
let cachedAnalysisCtx: CanvasRenderingContext2D | null = null;
const cachedGrayBuf = new Float32Array(ANALYSIS_SIZE * ANALYSIS_SIZE);
const cachedEdgeBuf = new Float32Array(ANALYSIS_SIZE * ANALYSIS_SIZE);
const cachedRowEnergyBuf = new Float32Array(ANALYSIS_SIZE);

export async function detectDocumentAndTextCorners(
  source: string | HTMLCanvasElement | HTMLVideoElement
): Promise<DetectedAreaResult> {
  const analysisW = ANALYSIS_SIZE;
  const analysisH = ANALYSIS_SIZE;

  const fallbackResult: DetectedAreaResult = {
    corners: {
      topLeft: { x: 0.08, y: 0.08 },
      topRight: { x: 0.92, y: 0.08 },
      bottomRight: { x: 0.92, y: 0.92 },
      bottomLeft: { x: 0.08, y: 0.92 },
    },
    documentSurface: { x: 0.08, y: 0.08, width: 0.84, height: 0.84 },
    textSurface: { x: 0.08, y: 0.08, width: 0.84, height: 0.84 },
    textBands: [],
    confidence: 0.65,
    skewAngleDeg: 0,
    avgLuminance: 140,
    sharpnessScore: 0.75,
    paperDetected: false,
  };

  if (!cachedAnalysisCanvas) {
    cachedAnalysisCanvas = document.createElement('canvas');
    cachedAnalysisCanvas.width = analysisW;
    cachedAnalysisCanvas.height = analysisH;
    cachedAnalysisCtx = cachedAnalysisCanvas.getContext('2d', { willReadFrequently: true });
  }
  const ctx = cachedAnalysisCtx;
  if (!ctx) return fallbackResult;

  if (typeof source === 'string') {
    const img = await loadImage(source);
    ctx.drawImage(img, 0, 0, analysisW, analysisH);
  } else {
    ctx.drawImage(source, 0, 0, analysisW, analysisH);
  }

  const imgData = ctx.getImageData(0, 0, analysisW, analysisH);
  const data = imgData.data;
  const totalPx = analysisW * analysisH;

  const gray = cachedGrayBuf;
  let lumSum = 0;
  for (let i = 0; i < totalPx; i++) {
    const idx = i * 4;
    const g = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    gray[i] = g;
    lumSum += g;
  }
  const avgLuminance = lumSum / totalPx;

  // 1. Sample outer 8px border (surrounding desk/surface)
  let borderR = 0;
  let borderG = 0;
  let borderB = 0;
  let borderCount = 0;
  for (let y = 0; y < analysisH; y += 3) {
    for (let x = 0; x < analysisW; x += 3) {
      if (x < 9 || x >= analysisW - 9 || y < 9 || y >= analysisH - 9) {
        const idx = (y * analysisW + x) * 4;
        borderR += data[idx];
        borderG += data[idx + 1];
        borderB += data[idx + 2];
        borderCount++;
      }
    }
  }
  const bgR = borderR / Math.max(1, borderCount);
  const bgG = borderG / Math.max(1, borderCount);
  const bgB = borderB / Math.max(1, borderCount);
  const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;

  // 2. Sample inner central box (30%-70%) to estimate actual paper surface RGB & lum (top 40% brightest pixels ignore ink)
  const centerSamples: { lum: number; r: number; g: number; b: number }[] = [];
  for (let y = Math.round(analysisH * 0.3); y <= Math.round(analysisH * 0.7); y += 4) {
    for (let x = Math.round(analysisW * 0.3); x <= Math.round(analysisW * 0.7); x += 4) {
      const idx = y * analysisW + x;
      const pIdx = idx * 4;
      centerSamples.push({ lum: gray[idx], r: data[pIdx], g: data[pIdx + 1], b: data[pIdx + 2] });
    }
  }
  centerSamples.sort((a, b) => b.lum - a.lum);
  const paperSliceEnd = Math.max(4, Math.floor(centerSamples.length * 0.4));
  let paperR = 0;
  let paperG = 0;
  let paperB = 0;
  for (let i = 0; i < paperSliceEnd; i++) {
    paperR += centerSamples[i].r;
    paperG += centerSamples[i].g;
    paperB += centerSamples[i].b;
  }
  paperR /= paperSliceEnd;
  paperG /= paperSliceEnd;
  paperB /= paperSliceEnd;
  const paperLum = 0.299 * paperR + 0.587 * paperG + 0.114 * paperB;

  const deskPaperColorDiff =
    Math.abs(paperR - bgR) + Math.abs(paperG - bgG) + Math.abs(paperB - bgB);
  const deskPaperLumDiff = Math.abs(paperLum - bgLum);
  const hasDistinctDesk = deskPaperLumDiff > 16 || deskPaperColorDiff > 32;

  // 3. Sobel edge score + sharpness Laplacian check + text energy detection
  const edgeScore = cachedEdgeBuf;
  const textEnergyRows = cachedRowEnergyBuf;
  textEnergyRows.fill(0);
  let minTextX = analysisW;
  let maxTextX = 0;
  let edgeEnergyTotal = 0;
  let edgePxCount = 0;

  for (let y = 2; y < analysisH - 2; y++) {
    for (let x = 2; x < analysisW - 2; x++) {
      const idx = y * analysisW + x;
      const gx =
        -gray[idx - analysisW - 1] +
        gray[idx - analysisW + 1] -
        2 * gray[idx - 1] +
        2 * gray[idx + 1] -
        gray[idx + analysisW - 1] +
        gray[idx + analysisW + 1];

      const gy =
        -gray[idx - analysisW - 1] -
        2 * gray[idx - analysisW] -
        gray[idx - analysisW + 1] +
        gray[idx + analysisW - 1] +
        2 * gray[idx + analysisW] +
        gray[idx + analysisW + 1];

      const mag = Math.abs(gx) + Math.abs(gy);
      const pxIdx = idx * 4;
      const colorDist =
        Math.abs(data[pxIdx] - bgR) +
        Math.abs(data[pxIdx + 1] - bgG) +
        Math.abs(data[pxIdx + 2] - bgB);

      edgeScore[idx] = mag * 0.68 + colorDist * 0.35;

      if (x % 2 === 0 && y % 2 === 0) {
        edgeEnergyTotal += mag;
        edgePxCount++;
      }

      const lum = gray[idx];
      if (
        x > 16 &&
        x < analysisW - 16 &&
        y > 16 &&
        y < analysisH - 16 &&
        Math.abs(gx) > 36 &&
        lum < 210
      ) {
        textEnergyRows[y] += Math.abs(gx);
        if (x < minTextX) minTextX = x;
        if (x > maxTextX) maxTextX = x;
      }
    }
  }

  const meanEdge = edgeEnergyTotal / Math.max(1, edgePxCount);
  const sharpnessScore = Math.min(1, Math.max(0.15, meanEdge / 58));

  // Helper: check if pixel resembles detected paper more than outer desk surface
  const isPaperPixel = (x: number, y: number): boolean => {
    const pxIdx = (y * analysisW + x) * 4;
    const drP = Math.abs(data[pxIdx] - paperR);
    const dgP = Math.abs(data[pxIdx + 1] - paperG);
    const dbP = Math.abs(data[pxIdx + 2] - paperB);
    const distPaper = drP + dgP + dbP;

    const drB = Math.abs(data[pxIdx] - bgR);
    const dgB = Math.abs(data[pxIdx + 1] - bgG);
    const dbB = Math.abs(data[pxIdx + 2] - bgB);
    const distDesk = drB + dgB + dbB;

    return distPaper * 1.15 < distDesk && gray[y * analysisW + x] > Math.min(bgLum, paperLum) * 0.72;
  };

  // 4. Outer-inward paper boundary scan along 24 rays per side
  // Locks onto the PHYSICAL PAPER SECTION boundary, never shrinking into inner text lines
  const topSamples: number[] = [];
  const bottomSamples: number[] = [];
  const leftSamples: number[] = [];
  const rightSamples: number[] = [];

  const rayCount = 24;
  const edgeThreshold = hasDistinctDesk ? 46 : 78;

  for (let i = 0; i < rayCount; i++) {
    const frac = 0.18 + (i / (rayCount - 1)) * 0.64;
    const rx = Math.round(frac * analysisW);
    const ry = Math.round(frac * analysisH);

    // Top paper edge (outer -> inward up to 34% depth so inner paragraphs aren't mistaken as paper edge)
    for (let y = 4; y < Math.round(analysisH * 0.34); y++) {
      const s = edgeScore[y * analysisW + rx];
      const lookAhead = Math.min(analysisH - 5, y + 6);
      const paperMatch = hasDistinctDesk
        ? isPaperPixel(rx, y + 3) && isPaperPixel(rx, lookAhead)
        : s > edgeThreshold && gray[lookAhead * analysisW + rx] > bgLum + 14;
      if ((s > edgeThreshold && paperMatch) || (hasDistinctDesk && isPaperPixel(rx, y) && isPaperPixel(rx, lookAhead))) {
        topSamples.push(y / analysisH);
        break;
      }
    }

    // Bottom paper edge
    for (let y = analysisH - 5; y > Math.round(analysisH * 0.66); y--) {
      const s = edgeScore[y * analysisW + rx];
      const lookAhead = Math.max(4, y - 6);
      const paperMatch = hasDistinctDesk
        ? isPaperPixel(rx, y - 3) && isPaperPixel(rx, lookAhead)
        : s > edgeThreshold && gray[lookAhead * analysisW + rx] > bgLum + 14;
      if ((s > edgeThreshold && paperMatch) || (hasDistinctDesk && isPaperPixel(rx, y) && isPaperPixel(rx, lookAhead))) {
        bottomSamples.push(y / analysisH);
        break;
      }
    }

    // Left paper edge
    for (let x = 4; x < Math.round(analysisW * 0.34); x++) {
      const s = edgeScore[ry * analysisW + x];
      const lookAhead = Math.min(analysisW - 5, x + 6);
      const paperMatch = hasDistinctDesk
        ? isPaperPixel(x + 3, ry) && isPaperPixel(lookAhead, ry)
        : s > edgeThreshold && gray[ry * analysisW + lookAhead] > bgLum + 14;
      if ((s > edgeThreshold && paperMatch) || (hasDistinctDesk && isPaperPixel(x, ry) && isPaperPixel(lookAhead, ry))) {
        leftSamples.push(x / analysisW);
        break;
      }
    }

    // Right paper edge
    for (let x = analysisW - 5; x > Math.round(analysisW * 0.66); x--) {
      const s = edgeScore[ry * analysisW + x];
      const lookAhead = Math.max(4, x - 6);
      const paperMatch = hasDistinctDesk
        ? isPaperPixel(x - 3, ry) && isPaperPixel(lookAhead, ry)
        : s > edgeThreshold && gray[ry * analysisW + lookAhead] > bgLum + 14;
      if ((s > edgeThreshold && paperMatch) || (hasDistinctDesk && isPaperPixel(x, ry) && isPaperPixel(lookAhead, ry))) {
        rightSamples.push(x / analysisW);
        break;
      }
    }
  }

  const topEdge = trimmedMedian(topSamples, 0.08);
  const bottomEdge = trimmedMedian(bottomSamples, 0.92);
  const leftEdge = trimmedMedian(leftSamples, 0.08);
  const rightEdge = trimmedMedian(rightSamples, 0.92);

  let left = Math.max(0.04, Math.min(0.28, leftEdge.value));
  let right = Math.min(0.96, Math.max(0.72, rightEdge.value));
  let top = Math.max(0.04, Math.min(0.28, topEdge.value));
  let bottom = Math.min(0.96, Math.max(0.72, bottomEdge.value));

  const rectW = right - left;
  const rectH = bottom - top;
  const isRectValid = rectW > 0.42 && rectH > 0.42;

  if (!isRectValid) {
    left = 0.08;
    top = 0.08;
    right = 0.92;
    bottom = 0.92;
  }

  // Strictly orthogonal 90-degree corners enclosing the full paper document surface
  const corners: QuadCorners = {
    topLeft: { x: left, y: top },
    topRight: { x: right, y: top },
    bottomRight: { x: right, y: bottom },
    bottomLeft: { x: left, y: bottom },
  };

  const documentSurface = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };

  // Optional internal text-line coordinates (used only if user toggles text inspection)
  const textBands: { x: number; y: number; width: number; height: number }[] = [];
  let inBand = false;
  let bandStartY = 0;

  const boxW = Math.max(0.35, right - left);
  const boxH = Math.max(0.35, bottom - top);

  const bandMinX = minTextX < analysisW ? Math.max(left + 0.03, minTextX / analysisW) : left + boxW * 0.08;
  const bandMaxX = maxTextX > 0 ? Math.min(right - 0.03, maxTextX / analysisW) : right - boxW * 0.08;

  for (let y = 12; y < analysisH - 12; y++) {
    const energy = textEnergyRows[y];
    if (energy > 240) {
      if (!inBand) {
        inBand = true;
        bandStartY = y;
      }
    } else if (inBand) {
      inBand = false;
      const bandH = y - bandStartY;
      if (bandH >= 3 && bandH <= 32) {
        const relX = Math.max(0.06, Math.min(0.22, (bandMinX - left) / boxW));
        const relY = Math.max(0.05, Math.min(0.9, (bandStartY / analysisH - top) / boxH));
        const relW = Math.max(0.35, Math.min(0.88 - relX, (bandMaxX - bandMinX) / boxW));
        const relH = Math.max(0.02, Math.min(0.08, bandH / analysisH / boxH));
        textBands.push({ x: relX, y: relY, width: relW, height: relH });
      }
    }
  }

  const lockedSides = [topEdge.valid, bottomEdge.valid, leftEdge.valid, rightEdge.valid].filter(Boolean).length;
  const avgSpread =
    (topEdge.spread + bottomEdge.spread + leftEdge.spread + rightEdge.spread) / 4;
  const skewAngleDeg = Math.min(12, avgSpread * 45);
  const confidence = Math.min(
    0.98,
    (isRectValid ? 0.56 + lockedSides * 0.09 : 0.5) + (hasDistinctDesk ? 0.08 : 0)
  );

  return {
    corners,
    documentSurface,
    textSurface: { x: 0, y: 0, width: 1, height: 1 },
    textBands: textBands.slice(0, 10),
    confidence,
    skewAngleDeg,
    avgLuminance,
    sharpnessScore,
    paperDetected: hasDistinctDesk && lockedSides >= 2,
  };
}
