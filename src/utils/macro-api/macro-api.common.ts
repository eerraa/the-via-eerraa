import {
  GroupedKeycodeSequenceAction,
  OptimizedKeycodeSequence,
  OptimizedKeycodeSequenceItem,
  RawKeycodeSequence,
  RawKeycodeSequenceAction,
  RawKeycodeSequenceItem,
} from './types';

/** Why a macro draft cannot be written as it is. */
export type MacroExpressionProblem =
  | {type: 'untypeable'}
  | {type: 'unclosed'}
  | {type: 'empty'}
  | {type: 'unknown-keys'; keys: string[]};

export interface IMacroAPI {
  readRawKeycodeSequences(): Promise<RawKeycodeSequence[]>;
  writeRawKeycodeSequences(sequences: RawKeycodeSequence[]): void;
  rawKeycodeSequencesToMacroBytes(sequences: RawKeycodeSequence[]): number[];
  macroBytesToRawKeycodeSequences(
    bytes: number[],
    macroCount: number,
  ): RawKeycodeSequence[];
  findExpressionProblem(expression: string): MacroExpressionProblem | undefined;
}

// Corresponds to 'magic codes' in qmk sendstring
export enum KeyAction {
  Tap = 1, // \x01
  Down = 2, // \x02
  Up = 3, // \x03
  Delay = 4, // \x04
}

export const KeyActionPrefix = 1; // \x01
export const DelayTerminator = 124; // '|';
export const MacroTerminator = 0;

// Firmware that reads a wait into a fixed buffer (the H7S build) takes at most four
// digits and abandons the rest of the macro at a fifth.
export const MAX_MACRO_DELAY_MS = 9999;

// split "{KC_A}bcd{KC_E}" into "{KC_A}","bcd","{KC_E}",
// handles escaped braces e.g. "\{"
function splitExpression(expression: string): string[] {
  let regex;
  try {
    regex = eval('/(?<!\\\\)({.*?})/g');
    return expression.split(regex).filter((s) => s.length);
  } catch (e) {
    console.error('Lookbehind is not supported in this browser.');
    return [];
  }
}

export function optimizedSequenceToRawSequence(
  sequence: OptimizedKeycodeSequence,
): RawKeycodeSequence {
  return sequence.flatMap((element) => {
    if (element[0] == GroupedKeycodeSequenceAction.Chord) {
      const makeTurnToKeyAction =
        (action: RawKeycodeSequenceAction) => (keycode: string) =>
          [action, keycode] as RawKeycodeSequenceItem;
      return [...element[1]]
        .map(makeTurnToKeyAction(RawKeycodeSequenceAction.Down))
        .concat(
          [...element[1]]
            .reverse()
            .map(makeTurnToKeyAction(RawKeycodeSequenceAction.Up)),
        );
    } else {
      return [element];
    }
  });
}

export function rawSequenceToOptimizedSequence(
  sequence: RawKeycodeSequence,
): OptimizedKeycodeSequence {
  let result: OptimizedKeycodeSequence = [];
  result = convertToTapsAndChords(sequence);
  return result;
}

function convertToTapsAndChords(
  sequence: OptimizedKeycodeSequence,
): OptimizedKeycodeSequence {
  let cat: OptimizedKeycodeSequence = [];
  let keyDownKeycodes: string[] = [];
  let unmatchedKeyDownCount: number = 0;

  // Convert taps to down/up so that chord detection algorithm is simpler
  const seq: OptimizedKeycodeSequence = sequence.reduce((p, n) => {
    if (n[0] === RawKeycodeSequenceAction.Tap) {
      p.push(
        [RawKeycodeSequenceAction.Down, n[1]],
        [RawKeycodeSequenceAction.Up, n[1]],
      );
    } else {
      p.push(n);
    }
    return p;
  }, [] as OptimizedKeycodeSequenceItem[]);

  let seq2: OptimizedKeycodeSequence = [];
  seq.forEach((element, index) => {
    // This gets set true while we are iterating over
    // a possible key chord (symmetric nested key downs/key ups)
    let keepGoing = false;
    // Concatenate elements of a possible key chord, if it turns out
    // not possible, then we concatenate this to the output
    cat.push(element);

    if (element[0] === RawKeycodeSequenceAction.Down) {
      // If key down
      if (unmatchedKeyDownCount == keyDownKeycodes.length) {
        // If we have not matched key ups to key downs yet
        // Add to key downs
        keyDownKeycodes.push(element[1] as string);
        unmatchedKeyDownCount++;
        keepGoing = true;
      }
    } else if (element[0] === RawKeycodeSequenceAction.Up) {
      // If key up
      const keyUpKeycode = element[1];
      if (
        keyDownKeycodes.length > 0 &&
        keyUpKeycode === keyDownKeycodes[unmatchedKeyDownCount - 1]
      ) {
        // If it matches last key down
        unmatchedKeyDownCount--;
        if (unmatchedKeyDownCount == 0) {
          // If we have matched all the last key downs.
          // we have a valid key chord, concatenate it
          if (keyDownKeycodes.length === 1) {
            seq2.push([RawKeycodeSequenceAction.Tap, keyDownKeycodes[0]]);
          } else {
            seq2.push([GroupedKeycodeSequenceAction.Chord, keyDownKeycodes]);
          }
          // We don't want this concatenated in the default case below.
          cat = [];
        } else {
          // Still a possible key chord, keep going
          keepGoing = true;
        }
      }
    }

    if (index === seq.length - 1) {
      keepGoing = false;
    }

    if (!keepGoing) {
      seq2.push(...cat);
      cat = [];
      keyDownKeycodes = [];
      unmatchedKeyDownCount = 0;
    }
  });

  // Convert adjacent down/ups to taps
  let seq3: OptimizedKeycodeSequence = [];
  for (let index = 0; index < seq2.length; index++) {
    if (
      index + 1 < seq2.length &&
      seq2[index][0] == RawKeycodeSequenceAction.Down &&
      seq2[index + 1][0] == RawKeycodeSequenceAction.Up &&
      seq2[index][1] === seq2[index + 1][1]
    ) {
      seq3.push([RawKeycodeSequenceAction.Tap, seq2[index][1] as string]);
      index++;
    } else {
      seq3.push(seq2[index]);
    }
  }

  return seq3;
}

const mapKeycodeToCharacterStream: Record<string, string[]> = {
  KC_A: ['a', 'A'],
  KC_B: ['b', 'B'],
  KC_C: ['c', 'C'],
  KC_D: ['d', 'D'],
  KC_E: ['e', 'E'],
  KC_F: ['f', 'F'],
  KC_G: ['g', 'G'],
  KC_H: ['h', 'H'],
  KC_I: ['i', 'I'],
  KC_J: ['j', 'J'],
  KC_K: ['k', 'K'],
  KC_L: ['l', 'L'],
  KC_M: ['m', 'M'],
  KC_N: ['n', 'N'],
  KC_O: ['o', 'O'],
  KC_P: ['p', 'P'],
  KC_Q: ['q', 'Q'],
  KC_R: ['r', 'R'],
  KC_S: ['s', 'S'],
  KC_T: ['t', 'T'],
  KC_U: ['u', 'U'],
  KC_V: ['v', 'V'],
  KC_W: ['w', 'W'],
  KC_X: ['x', 'X'],
  KC_Y: ['y', 'Y'],
  KC_Z: ['z', 'Z'],
  KC_1: ['1', '!'],
  KC_2: ['2', '@'],
  KC_3: ['3', '#'],
  KC_4: ['4', '$'],
  KC_5: ['5', '%'],
  KC_6: ['6', '^'],
  KC_7: ['7', '&'],
  KC_8: ['8', '*'],
  KC_9: ['9', '('],
  KC_0: ['0', ')'],
  KC_SPC: [' ', ' '],
  KC_MINS: ['-', '_'],
  KC_EQL: ['=', '+'],
  KC_LBRC: ['[', '{'],
  KC_RBRC: [']', '}'],
  KC_BSLS: ['\\', '|'],
  KC_SCLN: [';', ':'],
  KC_QUOT: ["'", '"'],
  KC_GRV: ['`', '~'],
  KC_COMM: [',', '<'],
  KC_DOT: ['.', '>'],
  KC_SLSH: ['/', '?'],
};

const mapCharToShiftedChar = Object.values(mapKeycodeToCharacterStream).reduce(
  (p, [n, m]) => {
    return {...p, [n]: m};
  },
  {} as Record<string, string>,
);

// Convert all down actions of characters (i.e. letters, numbers, punctuation)
// into tap actions and throw away the up actions.
export function convertCharacterTaps(
  sequence: RawKeycodeSequence,
): RawKeycodeSequence {
  let result: RawKeycodeSequence = sequence.reduce((p, n) => {
    if (
      n[0] == RawKeycodeSequenceAction.Down &&
      n[1] in mapKeycodeToCharacterStream
    ) {
      p.push([RawKeycodeSequenceAction.Tap, n[1]]);
    } else if (
      n[0] == RawKeycodeSequenceAction.Up &&
      n[1] in mapKeycodeToCharacterStream
    ) {
      return p;
    } else {
      p.push(n);
    }
    return p;
  }, [] as RawKeycodeSequenceItem[]);
  return result;
}

export function trimLastWait(sequence: RawKeycodeSequence): RawKeycodeSequence {
  if (
    sequence[sequence.length - 1] &&
    sequence[sequence.length - 1][0] === RawKeycodeSequenceAction.Delay
  ) {
    return sequence.slice(0, -1);
  }
  return sequence;
}

export function mergeConsecutiveWaits(
  sequence: RawKeycodeSequence,
): RawKeycodeSequence {
  return sequence.reduce((p, n) => {
    if (
      p[p.length - 1] &&
      p[p.length - 1][0] === RawKeycodeSequenceAction.Delay &&
      n[0] === RawKeycodeSequenceAction.Delay
    ) {
      p.splice(-1, 1, [
        RawKeycodeSequenceAction.Delay,
        Number(p[p.length - 1][1]) + Number(n[1]),
      ]);
    } else {
      p.push(n);
    }
    return p;
  }, [] as RawKeycodeSequence);
}

export function foldKeydownKeyupKeys(
  sequence: RawKeycodeSequence,
): RawKeycodeSequence {
  return sequence.reduce((p, n) => {
    if (
      p[p.length - 1] &&
      p[p.length - 1][0] === RawKeycodeSequenceAction.Down &&
      n[0] === RawKeycodeSequenceAction.Up &&
      p[p.length - 1][1] === n[1]
    ) {
      p.splice(-1, 1, [RawKeycodeSequenceAction.Tap, n[1]]);
    } else {
      p.push(n);
    }
    return p;
  }, [] as RawKeycodeSequence);
}

export function convertToCharacterStreams(
  sequence: RawKeycodeSequence,
): RawKeycodeSequence {
  // Convert "{KC_A}{KC_B}{KC_C}" to "abc"
  // Convert "{KC_LSFT,KC_A}" to "A"
  let seq: RawKeycodeSequence = sequence.reduce((p, n) => {
    if (
      n[0] == RawKeycodeSequenceAction.Tap &&
      n[1] in mapKeycodeToCharacterStream
    ) {
      const newChars = mapKeycodeToCharacterStream[n[1]][0];
      if (
        p[p.length - 1] !== undefined &&
        p[p.length - 1][0] === RawKeycodeSequenceAction.CharacterStream
      ) {
        // append case
        p[p.length - 1] = [
          RawKeycodeSequenceAction.CharacterStream,
          (p[p.length - 1][1] as string) + newChars,
        ];
      } else {
        p.push([RawKeycodeSequenceAction.CharacterStream, newChars]);
      }
    } else {
      p.push(n);
    }
    return p;
  }, [] as RawKeycodeSequenceItem[]);

  // convert "{+KC_LSFT}abc{-KC_LSFT}" into "ABC"
  let seq2: RawKeycodeSequence = [];
  for (let index = 0; index < seq.length; index++) {
    if (
      index + 2 < seq.length &&
      seq[index][0] === RawKeycodeSequenceAction.Down &&
      seq[index + 1][0] === RawKeycodeSequenceAction.CharacterStream &&
      seq[index + 2][0] === RawKeycodeSequenceAction.Up &&
      seq[index][1] === seq[index + 2][1] &&
      (seq[index][1] === 'KC_LSFT' || seq[index][1] === 'KC_RSFT')
    ) {
      const newChars = (seq[index + 1][1] as string)
        .split('')
        .map((char) => mapCharToShiftedChar[char])
        .join('');
      seq2.push([RawKeycodeSequenceAction.CharacterStream, newChars]);
      index += 2;
    } else {
      seq2.push(seq[index]);
    }
  }

  // concatenate adjacent character streams
  const seq3: RawKeycodeSequence = seq2.reduce((p, n) => {
    if (
      n[0] === RawKeycodeSequenceAction.CharacterStream &&
      p[p.length - 1] !== undefined &&
      p[p.length - 1][0] === RawKeycodeSequenceAction.CharacterStream
    ) {
      p[p.length - 1] = [
        RawKeycodeSequenceAction.CharacterStream,
        (p[p.length - 1][1] as string).concat(n[1] as string),
      ];
      return p;
    }
    p.push(n);
    return p;
  }, [] as RawKeycodeSequenceItem[]);

  return seq3;
}

export function sequenceToExpression(
  sequence: OptimizedKeycodeSequence,
): string {
  let result: string[] = [];
  sequence.forEach((element) => {
    switch (element[0]) {
      case RawKeycodeSequenceAction.Tap:
        result.push('{' + element[1] + '}');
        break;
      case RawKeycodeSequenceAction.Down:
        result.push('{+' + element[1] + '}');
        break;
      case RawKeycodeSequenceAction.Up:
        result.push('{-' + element[1] + '}');
        break;
      case RawKeycodeSequenceAction.Delay:
        result.push('{' + element[1] + '}');
        break;
      case GroupedKeycodeSequenceAction.Chord:
        result.push('{' + element[1].join(',') + '}');
        break;
      case RawKeycodeSequenceAction.CharacterStream:
        // Insert escape character \ before {
        result.push((element[1] as string).replace(/{/g, '\\{'));
    }
  });
  return result.join('');
}

export function expressionToSequence(str: string): OptimizedKeycodeSequence {
  let expression: string[] = splitExpression(str);
  let result: OptimizedKeycodeSequence = [];

  expression.forEach((element) => {
    if (/^{.*}$/.test(element)) {
      // If it's a tag with braces
      element = element.slice(1, -1);
      if (/^\d+$/.test(element)) {
        result.push([RawKeycodeSequenceAction.Delay, parseInt(element)]);
      } else {
        // Otherwise handle as a keycode block
        // Test if there's a + or - after the {
        const downOrUpAction = /^[+-]/.test(element)
          ? element.slice(0, 1)
          : null;
        const keycodes = element
          .replace(/^[+-]/, '')
          .split(',')
          .map((keycode) => keycode.trim().toUpperCase())
          .filter((keycode) => keycode.length);
        if (keycodes.length > 0) {
          if (downOrUpAction == null) {
            if (keycodes.length == 1) {
              result.push([RawKeycodeSequenceAction.Tap, keycodes[0]]);
            } else {
              result.push([GroupedKeycodeSequenceAction.Chord, keycodes]);
            }
          } else {
            const action: RawKeycodeSequenceAction =
              downOrUpAction == '+'
                ? RawKeycodeSequenceAction.Down
                : RawKeycodeSequenceAction.Up;
            result.push([action, keycodes[0]]);
          }
        }
      }
    } else {
      // It's a character sequence
      // Remove escape character \ before {
      element = element.replace(/\\{/g, '{');
      result.push([RawKeycodeSequenceAction.CharacterStream, element]);
    }
  });

  return result;
}

// Each wait costs seven bytes, so this many already overflow the largest buffer a
// 16-bit size can describe: a longer wait stops here and is refused as too large
// instead of being expanded without end.
const MAX_SPLIT_DELAYS = Math.ceil(0xffff / 7) + 1;

/** Writes a wait longer than the firmware reads as several waits in a row. */
export function splitLongDelays(
  sequence: RawKeycodeSequence,
): RawKeycodeSequence {
  return sequence.flatMap((item): RawKeycodeSequence => {
    if (item[0] !== RawKeycodeSequenceAction.Delay) {
      return [item];
    }
    const delays: RawKeycodeSequence = [];
    let remaining = Number(item[1]);
    while (remaining > MAX_MACRO_DELAY_MS && delays.length < MAX_SPLIT_DELAYS) {
      delays.push([RawKeycodeSequenceAction.Delay, MAX_MACRO_DELAY_MS]);
      remaining -= MAX_MACRO_DELAY_MS;
    }
    if (delays.length < MAX_SPLIT_DELAYS) {
      delays.push([RawKeycodeSequenceAction.Delay, remaining]);
    }
    return delays;
  });
}

/** The raw sequence an expression is written as. Every macro save goes through it. */
export const expressionToRawSequence = (
  expression: string,
): RawKeycodeSequence =>
  splitLongDelays(
    optimizedSequenceToRawSequence(expressionToSequence(expression)),
  );

// send_string types a character through a 128-entry ASCII table, so anything above
// reads past it, and control bytes collide with the macro's own markers.
export const isTypeableMacroCharacter = (character: string) =>
  character === '\n' ||
  character === '\t' ||
  (character >= ' ' && character <= '~');

// The blocks expressionToSequence() cuts out: an unescaped "{" up to the first "}"
// on its line. A block is unclosed when another "{", or the end, comes first.
const scanKeycodeBlocks = (expression: string) => {
  const blocks: string[] = [];
  for (let index = 0; index < expression.length; index++) {
    if (expression[index] !== '{' || expression[index - 1] === '\\') {
      continue;
    }
    const close = expression.indexOf('}', index + 1);
    const reopen = expression.indexOf('{', index + 1);
    if (close === -1 || (reopen !== -1 && reopen < close)) {
      return {blocks, unclosed: true};
    }
    const block = expression.slice(index + 1, close);
    if (!block.includes('\n')) {
      blocks.push(block);
      index = close;
    }
  }
  return {blocks, unclosed: false};
};

/**
 * What stops the keyboard from playing an expression as written, the same check for
 * a typed script and a recording. A wait of any length is fine: it is split when
 * written.
 */
export function findMacroExpressionProblem(
  expression: string,
  {
    delays,
    keycodeToByte,
  }: {delays: boolean; keycodeToByte: (keycode: string) => number | undefined},
): MacroExpressionProblem | undefined {
  for (const character of expression) {
    if (!isTypeableMacroCharacter(character)) {
      return {type: 'untypeable'};
    }
  }
  const {blocks, unclosed} = scanKeycodeBlocks(expression);
  if (unclosed) {
    return {type: 'unclosed'};
  }
  if (blocks.some((block) => !block.trim().length)) {
    return {type: 'empty'};
  }
  const unknown = new Set<string>();
  const checkKeycode = (keycode: string) => {
    const byte = keycodeToByte(keycode);
    // A macro holds a key as one byte, and a zero byte would end the macro there.
    // The autocomplete list is not the test: the keyboard reads 0x9C back as KC_CLR,
    // a name it leaves out. The table's _QK_ entries are ranges and masks, not keys.
    if (keycode.startsWith('_') || !byte || byte > 0xff) {
      unknown.add(keycode);
    }
  };
  expressionToSequence(expression).forEach(([action, argument]) => {
    if (action === GroupedKeycodeSequenceAction.Chord) {
      (argument as string[]).forEach(checkKeycode);
    } else if (action === RawKeycodeSequenceAction.Delay) {
      if (!delays) {
        unknown.add(String(argument));
      }
    } else if (action !== RawKeycodeSequenceAction.CharacterStream) {
      checkKeycode(argument as string);
    }
  });
  return unknown.size ? {type: 'unknown-keys', keys: [...unknown]} : undefined;
}

export type MacroDraft = {
  problem?: MacroExpressionProblem;
  /** Buffer bytes the macro takes, its end marker included. */
  byteCount: number;
  /** The expression the keyboard will hold, in the form the editor reads back. */
  stored: string;
};

export const countMacroBytes = (macroApi: IMacroAPI, expression: string) =>
  macroApi.rawKeycodeSequencesToMacroBytes([
    expressionToRawSequence(expression),
  ]).length;

export function checkMacroDraft(
  macroApi: IMacroAPI,
  expression: string,
): MacroDraft {
  const problem = macroApi.findExpressionProblem(expression);
  const bytes = macroApi.rawKeycodeSequencesToMacroBytes([
    expressionToRawSequence(expression),
  ]);
  // Only a draft a keyboard could hold is read back: the bytes of an invalid one are
  // not a macro the reader knows, and one larger than any buffer only costs time.
  if (problem || bytes.length > 0xffff) {
    return {problem, byteCount: bytes.length, stored: expression};
  }
  const [stored = []] = macroApi.macroBytesToRawKeycodeSequences(bytes, 1);
  return {
    byteCount: bytes.length,
    stored: sequenceToExpression(rawSequenceToOptimizedSequence(stored)),
  };
}
