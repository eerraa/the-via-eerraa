import {describe, expect, test} from 'bun:test';
import type {VIADefinitionV2} from '@the-via/reader';
import {getByteToKey, getKeycodes} from '../src/utils/key';
import {buildEnabledKeycodeMenus} from '../src/utils/keycode-menus';
import v13BasicKeyToByte from '../src/utils/key-to-byte/v13';
import {
  getTapDanceKeycodeDisabledReason,
  type TapDanceEligibilityContext,
} from '../src/utils/keycode-eligibility';
import {selectKeycodeFromMenuCode} from '../src/utils/keycode-picker';
import {keymapExtras} from '../src/utils/keymap-extras';
import {readFileSync} from 'node:fs';
import {
  buildBasicSections,
  buildCategorySections,
  buildComposeResult,
  buildKeycodeIndex,
  CATEGORY_GROUPS,
  COMPOSE_KINDS,
  COMPOSE_MODIFIERS,
  CONDENSED_WIDTH,
  describeKeycodeValue,
  editedTapDanceChanges,
  fitKeycapLegend,
  FACE_TEXT_WIDTH,
  fitLegend,
  legendEm,
  legendWidth,
  looksLikeKeycode,
  getTapDanceSlots,
  menuForLayerCount,
  pendingTapDanceChanges,
  planTapDanceWrites,
  searchPalette,
  tapDanceFieldOf,
  withTapDanceChanges,
  splitLegend,
  tapLegend,
  toPaletteKey,
  type PaletteKey,
  type TapDanceDraft,
} from '../src/utils/keycode-palette';

const basicMenu = getKeycodes().find((menu) => menu.id === 'basic')!;

const keysOf = (sections: ReturnType<typeof buildBasicSections>) =>
  sections.flatMap((section) =>
    section.rows.flatMap((row) =>
      row.filter((item): item is PaletteKey => item.kind === 'key'),
    ),
  );

describe('keycode palette layout', () => {
  test('the Basic keyboard layout places every Basic keycode exactly once', () => {
    const sections = buildBasicSections(basicMenu);
    const placed = keysOf(sections).map((key) => key.keycode.code);
    const expected = basicMenu.keycodes
      .map((keycode) => keycode.code)
      .filter((code) => code !== 'text');
    expect(placed.sort()).toEqual([...expected].sort());
    expect(new Set(placed).size).toBe(placed.length);
    // Nothing fell through to the catch-all: the layout covers today's Basic menu.
    expect(sections.map((section) => section.id)).not.toContain('other');
  });

  // The other long categories read as labelled groups, not one wall of keys.
  test('grouped categories place every keycode exactly once, with no leftovers', () => {
    for (const id of Object.keys(CATEGORY_GROUPS)) {
      const menu = getKeycodes().find((candidate) => candidate.id === id)!;
      const sections = buildCategorySections(menu);
      const placed = keysOf(sections).map((key) => key.keycode.code);
      const expected = menu.keycodes
        .map((keycode) => keycode.code)
        .filter((code) => code !== 'text');
      expect({id, placed: [...placed].sort()}).toEqual({
        id,
        placed: [...expected].sort(),
      });
      expect(new Set(placed).size).toBe(placed.length);
      expect({id, other: sections.some((section) => section.id.endsWith('-other'))}).toEqual({
        id,
        other: false,
      });
      expect(sections.every((section) => section.label !== '')).toBe(true);
    }
  });

  // A layer key is offered only for a layer the keyboard has: one key per layer under
  // each function, and the Fn keys whose layers are all there.
  const layerMenu = getKeycodes().find((menu) => menu.id === 'layers')!;
  const layerKeys = (layerCount: number | undefined) =>
    Object.fromEntries(
      buildCategorySections(menuForLayerCount(layerMenu, layerCount)).map(
        (section) => [
          section.label,
          section.rows.map((row) =>
            row.flatMap((item) =>
              item.kind === 'key' ? [item.keycode.code] : [],
            ),
          ),
        ],
      ),
    );
  const LAYER_FUNCTIONS = [
    'While held (MO)',
    'Toggle (TG)',
    'Hold or tap to toggle (TT)',
    'Next key only (OSL)',
    'Switch to (TO)',
    'Default layer (DF)',
  ];

  test('layer keys line up as one row per layer function, one key per layer the keyboard has', () => {
    const keys = layerKeys(4);
    expect(Object.keys(keys)).toEqual(['Fn keys', ...LAYER_FUNCTIONS]);
    expect(keys['Fn keys']).toEqual([
      ['FN_MO13', 'FN_MO23', 'LT(1,KC_SPC)', 'LT(2,KC_SPC)', 'LT(3,KC_SPC)'],
    ]);
    expect(keys['While held (MO)']).toEqual([
      ['MO(0)', 'MO(1)', 'MO(2)', 'MO(3)'],
    ]);
    for (const label of LAYER_FUNCTIONS) {
      expect({label, rows: keys[label].map((row) => row.length)}).toEqual({
        label,
        rows: [4],
      });
    }
  });

  test('a keyboard with fewer layers is offered no key that reaches past them', () => {
    // Without layer 3 the Fn keys that bring it up together go, and Space Fn3 too.
    const three = layerKeys(3);
    expect(three['Fn keys']).toEqual([['LT(1,KC_SPC)', 'LT(2,KC_SPC)']]);
    expect(three['Default layer (DF)']).toEqual([['DF(0)', 'DF(1)', 'DF(2)']]);
    // A group left with no key is not shown at all.
    const one = layerKeys(1);
    expect(Object.keys(one)).toEqual(LAYER_FUNCTIONS);
    expect(one['Toggle (TG)']).toEqual([['TG(0)']]);
    // Only the Layers category changes.
    expect(menuForLayerCount(basicMenu, 1)).toBe(basicMenu);
  });

  test('with the layer count unknown, the layer keys stay one row of ten per function', () => {
    for (const keys of [layerKeys(undefined), layerKeys(0)]) {
      expect(keys['Fn keys'][0]).toHaveLength(5);
      for (const label of LAYER_FUNCTIONS) {
        expect({label, rows: keys[label].map((row) => row.length)}).toEqual({
          label,
          rows: [10],
        });
      }
    }
    // A keyboard with more layers than the menu has keys for keeps all ten.
    expect(layerKeys(16)['While held (MO)'][0]).toHaveLength(10);
  });

  test('mouse keys split into rows by kind, and sound into its three features', () => {
    const special = getKeycodes().find((menu) => menu.id === 'special')!;
    const sections = buildCategorySections(special);
    const rowsOf = (id: string) =>
      sections
        .find((section) => section.id === `special-${id}`)!
        .rows.map((row) =>
          row.flatMap((item) => (item.kind === 'key' ? [item.keycode.code] : [])),
        );
    expect(rowsOf('mouse').map((row) => row.length)).toEqual([4, 8, 4, 3]);
    expect(rowsOf('mouse')[0]).toEqual([
      'KC_MS_UP',
      'KC_MS_DOWN',
      'KC_MS_LEFT',
      'KC_MS_RIGHT',
    ]);
    expect(
      ['audio', 'clicky', 'music'].map((id) => rowsOf(id)[0][0]),
    ).toEqual(['AU_ON', 'CLICKY_TOGGLE', 'MU_ON']);
  });

  // A group heading already names what its keys share, so the keys under it drop
  // that word; out of the group (search, the header, a Tap Dance slot) they keep it.
  test('keys do not repeat the word their group heading says', () => {
    const legendIn = (menuId: string, code: string) => {
      const menu = getKeycodes().find((candidate) => candidate.id === menuId)!;
      const key = keysOf(buildCategorySections(menu)).find(
        (candidate) => candidate.keycode.code === code,
      )!;
      return [key.top, key.bottom].filter(Boolean).join(' ');
    };
    expect(legendIn('special', 'KC_MS_BTN1')).toBe('Btn1');
    expect(legendIn('special', 'KC_MS_UP')).toBe('↑');
    expect(legendIn('special', 'KC_MS_WH_UP')).toBe('Wh ↑');
    expect(legendIn('special', 'AU_ON')).toBe('On');
    expect(legendIn('special', 'CLICKY_DISABLE')).toBe('Off');
    expect(legendIn('special', 'MU_MOD')).toBe('Mode');
    expect(legendIn('special', 'KC_LCAP')).toBe('Caps');
    expect(legendIn('layers', 'MO(1)')).toBe('1');
    expect(legendIn('layers', 'OSL(3)')).toBe('3');
    expect(legendIn('media', 'KC_MSTP')).toBe('Stop');
    expect(legendIn('qmk_lighting', 'RGB_TOG')).toBe('Toggle');
    expect(legendIn('qmk_lighting', 'RGB_M_SW')).toBe('Swirl');
    expect(legendIn('qmk_lighting', 'BL_BRTG')).toBe('Breath');
    expect(legendIn('qmk_lighting', 'UG_HUEU')).toBe('Hue +');
    expect(legendIn('qmk_lighting', 'BL_ON')).toBe('On');
    // A bare sign says nothing on its own.
    expect(legendIn('qmk_lighting', 'BL_DEC')).toBe('BL -');

    const mouse = getKeycodes()
      .find((menu) => menu.id === 'special')!
      .keycodes.find((keycode) => keycode.code === 'KC_MS_BTN1')!;
    expect(toPaletteKey(mouse)).toMatchObject({top: 'Mouse', bottom: 'Btn1'});
    for (const {menu, keys} of searchPalette(getKeycodes(), 'btn1')) {
      expect({menu: menu.id, top: keys[0].top}).toEqual({menu: 'special', top: 'Mouse'});
    }
  });

  // Every key is 1u. A legend is set at the keyboard's sizes when it fits the face
  // and is broken over two lines and set smaller when it does not, down to 9px;
  // VIA's short name or a palette legend covers the few that fit nowhere.
  test('every legend fits a 1u face', () => {
    for (const menu of getKeycodes()) {
      for (const key of keysOf(buildCategorySections(menu))) {
        const widest =
          Math.max(legendEm(key.top), legendEm(key.bottom)) *
          (key.condensed ? CONDENSED_WIDTH : 1);
        expect({code: key.keycode.code, fits: widest * key.size <= FACE_TEXT_WIDTH}).toEqual({
          code: key.keycode.code,
          fits: true,
        });
        expect(key.size).toBeGreaterThanOrEqual(9);
      }
    }
  });

  test('legends keep the keyboard sizes and shrink only when they must', () => {
    const legend = (menuId: string, code: string) => {
      const menu = getKeycodes().find((candidate) => candidate.id === menuId)!;
      const key = keysOf(buildCategorySections(menu)).find(
        (candidate) => candidate.keycode.code === code,
      )!;
      return {top: key.top, bottom: key.bottom, size: key.size};
    };
    expect(legend('basic', 'KC_A')).toEqual({top: 'A', bottom: '', size: 22});
    expect(legend('basic', 'KC_1')).toEqual({top: '!', bottom: '1', size: 16});
    expect(legend('media', 'KC_VOLD')).toEqual({top: 'Vol -', bottom: '', size: 13});
    expect(legend('basic', 'KC_BSPC')).toEqual({top: 'Bksp', bottom: '', size: 13});
    expect(legend('special', 'KC_MS_BTN1')).toMatchObject({top: 'Btn1', size: 13});
    expect(legend('special', 'KC_HAEN')).toMatchObject({top: '한영', size: 16});
    expect(legend('media', 'KC_MPRV')).toMatchObject({top: 'Prev'});
    expect(legend('special', 'MAGIC_UNSWAP_CTL_GUI')).toMatchObject({top: 'CG', bottom: 'Norm'});
    // An RGB preset shows its effect; the two that fit no size in the legend face are
    // condensed rather than clipped, and only those.
    expect(legend('qmk_lighting', 'RGB_M_P')).toEqual({top: 'Plain', bottom: '', size: 13});
    const presets = keysOf(
      buildCategorySections(getKeycodes().find((menu) => menu.id === 'qmk_lighting')!),
    ).filter((key) => key.keycode.code.startsWith('RGB_M_'));
    expect(presets.filter((key) => key.condensed).map((key) => key.top)).toEqual([
      'Rainbow',
      'Gradient',
    ]);
    expect(fitKeycapLegend('Mode', 'Rainbow')).toEqual({size: 9, condensed: true});
    expect(fitLegend('Favorites').size).toBe(9);
    expect(legendWidth('無変換')).toBeGreaterThan(4);
  });

  test('every group label is translated in all six catalogs', () => {
    const labels = Object.values(CATEGORY_GROUPS).flatMap((groups) =>
      groups.map(({label}) => label),
    );
    for (const lang of ['en', 'ko', 'ja', 'zh', 'de', 'es']) {
      const catalog = JSON.parse(
        readFileSync(`src/locales/${lang}.json`, 'utf8'),
      ) as Record<string, string>;
      for (const label of labels) {
        expect({lang, label, found: typeof catalog[label]}).toEqual({
          lang,
          label,
          found: 'string',
        });
      }
    }
  });

  test('a Basic keycode the layout does not know still shows up under Other', () => {
    const sections = buildBasicSections({
      ...basicMenu,
      keycodes: [...basicMenu.keycodes, {name: 'New', code: 'KC_NEW_KEY'}],
    });
    const other = sections.find((section) => section.id === 'other');
    expect(keysOf(other ? [other] : []).map((key) => key.keycode.code)).toEqual(
      ['KC_NEW_KEY'],
    );
  });

  test('legends stack like printed keycaps', () => {
    expect(splitLegend('!\n1')).toEqual({top: '!', bottom: '1'});
    expect(splitLegend('Print Screen')).toEqual({
      top: 'Print',
      bottom: 'Screen',
    });
    expect(splitLegend('MO(3)')).toEqual({top: 'MO', bottom: '3'});
    expect(splitLegend('Esc')).toEqual({top: 'Esc', bottom: ''});
    expect(tapLegend('!\n1')).toBe('1');
    expect(tapLegend('Print Screen')).toBe('Print Screen');
  });

  test('modifier keys keep their role and numpad digits say KP', () => {
    const keys = keysOf(buildBasicSections(basicMenu));
    const byCode = new Map(keys.map((key) => [key.keycode.code, key]));
    expect(byCode.get('KC_LSFT')).toMatchObject({top: 'Left', bottom: 'Shift', role: 'mod'});
    expect(byCode.get('KC_A')!.role).toBe('alpha');
    expect(byCode.get('KC_P1')).toMatchObject({top: '1', bottom: 'KP'});
    expect(byCode.get('KC_UP')).toMatchObject({top: '↑'});
    expect(byCode.get('KC_INS')).toMatchObject({top: 'Ins'});
  });

  // With every key 1u, holes keep Ins over Del and Up over Down.
  test('the editing cluster stays in columns at 1u', () => {
    const editing = buildBasicSections(basicMenu).find(
      (section) => section.id === 'editing',
    )!;
    const column = (row: number, code: string) => {
      let units = 0;
      for (const item of editing.rows[row]) {
        if (item.kind === 'key' && item.keycode.code === code) {
          return units;
        }
        units += item.kind === 'key' ? 1 : item.units;
      }
      return -1;
    };
    expect(column(1, 'KC_DEL')).toBe(column(0, 'KC_INS'));
    expect(column(1, 'KC_DOWN')).toBe(column(0, 'KC_UP'));
  });

  test('search covers every category and keeps hits under their category', () => {
    const menus = getKeycodes();
    const hits = searchPalette(menus, 'volume');
    expect(hits.length).toBeGreaterThan(0);
    for (const {menu, keys} of hits) {
      expect(menus).toContain(menu);
      expect(keys.length).toBeGreaterThan(0);
    }
    expect(searchPalette(menus, '   ')).toEqual([]);
  });
});

// The search box also takes a keycode as typed. Only input that reads as a code
// is offered as one; a word spelled in hex letters stays a search.
describe('typing a keycode into search', () => {
  test('codes, expressions and 0x hex read as keycodes', () => {
    for (const query of ['LT(1,KC_SPC)', 'kc_spc', 'MT(MOD_LCTL,KC_A)', '0x412C', ' 0x4 ']) {
      expect({query, code: looksLikeKeycode(query)}).toEqual({query, code: true});
    }
  });

  test('words stay searches, even hex-looking ones', () => {
    for (const query of ['space', 'fade', 'dead', 'Caps Lock', 'F13', '412C']) {
      expect({query, code: looksLikeKeycode(query)}).toEqual({query, code: false});
    }
  });
});

// The keyboard above names keys for the OS layout picked in its layout badge, and the
// palette names them the same way: on a German layout the key QMK calls KC_Y is Z.
describe('the host keyboard layout', () => {
  const german = keymapExtras.keymap_german.keycodeLUT;
  const special = getKeycodes().find((menu) => menu.id === 'special')!;
  const keycode = (code: string) =>
    [...basicMenu.keycodes, ...special.keycodes].find(
      (candidate) => candidate.code === code,
    )!;
  const legend = (key: PaletteKey) =>
    [key.top, key.bottom].filter(Boolean).join(' ');

  test('keys carry the layout’s names, so the letter rows read as its keyboard', () => {
    const letters = buildBasicSections(basicMenu, german).find(
      (section) => section.id === 'letters',
    )!;
    const rows = letters.rows.map((row) =>
      row.flatMap((item) => (item.kind === 'key' ? [legend(item)] : [])),
    );
    expect(rows[0].slice(0, 11)).toEqual([
      'Q', 'W', 'E', 'R', 'T', 'Z', 'U', 'I', 'O', 'P', 'Ü',
    ]);
    expect(rows[2][0]).toBe('Y');
    // Without a layout the palette keeps VIA's own names.
    expect(legend(toPaletteKey(keycode('KC_Y')))).toBe('Y');
    // A layout name is fitted on its own, not swapped for VIA's US short name.
    expect(toPaletteKey(keycode('KC_LCTL'), '', german)).toMatchObject({
      top: 'Left',
      bottom: 'Strg',
    });
  });

  test('the layout’s description is the tooltip when it says more than the keycap', () => {
    expect(toPaletteKey(keycode('KC_GRV'), '', german).keycode).toMatchObject({
      name: '°\n^',
      title: '◌̂ (dead) and ◌̊',
    });
    const us = keymapExtras.keymap_us.keycodeLUT;
    expect(toPaletteKey(keycode('KC_NUHS'), '', us).keycode).toMatchObject({
      name: '~\n#',
      title: 'Non-US # and ~',
    });
    // "z and Z", "1 and !" and a bare "!" only name what the keycap shows, so a
    // letter keeps no tooltip and Shift + 1 keeps VIA's own.
    expect(toPaletteKey(keycode('KC_Y'), '', german).keycode.title).toBeUndefined();
    expect(toPaletteKey(keycode('KC_1'), '', us).keycode.title).toBeUndefined();
    expect(toPaletteKey(keycode('S(KC_1)'), '', german).keycode).toMatchObject({
      name: '!',
      title: 'Shift + 1',
    });
    // Greek "σ and Σ" too: run together and lowercased, "σΣ" would end in a final ς.
    const greek = keymapExtras.keymap_greek.keycodeLUT;
    expect(toPaletteKey(keycode('KC_S'), '', greek).keycode.title).toBeUndefined();
  });

  test('search finds a key by its layout name as well as by its code and US name', () => {
    const found = (query: string, layout?: typeof german) =>
      searchPalette(getKeycodes(), query, layout).flatMap(({keys}) =>
        keys.map((key) => key.keycode.code),
      );
    expect(found('ü', german)).toContain('KC_LBRC');
    expect(found('ü')).not.toContain('KC_LBRC');
    expect(found('lbrc', german)).toContain('KC_LBRC');
    expect(found('[', german)).toContain('KC_LBRC');
    expect(found('z', german)).toEqual(
      expect.arrayContaining(['KC_Y', 'KC_Z']),
    );
    // A hit shows the key as the layout names it.
    const [hit] = searchPalette(getKeycodes(), 'ü', german).flatMap(
      ({keys}) => keys.filter((key) => key.keycode.code === 'KC_LBRC'),
    );
    expect(legend(hit)).toBe('Ü');
  });

  // One description serves the palette's header, Tap Dance summaries and footer and
  // the button of a keycode setting: its legend, its name and the code behind it.
  test('a value is described with the palette’s legend and its code', () => {
    const index = buildKeycodeIndex(getKeycodes(), v13BasicKeyToByte);
    const byteToKey = getByteToKey(v13BasicKeyToByte);
    const describe = (value: number, layout?: typeof german) =>
      describeKeycodeValue(value, index, v13BasicKeyToByte, byteToKey, layout);
    expect(describe(0x4f)).toMatchObject({
      top: '→',
      bottom: '',
      name: 'Right',
      code: 'KC_RGHT',
    });
    expect(describe(0xe1)).toMatchObject({
      top: 'Left',
      bottom: 'Shift',
      code: 'KC_LSFT',
    });
    expect(describe(0x00)).toMatchObject({top: '', bottom: '', code: 'KC_NO'});
    expect(describe(0x1c, german)).toMatchObject({
      top: 'Z',
      name: 'Z',
      code: 'KC_Y',
    });
    expect(describe(0x35, german)).toMatchObject({
      top: '°',
      bottom: '^',
      title: '◌̂ (dead) and ◌̊',
      code: 'KC_GRV',
    });
    // A value no key in the palette has is named by its QMK expression.
    expect(describe(0x0104)).toMatchObject({
      name: 'C(KC_A)',
      title: '',
      code: 'C(KC_A)',
    });
  });
});

describe('combined keys', () => {
  const A = basicMenu.keycodes.find((keycode) => keycode.code === 'KC_A')!;

  test('Layer-Tap shows the tap key over its layer', () => {
    expect(buildComposeResult('LT', A, 1, [], v13BasicKeyToByte)).toEqual({
      value: 0x4104,
      code: 'LT(1,KC_A)',
      top: 'A',
      bottom: 'L1',
    });
  });

  test('Mod-Tap and a modified key need at least one modifier', () => {
    expect(buildComposeResult('MT', A, 0, [], v13BasicKeyToByte).value).toBe(
      null,
    );
    expect(
      buildComposeResult('MT', A, 0, ['LSFT', 'LCTL'], v13BasicKeyToByte),
    ).toEqual({
      value: 0x2304,
      code: 'MT(MOD_LCTL|MOD_LSFT,KC_A)',
      top: 'A',
      bottom: 'C+S',
    });
    expect(
      buildComposeResult('MOD', A, 0, ['LCTL'], v13BasicKeyToByte),
    ).toEqual({value: 0x0104, code: 'LCTL(KC_A)', top: 'Ctrl+', bottom: 'A'});
  });

  test('the result legend fits a 1u keycap, shortening only what overflows', () => {
    const key = (code: string) =>
      basicMenu.keycodes.find((keycode) => keycode.code === code)!;
    expect(
      buildComposeResult('MT', key('KC_ESC'), 0, ['LALT'], v13BasicKeyToByte),
    ).toMatchObject({top: 'Esc', bottom: 'Alt'});
    expect(
      buildComposeResult('LT', key('KC_BSPC'), 1, [], v13BasicKeyToByte),
    ).toMatchObject({top: 'Bksp', bottom: 'L1'});
    expect(
      buildComposeResult('LT', key('KC_CAPS'), 1, [], v13BasicKeyToByte),
    ).toMatchObject({top: 'Caps'});
    expect(
      buildComposeResult('MOD', A, 0, [...COMPOSE_MODIFIERS], v13BasicKeyToByte),
    ).toMatchObject({top: 'CSAW+', bottom: 'A'});

    // Every Basic tap key under every non-empty set of modifiers, in every kind.
    for (const tap of basicMenu.keycodes) {
      for (let mask = 1; mask < 1 << COMPOSE_MODIFIERS.length; mask++) {
        const held = COMPOSE_MODIFIERS.filter((_, bit) => mask & (1 << bit));
        for (const kind of COMPOSE_KINDS) {
          const {top, bottom} = buildComposeResult(
            kind,
            tap,
            7,
            held,
            v13BasicKeyToByte,
          );
          const {size, condensed} = fitKeycapLegend(top, bottom);
          expect(condensed).toBe(false);
          const widest = Math.max(legendEm(top), legendEm(bottom));
          expect({tap: tap.code, kind, held, fits: widest * size <= FACE_TEXT_WIDTH})
            .toEqual({tap: tap.code, kind, held, fits: true});
        }
      }
    }
  });

  test('nothing is produced before a tap key is chosen', () => {
    expect(
      buildComposeResult('LT', null, 2, [], v13BasicKeyToByte),
    ).toMatchObject({value: null, code: 'LT(2,kc)'});
  });
});

describe('Tap Dance slots', () => {
  const definition = JSON.parse(
    require('node:fs').readFileSync(
      'public/definitions/era/v3/1163042818.json',
      'utf8',
    ),
  );

  const contextFor = (engine: 'qmk' | 'h7s'): TapDanceEligibilityContext => ({
    engine,
    basicKeyToByte: v13BasicKeyToByte,
    layerCount: 8,
    macroCount: 16,
    tapDanceCount: 8,
    availableKeycodes: new Set(
      buildEnabledKeycodeMenus({
        definition,
        basicKeyToByte: v13BasicKeyToByte,
        macroCount: 16,
      }).flatMap((menu) =>
        menu.keycodes.flatMap((keycode) => {
          const value = selectKeycodeFromMenuCode(keycode.code, v13BasicKeyToByte);
          return value === null ? [] : [value];
        }),
      ),
    ),
  });

  test('both ERA engines accept action families and dispatch available quantum keys', () => {
    for (const engine of ['qmk', 'h7s'] as const) {
      const context = contextFor(engine);
      for (const value of [
        0,
        v13BasicKeyToByte.KC_A,
        v13BasicKeyToByte.KC_F13,
        v13BasicKeyToByte.KC_MPLY,
        v13BasicKeyToByte.KC_VOLU,
        ...Array.from({length: 8}, (_, index) => 0xe0 + index),
        0x0104, // modified basic
        0x2104, // Mod-Tap
        0x4104, // Layer-Tap
        0x5021, // layer 1 + Left Ctrl
        0x5201, // TO(1)
        0x5221, // MO(1)
        0x5241, // DF(1)
        0x5261, // TG(1)
        0x5281, // OSL(1)
        0x52a1, // OSM(MOD_LCTL)
        0x52c1, // TT(1)
        0x7700, // VIA macro 0
        0x770f, // last available macro
        v13BasicKeyToByte.RESET,
        v13BasicKeyToByte.QK_CLEAR_EEPROM,
      ]) {
        expect(getTapDanceKeycodeDisabledReason(value, context)).toBeNull();
      }
      // A definition-declared Custom key takes the same quantum/user dispatch.
      context.availableKeycodes = new Set([...context.availableKeycodes, 0x7e08]);
      expect(getTapDanceKeycodeDisabledReason(0x7e08, context)).toBeNull();
    }
  });

  test('both ERA engines reject recursive dances, absent slots and reserved codes', () => {
    for (const engine of ['qmk', 'h7s'] as const) {
      const context = contextFor(engine);
      for (const value of [0x7e00, 0x7e07, 0x5700, 0x5707, 0x57ff]) {
        expect(getTapDanceKeycodeDisabledReason(value, context)).toBe(
          'recursive-tapdance',
        );
      }
      for (const value of [0x4804, 0x5101, 0x5208, 0x5228, 0x5248, 0x5268, 0x5288, 0x52c8]) {
        expect(getTapDanceKeycodeDisabledReason(value, context)).toBe(
          'unavailable-layer',
        );
      }
      expect(getTapDanceKeycodeDisabledReason(0x7710, context)).toBe('unavailable-macro');
      expect(getTapDanceKeycodeDisabledReason(0x7700, {...context, macroCount: null})).toBe('unavailable-macro');
      for (const value of [0x00ff, 0xabcd, 0x7e08, 0x7eff, 0x01ff, 0x3004, 0x5000, 0x52a0]) {
        expect(getTapDanceKeycodeDisabledReason(value, context)).toBe('unavailable-keycode');
      }
      expect(getTapDanceKeycodeDisabledReason(1, context)).toBe('tapdance-no-action');
      expect(getTapDanceKeycodeDisabledReason(4, {...context, engine: null})).toBe('unverified-tapdance');
    }
  });

  test('Apply validates changed actions without rewriting unknown values already read', () => {
    const [slot] = getTapDanceSlots(definition);
    const current: TapDanceDraft = {
      actions: {tap: 0xabcd, hold: 0x7e07, dtap: 0x00ff, thold: 0},
      term: '200',
    };
    const context = contextFor('qmk');
    const reason = (value: number | null) => getTapDanceKeycodeDisabledReason(value, context);
    const bounds = {minMs: 1, maxMs: 65535};
    expect(planTapDanceWrites(slot, current, current, bounds, reason)).toEqual([]);
    expect(planTapDanceWrites(slot, {...current, term: '137'}, current, bounds, reason)).toEqual([
      {name: slot.term!.name, channel: slot.term!.channel, id: slot.term!.id, value: 137},
    ]);
    expect(current.actions).toEqual({tap: 0xabcd, hold: 0x7e07, dtap: 0x00ff, thold: 0});
    for (const value of [0xabce, 0x7e06, 0x7710, 0x4804, NaN, -1, 0x10004]) {
      expect(planTapDanceWrites(slot, {
        actions: {...current.actions, tap: value},
        term: '137',
      }, current, bounds, reason)).toBeNull();
    }
    expect(planTapDanceWrites(slot, {
      actions: {...current.actions, tap: v13BasicKeyToByte.KC_MPLY},
      term: '200',
    }, current, bounds, reason)).toEqual([
      {name: slot.actions.tap.name, channel: slot.actions.tap.channel, id: slot.actions.tap.id, value: 0x00ae},
    ]);
  });

  test('slots come from the TD keycodes, roles from the firmware command names', () => {
    const slots = getTapDanceSlots(definition);
    expect(slots.map((slot) => slot.code)).toEqual(
      Array.from({length: 8}, (_, index) => `TD(${index})`),
    );
    expect(slots[0].actions.tap).toMatchObject({
      name: 'id_qmk_tapdance_1_tap',
      channel: 0,
      id: 32,
    });
    expect(slots[7].actions.thold.id).toBe(70);
    expect(slots[7].term).toMatchObject({
      name: 'id_qmk_tapdance_8_term_exact',
      id: 79,
      options: [1, 65535],
    });
  });

  test('a TD without all four actions is not offered for editing', () => {
    const [first] = definition.tapdanceKeycodes;
    const slots = getTapDanceSlots({
      tapdanceKeycodes: [
        {...first, controls: first.controls.slice(1)},
        definition.tapdanceKeycodes[1],
      ],
    });
    expect(slots.map((slot) => slot.index)).toEqual([1]);
  });

  test('Apply sends only what changed, in slot order, and never an invalid term', () => {
    const [slot] = getTapDanceSlots(definition);
    const current: TapDanceDraft = {
      actions: {tap: 0x29, hold: 0xe0, dtap: 0, thold: 0},
      term: '200',
    };
    const bounds = {minMs: 1, maxMs: 65535};
    expect(planTapDanceWrites(slot, current, current, bounds)).toEqual([]);
    expect(
      planTapDanceWrites(
        slot,
        {actions: {...current.actions, dtap: 0x4104, hold: 0x04}, term: '180'},
        current,
        bounds,
      ),
    ).toEqual([
      {name: 'id_qmk_tapdance_1_hold', channel: 0, id: 33, value: 0x04},
      {name: 'id_qmk_tapdance_1_dtap', channel: 0, id: 34, value: 0x4104},
      {name: 'id_qmk_tapdance_1_term_exact', channel: 0, id: 72, value: 180},
    ]);
    for (const term of ['', '0', '65536', '12.5', 'abc']) {
      expect(
        planTapDanceWrites(slot, {...current, term}, current, bounds),
      ).toBeNull();
    }
  });

  // A draft holds only what the user changed, so the fields left alone keep
  // following the keyboard, and one set back to the keyboard's value is no change.
  test('a draft is the changed fields over what the keyboard holds', () => {
    const [slot] = getTapDanceSlots(definition);
    const current: TapDanceDraft = {
      actions: {tap: 0x29, hold: 0xe0, dtap: 0, thold: 0},
      term: '200',
    };
    const changes = {tap: 0x29, dtap: 0x04, term: '180'};
    expect(pendingTapDanceChanges(changes, current)).toEqual({
      dtap: 0x04,
      term: '180',
    });
    expect(withTapDanceChanges(current, {dtap: 0x04, term: '180'})).toEqual({
      actions: {tap: 0x29, hold: 0xe0, dtap: 0x04, thold: 0},
      term: '180',
    });
    expect(pendingTapDanceChanges({term: '200'}, current)).toEqual({});
    // A write names its field by command, as the keyboard does.
    expect(tapDanceFieldOf(slot, 'id_qmk_tapdance_1_dtap')).toBe('dtap');
    expect(tapDanceFieldOf(slot, 'id_qmk_tapdance_1_term_exact')).toBe('term');
    expect(tapDanceFieldOf(slot, 'id_qmk_tapdance_2_tap')).toBeNull();
  });

  // The keyboard's values show a write on its way before the keyboard has taken it,
  // so an edit weighs against them only the fields it set.
  test('an edit keeps the fields it left as they were, even where the keyboard reads the same', () => {
    // Double Tap B is on its way; the keyboard's values already show it.
    const current: TapDanceDraft = {
      actions: {tap: 0x29, hold: 0xe0, dtap: 0x05, thold: 0},
      term: '200',
    };
    expect(
      editedTapDanceChanges({dtap: 0x05, term: '180'}, {dtap: 0x05}, current),
    ).toEqual({dtap: 0x05, term: '180'});
    // A field set back to the keyboard's value is no change; one left out is gone.
    expect(
      editedTapDanceChanges(
        {tap: 0x29, dtap: 0x05, term: '200'},
        {tap: 0x04, dtap: 0x05, term: '180'},
        current,
      ),
    ).toEqual({dtap: 0x05});
    expect(editedTapDanceChanges({}, {dtap: 0x05}, current)).toEqual({});
    expect(
      editedTapDanceChanges({term: '200'}, {term: '200'}, current),
    ).toEqual({term: '200'});
  });

  // For the same reason a field changed and then set to the value on its way again
  // is still a change, until the keyboard answers that write.
  test('an edit keeps a field set to the value on its way', () => {
    // Double Tap B and a term of 180 are on their way.
    const current: TapDanceDraft = {
      actions: {tap: 0x29, hold: 0xe0, dtap: 0x05, thold: 0},
      term: '180',
    };
    const sending = {dtap: 0x05, term: '180'};
    expect(
      editedTapDanceChanges({dtap: 0x05}, {dtap: 0x06}, current, sending),
    ).toEqual({dtap: 0x05});
    expect(
      editedTapDanceChanges({term: '180'}, {term: '18'}, current, sending),
    ).toEqual({term: '180'});
    // Any other field set back to the keyboard's value is still no change.
    expect(
      editedTapDanceChanges({tap: 0x29}, {tap: 0x04}, current, sending),
    ).toEqual({});
  });
});

describe('categories a keyboard is offered', () => {
  // A keyboard on VIA before protocol 11 uses a V2 definition, whose lighting
  // type names the one set of lighting keycodes its firmware knows.
  const v2Board = (lighting: string) =>
    ({
      name: 'V2 board',
      vendorProductId: 0x12340002,
      lighting,
      matrix: {rows: 1, cols: 1},
      layouts: {keys: [], labels: [], optionKeys: {}, width: 1, height: 1},
    }) as unknown as VIADefinitionV2;
  const menusFor = (definition: VIADefinitionV2, macroCount?: number | null) =>
    buildEnabledKeycodeMenus({
      definition,
      basicKeyToByte: v13BasicKeyToByte,
      protocol: 9,
      macroCount,
    });
  const lightingTabs = (lighting: string) =>
    menusFor(v2Board(lighting))
      .filter((menu) => menu.label === 'Lighting')
      .map((menu) => menu.id);

  test('an old-VIA keyboard gets one Lighting tab, the one its keycodes use', () => {
    for (const lighting of [
      'qmk_backlight',
      'qmk_rgblight',
      'qmk_backlight_rgblight',
    ]) {
      expect({lighting, tabs: lightingTabs(lighting)}).toEqual({
        lighting,
        tabs: ['qmk_lighting'],
      });
    }
    for (const lighting of ['wt_rgb_backlight', 'wt_mono_backlight']) {
      expect({lighting, tabs: lightingTabs(lighting)}).toEqual({
        lighting,
        tabs: ['wt_lighting'],
      });
    }
    expect(lightingTabs('none')).toEqual([]);
  });

  test('a keyboard without macros gets no Macro tab', () => {
    const board = v2Board('none');
    expect(menusFor(board, null).map((menu) => menu.id)).not.toContain('macro');
    // While the count is still being read the tab stays, so it does not blink.
    expect(menusFor(board, 0).map((menu) => menu.id)).toContain('macro');
    expect(
      menusFor(board, 3)
        .find((menu) => menu.id === 'macro')
        ?.keycodes.map(({code}) => code),
    ).toEqual(['MACRO(0)', 'MACRO(1)', 'MACRO(2)']);
  });
});
