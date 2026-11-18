import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Share2,
  Crop,
  RotateCw,
  Sliders,
  Layers,
  Sun,
  Eye,
  CheckCheck,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Folder as FolderIcon,
  Check,
  PenTool,
  Highlighter,
  Type as TypeIcon,
  Stamp,
  Undo2,
  Star,
  Copy,
  ScanText,
  Tag,
  Loader2,
  MousePointer,
  AlertCircle,
} from 'lucide-react';
import {
  ScannedDocument,
  PageItem,
  FilterPreset,
  AdjustmentParams,
  FolderItem,
  PageAnnotation,
  OcrLanguage,
} from '../types/scanner';
import { processImage, createThumbnail } from '../utils/imageProcessing';
import { importPdfFileToPages } from '../utils/pdfGenerator';
import { runDocumentOcr, suggestDocumentNames } from '../utils/ocrService';
import { getAppSettings } from '../utils/storage';
import { CropPerspectiveModal } from './CropPerspectiveModal';
import { SignaturePadModal } from './SignaturePadModal';

interface DocumentEditorProps {
  document: ScannedDocument;
  folders: FolderItem[];
  onUpdateDocument: (updated: ScannedDocument) => void;
  onOpenExport: (doc: ScannedDocument) => void;
  onAddPageWithCamera: () => void;
  onClose: () => void;
}

type EditorTab = 'presets' | 'adjust' | 'annotate' | 'ocr';
type AnnotateTool = 'select' | 'pen' | 'highlighter' | 'text' | 'stamp';

export const DocumentEditor: React.FC<DocumentEditorProps> = ({
  document: initialDoc,
  folders,
  onUpdateDocument,
  onOpenExport,
  onAddPageWithCamera,
  onClose,
}) => {
  const [doc, setDoc] = useState<ScannedDocument>(() => ({
    ...initialDoc,
    lastOpenedAt: Date.now(),
  }));
  const [activePageIndex, setActivePageIndex] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<EditorTab>('presets');

  const [isComparingOriginal, setIsComparingOriginal] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [isCropOpen, setIsCropOpen] = useState(false);
  const [isSignaturePadOpen, setIsSignaturePadOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [confirmExitSinglePage, setConfirmExitSinglePage] = useState(false);

  // Annotation state
  const [annotateTool, setAnnotateTool] = useState<AnnotateTool>('select');
  const [annotateColor, setAnnotateColor] = useState<string>('#1D4ED8');
  const [selectedStampText, setSelectedStampText] = useState<string>('APPROVED');
  const [pendingTextNote, setPendingTextNote] = useState<string>('Reviewed');
  const [drawingStroke, setDrawingStroke] = useState<{ x: number; y: number }[] | null>(null);
  const [draggingAnnId, setDraggingAnnId] = useState<string | null>(null);
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const viewportOverlayRef = useRef<HTMLDivElement | null>(null);

  // OCR & Naming state
  const [ocrLangHint, setOcrLangHint] = useState<'auto' | 'fr' | 'en'>(() => getAppSettings().defaultOcrLanguage);
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [newTagInput, setNewTagInput] = useState('');

  const addFileInputRef = useRef<HTMLInputElement | null>(null);
  const activePage = doc.pages[activePageIndex] || doc.pages[0];

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2200);
  }

  const processedSigByPageRef = useRef<Record<string, string>>({});

  // Record lastOpenedAt once on mount & index pre-processed signatures for all pages
  useEffect(() => {
    const map: Record<string, string> = {};
    for (const p of initialDoc.pages) {
      if (p.processedDataUrl) {
        map[p.id] = JSON.stringify([p.filter, p.rotation, p.adjustments]);
      }
    }
    processedSigByPageRef.current = map;
    onUpdateDocument({ ...initialDoc, lastOpenedAt: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDoc.id]);

  // Process image only when filter, rotation, or adjustments actually change (fast 960px preview -> crisp 2200px commit)
  useEffect(() => {
    if (!activePage) return;
    const sig = JSON.stringify([
      activePage.filter,
      activePage.rotation,
      activePage.adjustments,
    ]);
    if (processedSigByPageRef.current[activePage.id] === sig && activePage.processedDataUrl) {
      return;
    }

    let isCancelled = false;

    async function updateActivePagePreview(maxDim: number, isFinal: boolean) {
      if (!activePage) return;
      try {
        const processed = await processImage(
          activePage.originalDataUrl,
          activePage.filter,
          activePage.adjustments,
          activePage.rotation,
          maxDim
        );
        if (isCancelled) return;
        const thumb = isFinal ? await createThumbnail(processed) : activePage.thumbnailUrl;
        if (isFinal) {
          processedSigByPageRef.current[activePage.id] = sig;
        }

        setDoc((prev) => {
          const updatedPages = [...prev.pages];
          if (updatedPages[activePageIndex]) {
            updatedPages[activePageIndex] = {
              ...updatedPages[activePageIndex],
              processedDataUrl: processed,
              thumbnailUrl: thumb,
            };
          }
          const updatedDoc = { ...prev, pages: updatedPages, updatedAt: Date.now() };
          if (isFinal) {
            onUpdateDocument(updatedDoc);
          }
          return updatedDoc;
        });
      } catch (err) {
        console.error('Error processing page image:', err);
      }
    }

    const fastTimeout = setTimeout(() => updateActivePagePreview(960, false), 25);
    const fullTimeout = setTimeout(() => updateActivePagePreview(2200, true), 260);
    return () => {
      isCancelled = true;
      clearTimeout(fastTimeout);
      clearTimeout(fullTimeout);
    };
  }, [
    activePage?.id,
    activePage?.filter,
    activePage?.rotation,
    activePage?.adjustments?.brightness,
    activePage?.adjustments?.contrast,
    activePage?.adjustments?.sharpness,
    activePage?.adjustments?.warmth,
    activePage?.adjustments?.saturation,
    activePage?.adjustments?.shadowRemoval,
    activePage?.adjustments?.shadowStrength,
    activePageIndex,
  ]);

  function commitDocUpdate(updated: ScannedDocument) {
    setDoc(updated);
    onUpdateDocument(updated);
  }

  function handleSelectFilter(preset: FilterPreset) {
    if (!activePage) return;
    const updatedPages = [...doc.pages];
    updatedPages[activePageIndex] = {
      ...updatedPages[activePageIndex],
      filter: preset,
      adjustments: {
        ...updatedPages[activePageIndex].adjustments,
        shadowRemoval: preset !== 'original',
      },
    };
    setDoc({ ...doc, pages: updatedPages });
  }

  function handleAdjustmentChange(key: keyof AdjustmentParams, value: number | boolean) {
    if (!activePage) return;
    const updatedPages = [...doc.pages];
    updatedPages[activePageIndex] = {
      ...updatedPages[activePageIndex],
      adjustments: {
        ...updatedPages[activePageIndex].adjustments,
        [key]: value,
      },
    };
    setDoc({ ...doc, pages: updatedPages });
  }

  function handleRotate() {
    if (!activePage) return;
    const newRotation = (activePage.rotation + 90) % 360;
    const updatedPages = [...doc.pages];
    updatedPages[activePageIndex] = {
      ...updatedPages[activePageIndex],
      rotation: newRotation,
    };
    setDoc({ ...doc, pages: updatedPages });
  }

  async function handleApplyToAll() {
    if (!activePage) return;
    const currentFilter = activePage.filter;
    const currentAdjustments = { ...activePage.adjustments };

    setToastMessage('Applying settings to all pages...');
    const updatedPages = [...doc.pages];
    for (let i = 0; i < updatedPages.length; i++) {
      updatedPages[i] = {
        ...updatedPages[i],
        filter: currentFilter,
        adjustments: { ...currentAdjustments },
      };
      const processed = await processImage(
        updatedPages[i].originalDataUrl,
        currentFilter,
        currentAdjustments,
        updatedPages[i].rotation
      );
      const thumb = await createThumbnail(processed);
      updatedPages[i].processedDataUrl = processed;
      updatedPages[i].thumbnailUrl = thumb;
    }

    commitDocUpdate({ ...doc, pages: updatedPages, updatedAt: Date.now() });
    showToast('Applied enhancements to all pages');
  }

  function movePage(fromIndex: number, toIndex: number) {
    if (toIndex < 0 || toIndex >= doc.pages.length) return;
    const newPages = [...doc.pages];
    const [moved] = newPages.splice(fromIndex, 1);
    newPages.splice(toIndex, 0, moved);
    newPages.forEach((p, idx) => {
      p.pageNumber = idx + 1;
    });
    commitDocUpdate({ ...doc, pages: newPages, updatedAt: Date.now() });
    setActivePageIndex(toIndex);
  }

  function handleDeletePage() {
    if (doc.pages.length <= 1) {
      setConfirmExitSinglePage(true);
      return;
    }

    const newPages = doc.pages.filter((_, idx) => idx !== activePageIndex);
    newPages.forEach((p, idx) => {
      p.pageNumber = idx + 1;
    });
    const nextIndex = Math.min(activePageIndex, newPages.length - 1);
    commitDocUpdate({ ...doc, pages: newPages, updatedAt: Date.now() });
    setActivePageIndex(nextIndex);
  }

  async function handleAddPagesUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newPages: PageItem[] = [...doc.pages];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const { pages } = await importPdfFileToPages(file);
        for (const p of pages) {
          newPages.push({ ...p, pageNumber: newPages.length + 1 });
        }
        continue;
      }

      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      const adj = activePage?.adjustments || {
        brightness: 4,
        contrast: 15,
        sharpness: 20,
        warmth: 0,
        saturation: 0,
        shadowRemoval: true,
      };
      const processed = await processImage(dataUrl, activePage?.filter || 'magic', adj);
      const thumb = await createThumbnail(processed);

      newPages.push({
        id: 'p_' + Date.now() + '_' + i,
        originalDataUrl: dataUrl,
        processedDataUrl: processed,
        thumbnailUrl: thumb,
        pageNumber: newPages.length + 1,
        rotation: 0,
        filter: activePage?.filter || 'magic',
        label: `Page ${newPages.length + 1}`,
        adjustments: { ...adj },
        createdAt: Date.now(),
      });
    }

    commitDocUpdate({ ...doc, pages: newPages, updatedAt: Date.now() });
    setActivePageIndex(newPages.length - 1);
    showToast('Added uploaded page(s)');
  }

  function handleResetSliders() {
    if (!activePage) return;
    const updatedPages = [...doc.pages];
    updatedPages[activePageIndex] = {
      ...updatedPages[activePageIndex],
      adjustments: {
        brightness: 0,
        contrast: 0,
        sharpness: 0,
        warmth: 0,
        saturation: 0,
        shadowRemoval: true,
        shadowStrength: 88,
      },
    };
    setDoc({ ...doc, pages: updatedPages });
  }

  // ANNOTATION HANDLERS
  function getNormCoords(e: React.PointerEvent<HTMLDivElement>): { x: number; y: number } {
    const el = viewportOverlayRef.current;
    if (!el) return { x: 0.5, y: 0.5 };
    const rect = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }

  function pushAnnotation(ann: PageAnnotation) {
    if (!activePage) return;
    const updatedPages = [...doc.pages];
    const existing = updatedPages[activePageIndex].annotations || [];
    updatedPages[activePageIndex] = {
      ...updatedPages[activePageIndex],
      annotations: [...existing, ann],
    };
    commitDocUpdate({ ...doc, pages: updatedPages, updatedAt: Date.now() });
  }

  function handleOverlayPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (activeTab !== 'annotate' || annotateTool === 'select' || !activePage) return;
    e.stopPropagation();
    const pt = getNormCoords(e);

    if (annotateTool === 'pen' || annotateTool === 'highlighter') {
      viewportOverlayRef.current?.setPointerCapture(e.pointerId);
      setDrawingStroke([pt]);
    } else if (annotateTool === 'text') {
      const content = pendingTextNote.trim() || 'Note';
      pushAnnotation({
        id: 'ann_' + Date.now(),
        type: 'text',
        color: annotateColor,
        x: Math.max(0.05, Math.min(0.8, pt.x)),
        y: Math.max(0.05, Math.min(0.9, pt.y)),
        text: content,
        fontSize: 28,
        createdAt: Date.now(),
      });
      setAnnotateTool('select');
      showToast('Added text note');
    } else if (annotateTool === 'stamp') {
      const label =
        selectedStampText === 'DATE'
          ? new Date().toLocaleDateString()
          : selectedStampText;
      pushAnnotation({
        id: 'ann_' + Date.now(),
        type: 'stamp',
        color: selectedStampText === 'APPROVED' || selectedStampText === 'PAID' ? '#278A68' : '#C94E5B',
        x: Math.max(0.04, Math.min(0.7, pt.x - 0.13)),
        y: Math.max(0.04, Math.min(0.88, pt.y - 0.035)),
        width: 0.26,
        height: 0.07,
        text: label,
        createdAt: Date.now(),
      });
      setAnnotateTool('select');
      showToast(`Placed ${label} stamp`);
    }
  }

  function handleOverlayPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (draggingAnnId && activePage) {
      e.stopPropagation();
      const pt = getNormCoords(e);
      const updatedPages = [...doc.pages];
      const anns = (updatedPages[activePageIndex].annotations || []).map((a) =>
        a.id === draggingAnnId
          ? {
              ...a,
              x: Math.max(0, Math.min(0.88, pt.x - dragOffsetRef.current.dx)),
              y: Math.max(0, Math.min(0.92, pt.y - dragOffsetRef.current.dy)),
            }
          : a
      );
      updatedPages[activePageIndex] = { ...updatedPages[activePageIndex], annotations: anns };
      setDoc({ ...doc, pages: updatedPages });
      return;
    }

    if (drawingStroke) {
      e.stopPropagation();
      const pt = getNormCoords(e);
      setDrawingStroke((prev) => (prev ? [...prev, pt] : [pt]));
    }
  }

  function handleOverlayPointerUp() {
    if (draggingAnnId) {
      setDraggingAnnId(null);
      commitDocUpdate({ ...doc, updatedAt: Date.now() });
      return;
    }

    if (drawingStroke && drawingStroke.length > 1) {
      pushAnnotation({
        id: 'ann_' + Date.now(),
        type: annotateTool === 'highlighter' ? 'highlighter' : 'pen',
        color: annotateTool === 'highlighter' ? '#FACC15' : annotateColor,
        strokeWidth: annotateTool === 'highlighter' ? 0.025 : 0.005,
        opacity: annotateTool === 'highlighter' ? 0.42 : 1,
        points: drawingStroke,
        createdAt: Date.now(),
      });
    }
    setDrawingStroke(null);
  }

  function handleUndoAnnotation() {
    if (!activePage || !activePage.annotations?.length) return;
    const updatedPages = [...doc.pages];
    updatedPages[activePageIndex] = {
      ...updatedPages[activePageIndex],
      annotations: activePage.annotations.slice(0, -1),
    };
    commitDocUpdate({ ...doc, pages: updatedPages, updatedAt: Date.now() });
  }

  function handleClearAnnotations() {
    if (!activePage || !activePage.annotations?.length) return;
    const updatedPages = [...doc.pages];
    updatedPages[activePageIndex] = {
      ...updatedPages[activePageIndex],
      annotations: [],
    };
    commitDocUpdate({ ...doc, pages: updatedPages, updatedAt: Date.now() });
  }

  function handleInsertSignature(sigDataUrl: string) {
    pushAnnotation({
      id: 'ann_sig_' + Date.now(),
      type: 'signature',
      color: '#1E3A8A',
      x: 0.56,
      y: 0.74,
      width: 0.3,
      height: 0.12,
      signatureDataUrl: sigDataUrl,
      createdAt: Date.now(),
    });
    setIsSignaturePadOpen(false);
    setActiveTab('annotate');
    setAnnotateTool('select');
    showToast('Signature added — drag to reposition');
  }

  // OCR & SMART NAMING HANDLERS
  async function handleRunOcr(scope: 'current' | 'all') {
    setIsOcrRunning(true);
    setOcrError(null);
    try {
      const targetPages = scope === 'all' ? doc.pages.slice(0, 6) : [activePage];
      const images = targetPages.map((p) => p.processedDataUrl || p.originalDataUrl);
      const result = await runDocumentOcr(images, ocrLangHint);

      const updatedPages = [...doc.pages];
      if (scope === 'current') {
        const resPage = result.pages[0];
        if (resPage) {
          updatedPages[activePageIndex] = {
            ...updatedPages[activePageIndex],
            extractedText: resPage.text,
            ocrLanguage: resPage.language,
            ocrBlocks: resPage.blocks,
          };
        }
      } else {
        result.pages.forEach((resPage, i) => {
          if (updatedPages[i]) {
            updatedPages[i] = {
              ...updatedPages[i],
              extractedText: resPage.text,
              ocrLanguage: resPage.language,
              ocrBlocks: resPage.blocks,
            };
          }
        });
      }

      const combinedText = updatedPages
        .map((p) => p.extractedText || '')
        .filter(Boolean)
        .join('\n\n');

      const mergedTags = Array.from(
        new Set([...(doc.tags || []), ...(result.suggestedTags || [])])
      ).slice(0, 8);

      commitDocUpdate({
        ...doc,
        pages: updatedPages,
        extractedText: combinedText,
        ocrStatus: 'done',
        ocrLanguage: result.detectedLanguage as OcrLanguage,
        suggestedTitles: result.suggestedTitles,
        tags: mergedTags,
        updatedAt: Date.now(),
      });
      showToast('OCR text & smart names extracted');
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'OCR failed.');
    } finally {
      setIsOcrRunning(false);
    }
  }

  async function handleSuggestNamesOnly() {
    setIsOcrRunning(true);
    setOcrError(null);
    try {
      const res = await suggestDocumentNames({
        text: activePage?.extractedText || doc.extractedText,
        image:
          !activePage?.extractedText && !doc.extractedText
            ? activePage?.processedDataUrl || activePage?.originalDataUrl
            : undefined,
        scanMode: doc.scanMode,
      });
      commitDocUpdate({
        ...doc,
        suggestedTitles: res.suggestedTitles,
        tags: Array.from(new Set([...(doc.tags || []), ...(res.suggestedTags || [])])).slice(0, 8),
        updatedAt: Date.now(),
      });
      showToast('Updated filename suggestions');
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'Could not suggest names.');
    } finally {
      setIsOcrRunning(false);
    }
  }

  async function handleCopyText(text: string, key: string) {
    if (!text.trim()) return;
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  }

  function handleAddTag(e: React.FormEvent) {
    e.preventDefault();
    const clean = newTagInput.trim();
    if (!clean) return;
    if (!doc.tags.includes(clean)) {
      commitDocUpdate({ ...doc, tags: [...doc.tags, clean], updatedAt: Date.now() });
    }
    setNewTagInput('');
  }

  function handleRemoveTag(tag: string) {
    commitDocUpdate({
      ...doc,
      tags: doc.tags.filter((t) => t !== tag),
      updatedAt: Date.now(),
    });
  }

  const activeAnnotations = activePage?.annotations || [];

  return (
    <div className="fixed inset-0 z-40 bg-slate-950 flex flex-col text-slate-100 select-none">
      {toastMessage && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold shadow-xl flex items-center gap-2">
          <Check className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* TOP BAR */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-[#E6E6EB] z-20 gap-3">
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-lg flex items-center justify-center bg-[#FAFAFC] hover:bg-[#F5F3FF] text-[#1C1B22] border border-[#E6E6EB] transition-colors shrink-0"
          title="Back to Documents"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex-1 min-w-0 max-w-xl">
          <input
            type="text"
            value={doc.title}
            onChange={(e) => commitDocUpdate({ ...doc, title: e.target.value, updatedAt: Date.now() })}
            className="w-full bg-transparent hover:bg-[#FAFAFC] focus:bg-[#FAFAFC] px-2 py-0.5 rounded text-sm font-bold text-[#1C1B22] focus:outline-none focus:ring-1 focus:ring-[#7C3AED] truncate border border-transparent focus:border-[#7C3AED]"
          />
          <div className="flex items-center gap-2 px-2 mt-0.5 text-xs text-[#666672]">
            <FolderIcon className="w-3.5 h-3.5 text-[#666672]" />
            <select
              value={doc.folderId}
              onChange={(e) => commitDocUpdate({ ...doc, folderId: e.target.value, updatedAt: Date.now() })}
              aria-label="Select folder"
              className="bg-transparent text-[#666672] hover:text-[#1C1B22] text-xs focus:outline-none cursor-pointer"
            >
              {folders.map((f) => (
                <option key={f.id} value={f.id} className="bg-white text-[#1C1B22]">
                  {f.name}
                </option>
              ))}
            </select>
            <span>·</span>
            <span className="font-mono text-[#666672] tabular-nums">
              {doc.pages.length} {doc.pages.length === 1 ? 'page' : 'pages'}
            </span>
            {doc.ocrStatus === 'done' && (
              <>
                <span>·</span>
                <span className="text-[#16A34A] font-medium">OCR Ready</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() =>
              commitDocUpdate({ ...doc, isFavorite: !doc.isFavorite, updatedAt: Date.now() })
            }
            className={`w-9 h-9 rounded-lg flex items-center justify-center border transition-colors ${
              doc.isFavorite
                ? 'bg-amber-50 border-amber-300 text-amber-500'
                : 'bg-[#FAFAFC] border-[#E6E6EB] text-[#666672] hover:text-amber-500'
            }`}
            title={doc.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
          >
            <Star className={`w-4 h-4 ${doc.isFavorite ? 'fill-amber-400' : ''}`} />
          </button>

          <button
            onClick={() => onOpenExport(doc)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] active:bg-[#5B21B6] text-white font-semibold text-xs transition-colors whitespace-nowrap"
          >
            <Share2 className="w-4 h-4" />
            <span className="hidden sm:inline">Export PDF / PNG</span>
            <span className="sm:hidden">Export</span>
          </button>
        </div>
      </div>

      {/* MAIN VIEWPORT WITH LIVE ANNOTATIONS OVERLAY */}
      <div className="relative flex-1 bg-[#1C1B22] flex items-center justify-center overflow-auto p-4 md:p-6">
        {activePage && (
          <div
            className="relative inline-block transition-transform duration-200"
            style={{
              transform: `scale(${zoomLevel})`,
              transformOrigin: 'center center',
            }}
          >
            <img
              src={
                isComparingOriginal
                  ? activePage.originalDataUrl
                  : activePage.processedDataUrl || activePage.originalDataUrl
              }
              alt={`Page ${activePageIndex + 1}`}
              onClick={() => {
                if (activeTab !== 'annotate') setZoomLevel((z) => (z === 1 ? 1.8 : 1));
              }}
              className={`max-h-[55vh] max-w-full object-contain rounded-lg shadow-2xl border border-slate-700 bg-white block ${
                activeTab !== 'annotate'
                  ? zoomLevel > 1
                    ? 'cursor-zoom-out'
                    : 'cursor-zoom-in'
                  : ''
              }`}
            />

            {/* INTERACTIVE ANNOTATION LAYER */}
            {!isComparingOriginal && (
              <div
                ref={viewportOverlayRef}
                onPointerDown={handleOverlayPointerDown}
                onPointerMove={handleOverlayPointerMove}
                onPointerUp={handleOverlayPointerUp}
                className={`absolute inset-0 rounded-lg overflow-hidden ${
                  activeTab === 'annotate'
                    ? annotateTool === 'select'
                      ? 'cursor-default'
                      : 'cursor-crosshair touch-none'
                    : 'pointer-events-none'
                }`}
              >
                {/* Vector SVG Layer for Pen & Highlighter */}
                <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="w-full h-full absolute inset-0 pointer-events-none">
                  {activeAnnotations
                    .filter((a) => (a.type === 'pen' || a.type === 'highlighter') && a.points && a.points.length > 1)
                    .map((ann) => {
                      const d = ann
                        .points!.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x * 1000} ${p.y * 1000}`)
                        .join(' ');
                      return (
                        <path
                          key={ann.id}
                          d={d}
                          fill="none"
                          stroke={ann.color}
                          strokeWidth={(ann.strokeWidth ?? 0.005) * 1000}
                          strokeOpacity={ann.opacity ?? 1}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      );
                    })}

                  {drawingStroke && drawingStroke.length > 1 && (
                    <path
                      d={drawingStroke
                        .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x * 1000} ${p.y * 1000}`)
                        .join(' ')}
                      fill="none"
                      stroke={annotateTool === 'highlighter' ? '#FACC15' : annotateColor}
                      strokeWidth={annotateTool === 'highlighter' ? 25 : 5}
                      strokeOpacity={annotateTool === 'highlighter' ? 0.42 : 1}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                </svg>

                {/* Draggable Text, Stamps & Signatures */}
                {activeAnnotations
                  .filter((a) => a.type === 'text' || a.type === 'stamp' || a.type === 'signature')
                  .map((ann) => (
                    <div
                      key={ann.id}
                      onPointerDown={(e) => {
                        if (activeTab !== 'annotate') return;
                        e.stopPropagation();
                        const pt = getNormCoords(e);
                        dragOffsetRef.current = {
                          dx: pt.x - (ann.x ?? 0),
                          dy: pt.y - (ann.y ?? 0),
                        };
                        setDraggingAnnId(ann.id);
                      }}
                      style={{
                        left: `${(ann.x ?? 0.2) * 100}%`,
                        top: `${(ann.y ?? 0.2) * 100}%`,
                        width: ann.width ? `${ann.width * 100}%` : undefined,
                        height: ann.height ? `${ann.height * 100}%` : undefined,
                      }}
                      className={`absolute ${
                        activeTab === 'annotate' ? 'cursor-move hover:ring-2 hover:ring-[#7C3AED] rounded' : ''
                      }`}
                    >
                      {ann.type === 'text' && (
                        <span
                          className="font-semibold text-xs sm:text-sm whitespace-pre-wrap px-1"
                          style={{ color: ann.color }}
                        >
                          {ann.text}
                        </span>
                      )}

                      {ann.type === 'stamp' && (
                        <div
                          className="w-full h-full border-2 flex items-center justify-center font-extrabold text-[10px] sm:text-xs tracking-wider -rotate-3 bg-white/40"
                          style={{ borderColor: ann.color, color: ann.color }}
                        >
                          {ann.text}
                        </div>
                      )}

                      {ann.type === 'signature' && ann.signatureDataUrl && (
                        <img
                          src={ann.signatureDataUrl}
                          alt="Signature"
                          className="w-full h-full object-contain pointer-events-none"
                        />
                      )}
                    </div>
                  ))}
              </div>
            )}

            {isComparingOriginal && (
              <div className="absolute top-4 left-4 px-3 py-1 rounded-md bg-[#1C1B22]/90 backdrop-blur-md text-violet-200 text-xs font-bold border border-[#7C3AED]/50 shadow-md">
                RAW ORIGINAL (UNENHANCED)
              </div>
            )}
          </div>
        )}

        {/* Floating Viewport Quick Actions */}
        <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
          <button
            onPointerDown={() => setIsComparingOriginal(true)}
            onPointerUp={() => setIsComparingOriginal(false)}
            onPointerLeave={() => setIsComparingOriginal(false)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/95 hover:bg-[#F5F3FF] border border-[#E6E6EB] text-[#1C1B22] text-xs font-semibold backdrop-blur-md shadow-md active:bg-[#7C3AED] active:text-white transition-colors"
            title="Press and hold to see unenhanced original photo"
          >
            <Eye className="w-4 h-4 text-[#7C3AED]" />
            <span className="hidden sm:inline">Hold to Compare</span>
          </button>

          <button
            onClick={() => setIsCropOpen(true)}
            className="w-10 h-10 rounded-lg flex items-center justify-center bg-white/95 hover:bg-[#F5F3FF] border border-[#E6E6EB] text-[#1C1B22] hover:text-[#7C3AED] backdrop-blur-md shadow-md transition-colors"
            title="Crop & Correct Perspective Corners"
          >
            <Crop className="w-4 h-4" />
          </button>

          <button
            onClick={handleRotate}
            className="w-10 h-10 rounded-lg flex items-center justify-center bg-white/95 hover:bg-[#F5F3FF] border border-[#E6E6EB] text-[#1C1B22] hover:text-[#7C3AED] backdrop-blur-md shadow-md transition-colors"
            title="Rotate 90 degrees"
          >
            <RotateCw className="w-4 h-4" />
          </button>

          <button
            onClick={() => setZoomLevel((z) => (z === 1 ? 1.8 : 1))}
            className="w-10 h-10 rounded-lg flex items-center justify-center bg-white/95 hover:bg-[#F5F3FF] border border-[#E6E6EB] text-[#1C1B22] hover:text-[#7C3AED] backdrop-blur-md shadow-md transition-colors"
            title="Toggle Zoom"
          >
            {zoomLevel === 1 ? <ZoomIn className="w-4 h-4" /> : <ZoomOut className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* CONTROLS TOOLBAR: Presets / Adjust / Annotate & Sign / OCR & Tags */}
      <div className="bg-white border-t border-[#E6E6EB] px-4 py-3 z-20 max-h-[36vh] overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-1 p-1 bg-[#FAFAFC] rounded-lg border border-[#E6E6EB] overflow-x-auto">
            {[
              { id: 'presets', label: 'Presets', icon: Layers },
              { id: 'adjust', label: 'Adjust', icon: Sliders },
              { id: 'annotate', label: 'Sign & Annotate', icon: PenTool },
              { id: 'ocr', label: 'OCR & Tags', icon: ScanText },
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as EditorTab)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                    activeTab === tab.id
                      ? 'bg-[#7C3AED] text-white'
                      : 'text-[#666672] hover:text-[#1C1B22]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {doc.pages.length > 1 && (activeTab === 'presets' || activeTab === 'adjust') && (
            <button
              onClick={handleApplyToAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F5F3FF] hover:bg-[#7C3AED] hover:text-white border border-[#DDD6FE] text-[#7C3AED] text-xs font-semibold transition-colors"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Apply to All ({doc.pages.length})</span>
            </button>
          )}
        </div>

        {/* TAB 1: PRESETS */}
        {activeTab === 'presets' && (
          <div className="grid grid-cols-5 gap-2 max-w-2xl mx-auto">
            {(
              [
                { id: 'original', name: 'Original', desc: 'Preserved Raw' },
                { id: 'magic', name: 'Magic Color', desc: 'Shadow Free' },
                { id: 'bw', name: 'B&W Pure', desc: 'Adaptive Ink' },
                { id: 'grayscale', name: 'Grayscale', desc: 'Clean Tone' },
                { id: 'eco', name: 'Eco Light', desc: 'Toner Saver' },
              ] as const
            ).map((item) => {
              const active = (activePage?.filter || 'magic') === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleSelectFilter(item.id)}
                  className={`flex flex-col items-center justify-center p-2 rounded-lg border text-center transition-all ${
                    active
                      ? 'bg-[#F5F3FF] border-[#7C3AED] text-[#7C3AED] font-semibold'
                      : 'bg-[#FAFAFC] border-[#E6E6EB] text-[#1C1B22] hover:border-[#DDD6FE]'
                  }`}
                >
                  <span className="text-xs font-semibold">{item.name}</span>
                  <span className="text-[10px] text-[#666672] mt-0.5 hidden sm:block">{item.desc}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* TAB 2: FINE-TUNING + SHADOW & CREASE FLATTENING */}
        {activeTab === 'adjust' && (
          <div className="max-w-3xl mx-auto space-y-2.5 py-1">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <label className="flex items-center gap-2 text-[#1C1B22] font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={activePage?.adjustments?.shadowRemoval ?? activePage?.filter !== 'original'}
                  onChange={(e) => handleAdjustmentChange('shadowRemoval', e.target.checked)}
                  className="w-4 h-4 rounded accent-[#7C3AED]"
                />
                <span>Shadow &amp; Crease Flattening (Illumination Normalization)</span>
              </label>

              <div className="flex items-center gap-3">
                {(activePage?.adjustments?.shadowRemoval ?? activePage?.filter !== 'original') && (
                  <label className="flex items-center gap-2 text-[11px] text-[#666672]">
                    <span>Strength</span>
                    <input
                      type="range"
                      min={20}
                      max={100}
                      value={Number(activePage?.adjustments?.shadowStrength ?? 88)}
                      onChange={(e) => handleAdjustmentChange('shadowStrength', Number(e.target.value))}
                      className="w-20 accent-[#7C3AED]"
                    />
                    <span className="font-mono tabular-nums w-7 text-right">
                      {Number(activePage?.adjustments?.shadowStrength ?? 88)}%
                    </span>
                  </label>
                )}

                <button
                  onClick={handleResetSliders}
                  className="text-[#7C3AED] hover:underline text-[11px] font-medium"
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
              {[
                { key: 'brightness', label: 'Brightness', min: -100, max: 100 },
                { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
                { key: 'sharpness', label: 'Sharpness', min: 0, max: 100 },
                { key: 'saturation', label: 'Color Boost', min: -100, max: 100 },
                { key: 'warmth', label: 'Warmth', min: -50, max: 50 },
              ].map((sl) => {
                const val = Number(activePage?.adjustments?.[sl.key as keyof AdjustmentParams] ?? 0);
                return (
                  <div key={sl.key} className="bg-[#FAFAFC] p-2 rounded-lg border border-[#E6E6EB] flex flex-col gap-1">
                    <div className="flex justify-between items-center text-[#1C1B22]">
                      <span className="font-medium flex items-center gap-1">
                        {sl.key === 'brightness' && <Sun className="w-3 h-3 text-[#7C3AED]" />}
                        {sl.label}
                      </span>
                      <span className="font-mono text-[#666672] tabular-nums">{val}</span>
                    </div>
                    <input
                      type="range"
                      min={sl.min}
                      max={sl.max}
                      value={val}
                      onChange={(e) => handleAdjustmentChange(sl.key as keyof AdjustmentParams, Number(e.target.value))}
                      className="w-full accent-[#7C3AED]"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: ANNOTATIONS & SIGNATURES */}
        {activeTab === 'annotate' && (
          <div className="max-w-3xl mx-auto space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { id: 'select', label: 'Move', icon: MousePointer },
                  { id: 'pen', label: 'Pen', icon: PenTool },
                  { id: 'highlighter', label: 'Highlight', icon: Highlighter },
                  { id: 'text', label: 'Text', icon: TypeIcon },
                  { id: 'stamp', label: 'Stamp', icon: Stamp },
                ].map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setAnnotateTool(t.id as AnnotateTool)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                        annotateTool === t.id
                          ? 'bg-[#F5F3FF] border-[#7C3AED] text-[#7C3AED]'
                          : 'bg-[#FAFAFC] border-[#E6E6EB] text-[#1C1B22] hover:border-[#DDD6FE]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{t.label}</span>
                    </button>
                  );
                })}

                <button
                  onClick={() => setIsSignaturePadOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold"
                >
                  <PenTool className="w-3.5 h-3.5" />
                  <span>Add Signature</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                {['#1D4ED8', '#0F172A', '#C94E5B', '#278A68'].map((c) => (
                  <button
                    key={c}
                    onClick={() => setAnnotateColor(c)}
                    className={`w-5 h-5 rounded-full border-2 ${
                      annotateColor === c ? 'border-[#7C3AED] scale-110' : 'border-white'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <button
                  onClick={handleUndoAnnotation}
                  disabled={activeAnnotations.length === 0}
                  className="px-2.5 py-1.5 rounded-lg bg-[#FAFAFC] border border-[#E6E6EB] disabled:opacity-35 text-[#1C1B22] text-xs font-medium flex items-center gap-1"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  <span>Undo</span>
                </button>
                <button
                  onClick={handleClearAnnotations}
                  disabled={activeAnnotations.length === 0}
                  className="px-2.5 py-1.5 rounded-lg bg-[#FFF5F5] border border-[#FECACA] disabled:opacity-35 text-[#DC2626] text-xs font-medium"
                >
                  Clear
                </button>
              </div>
            </div>

            {annotateTool === 'text' && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[#666672] font-medium">Text to place (tap page):</span>
                <input
                  type="text"
                  value={pendingTextNote}
                  onChange={(e) => setPendingTextNote(e.target.value)}
                  className="px-2.5 py-1 rounded border border-[#E6E6EB] text-[#1C1B22] text-xs w-56 focus:outline-none focus:border-[#7C3AED]"
                />
              </div>
            )}

            {annotateTool === 'stamp' && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[#666672] font-medium">Stamp (tap page to place):</span>
                {['APPROVED', 'PAID', 'CONFIDENTIAL', 'VERIFIED', 'DATE'].map((s) => (
                  <button
                    key={s}
                    onClick={() => setSelectedStampText(s)}
                    className={`px-2.5 py-1 rounded border font-bold text-[11px] ${
                      selectedStampText === s
                        ? 'bg-[#F5F3FF] border-[#7C3AED] text-[#7C3AED]'
                        : 'bg-[#FAFAFC] border-[#E6E6EB] text-[#666672]'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: OCR (FR/EN) + COPY TEXT + AUTO NAMING + TAGS */}
        {activeTab === 'ocr' && (
          <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {/* Left: OCR Controls & Extracted Text */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <select
                    value={ocrLangHint}
                    onChange={(e) => setOcrLangHint(e.target.value as 'auto' | 'fr' | 'en')}
                    className="px-2.5 py-1.5 rounded-lg bg-[#FAFAFC] border border-[#E6E6EB] text-[#1C1B22] font-medium text-xs focus:outline-none focus:border-[#7C3AED]"
                  >
                    <option value="auto">Auto (FR / EN)</option>
                    <option value="fr">Français</option>
                    <option value="en">English</option>
                  </select>
                  <button
                    onClick={() => handleRunOcr('current')}
                    disabled={isOcrRunning}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-50 text-white font-semibold transition-colors"
                  >
                    {isOcrRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanText className="w-3.5 h-3.5" />}
                    <span>OCR Page {activePageIndex + 1}</span>
                  </button>
                  {doc.pages.length > 1 && (
                    <button
                      onClick={() => handleRunOcr('all')}
                      disabled={isOcrRunning}
                      className="px-3 py-1.5 rounded-lg bg-[#F5F3FF] hover:bg-[#7C3AED] hover:text-white border border-[#DDD6FE] text-[#7C3AED] font-semibold transition-colors"
                    >
                      All Pages
                    </button>
                  )}
                </div>

                {(activePage?.extractedText || doc.extractedText) && (
                  <button
                    onClick={() =>
                      handleCopyText(activePage?.extractedText || doc.extractedText || '', 'page')
                    }
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#FAFAFC] border border-[#E6E6EB] hover:border-[#7C3AED] text-[#1C1B22] font-semibold transition-colors"
                  >
                    {copiedKey === 'page' ? <Check className="w-3.5 h-3.5 text-[#16A34A]" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedKey === 'page' ? 'Copied' : 'Copy Text'}</span>
                  </button>
                )}
              </div>

              {ocrError && (
                <div className="p-2 rounded-lg bg-[#FFF5F5] border border-[#FECACA] text-[#DC2626] flex items-center gap-2 text-[11px]">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{ocrError}</span>
                </div>
              )}

              <textarea
                value={activePage?.extractedText || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  const updatedPages = [...doc.pages];
                  updatedPages[activePageIndex] = {
                    ...updatedPages[activePageIndex],
                    extractedText: val,
                  };
                  const full = updatedPages.map((p) => p.extractedText || '').filter(Boolean).join('\n\n');
                  commitDocUpdate({ ...doc, pages: updatedPages, extractedText: full, updatedAt: Date.now() });
                }}
                placeholder="Click 'OCR Page' to extract French or English text from this scan."
                rows={4}
                className="w-full p-2.5 rounded-lg bg-[#FAFAFC] border border-[#E6E6EB] text-[#1C1B22] text-xs focus:outline-none focus:border-[#7C3AED] resize-none select-text"
              />
            </div>

            {/* Right: Naming Suggestions & Tags */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#1C1B22] flex items-center gap-1.5">
                    <ScanText className="w-3.5 h-3.5 text-[#7C3AED]" />
                    <span>Filename suggestions</span>
                  </span>
                  <button
                    onClick={handleSuggestNamesOnly}
                    disabled={isOcrRunning}
                    className="text-[#7C3AED] hover:underline font-semibold text-[11px]"
                  >
                    Refresh
                  </button>
                </div>

                {doc.suggestedTitles && doc.suggestedTitles.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {doc.suggestedTitles.map((titleOpt) => (
                      <button
                        key={titleOpt}
                        onClick={() => {
                          commitDocUpdate({ ...doc, title: titleOpt, updatedAt: Date.now() });
                          showToast(`Renamed to "${titleOpt}"`);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-[#F5F3FF] hover:bg-[#7C3AED] hover:text-white border border-[#DDD6FE] text-[#7C3AED] text-[11px] font-semibold transition-colors text-left"
                      >
                        {titleOpt}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-[#666672]">
                    Run OCR or click Refresh for filename suggestions.
                  </p>
                )}
              </div>

              {/* Tags */}
              <div className="space-y-1.5">
                <span className="font-semibold text-[#1C1B22] flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-[#7C3AED]" />
                  <span>Document Tags</span>
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {doc.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#FAFAFC] border border-[#E6E6EB] text-[#1C1B22] text-[11px] font-medium"
                    >
                      <span>#{tag}</span>
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        className="text-[#666672] hover:text-[#DC2626]"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <form onSubmit={handleAddTag} className="inline-flex items-center gap-1">
                    <input
                      type="text"
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      placeholder="+ Add tag"
                      className="w-24 px-2 py-0.5 rounded-md border border-[#E6E6EB] text-[11px] text-[#1C1B22] focus:outline-none focus:border-[#7C3AED]"
                    />
                  </form>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* PAGE REORDERING & MANAGEMENT STRIP */}
      <div className="bg-white border-t border-[#E6E6EB] px-4 py-2.5 flex items-center justify-between gap-3 overflow-x-auto">
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => movePage(activePageIndex, activePageIndex - 1)}
            disabled={activePageIndex === 0}
            className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#FAFAFC] border border-[#E6E6EB] disabled:opacity-30 hover:bg-[#F5F3FF] text-[#666672] hover:text-[#1C1B22] transition-colors"
            title="Move Page Left"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => movePage(activePageIndex, activePageIndex + 1)}
            disabled={activePageIndex === doc.pages.length - 1}
            className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#FAFAFC] border border-[#E6E6EB] disabled:opacity-30 hover:bg-[#F5F3FF] text-[#666672] hover:text-[#1C1B22] transition-colors"
            title="Move Page Right"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {confirmExitSinglePage ? (
            <div className="flex items-center gap-1.5 bg-[#FFF5F5] border border-[#FECACA] rounded-lg px-2 py-1 text-[11px]">
              <span className="text-[#1C1B22] font-medium whitespace-nowrap">Only 1 page. Close editor?</span>
              <button
                onClick={onClose}
                className="px-2 py-0.5 rounded bg-[#7C3AED] text-white font-semibold hover:bg-[#6D28D9]"
              >
                Leave
              </button>
              <button
                onClick={() => setConfirmExitSinglePage(false)}
                className="px-2 py-0.5 rounded bg-white border border-[#E6E6EB] text-[#666672] font-medium hover:text-[#1C1B22]"
              >
                Stay
              </button>
            </div>
          ) : (
            <button
              onClick={handleDeletePage}
              className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#FAFAFC] border border-[#E6E6EB] hover:bg-[#FFF5F5] hover:text-[#DC2626] text-[#666672] transition-colors"
              title="Delete this page"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 overflow-x-auto py-1 scrollbar-none flex-1 justify-center">
          {doc.pages.map((page, idx) => {
            const isSelected = idx === activePageIndex;
            return (
              <button
                key={page.id}
                onClick={() => setActivePageIndex(idx)}
                className={`relative shrink-0 rounded-lg overflow-hidden border-2 transition-all ${
                  isSelected
                    ? 'border-[#7C3AED] scale-105 shadow-md'
                    : 'border-[#E6E6EB] hover:border-[#DDD6FE] opacity-80 hover:opacity-100'
                }`}
              >
                <img
                  src={page.thumbnailUrl || page.processedDataUrl || page.originalDataUrl}
                  alt={`Thumbnail ${idx + 1}`}
                  className="w-12 h-16 object-cover bg-white"
                />
                <span className="absolute bottom-0 inset-x-0 bg-[#1C1B22]/85 text-white font-mono text-[9px] text-center py-0.5 tabular-nums">
                  {idx + 1}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <input
            ref={addFileInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            onChange={handleAddPagesUpload}
            className="hidden"
          />
          <button
            onClick={() => addFileInputRef.current?.click()}
            className="px-3 py-1.5 rounded-lg bg-[#FAFAFC] hover:bg-[#F5F3FF] border border-[#E6E6EB] text-[#1C1B22] text-xs font-semibold flex items-center gap-1 transition-colors"
            title="Import image or PDF page"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Upload</span>
          </button>

          <button
            onClick={onAddPageWithCamera}
            className="px-3 py-1.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold flex items-center gap-1 transition-colors"
            title="Snap additional page with camera"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Camera</span>
          </button>
        </div>
      </div>

      {isCropOpen && activePage && (
        <CropPerspectiveModal
          imageDataUrl={activePage.originalDataUrl}
          initialCorners={activePage.cropCorners}
          onApplyCrop={(croppedUrl, corners) => {
            const updatedPages = [...doc.pages];
            updatedPages[activePageIndex] = {
              ...updatedPages[activePageIndex],
              originalDataUrl: croppedUrl,
              processedDataUrl: croppedUrl,
              cropCorners: corners,
            };
            commitDocUpdate({ ...doc, pages: updatedPages, updatedAt: Date.now() });
            setIsCropOpen(false);
          }}
          onClose={() => setIsCropOpen(false)}
        />
      )}

      {isSignaturePadOpen && (
        <SignaturePadModal
          onSelectSignature={handleInsertSignature}
          onClose={() => setIsSignaturePadOpen(false)}
        />
      )}
    </div>
  );
};
