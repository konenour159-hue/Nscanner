import React, { useState, useEffect } from 'react';
import {
  X,
  FileText,
  Download,
  Printer,
  Share2,
  FileArchive,
  Image as ImageIcon,
  Check,
  SearchCheck,
} from 'lucide-react';
import { ScannedDocument, ExportSettings } from '../types/scanner';
import { getAppSettings, recordExportEvent } from '../utils/storage';
import {
  generateDocumentPdf,
  generatePngZip,
  generateSinglePng,
  triggerDownload,
  GeneratedPdfResult,
} from '../utils/pdfGenerator';

interface ExportModalProps {
  document: ScannedDocument;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ document: doc, onClose }) => {
  const [format, setFormat] = useState<'pdf' | 'png_zip' | 'png_single'>('pdf');
  const [pageSize, setPageSize] = useState<'a4' | 'letter' | 'original'>(
    () => getAppSettings().defaultPageSize
  );
  const [orientation, setOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto');
  const [marginMm, setMarginMm] = useState<number>(0);
  const [quality, setQuality] = useState<'high' | 'medium' | 'low'>('high');
  const [includePageNumbers, setIncludePageNumbers] = useState<boolean>(false);
  const [searchablePdf, setSearchablePdf] = useState<boolean>(true);

  const [isGenerating, setIsGenerating] = useState(false);
  const [pdfResult, setPdfResult] = useState<GeneratedPdfResult | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  const hasOcrText = Boolean(
    doc.extractedText?.trim() || doc.pages.some((p) => p.extractedText?.trim())
  );

  useEffect(() => {
    let isCancelled = false;

    async function buildPdf() {
      if (format !== 'pdf') return;
      setIsGenerating(true);

      const settings: ExportSettings = {
        format: 'pdf',
        pageSize,
        orientation,
        marginMm,
        quality,
        includePageNumbers,
        searchablePdf,
        documentTitle: doc.title,
      };

      try {
        const result = await generateDocumentPdf(doc, settings);
        if (!isCancelled) {
          setPdfResult(result);
        }
      } catch (err) {
        console.error('Error generating PDF:', err);
      } finally {
        if (!isCancelled) setIsGenerating(false);
      }
    }

    buildPdf();
    return () => {
      isCancelled = true;
    };
  }, [doc, format, pageSize, orientation, marginMm, quality, includePageNumbers, searchablePdf]);

  useEffect(() => {
    return () => {
      if (pdfResult?.url) {
        URL.revokeObjectURL(pdfResult.url);
      }
    };
  }, [pdfResult]);

  async function handleDownload() {
    setIsGenerating(true);
    try {
      if (format === 'pdf' && pdfResult) {
        triggerDownload(pdfResult.url, pdfResult.filename);
        recordExportEvent({
          documentId: doc.id,
          documentTitle: doc.title,
          format: 'pdf',
          pageCount: doc.pages.length,
          sizeBytes: pdfResult.sizeBytes,
        });
      } else if (format === 'png_zip') {
        const zipResult = await generatePngZip(doc, doc.title, 'png');
        triggerDownload(zipResult.url, zipResult.filename);
        recordExportEvent({
          documentId: doc.id,
          documentTitle: doc.title,
          format: 'png_zip',
          pageCount: doc.pages.length,
          sizeBytes: zipResult.blob.size,
        });
      } else if (format === 'png_single' && doc.pages[0]) {
        const pngRes = await generateSinglePng(doc.pages[0], doc.title);
        triggerDownload(pngRes.url, pngRes.filename);
        recordExportEvent({
          documentId: doc.id,
          documentTitle: doc.title,
          format: 'png',
          pageCount: 1,
          sizeBytes: pngRes.blob.size,
        });
      }
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 2500);
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setIsGenerating(false);
    }
  }

  function handlePrint() {
    if (!pdfResult?.url) return;
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = pdfResult.url;
    document.body.appendChild(iframe);
    iframe.onload = () => {
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 1000);
    };
  }

  async function handleShare() {
    if (!pdfResult) return;
    if (navigator.share) {
      try {
        const file = new File([pdfResult.blob], pdfResult.filename, {
          type: 'application/pdf',
        });
        await navigator.share({
          title: doc.title,
          files: [file],
        });
      } catch {
        handleDownload();
      }
    } else {
      handleDownload();
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#1C1B22]/40 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 text-[#1C1B22] select-none">
      <div className="bg-white border border-[#E6E6EB] rounded-xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-lg overflow-hidden">
        {/* Top Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E6E6EB] bg-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#F5F3FF] text-[#7C3AED] flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#1C1B22]">Export &amp; Share Document</h2>
              <p className="text-xs text-[#666672]">
                {hasOcrText ? 'Searchable PDF text layer ready' : 'PDF and PNG export'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[#F5F3FF] text-[#666672] hover:text-[#1C1B22] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
          <div className="space-y-5">
            <div>
              <label className="block text-[11px] font-semibold text-[#666672] uppercase tracking-wider mb-2">
                Export Format
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setFormat('pdf')}
                  className={`flex flex-col items-start gap-1 p-2.5 rounded-lg border text-left transition-colors ${
                    format === 'pdf'
                      ? 'bg-[#F5F3FF] border-[#7C3AED] text-[#7C3AED]'
                      : 'bg-[#FAFAFC] border-[#E6E6EB] text-[#1C1B22] hover:border-[#7C3AED]/50'
                  }`}
                >
                  <FileText className="w-4 h-4 text-[#7C3AED]" />
                  <div className="text-xs font-bold">Single PDF</div>
                  <div className="text-[10px] text-[#666672]">Multi-page</div>
                </button>

                <button
                  onClick={() => setFormat('png_zip')}
                  className={`flex flex-col items-start gap-1 p-2.5 rounded-lg border text-left transition-colors ${
                    format === 'png_zip'
                      ? 'bg-[#F5F3FF] border-[#7C3AED] text-[#7C3AED]'
                      : 'bg-[#FAFAFC] border-[#E6E6EB] text-[#1C1B22] hover:border-[#7C3AED]/50'
                  }`}
                >
                  <FileArchive className="w-4 h-4 text-[#666672]" />
                  <div className="text-xs font-bold">PNG ZIP</div>
                  <div className="text-[10px] text-[#666672]">All pages</div>
                </button>

                <button
                  onClick={() => setFormat('png_single')}
                  className={`flex flex-col items-start gap-1 p-2.5 rounded-lg border text-left transition-colors ${
                    format === 'png_single'
                      ? 'bg-[#F5F3FF] border-[#7C3AED] text-[#7C3AED]'
                      : 'bg-[#FAFAFC] border-[#E6E6EB] text-[#1C1B22] hover:border-[#7C3AED]/50'
                  }`}
                >
                  <ImageIcon className="w-4 h-4 text-[#16A34A]" />
                  <div className="text-xs font-bold">Cover PNG</div>
                  <div className="text-[10px] text-[#666672]">Page 1 PNG</div>
                </button>
              </div>
            </div>

            {format === 'pdf' && (
              <>
                <div>
                  <label className="block text-[11px] font-semibold text-[#666672] uppercase tracking-wider mb-2">
                    Paper Size
                  </label>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {[
                      { id: 'a4', label: 'A4 Standard', desc: '210 × 297 mm' },
                      { id: 'letter', label: 'US Letter', desc: '8.5 × 11 in' },
                      { id: 'original', label: 'Auto-Fit', desc: 'Scan Ratio' },
                    ].map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setPageSize(p.id as 'a4' | 'letter' | 'original')}
                        className={`p-2.5 rounded-lg border text-center transition-colors ${
                          pageSize === p.id
                            ? 'bg-[#F5F3FF] border-[#7C3AED] text-[#7C3AED] font-semibold'
                            : 'bg-[#FAFAFC] border-[#E6E6EB] text-[#666672] hover:text-[#1C1B22]'
                        }`}
                      >
                        <div className="font-semibold">{p.label}</div>
                        <div className="text-[10px] text-[#8E8E9A] mt-0.5">{p.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#666672] uppercase tracking-wider mb-2">
                      Orientation
                    </label>
                    <select
                      value={orientation}
                      onChange={(e) => setOrientation(e.target.value as 'auto' | 'portrait' | 'landscape')}
                      className="w-full px-3 py-2 rounded-lg bg-[#FAFAFC] border border-[#E6E6EB] text-xs font-semibold text-[#1C1B22]"
                    >
                      <option value="auto">Auto Detect</option>
                      <option value="portrait">Portrait</option>
                      <option value="landscape">Landscape</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#666672] uppercase tracking-wider mb-2">
                      Margins
                    </label>
                    <select
                      value={marginMm}
                      onChange={(e) => setMarginMm(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg bg-[#FAFAFC] border border-[#E6E6EB] text-xs font-semibold text-[#1C1B22]"
                    >
                      <option value={0}>Borderless (0 mm)</option>
                      <option value={6}>Small (6 mm)</option>
                      <option value={12}>Standard (12 mm)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#666672] uppercase tracking-wider mb-2">
                    Compression &amp; Quality
                  </label>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {[
                      { id: 'high', label: 'High (300 DPI)', desc: 'Best print' },
                      { id: 'medium', label: 'Balanced', desc: 'Email ready' },
                      { id: 'low', label: 'Compact', desc: 'Min file size' },
                    ].map((q) => (
                      <button
                        key={q.id}
                        onClick={() => setQuality(q.id as 'high' | 'medium' | 'low')}
                        className={`p-2 rounded-lg border text-center transition-colors ${
                          quality === q.id
                            ? 'bg-[#F5F3FF] border-[#7C3AED] text-[#7C3AED] font-semibold'
                            : 'bg-[#FAFAFC] border-[#E6E6EB] text-[#666672] hover:text-[#1C1B22]'
                        }`}
                      >
                        <div className="font-semibold">{q.label}</div>
                        <div className="text-[10px] text-[#8E8E9A]">{q.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2 pt-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="searchablePdf"
                      checked={searchablePdf}
                      onChange={(e) => setSearchablePdf(e.target.checked)}
                      className="w-4 h-4 rounded accent-[#7C3AED] cursor-pointer"
                    />
                    <label htmlFor="searchablePdf" className="text-xs text-[#1C1B22] cursor-pointer flex items-center gap-1.5">
                      <SearchCheck className="w-3.5 h-3.5 text-[#7C3AED]" />
                      <span>Embed Searchable OCR Text Layer {hasOcrText ? '(Text ready)' : '(Run OCR in Editor first)'}</span>
                    </label>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="includePageNumbers"
                      checked={includePageNumbers}
                      onChange={(e) => setIncludePageNumbers(e.target.checked)}
                      className="w-4 h-4 rounded accent-[#7C3AED] cursor-pointer"
                    />
                    <label htmlFor="includePageNumbers" className="text-xs text-[#1C1B22] cursor-pointer">
                      Include page numbers in footer (Page 1 of {doc.pages.length})
                    </label>
                  </div>
                </div>
              </>
            )}

            <div className="p-3.5 rounded-lg bg-[#FAFAFC] border border-[#E6E6EB] text-xs space-y-1.5">
              <div className="flex justify-between text-[#666672]">
                <span>Document:</span>
                <span className="text-[#1C1B22] font-semibold truncate max-w-[210px]">{doc.title}</span>
              </div>
              <div className="flex justify-between text-[#666672]">
                <span>Pages:</span>
                <span className="text-[#1C1B22] font-mono tabular-nums">{doc.pages.length}</span>
              </div>
              {pdfResult && format === 'pdf' && (
                <div className="flex justify-between text-[#666672]">
                  <span>Estimated PDF Size:</span>
                  <span className="text-[#16A34A] font-mono font-semibold tabular-nums">
                    {formatBytes(pdfResult.sizeBytes)}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col bg-[#FAFAFC] rounded-lg border border-[#E6E6EB] p-4 overflow-hidden">
            <div className="flex items-center justify-between text-xs text-[#666672] mb-2">
              <span className="font-semibold text-[#1C1B22]">Preview</span>
              {isGenerating ? (
                <span className="text-[#7C3AED] text-[11px] font-medium">Compiling...</span>
              ) : (
                <span className="text-[#16A34A] text-[11px] font-semibold">Ready</span>
              )}
            </div>

            <div className="flex-1 bg-white rounded-lg border border-[#E6E6EB] flex items-center justify-center p-3 overflow-hidden min-h-[280px]">
              {format === 'pdf' && pdfResult?.url ? (
                <iframe
                  src={pdfResult.url}
                  title="PDF Preview"
                  className="w-full h-full rounded border-0 bg-white"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-center p-4">
                  <div className="grid grid-cols-2 gap-2 max-w-[200px] mb-3">
                    {doc.pages.slice(0, format === 'png_single' ? 1 : 4).map((p, idx) => (
                      <img
                        key={p.id}
                        src={p.thumbnailUrl || p.processedDataUrl}
                        alt={`Page ${idx + 1}`}
                        className="w-20 h-24 object-cover rounded border border-[#E6E6EB] bg-white"
                      />
                    ))}
                  </div>
                  <span className="text-xs text-[#666672] font-medium">
                    {format === 'png_single'
                      ? 'Lossless PNG export of Page 1 (with annotations)'
                      : `${doc.pages.length} PNG files packaged into a ZIP archive`}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#E6E6EB] bg-white gap-3">
          <div className="flex items-center gap-2">
            {format === 'pdf' && (
              <button
                onClick={handlePrint}
                disabled={!pdfResult || isGenerating}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#FAFAFC] hover:bg-[#F5F3FF] border border-[#E6E6EB] text-[#1C1B22] text-xs font-medium transition-colors"
              >
                <Printer className="w-4 h-4" />
                <span>Print</span>
              </button>
            )}

            <button
              onClick={handleShare}
              disabled={isGenerating}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#FAFAFC] hover:bg-[#F5F3FF] border border-[#E6E6EB] text-[#1C1B22] text-xs font-medium transition-colors"
            >
              <Share2 className="w-4 h-4" />
              <span>Share</span>
            </button>
          </div>

          <button
            onClick={handleDownload}
            disabled={isGenerating}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-xs transition-colors ${
              downloadSuccess
                ? 'bg-[#16A34A] text-white'
                : 'bg-[#7C3AED] hover:bg-[#6D28D9] active:bg-[#5B21B6] text-white'
            }`}
          >
            {downloadSuccess ? (
              <>
                <Check className="w-4 h-4" />
                <span>Downloaded</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>
                  Download {format === 'pdf' ? 'PDF File' : format === 'png_zip' ? 'PNG Archive' : 'PNG Image'}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
