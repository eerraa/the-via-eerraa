import type {
  UsbDiagnosticsCapabilities,
  UsbDiagnosticsPollingMode,
  UsbDiagnosticsSnapshot,
  UsbDiagnosticsSpeed,
} from './era-usb-diagnostics';
import {
  isUsbDiagnosticsSpeedConsistent,
  usbDiagnosticsExpectedSpeed,
  usbDiagnosticsPollingModeLabel,
  usbDiagnosticsSpeedLabel,
} from './era-usb-diagnostics';

export const USB_DIAGNOSTICS_HISTORY_KEY = 'era.usbDiagnostics.history.v1';
export const USB_DIAGNOSTICS_HISTORY_SCHEMA_VERSION = 1;
export const USB_DIAGNOSTICS_HISTORY_LIMIT = 24;
export const USB_DIAGNOSTICS_HISTORY_POINT_LIMIT = 65;

export type UsbDiagnosticsRunOutcome = 'complete' | 'stopped' | 'aborted';

export type UsbDiagnosticsRun = {
  id: string;
  vendorProductId: number;
  productName: string;
  firmwareVersion: string;
  protocolVersion: number;
  pollingMode: UsbDiagnosticsPollingMode;
  speed: UsbDiagnosticsSpeed;
  durationSeconds: number;
  startedAt: string;
  endedAt: string;
  outcome: UsbDiagnosticsRunOutcome;
  abortReason?: string;
  snapshots: UsbDiagnosticsSnapshot[];
};

type HistoryEnvelope = {
  schemaVersion: number;
  runs: UsbDiagnosticsRun[];
};

export type UsbDiagnosticsStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type HistogramQuantile = {
  bucketIndex: number;
  upperMultiplier: number | null;
  label: string;
};

export const USB_DIAGNOSTICS_BUCKETS = [
  {label: '≤ 0.50×', upperMultiplier: 0.5},
  {label: '0.50–0.75×', upperMultiplier: 0.75},
  {label: '0.75–1.00×', upperMultiplier: 1},
  {label: '1.00–1.25×', upperMultiplier: 1.25},
  {label: '1.25–1.50×', upperMultiplier: 1.5},
  {label: '1.50–2.00×', upperMultiplier: 2},
  {label: '2.00–4.00×', upperMultiplier: 4},
  {label: '> 4.00×', upperMultiplier: null},
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isUint = (value: unknown, max = 0xffffffff) =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= max;

const isIsoDate = (value: unknown) =>
  typeof value === 'string' &&
  value.length > 0 &&
  Number.isFinite(Date.parse(value));

const isHardCounters = (value: unknown) =>
  isRecord(value) &&
  isUint(value.reportDrops) &&
  isUint(value.usbResets) &&
  isUint(value.configurations) &&
  isUint(value.suspends) &&
  isUint(value.speedChanges);

const isEvent = (value: unknown) =>
  isRecord(value) &&
  isUint(value.type, 6) &&
  Number(value.type) >= 1 &&
  isUint(value.relativeMs) &&
  isUint(value.value);

export const isUsbDiagnosticsSnapshot = (
  value: unknown,
): value is UsbDiagnosticsSnapshot =>
  isRecord(value) &&
  value.protocolVersion === 1 &&
  isUint(value.state, 3) &&
  isUint(value.sessionId, 0xffff) &&
  Number(value.sessionId) > 0 &&
  isUint(value.sequence, 0xffff) &&
  Number(value.sequence) > 0 &&
  isUint(value.pollingMode, 3) &&
  isUint(value.speed, 2) &&
  [10, 30, 60].includes(Number(value.durationSeconds)) &&
  isUint(value.elapsedMs) &&
  isUint(value.expectedIntervalUs) &&
  Number(value.expectedIntervalUs) > 0 &&
  isUint(value.reportSamples) &&
  isUint(value.latencyMinUs) &&
  isUint(value.latencyAverageUs) &&
  isUint(value.latencyMaxUs) &&
  isUint(value.intervalLatencyMaxUs) &&
  isUint(value.queueDepthPeak, 0xffff) &&
  Array.isArray(value.histogram) &&
  value.histogram.length === 8 &&
  value.histogram.every((count) => isUint(count)) &&
  isUint(value.loopSamples) &&
  isUint(value.loopGapMaxUs) &&
  isUint(value.intervalLoopGapMaxUs) &&
  isUint(value.loopStallCount) &&
  isUint(value.loopStallThresholdUs, 0xffff) &&
  isHardCounters(value.bootCounters) &&
  isHardCounters(value.sessionCounters) &&
  isUint(value.timelineOverwrites) &&
  Array.isArray(value.events) &&
  value.events.length <= 8 &&
  value.events.every(isEvent);

export const isUsbDiagnosticsRun = (
  value: unknown,
): value is UsbDiagnosticsRun =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  value.id.length > 0 &&
  isUint(value.vendorProductId) &&
  typeof value.productName === 'string' &&
  value.productName.length > 0 &&
  typeof value.firmwareVersion === 'string' &&
  value.firmwareVersion.length > 0 &&
  value.protocolVersion === 1 &&
  isUint(value.pollingMode, 3) &&
  isUint(value.speed, 2) &&
  [10, 30, 60].includes(Number(value.durationSeconds)) &&
  isIsoDate(value.startedAt) &&
  isIsoDate(value.endedAt) &&
  ['complete', 'stopped', 'aborted'].includes(String(value.outcome)) &&
  (value.abortReason === undefined || typeof value.abortReason === 'string') &&
  Array.isArray(value.snapshots) &&
  value.snapshots.length > 0 &&
  value.snapshots.length <= USB_DIAGNOSTICS_HISTORY_POINT_LIMIT &&
  value.snapshots.every(isUsbDiagnosticsSnapshot);

const resolveStorage = (storage?: UsbDiagnosticsStorage) =>
  storage ??
  (typeof globalThis.localStorage === 'undefined'
    ? undefined
    : globalThis.localStorage);

export const loadUsbDiagnosticsHistory = (
  storage?: UsbDiagnosticsStorage,
): UsbDiagnosticsRun[] => {
  const target = resolveStorage(storage);
  if (!target) {
    return [];
  }
  try {
    const raw = target.getItem(USB_DIAGNOSTICS_HISTORY_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== USB_DIAGNOSTICS_HISTORY_SCHEMA_VERSION ||
      !Array.isArray(parsed.runs)
    ) {
      return [];
    }
    return parsed.runs
      .filter(isUsbDiagnosticsRun)
      .slice(0, USB_DIAGNOSTICS_HISTORY_LIMIT);
  } catch {
    return [];
  }
};

export const saveUsbDiagnosticsRun = (
  run: UsbDiagnosticsRun,
  storage?: UsbDiagnosticsStorage,
) => {
  const target = resolveStorage(storage);
  if (!target || !isUsbDiagnosticsRun(run)) {
    return false;
  }
  const runs = [
    run,
    ...loadUsbDiagnosticsHistory(target).filter(
      (candidate) => candidate.id !== run.id,
    ),
  ].slice(0, USB_DIAGNOSTICS_HISTORY_LIMIT);
  const envelope: HistoryEnvelope = {
    schemaVersion: USB_DIAGNOSTICS_HISTORY_SCHEMA_VERSION,
    runs,
  };
  try {
    target.setItem(USB_DIAGNOSTICS_HISTORY_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
};

export const createUsbDiagnosticsRun = ({
  vendorProductId,
  productName,
  capabilities,
  startedAt,
  endedAt,
  outcome,
  abortReason,
  snapshots,
}: {
  vendorProductId: number;
  productName: string;
  capabilities: UsbDiagnosticsCapabilities;
  startedAt: Date;
  endedAt: Date;
  outcome: UsbDiagnosticsRunOutcome;
  abortReason?: string;
  snapshots: UsbDiagnosticsSnapshot[];
}): UsbDiagnosticsRun | null => {
  const keptSnapshots = snapshots.slice(-USB_DIAGNOSTICS_HISTORY_POINT_LIMIT);
  const finalSnapshot = keptSnapshots.at(-1);
  if (!finalSnapshot) {
    return null;
  }
  return {
    id: `${startedAt.toISOString()}:${vendorProductId}:${finalSnapshot.sessionId}`,
    vendorProductId,
    productName,
    firmwareVersion: capabilities.firmwareVersion,
    protocolVersion: capabilities.protocolVersion,
    pollingMode: finalSnapshot.pollingMode,
    speed: finalSnapshot.speed,
    durationSeconds: finalSnapshot.durationSeconds,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    outcome,
    ...(abortReason ? {abortReason} : {}),
    snapshots: keptSnapshots,
  };
};

export const usbDiagnosticsIdentityKey = (
  run: Pick<
    UsbDiagnosticsRun,
    'vendorProductId' | 'firmwareVersion' | 'protocolVersion'
  >,
) => `${run.vendorProductId}:${run.firmwareVersion}:${run.protocolVersion}`;

export const getComparableUsbDiagnosticsRuns = (
  runs: UsbDiagnosticsRun[],
  identity: Pick<
    UsbDiagnosticsRun,
    'vendorProductId' | 'firmwareVersion' | 'protocolVersion'
  >,
) => {
  const key = usbDiagnosticsIdentityKey(identity);
  return runs
    .filter(
      (run) =>
        run.outcome !== 'aborted' && usbDiagnosticsIdentityKey(run) === key,
    )
    .sort(
      (left, right) => Date.parse(right.endedAt) - Date.parse(left.endedAt),
    );
};

export const estimateHistogramQuantile = (
  histogram: number[],
  quantile: number,
): HistogramQuantile | null => {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (histogram.length !== 8 || total === 0 || quantile <= 0 || quantile > 1) {
    return null;
  }
  const target = Math.ceil(total * quantile);
  let cumulative = 0;
  for (let index = 0; index < histogram.length; index++) {
    cumulative += histogram[index];
    if (cumulative >= target) {
      const bucket = USB_DIAGNOSTICS_BUCKETS[index];
      return {
        bucketIndex: index,
        upperMultiplier: bucket.upperMultiplier,
        label:
          bucket.upperMultiplier === null
            ? '> 4.00×'
            : `≤ ${bucket.upperMultiplier.toFixed(2)}×`,
      };
    }
  }
  return null;
};

const countAfterBucket = (histogram: number[], first: number) =>
  histogram.slice(first).reduce((sum, count) => sum + count, 0);

const counterLines = (snapshot: UsbDiagnosticsSnapshot) => [
  `Report queue drops: ${snapshot.sessionCounters.reportDrops}`,
  `USB resets: ${snapshot.sessionCounters.usbResets}`,
  `USB configurations: ${snapshot.sessionCounters.configurations}`,
  `USB suspends: ${snapshot.sessionCounters.suspends}`,
  `USB speed changes: ${snapshot.sessionCounters.speedChanges}`,
];

export const buildUsbDiagnosticReport = (run: UsbDiagnosticsRun) => {
  const snapshot = run.snapshots.at(-1);
  if (!snapshot) {
    return 'ERA USB Diagnostics\nNo snapshot was captured.';
  }
  const p50 =
    estimateHistogramQuantile(snapshot.histogram, 0.5)?.label ?? 'n/a';
  const p95 =
    estimateHistogramQuantile(snapshot.histogram, 0.95)?.label ?? 'n/a';
  const p99 =
    estimateHistogramQuantile(snapshot.histogram, 0.99)?.label ?? 'n/a';
  const total = snapshot.histogram.reduce((sum, count) => sum + count, 0);
  const overTwo = countAfterBucket(snapshot.histogram, 6);
  const overTwoRate =
    total === 0 ? 'n/a' : `${((overTwo / total) * 100).toFixed(3)}%`;
  const speedConsistent = isUsbDiagnosticsSpeedConsistent(
    run.pollingMode,
    run.speed,
  );

  return [
    'ERA USB Diagnostics',
    `Device: ${run.productName} (${run.vendorProductId})`,
    `Firmware: ${run.firmwareVersion}`,
    `Protocol: ${run.protocolVersion}`,
    `Mode: ${usbDiagnosticsPollingModeLabel(run.pollingMode)}`,
    `USB speed: ${usbDiagnosticsSpeedLabel(run.speed)}`,
    `Duration: ${run.durationSeconds}s`,
    `Outcome: ${run.outcome}`,
    `Timestamp: ${run.endedAt}`,
    ...(run.abortReason ? [`Abort reason: ${run.abortReason}`] : []),
    ...(speedConsistent
      ? []
      : [
          `WARNING: ${usbDiagnosticsPollingModeLabel(
            run.pollingMode,
          )} requires ${usbDiagnosticsSpeedLabel(
            usbDiagnosticsExpectedSpeed(run.pollingMode),
          )}, but the link enumerated at ${usbDiagnosticsSpeedLabel(run.speed)}.`,
          'WARNING: normalized multipliers, histogram buckets and quantile bounds below are not comparable with other modes.',
        ]),
    '',
    'HID delivery',
    `Reports observed: ${snapshot.reportSamples}`,
    `Queue depth peak: ${snapshot.queueDepthPeak}`,
    ...counterLines(snapshot).slice(0, 1),
    '',
    'Timing',
    `Expected interval: ${snapshot.expectedIntervalUs} us`,
    `Minimum / average / maximum: ${snapshot.latencyMinUs} / ${snapshot.latencyAverageUs} / ${snapshot.latencyMaxUs} us`,
    `p50 / p95 / p99 histogram bounds: ${p50} / ${p95} / ${p99}`,
    `> 2x interval: ${overTwo} (${overTwoRate})`,
    '',
    'Firmware',
    `Main-loop maximum gap: ${snapshot.loopGapMaxUs} us`,
    `Main-loop gaps > ${snapshot.loopStallThresholdUs} us: ${snapshot.loopStallCount}`,
    '',
    'USB events during this session',
    ...counterLines(snapshot).slice(1),
    `Timeline overwrites: ${snapshot.timelineOverwrites}`,
    '',
    'This report describes only the observed test window; it is not a stability certification.',
  ].join('\n');
};
