import {describe, expect, test} from 'bun:test';
import {
  clearKeycodeValue,
  composeLayerTap,
  composeModTap,
  composeModifiers,
  formatKeycodeHex,
  formatKeycodeLabel,
  getComposeBaseKeycodes,
  getComposeKeycodeDisabledReason,
  parseKeycodeInput,
  selectKeycodeFromMenuCode,
} from '../src/utils/keycode-picker';
import {menusWithTapDanceKeycodes} from '../src/utils/keycode-menus';
import {getKeycodes, type IKeycodeMenu} from '../src/utils/key';
import v13BasicKeyToByte from '../src/utils/key-to-byte/v13';
import legacyBasicKeyToByte from '../src/utils/key-to-byte/default';

const basicKeyToByte: Record<string, number> = {
  KC_NO: 0x0000,
  KC_A: 0x0004,
  KC_B: 0x0005,
  KC_SPC: 0x002c,
  KC_LSFT: 0x00e1,
  KC_F13: 0x0068,
  KC_MPLY: 0x00ae,
  KC_VOLU: 0x00a9,
  EXTENDED_KEY: 0x0104,
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
    keycodes: [
      {name: 'Any', code: 'text'},
      {name: 'F13', code: 'KC_F13'},
      {name: 'Play', code: 'KC_MPLY'},
      {name: 'Volume Up', code: 'KC_VOLU'},
      {name: 'Shift', code: 'KC_LSFT'},
      {name: 'A again', code: 'KC_A'},
      {name: 'Extended', code: 'EXTENDED_KEY'},
    ],
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
    expect(composeModifiers(['LCTL'], 'KC_A', basicKeyToByte)).toBe(0x0104);
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

  test('grid base picking allows basic values from every enabled category', () => {
    expect(
      getComposeBaseKeycodes(menus, basicKeyToByte).map(
        (keycode) => keycode.code,
      ),
    ).toEqual(['KC_A', 'KC_B', 'KC_F13', 'KC_MPLY', 'KC_VOLU', 'KC_LSFT']);
    expect(getComposeBaseKeycodes(menus.slice(1), basicKeyToByte)).toHaveLength(5);
  });

  test('Media, F13 and every modifier usage are valid LT/MT/MOD operands', () => {
    for (const code of [
      'KC_MPLY',
      'KC_VOLU',
      'KC_F13',
      'KC_LCTL',
      'KC_LSFT',
      'KC_LALT',
      'KC_LGUI',
      'KC_RCTL',
      'KC_RSFT',
      'KC_RALT',
      'KC_RGUI',
    ]) {
      const value = v13BasicKeyToByte[code as keyof typeof v13BasicKeyToByte];
      expect(getComposeKeycodeDisabledReason(value, v13BasicKeyToByte)).toBeNull();
      expect(composeLayerTap(2, code, v13BasicKeyToByte)).toBe(0x4200 | value);
      expect(composeModTap('MOD_LCTL', code, v13BasicKeyToByte)).toBe(0x2100 | value);
      expect(composeModifiers(['LCTL'], code, v13BasicKeyToByte)).toBe(0x0100 | value);
    }
  });

  test('named and raw 16-bit operands cannot corrupt or truncate combined keys', () => {
    for (const code of [
      'EXTENDED_KEY',
      '0x0104',
      '0xFFFF',
      'LCTL(KC_A)',
      'MT(MOD_LCTL,KC_A)',
      'LT(1,KC_A)',
      'MACRO(0)',
      'CUSTOM(0)',
    ]) {
      expect(composeLayerTap(1, code, basicKeyToByte)).toBeNull();
      expect(composeModTap('MOD_LCTL', code, basicKeyToByte)).toBeNull();
      expect(composeModifiers(['LCTL'], code, basicKeyToByte)).toBeNull();
    }
    for (const input of [
      'LT(1,EXTENDED_KEY)',
      'MT(MOD_LCTL,EXTENDED_KEY)',
      'LCTL(EXTENDED_KEY)',
      'LT(1,LCTL(KC_A))',
      'MT(MOD_LCTL,LT(1,KC_A))',
      'LCTL(MACRO(0))',
      'LCTL(no-such-key)',
      'LT(1,KC_A,KC_B)',
      'MT(MOD_LCTL,KC_A,KC_B)',
      'LT(16,KC_A)',
      'LT(1.5,KC_A)',
      'LCTL(KC_A',
      'LCTL(KC_A))',
      'LCTL(KC_A)suffix',
    ]) {
      expect(parseKeycodeInput(input, basicKeyToByte)).toBeNull();
    }
    expect(getComposeKeycodeDisabledReason(0x0104, basicKeyToByte)).toBe(
      'requires-basic-keycode',
    );
    for (const value of [null, -1, 0x10000, NaN, Infinity, 1.5]) {
      expect(getComposeKeycodeDisabledReason(value, basicKeyToByte)).toBe(
        'invalid-keycode',
      );
    }
  });

  test('raw basic operands work, while reserved values stay readable without being composed', () => {
    expect(composeLayerTap(1, '0x00AE', basicKeyToByte)).toBe(0x41ae);
    expect(composeModTap('MOD_LCTL', '0x00AE', basicKeyToByte)).toBe(0x21ae);
    expect(composeModifiers(['LCTL', 'LSFT'], '0x00AE', basicKeyToByte)).toBe(0x03ae);
    expect(parseKeycodeInput('0x00FF', basicKeyToByte)).toBe(0x00ff);
    expect(getComposeKeycodeDisabledReason(0x00ff, basicKeyToByte)).toBe(
      'unavailable-keycode',
    );
    expect(composeModifiers(['LCTL'], '0x00FF', basicKeyToByte)).toBeNull();
    expect(parseKeycodeInput('0xABCD', basicKeyToByte)).toBe(0xabcd);
  });

  test('legacy and modern numeric expressions retain exact ordinals instead of clamping or wrapping', () => {
    const ranges = {
      TO: '_QK_TO',
      MO: '_QK_MOMENTARY',
      DF: '_QK_DEF_LAYER',
      TG: '_QK_TOGGLE_LAYER',
      OSL: '_QK_ONE_SHOT_LAYER',
      TT: '_QK_LAYER_TAP_TOGGLE',
      MACRO: '_QK_MACRO',
      CUSTOM: '_QK_KB',
      TD: '_QK_KB',
    };
    for (const dictionary of [legacyBasicKeyToByte, v13BasicKeyToByte]) {
      const dict: Record<string, number> = dictionary;
      for (const [macro, range] of Object.entries(ranges)) {
        const max = dict[`${range}_MAX`] - dict[range];
        expect(parseKeycodeInput(`${macro}(0)`, dict)).toBe(dict[range]);
        expect(parseKeycodeInput(`${macro}(${max})`, dict)).toBe(dict[`${range}_MAX`]);
        for (const parameter of ['foo', '-1', '1.5', '0junk', String(max + 1), '256', '99999999999999999999']) {
          expect(parseKeycodeInput(`${macro}(${parameter})`, dict)).toBeNull();
          expect(selectKeycodeFromMenuCode(`${macro}(${parameter})`, dict)).toBeNull();
        }
        expect(parseKeycodeInput(`${macro}(0)junk`, dict)).toBeNull();
      }
      const shift = Math.log2(dict._QK_LAYER_MOD_MASK + 1);
      expect(parseKeycodeInput('LM(15,MOD_LCTL)', dict)).toBe(dict._QK_LAYER_MOD | (15 << shift) | 1);
      for (const parameter of ['16', '-1', 'foo', '1.5', '0junk']) {
        expect(parseKeycodeInput(`LM(${parameter},MOD_LCTL)`, dict)).toBeNull();
      }
      expect(parseKeycodeInput('LCTL(LSFT(KC_A))', dict)).toBe(0x0304);
    }
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

  test('places the Tap Dance tab from tapdanceKeycodes and leaves Custom untouched', () => {
    const split = menusWithTapDanceKeycodes(
      [
        {
          id: 'special',
          label: 'Special',
          keycodes: [{name: 'Any', code: 'text'}],
        },
        {
          id: 'custom',
          label: 'Custom',
          keycodes: [{name: 'USER1', title: 'User 1', code: 'CUSTOM(0)'}],
        },
      ],
      [
        {name: 'TD0', title: 'Tap Dance 0'},
        {name: 'TD7', title: 'Tap Dance 7'},
      ],
    );
    expect(split.map((menu: {id: string}) => menu.id)).toEqual([
      'special',
      'tapdance',
      'custom',
    ]);
    expect(split[1].label).toBe('Tap Dance');
    expect(
      split[1].keycodes.map((keycode: {code: string}) => keycode.code),
    ).toEqual(['TD(0)', 'TD(1)']);
    expect(
      split[2].keycodes.map((keycode: {name: string}) => keycode.name),
    ).toEqual(['USER1']);
  });

  test('omits the Tap Dance tab when tapdanceKeycodes is empty and keeps Custom', () => {
    const menus = [
      {
        id: 'custom',
        label: 'Custom',
        keycodes: [{name: 'USER1', code: 'CUSTOM(0)'}],
      },
    ];
    expect(menusWithTapDanceKeycodes(menus, [])).toEqual(menus);
  });

  test('TD(n) and CUSTOM(n) both encode to QK_KB_n for firmware', () => {
    expect(selectKeycodeFromMenuCode('TD(0)', basicKeyToByte)).toBe(0x7e00);
    expect(selectKeycodeFromMenuCode('CUSTOM(0)', basicKeyToByte)).toBe(0x7e00);
    expect(selectKeycodeFromMenuCode('TD(7)', basicKeyToByte)).toBe(0x7e07);
  });

  test('does not steal Custom entries named TD0 when tapdanceKeycodes is absent', () => {
    const menus = [
      {
        id: 'custom',
        label: 'Custom',
        keycodes: [
          {name: 'TD0', code: 'CUSTOM(0)'},
          {name: 'USER1', code: 'CUSTOM(1)'},
        ],
      },
    ];
    expect(menusWithTapDanceKeycodes(menus)).toEqual(menus);
  });
});
