import React, { useEffect, useRef, useState } from 'react';
import { QuadCorners } from '../types/scanner';
import { DetectedAreaResult } from '../utils/imageProcessing';
import { Check } from 'lucide-react';

interface RealtimeDocumentOverlayProps {
  detectedArea: DetectedAreaResult | null;
  modeAccentColor?: string;
  isTextDetected: boolean;
  videoElement?: HTMLVideoElement | null;
  autoCaptureProgress?: number; // 0 to 1 when locking steady
  autoCaptureEnabled?: boolean;
  onSmoothedCornersUpdate?: (corners: QuadCorners) => void;
}

export const RealtimeDocumentOverlay: React.FC<RealtimeDocumentOverlayProps> = ({
  detectedArea,
  isTextDetected: _isTextDetected,
  videoElement,
  autoCaptureProgress = 0,
  autoCaptureEnabled = true,
  onSmoothedCornersUpdate,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [boxSize, setBoxSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 });

  // Measure container in pixels so SVG L-brackets & strokes render crisp & unstretched
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

  const currentCornersRef = useRef<QuadCorners>({
    topLeft: { x: 0.12, y: 0.14 },
    topRight: { x: 0.88, y: 0.14 },
    bottomRight: { x: 0.88, y: 0.86 },
    bottomLeft: { x: 0.12, y: 0.86 },
  });

  const [smoothedCorners, setSmoothedCorners] = useState<QuadCorners>(
    currentCornersRef.current
  );
  const [dashOffset, setDashOffset] = useState<number>(0);
  const [scanProgress, setScanProgress] = useState<number>(0.2);
  const miniCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const targetCornersRef = useRef<QuadCorners>(
    detectedArea?.corners || currentCornersRef.current
  );

  useEffect(() => {
    if (detectedArea?.corners) {
      targetCornersRef.current = detectedArea.corners;
    }
  }, [detectedArea]);

  // 60 FPS Spring-Lerp Motion & Sweeping Laser Micro-Animations
  useEffect(() => {
    let animId: number;
    let offset = 0;
    let scanPos = 0;
    let scanDirection = 1;

    const lerp = (start: number, end: number, factor: number) => start + (end - start) * factor;

    const updateFrame = () => {
      const target = targetCornersRef.current;
      const current = currentCornersRef.current;
      const factor = 0.22;

      current.topLeft.x = lerp(current.topLeft.x, target.topLeft.x, factor);
      current.topLeft.y = lerp(current.topLeft.y, target.topLeft.y, factor);
      current.topRight.x = lerp(current.topRight.x, target.topRight.x, factor);
      current.topRight.y = lerp(current.topRight.y, target.topRight.y, factor);
      current.bottomRight.x = lerp(current.bottomRight.x, target.bottomRight.x, factor);
      current.bottomRight.y = lerp(current.bottomRight.y, target.bottomRight.y, factor);
      current.bottomLeft.x = lerp(current.bottomLeft.x, target.bottomLeft.x, factor);
      current.bottomLeft.y = lerp(current.bottomLeft.y, target.bottomLeft.y, factor);

      offset = (offset + 0.85) % 24;
      setDashOffset(offset);

      scanPos += 0.0075 * scanDirection;
      if (scanPos >= 1.0) {
        scanPos = 1.0;
        scanDirection = -1;
      } else if (scanPos <= 0.0) {
        scanPos = 0.0;
        scanDirection = 1;
      }
      setScanProgress(scanPos);

      const updated: QuadCorners = {
        topLeft: { ...current.topLeft },
        topRight: { ...current.topRight },
        bottomRight: { ...current.bottomRight },
        bottomLeft: { ...current.bottomLeft },
      };

      setSmoothedCorners(updated);
      if (onSmoothedCornersUpdate) {
        onSmoothedCornersUpdate(updated);
      }

      animId = requestAnimationFrame(updateFrame);
    };

    animId = requestAnimationFrame(updateFrame);
    return () => cancelAnimationFrame(animId);
  }, [onSmoothedCornersUpdate]);

  // Live Perspective-Rectified Mini Preview (~12 FPS using true affine triangle mesh)
  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let isCancelled = false;

    function renderLiveMiniDewarp() {
      if (!videoElement || videoElement.readyState < 2 || !miniCanvasRef.current) {
        if (!isCancelled) timerId = setTimeout(renderLiveMiniDewarp, 150);
        return;
      }

      const canvas = miniCanvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const vidW = videoElement.videoWidth || 640;
      const vidH = videoElement.videoHeight || 480;

      const corners = currentCornersRef.current;
      const p0 = { x: corners.topLeft.x * vidW, y: corners.topLeft.y * vidH };
      const p1 = { x: corners.topRight.x * vidW, y: corners.topRight.y * vidH };
      const p2 = { x: corners.bottomRight.x * vidW, y: corners.bottomRight.y * vidH };
      const p3 = { x: corners.bottomLeft.x * vidW, y: corners.bottomLeft.y * vidH };

      const targetW = canvas.width;
      const targetH = canvas.height;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetW, targetH);

      const cols = 4;
      const rows = 4;
      const interp = (u: number, v: number) => {
        const tx = p0.x + (p1.x - p0.x) * u;
        const ty = p0.y + (p1.y - p0.y) * u;
        const bx = p3.x + (p2.x - p3.x) * u;
        const by = p3.y + (p2.y - p3.y) * u;
        return { x: tx + (bx - tx) * v, y: ty + (by - ty) * v };
      };

      const drawTri = (
        s0: { x: number; y: number },
        s1: { x: number; y: number },
        s2: { x: number; y: number },
        d0: { x: number; y: number },
        d1: { x: number; y: number },
        d2: { x: number; y: number }
      ) => {
        const denom = s0.x * (s2.y - s1.y) - s1.x * s2.y + s2.x * s1.y + (s1.x - s2.x) * s0.y;
        if (Math.abs(denom) < 0.01) return;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(d0.x, d0.y);
        ctx.lineTo(d1.x, d1.y);
        ctx.lineTo(d2.x, d2.y);
        ctx.closePath();
        ctx.clip();

        const a = -(s0.y * (d2.x - d1.x) - s1.y * d2.x + s2.y * d1.x + (s1.y - s2.y) * d0.x) / denom;
        const b = (s1.y * d2.y + s0.y * (d1.y - d2.y) - s2.y * d1.y + (s2.y - s1.y) * d0.y) / denom;
        const c = (s0.x * (d2.x - d1.x) - s1.x * d2.x + s2.x * d1.x + (s1.x - s2.x) * d0.x) / denom;
        const d = -(s1.x * d2.y + s0.x * (d1.y - d2.y) - s2.x * d1.y + (s2.x - s1.x) * d0.y) / denom;
        const e = (s0.x * (s2.y * d1.x - s1.y * d2.x) + s0.y * (s1.x * d2.x - s2.x * d1.x) + (s1.y * s2.x - s1.x * s2.y) * d0.x) / denom;
        const f = (s0.x * (s2.y * d1.y - s1.y * d2.y) + s0.y * (s1.x * d2.y - s2.x * d1.y) + (s1.y * s2.x - s1.x * s2.y) * d0.y) / denom;

        ctx.transform(a, b, c, d, e, f);
        ctx.drawImage(videoElement, 0, 0);
        ctx.restore();
      };

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const u0 = c / cols;
          const v0 = r / rows;
          const u1 = (c + 1) / cols;
          const v1 = (r + 1) / rows;
          const sp0 = interp(u0, v0);
          const sp1 = interp(u1, v0);
          const sp2 = interp(u0, v1);
          const sp3 = interp(u1, v1);

          const dx0 = u0 * targetW;
          const dy0 = v0 * targetH;
          const dw = (u1 - u0) * targetW + 0.5;
          const dh = (v1 - v0) * targetH + 0.5;

          drawTri(sp0, sp1, sp2, { x: dx0, y: dy0 }, { x: dx0 + dw, y: dy0 }, { x: dx0, y: dy0 + dh });
          drawTri(sp1, sp3, sp2, { x: dx0 + dw, y: dy0 }, { x: dx0 + dw, y: dy0 + dh }, { x: dx0, y: dy0 + dh });
        }
      }

      if (!isCancelled) {
        timerId = setTimeout(renderLiveMiniDewarp, 95);
      }
    }

    timerId = setTimeout(renderLiveMiniDewarp, 200);
    return () => {
      isCancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [videoElement]);

  const { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl } = smoothedCorners;

  // Pixel coordinates inside container (crisp L-brackets & alignment)
  const p0 = { x: tl.x * boxSize.w, y: tl.y * boxSize.h };
  const p1 = { x: tr.x * boxSize.w, y: tr.y * boxSize.h };
  const p2 = { x: br.x * boxSize.w, y: br.y * boxSize.h };
  const p3 = { x: bl.x * boxSize.w, y: bl.y * boxSize.h };

  const polygonPoints = `${p0.x},${p0.y} ${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`;

  const scanP1 = {
    x: p0.x + (p3.x - p0.x) * scanProgress,
    y: p0.y + (p3.y - p0.y) * scanProgress,
  };
  const scanP2 = {
    x: p1.x + (p2.x - p1.x) * scanProgress,
    y: p1.y + (p2.y - p1.y) * scanProgress,
  };

  const prevProgress = Math.max(0, scanProgress - 0.08);
  const trailP1 = {
    x: p0.x + (p3.x - p0.x) * prevProgress,
    y: p0.y + (p3.y - p0.y) * prevProgress,
  };
  const trailP2 = {
    x: p1.x + (p2.x - p1.x) * prevProgress,
    y: p1.y + (p2.y - p1.y) * prevProgress,
  };
  const trailPoints = `${scanP1.x},${scanP1.y} ${scanP2.x},${scanP2.y} ${trailP2.x},${trailP2.y} ${trailP1.x},${trailP1.y}`;

  const gridH1 = {
    x1: (p0.x * 2 + p3.x) / 3,
    y1: (p0.y * 2 + p3.y) / 3,
    x2: (p1.x * 2 + p2.x) / 3,
    y2: (p1.y * 2 + p2.y) / 3,
  };
  const gridH2 = {
    x1: (p0.x + p3.x * 2) / 3,
    y1: (p0.y + p3.y * 2) / 3,
    x2: (p1.x + p2.x * 2) / 3,
    y2: (p1.y + p2.y * 2) / 3,
  };
  const gridV1 = {
    x1: (p0.x * 2 + p1.x) / 3,
    y1: (p0.y * 2 + p1.y) / 3,
    x2: (p3.x * 2 + p2.x) / 3,
    y2: (p3.y * 2 + p2.y) / 3,
  };
  const gridV2 = {
    x1: (p0.x + p1.x * 2) / 3,
    y1: (p0.y + p1.y * 2) / 3,
    x2: (p3.x + p2.x * 2) / 3,
    y2: (p3.y + p2.y * 2) / 3,
  };

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
      <svg
        width={boxSize.w}
        height={boxSize.h}
        viewBox={`0 0 ${boxSize.w} ${boxSize.h}`}
        className="w-full h-full absolute inset-0"
      >
        <defs>
          <mask id="smooth-camera-quad-mask">
            <rect width={boxSize.w} height={boxSize.h} fill="white" />
            <polygon points={polygonPoints} fill="black" />
          </mask>

          <filter id="laser-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Very Light Transparent Blue Document Projection Layer */}
          <linearGradient id="light-blue-doc-wash" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.16" />
            <stop offset="50%" stopColor="#60A5FA" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#2563EB" stopOpacity="0.14" />
          </linearGradient>

          <linearGradient id="laser-beam-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#60A5FA" stopOpacity="0.2" />
            <stop offset="50%" stopColor="#93C5FD" stopOpacity="1" />
            <stop offset="100%" stopColor="#60A5FA" stopOpacity="0.2" />
          </linearGradient>

          <linearGradient id="scan-trail-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Semi-transparent dark vignette outside quadrilateral */}
        <rect
          width={boxSize.w}
          height={boxSize.h}
          fill="rgba(0, 0, 0, 0.42)"
          mask="url(#smooth-camera-quad-mask)"
        />

        {/* VERY LIGHT TRANSPARENT BLUE DOCUMENT OVERLAY */}
        <polygon points={polygonPoints} fill="url(#light-blue-doc-wash)" />

        {/* 3D Perspective Rule-of-Thirds Grid */}
        {[gridH1, gridH2, gridV1, gridV2].map((g, idx) => (
          <line
            key={idx}
            x1={g.x1}
            y1={g.y1}
            x2={g.x2}
            y2={g.y2}
            stroke="#60A5FA"
            strokeWidth="1.2"
            strokeOpacity="0.35"
            strokeDasharray="4 4"
          />
        ))}

        {/* Sweeping Scanline Trail & Laser Beam */}
        <polygon points={trailPoints} fill="url(#scan-trail-grad)" />
        <line
          x1={scanP1.x}
          y1={scanP1.y}
          x2={scanP2.x}
          y2={scanP2.y}
          stroke="url(#laser-beam-grad)"
          strokeWidth="2.5"
          filter="url(#laser-glow)"
        />

        {/* Animated Marching Dash Quad Boundary */}
        <polygon
          points={polygonPoints}
          fill="none"
          stroke="#3B82F6"
          strokeWidth="2.5"
          strokeDasharray="14 7"
          strokeDashoffset={-dashOffset}
          filter="url(#laser-glow)"
        />

        <polygon
          points={polygonPoints}
          fill="none"
          stroke="#BFDBFE"
          strokeWidth="1"
          strokeOpacity="0.75"
        />

        {/* Detected Letter/Text Bands (Pulsing blue highlights) */}
        {detectedArea?.textBands &&
          detectedArea.textBands.map((band, idx) => {
            const bandLeft = p0.x + band.x * (p1.x - p0.x);
            const bandTop = p0.y + band.y * (p3.y - p0.y);
            const bandWidth = Math.max(8, band.width * (p1.x - p0.x));
            const bandHeight = Math.max(4, band.height * (p3.y - p0.y));
            const isNearScanline = Math.abs(band.y - scanProgress) < 0.12;

            return (
              <rect
                key={idx}
                x={bandLeft}
                y={bandTop}
                width={bandWidth}
                height={bandHeight}
                rx="3"
                fill={isNearScanline ? 'rgba(147, 197, 253, 0.45)' : 'rgba(59, 130, 246, 0.22)'}
                stroke={isNearScanline ? '#BFDBFE' : 'rgba(147, 197, 253, 0.6)'}
                strokeWidth={isNearScanline ? '1.5' : '1'}
              />
            );
          })}

        {/* 4 Crisp Pixel-Scaled Targeting Reticles & Micro L-Brackets */}
        {[
          { pt: p0, dx: 1, dy: 1 },
          { pt: p1, dx: -1, dy: 1 },
          { pt: p2, dx: -1, dy: -1 },
          { pt: p3, dx: 1, dy: -1 },
        ].map(({ pt, dx, dy }, idx) => (
          <g key={idx}>
            <circle
              cx={pt.x}
              cy={pt.y}
              r="13"
              fill="none"
              stroke="#60A5FA"
              strokeWidth="1.5"
              strokeOpacity="0.45"
            />
            <circle
              cx={pt.x}
              cy={pt.y}
              r="7.5"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="2"
            />
            <circle cx={pt.x} cy={pt.y} r="4" fill="#2563EB" />
            <path
              d={`M ${pt.x + dx * 18} ${pt.y} L ${pt.x} ${pt.y} L ${pt.x} ${pt.y + dy * 18}`}
              fill="none"
              stroke="#93C5FD"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </g>
        ))}
      </svg>

      {/* TOP FLOATING STATUS HUD: Auto-Projection Permanently Active + Auto-Capture Lock */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-blue-500/60 backdrop-blur-md flex items-center gap-2.5 text-xs shadow-2xl select-none">
        <span className="inline-flex rounded-full h-2 w-2 bg-blue-400" />
        <span className="font-semibold text-blue-200 tracking-wide text-[11px] whitespace-nowrap">
          AUTO-PROJECTION ON
        </span>
        <span className="text-[10px] text-slate-400 font-mono whitespace-nowrap">
          {detectedArea && detectedArea.skewAngleDeg > 0.4
            ? `Dewarp ${detectedArea.skewAngleDeg.toFixed(1)}°`
            : 'Aligned'}
        </span>
        {autoCaptureEnabled && autoCaptureProgress > 0.08 && (
          <span className="flex items-center gap-1 pl-2 border-l border-slate-700 text-[10px] font-mono text-emerald-300 whitespace-nowrap">
            <span>Hold steady</span>
            <span>{Math.round(autoCaptureProgress * 100)}%</span>
          </span>
        )}
      </div>

      {/* BOTTOM-RIGHT CORNER: Real-Time Live Perspective-Straightened Preview Mini HUD */}
      <div className="absolute bottom-24 right-4 z-20 hidden sm:flex flex-col items-center bg-slate-950/85 backdrop-blur-md p-1.5 rounded-xl border border-blue-500/40 shadow-2xl">
        <canvas
          ref={miniCanvasRef}
          width={100}
          height={135}
          className="rounded-lg border border-slate-700 bg-white shadow-inner"
        />
        <div className="text-[9px] font-mono text-blue-300 mt-1 flex items-center gap-1">
          <Check className="w-2.5 h-2.5 text-blue-400" />
          <span>Live Rectified Doc</span>
        </div>
      </div>
    </div>
  );
};
