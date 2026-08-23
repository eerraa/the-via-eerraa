import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
} from 'react';
import styled from 'styled-components';
import {AccentButton, PrimaryAccentButton} from '../../../inputs/accent-button';
import {AccentSlider} from '../../../inputs/accent-slider';
import {useAppSelector} from 'src/store/hooks';
import {
  getIsSelectedDeviceReady,
  getSelectedConnectedDevice,
  getSelectedKeyboardAPI,
  getSelectionGeneration,
} from 'src/store/devicesSlice';
import {getDefinitionSourceForDevice} from 'src/store/definitionsSlice';
import {
  isEraAdvancedMetadataLoaded,
  loadEraAdvancedMetadata,
  shouldProbeUsbDiagnostics,
} from 'src/utils/era-advanced-metadata';
import type {KeyboardAPI} from 'src/utils/keyboard-api';
import {
  clearUsbDiagnostics,
  ERA_USB_DIAGNOSTICS_STATUS_BUSY,
  ERA_USB_DIAGNOSTICS_STATUS_UNSUPPORTED_VERSION,
  getUsbDiagnosticsCapabilities,
  getUsbDiagnosticsSnapshot,
  startUsbDiagnostics,
  stopUsbDiagnostics,
  type UsbDiagnosticsCapabilities,
  type UsbDiagnosticsDuration,
  usbDiagnosticsPollingModeLabel,
  type UsbDiagnosticsFailureKind,
  type UsbDiagnosticsSnapshot,
} from 'src/utils/era-usb-diagnostics';
import {
  buildUsbDiagnosticReport,
  createUsbDiagnosticsRun,
  getComparableUsbDiagnosticsRuns,
  loadUsbDiagnosticsHistory,
  saveUsbDiagnosticsRun,
  type UsbDiagnosticsRun,
  type UsbDiagnosticsRunOutcome,
} from 'src/utils/usb-diagnostics-history';
import {
  DiagnosticsComparison,
  DiagnosticsResultView,
} from '../../diagnostics-results';

// The block lines up with the ControlRow width of the menu it is embedded in so the
// polling-mode controls and the diagnostics that describe them read as one column.
const Section = styled.section({
  width: '100%',
  maxWidth: 960,
  boxSizing: 'border-box',
  padding: '20px 5px 24px',
  color: 'var(--color_label)',
  fontSize: 16,
  lineHeight: 1.55,
});

const SectionTitle = styled.h2({
  color: 'var(--color_label-highlighted)',
  fontSize: 20,
  lineHeight: 1.3,
  margin: '0 0 6px',
});

const Intro = styled.p({
  margin: '0 0 14px',
  maxWidth: 760,
});

const Controls = styled.div({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
});

const Select = styled.select({
  height: 40,
  minWidth: 120,
  padding: '0 10px',
  border: '1px solid var(--color_accent)',
  borderRadius: 5,
  color: 'var(--color_accent)',
  background: 'var(--bg_menu)',
  fontSize: 16,
});

const Note = styled.p({
  background: 'var(--bg_control)',
  border: '1px solid var(--border_color_cell)',
  borderRadius: 10,
  padding: '12px 14px',
  lineHeight: 1.55,
  margin: '14px 0 0',
});

const NoteTitle = styled.strong({
  color: 'var(--color_label-highlighted)',
  display: 'block',
  marginBottom: 4,
});

const Muted = styled.p({
  opacity: 0.82,
  margin: '10px 0 0',
});

const ErrorText = styled.p({
  color: 'var(--color_label-highlighted)',
  margin: '12px 0 0',
});

const AdvancedRow = styled.div({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  borderTop: '1px solid var(--border_color_cell)',
  marginTop: 20,
  paddingTop: 14,
});

const AdvancedLabel = styled.span({
  color: 'var(--color_label)',
  fontSize: 18,
});

const AdvancedPanel = styled.div({
  marginTop: 4,
});

const AdvancedTitle = styled.h3({
  color: 'var(--color_label-highlighted)',
  fontSize: 18,
  lineHeight: 1.3,
  margin: '18px 0 8px',
});

type ActiveRun = {
  api: KeyboardAPI;
  path: string;
  connectionGeneration: number;
  selectionGeneration: number;
  vendorProductId: number;
  productName: string;
  capabilities: UsbDiagnosticsCapabilities;
  startedAt: Date;
  snapshots: UsbDiagnosticsSnapshot[];
  sessionId: number;
  stopRequested: boolean;
  saved: boolean;
};

type CapabilityState =
  'loading' | 'supported' | 'unsupported' | 'unverified' | 'disconnected';

const failureMessage = (failure: {
  kind: UsbDiagnosticsFailureKind;
  status?: number;
}) => {
  if (
    failure.kind === 'unhandled' ||
    (failure.kind === 'status' &&
      failure.status === ERA_USB_DIAGNOSTICS_STATUS_UNSUPPORTED_VERSION)
  ) {
    return 'USB Diagnostics are not supported by this firmware version.';
  }
  if (failure.kind === 'disconnected') {
    return 'The keyboard disconnected. Reconnect it before starting another test.';
  }
  if (failure.kind === 'timeout') {
    return 'The diagnostic request timed out. Reconnect the keyboard and try again.';
  }
  if (
    failure.kind === 'status' &&
    failure.status === ERA_USB_DIAGNOSTICS_STATUS_BUSY
  ) {
    return 'The firmware already has a diagnostic session in progress.';
  }
  if (failure.kind === 'stale') {
    return 'The coherent snapshot changed before every chunk was read.';
  }
  return 'The diagnostic response was invalid. Reconnect the keyboard and verify that the app and firmware are current.';
};

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));

export const UsbDiagnosticsSection: FC = () => {
  const device = useAppSelector(getSelectedConnectedDevice);
  const api = useAppSelector(getSelectedKeyboardAPI);
  const ready = useAppSelector(getIsSelectedDeviceReady);
  const selectionGeneration = useAppSelector(getSelectionGeneration);
  const definitionSource = useAppSelector((state) =>
    device ? getDefinitionSourceForDevice(state, device) : null,
  );
  const [metadataReady, setMetadataReady] = useState(
    isEraAdvancedMetadataLoaded,
  );
  const [capabilityState, setCapabilityState] =
    useState<CapabilityState>('loading');
  const [capabilities, setCapabilities] =
    useState<UsbDiagnosticsCapabilities | null>(null);
  const [duration, setDuration] = useState<UsbDiagnosticsDuration>(30);
  const [snapshots, setSnapshots] = useState<UsbDiagnosticsSnapshot[]>([]);
  const [currentRun, setCurrentRun] = useState<UsbDiagnosticsRun | null>(null);
  const [history, setHistory] = useState<UsbDiagnosticsRun[]>(() =>
    loadUsbDiagnosticsHistory(),
  );
  const [recoveredSnapshot, setRecoveredSnapshot] =
    useState<UsbDiagnosticsSnapshot | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [commandPending, setCommandPending] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const activeRef = useRef<ActiveRun | null>(null);
  const mountedRef = useRef(true);
  const selectionRef = useRef({
    path: device?.path ?? null,
    generation: selectionGeneration,
  });
  selectionRef.current = {
    path: device?.path ?? null,
    generation: selectionGeneration,
  };

  const eligible =
    metadataReady &&
    definitionSource === 'era' &&
    device !== null &&
    shouldProbeUsbDiagnostics(definitionSource, device.vendorProductId);

  const isCurrent = useCallback((active: ActiveRun) => {
    return (
      activeRef.current === active &&
      active.api.isConnectionGenerationCurrent(active.connectionGeneration) &&
      selectionRef.current.path === active.path &&
      selectionRef.current.generation === active.selectionGeneration
    );
  }, []);

  const finishActive = useCallback(
    (
      active: ActiveRun,
      outcome: UsbDiagnosticsRunOutcome,
      abortReason?: string,
    ) => {
      if (active.saved) {
        return;
      }
      active.saved = true;
      active.stopRequested = true;
      if (activeRef.current === active) {
        activeRef.current = null;
      }
      const run = createUsbDiagnosticsRun({
        vendorProductId: active.vendorProductId,
        productName: active.productName,
        capabilities: active.capabilities,
        startedAt: active.startedAt,
        endedAt: new Date(),
        outcome,
        abortReason,
        snapshots: active.snapshots,
      });
      const saved = run ? saveUsbDiagnosticsRun(run) : false;
      if (mountedRef.current) {
        setCommandPending(false);
        if (run && !saved) {
          // Silently dropping the result would look identical to a successful save.
          setCommandError(
            'This result could not be written to local history. Browser storage may be full or blocked.',
          );
        }
        if (run) {
          setCurrentRun(run);
          setHistory(loadUsbDiagnosticsHistory());
        }
        const finalSnapshot = active.snapshots.at(-1);
        if (finalSnapshot) {
          setCapabilities((previous) =>
            previous
              ? {
                  ...previous,
                  sessionState: finalSnapshot.state,
                  sessionId: finalSnapshot.sessionId,
                }
              : previous,
          );
        }
      }
    },
    [],
  );

  const appendSnapshot = useCallback(
    (active: ActiveRun, snapshot: UsbDiagnosticsSnapshot) => {
      if (active.snapshots.at(-1)?.sequence === snapshot.sequence) {
        return;
      }
      active.snapshots.push(snapshot);
      if (mountedRef.current && isCurrent(active)) {
        setSnapshots([...active.snapshots]);
      }
    },
    [isCurrent],
  );

  const pollActive = useCallback(
    async (active: ActiveRun) => {
      let consecutiveFailures = 0;
      const interval = Math.min(
        2000,
        Math.max(500, active.capabilities.recommendedSnapshotMs),
      );
      // stopRequested is always checked first: handleStop and the unmount cleanup
      // set it before taking ownership of the final result themselves.
      while (!active.stopRequested) {
        if (!isCurrent(active)) {
          finishActive(
            active,
            'aborted',
            'The connection or device selection changed.',
          );
          return;
        }
        const requestStartedAt = performance.now();
        const result = await getUsbDiagnosticsSnapshot(active.api);
        if (active.stopRequested) {
          return;
        }
        if (!isCurrent(active)) {
          finishActive(
            active,
            'aborted',
            'The connection or device selection changed.',
          );
          return;
        }
        if (result.kind === 'ok') {
          if (result.value.sessionId !== active.sessionId) {
            setCommandError(
              'The firmware returned a different diagnostic session.',
            );
            finishActive(active, 'aborted', 'Session identity changed.');
            return;
          }
          consecutiveFailures = 0;
          appendSnapshot(active, result.value);
          if (result.value.state === 2 || result.value.state === 3) {
            finishActive(
              active,
              result.value.state === 2 ? 'complete' : 'stopped',
            );
            return;
          }
          if (result.value.state !== 1) {
            setCommandError('The firmware returned an invalid session state.');
            finishActive(active, 'aborted', 'Invalid session state.');
            return;
          }
        } else if (result.kind === 'stale') {
          consecutiveFailures = 0;
        } else {
          consecutiveFailures += 1;
          if (result.kind === 'disconnected' || consecutiveFailures >= 3) {
            setCommandError(failureMessage(result));
            finishActive(
              active,
              'aborted',
              result.kind === 'disconnected'
                ? 'Device disconnected.'
                : 'Three consecutive snapshot reads failed.',
            );
            return;
          }
        }
        const remaining = Math.max(
          100,
          interval - (performance.now() - requestStartedAt),
        );
        await wait(remaining);
      }
    },
    [appendSnapshot, finishActive, isCurrent],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadEraAdvancedMetadata().then(() => {
      if (!cancelled) {
        setMetadataReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      const active = activeRef.current;
      if (!active) {
        return;
      }
      active.stopRequested = true;
      if (
        active.api.isConnectionGenerationCurrent(active.connectionGeneration)
      ) {
        void stopUsbDiagnostics(active.api);
      }
      finishActive(active, 'aborted', 'Page, device, or connection changed.');
    };
  }, [device?.path, finishActive, selectionGeneration]);

  useEffect(() => {
    let cancelled = false;
    setCapabilities(null);
    setCommandError(null);
    setCurrentRun(null);
    setSnapshots([]);
    setRecoveredSnapshot(null);

    if (!device || !ready || !api || !metadataReady) {
      setCapabilityState('loading');
      return () => {
        cancelled = true;
      };
    }
    if (!eligible) {
      setCapabilityState('unsupported');
      return () => {
        cancelled = true;
      };
    }

    setCapabilityState('loading');
    void getUsbDiagnosticsCapabilities(api).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.kind === 'ok') {
        setCapabilities(result.value);
        setCapabilityState('supported');
        return;
      }
      if (
        result.kind === 'unhandled' ||
        (result.kind === 'status' &&
          result.status === ERA_USB_DIAGNOSTICS_STATUS_UNSUPPORTED_VERSION)
      ) {
        setCapabilityState('unsupported');
      } else if (result.kind === 'disconnected') {
        setCapabilityState('disconnected');
      } else {
        setCapabilityState('unverified');
      }
      setCommandError(failureMessage(result));
    });
    return () => {
      cancelled = true;
    };
  }, [api, device, eligible, metadataReady, ready, selectionGeneration]);

  const handleStart = useCallback(async () => {
    if (
      !api ||
      !device ||
      !capabilities ||
      !ready ||
      activeRef.current ||
      capabilities.sessionState === 1
    ) {
      return;
    }
    const connectionGeneration = api.getConnectionGeneration();
    const active: ActiveRun = {
      api,
      path: device.path,
      connectionGeneration,
      selectionGeneration,
      vendorProductId: device.vendorProductId,
      productName: device.productName,
      capabilities,
      startedAt: new Date(),
      snapshots: [],
      sessionId: 0,
      stopRequested: false,
      saved: false,
    };
    activeRef.current = active;
    setCommandPending(true);
    setCommandError(null);
    setCopyStatus(null);
    setCurrentRun(null);
    setSnapshots([]);
    setRecoveredSnapshot(null);

    const result = await startUsbDiagnostics(api, duration);
    if (!isCurrent(active)) {
      return;
    }
    if (result.kind !== 'ok') {
      activeRef.current = null;
      active.saved = true;
      setCommandPending(false);
      setCommandError(failureMessage(result));
      if (
        result.kind === 'status' &&
        result.status === ERA_USB_DIAGNOSTICS_STATUS_BUSY
      ) {
        setCapabilities((previous) =>
          previous ? {...previous, sessionState: 1} : previous,
        );
      }
      return;
    }
    if (
      result.value.state !== 1 ||
      result.value.sessionId === 0 ||
      result.value.durationSeconds !== duration
    ) {
      activeRef.current = null;
      active.saved = true;
      setCommandPending(false);
      setCommandError('The firmware returned an invalid start response.');
      return;
    }
    active.sessionId = result.value.sessionId;
    // The START command itself is done here; only the session is still running.
    // Leaving commandPending set until finishActive() kept Stop Test disabled for
    // the whole session, so a started test could not be stopped from the UI. From
    // this point the running session, not a pending command, governs the controls.
    setCommandPending(false);
    setCapabilities((previous) =>
      previous
        ? {
            ...previous,
            sessionState: 1,
            sessionId: result.value.sessionId,
          }
        : previous,
    );
    void pollActive(active);
  }, [
    api,
    capabilities,
    device,
    duration,
    isCurrent,
    pollActive,
    ready,
    selectionGeneration,
  ]);

  const handleStop = useCallback(async () => {
    if (!api || !capabilities) {
      return;
    }
    const active = activeRef.current;
    if (!active) {
      if (capabilities.sessionState !== 1) {
        return;
      }
      setCommandPending(true);
      const result = await stopUsbDiagnostics(api);
      setCommandPending(false);
      if (result.kind !== 'ok') {
        setCommandError(failureMessage(result));
        return;
      }
      setCapabilities((previous) =>
        previous
          ? {
              ...previous,
              sessionState: result.value.state,
              sessionId: result.value.sessionId,
            }
          : previous,
      );
      setCommandError(
        'The unmatched firmware session was stopped. Start a new test to capture a local result.',
      );
      return;
    }

    active.stopRequested = true;
    setCommandPending(true);
    const stopResult = await stopUsbDiagnostics(active.api);
    if (!isCurrent(active)) {
      return;
    }
    if (stopResult.kind !== 'ok') {
      active.stopRequested = false;
      setCommandPending(false);
      setCommandError(failureMessage(stopResult));
      void pollActive(active);
      return;
    }
    const snapshotResult = await getUsbDiagnosticsSnapshot(active.api);
    if (!isCurrent(active)) {
      return;
    }
    if (
      snapshotResult.kind === 'ok' &&
      snapshotResult.value.sessionId === active.sessionId
    ) {
      appendSnapshot(active, snapshotResult.value);
      finishActive(active, 'stopped');
    } else {
      setCommandError(
        snapshotResult.kind === 'ok'
          ? 'The final snapshot belonged to a different diagnostic session.'
          : failureMessage(snapshotResult),
      );
      finishActive(
        active,
        'aborted',
        'The session stopped, but its final coherent snapshot was unavailable.',
      );
    }
  }, [api, appendSnapshot, capabilities, finishActive, isCurrent, pollActive]);

  // The firmware keeps a finished session in RAM until CLEAR or the next START, so a
  // test whose page lost track of it (sleep, reload, reconnect) is still recoverable.
  // Read it on demand instead of letting the result disappear.
  const handleReadDeviceResult = useCallback(async () => {
    if (!api || activeRef.current) {
      return;
    }
    setCommandPending(true);
    setCommandError(null);
    const result = await getUsbDiagnosticsSnapshot(api);
    setCommandPending(false);
    if (result.kind !== 'ok') {
      setCommandError(failureMessage(result));
      return;
    }
    if (result.value.state !== 2 && result.value.state !== 3) {
      setCommandError('The keyboard no longer holds a finished session.');
      return;
    }
    setRecoveredSnapshot(result.value);
    setCurrentRun(null);
    setSnapshots([]);
    setCapabilities((previous) =>
      previous
        ? {
            ...previous,
            sessionState: result.value.state,
            sessionId: result.value.sessionId,
          }
        : previous,
    );
  }, [api]);

  const handleClear = useCallback(async () => {
    if (!api || activeRef.current) {
      return;
    }
    setCommandPending(true);
    setCommandError(null);
    const result = await clearUsbDiagnostics(api);
    setCommandPending(false);
    if (result.kind !== 'ok') {
      setCommandError(failureMessage(result));
      return;
    }
    setSnapshots([]);
    setCurrentRun(null);
    setRecoveredSnapshot(null);
    setCapabilities((previous) =>
      previous
        ? {...previous, sessionState: result.value.state, sessionId: 0}
        : previous,
    );
  }, [api]);

  const comparableRuns = useMemo(() => {
    if (!device || !capabilities) {
      return [];
    }
    return getComparableUsbDiagnosticsRuns(history, {
      vendorProductId: device.vendorProductId,
      firmwareVersion: capabilities.firmwareVersion,
      protocolVersion: capabilities.protocolVersion,
    });
  }, [capabilities, device, history]);

  const displayedRun = currentRun ?? comparableRuns[0] ?? null;
  const showingStoredRun =
    snapshots.length === 0 && !recoveredSnapshot && displayedRun !== null;
  const displayedSnapshots = snapshots.length
    ? snapshots
    : recoveredSnapshot
      ? [recoveredSnapshot]
      : (displayedRun?.snapshots ?? []);
  // A run whose device or connection changed mid-session clears the live view, so the
  // block would otherwise fall back to an older stored run with nothing marking it as
  // stale. Name the run whenever what is shown is not the current connection's result.
  // A recovered session has no page-side start time, so build its run only for Copy and
  // never store it — history entries must keep a known start time and identity.
  const recoveredRun = useMemo(() => {
    if (!recoveredSnapshot || !device || !capabilities) {
      return null;
    }
    const endedAt = new Date();
    return createUsbDiagnosticsRun({
      vendorProductId: device.vendorProductId,
      productName: device.productName,
      capabilities,
      startedAt: new Date(endedAt.getTime() - recoveredSnapshot.elapsedMs),
      endedAt,
      outcome: recoveredSnapshot.state === 2 ? 'complete' : 'stopped',
      abortReason:
        'Read from the keyboard after the page lost track of the session; start time is approximate.',
      snapshots: [recoveredSnapshot],
    });
  }, [capabilities, device, recoveredSnapshot]);

  const recoveredRunLabel = recoveredSnapshot
    ? `${usbDiagnosticsPollingModeLabel(recoveredSnapshot.pollingMode)} · ${
        recoveredSnapshot.durationSeconds
      }s · read from the keyboard, not from a test this page ran`
    : undefined;

  const storedRunLabel =
    showingStoredRun && displayedRun
      ? `${usbDiagnosticsPollingModeLabel(displayedRun.pollingMode)} · ${
          displayedRun.durationSeconds
        }s · ${displayedRun.outcome} · ${new Date(
          displayedRun.endedAt,
        ).toLocaleString()}`
      : undefined;

  const handleCopy = useCallback(async () => {
    // Copy must follow what the view shows, or the report describes a different run.
    const run = recoveredRun ?? currentRun ?? comparableRuns[0];
    if (!run) {
      return;
    }
    try {
      await navigator.clipboard.writeText(buildUsbDiagnosticReport(run));
      setCopyStatus('Diagnostic report copied.');
    } catch {
      setCopyStatus('Unable to access the clipboard.');
    }
  }, [comparableRuns, currentRun, recoveredRun]);

  const running = activeRef.current !== null;

  // A definition that does not opt in never reaches the firmware with a selector
  // probe, and there is nothing to show, so the block does not exist for it either.
  // `eligible` already requires the canonical metadata, so an ordinary keyboard that
  // happens to expose a polling-mode control never renders this block at all.
  if (!eligible) {
    return null;
  }

  const deviceHoldsFinishedSession =
    capabilities?.sessionState === 2 || capabilities?.sessionState === 3;
  const hasResult = Boolean(displayedRun || recoveredRun);

  return (
    <Section>
      <SectionTitle>USB Delivery Diagnostics</SectionTitle>
      <Intro>
        Run a short, read-only measurement of the polling mode this keyboard is
        currently running. It never changes the selected mode and writes nothing
        to keyboard EEPROM.
      </Intro>

      {(!ready || capabilityState === 'loading') && (
        <Note>Checking whether this firmware supports diagnostics.</Note>
      )}

      {ready && capabilityState === 'unsupported' && (
        <Note>
          USB Diagnostics are not supported by this firmware version. Every
          other feature on this page is unaffected.
        </Note>
      )}

      {ready &&
        (capabilityState === 'unverified' ||
          capabilityState === 'disconnected') && (
          <Note>
            <NoteTitle>Unable to verify diagnostics support</NoteTitle>
            {commandError}
          </Note>
        )}

      {ready && capabilities && capabilityState === 'supported' && (
        <>
          <Controls>
            <label htmlFor="usb-diagnostics-duration">Test duration</label>
            <Select
              disabled={running || commandPending}
              id="usb-diagnostics-duration"
              onChange={(event) =>
                setDuration(
                  Number(event.target.value) as UsbDiagnosticsDuration,
                )
              }
              value={duration}
            >
              {capabilities.durations.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate} seconds
                </option>
              ))}
            </Select>
            <PrimaryAccentButton
              disabled={
                running || commandPending || capabilities.sessionState === 1
              }
              onClick={handleStart}
            >
              Start Test
            </PrimaryAccentButton>
            {(running || capabilities.sessionState === 1) && (
              <AccentButton disabled={commandPending} onClick={handleStop}>
                {running ? 'Stop Test' : 'Stop Device Session'}
              </AccentButton>
            )}
            {!running && deviceHoldsFinishedSession && (
              <>
                <AccentButton
                  disabled={commandPending}
                  onClick={handleReadDeviceResult}
                >
                  Read Device Result
                </AccentButton>
                <AccentButton disabled={commandPending} onClick={handleClear}>
                  Clear Device Result
                </AccentButton>
              </>
            )}
            {hasResult && (
              <AccentButton disabled={running} onClick={handleCopy}>
                Copy Diagnostic Report
              </AccentButton>
            )}
            {copyStatus && <span>{copyStatus}</span>}
          </Controls>

          {running && (
            <Note>
              The test is running. Type normally or reproduce the workload you
              want to observe. Leaving this menu, switching keyboards or
              unplugging ends the test and stores only what was captured so far.
            </Note>
          )}

          {deviceHoldsFinishedSession &&
            !running &&
            !recoveredSnapshot &&
            snapshots.length === 0 && (
              <Note>
                <NoteTitle>Finished session still on the keyboard</NoteTitle>
                The keyboard is holding the result of a session this page did
                not follow to the end — for example one interrupted by sleep, a
                reload, or a reconnect. Read Device Result shows it. Starting a
                new test or Clear Device Result discards it.
              </Note>
            )}

          {capabilities.sessionState === 1 && !running && (
            <Note>
              <NoteTitle>Unmatched firmware session</NoteTitle>A session was
              already running when this page connected. Stop it, then start a
              new test so local history has a known start time and identity.
            </Note>
          )}

          {commandError && <ErrorText>{commandError}</ErrorText>}

          {displayedSnapshots.length > 0 ? (
            <DiagnosticsResultView
              detail={showAdvanced ? 'full' : 'summary'}
              outcome={
                recoveredRun?.outcome ??
                currentRun?.outcome ??
                displayedRun?.outcome
              }
              snapshots={displayedSnapshots}
              storedRunLabel={recoveredRunLabel ?? storedRunLabel}
            />
          ) : (
            <Muted>
              No result yet. Choose a duration and start a test. The app reads
              one coherent aggregate from the keyboard about once per second
              while it runs.
            </Muted>
          )}

          <AdvancedRow>
            <AdvancedLabel>Advanced metrics and mode comparison</AdvancedLabel>
            <AccentSlider isChecked={showAdvanced} onChange={setShowAdvanced} />
          </AdvancedRow>

          {showAdvanced && (
            <AdvancedPanel>
              <AdvancedTitle>Manual polling-mode comparison</AdvancedTitle>
              <DiagnosticsComparison runs={comparableRuns} />
              <Muted>
                Firmware {capabilities.firmwareVersion} · diagnostics protocol{' '}
                {capabilities.protocolVersion} · recommended snapshot interval{' '}
                {capabilities.recommendedSnapshotMs} ms
              </Muted>
            </AdvancedPanel>
          )}
        </>
      )}
    </Section>
  );
};
