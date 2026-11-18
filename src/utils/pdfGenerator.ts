import jsPDF from 'jspdf';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ExportSettings, OcrBlock, PageItem, ScannedDocument } from '../types/scanner';
import { createThumbnail, loadImage, renderPageWithAnnotations } from './imageProcessing';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export interface GeneratedPdfResult {
  blob: Blob;
  url: string;
  filename: string;
  sizeBytes: number;
  pageCount: number;
}

/**
 * Normalizes characters outside WinAnsi for jsPDF standard Helvetica invisible text layer
 * while preserving French accents (é, è, ê, à, ç, ù, î, ô, û, ë, ï, ü) which WinAnsi supports.
 */
function sanitizeForPdfTextLayer(text: string): string {
  return text
    .replace(/\u0153/g, 'oe')
    .replace(/\u0152/g, 'OE')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...');
}

/**
 * Compiles an array of processed & annotated document pages into a clean,
 * optionally searchable multi-page PDF document.
 */
export async function generateDocumentPdf(
  doc: ScannedDocument,
  settings: ExportSettings
): Promise<GeneratedPdfResult> {
  const {
    pageSize = 'a4',
    orientation = 'auto',
    marginMm = 0,
    includePageNumbers = false,
    searchablePdf = true,
    quality = 'high',
  } = settings;

  const maxDim = quality === 'high' ? 2400 : quality === 'medium' ? 1500 : 950;
  const jpegQuality = quality === 'high' ? 0.92 : quality === 'medium' ? 0.76 : 0.56;

  let pdf: jsPDF | null = null;
  const pages = doc.pages;
  const totalPages = pages.length;

  for (let i = 0; i < totalPages; i++) {
    const page = pages[i];
    const annotatedDataUrl = await renderPageWithAnnotations(page, 'image/jpeg', jpegQuality);
    const img = await loadImage(annotatedDataUrl);

    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;

    let finalDataUrl = annotatedDataUrl;
    if (origW > maxDim || origH > maxDim || quality !== 'high') {
      const scale = Math.min(1, maxDim / Math.max(origW, origH));
      const scaledCanvas = document.createElement('canvas');
      scaledCanvas.width = Math.max(1, Math.round(origW * scale));
      scaledCanvas.height = Math.max(1, Math.round(origH * scale));
      const sCtx = scaledCanvas.getContext('2d');
      if (sCtx) {
        sCtx.drawImage(img, 0, 0, scaledCanvas.width, scaledCanvas.height);
        finalDataUrl = scaledCanvas.toDataURL('image/jpeg', jpegQuality);
      }
    }

    let isLandscape = origW > origH;
    if (orientation === 'portrait') isLandscape = false;
    if (orientation === 'landscape') isLandscape = true;

    let pageWidthMm = 210;
    let pageHeightMm = 297;

    if (pageSize === 'letter') {
      pageWidthMm = 215.9;
      pageHeightMm = 279.4;
    } else if (pageSize === 'original') {
      pageWidthMm = (origW * 25.4) / 150;
      pageHeightMm = (origH * 25.4) / 150;
    }

    if (isLandscape && pageSize !== 'original') {
      const temp = pageWidthMm;
      pageWidthMm = pageHeightMm;
      pageHeightMm = temp;
    }

    if (i === 0) {
      pdf = new jsPDF({
        orientation: isLandscape ? 'landscape' : 'portrait',
        unit: 'mm',
        format: pageSize === 'original' ? [pageWidthMm, pageHeightMm] : pageSize,
        compress: true,
      });
    } else if (pdf) {
      pdf.addPage(
        pageSize === 'original' ? [pageWidthMm, pageHeightMm] : pageSize,
        isLandscape ? 'landscape' : 'portrait'
      );
    }

    if (!pdf) continue;

    const availW = pageWidthMm - marginMm * 2;
    const availH = pageHeightMm - marginMm * 2 - (includePageNumbers ? 8 : 0);

    const imgAspect = origW / origH;
    const boxAspect = availW / availH;

    let drawW = availW;
    let drawH = availH;

    if (imgAspect > boxAspect) {
      drawW = availW;
      drawH = availW / imgAspect;
    } else {
      drawH = availH;
      drawW = availH * imgAspect;
    }

    const drawX = marginMm + (availW - drawW) / 2;
    const drawY = marginMm + (availH - drawH) / 2;

    pdf.addImage(finalDataUrl, 'JPEG', drawX, drawY, drawW, drawH, undefined, 'FAST');

    // Embed invisible searchable OCR text layer inside PDF
    if (searchablePdf) {
      if (page.ocrBlocks && page.ocrBlocks.length > 0) {
        for (const block of page.ocrBlocks) {
          if (!block.text?.trim()) continue;
          const bx = drawX + Math.max(0, Math.min(1, block.x)) * drawW;
          const by = drawY + Math.max(0, Math.min(1, block.y + block.height * 0.75)) * drawH;
          const fontSizePt = Math.max(6, Math.min(24, (block.height * drawH * 72) / 25.4));
          pdf.setFontSize(fontSizePt);
          try {
            pdf.text(sanitizeForPdfTextLayer(block.text), bx, by, {
              renderingMode: 'invisible',
              maxWidth: Math.max(10, block.width * drawW),
            });
          } catch {
            // fallback if renderingMode options fail on special characters
          }
        }
      } else if (page.extractedText?.trim()) {
        const lines = page.extractedText.split('\n').filter((l) => l.trim());
        const lineStep = drawH / Math.max(10, lines.length + 2);
        pdf.setFontSize(9);
        lines.forEach((line, idx) => {
          try {
            pdf!.text(
              sanitizeForPdfTextLayer(line),
              drawX + 5,
              drawY + 8 + idx * Math.min(6, lineStep),
              {
                renderingMode: 'invisible',
                maxWidth: Math.max(20, drawW - 10),
              }
            );
          } catch {
            // ignore unsupported glyph
          }
        });
      }
    }

    if (includePageNumbers) {
      pdf.setFontSize(9);
      pdf.setTextColor(120, 120, 120);
      pdf.text(
        `Page ${i + 1} of ${totalPages}`,
        pageWidthMm / 2,
        pageHeightMm - marginMm - 3,
        { align: 'center' }
      );
    }
  }

  if (!pdf) {
    throw new Error('Failed to generate PDF');
  }

  pdf.setProperties({
    title: doc.title || 'Scanned Document',
    subject: `NScanner Export - ${doc.scanMode}`,
    creator: 'NScanner',
  });

  const blob = pdf.output('blob');
  const url = URL.createObjectURL(blob);
  const cleanTitle = (doc.title || 'Scan').replace(/[^a-z0-9_-]/gi, '_');
  const filename = `${cleanTitle}.pdf`;

  return {
    blob,
    url,
    filename,
    sizeBytes: blob.size,
    pageCount: totalPages,
  };
}

/**
 * Exports a single page as a true PNG file (with annotations flattened).
 */
export async function generateSinglePng(
  page: PageItem,
  filenameBase: string
): Promise<{ blob: Blob; url: string; filename: string }> {
  const pngDataUrl = await renderPageWithAnnotations(page, 'image/png', 1.0);
  const res = await fetch(pngDataUrl);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const cleanTitle = filenameBase.replace(/[^a-z0-9_-]/gi, '_');
  return {
    blob,
    url,
    filename: `${cleanTitle}_p${page.pageNumber}.png`,
  };
}

/**
 * Exports pages as a ZIP file containing genuine PNG (or JPEG) high-res images.
 */
export async function generatePngZip(
  doc: ScannedDocument,
  title?: string,
  imageFormat: 'png' | 'jpeg' = 'png'
): Promise<{ blob: Blob; url: string; filename: string }> {
  const zip = new JSZip();
  const folderName = (title || doc.title || 'Scanned_Pages').replace(/[^a-z0-9_-]/gi, '_');
  const imgFolder = zip.folder(folderName) || zip;

  const mime = imageFormat === 'png' ? 'image/png' : 'image/jpeg';
  const ext = imageFormat === 'png' ? 'png' : 'jpg';

  for (let i = 0; i < doc.pages.length; i++) {
    const page = doc.pages[i];
    const encodedUrl = await renderPageWithAnnotations(page, mime, 0.92);
    const base64Data = encodedUrl.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
    const pageLabel = page.label ? `_${page.label.toLowerCase().replace(/\s+/g, '_')}` : '';
    const pageNumberStr = String(i + 1).padStart(2, '0');
    imgFolder.file(`page_${pageNumberStr}${pageLabel}.${ext}`, base64Data, { base64: true });
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const filename = `${folderName}_${imageFormat.toUpperCase()}s.zip`;

  return { blob, url, filename };
}

/**
 * IMPORT PDF:
 * Uses pdfjs-dist to render every page of an uploaded PDF into editable PageItems
 * and extracts embedded text + bounding blocks when present.
 */
export async function importPdfFileToPages(
  file: File,
  onProgress?: (current: number, total: number) => void
): Promise<{ pages: PageItem[]; extractedText: string }> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdfDoc = await loadingTask.promise;
  const total = pdfDoc.numPages;

  const pages: PageItem[] = [];
  const allTexts: string[] = [];

  for (let pNum = 1; pNum <= total; pNum++) {
    if (onProgress) onProgress(pNum, total);
    const page = await pdfDoc.getPage(pNum);
    const viewport = page.getViewport({ scale: 1.8 });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const thumb = await createThumbnail(dataUrl);

    // Extract embedded PDF text if any
    let pageText = '';
    const ocrBlocks: OcrBlock[] = [];
    try {
      const textContent = await page.getTextContent();
      const strings: string[] = [];
      for (const item of textContent.items) {
        if ('str' in item && item.str.trim()) {
          strings.push(item.str);
          const tx = item.transform?.[4] ?? 0;
          const ty = item.transform?.[5] ?? 0;
          const origVp = page.getViewport({ scale: 1 });
          const normX = Math.max(0, Math.min(0.95, tx / origVp.width));
          const normY = Math.max(0, Math.min(0.95, 1 - ty / origVp.height));
          ocrBlocks.push({
            text: item.str,
            x: normX,
            y: normY,
            width: Math.max(0.05, Math.min(0.9, (item.width || 40) / origVp.width)),
            height: 0.025,
          });
        }
      }
      pageText = strings.join(' ').trim();
      if (pageText) allTexts.push(pageText);
    } catch {
      // Scanned image-only PDF without embedded text
    }

    pages.push({
      id: `p_pdf_${Date.now()}_${pNum}`,
      originalDataUrl: dataUrl,
      processedDataUrl: dataUrl,
      thumbnailUrl: thumb,
      pageNumber: pNum,
      rotation: 0,
      filter: 'original',
      label: `Imported Page ${pNum}`,
      adjustments: {
        brightness: 0,
        contrast: 0,
        sharpness: 0,
        warmth: 0,
        saturation: 0,
        shadowRemoval: false,
      },
      extractedText: pageText || undefined,
      ocrBlocks: ocrBlocks.length > 0 ? ocrBlocks : undefined,
      createdAt: Date.now(),
    });
  }

  return {
    pages,
    extractedText: allTexts.join('\n\n'),
  };
}

/**
 * MERGE RAW PDF FILES directly using pdf-lib (preserves vector quality for external PDFs)
 */
export async function mergeRawPdfFiles(files: File[], outputName = 'Merged_Document.pdf'): Promise<GeneratedPdfResult> {
  const mergedPdf = await PDFDocument.create();
  for (const file of files) {
    const bytes = await file.arrayBuffer();
    const donor = await PDFDocument.load(bytes);
    const copied = await mergedPdf.copyPages(donor, donor.getPageIndices());
    copied.forEach((p) => mergedPdf.addPage(p));
  }
  const pdfBytes = await mergedPdf.save();
  const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  return {
    blob,
    url,
    filename: outputName.endsWith('.pdf') ? outputName : `${outputName}.pdf`,
    sizeBytes: blob.size,
    pageCount: mergedPdf.getPageCount(),
  };
}

/**
 * SPLIT DOCUMENT BY PAGE RANGES:
 * Parses syntax like "1-2, 3, 4-5" against total page count and returns PageItem groups.
 */
export function parseSplitRanges(rangeText: string, totalPages: number): number[][] {
  const groups: number[][] = [];
  const parts = rangeText
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-').map((n) => parseInt(n.trim(), 10));
      if (!isNaN(startStr) && !isNaN(endStr)) {
        const start = Math.max(1, Math.min(startStr, totalPages));
        const end = Math.max(start, Math.min(endStr, totalPages));
        const indices: number[] = [];
        for (let p = start; p <= end; p++) {
          indices.push(p - 1);
        }
        if (indices.length > 0) groups.push(indices);
      }
    } else {
      const single = parseInt(part, 10);
      if (!isNaN(single) && single >= 1 && single <= totalPages) {
        groups.push([single - 1]);
      }
    }
  }
  return groups;
}

/**
 * Triggers browser download of a blob URL
 */
export function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
