import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  RefreshCw,
  Zap,
  ZapOff,
  Image as ImageIcon,
  Check,
  X,
  CreditCard,
  FileText,
  Receipt,
  BookOpen,
  AlertCircle,
  Trash2,
  Timer,
  Grid3x3,
  SlidersHorizontal,
  Sun,
  Focus,
  Maximize2,
} from 'lucide-react';
import { ScanMode, PageItem, QuadCorners, FilterPreset, AdjustmentParams } from '../types/scanner';
import {
  createThumbnail,
  stitchRectoVerso,
  splitBookPages,
  detectDocumentAndTextCorners,
  DetectedAreaResult,
  perspectiveCrop,
  processImage,
} from '../utils/imageProcessing';
import { getAppSettings } from '../utils/storage';
import { RealtimeDocumentOverlay } from './RealtimeDocumentOverlay';

interface CameraViewProps {
  initialMode?: ScanMode;
  targetFolderId: string;
  onSaveDocument: (title: string, mode: ScanMode, pages: PageItem[]) => void;
  onClose: () => void;
}

type ShadowLevel = 'off' | 'balanced' | 'strong';
type FramingMode = 'auto_paper' | 'full_frame';
type ClarityLevel = 'standard' | 'ultra';
type ResolutionMode = 'hd' | 'ultra';

export const CameraView: React.FC<CameraViewProps> = ({
  initialMode = 'document',
  targetFolderId: _targetFolderId,
  onSaveDocument,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const viewfinderRef = useRef<HTMLDivElement | null>(null);

  const [mode, setMode] = useState<ScanMode>(initialMode);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [screenFlashOn, setScreenFlashOn] = useState<boolean>(false);
  const [permissionState, setPermissionState] = useState<'granted' | 'needs_prompt' | 'denied'>('granted');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isShutterFlashing, setIsShutterFlashing] = useState<boolean>(false);

  // Real-world Pro Scanner Options
  const [captureFilter, setCaptureFilter] = useState<FilterPreset>(() => getAppSettings().defaultFilter);
  const [shadowLevel, setShadowLevel] = useState<ShadowLevel>('strong');
  const [clarityLevel, setClarityLevel] = useState<ClarityLevel>('ultra');
  const [framingMode, setFramingMode] = useState<FramingMode>('auto_paper');
  const [showGrid, setShowGrid] = useState<boolean>(false);
  const [timerSeconds, setTimerSeconds] = useState<0 | 2 | 5>(0);
  const [countdownLeft, setCountdownLeft] = useState<number | null>(null);
  const [resolutionMode, setResolutionMode] = useState<ResolutionMode>('hd');
  const [isOptionsOpen, setIsOptionsOpen] = useState<boolean>(false);
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);

  // ID Card Recto-Verso state
  const [idStep, setIdStep] = useState<'front' | 'back'>('front');
  const [frontCardDataUrl, setFrontCardDataUrl] = useState<string | null>(null);

  // Captured pages in current batch + expandable tray
  const [capturedPages, setCapturedPages] = useState<PageItem[]>([]);
  const [isBatchTrayOpen, setIsBatchTrayOpen] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // AUTO-PROJECTION: Permanently ON spanning full paper surface
  const autoProjectEnabled = true;

  // AUTO-CAPTURE: Steadiness lock detector (initialized from NScanner Settings)
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState<boolean>(() => getAppSettings().autoCaptureDefault);
  const [autoCaptureProgress, setAutoCaptureProgress] = useState<number>(0);
  const prevCornersRef = useRef<QuadCorners | null>(null);
  const steadyMsRef = useRef<number>(0);
  const cooldownUntilRef = useRef<number>(0);

  const [detectedArea, setDetectedArea] = useState<DetectedAreaResult | null>({
    corners: {
      topLeft: { x: 0.08, y: 0.08 },
      topRight: { x: 0.92, y: 0.08 },
      bottomRight: { x: 0.92, y: 0.92 },
      bottomLeft: { x: 0.08, y: 0.92 },
    },
    documentSurface: { x: 0.08, y: 0.08, width: 0.84, height: 0.84 },
    textBands: [],
    confidence: 0.88,
    skewAngleDeg: 0,
    avgLuminance: 140,
    sharpnessScore: 0.8,
    paperDetected: false,
  });
  const smoothedCornersRef = useRef<QuadCorners | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const shutterFnRef = useRef<() => void>(() => {});
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adjust filter defaults automatically when switching into receipt mode if user hadn't customized
  useEffect(() => {
    if (mode === 'receipt' && captureFilter === 'magic') {
      // keep user choice if they selected it manually, otherwise receipt B&W works nicely cleanly via filter strip
    }
  }, [mode, captureFilter]);

  // Smart Full-Paper Edge Detection + Auto-Capture Steadiness Lock Loop (~12 FPS)
  useEffect(() => {
    let isMounted = true;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const intervalMs = 85;
    let lastTickAt = Date.now();

    async function detectFrame() {
      if (videoRef.current && videoRef.current.readyState >= 2) {
        try {
          const result = await detectDocumentAndTextCorners(videoRef.current);
          const now = Date.now();
          const dt = Math.min(350, Math.max(20, now - lastTickAt));
          lastTickAt = now;

          if (isMounted && result) {
            setDetectedArea(result);

            if (
              autoCaptureEnabled &&
              !isProcessing &&
              countdownLeft === null &&
              !isOptionsOpen &&
              now > cooldownUntilRef.current
            ) {
              const prev = prevCornersRef.current;
              const curr = result.corners;
              let maxDelta = 1;
              if (prev) {
                maxDelta = Math.max(
                  Math.abs(curr.topLeft.x - prev.topLeft.x),
                  Math.abs(curr.topLeft.y - prev.topLeft.y),
                  Math.abs(curr.topRight.x - prev.topRight.x),
                  Math.abs(curr.topRight.y - prev.topRight.y),
                  Math.abs(curr.bottomRight.x - prev.bottomRight.x),
                  Math.abs(curr.bottomRight.y - prev.bottomRight.y),
                  Math.abs(curr.bottomLeft.x - prev.bottomLeft.x),
                  Math.abs(curr.bottomLeft.y - prev.bottomLeft.y)
                );
              }

              if (result.confidence >= 0.7 && maxDelta < 0.022) {
                steadyMsRef.current += dt;
                const progress = Math.min(1, steadyMsRef.current / 1050);
                setAutoCaptureProgress(progress);

                if (progress >= 1) {
                  steadyMsRef.current = 0;
                  setAutoCaptureProgress(0);
                  cooldownUntilRef.current = Date.now() + 2600;
                  shutterFnRef.current();
                }
              } else {
                steadyMsRef.current = Math.max(0, steadyMsRef.current - dt * 1.4);
                setAutoCaptureProgress(Math.min(1, steadyMsRef.current / 1050));
              }
              prevCornersRef.current = curr;
            } else {
              steadyMsRef.current = 0;
              setAutoCaptureProgress(0);
            }
          }
        } catch {
          // ignore transient frame read errors
        }
      }

      if (isMounted) {
        timerId = setTimeout(detectFrame, intervalMs);
      }
    }

    timerId = setTimeout(detectFrame, 300);
    return () => {
      isMounted = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [autoCaptureEnabled, isProcessing, countdownLeft, isOptionsOpen]);

  const startCameraStream = React.useCallback(
    async (isMountedCheck?: () => boolean) => {
      stopCamera();
      setCameraError(null);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setPermissionState('denied');
        setCameraError(
          'Camera capture is unavailable in this browser context. You can upload photos or load a demo document.'
        );
        return;
      }

      try {
        const targetW = resolutionMode === 'ultra' ? 3840 : 1920;
        const targetH = resolutionMode === 'ultra' ? 2160 : 1080;

        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: targetW },
            height: { ideal: targetH },
          },
          audio: false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (isMountedCheck && !isMountedCheck()) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        setPermissionState('granted');
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        const track = stream.getVideoTracks()[0];
        const capabilities = (track.getCapabilities ? track.getCapabilities() : {}) as {
          torch?: boolean;
          focusMode?: string[];
        };
        setHasTorch(Boolean(capabilities?.torch));

        // Request continuous autofocus when hardware supports it
        if (capabilities?.focusMode?.includes('continuous')) {
          try {
            await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
              advanced: [{ focusMode: 'continuous' }],
            });
          } catch {
            // ignore unsupported continuous focus
          }
        }
      } catch (err) {
        const isDenied =
          err instanceof DOMException &&
          (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
        setPermissionState('denied');
        setCameraError(
          isDenied
            ? 'Camera permission was declined. Allow camera access in browser settings or upload images below.'
            : 'Camera hardware is unavailable right now. You can upload images or load a demo document.'
        );
      }
    },
    [facingMode, resolutionMode]
  );

  useEffect(() => {
    let isMounted = true;

    async function initCameraWithContext() {
      try {
        if (navigator.permissions && navigator.permissions.query) {
          const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
          if (!isMounted) return;
          if (status.state === 'prompt') {
            setPermissionState('needs_prompt');
            return;
          }
          if (status.state === 'denied') {
            setPermissionState('denied');
            setCameraError(
              'Camera permission is currently blocked. Enable camera access in browser settings or upload photos from your device.'
            );
            return;
          }
        }
      } catch {
        // Permissions API unsupported for camera — request stream directly
      }

      await startCameraStream(() => isMounted);
    }

    initCameraWithContext();
    return () => {
      isMounted = false;
      stopCamera();
    };
  }, [startCameraStream]);

  // Clean up countdown / focus timers on unmount
  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    };
  }, []);

  // Keyboard shortcuts (Space to snap, Escape to close options or exit)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (isOptionsOpen) {
          setIsOptionsOpen(false);
        } else {
          onClose();
        }
      } else if (e.key === ' ' && !isOptionsOpen && permissionState === 'granted') {
        e.preventDefault();
        triggerShutterWithTimer();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  async function toggleLightAssist() {
    if (hasTorch && streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      if (track) {
        try {
          await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
            advanced: [{ torch: !torchOn }],
          });
          setTorchOn(!torchOn);
          return;
        } catch (err) {
          console.warn('Torch constraint error', err);
        }
      }
    }
    // Fallback / front camera soft-light bezel boost
    setScreenFlashOn((v) => !v);
  }

  function flipCamera() {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  }

  async function handleViewfinderTap(e: React.PointerEvent<HTMLDivElement>) {
    if (isOptionsOpen || permissionState !== 'granted' || !viewfinderRef.current) return;
    const rect = viewfinderRef.current.getBoundingClientRect();
    const x = Math.max(0.08, Math.min(0.92, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0.08, Math.min(0.92, (e.clientY - rect.top) / rect.height));
    setFocusPoint({ x, y });

    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => setFocusPoint(null), 1300);

    if (streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      if (track) {
        try {
          await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
            advanced: [{ focusMode: 'single-shot' }],
          });
          setTimeout(async () => {
            try {
              await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
                advanced: [{ focusMode: 'continuous' }],
              });
            } catch {
              // ignore
            }
          }, 900);
        } catch {
          // Focus mode constraints unsupported on this webcam/browser
        }
      }
    }
  }

  function captureVideoFrame(): string {
    if (!videoRef.current) return '';
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.96);
  }

  function buildActiveCaptureSettings(targetMode: ScanMode): {
    filter: FilterPreset;
    adjustments: AdjustmentParams;
  } {
    const filter: FilterPreset =
      targetMode === 'receipt' && captureFilter === 'magic' ? 'bw' : captureFilter;

    const shadowRemoval = shadowLevel !== 'off';
    const shadowStrength = shadowLevel === 'strong' ? 95 : shadowLevel === 'balanced' ? 78 : 0;
    const sharpnessBoost = clarityLevel === 'ultra' ? 42 : 18;

    const adjustments: AdjustmentParams = {
      brightness: targetMode === 'receipt' ? 8 : 4,
      contrast: targetMode === 'receipt' ? 28 : clarityLevel === 'ultra' ? 20 : 12,
      sharpness: sharpnessBoost,
      warmth: 0,
      saturation: filter === 'magic' ? 10 : 0,
      shadowRemoval,
      shadowStrength,
    };

    return { filter, adjustments };
  }

  /**
   * Applies full-paper perspective dewarp + shadow flattening + selected enhancement filter
   * while preserving original capture untouched for "Hold to Compare".
   */
  async function rectifyAndEnhanceCapture(
    rawDataUrl: string,
    targetMode: ScanMode,
    useVideoLiveCrop: boolean
  ): Promise<{ rectifiedOriginal: string; enhancedUrl: string; filter: FilterPreset; adjustments: AdjustmentParams }> {
    const { filter, adjustments } = buildActiveCaptureSettings(targetMode);

    let rectifiedOriginal = rawDataUrl;
    const cornersToCrop = smoothedCornersRef.current || detectedArea?.corners;

    if (
      autoProjectEnabled &&
      framingMode === 'auto_paper' &&
      useVideoLiveCrop &&
      cornersToCrop
    ) {
      try {
        rectifiedOriginal = await perspectiveCrop(rawDataUrl, cornersToCrop);
      } catch {
        rectifiedOriginal = rawDataUrl;
      }
    }

    const enhancedUrl = await processImage(rectifiedOriginal, filter, adjustments, 0);
    return { rectifiedOriginal, enhancedUrl, filter, adjustments };
  }

  function triggerShutterWithTimer() {
    if (isProcessing) return;

    // Cancel running countdown if clicked again
    if (countdownLeft !== null) {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
      setCountdownLeft(null);
      return;
    }

    if (timerSeconds === 0) {
      handleShutter();
      return;
    }

    let rem = timerSeconds;
    setCountdownLeft(rem);
    countdownTimerRef.current = setInterval(() => {
      rem -= 1;
      if (rem <= 0) {
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
        setCountdownLeft(null);
        handleShutter();
      } else {
        setCountdownLeft(rem);
      }
    }, 1000);
  }

  async function handleShutter() {
    if (isProcessing) return;

    cooldownUntilRef.current = Date.now() + 2600;
    steadyMsRef.current = 0;
    setAutoCaptureProgress(0);

    setIsShutterFlashing(true);
    setTimeout(() => setIsShutterFlashing(false), 180);

    const hasLiveVideo = Boolean(videoRef.current && videoRef.current.readyState >= 2);
    const rawDataUrl = hasLiveVideo
      ? captureVideoFrame()
      : createSimulatedScanFrame(mode, idStep);

    if (!rawDataUrl) return;
    setIsProcessing(true);

    try {
      if (mode === 'id_card') {
        const { enhancedUrl, filter, adjustments } = await rectifyAndEnhanceCapture(
          rawDataUrl,
          'id_card',
          hasLiveVideo
        );

        if (idStep === 'front') {
          setFrontCardDataUrl(enhancedUrl);
          setIdStep('back');
        } else {
          const front = frontCardDataUrl || enhancedUrl;
          const back = enhancedUrl;
          const stitched = await stitchRectoVerso(front, back, 'a4_stacked');
          const thumbStitched = await createThumbnail(stitched);
          const thumbFront = await createThumbnail(front);
          const thumbBack = await createThumbnail(back);

          const newPages: PageItem[] = [
            {
              id: 'p_' + Date.now() + '_stitched',
              originalDataUrl: stitched,
              processedDataUrl: stitched,
              thumbnailUrl: thumbStitched,
              pageNumber: 1,
              rotation: 0,
              filter,
              label: 'A4 Recto-Verso (Front & Back)',
              adjustments,
              createdAt: Date.now(),
            },
            {
              id: 'p_' + Date.now() + '_front',
              originalDataUrl: front,
              processedDataUrl: front,
              thumbnailUrl: thumbFront,
              pageNumber: 2,
              rotation: 0,
              filter,
              label: 'Front Side',
              adjustments,
              createdAt: Date.now(),
            },
            {
              id: 'p_' + Date.now() + '_back',
              originalDataUrl: back,
              processedDataUrl: back,
              thumbnailUrl: thumbBack,
              pageNumber: 3,
              rotation: 0,
              filter,
              label: 'Back Side',
              adjustments,
              createdAt: Date.now(),
            },
          ];

          setCapturedPages(newPages);
          onSaveDocument(`ID Card Scan - ${new Date().toLocaleDateString()}`, 'id_card', newPages);
        }
      } else if (mode === 'book') {
        const { rectifiedOriginal, filter, adjustments } = await rectifyAndEnhanceCapture(
          rawDataUrl,
          'book',
          hasLiveVideo
        );
        const { leftPage, rightPage } = await splitBookPages(rectifiedOriginal);
        const procLeft = await processImage(leftPage, filter, adjustments, 0);
        const procRight = await processImage(rightPage, filter, adjustments, 0);
        const thumbLeft = await createThumbnail(procLeft);
        const thumbRight = await createThumbnail(procRight);

        const pageLeft: PageItem = {
          id: 'p_' + Date.now() + '_left',
          originalDataUrl: leftPage,
          processedDataUrl: procLeft,
          thumbnailUrl: thumbLeft,
          pageNumber: capturedPages.length + 1,
          rotation: 0,
          filter,
          label: `Page ${capturedPages.length + 1} (Left)`,
          adjustments,
          createdAt: Date.now(),
        };

        const pageRight: PageItem = {
          id: 'p_' + Date.now() + '_right',
          originalDataUrl: rightPage,
          processedDataUrl: procRight,
          thumbnailUrl: thumbRight,
          pageNumber: capturedPages.length + 2,
          rotation: 0,
          filter,
          label: `Page ${capturedPages.length + 2} (Right)`,
          adjustments,
          createdAt: Date.now(),
        };

        setCapturedPages((prev) => [...prev, pageLeft, pageRight]);
      } else {
        const { rectifiedOriginal, enhancedUrl, filter, adjustments } = await rectifyAndEnhanceCapture(
          rawDataUrl,
          mode,
          hasLiveVideo
        );
        const thumb = await createThumbnail(enhancedUrl);

        const newPage: PageItem = {
          id: 'p_' + Date.now(),
          originalDataUrl: rectifiedOriginal,
          processedDataUrl: enhancedUrl,
          thumbnailUrl: thumb,
          pageNumber: capturedPages.length + 1,
          rotation: 0,
          filter,
          label: `Page ${capturedPages.length + 1}`,
          adjustments,
          cropCorners:
            framingMode === 'auto_paper'
              ? smoothedCornersRef.current || detectedArea?.corners
              : undefined,
          createdAt: Date.now(),
        };

        setCapturedPages((prev) => [...prev, newPage]);
      }
    } catch (err) {
      console.error('Error during capture processing:', err);
    } finally {
      setIsProcessing(false);
    }
  }

  shutterFnRef.current = handleShutter;

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    const newPages: PageItem[] = [...capturedPages];
    const { filter, adjustments } = buildActiveCaptureSettings(mode);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      let croppedUrl = dataUrl;
      if (framingMode === 'auto_paper') {
        try {
          const detected = await detectDocumentAndTextCorners(dataUrl);
          if (detected.confidence >= 0.65) {
            croppedUrl = await perspectiveCrop(dataUrl, detected.corners);
          }
        } catch {
          croppedUrl = dataUrl;
        }
      }

      const processed = await processImage(croppedUrl, filter, adjustments, 0);
      const thumb = await createThumbnail(processed);

      newPages.push({
        id: 'p_' + Date.now() + '_' + i,
        originalDataUrl: croppedUrl,
        processedDataUrl: processed,
        thumbnailUrl: thumb,
        pageNumber: newPages.length + 1,
        rotation: 0,
        filter,
        label: `Page ${newPages.length + 1}`,
        adjustments,
        createdAt: Date.now(),
      });
    }

    setCapturedPages(newPages);
    setIsProcessing(false);
    if (newPages.length > 0) setIsBatchTrayOpen(true);
  }

  function removeBatchPage(pageId: string) {
    setCapturedPages((prev) =>
      prev
        .filter((p) => p.id !== pageId)
        .map((p, idx) => ({ ...p, pageNumber: idx + 1, label: `Page ${idx + 1}` }))
    );
  }

  function finishScanning() {
    if (capturedPages.length === 0) return;
    const modeTitles: Record<ScanMode, string> = {
      id_card: 'ID Card Scan',
      passport: 'Passport Document',
      document: 'Scanned Document',
      receipt: 'Expense Receipt',
      book: 'Book Spread Scan',
    };
    const title = `${modeTitles[mode]} · ${new Date().toLocaleDateString()}`;
    onSaveDocument(title, mode, capturedPages);
  }

  async function loadSampleForMode(targetMode: ScanMode) {
    setIsProcessing(true);
    try {
      const { filter, adjustments } = buildActiveCaptureSettings(targetMode);
      const dataUrl = createSimulatedScanFrame(targetMode, 'front');
      const thumb = await createThumbnail(dataUrl);

      if (targetMode === 'id_card') {
        const backUrl = createSimulatedScanFrame('id_card', 'back');
        const backThumb = await createThumbnail(backUrl);
        const stitched = await stitchRectoVerso(dataUrl, backUrl, 'a4_stacked');
        const stitchedThumb = await createThumbnail(stitched);

        const pages: PageItem[] = [
          {
            id: 'p_sample_stitched',
            originalDataUrl: stitched,
            processedDataUrl: stitched,
            thumbnailUrl: stitchedThumb,
            pageNumber: 1,
            rotation: 0,
            filter,
            label: 'A4 Recto-Verso (Front & Back)',
            adjustments,
            createdAt: Date.now(),
          },
          {
            id: 'p_sample_front',
            originalDataUrl: dataUrl,
            processedDataUrl: dataUrl,
            thumbnailUrl: thumb,
            pageNumber: 2,
            rotation: 0,
            filter,
            label: 'Front Side',
            adjustments,
            createdAt: Date.now(),
          },
          {
            id: 'p_sample_back',
            originalDataUrl: backUrl,
            processedDataUrl: backUrl,
            thumbnailUrl: backThumb,
            pageNumber: 3,
            rotation: 0,
            filter,
            label: 'Back Side',
            adjustments,
            createdAt: Date.now(),
          },
        ];

        onSaveDocument('Sample Driver License (Recto-Verso)', 'id_card', pages);
      } else {
        const processed = await processImage(dataUrl, filter, adjustments, 0);
        const procThumb = await createThumbnail(processed);
        const page: PageItem = {
          id: 'p_sample_' + Date.now(),
          originalDataUrl: dataUrl,
          processedDataUrl: processed,
          thumbnailUrl: procThumb,
          pageNumber: 1,
          rotation: 0,
          filter,
          label: 'Page 1',
          adjustments,
          createdAt: Date.now(),
        };
        onSaveDocument(`Sample ${targetMode.toUpperCase()} Scan`, targetMode, [page]);
      }
    } finally {
      setIsProcessing(false);
    }
  }

  // Subtle CSS viewfinder preview hint reflecting chosen live filter
  const liveVideoFilterCss =
    captureFilter === 'bw'
      ? 'grayscale(1) contrast(1.42) brightness(1.06)'
      : captureFilter === 'grayscale'
      ? 'grayscale(1) contrast(1.18)'
      : captureFilter === 'eco'
      ? 'grayscale(0.7) contrast(1.22) brightness(1.08)'
      : captureFilter === 'magic'
      ? 'contrast(1.12) saturate(1.12) brightness(1.03)'
      : 'none';

  const isLowLight = Boolean(
    videoRef.current &&
      videoRef.current.readyState >= 2 &&
      (detectedArea?.avgLuminance ?? 140) < 62 &&
      !torchOn &&
      !screenFlashOn
  );

  const hasCustomOptions =
    shadowLevel !== 'strong' ||
    clarityLevel !== 'ultra' ||
    framingMode !== 'auto_paper' ||
    timerSeconds !== 0 ||
    resolutionMode !== 'hd';

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col select-none overflow-hidden text-slate-100">
      {isShutterFlashing && (
        <div className="absolute inset-0 bg-white z-50 pointer-events-none transition-opacity duration-150 opacity-90" />
      )}

      {/* TOP BAR */}
      <div className="relative z-20 flex items-center justify-between px-3 sm:px-4 py-2.5 bg-slate-950/90 backdrop-blur-md border-b border-slate-800 gap-2">
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full flex items-center justify-center bg-slate-800/80 hover:bg-slate-700 text-slate-200 transition-colors shrink-0"
          title="Close Scanner (Esc)"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="text-center min-w-0">
          <div className="text-xs sm:text-sm font-semibold tracking-wide text-white truncate">
            {mode === 'id_card' && 'ID CARD (RECTO-VERSO)'}
            {mode === 'passport' && 'PASSPORT SCAN'}
            {mode === 'document' && 'MULTI-PAGE DOCUMENT'}
            {mode === 'receipt' && 'RECEIPT SCANNER'}
            {mode === 'book' && 'BOOK (DUAL-PAGE SPLIT)'}
          </div>
          <div className="text-[11px] text-slate-400">
            {mode === 'id_card'
              ? idStep === 'front'
                ? 'Step 1 of 2: Snap Front Side'
                : 'Step 2 of 2: Flip Card & Snap Back'
              : `${capturedPages.length} ${capturedPages.length === 1 ? 'page' : 'pages'} in batch`}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Auto-Snap Lock */}
          <button
            onClick={() => setAutoCaptureEnabled((v) => !v)}
            className={`px-2.5 h-9 rounded-full flex items-center gap-1.5 text-[11px] font-semibold border transition-colors ${
              autoCaptureEnabled
                ? 'bg-[#7C3AED]/25 border-[#A78BFA]/60 text-violet-200'
                : 'bg-slate-800/80 border-slate-700 text-slate-400'
            }`}
            title="Automatically capture when document corners stabilize"
          >
            <Timer className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{autoCaptureEnabled ? 'Auto-Snap' : 'Manual'}</span>
          </button>

          {/* 3x3 Framing Grid */}
          <button
            onClick={() => setShowGrid((v) => !v)}
            className={`w-9 h-9 rounded-full flex items-center justify-center border transition-colors ${
              showGrid
                ? 'bg-blue-500/20 border-blue-400/60 text-blue-200'
                : 'bg-slate-800/80 border-slate-700 hover:bg-slate-700 text-slate-300'
            }`}
            title="Toggle 3x3 framing grid"
          >
            <Grid3x3 className="w-4 h-4" />
          </button>

          {/* Torch / Screen Soft-Fill */}
          <button
            onClick={toggleLightAssist}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
              torchOn || screenFlashOn
                ? 'bg-amber-400 text-slate-950'
                : 'bg-slate-800/80 hover:bg-slate-700 text-slate-200'
            }`}
            title={hasTorch ? 'Toggle Camera Torch' : 'Toggle Soft Screen Fill Light'}
          >
            {torchOn || screenFlashOn ? <Zap className="w-4 h-4" /> : <ZapOff className="w-4 h-4" />}
          </button>

          {/* Scanner Pro Options */}
          <button
            onClick={() => setIsOptionsOpen((v) => !v)}
            className={`relative px-2.5 h-9 rounded-full flex items-center gap-1.5 text-[11px] font-semibold border transition-colors ${
              isOptionsOpen || hasCustomOptions
                ? 'bg-blue-500/20 border-blue-400/60 text-blue-100'
                : 'bg-slate-800/80 border-slate-700 hover:bg-slate-700 text-slate-200'
            }`}
            title="Scanner quality, shadow flattening & framing options"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Options</span>
          </button>

          {/* Flip Camera */}
          <button
            onClick={flipCamera}
            className="w-9 h-9 rounded-full flex items-center justify-center bg-slate-800/80 hover:bg-slate-700 text-slate-200 transition-colors"
            title="Switch Camera"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* VIEWFINDER AREA */}
      <div
        ref={viewfinderRef}
        onPointerDown={handleViewfinderTap}
        className={`relative flex-1 bg-black flex items-center justify-center overflow-hidden ${
          screenFlashOn ? 'ring-[14px] ring-inset ring-white/90' : ''
        }`}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ filter: liveVideoFilterCss }}
          className="absolute inset-0 w-full h-full object-cover transition-[filter] duration-200"
        />

        {/* FULL PAPER-SURFACE ORTHOGONAL LIGHT-BLUE PROJECTION OVERLAY */}
        <RealtimeDocumentOverlay
          detectedArea={detectedArea}
          scanMode={mode}
          isTextDetected={true}
          videoElement={videoRef.current}
          autoCaptureProgress={autoCaptureProgress}
          autoCaptureEnabled={autoCaptureEnabled && countdownLeft === null && !isOptionsOpen}
          fullFrameMode={framingMode === 'full_frame'}
          showGrid={showGrid}
          focusPoint={focusPoint}
          onSmoothedCornersUpdate={(corners) => {
            smoothedCornersRef.current = corners;
          }}
        />

        {/* LOW-LIGHT REALITY CARE ACTION PILL */}
        {isLowLight && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleLightAssist();
            }}
            className="absolute top-12 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-[11px] flex items-center gap-1.5 shadow-lg transition-colors"
          >
            <Sun className="w-3.5 h-3.5" />
            <span>{hasTorch ? 'Low light · Turn on Flash' : 'Low light · Soft Screen Light'}</span>
          </button>
        )}

        {/* HANDS-FREE COUNTDOWN OVERLAY */}
        {countdownLeft !== null && (
          <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center bg-slate-950/35">
            <div className="w-24 h-24 rounded-2xl bg-slate-950/85 border border-blue-400/60 flex flex-col items-center justify-center shadow-2xl">
              <span className="text-4xl font-bold text-white tabular-nums">{countdownLeft}</span>
              <span className="text-[10px] text-blue-200 mt-0.5">Hold steady</span>
            </div>
          </div>
        )}

        {/* EXPANDABLE PRO SCANNER OPTIONS DRAWER */}
        {isOptionsOpen && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute top-3 right-3 left-3 sm:left-auto sm:w-80 z-30 bg-slate-950/95 backdrop-blur-lg border border-slate-700 rounded-xl p-4 shadow-2xl space-y-3.5 text-xs max-h-[82%] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-bold text-white flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-blue-400" />
                <span>Scanner Options</span>
              </span>
              <button
                onClick={() => setIsOptionsOpen(false)}
                className="w-7 h-7 rounded-lg flex items-center justify-center bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Paper Surface Crop Mode */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                <Maximize2 className="w-3 h-3 text-blue-400" />
                <span>Paper Surface Framing</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'auto_paper', label: 'Auto Paper Crop' },
                  { id: 'full_frame', label: 'Full Frame (100%)' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setFramingMode(opt.id as FramingMode)}
                    className={`min-h-[36px] px-2.5 py-1.5 rounded-lg border font-medium transition-colors ${
                      framingMode === opt.id
                        ? 'bg-blue-500/20 border-blue-400 text-blue-100'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Shadow & Crease Flattening */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-400">
                Shadow &amp; Crease Flattening
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'off', label: 'Off' },
                  { id: 'balanced', label: 'Balanced' },
                  { id: 'strong', label: 'Strong' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setShadowLevel(opt.id as ShadowLevel)}
                    className={`min-h-[36px] px-2 py-1.5 rounded-lg border font-medium transition-colors ${
                      shadowLevel === opt.id
                        ? 'bg-[#7C3AED]/30 border-[#A78BFA] text-violet-100'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Reality Care Sharpness & Clarity */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                <Focus className="w-3 h-3 text-blue-400" />
                <span>Text Clarity &amp; Sharpness</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'standard', label: 'Natural Print' },
                  { id: 'ultra', label: 'Ultra Crisp Text' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setClarityLevel(opt.id as ClarityLevel)}
                    className={`min-h-[36px] px-2.5 py-1.5 rounded-lg border font-medium transition-colors ${
                      clarityLevel === opt.id
                        ? 'bg-[#7C3AED]/30 border-[#A78BFA] text-violet-100'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Hands-Free Self-Timer */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-400">
                Anti-Shake Self-Timer
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[0, 2, 5].map((sec) => (
                  <button
                    key={sec}
                    onClick={() => setTimerSeconds(sec as 0 | 2 | 5)}
                    className={`min-h-[36px] px-2 py-1.5 rounded-lg border font-medium transition-colors ${
                      timerSeconds === sec
                        ? 'bg-blue-500/20 border-blue-400 text-blue-100'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {sec === 0 ? 'Instant' : `${sec}s Delay`}
                  </button>
                ))}
              </div>
            </div>

            {/* Sensor Resolution */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-400">
                Camera Resolution
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'hd', label: 'HD (1080p Fast)' },
                  { id: 'ultra', label: 'Ultra 4K (Max)' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setResolutionMode(opt.id as ResolutionMode)}
                    className={`min-h-[36px] px-2.5 py-1.5 rounded-lg border font-medium transition-colors ${
                      resolutionMode === opt.id
                        ? 'bg-[#7C3AED]/30 border-[#A78BFA] text-violet-100'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {permissionState === 'needs_prompt' && !cameraError && (
          <div className="absolute inset-0 z-30 flex items-center justify-center p-5 bg-slate-950/80 backdrop-blur-sm">
            <div className="w-full max-w-sm bg-white text-[#1C1B22] rounded-xl border border-[#E6E6EB] p-5 space-y-4 shadow-xl text-center">
              <div className="w-11 h-11 rounded-full bg-[#F5F3FF] text-[#7C3AED] flex items-center justify-center mx-auto">
                <Camera className="w-5 h-5" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-sm font-bold text-[#1C1B22]">Camera access for scanning</h2>
                <p className="text-xs text-[#666672] leading-relaxed">
                  NScanner detects full paper borders and enhances lighting directly on your device.
                </p>
              </div>
              <div className="flex flex-col gap-2 pt-1">
                <button
                  onClick={() => startCameraStream()}
                  className="w-full min-h-[44px] px-4 py-2.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold transition-colors"
                >
                  Allow Camera
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-[40px] px-3 py-2 rounded-lg bg-white border border-[#E6E6EB] hover:border-[#7C3AED] text-[#1C1B22] text-xs font-medium transition-colors"
                  >
                    Upload Photo
                  </button>
                  <button
                    onClick={() => loadSampleForMode(mode)}
                    className="min-h-[40px] px-3 py-2 rounded-lg bg-[#F5F3FF] border border-[#DDD6FE] text-[#7C3AED] text-xs font-semibold transition-colors"
                  >
                    Load Demo
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {cameraError && (
          <div className="absolute top-14 inset-x-4 z-30 p-3.5 rounded-xl bg-slate-900/95 border border-slate-700 text-white text-xs flex flex-col sm:flex-row sm:items-center gap-3 backdrop-blur-md">
            <div className="flex items-start gap-2.5 flex-1">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed text-slate-200">{cameraError}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => startCameraStream()}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium text-xs"
              >
                Retry
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium text-xs"
              >
                Upload
              </button>
              <button
                onClick={() => loadSampleForMode(mode)}
                className="px-3 py-1.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-semibold text-xs"
              >
                Load Demo
              </button>
            </div>
          </div>
        )}

        {/* MODE-SPECIFIC ALIGNMENT GUIDES */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-6">
          {mode === 'id_card' && (
            <div className="relative w-full max-w-sm aspect-[1.586/1] rounded-xl border border-emerald-400/75 flex flex-col justify-between p-4">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-1 rounded bg-emerald-500/90 text-slate-950 font-bold text-xs uppercase tracking-wider">
                  {idStep === 'front' ? '1. Front Side' : '2. Back Side'}
                </span>
                {idStep === 'back' && frontCardDataUrl && (
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900/80 border border-emerald-500/60 text-[10px] text-emerald-300">
                    <Check className="w-3 h-3 text-emerald-400" /> Front Saved
                  </div>
                )}
              </div>
              <div className="text-center py-2">
                <p className="text-white font-medium text-xs drop-shadow-md">
                  {idStep === 'front'
                    ? 'Align FRONT of ID inside frame'
                    : 'FLIP card & align BACK inside frame'}
                </p>
              </div>
              <div className="flex justify-between items-center text-[10px] text-slate-300/80">
                <span>Shadow removal active</span>
                <span>Auto-stitches onto A4</span>
              </div>
            </div>
          )}

          {mode === 'passport' && (
            <div className="relative w-full max-w-md aspect-[1.42/1] rounded-xl border border-sky-400/75 flex flex-col justify-between p-4">
              <div className="flex justify-between items-start">
                <div className="w-24 h-32 rounded border border-dashed border-sky-300/70 bg-sky-950/30 flex items-center justify-center text-[10px] text-sky-200">
                  Photo Zone
                </div>
                <span className="px-2 py-1 rounded bg-sky-500/90 text-slate-950 font-bold text-xs">
                  Passport Bio Page
                </span>
              </div>
              <div className="w-full h-12 rounded border border-dashed border-sky-300/60 bg-sky-950/30 flex items-center justify-center text-[11px] text-sky-200 font-mono tracking-widest">
                &lt;&lt;&lt; MACHINE READABLE ZONE &gt;&gt;&gt;
              </div>
            </div>
          )}

          {mode === 'receipt' && (
            <div className="relative w-full max-w-[260px] aspect-[1/2] rounded-lg border border-emerald-400/75 flex flex-col justify-between p-3">
              <div className="text-center">
                <span className="px-2 py-0.5 rounded bg-emerald-500/90 text-slate-950 font-bold text-[11px]">
                  Expense Receipt
                </span>
              </div>
              <div className="text-center text-xs text-emerald-200/90">
                Sauvola B&amp;W + Shadow Removal
              </div>
              <div className="text-[10px] text-slate-400 text-center">Align narrow paper strip</div>
            </div>
          )}

          {mode === 'book' && (
            <div className="relative w-full max-w-md aspect-[1.35/1] rounded-xl border border-violet-400/75 flex justify-between p-4">
              <div className="flex flex-col justify-between">
                <span className="px-2 py-0.5 rounded bg-violet-500/90 text-slate-950 font-bold text-[11px]">
                  Left Page
                </span>
              </div>
              <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 border-l-2 border-dashed border-violet-300 flex items-center justify-center">
                <span className="bg-violet-900/90 text-violet-200 px-2 py-1 rounded text-[10px] whitespace-nowrap rotate-90">
                  Book Spine
                </span>
              </div>
              <div className="flex flex-col justify-between items-end">
                <span className="px-2 py-0.5 rounded bg-violet-500/90 text-slate-950 font-bold text-[11px]">
                  Right Page
                </span>
              </div>
            </div>
          )}
        </div>

        {/* EXPANDABLE BATCH SCANNING TRAY */}
        {capturedPages.length > 0 && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute bottom-3 left-3 z-20 flex flex-col gap-2 max-w-[72%]"
          >
            {isBatchTrayOpen && (
              <div className="flex items-center gap-2 p-2 rounded-xl bg-slate-900/95 backdrop-blur-md border border-slate-700 overflow-x-auto shadow-2xl">
                {capturedPages.map((p, idx) => (
                  <div key={p.id} className="relative shrink-0 group">
                    <img
                      src={p.thumbnailUrl}
                      alt={`Batch page ${idx + 1}`}
                      className="w-14 h-18 object-cover rounded-lg border border-slate-600 bg-white"
                    />
                    <span className="absolute bottom-1 left-1 px-1 rounded bg-slate-950/80 text-[9px] font-mono text-white">
                      {idx + 1}
                    </span>
                    <button
                      onClick={() => removeBatchPage(p.id)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center shadow hover:bg-red-500"
                      title="Remove page from batch"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setIsBatchTrayOpen((v) => !v)}
              className="flex items-center gap-2 bg-slate-900/90 hover:bg-slate-800 backdrop-blur-md p-1.5 rounded-xl border border-slate-700 self-start transition-colors"
            >
              <img
                src={capturedPages[capturedPages.length - 1].thumbnailUrl}
                alt="Last page thumbnail"
                className="w-11 h-14 object-cover rounded-lg border border-slate-600 bg-white"
              />
              <div className="pr-2 text-left">
                <div className="text-xs font-semibold text-white">
                  {capturedPages.length} {capturedPages.length === 1 ? 'Page' : 'Pages'}
                </div>
                <div className="text-[10px] text-blue-300">
                  {isBatchTrayOpen ? 'Hide batch' : 'Review batch'}
                </div>
              </div>
            </button>
          </div>
        )}
      </div>

      {/* BOTTOM CONTROLS */}
      <div className="relative z-20 bg-slate-950 border-t border-slate-800 pb-5 pt-2.5 px-4 space-y-2.5">
        {/* Live Capture Enhancement Preset Strip */}
        <div className="flex items-center justify-center gap-1.5 overflow-x-auto scrollbar-none text-[11px]">
          {(
            [
              { id: 'magic', label: 'Magic Color' },
              { id: 'bw', label: 'Crisp B&W' },
              { id: 'grayscale', label: 'Grayscale' },
              { id: 'eco', label: 'Eco Clean' },
              { id: 'original', label: 'Original' },
            ] as const
          ).map((f) => {
            const active = captureFilter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setCaptureFilter(f.id)}
                className={`px-2.5 py-1 rounded-md whitespace-nowrap font-medium border transition-colors ${
                  active
                    ? 'bg-blue-500/20 border-blue-400/70 text-blue-100 font-semibold'
                    : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Scan Mode Strip */}
        <div className="flex items-center justify-center gap-2 overflow-x-auto pb-1 scrollbar-none text-xs">
          {[
            { id: 'id_card', label: 'ID Card (2-Sided)', icon: CreditCard },
            { id: 'passport', label: 'Passport', icon: FileText },
            { id: 'document', label: 'Document', icon: FileText },
            { id: 'receipt', label: 'Receipt', icon: Receipt },
            { id: 'book', label: 'Book Split', icon: BookOpen },
          ].map((item) => {
            const Icon = item.icon;
            const active = mode === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setMode(item.id as ScanMode);
                  if (item.id === 'id_card') {
                    setIdStep('front');
                    setFrontCardDataUrl(null);
                  }
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full whitespace-nowrap transition-all font-medium ${
                  active
                    ? 'bg-[#7C3AED] text-white shadow-md font-semibold'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Shutter Row */}
        <div className="flex items-center justify-between max-w-md mx-auto pt-0.5">
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-12 h-12 rounded-full flex flex-col items-center justify-center bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-300 transition-colors"
              title="Upload Photos from device"
            >
              <ImageIcon className="w-5 h-5" />
              <span className="text-[8px] text-slate-400 mt-0.5">Upload</span>
            </button>
          </div>

          <div className="flex flex-col items-center">
            <button
              onClick={triggerShutterWithTimer}
              disabled={isProcessing}
              className={`relative w-20 h-20 rounded-full flex items-center justify-center border-4 transition-transform active:scale-95 ${
                mode === 'id_card'
                  ? 'border-emerald-500 bg-emerald-500/20'
                  : 'border-white bg-white/20'
              } ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'}`}
            >
              <div
                className={`w-14 h-14 rounded-full shadow-lg ${
                  mode === 'id_card' ? 'bg-emerald-500' : 'bg-white'
                }`}
              />
              {countdownLeft !== null ? (
                <span className="absolute text-lg font-extrabold text-slate-900">{countdownLeft}</span>
              ) : (
                <Camera
                  className={`absolute w-6 h-6 ${
                    mode === 'id_card' ? 'text-slate-950' : 'text-slate-900'
                  }`}
                />
              )}
            </button>
            <span className="text-[11px] font-medium text-slate-300 mt-1.5">
              {isProcessing
                ? 'Enhancing...'
                : countdownLeft !== null
                ? 'Tap to cancel'
                : mode === 'id_card'
                ? idStep === 'front'
                  ? 'Snap Front (1/2)'
                  : 'Snap Back (2/2)'
                : timerSeconds > 0
                ? `Scan (${timerSeconds}s Timer)`
                : 'Take Scan'}
            </span>
          </div>

          <div>
            {capturedPages.length > 0 ? (
              <button
                onClick={finishScanning}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-900/30 transition-transform active:scale-95"
              >
                <span>Done</span>
                <span className="w-5 h-5 rounded-full bg-emerald-800 flex items-center justify-center text-[10px]">
                  {capturedPages.length}
                </span>
              </button>
            ) : (
              <button
                onClick={() => loadSampleForMode(mode)}
                className="w-12 h-12 rounded-full flex flex-col items-center justify-center bg-slate-900 border border-slate-700 hover:bg-slate-800 text-violet-300 transition-colors"
                title="Load sample document for this mode"
              >
                <FileText className="w-5 h-5" />
                <span className="text-[8px] text-violet-200 mt-0.5">Demo</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

function createSimulatedScanFrame(mode: ScanMode, idStep?: 'front' | 'back'): string {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  if (mode === 'id_card') {
    canvas.width = 856;
    canvas.height = 540;
    ctx.fillStyle = idStep === 'back' ? '#E2E8F0' : '#EFF6FF';
    ctx.fillRect(0, 0, 856, 540);

    ctx.fillStyle = '#1E3A8A';
    ctx.fillRect(0, 0, 856, 80);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(
      idStep === 'back' ? 'STATE ID CARD · REVERSE' : 'NATIONAL IDENTIFICATION CARD',
      30,
      48
    );

    if (idStep === 'back') {
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(0, 100, 856, 60);
      ctx.fillStyle = '#475569';
      ctx.font = '14px sans-serif';
      ctx.fillText('DISCLAIMER: PROPERTY OF STATE ISSUING AUTHORITY', 40, 220);
      ctx.font = 'bold 16px monospace';
      ctx.fillText('IDUSA991048123<<<<<<<<<<<<<<<<<<', 40, 420);
      ctx.fillText('9105141M2905140USA<<<<<<<<<<<<<4', 40, 455);
    } else {
      ctx.fillStyle = '#94A3B8';
      ctx.fillRect(40, 110, 160, 210);
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('NAME: MORGAN, CASEY', 230, 140);
      ctx.fillText('DOB: 08/19/1994', 230, 175);
      ctx.fillText('EXP: 08/19/2030', 230, 210);
      ctx.fillText('DOC ID: 884-9102-441', 230, 245);
    }
  } else if (mode === 'receipt') {
    canvas.width = 600;
    canvas.height = 1100;
    ctx.fillStyle = '#FAFAFA';
    ctx.fillRect(0, 0, 600, 1100);
    ctx.fillStyle = '#18181B';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('METRO COFFEE ROASTERS', 300, 80);
    ctx.font = '14px monospace';
    ctx.fillText('DATE: 2026-11-06 · ORDER #8410', 300, 115);
    ctx.fillText('----------------------------------', 300, 150);
    ctx.textAlign = 'left';
    ctx.fillText('1x OAT CORTADO', 60, 200);
    ctx.textAlign = 'right';
    ctx.fillText('$5.25', 540, 200);
    ctx.textAlign = 'left';
    ctx.fillText('1x AVOCADO TOAST', 60, 240);
    ctx.textAlign = 'right';
    ctx.fillText('$12.50', 540, 240);
    ctx.textAlign = 'center';
    ctx.fillText('----------------------------------', 300, 300);
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('TOTAL PAID', 60, 350);
    ctx.textAlign = 'right';
    ctx.fillText('$17.75', 540, 350);
  } else {
    canvas.width = 1000;
    canvas.height = 1414;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 1000, 1414);
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText('COMMERCIAL INVOICE & RECEIPT', 80, 100);
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#64748B';
    ctx.fillText('INVOICE NO: INV-2026-9812 · DATE: 2026-11-06', 80, 135);
    ctx.strokeStyle = '#E2E8F0';
    ctx.strokeRect(80, 170, 840, 400);
    ctx.fillStyle = '#0F172A';
    ctx.fillText('BILL TO: APEX LOGISTICS GROUP', 100, 210);
    ctx.fillText('DESCRIPTION: Cloud Infrastructure Consulting Services', 100, 250);
    ctx.fillText('SUBTOTAL: $4,500.00  |  TAX: $360.00  |  TOTAL: $4,860.00', 100, 290);
    ctx.fillStyle = '#15803D';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('STATUS: PAID IN FULL [BANK TRANSFER]', 100, 350);
  }

  return canvas.toDataURL('image/jpeg', 0.92);
}
