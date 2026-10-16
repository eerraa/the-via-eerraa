import type {KeyboardAPI} from '../keyboard-api';
import {
  IMacroAPI,
  KeyAction,
  MacroTerminator,
  findMacroExpressionProblem,
  countRawSequenceBytes,
} from './macro-api.common';
import {RawKeycodeSequence, RawKeycodeSequenceAction} from './types';

export class MacroAPI implements IMacroAPI {
  constructor(
    private keyboardApi: KeyboardAPI,
    private basicKeyToByte: Record<string, number>,
    private byteToKey: Record<number, string>,
  ) {}

  async readRawKeycodeSequences(): Promise<RawKeycodeSequence[]> {
    const bytes = await this.keyboardApi.getMacroBytes();
    const macroCount = await this.keyboardApi.getMacroCount();

    // If macroCount is 0, macros are disabled
    if (macroCount === 0) {
      throw Error('Macros are disabled');
    }

    return this.macroBytesToRawKeycodeSequences(bytes, macroCount);
  }

  macroBytesToRawKeycodeSequences(
    bytes: number[],
    macroCount: number,
  ): RawKeycodeSequence[] {
    let macroId = 0;
    let i = 0;
    const sequences: RawKeycodeSequence[] = [];
    let currentSequence: RawKeycodeSequence = [];

    while (i < bytes.length && macroId < macroCount) {
      let byte = bytes[i];
      switch (byte) {
        case MacroTerminator:
          sequences[macroId] = currentSequence;
          macroId++;
          currentSequence = [];
          break;
        case KeyAction.Tap:
          byte = bytes[++i];
          currentSequence.push([
            RawKeycodeSequenceAction.Tap,
            (this.byteToKey as any)[byte],
          ]);
          break;
        case KeyAction.Down:
          byte = bytes[++i];
          currentSequence.push([
            RawKeycodeSequenceAction.Down,
            (this.byteToKey as any)[byte],
          ]);
          break;
        case KeyAction.Up:
          byte = bytes[++i];
          currentSequence.push([
            RawKeycodeSequenceAction.Up,
            (this.byteToKey as any)[byte],
          ]);
          break;
        default: {
          const char = String.fromCharCode(byte);
          if (
            currentSequence.length &&
            currentSequence[currentSequence.length - 1][0] ===
              RawKeycodeSequenceAction.CharacterStream
          ) {
            currentSequence[currentSequence.length - 1] = [
              RawKeycodeSequenceAction.CharacterStream,
              (currentSequence[currentSequence.length - 1][1] as string) + char,
            ];
          } else {
            currentSequence.push([
              RawKeycodeSequenceAction.CharacterStream,
              char,
            ]);
          }
          break;
        }
      }
      i++;
    }

    return sequences;
  }

  // Before protocol 11 a macro has no waits: a {100} is not a key it knows.
  findExpressionProblem(expression: string) {
    return findMacroExpressionProblem(expression, {
      delays: false,
      keycodeToByte: (keycode) => this.basicKeyToByte[keycode],
    });
  }

  rawKeycodeSequencesToMacroBytes(sequences: RawKeycodeSequence[]): number[] {
    return sequences.flatMap((sequence) => {
      const bytes: number[] = [];
      sequence.forEach((element) => {
        switch (element[0]) {
          case RawKeycodeSequenceAction.Tap:
            bytes.push(KeyAction.Tap, this.basicKeyToByte[element[1]]);
            break;
          case RawKeycodeSequenceAction.Up:
            bytes.push(KeyAction.Up, this.basicKeyToByte[element[1]]);
            break;
          case RawKeycodeSequenceAction.Down:
            bytes.push(KeyAction.Down, this.basicKeyToByte[element[1]]);
            break;
          case RawKeycodeSequenceAction.Delay:
            // Unsupported
            break;
          case RawKeycodeSequenceAction.CharacterStream:
            for (let index = 0; index < String(element[1]).length; index++) {
              bytes.push(String(element[1]).charCodeAt(index));
            }
            break;
        }
      });

      bytes.push(MacroTerminator);
      return bytes;
    });
  }

  countRawSequenceBytes(sequence: RawKeycodeSequence) {
    return countRawSequenceBytes(sequence, false);
  }

  async writeRawKeycodeSequences(sequences: RawKeycodeSequence[]) {
    const macroBytes = this.rawKeycodeSequencesToMacroBytes(sequences);
    await this.keyboardApi.setMacroBytes(macroBytes);
  }
}
