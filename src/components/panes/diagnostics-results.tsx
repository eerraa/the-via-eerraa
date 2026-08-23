import {type FC} from 'react';
import styled from 'styled-components';
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

const eventLabel = (type: number) =>
  [
    'Unknown event',
    'Report queue drop',
    'USB reset',
    'USB configured',
    'USB suspend',
    'USB speed change',
    'Firmware loop stall',
  ][type] ?? 'Unknown event';

const speedMismatchText = (mode: 0 | 1 | 2 | 3, speed: 0 | 1 | 2) =>
  `${usbDiagnosticsPollingModeLabel(mode)} requires ${usbDiagnosticsSpeedLabel(
    usbDiagnosticsExpectedSpeed(mode),
  )}, but the link enumerated at ${usbDiagnosticsSpeedLabel(speed)}.`;

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
  const points = buildUsbDiagnosticsTrend(snapshots);
  if (points.length === 0) {
    return <Muted>No HID reports were observed in a completed interval.</Muted>;
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
        aria-label="HID delivery timing over the diagnostic session"
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
          p99 histogram bound per snapshot window
        </LegendItem>
        <LegendItem>
          <LegendSwatch $color="var(--color_label-highlighted)" />
          Worst delivery time per snapshot window
        </LegendItem>
        <LegendItem>
          <LegendSwatch $color="var(--color_label)" />
          Configured polling interval
        </LegendItem>
      </Legend>
    </ChartFrame>
  );
};

const DiagnosticsDistribution: FC<{snapshot: UsbDiagnosticsSnapshot}> = ({
  snapshot,
}) => {
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
        Buckets are normalized to the polling interval selected when the test
        started. Values are HID report request-to-USB-IN-completion times.
      </Muted>
    </>
  );
};

const DiagnosticsTimeline: FC<{snapshot: UsbDiagnosticsSnapshot}> = ({
  snapshot,
}) => {
  if (snapshot.events.length === 0) {
    return <Muted>No bounded timeline events were recorded.</Muted>;
  }
  const durationMs = Math.max(snapshot.durationSeconds * 1000, 1);
  return (
    <>
      <TimelineTrack aria-label="Diagnostic event timeline">
        {snapshot.events.map((event, index) => (
          <TimelineMarker
            $position={(event.relativeMs / durationMs) * 100}
            key={`${event.relativeMs}:${event.type}:${index}`}
            title={`${(event.relativeMs / 1000).toFixed(3)}s — ${eventLabel(
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
            {(event.relativeMs / 1000).toFixed(3)}s — {eventLabel(event.type)}
            {event.type === 6 ? ` (${formatMicroseconds(event.value)})` : ''}
          </li>
        ))}
      </EventList>
      {snapshot.timelineOverwrites > 0 && (
        <Muted>
          {formatInteger(snapshot.timelineOverwrites)} older timeline event(s)
          were overwritten by the fixed-size firmware ring.
        </Muted>
      )}
    </>
  );
};

export const DiagnosticsResultView: FC<{
  snapshots: UsbDiagnosticsSnapshot[];
  outcome?: UsbDiagnosticsRunOutcome;
  storedRunLabel?: string;
}> = ({snapshots, outcome, storedRunLabel}) => {
  const snapshot = snapshots.at(-1);
  if (!snapshot) {
    return null;
  }
  const drops = snapshot.sessionCounters.reportDrops;
  const hardEvents = sessionHardEventCount(snapshot);
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
          <PanelTitle>Previously stored result — not this session</PanelTitle>
          <SummaryHeadline>{storedRunLabel}</SummaryHeadline>
          <Muted>
            No result has been captured for the current connection yet, so the
            last stored test is shown instead. Copy Diagnostic Report copies
            this same stored run. Start a new test to measure the current
            connection.
          </Muted>
        </Caveat>
      )}
      {!speedConsistent && (
        <Caveat>
          <PanelTitle>Normalized values do not describe this mode</PanelTitle>
          <SummaryHeadline>
            {speedMismatchText(snapshot.pollingMode, snapshot.speed)}
          </SummaryHeadline>
          <Muted>
            Every multiplier, histogram bucket, quantile bound and trend point
            below is normalized against the{' '}
            {formatMicroseconds(snapshot.expectedIntervalUs)} interval of the
            selected mode, so they describe a polling rate this connection never
            ran at. The raw microsecond values and the counters remain valid.
            Move the keyboard to a port or hub that enumerates at{' '}
            {usbDiagnosticsSpeedLabel(
              usbDiagnosticsExpectedSpeed(snapshot.pollingMode),
            )}
            , then repeat the test before comparing modes.
          </Muted>
        </Caveat>
      )}
      <Summary>
        <PanelTitle>
          USB Diagnostics —{' '}
          {usbDiagnosticsPollingModeLabel(snapshot.pollingMode)} /{' '}
          {usbDiagnosticsSpeedLabel(snapshot.speed)}
        </PanelTitle>
        <SummaryHeadline>
          {drops === 0
            ? 'No report queue drops were observed during this test.'
            : `${formatInteger(drops)} report queue drop(s) were observed during this test.`}
        </SummaryHeadline>
        <Muted>
          {hardEvents === 0
            ? 'No USB reset, reconfiguration, suspend, or speed change was observed in the session.'
            : `${formatInteger(hardEvents)} USB hard event(s) were observed in the session.`}
        </Muted>
        {outcome === 'aborted' && (
          <Muted>This is a partial result from an interrupted session.</Muted>
        )}
        <Muted>
          State: {usbDiagnosticsStateLabel(snapshot.state)} ·{' '}
          {(snapshot.elapsedMs / 1000).toFixed(1)} / {snapshot.durationSeconds}s
        </Muted>
        <ProgressTrack>
          <ProgressFill $progress={progress} />
        </ProgressTrack>
      </Summary>

      <Panel>
        <PanelTitle>Connection</PanelTitle>
        <MetricGrid>
          <MetricName>Polling mode</MetricName>
          <MetricValue>
            {usbDiagnosticsPollingModeLabel(snapshot.pollingMode)}
          </MetricValue>
          <MetricName>Negotiated USB speed</MetricName>
          <MetricValue>{usbDiagnosticsSpeedLabel(snapshot.speed)}</MetricValue>
          <MetricName>Expected interval</MetricName>
          <MetricValue>
            {formatMicroseconds(snapshot.expectedIntervalUs)}
          </MetricValue>
          <MetricName>Session ID</MetricName>
          <MetricValue>{snapshot.sessionId}</MetricValue>
        </MetricGrid>
        <Muted>
          {speedConsistent
            ? 'The negotiated speed matches the selected polling mode, so the normalized values below describe that mode.'
            : speedMismatchText(snapshot.pollingMode, snapshot.speed)}
        </Muted>
      </Panel>

      <Panel>
        <PanelTitle>HID delivery</PanelTitle>
        <MetricGrid>
          <MetricName>Reports observed</MetricName>
          <MetricValue>{formatInteger(snapshot.reportSamples)}</MetricValue>
          <MetricName>Queue depth peak</MetricName>
          <MetricValue>{formatInteger(snapshot.queueDepthPeak)}</MetricValue>
          <MetricName>Report queue drops</MetricName>
          <MetricValue>
            {formatInteger(snapshot.sessionCounters.reportDrops)}
          </MetricValue>
          <MetricName>Minimum / average</MetricName>
          <MetricValue>
            {formatMicroseconds(snapshot.latencyMinUs)} /{' '}
            {formatMicroseconds(snapshot.latencyAverageUs)}
          </MetricValue>
          <MetricName>Maximum</MetricName>
          <MetricValue>{formatMicroseconds(snapshot.latencyMaxUs)}</MetricValue>
        </MetricGrid>
        <Muted>
          Delivery timing begins when firmware receives a keyboard report and
          ends on the keyboard USB IN completion, including queue wait. The
          minimum is this connection’s fixed offset between the firmware tick
          and the USB frame; it is re-drawn on every replug, so compare runs by
          Maximum minus Minimum rather than by the absolute values.
        </Muted>
      </Panel>

      <Panel>
        <PanelTitle>Normalized timing bounds</PanelTitle>
        <MetricGrid>
          <MetricName>p50 histogram bound</MetricName>
          <MetricValue>{p50?.label ?? 'No samples'}</MetricValue>
          <MetricName>p95 histogram bound</MetricName>
          <MetricValue>{p95?.label ?? 'No samples'}</MetricValue>
          <MetricName>p99 histogram bound</MetricName>
          <MetricValue>{p99?.label ?? 'No samples'}</MetricValue>
          <MetricName>&gt; 2× interval</MetricName>
          <MetricValue>
            {formatInteger(snapshot.histogram[6] + snapshot.histogram[7])}
          </MetricValue>
        </MetricGrid>
        <Muted>
          Quantiles are bounded estimates from eight fixed histogram buckets,
          not raw-sample percentiles.
        </Muted>
      </Panel>

      <FullPanel>
        <PanelTitle>HID timing trend</PanelTitle>
        <DiagnosticsTimingTrend snapshots={snapshots} />
      </FullPanel>

      <FullPanel>
        <PanelTitle>Normalized timing distribution</PanelTitle>
        <DiagnosticsDistribution snapshot={snapshot} />
      </FullPanel>

      <Panel>
        <PanelTitle>Firmware timing</PanelTitle>
        <MetricGrid>
          <MetricName>Main-loop samples</MetricName>
          <MetricValue>{formatInteger(snapshot.loopSamples)}</MetricValue>
          <MetricName>Maximum loop gap</MetricName>
          <MetricValue>{formatMicroseconds(snapshot.loopGapMaxUs)}</MetricValue>
          <MetricName>
            Gaps &gt; {formatMicroseconds(snapshot.loopStallThresholdUs)}
          </MetricName>
          <MetricValue>{formatInteger(snapshot.loopStallCount)}</MetricValue>
        </MetricGrid>
        <Muted>
          This separates long firmware main-loop gaps from HID delivery timing.
        </Muted>
      </Panel>

      <Panel>
        <PanelTitle>USB events during the session</PanelTitle>
        <MetricGrid>
          <MetricName>Resets</MetricName>
          <MetricValue>
            {formatInteger(snapshot.sessionCounters.usbResets)}
          </MetricValue>
          <MetricName>Configurations</MetricName>
          <MetricValue>
            {formatInteger(snapshot.sessionCounters.configurations)}
          </MetricValue>
          <MetricName>Suspends</MetricName>
          <MetricValue>
            {formatInteger(snapshot.sessionCounters.suspends)}
          </MetricValue>
          <MetricName>Speed changes</MetricName>
          <MetricValue>
            {formatInteger(snapshot.sessionCounters.speedChanges)}
          </MetricValue>
        </MetricGrid>
      </Panel>

      <FullPanel>
        <PanelTitle>Event timeline</PanelTitle>
        <DiagnosticsTimeline snapshot={snapshot} />
      </FullPanel>

      <FullPanel>
        <PanelTitle>Since firmware boot</PanelTitle>
        <MetricGrid>
          <MetricName>Report queue drops</MetricName>
          <MetricValue>
            {formatInteger(snapshot.bootCounters.reportDrops)}
          </MetricValue>
          <MetricName>USB resets / configurations</MetricName>
          <MetricValue>
            {formatInteger(snapshot.bootCounters.usbResets)} /{' '}
            {formatInteger(snapshot.bootCounters.configurations)}
          </MetricValue>
          <MetricName>Suspends / speed changes</MetricName>
          <MetricValue>
            {formatInteger(snapshot.bootCounters.suspends)} /{' '}
            {formatInteger(snapshot.bootCounters.speedChanges)}
          </MetricValue>
        </MetricGrid>
        <Muted>
          These are the values captured at the end of this test, not a live
          reading — they only change when a test produces a new snapshot.
          Applying a polling mode restarts the keyboard, which zeroes them, so a
          test run right after a mode change always starts near zero. To check
          whether an unplug, suspend or speed change was counted, trigger it and
          then run another short test.
        </Muted>
        <Muted>
          RAM-only. They reset when the firmware restarts and are never written
          to EEPROM.
        </Muted>
      </FullPanel>
    </DashboardGrid>
  );
};

export const DiagnosticsComparison: FC<{runs: UsbDiagnosticsRun[]}> = ({
  runs,
}) => {
  const latestPerMode = [0, 1, 2, 3]
    .map((mode) => runs.find((run) => run.pollingMode === mode))
    .filter((run): run is UsbDiagnosticsRun => run !== undefined);
  if (latestPerMode.length === 0) {
    return (
      <Muted>
        Complete tests are stored locally. Change polling mode manually, run
        another test, and return here to compare results.
      </Muted>
    );
  }
  const anyMismatch = latestPerMode.some(
    (run) => !isUsbDiagnosticsSpeedConsistent(run.pollingMode, run.speed),
  );
  return (
    <>
      <Muted>
        Latest non-aborted result for each manually selected mode. Firmware and
        diagnostics protocol versions must match the current device.
      </Muted>
      {anyMismatch && (
        <Muted>
          Rows marked “speed mismatch” enumerated at a USB speed the selected
          mode cannot run at, so their normalized columns (p99 bound, &gt; 2×)
          are not comparable with the other rows.
        </Muted>
      )}
      <Muted>
        Compare runs with <strong>Spread</strong>, Drops and Queue. Avg and Max
        each carry a constant offset that is fixed when the keyboard enumerates
        and is re-drawn on every replug, so the same firmware in the same mode
        can report very different microseconds between runs. Spread (Max minus
        Min, in polling intervals) removes that offset and shows how many extra
        intervals reports had to wait. The p99 and &gt; 2× columns are measured
        against each mode’s own interval, so they answer “did this mode stay
        inside its own budget?” rather than which mode is faster.
      </Muted>
      <TableWrap>
        <ComparisonTable>
          <thead>
            <tr>
              <th>Mode</th>
              <th>Negotiated speed</th>
              <th>Date</th>
              <th>Duration</th>
              <th>Drops</th>
              <th>Queue</th>
              <th>Spread</th>
              <th>Avg</th>
              <th>Max</th>
              <th>p99 bound</th>
              <th>&gt; 2×</th>
              <th>Loop max</th>
              <th>USB resets</th>
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
                    {consistent ? '' : ' — speed mismatch'}
                  </td>
                  <td>{new Date(run.endedAt).toLocaleString()}</td>
                  <td>{run.durationSeconds}s</td>
                  <td>{snapshot.sessionCounters.reportDrops}</td>
                  <td>{snapshot.queueDepthPeak}</td>
                  <td>
                    {snapshot.reportSamples === 0 ||
                    snapshot.expectedIntervalUs === 0
                      ? 'No samples'
                      : `${(
                          (snapshot.latencyMaxUs - snapshot.latencyMinUs) /
                          snapshot.expectedIntervalUs
                        ).toFixed(2)}×`}
                  </td>
                  <td>
                    {snapshot.reportSamples === 0
                      ? 'No samples'
                      : formatMicroseconds(snapshot.latencyAverageUs)}
                  </td>
                  <td>
                    {snapshot.reportSamples === 0
                      ? 'No samples'
                      : formatMicroseconds(snapshot.latencyMaxUs)}
                  </td>
                  <td>
                    {estimateHistogramQuantile(snapshot.histogram, 0.99)
                      ?.label ?? 'No samples'}
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
