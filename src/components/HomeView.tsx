import React from 'react';
import {
  CreditCard,
  FileText,
  Receipt,
  BookOpen,
  Layers,
  ArrowRight,
  Clock,
  Share2,
  BarChart3,
  FolderKanban,
} from 'lucide-react';
import { FolderItem, ScanMode, ScannedDocument } from '../types/scanner';
import { DetailedStorageStats } from '../utils/storage';
import { ScanTilesWidget } from './ScanActionWidgets';

interface HomeViewProps {
  documents: ScannedDocument[];
  folders: FolderItem[];
  storageStats: DetailedStorageStats;
  exportCount: number;
  defaultScanMode: ScanMode;
  onStartScan: (mode?: ScanMode) => void;
  onSelectDocument: (doc: ScannedDocument) => void;
  onOpenExport: (doc: ScannedDocument) => void;
  onImportPdfFile: (file: File) => Promise<void>;
  onImportGalleryImages: (files: File[]) => Promise<void>;
  onOpenPdfWorkspace: () => void;
  onNavigateDocuments: () => void;
  onNavigateCategories: () => void;
  onNavigateAnalytics: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateShort(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export const HomeView: React.FC<HomeViewProps> = ({
  documents,
  folders,
  storageStats,
  exportCount,
  defaultScanMode,
  onStartScan,
  onSelectDocument,
  onOpenExport,
  onImportPdfFile,
  onImportGalleryImages,
  onOpenPdfWorkspace,
  onNavigateDocuments,
  onNavigateCategories,
  onNavigateAnalytics,
}) => {
  const totalPages = documents.reduce((acc, doc) => acc + doc.pages.length, 0);
  const recentDocs = [...documents]
    .sort((a, b) => (b.lastOpenedAt || b.updatedAt) - (a.lastOpenedAt || a.updatedAt))
    .slice(0, 4);

  return (
    <div className="space-y-8">
      {/* Primary Scanning & Import Action Section */}
      <section className="bg-white border border-[#E6E6EB] rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 max-w-xl">
            <h2 className="text-lg sm:text-xl font-bold text-[#1C1B22] tracking-tight">
              Scan, organize and export your documents.
            </h2>
            <p className="text-xs text-[#666672] leading-relaxed">
              Automatic edge detection, perspective projection, shadow removal, PDF tools, and bilingual OCR.
            </p>
          </div>

          <button
            onClick={onOpenPdfWorkspace}
            className="min-h-[40px] px-3.5 py-2 rounded-lg bg-[#F5F3FF] border border-[#DDD6FE] text-[#7C3AED] hover:bg-[#7C3AED] hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>PDF Tools</span>
          </button>
        </div>

        {/* 3-Tile Action Widget: Scan Doc / Gallery / Import File */}
        <ScanTilesWidget
          onStartScan={(mode) => onStartScan(mode || defaultScanMode)}
          onImportGalleryImages={onImportGalleryImages}
          onImportPdfFile={onImportPdfFile}
        />

        {/* Specialized Capture Modes */}
        <div className="pt-1 flex flex-wrap items-center gap-2">
          {(
            [
              { id: 'document', label: 'Document', icon: FileText },
              { id: 'id_card', label: 'ID Card (2-Sided)', icon: CreditCard },
              { id: 'receipt', label: 'Receipt', icon: Receipt },
              { id: 'book', label: 'Book Split', icon: BookOpen },
            ] as const
          ).map((modeItem) => {
            const Icon = modeItem.icon;
            return (
              <button
                key={modeItem.id}
                onClick={() => onStartScan(modeItem.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FAFAFC] hover:bg-[#F5F3FF] border border-[#E6E6EB] hover:border-[#DDD6FE] text-[#1C1B22] hover:text-[#7C3AED] text-xs font-medium transition-colors whitespace-nowrap"
              >
                <Icon className="w-3.5 h-3.5 text-[#7C3AED]" />
                <span>{modeItem.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Activity Summary */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#1C1B22]">Activity overview</h3>
          <button
            onClick={onNavigateAnalytics}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#7C3AED] hover:text-[#6D28D9] transition-colors"
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>View Analytics</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button
            onClick={onNavigateDocuments}
            className="bg-white border border-[#E6E6EB] hover:border-[#7C3AED] rounded-lg p-3.5 text-left transition-colors"
          >
            <div className="text-xs text-[#666672]">Documents</div>
            <div className="text-xl font-bold text-[#1C1B22] mt-1 tabular-nums">
              {documents.length}
            </div>
          </button>

          <button
            onClick={onNavigateDocuments}
            className="bg-white border border-[#E6E6EB] hover:border-[#7C3AED] rounded-lg p-3.5 text-left transition-colors"
          >
            <div className="text-xs text-[#666672]">Pages captured</div>
            <div className="text-xl font-bold text-[#1C1B22] mt-1 tabular-nums">
              {totalPages}
            </div>
          </button>

          <button
            onClick={onNavigateAnalytics}
            className="bg-white border border-[#E6E6EB] hover:border-[#7C3AED] rounded-lg p-3.5 text-left transition-colors"
          >
            <div className="text-xs text-[#666672]">Exports</div>
            <div className="text-xl font-bold text-[#1C1B22] mt-1 tabular-nums">
              {exportCount}
            </div>
          </button>

          <button
            onClick={onNavigateCategories}
            className="bg-white border border-[#E6E6EB] hover:border-[#7C3AED] rounded-lg p-3.5 text-left transition-colors"
          >
            <div className="text-xs text-[#666672]">Local storage</div>
            <div className="text-xl font-bold text-[#1C1B22] mt-1 tabular-nums">
              {formatBytes(storageStats.activeBytes)}
            </div>
          </button>
        </div>
      </section>

      {/* Recent Documents */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-[#1C1B22]">Recent documents</h3>
            <span className="text-xs text-[#666672] tabular-nums">· {recentDocs.length}</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onNavigateCategories}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#666672] hover:text-[#1C1B22] transition-colors"
            >
              <FolderKanban className="w-3.5 h-3.5" />
              <span>Categories</span>
            </button>
            <button
              onClick={onNavigateDocuments}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#7C3AED] hover:text-[#6D28D9] transition-colors"
            >
              <span>All documents</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {recentDocs.length === 0 ? (
          <div className="bg-white border border-dashed border-[#E6E6EB] rounded-lg p-8 text-center space-y-2">
            <p className="text-xs font-semibold text-[#1C1B22]">No documents yet</p>
            <p className="text-xs text-[#666672]">
              Start a new scan or import a PDF to build your library.
            </p>
          </div>
        ) : (
          <div className="bg-white border border-[#E6E6EB] rounded-lg divide-y divide-[#E6E6EB]">
            {recentDocs.map((doc) => {
              const folder = folders.find((f) => f.id === doc.folderId);
              const thumb =
                doc.pages[0]?.thumbnailUrl ||
                doc.pages[0]?.processedDataUrl ||
                doc.pages[0]?.originalDataUrl;

              return (
                <div
                  key={doc.id}
                  onClick={() => onSelectDocument(doc)}
                  className="p-3.5 hover:bg-[#FAFAFC] flex items-center justify-between gap-3 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-14 rounded border border-[#E6E6EB] bg-white overflow-hidden shrink-0 flex items-center justify-center">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={doc.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <FileText className="w-5 h-5 text-[#666672]" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="text-xs sm:text-sm font-semibold text-[#1C1B22] truncate">
                        {doc.title}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-[#666672] mt-1 tabular-nums">
                        {folder && (
                          <>
                            <span className="truncate max-w-[120px]">{folder.name}</span>
                            <span aria-hidden="true">·</span>
                          </>
                        )}
                        <span>
                          {doc.pages.length} {doc.pages.length === 1 ? 'page' : 'pages'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 font-mono">
                          <Clock className="w-3 h-3" />
                          {formatDateShort(doc.lastOpenedAt || doc.updatedAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenExport(doc);
                    }}
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-[#666672] hover:text-[#7C3AED] hover:bg-[#F5F3FF] transition-colors shrink-0"
                    title="Export PDF / PNG"
                    aria-label={`Export ${doc.title}`}
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
