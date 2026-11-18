import React, { useState, useRef, useEffect } from 'react';
import {
  Search,
  FileText,
  Share2,
  Trash2,
  Calendar,
  CreditCard,
  Receipt,
  BookOpen,
  Plus,
  Star,
  ArrowUpDown,
  Upload,
  CheckSquare,
  Square,
  Combine,
  FolderInput,
  Tag,
  X,
  LayoutGrid,
  List,
  Layers,
} from 'lucide-react';
import { ScannedDocument, FolderItem, ScanMode, SortOption } from '../types/scanner';

export type SmartView = 'all' | 'favorites' | 'recent';

interface DocumentGridProps {
  documents: ScannedDocument[];
  folders: FolderItem[];
  selectedFolderId: string | null;
  selectedSmartView?: SmartView;
  selectedTag?: string | null;
  searchTrigger?: number;
  containedPreview?: boolean;
  onSelectFolderFilter?: (folderId: string | null) => void;
  onClearTagFilter?: () => void;
  onSelectDocument: (doc: ScannedDocument) => void;
  onOpenExport: (doc: ScannedDocument) => void;
  onDeleteDocument: (docId: string) => void;
  onToggleFavorite: (docId: string) => void;
  onBatchDelete: (docIds: string[]) => void;
  onBatchMoveFolder: (docIds: string[], folderId: string) => void;
  onBatchAddTag: (docIds: string[], tag: string) => void;
  onBatchMerge: (docIds: string[]) => void;
  onImportPdfFile: (file: File) => Promise<void>;
  onOpenPdfWorkspace?: () => void;
  onStartScan: (mode?: ScanMode) => void;
  onLoadSamples: () => void;
  onBatchSelectionChange?: (count: number) => void;
}

export const DocumentGrid: React.FC<DocumentGridProps> = ({
  documents,
  folders,
  selectedFolderId,
  selectedSmartView = 'all',
  selectedTag = null,
  searchTrigger = 0,
  containedPreview = false,
  onSelectFolderFilter,
  onClearTagFilter,
  onSelectDocument,
  onOpenExport,
  onDeleteDocument,
  onToggleFavorite,
  onBatchDelete,
  onBatchMoveFolder,
  onBatchAddTag,
  onBatchMerge,
  onImportPdfFile,
  onOpenPdfWorkspace,
  onStartScan,
  onLoadSamples,
  onBatchSelectionChange,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortOption>('updated_desc');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchTagInput, setBatchTagInput] = useState('');
  const [showBatchTagInput, setShowBatchTagInput] = useState(false);
  const [isImportingPdf, setIsImportingPdf] = useState(false);
  const pdfUploadRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    onBatchSelectionChange?.(selectedIds.length);
  }, [selectedIds.length, onBatchSelectionChange]);

  useEffect(() => {
    return () => {
      onBatchSelectionChange?.(0);
    };
  }, [onBatchSelectionChange]);

  useEffect(() => {
    if (searchTrigger > 0 && searchInputRef.current) {
      searchInputRef.current.focus();
      searchInputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [searchTrigger]);

  function getDocSearchableText(doc: ScannedDocument): string {
    const pageTexts = doc.pages.map((p) => p.extractedText || '').join(' ');
    return `${doc.extractedText || ''} ${pageTexts}`.trim();
  }

  function findContentSnippet(doc: ScannedDocument, query: string): string | null {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const text = getDocSearchableText(doc);
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return null;
    const start = Math.max(0, idx - 28);
    const end = Math.min(text.length, idx + q.length + 52);
    return `${start > 0 ? '...' : ''}${text.slice(start, end)}${end < text.length ? '...' : ''}`;
  }

  const filteredDocs = documents
    .filter((doc) => {
      if (selectedSmartView === 'favorites' && !doc.isFavorite) return false;
      if (selectedSmartView === 'recent' && !doc.lastOpenedAt && !doc.updatedAt) return false;

      if (selectedFolderId && selectedFolderId !== 'all' && doc.folderId !== selectedFolderId) {
        return false;
      }

      if (selectedTag && !(doc.tags || []).includes(selectedTag)) {
        return false;
      }

      if (filterMode !== 'all' && doc.scanMode !== filterMode) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = doc.title.toLowerCase().includes(q);
        const matchTags = doc.tags?.some((t) => t.toLowerCase().includes(q));
        const matchOcr = getDocSearchableText(doc).toLowerCase().includes(q);
        if (!matchTitle && !matchTags && !matchOcr) return false;
      }

      return true;
    })
    .sort((a, b) => {
      if (selectedSmartView === 'recent' || sortBy === 'opened_desc') {
        return (b.lastOpenedAt || b.updatedAt || 0) - (a.lastOpenedAt || a.updatedAt || 0);
      }
      if (sortBy === 'created_desc') return b.createdAt - a.createdAt;
      if (sortBy === 'title_asc') return a.title.localeCompare(b.title);
      if (sortBy === 'pages_desc') return b.pages.length - a.pages.length;
      return b.updatedAt - a.updatedAt;
    });

  function toggleSelect(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handlePdfUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImportingPdf(true);
    try {
      await onImportPdfFile(file);
    } finally {
      setIsImportingPdf(false);
      e.target.value = '';
    }
  }

  function getFolder(folderId: string): FolderItem | undefined {
    return folders.find((f) => f.id === folderId);
  }

  function getModeIcon(mode: ScanMode) {
    switch (mode) {
      case 'id_card':
        return CreditCard;
      case 'receipt':
        return Receipt;
      case 'book':
        return BookOpen;
      default:
        return FileText;
    }
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  return (
    <div className="space-y-4 relative pb-8">
      {/* Search, Sort, View Mode & PDF Actions */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#666672]" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search titles, tags, or OCR text..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full min-h-[40px] bg-white border border-[#E6E6EB] focus:border-[#7C3AED] focus:ring-2 focus:ring-[#F5F3FF] rounded-lg pl-10 pr-8 py-2 text-xs text-[#1C1B22] placeholder-[#666672] focus:outline-none transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#666672] hover:text-[#1C1B22]"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 bg-white border border-[#E6E6EB] rounded-lg px-2.5 min-h-[38px] text-xs">
              <ArrowUpDown className="w-3.5 h-3.5 text-[#666672]" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                aria-label="Sort documents"
                className="bg-transparent text-[#1C1B22] font-medium text-xs focus:outline-none cursor-pointer"
              >
                <option value="updated_desc">Last Updated</option>
                <option value="opened_desc">Recently Opened</option>
                <option value="created_desc">Date Created</option>
                <option value="title_asc">Name (A–Z)</option>
                <option value="pages_desc">Most Pages</option>
              </select>
            </div>

            {/* Grid / List Display Switcher */}
            <div
              role="group"
              aria-label="Display layout"
              className="inline-flex items-center p-0.5 bg-white border border-[#E6E6EB] rounded-lg"
            >
              <button
                onClick={() => setViewMode('grid')}
                aria-label="Grid view"
                aria-pressed={viewMode === 'grid'}
                className={`p-1.5 rounded-md transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-[#F5F3FF] text-[#7C3AED]'
                    : 'text-[#666672] hover:text-[#1C1B22]'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                aria-label="List view"
                aria-pressed={viewMode === 'list'}
                className={`p-1.5 rounded-md transition-colors ${
                  viewMode === 'list'
                    ? 'bg-[#F5F3FF] text-[#7C3AED]'
                    : 'text-[#666672] hover:text-[#1C1B22]'
                }`}
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>

            <input
              ref={pdfUploadRef}
              type="file"
              accept="application/pdf"
              onChange={handlePdfUpload}
              className="hidden"
            />
            <button
              onClick={() => pdfUploadRef.current?.click()}
              disabled={isImportingPdf}
              className="min-h-[38px] flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#E6E6EB] hover:border-[#7C3AED] text-[#1C1B22] hover:text-[#7C3AED] text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{isImportingPdf ? 'Importing...' : 'Import PDF'}</span>
            </button>

            {onOpenPdfWorkspace && (
              <button
                onClick={onOpenPdfWorkspace}
                className="min-h-[38px] flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F5F3FF] border border-[#DDD6FE] text-[#7C3AED] hover:bg-[#7C3AED] hover:text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>PDF Tools</span>
              </button>
            )}
          </div>
        </div>

        {/* Folder & Tag Filter Strip */}
        {(onSelectFolderFilter || selectedTag) && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none text-xs">
            {onSelectFolderFilter && (
              <>
                <button
                  onClick={() => onSelectFolderFilter(null)}
                  className={`px-2.5 py-1 rounded-md border whitespace-nowrap font-medium transition-colors ${
                    selectedFolderId === null
                      ? 'bg-[#F5F3FF] border-[#DDD6FE] text-[#7C3AED] font-semibold'
                      : 'bg-white border-[#E6E6EB] text-[#666672] hover:text-[#1C1B22]'
                  }`}
                >
                  All Folders
                </button>
                {folders.map((folder) => {
                  const active = selectedFolderId === folder.id;
                  return (
                    <button
                      key={folder.id}
                      onClick={() => onSelectFolderFilter(active ? null : folder.id)}
                      className={`px-2.5 py-1 rounded-md border whitespace-nowrap font-medium transition-colors flex items-center gap-1.5 ${
                        active
                          ? 'bg-[#F5F3FF] border-[#DDD6FE] text-[#7C3AED] font-semibold'
                          : 'bg-white border-[#E6E6EB] text-[#666672] hover:text-[#1C1B22]'
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: folder.color }}
                      />
                      <span>{folder.name}</span>
                    </button>
                  );
                })}
              </>
            )}

            {selectedTag && onClearTagFilter && (
              <button
                onClick={onClearTagFilter}
                className="px-2.5 py-1 rounded-md bg-[#7C3AED] text-white font-semibold flex items-center gap-1 whitespace-nowrap"
              >
                <span>#{selectedTag}</span>
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {/* Mode Filter Tabs & Select All */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1 p-1 bg-[#FAFAFC] border border-[#E6E6EB] rounded-lg overflow-x-auto scrollbar-none text-xs">
            {[
              { id: 'all', label: 'All Types' },
              { id: 'id_card', label: 'ID Cards' },
              { id: 'document', label: 'Documents' },
              { id: 'receipt', label: 'Receipts' },
              { id: 'book', label: 'Books' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterMode(tab.id)}
                className={`px-3 py-1 rounded-md whitespace-nowrap font-medium text-xs transition-colors ${
                  filterMode === tab.id
                    ? 'bg-[#7C3AED] text-white font-semibold'
                    : 'text-[#666672] hover:text-[#1C1B22] hover:bg-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {filteredDocs.length > 0 && (
            <button
              onClick={() =>
                setSelectedIds((prev) =>
                  prev.length === filteredDocs.length ? [] : filteredDocs.map((d) => d.id)
                )
              }
              className="text-xs font-medium text-[#666672] hover:text-[#7C3AED] flex items-center gap-1.5 min-h-[34px]"
            >
              {selectedIds.length === filteredDocs.length ? (
                <CheckSquare className="w-3.5 h-3.5 text-[#7C3AED]" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
              <span>{selectedIds.length > 0 ? `${selectedIds.length} selected` : 'Select All'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Document Grid or List */}
      {filteredDocs.length > 0 ? (
        viewMode === 'list' ? (
          <div className="bg-white border border-[#E6E6EB] rounded-lg divide-y divide-[#E6E6EB]">
            {filteredDocs.map((doc) => {
              const folder = getFolder(doc.folderId);
              const coverPage = doc.pages[0];
              const coverThumb =
                coverPage?.thumbnailUrl || coverPage?.processedDataUrl || coverPage?.originalDataUrl;
              const isSelected = selectedIds.includes(doc.id);
              const snippet = searchQuery.trim() ? findContentSnippet(doc, searchQuery) : null;

              return (
                <div
                  key={doc.id}
                  className={`p-3.5 flex items-center justify-between gap-3 transition-colors ${
                    isSelected ? 'bg-[#F5F3FF]/60' : 'hover:bg-[#FAFAFC]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <button
                      onClick={() => toggleSelect(doc.id)}
                      className={`p-1 rounded-md border shrink-0 ${
                        isSelected
                          ? 'bg-[#7C3AED] border-[#7C3AED] text-white'
                          : 'bg-white border-[#E6E6EB] text-[#666672] hover:border-[#7C3AED]'
                      }`}
                      aria-label={`Select ${doc.title}`}
                    >
                      {isSelected ? (
                        <CheckSquare className="w-3.5 h-3.5" />
                      ) : (
                        <Square className="w-3.5 h-3.5" />
                      )}
                    </button>

                    <div
                      onClick={() => onSelectDocument(doc)}
                      className="w-10 h-12 rounded border border-[#E6E6EB] bg-white overflow-hidden shrink-0 flex items-center justify-center cursor-pointer"
                    >
                      {coverThumb ? (
                        <img
                          src={coverThumb}
                          alt={doc.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <FileText className="w-4 h-4 text-[#666672]" />
                      )}
                    </div>

                    <div
                      onClick={() => onSelectDocument(doc)}
                      className="min-w-0 flex-1 cursor-pointer"
                    >
                      <div className="text-xs sm:text-sm font-semibold text-[#1C1B22] hover:text-[#7C3AED] truncate">
                        {doc.title}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-[#666672] mt-0.5 flex-wrap tabular-nums">
                        {folder && (
                          <span className="inline-flex items-center gap-1">
                            <span
                              className="w-2 h-2 rounded-full inline-block"
                              style={{ backgroundColor: folder.color }}
                            />
                            <span>{folder.name}</span>
                          </span>
                        )}
                        {folder && <span aria-hidden="true">·</span>}
                        <span>
                          {doc.pages.length} {doc.pages.length === 1 ? 'page' : 'pages'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{formatDate(doc.updatedAt || doc.createdAt)}</span>
                      </div>
                      {snippet && (
                        <div className="mt-1 text-[11px] text-[#1C1B22] truncate">{snippet}</div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => onToggleFavorite(doc.id)}
                      className={`p-2 rounded-lg transition-colors ${
                        doc.isFavorite
                          ? 'text-amber-500'
                          : 'text-[#666672] hover:text-amber-500'
                      }`}
                      title={doc.isFavorite ? 'Remove favorite' : 'Favorite document'}
                    >
                      <Star className={`w-4 h-4 ${doc.isFavorite ? 'fill-amber-400' : ''}`} />
                    </button>

                    <button
                      onClick={() => onOpenExport(doc)}
                      className="p-2 rounded-lg hover:bg-[#F5F3FF] text-[#666672] hover:text-[#7C3AED] transition-colors"
                      title="Export PDF / PNG"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => onDeleteDocument(doc.id)}
                      className="p-2 rounded-lg hover:bg-red-50 text-[#666672] hover:text-[#DC2626] transition-colors"
                      title="Move to Trash"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            className={`grid gap-4 ${
              containedPreview
                ? 'grid-cols-1 sm:grid-cols-2'
                : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4'
            }`}
          >
            {filteredDocs.map((doc) => {
              const folder = getFolder(doc.folderId);
              const ModeIcon = getModeIcon(doc.scanMode);
              const coverPage = doc.pages[0];
              const coverThumb =
                coverPage?.thumbnailUrl || coverPage?.processedDataUrl || coverPage?.originalDataUrl;
              const isSelected = selectedIds.includes(doc.id);
              const snippet = searchQuery.trim() ? findContentSnippet(doc, searchQuery) : null;

              return (
                <div
                  key={doc.id}
                  className={`group relative bg-white border rounded-lg overflow-hidden transition-colors flex flex-col ${
                    isSelected
                      ? 'border-[#7C3AED] ring-2 ring-[#F5F3FF]'
                      : 'border-[#E6E6EB] hover:border-[#7C3AED]'
                  }`}
                >
                  {/* Thumbnail Preview */}
                  <div
                    onClick={() => onSelectDocument(doc)}
                    className="relative aspect-[4/3] bg-[#FAFAFC] border-b border-[#E6E6EB] flex items-center justify-center cursor-pointer overflow-hidden p-3"
                  >
                    {coverThumb ? (
                      <img
                        src={coverThumb}
                        alt={doc.title}
                        className="max-h-full max-w-full object-contain rounded border border-[#E6E6EB] bg-white"
                      />
                    ) : (
                      <FileText className="w-12 h-12 text-[#8E8E9A]" />
                    )}

                    {/* Batch Selection Checkbox */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(doc.id);
                      }}
                      className={`absolute top-2 left-2 p-1 rounded-md border transition-opacity ${
                        isSelected
                          ? 'bg-[#7C3AED] border-[#7C3AED] text-white opacity-100'
                          : 'bg-white border-[#E6E6EB] text-[#666672] opacity-0 group-hover:opacity-100'
                      }`}
                      title="Select for batch actions"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-3.5 h-3.5" />
                      ) : (
                        <Square className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {/* Favorite Star Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(doc.id);
                      }}
                      className={`absolute top-2 right-2 p-1.5 rounded-md bg-white border border-[#E6E6EB] transition-colors ${
                        doc.isFavorite ? 'text-amber-500' : 'text-[#8E8E9A] hover:text-amber-500'
                      }`}
                      title={doc.isFavorite ? 'Remove favorite' : 'Favorite document'}
                    >
                      <Star className={`w-3.5 h-3.5 ${doc.isFavorite ? 'fill-amber-400' : ''}`} />
                    </button>

                    {/* Page Count */}
                    <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-white text-[10px] font-mono tabular-nums text-[#1C1B22] border border-[#E6E6EB]">
                      {doc.pages.length} {doc.pages.length === 1 ? 'page' : 'pages'}
                    </div>

                    {/* Mode Icon */}
                    <div className="absolute bottom-2 left-2 p-1 rounded bg-white text-[#7C3AED] border border-[#E6E6EB]">
                      <ModeIcon className="w-3 h-3" />
                    </div>
                  </div>

                  {/* Metadata & Snippet */}
                  <div className="p-4 flex-1 flex flex-col justify-between">
                    <div>
                      <h3
                        onClick={() => onSelectDocument(doc)}
                        className="text-sm font-semibold text-[#1C1B22] group-hover:text-[#7C3AED] transition-colors cursor-pointer truncate"
                        title={doc.title}
                      >
                        {doc.title}
                      </h3>

                      <div className="flex items-center gap-2 text-[11px] text-[#666672] mt-1.5 flex-wrap">
                        {folder && (
                          <span className="flex items-center gap-1.5">
                            <span
                              className="w-2 h-2 rounded-full inline-block shrink-0"
                              style={{ backgroundColor: folder.color }}
                            />
                            <span className="truncate max-w-[95px]">{folder.name}</span>
                          </span>
                        )}
                        {folder && <span aria-hidden="true">·</span>}
                        <span className="flex items-center gap-1 font-mono text-[#666672] tabular-nums">
                          <Calendar className="w-3 h-3" />
                          <span>{formatDate(doc.updatedAt || doc.createdAt)}</span>
                        </span>
                        {doc.ocrLanguage && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-[#16A34A] uppercase text-[10px] font-semibold">
                              {doc.ocrLanguage}
                            </span>
                          </>
                        )}
                      </div>

                      {snippet && (
                        <div className="mt-2 p-2 rounded-md bg-[#F5F3FF] border border-[#DDD6FE] text-[11px] text-[#1C1B22] leading-snug line-clamp-2">
                          {snippet}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#E6E6EB] text-xs">
                      <button
                        onClick={() => onSelectDocument(doc)}
                        className="text-[#7C3AED] hover:text-[#6D28D9] font-semibold text-xs transition-colors"
                      >
                        Open &amp; Edit
                      </button>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onOpenExport(doc)}
                          className="p-1.5 rounded-lg hover:bg-[#F5F3FF] text-[#666672] hover:text-[#7C3AED] transition-colors"
                          title="Export PDF / PNG"
                        >
                          <Share2 className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => onDeleteDocument(doc.id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-[#8E8E9A] hover:text-[#DC2626] transition-colors"
                          title="Move to Trash"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div className="text-center py-14 px-4 bg-white border border-dashed border-[#E6E6EB] rounded-lg max-w-xl mx-auto space-y-4">
          <div className="w-12 h-12 rounded-lg bg-[#F5F3FF] text-[#7C3AED] flex items-center justify-center mx-auto">
            <FileText className="w-6 h-6" />
          </div>

          <div className="space-y-1">
            <h3 className="text-base font-bold text-[#1C1B22]">No matching documents</h3>
            <p className="text-xs text-[#666672] max-w-md mx-auto">
              Scan a document, import a PDF, or adjust your current filters.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
            <button
              onClick={() => onStartScan('document')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-semibold text-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Scan Document</span>
            </button>

            <button
              onClick={() => onStartScan('id_card')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-[#E6E6EB] hover:border-[#7C3AED] text-[#1C1B22] font-medium text-xs"
            >
              <CreditCard className="w-4 h-4 text-[#7C3AED]" />
              <span>Scan ID Card</span>
            </button>

            <button
              onClick={onLoadSamples}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#F5F3FF] hover:bg-[#EDE9FE] text-[#7C3AED] border border-[#DDD6FE] text-xs font-medium"
            >
              <span>Load Sample Documents</span>
            </button>
          </div>
        </div>
      )}

      {/* Floating Batch Action Bar */}
      {selectedIds.length > 0 && (
        <div
          className={`${
            containedPreview
              ? 'sticky bottom-2 mx-auto w-full'
              : 'fixed bottom-20 lg:bottom-5 left-1/2 -translate-x-1/2 max-w-[calc(100vw-1.5rem)]'
          } z-30 bg-[#1C1B22] text-white px-4 py-2.5 rounded-lg shadow-xl border border-[#343240] flex flex-wrap items-center gap-2.5 text-xs`}
        >
          <span className="font-semibold text-violet-300 font-mono tabular-nums">
            {selectedIds.length} selected
          </span>

          <button
            onClick={() => {
              onBatchMerge(selectedIds);
              setSelectedIds([]);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#7C3AED] hover:bg-[#6D28D9] font-semibold"
          >
            <Combine className="w-3.5 h-3.5" />
            <span>Merge PDF</span>
          </button>

          <div className="flex items-center gap-1 bg-[#2B2936] rounded-md px-2 py-1">
            <FolderInput className="w-3.5 h-3.5 text-neutral-300" />
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  onBatchMoveFolder(selectedIds, e.target.value);
                  setSelectedIds([]);
                }
              }}
              className="bg-transparent text-xs text-white focus:outline-none cursor-pointer"
            >
              <option value="" disabled className="text-[#1C1B22]">
                Move to folder...
              </option>
              {folders.map((f) => (
                <option key={f.id} value={f.id} className="text-[#1C1B22]">
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          {showBatchTagInput ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (batchTagInput.trim()) {
                  onBatchAddTag(selectedIds, batchTagInput.trim());
                  setBatchTagInput('');
                  setShowBatchTagInput(false);
                  setSelectedIds([]);
                }
              }}
              className="flex items-center gap-1"
            >
              <input
                type="text"
                autoFocus
                value={batchTagInput}
                onChange={(e) => setBatchTagInput(e.target.value)}
                placeholder="Tag name"
                className="w-24 px-2 py-1 rounded bg-[#14131A] border border-[#3E3C4C] text-xs text-white"
              />
              <button type="submit" className="px-2 py-1 rounded bg-[#7C3AED] text-xs font-semibold">
                Add
              </button>
            </form>
          ) : (
            <button
              onClick={() => setShowBatchTagInput(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#2B2936] hover:bg-[#3A3848] font-medium"
            >
              <Tag className="w-3.5 h-3.5" />
              <span>Tag</span>
            </button>
          )}

          <button
            onClick={() => {
              onBatchDelete(selectedIds);
              setSelectedIds([]);
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#DC2626] hover:bg-red-700 font-semibold"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Trash</span>
          </button>

          <button
            onClick={() => setSelectedIds([])}
            className="p-1 text-neutral-400 hover:text-white"
            title="Clear selection"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
