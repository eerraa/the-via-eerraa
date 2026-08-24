import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
} from 'react';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
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
  DiagnosticsAdvanced,
  DiagnosticsResultView,
} from '../../diagnostics-results';
import {Explain, ExplainRow} from '../../../inputs/explain';

// The block lines up with the ControlRow width of the menu it is embedded in so the
// polling-mode controls and the diagnostics that describe them read as one column.
const Section = styled.section({
  width: '100%',
  maxWidth: 960,
  boxSizing: 'border-box',
  padding: '20px 5px 24px',
  color: 'var(--color_label)',
  fontSize: 15,
  lineHeight: 1.55,
});

const SectionTitle = styled.h2({
  color: 'var(--color_label-highlighted)',
  fontSize: 18,
  lineHeight: 1.3,
  margin: 0,
});

const SectionHead = styled(ExplainRow)({
  marginBottom: 12,
});

const Intro = styled.p({
  margin: '0 0 14px',
  maxWidth: 760,
  fontSize: 14,
  opacity: 0.85,
});

const Controls = styled.div({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
  '& button': {
    height: 36,
    lineHeight: '34px',
    minWidth: 0,
    fontSize: 15,
  },
});

const Select = styled.select({
  height: 36,
  minWidth: 120,
  padding: '0 10px',
  border: '1px solid var(--color_accent)',
  borderRadius: 5,
  color: 'var(--color_accent)',
  background: 'var(--bg_menu)',
  fontSize: 15,
});

const Note = styled.p({
  background: 'var(--bg_control)',
  border: '1px solid var(--border_color_cell)',
  borderRadius: 10,
  padding: '12px 14px',
  fontSize: 14,
  lineHeight: 1.55,
  margin: '14px 0 0',
});

const NoteTitle = styled.strong({
  color: 'var(--color_label-highlighted)',
  display: 'block',
  marginBottom: 4,
});

// The recovery and leftover-session actions live inside the note that explains the
// situation they belong to. A button called "Read Device Result" has to carry the
// whole explanation in its name; one called "Show It" under that sentence does not.
const NoteActions = styled.span({
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  marginTop: 12,
});

const Muted = styled.p({
  opacity: 0.82,
  fontSize: 13,
  margin: '10px 0 0',
});

const ErrorText = styled.p({
  color: 'var(--color_label-highlighted)',
  fontSize: 14,
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
  fontSize: 15,
});

const AdvancedPanel = styled.div({
  marginTop: 4,
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

// Keys are the English source text, so a missing translation degrades to readable
// English rather than a raw identifier.
type Translate = (key: string, options?: Record<string, unknown>) => string;

const failureMessage = (
  t: Translate,
  failure: {
    kind: UsbDiagnosticsFailureKind;
    status?: number;
  },
) => {
  if (
    failure.kind === 'unhandled' ||
    (failure.kind === 'status' &&
      failure.status === ERA_USB_DIAGNOSTICS_STATUS_UNSUPPORTED_VERSION)
  ) {
    return t('USB Diagnostics are not supported by this firmware version.');
  }
  if (failure.kind === 'disconnected') {
    return t(
      'The keyboard disconnected. Reconnect it before starting another test.',
    );
  }
  if (failure.kind === 'timeout') {
    return t(
      'The diagnostic request timed out. Reconnect the keyboard and try again.',
    );
  }
  if (
    failure.kind === 'status' &&
    failure.status === ERA_USB_DIAGNOSTICS_STATUS_BUSY
  ) {
    return t('The firmware already has a diagnostic session in progress.');
  }
  if (failure.kind === 'stale') {
    return t('The coherent snapshot changed before every chunk was read.');
  }
  return t(
    'The diagnostic response was invalid. Reconnect the keyboard and verify that the app and firmware are current.',
  );
};

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));

export const UsbDiagnosticsSection: FC = () => {
  const {t} = useTranslation();
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
  // Held in a ref, not closed over: adding `t` to the session callbacks' dependency
  // arrays would change `finishActive`'s identity on a language change, and the
  // cleanup effect that depends on it would then abort a running measurement.
  const translate = useRef(t);
  translate.current = t;
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
            translate.current(
              'This result could not be written to local history. Browser storage may be full or blocked.',
            ),
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
              translate.current(
                'The firmware returned a different diagnostic session.',
              ),
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
            setCommandError(
              translate.current(
                'The firmware returned an invalid session state.',
              ),
            );
            finishActive(active, 'aborted', 'Invalid session state.');
            return;
          }
        } else if (result.kind === 'stale') {
          consecutiveFailures = 0;
        } else {
          consecutiveFailures += 1;
          if (result.kind === 'disconnected' || consecutiveFailures >= 3) {
            setCommandError(failureMessage(translate.current, result));
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
      setCommandError(failureMessage(translate.current, result));
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
      setCommandError(failureMessage(translate.current, result));
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
      setCommandError(
        translate.current('The firmware returned an invalid start response.'),
      );
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
        setCommandError(failureMessage(translate.current, result));
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
        translate.current(
          'The unmatched firmware session was stopped. Start a new test to capture a local result.',
        ),
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
      setCommandError(failureMessage(translate.current, stopResult));
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
          ? translate.current(
              'The final snapshot belonged to a different diagnostic session.',
            )
          : failureMessage(translate.current, snapshotResult),
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
      setCommandError(failureMessage(translate.current, result));
      return;
    }
    if (result.value.state !== 2 && result.value.state !== 3) {
      setCommandError(
        translate.current('The keyboard no longer holds a finished session.'),
      );
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
      setCommandError(failureMessage(translate.current, result));
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
      }s · ${t('read from the keyboard, not from a test this page ran')}`
    : undefined;

  const storedRunLabel =
    showingStoredRun && displayedRun
      ? `${usbDiagnosticsPollingModeLabel(displayedRun.pollingMode)} · ${
          displayedRun.durationSeconds
        }s · ${t(displayedRun.outcome)} · ${new Date(
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
      setCopyStatus(translate.current('Diagnostic report copied.'));
    } catch {
      setCopyStatus(translate.current('Unable to access the clipboard.'));
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
  // The keyboard is holding a session this page never followed to the end, or is
  // showing the one it just recovered. Both are situations, not operations, so the
  // actions live inside the sentence that describes them.
  const keyboardResultNeedsAttention =
    deviceHoldsFinishedSession && !running && snapshots.length === 0;

  return (
    <Section>
      <SectionHead>
        <SectionTitle>{t('USB Delivery Diagnostics')}</SectionTitle>
        <Explain>
          {t(
            'It answers one question: while the test ran, did the keyboard lose key presses, pause, or lose its USB connection? It only reads. It never changes the mode and never writes to the keyboard.',
          )}
        </Explain>
      </SectionHead>
      <Intro>
        {t('Measures how the polling mode selected above actually behaves.')}
      </Intro>

      {(!ready || capabilityState === 'loading') && (
        <Note>{t('Checking whether this firmware supports diagnostics.')}</Note>
      )}

      {ready && capabilityState === 'unsupported' && (
        <Note>
          {t(
            'USB Diagnostics are not supported by this firmware version. Every other feature on this page is unaffected.',
          )}
        </Note>
      )}

      {ready &&
        (capabilityState === 'unverified' ||
          capabilityState === 'disconnected') && (
          <Note>
            <NoteTitle>{t('Unable to verify diagnostics support')}</NoteTitle>
            {commandError}
          </Note>
        )}

      {ready && capabilities && capabilityState === 'supported' && (
        <>
          <Controls>
            <label htmlFor="usb-diagnostics-duration">
              {t('Test duration')}
            </label>
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
                  {t('{{seconds}} seconds', {seconds: candidate})}
                </option>
              ))}
            </Select>
            <PrimaryAccentButton
              disabled={
                running || commandPending || capabilities.sessionState === 1
              }
              onClick={handleStart}
            >
              {t('Start Test')}
            </PrimaryAccentButton>
            {running && (
              <AccentButton disabled={commandPending} onClick={handleStop}>
                {t('Stop Test')}
              </AccentButton>
            )}
            {hasResult && (
              <AccentButton disabled={running} onClick={handleCopy}>
                {t('Copy Diagnostic Report')}
              </AccentButton>
            )}
            {copyStatus && <span>{copyStatus}</span>}
          </Controls>

          {running ? (
            <Note>
              {t(
                'Running. Type normally. Leaving this menu, switching keyboards or unplugging ends the test early.',
              )}
            </Note>
          ) : (
            !hasResult && (
              <Muted>
                {t('Pick a length, press Start Test, then type normally.')}
              </Muted>
            )
          )}

          {keyboardResultNeedsAttention && (
            <Note>
              <NoteTitle>
                {recoveredSnapshot
                  ? t('The result above is still stored on the keyboard')
                  : t('A finished test is still on the keyboard')}
              </NoteTitle>
              {recoveredSnapshot
                ? t('It stays there until a new test starts or you discard it.')
                : t(
                    'Sleep, a reload or unplugging interrupted it. The keyboard keeps the result until a new test starts.',
                  )}
              <NoteActions>
                {!recoveredSnapshot && (
                  <AccentButton
                    disabled={commandPending}
                    onClick={handleReadDeviceResult}
                  >
                    {t('Show It')}
                  </AccentButton>
                )}
                <AccentButton disabled={commandPending} onClick={handleClear}>
                  {t('Discard It')}
                </AccentButton>
              </NoteActions>
            </Note>
          )}

          {capabilities.sessionState === 1 && !running && (
            <Note>
              <NoteTitle>
                {t('A test was already running when this page connected')}
              </NoteTitle>
              {t(
                'Another tab or a reload started it. Stop it before starting a new test.',
              )}
              <NoteActions>
                <AccentButton disabled={commandPending} onClick={handleStop}>
                  {t('Stop It')}
                </AccentButton>
              </NoteActions>
            </Note>
          )}

          {commandError && <ErrorText>{commandError}</ErrorText>}

          {displayedSnapshots.length > 0 && (
            <>
              <DiagnosticsResultView
                detail="summary"
                outcome={
                  recoveredRun?.outcome ??
                  currentRun?.outcome ??
                  displayedRun?.outcome
                }
                snapshots={displayedSnapshots}
                storedRunLabel={recoveredRunLabel ?? storedRunLabel}
              />

              <AdvancedRow>
                <AdvancedLabel>
                  {t('Advanced metrics and mode comparison')}
                </AdvancedLabel>
                <AccentSlider
                  isChecked={showAdvanced}
                  onChange={setShowAdvanced}
                />
              </AdvancedRow>

              {showAdvanced && (
                <AdvancedPanel>
                  <DiagnosticsAdvanced
                    runs={comparableRuns}
                    snapshots={displayedSnapshots}
                  />
                  <Muted>
                    {t(
                      'Firmware {{firmware}} · diagnostics protocol {{protocol}} · recommended snapshot interval {{interval}} ms',
                      {
                        firmware: capabilities.firmwareVersion,
                        protocol: capabilities.protocolVersion,
                        interval: capabilities.recommendedSnapshotMs,
                      },
                    )}
                  </Muted>
                </AdvancedPanel>
              )}
            </>
          )}
        </>
      )}
    </Section>
  );
};
