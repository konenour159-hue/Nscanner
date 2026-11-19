import React, { useEffect, useRef, useState } from 'react';
import { QuadCorners, ScanMode } from '../types/scanner';
import { computeVideoVisibleCrop, DetectedAreaResult } from '../utils/imageProcessing';
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

function getDefaultCornersForMode(mode: ScanMode, fullFrame = false): QuadCorners {
  let l = 0.09;
  let t = 0.08;
  let r = 0.91;
  let b = 0.92;

  if (fullFrame) {
    l = 0.03;
    t = 0.03;
    r = 0.97;
    b = 0.97;
  } else {
    switch (mode) {
      case 'id_card':
        l = 0.14;
        t = 0.28;
        r = 0.86;
        b = 0.72;
        break;
      case 'passport':
        l = 0.12;
        t = 0.22;
        r = 0.88;
        b = 0.78;
        break;
      case 'receipt':
        l = 0.24;
        t = 0.08;
        r = 0.76;
        b = 0.92;
        break;
      case 'book':
        l = 0.07;
        t = 0.16;
        r = 0.93;
        b = 0.84;
        break;
      default:
        break;
    }
  }

  return {
    topLeft: { x: l, y: t },
    topRight: { x: r, y: t },
    bottomRight: { x: r, y: b },
    bottomLeft: { x: l, y: b },
  };
}

function cloneQuad(q: QuadCorners): QuadCorners {
  return {
    topLeft: { ...q.topLeft },
    topRight: { ...q.topRight },
    bottomRight: { ...q.bottomRight },
    bottomLeft: { ...q.bottomLeft },
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
  const boxSizeRef = useRef<{ w: number; h: number }>({ w: 800, h: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const next = { w: rect.width, h: rect.height };
        boxSizeRef.current = next;
        setBoxSize(next);
      }
    };
    updateSize();
    const obs = new ResizeObserver(updateSize);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const initialQuad = getDefaultCornersForMode(scanMode, fullFrameMode);
  const currentQuadRef = useRef<QuadCorners>(cloneQuad(initialQuad));
  const targetQuadRef = useRef<QuadCorners>(cloneQuad(initialQuad));

  const [smoothedQuad, setSmoothedQuad] = useState<QuadCorners>(cloneQuad(initialQuad));
  const [scanProgress, setScanProgress] = useState<number>(0.15);
  const miniCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Sync mode switches or full-frame toggle immediately
  useEffect(() => {
    if (fullFrameMode || !videoElement || videoElement.readyState < 2) {
      targetQuadRef.current = getDefaultCornersForMode(scanMode, fullFrameMode);
    }
  }, [scanMode, fullFrameMode, videoElement]);

  // Apply hysteresis deadzone per corner so detected quad hugs any document angle cleanly without micro-jitter
  useEffect(() => {
    if (fullFrameMode) {
      targetQuadRef.current = getDefaultCornersForMode(scanMode, true);
      return;
    }
    if (detectedArea?.corners && videoElement && videoElement.readyState >= 2) {
      const next = detectedArea.paperDetected
        ? detectedArea.corners
        : getDefaultCornersForMode(scanMode, false);

      const prev = targetQuadRef.current;
      const delta = Math.max(
        Math.abs(next.topLeft.x - prev.topLeft.x),
        Math.abs(next.topLeft.y - prev.topLeft.y),
        Math.abs(next.topRight.x - prev.topRight.x),
        Math.abs(next.topRight.y - prev.topRight.y),
        Math.abs(next.bottomRight.x - prev.bottomRight.x),
        Math.abs(next.bottomRight.y - prev.bottomRight.y),
        Math.abs(next.bottomLeft.x - prev.bottomLeft.x),
        Math.abs(next.bottomLeft.y - prev.bottomLeft.y)
      );

      if (delta > 0.0085) {
        targetQuadRef.current = cloneQuad(next);
      }
    }
  }, [detectedArea, scanMode, fullFrameMode, videoElement]);

  // Smooth spring-lerp across all 4 quad corners + calm optical sweep clipped inside paper polygon
  useEffect(() => {
    let animId: number;
    let scanPos = 0.05;
    let scanDir = 1;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const updateFrame = () => {
      const target = targetQuadRef.current;
      const curr = currentQuadRef.current;
      const factor = 0.24;

      curr.topLeft.x = lerp(curr.topLeft.x, target.topLeft.x, factor);
      curr.topLeft.y = lerp(curr.topLeft.y, target.topLeft.y, factor);
      curr.topRight.x = lerp(curr.topRight.x, target.topRight.x, factor);
      curr.topRight.y = lerp(curr.topRight.y, target.topRight.y, factor);
      curr.bottomRight.x = lerp(curr.bottomRight.x, target.bottomRight.x, factor);
      curr.bottomRight.y = lerp(curr.bottomRight.y, target.bottomRight.y, factor);
      curr.bottomLeft.x = lerp(curr.bottomLeft.x, target.bottomLeft.x, factor);
      curr.bottomLeft.y = lerp(curr.bottomLeft.y, target.bottomLeft.y, factor);

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

      const copy = cloneQuad(curr);
      setSmoothedQuad(copy);
      onSmoothedCornersUpdate?.(copy);

      animId = requestAnimationFrame(updateFrame);
    };

    animId = requestAnimationFrame(updateFrame);
    return () => cancelAnimationFrame(animId);
  }, [onSmoothedCornersUpdate]);

  // Live cropped paper thumbnail preview (~10 FPS), 1:1 synced with CSS object-cover viewport
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
      const crop = computeVideoVisibleCrop(
        vidW,
        vidH,
        boxSizeRef.current.w,
        boxSizeRef.current.h
      );

      const q = currentQuadRef.current;
      const minX = Math.min(q.topLeft.x, q.bottomLeft.x);
      const maxX = Math.max(q.topRight.x, q.bottomRight.x);
      const minY = Math.min(q.topLeft.y, q.topRight.y);
      const maxY = Math.max(q.bottomLeft.y, q.bottomRight.y);

      const sx = crop.sx + minX * crop.sw;
      const sy = crop.sy + minY * crop.sh;
      const sw = Math.max(16, (maxX - minX) * crop.sw);
      const sh = Math.max(16, (maxY - minY) * crop.sh);

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

  // Pixel coordinates of the 4 smoothed corners tightly hugging the paper shape
  const tl = { x: smoothedQuad.topLeft.x * boxSize.w, y: smoothedQuad.topLeft.y * boxSize.h };
  const tr = { x: smoothedQuad.topRight.x * boxSize.w, y: smoothedQuad.topRight.y * boxSize.h };
  const br = {
    x: smoothedQuad.bottomRight.x * boxSize.w,
    y: smoothedQuad.bottomRight.y * boxSize.h,
  };
  const bl = {
    x: smoothedQuad.bottomLeft.x * boxSize.w,
    y: smoothedQuad.bottomLeft.y * boxSize.h,
  };

  const polyPoints = `${tl.x.toFixed(1)},${tl.y.toFixed(1)} ${tr.x.toFixed(1)},${tr.y.toFixed(1)} ${br.x.toFixed(1)},${br.y.toFixed(1)} ${bl.x.toFixed(1)},${bl.y.toFixed(1)}`;

  // Edge lengths for bracket proportions
  const topLen = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const rightLen = Math.hypot(br.x - tr.x, br.y - tr.y);
  const bottomLen = Math.hypot(bl.x - br.x, bl.y - br.y);
  const leftLen = Math.hypot(tl.x - bl.x, tl.y - bl.y);
  const minEdgePx = Math.max(64, Math.min(topLen, rightLen, bottomLen, leftLen));
  const bracketLeg = Math.min(26, Math.max(13, Math.round(minEdgePx * 0.11)));

  // Edge-aligned corner L-bracket path builder
  const buildCornerBracket = (
    c: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number }
  ) => {
    const da = Math.max(1, Math.hypot(a.x - c.x, a.y - c.y));
    const db = Math.max(1, Math.hypot(b.x - c.x, b.y - c.y));
    const p1x = c.x + ((a.x - c.x) / da) * bracketLeg;
    const p1y = c.y + ((a.y - c.y) / da) * bracketLeg;
    const p2x = c.x + ((b.x - c.x) / db) * bracketLeg;
    const p2y = c.y + ((b.y - c.y) / db) * bracketLeg;
    return `M ${p1x.toFixed(1)} ${p1y.toFixed(1)} L ${c.x.toFixed(1)} ${c.y.toFixed(1)} L ${p2x.toFixed(1)} ${p2y.toFixed(1)}`;
  };

  // Bilinear point interpolation helper for perspective-matched grid & optical sweep beam
  const lerpPt = (
    p: { x: number; y: number },
    q: { x: number; y: number },
    t: number
  ) => ({
    x: p.x + (q.x - p.x) * t,
    y: p.y + (q.y - p.y) * t,
  });

  const sweepLeadL = lerpPt(tl, bl, scanProgress);
  const sweepLeadR = lerpPt(tr, br, scanProgress);
  const trailT = Math.max(0, scanProgress - 0.11);
  const sweepTailL = lerpPt(tl, bl, trailT);
  const sweepTailR = lerpPt(tr, br, trailT);
  const sweepTrailPoly = `${sweepTailL.x.toFixed(1)},${sweepTailL.y.toFixed(1)} ${sweepTailR.x.toFixed(1)},${sweepTailR.y.toFixed(1)} ${sweepLeadR.x.toFixed(1)},${sweepLeadR.y.toFixed(1)} ${sweepLeadL.x.toFixed(1)},${sweepLeadL.y.toFixed(1)}`;

  const isLocked = autoCaptureEnabled && autoCaptureProgress > 0.08;
  const isLowLight = (detectedArea?.avgLuminance ?? 140) < 62;
  const isSoftFocus = (detectedArea?.sharpnessScore ?? 0.8) < 0.28;

  let statusLabel = fullFrameMode ? 'Full Frame Capture' : 'Align Paper Inside Frame';
  if (isLocked) {
    statusLabel = `Hold steady · ${Math.round(autoCaptureProgress * 100)}%`;
  } else if (videoElement && videoElement.readyState >= 2) {
    if (isLowLight) {
      statusLabel = 'Low light · Try Torch or Brighter Light';
    } else if (isSoftFocus) {
      statusLabel = 'Tap paper to focus cleanly';
    } else if (detectedArea?.paperDetected) {
      statusLabel =
        (detectedArea.skewAngleDeg ?? 0) >= 2.2
          ? 'Paper Contour Matched'
          : 'Paper Sheet Locked';
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
          {/* Outer cutout strictly matching the 4-corner perspective paper polygon */}
          <mask id="ns-paper-doc-mask">
            <rect width={boxSize.w} height={boxSize.h} fill="white" />
            <polygon points={polyPoints} fill="black" />
          </mask>

          {/* Clip sweep & perspective grid cleanly inside the paper polygon */}
          <clipPath id="ns-paper-clip">
            <polygon points={polyPoints} />
          </clipPath>

          {/* Very light, almost-transparent blue glass wash covering the ENTIRE document quad */}
          <linearGradient id="ns-paper-surface-wash" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#93C5FD" stopOpacity="0.14" />
            <stop offset="50%" stopColor="#60A5FA" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.13" />
          </linearGradient>
        </defs>

        {/* Gentle darkened desk surround outside the exact physical paper quad */}
        <rect
          width={boxSize.w}
          height={boxSize.h}
          fill="rgba(8, 12, 24, 0.34)"
          mask="url(#ns-paper-doc-mask)"
        />

        {/* Polished, uniform, almost-transparent blue projection plate tightly marrying the paper */}
        <polygon
          points={polyPoints}
          fill="url(#ns-paper-surface-wash)"
          stroke={isLocked ? 'rgba(96, 165, 250, 0.92)' : 'rgba(147, 197, 253, 0.78)'}
          strokeWidth={isLocked ? 2 : 1.5}
          strokeLinejoin="round"
        />

        {/* Clipped interior optical scan sweep & bilinear 3x3 framing grid */}
        <g clipPath="url(#ns-paper-clip)">
          {showGrid && (
            <g stroke="rgba(191, 219, 254, 0.32)" strokeWidth="1">
              {[1 / 3, 2 / 3].map((t) => {
                const topP = lerpPt(tl, tr, t);
                const botP = lerpPt(bl, br, t);
                const leftP = lerpPt(tl, bl, t);
                const rightP = lerpPt(tr, br, t);
                return (
                  <React.Fragment key={t}>
                    <line x1={topP.x} y1={topP.y} x2={botP.x} y2={botP.y} />
                    <line x1={leftP.x} y1={leftP.y} x2={rightP.x} y2={rightP.y} />
                  </React.Fragment>
                );
              })}
            </g>
          )}

          {/* Soft perspective-aligned optical scan beam */}
          <polygon points={sweepTrailPoly} fill="rgba(147, 197, 253, 0.14)" />
          <line
            x1={sweepLeadL.x}
            y1={sweepLeadL.y}
            x2={sweepLeadR.x}
            y2={sweepLeadR.y}
            stroke="rgba(191, 219, 254, 0.88)"
            strokeWidth="1.5"
          />
        </g>

        {/* 4 Edge-Aligned Precision Corner L-Brackets + Vertex Anchor Nodes */}
        {[
          { d: buildCornerBracket(tl, tr, bl), pt: tl },
          { d: buildCornerBracket(tr, tl, br), pt: tr },
          { d: buildCornerBracket(br, tr, bl), pt: br },
          { d: buildCornerBracket(bl, tl, br), pt: bl },
        ].map(({ d, pt }, idx) => (
          <g key={idx}>
            <path
              d={d}
              fill="none"
              stroke="#BFDBFE"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx={pt.x} cy={pt.y} r="3" fill="#93C5FD" stroke="#1E3A8A" strokeWidth="1" />
          </g>
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

      {/* Live Cropped Paper Thumbnail (Desktop / Tablet viewports when camera is active) */}
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

