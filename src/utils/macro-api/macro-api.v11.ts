import type {KeyboardAPI} from '../keyboard-api';
import {
  DelayTerminator,
  KeyActionPrefix,
  MacroTerminator,
  KeyAction,
  IMacroAPI,
  findMacroExpressionProblem,
} from './macro-api.common';
import {RawKeycodeSequence, RawKeycodeSequenceAction} from './types';

export class MacroAPIV11 implements IMacroAPI {
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
        case KeyActionPrefix:
          byte = bytes[++i];
          switch (byte) {
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
            case KeyAction.Delay:
              let delayBytes = [];
              byte = bytes[++i];
              while (byte !== DelayTerminator && i < bytes.length) {
                delayBytes.push(byte);
                byte = bytes[++i];
              }
              const delayValue = delayBytes.reduce((acc, byte) => {
                acc += String.fromCharCode(byte);
                return acc;
              }, '');
              currentSequence.push([
                RawKeycodeSequenceAction.Delay,
                parseInt(delayValue),
              ]);
              break;
            default:
              throw `Expected a KeyAction to follow the KeyActionPrefix. Received ${byte} instead.`;
          }
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
  findExpressionProblem(expression: string) {
    return findMacroExpressionProblem(expression, {
      delays: true,
      keycodeToByte: (keycode) => this.basicKeyToByte[keycode],
    });
  }
  rawKeycodeSequencesToMacroBytes(sequences: RawKeycodeSequence[]) {
    return sequences.flatMap((sequence) => {
      const bytes: number[] = [];
      sequence.forEach((element) => {
        switch (element[0]) {
          case RawKeycodeSequenceAction.Tap:
            bytes.push(
              KeyActionPrefix,
              KeyAction.Tap,
              this.basicKeyToByte[element[1]],
            );
            break;
          case RawKeycodeSequenceAction.Down:
            bytes.push(
              KeyActionPrefix,
              KeyAction.Down,
              this.basicKeyToByte[element[1]],
            );
            break;
          case RawKeycodeSequenceAction.Up:
            bytes.push(
              KeyActionPrefix,
              KeyAction.Up,
              this.basicKeyToByte[element[1]],
            );
            break;
          case RawKeycodeSequenceAction.Delay:
            let delay: string = `${element[1] as number}`;
            bytes.push(
              KeyActionPrefix,
              KeyAction.Delay,
              ...delay.split('').map((char) => char.charCodeAt(0)),
              DelayTerminator,
            );
            break;
          case RawKeycodeSequenceAction.CharacterStream:
            bytes.push(
              ...(element[1] as string)
                .split('')
                .map((char) => char.charCodeAt(0)),
            );
            break;
        }
      });

      bytes.push(MacroTerminator);
      return bytes;
    });
  }
  async writeRawKeycodeSequences(sequences: RawKeycodeSequence[]) {
    const macroBytes = this.rawKeycodeSequencesToMacroBytes(sequences);
    await this.keyboardApi.setMacroBytes(macroBytes);
  }
}
