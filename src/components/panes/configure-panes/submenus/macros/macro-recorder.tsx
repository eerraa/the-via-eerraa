import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  OptimizedKeycodeSequence,
  OptimizedKeycodeSequenceItem,
  RawKeycodeSequence,
  RawKeycodeSequenceAction,
} from 'src/utils/macro-api/types';
import {useKeycodeRecorder} from 'src/utils/use-keycode-recorder';
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

const RECORDING_PREVIEW_ITEMS = 80;
const RECORDING_PREVIEW_CHARACTERS = 160;
const RecordingPreviewNote = styled.div`
  color: var(--color_label);
  font-size: 12px;
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
  isDelaySupported: boolean;
}> = ({
  macroIndex,
  selectedMacro,
  draft,
  editMacro,
  isModified,
  canEditItems,
  onRecordingChange,
  isDelaySupported,
}) => {
  const {t} = useTranslation();
  // The slot a recording goes to, even once another is shown.
  const [recordingIndex, setRecordingIndex] = useState<number | null>(null);
  const isRecording = recordingIndex !== null;
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
  } = useKeycodeRecorder(
    isRecording,
    recordDelaysEnabled && isDelaySupported,
  );
  const macroSequenceRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const recording = useRef(isRecording);
  recording.current = isRecording;
  const finalDraft = useRef({recordingIndex, editMacro, smartOptimizeEnabled});
  finalDraft.current = {recordingIndex, editMacro, smartOptimizeEnabled};
  const shownIndex = useRef(macroIndex);
  shownIndex.current = macroIndex;

  const recordedSequence = useMemo(
    () =>
      smartOptimizeEnabled
        ? optimizeKeycodeSequence(keycodeSequence)
        : keycodeSequence,
    [keycodeSequence, smartOptimizeEnabled],
  );

  const displayedSequence: OptimizedKeycodeSequence = useMemo(
    () =>
      recordingIndex === macroIndex
        ? recordedSequence
        : draft !== undefined
        ? expressionToSequence(draft)
        : selectedMacro ?? [],
    [draft, macroIndex, recordedSequence, recordingIndex, selectedMacro],
  );

  // A recording is its slot's draft as it comes in, so however the recorder is left
  // what was recorded stays.
  useEffect(() => {
    if (recordingIndex !== null) {
      editMacro(sequenceToExpression(recordedSequence), recordingIndex);
    }
  }, [editMacro, recordedSequence, recordingIndex]);

  useEffect(() => {
    onRecordingChange(isRecording);
  }, [isRecording]);

  const startRecording = useCallback(async () => {
    const index = macroIndex;
    // The keyboard is only locked in fullscreen, so one press asks for both and
    // records only once it has them.
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      await navigator.keyboard.lock();
    } catch {
      return;
    }
    if (!mounted.current || shownIndex.current !== index) {
      navigator.keyboard.unlock();
      return;
    }
    resetRecording();
    setIsFullscreen(!!document.fullscreenElement);
    setRecordingIndex(index);
  }, [macroIndex, resetRecording]);

  const stopRecording = useCallback(
    (exitedFullscreen = false) => {
      if (recordingIndex === null) {
        return;
      }
      navigator.keyboard.unlock();
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

  const previewStart = isRecording
    ? Math.max(0, displayedSequence.length - RECORDING_PREVIEW_ITEMS)
    : 0;
  const shortenedPreview = isRecording && (previewStart > 0 ||
    displayedSequence.some(([action, value]) =>
      action === RawKeycodeSequenceAction.CharacterStream &&
      String(value).length > RECORDING_PREVIEW_CHARACTERS,
    ));
  const sequence = useMemo(() => {
    const itemsLocked = isRecording || !canEditItems;
    return componentJoin(
      displayedSequence.slice(previewStart).map(([action, actionArg], offset) => {
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
                  ? componentJoin(
                      shownText
                        .split(' ')
                        .map((a, i) => <span key={i}>{a}</span>),
                      <span
                        style={{
                          fontFamily: 'fantasy, cursive, monospace',
                        }}
                      >
                        ␣
                      </span>,
                    )
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
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.documentElement.addEventListener(
      'fullscreenchange',
      onFullScreenChanged,
    );
    return () => {
      mounted.current = false;
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
        navigator.keyboard.unlock();
        onRecordingChange(false);
      }
      document.documentElement.removeEventListener(
        'fullscreenchange',
        onFullScreenChanged,
      );
    };
  }, [setIsFullscreen, readRecording]);

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
      <MacroSequenceContainer ref={macroSequenceRef} $isModified={isModified}>
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
    </>
  );
};
