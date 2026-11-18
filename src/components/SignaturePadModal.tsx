import React, { useRef, useState, useEffect } from 'react';
import { X, PenTool, Trash2, Check, RotateCcw } from 'lucide-react';
import { SavedSignature } from '../types/scanner';
import { getSavedSignatures, saveSignature, deleteSignature } from '../utils/storage';

interface SignaturePadModalProps {
  onSelectSignature: (dataUrl: string) => void;
  onClose: () => void;
}

export const SignaturePadModal: React.FC<SignaturePadModalProps> = ({
  onSelectSignature,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [inkColor, setInkColor] = useState<string>('#1E3A8A');
  const [strokeSize, setStrokeSize] = useState<number>(3.5);
  const [savedList, setSavedList] = useState<SavedSignature[]>([]);

  useEffect(() => {
    setSavedList(getSavedSignatures());
  }, []);

  function getPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.setPointerCapture(e.pointerId);
    const pt = getPoint(e);
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = strokeSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    setIsDrawing(true);
    setHasStrokes(true);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pt = getPoint(e);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  }

  function handlePointerUp() {
    setIsDrawing(false);
  }

  function handleClear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStrokes(false);
  }

  function trimSignatureCanvas(canvas: HTMLCanvasElement): string {
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas.toDataURL('image/png');
    const { width, height } = canvas;
    const imgData = ctx.getImageData(0, 0, width, height).data;

    let minX = width, minY = height, maxX = 0, maxY = 0;
    let found = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const alpha = imgData[(y * width + x) * 4 + 3];
        if (alpha > 10) {
          found = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (!found) return canvas.toDataURL('image/png');
    const pad = 16;
    const sx = Math.max(0, minX - pad);
    const sy = Math.max(0, minY - pad);
    const sw = Math.min(width - sx, maxX - minX + pad * 2);
    const sh = Math.min(height - sy, maxY - minY + pad * 2);

    const out = document.createElement('canvas');
    out.width = Math.max(100, sw);
    out.height = Math.max(40, sh);
    const outCtx = out.getContext('2d');
    if (outCtx) {
      outCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
    }
    return out.toDataURL('image/png');
  }

  function handleSaveAndUse() {
    const canvas = canvasRef.current;
    if (!canvas || !hasStrokes) return;
    const dataUrl = trimSignatureCanvas(canvas);
    const newSig: SavedSignature = {
      id: 'sig_' + Date.now(),
      name: `Signature ${savedList.length + 1}`,
      dataUrl,
      createdAt: Date.now(),
    };
    setSavedList(saveSignature(newSig));
    onSelectSignature(dataUrl);
  }

  function handleDeleteSaved(id: string) {
    setSavedList(deleteSignature(id));
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#1C1B22]/45 backdrop-blur-xs flex items-center justify-center p-4 text-[#1C1B22] select-none">
      <div className="bg-white border border-[#E6E6EB] rounded-xl w-full max-w-xl shadow-lg overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E6E6EB]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#F5F3FF] text-[#7C3AED] flex items-center justify-center">
              <PenTool className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#1C1B22]">Signature Pad</h3>
              <p className="text-[11px] text-[#666672]">Draw once and reuse on any scanned page</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[#F5F3FF] text-[#666672]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-[#666672]">Ink:</span>
              {[
                { color: '#1E3A8A', label: 'Royal Blue' },
                { color: '#1C1B22', label: 'Black Ink' },
                { color: '#7C3AED', label: 'Violet' },
              ].map((c) => (
                <button
                  key={c.color}
                  onClick={() => setInkColor(c.color)}
                  title={c.label}
                  className={`w-6 h-6 rounded-full border-2 transition-transform ${
                    inkColor === c.color ? 'border-[#7C3AED] scale-110 ring-2 ring-[#F5F3FF]' : 'border-white'
                  }`}
                  style={{ backgroundColor: c.color }}
                />
              ))}
            </div>

            <div className="flex items-center gap-2 text-xs text-[#666672]">
              <span>Tip:</span>
              {[2.5, 4, 6].map((sz) => (
                <button
                  key={sz}
                  onClick={() => setStrokeSize(sz)}
                  className={`px-2 py-0.5 rounded border text-[11px] font-mono ${
                    strokeSize === sz
                      ? 'bg-[#F5F3FF] border-[#7C3AED] text-[#7C3AED] font-semibold'
                      : 'bg-[#FAFAFC] border-[#E6E6EB] text-[#666672]'
                  }`}
                >
                  {sz === 2.5 ? 'Fine' : sz === 4 ? 'Med' : 'Bold'}
                </button>
              ))}
            </div>
          </div>

          <div className="relative rounded-xl border-2 border-dashed border-[#D3D3DC] bg-[#FAFAFC] overflow-hidden">
            <canvas
              ref={canvasRef}
              width={640}
              height={220}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="w-full h-44 touch-none cursor-crosshair block"
            />
            {!hasStrokes && (
              <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center text-[#8E8E9A] text-xs">
                <span>Sign above the baseline</span>
                <div className="w-3/4 border-b border-[#E6E6EB] mt-8" />
              </div>
            )}
          </div>

          {savedList.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-semibold text-[#666672] uppercase tracking-wider">
                Saved Signatures
              </div>
              <div className="grid grid-cols-3 gap-2">
                {savedList.map((sig) => (
                  <div
                    key={sig.id}
                    className="group relative bg-[#FAFAFC] border border-[#E6E6EB] hover:border-[#7C3AED] rounded-lg p-2 cursor-pointer flex items-center justify-center h-16 transition-colors"
                    onClick={() => onSelectSignature(sig.dataUrl)}
                  >
                    <img src={sig.dataUrl} alt={sig.name} className="max-h-full max-w-full object-contain" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSaved(sig.id);
                      }}
                      className="absolute top-1 right-1 p-1 rounded bg-white text-[#8E8E9A] hover:text-[#DC2626] opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete saved signature"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3.5 border-t border-[#E6E6EB] bg-[#FAFAFC]">
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#E6E6EB] hover:bg-[#F5F3FF] text-[#666672] hover:text-[#1C1B22] text-xs font-medium"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>

          <button
            onClick={handleSaveAndUse}
            disabled={!hasStrokes}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-40 text-white text-xs font-semibold"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Insert Signature</span>
          </button>
        </div>
      </div>
    </div>
  );
};
