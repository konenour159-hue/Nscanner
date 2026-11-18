export type ScanMode = 'id_card' | 'passport' | 'document' | 'receipt' | 'book';

export type FilterPreset = 'original' | 'magic' | 'bw' | 'grayscale' | 'eco';

export interface AdjustmentParams {
  brightness: number; // -100 to 100, default 0
  contrast: number;   // -100 to 100, default 0
  sharpness: number;  // 0 to 100, default 0
  warmth: number;     // -50 to 50, default 0 (cool to warm)
  saturation: number; // -100 to 100, default 0
  shadowRemoval?: boolean; // Local illumination normalization
  shadowStrength?: number; // 0 to 100 illumination flattening intensity
}

export interface CornerPoint {
  x: number; // 0 to 1 normalized
  y: number; // 0 to 1 normalized
}

export interface QuadCorners {
  topLeft: CornerPoint;
  topRight: CornerPoint;
  bottomRight: CornerPoint;
  bottomLeft: CornerPoint;
}

export type AnnotationType = 'pen' | 'highlighter' | 'text' | 'signature' | 'stamp';

export interface PageAnnotation {
  id: string;
  type: AnnotationType;
  color: string;
  strokeWidth?: number; // normalized relative to page width (e.g. 0.004)
  opacity?: number;
  // For pen & highlighter
  points?: { x: number; y: number }[];
  // For text, signature, stamp (normalized 0..1)
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  fontSize?: number; // relative to 1000px base height
  signatureDataUrl?: string;
  createdAt: number;
}

export interface SavedSignature {
  id: string;
  name: string;
  dataUrl: string;
  createdAt: number;
}

export interface OcrBlock {
  text: string;
  x: number;      // 0..1 normalized
  y: number;      // 0..1 normalized
  width: number;  // 0..1 normalized
  height: number; // 0..1 normalized
}

export type OcrLanguage = 'fr' | 'en' | 'mixed';

export interface PageItem {
  id: string;
  originalDataUrl: string;
  processedDataUrl: string;
  thumbnailUrl: string;
  pageNumber: number;
  rotation: number; // 0, 90, 180, 270
  filter: FilterPreset;
  adjustments: AdjustmentParams;
  cropCorners?: QuadCorners;
  label?: string; // e.g. "Front", "Back", "Left Page", "Right Page"
  annotations?: PageAnnotation[];
  extractedText?: string;
  ocrLanguage?: OcrLanguage;
  ocrBlocks?: OcrBlock[];
  createdAt: number;
}

export interface ScannedDocument {
  id: string;
  title: string;
  folderId: string;
  scanMode: ScanMode;
  pages: PageItem[];
  createdAt: number;
  updatedAt: number;
  lastOpenedAt?: number;
  isFavorite?: boolean;
  tags: string[];
  ocrStatus?: 'none' | 'processing' | 'done' | 'error';
  ocrLanguage?: OcrLanguage;
  extractedText?: string;
  suggestedTitles?: string[];
  sourceType?: 'scan' | 'pdf_import' | 'merged' | 'split';
  deletedAt?: number;
}

export interface FolderItem {
  id: string;
  name: string;
  color: string;
  icon?: string;
  createdAt: number;
  isSystem?: boolean;
}

export interface ExportSettings {
  format: 'pdf' | 'png_single' | 'png_zip';
  pageSize: 'a4' | 'letter' | 'original';
  orientation: 'portrait' | 'landscape' | 'auto';
  quality: 'high' | 'medium' | 'low';
  marginMm: number;
  includePageNumbers: boolean;
  searchablePdf?: boolean;
  documentTitle: string;
}

export type SortOption =
  | 'updated_desc'
  | 'opened_desc'
  | 'created_desc'
  | 'title_asc'
  | 'pages_desc';

export interface AppSettings {
  defaultScanMode: ScanMode;
  defaultFilter: FilterPreset;
  autoCaptureDefault: boolean;
  defaultPageSize: 'a4' | 'letter' | 'original';
  defaultOcrLanguage: 'auto' | 'fr' | 'en';
}

export interface ExportEvent {
  id: string;
  documentId?: string;
  documentTitle: string;
  format: 'pdf' | 'png' | 'png_zip' | 'jpeg_zip' | 'merged_pdf' | 'split_pdf' | 'compressed_pdf';
  pageCount: number;
  sizeBytes?: number;
  timestamp: number;
}

export type AnalyticsTimeframe = '7d' | '30d' | '90d' | '12m';

export type AppScreen =
  | 'home'
  | 'documents'
  | 'recent'
  | 'favorites'
  | 'categories'
  | 'trash'
  | 'analytics'
  | 'storage'
  | 'settings'
  | 'help'
  | 'about';

