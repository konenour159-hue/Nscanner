import React, { useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  HelpCircle,
  Mail,
  RotateCcw,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { AppSettings, FilterPreset, ScanMode } from '../types/scanner';
import { DetailedStorageStats } from '../utils/storage';

interface SettingsViewProps {
  settings: AppSettings;
  isAndroidFrame: boolean;
  onToggleAndroidFrame: () => void;
  onUpdateSettings: (next: AppSettings) => void;
  onReloadSamples: () => Promise<void>;
  onClearExportHistory: () => void;
  onOpenAndroidNativeModal: () => void;
  onOpenStorageOverview: () => void;
  onReplayWelcome?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  isAndroidFrame,
  onToggleAndroidFrame,
  onUpdateSettings,
  onReloadSamples,
  onClearExportHistory,
  onOpenAndroidNativeModal,
  onOpenStorageOverview,
  onReplayWelcome,
}) => {
  const [feedback, setFeedback] = useState<string | null>(null);

  function showNote(msg: string) {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 2200);
  }

  function updateField<K extends keyof AppSettings>(key: K, val: AppSettings[K]) {
    onUpdateSettings({ ...settings, [key]: val });
    showNote('Preferences saved');
  }

  return (
    <div className="max-w-3xl space-y-6">
      {feedback && (
        <div className="px-4 py-2.5 rounded-lg bg-[#F5F3FF] border border-[#DDD6FE] text-[#7C3AED] text-xs font-semibold flex items-center gap-2">
          <Check className="w-4 h-4" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Group 1: Capture & Processing */}
      <section className="bg-white border border-[#E6E6EB] rounded-lg p-5 space-y-4 text-xs">
        <h2 className="text-sm font-bold text-[#1C1B22]">Capture &amp; enhancement</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="font-medium text-[#1C1B22]">Default scan mode</span>
            <select
              value={settings.defaultScanMode}
              onChange={(e) => updateField('defaultScanMode', e.target.value as ScanMode)}
              className="w-full min-h-[42px] px-3 py-2 rounded-lg bg-[#FAFAFC] border border-[#E6E6EB] text-[#1C1B22] font-medium focus:outline-none focus:border-[#7C3AED]"
            >
              <option value="document">Multi-Page Document</option>
              <option value="id_card">ID Card (2-Sided)</option>
              <option value="receipt">Expense Receipt</option>
              <option value="book">Book Spread (Split)</option>
              <option value="passport">Passport Bio Page</option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="font-medium text-[#1C1B22]">Default enhancement preset</span>
            <select
              value={settings.defaultFilter}
              onChange={(e) => updateField('defaultFilter', e.target.value as FilterPreset)}
              className="w-full min-h-[42px] px-3 py-2 rounded-lg bg-[#FAFAFC] border border-[#E6E6EB] text-[#1C1B22] font-medium focus:outline-none focus:border-[#7C3AED]"
            >
              <option value="magic">Magic Color (Shadow Removal)</option>
              <option value="bw">B&amp;W Pure</option>
              <option value="grayscale">Grayscale</option>
              <option value="eco">Eco Light</option>
              <option value="original">Original</option>
            </select>
          </label>
        </div>

        <label className="flex items-center justify-between p-3.5 rounded-lg bg-[#FAFAFC] border border-[#E6E6EB] cursor-pointer gap-3">
          <div>
            <div className="font-semibold text-[#1C1B22]">Automatic shutter on steady frame</div>
            <div className="text-[11px] text-[#666672] mt-0.5">
              Captures automatically once detected document corners stabilize in the camera viewfinder.
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.autoCaptureDefault}
            onChange={(e) => updateField('autoCaptureDefault', e.target.checked)}
            className="w-4 h-4 accent-[#7C3AED] cursor-pointer shrink-0"
          />
        </label>
      </section>

      {/* Group 2: Export & OCR */}
      <section className="bg-white border border-[#E6E6EB] rounded-lg p-5 space-y-4 text-xs">
        <h2 className="text-sm font-bold text-[#1C1B22]">Export &amp; OCR</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="font-medium text-[#1C1B22]">Default PDF paper size</span>
            <select
              value={settings.defaultPageSize}
              onChange={(e) =>
                updateField('defaultPageSize', e.target.value as 'a4' | 'letter' | 'original')
              }
              className="w-full min-h-[42px] px-3 py-2 rounded-lg bg-[#FAFAFC] border border-[#E6E6EB] text-[#1C1B22] font-medium focus:outline-none focus:border-[#7C3AED]"
            >
              <option value="a4">A4 Standard (210 × 297 mm)</option>
              <option value="letter">US Letter (8.5 × 11 in)</option>
              <option value="original">Auto-Fit Scan Ratio</option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="font-medium text-[#1C1B22]">Default OCR language</span>
            <select
              value={settings.defaultOcrLanguage}
              onChange={(e) =>
                updateField('defaultOcrLanguage', e.target.value as 'auto' | 'fr' | 'en')
              }
              className="w-full min-h-[42px] px-3 py-2 rounded-lg bg-[#FAFAFC] border border-[#E6E6EB] text-[#1C1B22] font-medium focus:outline-none focus:border-[#7C3AED]"
            >
              <option value="auto">Auto-detect (French / English)</option>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>
      </section>

      {/* Group 3: Workspace & Platform */}
      <section className="bg-white border border-[#E6E6EB] rounded-lg p-5 space-y-4 text-xs">
        <h2 className="text-sm font-bold text-[#1C1B22]">Storage, privacy &amp; platform</h2>

        <p className="text-[#666672] leading-relaxed">
          Scanned pages, folders, signatures, and analytics metrics are saved locally in your browser.
          Images are only sent to the server OCR route when you manually start OCR extraction or naming suggestions.
        </p>

        <div className="flex flex-wrap gap-2.5 pt-1">
          <button
            onClick={onOpenStorageOverview}
            className="min-h-[40px] px-3.5 py-2 rounded-lg bg-white border border-[#E6E6EB] hover:border-[#7C3AED] text-[#1C1B22] hover:text-[#7C3AED] font-medium transition-colors"
          >
            Storage Overview
          </button>

          <button
            onClick={async () => {
              await onReloadSamples();
              showNote('Sample documents restored');
            }}
            className="min-h-[40px] px-3.5 py-2 rounded-lg bg-white border border-[#E6E6EB] hover:border-[#7C3AED] text-[#1C1B22] font-medium flex items-center gap-1.5 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#7C3AED]" />
            <span>Restore Sample Documents</span>
          </button>

          <button
            onClick={() => {
              onClearExportHistory();
              showNote('Export log cleared');
            }}
            className="min-h-[40px] px-3.5 py-2 rounded-lg bg-white border border-[#E6E6EB] hover:border-[#DC2626] text-[#1C1B22] hover:text-[#DC2626] font-medium flex items-center gap-1.5 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5 text-[#DC2626]" />
            <span>Clear Export Log</span>
          </button>

          <button
            onClick={onToggleAndroidFrame}
            className={`hidden md:flex min-h-[40px] px-3.5 py-2 rounded-lg border font-medium items-center gap-1.5 transition-colors ${
              isAndroidFrame
                ? 'bg-[#7C3AED] border-[#7C3AED] text-white'
                : 'bg-white border-[#E6E6EB] hover:border-[#7C3AED] text-[#1C1B22]'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>{isAndroidFrame ? 'Exit Mobile Frame' : 'Preview Mobile Frame'}</span>
          </button>

          <button
            onClick={onOpenAndroidNativeModal}
            className="min-h-[40px] px-3.5 py-2 rounded-lg bg-[#F5F3FF] border border-[#DDD6FE] text-[#7C3AED] hover:bg-[#7C3AED] hover:text-white font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>Android Kotlin Code</span>
          </button>

          {onReplayWelcome && (
            <button
              onClick={onReplayWelcome}
              className="min-h-[40px] px-3.5 py-2 rounded-lg bg-white border border-[#E6E6EB] hover:border-[#7C3AED] text-[#1C1B22] hover:text-[#7C3AED] font-medium transition-colors"
            >
              Replay Welcome Screen
            </button>
          )}
        </div>
      </section>
    </div>
  );
};

interface HelpSupportViewProps {
  storageStats: DetailedStorageStats;
  onStartScan: () => void;
}

export const HelpSupportView: React.FC<HelpSupportViewProps> = ({
  storageStats,
  onStartScan,
}) => {
  const [copiedDiag, setCopiedDiag] = useState(false);

  const guides = [
    {
      title: 'Camera scanning & automatic projection',
      body: 'Point the camera at any page. NScanner highlights text boundaries and applies perspective dewarping automatically. Enable Auto-Snap in the top-right viewfinder controls to capture as soon as corners hold steady.',
    },
    {
      title: 'Batch documents, 2-sided ID cards & book spreads',
      body: 'Switch capture modes along the bottom of the camera viewfinder. ID Card guides you through Front and Back captures and composes an A4 recto-verso sheet. Book Split separates facing pages automatically.',
    },
    {
      title: 'PDF Workspace (Merge, Split, Compress & Images)',
      body: 'Combine multiple scanned documents or external PDF files, extract specific page ranges, optimize file size, or export high-resolution PNG and JPEG archives from PDF Tools.',
    },
    {
      title: 'French & English OCR search',
      body: 'Open any document and switch to the OCR & Tags tab to extract searchable text in French or English. Extracted text is indexed immediately for search across your library and embedded into exported PDFs.',
    },
  ];

  async function copyDiagnostics() {
    const text = [
      'NScanner Diagnostics',
      `Active documents: ${storageStats.count}`,
      `Trashed documents: ${storageStats.trashedCount}`,
      `Stored bytes: ${storageStats.usedBytes}`,
      `User agent: ${navigator.userAgent}`,
    ].join('\n');
    await navigator.clipboard.writeText(text);
    setCopiedDiag(true);
    setTimeout(() => setCopiedDiag(false), 2000);
  }

  return (
    <div className="max-w-3xl space-y-6 text-xs">
      <div className="bg-white border border-[#E6E6EB] rounded-lg p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <HelpCircle className="w-5 h-5 text-[#7C3AED] shrink-0 mt-0.5" />
          <div>
            <h2 className="text-sm font-bold text-[#1C1B22]">Using NScanner</h2>
            <p className="text-[#666672] mt-0.5">
              Quick reference for capture, document editing, PDF workflows, and OCR.
            </p>
          </div>
        </div>

        <button
          onClick={onStartScan}
          className="min-h-[40px] px-3.5 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-semibold transition-colors"
        >
          Open Camera
        </button>
      </div>

      <div className="bg-white border border-[#E6E6EB] rounded-lg divide-y divide-[#E6E6EB]">
        {guides.map((item) => (
          <div key={item.title} className="p-4 space-y-1">
            <h3 className="text-xs sm:text-sm font-semibold text-[#1C1B22]">{item.title}</h3>
            <p className="text-xs text-[#666672] leading-relaxed">{item.body}</p>
          </div>
        ))}
      </div>

      <div className="bg-white border border-[#E6E6EB] rounded-lg p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-[#1C1B22]">Support &amp; feedback</div>
          <div className="text-xs text-[#666672] mt-0.5">
            Share bug reports or feature feedback along with local environment details.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={copyDiagnostics}
            className="min-h-[40px] px-3 py-2 rounded-lg bg-[#FAFAFC] border border-[#E6E6EB] hover:border-[#7C3AED] text-[#1C1B22] font-medium flex items-center gap-1.5 transition-colors"
          >
            {copiedDiag ? <Check className="w-3.5 h-3.5 text-[#16A34A]" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedDiag ? 'Copied' : 'Copy Diagnostics'}</span>
          </button>

          <a
            href="mailto:konenour159@gmail.com?subject=NScanner%20Support"
            className="min-h-[40px] px-3.5 py-2 rounded-lg bg-[#F5F3FF] border border-[#DDD6FE] text-[#7C3AED] hover:bg-[#7C3AED] hover:text-white font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Contact Support</span>
          </a>
        </div>
      </div>
    </div>
  );
};

export const AboutView: React.FC = () => {
  return (
    <div className="max-w-3xl space-y-6 text-xs text-[#1C1B22]">
      <div className="bg-white border border-[#E6E6EB] rounded-lg p-6 flex items-center gap-4">
        <img
          src="/assets/aistudio/image_20c39404.png"
          alt="NScanner"
          className="w-16 h-16 rounded-full object-cover shrink-0 ns-logo-violet"
        />
        <div>
          <h2 className="text-lg font-bold text-[#1C1B22]">NScanner</h2>
          <p className="text-xs font-semibold text-[#7C3AED]">Scan. Manage. Analyze.</p>
          <p className="text-xs text-[#666672] mt-1">
            Document capture, perspective correction, PDF workspace, bilingual OCR, and storage analytics.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white border border-[#E6E6EB] rounded-lg p-4 space-y-1.5">
          <div className="text-sm font-bold text-[#1C1B22]">Capture &amp; Projection</div>
          <p className="text-xs text-[#666672] leading-relaxed">
            Real-time edge detection, continuous perspective dewarping, shadow removal, batch scanning,
            2-sided ID stitching, and dual-page book split.
          </p>
        </div>

        <div className="bg-white border border-[#E6E6EB] rounded-lg p-4 space-y-1.5">
          <div className="text-sm font-bold text-[#1C1B22]">PDF Workspace &amp; OCR</div>
          <p className="text-xs text-[#666672] leading-relaxed">
            Merge, split, compress, annotate, sign, export PDF or PNG packages, and extract searchable
            French and English text.
          </p>
        </div>
      </div>

      <div className="bg-white border border-[#E6E6EB] rounded-lg p-4 space-y-1.5">
        <div className="text-sm font-bold text-[#1C1B22]">Data &amp; Privacy</div>
        <p className="text-xs text-[#666672] leading-relaxed">
          All documents, folders, tags, signatures, and usage analytics live locally in IndexedDB and browser storage.
          Pages are transmitted to OCR endpoints only when you explicitly invoke text extraction or naming suggestions.
        </p>
      </div>

      <div className="pt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#666672]">
        <span>Version 1.0.0</span>
        <span>Designed by Koné Nourdine for public utility.</span>
      </div>
    </div>
  );
};
