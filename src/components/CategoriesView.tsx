import React from 'react';
import { Folder, FolderPlus, Tag, ArrowRight } from 'lucide-react';
import { FolderItem, ScannedDocument } from '../types/scanner';

interface CategoriesViewProps {
  folders: FolderItem[];
  documents: ScannedDocument[];
  onSelectFolder: (folderId: string) => void;
  onSelectTag: (tag: string) => void;
  onOpenFolderManager: () => void;
}

export const CategoriesView: React.FC<CategoriesViewProps> = ({
  folders,
  documents,
  onSelectFolder,
  onSelectTag,
  onOpenFolderManager,
}) => {
  const tagMap = new Map<string, number>();
  for (const doc of documents) {
    for (const tag of doc.tags || []) {
      tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
    }
  }
  const tags = Array.from(tagMap.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#1C1B22] tracking-tight">Folders &amp; categories</h2>
          <p className="text-xs text-[#666672] mt-0.5 tabular-nums">
            {folders.length} {folders.length === 1 ? 'folder' : 'folders'} organizing {documents.length}{' '}
            {documents.length === 1 ? 'document' : 'documents'}
          </p>
        </div>

        <button
          onClick={onOpenFolderManager}
          className="min-h-[40px] px-3.5 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap"
        >
          <FolderPlus className="w-4 h-4" />
          <span>Manage Folders</span>
        </button>
      </div>

      {/* Folders Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {folders.map((folder) => {
          const folderDocs = documents.filter((d) => d.folderId === folder.id);
          const pageCount = folderDocs.reduce((acc, d) => acc + d.pages.length, 0);

          return (
            <button
              key={folder.id}
              onClick={() => onSelectFolder(folder.id)}
              className="group bg-white border border-[#E6E6EB] hover:border-[#7C3AED] rounded-lg p-4 text-left transition-colors flex flex-col justify-between gap-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: folder.color }}
                  />
                  <span className="text-sm font-semibold text-[#1C1B22] group-hover:text-[#7C3AED] truncate transition-colors">
                    {folder.name}
                  </span>
                </div>
                <Folder className="w-4 h-4 text-[#666672] group-hover:text-[#7C3AED] shrink-0 transition-colors" />
              </div>

              <div className="flex items-center justify-between text-xs text-[#666672] pt-2 border-t border-[#E6E6EB] tabular-nums">
                <span>
                  {folderDocs.length} {folderDocs.length === 1 ? 'doc' : 'docs'} · {pageCount}{' '}
                  {pageCount === 1 ? 'page' : 'pages'}
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-[#666672] group-hover:text-[#7C3AED] transition-colors" />
              </div>
            </button>
          );
        })}
      </div>

      {/* Document Tags */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-[#7C3AED]" />
          <h3 className="text-sm font-bold text-[#1C1B22]">Tags</h3>
        </div>

        {tags.length === 0 ? (
          <p className="text-xs text-[#666672]">
            Add tags inside any document editor to filter scans across folders.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map(([tag, count]) => (
              <button
                key={tag}
                onClick={() => onSelectTag(tag)}
                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-white border border-[#E6E6EB] hover:border-[#7C3AED] hover:bg-[#F5F3FF] text-xs font-medium text-[#1C1B22] hover:text-[#7C3AED] transition-colors flex items-center gap-2"
              >
                <span>#{tag}</span>
                <span className="font-mono text-[11px] text-[#666672] tabular-nums">{count}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
