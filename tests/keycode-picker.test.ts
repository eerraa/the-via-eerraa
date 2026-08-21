import {describe, expect, test} from 'bun:test';
import {
  clearKeycodeValue,
  composeLayerTap,
  composeModTap,
  composeModifier,
  composeModifiers,
  filterKeycodeMenus,
  formatKeycodeHex,
  formatKeycodeLabel,
  getComposeBaseKeycodes,
  isComposerCategory,
  parseKeycodeInput,
  resolveComposeBaseCode,
  selectKeycodeFromMenuCode,
} from '../src/utils/keycode-picker';
import {menusWithTapDanceSplit} from '../src/utils/keycode-menus';
import {getKeycodes, type IKeycodeMenu} from '../src/utils/key';

const basicKeyToByte: Record<string, number> = {
  KC_NO: 0x0000,
  KC_A: 0x0004,
  KC_B: 0x0005,
  KC_SPC: 0x002c,
  KC_LSFT: 0x00e1,
  _QK_MODS: 0x0100,
  _QK_MODS_MAX: 0x1fff,
  _QK_MOD_TAP: 0x2000,
  _QK_MOD_TAP_MAX: 0x3fff,
  _QK_LAYER_TAP: 0x4000,
  _QK_LAYER_TAP_MAX: 0x4fff,
  _QK_MOMENTARY: 0x5100,
  _QK_MOMENTARY_MAX: 0x511f,
  _QK_MACRO: 0x7700,
  _QK_MACRO_MAX: 0x777f,
  _QK_KB: 0x7e00,
  _QK_KB_MAX: 0x7e3f,
  QK_LCTL: 0x0100,
};

const byteToKey = Object.fromEntries(
  Object.entries(basicKeyToByte).map(([code, value]) => [value, code]),
) as Record<number, string>;

const menus: IKeycodeMenu[] = [
  {
    id: 'basic',
    label: 'Basic',
    keycodes: [
      {name: 'A', code: 'KC_A', title: 'A key'},
      {name: 'B', code: 'KC_B'},
    ],
  },
  {
    id: 'layers',
    label: 'Layers',
    keycodes: [
      {name: 'MO(1)', code: 'MO(1)'},
      {name: 'Space Fn1', code: 'LT(1,KC_SPC)'},
    ],
  },
  {
    id: 'special',
    label: 'Special',
    keycodes: [{name: 'Any', code: 'text'}],
  },
];

describe('keycode picker codec', () => {
  test('preserves unknown 16-bit values as hex', () => {
    expect(formatKeycodeHex(0x1234)).toBe('0x1234');
    expect(formatKeycodeLabel(0xabcd, basicKeyToByte, byteToKey)).toBe(
      '0xABCD',
    );
    expect(parseKeycodeInput('0xABCD', basicKeyToByte)).toBe(0xabcd);
  });

  test('selects KC_NO, basic, modifier, MT, LT, macro and custom encodings', () => {
    expect(clearKeycodeValue(basicKeyToByte)).toBe(0);
    expect(selectKeycodeFromMenuCode('KC_A', basicKeyToByte)).toBe(0x0004);
    expect(composeModifier('LCTL', 'KC_A', basicKeyToByte)).toBe(0x0104);
    expect(composeModifiers(['LCTL', 'LSFT'], 'KC_A', basicKeyToByte)).toBe(
      0x0304,
    );
    expect(composeModTap('MOD_LSFT', 'KC_A', basicKeyToByte)).toBe(
      0x2000 | (0x0002 << 8) | 0x0004,
    );
    expect(composeLayerTap(2, 'KC_A', basicKeyToByte)).toBe(
      0x4000 | (2 << 8) | 0x0004,
    );
    expect(parseKeycodeInput('MACRO(3)', basicKeyToByte)).toBe(0x7703);
    expect(parseKeycodeInput('CUSTOM(1)', basicKeyToByte)).toBe(0x7e01);
    expect(parseKeycodeInput('not-a-keycode', basicKeyToByte)).toBeNull();
  });

  test('search filters categories without dropping unmatched-empty noise', () => {
    const filtered = filterKeycodeMenus(menus, 'a key');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].keycodes.map((keycode) => keycode.code)).toEqual([
      'KC_A',
    ]);
    expect(filterKeycodeMenus(menus, 'nope')).toEqual([]);
  });

  test('composer is only attached to the Layers category', () => {
    expect(isComposerCategory('layers')).toBe(true);
    expect(isComposerCategory('basic')).toBe(false);
    expect(isComposerCategory('special')).toBe(false);
    expect(isComposerCategory(undefined)).toBe(false);
  });

  test('compose base is resolved only from explicit input, not a side effect', () => {
    expect(
      resolveComposeBaseCode('', menus, basicKeyToByte, byteToKey),
    ).toBeNull();
    expect(resolveComposeBaseCode('A', menus, basicKeyToByte, byteToKey)).toBe(
      'KC_A',
    );
    expect(
      resolveComposeBaseCode('kc_b', menus, basicKeyToByte, byteToKey),
    ).toBe('KC_B');
    expect(
      resolveComposeBaseCode('nope', menus, basicKeyToByte, byteToKey),
    ).toBeNull();
    expect(
      resolveComposeBaseCode('MO(1)', menus, basicKeyToByte, byteToKey),
    ).toBeNull();
    expect(
      resolveComposeBaseCode('0x1234', menus, basicKeyToByte, byteToKey),
    ).toBeNull();
  });

  test('grid base picking exposes only explicit Basic tap keycodes', () => {
    expect(
      getComposeBaseKeycodes(menus, basicKeyToByte).map(
        (keycode) => keycode.code,
      ),
    ).toEqual(['KC_A', 'KC_B']);
  });
});

describe('tapdance keycode category', () => {
  test('keeps Layer cards selectable as 16-bit Tap Dance actions', () => {
    const layerMenu = getKeycodes().find((menu) => menu.id === 'layers');
    const layerCodes = layerMenu?.keycodes.map((keycode) => keycode.code);

    expect(layerCodes).toContain('MO(1)');
    expect(layerCodes).toContain('LT(1,KC_SPC)');
    expect(selectKeycodeFromMenuCode('MO(1)', basicKeyToByte)).toBe(0x5101);
    expect(selectKeycodeFromMenuCode('LT(1,KC_SPC)', basicKeyToByte)).toBe(
      0x412c,
    );
  });

  test('lifts TD0-TD7 out of Custom and places TAPDANCE immediately above it', () => {
    const split = menusWithTapDanceSplit([
      {
        id: 'special',
        label: 'Special',
        keycodes: [{name: 'Any', code: 'text'}],
      },
      {
        id: 'custom',
        label: 'Custom',
        keycodes: [
          {name: 'TD0', title: 'Tap Dance 0', code: 'CUSTOM(0)'},
          {name: 'TD7', title: 'Tap Dance 7', code: 'CUSTOM(7)'},
          {name: 'USER1', title: 'User 1', code: 'CUSTOM(8)'},
        ],
      },
    ]);
    expect(split.map((menu: {id: string}) => menu.id)).toEqual([
      'special',
      'tapdance',
      'custom',
    ]);
    expect(split[1].label).toBe('TAPDANCE');
    expect(
      split[1].keycodes.map((keycode: {code: string}) => keycode.code),
    ).toEqual(['CUSTOM(0)', 'CUSTOM(7)']);
    expect(
      split[2].keycodes.map((keycode: {name: string}) => keycode.name),
    ).toEqual(['USER1']);
  });

  test('drops Custom when every custom keycode is TD0-TD7', () => {
    const split = menusWithTapDanceSplit([
      {
        id: 'custom',
        label: 'Custom',
        keycodes: [
          {name: 'TD0', code: 'CUSTOM(0)'},
          {name: 'TD1', code: 'CUSTOM(1)'},
        ],
      },
    ]);
    expect(split).toHaveLength(1);
    expect(split[0].id).toBe('tapdance');
  });
});
