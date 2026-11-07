import {describe, expect, test} from 'bun:test';
import {ERA_WIRE as W} from '../src/utils/era-wire.generated';
import {
  MacroOptionsReplyError,
  macroOptionsWrites,
  readMacroOptions,
} from '../src/utils/macro-api/era-macro-options';
import {planLayoutImport, saveMacroOptions} from '../src/utils/layout-import';

const F = W.MACRO_OPTIONS_FLAGS;
const ALL = F.RETAP | F.HOLD | F.RELEASE | F.OTHER | F.IGNORE_MODS | F.BLOCK_OTHERS;
const capability = (mask = ALL, version = 2) =>
  [W.MACRO_OPTIONS.CAPABILITIES, version, mask, 0x45, 0x4d, 0x4f, 0x31];

const transport = (
  cap: number[] | null,
  options = [{flags: F.RETAP, holdMs: 1000, repeatCount: 1}],
) => {
  const requests: number[][] = [];
  return {
    requests,
    probe: async (bytes: number[]) => {
      requests.push(bytes);
      return cap;
    },
    get: async ([, id, index]: number[]) => {
      requests.push([id, index]);
      const {flags, holdMs, repeatCount} = options[index];
      return id === W.MACRO_OPTIONS.FLAGS
        ? [flags]
        : id === W.MACRO_OPTIONS.REPEAT_COUNT
          ? [repeatCount]
          : [holdMs >>> 8, holdMs & 0xff];
    },
  };
};

describe('ERA macro options capability', () => {
  test('an exact id_unhandled is unsupported, and nothing more is asked', async () => {
    const wire = transport(null);
    expect(await readMacroOptions(wire, 0x11, 1)).toEqual({kind: 'unsupported'});
    expect(wire.requests).toEqual([[0x11, W.MACRO_OPTIONS.CAPABILITIES]]);
  });

  test('only version 2 is spoken: any other version is unsupported, and nothing more is asked', async () => {
    for (const version of [0, 1, 3, 0xff]) {
      const wire = transport(capability(ALL, version));
      expect(await readMacroOptions(wire, 0x11, 1)).toEqual({kind: 'unsupported'});
      expect(wire.requests).toEqual([[0x11, W.MACRO_OPTIONS.CAPABILITIES]]);
    }
  });

  test('a reply off the registry is an error, not proof either way', async () => {
    for (const cap of [
      [0x02, ...capability().slice(1)],
      [...capability().slice(0, 3), 0x45, 0x4d, 0x52, 0x31],
      // The unreleased REPEAT bit and bit 7 are reserved in version 2.
      capability(ALL | 0x10),
      capability(ALL | 0x80),
    ]) {
      await expect(readMacroOptions(transport(cap), 0x11, 1)).rejects.toBeInstanceOf(MacroOptionsReplyError);
    }
  });

  test('reads each macro’s flags, big-endian hold time and repeat count', async () => {
    const wire = transport(capability(), [
      {flags: F.RETAP, holdMs: 1000, repeatCount: 1},
      {flags: F.BLOCK_OTHERS | F.OTHER, holdMs: 0x1234, repeatCount: 0},
    ]);
    expect(await readMacroOptions(wire, 0x13, 2)).toEqual({
      kind: 'read',
      supported: ALL,
      options: [
        {flags: F.RETAP, holdMs: 1000, repeatCount: 1},
        {flags: F.BLOCK_OTHERS | F.OTHER, holdMs: 0x1234, repeatCount: 0},
      ],
    });
    expect(wire.requests.slice(1, 4)).toEqual([
      [W.MACRO_OPTIONS.FLAGS, 0],
      [W.MACRO_OPTIONS.HOLD_MS, 0],
      [W.MACRO_OPTIONS.REPEAT_COUNT, 0],
    ]);
  });

  test('writes the repeat count as one byte after FLAGS and HOLD_MS', () => {
    expect(macroOptionsWrites(0x11, 2, {flags: F.BLOCK_OTHERS, holdMs: 0x0102, repeatCount: 255})).toEqual([
      [0x11, W.MACRO_OPTIONS.FLAGS, 2, F.BLOCK_OTHERS],
      [0x11, W.MACRO_OPTIONS.HOLD_MS, 2, 0x01, 0x02],
      [0x11, W.MACRO_OPTIONS.REPEAT_COUNT, 2, 255],
    ]);
  });
});

describe('macro options in layout files', () => {
  const DEFAULTS = Array.from({length: 3}, () => ({flags: 0, holdMs: 1000, repeatCount: 1}));
  const keyboard = (macroOptions?: {channel: number; supported: number}) => ({
    vendorProductId: 1,
    layers: [[4]],
    macroCount: 3,
    macroOptions: macroOptions && {
      available: true as const,
      ...macroOptions,
      options: DEFAULTS,
      unsaved: false,
    },
  });
  const file = (macroOptions?: unknown) => ({
    name: 'K',
    vendorProductId: 1,
    layers: [['KC_A']],
    ...(macroOptions !== undefined && {macroOptions}),
  });
  const plan = (
    saved: unknown,
    target = keyboard({channel: 0x11, supported: F.RETAP | F.HOLD | F.BLOCK_OTHERS}),
  ) => planLayoutImport(file(saved) as any, target, () => 4) as any;

  test('saved only where CAPABILITIES confirmed support, with the repeat count and every flag', () => {
    expect(saveMacroOptions(null)).toEqual({});
    expect(saveMacroOptions({kind: 'unsupported'})).toEqual({});
    expect(saveMacroOptions(undefined)).toEqual({error: 'keyboard-not-ready'});
    expect(saveMacroOptions({kind: 'failed', reason: 'x'})).toEqual({error: 'keyboard-not-ready'});
    expect(saveMacroOptions({
      kind: 'read',
      supported: ALL,
      options: [{flags: F.RETAP | F.BLOCK_OTHERS, holdMs: 250, repeatCount: 7}],
    })).toEqual({macroOptions: [{flags: F.RETAP | F.BLOCK_OTHERS, holdMs: 250, repeatCount: 7}]});
  });

  test('loads only supported bits, hold times and counts in range, and until stopped with a stop', () => {
    expect(plan([
      {flags: F.RETAP | F.HOLD | F.BLOCK_OTHERS, holdMs: 250, repeatCount: 5},
      {flags: F.OTHER, holdMs: 0, repeatCount: 256},
      {flags: 0, holdMs: 65536, repeatCount: 0},
      {flags: F.RETAP, holdMs: 65535, repeatCount: 0},
    ]).macroOptions).toEqual({
      channel: 0x11,
      // OTHER is unsupported, 0 and 65536 ms and a count of 256 do not fit, until
      // stopped has no stop, and the keyboard has three macros.
      writes: [{index: 0, flags: F.RETAP | F.HOLD | F.BLOCK_OTHERS, holdMs: 250, repeatCount: 5}],
    });
    // Until stopped with no stop writes neither of the values that make it.
    expect(plan([{flags: 0, holdMs: 300, repeatCount: 0}]).macroOptions).toEqual({
      channel: 0x11,
      writes: [{index: 0, holdMs: 300}],
    });
    expect(plan([null, null, {flags: F.RETAP, holdMs: 65535, repeatCount: 0}]).macroOptions).toEqual({
      channel: 0x11,
      writes: [{index: 2, flags: F.RETAP, holdMs: 65535, repeatCount: 0}],
    });
    // The block flag alone, the rest as the keyboard holds it.
    expect(plan([{flags: F.BLOCK_OTHERS, holdMs: 1000, repeatCount: 1}]).macroOptions).toEqual({
      channel: 0x11,
      writes: [{index: 0, flags: F.BLOCK_OTHERS}],
    });
  });

  test('a file without them, or a keyboard without them, loads as before', () => {
    expect(plan(undefined).macroOptions).toBeUndefined();
    expect(plan([{flags: F.RETAP, holdMs: 250, repeatCount: 2}], keyboard()).macroOptions).toBeUndefined();
  });
});
