import React, { useMemo, useState } from 'react';
import { Camera, FileText, Download, HardDrive, Layers, Clock } from 'lucide-react';
import {
  AnalyticsTimeframe,
  ExportEvent,
  FolderItem,
  ScanMode,
  ScannedDocument,
} from '../types/scanner';
import { DetailedStorageStats } from '../utils/storage';

interface AnalyticsViewProps {
  documents: ScannedDocument[];
  folders: FolderItem[];
  exportEvents: ExportEvent[];
  storageStats: DetailedStorageStats;
  timeframe?: AnalyticsTimeframe;
  onTimeframeChange?: (tf: AnalyticsTimeframe) => void;
  onOpenStorageOverview?: () => void;
  onStartScan: (mode?: ScanMode) => void;
  onSelectDocument: (doc: ScannedDocument) => void;
}

interface ActivityBucket {
  key: string;
  label: string;
  fullLabel: string;
  docCount: number;
  pageCount: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatRelativeDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatExportLabel(format: ExportEvent['format']): string {
  switch (format) {
    case 'pdf':
      return 'PDF';
    case 'png':
      return 'PNG';
    case 'png_zip':
      return 'PNG ZIP';
    case 'jpeg_zip':
      return 'JPEG ZIP';
    case 'merged_pdf':
      return 'Merged PDF';
    case 'split_pdf':
      return 'Split PDF';
    case 'compressed_pdf':
      return 'Compressed PDF';
  }
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  documents,
  folders,
  exportEvents,
  storageStats,
  timeframe: controlledTimeframe,
  onTimeframeChange,
  onOpenStorageOverview,
  onStartScan,
  onSelectDocument,
}) => {
  const [internalTimeframe, setInternalTimeframe] = useState<AnalyticsTimeframe>('30d');
  const timeframe = controlledTimeframe ?? internalTimeframe;
  const setTimeframe = (next: AnalyticsTimeframe) => {
    setInternalTimeframe(next);
    onTimeframeChange?.(next);
  };
  const [hoveredBucketIdx, setHoveredBucketIdx] = useState<number | null>(null);
  const [hoveredSlice, setHoveredSlice] = useState<string | null>(null);

  const totalPages = useMemo(
    () => documents.reduce((acc, doc) => acc + doc.pages.length, 0),
    [documents]
  );

  // Build real time-series buckets from document creation timestamps
  const activityBuckets = useMemo<ActivityBucket[]>(() => {
    const now = new Date();
    const buckets: ActivityBucket[] = [];

    if (timeframe === '7d' || timeframe === '30d') {
      const days = timeframe === '7d' ? 7 : 30;
      const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
      const map = new Map<string, ActivityBucket>();

      for (let i = 0; i < days; i++) {
        const d = new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate() + i);
        const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
        const label =
          days === 7
            ? d.toLocaleDateString(undefined, { weekday: 'short' })
            : i % 5 === 0 || i === days - 1
            ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            : '';
        const fullLabel = d.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
        const bucket = { key, label, fullLabel, docCount: 0, pageCount: 0 };
        buckets.push(bucket);
        map.set(key, bucket);
      }

      for (const doc of documents) {
        const d = new Date(doc.createdAt);
        const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
        const target = map.get(key);
        if (target) {
          target.docCount += 1;
          target.pageCount += doc.pages.length;
        }
      }
      return buckets;
    }

    if (timeframe === '90d') {
      // 13 weekly buckets covering the last 91 days
      const weeks = 13;
      const msPerWeek = 7 * 86400000;
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
      const startMs = endOfToday - weeks * msPerWeek + 1;

      for (let w = 0; w < weeks; w++) {
        const wStart = new Date(startMs + w * msPerWeek);
        const wEnd = new Date(startMs + (w + 1) * msPerWeek - 1);
        const label =
          w % 3 === 0 || w === weeks - 1
            ? wStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            : '';
        const fullLabel = `${wStart.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        })} – ${wEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
        buckets.push({
          key: `w_${w}`,
          label,
          fullLabel,
          docCount: 0,
          pageCount: 0,
        });
      }

      for (const doc of documents) {
        if (doc.createdAt >= startMs && doc.createdAt <= endOfToday) {
          const idx = Math.min(weeks - 1, Math.floor((doc.createdAt - startMs) / msPerWeek));
          if (idx >= 0) {
            buckets[idx].docCount += 1;
            buckets[idx].pageCount += doc.pages.length;
          }
        }
      }
      return buckets;
    }

    // 12m: Last 12 calendar months
    const monthMap = new Map<string, ActivityBucket>();
    for (let m = 11; m >= 0; m--) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      const label = d.toLocaleDateString(undefined, { month: 'short' });
      const fullLabel = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      const bucket = { key, label, fullLabel, docCount: 0, pageCount: 0 };
      buckets.push(bucket);
      monthMap.set(key, bucket);
    }

    for (const doc of documents) {
      const d = new Date(doc.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      const target = monthMap.get(key);
      if (target) {
        target.docCount += 1;
        target.pageCount += doc.pages.length;
      }
    }
    return buckets;
  }, [documents, timeframe]);

  const docsInTimeframe = useMemo(
    () => activityBuckets.reduce((sum, b) => sum + b.docCount, 0),
    [activityBuckets]
  );

  const maxBucketCount = useMemo(
    () => Math.max(1, ...activityBuckets.map((b) => b.docCount)),
    [activityBuckets]
  );

  // Real Document Distribution by Format Category
  const distribution = useMemo(() => {
    let pdfCount = 0;
    let imageCount = 0;
    let otherCount = 0;

    for (const doc of documents) {
      const isPdfCategory =
        doc.sourceType === 'pdf_import' ||
        doc.sourceType === 'merged' ||
        doc.sourceType === 'split' ||
        (doc.scanMode === 'document' && doc.pages.length > 1);

      if (isPdfCategory) {
        pdfCount += 1;
      } else if (doc.scanMode === 'document' || doc.scanMode === 'book') {
        imageCount += 1;
      } else {
        otherCount += 1;
      }
    }

    const total = documents.length;
    const slices = [
      {
        id: 'pdf',
        label: 'PDF',
        detail: 'Imported, merged & multi-page PDFs',
        count: pdfCount,
        color: '#7C3AED',
      },
      {
        id: 'images',
        label: 'Images',
        detail: 'Single-page document & book scans',
        count: imageCount,
        color: '#A78BFA',
      },
      {
        id: 'other',
        label: 'Other formats',
        detail: 'ID cards, passports & receipts',
        count: otherCount,
        color: '#DDD6FE',
      },
    ];

    return { total, slices };
  }, [documents]);

  // Storage proportions
  const storageDenominator = Math.max(1, storageStats.usedBytes);
  const origPct = Math.round((storageStats.originalBytes / storageDenominator) * 100);
  const procPct = Math.round((storageStats.processedBytes / storageDenominator) * 100);
  const metaPct = Math.max(0, 100 - origPct - procPct);

  const recentDocs = useMemo(
    () =>
      [...documents]
        .sort((a, b) => (b.lastOpenedAt || b.updatedAt) - (a.lastOpenedAt || a.updatedAt))
        .slice(0, 5),
    [documents]
  );

  const recentExports = useMemo(() => exportEvents.slice(0, 5), [exportEvents]);

  // SVG Donut geometry
  const donutRadius = 56;
  const donutCircumference = 2 * Math.PI * donutRadius;
  let runningOffset = 0;

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[#666672]">
          Metrics derived from your stored documents, exports, and browser storage.
        </p>

        <div className="flex items-center gap-2">
          {onOpenStorageOverview && (
            <button
              onClick={onOpenStorageOverview}
              className="min-h-[38px] flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#E6E6EB] hover:border-[#7C3AED] text-[#1C1B22] hover:text-[#7C3AED] text-xs font-medium transition-colors whitespace-nowrap"
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>Storage Overview</span>
            </button>
          )}
          <button
            onClick={() => onStartScan('document')}
            className="min-h-[38px] flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold transition-colors whitespace-nowrap"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Scan Document</span>
          </button>
        </div>
      </div>

      {/* KPI Row — Single-Elevation Hairline Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#E6E6EB] rounded-lg p-4">
          <div className="flex items-center justify-between text-xs text-[#666672]">
            <span>Documents scanned</span>
            <FileText className="w-4 h-4 text-[#7C3AED]" />
          </div>
          <div className="text-2xl font-bold text-[#1C1B22] mt-2 tabular-nums">
            {documents.length}
          </div>
          <div className="text-[11px] text-[#666672] mt-1 tabular-nums">
            Across {folders.length} {folders.length === 1 ? 'folder' : 'folders'}
          </div>
        </div>

        <div className="bg-white border border-[#E6E6EB] rounded-lg p-4">
          <div className="flex items-center justify-between text-xs text-[#666672]">
            <span>Pages captured</span>
            <Layers className="w-4 h-4 text-[#7C3AED]" />
          </div>
          <div className="text-2xl font-bold text-[#1C1B22] mt-2 tabular-nums">
            {totalPages}
          </div>
          <div className="text-[11px] text-[#666672] mt-1 tabular-nums">
            {documents.length > 0
              ? `${(totalPages / documents.length).toFixed(1)} avg pages/doc`
              : 'No pages stored'}
          </div>
        </div>

        <div className="bg-white border border-[#E6E6EB] rounded-lg p-4">
          <div className="flex items-center justify-between text-xs text-[#666672]">
            <span>Exports completed</span>
            <Download className="w-4 h-4 text-[#7C3AED]" />
          </div>
          <div className="text-2xl font-bold text-[#1C1B22] mt-2 tabular-nums">
            {exportEvents.length}
          </div>
          <div className="text-[11px] text-[#666672] mt-1 tabular-nums">
            {exportEvents.length > 0
              ? `Last: ${formatExportLabel(exportEvents[0].format)}`
              : 'Tracked on download'}
          </div>
        </div>

        <div className="bg-white border border-[#E6E6EB] rounded-lg p-4">
          <div className="flex items-center justify-between text-xs text-[#666672]">
            <span>Document cache</span>
            <HardDrive className="w-4 h-4 text-[#7C3AED]" />
          </div>
          <div className="text-2xl font-bold text-[#1C1B22] mt-2 tabular-nums">
            {formatBytes(storageStats.usedBytes)}
          </div>
          <div className="text-[11px] text-[#666672] mt-1 tabular-nums">
            {storageStats.browserQuotaBytes
              ? `of ${formatBytes(storageStats.browserQuotaBytes)} quota`
              : 'IndexedDB local store'}
          </div>
        </div>
      </div>

      {/* Main Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* A. Scanning Activity Chart */}
        <div className="lg:col-span-2 bg-white border border-[#E6E6EB] rounded-lg p-5 flex flex-col justify-between">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-bold text-[#1C1B22]">Scanning activity</h2>
              <p className="text-xs text-[#666672] tabular-nums">
                {docsInTimeframe} {docsInTimeframe === 1 ? 'document' : 'documents'} created in selected period
              </p>
            </div>

            {!onTimeframeChange && (
              <div className="inline-flex items-center p-0.5 bg-[#FAFAFC] border border-[#E6E6EB] rounded-lg text-xs">
                {(
                  [
                    { id: '7d', label: '7 days' },
                    { id: '30d', label: '30 days' },
                    { id: '90d', label: '90 days' },
                    { id: '12m', label: '12 months' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => {
                      setTimeframe(opt.id);
                      setHoveredBucketIdx(null);
                    }}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
                      timeframe === opt.id
                        ? 'bg-[#7C3AED] text-white'
                        : 'text-[#666672] hover:text-[#1C1B22]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {docsInTimeframe === 0 ? (
            <div className="h-56 flex flex-col items-center justify-center border border-dashed border-[#E6E6EB] rounded-lg bg-[#FAFAFC] text-center px-4">
              <p className="text-xs font-medium text-[#1C1B22]">No scans recorded in this period</p>
              <p className="text-[11px] text-[#666672] mt-1 mb-3">
                Scan a document or import a PDF to track activity over time.
              </p>
              <button
                onClick={() => onStartScan('document')}
                className="px-3 py-1.5 rounded-lg bg-[#F5F3FF] border border-[#DDD6FE] text-[#7C3AED] text-xs font-semibold hover:bg-[#7C3AED] hover:text-white transition-colors"
              >
                Scan Document
              </button>
            </div>
          ) : (
            <div className="relative">
              {/* Hover Tooltip */}
              {hoveredBucketIdx !== null && activityBuckets[hoveredBucketIdx] && (
                <div className="mb-2 px-3 py-1.5 rounded-md bg-[#1C1B22] text-white text-[11px] inline-flex items-center gap-3 tabular-nums">
                  <span className="font-semibold">{activityBuckets[hoveredBucketIdx].fullLabel}</span>
                  <span>
                    {activityBuckets[hoveredBucketIdx].docCount}{' '}
                    {activityBuckets[hoveredBucketIdx].docCount === 1 ? 'doc' : 'docs'}
                  </span>
                  <span className="text-violet-300">
                    {activityBuckets[hoveredBucketIdx].pageCount}{' '}
                    {activityBuckets[hoveredBucketIdx].pageCount === 1 ? 'page' : 'pages'}
                  </span>
                </div>
              )}

              <div className="w-full h-56">
                <svg
                  viewBox="0 0 640 210"
                  className="w-full h-full overflow-visible"
                  role="img"
                  aria-label="Scanning activity bar chart"
                >
                  {/* Y-axis grid lines */}
                  {[0, 0.5, 1].map((ratio, idx) => {
                    const y = 170 - ratio * 145;
                    const val = Math.round(maxBucketCount * ratio);
                    return (
                      <g key={idx}>
                        <line
                          x1="28"
                          y1={y}
                          x2="632"
                          y2={y}
                          stroke="#E6E6EB"
                          strokeWidth="1"
                          strokeDasharray={ratio === 0 ? undefined : '3 3'}
                        />
                        <text
                          x="22"
                          y={y + 4}
                          textAnchor="end"
                          className="fill-[#666672] text-[10px] font-mono tabular-nums"
                        >
                          {val}
                        </text>
                      </g>
                    );
                  })}

                  {/* Bars */}
                  {activityBuckets.map((bucket, idx) => {
                    const plotWidth = 596;
                    const step = plotWidth / activityBuckets.length;
                    const barWidth = Math.max(4, Math.min(28, step * 0.64));
                    const x = 34 + idx * step + (step - barWidth) / 2;
                    const barHeight =
                      bucket.docCount > 0 ? Math.max(6, (bucket.docCount / maxBucketCount) * 145) : 0;
                    const y = 170 - barHeight;
                    const isHovered = hoveredBucketIdx === idx;

                    return (
                      <g
                        key={bucket.key}
                        onMouseEnter={() => setHoveredBucketIdx(idx)}
                        onMouseLeave={() => setHoveredBucketIdx(null)}
                        className="cursor-pointer"
                      >
                        <rect x={34 + idx * step} y={20} width={step} height={155} fill="transparent" />
                        {bucket.docCount > 0 ? (
                          <rect
                            x={x}
                            y={y}
                            width={barWidth}
                            height={barHeight}
                            rx="3"
                            fill={isHovered ? '#6D28D9' : '#7C3AED'}
                          />
                        ) : (
                          <rect
                            x={x}
                            y={168}
                            width={barWidth}
                            height={2}
                            rx="1"
                            fill="#E6E6EB"
                          />
                        )}
                        {bucket.label && (
                          <text
                            x={x + barWidth / 2}
                            y={192}
                            textAnchor="middle"
                            className="fill-[#666672] text-[10px] font-mono"
                          >
                            {bucket.label}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          )}
        </div>

        {/* B. Document Distribution Donut */}
        <div className="bg-white border border-[#E6E6EB] rounded-lg p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold text-[#1C1B22]">Document distribution</h2>
            <p className="text-xs text-[#666672] mt-0.5">Actual count by format category</p>
          </div>

          {distribution.total === 0 ? (
            <div className="my-6 py-10 text-center border border-dashed border-[#E6E6EB] rounded-lg bg-[#FAFAFC]">
              <p className="text-xs text-[#666672]">No documents stored yet.</p>
            </div>
          ) : (
            <div className="flex flex-col items-center my-4">
              <div className="relative w-40 h-40">
                <svg viewBox="0 0 144 144" className="w-full h-full -rotate-90">
                  <circle
                    cx="72"
                    cy="72"
                    r={donutRadius}
                    fill="none"
                    stroke="#F4F4F7"
                    strokeWidth="18"
                  />
                  {distribution.slices.map((slice) => {
                    if (slice.count === 0) return null;
                    const fraction = slice.count / distribution.total;
                    const dashLength = fraction * donutCircumference;
                    const dashOffset = -runningOffset;
                    runningOffset += dashLength;
                    const isHovered = hoveredSlice === slice.id;

                    return (
                      <circle
                        key={slice.id}
                        cx="72"
                        cy="72"
                        r={donutRadius}
                        fill="none"
                        stroke={slice.color}
                        strokeWidth={isHovered ? 21 : 18}
                        strokeDasharray={`${dashLength} ${donutCircumference - dashLength}`}
                        strokeDashoffset={dashOffset}
                        onMouseEnter={() => setHoveredSlice(slice.id)}
                        onMouseLeave={() => setHoveredSlice(null)}
                        className="transition-all duration-150 cursor-pointer"
                      />
                    );
                  })}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-2xl font-bold text-[#1C1B22] tabular-nums">
                    {hoveredSlice
                      ? distribution.slices.find((s) => s.id === hoveredSlice)?.count ?? distribution.total
                      : distribution.total}
                  </span>
                  <span className="text-[11px] text-[#666672]">
                    {hoveredSlice
                      ? distribution.slices.find((s) => s.id === hoveredSlice)?.label
                      : 'Total docs'}
                  </span>
                </div>
              </div>

              <div className="w-full space-y-2 mt-4">
                {distribution.slices.map((slice) => {
                  const pct =
                    distribution.total > 0 ? Math.round((slice.count / distribution.total) * 100) : 0;
                  return (
                    <div
                      key={slice.id}
                      onMouseEnter={() => setHoveredSlice(slice.id)}
                      onMouseLeave={() => setHoveredSlice(null)}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                        hoveredSlice === slice.id ? 'bg-[#F5F3FF]' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: slice.color }}
                        />
                        <div className="min-w-0">
                          <div className="font-semibold text-[#1C1B22]">{slice.label}</div>
                          <div className="text-[10px] text-[#666672] truncate">{slice.detail}</div>
                        </div>
                      </div>
                      <div className="font-mono text-[#1C1B22] font-semibold tabular-nums shrink-0 ml-2">
                        {slice.count} <span className="text-[#666672] font-normal">({pct}%)</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* C. Storage Usage Breakdown */}
      <div className="bg-white border border-[#E6E6EB] rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-[#1C1B22]">Storage usage</h2>
            <p className="text-xs text-[#666672] mt-0.5 tabular-nums">
              {formatBytes(storageStats.usedBytes)} stored locally in IndexedDB
              {storageStats.browserQuotaBytes && storageStats.browserUsageBytes !== null
                ? ` · ${formatBytes(storageStats.browserUsageBytes)} of ${formatBytes(
                    storageStats.browserQuotaBytes
                  )} origin quota used`
                : ''}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-mono font-semibold text-[#7C3AED] tabular-nums">
              {storageStats.count} active
            </span>
            {onOpenStorageOverview && (
              <button
                onClick={onOpenStorageOverview}
                className="text-xs font-semibold text-[#1C1B22] hover:text-[#7C3AED] transition-colors"
              >
                Details →
              </button>
            )}
          </div>
        </div>

        <div className="w-full h-3 bg-[#F4F4F7] rounded-full overflow-hidden flex border border-[#E6E6EB]">
          {storageStats.usedBytes > 0 && (
            <>
              <div
                style={{ width: `${origPct}%` }}
                className="bg-[#7C3AED] h-full"
                title={`Original captures: ${formatBytes(storageStats.originalBytes)}`}
              />
              <div
                style={{ width: `${procPct}%` }}
                className="bg-[#A78BFA] h-full"
                title={`Processed scans: ${formatBytes(storageStats.processedBytes)}`}
              />
              <div
                style={{ width: `${metaPct}%` }}
                className="bg-[#DDD6FE] h-full"
                title={`Thumbnails & OCR text: ${formatBytes(storageStats.thumbnailAndTextBytes)}`}
              />
            </>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="flex items-center justify-between px-3 py-2 rounded-md bg-[#FAFAFC] border border-[#E6E6EB]">
            <span className="flex items-center gap-2 text-[#666672]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#7C3AED]" />
              <span>Original captures</span>
            </span>
            <span className="font-mono font-semibold text-[#1C1B22] tabular-nums">
              {formatBytes(storageStats.originalBytes)}
            </span>
          </div>

          <div className="flex items-center justify-between px-3 py-2 rounded-md bg-[#FAFAFC] border border-[#E6E6EB]">
            <span className="flex items-center gap-2 text-[#666672]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#A78BFA]" />
              <span>Processed renders</span>
            </span>
            <span className="font-mono font-semibold text-[#1C1B22] tabular-nums">
              {formatBytes(storageStats.processedBytes)}
            </span>
          </div>

          <div className="flex items-center justify-between px-3 py-2 rounded-md bg-[#FAFAFC] border border-[#E6E6EB]">
            <span className="flex items-center gap-2 text-[#666672]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#DDD6FE]" />
              <span>Thumbnails &amp; OCR</span>
            </span>
            <span className="font-mono font-semibold text-[#1C1B22] tabular-nums">
              {formatBytes(storageStats.thumbnailAndTextBytes)}
            </span>
          </div>
        </div>
      </div>

      {/* D. Recent Scanning & Export Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-[#E6E6EB] rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-[#1C1B22]">Recent scanning activity</h2>
            <Clock className="w-4 h-4 text-[#666672]" />
          </div>

          {recentDocs.length === 0 ? (
            <p className="text-xs text-[#666672] py-6 text-center">No recent documents.</p>
          ) : (
            <div className="divide-y divide-[#E6E6EB]">
              {recentDocs.map((doc) => {
                const folderName = folders.find((f) => f.id === doc.folderId)?.name || 'Unassigned';
                return (
                  <button
                    key={doc.id}
                    onClick={() => onSelectDocument(doc)}
                    className="w-full py-2.5 px-2 -mx-2 rounded-md hover:bg-[#F5F3FF] flex items-center justify-between gap-3 text-left transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[#1C1B22] truncate">{doc.title}</div>
                      <div className="text-[11px] text-[#666672] mt-0.5 tabular-nums">
                        {folderName} · {doc.pages.length} {doc.pages.length === 1 ? 'page' : 'pages'}
                      </div>
                    </div>
                    <span className="text-[11px] font-mono text-[#666672] shrink-0 tabular-nums">
                      {formatRelativeDate(doc.lastOpenedAt || doc.updatedAt)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white border border-[#E6E6EB] rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-[#1C1B22]">Recent exports</h2>
            <Download className="w-4 h-4 text-[#666672]" />
          </div>

          {recentExports.length === 0 ? (
            <p className="text-xs text-[#666672] py-6 text-center">
              Export history updates when you download a PDF or PNG.
            </p>
          ) : (
            <div className="divide-y divide-[#E6E6EB]">
              {recentExports.map((exp) => (
                <div
                  key={exp.id}
                  className="py-2.5 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-[#1C1B22] truncate">{exp.documentTitle}</div>
                    <div className="text-[11px] text-[#666672] mt-0.5 tabular-nums">
                      {formatExportLabel(exp.format)} · {exp.pageCount}{' '}
                      {exp.pageCount === 1 ? 'page' : 'pages'}
                      {exp.sizeBytes ? ` · ${formatBytes(exp.sizeBytes)}` : ''}
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-[#666672] shrink-0 tabular-nums">
                    {formatRelativeDate(exp.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
