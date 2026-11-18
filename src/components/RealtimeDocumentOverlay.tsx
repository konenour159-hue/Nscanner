import React, { useEffect, useRef, useState } from 'react';
import { QuadCorners, ScanMode } from '../types/scanner';
import { DetectedAreaResult } from '../utils/imageProcessing';
import { Check } from 'lucide-react';

interface RealtimeDocumentOverlayProps {
  detectedArea: DetectedAreaResult | null;
  scanMode?: ScanMode;
  modeAccentColor?: string;
  isTextDetected: boolean;
  videoElement?: HTMLVideoElement | null;
  autoCaptureProgress?: number; // 0 to 1 when locking steady
  autoCaptureEnabled?: boolean;
  onSmoothedCornersUpdate?: (corners: QuadCorners) => void;
}

interface RectBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function getDefaultRectForMode(mode: ScanMode): RectBox {
  switch (mode) {
    case 'id_card':
      return { left: 0.14, top: 0.28, right: 0.86, bottom: 0.72 };
    case 'passport':
      return { left: 0.12, top: 0.22, right: 0.88, bottom: 0.78 };
    case 'receipt':
      return { left: 0.26, top: 0.1, right: 0.74, bottom: 0.9 };
    case 'book':
      return { left: 0.08, top: 0.18, right: 0.92, bottom: 0.82 };
    default:
      return { left: 0.12, top: 0.1, right: 0.88, bottom: 0.9 };
  }
}

/**
 * Normalizes any QuadCorners into a strictly orthogonal 90-degree rectangle
 * so the projection surface is always clean, squared, and never oblique.
 */
function cornersToOrthogonalRect(corners?: QuadCorners | null, fallbackMode: ScanMode = 'document'): RectBox {
  if (!corners) return getDefaultRectForMode(fallbackMode);

  const rawLeft = (corners.topLeft.x + corners.bottomLeft.x) * 0.5;
  const rawRight = (corners.topRight.x + corners.bottomRight.x) * 0.5;
  const rawTop = (corners.topLeft.y + corners.topRight.y) * 0.5;
  const rawBottom = (corners.bottomLeft.y + corners.bottomRight.y) * 0.5;

  const left = Math.max(0.05, Math.min(0.4, rawLeft));
  const right = Math.min(0.95, Math.max(0.6, rawRight));
  const top = Math.max(0.05, Math.min(0.4, rawTop));
  const bottom = Math.min(0.95, Math.max(0.6, rawBottom));

  if (right - left < 0.3 || bottom - top < 0.28) {
    return getDefaultRectForMode(fallbackMode);
  }

  return { left, top, right, bottom };
}

function rectToCorners(r: RectBox): QuadCorners {
  return {
    topLeft: { x: r.left, y: r.top },
    topRight: { x: r.right, y: r.top },
    bottomRight: { x: r.right, y: r.bottom },
    bottomLeft: { x: r.left, y: r.bottom },
  };
}

export const RealtimeDocumentOverlay: React.FC<RealtimeDocumentOverlayProps> = ({
  detectedArea,
  scanMode = 'document',
  isTextDetected: _isTextDetected,
  videoElement,
  autoCaptureProgress = 0,
  autoCaptureEnabled = true,
  onSmoothedCornersUpdate,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [boxSize, setBoxSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setBoxSize({ w: rect.width, h: rect.height });
      }
    };
    updateSize();
    const obs = new ResizeObserver(updateSize);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const initialRect = getDefaultRectForMode(scanMode);
  const currentRectRef = useRef<RectBox>({ ...initialRect });
  const targetRectRef = useRef<RectBox>({ ...initialRect });
  const textSurfaceRef = useRef<{ x: number; y: number; width: number; height: number }>({
    x: 0.08,
    y: 0.1,
    width: 0.84,
    height: 0.8,
  });

  const [smoothedRect, setSmoothedRect] = useState<RectBox>({ ...initialRect });
  const [smoothedTextSurf, setSmoothedTextSurf] = useState(textSurfaceRef.current);
  const [scanProgress, setScanProgress] = useState<number>(0.15);
  const miniCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Sync mode switches cleanly
  useEffect(() => {
    if (!videoElement || videoElement.readyState < 2) {
      const next = getDefaultRectForMode(scanMode);
      targetRectRef.current = next;
    }
  }, [scanMode, videoElement]);

  // Apply hysteresis deadzone before updating target rect so edges never jitter
  useEffect(() => {
    if (detectedArea?.corners) {
      const nextRect =
        videoElement && videoElement.readyState >= 2
          ? cornersToOrthogonalRect(detectedArea.corners, scanMode)
          : getDefaultRectForMode(scanMode);

      const prev = targetRectRef.current;
      const delta = Math.max(
        Math.abs(nextRect.left - prev.left),
        Math.abs(nextRect.top - prev.top),
        Math.abs(nextRect.right - prev.right),
        Math.abs(nextRect.bottom - prev.bottom)
      );
      if (delta > 0.012) {
        targetRectRef.current = nextRect;
      }
    }

    if (detectedArea?.textSurface) {
      textSurfaceRef.current = detectedArea.textSurface;
    }
  }, [detectedArea, scanMode, videoElement]);

  // Smooth spring-lerp + calm vertical optical sweep animation
  useEffect(() => {
    let animId: number;
    let scanPos = 0.08;
    let scanDir = 1;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const updateFrame = () => {
      const target = targetRectRef.current;
      const curr = currentRectRef.current;
      const factor = 0.16;

      curr.left = lerp(curr.left, target.left, factor);
      curr.top = lerp(curr.top, target.top, factor);
      curr.right = lerp(curr.right, target.right, factor);
      curr.bottom = lerp(curr.bottom, target.bottom, factor);

      const tsTarget = textSurfaceRef.current;
      setSmoothedTextSurf((prev) => ({
        x: lerp(prev.x, tsTarget.x, 0.15),
        y: lerp(prev.y, tsTarget.y, 0.15),
        width: lerp(prev.width, tsTarget.width, 0.15),
        height: lerp(prev.height, tsTarget.height, 0.15),
      }));

      if (!prefersReduced) {
        scanPos += 0.0052 * scanDir;
        if (scanPos >= 1) {
          scanPos = 1;
          scanDir = -1;
        } else if (scanPos <= 0) {
          scanPos = 0;
          scanDir = 1;
        }
        setScanProgress(scanPos);
      } else {
        setScanProgress(0.5);
      }

      const copy: RectBox = { ...curr };
      setSmoothedRect(copy);
      onSmoothedCornersUpdate?.(rectToCorners(copy));

      animId = requestAnimationFrame(updateFrame);
    };

    animId = requestAnimationFrame(updateFrame);
    return () => cancelAnimationFrame(animId);
  }, [onSmoothedCornersUpdate]);

  // Live rectified thumbnail preview (~10 FPS)
  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let isCancelled = false;

    function renderMiniPreview() {
      if (!videoElement || videoElement.readyState < 2 || !miniCanvasRef.current) {
        if (!isCancelled) timerId = setTimeout(renderMiniPreview, 180);
        return;
      }

      const canvas = miniCanvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const vidW = videoElement.videoWidth || 640;
      const vidH = videoElement.videoHeight || 480;
      const r = currentRectRef.current;

      const sx = r.left * vidW;
      const sy = r.top * vidH;
      const sw = Math.max(16, (r.right - r.left) * vidW);
      const sh = Math.max(16, (r.bottom - r.top) * vidH);

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(videoElement, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

      if (!isCancelled) {
        timerId = setTimeout(renderMiniPreview, 110);
      }
    }

    timerId = setTimeout(renderMiniPreview, 200);
    return () => {
      isCancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [videoElement]);

  // Strict orthogonal pixel rectangle inside the viewport container
  const rectX = Math.round(smoothedRect.left * boxSize.w);
  const rectY = Math.round(smoothedRect.top * boxSize.h);
  const rectW = Math.max(80, Math.round((smoothedRect.right - smoothedRect.left) * boxSize.w));
  const rectH = Math.max(80, Math.round((smoothedRect.bottom - smoothedRect.top) * boxSize.h));

  // Polished inner rectangular text surface strictly aligned with document rect
  const textX = Math.round(rectX + smoothedTextSurf.x * rectW);
  const textY = Math.round(rectY + smoothedTextSurf.y * rectH);
  const textW = Math.max(48, Math.round(smoothedTextSurf.width * rectW));
  const textH = Math.max(40, Math.round(smoothedTextSurf.height * rectH));

  // Optical scan sweep coordinate clipped inside the rounded rectangle
  const sweepY = textY + scanProgress * textH;
  const trailHeight = 32;

  const isLocked = autoCaptureEnabled && autoCaptureProgress > 0.08;
  const bracketLeg = Math.min(22, Math.max(14, Math.round(Math.min(rectW, rectH) * 0.08)));

  // Clean aligned orthogonal text baseline guides inside polished text surface
  const detectedBands = detectedArea?.textBands?.length
    ? detectedArea.textBands.slice(0, 8)
    : [
        { x: 0.1, y: 0.18, width: 0.72, height: 0.025 },
        { x: 0.1, y: 0.3, width: 0.78, height: 0.025 },
        { x: 0.1, y: 0.42, width: 0.68, height: 0.025 },
        { x: 0.1, y: 0.54, width: 0.75, height: 0.025 },
        { x: 0.1, y: 0.66, width: 0.58, height: 0.025 },
      ];

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
      <svg
        width={boxSize.w}
        height={boxSize.h}
        viewBox={`0 0 ${boxSize.w} ${boxSize.h}`}
        className="w-full h-full absolute inset-0"
      >
        <defs>
          {/* Outer vignette cutout strictly matching the square/rounded document rect */}
          <mask id="ns-square-doc-mask">
            <rect width={boxSize.w} height={boxSize.h} fill="white" />
            <rect x={rectX} y={rectY} width={rectW} height={rectH} rx="10" fill="black" />
          </mask>

          {/* Clip micro-animations cleanly inside the document rect */}
          <clipPath id="ns-doc-clip">
            <rect x={rectX} y={rectY} width={rectW} height={rectH} rx="10" />
          </clipPath>

          {/* Very light, almost-transparent blue document surface gradient */}
          <linearGradient id="ns-blue-surface-wash" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#60A5FA" stopOpacity="0.11" />
            <stop offset="50%" stopColor="#3B82F6" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#2563EB" stopOpacity="0.10" />
          </linearGradient>

          {/* Slightly clearer blue polish strictly over the rectangular text zone */}
          <linearGradient id="ns-text-surface-polish" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#93C5FD" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.08" />
          </linearGradient>

          {/* Soft vertical optical scan trail */}
          <linearGradient id="ns-scan-trail" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#60A5FA" stopOpacity="0" />
            <stop offset="100%" stopColor="#93C5FD" stopOpacity="0.22" />
          </linearGradient>
        </defs>

        {/* Soft dimmed surround outside the square document boundary */}
        <rect
          width={boxSize.w}
          height={boxSize.h}
          fill="rgba(10, 15, 28, 0.36)"
          mask="url(#ns-square-doc-mask)"
        />

        {/* Light translucent blue projection wash over full document rectangle */}
        <rect
          x={rectX}
          y={rectY}
          width={rectW}
          height={rectH}
          rx="10"
          fill="url(#ns-blue-surface-wash)"
          stroke="rgba(147, 197, 253, 0.62)"
          strokeWidth="1.25"
        />

        {/* Clipped interior polished text surface & micro scanline */}
        <g clipPath="url(#ns-doc-clip)">
          {/* Polished rectangular text-surface plate (strictly square/orthogonal) */}
          <rect
            x={textX}
            y={textY}
            width={textW}
            height={textH}
            rx="6"
            fill="url(#ns-text-surface-polish)"
            stroke="rgba(191, 219, 254, 0.34)"
            strokeWidth="1"
          />

          {/* Subtle clean rectangular alignment bars across detected text rows */}
          {detectedBands.map((band, idx) => {
            const bx = Math.round(rectX + Math.max(0.08, band.x) * rectW);
            const by = Math.round(rectY + band.y * rectH);
            const bw = Math.max(24, Math.min(rectW - (bx - rectX) - 16, Math.round(band.width * rectW)));
            const distFromSweep = Math.abs(by - sweepY);
            const isHighlighted = distFromSweep < 26;

            return (
              <rect
                key={idx}
                x={bx}
                y={by}
                width={bw}
                height={Math.max(3, Math.round(Math.min(6, band.height * rectH * 0.45)))}
                rx="1.5"
                fill={isHighlighted ? 'rgba(191, 219, 254, 0.42)' : 'rgba(147, 197, 253, 0.16)'}
              />
            );
          })}

          {/* Gentle optical scan gradient trail + crisp hairline beam */}
          <rect
            x={textX}
            y={sweepY - trailHeight}
            width={textW}
            height={trailHeight}
            fill="url(#ns-scan-trail)"
          />
          <line
            x1={textX}
            y1={sweepY}
            x2={textX + textW}
            y2={sweepY}
            stroke="rgba(191, 219, 254, 0.92)"
            strokeWidth="1.5"
          />
        </g>

        {/* 4 Precision Architectural Corner L-Brackets */}
        {[
          // Top-Left
          `M ${rectX} ${rectY + bracketLeg} L ${rectX} ${rectY} L ${rectX + bracketLeg} ${rectY}`,
          // Top-Right
          `M ${rectX + rectW - bracketLeg} ${rectY} L ${rectX + rectW} ${rectY} L ${rectX + rectW} ${rectY + bracketLeg}`,
          // Bottom-Right
          `M ${rectX + rectW} ${rectY + rectH - bracketLeg} L ${rectX + rectW} ${rectY + rectH} L ${rectX + rectW - bracketLeg} ${rectY + rectH}`,
          // Bottom-Left
          `M ${rectX + bracketLeg} ${rectY + rectH} L ${rectX} ${rectY + rectH} L ${rectX} ${rectY + rectH - bracketLeg}`,
        ].map((pathD, idx) => (
          <path
            key={idx}
            d={pathD}
            fill="none"
            stroke="#93C5FD"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>

      {/* Clean Minimal Projection Status Pill */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-slate-950/75 border border-blue-400/35 backdrop-blur-md flex items-center gap-2 text-[11px] text-blue-100 select-none">
        <span className="font-medium tracking-tight whitespace-nowrap">
          {isLocked ? `Hold steady · ${Math.round(autoCaptureProgress * 100)}%` : 'Auto-Projection Aligned'}
        </span>
      </div>

      {/* Live Straightened Preview Thumbnail (Desktop / Tablet viewports when camera is active) */}
      {videoElement && videoElement.readyState >= 2 && (
        <div className="absolute bottom-3 right-3 z-20 hidden sm:flex flex-col items-center bg-slate-950/80 backdrop-blur-md p-1.5 rounded-lg border border-blue-400/35 shadow-lg">
          <canvas
            ref={miniCanvasRef}
            width={84}
            height={112}
            className="rounded border border-slate-700 bg-white"
          />
          <div className="text-[9px] font-medium text-blue-200 mt-1 flex items-center gap-1">
            <Check className="w-2.5 h-2.5 text-blue-400" />
            <span>Aligned</span>
          </div>
        </div>
      )}
    </div>
  );
};
