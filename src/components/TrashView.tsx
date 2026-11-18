import React, { useState } from 'react';
import { Trash2, RotateCcw, FileText } from 'lucide-react';
import { FolderItem, ScannedDocument } from '../types/scanner';

interface TrashViewProps {
  trashedDocuments: ScannedDocument[];
  folders: FolderItem[];
  onRestore: (doc: ScannedDocument) => Promise<void>;
  onDeleteForever: (docId: string) => Promise<void>;
  onEmptyTrash: () => Promise<void>;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export const TrashView: React.FC<TrashViewProps> = ({
  trashedDocuments,
  folders,
  onRestore,
  onDeleteForever,
  onEmptyTrash,
}) => {
  const [confirmingEmpty, setConfirmingEmpty] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const sorted = [...trashedDocuments].sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#1C1B22] tracking-tight">Trash</h2>
          <p className="text-xs text-[#666672] mt-0.5 tabular-nums">
            {sorted.length === 0
              ? 'No deleted documents.'
              : `${sorted.length} ${sorted.length === 1 ? 'document' : 'documents'} pending permanent removal.`}
          </p>
        </div>

        {sorted.length > 0 && (
          <div className="flex items-center gap-2">
            {confirmingEmpty ? (
              <>
                <button
                  onClick={async () => {
                    await onEmptyTrash();
                    setConfirmingEmpty(false);
                  }}
                  className="min-h-[40px] px-3.5 py-2 rounded-lg bg-[#DC2626] text-white text-xs font-semibold transition-colors whitespace-nowrap"
                >
                  Confirm Empty ({sorted.length})
                </button>
                <button
                  onClick={() => setConfirmingEmpty(false)}
                  className="min-h-[40px] px-3 py-2 rounded-lg bg-white border border-[#E6E6EB] text-[#666672] text-xs font-medium"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmingEmpty(true)}
                className="min-h-[40px] px-3.5 py-2 rounded-lg bg-[#FFF5F5] border border-[#FECACA] text-[#DC2626] hover:bg-[#DC2626] hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <Trash2 className="w-4 h-4" />
                <span>Empty Trash</span>
              </button>
            )}
          </div>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="bg-white border border-dashed border-[#E6E6EB] rounded-lg py-14 px-4 text-center space-y-2 max-w-xl mx-auto">
          <div className="w-11 h-11 rounded-lg bg-[#FAFAFC] border border-[#E6E6EB] text-[#666672] flex items-center justify-center mx-auto">
            <Trash2 className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-bold text-[#1C1B22]">Trash is empty</h3>
          <p className="text-xs text-[#666672]">
            Documents you delete appear here so you can restore them or clear storage permanently.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-[#E6E6EB] rounded-lg divide-y divide-[#E6E6EB]">
          {sorted.map((doc) => {
            const folderName = folders.find((f) => f.id === doc.folderId)?.name || 'Unassigned';
            const thumb =
              doc.pages[0]?.thumbnailUrl ||
              doc.pages[0]?.processedDataUrl ||
              doc.pages[0]?.originalDataUrl;
            const isConfirming = confirmingDeleteId === doc.id;

            return (
              <div
                key={doc.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-14 rounded border border-[#E6E6EB] bg-[#FAFAFC] overflow-hidden shrink-0 flex items-center justify-center">
                    {thumb ? (
                      <img src={thumb} alt={doc.title} className="w-full h-full object-cover" />
                    ) : (
                      <FileText className="w-5 h-5 text-[#666672]" />
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[#1C1B22] truncate">{doc.title}</div>
                    <div className="text-xs text-[#666672] mt-0.5 tabular-nums">
                      {folderName} · {doc.pages.length} {doc.pages.length === 1 ? 'page' : 'pages'} ·
                      Removed {formatDate(doc.deletedAt || doc.updatedAt)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => onRestore(doc)}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#F5F3FF] border border-[#DDD6FE] text-[#7C3AED] hover:bg-[#7C3AED] hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Restore</span>
                  </button>

                  {isConfirming ? (
                    <>
                      <button
                        onClick={async () => {
                          await onDeleteForever(doc.id);
                          setConfirmingDeleteId(null);
                        }}
                        className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#DC2626] text-white text-xs font-semibold"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmingDeleteId(null)}
                        className="min-h-[38px] px-2.5 py-1.5 rounded-lg bg-white border border-[#E6E6EB] text-[#666672] text-xs"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmingDeleteId(doc.id)}
                      className="min-h-[38px] px-3 py-1.5 rounded-lg bg-white border border-[#E6E6EB] hover:border-[#DC2626] text-[#666672] hover:text-[#DC2626] text-xs font-medium flex items-center gap-1.5 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
