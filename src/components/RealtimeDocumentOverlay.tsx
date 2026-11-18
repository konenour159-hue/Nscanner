import React, { useEffect, useRef, useState } from 'react';
import { QuadCorners, ScanMode } from '../types/scanner';
import { DetectedAreaResult } from '../utils/imageProcessing';
import { Check } from 'lucide-react';

interface RealtimeDocumentOverlayProps {
  detectedArea: DetectedAreaResult | null;
  scanMode?: ScanMode;
  isTextDetected?: boolean;
  videoElement?: HTMLVideoElement | null;
  autoCaptureProgress?: number; // 0 to 1 when locking steady
  autoCaptureEnabled?: boolean;
  fullFrameMode?: boolean;
  showGrid?: boolean;
  focusPoint?: { x: number; y: number } | null;
  onSmoothedCornersUpdate?: (corners: QuadCorners) => void;
}

interface RectBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function getDefaultRectForMode(mode: ScanMode, fullFrame = false): RectBox {
  if (fullFrame) {
    return { left: 0.04, top: 0.04, right: 0.96, bottom: 0.96 };
  }
  switch (mode) {
    case 'id_card':
      return { left: 0.14, top: 0.28, right: 0.86, bottom: 0.72 };
    case 'passport':
      return { left: 0.12, top: 0.22, right: 0.88, bottom: 0.78 };
    case 'receipt':
      return { left: 0.24, top: 0.08, right: 0.76, bottom: 0.92 };
    case 'book':
      return { left: 0.07, top: 0.16, right: 0.93, bottom: 0.84 };
    default:
      return { left: 0.09, top: 0.08, right: 0.91, bottom: 0.92 };
  }
}

/**
 * Normalizes any detected bounds into a strictly orthogonal 90-degree rectangle
 * spanning the entire physical paper section — never restricted to a sub-box of text.
 */
function cornersToOrthogonalPaperRect(
  detectedArea?: DetectedAreaResult | null,
  fallbackMode: ScanMode = 'document',
  fullFrame = false
): RectBox {
  if (fullFrame) return getDefaultRectForMode(fallbackMode, true);
  if (!detectedArea?.corners) return getDefaultRectForMode(fallbackMode, false);

  const c = detectedArea.corners;
  const surf = detectedArea.documentSurface;

  const rawLeft = surf ? surf.x : (c.topLeft.x + c.bottomLeft.x) * 0.5;
  const rawTop = surf ? surf.y : (c.topLeft.y + c.topRight.y) * 0.5;
  const rawRight = surf ? surf.x + surf.width : (c.topRight.x + c.bottomRight.x) * 0.5;
  const rawBottom = surf ? surf.y + surf.height : (c.bottomLeft.y + c.bottomRight.y) * 0.5;

  const left = Math.max(0.04, Math.min(0.32, rawLeft));
  const right = Math.min(0.96, Math.max(0.68, rawRight));
  const top = Math.max(0.04, Math.min(0.32, rawTop));
  const bottom = Math.min(0.96, Math.max(0.68, rawBottom));

  if (right - left < 0.36 || bottom - top < 0.34) {
    return getDefaultRectForMode(fallbackMode, false);
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
  videoElement,
  autoCaptureProgress = 0,
  autoCaptureEnabled = true,
  fullFrameMode = false,
  showGrid = false,
  focusPoint = null,
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

  const initialRect = getDefaultRectForMode(scanMode, fullFrameMode);
  const currentRectRef = useRef<RectBox>({ ...initialRect });
  const targetRectRef = useRef<RectBox>({ ...initialRect });

  const [smoothedRect, setSmoothedRect] = useState<RectBox>({ ...initialRect });
  const [scanProgress, setScanProgress] = useState<number>(0.15);
  const miniCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Sync mode switches or full-frame toggle immediately
  useEffect(() => {
    if (fullFrameMode || !videoElement || videoElement.readyState < 2) {
      targetRectRef.current = getDefaultRectForMode(scanMode, fullFrameMode);
    }
  }, [scanMode, fullFrameMode, videoElement]);

  // Apply hysteresis deadzone before updating target paper rect so boundary never jitters
  useEffect(() => {
    if (fullFrameMode) {
      targetRectRef.current = getDefaultRectForMode(scanMode, true);
      return;
    }
    if (detectedArea?.corners) {
      const nextRect =
        videoElement && videoElement.readyState >= 2
          ? cornersToOrthogonalPaperRect(detectedArea, scanMode, false)
          : getDefaultRectForMode(scanMode, false);

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
  }, [detectedArea, scanMode, fullFrameMode, videoElement]);

  // Smooth spring-lerp + calm optical sweep across entire document paper sheet
  useEffect(() => {
    let animId: number;
    let scanPos = 0.05;
    let scanDir = 1;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const updateFrame = () => {
      const target = targetRectRef.current;
      const curr = currentRectRef.current;
      const factor = 0.18;

      curr.left = lerp(curr.left, target.left, factor);
      curr.top = lerp(curr.top, target.top, factor);
      curr.right = lerp(curr.right, target.right, factor);
      curr.bottom = lerp(curr.bottom, target.bottom, factor);

      if (!prefersReduced) {
        scanPos += 0.0048 * scanDir;
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

  // Live rectified paper thumbnail preview (~10 FPS)
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

  // Strict orthogonal pixel rectangle spanning the FULL DOCUMENT / PAPER SURFACE
  const rectX = Math.round(smoothedRect.left * boxSize.w);
  const rectY = Math.round(smoothedRect.top * boxSize.h);
  const rectW = Math.max(88, Math.round((smoothedRect.right - smoothedRect.left) * boxSize.w));
  const rectH = Math.max(88, Math.round((smoothedRect.bottom - smoothedRect.top) * boxSize.h));

  // Full-paper optical scan sweep across the entire document height
  const sweepY = rectY + scanProgress * rectH;
  const trailHeight = 36;

  const isLocked = autoCaptureEnabled && autoCaptureProgress > 0.08;
  const isLowLight = (detectedArea?.avgLuminance ?? 140) < 62;
  const isSoftFocus = (detectedArea?.sharpnessScore ?? 0.8) < 0.28;
  const bracketLeg = Math.min(24, Math.max(14, Math.round(Math.min(rectW, rectH) * 0.085)));

  let statusLabel = fullFrameMode ? 'Full Frame Capture' : 'Document Surface Aligned';
  if (isLocked) {
    statusLabel = `Hold steady · ${Math.round(autoCaptureProgress * 100)}%`;
  } else if (videoElement && videoElement.readyState >= 2) {
    if (isLowLight) {
      statusLabel = 'Low light · Try Torch or Brighter Light';
    } else if (isSoftFocus) {
      statusLabel = 'Tap paper to focus cleanly';
    } else if (detectedArea?.paperDetected) {
      statusLabel = 'Paper Sheet Locked';
    }
  }

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
      <svg
        width={boxSize.w}
        height={boxSize.h}
        viewBox={`0 0 ${boxSize.w} ${boxSize.h}`}
        className="w-full h-full absolute inset-0"
      >
        <defs>
          {/* Outer cutout strictly matching the full squared paper rectangle */}
          <mask id="ns-paper-doc-mask">
            <rect width={boxSize.w} height={boxSize.h} fill="white" />
            <rect x={rectX} y={rectY} width={rectW} height={rectH} rx="10" fill="black" />
          </mask>

          {/* Clip sweep & grid cleanly inside the document paper rect */}
          <clipPath id="ns-paper-clip">
            <rect x={rectX} y={rectY} width={rectW} height={rectH} rx="10" />
          </clipPath>

          {/* Unified very light, almost-transparent blue glass wash covering the ENTIRE paper section */}
          <linearGradient id="ns-paper-surface-wash" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#93C5FD" stopOpacity="0.13" />
            <stop offset="50%" stopColor="#60A5FA" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.12" />
          </linearGradient>

          {/* Soft vertical optical scan trail across full paper section */}
          <linearGradient id="ns-paper-scan-trail" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#60A5FA" stopOpacity="0" />
            <stop offset="100%" stopColor="#93C5FD" stopOpacity="0.2" />
          </linearGradient>
        </defs>

        {/* Gentle darkened desk surround outside the full paper rectangle */}
        <rect
          width={boxSize.w}
          height={boxSize.h}
          fill="rgba(8, 12, 24, 0.34)"
          mask="url(#ns-paper-doc-mask)"
        />

        {/* Polished, uniform, almost-transparent blue projection plate across the ENTIRE paper sheet */}
        <rect
          x={rectX}
          y={rectY}
          width={rectW}
          height={rectH}
          rx="10"
          fill="url(#ns-paper-surface-wash)"
          stroke="rgba(147, 197, 253, 0.72)"
          strokeWidth="1.5"
        />

        {/* Clipped interior full-paper optical scan sweep & optional alignment grid */}
        <g clipPath="url(#ns-paper-clip)">
          {showGrid && (
            <g stroke="rgba(191, 219, 254, 0.28)" strokeWidth="1">
              <line x1={rectX + rectW / 3} y1={rectY} x2={rectX + rectW / 3} y2={rectY + rectH} />
              <line x1={rectX + (rectW * 2) / 3} y1={rectY} x2={rectX + (rectW * 2) / 3} y2={rectY + rectH} />
              <line x1={rectX} y1={rectY + rectH / 3} x2={rectX + rectW} y2={rectY + rectH / 3} />
              <line x1={rectX} y1={rectY + (rectH * 2) / 3} x2={rectX + rectW} y2={rectY + (rectH * 2) / 3} />
            </g>
          )}

          {/* Full-width optical scan sweep spanning the entire document paper */}
          <rect
            x={rectX}
            y={sweepY - trailHeight}
            width={rectW}
            height={trailHeight}
            fill="url(#ns-paper-scan-trail)"
          />
          <line
            x1={rectX}
            y1={sweepY}
            x2={rectX + rectW}
            y2={sweepY}
            stroke="rgba(191, 219, 254, 0.88)"
            strokeWidth="1.5"
          />
        </g>

        {/* 4 Precision Architectural Corner L-Brackets */}
        {[
          `M ${rectX} ${rectY + bracketLeg} L ${rectX} ${rectY} L ${rectX + bracketLeg} ${rectY}`,
          `M ${rectX + rectW - bracketLeg} ${rectY} L ${rectX + rectW} ${rectY} L ${rectX + rectW} ${rectY + bracketLeg}`,
          `M ${rectX + rectW} ${rectY + rectH - bracketLeg} L ${rectX + rectW} ${rectY + rectH} L ${rectX + rectW - bracketLeg} ${rectY + rectH}`,
          `M ${rectX + bracketLeg} ${rectY + rectH} L ${rectX} ${rectY + rectH} L ${rectX} ${rectY + rectH - bracketLeg}`,
        ].map((pathD, idx) => (
          <path
            key={idx}
            d={pathD}
            fill="none"
            stroke="#BFDBFE"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>

      {/* Tap-to-Focus Optical Reticle */}
      {focusPoint && (
        <div
          style={{
            left: `${focusPoint.x * 100}%`,
            top: `${focusPoint.y * 100}%`,
            transform: 'translate(-50%, -50%)',
          }}
          className="absolute w-14 h-14 rounded-lg border-2 border-blue-300/90 shadow-[0_0_0_2px_rgba(15,23,42,0.45)] flex items-center justify-center transition-opacity duration-200"
        >
          <div className="w-1.5 h-1.5 rounded-full bg-blue-300" />
        </div>
      )}

      {/* Clean Minimal Projection Status Pill */}
      <div
        className={`absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-slate-950/75 backdrop-blur-md flex items-center gap-2 text-[11px] select-none border ${
          isLowLight
            ? 'border-amber-400/50 text-amber-200'
            : 'border-blue-400/35 text-blue-100'
        }`}
      >
        <span className="font-medium tracking-tight whitespace-nowrap">{statusLabel}</span>
      </div>

      {/* Live Straightened Paper Thumbnail (Desktop / Tablet viewports when camera is active) */}
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
            <span>Paper Lock</span>
          </div>
        </div>
      )}
    </div>
  );
};
