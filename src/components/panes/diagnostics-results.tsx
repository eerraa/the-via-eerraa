import {type FC} from 'react';
import styled from 'styled-components';
import {Trans, useTranslation} from 'react-i18next';
import {
  isUsbDiagnosticsSpeedConsistent,
  usbDiagnosticsExpectedSpeed,
  usbDiagnosticsPollingModeLabel,
  usbDiagnosticsSpeedLabel,
  usbDiagnosticsStateLabel,
  type UsbDiagnosticsSnapshot,
} from 'src/utils/era-usb-diagnostics';
import {
  estimateHistogramQuantile,
  USB_DIAGNOSTICS_BUCKETS,
  type UsbDiagnosticsRun,
  type UsbDiagnosticsRunOutcome,
} from 'src/utils/usb-diagnostics-history';

const Panel = styled.section({
  background: 'var(--bg_control)',
  border: '1px solid var(--border_color_cell)',
  borderRadius: 10,
  padding: 18,
  minWidth: 0,
});

const FullPanel = styled(Panel)({
  gridColumn: '1 / -1',
});

const PanelTitle = styled.h2({
  color: 'var(--color_label-highlighted)',
  fontSize: 18,
  lineHeight: 1.3,
  margin: '0 0 14px',
});

const DashboardGrid = styled.div({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))',
  gap: 14,
  marginTop: 14,
});

const Muted = styled.p({
  color: 'var(--color_label)',
  opacity: 0.82,
  lineHeight: 1.5,
  margin: '6px 0',
});

// The summary view answers one question — was anything observed in this window. The
// left column names the topic in plain words so the reader knows what is being
// reported, and the right column states only what was observed. Splitting them is what
// makes the line readable; shortening the sentence would only make it more abstract.
const FindingGrid = styled.dl({
  display: 'grid',
  gridTemplateColumns: 'minmax(150px, auto) minmax(0, 1fr)',
  gap: '10px 20px',
  margin: '0 0 12px',
});

const FindingName = styled.dt({
  color: 'var(--color_label)',
  lineHeight: 1.5,
});

const FindingValue = styled.dd({
  color: 'var(--color_label-highlighted)',
  lineHeight: 1.5,
  margin: 0,
});

const Summary = styled(FullPanel)({
  borderLeft: '4px solid var(--color_accent)',
});

const Caveat = styled(FullPanel)({
  borderLeft: '4px solid var(--color_label-highlighted)',
});

const SummaryHeadline = styled.p({
  color: 'var(--color_label-highlighted)',
  fontSize: 20,
  lineHeight: 1.4,
  margin: '0 0 8px',
});

const MetricGrid = styled.dl({
  display: 'grid',
  gridTemplateColumns: 'minmax(130px, 1fr) auto',
  gap: '9px 16px',
  margin: 0,
});

const MetricName = styled.dt({
  color: 'var(--color_label)',
  lineHeight: 1.4,
});

const MetricValue = styled.dd({
  color: 'var(--color_label-highlighted)',
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
  lineHeight: 1.4,
  margin: 0,
});

const ProgressTrack = styled.div({
  width: '100%',
  height: 6,
  overflow: 'hidden',
  borderRadius: 10,
  background: 'var(--border_color_cell)',
  marginTop: 12,
});

const ProgressFill = styled.div<{$progress: number}>(({$progress}) => ({
  width: Math.min(100, Math.max(0, $progress)) + '%',
  height: '100%',
  background: 'var(--color_accent)',
}));

const HistogramRow = styled.div({
  display: 'grid',
  gridTemplateColumns: '105px minmax(80px, 1fr) 74px',
  alignItems: 'center',
  gap: 10,
  margin: '9px 0',
  fontVariantNumeric: 'tabular-nums',
});

const HistogramTrack = styled.div({
  height: 12,
  background: 'var(--border_color_cell)',
  borderRadius: 8,
  overflow: 'hidden',
});

const HistogramFill = styled.div<{$percent: number}>(({$percent}) => ({
  width: Math.min(100, Math.max(0, $percent)) + '%',
  height: '100%',
  minWidth: $percent > 0 ? 2 : 0,
  background: 'var(--color_accent)',
}));

const ChartFrame = styled.div({
  width: '100%',
  overflowX: 'auto',
});

const Legend = styled.div({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 16,
  fontSize: 13,
  marginTop: 8,
});

const LegendItem = styled.span({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
});

const LegendSwatch = styled.span<{$color: string}>(({$color}) => ({
  display: 'inline-block',
  width: 18,
  height: 3,
  background: $color,
}));

const TimelineTrack = styled.div({
  position: 'relative',
  height: 52,
  margin: '12px 8px 4px',
  borderTop: '2px solid var(--border_color_cell)',
});

const TimelineMarker = styled.span<{$position: number}>(({$position}) => ({
  position: 'absolute',
  left: Math.min(100, Math.max(0, $position)) + '%',
  top: -7,
  width: 12,
  height: 12,
  borderRadius: '50%',
  background: 'var(--color_accent)',
  transform: 'translateX(-50%)',
}));

const TimelineLabels = styled.div({
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: 12,
  opacity: 0.8,
  marginTop: 8,
});

const EventList = styled.ul({
  paddingLeft: 20,
  margin: '10px 0 0',
  lineHeight: 1.55,
});

const TableWrap = styled.div({
  overflowX: 'auto',
});

const ComparisonTable = styled.table({
  width: '100%',
  minWidth: 830,
  borderCollapse: 'collapse',
  fontVariantNumeric: 'tabular-nums',
  '& th, & td': {
    borderBottom: '1px solid var(--border_color_cell)',
    padding: '9px 8px',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  },
  '& th': {
    color: 'var(--color_label-highlighted)',
    fontWeight: 600,
  },
});

const formatInteger = (value: number) => value.toLocaleString();

const formatMicroseconds = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(3)} ms` : `${value} µs`;

const percent = (value: number, total: number) =>
  total === 0 ? 0 : (value / total) * 100;

// Keys are the English source text, matching the rest of the app's locale files, so a
// missing translation degrades to readable English instead of a raw identifier.
type Translate = (key: string, options?: Record<string, unknown>) => string;

const eventLabel = (t: Translate, type: number) =>
  t(
    [
      'Unknown event',
      'Report queue drop',
      'USB reset',
      'USB configured',
      'USB suspend',
      'USB speed change',
      'Firmware loop stall',
    ][type] ?? 'Unknown event',
  );

// USB speed and polling-mode names stay untranslated: they are specification and
// firmware identifiers, and they must match what the comparison table, the copied
// report and the firmware documentation call them.
const speedMismatchText = (
  t: Translate,
  mode: 0 | 1 | 2 | 3,
  speed: 0 | 1 | 2,
) =>
  t('{{mode}} requires {{required}}, but the link enumerated at {{actual}}.', {
    mode: usbDiagnosticsPollingModeLabel(mode),
    required: usbDiagnosticsSpeedLabel(usbDiagnosticsExpectedSpeed(mode)),
    actual: usbDiagnosticsSpeedLabel(speed),
  });

const sessionHardEventCount = (snapshot: UsbDiagnosticsSnapshot) =>
  snapshot.sessionCounters.usbResets +
  snapshot.sessionCounters.configurations +
  snapshot.sessionCounters.suspends +
  snapshot.sessionCounters.speedChanges;

type TrendPoint = {
  elapsedMs: number;
  p99Multiplier: number;
  worstMultiplier: number;
};

// The two series have different window boundaries: the p99 bound is the histogram
// delta between two *accepted* snapshots, while the firmware resets its window
// maximum on every *capture*. `sequence` increments on every capture, so a gap means
// a snapshot read failed in between and the histogram delta then spans more windows
// than the window maximum does. Drop the window maximum for such a point rather than
// plotting two different windows as one.
export const buildUsbDiagnosticsTrend = (
  snapshots: UsbDiagnosticsSnapshot[],
): TrendPoint[] => {
  let previousHistogram = new Array(8).fill(0);
  let previousSequence: number | null = null;
  return snapshots.flatMap((snapshot) => {
    const intervalHistogram = snapshot.histogram.map((count, index) =>
      Math.max(0, count - previousHistogram[index]),
    );
    const contiguous =
      previousSequence === null || snapshot.sequence - previousSequence === 1;
    previousHistogram = snapshot.histogram;
    previousSequence = snapshot.sequence;
    const quantile = estimateHistogramQuantile(intervalHistogram, 0.99);
    const worstMultiplier =
      snapshot.expectedIntervalUs === 0 || !contiguous
        ? 0
        : snapshot.intervalLatencyMaxUs / snapshot.expectedIntervalUs;
    if (!quantile) {
      return [];
    }
    return [
      {
        elapsedMs: snapshot.elapsedMs,
        p99Multiplier:
          quantile.upperMultiplier ?? Math.max(4.01, worstMultiplier),
        worstMultiplier,
      },
    ];
  });
};

export const DiagnosticsTimingTrend: FC<{
  snapshots: UsbDiagnosticsSnapshot[];
}> = ({snapshots}) => {
  const {t} = useTranslation();
  const points = buildUsbDiagnosticsTrend(snapshots);
  if (points.length === 0) {
    return (
      <Muted>
        {t('No HID reports were observed in a completed interval.')}
      </Muted>
    );
  }

  const width = 760;
  const height = 230;
  const left = 46;
  const right = 12;
  const top = 12;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maximumElapsed = Math.max(points.at(-1)?.elapsedMs ?? 1, 1);
  const maximumMultiplier = Math.max(
    1.25,
    ...points.flatMap((point) => [point.p99Multiplier, point.worstMultiplier]),
  );
  const yMaximum = Math.ceil(maximumMultiplier * 4) / 4;
  const x = (elapsedMs: number) =>
    left + (elapsedMs / maximumElapsed) * plotWidth;
  const y = (multiplier: number) =>
    top + plotHeight - (multiplier / yMaximum) * plotHeight;
  const polyline = (field: 'p99Multiplier' | 'worstMultiplier') =>
    points.map((point) => `${x(point.elapsedMs)},${y(point[field])}`).join(' ');

  return (
    <ChartFrame>
      <svg
        aria-label={t('HID delivery timing over the diagnostic session')}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
      >
        <line
          x1={left}
          x2={width - right}
          y1={y(1)}
          y2={y(1)}
          stroke="var(--color_label)"
          strokeDasharray="5 5"
          opacity="0.65"
        />
        <line
          x1={left}
          x2={left}
          y1={top}
          y2={height - bottom}
          stroke="var(--border_color_cell)"
        />
        <line
          x1={left}
          x2={width - right}
          y1={height - bottom}
          y2={height - bottom}
          stroke="var(--border_color_cell)"
        />
        <polyline
          fill="none"
          points={polyline('p99Multiplier')}
          stroke="var(--color_accent)"
          strokeWidth="3"
        />
        <polyline
          fill="none"
          points={polyline('worstMultiplier')}
          stroke="var(--color_label-highlighted)"
          strokeWidth="2"
          strokeDasharray="3 3"
        />
        <text x={4} y={y(1) + 4} fill="var(--color_label)" fontSize="12">
          1.00×
        </text>
        <text x={4} y={top + 4} fill="var(--color_label)" fontSize="12">
          {yMaximum.toFixed(2)}×
        </text>
        <text x={left} y={height - 8} fill="var(--color_label)" fontSize="12">
          0s
        </text>
        <text
          x={width - right}
          y={height - 8}
          fill="var(--color_label)"
          fontSize="12"
          textAnchor="end"
        >
          {(maximumElapsed / 1000).toFixed(1)}s
        </text>
      </svg>
      <Legend>
        <LegendItem>
          <LegendSwatch $color="var(--color_accent)" />
          {t('p99 histogram bound per snapshot window')}
        </LegendItem>
        <LegendItem>
          <LegendSwatch $color="var(--color_label-highlighted)" />
          {t('Worst delivery time per snapshot window')}
        </LegendItem>
        <LegendItem>
          <LegendSwatch $color="var(--color_label)" />
          {t('Configured polling interval')}
        </LegendItem>
      </Legend>
    </ChartFrame>
  );
};

const DiagnosticsDistribution: FC<{snapshot: UsbDiagnosticsSnapshot}> = ({
  snapshot,
}) => {
  const {t} = useTranslation();
  const total = snapshot.histogram.reduce((sum, count) => sum + count, 0);
  return (
    <>
      {USB_DIAGNOSTICS_BUCKETS.map((bucket, index) => {
        const share = percent(snapshot.histogram[index], total);
        return (
          <HistogramRow key={bucket.label}>
            <span>{bucket.label}</span>
            <HistogramTrack>
              <HistogramFill $percent={share} />
            </HistogramTrack>
            <span>{share.toFixed(total === 0 ? 0 : 2)}%</span>
          </HistogramRow>
        );
      })}
      <Muted>
        {t(
          'Buckets are normalized to the polling interval selected when the test started. Values are HID report request-to-USB-IN-completion times.',
        )}
      </Muted>
    </>
  );
};

const DiagnosticsTimeline: FC<{snapshot: UsbDiagnosticsSnapshot}> = ({
  snapshot,
}) => {
  const {t} = useTranslation();
  if (snapshot.events.length === 0) {
    return <Muted>{t('No bounded timeline events were recorded.')}</Muted>;
  }
  const durationMs = Math.max(snapshot.durationSeconds * 1000, 1);
  return (
    <>
      <TimelineTrack aria-label={t('Diagnostic event timeline')}>
        {snapshot.events.map((event, index) => (
          <TimelineMarker
            $position={(event.relativeMs / durationMs) * 100}
            key={`${event.relativeMs}:${event.type}:${index}`}
            title={`${(event.relativeMs / 1000).toFixed(3)}s — ${eventLabel(
              t,
              event.type,
            )}`}
          />
        ))}
        <TimelineLabels>
          <span>0s</span>
          <span>{snapshot.durationSeconds}s</span>
        </TimelineLabels>
      </TimelineTrack>
      <EventList>
        {snapshot.events.map((event, index) => (
          <li key={`${event.relativeMs}:${event.type}:detail:${index}`}>
            {(event.relativeMs / 1000).toFixed(3)}s —{' '}
            {eventLabel(t, event.type)}
            {event.type === 6 ? ` (${formatMicroseconds(event.value)})` : ''}
          </li>
        ))}
      </EventList>
      {snapshot.timelineOverwrites > 0 && (
        <Muted>
          {t(
            '{{overwrites}} older timeline event(s) were overwritten by the fixed-size firmware ring.',
            {overwrites: formatInteger(snapshot.timelineOverwrites)},
          )}
        </Muted>
      )}
    </>
  );
};

export const DiagnosticsResultView: FC<{
  snapshots: UsbDiagnosticsSnapshot[];
  outcome?: UsbDiagnosticsRunOutcome;
  storedRunLabel?: string;
  // 'summary' keeps the caveat panels and the per-category statements and drops the
  // panels a first-time reader cannot act on. 'full' adds them back unchanged.
  detail?: 'summary' | 'full';
}> = ({snapshots, outcome, storedRunLabel, detail = 'full'}) => {
  const {t} = useTranslation();
  const snapshot = snapshots.at(-1);
  if (!snapshot) {
    return null;
  }
  const drops = snapshot.sessionCounters.reportDrops;
  const hardEvents = sessionHardEventCount(snapshot);
  const stalls = snapshot.loopStallCount;
  const stallThreshold = formatMicroseconds(snapshot.loopStallThresholdUs);
  const p50 = estimateHistogramQuantile(snapshot.histogram, 0.5);
  const p95 = estimateHistogramQuantile(snapshot.histogram, 0.95);
  const p99 = estimateHistogramQuantile(snapshot.histogram, 0.99);
  const progress =
    (snapshot.elapsedMs / (snapshot.durationSeconds * 1000)) * 100;
  const speedConsistent = isUsbDiagnosticsSpeedConsistent(
    snapshot.pollingMode,
    snapshot.speed,
  );

  return (
    <DashboardGrid>
      {storedRunLabel && (
        <Caveat>
          <PanelTitle>
            {t('Previously stored result — not this session')}
          </PanelTitle>
          <SummaryHeadline>{storedRunLabel}</SummaryHeadline>
          <Muted>
            {t(
              'No result has been captured for the current connection yet, so the last stored test is shown instead. Copy Diagnostic Report copies this same stored run. Start a new test to measure the current connection.',
            )}
          </Muted>
        </Caveat>
      )}
      {!speedConsistent && (
        <Caveat>
          <PanelTitle>
            {t('Normalized values do not describe this mode')}
          </PanelTitle>
          <SummaryHeadline>
            {speedMismatchText(t, snapshot.pollingMode, snapshot.speed)}
          </SummaryHeadline>
          <Muted>
            {t(
              'Every multiplier, histogram bucket, quantile bound and trend point in the advanced metrics is normalized against the {{interval}} interval of the selected mode, so they describe a polling rate this connection never ran at. The raw microsecond values and the counters remain valid. Move the keyboard to a port or hub that enumerates at {{required}}, then repeat the test before comparing modes.',
              {
                interval: formatMicroseconds(snapshot.expectedIntervalUs),
                required: usbDiagnosticsSpeedLabel(
                  usbDiagnosticsExpectedSpeed(snapshot.pollingMode),
                ),
              },
            )}
          </Muted>
        </Caveat>
      )}
      <Summary>
        <PanelTitle>
          {t('Result')} — {usbDiagnosticsPollingModeLabel(snapshot.pollingMode)}{' '}
          / {usbDiagnosticsSpeedLabel(snapshot.speed)}
        </PanelTitle>
        <SummaryHeadline>
          {t('What this {{seconds}}-second test observed', {
            seconds: snapshot.durationSeconds,
          })}
        </SummaryHeadline>
        <FindingGrid>
          <FindingName>{t('Lost key reports')}</FindingName>
          <FindingValue>
            {drops === 0
              ? t('None were observed during this test.')
              : t('{{drops}} were observed during this test.', {
                  drops: formatInteger(drops),
                })}
          </FindingValue>
          <FindingName>{t('USB link interruptions')}</FindingName>
          <FindingValue>
            {hardEvents === 0
              ? t(
                  'No reset, reconfiguration, suspend or speed change was observed.',
                )
              : t(
                  '{{events}} observed — {{resets}} reset, {{configurations}} reconfiguration, {{suspends}} suspend, {{speedChanges}} speed change.',
                  {
                    events: formatInteger(hardEvents),
                    resets: formatInteger(snapshot.sessionCounters.usbResets),
                    configurations: formatInteger(
                      snapshot.sessionCounters.configurations,
                    ),
                    suspends: formatInteger(snapshot.sessionCounters.suspends),
                    speedChanges: formatInteger(
                      snapshot.sessionCounters.speedChanges,
                    ),
                  },
                )}
          </FindingValue>
          <FindingName>{t('Firmware pauses')}</FindingName>
          <FindingValue>
            {stalls === 0
              ? t('No main-loop gap longer than {{threshold}} was observed.', {
                  threshold: stallThreshold,
                })
              : t(
                  '{{gaps}} main-loop gap(s) longer than {{threshold}} were observed.',
                  {gaps: formatInteger(stalls), threshold: stallThreshold},
                )}
          </FindingValue>
          <FindingName>{t('Busiest queue moment')}</FindingName>
          <FindingValue>
            {t('{{depth}} report(s) were waiting to be sent at once.', {
              depth: formatInteger(snapshot.queueDepthPeak),
            })}
          </FindingValue>
          <FindingName>{t('Link speed')}</FindingName>
          <FindingValue>
            {speedConsistent
              ? t(
                  'Enumerated at {{actual}}, which is what {{mode}} requires.',
                  {
                    actual: usbDiagnosticsSpeedLabel(snapshot.speed),
                    mode: usbDiagnosticsPollingModeLabel(snapshot.pollingMode),
                  },
                )
              : speedMismatchText(t, snapshot.pollingMode, snapshot.speed)}
          </FindingValue>
        </FindingGrid>
        {outcome === 'aborted' && (
          <Muted>
            {t('This is a partial result from an interrupted session.')}
          </Muted>
        )}
        {snapshot.reportSamples === 0 && (
          // Every delivery statement above is vacuously true when nothing was sent,
          // which reads like a clean result unless the window is named as empty.
          <Muted>
            {t(
              'No keyboard reports were sent during this test, so the lines above describe a window with no typing in it. Type on the keyboard while the next test runs.',
            )}
          </Muted>
        )}
        <Muted>
          {t(
            'Each line above covers only the category it names, over the window this test ran. Categories this test does not measure are not covered by it.',
          )}
        </Muted>
        <Muted>
          {t('State')}: {t(usbDiagnosticsStateLabel(snapshot.state))} ·{' '}
          {(snapshot.elapsedMs / 1000).toFixed(1)} / {snapshot.durationSeconds}s
        </Muted>
        <ProgressTrack>
          <ProgressFill $progress={progress} />
        </ProgressTrack>
      </Summary>

      {detail === 'full' && (
        <>
          <Panel>
            <PanelTitle>{t('Connection')}</PanelTitle>
            <MetricGrid>
              <MetricName>{t('Polling mode')}</MetricName>
              <MetricValue>
                {usbDiagnosticsPollingModeLabel(snapshot.pollingMode)}
              </MetricValue>
              <MetricName>{t('Negotiated USB speed')}</MetricName>
              <MetricValue>
                {usbDiagnosticsSpeedLabel(snapshot.speed)}
              </MetricValue>
              <MetricName>{t('Expected interval')}</MetricName>
              <MetricValue>
                {formatMicroseconds(snapshot.expectedIntervalUs)}
              </MetricValue>
              <MetricName>{t('Session ID')}</MetricName>
              <MetricValue>{snapshot.sessionId}</MetricValue>
            </MetricGrid>
            <Muted>
              {speedConsistent
                ? t(
                    'The negotiated speed matches the selected polling mode, so the normalized values below describe that mode.',
                  )
                : speedMismatchText(t, snapshot.pollingMode, snapshot.speed)}
            </Muted>
          </Panel>

          <Panel>
            <PanelTitle>{t('HID delivery')}</PanelTitle>
            <MetricGrid>
              <MetricName>{t('Reports observed')}</MetricName>
              <MetricValue>{formatInteger(snapshot.reportSamples)}</MetricValue>
              <MetricName>{t('Queue depth peak')}</MetricName>
              <MetricValue>
                {formatInteger(snapshot.queueDepthPeak)}
              </MetricValue>
              <MetricName>{t('Report queue drops')}</MetricName>
              <MetricValue>
                {formatInteger(snapshot.sessionCounters.reportDrops)}
              </MetricValue>
              <MetricName>{t('Minimum / average')}</MetricName>
              <MetricValue>
                {formatMicroseconds(snapshot.latencyMinUs)} /{' '}
                {formatMicroseconds(snapshot.latencyAverageUs)}
              </MetricValue>
              <MetricName>{t('Maximum')}</MetricName>
              <MetricValue>
                {formatMicroseconds(snapshot.latencyMaxUs)}
              </MetricValue>
            </MetricGrid>
            <Muted>
              {t(
                'Delivery timing begins when firmware receives a keyboard report and ends on the keyboard USB IN completion, including queue wait. The minimum is this connection’s fixed offset between the firmware tick and the USB frame; it is re-drawn on every replug, so compare runs by Maximum minus Minimum rather than by the absolute values.',
              )}
            </Muted>
          </Panel>

          <Panel>
            <PanelTitle>{t('Normalized timing bounds')}</PanelTitle>
            <MetricGrid>
              <MetricName>{t('p50 histogram bound')}</MetricName>
              <MetricValue>{p50?.label ?? t('No samples')}</MetricValue>
              <MetricName>{t('p95 histogram bound')}</MetricName>
              <MetricValue>{p95?.label ?? t('No samples')}</MetricValue>
              <MetricName>{t('p99 histogram bound')}</MetricName>
              <MetricValue>{p99?.label ?? t('No samples')}</MetricValue>
              <MetricName>&gt; 2× interval</MetricName>
              <MetricValue>
                {formatInteger(snapshot.histogram[6] + snapshot.histogram[7])}
              </MetricValue>
            </MetricGrid>
            <Muted>
              {t(
                'Quantiles are bounded estimates from eight fixed histogram buckets, not raw-sample percentiles.',
              )}
            </Muted>
          </Panel>

          <FullPanel>
            <PanelTitle>{t('HID timing trend')}</PanelTitle>
            <DiagnosticsTimingTrend snapshots={snapshots} />
          </FullPanel>

          <FullPanel>
            <PanelTitle>{t('Normalized timing distribution')}</PanelTitle>
            <DiagnosticsDistribution snapshot={snapshot} />
          </FullPanel>

          <Panel>
            <PanelTitle>{t('Firmware timing')}</PanelTitle>
            <MetricGrid>
              <MetricName>{t('Main-loop samples')}</MetricName>
              <MetricValue>{formatInteger(snapshot.loopSamples)}</MetricValue>
              <MetricName>{t('Maximum loop gap')}</MetricName>
              <MetricValue>
                {formatMicroseconds(snapshot.loopGapMaxUs)}
              </MetricValue>
              <MetricName>
                {t('Gaps >')}{' '}
                {formatMicroseconds(snapshot.loopStallThresholdUs)}
              </MetricName>
              <MetricValue>
                {formatInteger(snapshot.loopStallCount)}
              </MetricValue>
            </MetricGrid>
            <Muted>
              {t(
                'This separates long firmware main-loop gaps from HID delivery timing.',
              )}
            </Muted>
          </Panel>

          <Panel>
            <PanelTitle>{t('USB events during the session')}</PanelTitle>
            <MetricGrid>
              <MetricName>{t('Resets')}</MetricName>
              <MetricValue>
                {formatInteger(snapshot.sessionCounters.usbResets)}
              </MetricValue>
              <MetricName>{t('Configurations')}</MetricName>
              <MetricValue>
                {formatInteger(snapshot.sessionCounters.configurations)}
              </MetricValue>
              <MetricName>{t('Suspends')}</MetricName>
              <MetricValue>
                {formatInteger(snapshot.sessionCounters.suspends)}
              </MetricValue>
              <MetricName>{t('Speed changes')}</MetricName>
              <MetricValue>
                {formatInteger(snapshot.sessionCounters.speedChanges)}
              </MetricValue>
            </MetricGrid>
          </Panel>

          <FullPanel>
            <PanelTitle>{t('Event timeline')}</PanelTitle>
            <DiagnosticsTimeline snapshot={snapshot} />
          </FullPanel>

          <FullPanel>
            <PanelTitle>{t('Since firmware boot')}</PanelTitle>
            <MetricGrid>
              <MetricName>{t('Report queue drops')}</MetricName>
              <MetricValue>
                {formatInteger(snapshot.bootCounters.reportDrops)}
              </MetricValue>
              <MetricName>{t('USB resets / configurations')}</MetricName>
              <MetricValue>
                {formatInteger(snapshot.bootCounters.usbResets)} /{' '}
                {formatInteger(snapshot.bootCounters.configurations)}
              </MetricValue>
              <MetricName>{t('Suspends / speed changes')}</MetricName>
              <MetricValue>
                {formatInteger(snapshot.bootCounters.suspends)} /{' '}
                {formatInteger(snapshot.bootCounters.speedChanges)}
              </MetricValue>
            </MetricGrid>
            <Muted>
              {t(
                'These are the values captured at the end of this test, not a live reading — they only change when a test produces a new snapshot. Applying a polling mode restarts the keyboard, which zeroes them, so a test run right after a mode change always starts near zero. To check whether an unplug, suspend or speed change was counted, trigger it and then run another short test.',
              )}
            </Muted>
            <Muted>
              {t(
                'RAM-only. They reset when the firmware restarts and are never written to EEPROM.',
              )}
            </Muted>
          </FullPanel>
        </>
      )}
    </DashboardGrid>
  );
};

export const DiagnosticsComparison: FC<{runs: UsbDiagnosticsRun[]}> = ({
  runs,
}) => {
  const {t} = useTranslation();
  const latestPerMode = [0, 1, 2, 3]
    .map((mode) => runs.find((run) => run.pollingMode === mode))
    .filter((run): run is UsbDiagnosticsRun => run !== undefined);
  if (latestPerMode.length === 0) {
    return (
      <Muted>
        {t(
          'Complete tests are stored locally. Change polling mode manually, run another test, and return here to compare results.',
        )}
      </Muted>
    );
  }
  const anyMismatch = latestPerMode.some(
    (run) => !isUsbDiagnosticsSpeedConsistent(run.pollingMode, run.speed),
  );
  return (
    <>
      <Muted>
        {t(
          'Latest non-aborted result for each manually selected mode. Firmware and diagnostics protocol versions must match the current device.',
        )}
      </Muted>
      {anyMismatch && (
        <Muted>
          {t(
            'Rows marked “speed mismatch” enumerated at a USB speed the selected mode cannot run at, so their normalized columns (p99 bound, > 2×) are not comparable with the other rows.',
          )}
        </Muted>
      )}
      <Muted>
        <Trans
          i18nKey="Compare runs with <1>Spread</1>, Drops and Queue. Avg and Max each carry a constant offset that is fixed when the keyboard enumerates and is re-drawn on every replug, so the same firmware in the same mode can report very different microseconds between runs. Spread (Max minus Min, in polling intervals) removes that offset and shows how many extra intervals reports had to wait. The p99 and > 2× columns are measured against each mode’s own interval, so they answer “did this mode stay inside its own budget?” rather than which mode is faster."
          components={{1: <strong />}}
        />
      </Muted>
      <TableWrap>
        <ComparisonTable>
          <thead>
            <tr>
              <th>{t('Mode')}</th>
              <th>{t('Negotiated speed')}</th>
              <th>{t('Date')}</th>
              <th>{t('Duration')}</th>
              <th>{t('Drops')}</th>
              <th>{t('Queue')}</th>
              <th>{t('Spread')}</th>
              <th>{t('Avg')}</th>
              <th>{t('Max')}</th>
              <th>{t('p99 bound')}</th>
              <th>&gt; 2×</th>
              <th>{t('Loop max')}</th>
              <th>{t('USB resets')}</th>
            </tr>
          </thead>
          <tbody>
            {latestPerMode.map((run) => {
              const snapshot = run.snapshots.at(-1)!;
              const total = snapshot.histogram.reduce(
                (sum, count) => sum + count,
                0,
              );
              const overTwo = snapshot.histogram[6] + snapshot.histogram[7];
              const consistent = isUsbDiagnosticsSpeedConsistent(
                run.pollingMode,
                run.speed,
              );
              return (
                <tr key={run.id}>
                  <td>{usbDiagnosticsPollingModeLabel(run.pollingMode)}</td>
                  <td>
                    {usbDiagnosticsSpeedLabel(run.speed)}
                    {consistent ? '' : ` — ${t('speed mismatch')}`}
                  </td>
                  <td>{new Date(run.endedAt).toLocaleString()}</td>
                  <td>{run.durationSeconds}s</td>
                  <td>{snapshot.sessionCounters.reportDrops}</td>
                  <td>{snapshot.queueDepthPeak}</td>
                  <td>
                    {snapshot.reportSamples === 0 ||
                    snapshot.expectedIntervalUs === 0
                      ? t('No samples')
                      : `${(
                          (snapshot.latencyMaxUs - snapshot.latencyMinUs) /
                          snapshot.expectedIntervalUs
                        ).toFixed(2)}×`}
                  </td>
                  <td>
                    {snapshot.reportSamples === 0
                      ? t('No samples')
                      : formatMicroseconds(snapshot.latencyAverageUs)}
                  </td>
                  <td>
                    {snapshot.reportSamples === 0
                      ? t('No samples')
                      : formatMicroseconds(snapshot.latencyMaxUs)}
                  </td>
                  <td>
                    {estimateHistogramQuantile(snapshot.histogram, 0.99)
                      ?.label ?? t('No samples')}
                  </td>
                  <td>
                    {total === 0
                      ? 'n/a'
                      : `${((overTwo / total) * 100).toFixed(3)}%`}
                  </td>
                  <td>{formatMicroseconds(snapshot.loopGapMaxUs)}</td>
                  <td>{snapshot.sessionCounters.usbResets}</td>
                </tr>
              );
            })}
          </tbody>
        </ComparisonTable>
      </TableWrap>
    </>
  );
};
