import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Wifi, BatteryMedium, Smartphone, Code2 } from 'lucide-react';
import {
  ScannedDocument,
  FolderItem,
  ScanMode,
  PageItem,
  AppSettings,
  ExportEvent,
  AppScreen,
  AnalyticsTimeframe,
} from './types/scanner';
import {
  getFolders,
  saveFolder,
  deleteFolder,
  getAllDocuments,
  saveDocument,
  deleteDocument,
  moveDocumentToTrash,
  restoreDocumentFromTrash,
  emptyTrashDocuments,
  seedInitialDocumentsIfNeeded,
  getStorageEstimate,
  DetailedStorageStats,
  getAppSettings,
  saveAppSettings,
  getExportEvents,
  clearExportEvents,
  resetSampleSeedFlag,
  hasCompletedWelcome,
  setWelcomeCompleted,
} from './utils/storage';
import { importPdfFileToPages } from './utils/pdfGenerator';
import {
  detectDocumentAndTextCorners,
  perspectiveCrop,
  processImage,
  createThumbnail,
} from './utils/imageProcessing';
import { TopBar } from './components/TopBar';
import { SlideNavigationDrawer, PersistentSidebar } from './components/NavigationDrawer';
import { MobileBottomNav } from './components/MobileBottomNav';
import { HomeView } from './components/HomeView';
import { QuickActionFabSheet } from './components/ScanActionWidgets';
import { DocumentGrid } from './components/DocumentGrid';
import { CategoriesView } from './components/CategoriesView';
import { TrashView } from './components/TrashView';
import { AnalyticsView } from './components/AnalyticsView';
import { StorageOverviewView } from './components/StorageOverviewView';
import { SettingsView, HelpSupportView, AboutView } from './components/PreferencesViews';
import { CameraView } from './components/CameraView';
import { DocumentEditor } from './components/DocumentEditor';
import { ExportModal } from './components/ExportModal';
import { FolderManagerModal } from './components/FolderManagerModal';
import { AndroidNativeModal } from './components/AndroidNativeModal';
import { PdfWorkspaceModal } from './components/PdfWorkspaceModal';
import { SplashScreen } from './components/SplashScreen';
import { WelcomeScreen } from './components/WelcomeScreen';
import { OfflineIndicator } from './components/PWAInstallButton';

export default function App() {
  const [showSplash, setShowSplash] = useState<boolean>(true);
  const [isAppReady, setIsAppReady] = useState<boolean>(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState<boolean>(() => !hasCompletedWelcome());
  const [activeScreen, setActiveScreen] = useState<AppScreen>('home');
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState<boolean>(false);
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState<boolean>(true);
  const [isDesktopViewport, setIsDesktopViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );

  const [analyticsTimeframe, setAnalyticsTimeframe] = useState<AnalyticsTimeframe>('30d');
  const [searchFocusTrigger, setSearchFocusTrigger] = useState<number>(0);
  const [batchSelectedCount, setBatchSelectedCount] = useState<number>(0);

  const [appSettings, setAppSettings] = useState<AppSettings>(() => getAppSettings());
  const [exportEvents, setExportEvents] = useState<ExportEvent[]>(() => getExportEvents());

  const [documents, setDocuments] = useState<ScannedDocument[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [storageStats, setStorageStats] = useState<DetailedStorageStats>({
    usedBytes: 0,
    activeBytes: 0,
    trashedBytes: 0,
    originalBytes: 0,
    processedBytes: 0,
    thumbnailAndTextBytes: 0,
    count: 0,
    trashedCount: 0,
    browserQuotaBytes: null,
    browserUsageBytes: null,
  });

  const [isAndroidFrame, setIsAndroidFrame] = useState<boolean>(false);
  const [isAndroidNativeModalOpen, setIsAndroidNativeModalOpen] = useState<boolean>(false);

  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);
  const [cameraMode, setCameraMode] = useState<ScanMode>(appSettings.defaultScanMode);
  const [cameraTargetDocId, setCameraTargetDocId] = useState<string | null>(null);

  const [editingDoc, setEditingDoc] = useState<ScannedDocument | null>(null);
  const [exportingDoc, setExportingDoc] = useState<ScannedDocument | null>(null);
  const [isFolderManagerOpen, setIsFolderManagerOpen] = useState<boolean>(false);

  const [isPdfWorkspaceOpen, setIsPdfWorkspaceOpen] = useState<boolean>(false);
  const [pdfWorkspaceTab, setPdfWorkspaceTab] = useState<'merge' | 'split' | 'compress' | 'images'>('merge');
  const [pdfWorkspacePreselectedIds, setPdfWorkspacePreselectedIds] = useState<string[]>([]);

  const refreshData = useCallback(async () => {
    const loadedFolders = getFolders();
    setFolders(loadedFolders);

    const docs = await getAllDocuments();
    setDocuments(docs);

    const est = await getStorageEstimate();
    setStorageStats(est);
    setExportEvents(getExportEvents());
  }, []);

  const runAppInit = useCallback(async () => {
    setInitError(null);
    try {
      await seedInitialDocumentsIfNeeded();
      await refreshData();
      setIsAppReady(true);
    } catch (err) {
      console.error('Initialization failed:', err);
      setInitError('Could not access local document storage. Retry or continue with a temporary workspace.');
      setIsAppReady(true);
    }
  }, [refreshData]);

  useEffect(() => {
    runAppInit();
  }, [runAppInit]);

  useEffect(() => {
    function handleAnalyticsUpdate() {
      setExportEvents(getExportEvents());
    }
    function handleSettingsUpdate() {
      setAppSettings(getAppSettings());
    }
    window.addEventListener('nscanner:analytics-updated', handleAnalyticsUpdate);
    window.addEventListener('nscanner:settings-updated', handleSettingsUpdate);
    return () => {
      window.removeEventListener('nscanner:analytics-updated', handleAnalyticsUpdate);
      window.removeEventListener('nscanner:settings-updated', handleSettingsUpdate);
    };
  }, []);

  // Track responsive lg breakpoint for menu toggle behavior
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setIsDesktopViewport(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Sync browser history stack across app screens
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.history.state?.nscannerScreen) {
      window.history.replaceState({ nscannerScreen: 'home' }, '');
    }
    function handlePopState(e: PopStateEvent) {
      if (isCameraOpen) return;
      const prevScreen = e.state?.nscannerScreen as AppScreen | undefined;
      if (prevScreen) {
        setActiveScreen(prevScreen);
        setIsMobileDrawerOpen(false);
      }
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isCameraOpen]);

  const activeDocuments = useMemo(
    () => documents.filter((d) => !d.deletedAt),
    [documents]
  );

  const trashedDocuments = useMemo(
    () => documents.filter((d) => Boolean(d.deletedAt)),
    [documents]
  );

  const navigateTo = useCallback(
    (
      screen: AppScreen,
      options?: { folderId?: string | null; tag?: string | null }
    ) => {
      if (isCameraOpen) return;

      if (screen === 'documents') {
        setSelectedFolderId(options?.folderId ?? null);
        setSelectedTag(options?.tag ?? null);
      } else if (screen === 'recent' || screen === 'favorites') {
        setSelectedFolderId(null);
        setSelectedTag(null);
      }

      setActiveScreen(screen);
      setIsMobileDrawerOpen(false);

      if (typeof window !== 'undefined' && window.history.state?.nscannerScreen !== screen) {
        window.history.pushState({ nscannerScreen: screen }, '');
      }
    },
    [isCameraOpen]
  );

  function handleToggleMenu() {
    if (isCameraOpen) return;
    if (!isAndroidFrame && isDesktopViewport) {
      setIsDesktopSidebarOpen((prev) => !prev);
    } else {
      setIsMobileDrawerOpen((prev) => !prev);
    }
  }

  function handleStartScan(mode?: ScanMode) {
    setIsMobileDrawerOpen(false);
    setCameraMode(mode || appSettings.defaultScanMode);
    setCameraTargetDocId(null);
    setIsCameraOpen(true);
  }

  async function handleSaveFromCamera(title: string, mode: ScanMode, pages: PageItem[]) {
    if (cameraTargetDocId) {
      const targetDoc = documents.find((d) => d.id === cameraTargetDocId);
      if (targetDoc) {
        const mergedPages = [...targetDoc.pages, ...pages];
        mergedPages.forEach((p, idx) => {
          p.pageNumber = idx + 1;
        });
        const updated: ScannedDocument = {
          ...targetDoc,
          pages: mergedPages,
          updatedAt: Date.now(),
          lastOpenedAt: Date.now(),
        };
        await saveDocument(updated);
        await refreshData();
        setEditingDoc(updated);
      }
    } else {
      const newDocId = 'doc_' + Date.now();
      const defaultFolder =
        selectedFolderId && selectedFolderId !== 'all'
          ? selectedFolderId
          : mode === 'id_card'
          ? 'f_personal'
          : mode === 'receipt'
          ? 'f_receipts'
          : 'f_work';

      const newDoc: ScannedDocument = {
        id: newDocId,
        title,
        folderId: defaultFolder,
        scanMode: mode,
        pages,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastOpenedAt: Date.now(),
        tags: [mode.toUpperCase()],
        ocrStatus: 'none',
        sourceType: 'scan',
      };

      await saveDocument(newDoc);
      await refreshData();
      setEditingDoc(newDoc);
    }

    setIsCameraOpen(false);
  }

  async function handleOpenDocument(doc: ScannedDocument) {
    const opened: ScannedDocument = {
      ...doc,
      lastOpenedAt: Date.now(),
    };
    setEditingDoc(opened);
    await saveDocument(opened);
    setDocuments((prev) => prev.map((d) => (d.id === opened.id ? opened : d)));
  }

  async function handleUpdateDocument(updated: ScannedDocument) {
    await saveDocument(updated);
    setDocuments((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    const est = await getStorageEstimate();
    setStorageStats(est);
  }

  async function handleMoveToTrash(docId: string) {
    const target = documents.find((d) => d.id === docId);
    if (target) {
      await moveDocumentToTrash(target);
    }
    if (editingDoc?.id === docId) {
      setEditingDoc(null);
    }
    await refreshData();
  }

  async function handleRestoreFromTrash(doc: ScannedDocument) {
    await restoreDocumentFromTrash(doc);
    await refreshData();
  }

  async function handlePermanentDelete(docId: string) {
    await deleteDocument(docId);
    if (editingDoc?.id === docId) {
      setEditingDoc(null);
    }
    await refreshData();
  }

  async function handleEmptyTrash() {
    await emptyTrashDocuments(documents);
    await refreshData();
  }

  async function handleToggleFavorite(docId: string) {
    const target = documents.find((d) => d.id === docId);
    if (!target) return;
    const updated: ScannedDocument = {
      ...target,
      isFavorite: !target.isFavorite,
      updatedAt: Date.now(),
    };
    await handleUpdateDocument(updated);
  }

  async function handleBatchTrash(docIds: string[]) {
    for (const id of docIds) {
      const target = documents.find((d) => d.id === id);
      if (target) {
        await moveDocumentToTrash(target);
      }
    }
    await refreshData();
  }

  async function handleBatchMoveFolder(docIds: string[], folderId: string) {
    for (const id of docIds) {
      const target = documents.find((d) => d.id === id);
      if (target) {
        await saveDocument({ ...target, folderId, updatedAt: Date.now() });
      }
    }
    await refreshData();
  }

  async function handleBatchAddTag(docIds: string[], tag: string) {
    for (const id of docIds) {
      const target = documents.find((d) => d.id === id);
      if (target) {
        const nextTags = Array.from(new Set([...(target.tags || []), tag]));
        await saveDocument({ ...target, tags: nextTags, updatedAt: Date.now() });
      }
    }
    await refreshData();
  }

  function handleBatchMerge(docIds: string[]) {
    setPdfWorkspaceTab('merge');
    setPdfWorkspacePreselectedIds(docIds);
    setIsPdfWorkspaceOpen(true);
  }

  async function handleImportPdfFile(file: File) {
    const { pages, extractedText } = await importPdfFileToPages(file);
    const newDoc: ScannedDocument = {
      id: 'doc_pdf_' + Date.now(),
      title: file.name.replace(/\.pdf$/i, ''),
      folderId: selectedFolderId || 'f_work',
      scanMode: 'document',
      pages,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastOpenedAt: Date.now(),
      tags: ['Imported PDF'],
      extractedText: extractedText || undefined,
      ocrStatus: extractedText ? 'done' : 'none',
      sourceType: 'pdf_import',
    };
    await saveDocument(newDoc);
    await refreshData();
    setEditingDoc(newDoc);
  }

  async function handleImportGalleryImages(files: File[]) {
    const pages: PageItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      if (!dataUrl) continue;

      let corners;
      try {
        const detected = await detectDocumentAndTextCorners(dataUrl);
        corners = detected.corners;
      } catch {
        corners = {
          topLeft: { x: 0.04, y: 0.04 },
          topRight: { x: 0.96, y: 0.04 },
          bottomRight: { x: 0.96, y: 0.96 },
          bottomLeft: { x: 0.04, y: 0.96 },
        };
      }

      const warped = await perspectiveCrop(dataUrl, corners);
      const defaultAdjustments = {
        brightness: 0,
        contrast: 0,
        sharpness: 0,
        warmth: 0,
        saturation: 0,
        shadowRemoval: true,
      };
      const processed = await processImage(
        warped,
        appSettings.defaultFilter,
        defaultAdjustments,
        0
      );
      const thumbnailUrl = await createThumbnail(processed);
      pages.push({
        id: `page_${Date.now()}_${i}`,
        originalDataUrl: dataUrl,
        processedDataUrl: processed,
        thumbnailUrl,
        pageNumber: pages.length + 1,
        rotation: 0,
        filter: appSettings.defaultFilter,
        adjustments: defaultAdjustments,
        cropCorners: corners,
        createdAt: Date.now(),
      });
    }

    if (pages.length === 0) return;

    const firstBaseName = files[0].name.replace(/\.[^/.]+$/, '').trim();
    const newDoc: ScannedDocument = {
      id: 'doc_gal_' + Date.now(),
      title:
        files.length === 1 && firstBaseName
          ? firstBaseName
          : `Gallery Import · ${new Date().toLocaleDateString()}`,
      folderId: selectedFolderId || 'f_work',
      scanMode: 'document',
      pages,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastOpenedAt: Date.now(),
      tags: ['Gallery'],
      ocrStatus: 'none',
      sourceType: 'scan',
    };
    await saveDocument(newDoc);
    await refreshData();
    setEditingDoc(newDoc);
  }

  async function handleSaveNewWorkspaceDoc(newDoc: ScannedDocument) {
    await saveDocument(newDoc);
    await refreshData();
  }

  function handleAddPageWithCamera() {
    if (!editingDoc) return;
    setCameraTargetDocId(editingDoc.id);
    setCameraMode(editingDoc.scanMode);
    setIsCameraOpen(true);
  }

  function handleSaveFolder(folder: FolderItem) {
    const updated = saveFolder(folder);
    setFolders(updated);
  }

  function handleDeleteFolder(folderId: string) {
    const updated = deleteFolder(folderId);
    setFolders(updated);
    if (selectedFolderId === folderId) {
      setSelectedFolderId(null);
    }
  }

  async function handleReloadSamples() {
    resetSampleSeedFlag();
    await seedInitialDocumentsIfNeeded();
    await refreshData();
  }

  function getScreenTitle(): string {
    switch (activeScreen) {
      case 'home':
        return 'Home';
      case 'documents':
        if (selectedTag) return `#${selectedTag}`;
        if (selectedFolderId) {
          return folders.find((f) => f.id === selectedFolderId)?.name || 'My Documents';
        }
        return 'My Documents';
      case 'recent':
        return 'Recent Documents';
      case 'favorites':
        return 'Favorites';
      case 'categories':
        return 'Categories';
      case 'trash':
        return 'Trash';
      case 'analytics':
        return 'Analytics';
      case 'storage':
        return 'Storage Overview';
      case 'settings':
        return 'Settings';
      case 'help':
        return 'Help & Support';
      case 'about':
        return 'About NScanner';
    }
  }

  function renderActiveScreen(containedPreview: boolean) {
    switch (activeScreen) {
      case 'home':
        return (
          <HomeView
            documents={activeDocuments}
            folders={folders}
            storageStats={storageStats}
            exportCount={exportEvents.length}
            defaultScanMode={appSettings.defaultScanMode}
            onStartScan={(m) => handleStartScan(m)}
            onSelectDocument={handleOpenDocument}
            onOpenExport={(doc) => setExportingDoc(doc)}
            onImportPdfFile={handleImportPdfFile}
            onImportGalleryImages={handleImportGalleryImages}
            onOpenPdfWorkspace={() => {
              setPdfWorkspaceTab('merge');
              setPdfWorkspacePreselectedIds([]);
              setIsPdfWorkspaceOpen(true);
            }}
            onNavigateDocuments={() => navigateTo('documents')}
            onNavigateCategories={() => navigateTo('categories')}
            onNavigateAnalytics={() => navigateTo('analytics')}
          />
        );

      case 'documents':
      case 'recent':
      case 'favorites':
        return (
          <DocumentGrid
            documents={activeDocuments}
            folders={folders}
            selectedFolderId={activeScreen === 'documents' ? selectedFolderId : null}
            selectedSmartView={
              activeScreen === 'favorites'
                ? 'favorites'
                : activeScreen === 'recent'
                ? 'recent'
                : 'all'
            }
            selectedTag={activeScreen === 'documents' ? selectedTag : null}
            searchTrigger={searchFocusTrigger}
            containedPreview={containedPreview}
            onSelectFolderFilter={
              activeScreen === 'documents' ? (fid) => setSelectedFolderId(fid) : undefined
            }
            onClearTagFilter={
              activeScreen === 'documents' && selectedTag
                ? () => setSelectedTag(null)
                : undefined
            }
            onSelectDocument={handleOpenDocument}
            onOpenExport={(doc) => setExportingDoc(doc)}
            onDeleteDocument={handleMoveToTrash}
            onToggleFavorite={handleToggleFavorite}
            onBatchDelete={handleBatchTrash}
            onBatchMoveFolder={handleBatchMoveFolder}
            onBatchAddTag={handleBatchAddTag}
            onBatchMerge={handleBatchMerge}
            onImportPdfFile={handleImportPdfFile}
            onOpenPdfWorkspace={() => {
              setPdfWorkspaceTab('merge');
              setPdfWorkspacePreselectedIds([]);
              setIsPdfWorkspaceOpen(true);
            }}
            onStartScan={(m) => handleStartScan(m)}
            onLoadSamples={handleReloadSamples}
            onBatchSelectionChange={setBatchSelectedCount}
          />
        );

      case 'categories':
        return (
          <CategoriesView
            folders={folders}
            documents={activeDocuments}
            onSelectFolder={(folderId) => navigateTo('documents', { folderId })}
            onSelectTag={(tag) => navigateTo('documents', { tag })}
            onOpenFolderManager={() => setIsFolderManagerOpen(true)}
          />
        );

      case 'trash':
        return (
          <TrashView
            trashedDocuments={trashedDocuments}
            folders={folders}
            onRestore={handleRestoreFromTrash}
            onDeleteForever={handlePermanentDelete}
            onEmptyTrash={handleEmptyTrash}
          />
        );

      case 'analytics':
        return (
          <AnalyticsView
            documents={activeDocuments}
            folders={folders}
            exportEvents={exportEvents}
            storageStats={storageStats}
            timeframe={analyticsTimeframe}
            onTimeframeChange={setAnalyticsTimeframe}
            onOpenStorageOverview={() => navigateTo('storage')}
            onStartScan={(m) => handleStartScan(m)}
            onSelectDocument={handleOpenDocument}
          />
        );

      case 'storage':
        return (
          <StorageOverviewView
            documents={activeDocuments}
            trashedDocuments={trashedDocuments}
            folders={folders}
            storageStats={storageStats}
            exportCount={exportEvents.length}
            onOpenTrash={() => navigateTo('trash')}
            onOpenAnalytics={() => navigateTo('analytics')}
            onClearExportLog={() => {
              clearExportEvents();
              setExportEvents([]);
            }}
          />
        );

      case 'settings':
        return (
          <SettingsView
            settings={appSettings}
            isAndroidFrame={isAndroidFrame}
            onToggleAndroidFrame={() => setIsAndroidFrame((prev) => !prev)}
            onUpdateSettings={(next) => {
              saveAppSettings(next);
              setAppSettings(next);
            }}
            onReloadSamples={handleReloadSamples}
            onClearExportHistory={() => {
              clearExportEvents();
              setExportEvents([]);
            }}
            onOpenAndroidNativeModal={() => setIsAndroidNativeModalOpen(true)}
            onOpenStorageOverview={() => navigateTo('storage')}
            onReplayWelcome={() => {
              setWelcomeCompleted(false);
              setShowWelcome(true);
            }}
          />
        );

      case 'help':
        return (
          <HelpSupportView
            storageStats={storageStats}
            onStartScan={() => handleStartScan()}
          />
        );

      case 'about':
        return <AboutView />;
    }
  }

  const isMenuCurrentlyOpen =
    !isAndroidFrame && isDesktopViewport ? isDesktopSidebarOpen : isMobileDrawerOpen;

  const showQuickFab =
    !isCameraOpen &&
    !editingDoc &&
    !exportingDoc &&
    !isFolderManagerOpen &&
    !isPdfWorkspaceOpen &&
    !isAndroidNativeModalOpen &&
    batchSelectedCount === 0 &&
    (activeScreen === 'documents' ||
      activeScreen === 'recent' ||
      activeScreen === 'favorites' ||
      activeScreen === 'categories');

  function handleGetStarted() {
    setWelcomeCompleted(true);
    setShowWelcome(false);
    setActiveScreen('home');
  }

  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#1C1B22] flex flex-col antialiased">
      {showSplash && (
        <SplashScreen
          isReady={isAppReady}
          errorMessage={initError}
          onRetry={runAppInit}
          onComplete={() => setShowSplash(false)}
        />
      )}

      {showWelcome ? (
        showSplash ? null : <WelcomeScreen onGetStarted={handleGetStarted} />
      ) : isAndroidFrame ? (
        <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 bg-[#FAFAFC]">
          <div className="flex items-center gap-3 mb-4 flex-wrap justify-center">
            <button
              onClick={() => setIsAndroidFrame(false)}
              className="px-3 py-1.5 rounded-lg bg-[#7C3AED] text-white text-xs font-semibold flex items-center gap-1.5"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Exit Mobile Preview</span>
            </button>
            <button
              onClick={() => setIsAndroidNativeModalOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-[#F5F3FF] border border-[#DDD6FE] text-[#7C3AED] text-xs font-semibold hover:bg-[#7C3AED] hover:text-white flex items-center gap-1.5 transition-colors"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Android Kotlin Code</span>
            </button>
          </div>

          <div className="relative w-full max-w-[390px] h-[780px] bg-white rounded-[48px] border-[10px] border-[#1C1B22] shadow-[0_20px_50px_rgba(28,27,34,0.16)] flex flex-col overflow-hidden">
            {/* Phone Speaker/Camera Notch */}
            <div className="absolute top-3 left-1/2 -translate-x-1/2 w-4 h-4 bg-[#1C1B22] rounded-full z-40 border border-slate-700 flex items-center justify-center">
              <div className="w-1.5 h-1.5 bg-slate-800 rounded-full" />
            </div>

            {/* Simulated Android Status Bar */}
            <div className="h-10 px-6 flex items-center justify-between text-xs text-[#666672] shrink-0 select-none z-30 pt-1 bg-white border-b border-[#E6E6EB]">
              <span className="font-semibold text-[11px] font-mono text-[#1C1B22] tabular-nums">11:45</span>
              <div className="flex items-center gap-2 text-[#666672]">
                <Wifi className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold">5G</span>
                <BatteryMedium className="w-4 h-4" />
              </div>
            </div>

            {/* Contained NScanner Header */}
            <TopBar
              activeScreen={activeScreen}
              screenTitle={getScreenTitle()}
              onToggleMenu={handleToggleMenu}
              isMenuOpen={isMobileDrawerOpen}
              disabled={isCameraOpen}
              onFocusSearch={() => setSearchFocusTrigger((n) => n + 1)}
              onOpenFolderManager={() => setIsFolderManagerOpen(true)}
              trashedCount={trashedDocuments.length}
              onEmptyTrash={handleEmptyTrash}
              analyticsTimeframe={analyticsTimeframe}
              onChangeTimeframe={setAnalyticsTimeframe}
            />

            {/* Contained Scrollable Screen Body */}
            <div className="flex-1 overflow-y-auto px-4 py-4 bg-[#FAFAFC]">
              {renderActiveScreen(true)}
            </div>

            {/* Contained Bottom Navigation */}
            <MobileBottomNav
              activeScreen={activeScreen}
              onSelectScreen={(s) => navigateTo(s)}
              onStartScan={() => handleStartScan()}
              contained={true}
              disabled={isCameraOpen}
            />

            {/* Contained Slide Navigation Drawer */}
            <SlideNavigationDrawer
              isOpen={isMobileDrawerOpen}
              contained={true}
              activeScreen={activeScreen}
              trashedCount={trashedDocuments.length}
              onSelectScreen={(s) => navigateTo(s)}
              onStartScan={() => handleStartScan()}
              onClose={() => setIsMobileDrawerOpen(false)}
            />

            {showQuickFab && (
              <QuickActionFabSheet
                contained={true}
                onStartScan={(m) => handleStartScan(m)}
                onImportGalleryImages={handleImportGalleryImages}
                onImportPdfFile={handleImportPdfFile}
                onOpenPdfWorkspace={() => {
                  setPdfWorkspaceTab('merge');
                  setPdfWorkspacePreselectedIds([]);
                  setIsPdfWorkspaceOpen(true);
                }}
              />
            )}

            <div className="h-4 flex items-center justify-center shrink-0 bg-white">
              <div className="w-28 h-1 bg-[#D1D1D9] rounded-full" />
            </div>
          </div>
        </div>
      ) : (
        <>
          <TopBar
            activeScreen={activeScreen}
            screenTitle={getScreenTitle()}
            onToggleMenu={handleToggleMenu}
            isMenuOpen={isMenuCurrentlyOpen}
            disabled={isCameraOpen}
            onFocusSearch={() => setSearchFocusTrigger((n) => n + 1)}
            onOpenFolderManager={() => setIsFolderManagerOpen(true)}
            trashedCount={trashedDocuments.length}
            onEmptyTrash={handleEmptyTrash}
            analyticsTimeframe={analyticsTimeframe}
            onChangeTimeframe={setAnalyticsTimeframe}
          />

          <div className="flex-1 flex min-h-0">
            {/* Desktop Collapsible Sidebar (lg+) */}
            <PersistentSidebar
              isOpen={isDesktopSidebarOpen}
              activeScreen={activeScreen}
              trashedCount={trashedDocuments.length}
              onSelectScreen={(s) => navigateTo(s)}
              onStartScan={() => handleStartScan()}
            />

            {/* Active Screen Content */}
            <main className="flex-1 min-w-0 bg-[#FAFAFC]">
              <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 pb-24 lg:pb-8">
                {renderActiveScreen(false)}
              </div>
            </main>
          </div>

          {/* Mobile & Tablet Slide Drawer (< lg) */}
          <SlideNavigationDrawer
            isOpen={isMobileDrawerOpen}
            contained={false}
            activeScreen={activeScreen}
            trashedCount={trashedDocuments.length}
            onSelectScreen={(s) => navigateTo(s)}
            onStartScan={() => handleStartScan()}
            onClose={() => setIsMobileDrawerOpen(false)}
          />

          {/* Mobile Persistent Bottom Navigation (< lg) */}
          <MobileBottomNav
            activeScreen={activeScreen}
            onSelectScreen={(s) => navigateTo(s)}
            onStartScan={() => handleStartScan()}
            contained={false}
            disabled={isCameraOpen}
          />

          {showQuickFab && (
            <QuickActionFabSheet
              contained={false}
              onStartScan={(m) => handleStartScan(m)}
              onImportGalleryImages={handleImportGalleryImages}
              onImportPdfFile={handleImportPdfFile}
              onOpenPdfWorkspace={() => {
                setPdfWorkspaceTab('merge');
                setPdfWorkspacePreselectedIds([]);
                setIsPdfWorkspaceOpen(true);
              }}
            />
          )}
        </>
      )}

      {isCameraOpen && (
        <CameraView
          initialMode={cameraMode}
          targetFolderId={selectedFolderId || 'f_personal'}
          onSaveDocument={handleSaveFromCamera}
          onClose={() => setIsCameraOpen(false)}
        />
      )}

      {editingDoc && (
        <DocumentEditor
          document={editingDoc}
          folders={folders}
          onUpdateDocument={handleUpdateDocument}
          onOpenExport={(doc) => setExportingDoc(doc)}
          onAddPageWithCamera={handleAddPageWithCamera}
          onClose={() => setEditingDoc(null)}
        />
      )}

      {exportingDoc && (
        <ExportModal
          document={exportingDoc}
          onClose={() => setExportingDoc(null)}
        />
      )}

      {isFolderManagerOpen && (
        <FolderManagerModal
          folders={folders}
          onSaveFolder={handleSaveFolder}
          onDeleteFolder={handleDeleteFolder}
          onClose={() => setIsFolderManagerOpen(false)}
        />
      )}

      {isAndroidNativeModalOpen && (
        <AndroidNativeModal onClose={() => setIsAndroidNativeModalOpen(false)} />
      )}

      {isPdfWorkspaceOpen && (
        <PdfWorkspaceModal
          documents={activeDocuments}
          initialTab={pdfWorkspaceTab}
          preselectedDocIds={pdfWorkspacePreselectedIds}
          onSaveNewDocument={handleSaveNewWorkspaceDoc}
          onClose={() => setIsPdfWorkspaceOpen(false)}
        />
      )}

      <OfflineIndicator />
    </div>
  );
}
