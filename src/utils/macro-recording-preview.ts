import {
  convertCharacterTaps,
  convertToCharacterStreams,
  countRawSequenceBytes,
  splitLongDelays,
} from './macro-api/macro-api.common';
import {
  RawKeycodeSequence,
  RawKeycodeSequenceAction as Action,
  RawKeycodeSequenceItem,
} from './macro-api/types';

export const MACRO_PREVIEW_ITEMS = 80;

type PreviewState = {
  pending: RawKeycodeSequence[];
  tail: RawKeycodeSequence;
  total: number;
  bytes: number;
};

/**
 * Streaming versions of the recorder's existing transforms. Each stage retains
 * only the suffix it can still change. A preview flushes a copy of those suffixes;
 * it never scans or serializes the captured history.
 */
export const createMacroRecordingPreview = (
  smart: boolean,
  delays: boolean,
) => {
  const state: PreviewState = {
    pending: Array.from({length: 6}, () => []),
    tail: [],
    total: 0,
    bytes: 1,
  };
  const commit = (
    target: PreviewState,
    item: RawKeycodeSequenceItem,
    next?: RawKeycodeSequenceItem,
  ) => {
    target.tail.push(item);
    if (target.tail.length > MACRO_PREVIEW_ITEMS) target.tail.shift();
    target.total++;
    target.bytes += countRawSequenceBytes(splitLongDelays([item]), delays) - 1;
    // sequenceToExpression spells a text suffix before a command as KC_BSLS taps.
    if (
      item[0] === Action.CharacterStream &&
      next &&
      next[0] !== Action.CharacterStream
    ) {
      const slashes = String(item[1]).match(/\\+$/)?.[0].length ?? 0;
      target.bytes += slashes * (delays ? 2 : 1);
    }
  };
  const accept = (
    target: PreviewState,
    stage: number,
    item: RawKeycodeSequenceItem,
  ): void => {
    const pending = target.pending[stage];
    const last = pending[0];
    const emit = (value: RawKeycodeSequenceItem) =>
      accept(target, stage + 1, value);
    if (stage === 4) {
      // Shift + character stream + matching release, with at most two pending items.
      pending.push(item);
      while (pending.length) {
        const [down, text, up] = pending;
        if (
          down[0] === Action.Down &&
          (down[1] === 'KC_LSFT' || down[1] === 'KC_RSFT')
        ) {
          if (!text) return;
          if (text[0] === Action.CharacterStream) {
            if (!up) return;
            if (up[0] === Action.Up && up[1] === down[1]) {
              emit(convertToCharacterStreams(pending.splice(0, 3))[0]);
              continue;
            }
          }
        }
        emit(pending.shift()!);
      }
      return;
    }
    if (stage === 3) item = convertToCharacterStreams([item])[0];
    if (last) {
      if (stage === 1 && last[0] === Action.Delay && item[0] === Action.Delay) {
        pending[0] = [Action.Delay, Number(last[1]) + Number(item[1])];
        return;
      }
      if (
        stage === 2 &&
        last[0] === Action.Down &&
        item[0] === Action.Up &&
        last[1] === item[1]
      ) {
        pending.length = 0;
        emit([Action.Tap, item[1]]);
        return;
      }
      if (
        (stage === 3 || stage === 5) &&
        last[0] === Action.CharacterStream &&
        item[0] === Action.CharacterStream
      ) {
        pending[0] = [Action.CharacterStream, String(last[1]) + item[1]];
        return;
      }
      if (stage === 5) commit(target, last, item);
      else emit(last);
    }
    pending[0] = item;
  };
  return {
    append(item: RawKeycodeSequenceItem) {
      if (smart)
        convertCharacterTaps([item]).forEach((value) =>
          accept(state, 0, value),
        );
      else commit(state, item);
    },
    read() {
      const copy: PreviewState = {
        ...state,
        pending: state.pending.map((items) => items.slice()),
        tail: state.tail.slice(),
      };
      if (smart) {
        for (let stage = 0; stage < copy.pending.length; stage++) {
          const items = copy.pending[stage].splice(0);
          for (const item of items) {
            if (stage === 0 && item[0] === Action.Delay) continue; // trimLastWait
            if (stage === 5) commit(copy, item);
            else accept(copy, stage + 1, item);
          }
        }
      }
      return {
        sequence: copy.tail,
        totalItems: copy.total,
        byteCount: copy.bytes,
      };
    },
  };
};
