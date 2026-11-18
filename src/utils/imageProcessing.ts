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
 * SHADOW REMOVAL (Local Illumination Normalization):
 * Estimates the uneven paper illumination map by computing a heavily smoothed
 * local-maximum envelope on a downscaled copy, then divides out the shadow field
 * so shadowed corners brighten cleanly to match well-lit regions without blowing out dark ink.
 */
function applyShadowRemovalInPlace(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  strength = 0.85
) {
  const mapW = Math.max(16, Math.min(72, Math.round(width / 16)));
  const mapH = Math.max(16, Math.min(72, Math.round((height * mapW) / width)));

  // 1. Build coarse local-max illumination map (captures paper brightness while ignoring thin dark text)
  const bgMapR = new Float32Array(mapW * mapH);
  const bgMapG = new Float32Array(mapW * mapH);
  const bgMapB = new Float32Array(mapW * mapH);

  const cellW = width / mapW;
  const cellH = height / mapH;

  for (let my = 0; my < mapH; my++) {
    const yStart = Math.floor(my * cellH);
    const yEnd = Math.min(height, Math.ceil((my + 1) * cellH));
    for (let mx = 0; mx < mapW; mx++) {
      const xStart = Math.floor(mx * cellW);
      const xEnd = Math.min(width, Math.ceil((mx + 1) * cellW));

      // Take top-85th percentile / local bright paper sample inside cell
      let maxLum = -1;
      let bestR = 235;
      let bestG = 235;
      let bestB = 235;
      const stepY = Math.max(1, Math.floor((yEnd - yStart) / 4));
      const stepX = Math.max(1, Math.floor((xEnd - xStart) / 4));

      for (let y = yStart; y < yEnd; y += stepY) {
        for (let x = xStart; x < xEnd; x += stepX) {
          const idx = (y * width + x) * 4;
          const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          if (lum > maxLum) {
            maxLum = lum;
            bestR = data[idx];
            bestG = data[idx + 1];
            bestB = data[idx + 2];
          }
        }
      }

      const mIdx = my * mapW + mx;
      bgMapR[mIdx] = Math.max(70, bestR);
      bgMapG[mIdx] = Math.max(70, bestG);
      bgMapB[mIdx] = Math.max(70, bestB);
    }
  }

  // 2. Smooth the background map with 2 passes of 3x3 box blur
  const smoothChannel = (src: Float32Array) => {
    let cur = new Float32Array(src);
    let next = new Float32Array(src.length);
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

  // 3. Bilinearly sample smooth background map and divide out uneven shadows
  const targetPaper = 248;
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

      const idx = (y * width + x) * 4;
      const normR = Math.min(255, (data[idx] / bgR) * targetPaper);
      const normG = Math.min(255, (data[idx + 1] / bgG) * targetPaper);
      const normB = Math.min(255, (data[idx + 2] / bgB) * targetPaper);

      data[idx] = data[idx] * (1 - strength) + normR * strength;
      data[idx + 1] = data[idx + 1] * (1 - strength) + normG * strength;
      data[idx + 2] = data[idx + 2] * (1 - strength) + normB * strength;
    }
  }
}

/**
 * Integral-image local adaptive threshold for pure crisp B&W document scans
 * (resilient against dark desk shadows).
 */
function applyAdaptiveThresholdInPlace(
  data: Uint8ClampedArray,
  width: number,
  height: number
) {
  const lum = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    lum[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }

  // Build summed area table (integral image)
  const sat = new Float64Array((width + 1) * (height + 1));
  const stride = width + 1;
  for (let y = 1; y <= height; y++) {
    let rowSum = 0;
    for (let x = 1; x <= width; x++) {
      rowSum += lum[(y - 1) * width + (x - 1)];
      sat[y * stride + x] = sat[(y - 1) * stride + x] + rowSum;
    }
  }

  const radius = Math.max(8, Math.round(Math.min(width, height) / 28));
  const tFactor = 0.9; // pixel is black if < 90% of local neighborhood mean

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
      const localMean = sum / count;

      const pxLum = lum[y * width + x];
      const val = pxLum < localMean * tFactor && pxLum < 210 ? 0 : 255;

      const idx = (y * width + x) * 4;
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
    }
  }
}

/**
 * Core image processing pipeline:
 * Applies rotation, shadow removal (local illumination normalization),
 * filter presets (Magic Color, B&W adaptive, Grayscale, Eco),
 * and manual adjustment sliders (brightness, contrast, sharpness, warmth, saturation).
 */
export async function processImage(
  dataUrl: string,
  filter: FilterPreset,
  adjustments: AdjustmentParams,
  rotation = 0,
  targetMaxDimension?: number
): Promise<string> {
  const img = await loadImage(dataUrl);

  let origWidth = img.naturalWidth || img.width;
  let origHeight = img.naturalHeight || img.height;

  // Scale if requested (e.g. for real-time slider preview)
  if (targetMaxDimension && (origWidth > targetMaxDimension || origHeight > targetMaxDimension)) {
    if (origWidth > origHeight) {
      origHeight = Math.round((origHeight * targetMaxDimension) / origWidth);
      origWidth = targetMaxDimension;
    } else {
      origWidth = Math.round((origWidth * targetMaxDimension) / origHeight);
      origHeight = targetMaxDimension;
    }
  }

  // Handle rotation dimensions
  const isRotated90or270 = rotation % 180 !== 0;
  const canvasWidth = isRotated90or270 ? origHeight : origWidth;
  const canvasHeight = isRotated90or270 ? origWidth : origHeight;

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return dataUrl;

  // Draw with rotation
  ctx.save();
  ctx.translate(canvasWidth / 2, canvasHeight / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, -origWidth / 2, -origHeight / 2, origWidth, origHeight);
  ctx.restore();

  const shadowRemovalEnabled =
    adjustments.shadowRemoval !== undefined
      ? adjustments.shadowRemoval
      : filter !== 'original';

  // If original filter, zero adjustments, and no shadow removal requested, return early
  const isZeroAdjustments =
    adjustments.brightness === 0 &&
    adjustments.contrast === 0 &&
    adjustments.sharpness === 0 &&
    adjustments.warmth === 0 &&
    adjustments.saturation === 0;

  if (filter === 'original' && isZeroAdjustments && !shadowRemovalEnabled) {
    return canvas.toDataURL('image/jpeg', 0.92);
  }

  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const data = imageData.data;
  const len = data.length;

  // 0. LOCAL SHADOW REMOVAL (before thresholding/enhancement)
  if (shadowRemovalEnabled) {
    const strength = filter === 'original' ? 0.65 : filter === 'bw' ? 0.9 : 0.82;
    applyShadowRemovalInPlace(data, canvasWidth, canvasHeight, strength);
  }

  // Pre-calculate adjustment factors
  const brightnessOffset = (adjustments.brightness / 100) * 128;
  const contrastFactor =
    adjustments.contrast >= 0
      ? 1 + (adjustments.contrast / 100) * 2
      : 1 + adjustments.contrast / 100;
  const redShift = (adjustments.warmth / 50) * 25;
  const blueShift = -(adjustments.warmth / 50) * 25;
  const satFactor = 1 + adjustments.saturation / 100;

  // Adaptive B&W path uses integral image
  if (filter === 'bw') {
    // Apply brightness/contrast before adaptive binarization if tweaked
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
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum > 145) {
          const boost = Math.pow((lum - 145) / 110, 1.15) * 85;
          r = Math.min(255, r + boost);
          g = Math.min(255, g + boost);
          b = Math.min(255, b + boost);
        } else {
          const pull = (145 - lum) / 145;
          r = Math.max(0, r * (1 - pull * 0.38));
          g = Math.max(0, g * (1 - pull * 0.38));
          b = Math.max(0, b * (1 - pull * 0.38));
        }
        const avg = (r + g + b) / 3;
        r = Math.min(255, Math.max(0, avg + (r - avg) * 1.18));
        g = Math.min(255, Math.max(0, avg + (g - avg) * 1.18));
        b = Math.min(255, Math.max(0, avg + (b - avg) * 1.18));
      } else if (filter === 'grayscale') {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const adjustedLum = Math.min(255, Math.max(0, (lum - 128) * 1.15 + 138));
        r = adjustedLum;
        g = adjustedLum;
        b = adjustedLum;
      } else if (filter === 'eco') {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum > 135) {
          r = 255;
          g = 255;
          b = 255;
        } else {
          const ink = Math.min(255, lum * 0.78);
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

  // Sharpness convolution (Unsharp Masking)
  if (adjustments.sharpness > 0 || filter === 'magic') {
    const sharpnessAmount =
      (adjustments.sharpness / 100) * 0.8 + (filter === 'magic' ? 0.22 : 0);
    applySharpness(imageData, canvasWidth, canvasHeight, sharpnessAmount);
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.92);
}

/**
 * 3x3 convolution kernel for unsharp mask edge enhancement
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

  const targetW = Math.max(64, Math.round(outputWidth || Math.max(topDist, bottomDist)));
  const targetH = Math.max(64, Math.round(outputHeight || Math.max(leftDist, rightDist)));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;

  const meshCols = 16;
  const meshRows = 16;

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

  return canvas.toDataURL('image/jpeg', 0.92);
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
  textBands: { x: number; y: number; width: number; height: number }[];
  confidence: number; // 0 to 1
  skewAngleDeg: number;
}

/**
 * Fits a robust line (y = m*x + b or x = m*y + b) using trimmed least squares
 * so outlier desk textures do not skew the detected quadrilateral edges.
 */
function fitLineRobust(
  pts: Array<{ u: number; v: number }>,
  defaultU: number
): { m: number; b: number; valid: boolean } {
  if (pts.length < 4) return { m: 0, b: defaultU, valid: false };

  // Compute median u to reject wild outliers first
  const sortedU = [...pts].map((p) => p.u).sort((a, b) => a - b);
  const medU = sortedU[Math.floor(sortedU.length / 2)];
  const inliers = pts.filter((p) => Math.abs(p.u - medU) < 0.16);
  const used = inliers.length >= 4 ? inliers : pts;

  let sumV = 0;
  let sumU = 0;
  let sumVV = 0;
  let sumVU = 0;
  for (const p of used) {
    sumV += p.v;
    sumU += p.u;
    sumVV += p.v * p.v;
    sumVU += p.v * p.u;
  }
  const n = used.length;
  const denom = n * sumVV - sumV * sumV;
  if (Math.abs(denom) < 1e-6) {
    return { m: 0, b: sumU / n, valid: true };
  }
  const m = (n * sumVU - sumV * sumU) / denom;
  const b = (sumU - m * sumV) / n;
  // Clamp unreasonable slant angles
  const clampedM = Math.max(-0.45, Math.min(0.45, m));
  const adjustedB = sumU / n - clampedM * (sumV / n);
  return { m: clampedM, b: adjustedB, valid: true };
}

function intersectLines(
  horiz: { m: number; b: number }, // y = m*x + b
  vert: { m: number; b: number }   // x = m*y + b
): { x: number; y: number } {
  // x = vert.m * (horiz.m * x + horiz.b) + vert.b
  const denom = 1 - vert.m * horiz.m;
  if (Math.abs(denom) < 1e-4) {
    return { x: vert.b, y: horiz.b };
  }
  const x = (vert.m * horiz.b + vert.b) / denom;
  const y = horiz.m * x + horiz.b;
  return {
    x: Math.max(0.03, Math.min(0.97, x)),
    y: Math.max(0.03, Math.min(0.97, y)),
  };
}

/**
 * REAL 4-CORNER QUADRILATERAL EDGE & TEXT PROJECTION DETECTOR:
 * 1. Samples perimeter desk color & luminance.
 * 2. Computes Sobel gradient + paper-vs-background contrast map.
 * 3. Scans inward from Top, Bottom, Left, and Right edges along multiple rays
 *    to locate genuine document edge points.
 * 4. Fits 4 straight edge lines robustly and intersects them to obtain a true
 *    perspective trapezoid (QuadCorners) + skew angle + text line bands.
 */
export async function detectDocumentAndTextCorners(
  source: string | HTMLCanvasElement | HTMLVideoElement
): Promise<DetectedAreaResult> {
  const analysisW = 220;
  const analysisH = 220;

  const canvas = document.createElement('canvas');
  canvas.width = analysisW;
  canvas.height = analysisH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    return {
      corners: {
        topLeft: { x: 0.08, y: 0.08 },
        topRight: { x: 0.92, y: 0.08 },
        bottomRight: { x: 0.92, y: 0.92 },
        bottomLeft: { x: 0.08, y: 0.92 },
      },
      textBands: [],
      confidence: 0.5,
      skewAngleDeg: 0,
    };
  }

  if (typeof source === 'string') {
    const img = await loadImage(source);
    ctx.drawImage(img, 0, 0, analysisW, analysisH);
  } else {
    ctx.drawImage(source, 0, 0, analysisW, analysisH);
  }

  const imgData = ctx.getImageData(0, 0, analysisW, analysisH);
  const data = imgData.data;
  const totalPx = analysisW * analysisH;

  const gray = new Float32Array(totalPx);
  for (let i = 0; i < totalPx; i++) {
    const idx = i * 4;
    gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }

  // Estimate outer border background RGB + luminance
  let borderR = 0;
  let borderG = 0;
  let borderB = 0;
  let borderCount = 0;
  for (let y = 0; y < analysisH; y += 4) {
    for (let x = 0; x < analysisW; x += 4) {
      if (x < 10 || x >= analysisW - 10 || y < 10 || y >= analysisH - 10) {
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

  // Compute Sobel gradient magnitude + foreground contrast score
  const edgeScore = new Float32Array(totalPx);
  const textEnergyRows = new Float32Array(analysisH);
  let minTextX = analysisW;
  let maxTextX = 0;

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

      // Edge score combines Sobel gradient and transition away from border desk tone
      edgeScore[idx] = mag * 0.7 + colorDist * 0.35;

      // Text line horizontal stroke detection inside interior region
      const lum = gray[idx];
      if (
        x > 16 &&
        x < analysisW - 16 &&
        y > 16 &&
        y < analysisH - 16 &&
        Math.abs(gx) > 32 &&
        lum < 215
      ) {
        textEnergyRows[y] += Math.abs(gx);
        if (x < minTextX) minTextX = x;
        if (x > maxTextX) maxTextX = x;
      }
    }
  }

  // Detect edge points along 22 rays per side (from 15% to 85% span)
  const topPts: Array<{ u: number; v: number }> = [];
  const bottomPts: Array<{ u: number; v: number }> = [];
  const leftPts: Array<{ u: number; v: number }> = [];
  const rightPts: Array<{ u: number; v: number }> = [];

  const rayCount = 20;
  const edgeThreshold = 68;

  for (let i = 0; i < rayCount; i++) {
    const frac = 0.18 + (i / (rayCount - 1)) * 0.64;
    const rx = Math.round(frac * analysisW);
    const ry = Math.round(frac * analysisH);

    // Top scan (downward to 45% height)
    let bestTopY = -1;
    let bestTopScore = edgeThreshold;
    for (let y = 6; y < Math.round(analysisH * 0.45); y++) {
      const s = edgeScore[y * analysisW + rx];
      const nextBright = gray[Math.min(analysisH - 1, y + 4) * analysisW + rx];
      if (s > bestTopScore && (nextBright > bgLum + 18 || s > 135)) {
        bestTopScore = s;
        bestTopY = y;
        break;
      }
    }
    if (bestTopY > 0) topPts.push({ v: rx / analysisW, u: bestTopY / analysisH });

    // Bottom scan (upward from bottom to 55% height)
    let bestBotY = -1;
    let bestBotScore = edgeThreshold;
    for (let y = analysisH - 7; y > Math.round(analysisH * 0.55); y--) {
      const s = edgeScore[y * analysisW + rx];
      const prevBright = gray[Math.max(0, y - 4) * analysisW + rx];
      if (s > bestBotScore && (prevBright > bgLum + 18 || s > 135)) {
        bestBotScore = s;
        bestBotY = y;
        break;
      }
    }
    if (bestBotY > 0) bottomPts.push({ v: rx / analysisW, u: bestBotY / analysisH });

    // Left scan (rightward to 45% width)
    let bestLeftX = -1;
    let bestLeftScore = edgeThreshold;
    for (let x = 6; x < Math.round(analysisW * 0.45); x++) {
      const s = edgeScore[ry * analysisW + x];
      const nextBright = gray[ry * analysisW + Math.min(analysisW - 1, x + 4)];
      if (s > bestLeftScore && (nextBright > bgLum + 18 || s > 135)) {
        bestLeftScore = s;
        bestLeftX = x;
        break;
      }
    }
    if (bestLeftX > 0) leftPts.push({ v: ry / analysisH, u: bestLeftX / analysisW });

    // Right scan (leftward to 55% width)
    let bestRightX = -1;
    let bestRightScore = edgeThreshold;
    for (let x = analysisW - 7; x > Math.round(analysisW * 0.55); x--) {
      const s = edgeScore[ry * analysisW + x];
      const prevBright = gray[ry * analysisW + Math.max(0, x - 4)];
      if (s > bestRightScore && (prevBright > bgLum + 18 || s > 135)) {
        bestRightScore = s;
        bestRightX = x;
        break;
      }
    }
    if (bestRightX > 0) rightPts.push({ v: ry / analysisH, u: bestRightX / analysisW });
  }

  const topLine = fitLineRobust(topPts, 0.09);
  const bottomLine = fitLineRobust(bottomPts, 0.91);
  const leftLine = fitLineRobust(leftPts, 0.09);
  const rightLine = fitLineRobust(rightPts, 0.91);

  const tl = intersectLines(topLine, leftLine);
  const tr = intersectLines(topLine, rightLine);
  const br = intersectLines(bottomLine, rightLine);
  const bl = intersectLines(bottomLine, leftLine);

  // Sanity-check quad area so degenerate intersections never collapse
  const quadWidth = Math.min(tr.x - tl.x, br.x - bl.x);
  const quadHeight = Math.min(bl.y - tl.y, br.y - tr.y);
  const isQuadValid = quadWidth > 0.25 && quadHeight > 0.25;

  const corners: QuadCorners = isQuadValid
    ? {
        topLeft: tl,
        topRight: tr,
        bottomRight: br,
        bottomLeft: bl,
      }
    : {
        topLeft: { x: 0.09, y: 0.1 },
        topRight: { x: 0.91, y: 0.1 },
        bottomRight: { x: 0.91, y: 0.9 },
        bottomLeft: { x: 0.09, y: 0.9 },
      };

  // Identify Text Lines & Bounding Blocks relative to quad
  const textBands: { x: number; y: number; width: number; height: number }[] = [];
  let inBand = false;
  let bandStartY = 0;

  const bandMinX = minTextX < analysisW ? Math.max(0.08, minTextX / analysisW) : 0.12;
  const bandMaxX = maxTextX > 0 ? Math.min(0.92, maxTextX / analysisW) : 0.88;

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
      if (bandH >= 3 && bandH <= 36) {
        textBands.push({
          x: Math.max(0.06, (bandMinX - corners.topLeft.x) / Math.max(0.3, corners.topRight.x - corners.topLeft.x)),
          y: Math.max(0.04, (bandStartY / analysisH - corners.topLeft.y) / Math.max(0.3, corners.bottomLeft.y - corners.topLeft.y)),
          width: Math.min(0.86, (bandMaxX - bandMinX) / Math.max(0.3, corners.topRight.x - corners.topLeft.x)),
          height: Math.min(0.12, bandH / analysisH / Math.max(0.3, corners.bottomLeft.y - corners.topLeft.y)),
        });
      }
    }
  }

  // Real skew angle from top/left edge slopes
  const topSlopeDeg = (Math.atan(topLine.m) * 180) / Math.PI;
  const leftSlopeDeg = (Math.atan(leftLine.m) * 180) / Math.PI;
  const skewAngleDeg = Math.max(Math.abs(topSlopeDeg), Math.abs(leftSlopeDeg));

  // Confidence based on how many sides were cleanly locked + text presence
  const lockedSides = [topLine.valid, bottomLine.valid, leftLine.valid, rightLine.valid].filter(Boolean).length;
  const baseConf = isQuadValid ? 0.55 + lockedSides * 0.095 : 0.45;
  const confidence = Math.min(0.98, baseConf + (textBands.length > 0 ? 0.07 : 0));

  return {
    corners,
    textBands: textBands.slice(0, 12),
    confidence,
    skewAngleDeg,
  };
}
