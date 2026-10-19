import './setup';
import {describe, expect, test} from 'bun:test';
import type {VIADefinitionV3} from '@the-via/reader';
import {getByteToKey, getKeycodes} from '../src/utils/key';
import v13BasicKeyToByte from '../src/utils/key-to-byte/v13';
import {menusWithTapDanceKeycodes} from '../src/utils/keycode-menus';
import {
  buildKeycodeIndex,
  describeKeycodeValue,
  toPaletteKey,
} from '../src/utils/keycode-palette';
import {selectKeycodeFromMenuCode} from '../src/utils/keycode-picker';
import {getLabel} from '../src/utils/keyboard-rendering';
import {
  faceSize,
  keycapLegend,
  legendBaseline,
  legendEm,
  legendText,
  modifierLabel,
  type KeycapLegend,
  type LegendKey,
  type LegendModifier,
  type LegendName,
} from '../src/utils/keycap-legend';

const named = (code: string, name: string, shortName?: string): LegendKey => ({
  type: 'named',
  code,
  name,
  ...(shortName ? {shortName} : {}),
});

const combined = (
  kind: 'LT' | 'MT' | 'MOD',
  code: string,
  tap: LegendName,
  {
    layer = 0,
    modifiers = [],
    right = false,
  }: {
    layer?: number;
    modifiers?: LegendModifier[];
    right?: boolean;
  } = {},
): LegendKey => ({type: 'combined', kind, code, tap, layer, modifiers, right});

const A = {code: 'KC_A', name: 'A'};

/** Each line as it is drawn: text, size, baseline from the top or bottom, small. */
const drawn = ({lines}: KeycapLegend) =>
  lines.map(
    ({text, size, x, y, from, opacity}) =>
      `${text} ${size}px x${x} ${from} ${+y.toFixed(2)}${opacity < 1 ? ' small' : ''}`,
  );

/** Every line ends 2px short of the face's right edge, at 9px or more. */
const expectWhole = (code: string, {lines}: KeycapLegend, width = 1) => {
  const face = faceSize(width);
  for (const line of lines) {
    expect({
      code,
      text: line.text,
      fits: line.x + legendEm(line.text) * line.size <= face.width - 2,
      readable: line.size >= 9,
    }).toEqual({code, text: line.text, fits: true, readable: true});
  }
};

/**
 * On a 1u face the name stays inside the face and clear of the small legends: a
 * combo's modifiers over it, a hold, KP or a system under it.
 */
const expectClear = (code: string, {lines}: KeycapLegend) => {
  const height = faceSize(1).height;
  const drawnAt = lines.map((line) => {
    const baseline = legendBaseline(line, height);
    return {small: line.opacity < 1, top: baseline - 0.75 * line.size, baseline};
  });
  const smalls = drawnAt.filter((line) => line.small);
  for (const name of drawnAt.filter((line) => !line.small)) {
    expect({
      code,
      inside: name.top >= 0 && name.baseline <= height,
      clear: smalls.every(
        (small) => small.baseline <= name.top || name.baseline <= small.top,
      ),
    }).toEqual({code, inside: true, clear: true});
  }
};

describe('a keycap legend', () => {
  test('a letter or a digit takes the top left at 18px; a word sits in the middle at 13px, as in VIA', () => {
    expect(drawn(keycapLegend(named('KC_A', 'A')))).toEqual([
      'A 18px x4 top 17.5',
    ]);
    // Centred on its cap height: the baseline is 4.88px under the face's middle.
    expect(drawn(keycapLegend(named('KC_F3', 'F3')))).toEqual([
      'F3 13px x4 middle 4.88',
    ]);
    expect(drawn(keycapLegend(named('KC_ESC', 'Esc')))).toEqual([
      'Esc 13px x4 middle 4.88',
    ]);
    expect(drawn(keycapLegend(named('KC_ENT', 'Enter')))).toEqual([
      'Enter 13px x4 middle 4.88',
    ]);
    // A symbol is no letter: it sits in the middle too.
    expect(drawn(keycapLegend(named('KC_TRNS', '▽')))).toEqual([
      '▽ 18px x4 middle 6.75',
    ]);
  });

  test('a long name breaks at a space over two lines, then takes its short name', () => {
    expect(drawn(keycapLegend(named('KC_CAPS', 'Caps Lock')))).toEqual([
      'Caps 13px x4 middle -2.6',
      'Lock 13px x4 middle 12.35',
    ]);
    // Two lines of the full name come before a short name.
    expect(legendText(keycapLegend(named('KC_PGUP', 'Page Up', 'PgUp')))).toBe(
      'Page Up',
    );
    // "Screen" is too wide for 13px, so VIA's short name is used.
    expect(
      drawn(keycapLegend(named('KC_PSCR', 'Print Screen', 'Print'))),
    ).toEqual(['Print 13px x4 middle 4.88']);
    expect(drawn(keycapLegend(named('KC_BSPC', 'Backspace', 'Bksp')))).toEqual([
      'Bksp 13px x4 middle 4.88',
    ]);
    // Without a short name of VIA's, the app's own abbreviation.
    expect(legendText(keycapLegend(named('KC_MPRV', 'Previous')))).toBe('Prev');
  });

  test('a name that fits no legend size is set smaller, down to 10px, 9px only for what fits nothing larger, and never cut', () => {
    expect(drawn(keycapLegend(named('KC_MS_BTN1', 'Mouse Btn1')))).toEqual([
      'Mouse 11px x4 middle -2.2',
      'Btn1 11px x4 middle 10.45',
    ]);
    expect(drawn(keycapLegend(named('KC_LCAP', 'Locking Caps Lock')))).toEqual([
      'Locking 9px x4 middle -1.8',
      'Caps 9px x4 middle 8.55',
    ]);
    expect(legendText(keycapLegend(named('CUSTOM(3)', 'CUSTOM(3)')))).toBe(
      'Custom 3',
    );
  });

  test('a "\\n" name is a shifted pair at 14px, top and bottom, or two words at 13px', () => {
    expect(drawn(keycapLegend(named('KC_1', '!\n1')))).toEqual([
      '! 14px x4 top 14.5',
      '1 14px x4 bottom 4',
    ]);
    // A high or low glyph moves toward the middle, as on a printed keycap.
    expect(drawn(keycapLegend(named('KC_QUOT', '"\n\'')))).toEqual([
      '" 14px x4 top 16.6',
      "' 14px x4 bottom 7.15",
    ]);
    expect(drawn(keycapLegend(named('KC_COMM', '<\n,')))).toEqual([
      '< 14px x4 top 14.5',
      ', 14px x4 bottom 8.2',
    ]);
    // A lowercase letter of a host layout's pair is a glyph, not a word.
    expect(drawn(keycapLegend(named('KC_LBRC', 'é\nè')))).toEqual([
      'é 14px x4 top 14.5',
      'è 14px x4 bottom 4',
    ]);
    expect(drawn(keycapLegend(named('KC_NLCK', 'Num\nLock', 'N.Lck')))).toEqual(
      ['Num 13px x4 middle -2.6', 'Lock 13px x4 middle 12.35'],
    );
  });

  test('keypad keys say KP, layer keys show the layer over the function, arrows their arrow in the middle', () => {
    expect(drawn(keycapLegend(named('KC_P1', '1')))).toEqual([
      '1 18px x4 top 17.5',
      'KP 11px x4 bottom 4 small',
    ]);
    // A symbol sits in the middle of the room KP leaves it.
    expect(drawn(keycapLegend(named('KC_PMNS', '-')))).toEqual([
      '- 18px x4 middle 0.63',
      'KP 11px x4 bottom 4 small',
    ]);
    expect(drawn(keycapLegend(named('MO(1)', 'MO(1)')))).toEqual([
      'MO 11px x4 bottom 4 small',
      '1 18px x4 top 17.5',
    ]);
    // A layer past 9 is no single digit: it sits in the middle, over the function.
    expect(drawn(keycapLegend(named('TT(12)', 'TT(12)')))).toEqual([
      'TT 11px x4 bottom 4 small',
      '12 13px x4 middle -1.25',
    ]);
    expect(drawn(keycapLegend(named('KC_UP', 'Up', '↑')))).toEqual([
      '↑ 18px x4 middle 6.75',
    ]);
  });

  test('a lighting key names its system small, as a keypad key says KP', () => {
    expect(drawn(keycapLegend(named('RM_TOGG', 'RM Toggle')))).toEqual([
      'Toggle 11px x4 middle -2',
      'RM 11px x4 bottom 4 small',
    ]);
    // Two lines stop at 12px, in the middle of the room the small line leaves.
    expect(drawn(keycapLegend(named('RM_VALU', 'RM Bright +')))).toEqual([
      'Bright 12px x4 middle -8.52',
      '+ 12px x4 middle 5.28',
      'RM 11px x4 bottom 4 small',
    ]);
    // A key whose VIA name reads badly takes a name of its own.
    expect(legendText(keycapLegend(named('BL_BRTG', 'BR Toggle')))).toBe(
      'Breath BL',
    );
    expect(legendText(keycapLegend(named('RGB_M_SW', 'RGB Mode SW')))).toBe(
      'Swirl RGB',
    );
    // One too wide even at 9px is shortened.
    expect(drawn(keycapLegend(named('RGB_M_R', 'RGB Mode R')))).toEqual([
      'Rnbw 13px x4 middle -1.25',
      'RGB 11px x4 bottom 4 small',
    ]);
  });

  test('a hold sits small under the key a tap sends; a combo’s modifiers over its key', () => {
    const f3 = {code: 'KC_F3', name: 'F3'};
    expect(
      drawn(keycapLegend(combined('LT', 'LT(1,KC_F3)', f3, {layer: 1}))),
    ).toEqual(['F3 13px x4 middle -1.25', 'L1 11px x4 bottom 4 small']);
    // A long tap breaks over two lines, at 12px over the hold and 11px under a
    // combo's modifiers, in the middle of the room they leave.
    const stop = {code: 'KC_MSTP', name: 'Media Stop'};
    expect(
      drawn(keycapLegend(combined('LT', 'LT(1,KC_MSTP)', stop, {layer: 1}))),
    ).toEqual([
      'Media 12px x4 middle -8.52',
      'Stop 12px x4 middle 5.28',
      'L1 11px x4 bottom 4 small',
    ]);
    expect(
      drawn(
        keycapLegend(
          combined('MOD', 'C(KC_MSTP)', stop, {modifiers: ['CTL']}),
        ),
      ),
    ).toEqual([
      'Ctrl+ 11px x4 top 12.25 small',
      'Media 11px x4 middle 3.93',
      'Stop 11px x4 middle 16.57',
    ]);
    // A word under a combo's modifiers sits in the middle of the room under them;
    // a letter goes right under them.
    const esc = {code: 'KC_ESC', name: 'Esc'};
    expect(
      drawn(
        keycapLegend(combined('MOD', 'C(KC_ESC)', esc, {modifiers: ['CTL']})),
      ),
    ).toEqual(['Ctrl+ 11px x4 top 12.25 small', 'Esc 13px x4 middle 11']);
    // A shifted key taps its lower glyph; a long name takes its short one.
    expect(
      legendText(
        keycapLegend(
          combined(
            'LT',
            'LT(2,KC_1)',
            {code: 'KC_1', name: '!\n1'},
            {layer: 2},
          ),
        ),
      ),
    ).toBe('1 L2');
    expect(
      legendText(
        keycapLegend(
          combined(
            'LT',
            'LT(1,KC_NLCK)',
            {code: 'KC_NLCK', name: 'Num\nLock', shortName: 'N.Lck'},
            {layer: 1},
          ),
        ),
      ),
    ).toBe('N.Lck L1');
    expect(
      drawn(
        keycapLegend(
          combined('MT', 'MT(MOD_RCTL,KC_A)', A, {
            modifiers: ['CTL'],
            right: true,
          }),
        ),
      ),
    ).toEqual(['A 18px x4 top 17.5', 'RCtrl 11px x4 bottom 4 small']);
    expect(
      drawn(
        keycapLegend(
          combined('MOD', 'RCTL(KC_A)', A, {modifiers: ['CTL'], right: true}),
        ),
      ),
    ).toEqual(['RCtrl+ 11px x4 top 12.25 small', 'A 18px x4 top 32.95']);
    expect(
      legendText(
        keycapLegend(combined('MOD', 'C(KC_A)', A, {modifiers: ['CTL']})),
      ),
    ).toBe('Ctrl+A');
  });

  test('held modifiers shorten only as far as the face needs', () => {
    const held = (
      kind: 'MT' | 'MOD',
      modifiers: LegendModifier[],
      right = false,
      width = 1,
    ) =>
      keycapLegend(
        combined(kind, 'mods', A, {modifiers, right}),
        width,
      ).lines.find((line) => line.text !== 'A')!.text;
    expect(held('MT', ['CTL', 'SFT'])).toBe('Ctl+Sft');
    expect(held('MT', ['SFT', 'CTL'], false, 2)).toBe('Ctrl+Shift');
    expect(held('MT', ['CTL', 'SFT'], true)).toBe('RC+RS');
    expect(held('MOD', ['SFT'], true)).toBe('RSft+');
    expect(held('MOD', ['SFT'], true, 2)).toBe('RShift+');
    expect(held('MOD', ['CTL', 'SFT', 'ALT', 'GUI'])).toBe('CSAW+');
    expect(held('MT', ['CTL', 'SFT', 'ALT', 'GUI'])).toBe('CSAW');
    expect(modifierLabel('CTL', true)).toBe('RCtrl');
    expect(modifierLabel('GUI', false)).toBe('Win');
  });

  test('every set of held modifiers fits a 1u face, on either hand', () => {
    const all: LegendModifier[] = ['CTL', 'SFT', 'ALT', 'GUI'];
    for (let set = 1; set < 16; set++) {
      const modifiers = all.filter((_, bit) => set & (1 << bit));
      for (const right of [false, true]) {
        for (const kind of ['MT', 'MOD'] as const) {
          expectWhole(
            `${kind} ${modifiers.join('|')}${right ? ' right' : ''}`,
            keycapLegend(combined(kind, kind, A, {modifiers, right})),
          );
        }
      }
    }
    // Only the right hand's four initials with their + need a smaller size.
    expect(
      drawn(
        keycapLegend(
          combined('MOD', 'RCTL(RSFT(RALT(RGUI(KC_A))))', A, {
            modifiers: all,
            right: true,
          }),
        ),
      ),
    ).toEqual(['RCSAW+ 9px x4 top 10.75 small', 'A 18px x4 top 31.45']);
  });

  test('a wider key has room for the whole name', () => {
    expect(
      drawn(keycapLegend(named('KC_BSPC', 'Backspace', 'Bksp'), 2)),
    ).toEqual(['Backspace 13px x4 middle 4.88']);
    expect(faceSize(2.25, 1)).toEqual({width: 105, height: 42});
  });

  test('a line is measured from the top, middle or bottom of the face it is drawn on', () => {
    const [esc] = keycapLegend(named('KC_ESC', 'Esc')).lines;
    expect(legendBaseline(esc, faceSize(1).height)).toBe(25.875);
    // A key two units high centres its word on its own face.
    expect(legendBaseline(esc, faceSize(1, 2).height)).toBe(52.875);
    const [one, kp] = keycapLegend(named('KC_P1', '1')).lines;
    expect(legendBaseline(one, faceSize(1, 2).height)).toBe(17.5);
    expect(legendBaseline(kp, faceSize(1, 2).height)).toBe(92);
  });

  test('a blank key has no legend; a legend reads on one line', () => {
    expect(keycapLegend(named('KC_NO', ''))).toEqual({lines: []});
    expect(legendText(keycapLegend(named('KC_1', '!\n1')))).toBe('! 1');
    expect(legendText(keycapLegend(named('KC_CAPS', 'Caps Lock')))).toBe(
      'Caps Lock',
    );
  });

  test('every key a tap can send is drawn whole, clear of a hold or a combo’s modifiers', () => {
    const taps = getKeycodes()
      .flatMap((menu) => menu.keycodes)
      .filter(({code}) => (v13BasicKeyToByte[code] ?? 0x100) <= 0xff);
    expect(taps.length).toBeGreaterThan(150);
    for (const {code, name, shortName} of taps) {
      const tap = {code, name, shortName};
      for (const legend of [
        keycapLegend(combined('LT', 'LT', tap, {layer: 15})),
        keycapLegend(
          combined('MT', 'MT', tap, {modifiers: ['CTL', 'SFT', 'ALT', 'GUI']}),
        ),
        keycapLegend(
          combined('MOD', 'MOD', tap, {
            modifiers: ['CTL', 'SFT', 'ALT'],
            right: true,
          }),
        ),
      ]) {
        expectWhole(code, legend);
        expectClear(code, legend);
      }
    }
    expect(
      legendText(
        keycapLegend(
          combined(
            'LT',
            'LT(1,KC_CAPS)',
            {code: 'KC_CAPS', name: 'Caps Lock'},
            {layer: 1},
          ),
        ),
      ),
    ).toBe('Caps L1');
  });

  test('the keyboard and the keycode list draw a key alike', () => {
    const tapdanceKeycodes = [
      {name: 'TD0', title: 'Tap Dance 0', shortName: 'TD0'},
    ];
    const definition = {tapdanceKeycodes} as unknown as VIADefinitionV3;
    const byteToKey = getByteToKey(v13BasicKeyToByte);
    const index = buildKeycodeIndex(
      menusWithTapDanceKeycodes(getKeycodes(), tapdanceKeycodes),
      v13BasicKeyToByte,
    );
    const shown: Record<string, string> = {
      KC_A: 'A',
      KC_1: '! 1',
      'S(KC_1)': '!',
      KC_F3: 'F3',
      KC_ESC: 'Esc',
      'TD(0)': 'TD0',
      'MACRO(0)': 'M0',
      'MO(1)': 'MO 1',
      KC_P1: '1 KP',
      KC_NLCK: 'Num Lock',
      KC_CAPS: 'Caps Lock',
      KC_UP: '↑',
      'LT(1,KC_F3)': 'F3 L1',
      'MT(MOD_RCTL,KC_A)': 'A RCtrl',
      'RCTL(KC_A)': 'RCtrl+A',
      'C(KC_A)': 'Ctrl+A',
      'MT(MOD_LCTL|MOD_LSFT,KC_A)': 'A Ctl+Sft',
      RM_TOGG: 'Toggle RM',
    };
    for (const [code, text] of Object.entries(shown)) {
      const value = selectKeycodeFromMenuCode(code, v13BasicKeyToByte)!;
      const {lines} = getLabel(
        value,
        1,
        [],
        definition,
        v13BasicKeyToByte,
        byteToKey,
      );
      const listed = describeKeycodeValue(
        value,
        index,
        v13BasicKeyToByte,
        byteToKey,
      ).legend;
      expect({code, text: legendText({lines}), listed}).toEqual({
        code,
        text,
        listed: {lines},
      });
    }
    // The Layers menu's Layer-Tap keys are drawn in the list as on the keyboard.
    const layers = getKeycodes().find((menu) => menu.id === 'layers')!;
    const layerTaps = layers.keycodes.filter(({code}) =>
      code.startsWith('LT('),
    );
    expect(layerTaps.map(({code}) => code)).toEqual([
      'LT(1,KC_SPC)',
      'LT(2,KC_SPC)',
      'LT(3,KC_SPC)',
    ]);
    for (const keycode of layerTaps) {
      const value = selectKeycodeFromMenuCode(keycode.code, v13BasicKeyToByte)!;
      const {lines} = getLabel(
        value,
        1,
        [],
        definition,
        v13BasicKeyToByte,
        byteToKey,
      );
      expect({code: keycode.code, listed: toPaletteKey(keycode).legend}).toEqual(
        {code: keycode.code, listed: {lines}},
      );
    }
    expect(legendText(toPaletteKey(layerTaps[0]).legend)).toBe('Space L1');
    // A macro past the list's first sixteen is named by its number on both.
    const macro = selectKeycodeFromMenuCode('MACRO(16)', v13BasicKeyToByte)!;
    const keyboard = getLabel(
      macro,
      1,
      [],
      definition,
      v13BasicKeyToByte,
      byteToKey,
    );
    expect(legendText(keyboard)).toBe('M16');
    const thirtyTwo = buildKeycodeIndex(
      menusWithTapDanceKeycodes(getKeycodes(32), tapdanceKeycodes),
      v13BasicKeyToByte,
    );
    expect(
      describeKeycodeValue(macro, thirtyTwo, v13BasicKeyToByte, byteToKey)
        .legend,
    ).toEqual({lines: keyboard.lines});
  });

  test('only a macro key has a tooltip: what its macro types, its waits left out, or "…" until the macros are read', () => {
    const definition = {tapdanceKeycodes: []} as unknown as VIADefinitionV3;
    const byteToKey = getByteToKey(v13BasicKeyToByte);
    const tooltip = (
      code: string,
      macros: string[] | null = ['n{88}l{1}{KC_ENT}{100}', '{100}'],
    ) =>
      getLabel(
        selectKeycodeFromMenuCode(code, v13BasicKeyToByte)!,
        1,
        macros,
        definition,
        v13BasicKeyToByte,
        byteToKey,
      ).macro;
    expect(tooltip('MACRO(0)')).toBe('nl{KC_ENT}');
    // A macro that only waits, or one not set, types nothing to show.
    expect(tooltip('MACRO(1)')).toBeFalsy();
    expect(tooltip('MACRO(2)')).toBeFalsy();
    expect(tooltip('KC_A')).toBeFalsy();
    // Until the keyboard's macros are read, a macro key's tooltip says so.
    expect(tooltip('MACRO(0)', null)).toBe('…');
    expect(tooltip('KC_A', null)).toBeFalsy();
  });

  test('every key of every menu is drawn whole on a 1u face, at 9px or more, clear of its small legends', () => {
    for (const menu of getKeycodes()) {
      for (const {code, name, shortName} of menu.keycodes) {
        const legend = keycapLegend(named(code, name, shortName));
        expectWhole(code, legend);
        expectClear(code, legend);
      }
    }
  });
});
