import {describe, expect, test} from 'bun:test';
import type {UsbDiagnosticsCapabilities} from '../src/utils/era-usb-diagnostics';
import {
  buildUsbDiagnosticReport,
  createUsbDiagnosticsRun,
  estimateHistogramQuantile,
  getComparableUsbDiagnosticsRuns,
  loadUsbDiagnosticsHistory,
  saveUsbDiagnosticsRun,
  USB_DIAGNOSTICS_HISTORY_KEY,
  USB_DIAGNOSTICS_HISTORY_LIMIT,
  type UsbDiagnosticsRun,
  type UsbDiagnosticsStorage,
} from '../src/utils/usb-diagnostics-history';
import {diagnosticSnapshot} from './usb-diagnostics-fixtures';

const capabilities: UsbDiagnosticsCapabilities = {
  protocolVersion: 1,
  sessionState: 0,
  sessionId: 0,
  flags: 0x1f,
  durations: [10, 30, 60],
  histogramBuckets: 8,
  timelineCapacity: 8,
  recommendedSnapshotMs: 1000,
  endianness: 'big',
  timeUnit: 'microseconds',
  firmwareVersion: 'V260823R2',
};

const memoryStorage = (): UsbDiagnosticsStorage & {
  raw: () => string | null;
} => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    raw: () => values.get(USB_DIAGNOSTICS_HISTORY_KEY) ?? null,
  };
};

const runAt = (
  index: number,
  extras: Partial<{
    firmwareVersion: string;
    outcome: 'complete' | 'stopped' | 'aborted';
    pollingMode: 0 | 1 | 2 | 3;
  }> = {},
) => {
  const startedAt = new Date(Date.UTC(2026, 7, 23, 0, 0, index));
  const snapshot = diagnosticSnapshot({
    sessionId: index + 1,
    sequence: index + 1,
    pollingMode: extras.pollingMode ?? 3,
  });
  return createUsbDiagnosticsRun({
    vendorProductId: 0x45520030,
    productName: 'MAY65',
    capabilities: {
      ...capabilities,
      firmwareVersion: extras.firmwareVersion ?? capabilities.firmwareVersion,
    },
    startedAt,
    endedAt: new Date(startedAt.getTime() + 30000),
    outcome: extras.outcome ?? 'complete',
    snapshots: [snapshot],
  })!;
};

describe('USB diagnostics local history', () => {
  test('persists a versioned result and reloads it without firmware EEPROM state', () => {
    const storage = memoryStorage();
    const run = runAt(0);
    expect(saveUsbDiagnosticsRun(run, storage)).toBe(true);
    expect(loadUsbDiagnosticsHistory(storage)).toEqual([run]);
    expect(JSON.parse(storage.raw()!)).toMatchObject({
      schemaVersion: 1,
      runs: [{firmwareVersion: 'V260823R2', protocolVersion: 1}],
    });
  });

  test('rejects unknown schemas and corrupt records while retaining valid records', () => {
    const storage = memoryStorage();
    storage.setItem(
      USB_DIAGNOSTICS_HISTORY_KEY,
      JSON.stringify({schemaVersion: 0, runs: [runAt(0)]}),
    );
    expect(loadUsbDiagnosticsHistory(storage)).toEqual([]);

    storage.setItem(
      USB_DIAGNOSTICS_HISTORY_KEY,
      JSON.stringify({
        schemaVersion: 1,
        runs: [runAt(1), {...runAt(2), snapshots: [{bad: true}]}],
      }),
    );
    expect(loadUsbDiagnosticsHistory(storage)).toEqual([runAt(1)]);

    storage.setItem(USB_DIAGNOSTICS_HISTORY_KEY, '{not json');
    expect(loadUsbDiagnosticsHistory(storage)).toEqual([]);
  });

  test('bounds history and keeps the most recent unique result first', () => {
    const storage = memoryStorage();
    for (let index = 0; index < USB_DIAGNOSTICS_HISTORY_LIMIT + 6; index++) {
      saveUsbDiagnosticsRun(runAt(index), storage);
    }
    const loaded = loadUsbDiagnosticsHistory(storage);
    expect(loaded).toHaveLength(USB_DIAGNOSTICS_HISTORY_LIMIT);
    expect(loaded[0].sessionId).toBeUndefined();
    expect(loaded[0].snapshots[0].sessionId).toBe(
      USB_DIAGNOSTICS_HISTORY_LIMIT + 6,
    );
    expect(loaded.at(-1)?.snapshots[0].sessionId).toBe(7);
  });

  test('compares only matching device, firmware, and protocol identities', () => {
    const matching1k = runAt(1, {pollingMode: 0});
    const matching8k = runAt(2, {pollingMode: 3});
    const oldFirmware = runAt(3, {
      pollingMode: 2,
      firmwareVersion: 'V260823R1',
    });
    const aborted = runAt(4, {pollingMode: 1, outcome: 'aborted'});
    const otherDevice: UsbDiagnosticsRun = {
      ...runAt(5, {pollingMode: 1}),
      vendorProductId: 1,
    };
    expect(
      getComparableUsbDiagnosticsRuns(
        [matching1k, matching8k, oldFirmware, aborted, otherDevice],
        matching1k,
      ),
    ).toEqual([matching8k, matching1k]);
  });

  test('derives explainable histogram bounds and a factual copy report', () => {
    const p50 = estimateHistogramQuantile([25, 25, 45, 3, 1, 0, 1, 0], 0.5);
    const p99 = estimateHistogramQuantile([25, 25, 45, 3, 1, 0, 1, 0], 0.99);
    expect(p50?.label).toBe('≤ 0.75×');
    expect(p99?.label).toBe('≤ 1.50×');

    const report = buildUsbDiagnosticReport(runAt(0));
    expect(report).toContain('Firmware: V260823R2');
    expect(report).toContain('Mode: HS 8K');
    expect(report).toContain('Reports observed: 100');
    expect(report).toContain('p50 / p95 / p99 histogram bounds');
    expect(report).toContain('not a stability certification');
    expect(report).not.toMatch(/health|quality score|perfect|certified 8k/i);
  });
});
