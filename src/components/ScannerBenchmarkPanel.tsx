import React, { useState, useRef } from 'react';
import { Play, Upload, CheckCircle2, Loader2, Gauge } from 'lucide-react';
import {
  detectDocumentAndTextCorners,
  perspectiveCrop,
  processImage,
} from '../utils/imageProcessing';
import { generateDocumentPdf } from '../utils/pdfGenerator';
import { AdjustmentParams, ScannedDocument } from '../types/scanner';

interface BenchmarkResult {
  sourceLabel: string;
  resolution: string;
  edgeDetectAvgMs: number;
  trackingFps: number;
  paperCoveragePct: number;
  cropMs: number;
  magicColorMs: number;
  sauvolaBwMs: number;
  pdfBuildMs: number;
  pdfSizeKb: number;
  rawPreviewUrl: string;
  croppedRawUrl: string;
  magicUrl: string;
  bwUrl: string;
  detectedCorners: { x: number; y: number; width: number; height: number };
}

/**
 * Generates a realistic 1920x1080 test scene (dim indoor off-white sheet with a
 * diagonal hand shadow, coffee-table desk surround, fine print & colored stamp)
 * so real-time pipeline latency and shadow removal quality can be measured live.
 */
function buildRealisticShadowedSheetScene(): string {
  const w = 1920;
  const h = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Dark walnut desk surround
  ctx.fillStyle = '#382B22';
  ctx.fillRect(0, 0, w, h);

  // Subtle wood grain lines on desk
  ctx.strokeStyle = 'rgba(20, 12, 8, 0.25)';
  ctx.lineWidth = 3;
  for (let y = 0; y < h; y += 28) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(w * 0.35, y + 6, w * 0.7, y - 6, w, y);
    ctx.stroke();
  }

  // Physical A4 paper sheet (warm dim indoor tone)
  const px = 310;
  const py = 80;
  const pw = 1300;
  const ph = 920;

  ctx.fillStyle = '#E5DEC9';
  ctx.fillRect(px, py, pw, ph);

  // Document header & fine typography
  ctx.fillStyle = '#1E293B';
  ctx.font = 'bold 34px Georgia, serif';
  ctx.fillText('SERVICE AGREEMENT & INSPECTION REPORT', px + 72, py + 96);

  ctx.fillStyle = '#475569';
  ctx.font = '20px Inter, sans-serif';
  ctx.fillText('Reference: NS-2026-8841  |  Facility Audit  |  Page 1 of 2', px + 72, py + 138);

  ctx.strokeStyle = '#94A3B8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px + 72, py + 162);
  ctx.lineTo(px + pw - 72, py + 162);
  ctx.stroke();

  const lines = [
    '1. Scope of inspection covers hardware optics, real-time document paper boundary tracking,',
    '   illumination normalization across creases, and crisp archival ink legibility under uneven',
    '   ambient indoor lighting conditions.',
    '2. Automatic shadow flattening divides out low-frequency illumination variance while preserving',
    '   blue signatures, ink stamps, and thin printed serif characters without halo artifacts.',
    '3. Searchable PDF export maintains compact JPEG encoding aligned to A4 300-DPI fidelity.',
  ];
  ctx.fillStyle = '#1F2937';
  ctx.font = '22px Georgia, serif';
  lines.forEach((line, idx) => {
    ctx.fillText(line, px + 72, py + 220 + idx * 44);
  });

  // Colored blue company stamp + handwritten signature
  ctx.save();
  ctx.translate(px + 960, py + 660);
  ctx.rotate(-0.07);
  ctx.strokeStyle = '#1D4ED8';
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, 220, 74);
  ctx.fillStyle = '#1D4ED8';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText('VERIFIED', 42, 46);
  ctx.restore();

  // Heavy diagonal hand/phone shadow across upper-right and middle of the paper
  const grad = ctx.createLinearGradient(px + pw * 0.25, py, px + pw, py + ph * 0.85);
  grad.addColorStop(0, 'rgba(15, 23, 42, 0)');
  grad.addColorStop(0.45, 'rgba(15, 23, 42, 0.44)');
  grad.addColorStop(1, 'rgba(15, 23, 42, 0.22)');
  ctx.fillStyle = grad;
  ctx.fillRect(px, py, pw, ph);

  return canvas.toDataURL('image/jpeg', 0.9);
}

export const ScannerBenchmarkPanel: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function executeBenchmark(inputDataUrl: string, label: string) {
    setIsRunning(true);
    setErrorMsg(null);
    try {
      // Yield frame so spinner updates immediately
      await new Promise((r) => setTimeout(r, 20));

      // Load image dimensions
      const probeImg = new Image();
      await new Promise<void>((resolve, reject) => {
        probeImg.onload = () => resolve();
        probeImg.onerror = () => reject(new Error('Could not decode test image'));
        probeImg.src = inputDataUrl;
      });
      const resLabel = `${probeImg.naturalWidth}×${probeImg.naturalHeight}`;

      // Pre-render into canvas for realistic zero-decode live video frame timing
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = probeImg.naturalWidth;
      frameCanvas.height = probeImg.naturalHeight;
      const fCtx = frameCanvas.getContext('2d');
      if (fCtx) fCtx.drawImage(probeImg, 0, 0);

      // 1. Live Edge Detection (10 consecutive frames like live camera viewfinder)
      const detectTimes: number[] = [];
      let lastDetect = await detectDocumentAndTextCorners(frameCanvas);
      for (let i = 0; i < 10; i++) {
        const t0 = performance.now();
        lastDetect = await detectDocumentAndTextCorners(frameCanvas);
        detectTimes.push(performance.now() - t0);
      }
      const edgeDetectAvgMs =
        detectTimes.reduce((a, b) => a + b, 0) / detectTimes.length;
      const trackingFps = Math.min(60, Math.round(1000 / Math.max(4, edgeDetectAvgMs)));

      // 2. Orthogonal Paper Surface Crop
      const tCrop0 = performance.now();
      const croppedRawUrl = await perspectiveCrop(inputDataUrl, lastDetect.corners);
      const cropMs = performance.now() - tCrop0;

      // 3. Magic Color (Illumination Normalization + Paper Whitening + Clarity)
      const strongAdj: AdjustmentParams = {
        brightness: 4,
        contrast: 20,
        sharpness: 42,
        warmth: 0,
        saturation: 10,
        shadowRemoval: true,
        shadowStrength: 95,
      };
      const tMagic0 = performance.now();
      const magicUrl = await processImage(croppedRawUrl, 'magic', strongAdj, 0);
      const magicColorMs = performance.now() - tMagic0;

      // 4. Sauvola Adaptive B&W
      const tBw0 = performance.now();
      const bwUrl = await processImage(croppedRawUrl, 'bw', strongAdj, 0);
      const sauvolaBwMs = performance.now() - tBw0;

      // 5. PDF Compilation Benchmark
      const benchDoc: ScannedDocument = {
        id: 'bench_doc',
        title: 'Benchmark Scan',
        folderId: 'f_inbox',
        scanMode: 'document',
        pages: [
          {
            id: 'bp_1',
            originalDataUrl: croppedRawUrl,
            processedDataUrl: magicUrl,
            thumbnailUrl: magicUrl,
            pageNumber: 1,
            rotation: 0,
            filter: 'magic',
            adjustments: strongAdj,
            createdAt: Date.now(),
          },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tags: [],
      };
      const tPdf0 = performance.now();
      const pdfRes = await generateDocumentPdf(benchDoc, {
        format: 'pdf',
        pageSize: 'a4',
        orientation: 'auto',
        quality: 'medium',
        marginMm: 0,
        includePageNumbers: false,
        searchablePdf: false,
        documentTitle: 'Benchmark Scan',
      });
      const pdfBuildMs = performance.now() - tPdf0;
      const pdfSizeKb = Math.round(pdfRes.sizeBytes / 1024);
      URL.revokeObjectURL(pdfRes.url);

      const surf = lastDetect.documentSurface;
      const paperCoveragePct = Math.round(surf.width * surf.height * 100);

      setResult({
        sourceLabel: label,
        resolution: resLabel,
        edgeDetectAvgMs: Number(edgeDetectAvgMs.toFixed(1)),
        trackingFps,
        paperCoveragePct,
        cropMs: Number(cropMs.toFixed(1)),
        magicColorMs: Number(magicColorMs.toFixed(0)),
        sauvolaBwMs: Number(sauvolaBwMs.toFixed(0)),
        pdfBuildMs: Number(pdfBuildMs.toFixed(0)),
        pdfSizeKb,
        rawPreviewUrl: inputDataUrl,
        croppedRawUrl,
        magicUrl,
        bwUrl,
        detectedCorners: surf,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Benchmark failed');
    } finally {
      setIsRunning(false);
    }
  }

  async function handleRunSynthetic1080p() {
    const dataUrl = buildRealisticShadowedSheetScene();
    await executeBenchmark(dataUrl, 'Shadowed 1080p Sheet on Desk');
  }

  async function handleUploadCustomPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
    await executeBenchmark(dataUrl, file.name);
    e.target.value = '';
  }

  return (
    <section className="bg-white border border-[#E6E6EB] rounded-lg p-5 space-y-4 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Gauge className="w-4 h-4 text-[#7C3AED] shrink-0 mt-0.5" />
          <div>
            <h2 className="text-sm font-bold text-[#1C1B22]">
              Real-Time Scanner Benchmark
            </h2>
            <p className="text-[11px] text-[#666672] mt-0.5">
              Measure live edge-lock speed, orthogonal paper cropping, shadow flattening, Sauvola B&amp;W, and PDF speed directly on your device.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleUploadCustomPhoto}
            className="hidden"
          />
          <button
            type="button"
            disabled={isRunning}
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#FAFAFC] hover:bg-[#F5F3FF] border border-[#E6E6EB] hover:border-[#7C3AED] text-[#1C1B22] font-medium inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5 text-[#7C3AED]" />
            <span>Test With Your Photo</span>
          </button>

          <button
            type="button"
            disabled={isRunning}
            onClick={handleRunSynthetic1080p}
            className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            {isRunning ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Running Live Test...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>Run Real-Time Test</span>
              </>
            )}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg bg-[#FFF5F5] border border-[#FECACA] text-[#DC2626] text-xs">
          {errorMsg}
        </div>
      )}

      {result && (
        <div className="space-y-4 pt-2 border-t border-[#E6E6EB]">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#666672]">
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#16A34A]">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Measured Live · {result.sourceLabel} ({result.resolution})</span>
            </span>
            <span className="font-mono tabular-nums">
              Paper Locked Area: {result.paperCoveragePct}% of frame
            </span>
          </div>

          {/* Real Measured Latency Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            <div className="bg-[#FAFAFC] border border-[#E6E6EB] rounded-lg p-2.5">
              <div className="text-[10px] text-[#666672]">Edge Tracking</div>
              <div className="text-sm font-bold text-[#1C1B22] font-mono tabular-nums mt-0.5">
                {result.edgeDetectAvgMs} ms
              </div>
              <div className="text-[10px] text-[#7C3AED] font-medium tabular-nums">
                Up to {result.trackingFps} FPS
              </div>
            </div>

            <div className="bg-[#FAFAFC] border border-[#E6E6EB] rounded-lg p-2.5">
              <div className="text-[10px] text-[#666672]">Paper Crop</div>
              <div className="text-sm font-bold text-[#1C1B22] font-mono tabular-nums mt-0.5">
                {result.cropMs} ms
              </div>
              <div className="text-[10px] text-[#666672]">Orthogonal GPU</div>
            </div>

            <div className="bg-[#FAFAFC] border border-[#E6E6EB] rounded-lg p-2.5">
              <div className="text-[10px] text-[#666672]">Magic Color</div>
              <div className="text-sm font-bold text-[#1C1B22] font-mono tabular-nums mt-0.5">
                {result.magicColorMs} ms
              </div>
              <div className="text-[10px] text-[#666672]">Shadow + Clarity</div>
            </div>

            <div className="bg-[#FAFAFC] border border-[#E6E6EB] rounded-lg p-2.5">
              <div className="text-[10px] text-[#666672]">Sauvola B&amp;W</div>
              <div className="text-sm font-bold text-[#1C1B22] font-mono tabular-nums mt-0.5">
                {result.sauvolaBwMs} ms
              </div>
              <div className="text-[10px] text-[#666672]">Adaptive Ink</div>
            </div>

            <div className="bg-[#FAFAFC] border border-[#E6E6EB] rounded-lg p-2.5">
              <div className="text-[10px] text-[#666672]">A4 PDF Export</div>
              <div className="text-sm font-bold text-[#1C1B22] font-mono tabular-nums mt-0.5">
                {result.pdfBuildMs} ms
              </div>
              <div className="text-[10px] text-[#666672] tabular-nums">{result.pdfSizeKb} KB output</div>
            </div>
          </div>

          {/* Visual Side-by-Side Comparison */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-[#666672]">
                1. Raw Input &amp; Locked Paper Box
              </div>
              <div className="relative rounded-lg border border-[#E6E6EB] overflow-hidden bg-slate-900 aspect-video flex items-center justify-center">
                <img
                  src={result.rawPreviewUrl}
                  alt="Raw input"
                  className="w-full h-full object-contain"
                />
                {/* Show actual normalized paper lock rectangle */}
                <div
                  style={{
                    left: `${result.detectedCorners.x * 100}%`,
                    top: `${result.detectedCorners.y * 100}%`,
                    width: `${result.detectedCorners.width * 100}%`,
                    height: `${result.detectedCorners.height * 100}%`,
                  }}
                  className="absolute border-2 border-blue-400 bg-blue-400/15 pointer-events-none"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-[#7C3AED]">
                2. NScanner Magic Color
              </div>
              <div className="rounded-lg border border-[#DDD6FE] overflow-hidden bg-white aspect-video flex items-center justify-center">
                <img
                  src={result.magicUrl}
                  alt="Magic Color result"
                  className="w-full h-full object-contain"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-[#1C1B22]">
                3. Sauvola Adaptive B&amp;W
              </div>
              <div className="rounded-lg border border-[#E6E6EB] overflow-hidden bg-white aspect-video flex items-center justify-center">
                <img
                  src={result.bwUrl}
                  alt="Sauvola B&W result"
                  className="w-full h-full object-contain"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
