import { AppSettings, ExportEvent, FolderItem, ScannedDocument, SavedSignature } from '../types/scanner';
import { createThumbnail, stitchRectoVerso } from './imageProcessing';

const DB_NAME = 'NScanner_DB';
const LEGACY_DB_NAME = 'DocuScanPro_DB';
const DB_VERSION = 1;
const STORE_NAME = 'documents';
const FOLDERS_KEY = 'nscanner_folders_v1';
const HAS_SEEDED_KEY = 'nscanner_has_seeded_v1';
const SIGNATURES_KEY = 'nscanner_signatures_v1';
const SETTINGS_KEY = 'nscanner_settings_v1';
const EXPORTS_KEY = 'nscanner_exports_v1';
const WELCOME_COMPLETED_KEY = 'nscanner_welcome_completed_v1';

export function hasCompletedWelcome(): boolean {
  try {
    return localStorage.getItem(WELCOME_COMPLETED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setWelcomeCompleted(completed: boolean): void {
  try {
    if (completed) {
      localStorage.setItem(WELCOME_COMPLETED_KEY, '1');
    } else {
      localStorage.removeItem(WELCOME_COMPLETED_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultScanMode: 'document',
  defaultFilter: 'magic',
  autoCaptureDefault: true,
  defaultPageSize: 'a4',
  defaultOcrLanguage: 'auto',
};

export const DEFAULT_FOLDERS: FolderItem[] = [
  { id: 'f_personal', name: 'Personal & IDs', color: '#7C3AED', isSystem: false, createdAt: Date.now() - 86400000 * 5 },
  { id: 'f_work', name: 'Work & Contracts', color: '#2563EB', isSystem: false, createdAt: Date.now() - 86400000 * 4 },
  { id: 'f_receipts', name: 'Receipts & Expenses', color: '#D97706', isSystem: false, createdAt: Date.now() - 86400000 * 3 },
  { id: 'f_tax', name: 'Tax & Financials', color: '#16A34A', isSystem: false, createdAt: Date.now() - 86400000 * 2 },
];

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function migrateLegacyLocalStorageKey(legacyKey: string, nextKey: string) {
  try {
    if (!localStorage.getItem(nextKey)) {
      const legacyVal = localStorage.getItem(legacyKey);
      if (legacyVal) {
        localStorage.setItem(nextKey, legacyVal);
      }
    }
  } catch {
    // ignore storage errors
  }
}

migrateLegacyLocalStorageKey('docuscan_folders_v1', FOLDERS_KEY);
migrateLegacyLocalStorageKey('docuscan_has_seeded_v1', HAS_SEEDED_KEY);
migrateLegacyLocalStorageKey('docuscan_signatures_v1', SIGNATURES_KEY);

export function getAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;
    return { ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function saveAppSettings(next: AppSettings): AppSettings {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('nscanner:settings-updated', { detail: next }));
  } catch {
    // ignore storage errors
  }
  return next;
}

export function getExportEvents(): ExportEvent[] {
  try {
    const raw = localStorage.getItem(EXPORTS_KEY);
    return raw ? (JSON.parse(raw) as ExportEvent[]) : [];
  } catch {
    return [];
  }
}

export function recordExportEvent(event: Omit<ExportEvent, 'id' | 'timestamp'>): ExportEvent[] {
  const nextItem: ExportEvent = {
    ...event,
    id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
  };
  const next = [nextItem, ...getExportEvents()].slice(0, 200);
  try {
    localStorage.setItem(EXPORTS_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('nscanner:analytics-updated'));
  } catch {
    // ignore storage errors
  }
  return next;
}

export function clearExportEvents(): void {
  try {
    localStorage.removeItem(EXPORTS_KEY);
    window.dispatchEvent(new CustomEvent('nscanner:analytics-updated'));
  } catch {
    // ignore storage errors
  }
}

export function getFolders(): FolderItem[] {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    if (!raw) {
      localStorage.setItem(FOLDERS_KEY, JSON.stringify(DEFAULT_FOLDERS));
      return DEFAULT_FOLDERS;
    }
    return JSON.parse(raw);
  } catch {
    return DEFAULT_FOLDERS;
  }
}

export function saveFolders(folders: FolderItem[]) {
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
}

export function saveFolder(folder: FolderItem): FolderItem[] {
  const folders = getFolders();
  const idx = folders.findIndex((f) => f.id === folder.id);
  if (idx >= 0) {
    folders[idx] = folder;
  } else {
    folders.push(folder);
  }
  saveFolders(folders);
  return folders;
}

export function deleteFolder(folderId: string): FolderItem[] {
  const folders = getFolders().filter((f) => f.id !== folderId);
  saveFolders(folders);
  return folders;
}

export function getSavedSignatures(): SavedSignature[] {
  try {
    const raw = localStorage.getItem(SIGNATURES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveSignature(sig: SavedSignature): SavedSignature[] {
  const list = getSavedSignatures();
  const next = [sig, ...list.filter((s) => s.id !== sig.id)].slice(0, 8);
  localStorage.setItem(SIGNATURES_KEY, JSON.stringify(next));
  return next;
}

export function deleteSignature(sigId: string): SavedSignature[] {
  const next = getSavedSignatures().filter((s) => s.id !== sigId);
  localStorage.setItem(SIGNATURES_KEY, JSON.stringify(next));
  return next;
}

async function readLegacyIndexedDbDocs(): Promise<ScannedDocument[]> {
  try {
    if (typeof indexedDB.databases === 'function') {
      const dbs = await indexedDB.databases();
      if (!dbs.some((d) => d.name === LEGACY_DB_NAME)) {
        return [];
      }
    }
    return await new Promise<ScannedDocument[]>((resolve) => {
      const req = indexedDB.open(LEGACY_DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        // Do not create store if it didn't exist
      };
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.close();
          resolve([]);
          return;
        }
        const tx = db.transaction(STORE_NAME, 'readonly');
        const getAll = tx.objectStore(STORE_NAME).getAll();
        getAll.onsuccess = () => {
          const res = (getAll.result as ScannedDocument[]) || [];
          db.close();
          resolve(res);
        };
        getAll.onerror = () => {
          db.close();
          resolve([]);
        };
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function getAllDocuments(): Promise<ScannedDocument[]> {
  try {
    const db = await openDb();
    const docs = await new Promise<ScannedDocument[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const result = req.result as ScannedDocument[];
        resolve(result);
      };
      req.onerror = () => reject(req.error);
    });

    if (docs.length === 0 && !localStorage.getItem('nscanner_migrated_legacy_v1')) {
      localStorage.setItem('nscanner_migrated_legacy_v1', '1');
      const legacyDocs = await readLegacyIndexedDbDocs();
      if (legacyDocs.length > 0) {
        for (const doc of legacyDocs) {
          await saveDocument(doc);
        }
        legacyDocs.sort((a, b) => b.updatedAt - a.updatedAt);
        return legacyDocs;
      }
    }

    docs.sort((a, b) => b.updatedAt - a.updatedAt);
    return docs;
  } catch (err) {
    console.error('Failed to load docs from IndexedDB, falling back to localStorage', err);
    try {
      const raw = localStorage.getItem('nscanner_docs_fallback') || localStorage.getItem('docuscan_docs_fallback');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
}

export async function saveDocument(doc: ScannedDocument): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(doc);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Failed to save to IndexedDB', err);
  }
}

export async function deleteDocument(docId: string): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(docId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Failed to delete doc', err);
  }
}

export async function moveDocumentToTrash(doc: ScannedDocument): Promise<ScannedDocument> {
  const trashed: ScannedDocument = {
    ...doc,
    deletedAt: Date.now(),
    updatedAt: Date.now(),
  };
  await saveDocument(trashed);
  return trashed;
}

export async function restoreDocumentFromTrash(doc: ScannedDocument): Promise<ScannedDocument> {
  const { deletedAt: _removed, ...rest } = doc;
  const restored: ScannedDocument = {
    ...rest,
    updatedAt: Date.now(),
  };
  await saveDocument(restored);
  return restored;
}

export async function emptyTrashDocuments(docs: ScannedDocument[]): Promise<void> {
  const trashed = docs.filter((d) => Boolean(d.deletedAt));
  for (const d of trashed) {
    await deleteDocument(d.id);
  }
}

export interface DetailedStorageStats {
  usedBytes: number;
  activeBytes: number;
  trashedBytes: number;
  originalBytes: number;
  processedBytes: number;
  thumbnailAndTextBytes: number;
  count: number;
  trashedCount: number;
  browserQuotaBytes: number | null;
  browserUsageBytes: number | null;
}

export function computeDocumentStorageBreakdown(docs: ScannedDocument[]): {
  usedBytes: number;
  activeBytes: number;
  trashedBytes: number;
  originalBytes: number;
  processedBytes: number;
  thumbnailAndTextBytes: number;
} {
  let originalBytes = 0;
  let processedBytes = 0;
  let thumbnailAndTextBytes = 0;
  let activeBytes = 0;
  let trashedBytes = 0;

  for (const doc of docs) {
    let docOrig = 0;
    let docProc = 0;
    let docMeta = (doc.extractedText?.length || 0) + (doc.title?.length || 0);
    for (const p of doc.pages) {
      docOrig += p.originalDataUrl?.length || 0;
      docProc += p.processedDataUrl?.length || 0;
      docMeta += (p.thumbnailUrl?.length || 0) + (p.extractedText?.length || 0);
    }
    originalBytes += docOrig;
    processedBytes += docProc;
    thumbnailAndTextBytes += docMeta;
    const docTotal = docOrig + docProc + docMeta;
    if (doc.deletedAt) {
      trashedBytes += docTotal;
    } else {
      activeBytes += docTotal;
    }
  }

  return {
    usedBytes: originalBytes + processedBytes + thumbnailAndTextBytes,
    activeBytes,
    trashedBytes,
    originalBytes,
    processedBytes,
    thumbnailAndTextBytes,
  };
}

export async function getBrowserStorageEstimate(): Promise<{
  quotaBytes: number | null;
  usageBytes: number | null;
}> {
  try {
    if (navigator.storage && typeof navigator.storage.estimate === 'function') {
      const est = await navigator.storage.estimate();
      return {
        quotaBytes: typeof est.quota === 'number' && est.quota > 0 ? est.quota : null,
        usageBytes: typeof est.usage === 'number' && est.usage >= 0 ? est.usage : null,
      };
    }
  } catch {
    // ignore environments without storage estimate support
  }
  return { quotaBytes: null, usageBytes: null };
}

export async function getStorageEstimate(): Promise<DetailedStorageStats> {
  try {
    const docs = await getAllDocuments();
    const breakdown = computeDocumentStorageBreakdown(docs);
    const browserEst = await getBrowserStorageEstimate();
    const activeCount = docs.filter((d) => !d.deletedAt).length;
    const trashedCount = docs.length - activeCount;
    return {
      ...breakdown,
      count: activeCount,
      trashedCount,
      browserQuotaBytes: browserEst.quotaBytes,
      browserUsageBytes: browserEst.usageBytes,
    };
  } catch {
    return {
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
    };
  }
}

export function resetSampleSeedFlag(): void {
  try {
    localStorage.removeItem(HAS_SEEDED_KEY);
    localStorage.removeItem('docuscan_has_seeded_v1');
  } catch {
    // ignore
  }
}

export async function seedInitialDocumentsIfNeeded(): Promise<ScannedDocument[]> {
  const existing = await getAllDocuments();
  if (existing.length > 0 || localStorage.getItem(HAS_SEEDED_KEY)) {
    return existing;
  }

  const sampleDocs = await generateSampleDocuments();
  for (const doc of sampleDocs) {
    await saveDocument(doc);
  }
  localStorage.setItem(HAS_SEEDED_KEY, 'true');
  return sampleDocs;
}

async function generateSampleDocuments(): Promise<ScannedDocument[]> {
  const docs: ScannedDocument[] = [];

  // 1. ID CARD RECTO-VERSO SAMPLE
  const idFront = createSampleIdCardCanvas('front');
  const idBack = createSampleIdCardCanvas('back');
  const idStitched = await stitchRectoVerso(idFront, idBack, 'a4_stacked');

  const idFrontThumb = await createThumbnail(idFront);
  const idBackThumb = await createThumbnail(idBack);
  const idStitchedThumb = await createThumbnail(idStitched);

  const idFrontText =
    'STATE DRIVER LICENSE - DEPARTMENT OF MOTOR VEHICLES. LIC NO: D94810284. SURNAME: MERCER. GIVEN NAMES: ALEXANDER JAMES. DATE OF BIRTH: 14 MAY 1991. EXPIRATION DATE: 14 MAY 2029. ADDRESS: 742 EVERGREEN TERRACE, SUITE 400.';
  const idBackText =
    'RESTRICTIONS: NONE · ENDORSEMENTS: NONE · ORGAN DONOR: YES. IDUSA10284918204';

  docs.push({
    id: 'doc_id_sample',
    title: 'Driver License - Alex J. Mercer (Recto-Verso)',
    folderId: 'f_personal',
    scanMode: 'id_card',
    createdAt: Date.now() - 3600000 * 24,
    updatedAt: Date.now() - 3600000 * 24,
    lastOpenedAt: Date.now() - 3600000 * 3,
    isFavorite: true,
    tags: ['ID', 'Driver License', 'Official'],
    ocrStatus: 'done',
    ocrLanguage: 'en',
    extractedText: `${idFrontText}\n\n${idBackText}`,
    suggestedTitles: [
      'Driver License - Alexander Mercer',
      'DMV Identification D94810284',
      'Alex Mercer ID Recto-Verso',
    ],
    pages: [
      {
        id: 'p_id_stitched',
        originalDataUrl: idStitched,
        processedDataUrl: idStitched,
        thumbnailUrl: idStitchedThumb,
        pageNumber: 1,
        rotation: 0,
        filter: 'magic',
        label: 'A4 Recto-Verso Composite',
        extractedText: `${idFrontText}\n${idBackText}`,
        ocrLanguage: 'en',
        adjustments: { brightness: 5, contrast: 15, sharpness: 20, warmth: 0, saturation: 5, shadowRemoval: true },
        createdAt: Date.now() - 3600000 * 24,
      },
      {
        id: 'p_id_front',
        originalDataUrl: idFront,
        processedDataUrl: idFront,
        thumbnailUrl: idFrontThumb,
        pageNumber: 2,
        rotation: 0,
        filter: 'magic',
        label: 'Front Side',
        extractedText: idFrontText,
        ocrLanguage: 'en',
        adjustments: { brightness: 0, contrast: 10, sharpness: 15, warmth: 0, saturation: 0, shadowRemoval: true },
        createdAt: Date.now() - 3600000 * 24,
      },
      {
        id: 'p_id_back',
        originalDataUrl: idBack,
        processedDataUrl: idBack,
        thumbnailUrl: idBackThumb,
        pageNumber: 3,
        rotation: 0,
        filter: 'magic',
        label: 'Back Side',
        extractedText: idBackText,
        ocrLanguage: 'en',
        adjustments: { brightness: 0, contrast: 10, sharpness: 15, warmth: 0, saturation: 0, shadowRemoval: true },
        createdAt: Date.now() - 3600000 * 24,
      },
    ],
  });

  // 2. WORK CONTRACT SAMPLE (2 Pages)
  const contractP1 = createSampleContractCanvas(1);
  const contractP2 = createSampleContractCanvas(2);
  const contractP1Thumb = await createThumbnail(contractP1);
  const contractP2Thumb = await createThumbnail(contractP2);

  const contractP1Text =
    'MASTER CONSULTING SERVICES AGREEMENT. Reference: MSA-2026-094. Effective Date: November 1, 2026. 1. PURPOSE AND SCOPE OF WORK: Entered into by Apex Systems Group LLC and Lumina Digital Consulting Ltd. Rate: $225.00 per hour payable net 30 days.';
  const contractP2Text =
    '5. WARRANTIES AND INDEMNIFICATION. 6. SIGNATURES AND ACKNOWLEDGMENTS. Authorized Signature: Marcus Vance, VP Tech. Authorized Signature: Sarah Chen, Principal. OFFICIALLY EXECUTED.';

  docs.push({
    id: 'doc_contract_sample',
    title: 'Consulting Master Services Agreement',
    folderId: 'f_work',
    scanMode: 'document',
    createdAt: Date.now() - 3600000 * 48,
    updatedAt: Date.now() - 3600000 * 10,
    lastOpenedAt: Date.now() - 3600000 * 1,
    isFavorite: true,
    tags: ['Contract', 'Legal', 'Signed'],
    ocrStatus: 'done',
    ocrLanguage: 'en',
    extractedText: `${contractP1Text}\n\n${contractP2Text}`,
    suggestedTitles: [
      'Apex & Lumina MSA-2026-094',
      'Master Consulting Agreement - Signed',
      'Lumina Digital Services Contract',
    ],
    pages: [
      {
        id: 'p_c1',
        originalDataUrl: contractP1,
        processedDataUrl: contractP1,
        thumbnailUrl: contractP1Thumb,
        pageNumber: 1,
        rotation: 0,
        filter: 'magic',
        label: 'Page 1',
        extractedText: contractP1Text,
        ocrLanguage: 'en',
        adjustments: { brightness: 8, contrast: 25, sharpness: 30, warmth: -5, saturation: 0, shadowRemoval: true },
        createdAt: Date.now() - 3600000 * 48,
      },
      {
        id: 'p_c2',
        originalDataUrl: contractP2,
        processedDataUrl: contractP2,
        thumbnailUrl: contractP2Thumb,
        pageNumber: 2,
        rotation: 0,
        filter: 'magic',
        label: 'Page 2 (Signatures)',
        extractedText: contractP2Text,
        ocrLanguage: 'en',
        adjustments: { brightness: 8, contrast: 25, sharpness: 30, warmth: -5, saturation: 0, shadowRemoval: true },
        createdAt: Date.now() - 3600000 * 48,
      },
    ],
  });

  // 3. RECEIPT SAMPLE
  const receiptImg = createSampleReceiptCanvas();
  const receiptThumb = await createThumbnail(receiptImg);
  const receiptText =
    'ACME ORGANIC MARKET STORE #4810. 2026-11-04. Organic Avocado $5.99, Almond Milk $3.49, Sourdough Loaf $6.50, Espresso Beans $14.25, Olive Oil $18.50. SUBTOTAL $67.20. TAX $5.54. TOTAL DUE $72.74. VISA *8831 APPROVED.';

  docs.push({
    id: 'doc_receipt_sample',
    title: 'Acme Supermarket - Grocery Expense',
    folderId: 'f_receipts',
    scanMode: 'receipt',
    createdAt: Date.now() - 3600000 * 12,
    updatedAt: Date.now() - 3600000 * 12,
    tags: ['Expense', 'Receipt', 'Q4'],
    ocrStatus: 'done',
    ocrLanguage: 'en',
    extractedText: receiptText,
    suggestedTitles: [
      'Acme Organic Market - $72.74',
      'Grocery Receipt Nov 4 2026',
      'Store 4810 Expense Receipt',
    ],
    pages: [
      {
        id: 'p_rec1',
        originalDataUrl: receiptImg,
        processedDataUrl: receiptImg,
        thumbnailUrl: receiptThumb,
        pageNumber: 1,
        rotation: 0,
        filter: 'bw',
        label: 'Receipt Strip',
        extractedText: receiptText,
        ocrLanguage: 'en',
        adjustments: { brightness: 12, contrast: 40, sharpness: 35, warmth: 0, saturation: 0, shadowRemoval: true },
        createdAt: Date.now() - 3600000 * 12,
      },
    ],
  });

  // 4. FRENCH INVOICE SAMPLE (Demonstrates FR/EN bilingual OCR & Search)
  const frInvoiceImg = createSampleFrenchInvoiceCanvas();
  const frInvoiceThumb = await createThumbnail(frInvoiceImg);
  const frText =
    "FACTURE N° FAC-2026-1184. Émise le 12 novembre 2026. Électricité & Services France SAS. Client: Atelier Lumière Paris. Montant HT: 340,00 EUR. TVA (20%): 68,00 EUR. Total TTC à payer: 408,00 EUR. Paiement par virement bancaire sous 30 jours.";

  docs.push({
    id: 'doc_fr_invoice_sample',
    title: 'Facture Électricité & Services - Nov 2026',
    folderId: 'f_tax',
    scanMode: 'document',
    createdAt: Date.now() - 3600000 * 6,
    updatedAt: Date.now() - 3600000 * 6,
    lastOpenedAt: Date.now() - 3600000 * 2,
    tags: ['Facture', 'TVA', 'France'],
    ocrStatus: 'done',
    ocrLanguage: 'fr',
    extractedText: frText,
    suggestedTitles: [
      'Facture FAC-2026-1184 - 408,00 EUR',
      'Atelier Lumière - Facture Nov 2026',
      'Justificatif Comptable TVA 20%',
    ],
    pages: [
      {
        id: 'p_fr1',
        originalDataUrl: frInvoiceImg,
        processedDataUrl: frInvoiceImg,
        thumbnailUrl: frInvoiceThumb,
        pageNumber: 1,
        rotation: 0,
        filter: 'magic',
        label: 'Page 1',
        extractedText: frText,
        ocrLanguage: 'fr',
        adjustments: { brightness: 5, contrast: 20, sharpness: 25, warmth: 0, saturation: 0, shadowRemoval: true },
        createdAt: Date.now() - 3600000 * 6,
      },
    ],
  });

  return docs;
}

function createSampleFrenchInvoiceCanvas(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1240;
  canvas.height = 1754;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, 1240, 1754);

  ctx.fillStyle = '#1E1B4B';
  ctx.fillRect(0, 0, 1240, 170);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 38px Inter, sans-serif';
  ctx.fillText('FACTURE', 90, 95);
  ctx.font = '500 18px Inter, sans-serif';
  ctx.fillText('Électricité & Services France SAS · SIRET 842 190 441 00028', 90, 135);

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 22px Inter, sans-serif';
  ctx.fillText('Référence : FAC-2026-1184', 90, 250);
  ctx.font = '18px Inter, sans-serif';
  ctx.fillStyle = '#475569';
  ctx.fillText('Date d’émission : 12 novembre 2026', 90, 286);
  ctx.fillText('Client : Atelier Lumière Paris — 18 Rue de Rivoli, 75004 Paris', 90, 322);

  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 2;
  ctx.strokeRect(90, 380, 1060, 460);

  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(92, 382, 1056, 65);
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 18px Inter, sans-serif';
  ctx.fillText('Désignation des prestations', 120, 422);
  ctx.textAlign = 'right';
  ctx.fillText('Montant HT', 1110, 422);
  ctx.textAlign = 'left';

  ctx.font = '18px Inter, sans-serif';
  ctx.fillText('Abonnement Énergie Professionnelle — Tranche Novembre 2026', 120, 500);
  ctx.textAlign = 'right';
  ctx.fillText('240,00 €', 1110, 500);

  ctx.textAlign = 'left';
  ctx.fillText('Maintenance & Contrôle Technique Réseau', 120, 560);
  ctx.textAlign = 'right';
  ctx.fillText('100,00 €', 1110, 560);

  ctx.textAlign = 'left';
  ctx.strokeStyle = '#CBD5E1';
  ctx.beginPath();
  ctx.moveTo(120, 640);
  ctx.lineTo(1110, 640);
  ctx.stroke();

  ctx.fillText('Total HT', 780, 690);
  ctx.textAlign = 'right';
  ctx.fillText('340,00 €', 1110, 690);

  ctx.textAlign = 'left';
  ctx.fillText('TVA (20,0 %)', 780, 735);
  ctx.textAlign = 'right';
  ctx.fillText('68,00 €', 1110, 735);

  ctx.textAlign = 'left';
  ctx.font = 'bold 24px Inter, sans-serif';
  ctx.fillStyle = '#7C3AED';
  ctx.fillText('TOTAL TTC À PAYER', 780, 795);
  ctx.textAlign = 'right';
  ctx.fillText('408,00 €', 1110, 795);
  ctx.textAlign = 'left';

  ctx.fillStyle = '#64748B';
  ctx.font = '16px Inter, sans-serif';
  ctx.fillText('Conditions : Paiement par virement bancaire sous 30 jours.', 90, 920);

  return canvas.toDataURL('image/jpeg', 0.92);
}

function createSampleIdCardCanvas(side: 'front' | 'back'): string {
  const canvas = document.createElement('canvas');
  canvas.width = 856;
  canvas.height = 540;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const grad = ctx.createLinearGradient(0, 0, 856, 540);
  grad.addColorStop(0, '#F1F5F9');
  grad.addColorStop(0.5, '#E2E8F0');
  grad.addColorStop(1, '#CBD5E1');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 856, 540);

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 856; i += 28) {
    ctx.beginPath();
    ctx.arc(i, 270, 220, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = '#1E3A8A';
  ctx.fillRect(0, 0, 856, 90);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 26px Inter, sans-serif';
  ctx.fillText('STATE DRIVER LICENSE', 36, 46);
  ctx.font = '500 14px Inter, sans-serif';
  ctx.fillText('DEPARTMENT OF MOTOR VEHICLES · IDENTIFICATION DIVISION', 36, 72);

  ctx.fillStyle = '#F59E0B';
  ctx.beginPath();
  ctx.arc(800, 45, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1E3A8A';
  ctx.font = 'bold 18px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('★', 800, 52);
  ctx.textAlign = 'left';

  if (side === 'front') {
    ctx.fillStyle = '#94A3B8';
    ctx.fillRect(40, 120, 180, 240);
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.arc(130, 200, 45, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(130, 310, 75, Math.PI, 0, false);
    ctx.fill();

    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 15px Inter, sans-serif';
    ctx.fillText('LIC NO: D94810284', 250, 140);

    ctx.fillStyle = '#64748B';
    ctx.font = '12px Inter, sans-serif';
    ctx.fillText('1. SURNAME', 250, 175);
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 18px Inter, sans-serif';
    ctx.fillText('MERCER', 250, 195);

    ctx.fillStyle = '#64748B';
    ctx.font = '12px Inter, sans-serif';
    ctx.fillText('2. GIVEN NAMES', 250, 225);
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 18px Inter, sans-serif';
    ctx.fillText('ALEXANDER JAMES', 250, 245);

    ctx.fillStyle = '#64748B';
    ctx.font = '12px Inter, sans-serif';
    ctx.fillText('3. DATE OF BIRTH', 250, 275);
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 16px Inter, sans-serif';
    ctx.fillText('14 MAY 1991', 250, 295);

    ctx.fillStyle = '#64748B';
    ctx.font = '12px Inter, sans-serif';
    ctx.fillText('4. EXPIRATION DATE', 480, 275);
    ctx.fillStyle = '#DC2626';
    ctx.font = 'bold 16px Inter, sans-serif';
    ctx.fillText('14 MAY 2029', 480, 295);

    ctx.fillStyle = '#64748B';
    ctx.font = '12px Inter, sans-serif';
    ctx.fillText('8. ADDRESS', 250, 325);
    ctx.fillStyle = '#0F172A';
    ctx.font = '500 15px Inter, sans-serif';
    ctx.fillText('742 EVERGREEN TERRACE, SUITE 400', 250, 345);

    ctx.strokeStyle = '#0284C7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(250, 420);
    ctx.bezierCurveTo(320, 390, 380, 440, 460, 400);
    ctx.stroke();
    ctx.fillStyle = '#64748B';
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText('HOLDER SIGNATURE', 250, 440);
  } else {
    ctx.fillStyle = '#1E293B';
    ctx.fillRect(0, 110, 856, 75);

    ctx.fillStyle = '#0F172A';
    for (let bx = 60; bx < 800; bx += 4) {
      if ((bx * 7) % 3 === 0) {
        ctx.fillRect(bx, 220, 2.5, 120);
      }
    }

    ctx.fillStyle = '#64748B';
    ctx.font = '13px Inter, sans-serif';
    ctx.fillText('RESTRICTIONS: NONE · ENDORSEMENTS: NONE · ORGAN DONOR: YES', 60, 380);
    ctx.fillText('THIS CARD IS PROPERTY OF THE STATE. IF FOUND RETURN TO NEAREST DMV OFFICE.', 60, 410);

    ctx.font = 'bold 15px "JetBrains Mono", monospace';
    ctx.fillStyle = '#0F172A';
    ctx.fillText('IDUSA10284918204<<<<<<<<<<<<<<<', 60, 460);
    ctx.fillText('9105142M2905148USA<<<<<<<<<<<<<6', 60, 485);
  }

  return canvas.toDataURL('image/jpeg', 0.92);
}

function createSampleContractCanvas(pageNum: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1240;
  canvas.height = 1754;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#FCFDFE';
  ctx.fillRect(0, 0, 1240, 1754);

  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.strokeRect(40, 40, 1160, 1674);

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 32px Inter, sans-serif';
  ctx.fillText('MASTER CONSULTING SERVICES AGREEMENT', 90, 120);

  ctx.fillStyle = '#64748B';
  ctx.font = '500 16px Inter, sans-serif';
  ctx.fillText('Reference: MSA-2026-094 · Effective Date: November 1, 2026', 90, 155);

  ctx.strokeStyle = '#CBD5E1';
  ctx.beginPath();
  ctx.moveTo(90, 180);
  ctx.lineTo(1150, 180);
  ctx.stroke();

  if (pageNum === 1) {
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 20px Inter, sans-serif';
    ctx.fillText('1. PURPOSE AND SCOPE OF WORK', 90, 230);

    const lines = [
      'This Master Services Agreement ("Agreement") is entered into by and between Apex Systems Group LLC',
      '("Client") and Lumina Digital Consulting Ltd. ("Service Provider"). The parties agree to the following',
      'terms regarding technical architecture, digital transformation, and software engineering services.',
      '',
      '2. TERM AND TERMINATION',
      'This Agreement shall commence on the Effective Date and continue for a period of twelve (12) calendar',
      'months, unless terminated earlier in accordance with the provisions of Section 7 herein.',
      '',
      '3. COMPENSATION AND INVOICING',
      'Client agrees to pay Consultant at the agreed rate of $225.00 per hour. Invoices shall be submitted',
      'bi-weekly and shall be payable net thirty (30) days following receipt by Client.',
      '',
      '4. CONFIDENTIALITY AND PROPRIETARY RIGHTS',
      'All deliverables, designs, code bases, and technical documentation produced under this agreement shall',
      'remain the sole and exclusive intellectual property of Client upon complete satisfaction of fees.',
    ];

    let y = 270;
    for (const line of lines) {
      if (line.startsWith('2.') || line.startsWith('3.') || line.startsWith('4.')) {
        ctx.font = 'bold 20px Inter, sans-serif';
        y += 15;
      } else {
        ctx.font = '400 17px Inter, sans-serif';
      }
      ctx.fillText(line, 90, y);
      y += 34;
    }
  } else {
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 20px Inter, sans-serif';
    ctx.fillText('5. WARRANTIES AND INDEMNIFICATION', 90, 230);

    ctx.font = '400 17px Inter, sans-serif';
    ctx.fillText('Service Provider warrants that all work performed shall adhere to industry-standard best practices.', 90, 270);
    ctx.fillText('Neither party shall be liable for incidental, special, or consequential damages.', 90, 305);

    ctx.font = 'bold 20px Inter, sans-serif';
    ctx.fillText('6. SIGNATURES AND ACKNOWLEDGMENTS', 90, 380);

    ctx.strokeStyle = '#94A3B8';
    ctx.strokeRect(90, 420, 480, 200);
    ctx.strokeRect(630, 420, 480, 200);

    ctx.fillStyle = '#475569';
    ctx.font = 'bold 15px Inter, sans-serif';
    ctx.fillText('CLIENT: APEX SYSTEMS GROUP LLC', 110, 450);
    ctx.fillText('SERVICE PROVIDER: LUMINA DIGITAL', 650, 450);

    ctx.strokeStyle = '#1D4ED8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(110, 540);
    ctx.bezierCurveTo(160, 500, 220, 570, 320, 520);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(650, 540);
    ctx.bezierCurveTo(720, 490, 780, 580, 880, 520);
    ctx.stroke();

    ctx.fillStyle = '#64748B';
    ctx.font = '14px Inter, sans-serif';
    ctx.fillText('Authorized Signature: Marcus Vance, VP Tech', 110, 585);
    ctx.fillText('Authorized Signature: Sarah Chen, Principal', 650, 585);

    ctx.save();
    ctx.translate(920, 720);
    ctx.rotate(-0.12);
    ctx.strokeStyle = '#DC2626';
    ctx.lineWidth = 3;
    ctx.strokeRect(-90, -45, 180, 90);
    ctx.fillStyle = '#DC2626';
    ctx.font = 'bold 18px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('OFFICIALLY EXECUTED', 0, -10);
    ctx.font = '13px Inter, sans-serif';
    ctx.fillText('LEGAL AUDIT VERIFIED', 0, 18);
    ctx.restore();
  }

  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 14px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Page ${pageNum} of 2 · Confidential Document`, 620, 1690);

  return canvas.toDataURL('image/jpeg', 0.92);
}

function createSampleReceiptCanvas(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 1200;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, 0, 600, 1200);

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 28px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('ACME ORGANIC MARKET', 300, 80);

  ctx.font = '15px "JetBrains Mono", monospace';
  ctx.fillText('STORE #4810 · DOWNTOWN', 300, 115);
  ctx.fillText('TEL: (555) 019-2834', 300, 140);
  ctx.fillText('2026-11-04 18:42:10 CASHIER: EMILY', 300, 175);

  ctx.fillText('----------------------------------------', 300, 205);

  ctx.textAlign = 'left';
  const items = [
    { name: 'ORGANIC AVOCADO HASS 4PK', price: '$5.99' },
    { name: 'ALMOND MILK UNSWEETENED', price: '$3.49' },
    { name: 'SOURDOUGH ARTISAN LOAF', price: '$6.50' },
    { name: 'FREE RANGE EGGS DOZEN', price: '$4.99' },
    { name: 'FAIR TRADE ESPRESSO BEANS', price: '$14.25' },
    { name: 'GREEK YOGURT PLAIN 32OZ', price: '$5.49' },
    { name: 'WILD BLUEBERRIES 1LB', price: '$7.99' },
    { name: 'EXTRA VIRGIN OLIVE OIL', price: '$18.50' },
  ];

  let y = 250;
  for (const item of items) {
    ctx.fillText(item.name, 40, y);
    ctx.textAlign = 'right';
    ctx.fillText(item.price, 560, y);
    ctx.textAlign = 'left';
    y += 40;
  }

  y += 20;
  ctx.textAlign = 'center';
  ctx.fillText('----------------------------------------', 300, y);
  y += 40;

  ctx.textAlign = 'left';
  ctx.fillText('SUBTOTAL', 40, y);
  ctx.textAlign = 'right';
  ctx.fillText('$67.20', 560, y);

  y += 35;
  ctx.textAlign = 'left';
  ctx.fillText('STATE SALES TAX (8.25%)', 40, y);
  ctx.textAlign = 'right';
  ctx.fillText('$5.54', 560, y);

  y += 45;
  ctx.font = 'bold 24px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText('TOTAL DUE', 40, y);
  ctx.textAlign = 'right';
  ctx.fillText('$72.74', 560, y);

  y += 50;
  ctx.font = '16px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText('VISA ENDING IN *8831', 40, y);
  ctx.textAlign = 'right';
  ctx.fillText('APPROVED', 560, y);

  y += 80;
  ctx.fillStyle = '#0F172A';
  for (let bx = 80; bx < 520; bx += 5) {
    if ((bx * 13) % 4 !== 0) {
      ctx.fillRect(bx, y, 3, 70);
    }
  }

  y += 95;
  ctx.textAlign = 'center';
  ctx.font = '13px "JetBrains Mono", monospace';
  ctx.fillText('SCAN-ID: 9481-0284-8821-0492', 300, y);
  y += 25;
  ctx.fillText('THANK YOU FOR SHOPPING FRESH & LOCAL!', 300, y);

  return canvas.toDataURL('image/jpeg', 0.92);
}
