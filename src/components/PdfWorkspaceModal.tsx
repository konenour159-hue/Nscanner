import React, { useState, useRef } from 'react';
import {
  X,
  Combine,
  Scissors,
  Minimize2,
  Image as ImageIcon,
  Upload,
  ArrowUp,
  ArrowDown,
  Trash2,
  Download,
  Check,
  FileText,
  FolderPlus,
  Loader2,
} from 'lucide-react';
import { ScannedDocument, PageItem } from '../types/scanner';
import { recordExportEvent } from '../utils/storage';
import {
  generateDocumentPdf,
  generatePngZip,
  generateSinglePng,
  importPdfFileToPages,
  mergeRawPdfFiles,
  parseSplitRanges,
  triggerDownload,
} from '../utils/pdfGenerator';

type WorkspaceTab = 'merge' | 'split' | 'compress' | 'images';

interface PdfWorkspaceModalProps {
  documents: ScannedDocument[];
  initialTab?: WorkspaceTab;
  preselectedDocIds?: string[];
  onSaveNewDocument: (doc: ScannedDocument) => Promise<void>;
  onClose: () => void;
}

interface MergeQueueItem {
  id: string;
  title: string;
  pageCount: number;
  kind: 'doc' | 'pdf';
  doc?: ScannedDocument;
  file?: File;
}

export const PdfWorkspaceModal: React.FC<PdfWorkspaceModalProps> = ({
  documents,
  initialTab = 'merge',
  preselectedDocIds = [],
  onSaveNewDocument,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab);
  const [isBusy, setIsBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // MERGE STATE
  const [mergeTitle, setMergeTitle] = useState('Merged PDF Document');
  const [mergeQueue, setMergeQueue] = useState<MergeQueueItem[]>(() =>
    documents
      .filter((d) => preselectedDocIds.includes(d.id))
      .map((d) => ({
        id: d.id,
        title: d.title,
        pageCount: d.pages.length,
        kind: 'doc' as const,
        doc: d,
      }))
  );
  const mergePdfInputRef = useRef<HTMLInputElement | null>(null);

  // SPLIT / COMPRESS / IMAGES TARGET DOC
  const [targetDocId, setTargetDocId] = useState<string>(
    preselectedDocIds[0] || documents[0]?.id || ''
  );
  const [externalTargetDoc, setExternalTargetDoc] = useState<ScannedDocument | null>(null);
  const targetPdfInputRef = useRef<HTMLInputElement | null>(null);

  // SPLIT STATE
  const [splitMode, setSplitMode] = useState<'ranges' | 'every_page' | 'selected'>('ranges');
  const [splitRanges, setSplitRanges] = useState('1-1, 2-2');
  const [selectedPageIndices, setSelectedPageIndices] = useState<number[]>([0]);

  // COMPRESS STATE
  const [compressQuality, setCompressQuality] = useState<'high' | 'medium' | 'low'>('medium');
  const [compressStats, setCompressStats] = useState<{
    originalBytes: number;
    compressedBytes: number;
    url: string;
    filename: string;
  } | null>(null);

  const activeTargetDoc =
    externalTargetDoc || documents.find((d) => d.id === targetDocId) || documents[0] || null;

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function notify(msg: string) {
    setErrorMsg(null);
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(null), 3500);
  }

  // Handle uploading an external PDF as target for Split / Compress / PDF-to-Images
  async function handleExternalTargetPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsBusy(true);
    setErrorMsg(null);
    try {
      const { pages, extractedText } = await importPdfFileToPages(file);
      const tempDoc: ScannedDocument = {
        id: 'ext_' + Date.now(),
        title: file.name.replace(/\.pdf$/i, ''),
        folderId: 'f_work',
        scanMode: 'document',
        pages,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tags: ['Imported PDF'],
        extractedText: extractedText || undefined,
        ocrStatus: extractedText ? 'done' : 'none',
        sourceType: 'pdf_import',
      };
      setExternalTargetDoc(tempDoc);
      setSplitRanges(pages.length > 1 ? `1-${Math.ceil(pages.length / 2)}, ${Math.ceil(pages.length / 2) + 1}-${pages.length}` : '1');
      setSelectedPageIndices([0]);
      setCompressStats(null);
      notify(`Loaded "${file.name}" (${pages.length} pages)`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to parse PDF file.');
    } finally {
      setIsBusy(false);
    }
  }

  // MERGE HANDLERS
  function addLibraryDocToMerge(doc: ScannedDocument) {
    setMergeQueue((prev) => [
      ...prev,
      {
        id: `${doc.id}_${Date.now()}_${Math.random()}`,
        title: doc.title,
        pageCount: doc.pages.length,
        kind: 'doc',
        doc,
      },
    ]);
  }

  function handleAddMergePdfFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const added: MergeQueueItem[] = Array.from(files).map((file, idx) => ({
      id: `pdf_${Date.now()}_${idx}`,
      title: file.name,
      pageCount: 0,
      kind: 'pdf',
      file,
    }));
    setMergeQueue((prev) => [...prev, ...added]);
  }

  function moveMergeItem(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= mergeQueue.length) return;
    const next = [...mergeQueue];
    const [item] = next.splice(idx, 1);
    next.splice(target, 0, item);
    setMergeQueue(next);
  }

  async function executeMerge(action: 'download' | 'save_library') {
    if (mergeQueue.length === 0) {
      setErrorMsg('Add at least one document or PDF file to merge.');
      return;
    }
    setIsBusy(true);
    setErrorMsg(null);
    try {
      // If all items are raw external PDFs and user wants direct download, use pdf-lib fast path
      const allRawPdfs = mergeQueue.every((m) => m.kind === 'pdf' && m.file);
      if (allRawPdfs && action === 'download') {
        const res = await mergeRawPdfFiles(
          mergeQueue.map((m) => m.file!),
          mergeTitle
        );
        triggerDownload(res.url, res.filename);
        recordExportEvent({
          documentTitle: mergeTitle || res.filename,
          format: 'merged_pdf',
          pageCount: res.pageCount,
          sizeBytes: res.sizeBytes,
        });
        notify(`Merged ${mergeQueue.length} PDF files (${res.pageCount} pages)`);
        return;
      }

      // Build unified page list across library docs & imported PDFs
      const mergedPages: PageItem[] = [];
      const textChunks: string[] = [];

      for (const item of mergeQueue) {
        if (item.kind === 'doc' && item.doc) {
          for (const p of item.doc.pages) {
            mergedPages.push({
              ...p,
              id: `p_m_${Date.now()}_${mergedPages.length}`,
              pageNumber: mergedPages.length + 1,
            });
          }
          if (item.doc.extractedText) textChunks.push(item.doc.extractedText);
        } else if (item.kind === 'pdf' && item.file) {
          const { pages, extractedText } = await importPdfFileToPages(item.file);
          for (const p of pages) {
            mergedPages.push({
              ...p,
              id: `p_m_${Date.now()}_${mergedPages.length}`,
              pageNumber: mergedPages.length + 1,
            });
          }
          if (extractedText) textChunks.push(extractedText);
        }
      }

      const combinedDoc: ScannedDocument = {
        id: 'doc_merged_' + Date.now(),
        title: mergeTitle.trim() || 'Merged Document',
        folderId: documents[0]?.folderId || 'f_work',
        scanMode: 'document',
        pages: mergedPages,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tags: ['Merged'],
        extractedText: textChunks.join('\n\n') || undefined,
        ocrStatus: textChunks.length > 0 ? 'done' : 'none',
        sourceType: 'merged',
      };

      if (action === 'save_library') {
        await onSaveNewDocument(combinedDoc);
        notify(`Saved "${combinedDoc.title}" (${mergedPages.length} pages) to Library`);
      } else {
        const pdfRes = await generateDocumentPdf(combinedDoc, {
          format: 'pdf',
          pageSize: 'a4',
          orientation: 'auto',
          quality: 'high',
          marginMm: 0,
          includePageNumbers: false,
          searchablePdf: true,
          documentTitle: combinedDoc.title,
        });
        triggerDownload(pdfRes.url, pdfRes.filename);
        recordExportEvent({
          documentTitle: combinedDoc.title,
          format: 'merged_pdf',
          pageCount: pdfRes.pageCount,
          sizeBytes: pdfRes.sizeBytes,
        });
        notify(`Downloaded merged PDF (${pdfRes.pageCount} pages, ${formatBytes(pdfRes.sizeBytes)})`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Merge failed.');
    } finally {
      setIsBusy(false);
    }
  }

  // SPLIT HANDLERS
  async function executeSplit(action: 'download' | 'save_library') {
    if (!activeTargetDoc || activeTargetDoc.pages.length === 0) return;
    setIsBusy(true);
    setErrorMsg(null);
    try {
      let groups: number[][] = [];
      if (splitMode === 'every_page') {
        groups = activeTargetDoc.pages.map((_, idx) => [idx]);
      } else if (splitMode === 'selected') {
        if (selectedPageIndices.length === 0) {
          setErrorMsg('Select at least one page to extract.');
          setIsBusy(false);
          return;
        }
        groups = [[...selectedPageIndices].sort((a, b) => a - b)];
      } else {
        groups = parseSplitRanges(splitRanges, activeTargetDoc.pages.length);
        if (groups.length === 0) {
          setErrorMsg('Invalid range syntax. Example: 1-2, 3');
          setIsBusy(false);
          return;
        }
      }

      for (let gIdx = 0; gIdx < groups.length; gIdx++) {
        const indices = groups[gIdx];
        const partPages: PageItem[] = indices.map((origIdx, newIdx) => ({
          ...activeTargetDoc.pages[origIdx],
          id: `p_split_${Date.now()}_${gIdx}_${newIdx}`,
          pageNumber: newIdx + 1,
        }));
        const partTitle = `${activeTargetDoc.title} (Part ${gIdx + 1})`;
        const partDoc: ScannedDocument = {
          id: `doc_split_${Date.now()}_${gIdx}`,
          title: partTitle,
          folderId: activeTargetDoc.folderId || 'f_work',
          scanMode: activeTargetDoc.scanMode,
          pages: partPages,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          tags: [...(activeTargetDoc.tags || []), 'Split'],
          extractedText: partPages.map((p) => p.extractedText || '').filter(Boolean).join('\n\n') || undefined,
          sourceType: 'split',
        };

        if (action === 'save_library') {
          await onSaveNewDocument(partDoc);
        } else {
          const pdfRes = await generateDocumentPdf(partDoc, {
            format: 'pdf',
            pageSize: 'a4',
            orientation: 'auto',
            quality: 'high',
            marginMm: 0,
            includePageNumbers: false,
            searchablePdf: true,
            documentTitle: partTitle,
          });
          triggerDownload(pdfRes.url, pdfRes.filename);
          recordExportEvent({
            documentTitle: partTitle,
            format: 'split_pdf',
            pageCount: pdfRes.pageCount,
            sizeBytes: pdfRes.sizeBytes,
          });
        }
      }

      notify(
        action === 'save_library'
          ? `Created ${groups.length} split document(s) in your library`
          : `Downloaded ${groups.length} split PDF file(s)`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Split operation failed.');
    } finally {
      setIsBusy(false);
    }
  }

  // COMPRESS HANDLERS
  async function runCompressionPreview() {
    if (!activeTargetDoc) return;
    setIsBusy(true);
    setErrorMsg(null);
    try {
      const baseline = await generateDocumentPdf(activeTargetDoc, {
        format: 'pdf',
        pageSize: 'a4',
        orientation: 'auto',
        quality: 'high',
        marginMm: 0,
        includePageNumbers: false,
        searchablePdf: true,
        documentTitle: activeTargetDoc.title,
      });

      const compressed = await generateDocumentPdf(activeTargetDoc, {
        format: 'pdf',
        pageSize: 'a4',
        orientation: 'auto',
        quality: compressQuality,
        marginMm: 0,
        includePageNumbers: false,
        searchablePdf: true,
        documentTitle: `${activeTargetDoc.title}_compressed`,
      });

      setCompressStats({
        originalBytes: baseline.sizeBytes,
        compressedBytes: compressed.sizeBytes,
        url: compressed.url,
        filename: `${activeTargetDoc.title.replace(/[^a-z0-9_-]/gi, '_')}_${compressQuality}.pdf`,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Compression failed.');
    } finally {
      setIsBusy(false);
    }
  }

  // EXPORT PDF TO IMAGES
  async function handleExportImages(format: 'png' | 'jpeg') {
    if (!activeTargetDoc) return;
    setIsBusy(true);
    setErrorMsg(null);
    try {
      const zipRes = await generatePngZip(activeTargetDoc, activeTargetDoc.title, format);
      triggerDownload(zipRes.url, zipRes.filename);
      recordExportEvent({
        documentId: activeTargetDoc.id,
        documentTitle: activeTargetDoc.title,
        format: format === 'png' ? 'png_zip' : 'jpeg_zip',
        pageCount: activeTargetDoc.pages.length,
        sizeBytes: zipRes.blob.size,
      });
      notify(`Exported ${activeTargetDoc.pages.length} ${format.toUpperCase()} images in ZIP`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Image export failed.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleExportSingleImage(page: PageItem) {
    if (!activeTargetDoc) return;
    setIsBusy(true);
    try {
      const res = await generateSinglePng(page, activeTargetDoc.title);
      triggerDownload(res.url, res.filename);
      recordExportEvent({
        documentId: activeTargetDoc.id,
        documentTitle: `${activeTargetDoc.title} (Page ${page.pageNumber})`,
        format: 'png',
        pageCount: 1,
        sizeBytes: res.blob.size,
      });
      notify(`Saved Page ${page.pageNumber} as PNG`);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#25243A]/45 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 text-[#1C1B22] select-none">
      <div className="bg-white border border-[#E6E6EB] rounded-xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-[0_16px_44px_rgba(37,36,58,0.16)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E6E6EB]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#F5F3FF] text-[#7C3AED] flex items-center justify-center">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#1C1B22]">Complete PDF Workspace</h2>
              <p className="text-xs text-[#666672]">Merge, Split, Compress, and Convert PDFs to Images locally</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[#F5F3FF] text-[#666672] hover:text-[#1C1B22]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Workspace Tabs */}
        <div className="flex items-center gap-2 px-6 py-3 bg-[#FAFAFC] border-b border-[#E6E6EB] overflow-x-auto">
          {[
            { id: 'merge', label: 'Merge PDFs', icon: Combine },
            { id: 'split', label: 'Split & Extract', icon: Scissors },
            { id: 'compress', label: 'Compress PDF', icon: Minimize2 },
            { id: 'images', label: 'PDF to Images', icon: ImageIcon },
          ].map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setActiveTab(t.id as WorkspaceTab);
                  setErrorMsg(null);
                }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  active
                    ? 'bg-[#7C3AED] text-white shadow-xs'
                    : 'bg-white border border-[#E6E6EB] text-[#666672] hover:text-[#1C1B22]'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Feedback Banners */}
        {(statusMsg || errorMsg) && (
          <div
            className={`px-6 py-2.5 text-xs font-semibold flex items-center gap-2 border-b ${
              errorMsg
                ? 'bg-[#FFF5F5] text-[#C94E5B] border-[#FECACA]'
                : 'bg-[#ECFDF5] text-[#278A68] border-[#A7F3D0]'
            }`}
          >
            <Check className="w-4 h-4 shrink-0" />
            <span>{errorMsg || statusMsg}</span>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* TAB 1: MERGE PDFs & SCANS */}
          {activeTab === 'merge' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left: Source Picker */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#666672]">
                    1. Add Sources to Queue
                  </span>
                  <div>
                    <input
                      ref={mergePdfInputRef}
                      type="file"
                      accept="application/pdf"
                      multiple
                      onChange={handleAddMergePdfFiles}
                      className="hidden"
                    />
                    <button
                      onClick={() => mergePdfInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F5F3FF] hover:bg-[#7C3AED] hover:text-white text-[#7C3AED] text-xs font-semibold transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload PDF Files</span>
                    </button>
                  </div>
                </div>

                <div className="border border-[#E6E6EB] rounded-xl divide-y divide-[#ECECF2] max-h-72 overflow-y-auto bg-[#FCFDFE]">
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between px-3.5 py-2.5 hover:bg-[#F5F3FF] transition-colors"
                    >
                      <div className="min-w-0 pr-3">
                        <div className="text-xs font-semibold text-[#1C1B22] truncate">{doc.title}</div>
                        <div className="text-[11px] text-[#666672] font-mono">
                          {doc.pages.length} {doc.pages.length === 1 ? 'page' : 'pages'}
                        </div>
                      </div>
                      <button
                        onClick={() => addLibraryDocToMerge(doc)}
                        className="px-2.5 py-1 rounded-md bg-white border border-[#E6E6EB] hover:border-[#7C3AED] text-[#7C3AED] text-xs font-semibold shrink-0"
                      >
                        + Add
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: Ordered Merge Queue */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#666672] mb-1.5">
                    2. Output Title &amp; Order
                  </label>
                  <input
                    type="text"
                    value={mergeTitle}
                    onChange={(e) => setMergeTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[#E6E6EB] text-xs font-semibold text-[#1C1B22] focus:outline-none focus:border-[#7C3AED]"
                  />
                </div>

                <div className="border border-[#E6E6EB] rounded-xl min-h-[180px] max-h-60 overflow-y-auto divide-y divide-[#ECECF2] bg-[#FAFAFC]">
                  {mergeQueue.length === 0 ? (
                    <div className="p-8 text-center text-xs text-[#9698A8]">
                      Click "+ Add" on documents or upload external `.pdf` files to build your merge sequence.
                    </div>
                  ) : (
                    mergeQueue.map((item, idx) => (
                      <div key={item.id} className="flex items-center justify-between px-3.5 py-2.5 bg-white">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-5 h-5 rounded bg-[#F5F3FF] text-[#7C3AED] text-[10px] font-mono font-bold flex items-center justify-center shrink-0">
                            {idx + 1}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-[#1C1B22] truncate">{item.title}</div>
                            <div className="text-[10px] text-[#666672] font-mono">
                              {item.kind === 'pdf' ? 'External PDF File' : `${item.pageCount} pages`}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => moveMergeItem(idx, -1)}
                            disabled={idx === 0}
                            className="p-1 rounded hover:bg-[#F5F3FF] disabled:opacity-30 text-[#666672]"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => moveMergeItem(idx, 1)}
                            disabled={idx === mergeQueue.length - 1}
                            className="p-1 rounded hover:bg-[#F5F3FF] disabled:opacity-30 text-[#666672]"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setMergeQueue((q) => q.filter((_, i) => i !== idx))}
                            className="p-1 rounded hover:bg-[#FFF5F5] text-[#9698A8] hover:text-[#C94E5B]"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    onClick={() => executeMerge('save_library')}
                    disabled={isBusy || mergeQueue.length === 0}
                    className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-white border border-[#E6E6EB] hover:border-[#7C3AED] text-[#7C3AED] text-xs font-semibold disabled:opacity-40"
                  >
                    {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
                    <span>Save to Library</span>
                  </button>
                  <button
                    onClick={() => executeMerge('download')}
                    disabled={isBusy || mergeQueue.length === 0}
                    className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold disabled:opacity-40"
                  >
                    {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    <span>Download Merged PDF</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SHARED TARGET SELECTOR FOR SPLIT / COMPRESS / PDF-TO-IMAGES */}
          {activeTab !== 'merge' && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-[#FAFAFC] border border-[#E6E6EB]">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-xs font-semibold text-[#666672] shrink-0">Target PDF / Doc:</span>
                  <select
                    value={externalTargetDoc ? '__ext__' : activeTargetDoc?.id || ''}
                    onChange={(e) => {
                      setExternalTargetDoc(null);
                      setTargetDocId(e.target.value);
                      setCompressStats(null);
                      setSelectedPageIndices([0]);
                    }}
                    className="flex-1 min-w-0 bg-white border border-[#E6E6EB] rounded-lg px-3 py-1.5 text-xs font-semibold text-[#1C1B22] focus:outline-none focus:border-[#7C3AED]"
                  >
                    {externalTargetDoc && (
                      <option value="__ext__">Uploaded PDF: {externalTargetDoc.title}</option>
                    )}
                    {documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title} ({d.pages.length} {d.pages.length === 1 ? 'page' : 'pages'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <input
                    ref={targetPdfInputRef}
                    type="file"
                    accept="application/pdf"
                    onChange={handleExternalTargetPdf}
                    className="hidden"
                  />
                  <button
                    onClick={() => targetPdfInputRef.current?.click()}
                    disabled={isBusy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#E6E6EB] hover:border-[#7C3AED] text-[#7C3AED] text-xs font-semibold"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Open External .PDF</span>
                  </button>
                </div>
              </div>

              {/* TAB 2: SPLIT PDF */}
              {activeTab === 'split' && activeTargetDoc && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { id: 'ranges', title: 'Split by Page Ranges', desc: 'e.g. 1-2, 3, 4-5' },
                      { id: 'every_page', title: 'Split Every Page', desc: `Creates ${activeTargetDoc.pages.length} single-page PDFs` },
                      { id: 'selected', title: 'Extract Selected Pages', desc: 'Pick pages visually below' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => setSplitMode(opt.id as 'ranges' | 'every_page' | 'selected')}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          splitMode === opt.id
                            ? 'bg-[#F5F3FF] border-[#7C3AED] text-[#7C3AED]'
                            : 'bg-white border-[#E6E6EB] text-[#1C1B22]'
                        }`}
                      >
                        <div className="text-xs font-bold">{opt.title}</div>
                        <div className="text-[11px] text-[#666672] mt-0.5">{opt.desc}</div>
                      </button>
                    ))}
                  </div>

                  {splitMode === 'ranges' && (
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-semibold text-[#666672]">Page Ranges:</label>
                      <input
                        type="text"
                        value={splitRanges}
                        onChange={(e) => setSplitRanges(e.target.value)}
                        placeholder="e.g. 1-2, 3"
                        className="flex-1 max-w-sm px-3 py-2 rounded-lg border border-[#E6E6EB] text-xs font-mono text-[#1C1B22] focus:outline-none focus:border-[#7C3AED]"
                      />
                    </div>
                  )}

                  {/* Page Preview Grid */}
                  <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-3 max-h-56 overflow-y-auto p-1">
                    {activeTargetDoc.pages.map((p, idx) => {
                      const isPicked = selectedPageIndices.includes(idx);
                      return (
                        <button
                          key={p.id}
                          onClick={() => {
                            if (splitMode !== 'selected') setSplitMode('selected');
                            setSelectedPageIndices((prev) =>
                              prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
                            );
                          }}
                          className={`relative rounded-lg border-2 p-1.5 bg-[#FAFAFC] transition-all ${
                            splitMode === 'selected' && isPicked
                              ? 'border-[#7C3AED] bg-[#F5F3FF]'
                              : 'border-[#E6E6EB]'
                          }`}
                        >
                          <img
                            src={p.thumbnailUrl || p.processedDataUrl}
                            alt={`Page ${idx + 1}`}
                            className="w-full h-24 object-contain bg-white rounded"
                          />
                          <div className="text-[10px] font-mono font-semibold text-center mt-1 text-[#1C1B22]">
                            Page {idx + 1}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap gap-3 pt-2">
                    <button
                      onClick={() => executeSplit('save_library')}
                      disabled={isBusy}
                      className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-white border border-[#E6E6EB] hover:border-[#7C3AED] text-[#7C3AED] text-xs font-semibold"
                    >
                      <FolderPlus className="w-4 h-4" />
                      <span>Save Split Docs to Library</span>
                    </button>
                    <button
                      onClick={() => executeSplit('download')}
                      disabled={isBusy}
                      className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download Split PDF(s)</span>
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 3: COMPRESS PDF */}
              {activeTab === 'compress' && activeTargetDoc && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { id: 'high', title: 'Print Quality (300 DPI)', desc: 'Minimal compression, sharp fine print' },
                      { id: 'medium', title: 'Balanced (150 DPI)', desc: 'Recommended for email & portals (40-65% smaller)' },
                      { id: 'low', title: 'Compact Web (96 DPI)', desc: 'Maximum size reduction for strict upload limits' },
                    ].map((q) => (
                      <button
                        key={q.id}
                        onClick={() => {
                          setCompressQuality(q.id as 'high' | 'medium' | 'low');
                          setCompressStats(null);
                        }}
                        className={`p-3.5 rounded-xl border text-left transition-all ${
                          compressQuality === q.id
                            ? 'bg-[#F5F3FF] border-[#7C3AED] text-[#7C3AED]'
                            : 'bg-white border-[#E6E6EB] text-[#1C1B22]'
                        }`}
                      >
                        <div className="text-xs font-bold">{q.title}</div>
                        <div className="text-[11px] text-[#666672] mt-1">{q.desc}</div>
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={runCompressionPreview}
                      disabled={isBusy}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold"
                    >
                      {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Minimize2 className="w-4 h-4" />}
                      <span>Compress &amp; Calculate Savings</span>
                    </button>

                    {compressStats && (
                      <button
                        onClick={() => {
                          triggerDownload(compressStats.url, compressStats.filename);
                          recordExportEvent({
                            documentId: activeTargetDoc.id,
                            documentTitle: activeTargetDoc.title,
                            format: 'compressed_pdf',
                            pageCount: activeTargetDoc.pages.length,
                            sizeBytes: compressStats.compressedBytes,
                          });
                        }}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#16A34A] hover:bg-emerald-700 text-white text-xs font-semibold"
                      >
                        <Download className="w-4 h-4" />
                        <span>Download Compressed PDF ({formatBytes(compressStats.compressedBytes)})</span>
                      </button>
                    )}
                  </div>

                  {compressStats && (
                    <div className="p-4 rounded-xl bg-[#FAFAFC] border border-[#E6E6EB] grid grid-cols-3 gap-4 text-xs">
                      <div>
                        <div className="text-[#666672]">Original PDF Size</div>
                        <div className="text-sm font-bold font-mono text-[#1C1B22] mt-0.5">
                          {formatBytes(compressStats.originalBytes)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[#666672]">Compressed Size</div>
                        <div className="text-sm font-bold font-mono text-[#278A68] mt-0.5">
                          {formatBytes(compressStats.compressedBytes)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[#666672]">Reduction</div>
                        <div className="text-sm font-bold font-mono text-[#7C3AED] mt-0.5">
                          {Math.max(
                            0,
                            Math.round((1 - compressStats.compressedBytes / Math.max(1, compressStats.originalBytes)) * 100)
                          )}
                          % saved
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: EXPORT PDF TO IMAGES */}
              {activeTab === 'images' && activeTargetDoc && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-[#666672]">
                      Download individual pages as lossless PNGs or export all {activeTargetDoc.pages.length} pages in one archive.
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleExportImages('jpeg')}
                        disabled={isBusy}
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-[#E6E6EB] hover:border-[#7C3AED] text-[#1C1B22] text-xs font-semibold"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>All Pages (.ZIP JPEG)</span>
                      </button>
                      <button
                        onClick={() => handleExportImages('png')}
                        disabled={isBusy}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>All Pages (.ZIP PNG)</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3 max-h-64 overflow-y-auto p-1">
                    {activeTargetDoc.pages.map((p, idx) => (
                      <div
                        key={p.id}
                        className="bg-[#FAFAFC] border border-[#E6E6EB] rounded-xl p-2 flex flex-col gap-2"
                      >
                        <img
                          src={p.thumbnailUrl || p.processedDataUrl}
                          alt={`Page ${idx + 1}`}
                          className="w-full h-28 object-contain bg-white rounded border border-[#ECECF2]"
                        />
                        <button
                          onClick={() => handleExportSingleImage(p)}
                          disabled={isBusy}
                          className="w-full py-1.5 rounded-lg bg-white hover:bg-[#F5F3FF] border border-[#E6E6EB] text-[#7C3AED] text-[11px] font-semibold flex items-center justify-center gap-1"
                        >
                          <Download className="w-3 h-3" />
                          <span>Page {idx + 1} PNG</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
