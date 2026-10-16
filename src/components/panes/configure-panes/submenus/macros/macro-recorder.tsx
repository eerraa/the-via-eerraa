import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {
  OptimizedKeycodeSequence,
  OptimizedKeycodeSequenceItem,
  RawKeycodeSequence,
  RawKeycodeSequenceAction,
} from 'src/utils/macro-api/types';
import {useKeycodeRecorder} from 'src/utils/use-keycode-recorder';
import {MACRO_PREVIEW_ITEMS} from 'src/utils/macro-recording-preview';
import styled from 'styled-components';
import {
  convertCharacterTaps,
  expressionToSequence,
  foldKeydownKeyupKeys,
  convertToCharacterStreams,
  mergeConsecutiveWaits,
  sequenceToExpression,
  trimLastWait,
} from 'src/utils/macro-api/macro-api.common';
import {getKeycodes, IKeycode} from 'src/utils/key';
import {
  getSequenceItemComponent,
  getSequenceLabel,
  SequenceLabelSeparator,
  KeycodeSequenceWait,
  WaitInput,
} from './keycode-sequence-components';
import {MacroEditControls} from './macro-controls';
import {Deletable} from './deletable';
import {pipeline} from 'src/utils/pipeline';
import {useAppSelector} from 'src/store/hooks';
import {
  getMacroEditorSettings,
  setMacroEditorSettings,
} from 'src/store/settingsSlice';
import {useDispatch} from 'react-redux';
import { useTranslation } from 'react-i18next';
import {focusRing} from 'src/components/inputs/accent-button';

declare global {
  interface Navigator {
    keyboard: {
      unlock(): Promise<void>;
      lock(): Promise<void>;
    };
  }
}

const NoMacroRecorded = styled.div`
  font-style: italic;
  color: var(--color_label-highlighted);
`;

const RECORDING_PREVIEW_CHARACTERS = 160;
// Events a recording shows before the box has been measured.
const UNMEASURED_PREVIEW_ITEMS = 80;
// A stopped macro is one list the pane scrolls, as in VIA. Past this many events
// only the newest are listed, so a very long recording cannot stall the editor;
// Script shows all of it.
const MACRO_LIST_ITEMS = 5000;
// Fullscreen/Keyboard Lock promises can outlive a recorder or a slot change.
let keyboardLockOwner: symbol | undefined;
const PreviewNote = styled.div`
  color: var(--color_label);
  font-size: 12px;
`;

// The pane a stopped macro scrolls with: the nearest box around it that scrolls.
const scrollingPane = (element: HTMLElement) => {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
};

// Recording, the box fills the pane and shows the newest events that fit it.
// Stopped, it grows with the macro and the pane scrolls it whole, as in VIA.
const MacroSequenceContainer = styled.div<{
  $isModified: boolean;
  $isRecording: boolean;
}>`
  max-width: 960px;
  width: 100%;
  display: block;
  flex: ${(props) => (props.$isRecording ? '1 1 0' : '1 0 auto')};
  min-height: 140px;
  overflow: ${(props) => (props.$isRecording ? 'auto' : 'visible')};
  scrollbar-gutter: stable;
  outline: none;
  ${focusRing}
  border: 1px solid var(--border_color_cell);
  border-style: ${(props) => (props.$isModified ? 'dashed' : 'solid')};
  padding: 30px 20px;
  border-radius: 15px;
  margin-top: 10px;
  box-sizing: border-box;
`;

type SmartTransformAcc = [
  [OptimizedKeycodeSequenceItem, number][],
  [OptimizedKeycodeSequenceItem, number],
  number,
];

// TODO: make this handle {+LC_CTL}abc{-LC_CTL}
// TODO: make this handle abc{KC_ENT}def{KC_ENT}
const smartTransform = (
  [acc, , currHeld]: SmartTransformAcc,
  [curr, id]: [OptimizedKeycodeSequenceItem, number],
): SmartTransformAcc => {
  const [action, actionArg] = curr;
  if (action === RawKeycodeSequenceAction.Delay && currHeld === 0) {
    acc.push([curr, id]);
  } else if (
    (action === RawKeycodeSequenceAction.Down ||
      action === RawKeycodeSequenceAction.Tap) &&
    currHeld === 0
  ) {
    acc.push([[RawKeycodeSequenceAction.Tap, actionArg as string], id]);
    currHeld = currHeld + 1;
  } else if (
    action === RawKeycodeSequenceAction.Tap &&
    String(actionArg).length === 1 // this is meant to concatenate letters
  ) {
    acc[acc.length - 1][0][1] = `${acc[acc.length - 1][0][1]}${actionArg}`;
  } else if (action === RawKeycodeSequenceAction.Tap) {
    acc[acc.length - 1][0][1] = [acc[acc.length - 1][0][1] as string[]]
      .flat()
      .concat(actionArg as string);
  } else if (action === RawKeycodeSequenceAction.Down) {
    acc[acc.length - 1][0][1] = [acc[acc.length - 1][0][1] as string[]]
      .flat()
      .concat(actionArg as string);
    currHeld = currHeld + 1;
  } else if (action === RawKeycodeSequenceAction.Up) {
    currHeld = currHeld - 1;
  } else if (action === RawKeycodeSequenceAction.CharacterStream) {
    acc.push([curr, id]);
  }
  return [acc, [curr, id], currHeld] as SmartTransformAcc;
};

const componentJoin = (arr: (JSX.Element | null)[], separator: JSX.Element) => {
  return arr.reduce((acc, next, idx) => {
    if (idx) {
      acc.push({...separator, key: idx.toString()});
    }
    acc.push(next);
    return acc;
  }, [] as (JSX.Element | null)[]);
};

const KeycodeMap = getKeycodes()
  .flatMap((menu) => menu.keycodes)
  .reduce((p, n) => ({...p, [n.code]: n}), {} as Record<string, IKeycode>);

const optimizeKeycodeSequence = (sequence: RawKeycodeSequence) => {
  return pipeline(
    sequence,
    convertCharacterTaps,
    trimLastWait,
    mergeConsecutiveWaits,
    foldKeydownKeyupKeys,
    convertToCharacterStreams,
  );
};
const cleanKeycodeSequence = (sequence: RawKeycodeSequence) => {
  return pipeline(sequence, mergeConsecutiveWaits);
};

// Holding Escape is how a browser leaves fullscreen while the keyboard is locked, so
// a recording that fullscreen ended closes with that press. It is not part of the
// macro: the last Escape, whatever came after it and the wait before it are dropped.
const withoutFullscreenExit = (
  sequence: RawKeycodeSequence,
): RawKeycodeSequence => {
  const isWait = (index: number) =>
    sequence[index][0] === RawKeycodeSequenceAction.Delay;
  const isEscape = (index: number, action: RawKeycodeSequenceAction) =>
    sequence[index][0] === action && sequence[index][1] === 'KC_ESC';
  let end = sequence.length;
  while (
    end > 0 &&
    (isWait(end - 1) || isEscape(end - 1, RawKeycodeSequenceAction.Up))
  ) {
    end--;
  }
  if (end === 0 || !isEscape(end - 1, RawKeycodeSequenceAction.Down)) {
    return sequence;
  }
  end--;
  while (end > 0 && isWait(end - 1)) {
    end--;
  }
  return sequence.slice(0, end);
};

type MacroEventProps = {
  index: number;
  action: OptimizedKeycodeSequenceItem[0];
  /** What a key, chord or text shows. */
  label: string;
  /** A wait's milliseconds. */
  wait: number;
  locked: boolean;
  isRecording: boolean;
  deleteItem(index: number): void;
  editWait(index: number, wait: number): void;
};

// One event of the list. Its props are plain values and handlers that stay the
// same, so an edit draws again only the events it changes.
const MacroEvent = React.memo(function MacroEvent({
  index,
  action,
  label,
  wait,
  locked,
  isRecording,
  deleteItem,
  editWait,
}: MacroEventProps) {
  const Label = getSequenceItemComponent(action);
  return (
    <Deletable index={index} deleteItem={deleteItem} disabled={locked}>
      {action !== RawKeycodeSequenceAction.Delay ? (
        <Label>{label}</Label>
      ) : isRecording ? (
        <KeycodeSequenceWait>{wait} ms</KeycodeSequenceWait>
      ) : (
        <WaitInput
          index={index}
          value={wait}
          updateValue={editWait}
          disabled={locked}
        />
      )}
    </Deletable>
  );
});

export const MacroRecorder: React.FC<{
  macroIndex: number;
  /** The macro as the keyboard holds it. */
  selectedMacro?: OptimizedKeycodeSequence;
  /** The slot's edit that is not written yet, shown in place of the macro. */
  draft?: string;
  /** Keeps an edit as the draft of the slot it belongs to. */
  editMacro(expression: string, macroIndex: number): void;
  isModified: boolean;
  /**
   * Whether its keys and waits can be changed one by one. A change writes the whole
   * macro out again as the recorder reads it, which can turn a script the keyboard
   * refuses into a different one it takes, so that one is fixed in the script.
   */
  canEditItems: boolean;
  onRecordingChange(isRecording: boolean): void;
  onRecordingPreview?(byteCount: number): void;
  isDelaySupported: boolean;
}> = ({
  macroIndex,
  selectedMacro,
  draft,
  editMacro,
  isModified,
  canEditItems,
  onRecordingChange,
  onRecordingPreview,
  isDelaySupported,
}) => {
  const {t} = useTranslation();
  // The slot a recording goes to, even once another is shown.
  const [recordingIndex, setRecordingIndex] = useState<number | null>(null);
  const isRecording = recordingIndex !== null;
  const [viewport, setViewport] = useState({width: 0, height: 0});
  const [fit, setFit] = useState<{
    source: OptimizedKeycodeSequence;
    width: number;
    height: number;
    count: number;
  }>();
  // A probe whose every event fitted while more remained, drawn again larger.
  const [probe, setProbe] = useState<{
    source: OptimizedKeycodeSequence;
    width: number;
    height: number;
    count: number;
  }>();
  const [isFullscreen, setIsFullscreen] = useState(
    !!document.fullscreenElement,
  );
  const {smartOptimizeEnabled, recordDelaysEnabled} = useAppSelector(
    getMacroEditorSettings,
  );
  const dispatch = useDispatch();
  const {
    sequence: keycodeSequence,
    reset: resetRecording,
    read: readRecording,
    totalItems,
    byteCount,
  } = useKeycodeRecorder(
    isRecording,
    recordDelaysEnabled && isDelaySupported,
    smartOptimizeEnabled,
    isDelaySupported,
  );
  const macroSequenceRef = useRef<HTMLDivElement>(null);
  const resetRecordingRef = useRef(resetRecording);
  resetRecordingRef.current = resetRecording;
  const mounted = useRef(true);
  const starting = useRef(false);
  const startRequest = useRef(0);
  const lockToken = useRef<symbol>();
  const unlockKeyboard = useCallback(() => {
    if (lockToken.current && keyboardLockOwner === lockToken.current) {
      navigator.keyboard.unlock();
      keyboardLockOwner = undefined;
    }
  }, []);
  const recording = useRef(isRecording);
  recording.current = isRecording;
  const finalDraft = useRef({recordingIndex, editMacro, smartOptimizeEnabled});
  finalDraft.current = {recordingIndex, editMacro, smartOptimizeEnabled};
  const shownIndex = useRef(macroIndex);
  shownIndex.current = macroIndex;

  const recordedSequence = keycodeSequence;

  const displayedSequence: OptimizedKeycodeSequence = useMemo(
    () =>
      recordingIndex === macroIndex
        ? recordedSequence
        : draft !== undefined
        ? expressionToSequence(draft)
        : selectedMacro ?? [],
    [draft, macroIndex, recordedSequence, recordingIndex, selectedMacro],
  );
  // Edits read the sequence from here, so the events' handlers stay the same and
  // an edit draws again only the events it changes.
  const latestSequence = useRef(displayedSequence);
  latestSequence.current = displayedSequence;

  // The complete input is flushed on Stop, slot changes and unmount. Preview
  // updates publish only a byte count, not a full draft to parse and encode again.
  useEffect(() => {
    if (isRecording) onRecordingPreview?.(byteCount);
  }, [isRecording, byteCount, onRecordingPreview]);

  useEffect(() => { startRequest.current++; }, [macroIndex]);

  useEffect(() => {
    onRecordingChange(isRecording);
  }, [isRecording]);

  const startRecording = useCallback(async () => {
    if (starting.current || recording.current) return;
    starting.current = true;
    const request = ++startRequest.current;
    const token = Symbol('macro recording');
    lockToken.current = token;
    keyboardLockOwner = token;
    const index = macroIndex;
    let started = false;
    let lockRequested = false;
    const current = () => mounted.current && startRequest.current === request &&
      shownIndex.current === index && keyboardLockOwner === token &&
      !!document.fullscreenElement;
    // The keyboard is only locked in fullscreen, so one press asks for both and
    // records only once it has them.
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      if (!current()) return;
      lockRequested = true;
      await navigator.keyboard.lock();
      if (!current()) return;
      // Settings can change while fullscreen or Keyboard Lock is pending.
      resetRecordingRef.current();
      setIsFullscreen(!!document.fullscreenElement);
      setRecordingIndex(index);
      started = true;
    } catch {
      return;
    } finally {
      starting.current = false;
      if (!started && keyboardLockOwner === token) {
        if (lockRequested) unlockKeyboard();
        else keyboardLockOwner = undefined;
      }
    }
  }, [macroIndex, resetRecording, unlockKeyboard]);

  const stopRecording = useCallback(
    (exitedFullscreen = false) => {
      if (recordingIndex === null) {
        return;
      }
      unlockKeyboard();
      const input = readRecording();
      const recorded = exitedFullscreen ? withoutFullscreenExit(input) : input;
      editMacro(
        sequenceToExpression(
          smartOptimizeEnabled ? optimizeKeycodeSequence(recorded) : recorded,
        ),
        recordingIndex,
      );
      resetRecording();
      setRecordingIndex(null);
    },
    [
      editMacro,
      readRecording,
      recordingIndex,
      resetRecording,
      smartOptimizeEnabled,
      unlockKeyboard,
    ],
  );

  // However fullscreen ends, the recording ends with it: the keyboard is no longer
  // locked, and the keys it would take are meant for the page. Choosing another
  // slot ends it too, and it stays with the slot it was recorded in.
  useEffect(() => {
    if (recordingIndex === null) {
      return;
    }
    if (!isFullscreen) {
      stopRecording(true);
    } else if (recordingIndex !== macroIndex) {
      stopRecording();
    }
  }, [isFullscreen, macroIndex, recordingIndex, stopRecording]);

  const clearMacro = useCallback(
    () => editMacro('', macroIndex),
    [editMacro, macroIndex],
  );

  const editSequence = useCallback(
    (sequence: OptimizedKeycodeSequence) =>
      editMacro(
        sequenceToExpression(
          cleanKeycodeSequence(sequence as RawKeycodeSequence),
        ),
        macroIndex,
      ),
    [editMacro, macroIndex],
  );

  const deleteSequenceItem = useCallback(
    (id: number) => {
      // Deleting the focused item must not leave focus on a shifted event or body.
      if (document.activeElement?.closest('[data-macro-event]')?.getAttribute('data-macro-event') === String(id)) {
        macroSequenceRef.current?.focus({preventScroll: true});
      }
      const newSequence = [...latestSequence.current];
      newSequence.splice(id, 1);
      editSequence(newSequence);
    },
    [editSequence],
  );

  const editSequenceItem = useCallback(
    (id: number, val: number) => {
      const newSequence = [...latestSequence.current];
      newSequence.splice(id, 1, [RawKeycodeSequenceAction.Delay, val]);
      editSequence(newSequence);
    },
    [editSequence],
  );

  // A recording shows the newest events that fit the box: it probes a slice the
  // size of the box, larger while all of it fits and more remain, then keeps the
  // events whose actual wrapped bounds fit, whole rows back from the newest one.
  // Stopped, the macro is one list that the pane scrolls.
  const fitted = fit?.source === displayedSequence &&
    fit.width === viewport.width && fit.height === viewport.height;
  const probed = probe?.source === displayedSequence &&
    probe.width === viewport.width && probe.height === viewport.height;
  const probeCount = probed
    ? probe.count
    : viewport.width && viewport.height
      ? Math.min(MACRO_PREVIEW_ITEMS, Math.max(1, Math.ceil(viewport.width / 40) * Math.ceil(viewport.height / 50)))
      : UNMEASURED_PREVIEW_ITEMS;
  const visibleCount = isRecording
    ? fitted ? fit.count : probeCount
    : Math.min(displayedSequence.length, MACRO_LIST_ITEMS);
  const previewStart = Math.max(0, displayedSequence.length - visibleCount);

  useEffect(() => {
    const element = macroSequenceRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const update = () => setViewport((previous) => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      return width === previous.width && height === previous.height
        ? previous : {width, height};
    });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A font that loads late changes the size of events: a recording is fitted again.
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    const invalidate = () => setFit(undefined);
    fonts.addEventListener('loadingdone', invalidate);
    return () => fonts.removeEventListener('loadingdone', invalidate);
  }, []);

  // The newest recorded event stays in view, also once the fit replaces the probe.
  useLayoutEffect(() => {
    if (isRecording && macroSequenceRef.current) {
      macroSequenceRef.current.scrollTop = macroSequenceRef.current.scrollHeight;
    }
  }, [isRecording, recordedSequence, previewStart, visibleCount]);

  // Once a recording stops, the whole macro is listed and the pane scrolls to its
  // end, where the recording left its newest events; another slot opens at its
  // start.
  const scrolledSlot = useRef({macroIndex, recordingIndex});
  useLayoutEffect(() => {
    const previous = scrolledSlot.current;
    scrolledSlot.current = {macroIndex, recordingIndex};
    const pane =
      macroSequenceRef.current && scrollingPane(macroSequenceRef.current);
    if (!pane) return;
    if (previous.macroIndex !== macroIndex) {
      pane.scrollTop = 0;
    } else if (previous.recordingIndex === macroIndex && recordingIndex === null) {
      pane.scrollTop = pane.scrollHeight;
    }
  }, [macroIndex, recordingIndex]);

  useLayoutEffect(() => {
    const element = macroSequenceRef.current;
    if (!element || !viewport.height || !isRecording || fitted) return;
    element.scrollTop = 0;
    const bottom = element.getBoundingClientRect().bottom - parseFloat(getComputedStyle(element).paddingBottom) - element.clientTop;
    const rects = Array.from(element.querySelectorAll<HTMLElement>('[data-macro-event]'), (item) => item.getBoundingClientRect());
    const overflow = rects.findIndex((rect) => rect.bottom > bottom + 1);
    const context = {source: displayedSequence, ...viewport};
    // Every drawn event fits while older ones remain before the probe: draw more.
    if (overflow === -1 && previewStart > 0 && probeCount < MACRO_PREVIEW_ITEMS) {
      setProbe({...context, count: Math.min(MACRO_PREVIEW_ITEMS, probeCount * 2)});
      return;
    }
    let count = overflow === -1 ? rects.length : overflow;
    if (overflow !== -1) {
      // A recording keeps whole rows back from its newest event. A row starts at
      // the left edge, so the rows kept lay out as they did below the dropped ones.
      // A row starts where an event goes back left or below the one before it,
      // which also catches rows of a single event each.
      const starts = rects.flatMap((rect, index) =>
        index === 0 || rect.left < rects[index - 1].left - 1 ||
          rect.top >= rects[index - 1].bottom - 1 ? [index] : []);
      const rowTop = (row: number) =>
        Math.min(...rects.slice(starts[row], starts[row + 1]).map((rect) => rect.top));
      const end = Math.max(...rects.map((rect) => rect.bottom));
      const room = bottom - rowTop(0);
      let row = starts.length - 1;
      while (row > 0 && end - rowTop(row - 1) <= room + 1) row--;
      count = rects.length - starts[row];
    }
    setFit({...context, count: Math.max(1, count)});
  }, [displayedSequence, previewStart, probeCount, viewport, isRecording, fitted]);

  // A recording is measured with its note in place, so the events fitted below
  // the note still fit once it stays.
  const shortenedPreview = isRecording && ((!fitted && viewport.height > 0) ||
    totalItems > displayedSequence.length - previewStart ||
    displayedSequence.some(([action, value]) =>
      action === RawKeycodeSequenceAction.CharacterStream &&
      String(value).length > RECORDING_PREVIEW_CHARACTERS,
    ));
  const sequence = useMemo(() => {
    const locked = isRecording || !canEditItems;
    return componentJoin(
      displayedSequence.slice(previewStart, previewStart + visibleCount).map(([action, actionArg], offset) => {
        const id = previewStart + offset;
        const text = String(actionArg);
        const shownText = isRecording && text.length > RECORDING_PREVIEW_CHARACTERS
          ? `…${text.slice(-RECORDING_PREVIEW_CHARACTERS)}`
          : text;
        return (
          <MacroEvent
            key={`${id}-${action}`}
            index={id}
            action={action}
            label={
              action === RawKeycodeSequenceAction.Delay
                ? ''
                : action === RawKeycodeSequenceAction.CharacterStream
                ? shownText.replace(/ /g, '␣')
                : Array.isArray(actionArg)
                ? actionArg
                    .map((k) => getSequenceLabel(KeycodeMap[k]) || k)
                    .join(' + ')
                : getSequenceLabel(KeycodeMap[actionArg]) || text
            }
            wait={action === RawKeycodeSequenceAction.Delay ? Number(actionArg) : 0}
            locked={locked}
            isRecording={isRecording}
            deleteItem={deleteSequenceItem}
            editWait={editSequenceItem}
          />
        );
      }),
      <SequenceLabelSeparator />,
    );
  }, [
    displayedSequence,
    deleteSequenceItem,
    editSequenceItem,
    isRecording,
    canEditItems,
    previewStart,
    visibleCount,
  ]);

  useEffect(() => {
    mounted.current = true;
    const onFullScreenChanged: EventListener = () => {
      if (!document.fullscreenElement) startRequest.current++;
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.documentElement.addEventListener(
      'fullscreenchange',
      onFullScreenChanged,
    );
    return () => {
      mounted.current = false;
      startRequest.current++;
      if (recording.current) {
        // A mode/pane/device change can precede the next preview. Persist all
        // captured input through the original device's guarded draft callback.
        const {recordingIndex, editMacro, smartOptimizeEnabled} = finalDraft.current;
        if (recordingIndex !== null) {
          const input = readRecording();
          editMacro(
            sequenceToExpression(
              smartOptimizeEnabled ? optimizeKeycodeSequence(input) : input,
            ),
            recordingIndex,
          );
        }
        unlockKeyboard();
        onRecordingChange(false);
      }
      document.documentElement.removeEventListener(
        'fullscreenchange',
        onFullScreenChanged,
      );
    };
  }, [setIsFullscreen, readRecording, unlockKeyboard]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else if (document.exitFullscreen) {
      stopRecording();
      document.exitFullscreen();
    }
  }, [stopRecording]);

  return (
    <>
      <MacroSequenceContainer ref={macroSequenceRef} $isModified={isModified || isRecording}
        $isRecording={isRecording} tabIndex={0} aria-label={t('Macros')}>
        {shortenedPreview ? (
          <PreviewNote>{t('Showing recent inputs while recording')}</PreviewNote>
        ) : !isRecording && previewStart > 0 ? (
          <PreviewNote>{t('Showing recent inputs; Script shows all of them')}</PreviewNote>
        ) : null}
        {sequence.length ? (
          sequence
        ) : (
          <NoMacroRecorded>{t('No macro recorded yet...')}</NoMacroRecorded>
        )}
      </MacroSequenceContainer>
      {/* Below the box, not on its edge as VIA has them. */}
      <div
        style={{
          border: 'none',
          maxWidth: 960,
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
          marginTop: 10,
        }}
      >
        <MacroEditControls
          isFullscreen={isFullscreen}
          isEmpty={!displayedSequence.length}
          optimizeRecording={smartOptimizeEnabled}
          recordDelays={recordDelaysEnabled}
          isRecording={isRecording}
          addText={() => {}}
          clearMacro={clearMacro}
          toggleOptimizeRecording={() => {
            dispatch(
              setMacroEditorSettings({
                smartOptimizeEnabled: !smartOptimizeEnabled,
              }),
            );
          }}
          toggleRecordDelays={() => {
            dispatch(
              setMacroEditorSettings({
                recordDelaysEnabled: !recordDelaysEnabled,
              }),
            );
          }}
          toggleFullscreen={toggleFullscreen}
          recordingToggleChange={(start) =>
            start ? startRecording() : stopRecording()
          }
          isDelaySupported={isDelaySupported}
        />
      </div>
    </>
  );
};
