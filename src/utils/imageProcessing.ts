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

export interface ViewportCropBox {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Computes the exact visible sub-rectangle of an HTMLVideoElement rendered with CSS `object-cover`
 * inside a container of dimensions `viewW x viewH`, keeping live overlay & captured photo 1:1 aligned.
 */
export function computeVideoVisibleCrop(
  vidW: number,
  vidH: number,
  viewW: number,
  viewH: number
): ViewportCropBox {
  if (!vidW || !vidH || !viewW || !viewH) {
    return { sx: 0, sy: 0, sw: vidW || 1280, sh: vidH || 720 };
  }
  const vidAspect = vidW / vidH;
  const viewAspect = viewW / viewH;

  if (vidAspect > viewAspect) {
    const sw = vidH * viewAspect;
    return {
      sx: (vidW - sw) * 0.5,
      sy: 0,
      sw,
      sh: vidH,
    };
  }
  const sh = vidW / viewAspect;
  return {
    sx: 0,
    sy: (vidH - sh) * 0.5,
    sw: vidW,
    sh,
  };
}

interface Pt {
  x: number;
  y: number;
}

function triangleArea2(a: Pt, b: Pt, c: Pt): number {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Andrew's Monotone Chain 2D Convex Hull -> returns counter-clockwise convex polygon.
 */
function convexHull(points: Pt[]): Pt[] {
  if (points.length <= 3) return points;
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const lower: Pt[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Area-preserving decimation of a convex hull down to the exact 4 document corners.
 */
function decimateHullToQuad(hull: Pt[]): Pt[] | null {
  if (hull.length < 4) return null;
  const pts = [...hull];
  while (pts.length > 4) {
    let minArea = Infinity;
    let removeIdx = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const curr = pts[i];
      const next = pts[(i + 1) % n];
      const area = triangleArea2(prev, curr, next);
      if (area < minArea) {
        minArea = area;
        removeIdx = i;
      }
    }
    pts.splice(removeIdx, 1);
  }
  return pts;
}

/**
 * Sorts 4 quad points consistently into TopLeft, TopRight, BottomRight, BottomLeft.
 */
function orderQuadCorners(pts: Pt[]): QuadCorners {
  const sumSorted = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y));
  const diffSorted = [...pts].sort((a, b) => a.x - a.y - (b.x - b.y));

  // Wait: x - y is smallest (most negative) at bottomLeft, largest at topRight
  const topLeft = sumSorted[0];
  const bottomRight = sumSorted[3];
  const bottomLeft = diffSorted[0];
  const topRight = diffSorted[3];

  const unique = new Set([topLeft, topRight, bottomRight, bottomLeft]);
  if (unique.size === 4) {
    return { topLeft, topRight, bottomRight, bottomLeft };
  }

  // Fallback angular sort around centroid
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const byAngle = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  // Shift so top-left (smallest x+y) comes first
  let bestIdx = 0;
  let bestSum = Infinity;
  byAngle.forEach((p, i) => {
    if (p.x + p.y < bestSum) {
      bestSum = p.x + p.y;
      bestIdx = i;
    }
  });
  return {
    topLeft: byAngle[bestIdx],
    topRight: byAngle[(bestIdx + 1) % 4],
    bottomRight: byAngle[(bestIdx + 2) % 4],
    bottomLeft: byAngle[(bestIdx + 3) % 4],
  };
}

/**
 * Validates that quad is non-degenerate, convex, and has realistic document proportions & angles.
 */
function validateDocumentQuad(q: QuadCorners): boolean {
  const pts = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft];
  // Check polygon area (Shoelace) >= 4.5% and <= 94% of viewport
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  area = Math.abs(area) * 0.5;
  if (area < 0.045 || area > 0.94) return false;

  // Check convexity & interior corner angles between 38° and 142°
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const prev = pts[(i + 3) % 4];
    const curr = pts[i];
    const next = pts[(i + 1) % 4];
    const v1x = prev.x - curr.x;
    const v1y = prev.y - curr.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const crossVal = v1x * v2y - v1y * v2x;
    if (Math.abs(crossVal) < 1e-5) return false;
    const s = Math.sign(crossVal);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;

    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 < 0.12 || len2 < 0.12) return false;
    const cosAngle = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (len1 * len2)));
    const deg = (Math.acos(cosAngle) * 180) / Math.PI;
    if (deg < 42 || deg > 138) return false;
  }

  return true;
}

/**
 * Helper: Theil-Sen median-slope line fit on boundary ray points.
 */
function fitTheilSenEdge(
  pts: Pt[],
  mode: 'y_of_x' | 'x_of_y'
): { slope: number; intercept: number; valid: boolean } {
  if (pts.length < 5) return { slope: 0, intercept: 0, valid: false };
  const slopes: number[] = [];
  const uVals = pts.map((p) => (mode === 'y_of_x' ? p.x : p.y));
  const vVals = pts.map((p) => (mode === 'y_of_x' ? p.y : p.x));

  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const du = uVals[j] - uVals[i];
      if (Math.abs(du) < 0.08) continue;
      const m = (vVals[j] - vVals[i]) / du;
      if (Math.abs(m) <= 0.58) slopes.push(m);
    }
  }
  if (slopes.length === 0) return { slope: 0, intercept: 0, valid: false };
  slopes.sort((a, b) => a - b);
  const medianSlope = slopes[Math.floor(slopes.length / 2)];

  const intercepts = pts.map((_, i) => vVals[i] - medianSlope * uVals[i]);
  intercepts.sort((a, b) => a - b);
  const medianIntercept = intercepts[Math.floor(intercepts.length / 2)];

  let inliers = 0;
  for (let i = 0; i < pts.length; i++) {
    const err = Math.abs(vVals[i] - (medianSlope * uVals[i] + medianIntercept));
    if (err < 0.032) inliers++;
  }
  return {
    slope: medianSlope,
    intercept: medianIntercept,
    valid: inliers / pts.length >= 0.45,
  };
}

// Reusable offscreen analysis buffers to keep real-time live edge tracking allocation-free (~6-10ms/frame)
const ANALYSIS_SIZE = 220;
let cachedAnalysisCanvas: HTMLCanvasElement | null = null;
let cachedAnalysisCtx: CanvasRenderingContext2D | null = null;
const cachedGrayBuf = new Float32Array(ANALYSIS_SIZE * ANALYSIS_SIZE);
const cachedSmoothBuf = new Float32Array(ANALYSIS_SIZE * ANALYSIS_SIZE);
const cachedEdgeBuf = new Float32Array(ANALYSIS_SIZE * ANALYSIS_SIZE);
const cachedMaskBuf = new Uint8Array(ANALYSIS_SIZE * ANALYSIS_SIZE);
const cachedRowEnergyBuf = new Float32Array(ANALYSIS_SIZE);
const cachedBfsQueue = new Int32Array(ANALYSIS_SIZE * ANALYSIS_SIZE);

/**
 * CAMSCANNER / TAPSCANNER-INSPIRED PAPER FORM QUAD DETECTOR:
 * 1. Matches CSS `object-cover` visible viewport crop when reading live HTMLVideoElement.
 * 2. Smooths micro text noise (3x3 Gaussian), separates surrounding desk from paper sheet,
 *    and flood-fills outer desk region inward (`outsideMask`) so internal ink/images stay sealed inside the sheet.
 * 3. Extracts the 2D Convex Hull + area-preserving quad decimation so the overlay
 *    faithfully marries tilted, trapezoidal, narrow receipt, ID card, or straight paper shapes.
 * 4. Falls back to directional Sobel ridge rays + Theil-Sen median-slope intersection when desk ~ paper brightness.
 */
export async function detectDocumentAndTextCorners(
  source: string | HTMLCanvasElement | HTMLVideoElement,
  options?: { viewWidth?: number; viewHeight?: number }
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
  } else if (
    'videoWidth' in source &&
    source.videoWidth > 0 &&
    options?.viewWidth &&
    options?.viewHeight
  ) {
    const crop = computeVideoVisibleCrop(
      source.videoWidth,
      source.videoHeight,
      options.viewWidth,
      options.viewHeight
    );
    ctx.drawImage(
      source,
      crop.sx,
      crop.sy,
      crop.sw,
      crop.sh,
      0,
      0,
      analysisW,
      analysisH
    );
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

  // Gentle 3x3 Gaussian blur to suppress wood-grain & fine print texture while preserving macro paper edges
  const smooth = cachedSmoothBuf;
  for (let y = 0; y < analysisH; y++) {
    const ym = Math.max(0, y - 1) * analysisW;
    const y0 = y * analysisW;
    const yp = Math.min(analysisH - 1, y + 1) * analysisW;
    for (let x = 0; x < analysisW; x++) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(analysisW - 1, x + 1);
      smooth[y0 + x] =
        (gray[ym + xm] + 2 * gray[ym + x] + gray[ym + xp] +
          2 * gray[y0 + xm] + 4 * gray[y0 + x] + 2 * gray[y0 + xp] +
          gray[yp + xm] + 2 * gray[yp + x] + gray[yp + xp]) /
        16;
    }
  }

  // 1. Sample outer 6px perimeter ring (surrounding desk)
  let borderR = 0;
  let borderG = 0;
  let borderB = 0;
  let borderCount = 0;
  for (let y = 0; y < analysisH; y += 3) {
    for (let x = 0; x < analysisW; x += 3) {
      if (x < 7 || x >= analysisW - 7 || y < 7 || y >= analysisH - 7) {
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

  // 2. Estimate center paper envelope from upper-bright samples in middle 50% (unaffected by dark printed ink)
  const centerSamples: { lum: number; r: number; g: number; b: number }[] = [];
  for (let y = Math.round(analysisH * 0.25); y <= Math.round(analysisH * 0.75); y += 4) {
    for (let x = Math.round(analysisW * 0.25); x <= Math.round(analysisW * 0.75); x += 4) {
      const idx = y * analysisW + x;
      const pIdx = idx * 4;
      centerSamples.push({ lum: smooth[idx], r: data[pIdx], g: data[pIdx + 1], b: data[pIdx + 2] });
    }
  }
  centerSamples.sort((a, b) => b.lum - a.lum);
  const paperSliceEnd = Math.max(4, Math.floor(centerSamples.length * 0.35));
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
  const hasDistinctDesk = deskPaperLumDiff > 14 || deskPaperColorDiff > 28;

  // 3. Macro Sobel gradient map (on smoothed luminance) + high-freq sharpness check
  const edgeScore = cachedEdgeBuf;
  const textEnergyRows = cachedRowEnergyBuf;
  textEnergyRows.fill(0);
  let edgeEnergyTotal = 0;
  let edgePxCount = 0;

  for (let y = 1; y < analysisH - 1; y++) {
    for (let x = 1; x < analysisW - 1; x++) {
      const idx = y * analysisW + x;
      const gx =
        -smooth[idx - analysisW - 1] +
        smooth[idx - analysisW + 1] -
        2 * smooth[idx - 1] +
        2 * smooth[idx + 1] -
        smooth[idx + analysisW - 1] +
        smooth[idx + analysisW + 1];

      const gy =
        -smooth[idx - analysisW - 1] -
        2 * smooth[idx - analysisW] -
        smooth[idx - analysisW + 1] +
        smooth[idx + analysisW - 1] +
        2 * smooth[idx + analysisW] +
        smooth[idx + analysisW + 1];

      edgeScore[idx] = Math.abs(gx) + Math.abs(gy);

      if (x % 2 === 0 && y % 2 === 0) {
        const rawGx = Math.abs(gray[idx + 1] - gray[idx - 1]);
        const rawGy = Math.abs(gray[idx + analysisW] - gray[idx - analysisW]);
        edgeEnergyTotal += rawGx + rawGy;
        edgePxCount++;
        if (x > 16 && x < analysisW - 16 && rawGx > 24 && gray[idx] < 210) {
          textEnergyRows[y] += rawGx;
        }
      }
    }
  }

  const meanEdge = edgeEnergyTotal / Math.max(1, edgePxCount);
  const sharpnessScore = Math.min(1, Math.max(0.15, meanEdge / 34));

  // 4. Primary Strategy (CamScanner-style Outer Desk BFS + Convex Hull -> 4 Corners)
  let detectedQuad: QuadCorners | null = null;
  let paperLocked = false;

  if (hasDistinctDesk) {
    // outsideMask: 1 = outside desk reached from border, 0 = enclosed solid paper sheet
    const outside = cachedMaskBuf;
    outside.fill(0);
    const queue = cachedBfsQueue;
    let head = 0;
    let tail = 0;

    const lumMid = (bgLum + paperLum) * 0.48;
    const isBrighterPaper = paperLum >= bgLum;

    const isDeskCandidate = (idx: number): boolean => {
      const pIdx = idx * 4;
      const distBg =
        Math.abs(data[pIdx] - bgR) +
        Math.abs(data[pIdx + 1] - bgG) +
        Math.abs(data[pIdx + 2] - bgB);
      const distPaper =
        Math.abs(data[pIdx] - paperR) +
        Math.abs(data[pIdx + 1] - paperG) +
        Math.abs(data[pIdx + 2] - paperB);

      if (isBrighterPaper) {
        // Desk is darker or clearly closer in chroma to outer border than bright sheet
        return (smooth[idx] < lumMid || distBg * 1.08 < distPaper) && edgeScore[idx] < 135;
      }
      return distBg * 1.1 < distPaper && edgeScore[idx] < 135;
    };

    // Seed BFS along all 4 outer borders
    for (let x = 0; x < analysisW; x++) {
      const topIdx = x;
      const botIdx = (analysisH - 1) * analysisW + x;
      if (isDeskCandidate(topIdx) && outside[topIdx] === 0) {
        outside[topIdx] = 1;
        queue[tail++] = topIdx;
      }
      if (isDeskCandidate(botIdx) && outside[botIdx] === 0) {
        outside[botIdx] = 1;
        queue[tail++] = botIdx;
      }
    }
    for (let y = 1; y < analysisH - 1; y++) {
      const leftIdx = y * analysisW;
      const rightIdx = y * analysisW + (analysisW - 1);
      if (isDeskCandidate(leftIdx) && outside[leftIdx] === 0) {
        outside[leftIdx] = 1;
        queue[tail++] = leftIdx;
      }
      if (isDeskCandidate(rightIdx) && outside[rightIdx] === 0) {
        outside[rightIdx] = 1;
        queue[tail++] = rightIdx;
      }
    }

    while (head < tail) {
      const curr = queue[head++];
      const cx = curr % analysisW;
      const cy = (curr / analysisW) | 0;

      if (cx > 1) {
        const n = curr - 1;
        if (outside[n] === 0 && isDeskCandidate(n)) {
          outside[n] = 1;
          queue[tail++] = n;
        }
      }
      if (cx < analysisW - 2) {
        const n = curr + 1;
        if (outside[n] === 0 && isDeskCandidate(n)) {
          outside[n] = 1;
          queue[tail++] = n;
        }
      }
      if (cy > 1) {
        const n = curr - analysisW;
        if (outside[n] === 0 && isDeskCandidate(n)) {
          outside[n] = 1;
          queue[tail++] = n;
        }
      }
      if (cy < analysisH - 2) {
        const n = curr + analysisW;
        if (outside[n] === 0 && isDeskCandidate(n)) {
          outside[n] = 1;
          queue[tail++] = n;
        }
      }
    }

    // Collect outer boundary pixels of enclosed document (outside[idx] === 0 bordering outside[n] === 1)
    const boundaryPts: Pt[] = [];
    for (let y = 2; y < analysisH - 2; y++) {
      const rowOff = y * analysisW;
      for (let x = 2; x < analysisW - 2; x++) {
        const idx = rowOff + x;
        if (
          outside[idx] === 0 &&
          (outside[idx - 1] === 1 ||
            outside[idx + 1] === 1 ||
            outside[idx - analysisW] === 1 ||
            outside[idx + analysisW] === 1)
        ) {
          boundaryPts.push({ x: x / analysisW, y: y / analysisH });
        }
      }
    }

    if (boundaryPts.length >= 24) {
      const hull = convexHull(boundaryPts);
      const quadPts = decimateHullToQuad(hull);
      if (quadPts) {
        const ordered = orderQuadCorners(quadPts);
        if (validateDocumentQuad(ordered)) {
          detectedQuad = ordered;
          paperLocked = true;
        }
      }
    }
  }

  // 5. Fallback Strategy (Oriented 28-Ray Sobel Ridge + Theil-Sen 4-Line Intersection)
  if (!detectedQuad) {
    const topPts: Pt[] = [];
    const bottomPts: Pt[] = [];
    const leftPts: Pt[] = [];
    const rightPts: Pt[] = [];
    const rayCount = 28;
    const ridgeThreshold = hasDistinctDesk ? 42 : 68;

    for (let i = 0; i < rayCount; i++) {
      const frac = 0.14 + (i / (rayCount - 1)) * 0.72;
      const rx = Math.round(frac * analysisW);
      const ry = Math.round(frac * analysisH);

      for (let y = 4; y < Math.round(analysisH * 0.46); y++) {
        const s = edgeScore[y * analysisW + rx];
        if (s > ridgeThreshold) {
          topPts.push({ x: rx / analysisW, y: y / analysisH });
          break;
        }
      }
      for (let y = analysisH - 5; y > Math.round(analysisH * 0.54); y--) {
        const s = edgeScore[y * analysisW + rx];
        if (s > ridgeThreshold) {
          bottomPts.push({ x: rx / analysisW, y: y / analysisH });
          break;
        }
      }
      for (let x = 4; x < Math.round(analysisW * 0.46); x++) {
        const s = edgeScore[ry * analysisW + x];
        if (s > ridgeThreshold) {
          leftPts.push({ x: x / analysisW, y: ry / analysisH });
          break;
        }
      }
      for (let x = analysisW - 5; x > Math.round(analysisW * 0.54); x--) {
        const s = edgeScore[ry * analysisW + x];
        if (s > ridgeThreshold) {
          rightPts.push({ x: x / analysisW, y: ry / analysisH });
          break;
        }
      }
    }

    const lTop = fitTheilSenEdge(topPts, 'y_of_x');
    const lBot = fitTheilSenEdge(bottomPts, 'y_of_x');
    const lLeft = fitTheilSenEdge(leftPts, 'x_of_y');
    const lRight = fitTheilSenEdge(rightPts, 'x_of_y');

    if (lTop.valid && lBot.valid && lLeft.valid && lRight.valid) {
      const intersect = (
        hLine: { slope: number; intercept: number },
        vLine: { slope: number; intercept: number }
      ): Pt => {
        const denom = 1 - hLine.slope * vLine.slope;
        if (Math.abs(denom) < 0.05) {
          return { x: vLine.intercept, y: hLine.intercept };
        }
        const x = (vLine.slope * hLine.intercept + vLine.intercept) / denom;
        const y = hLine.slope * x + hLine.intercept;
        return {
          x: Math.max(0.02, Math.min(0.98, x)),
          y: Math.max(0.02, Math.min(0.98, y)),
        };
      };

      const candidate: QuadCorners = {
        topLeft: intersect(lTop, lLeft),
        topRight: intersect(lTop, lRight),
        bottomRight: intersect(lBot, lRight),
        bottomLeft: intersect(lBot, lLeft),
      };
      if (validateDocumentQuad(candidate)) {
        detectedQuad = candidate;
        paperLocked = true;
      }
    }
  }

  // Fallback centered clean frame if paper completely fills screen with zero desk border
  let corners: QuadCorners = detectedQuad || fallbackResult.corners;

  // 6. Subtle rectilinear snap ONLY when true slant is tiny (< 1.5°), preserving exact tilted/trapezoid fit otherwise
  const topSlope = Math.abs(corners.topRight.y - corners.topLeft.y);
  const botSlope = Math.abs(corners.bottomRight.y - corners.bottomLeft.y);
  const leftSlope = Math.abs(corners.bottomLeft.x - corners.topLeft.x);
  const rightSlope = Math.abs(corners.bottomRight.x - corners.topRight.x);
  const maxSkew = Math.max(topSlope, botSlope, leftSlope, rightSlope);

  if (maxSkew < 0.024) {
    const l = (corners.topLeft.x + corners.bottomLeft.x) * 0.5;
    const r = (corners.topRight.x + corners.bottomRight.x) * 0.5;
    const t = (corners.topLeft.y + corners.topRight.y) * 0.5;
    const b = (corners.bottomLeft.y + corners.bottomRight.y) * 0.5;
    corners = {
      topLeft: { x: l, y: t },
      topRight: { x: r, y: t },
      bottomRight: { x: r, y: b },
      bottomLeft: { x: l, y: b },
    };
  }

  const minX = Math.min(corners.topLeft.x, corners.bottomLeft.x);
  const maxX = Math.max(corners.topRight.x, corners.bottomRight.x);
  const minY = Math.min(corners.topLeft.y, corners.topRight.y);
  const maxY = Math.max(corners.bottomLeft.y, corners.bottomRight.y);

  const documentSurface = {
    x: minX,
    y: minY,
    width: Math.max(0.18, maxX - minX),
    height: Math.max(0.18, maxY - minY),
  };

  // Optional internal text-line coordinates for manual crop inspector
  const textBands: { x: number; y: number; width: number; height: number }[] = [];
  let inBand = false;
  let bandStartY = 0;
  const boxW = Math.max(0.2, documentSurface.width);
  const boxH = Math.max(0.2, documentSurface.height);

  for (let y = 12; y < analysisH - 12; y++) {
    const energy = textEnergyRows[y];
    if (energy > 120) {
      if (!inBand) {
        inBand = true;
        bandStartY = y;
      }
    } else if (inBand) {
      inBand = false;
      const bandH = y - bandStartY;
      if (bandH >= 3 && bandH <= 32) {
        textBands.push({
          x: Math.max(0.08, Math.min(0.22, documentSurface.x + boxW * 0.08)),
          y: Math.max(0.05, Math.min(0.9, (bandStartY / analysisH - minY) / boxH)),
          width: Math.max(0.35, Math.min(0.84, boxW * 0.8)),
          height: Math.max(0.02, Math.min(0.08, bandH / analysisH / boxH)),
        });
      }
    }
  }

  const skewAngleDeg = Number((Math.atan2(maxSkew, 0.7) * (180 / Math.PI)).toFixed(1));
  const confidence = paperLocked ? 0.94 : 0.62;

  return {
    corners,
    documentSurface,
    textSurface: { x: 0, y: 0, width: 1, height: 1 },
    textBands: textBands.slice(0, 10),
    confidence,
    skewAngleDeg,
    avgLuminance,
    sharpnessScore,
    paperDetected: paperLocked,
  };
}
