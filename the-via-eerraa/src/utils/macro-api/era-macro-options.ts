import {ERA_WIRE} from '../era-wire.generated';
import type {ExactMsFamily} from '../era-advanced-metadata';

// Per-macro playback options on the ERA MACRO_OPTIONS channel. Wire numbers,
// payloads and refusals are owned by config/era-wire.json; the product rules are
// docs/PROJECT_DIRECTION.md "Macro playback options".

const FLAG = ERA_WIRE.MACRO_OPTIONS_FLAGS;
const ID = ERA_WIRE.MACRO_OPTIONS;
const MARKER = ERA_WIRE.MACRO_OPTIONS_MARKER;

/** One macro's options: the FLAGS byte, the hold time in ms and REPEAT_COUNT. */
export type MacroOptionValues = {flags: number; holdMs: number; repeatCount: number};
export type MacroOptionsState =
  | {kind: 'unsupported'}
  | {kind: 'read'; supported: number; options: MacroOptionValues[]}
  | {kind: 'failed'; reason: string};

export const MACRO_OPTIONS_HOLD_MS = {min: 1, max: 65535};
/** REPEAT_COUNT: 1 plays once, 2..255 that many times, 0 until a stop condition. */
export const MACRO_OPTIONS_REPEAT = {once: 1, untilStopped: 0, min: 2, max: 255};
export const MACRO_OPTIONS_DEFAULTS: MacroOptionValues = {
  flags: 0,
  holdMs: 1000,
  repeatCount: MACRO_OPTIONS_REPEAT.once,
};
export const MACRO_OPTIONS_STOPS = FLAG.RELEASE | FLAG.RETAP | FLAG.HOLD | FLAG.OTHER;

/** Where an options SET waits for its SAVE, among the Custom Menu save retries. */
export const MACRO_OPTIONS_SAVE_RETRY = '__macroOptions';

/**
 * Until stopped with no stop condition could end only by a cancel: firmware plays
 * it once and the app never writes it.
 */
export const isUntilStoppedWithoutStop = ({flags, repeatCount}: Pick<MacroOptionValues, 'flags' | 'repeatCount'>) =>
  repeatCount === MACRO_OPTIONS_REPEAT.untilStopped && (flags & MACRO_OPTIONS_STOPS) === 0;

/** Flags this firmware supports. */
export const fitsMacroOptionFlags = (supported: number, flags: unknown): flags is number =>
  Number.isInteger(flags) && (flags as number) >= 0 && (flags as number) <= 0xff &&
  ((flags as number) & ~supported) === 0;

export const fitsMacroOptionHold = (holdMs: unknown): holdMs is number =>
  Number.isInteger(holdMs) &&
  (holdMs as number) >= MACRO_OPTIONS_HOLD_MS.min &&
  (holdMs as number) <= MACRO_OPTIONS_HOLD_MS.max;

export const fitsMacroOptionRepeatCount = (repeatCount: unknown): repeatCount is number =>
  Number.isInteger(repeatCount) && (repeatCount as number) >= 0 && (repeatCount as number) <= 0xff;

/** The MACRO_OPTIONS channel of an ERA firmware family; null for every other keyboard. */
export const macroOptionsChannel = (family: ExactMsFamily | null) =>
  family === 'qmk'
    ? ERA_WIRE.CHANNELS_EERRAA.MACRO_OPTIONS
    : family === 'h7s'
      ? ERA_WIRE.CHANNELS_H7S.MACRO_OPTIONS
      : null;

/** A reply that is neither id_unhandled nor the registry's layout: no proof of support either way. */
export class MacroOptionsReplyError extends Error {}

type Transport = {
  /** CAPABILITIES GET: null on an exact id_unhandled, else the bytes from the value id on. */
  probe: (bytes: number[]) => Promise<number[] | null>;
  /** A GET: the bytes after the request's own. */
  get: (bytes: number[]) => Promise<number[]>;
};

const parseCapabilities = (cap: number[]) => {
  if (
    cap[0] !== ID.CAPABILITIES ||
    cap[3] !== MARKER.BYTE_0 || cap[4] !== MARKER.BYTE_1 ||
    cap[5] !== MARKER.BYTE_2 || cap[6] !== MARKER.BYTE_3 ||
    (cap[2] & FLAG.RESERVED_MASK) !== 0
  ) {
    throw new MacroOptionsReplyError('Invalid ERA macro options capability');
  }
  return cap[2];
};

export async function readMacroOptions(
  transport: Transport,
  channel: number,
  macroCount: number,
): Promise<MacroOptionsState> {
  const cap = await transport.probe([channel, ID.CAPABILITIES]);
  if (cap === null) return {kind: 'unsupported'};
  // Only the current version is spoken; any other (version 1 was never released)
  // gets no options at all.
  if (cap[0] === ID.CAPABILITIES && cap[1] !== ERA_WIRE.MACRO_OPTIONS_VERSION.CURRENT) {
    return {kind: 'unsupported'};
  }
  const supported = parseCapabilities(cap);
  const options: MacroOptionValues[] = [];
  for (let index = 0; index < macroCount; index++) {
    const [flags] = await transport.get([channel, ID.FLAGS, index]);
    const [hi, lo] = await transport.get([channel, ID.HOLD_MS, index]);
    const [repeatCount] = await transport.get([channel, ID.REPEAT_COUNT, index]);
    const holdMs = (hi << 8) | lo;
    if ((flags & FLAG.RESERVED_MASK) !== 0 || holdMs < MACRO_OPTIONS_HOLD_MS.min) {
      throw new MacroOptionsReplyError(`Invalid ERA macro ${index} options`);
    }
    options.push({flags, holdMs, repeatCount});
  }
  return {kind: 'read', supported, options};
}

/** The Custom Value SETs that write one macro's options. */
export const macroOptionsWrites = (
  channel: number,
  index: number,
  {flags, holdMs, repeatCount}: Partial<MacroOptionValues>,
): number[][] => [
  ...(flags === undefined ? [] : [[channel, ID.FLAGS, index, flags]]),
  ...(holdMs === undefined ? [] : [[channel, ID.HOLD_MS, index, holdMs >>> 8, holdMs & 0xff]]),
  ...(repeatCount === undefined ? [] : [[channel, ID.REPEAT_COUNT, index, repeatCount]]),
];

/**
 * Writes one macro's options SET by SET so the keyboard never holds until stopped
 * with no stop condition, not even between them: to repeat until stopped FLAGS
 * goes before REPEAT_COUNT, any other count before FLAGS. The first SET the
 * keyboard refuses ends that macro's writes, since going on in either order could
 * reach that pair. `set` answers false for a refusal; `took` hears each value the
 * keyboard took. True when every SET was taken.
 */
export async function writeMacroOptions(
  set: (bytes: number[]) => Promise<boolean>,
  channel: number,
  index: number,
  values: Partial<MacroOptionValues>,
  took: (value: Partial<MacroOptionValues>) => void,
): Promise<boolean> {
  const order =
    values.repeatCount === MACRO_OPTIONS_REPEAT.untilStopped
      ? (['flags', 'holdMs', 'repeatCount'] as const)
      : (['repeatCount', 'flags', 'holdMs'] as const);
  for (const field of order) {
    const value = values[field];
    if (value === undefined) continue;
    const [bytes] = macroOptionsWrites(channel, index, {[field]: value});
    if (!(await set(bytes))) return false;
    took({[field]: value});
  }
  return true;
}
