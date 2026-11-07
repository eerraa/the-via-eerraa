import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {
  OptimizedKeycodeSequence,
  OptimizedKeycodeSequenceItem,
  RawKeycodeSequence,
  RawKeycodeSequenceAction,
} from 'src/utils/macro-api/types';
import {useKeycodeRecorder} from 'src/utils/use-keycode-recorder';
import {
  getMacroRecordingPreviewStart,
  MACRO_PREVIEW_ITEMS,
} from 'src/utils/macro-recording-preview';
import styled from 'styled-components';
import {
  convertCharacterTaps,
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
import {
  completeMacroEventEdit,
  createMacroEditFrame,
  prepareMacroEventEdit,
  rebaseMacroEditFrame,
  remapMacroViewId,
  type MacroEditCompletion,
  type MacroEditFrame,
  type MacroEditRequest,
  type MacroEditSource,
  type MacroEventEdit,
  type MacroViewId,
} from './macro-edit-model';
import {
  MacroEventViewport,
  type MacroEventCellProps,
  type MacroEventViewportHandle,
  type MacroFocusTarget,
  type MacroViewportSnapshot,
} from './macro-event-viewport';
import {
  MACRO_EVENT_BLOCK_PADDING,
  MACRO_EVENT_COLUMN_GAP,
  MACRO_EVENT_INLINE_PADDING,
  MACRO_EVENT_ROW_GAP,
  getMacroContainerGridTemplateColumns,
  getMacroRecordingFitBottom,
  isMacroSingleColumn,
} from './macro-row-layout';

declare global {
  interface Navigator {
    keyboard: {
      unlock(): Promise<void>;
      lock(): Promise<void>;
    };
  }
}

const NoMacroRecorded = styled.div`
  grid-column: 1 / -1;
  font-style: italic;
  color: var(--color_label-highlighted);
`;

const RECORDING_PREVIEW_CHARACTERS = 160;
// Events a recording shows before the box has been measured.
const UNMEASURED_PREVIEW_ITEMS = 80;
// Fullscreen/Keyboard Lock promises can outlive a recorder or a slot change.
let keyboardLockOwner: symbol | undefined;
const RecorderFrame = styled.div`
  max-width: 960px;
  width: 100%;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
`;
const SequenceBorder = styled.div<{$isModified: boolean}>`
  position: relative;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  border: 1px solid var(--border_color_cell);
  border-style: ${(props) => (props.$isModified ? 'dashed' : 'solid')};
  border-radius: 10px;
`;
const RecorderTools = styled.div`
  position: relative;
  display: flex;
  justify-content: center;
  width: max-content;
  max-width: 100%;
  margin: 0 auto;
  z-index: 1;
`;

const MacroSequenceContainer = styled.div<{$singleColumn: boolean}>`
  width: 100%;
  height: 100%;
  min-height: 0;
  display: grid;
  /* Wrap complete pairs, so alternating input and delay cells keep their columns. */
  grid-template-columns: ${(props) =>
    getMacroContainerGridTemplateColumns(props.$singleColumn)};
  gap: ${MACRO_EVENT_ROW_GAP}px ${MACRO_EVENT_COLUMN_GAP}px;
  align-content: start;
  align-items: stretch;
  flex: 1 1 0;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
  outline: none;
  ${focusRing}
  padding: ${MACRO_EVENT_BLOCK_PADDING}px ${MACRO_EVENT_INLINE_PADDING}px;
  border-radius: inherit;
  margin: 0;
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
  viewId?: MacroViewId;
  cellRef?: MacroEventCellProps['ref'];
  row?: number;
  action: OptimizedKeycodeSequenceItem[0];
  /** Formatted only when this cell renders. */
  actionArg: OptimizedKeycodeSequenceItem[1];
  locked: boolean;
  isRecording: boolean;
  deleteItem(index: number, viewId?: MacroViewId): void;
  editWait(index: number, wait: number, viewId?: MacroViewId): void;
};

// Normalization can rebuild equal chord arrays without changing the cell.
const sameMacroEventProps = (previous: MacroEventProps, next: MacroEventProps) => {
  const keys = Object.keys(previous) as (keyof MacroEventProps)[];
  return keys.length === Object.keys(next).length && keys.every((key) => {
    if (!Object.prototype.hasOwnProperty.call(next, key)) return false;
    const before = previous[key];
    const after = next[key];
    return Object.is(before, after) ||
      (key === 'actionArg' && Array.isArray(before) && Array.isArray(after) &&
        before.length === after.length &&
        before.every((value, index) => value === after[index]));
  });
};

// Compare event values and handlers before formatting the display label.
const MacroEvent = React.memo(function MacroEvent({
  index,
  viewId,
  cellRef,
  row,
  action,
  actionArg,
  locked,
  isRecording,
  deleteItem,
  editWait,
}: MacroEventProps) {
  const label = useMemo(() => {
    if (action === RawKeycodeSequenceAction.Delay) return '';
    const text = String(actionArg);
    const shownText = isRecording && text.length > RECORDING_PREVIEW_CHARACTERS
      ? `…${text.slice(-RECORDING_PREVIEW_CHARACTERS)}` : text;
    return action === RawKeycodeSequenceAction.CharacterStream
      ? shownText.replace(/ /g, '␣')
      : Array.isArray(actionArg)
      ? actionArg.map((key) => getSequenceLabel(KeycodeMap[key]) || key).join(' + ')
      : getSequenceLabel(KeycodeMap[actionArg]) || text;
  }, [action, actionArg, isRecording]);
  const wait = action === RawKeycodeSequenceAction.Delay ? Number(actionArg) : 0;
  const Label = getSequenceItemComponent(action);
  const remove = useCallback(
    (index: number) => deleteItem(index, viewId),
    [deleteItem, viewId],
  );
  const updateWait = useCallback(
    (index: number, wait: number) => editWait(index, wait, viewId),
    [editWait, viewId],
  );
  return (
    <Deletable
      index={index}
      viewId={viewId}
      row={row}
      eventRef={cellRef}
      deleteItem={remove}
      disabled={locked}
    >
      {action !== RawKeycodeSequenceAction.Delay ? (
        <Label>{label}</Label>
      ) : isRecording ? (
        <KeycodeSequenceWait>{wait} ms</KeycodeSequenceWait>
      ) : (
        <WaitInput
          index={index}
          value={wait}
          updateValue={updateWait}
          disabled={locked}
        />
      )}
    </Deletable>
  );
}, sameMacroEventProps);

export const MacroRecorder: React.FC<{
  macroIndex: number;
  editSource: MacroEditSource;
  /** Keeps an edit as the draft of the slot it belongs to. */
  editMacro(expression: string, macroIndex: number, request?: MacroEditRequest): boolean;
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
  renderFooter?: (controls: React.ReactNode) => React.ReactNode;
}> = ({
  macroIndex,
  editSource,
  editMacro,
  isModified,
  canEditItems,
  onRecordingChange,
  onRecordingPreview,
  isDelaySupported,
  renderFooter = (controls) => controls,
}) => {
  const {t} = useTranslation();
  // The slot a recording goes to, even once another is shown.
  const [recordingIndex, setRecordingIndex] = useState<number | null>(null);
  const isRecording = recordingIndex !== null;
  const [viewport, setViewport] = useState({width: 0, height: 0});
  const toolbar = useRef<HTMLDivElement | null>(null);
  const [toolbarElement, setToolbarElement] = useState<HTMLDivElement | null>(null);
  const bindToolbar = useCallback((element: HTMLDivElement | null) => {
    toolbar.current = element;
    setToolbarElement(element);
  }, []);
  const [fit, setFit] = useState<{
    source: OptimizedKeycodeSequence;
    width: number;
    height: number;
    count: number;
    measuredStart: number;
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
  const macroSequenceRef = useRef<HTMLDivElement | null>(null);
  const [scrollerElement, setScrollerElement] = useState<HTMLDivElement | null>(null);
  const bindScroller = useCallback((element: HTMLDivElement | null) => {
    macroSequenceRef.current = element;
    setScrollerElement(element);
  }, []);
  const eventViewportRef = useRef<MacroEventViewportHandle>(null);
  const idCounter = useRef(0);
  const allocateId = useCallback(() => `event-${++idCounter.current}`, []);
  const editFrameRef = useRef<MacroEditFrame>();
  editFrameRef.current = editFrameRef.current
    ? rebaseMacroEditFrame(editFrameRef.current, editSource, allocateId)
    : createMacroEditFrame(editSource, allocateId);
  const editFrame = editFrameRef.current;
  const [, publishEditFrame] = useState(0);
  const pendingSnapshot = useRef<{
    frame: MacroEditFrame;
    snapshot: MacroViewportSnapshot;
  }>();
  const contextKey = JSON.stringify([
    editSource.devicePath,
    editSource.connectionGeneration,
    macroIndex,
    editSource.epoch,
  ]);
  useLayoutEffect(() => {
    const pending = pendingSnapshot.current;
    pendingSnapshot.current = undefined;
    if (pending?.frame === editFrame) {
      eventViewportRef.current?.restoreSnapshot({
        ...pending.snapshot,
        invalidateUnseenMeasurements: true,
      });
    }
  }, [editFrame]);
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

  const displayedSequence = recordingIndex === macroIndex
    ? recordedSequence : editFrame.sequence;
  const editable = useRef(canEditItems);
  editable.current = canEditItems;

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

  const editEvent = useCallback((viewId: MacroViewId | undefined, edit: MacroEventEdit) => {
    if (!viewId || !mounted.current || recording.current || !editable.current) return;
    const frame = editFrameRef.current!;
    const prepared = prepareMacroEventEdit(frame, viewId, edit);
    if (!prepared) return;
    const snapshot = eventViewportRef.current?.captureSnapshot();
    // Move focus off a node before its deletion, then restore its logical neighbour.
    if (edit.type === 'delete' &&
      document.activeElement?.closest('[data-macro-view-id]')
        ?.getAttribute('data-macro-view-id') === viewId) {
      macroSequenceRef.current?.focus({preventScroll: true});
    }
    let completion: MacroEditCompletion | undefined;
    const accepted = editMacro(prepared.trace.expression, frame.source.macroIndex, {
      source: frame.source,
      prepare: (source) => {
        completion = completeMacroEventEdit(prepared, source, allocateId);
        if (!completion) return false;
        // Install before draft publication, which can synchronously render the recorder.
        editFrameRef.current = completion.frame;
        if (snapshot) {
          const remap = <T extends {eventIndex: number; viewId?: string | number}>(
            target: T | null,
          ): T | null => {
            if (!target) return null;
            const oldId = target.viewId === undefined
              ? frame.ids[target.eventIndex] : String(target.viewId);
            const id = oldId === undefined
              ? undefined : remapMacroViewId(oldId, completion!);
            if (id === undefined) return null;
            return {
              ...target,
              viewId: id,
              eventIndex: completion!.frame.indexById.get(id)!,
            };
          };
          const focus = (target: MacroFocusTarget | null) => {
            const next = remap(target);
            if (next?.controlKind === 'delay-input' &&
              completion!.frame.sequence[next.eventIndex][0] !== RawKeycodeSequenceAction.Delay) {
              next.controlKind = 'delete';
            }
            return next;
          };
          pendingSnapshot.current = {
            frame: completion.frame,
            snapshot: {
              ...snapshot,
              anchor: remap(snapshot.anchor),
              focus: focus(snapshot.focus),
              pendingNavigation: focus(snapshot.pendingNavigation),
            },
          };
        }
        return true;
      },
    });
    if (accepted) publishEditFrame((revision) => revision + 1);
  }, [allocateId, editMacro]);
  const deleteSequenceItem = useCallback(
    (_index: number, viewId?: MacroViewId) => editEvent(viewId, {type: 'delete'}),
    [editEvent],
  );
  const editSequenceItem = useCallback(
    (_index: number, value: number, viewId?: MacroViewId) =>
      editEvent(viewId, {type: 'wait', value}),
    [editEvent],
  );

  // A recording shows the newest events that fit the box: it probes a slice the
  // size of the box, larger while all of it fits and more remain, then keeps the
  // events whose actual wrapped bounds fit, whole rows back from the newest one.
  // Stopped, the viewport mounts the visible rows of the complete macro.
  const hasFit = fit?.source === displayedSequence &&
    fit.width === viewport.width && fit.height === viewport.height;
  const probed = probe?.source === displayedSequence &&
    probe.width === viewport.width && probe.height === viewport.height;
  const probeCount = probed
    ? probe.count
    : viewport.width && viewport.height
      ? Math.min(MACRO_PREVIEW_ITEMS, Math.max(1, Math.ceil(viewport.width / 40) * Math.ceil(viewport.height / 50)))
      : UNMEASURED_PREVIEW_ITEMS;
  const visibleCount = isRecording
    ? hasFit ? fit.count : probeCount
    : 0;
  const previewStart = getMacroRecordingPreviewStart(
    displayedSequence,
    visibleCount,
    recordingIndex === macroIndex ? totalItems : displayedSequence.length,
  );
  // Trimming an orphan wait can regroup wrapped cells beyond the measured row boundary.
  const fitted = hasFit && fit.measuredStart === previewStart;

  useEffect(() => {
    const element = scrollerElement;
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
  }, [scrollerElement]);

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
    if (isRecording && scrollerElement) {
      scrollerElement.scrollTop = scrollerElement.scrollHeight;
    }
  }, [isRecording, recordedSequence, previewStart, visibleCount, scrollerElement]);

  // Once a recording stops, the whole macro is listed and the sequence box
  // scrolls to its end, where the recording left its newest events; another
  // slot opens at its start.
  const scrolledSlot = useRef({macroIndex, recordingIndex});
  useLayoutEffect(() => {
    const previous = scrolledSlot.current;
    scrolledSlot.current = {macroIndex, recordingIndex};
    const pane = scrollerElement;
    if (!pane) return;
    if (previous.macroIndex !== macroIndex) {
      eventViewportRef.current?.scrollToStart();
      pane.scrollTop = 0;
    } else if (previous.recordingIndex === macroIndex && recordingIndex === null) {
      eventViewportRef.current?.scrollToEnd();
    }
  }, [macroIndex, recordingIndex, scrollerElement]);

  useLayoutEffect(() => {
    const element = scrollerElement;
    if (!element || !viewport.height || !isRecording || fitted) return;
    element.scrollTop = 0;
    const bottom = getMacroRecordingFitBottom(element, 0);
    const rects = Array.from(element.querySelectorAll<HTMLElement>('[data-macro-event]'), (item) => item.getBoundingClientRect());
    const overflow = rects.findIndex((rect) => rect.bottom > bottom + 1);
    const context = {source: displayedSequence, ...viewport};
    // Every drawn event fits while older ones remain before the probe: draw more.
    if (!hasFit && overflow === -1 && previewStart > 0 && probeCount < MACRO_PREVIEW_ITEMS) {
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
    const fittedCount = Math.max(1, count);
    setFit({
      ...context,
      count: fittedCount,
      measuredStart: Math.max(0, displayedSequence.length - fittedCount),
    });
  }, [displayedSequence, previewStart, probeCount, viewport, isRecording, hasFit, fitted, scrollerElement]);

  const getViewId = useCallback(
    (index: number) => editFrame.ids[index],
    [editFrame],
  );
  const getIndexForViewId = useCallback(
    (id: string | number) => editFrame.indexById.get(String(id)) ?? -1,
    [editFrame],
  );
  const getEventKind = useCallback(
    (index: number) => editFrame.sequence[index][0] === RawKeycodeSequenceAction.Delay
      ? 'delay' as const : 'key' as const,
    [editFrame],
  );
  const renderEvent = useCallback(
    (index: number, viewId: string | number, cell?: MacroEventCellProps) => {
      const [action, actionArg] = displayedSequence[index];
      return (
        <MacroEvent
          key={viewId}
          viewId={cell ? String(viewId) : undefined}
          cellRef={cell?.ref}
          row={cell?.['data-macro-row']}
          index={index}
          action={action}
          actionArg={actionArg}
          locked={isRecording || !canEditItems}
          isRecording={isRecording}
          deleteItem={deleteSequenceItem}
          editWait={editSequenceItem}
        />
      );
    },
    [displayedSequence, isRecording, canEditItems, deleteSequenceItem, editSequenceItem],
  );
  const sequence = useMemo(
    () => !isRecording ? [] : displayedSequence
      .slice(previewStart, previewStart + visibleCount)
      .map(([action], offset) => {
        const index = previewStart + offset;
        return renderEvent(index, `${index}-${action}`);
      }),
    [displayedSequence, isRecording, previewStart, visibleCount, renderEvent],
  );

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

  const controls = (
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
  );

  return (
    <>
      <RecorderFrame>
        <SequenceBorder $isModified={isModified || isRecording}>
          <MacroSequenceContainer
            ref={bindScroller}
            $singleColumn={isMacroSingleColumn(viewport.width)}
            tabIndex={0}
            aria-label={t('Macros')}
          >
            {!isRecording ? (
              <MacroEventViewport
                ref={eventViewportRef}
                eventCount={editFrame.sequence.length}
                contextKey={contextKey}
                modelRevision={editFrame.revision}
                scrollerElement={scrollerElement}
                toolbarElement={toolbarElement}
                hasTrailingAfterPseudo={false}
                disabled={!canEditItems}
                getViewId={getViewId}
                getIndexForViewId={getIndexForViewId}
                getEventKind={getEventKind}
                renderEvent={renderEvent}
                emptyState={<NoMacroRecorded>{t('No macro recorded yet...')}</NoMacroRecorded>}
              />
            ) : sequence.length ? sequence : (
              <NoMacroRecorded>{t('No macro recorded yet...')}</NoMacroRecorded>
            )}
          </MacroSequenceContainer>
        </SequenceBorder>
      </RecorderFrame>
      {renderFooter(<RecorderTools ref={bindToolbar}>{controls}</RecorderTools>)}
    </>
  );
};
