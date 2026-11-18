import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Check, RotateCcw, Maximize2, ScanLine, Layers } from 'lucide-react';
import { QuadCorners } from '../types/scanner';
import { perspectiveCrop, detectDocumentAndTextCorners } from '../utils/imageProcessing';

interface CropPerspectiveModalProps {
  imageDataUrl: string;
  initialCorners?: QuadCorners;
  onApplyCrop: (newProcessedDataUrl: string, corners: QuadCorners) => void;
  onClose: () => void;
}

export const CropPerspectiveModal: React.FC<CropPerspectiveModalProps> = ({
  imageDataUrl,
  initialCorners,
  onApplyCrop,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activeCorner, setActiveCorner] = useState<keyof QuadCorners | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [naturalDimensions, setNaturalDimensions] = useState({ width: 800, height: 600 });
  const [displayedRect, setDisplayedRect] = useState({ left: 0, top: 0, width: 0, height: 0 });

  // Default corners
  const [corners, setCorners] = useState<QuadCorners>(
    initialCorners || {
      topLeft: { x: 0.08, y: 0.08 },
      topRight: { x: 0.92, y: 0.08 },
      bottomRight: { x: 0.92, y: 0.92 },
      bottomLeft: { x: 0.08, y: 0.92 },
    }
  );

  // Detected text line bands & projection info
  const [textBands, setTextBands] = useState<{ x: number; y: number; width: number; height: number }[]>([]);
  const [skewAngle, setSkewAngle] = useState<number>(0);
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [showTextOverlay, setShowTextOverlay] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Run smart text detection
  const runAutoDetect = useCallback(async () => {
    setIsDetecting(true);
    try {
      const result = await detectDocumentAndTextCorners(imageDataUrl);
      if (result) {
        setCorners(result.corners);
        setTextBands(result.textBands);
        setSkewAngle(result.skewAngleDeg);
      }
    } catch (err) {
      console.warn('Auto-detection error:', err);
    } finally {
      setIsDetecting(false);
    }
  }, [imageDataUrl]);

  // Initial detection if no custom corners passed
  useEffect(() => {
    if (!initialCorners) {
      runAutoDetect();
    }
  }, [initialCorners, runAutoDetect]);

  // Measure rendered image rect within container
  const updateImageRect = useCallback(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const contW = container.clientWidth;
    const contH = container.clientHeight;

    const imgAspect = naturalDimensions.width / naturalDimensions.height;
    const contAspect = contW / contH;

    let w = contW;
    let h = contH;

    if (imgAspect > contAspect) {
      w = contW;
      h = contW / imgAspect;
    } else {
      h = contH;
      w = contH * imgAspect;
    }

    const left = (contW - w) / 2;
    const top = (contH - h) / 2;

    setDisplayedRect({ left, top, width: w, height: h });
  }, [naturalDimensions]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setNaturalDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      setImageLoaded(true);
    };
    img.src = imageDataUrl;
  }, [imageDataUrl]);

  useEffect(() => {
    if (imageLoaded) {
      updateImageRect();
      window.addEventListener('resize', updateImageRect);
      return () => window.removeEventListener('resize', updateImageRect);
    }
  }, [imageLoaded, updateImageRect]);

  // Pointer drag handling for 4 corner handles
  function handlePointerDown(corner: keyof QuadCorners, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    setActiveCorner(corner);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!activeCorner || displayedRect.width === 0) return;
    const cont = containerRef.current;
    if (!cont) return;

    const contRect = cont.getBoundingClientRect();
    const clientX = e.clientX - contRect.left;
    const clientY = e.clientY - contRect.top;

    let normX = (clientX - displayedRect.left) / displayedRect.width;
    let normY = (clientY - displayedRect.top) / displayedRect.height;

    normX = Math.max(0, Math.min(1, normX));
    normY = Math.max(0, Math.min(1, normY));

    setCorners((prev) => ({
      ...prev,
      [activeCorner]: { x: normX, y: normY },
    }));
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (activeCorner) {
      setActiveCorner(null);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  }

  // Reset to full bounds
  function handleReset() {
    setCorners({
      topLeft: { x: 0.05, y: 0.05 },
      topRight: { x: 0.95, y: 0.05 },
      bottomRight: { x: 0.95, y: 0.95 },
      bottomLeft: { x: 0.05, y: 0.95 },
    });
  }

  // Apply perspective crop
  async function handleApply() {
    setIsProcessing(true);
    try {
      const croppedUrl = await perspectiveCrop(imageDataUrl, corners);
      onApplyCrop(croppedUrl, corners);
    } catch (err) {
      console.error('Failed to crop perspective', err);
    } finally {
      setIsProcessing(false);
    }
  }

  // Compute pixel positions for handles & polygon
  const p0 = {
    x: displayedRect.left + corners.topLeft.x * displayedRect.width,
    y: displayedRect.top + corners.topLeft.y * displayedRect.height,
  };
  const p1 = {
    x: displayedRect.left + corners.topRight.x * displayedRect.width,
    y: displayedRect.top + corners.topRight.y * displayedRect.height,
  };
  const p2 = {
    x: displayedRect.left + corners.bottomRight.x * displayedRect.width,
    y: displayedRect.top + corners.bottomRight.y * displayedRect.height,
  };
  const p3 = {
    x: displayedRect.left + corners.bottomLeft.x * displayedRect.width,
    y: displayedRect.top + corners.bottomLeft.y * displayedRect.height,
  };

  const polygonPoints = `${p0.x},${p0.y} ${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`;

  return (
    <div className="fixed inset-0 z-50 bg-[#1C1B22] flex flex-col select-none text-[#1C1B22]">
      {/* Top Header */}
      <div className="flex items-center justify-between px-5 py-3.5 bg-white border-b border-[#E6E6EB]">
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg text-[#666672] hover:text-[#1C1B22] hover:bg-[#F5F3FF] text-xs font-semibold transition-colors"
        >
          Cancel
        </button>

        <div className="text-center">
          <div className="text-sm font-bold text-[#1C1B22] flex items-center justify-center gap-2">
            <span>Paper Surface &amp; Perspective Crop</span>
            {skewAngle > 0 && (
              <span className="text-[11px] text-[#7C3AED] font-mono font-medium tabular-nums">
                Dewarp {skewAngle.toFixed(1)}°
              </span>
            )}
          </div>
          <div className="text-[11px] text-[#666672]">
            Drag paper corners to match sheet edges or click Auto-Detect
          </div>
        </div>

        <button
          onClick={handleApply}
          disabled={isProcessing}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] active:bg-[#5B21B6] text-white font-semibold text-xs transition-colors"
        >
          <Check className="w-4 h-4" />
          <span>{isProcessing ? 'Straightening...' : 'Straighten & Apply'}</span>
        </button>
      </div>

      {/* Main Interactive Canvas Area */}
      <div
        ref={containerRef}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="relative flex-1 bg-black/95 overflow-hidden flex items-center justify-center touch-none"
      >
        {imageLoaded && (
          <img
            src={imageDataUrl}
            alt="Source scan"
            className="absolute pointer-events-none"
            style={{
              left: `${displayedRect.left}px`,
              top: `${displayedRect.top}px`,
              width: `${displayedRect.width}px`,
              height: `${displayedRect.height}px`,
            }}
          />
        )}

        {/* SVG Overlay: Scrim, Perspective Quad, 3D Grid, and Text Line Highlights */}
        {displayedRect.width > 0 && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            <defs>
              <mask id="quad-mask">
                <rect width="100%" height="100%" fill="white" />
                <polygon points={polygonPoints} fill="black" />
              </mask>
            </defs>

            {/* Dark scrim outside quadrilateral */}
            <rect
              width="100%"
              height="100%"
              fill="rgba(0,0,0,0.65)"
              mask="url(#quad-mask)"
            />

            {/* Light translucent blue projection wash over full paper surface */}
            <polygon
              points={polygonPoints}
              fill="rgba(96, 165, 250, 0.14)"
              stroke="#60A5FA"
              strokeWidth="2"
            />

            {/* 3D Perspective Projection Grid */}
            <line
              x1={(p0.x * 2 + p3.x) / 3}
              y1={(p0.y * 2 + p3.y) / 3}
              x2={(p1.x * 2 + p2.x) / 3}
              y2={(p1.y * 2 + p2.y) / 3}
              stroke="#60A5FA"
              strokeWidth="1.5"
              strokeOpacity="0.4"
              strokeDasharray="3 3"
            />
            <line
              x1={(p0.x + p3.x * 2) / 3}
              y1={(p0.y + p3.y * 2) / 3}
              x2={(p1.x + p2.x * 2) / 3}
              y2={(p1.y + p2.y * 2) / 3}
              stroke="#60A5FA"
              strokeWidth="1.5"
              strokeOpacity="0.4"
              strokeDasharray="3 3"
            />
            <line
              x1={(p0.x * 2 + p1.x) / 3}
              y1={(p0.y * 2 + p1.y) / 3}
              x2={(p3.x * 2 + p2.x) / 3}
              y2={(p3.y * 2 + p2.y) / 3}
              stroke="#60A5FA"
              strokeWidth="1.5"
              strokeOpacity="0.4"
              strokeDasharray="3 3"
            />
            <line
              x1={(p0.x + p1.x * 2) / 3}
              y1={(p0.y + p1.y * 2) / 3}
              x2={(p3.x + p2.x * 2) / 3}
              y2={(p3.y + p2.y * 2) / 3}
              stroke="#60A5FA"
              strokeWidth="1.5"
              strokeOpacity="0.4"
              strokeDasharray="3 3"
            />

            {/* Recognized text region highlights */}
            {showTextOverlay &&
              textBands.map((band, idx) => {
                const rx = displayedRect.left + band.x * displayedRect.width;
                const ry = displayedRect.top + band.y * displayedRect.height;
                const rw = band.width * displayedRect.width;
                const rh = band.height * displayedRect.height;

                return (
                  <rect
                    key={idx}
                    x={rx}
                    y={ry}
                    width={rw}
                    height={rh}
                    rx="3"
                    fill="rgba(245, 158, 11, 0.2)"
                    stroke="rgba(245, 158, 11, 0.7)"
                    strokeWidth="1.2"
                  />
                );
              })}
          </svg>
        )}

        {/* 4 Interactive Corner Handles */}
        {displayedRect.width > 0 && (
          <>
            {(
              [
                { key: 'topLeft', pt: p0, label: 'Top-Left' },
                { key: 'topRight', pt: p1, label: 'Top-Right' },
                { key: 'bottomRight', pt: p2, label: 'Bottom-Right' },
                { key: 'bottomLeft', pt: p3, label: 'Bottom-Left' },
              ] as const
            ).map(({ key, pt }) => (
              <div
                key={key}
                onPointerDown={(e) => handlePointerDown(key, e)}
                style={{
                  left: `${pt.x}px`,
                  top: `${pt.y}px`,
                  transform: 'translate(-50%, -50%)',
                }}
                className={`absolute w-12 h-12 flex items-center justify-center cursor-move touch-none z-20 group`}
              >
                <div
                  className={`w-5 h-5 rounded-full border-[3px] border-[#7C3AED] bg-white shadow-lg flex items-center justify-center transition-all ${
                    activeCorner === key
                      ? 'scale-125 ring-4 ring-[#7C3AED]/30 bg-[#F5F3FF]'
                      : 'hover:scale-110'
                  }`}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]" />
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Bottom Actions toolbar */}
      <div className="flex flex-wrap items-center justify-between px-6 py-3.5 bg-white border-t border-[#E6E6EB] text-xs gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={runAutoDetect}
            disabled={isDetecting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F5F3FF] border border-[#DDD6FE] text-[#7C3AED] hover:bg-[#7C3AED] hover:text-white font-semibold transition-colors"
          >
            <ScanLine className="w-3.5 h-3.5" />
            <span>{isDetecting ? 'Detecting...' : 'Auto-Detect Text & Projection'}</span>
          </button>

          <button
            onClick={() => setShowTextOverlay(!showTextOverlay)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              showTextOverlay
                ? 'bg-[#F5F3FF] border-[#7C3AED] text-[#7C3AED]'
                : 'bg-[#FAFAFC] border-[#E6E6EB] text-[#666672] hover:text-[#1C1B22]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Text Boxes ({textBands.length})</span>
          </button>

          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FAFAFC] hover:bg-[#F5F3FF] border border-[#E6E6EB] text-[#1C1B22] font-medium transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Bounds</span>
          </button>
        </div>

        <div className="text-[11px] text-[#666672] flex items-center gap-1">
          <Maximize2 className="w-3.5 h-3.5 text-[#16A34A]" />
          <span>Perspective projection auto-straightens angled captures</span>
        </div>
      </div>
    </div>
  );
};
