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
// Fullscreen/Keyboard Lock promises can outlive a recorder or a slot change.
let keyboardLockOwner: symbol | undefined;
const RecordingPreviewNote = styled.div`
  color: var(--color_label);
  font-size: 12px;
`;
const PageControls = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  min-height: 32px;
  color: var(--color_label);
  button {
    font: inherit;
    color: inherit;
    background: var(--bg_control);
    border: 1px solid var(--border_color_cell);
    border-radius: 5px;
    padding: 4px 10px;
    cursor: pointer;
    outline: none;
    ${focusRing}
    &:disabled { opacity: 0.4; cursor: default; }
  }
`;

const MacroSequenceContainer = styled.div<{$isModified: boolean}>`
  max-width: 960px;
  width: 100%;
  display: block;
  flex: 1 1 0;
  min-height: 140px;
  overflow: auto;
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
  const [pageStarts, setPageStarts] = useState([0]);
  const [viewport, setViewport] = useState({width: 0, height: 0});
  const wheelGesture = useRef({accumulated: 0, lastPage: -Infinity});
  const [fit, setFit] = useState<{
    source: OptimizedKeycodeSequence;
    start: number;
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
  const pageButtonFocus = useRef<HTMLButtonElement | null>(null);
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

  // The complete input is flushed on Stop, slot changes and unmount. Preview
  // updates publish only a byte count, not a full draft to parse and encode again.
  useEffect(() => {
    if (isRecording) onRecordingPreview?.(byteCount);
  }, [isRecording, byteCount, onRecordingPreview]);

  useEffect(() => {
    setPageStarts([0]);
    wheelGesture.current = {accumulated: 0, lastPage: -Infinity};
  }, [macroIndex, isRecording]);
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
      const newSequence = [...displayedSequence];
      newSequence.splice(id, 1);
      editSequence(newSequence);
    },
    [displayedSequence, editSequence],
  );

  const editSequenceItem = useCallback(
    (id: number, val: number) => {
      const newSequence = [...displayedSequence];
      newSequence.splice(id, 1, [RawKeycodeSequenceAction.Delay, val]);
      editSequence(newSequence);
    },
    [displayedSequence, editSequence],
  );

  const previewStart = isRecording ? 0 : Math.min(pageStarts[pageStarts.length - 1], Math.max(0, displayedSequence.length - 1));
  const fitted = fit?.source === displayedSequence && fit.start === previewStart &&
    fit.width === viewport.width && fit.height === viewport.height;
  // Probe only a viewport-sized suffix, then keep the events whose actual
  // wrapped bounds fit. Capture still uses its bounded 80-event preview.
  const probeCount = viewport.width && viewport.height
    ? Math.min(1000, Math.max(1, Math.ceil(viewport.width / 40) * Math.ceil(viewport.height / 50)))
    : MACRO_PREVIEW_ITEMS;
  const visibleCount = isRecording ? MACRO_PREVIEW_ITEMS : fitted ? fit.count : probeCount;
  const hasPrevious = !isRecording && pageStarts.length > 1;
  const hasNext = !isRecording && previewStart + visibleCount < displayedSequence.length;

  useEffect(() => {
    setPageStarts((starts) => {
      if (starts[starts.length - 1] < displayedSequence.length || starts.length === 1) return starts;
      return starts.filter((start) => start === 0 || start < displayedSequence.length);
    });
  }, [displayedSequence.length]);

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

  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    const invalidate = () => setFit(undefined);
    fonts.addEventListener('loadingdone', invalidate);
    return () => fonts.removeEventListener('loadingdone', invalidate);
  }, []);

  useLayoutEffect(() => {
    if (isRecording && macroSequenceRef.current) {
      macroSequenceRef.current.scrollTop = macroSequenceRef.current.scrollHeight;
    }
  }, [isRecording, recordedSequence]);

  useLayoutEffect(() => {
    const element = macroSequenceRef.current;
    if (!element || !viewport.height) return;
    // Line breaks and viewport size can make even a short label scrollable.
    // Keep only labels with actual overflow in the keyboard tab order.
    if (isRecording) {
      element.querySelectorAll('[data-macro-label][tabindex]').forEach((label) => label.removeAttribute('tabindex'));
      return;
    }
    element.querySelectorAll<HTMLElement>('[data-macro-label]').forEach((label) => {
      if (label.scrollHeight > label.clientHeight + 1 || label.scrollWidth > label.clientWidth + 1) {
        label.tabIndex = 0;
      } else {
        label.removeAttribute('tabindex');
      }
    });
    if (fitted) return;
    element.scrollTop = 0;
    const bottom = element.getBoundingClientRect().bottom - parseFloat(getComputedStyle(element).paddingBottom) - element.clientTop;
    const items = Array.from(element.querySelectorAll<HTMLElement>('[data-macro-event]'));
    const overflow = items.findIndex((item) => item.getBoundingClientRect().bottom > bottom + 1);
    setFit({source: displayedSequence, start: previewStart, ...viewport,
      count: Math.max(1, overflow === -1 ? items.length : overflow)});
  }, [displayedSequence, previewStart, viewport, isRecording, fitted]);

  const changePage = useCallback((direction: number, origin: 'wheel' | 'keyboard' | 'button' = 'button') => {
    if (direction < 0 ? !hasPrevious : !hasNext) return false;
    const element = macroSequenceRef.current;
    const active = document.activeElement;
    pageButtonFocus.current = origin === 'button' && active?.tagName === 'BUTTON'
      ? active as HTMLButtonElement : null;
    setPageStarts((starts) => direction < 0 ? starts.slice(0, -1) : [...starts, previewStart + visibleCount]);
    if (element) {
      element.scrollTop = 0;
      // Wheel gestures preserve outside focus. A child on the outgoing page
      // needs a stable destination before React replaces it.
      if (origin === 'keyboard' || (active && active !== element && element.contains(active))) {
        element.focus({preventScroll: true});
      }
    }
    return true;
  }, [hasPrevious, hasNext, previewStart, visibleCount]);

  useLayoutEffect(() => {
    if (!fitted && viewport.height) return;
    const button = pageButtonFocus.current;
    pageButtonFocus.current = null;
    if (button?.disabled && (document.activeElement === button || document.activeElement === document.body)) {
      macroSequenceRef.current?.focus({preventScroll: true});
    }
  }, [fitted, viewport.height, hasPrevious, hasNext]);

  useEffect(() => {
    const element = macroSequenceRef.current;
    if (!element || isRecording) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || !event.deltaY) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const direction = Math.sign(event.deltaY);
      // Inner text/chord scrolling and the viewport itself take precedence.
      for (let node: HTMLElement | null = target; node; node = node.parentElement) {
        if (node.scrollHeight > node.clientHeight + 1 &&
          /auto|scroll/.test(getComputedStyle(node).overflowY) &&
          (direction > 0 ? node.scrollTop + node.clientHeight < node.scrollHeight - 1 : node.scrollTop > 1)) return;
        if (node === element) break;
      }
      if (direction < 0 ? !hasPrevious : !hasNext) return;
      event.preventDefault();
      const now = performance.now();
      const gesture = wheelGesture.current;
      if (now - gesture.lastPage < 250) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      gesture.accumulated = Math.sign(gesture.accumulated) === direction ? gesture.accumulated + delta : delta;
      if (Math.abs(gesture.accumulated) >= 40 && changePage(direction, 'wheel')) {
        gesture.accumulated = 0;
        gesture.lastPage = now;
      }
    };
    element.addEventListener('wheel', onWheel, {passive: false});
    return () => element.removeEventListener('wheel', onWheel);
  }, [isRecording, hasPrevious, hasNext, changePage]);

  const onPageKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isRecording || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey ||
      (event.target as HTMLElement).closest('input, textarea, select, button, [contenteditable="true"]')) return;
    const direction = ['ArrowRight', 'ArrowDown', 'PageDown'].includes(event.key) ? 1
      : ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key) ? -1 : 0;
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    for (let node: HTMLElement | null = event.target as HTMLElement; direction && node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const length = horizontal ? node.scrollWidth : node.scrollHeight;
      const visible = horizontal ? node.clientWidth : node.clientHeight;
      const position = horizontal ? node.scrollLeft : node.scrollTop;
      if (length > visible + 1 && /auto|scroll/.test(horizontal ? style.overflowX : style.overflowY) &&
        (direction > 0 ? position + visible < length - 1 : position > 1)) return;
      if (node === macroSequenceRef.current) break;
    }
    if (direction && changePage(direction, 'keyboard')) event.preventDefault();
  };
  const shortenedPreview = isRecording && (totalItems > displayedSequence.length ||
    displayedSequence.some(([action, value]) =>
      action === RawKeycodeSequenceAction.CharacterStream &&
      String(value).length > RECORDING_PREVIEW_CHARACTERS,
    ));
  const sequence = useMemo(() => {
    const itemsLocked = isRecording || !canEditItems;
    return componentJoin(
      displayedSequence.slice(previewStart, previewStart + visibleCount).map(([action, actionArg], offset) => {
        const id = previewStart + offset;
        const text = String(actionArg);
        const shownText = isRecording && text.length > RECORDING_PREVIEW_CHARACTERS
          ? `…${text.slice(-RECORDING_PREVIEW_CHARACTERS)}`
          : text;
        const Label = getSequenceItemComponent(action);
        return (
          <Deletable
            key={`${id}-${action}`}
            index={id}
            deleteItem={deleteSequenceItem}
            disabled={itemsLocked}
          >
            {RawKeycodeSequenceAction.Delay !== action ? (
              <Label data-macro-label="">
                {action === RawKeycodeSequenceAction.CharacterStream
                  ? shownText.replace(/ /g, '␣')
                  : Array.isArray(actionArg)
                  ? actionArg
                      .map((k) => getSequenceLabel(KeycodeMap[k]) || k)
                      .join(' + ')
                  : getSequenceLabel(KeycodeMap[actionArg]) || actionArg}
              </Label>
            ) : isRecording ? (
              <KeycodeSequenceWait>{Number(actionArg)} ms</KeycodeSequenceWait>
            ) : (
              <WaitInput
                index={id}
                value={Number(actionArg)}
                updateValue={editSequenceItem}
                disabled={itemsLocked}
              />
            )}
          </Deletable>
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
        style={{'--macro-item-max-height': `${Math.max(60, viewport.height - 90)}px`} as React.CSSProperties}
        tabIndex={0} aria-label={t('Macros')} onKeyDown={onPageKeyDown}>
        {shortenedPreview ? (
          <RecordingPreviewNote>
            {t('Showing recent inputs while recording')}
          </RecordingPreviewNote>
        ) : null}
        {sequence.length ? (
          sequence
        ) : (
          <NoMacroRecorded>{t('No macro recorded yet...')}</NoMacroRecorded>
        )}
      </MacroSequenceContainer>
      <div
        style={{
          border: 'none',
          maxWidth: 960,
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
          marginTop: -21,
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
      {!isRecording ? (
        <PageControls style={{visibility: hasPrevious || hasNext ? 'visible' : 'hidden'}}>
          <button type="button" aria-label={t('Previous macro events')} disabled={!hasPrevious}
            onClick={() => changePage(-1)}>←</button>
          <span>{previewStart + 1}–{Math.min(displayedSequence.length, previewStart + visibleCount)} / {displayedSequence.length}</span>
          <button type="button" aria-label={t('Next macro events')} disabled={!hasNext}
            onClick={() => changePage(1)}>→</button>
        </PageControls>
      ) : null}
    </>
  );
};
