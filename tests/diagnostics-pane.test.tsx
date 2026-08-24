import {describe, expect, test} from 'bun:test';
import type {ReactElement} from 'react';
import i18n from 'i18next';
import {I18nextProvider, initReactI18next} from 'react-i18next';
import {renderToStaticMarkup as renderMarkup} from 'react-dom/server';
import {
  buildUsbDiagnosticsTrend,
  DiagnosticsAdvanced,
  DiagnosticsComparison,
  DiagnosticsResultView,
} from '../src/components/panes/diagnostics-results';
import type {UsbDiagnosticsRun} from '../src/utils/usb-diagnostics-history';
import {diagnosticSnapshot} from './usb-diagnostics-fixtures';

// English is the key itself, so an empty catalogue renders the untranslated source
// text. That is also what a user of an unsupported language sees, which is exactly
// the string these assertions must keep factual.
const translations = i18n.createInstance();
await translations.use(initReactI18next).init({
  lng: 'en',
  resources: {en: {translation: {}}},
});

const renderToStaticMarkup = (element: ReactElement) =>
  renderMarkup(
    <I18nextProvider i18n={translations}>{element}</I18nextProvider>,
  );

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
    expect(html).toContain('Lost key presses');
    expect(html).toContain('Not observed');
    expect(html).toContain('USB link changes');
    expect(html).toContain('HID timing trend');
    expect(html).toContain('<polyline');
    expect(html).toContain('Normalized timing distribution');
    expect(html).toContain('Firmware timing');
    expect(html).toContain('Event timeline');
    expect(html).toContain('Firmware loop stall');
    expect(html).toContain('RAM-only');
    // The boot counters were misread as live device state during hardware validation.
    expect(html).toContain('not a live reading');
    expect(html).toContain('Applying a polling mode restarts the keyboard');
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
    expect(html).toContain('Lost key presses');
    expect(html).toContain('2 observed');
    // The breakdown names which link event happened instead of only counting them.
    expect(html).toContain('Dropped 1 · Reconnected 0 · Slept 0');
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
    expect(html).toContain('Negotiated speed');
    expect(html).not.toContain('speed mismatch');
  });

  test('warns when the negotiated speed cannot run the selected polling mode', () => {
    const mismatched = diagnosticSnapshot({pollingMode: 3, speed: 1});
    const html = renderToStaticMarkup(
      <DiagnosticsResultView outcome="complete" snapshots={[mismatched]} />,
    );
    expect(html).toContain('Normalized values do not describe this mode');
    expect(html).toContain(
      'HS 8K needs High Speed, but this connection is Full Speed.',
    );
    expect(html).toContain(
      'The raw microsecond values and the counters remain valid.',
    );
  });

  test('states that the negotiated speed matches when it does', () => {
    const html = renderToStaticMarkup(
      <DiagnosticsResultView outcome="complete" snapshots={snapshots} />,
    );
    expect(html).not.toContain('Normalized values do not describe this mode');
    expect(html).toContain(
      'The negotiated speed matches the selected polling mode',
    );
  });

  test('drops the window maximum when a snapshot read was skipped', () => {
    const skipped = [
      snapshots[0],
      diagnosticSnapshot({
        state: 2,
        sequence: 4,
        elapsedMs: 30000,
        reportSamples: 100,
        intervalLatencyMaxUs: 625,
        histogram: [25, 25, 45, 3, 1, 0, 1, 0],
      }),
    ];
    expect(buildUsbDiagnosticsTrend(skipped)).toEqual([
      {elapsedMs: 1000, p99Multiplier: 1.5, worstMultiplier: 2},
      {elapsedMs: 30000, p99Multiplier: 4, worstMultiplier: 0},
    ]);
  });

  test('labels a stored result so it cannot be read as the current session', () => {
    const html = renderToStaticMarkup(
      <DiagnosticsResultView
        outcome="complete"
        snapshots={snapshots}
        storedRunLabel="HS 8K · 30s · complete · 8/23/2026"
      />,
    );
    expect(html).toContain('Previously stored result — not this session');
    expect(html).toContain('HS 8K · 30s · complete · 8/23/2026');
    expect(html).toContain(
      'Start a new test to measure the current connection',
    );
  });

  test('labels a session read back from the keyboard', () => {
    // A session interrupted by sleep or a reload leaves no page-side record, but the
    // firmware still holds it. What is shown must say where it came from.
    const html = renderToStaticMarkup(
      <DiagnosticsResultView
        outcome="complete"
        snapshots={[diagnosticSnapshot({pollingMode: 3, speed: 2})]}
        storedRunLabel="HS 8K · 30s · read from the keyboard, not from a test this page ran"
      />,
    );
    expect(html).toContain('Previously stored result — not this session');
    expect(html).toContain('read from the keyboard');
  });

  test('exposes a phase-independent spread so runs stay comparable', () => {
    // Hardware showed the same firmware and mode reporting min/avg 166/231 µs on one
    // enumeration and 512/558 µs on the next, because the offset between the firmware
    // tick and the USB frame is re-drawn on every replug. Max minus Min removes it.
    const enumerationA = diagnosticSnapshot({
      pollingMode: 0,
      speed: 1,
      expectedIntervalUs: 1000,
      latencyMinUs: 166,
      latencyAverageUs: 231,
      latencyMaxUs: 1232,
    });
    const enumerationB = diagnosticSnapshot({
      pollingMode: 1,
      speed: 2,
      expectedIntervalUs: 500,
      latencyMinUs: 326,
      latencyAverageUs: 370,
      latencyMaxUs: 876,
    });
    const asRun = (
      id: string,
      snapshot: typeof enumerationA,
    ): UsbDiagnosticsRun => ({
      id,
      vendorProductId: 0x45520030,
      productName: 'BRICK60',
      firmwareVersion: 'V260824R1',
      protocolVersion: 1,
      pollingMode: snapshot.pollingMode,
      speed: snapshot.speed,
      durationSeconds: 30,
      startedAt: '2026-08-23T00:00:00.000Z',
      endedAt: '2026-08-23T00:00:01.000Z',
      outcome: 'complete',
      snapshots: [snapshot],
    });
    const html = renderToStaticMarkup(
      <DiagnosticsComparison
        runs={[asRun('a', enumerationA), asRun('b', enumerationB)]}
      />,
    );
    expect(html).toContain('Spread');
    expect(html).toContain('1.07×'); // (1232 - 166) / 1000
    expect(html).toContain('1.10×'); // (876 - 326) / 500
    expect(html).toContain('Compare runs with <strong>Spread</strong>');
    expect(html).toContain('re-drawn on every replug');
  });

  test('compares modes with absolute microseconds, not only normalized values', () => {
    const run = (
      id: string,
      pollingMode: 0 | 1 | 2 | 3,
      expectedIntervalUs: number,
    ): UsbDiagnosticsRun => ({
      id,
      vendorProductId: 0x45520030,
      productName: 'BRICK60',
      firmwareVersion: 'V260824R1',
      protocolVersion: 1,
      pollingMode,
      speed: pollingMode === 0 ? 1 : 2,
      durationSeconds: 30,
      startedAt: '2026-08-23T00:00:00.000Z',
      endedAt: '2026-08-23T00:00:01.000Z',
      outcome: 'complete',
      snapshots: [
        diagnosticSnapshot({
          pollingMode,
          speed: pollingMode === 0 ? 1 : 2,
          expectedIntervalUs,
          latencyAverageUs: 231,
          latencyMaxUs: 1232,
        }),
      ],
    });
    const html = renderToStaticMarkup(
      <DiagnosticsComparison runs={[run('fs', 0, 1000), run('4k', 2, 250)]} />,
    );
    // Both rows have the same absolute latency, so the microseconds must be visible
    // next to the normalized columns that would otherwise rank FS above HS 4K.
    expect(html.match(/231 µs/g)).toHaveLength(2);
    expect(html.match(/1\.232 ms/g)).toHaveLength(2);
    expect(html).toContain('rather than which mode is faster');
  });

  // The summary view is what a user sees first, next to the polling-mode controls.
  // Everything asserted here exists so that view can answer "was there a problem"
  // without letting any of the hardware-confirmed caveats disappear.
  test('summary view answers each measured category in its own sentence', () => {
    const html = renderToStaticMarkup(
      <DiagnosticsResultView
        detail="summary"
        outcome="complete"
        snapshots={snapshots}
      />,
    );
    expect(html).toContain('-second test observed');
    // Each row names its topic in words a keyboard owner already uses, and the value
    // is a fragment because the row name supplies the subject.
    expect(html).toContain('Lost key presses');
    expect(html).toContain('USB link changes');
    expect(html).toContain('Firmware pauses (over 1.000 ms)');
    expect(html).toContain('Most waiting to send');
    expect(html).toContain('Connection speed');
    expect(html).toContain('High Speed — matches HS 8K');
    // "Not observed" still scopes the claim to what this test looked at.
    expect(html).toContain('Not observed');
    expect(html).not.toMatch(/\breports?\b|enumerat|queue depth/i);
    // "No failures observed" would cover categories this test never measured.
    expect(html).toContain('Categories this test does not measure');
    expect(html).not.toMatch(
      /stability \d|health|quality score|perfect|certified/i,
    );
    expect(html).not.toMatch(/good|bad|stable|unstable/i);
  });

  test('summary view leaves the phase-dependent and bucketed numbers to advanced', () => {
    // Absolute latency is re-drawn on every enumeration, normalized multipliers
    // invert the mode ranking, p99 is a bucket bound and the boot counters are not a
    // live reading. None of them can be read correctly without their caption, so the
    // summary omits the numbers rather than the captions.
    const html = renderToStaticMarkup(
      <DiagnosticsResultView
        detail="summary"
        outcome="complete"
        snapshots={snapshots}
      />,
    );
    expect(html).not.toContain('Minimum / average');
    expect(html).not.toContain('p99 histogram bound');
    expect(html).not.toContain('HID timing trend');
    expect(html).not.toContain('Normalized timing distribution');
    expect(html).not.toContain('Event timeline');
    expect(html).not.toContain('Since firmware boot');
    expect(html).not.toContain('not a live reading');
    expect(html).not.toContain('<polyline');
  });

  test('summary view keeps the speed-mismatch caveat', () => {
    const html = renderToStaticMarkup(
      <DiagnosticsResultView
        detail="summary"
        outcome="complete"
        snapshots={[diagnosticSnapshot({pollingMode: 3, speed: 1})]}
      />,
    );
    expect(html).toContain('Normalized values do not describe this mode');
    expect(html).toContain(
      'HS 8K needs High Speed, but this connection is Full Speed.',
    );
  });

  test('summary view keeps the source of a result it did not just measure', () => {
    const html = renderToStaticMarkup(
      <DiagnosticsResultView
        detail="summary"
        outcome="complete"
        snapshots={snapshots}
        storedRunLabel="HS 8K · 30s · complete · 8/23/2026"
      />,
    );
    expect(html).toContain('Previously stored result — not this session');
    expect(html).toContain('HS 8K · 30s · complete · 8/23/2026');
  });

  test('summary view names a window in which nothing was sent', () => {
    // Every delivery statement is vacuously true with no reports, which reads like a
    // clean result unless the empty window is named.
    const html = renderToStaticMarkup(
      <DiagnosticsResultView
        detail="summary"
        outcome="complete"
        snapshots={[
          diagnosticSnapshot({
            reportSamples: 0,
            queueDepthPeak: 0,
            histogram: [0, 0, 0, 0, 0, 0, 0, 0],
          }),
        ]}
      />,
    );
    expect(html).toContain('No keys were pressed during this test');
  });

  // A collapsed disclosure keeps its text in the page, so "still shipped" and "still
  // on the screen" are different questions. These strip the collapsed bodies to ask
  // the second one.
  const visibleText = (html: string) =>
    html.replace(/<p[^>]*hidden=""[^>]*>.*?<\/p>/gs, '');

  const count = (html: string, pattern: RegExp) =>
    (html.match(pattern) ?? []).length;

  test('caveats stay in the page but stop occupying the screen', () => {
    const html = renderToStaticMarkup(
      <DiagnosticsResultView
        detail="summary"
        outcome="complete"
        snapshots={snapshots}
      />,
    );
    // The observation-scope limit is still shipped with the result...
    expect(html).toContain('Categories this test does not measure');
    // ...but folded away, so the summary reads as answers rather than as prose.
    expect(visibleText(html)).not.toContain(
      'Categories this test does not measure',
    );
    expect(count(html, /hidden=""/g)).toBeGreaterThan(0);
  });

  test('advanced metrics show one group at a time', () => {
    const html = renderToStaticMarkup(
      <DiagnosticsAdvanced snapshots={snapshots} />,
    );
    expect(count(html, /role="tabpanel"/g)).toBe(4);
    expect(count(html, /aria-selected="true"/g)).toBe(1);
    // Three of the four groups are hidden rather than unmounted, so the chart keeps
    // its layout and find-in-page still reaches every group.
    expect(count(html, /hidden=""/g)).toBeGreaterThanOrEqual(3);
    expect(html).toContain('HID timing trend');
    expect(html).toContain('Event timeline');
    expect(html).toContain('Since the keyboard powered on');
  });

  test('every advanced group can be selected', () => {
    for (const tab of [
      'measurements',
      'timing',
      'events',
      'compare',
    ] as const) {
      const html = renderToStaticMarkup(
        <DiagnosticsAdvanced defaultTab={tab} snapshots={snapshots} />,
      );
      expect({tab, selected: count(html, /aria-selected="true"/g)}).toEqual({
        tab,
        selected: 1,
      });
    }
  });

  test('the boot-counter warning stays on screen, not behind the disclosure', () => {
    // Hardware validation twice concluded "suspend is not being counted" from these
    // numbers, so the sentence that prevents it may not be one click away.
    const html = renderToStaticMarkup(
      <DiagnosticsAdvanced snapshots={snapshots} />,
    );
    expect(visibleText(html)).toContain(
      'Captured when this test ended — not live.',
    );
    expect(html).toContain('Applying a polling mode restarts the keyboard');
  });

  test('the phase-independent comparison rule stays on screen', () => {
    const html = renderToStaticMarkup(
      <DiagnosticsComparison
        runs={[
          {
            id: 'a',
            vendorProductId: 0x45520030,
            productName: 'BRICK60',
            firmwareVersion: 'V260824R1',
            protocolVersion: 1,
            pollingMode: 3,
            speed: 2,
            durationSeconds: 30,
            startedAt: '2026-08-23T00:00:00.000Z',
            endedAt: '2026-08-23T00:00:01.000Z',
            outcome: 'complete',
            snapshots: [diagnosticSnapshot({})],
          },
        ]}
      />,
    );
    expect(visibleText(html)).toContain('Compare with <strong>Spread</strong>');
    expect(visibleText(html)).toContain('shift on every replug');
    // The full reasoning is still shipped, one click away.
    expect(html).toContain('re-drawn on every replug');
  });

  test('marks comparison rows whose negotiated speed cannot run the mode', () => {
    const mismatchRun = (
      id: string,
      pollingMode: 0 | 1 | 2 | 3,
      speed: 0 | 1 | 2,
    ): UsbDiagnosticsRun => ({
      id,
      vendorProductId: 0x45520030,
      productName: 'MAY65',
      firmwareVersion: 'V260823R2',
      protocolVersion: 1,
      pollingMode,
      speed,
      durationSeconds: 30,
      startedAt: '2026-08-23T00:00:00.000Z',
      endedAt: '2026-08-23T00:00:01.000Z',
      outcome: 'complete',
      snapshots: [diagnosticSnapshot({pollingMode, speed})],
    });
    const html = renderToStaticMarkup(
      <DiagnosticsComparison
        runs={[mismatchRun('fs', 0, 1), mismatchRun('hs8k-on-fs-port', 3, 1)]}
      />,
    );
    expect(html).toContain('speed mismatch');
    expect(html.match(/speed mismatch/g)).toHaveLength(2);
    expect(html).toContain('are not comparable with the other rows');
  });
});
