// Pure layout and lookup rules behind the keycode palette. The palette is the one
// keycode chooser for both KEYMAP and V3 `keycode` controls, so everything here is
// independent of where it is shown.

import type {TFunction} from 'i18next';
import {keycodesList, type IKeycode, type IKeycodeMenu} from './key';
import type {KeycodeLUT} from './keymap-extras';
import {
  composeLayerTap,
  composeModTap,
  composeModifiers,
  formatKeycodeLabel,
  keycodeMatchesQuery,
  selectKeycodeFromMenuCode,
} from './keycode-picker';
import {getTapDanceKeycodes, type EraTapDanceKeycode} from './era-definition';
import type {KeycodeDisabledReason} from './keycode-eligibility';
import {ERA_WIRE} from './era-wire.generated';
import {
  keycapLegend,
  type KeycapLegend,
  type LegendModifier,
} from './keycap-legend';

type KeycapRole = 'alpha' | 'mod';

/** Every key is one unit wide, its legend set as the keyboard sets it. */
export type PaletteKey = {
  kind: 'key';
  keycode: IKeycode;
  legend: KeycapLegend;
  role: KeycapRole;
};

type PaletteGap = {kind: 'gap'; units: number};

export type PaletteItem = PaletteKey | PaletteGap;

type PaletteSection = {
  id: string;
  /** English source text for t(); empty when the category name says enough. */
  label: string;
  rows: PaletteItem[][];
};

// Row gaps: a short separator between key groups, or a full 1u hole that keeps
// columns aligned (Ins over Del, the arrow cluster) now that every key is 1u.
const GROUP = 0.3;
const HOLE = 1;
type Token = string | {gap: number};
const g = (units: number) => ({gap: units});

const MOD_ROLE = new Set([
  'KC_ESC',
  'KC_TAB',
  'KC_CAPS',
  'KC_ENT',
  'KC_BSPC',
  'KC_LSFT',
  'KC_RSFT',
  'KC_LCTL',
  'KC_RCTL',
  'KC_LGUI',
  'KC_RGUI',
  'KC_LALT',
  'KC_RALT',
  'KC_APP',
]);

const range = (prefix: string, from: number, to: number) =>
  Array.from({length: to - from + 1}, (_, index) => `${prefix}${from + index}`);
const letters = (chars: string) => chars.split('').map((char) => `KC_${char}`);

/**
 * The Basic category laid out like a keyboard: function row, number row, the
 * three letter rows in QWERTY order, modifiers, editing keys around the arrow
 * cluster, numpad. Anything the menu has that is not placed here still appears
 * under "Other", so a new Basic keycode can never go missing.
 */
export const BASIC_LAYOUT: {id: string; label: string; rows: Token[][]}[] = [
  {
    id: 'function',
    label: 'Esc · Function',
    rows: [
      [
        'KC_ESC',
        g(GROUP),
        ...range('KC_F', 1, 4),
        g(GROUP),
        ...range('KC_F', 5, 8),
        g(GROUP),
        ...range('KC_F', 9, 12),
        g(GROUP),
        'KC_PSCR',
        'KC_SLCK',
        'KC_PAUS',
      ],
    ],
  },
  {
    id: 'numbers',
    label: 'Number row',
    rows: [['KC_GRV', ...range('KC_', 1, 9), 'KC_0', 'KC_MINS', 'KC_EQL']],
  },
  {
    id: 'letters',
    label: 'Letters',
    rows: [
      [...letters('QWERTYUIOP'), 'KC_LBRC', 'KC_RBRC', 'KC_BSLS'],
      [...letters('ASDFGHJKL'), 'KC_SCLN', 'KC_QUOT'],
      [...letters('ZXCVBNM'), 'KC_COMM', 'KC_DOT', 'KC_SLSH'],
    ],
  },
  {
    id: 'modifiers',
    label: 'Modifiers',
    rows: [
      [
        'KC_LCTL',
        'KC_LGUI',
        'KC_LALT',
        'KC_LSFT',
        g(GROUP),
        'KC_RSFT',
        'KC_RALT',
        'KC_RGUI',
        'KC_RCTL',
      ],
    ],
  },
  {
    id: 'editing',
    label: 'Editing & navigation',
    rows: [
      [
        'KC_TAB',
        'KC_CAPS',
        'KC_ENT',
        'KC_BSPC',
        g(GROUP),
        'KC_INS',
        'KC_HOME',
        'KC_PGUP',
        g(GROUP),
        g(HOLE),
        'KC_UP',
      ],
      [
        'KC_SPC',
        'KC_APP',
        g(HOLE),
        g(HOLE),
        g(GROUP),
        'KC_DEL',
        'KC_END',
        'KC_PGDN',
        g(GROUP),
        'KC_LEFT',
        'KC_DOWN',
        'KC_RGHT',
      ],
    ],
  },
  {
    id: 'numpad',
    label: 'Numpad',
    rows: [
      [
        'KC_NLCK',
        'KC_PSLS',
        'KC_PAST',
        'KC_PMNS',
        'KC_PPLS',
        'KC_PDOT',
        'KC_PCMM',
        'KC_PEQL',
        'KC_PENT',
        g(GROUP),
        ...range('KC_P', 1, 9),
        'KC_P0',
      ],
    ],
  },
  {id: 'blank', label: 'Blank & pass-through', rows: [['KC_NO', 'KC_TRNS']]},
];

// "z and Z", "1 and !": a layout description that names only what the keycap shows.
// Glyph by glyph: lowercased as one word, "σΣ" would end in a final "ς".
const namesOnlyKeycap = (title: string, name: string) => {
  const shown = name.toLowerCase();
  return [...title.replace(/ and /g, '').replace(/\s/g, '')].every((glyph) =>
    shown.includes(glyph.toLowerCase()),
  );
};

/**
 * A keycode named for the OS layout picked in the layout badge, as the keyboard
 * drawn above names it: on a German layout KC_Y is "Z". The layout's description
 * is its tooltip when it says more than the keycap ("◌̂ (dead) and ◌̊").
 */
const inHostLayout = (keycode: IKeycode, layout?: KeycodeLUT): IKeycode => {
  const entry = layout?.[keycode.code];
  if (!entry) {
    return keycode;
  }
  return {
    ...keycode,
    name: entry.name,
    // A short name abbreviates the US name, not the layout's.
    shortName: undefined,
    title:
      entry.title && !namesOnlyKeycap(entry.title, entry.name)
        ? entry.title
        : keycode.title,
  };
};

// A Layer-Tap key a menu lists, such as VIA's Space Fn1.
const MENU_LAYER_TAP = /^LT\((\d+),(\w+)\)$/;

export const toPaletteKey = (
  menuKeycode: IKeycode,
  layout?: KeycodeLUT,
): PaletteKey => {
  const keycode = inHostLayout(menuKeycode, layout);
  const {code, name, shortName} = keycode;
  // Drawn as the keyboard draws it: Space with L1 under it, not "Space Fn1".
  const layerTap = MENU_LAYER_TAP.exec(code);
  const tap =
    layerTap && keycodesList.find((candidate) => candidate.code === layerTap[2]);
  return {
    kind: 'key',
    keycode,
    legend:
      layerTap && tap
        ? combinedLegend(
            {
              kind: 'LT',
              tap,
              layer: Number(layerTap[1]),
              modifiers: [],
              right: false,
            },
            code,
            layout,
          )
        : keycapLegend({type: 'named', code, name, shortName}),
    role: MOD_ROLE.has(code) ? 'mod' : 'alpha',
  };
};

export const buildBasicSections = (
  basic: IKeycodeMenu,
  layout?: KeycodeLUT,
): PaletteSection[] => {
  const byCode = new Map(
    basic.keycodes.map((keycode) => [keycode.code, keycode]),
  );
  const placed = new Set<string>();
  const sections = BASIC_LAYOUT.map(({id, label, rows}) => ({
    id,
    label,
    rows: rows
      .map((row) =>
        row.flatMap((token): PaletteItem[] => {
          if (typeof token !== 'string') {
            return [{kind: 'gap', units: token.gap}];
          }
          const keycode = byCode.get(token);
          if (!keycode) {
            return [];
          }
          placed.add(token);
          return [toPaletteKey(keycode, layout)];
        }),
      )
      .filter((row) => row.some((item) => item.kind === 'key')),
  })).filter((section) => section.rows.length > 0);
  const other = basic.keycodes.filter(
    (keycode) => keycode.code !== 'text' && !placed.has(keycode.code),
  );
  if (other.length > 0) {
    sections.push({
      id: 'other',
      label: 'Other',
      rows: [other.map((keycode) => toPaletteKey(keycode, layout))],
    });
  }
  return sections;
};

type KeycodeTest = (code: string) => boolean;

type CategoryGroup = {
  id: string;
  /** English source text for t(). */
  label: string;
  match: KeycodeTest;
  /** Splits the group into rows by kind; keys no row claims form a last row. */
  rows?: KeycodeTest[];
};

const startsWith =
  (...prefixes: string[]): KeycodeTest =>
  (code) =>
    prefixes.some((prefix) => code.startsWith(prefix));
const oneOf = (...codes: string[]): KeycodeTest => {
  const set = new Set(codes);
  return (code) => set.has(code);
};

/**
 * The other long categories grouped by what the keys do, so a category reads as a
 * few labelled groups instead of one wall of keys. Groups keep the menu's own key
 * order, and a key no group claims still appears under "Other".
 */
export const CATEGORY_GROUPS: Record<string, CategoryGroup[]> = {
  layers: [
    {id: 'fn', label: 'Fn keys', match: startsWith('FN_MO', 'LT(')},
    {id: 'mo', label: 'While held (MO)', match: startsWith('MO(')},
    {id: 'tg', label: 'Toggle (TG)', match: startsWith('TG(')},
    {id: 'tt', label: 'Hold or tap to toggle (TT)', match: startsWith('TT(')},
    {id: 'osl', label: 'Next key only (OSL)', match: startsWith('OSL(')},
    {id: 'to', label: 'Switch to (TO)', match: startsWith('TO(')},
    {id: 'df', label: 'Default layer (DF)', match: startsWith('DF(')},
  ],
  special: [
    {id: 'shifted', label: 'Shifted symbols', match: startsWith('S(')},
    {
      id: 'international',
      label: 'International',
      match: oneOf(
        'KC_NUHS',
        'KC_NUBS',
        'KC_RO',
        'KC_JYEN',
        'KC_MHEN',
        'KC_HANJ',
        'KC_HAEN',
        'KC_HENK',
        'KC_KANA',
      ),
    },
    {
      id: 'dual',
      label: 'Grave Escape · Space Cadet',
      match: oneOf(
        'KC_GESC',
        'KC_LSPO',
        'KC_RSPC',
        'KC_LCPO',
        'KC_RCPC',
        'KC_LAPO',
        'KC_RAPC',
        'KC_SFTENT',
      ),
    },
    {
      id: 'f13',
      label: 'F13–F24',
      match: (code) => /^KC_F(1[3-9]|2[0-4])$/.test(code),
    },
    {
      id: 'locking',
      label: 'Locking keys',
      match: oneOf('KC_LNUM', 'KC_LCAP', 'KC_LSCR'),
    },
    {
      id: 'power',
      label: 'Power',
      match: oneOf('KC_PWR', 'KC_POWER', 'KC_SLEP', 'KC_WAKE'),
    },
    {
      id: 'apps',
      label: 'Apps · Editing',
      match: oneOf(
        'KC_CALC',
        'KC_MAIL',
        'KC_HELP',
        'KC_STOP',
        'KC_ERAS',
        'KC_AGAIN',
        'KC_MENU',
        'KC_UNDO',
        'KC_SELECT',
        'KC_EXECUTE',
        'KC_CUT',
        'KC_COPY',
        'KC_PASTE',
        'KC_FIND',
        'KC_MYCM',
      ),
    },
    {id: 'browser', label: 'Browser', match: startsWith('KC_WWW_')},
    {
      id: 'screen',
      label: 'Screen · macOS',
      match: oneOf('KC_BRIU', 'KC_BRID', 'KC_MCTL', 'KC_LPAD'),
    },
    {
      id: 'mouse',
      label: 'Mouse',
      match: startsWith('KC_MS_'),
      rows: [
        oneOf('KC_MS_UP', 'KC_MS_DOWN', 'KC_MS_LEFT', 'KC_MS_RIGHT'),
        startsWith('KC_MS_BTN'),
        startsWith('KC_MS_WH_'),
        startsWith('KC_MS_ACCEL'),
      ],
    },
    {id: 'magic', label: 'Magic', match: startsWith('MAGIC_')},
    {id: 'audio', label: 'Audio', match: startsWith('AU_')},
    {id: 'clicky', label: 'Clicky', match: startsWith('CLICKY_')},
    {id: 'music', label: 'Music', match: startsWith('MU_')},
    {
      id: 'firmware',
      label: 'Reset · Debug',
      match: oneOf('RESET', 'DEBUG', 'QK_BOOT', 'QK_DEBUG_TOGGLE'),
    },
  ],
  media: [
    {
      id: 'volume',
      label: 'Volume',
      match: oneOf('KC_VOLD', 'KC_VOLU', 'KC_MUTE'),
    },
    {
      id: 'playback',
      label: 'Playback',
      match: oneOf(
        'KC_MPLY',
        'KC_MSTP',
        'KC_MPRV',
        'KC_MNXT',
        'KC_MRWD',
        'KC_MFFD',
        'KC_MSEL',
        'KC_EJCT',
      ),
    },
  ],
  qmk_lighting: [
    {id: 'backlight', label: 'Backlight', match: startsWith('BL_')},
    {
      id: 'rgb',
      label: 'RGB',
      match: (code) => code.startsWith('RGB_') && !code.startsWith('RGB_M_'),
    },
    {id: 'rgb-modes', label: 'RGB mode presets', match: startsWith('RGB_M_')},
    {id: 'rgblight', label: 'RGB Light (UG)', match: startsWith('UG_')},
    {id: 'rgb-matrix', label: 'RGB Matrix (RM)', match: startsWith('RM_')},
  ],
  wt_lighting: [
    {
      id: 'wt-effect',
      label: 'Brightness · Effect',
      match: startsWith('BR_', 'EF_', 'ES_'),
    },
    {
      id: 'wt-color',
      label: 'Color',
      match: (code) => /^[HS][12]_/.test(code),
    },
  ],
};

const buildGroupedSections = (
  menu: IKeycodeMenu,
  groups: CategoryGroup[],
  layout?: KeycodeLUT,
): PaletteSection[] => {
  const keycodes = menu.keycodes.filter((keycode) => keycode.code !== 'text');
  const placed = new Set<string>();
  const sections: PaletteSection[] = [];
  for (const group of groups) {
    const members = keycodes.filter(
      (keycode) => !placed.has(keycode.code) && group.match(keycode.code),
    );
    members.forEach((keycode) => placed.add(keycode.code));
    const rowTests = group.rows ?? [];
    const rows = [
      ...rowTests.map((test) => members.filter(({code}) => test(code))),
      members.filter(({code}) => !rowTests.some((test) => test(code))),
    ].filter((row) => row.length > 0);
    if (rows.length > 0) {
      sections.push({
        id: `${menu.id}-${group.id}`,
        label: group.label,
        rows: rows.map((row) =>
          row.map((keycode) => toPaletteKey(keycode, layout)),
        ),
      });
    }
  }
  const other = keycodes.filter((keycode) => !placed.has(keycode.code));
  if (other.length > 0) {
    sections.push({
      id: `${menu.id}-other`,
      label: 'Other',
      rows: [other.map((keycode) => toPaletteKey(keycode, layout))],
    });
  }
  return sections;
};

export const buildCategorySections = (
  menu: IKeycodeMenu,
  layout?: KeycodeLUT,
): PaletteSection[] => {
  if (menu.id === 'basic') {
    return buildBasicSections(menu, layout);
  }
  const groups = CATEGORY_GROUPS[menu.id];
  if (groups) {
    return buildGroupedSections(menu, groups, layout);
  }
  return [
    {
      id: menu.id,
      label: '',
      rows: [
        menu.keycodes
          .filter((keycode) => keycode.code !== 'text')
          .map((keycode) => toPaletteKey(keycode, layout)),
      ],
    },
  ];
};

const LAYER_CALL = /^(?:MO|TG|TT|OSL|TO|DF|LT)\((\d+)[,)]/;
// FN_MO13 holds layer 1, and layer 3 together with Fn2.
const TRI_LAYER = /^FN_MO(\d)(\d)$/;

/** The highest layer a Layers key reaches, or null for a key that names none. */
const highestLayer = (code: string) => {
  const call = LAYER_CALL.exec(code);
  if (call) {
    return Number(call[1]);
  }
  const tri = TRI_LAYER.exec(code);
  return tri ? Math.max(Number(tri[1]), Number(tri[2])) : null;
};

/**
 * The Layers category with only the keys that reach layers the keyboard has, so
 * no key offered switches to a layer that is not there. With the count unknown,
 * every key stays.
 */
export const menuForLayerCount = (
  menu: IKeycodeMenu,
  layerCount: number | undefined,
): IKeycodeMenu => {
  if (menu.id !== 'layers' || !layerCount || layerCount < 1) {
    return menu;
  }
  return {
    ...menu,
    keycodes: menu.keycodes.filter(({code}) => {
      const layer = highestLayer(code);
      return layer === null || layer < layerCount;
    }),
  };
};

/**
 * A search that reads as a keycode rather than a name: a QMK expression
 * ("LT(1,KC_SPC)"), a QMK code ("KC_SPC") or hex written with its 0x ("0x412C").
 * Plain words stay searches, even ones spelled in hex letters ("fade").
 */
export const looksLikeKeycode = (query: string) =>
  /[(_]|^0x/i.test(query.trim());

/**
 * Search runs across every category and keeps each hit under its category. A key
 * is found by the character its keycap has in the host layout as well as by its
 * code and US name, so both what is printed on the key and what VIA calls it work.
 */
export const searchPalette = (
  menus: IKeycodeMenu[],
  query: string,
  layout?: KeycodeLUT,
): {menu: IKeycodeMenu; keys: PaletteKey[]}[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  const hostNameMatches = ({code}: IKeycode) =>
    !!layout?.[code]?.name.toLowerCase().includes(needle);
  return menus
    .map((menu) => ({
      menu,
      keys: menu.keycodes
        .filter(
          (keycode) =>
            keycode.code !== 'text' &&
            (keycodeMatchesQuery(keycode, query) || hostNameMatches(keycode)),
        )
        .map((keycode) => toPaletteKey(keycode, layout)),
    }))
    .filter(({keys}) => keys.length > 0);
};

/** 16-bit value → the menu keycode that encodes it (first menu wins, Basic first). */
export const buildKeycodeIndex = (
  menus: IKeycodeMenu[],
  basicKeyToByte: Record<string, number>,
) => {
  const index = new Map<number, IKeycode>();
  for (const menu of menus) {
    for (const keycode of menu.keycodes) {
      if (keycode.code === 'text') {
        continue;
      }
      const value = selectKeycodeFromMenuCode(keycode.code, basicKeyToByte);
      if (value !== null && !index.has(value)) {
        index.set(value, keycode);
      }
    }
  }
  return index;
};

type KeycodeDescription = {
  /** The legend the key has on the keyboard and in the palette. */
  legend: KeycapLegend;
  /** Its name in the host layout, else the QMK expression. */
  name: string;
  /** The layout's or the menu's description, if it has one. */
  title: string;
  /** The menu's code for it, else the QMK expression or hex. */
  code: string;
};

/** A combined key's legend, its tap key named in the host layout. */
const combinedLegend = (
  {kind, tap, layer, modifiers, right}: ComposedKeycode,
  code: string,
  layout?: KeycodeLUT,
): KeycapLegend => {
  const {name, shortName} = inHostLayout(tap, layout);
  return keycapLegend({
    type: 'combined',
    kind,
    code,
    tap: {code: tap.code, name, shortName},
    layer,
    modifiers: modifiers.map(legendModifier),
    right,
  });
};

/**
 * A keycode value as the palette names it, in the host layout, with the legend the
 * keyboard draws for it. The palette's header, Tap Dance summaries and footer and a
 * keycode setting's button all use it, so a key reads the same wherever it is shown.
 */
export const describeKeycodeValue = (
  value: number,
  index: Map<number, IKeycode>,
  basicKeyToByte: Record<string, number>,
  byteToKey: Record<number, string>,
  layout?: KeycodeLUT,
): KeycodeDescription => {
  const code = formatKeycodeLabel(value, basicKeyToByte, byteToKey);
  const known = index.get(value);
  // A Layer-Tap or Mod-Tap key is drawn as the tap key with its hold, and so is a
  // modified key the palette has no key for: its modifiers over the key.
  const combined = decodeComposedKeycode(value, index, basicKeyToByte);
  const legend =
    combined && (combined.kind !== 'MOD' || !known)
      ? combinedLegend(combined, code, layout)
      : null;
  if (known) {
    const {keycode, legend: named} = toPaletteKey(known, layout);
    return {
      legend: legend ?? named,
      name: keycode.name.replace(/\n/g, ' ') || keycode.code,
      title: keycode.title ?? '',
      code: keycode.code,
    };
  }
  return {
    legend: legend ?? keycapLegend({type: 'named', code, name: code}),
    name: code,
    title: '',
    code,
  };
};

const NUMBERED_TITLE = /^(.*\b(?:layer|Macro|Custom Keycode) )(\d+)(.*)$/;

/**
 * A keycode's description in the app language. Numbered descriptions share one
 * catalog entry; one the catalog lacks, such as a host-layout glyph, is shown as
 * it is.
 */
export const keycodeTitleText = (title: string, t: TFunction): string => {
  const flat = {keySeparator: false, nsSeparator: false} as const;
  const numbered = NUMBERED_TITLE.exec(title);
  return numbered
    ? t(`${numbered[1]}{{n}}${numbered[3]}`, {
        ...flat,
        n: numbered[2],
        defaultValue: title,
      })
    : t(title, flat);
};

// ---------------------------------------------------------------- Combined keys

const COMPOSE_KINDS = ['LT', 'MT', 'MOD'] as const;
export type ComposeKind = (typeof COMPOSE_KINDS)[number];
export const COMPOSE_MODIFIERS = ['LCTL', 'LSFT', 'LALT', 'LGUI'] as const;
export type ComposeModifier = (typeof COMPOSE_MODIFIERS)[number];

/** A modifier as the keycap legend names it: LCTL is CTL, held on either hand. */
export const legendModifier = (modifier: ComposeModifier) =>
  modifier.slice(1) as LegendModifier;

/** The part of a Basic legend a tap sends: "1" of "!\n1", all of "Esc". */
export const tapLegend = (name: string) =>
  name.includes('\n') ? (name.split('\n').pop() ?? name) : name;

type ComposeResult = {
  /** Null until a tap key and the hold part are both chosen. */
  value: number | null;
  code: string;
};

/** A combined key as it will be written: its value and its QMK code. */
export const buildComposeResult = (
  kind: ComposeKind,
  tap: IKeycode | null,
  layer: number,
  modifiers: readonly ComposeModifier[],
  basicKeyToByte: Record<string, number>,
  /** Mod-Tap and a modified key: the modifiers are the right-hand ones. */
  right = false,
): ComposeResult => {
  const ordered = COMPOSE_MODIFIERS.filter((modifier) =>
    modifiers.includes(modifier),
  );
  // QMK names a right-hand modifier as the left one with R for L: RCTL, MOD_RCTL.
  const named = ordered.map((modifier) =>
    right ? modifier.replace(/^L/, 'R') : modifier,
  );
  const base = tap?.code ?? 'kc';
  if (kind === 'LT') {
    return {
      value: tap ? composeLayerTap(layer, tap.code, basicKeyToByte) : null,
      code: `LT(${layer},${base})`,
    };
  }
  if (kind === 'MT') {
    const mods = named.map((modifier) => `MOD_${modifier}`).join('|');
    return {
      value:
        tap && ordered.length
          ? composeModTap(mods, tap.code, basicKeyToByte)
          : null,
      code: `MT(${mods || 'mods'},${base})`,
    };
  }
  return {
    value:
      tap && ordered.length
        ? composeModifiers(named, tap.code, basicKeyToByte)
        : null,
    code: named.reduceRight(
      (keycode, modifier) => `${modifier}(${keycode})`,
      base,
    ),
  };
};

/** A Layer-Tap, Mod-Tap or modified key's parts, as the builder takes them. */
type ComposedKeycode = {
  kind: ComposeKind;
  tap: IKeycode;
  layer: number;
  modifiers: ComposeModifier[];
  /** The modifiers are the right-hand ones. */
  right: boolean;
};

/** A combined key's parts, when its tap key is one the palette has. */
export const decodeComposedKeycode = (
  value: number,
  index: Map<number, IKeycode>,
  basicKeyToByte: Record<string, number>,
): ComposedKeycode | null => {
  const tap = index.get(value & 0xff);
  const within = (start: string, end: string) =>
    value >= basicKeyToByte[start] && value <= basicKeyToByte[end];
  // The low four mod bits are Ctrl, Shift, Alt and GUI; the fifth picks the right hand.
  const held = (bits: number) => ({
    modifiers: COMPOSE_MODIFIERS.filter((_, bit) => bits & (1 << bit)),
    right: (bits & 0x10) !== 0,
  });
  if (!tap) {
    return null;
  }
  if (within('_QK_LAYER_TAP', '_QK_LAYER_TAP_MAX')) {
    const layer = (value - basicKeyToByte._QK_LAYER_TAP) >> 8;
    return {kind: 'LT', tap, layer, modifiers: [], right: false};
  }
  if (within('_QK_MOD_TAP', '_QK_MOD_TAP_MAX')) {
    const mods = held((value - basicKeyToByte._QK_MOD_TAP) >> 8);
    return {kind: 'MT', tap, layer: 0, ...mods};
  }
  if (within('_QK_MODS', '_QK_MODS_MAX')) {
    return {kind: 'MOD', tap, layer: 0, ...held(value >> 8)};
  }
  return null;
};

// ---------------------------------------------------------------- Tap Dance

export const TAP_DANCE_ACTION_ROLES = ['tap', 'hold', 'dtap', 'thold'] as const;
export type TapDanceActionRole = (typeof TAP_DANCE_ACTION_ROLES)[number];

type TapDanceCommand = {
  name: string;
  channel: number;
  id: number;
  label: string;
};

export type TapDanceSlot = {
  index: number;
  name: string;
  /** Keycode that places this TD on a key, e.g. `TD(0)`. */
  code: string;
  actions: Record<TapDanceActionRole, TapDanceCommand>;
  mode?: TapDanceCommand;
  holdTerm?: TapDanceCommand;
  holdOnOther?: TapDanceCommand;
  term: (TapDanceCommand & {options?: [number, number]}) | null;
};

/**
 * Tap Dance slots of a definition, from the settings stored on its TD keycodes.
 * A slot is usable only with all four actions; the roles come from the firmware
 * command names, not from row order or labels.
 */
export const getTapDanceSlots = (
  definition: {tapdanceKeycodes?: EraTapDanceKeycode[]} | null | undefined,
): TapDanceSlot[] =>
  getTapDanceKeycodes(definition).flatMap((keycode, index) => {
    const prefix = `id_qmk_tapdance_${index + 1}_`;
    const actions: Partial<Record<TapDanceActionRole, TapDanceCommand>> = {};
    let term: TapDanceSlot['term'] = null;
    let mode: TapDanceSlot['mode'];
    let holdTerm: TapDanceSlot['holdTerm'];
    let holdOnOther: TapDanceSlot['holdOnOther'];
    for (const control of keycode.controls ?? []) {
      const [name, channel, id] = control.content;
      if (!name.startsWith(prefix)) {
        continue;
      }
      const role = name.slice(prefix.length);
      const command = {name, channel, id, label: control.label};
      if (role === 'mode' && control.type === 'dropdown') {
        mode = command;
      } else if (role === 'hold_term' && control.type === 'range') {
        holdTerm = command;
      } else if (role === 'hold_other' && control.type === 'dropdown') {
        holdOnOther = command;
      } else if (role === 'term_exact') {
        term = {...command, options: control.options as [number, number] | undefined};
      } else if ((TAP_DANCE_ACTION_ROLES as readonly string[]).includes(role)) {
        actions[role as TapDanceActionRole] = command;
      }
    }
    if (TAP_DANCE_ACTION_ROLES.some((role) => !actions[role])) {
      return [];
    }
    return [
      {
        index,
        name: keycode.name,
        code: `TD(${index})`,
        actions: actions as Record<TapDanceActionRole, TapDanceCommand>,
        term,
        ...(mode ? {mode} : {}),
        ...(holdTerm && holdOnOther ? {holdTerm, holdOnOther} : {}),
      },
    ];
  });

export type TapDanceDraft = {
  /** Undefined until the firmware confirms support; then an ERA_WIRE.TAPDANCE_MODES value: LEGACY keeps legacy semantics, AFTER_DECISION waits, ON_PRESS sends the first press immediately. */
  mode?: number;
  /** Zero follows term; undefined means this firmware has no advanced timing. */
  holdTerm?: string;
  holdOnOther?: number;
  actions: Record<TapDanceActionRole, number>;
  term: string;
};

const TD_MODE = ERA_WIRE.TAPDANCE_MODES;
const TD_HOLD_OTHER = ERA_WIRE.TAPDANCE_HOLD_OTHER;
const TD_MARKER = ERA_WIRE.TAPDANCE_MARKERS;

/** A Tap Dance mode byte the registry defines. */
export const isTapDanceMode = (value: unknown): boolean =>
  Object.values(TD_MODE).some((mode) => mode === value);

/** A hold-on-other-key flag byte the registry defines. */
export const isTapDanceHoldOther = (value: unknown): boolean =>
  Object.values(TD_HOLD_OTHER).some((flag) => flag === value);

export type TapDanceWrite = {
  name: string;
  channel: number;
  id: number;
  value: number;
};

export const isValidTermDraft = (term: string, min: number, max: number) => {
  if (!/^\d+$/.test(term)) {
    return false;
  }
  const value = Number(term);
  return value >= min && value <= max;
};

/**
 * What Save has to send: every action or term that differs from the keyboard's
 * value, or whose automatic save needs retrying, in slot order. Returns null when
 * a term draft is not a whole number inside the firmware range, so an invalid
 * draft never writes anything.
 */
export const planTapDanceWrites = (
  slot: TapDanceSlot,
  draft: TapDanceDraft,
  current: TapDanceDraft,
  termBounds: {minMs: number; maxMs: number},
  getDisabledReason?: (value: number | null) => KeycodeDisabledReason | null,
  retry: readonly TapDanceField[] = [],
): TapDanceWrite[] | null => {
  const writes: TapDanceWrite[] = [];
  if (draft.mode === TD_MODE.ON_PRESS && draft.actions.hold !== 1) return null;
  for (const role of TAP_DANCE_ACTION_ROLES) {
    if (draft.actions[role] !== current.actions[role] || retry.includes(role)) {
      const value = draft.actions[role];
      if (
        !Number.isInteger(value) ||
        value < 0 ||
        value > 0xffff ||
        (!(draft.mode !== undefined && draft.mode !== TD_MODE.LEGACY && role !== 'tap' && value === 1) &&
          getDisabledReason?.(value))
      ) {
        return null;
      }
      const {name, channel, id} = slot.actions[role];
      writes.push({name, channel, id, value});
    }
  }
  if (slot.term && (draft.term !== current.term || retry.includes('term'))) {
    if (!isValidTermDraft(draft.term, termBounds.minMs, termBounds.maxMs)) {
      return null;
    }
    const {name, channel, id} = slot.term;
    writes.push({name, channel, id, value: Number(draft.term)});
  }
  if (draft.mode !== undefined && (draft.mode !== current.mode || retry.includes('mode'))) {
    if (!slot.mode || current.mode === undefined || !isTapDanceMode(draft.mode)) return null;
    const {name, channel, id} = slot.mode;
    const modeWrite = {name, channel, id, value: draft.mode};
    // Leave immediate mode before writing a new first-hold action.
    if (current.mode === TD_MODE.ON_PRESS) writes.unshift(modeWrite);
    else writes.push(modeWrite);
  }
  if (draft.holdTerm !== undefined && (draft.holdTerm !== current.holdTerm || retry.includes('holdTerm'))) {
    if (!slot.holdTerm || current.holdTerm === undefined || !isValidTermDraft(draft.holdTerm, 0, 65535)) return null;
    const {name, channel, id} = slot.holdTerm;
    writes.push({name, channel, id, value: Number(draft.holdTerm)});
  }
  if (draft.holdOnOther !== undefined && (draft.holdOnOther !== current.holdOnOther || retry.includes('holdOnOther'))) {
    if (!slot.holdOnOther || current.holdOnOther === undefined || !isTapDanceHoldOther(draft.holdOnOther)) return null;
    const {name, channel, id} = slot.holdOnOther;
    writes.push({name, channel, id, value: draft.holdOnOther});
  }
  return writes;
};

/** One-byte stock VIA dropdown plus the firmware's support marker; actions/terms are BE16. */
export const tapDanceWriteBytes = (write: TapDanceWrite): number[] =>
  /_mode$/.test(write.name) ? [write.value, TD_MARKER.MODE] :
  /_hold_other$/.test(write.name) ? [write.value, TD_MARKER.TIMING] :
  /_hold_term$/.test(write.name) ? [write.value >> 8, write.value & 0xff, TD_MARKER.TIMING] :
  [write.value >> 8, write.value & 0xff];

export type TapDanceField = TapDanceActionRole | 'term' | 'mode' | 'holdTerm' | 'holdOnOther';

/** What the user set on a slot and has not applied, field by field. */
export type TapDanceChanges = Partial<Record<TapDanceActionRole, number>> & {
  term?: string;
  mode?: number;
  holdTerm?: string;
  holdOnOther?: number;
  /** A failed SET + SAVE must be retried even when GET reports the same RAM value. */
  retry?: TapDanceField[];
};

/** A slot's values with its unapplied changes in place. */
export const withTapDanceChanges = (
  current: TapDanceDraft,
  changes: TapDanceChanges,
): TapDanceDraft => ({
  actions: Object.fromEntries(
    TAP_DANCE_ACTION_ROLES.map((role) => [
      role,
      changes[role] ?? current.actions[role],
    ]),
  ) as TapDanceDraft['actions'],
  term: changes.term ?? current.term,
  ...(current.mode !== undefined ? {mode: changes.mode ?? current.mode} : {}),
  ...(current.holdTerm !== undefined ? {
    holdTerm: changes.holdTerm ?? current.holdTerm,
    holdOnOther: changes.holdOnOther ?? current.holdOnOther,
  } : {}),
});

/** Changes not yet confirmed by SET + SAVE; GET alone only confirms RAM. */
export const pendingTapDanceChanges = (
  changes: TapDanceChanges,
  current: TapDanceDraft,
): TapDanceChanges => {
  const pending: TapDanceChanges = {};
  for (const role of TAP_DANCE_ACTION_ROLES) {
    const value = changes[role];
    if (value !== undefined && value !== current.actions[role]) {
      pending[role] = value;
    }
  }
  if (changes.term !== undefined && changes.term !== current.term) {
    pending.term = changes.term;
  }
  if (changes.mode !== undefined && changes.mode !== current.mode) pending.mode = changes.mode;
  if (changes.holdTerm !== undefined && changes.holdTerm !== current.holdTerm) pending.holdTerm = changes.holdTerm;
  if (changes.holdOnOther !== undefined && changes.holdOnOther !== current.holdOnOther) pending.holdOnOther = changes.holdOnOther;
  for (const field of changes.retry ?? []) {
    if (changes[field] !== undefined) {
      Object.assign(pending, {[field]: changes[field]});
      (pending.retry ??= []).push(field);
    }
  }
  return pending;
};

/**
 * The changes an edit leaves. A field the edit set is a change while it differs
 * from the keyboard; one it left as it was stays, because it may be on its way to
 * the keyboard, whose values show a write before the keyboard has taken it. For
 * the same reason a field set to the value `sending` has on its way stays too,
 * until the keyboard's answer settles it.
 */
export const editedTapDanceChanges = (
  next: TapDanceChanges,
  previous: TapDanceChanges,
  current: TapDanceDraft,
  sending: TapDanceChanges = {},
): TapDanceChanges => {
  const edited: TapDanceChanges = {};
  for (const role of TAP_DANCE_ACTION_ROLES) {
    const value = next[role];
    if (
      value !== undefined &&
      (value === previous[role] ||
        value === sending[role] ||
        value !== current.actions[role])
    ) {
      edited[role] = value;
    }
  }
  const {term} = next;
  if (
    term !== undefined &&
    (term === previous.term || term === sending.term || term !== current.term)
  ) {
    edited.term = term;
  }
  if (next.mode !== undefined && (next.mode === previous.mode ||
      next.mode === sending.mode || next.mode !== current.mode)) edited.mode = next.mode;
  if (next.holdTerm !== undefined && (next.holdTerm === previous.holdTerm ||
      next.holdTerm === sending.holdTerm || next.holdTerm !== current.holdTerm)) edited.holdTerm = next.holdTerm;
  if (next.holdOnOther !== undefined && (next.holdOnOther === previous.holdOnOther ||
      next.holdOnOther === sending.holdOnOther || next.holdOnOther !== current.holdOnOther)) edited.holdOnOther = next.holdOnOther;
  for (const field of previous.retry ?? []) {
    if (next[field] !== undefined) {
      Object.assign(edited, {[field]: next[field]});
      (edited.retry ??= []).push(field);
    }
  }
  return edited;
};

/** The slot field a write sets, if it is one of the slot's. */
export const tapDanceFieldOf = (
  slot: TapDanceSlot,
  command: string,
): TapDanceField | null =>
  slot.holdTerm?.name === command ? 'holdTerm' :
  slot.holdOnOther?.name === command ? 'holdOnOther' :
  slot.mode?.name === command ? 'mode' :
  slot.term?.name === command
    ? 'term'
    : (TAP_DANCE_ACTION_ROLES.find(
        (role) => slot.actions[role].name === command,
      ) ?? null);

/** KC_TRNS inherits the base action in the new modes; KC_NO is explicit silence. */
export const tapDanceVisibleRoles = (draft: TapDanceDraft): TapDanceActionRole[] =>
  draft.mode === undefined ? [...TAP_DANCE_ACTION_ROLES] : TAP_DANCE_ACTION_ROLES.filter(
    (role) => role === 'tap' || (draft.mode === TD_MODE.LEGACY
      ? draft.actions[role] !== 0 && draft.actions[role] !== 1
      : draft.actions[role] !== 1),
  );

export const tapDanceImmediate = (draft: TapDanceDraft): boolean =>
  draft.mode === TD_MODE.ON_PRESS ||
  (draft.mode === TD_MODE.AFTER_DECISION && tapDanceVisibleRoles(draft).length === 1);

/** Opening a legacy slot never migrates it; an explicit edit stages the conversion. */
export const editTapDanceBehavior = (
  draft: TapDanceDraft, next: TapDanceChanges,
): TapDanceChanges => draft.mode === TD_MODE.LEGACY ? {
  mode: TD_MODE.AFTER_DECISION,
  ...Object.fromEntries((['hold', 'dtap', 'thold'] as const).map((role) =>
    [role, draft.actions[role] === 0 ? 1 : draft.actions[role]],
  )),
  ...next,
} : next;
