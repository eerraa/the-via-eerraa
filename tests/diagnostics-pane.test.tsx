import {describe, expect, test} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {
  buildUsbDiagnosticsTrend,
  DiagnosticsComparison,
  DiagnosticsResultView,
} from '../src/components/panes/diagnostics-results';
import type {UsbDiagnosticsRun} from '../src/utils/usb-diagnostics-history';
import {diagnosticSnapshot} from './usb-diagnostics-fixtures';

const snapshots = [
  diagnosticSnapshot({
    state: 1,
    sequence: 1,
    elapsedMs: 1000,
    reportSamples: 20,
    intervalLatencyMaxUs: 250,
    histogram: [5, 5, 8, 1, 1, 0, 0, 0],
  }),
  diagnosticSnapshot({
    state: 2,
    sequence: 2,
    elapsedMs: 30000,
    reportSamples: 100,
    intervalLatencyMaxUs: 625,
    histogram: [25, 25, 45, 3, 1, 0, 1, 0],
  }),
];

describe('USB diagnostics result UI', () => {
  test('renders factual summary, trend, normalized distribution, firmware timing and timeline', () => {
    const html = renderToStaticMarkup(
      <DiagnosticsResultView outcome="complete" snapshots={snapshots} />,
    );
    expect(html).toContain(
      'No report queue drops were observed during this test.',
    );
    expect(html).toContain('No USB reset, reconfiguration, suspend');
    expect(html).toContain('HID timing trend');
    expect(html).toContain('<polyline');
    expect(html).toContain('Normalized timing distribution');
    expect(html).toContain('Firmware timing');
    expect(html).toContain('Event timeline');
    expect(html).toContain('Firmware loop stall');
    expect(html).toContain('RAM-only counters');
    expect(html).not.toMatch(
      /stability \d|health|quality score|perfect|certified/i,
    );
  });

  test('reports observed hard failures without inventing a stability score', () => {
    const failed = diagnosticSnapshot({
      sessionCounters: {
        reportDrops: 2,
        usbResets: 1,
        configurations: 0,
        suspends: 0,
        speedChanges: 0,
      },
      events: [
        {type: 1, relativeMs: 1000, value: 1},
        {type: 2, relativeMs: 2000, value: 2},
      ],
    });
    const html = renderToStaticMarkup(
      <DiagnosticsResultView outcome="complete" snapshots={[failed]} />,
    );
    expect(html).toContain(
      '2 report queue drop(s) were observed during this test.',
    );
    expect(html).toContain('1 USB hard event(s) were observed');
    expect(html).toContain('USB reset');
    expect(html).not.toMatch(/good|bad|stable|unstable/i);
  });

  test('uses per-window histogram deltas for the p99 trend', () => {
    expect(buildUsbDiagnosticsTrend(snapshots)).toEqual([
      {elapsedMs: 1000, p99Multiplier: 1.5, worstMultiplier: 2},
      {elapsedMs: 30000, p99Multiplier: 4, worstMultiplier: 5},
    ]);
  });

  test('shows the latest locally stored result for each manually selected mode', () => {
    const run = (
      id: string,
      pollingMode: 0 | 1 | 2 | 3,
      endedAt: string,
    ): UsbDiagnosticsRun => ({
      id,
      vendorProductId: 0x45520030,
      productName: 'MAY65',
      firmwareVersion: 'V260823R2',
      protocolVersion: 1,
      pollingMode,
      speed: pollingMode === 0 ? 1 : 2,
      durationSeconds: 30,
      startedAt: endedAt,
      endedAt,
      outcome: 'complete',
      snapshots: [diagnosticSnapshot({pollingMode})],
    });
    const html = renderToStaticMarkup(
      <DiagnosticsComparison
        runs={[
          run('new-1k', 0, '2026-08-23T00:00:02.000Z'),
          run('old-1k', 0, '2026-08-23T00:00:01.000Z'),
          run('8k', 3, '2026-08-23T00:00:03.000Z'),
        ]}
      />,
    );
    expect(html).toContain('FS 1K');
    expect(html).toContain('HS 8K');
    expect(html.match(/<tr/g)).toHaveLength(3);
    expect(html).toContain('manually selected mode');
  });
});
