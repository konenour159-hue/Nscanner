import React from 'react';
import { HardDrive, Trash2, BarChart3 } from 'lucide-react';
import { FolderItem, ScannedDocument } from '../types/scanner';
import { DetailedStorageStats, computeDocumentStorageBreakdown } from '../utils/storage';

interface StorageOverviewViewProps {
  documents: ScannedDocument[];
  trashedDocuments: ScannedDocument[];
  folders: FolderItem[];
  storageStats: DetailedStorageStats;
  exportCount: number;
  onOpenTrash: () => void;
  onOpenAnalytics: () => void;
  onClearExportLog: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const StorageOverviewView: React.FC<StorageOverviewViewProps> = ({
  documents,
  trashedDocuments,
  folders,
  storageStats,
  exportCount,
  onOpenTrash,
  onOpenAnalytics,
  onClearExportLog,
}) => {
  const denom = Math.max(1, storageStats.usedBytes);
  const origPct = Math.round((storageStats.originalBytes / denom) * 100);
  const procPct = Math.round((storageStats.processedBytes / denom) * 100);
  const metaPct = Math.max(0, 100 - origPct - procPct);

  const folderUsage = folders.map((folder) => {
    const folderDocs = documents.filter((d) => d.folderId === folder.id);
    const bytes = computeDocumentStorageBreakdown(folderDocs).usedBytes;
    return { folder, count: folderDocs.length, bytes };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#1C1B22] tracking-tight">Storage overview</h2>
          <p className="text-xs text-[#666672] mt-0.5 tabular-nums">
            All documents, thumbnails, and OCR text are stored locally in IndexedDB.
          </p>
        </div>

        <button
          onClick={onOpenAnalytics}
          className="min-h-[40px] px-3.5 py-2 rounded-lg bg-[#F5F3FF] border border-[#DDD6FE] text-[#7C3AED] hover:bg-[#7C3AED] hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap"
        >
          <BarChart3 className="w-4 h-4" />
          <span>Full Analytics</span>
        </button>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-[#E6E6EB] rounded-lg p-4">
          <div className="flex items-center justify-between text-xs text-[#666672]">
            <span>Total NScanner Cache</span>
            <HardDrive className="w-4 h-4 text-[#7C3AED]" />
          </div>
          <div className="text-2xl font-bold text-[#1C1B22] mt-2 tabular-nums">
            {formatBytes(storageStats.usedBytes)}
          </div>
          <div className="text-[11px] text-[#666672] mt-1 tabular-nums">
            {storageStats.browserQuotaBytes
              ? `Origin quota: ${formatBytes(storageStats.browserQuotaBytes)}`
              : `${documents.length} active documents`}
          </div>
        </div>

        <div className="bg-white border border-[#E6E6EB] rounded-lg p-4">
          <div className="text-xs text-[#666672]">Active Library</div>
          <div className="text-2xl font-bold text-[#1C1B22] mt-2 tabular-nums">
            {formatBytes(storageStats.activeBytes)}
          </div>
          <div className="text-[11px] text-[#666672] mt-1 tabular-nums">
            {documents.length} {documents.length === 1 ? 'document' : 'documents'}
          </div>
        </div>

        <div className="bg-white border border-[#E6E6EB] rounded-lg p-4 flex flex-col justify-between">
          <div>
            <div className="text-xs text-[#666672]">Recoverable in Trash</div>
            <div className="text-2xl font-bold text-[#1C1B22] mt-2 tabular-nums">
              {formatBytes(storageStats.trashedBytes)}
            </div>
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-[11px] text-[#666672] tabular-nums">
              {trashedDocuments.length} trashed
            </span>
            {trashedDocuments.length > 0 && (
              <button
                onClick={onOpenTrash}
                className="text-xs font-semibold text-[#7C3AED] hover:underline"
              >
                Open Trash
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Allocation Bar */}
      <div className="bg-white border border-[#E6E6EB] rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-bold text-[#1C1B22]">Storage allocation by asset type</h3>

        <div className="w-full h-3 bg-[#F4F4F7] rounded-full overflow-hidden flex border border-[#E6E6EB]">
          {storageStats.usedBytes > 0 && (
            <>
              <div style={{ width: `${origPct}%` }} className="bg-[#7C3AED] h-full" />
              <div style={{ width: `${procPct}%` }} className="bg-[#A78BFA] h-full" />
              <div style={{ width: `${metaPct}%` }} className="bg-[#DDD6FE] h-full" />
            </>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="flex items-center justify-between px-3 py-2 rounded-md bg-[#FAFAFC] border border-[#E6E6EB]">
            <span className="flex items-center gap-2 text-[#666672]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#7C3AED]" />
              <span>Original captures</span>
            </span>
            <span className="font-mono font-semibold text-[#1C1B22] tabular-nums">
              {formatBytes(storageStats.originalBytes)}
            </span>
          </div>

          <div className="flex items-center justify-between px-3 py-2 rounded-md bg-[#FAFAFC] border border-[#E6E6EB]">
            <span className="flex items-center gap-2 text-[#666672]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#A78BFA]" />
              <span>Processed renders</span>
            </span>
            <span className="font-mono font-semibold text-[#1C1B22] tabular-nums">
              {formatBytes(storageStats.processedBytes)}
            </span>
          </div>

          <div className="flex items-center justify-between px-3 py-2 rounded-md bg-[#FAFAFC] border border-[#E6E6EB]">
            <span className="flex items-center gap-2 text-[#666672]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#DDD6FE]" />
              <span>Thumbnails &amp; OCR</span>
            </span>
            <span className="font-mono font-semibold text-[#1C1B22] tabular-nums">
              {formatBytes(storageStats.thumbnailAndTextBytes)}
            </span>
          </div>
        </div>
      </div>

      {/* Folder Storage Breakdown */}
      <div className="bg-white border border-[#E6E6EB] rounded-lg p-5 space-y-3">
        <h3 className="text-sm font-bold text-[#1C1B22]">By folder</h3>
        <div className="divide-y divide-[#E6E6EB]">
          {folderUsage.map(({ folder, count, bytes }) => {
            const pct =
              storageStats.activeBytes > 0
                ? Math.round((bytes / storageStats.activeBytes) * 100)
                : 0;
            return (
              <div key={folder.id} className="py-3 flex items-center justify-between gap-4 text-xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: folder.color }}
                  />
                  <span className="font-semibold text-[#1C1B22] truncate">{folder.name}</span>
                  <span className="text-[#666672] tabular-nums">({count})</span>
                </div>
                <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums">
                  <span className="text-[#666672]">{pct}%</span>
                  <span className="font-semibold text-[#1C1B22] w-20 text-right">
                    {formatBytes(bytes)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Export Log Cleanup */}
      {exportCount > 0 && (
        <div className="bg-white border border-[#E6E6EB] rounded-lg p-4 flex items-center justify-between gap-3 text-xs">
          <div>
            <div className="font-semibold text-[#1C1B22]">Export history log</div>
            <div className="text-[#666672] mt-0.5 tabular-nums">
              {exportCount} recorded export events stored in local preferences.
            </div>
          </div>
          <button
            onClick={onClearExportLog}
            className="min-h-[38px] px-3 py-1.5 rounded-lg border border-[#E6E6EB] hover:border-[#DC2626] text-[#1C1B22] hover:text-[#DC2626] font-medium flex items-center gap-1.5 transition-colors shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Log</span>
          </button>
        </div>
      )}
    </div>
  );
};
