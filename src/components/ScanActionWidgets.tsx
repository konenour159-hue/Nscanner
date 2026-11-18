import React, { useEffect, useRef, useState } from 'react';
import { Plus, X, CreditCard, Receipt, BookOpen, Layers } from 'lucide-react';
import { ScanMode } from '../types/scanner';

interface ScanTilesWidgetProps {
  onStartScan: (mode?: ScanMode) => void;
  onImportGalleryImages: (files: File[]) => Promise<void>;
  onImportPdfFile: (file: File) => Promise<void>;
  onAfterAction?: () => void;
  compact?: boolean;
}

export const ScanTilesWidget: React.FC<ScanTilesWidgetProps> = ({
  onStartScan,
  onImportGalleryImages,
  onImportPdfFile,
  onAfterAction,
  compact = false,
}) => {
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const fileImportRef = useRef<HTMLInputElement | null>(null);
  const [busyAction, setBusyAction] = useState<'gallery' | 'file' | null>(null);

  async function handleGallerySelect(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setBusyAction('gallery');
    try {
      await onImportGalleryImages(files);
      onAfterAction?.();
    } finally {
      setBusyAction(null);
      e.target.value = '';
    }
  }

  async function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setBusyAction('file');
    try {
      const pdfFile = files.find(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      );
      if (pdfFile) {
        await onImportPdfFile(pdfFile);
      } else {
        const images = files.filter((f) => f.type.startsWith('image/'));
        if (images.length > 0) {
          await onImportGalleryImages(images);
        }
      }
      onAfterAction?.();
    } finally {
      setBusyAction(null);
      e.target.value = '';
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-[#1C1B22] tracking-tight">Scan</h3>
        {!compact && (
          <span className="text-[11px] text-[#666672]">
            Camera capture, photo gallery, or PDF files
          </span>
        )}
      </div>

      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleGallerySelect}
        className="hidden"
      />
      <input
        ref={fileImportRef}
        type="file"
        accept="application/pdf,image/*"
        multiple
        onChange={handleFileImport}
        className="hidden"
      />

      <div className="grid grid-cols-3 gap-2.5 sm:gap-3.5">
        {/* Tile 1: Scan Doc */}
        <button
          type="button"
          onClick={() => {
            onStartScan();
            onAfterAction?.();
          }}
          className="group min-h-[108px] sm:min-h-[120px] rounded-2xl bg-[#FAFAFC] hover:bg-[#F5F3FF] border border-[#E6E6EB] hover:border-[#7C3AED] px-2.5 py-4 flex flex-col items-center justify-center gap-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-[#7C3AED] cursor-pointer"
        >
          {/* Custom Duotone Scan Doc Icon */}
          <svg
            viewBox="0 0 36 36"
            className="w-8 h-8 shrink-0 transition-transform group-hover:scale-105"
            fill="none"
            aria-hidden="true"
          >
            {/* Outer viewfinder corner brackets */}
            <path
              d="M5 11V7a2 2 0 0 1 2-2h4M25 5h4a2 2 0 0 1 2 2v4M31 25v4a2 2 0 0 1-2 2h-4M11 31H7a2 2 0 0 1-2-2v-4"
              stroke="#1C1B22"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            {/* Inner document silhouette & scan bar in Violet */}
            <path
              d="M12 10.5h8.2L24 14.3V25.5a1 1 0 0 1-1 1H12a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z"
              stroke="#7C3AED"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path
              d="M19.5 10.5V14.5H23.5"
              stroke="#7C3AED"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <line
              x1="9"
              y1="20"
              x2="27"
              y2="20"
              stroke="#7C3AED"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>

          <div className="text-center space-y-0.5">
            <div className="text-xs font-semibold text-[#1C1B22] group-hover:text-[#7C3AED] transition-colors">
              Scan Doc
            </div>
            {!compact && (
              <div className="hidden sm:block text-[11px] text-[#666672]">
                Auto-crop camera
              </div>
            )}
          </div>
        </button>

        {/* Tile 2: Gallery */}
        <button
          type="button"
          disabled={busyAction !== null}
          onClick={() => galleryInputRef.current?.click()}
          className="group min-h-[108px] sm:min-h-[120px] rounded-2xl bg-[#FAFAFC] hover:bg-[#F5F3FF] border border-[#E6E6EB] hover:border-[#7C3AED] px-2.5 py-4 flex flex-col items-center justify-center gap-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-[#7C3AED] disabled:opacity-60 cursor-pointer"
        >
          {/* Custom Duotone Gallery Icon */}
          <svg
            viewBox="0 0 36 36"
            className="w-8 h-8 shrink-0 transition-transform group-hover:scale-105"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="5"
              y="7.5"
              width="26"
              height="21"
              rx="2.5"
              stroke="#1C1B22"
              strokeWidth="2.2"
            />
            <circle cx="12" cy="13.5" r="2" fill="#7C3AED" />
            <path
              d="M7 25.5l6.8-6.8a1 1 0 0 1 1.4 0l3.6 3.6 3.5-3.9a1 1 0 0 1 1.5 0L29 24.5"
              stroke="#7C3AED"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>

          <div className="text-center space-y-0.5">
            <div className="text-xs font-semibold text-[#1C1B22] group-hover:text-[#7C3AED] transition-colors">
              {busyAction === 'gallery' ? 'Loading...' : 'Gallery'}
            </div>
            {!compact && (
              <div className="hidden sm:block text-[11px] text-[#666672]">
                Import photos
              </div>
            )}
          </div>
        </button>

        {/* Tile 3: Import File */}
        <button
          type="button"
          disabled={busyAction !== null}
          onClick={() => fileImportRef.current?.click()}
          className="group min-h-[108px] sm:min-h-[120px] rounded-2xl bg-[#FAFAFC] hover:bg-[#F5F3FF] border border-[#E6E6EB] hover:border-[#7C3AED] px-2.5 py-4 flex flex-col items-center justify-center gap-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-[#7C3AED] disabled:opacity-60 cursor-pointer"
        >
          {/* Custom Duotone Import File Icon */}
          <svg
            viewBox="0 0 36 36"
            className="w-8 h-8 shrink-0 transition-transform group-hover:scale-105"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M19 8h8a2.5 2.5 0 0 1 2.5 2.5v16A2.5 2.5 0 0 1 27 29H11a2.5 2.5 0 0 1-2.5-2.5v-8"
              stroke="#1C1B22"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M7 7l10.5 10.5M17.5 10.5v7h-7"
              stroke="#7C3AED"
              strokeWidth="2.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>

          <div className="text-center space-y-0.5">
            <div className="text-xs font-semibold text-[#1C1B22] group-hover:text-[#7C3AED] transition-colors">
              {busyAction === 'file' ? 'Importing...' : 'Import File'}
            </div>
            {!compact && (
              <div className="hidden sm:block text-[11px] text-[#666672]">
                PDF &amp; files
              </div>
            )}
          </div>
        </button>
      </div>
    </div>
  );
};

interface QuickActionFabProps {
  contained?: boolean;
  onStartScan: (mode?: ScanMode) => void;
  onImportGalleryImages: (files: File[]) => Promise<void>;
  onImportPdfFile: (file: File) => Promise<void>;
  onOpenPdfWorkspace: () => void;
}

export const QuickActionFabSheet: React.FC<QuickActionFabProps> = ({
  contained = false,
  onStartScan,
  onImportGalleryImages,
  onImportPdfFile,
  onOpenPdfWorkspace,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  return (
    <>
      {/* Circular Violet '+' Floating Action Button */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-label={isOpen ? 'Close quick actions' : 'New scan or import'}
        aria-expanded={isOpen}
        className={`${
          contained
            ? 'absolute bottom-20 right-4 z-30'
            : 'fixed bottom-20 right-4 lg:bottom-7 lg:right-7 z-30'
        } w-14 h-14 rounded-full bg-[#7C3AED] hover:bg-[#6D28D9] active:scale-95 text-white shadow-[0_8px_22px_rgba(124,58,237,0.34)] flex items-center justify-center transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7C3AED] cursor-pointer`}
      >
        <Plus
          className={`w-6 h-6 stroke-[2.5] transition-transform duration-200 ${
            isOpen ? 'rotate-45' : 'rotate-0'
          }`}
        />
      </button>

      {/* Quick Actions Sheet */}
      {isOpen && (
        <div
          className={`${
            contained ? 'absolute inset-0 z-40' : 'fixed inset-0 z-50'
          } flex items-end sm:items-center justify-center p-0 sm:p-4`}
        >
          <div
            onClick={() => setIsOpen(false)}
            className="absolute inset-0 bg-[#1C1B22]/35 backdrop-blur-[1px]"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Quick scan and import actions"
            className="relative w-full sm:max-w-md bg-white border-t sm:border border-[#E6E6EB] rounded-t-3xl sm:rounded-2xl p-5 pb-safe shadow-2xl space-y-5"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-[#1C1B22]">Create or Import</h2>
                <p className="text-[11px] text-[#666672] mt-0.5">
                  Choose how to add a document to NScanner
                </p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                aria-label="Close quick actions"
                className="w-9 h-9 rounded-lg flex items-center justify-center text-[#666672] hover:text-[#1C1B22] hover:bg-[#FAFAFC]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <ScanTilesWidget
              compact={true}
              onStartScan={onStartScan}
              onImportGalleryImages={onImportGalleryImages}
              onImportPdfFile={onImportPdfFile}
              onAfterAction={() => setIsOpen(false)}
            />

            <div className="pt-3 border-t border-[#E6E6EB] space-y-2">
              <div className="text-[11px] font-semibold text-[#666672]">
                Specialized capture &amp; PDF tools
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  onClick={() => {
                    onStartScan('id_card');
                    setIsOpen(false);
                  }}
                  className="min-h-[40px] px-3 py-2 rounded-lg bg-[#FAFAFC] hover:bg-[#F5F3FF] border border-[#E6E6EB] hover:border-[#DDD6FE] text-[#1C1B22] hover:text-[#7C3AED] font-medium flex items-center gap-2 transition-colors"
                >
                  <CreditCard className="w-3.5 h-3.5 text-[#7C3AED]" />
                  <span>ID Card (2-Sided)</span>
                </button>
                <button
                  onClick={() => {
                    onStartScan('receipt');
                    setIsOpen(false);
                  }}
                  className="min-h-[40px] px-3 py-2 rounded-lg bg-[#FAFAFC] hover:bg-[#F5F3FF] border border-[#E6E6EB] hover:border-[#DDD6FE] text-[#1C1B22] hover:text-[#7C3AED] font-medium flex items-center gap-2 transition-colors"
                >
                  <Receipt className="w-3.5 h-3.5 text-[#7C3AED]" />
                  <span>Receipt</span>
                </button>
                <button
                  onClick={() => {
                    onStartScan('book');
                    setIsOpen(false);
                  }}
                  className="min-h-[40px] px-3 py-2 rounded-lg bg-[#FAFAFC] hover:bg-[#F5F3FF] border border-[#E6E6EB] hover:border-[#DDD6FE] text-[#1C1B22] hover:text-[#7C3AED] font-medium flex items-center gap-2 transition-colors"
                >
                  <BookOpen className="w-3.5 h-3.5 text-[#7C3AED]" />
                  <span>Book Spread</span>
                </button>
                <button
                  onClick={() => {
                    onOpenPdfWorkspace();
                    setIsOpen(false);
                  }}
                  className="min-h-[40px] px-3 py-2 rounded-lg bg-[#F5F3FF] border border-[#DDD6FE] text-[#7C3AED] hover:bg-[#7C3AED] hover:text-white font-semibold flex items-center gap-2 transition-colors"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>PDF Workspace</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
