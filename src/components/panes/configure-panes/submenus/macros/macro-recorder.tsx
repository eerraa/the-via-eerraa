import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
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
  color: var(--color_label);
  button {
    font: inherit;
    color: inherit;
    background: var(--bg_control);
    border: 1px solid var(--border_color_cell);
    border-radius: 5px;
    padding: 4px 10px;
    cursor: pointer;
    &:disabled { opacity: 0.4; cursor: default; }
  }
`;

const MacroSequenceContainer = styled.div<{$isModified: boolean}>`
  max-width: 960px;
  width: 100%;
  display: block;
  border: 1px solid var(--border_color_cell);
  border-style: ${(props) => (props.$isModified ? 'dashed' : 'solid')};
  padding: 30px 20px;
  border-radius: 15px;
  margin-top: 10px;
  box-sizing: border-box;
}
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
  const [page, setPage] = useState(0);
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

  // The complete input is flushed on Stop, slot changes and unmount. Preview
  // updates publish only a byte count, not a full draft to parse and encode again.
  useEffect(() => {
    if (isRecording) onRecordingPreview?.(byteCount);
  }, [isRecording, byteCount, onRecordingPreview]);

  useEffect(() => setPage(0), [macroIndex, isRecording]);
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

  const pageCount = Math.max(1, Math.ceil(displayedSequence.length / MACRO_PREVIEW_ITEMS));
  const currentPage = Math.min(page, pageCount - 1);
  const previewStart = isRecording ? 0 : currentPage * MACRO_PREVIEW_ITEMS;
  const shortenedPreview = isRecording && (totalItems > displayedSequence.length ||
    displayedSequence.some(([action, value]) =>
      action === RawKeycodeSequenceAction.CharacterStream &&
      String(value).length > RECORDING_PREVIEW_CHARACTERS,
    ));
  const sequence = useMemo(() => {
    const itemsLocked = isRecording || !canEditItems;
    return componentJoin(
      displayedSequence.slice(previewStart, previewStart + MACRO_PREVIEW_ITEMS).map(([action, actionArg], offset) => {
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
              <Label>
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
      <MacroSequenceContainer ref={macroSequenceRef} $isModified={isModified || isRecording}>
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
      {!isRecording && pageCount > 1 ? (
        <PageControls>
          <button type="button" aria-label={t('Previous macro events')} disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}>←</button>
          <span>{previewStart + 1}–{Math.min(displayedSequence.length, previewStart + MACRO_PREVIEW_ITEMS)} / {displayedSequence.length}</span>
          <button type="button" aria-label={t('Next macro events')} disabled={currentPage === pageCount - 1}
            onClick={() => setPage(currentPage + 1)}>→</button>
        </PageControls>
      ) : null}
    </>
  );
};
