import {afterEach, describe, expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {
  eraAdvancedEntry,
  setEraAdvancedMetadataForTesting,
} from '../src/utils/era-advanced-metadata';
import {
  layoutFileName,
  getLayoutImportKeycodes,
  planLayoutImport,
  readLayoutCode,
  saveTapDance,
  type TapDanceTarget,
  type ViaSaveFile,
} from '../src/utils/layout-import';
import type {TapDanceDraft, TapDanceSlot} from '../src/utils/keycode-palette';
import {getByteForCode} from '../src/utils/key';
import {getBasicKeyDict} from '../src/utils/key-to-byte/dictionary-store';
import v12Keycodes from '../src/utils/key-to-byte/v12';
import {findMacroExpressionProblem} from '../src/utils/macro-api/macro-api.common';

const BRICK60 = 0x4501000c;
const BRICK60_OLD = 0x45520022;
const N86 = 0x45020002;
const N86_OTHER_MAKER = 0x45010006;
const OTHER_BOARD = 0x45010001;

const entry = (id: string, vendorProductId: number) => ({
  id,
  vendorProductId,
  stateSync: true,
  exactMsFamily: null,
});

const useEraMetadata = () =>
  setEraAdvancedMetadataForTesting({
    schemaVersion: 2,
    definitions: [
      entry('brick60-h7s', BRICK60),
      entry('brick60-h7s', BRICK60_OLD),
      entry('n86', N86),
      entry('n86', N86_OTHER_MAKER),
      entry('other', OTHER_BOARD),
    ],
  });

afterEach(() => setEraAdvancedMetadataForTesting(null));

const CODES: Record<string, number> = {
  KC_NO: 0x0000,
  KC_TRNS: 0x0001,
  KC_A: 0x0004,
  KC_B: 0x0005,
  'MO(2)': 0x5222,
  'CUSTOM(0)': 0x7e00,
  KC_ESC: 0x0029,
  KC_LCTL: 0x00e0,
};
// A small keycode set; a name outside it throws, as data no file holds does.
const toByte = (code: string) => {
  const byte = CODES[code];
  if (byte === undefined) {
    throw `Could not find byte for ${code}`;
  }
  return byte;
};
const toCode = (byte: number) =>
  Object.keys(CODES).find((code) => CODES[code] === byte) ?? '';

const file = (overrides: Partial<ViaSaveFile> = {}): ViaSaveFile => ({
  name: 'BRICK60',
  vendorProductId: BRICK60,
  layers: [
    ['KC_A', 'CUSTOM(0)', 'MO(2)'],
    ['KC_TRNS', 'KC_B', 'KC_TRNS'],
  ],
  ...overrides,
});

const keyboard = (layers = 2, overrides = {}) => ({
  vendorProductId: BRICK60,
  layers: Array.from({length: layers}, (_, idx) => [0x10 + idx, 0x20, 0x30]),
  macroCount: null,
  ...overrides,
});

describe('legacy lighting in saved layouts', () => {
  const names = [
    'RGB_TOG', 'RGB_MOD', 'RGB_RMOD', 'RGB_HUI', 'RGB_HUD',
    'RGB_SAI', 'RGB_SAD', 'RGB_VAI', 'RGB_VAD', 'RGB_SPI',
    'RGB_SPD', 'RGB_M_P', 'RGB_M_B', 'RGB_M_R', 'RGB_M_SW',
    'RGB_M_SN', 'RGB_M_K', 'RGB_M_X', 'RGB_M_G', 'RGB_MODE_RGBTEST',
  ] as const;
  const expected = names.map((name) => v12Keycodes[name]);

  test.each([12, 13, 14])(
    'protocol %i loads all 20 old names in layers and both encoder directions',
    (protocol) => {
      const basic = getBasicKeyDict(protocol, protocol >= 13 ? 9 : undefined);
      const codes = getLayoutImportKeycodes(protocol, basic);
      const resolve = (code: string) => getByteForCode(code, codes);
      const encoders = names.map((name) => [[name, name] as [string, string]]);
      const plan = planLayoutImport(
        file({layers: [[...names]], encoders}),
        keyboard(1, {layers: [Array(20).fill(0)]}),
        resolve,
      );
      expect(plan).toMatchObject({
        keymap: [expected],
        encoders: Object.fromEntries(expected.map((byte, id) => [id, [[byte, byte]]])),
      });
      if (protocol >= 13) {
        expect(Object.keys(codes).filter((code) => !(code in basic)).sort())
          .toEqual([...names].sort());
        names.forEach((name) => expect(basic).not.toHaveProperty(name));
        expect(resolve('UG_TOGG')).toBe(basic.UG_TOGG);
        expect(resolve('RM_TOGG')).toBe(basic.RM_TOGG);
      } else {
        expect(codes).toBe(basic);
      }
      expect(codes).not.toHaveProperty('RGB_UNKNOWN');
    },
  );

  test.each([10, 11, 12])('protocol %i keeps its original dictionary unchanged', (protocol) => {
    const basic = getBasicKeyDict(protocol);
    expect(getLayoutImportKeycodes(protocol, basic)).toBe(basic);
  });

  test('macros cannot carry 16-bit lighting keycodes as one-byte actions', () => {
    const codes = getLayoutImportKeycodes(13, getBasicKeyDict(13, 9));
    names.forEach((name) => {
      expect(findMacroExpressionProblem(`{${name}}`, {
        delays: true,
        keycodeToByte: (code) => codes[code],
      })).toEqual({type: 'unknown-keys', keys: [name]});
    });
  });
});

// A file loads what it can as written, read as a typed code is; the rest goes in
// as VIA always loaded it, so the load still finishes, and the plan names each
// such keycode with where it goes, so those keys can be set again.
describe('keycodes that do not load as written', () => {
  const readWith = (keycodes: Record<string, number>) => {
    const read = (code: string) => readLayoutCode(code, keycodes);
    return [
      (code: string) => read(code).value,
      (code: string) => read(code).asWritten,
    ] as const;
  };

  test('load as VIA loaded them, each named with where it goes', () => {
    const keycodes = getLayoutImportKeycodes(12, getBasicKeyDict(12));
    const plan = planLayoutImport(
      file({
        layers: [
          ['KC_A', 'KC_NOPE', 'MO(32)'],
          ['MT(MOD_LCTL|MOD_RALT,KC_A)', '0x7e40', 'LCTL(MO(1))'],
        ],
        encoders: [[['KC_VOLD', 'KC_FOO'], ['KC_TRNS', 'KC_TRNS']]],
      }),
      keyboard(),
      ...readWith(keycodes),
    );
    const held = keycodes._QK_MOMENTARY;
    expect(plan).toMatchObject({
      // A value VIA saves only in hex loads as it was saved.
      keymap: [
        [0x0004, 0x0000, keycodes._QK_MOMENTARY_MAX],
        [0x3504, 0x7e40, held + 1],
      ],
      encoders: {0: [[keycodes.KC_VOLD, 0x0000], [0x0001, 0x0001]]},
      changed: [
        {place: {layer: 0, key: 1}, code: 'KC_NOPE', value: 0x0000},
        {
          place: {layer: 0, key: 2},
          code: 'MO(32)',
          value: keycodes._QK_MOMENTARY_MAX,
        },
        {
          place: {layer: 1, key: 0},
          code: 'MT(MOD_LCTL|MOD_RALT,KC_A)',
          value: 0x3504,
        },
        {place: {layer: 1, key: 2}, code: 'LCTL(MO(1))', value: held + 1},
        {
          place: {layer: 0, encoder: 0, clockwise: true},
          code: 'KC_FOO',
          value: 0x0000,
        },
      ],
    });
  });

  // A cell holds whatever JSON the file has: one that is no name loads blank, as
  // in official VIA, and is named by the text it reads as, which can be shown.
  test('a cell that is not a name loads blank and is named as text', () => {
    const plan = planLayoutImport(
      file({
        layers: [['KC_A', {code: 'KC_B'}, null] as unknown as string[]],
      }),
      keyboard(1),
      ...readWith(getLayoutImportKeycodes(12, getBasicKeyDict(12))),
    );
    expect(plan).toMatchObject({
      keymap: [[0x0004, 0x0000, 0x0000]],
      changed: [
        {place: {layer: 0, key: 1}, code: '[object Object]', value: 0x0000},
        {place: {layer: 0, key: 2}, code: 'null', value: 0x0000},
      ],
    });
  });

  // Before protocol 11 an LM keeps no hand: a right-hand one goes in as its
  // left-hand twin, as QMK writes it, and is named.
  test('before protocol 11 a right-hand Layer-Mod loads as its left-hand twin', () => {
    const keycodes = getLayoutImportKeycodes(10, getBasicKeyDict(10));
    expect(
      planLayoutImport(
        file({layers: [['LM(2,MOD_RALT)', 'LM(2,MOD_LALT)', 'KC_A']]}),
        keyboard(1),
        ...readWith(keycodes),
      ),
    ).toMatchObject({
      keymap: [[0x5924, 0x5924, 0x0004]],
      changed: [
        {place: {layer: 0, key: 0}, code: 'LM(2,MOD_RALT)', value: 0x5924},
      ],
    });
  });
});

describe('which files a keyboard takes', () => {
  test('takes a file its older firmware saved under the old identity', () => {
    useEraMetadata();
    const plan = planLayoutImport(
      file({vendorProductId: BRICK60_OLD}),
      keyboard(),
      toByte,
    );
    expect(plan).toMatchObject({
      keymap: [
        [0x0004, 0x7e00, 0x5222],
        [0x0001, 0x0005, 0x0001],
      ],
    });
    // And the other way round: a new save onto a keyboard still on older firmware.
    expect(
      planLayoutImport(file(), keyboard(2, {vendorProductId: BRICK60_OLD}), toByte),
    ).not.toHaveProperty('error');
  });

  test("takes a file saved under another maker's identity for the same board", () => {
    useEraMetadata();
    expect(
      planLayoutImport(
        file({vendorProductId: N86_OTHER_MAKER}),
        keyboard(2, {vendorProductId: N86}),
        toByte,
      ),
    ).not.toHaveProperty('error');
  });

  test('refuses a file from a different board', () => {
    useEraMetadata();
    expect(
      planLayoutImport(file({vendorProductId: OTHER_BOARD}), keyboard(), toByte),
    ).toEqual({error: 'different-keyboard'});
    expect(
      planLayoutImport(file({vendorProductId: BRICK60_OLD}), keyboard(2, {vendorProductId: N86}), toByte),
    ).toEqual({error: 'different-keyboard'});
  });

  test('an ordinary keyboard still takes only its own identity', () => {
    const ordinary = 0x12340001;
    expect(
      planLayoutImport(
        file({vendorProductId: ordinary}),
        keyboard(2, {vendorProductId: ordinary}),
        toByte,
      ),
    ).not.toHaveProperty('error');
    expect(
      planLayoutImport(
        file({vendorProductId: 0x12340002}),
        keyboard(2, {vendorProductId: ordinary}),
        toByte,
      ),
    ).toEqual({error: 'different-keyboard'});
  });
});

// The metadata as the build writes it from the manifest: one entry for every
// identity a definition is served under.
type Identity = {vendorId: string; productId: string};
const manifest = JSON.parse(
  readFileSync('config/era-definitions.manifest.json', 'utf8'),
) as {
  definitions: (Identity & {
    id: string;
    pair?: string;
    stateSync: boolean;
    identities?: Identity[];
    legacy?: Identity;
  })[];
};
const vpidOf = ({vendorId, productId}: Identity) =>
  Number.parseInt(vendorId.slice(2), 16) * 0x10000 +
  Number.parseInt(productId.slice(2), 16);
const useBuiltMetadata = () =>
  setEraAdvancedMetadataForTesting({
    schemaVersion: 2,
    definitions: manifest.definitions.flatMap((definition) =>
      [
        definition,
        ...(definition.identities ?? []),
        ...(definition.legacy ? [definition.legacy] : []),
      ].map((identity) => eraAdvancedEntry(definition, vpidOf(identity))),
    ),
  });
const identity = (id: string, served: 'current' | 'legacy' = 'current') => {
  const definition = manifest.definitions.find((entry) => entry.id === id)!;
  return vpidOf(served === 'legacy' ? definition.legacy! : definition);
};

describe('the halves of a split keyboard', () => {
  const load = (from: number, onto: number) =>
    planLayoutImport(
      file({vendorProductId: from}),
      keyboard(2, {vendorProductId: onto}),
      toByte,
    );

  // Both halves describe the whole board, and a backup made on one half is
  // loaded with whichever half the cable is in.
  test('takes a file saved on the other half, under either identity', () => {
    useBuiltMetadata();
    const left = identity('tomak79h-left');
    const right = identity('tomak79h-right');
    expect(load(left, right)).not.toHaveProperty('error');
    expect(load(right, left)).not.toHaveProperty('error');
    expect(load(identity('tomak79h-left', 'legacy'), right)).not.toHaveProperty(
      'error',
    );
    expect(
      load(identity('tomak-tkl-right', 'legacy'), identity('tomak-tkl-left')),
    ).not.toHaveProperty('error');
  });

  test('still refuses a file from another split board', () => {
    useBuiltMetadata();
    expect(load(identity('tomak79h-left'), identity('tomak79s-left'))).toEqual({
      error: 'different-keyboard',
    });
    expect(
      load(identity('tomak79h-right'), identity('tomak79s-right')),
    ).toEqual({error: 'different-keyboard'});
  });

  test('an ordinary keyboard next to them still takes only its own identity', () => {
    useBuiltMetadata();
    const ordinary = 0x12340001;
    expect(load(ordinary, ordinary)).not.toHaveProperty('error');
    expect(load(0x12340002, ordinary)).toEqual({error: 'different-keyboard'});
    expect(load(ordinary, identity('tomak79h-left'))).toEqual({
      error: 'different-keyboard',
    });
  });
});

describe('the name a save offers', () => {
  // A backup made before a firmware update does not take the name of an older one.
  test('names the board and the day', () => {
    expect(layoutFileName('TOMAK79H L', new Date(2026, 8, 30))).toBe(
      'tomak79h_l_2026-09-30.layout.json',
    );
    expect(layoutFileName('BRICK60', new Date(2027, 0, 5))).toBe(
      'brick60_2027-01-05.layout.json',
    );
  });
});

describe('fitting the layers', () => {
  // Older EERRAA firmware had four layers, current firmware six.
  test('a layer the file lacks keeps what the keyboard has', () => {
    const plan = planLayoutImport(file(), keyboard(4), toByte);
    expect(plan).toMatchObject({
      keymap: [
        [0x0004, 0x7e00, 0x5222],
        [0x0001, 0x0005, 0x0001],
        [0x12, 0x20, 0x30],
        [0x13, 0x20, 0x30],
      ],
    });
  });

  test('drops layers the keyboard lacks only when they hold nothing', () => {
    const empty = file({
      layers: [...file().layers, ['KC_TRNS', 'KC_NO', 'KC_TRNS']],
      encoders: [[['KC_A', 'KC_B'], ['KC_B', 'KC_A'], ['KC_TRNS', 'KC_TRNS']]],
    });
    const plan = planLayoutImport(empty, keyboard(2), toByte);
    expect(plan).toMatchObject({
      keymap: [
        [0x0004, 0x7e00, 0x5222],
        [0x0001, 0x0005, 0x0001],
      ],
      encoders: {0: [[0x0004, 0x0005], [0x0005, 0x0004]]},
    });

    const used = file({layers: [...file().layers, ['KC_TRNS', 'KC_A', 'KC_TRNS']]});
    expect(planLayoutImport(used, keyboard(2), toByte)).toEqual({
      error: 'extra-layers',
    });
    const usedEncoder = file({
      encoders: [[['KC_A', 'KC_B'], ['KC_B', 'KC_A'], ['KC_A', 'KC_TRNS']]],
    });
    expect(planLayoutImport(usedEncoder, keyboard(2), toByte)).toEqual({
      error: 'extra-layers',
    });
  });

  // A State Sync keyboard knows its macro count once it connects; before that the
  // file's macros cannot be checked, so the load waits rather than skips them.
  test('refuses macros while the keyboard has not reported its macro count', () => {
    expect(
      planLayoutImport(
        file({macros: ['']}),
        keyboard(2, {macroCount: undefined}),
        toByte,
      ),
    ).toEqual({error: 'keyboard-not-ready'});
    expect(
      planLayoutImport(file(), keyboard(2, {macroCount: undefined}), toByte),
    ).not.toHaveProperty('error');
  });

  test('still refuses a different key count or macro count', () => {
    expect(
      planLayoutImport(
        file({layers: [['KC_A', 'KC_B']]}),
        keyboard(2),
        toByte,
      ),
    ).toEqual({error: 'key-count'});
    expect(
      planLayoutImport(
        file({macros: ['', '']}),
        keyboard(2, {macroCount: 16}),
        toByte,
      ),
    ).toEqual({error: 'macro-count'});
  });
});

describe('Tap Dance in the layout file', () => {
  const slot = (index: number): TapDanceSlot => {
    const command = (role: string, id: number) => ({
      name: `id_qmk_tapdance_${index + 1}_${role}`,
      channel: 16,
      id,
      label: role,
    });
    const base = index * 5;
    return {
      index,
      name: `TD${index}`,
      code: `TD(${index})`,
      actions: {
        tap: command('tap', base + 1),
        hold: command('hold', base + 2),
        dtap: command('dtap', base + 3),
        thold: command('thold', base + 4),
      },
      term: {...command('term_exact', 41 + index), options: [1, 65535]},
    };
  };
  const draft = (tap: number, hold: number, term: string): TapDanceDraft => ({
    actions: {tap, hold, dtap: 0x0000, thold: 0x0000},
    term,
  });
  const target = (
    values: (TapDanceDraft | null)[] = [
      draft(0x0004, 0x0000, '200'),
      draft(0x0000, 0x0000, '200'),
    ],
    available = true,
  ): TapDanceTarget => ({
    slots: [slot(0), slot(1)],
    read: (s) => values[s.index],
    // H7S bounds.
    termBounds: () => ({minMs: 100, maxMs: 500}),
    available,
  });
  const tapDanceWrites = (tapDance: unknown, td = target()) => {
    const plan = planLayoutImport(
      file({tapDance: tapDance as ViaSaveFile['tapDance']}),
      keyboard(2, {tapDance: td}),
      toByte,
    );
    if ('error' in plan) {
      throw new Error(plan.error);
    }
    return plan.customValues.map(({id, value}) => [id, value]);
  };

  test('saves each slot as keycode names and a term in ms', () => {
    expect(saveTapDance(target(), toCode)).toEqual({
      tapDance: [
        {tap: 'KC_A', hold: 'KC_NO', dtap: 'KC_NO', thold: 'KC_NO', term: 200},
        {tap: 'KC_NO', hold: 'KC_NO', dtap: 'KC_NO', thold: 'KC_NO', term: 200},
      ],
    });
  });

  // A file missing its Tap Dance would restore a keyboard without it, so the save
  // is refused instead of written short.
  test('refuses to save until every slot has been read', () => {
    expect(saveTapDance(target([draft(4, 0, '200'), null]), toCode)).toEqual({
      error: 'keyboard-not-ready',
    });
    expect(saveTapDance(target(undefined, false), toCode)).toEqual({
      error: 'keyboard-not-ready',
    });
    // A keyboard without Tap Dance has nothing to add.
    expect(
      saveTapDance({slots: [], read: () => null, available: false}, toCode),
    ).toEqual({});
  });

  test('loads only what differs, slot by slot', () => {
    expect(
      tapDanceWrites([
        {tap: 'KC_A', hold: 'KC_LCTL', dtap: 'KC_NO', thold: 'KC_NO', term: 200},
        {tap: 'KC_ESC', hold: 'KC_NO', dtap: 'KC_NO', thold: 'KC_NO', term: 250},
      ]),
    ).toEqual([
      [2, 0x00e0],
      [6, 0x0029],
      [42, 250],
    ]);
  });

  test('a file saved from the same keyboard writes nothing', () => {
    const saved = saveTapDance(target(), toCode);
    expect(tapDanceWrites('tapDance' in saved ? saved.tapDance : null)).toEqual([]);
  });

  test('writes every value the keyboard has not reported', () => {
    expect(
      tapDanceWrites(
        [{tap: 'KC_A', hold: 'KC_NO', dtap: 'KC_NO', thold: 'KC_NO', term: 200}],
        target([null, draft(0, 0, '200')]),
      ),
    ).toEqual([
      [1, 0x0004],
      [2, 0x0000],
      [3, 0x0000],
      [4, 0x0000],
      [41, 200],
    ]);
  });

  test('keeps the term when the file asks for one outside the range', () => {
    expect(
      tapDanceWrites([
        {tap: 'KC_ESC', hold: 'KC_NO', dtap: 'KC_NO', thold: 'KC_NO', term: 50},
      ]),
    ).toEqual([[1, 0x0029]]);
  });

  test('leaves a slot alone when the file cannot describe it', () => {
    expect(
      tapDanceWrites([
        {tap: 'KC_UNKNOWN', hold: 'KC_NO', dtap: 'KC_NO', thold: 'KC_NO'},
        {tap: 'KC_ESC', hold: 'KC_NO', dtap: 'KC_NO'},
        {tap: 'KC_ESC', hold: 'KC_NO', dtap: 'KC_NO', thold: 'KC_NO'},
      ]),
    ).toEqual([]);
    expect(tapDanceWrites('not a list')).toEqual([]);
    expect(tapDanceWrites([null, 7])).toEqual([]);
  });

  test('names an action that does not load as written', () => {
    const read = (code: string) =>
      readLayoutCode(code, getLayoutImportKeycodes(12, getBasicKeyDict(12)));
    const plan = planLayoutImport(
      file({
        tapDance: [
          {tap: 'KC_NOPE', hold: 'KC_LCTL', dtap: 'KC_NO', thold: 'KC_NO', term: 200},
        ],
      }),
      keyboard(2, {tapDance: target()}),
      (code) => read(code).value,
      (code) => read(code).asWritten,
    );
    expect(plan).toMatchObject({
      changed: [
        {place: {tapDance: 0, role: 'tap'}, code: 'KC_NOPE', value: 0x0000},
      ],
    });
  });

  test('an official VIA file, or a keyboard without Tap Dance, changes no Tap Dance', () => {
    expect(tapDanceWrites(undefined)).toEqual([]);
    const plan = planLayoutImport(
      file({
        tapDance: [
          {tap: 'KC_ESC', hold: 'KC_NO', dtap: 'KC_NO', thold: 'KC_NO', term: 300},
        ],
      }),
      keyboard(2),
      toByte,
    );
    expect(plan).toMatchObject({customValues: []});
  });

  test('refuses Tap Dance it cannot write yet, instead of loading without it', () => {
    const load = (tapDance: unknown) =>
      planLayoutImport(
        file({tapDance: tapDance as ViaSaveFile['tapDance']}),
        keyboard(2, {tapDance: target(undefined, false)}),
        toByte,
      );
    expect(
      load([{tap: 'KC_ESC', hold: 'KC_NO', dtap: 'KC_NO', thold: 'KC_NO', term: 200}]),
    ).toEqual({error: 'keyboard-not-ready'});
    // Nothing to change, nothing to wait for.
    expect(
      load([{tap: 'KC_A', hold: 'KC_NO', dtap: 'KC_NO', thold: 'KC_NO', term: 200}]),
    ).not.toHaveProperty('error');
  });
});
