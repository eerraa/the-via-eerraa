// Pure layout and lookup rules behind the keycode palette. The palette is the one
// keycode chooser for both KEYMAP and V3 `keycode` controls, so everything here is
// independent of where it is shown.

import type {TFunction} from 'i18next';
import type {IKeycode, IKeycodeMenu} from './key';
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

export type KeycapRole = 'alpha' | 'mod';

/** Every key is one unit wide; `size` is the legend's font size in px. */
export type PaletteKey = {
  kind: 'key';
  keycode: IKeycode;
  top: string;
  bottom: string;
  size: number;
  /** Set in the condensed face: the name fits a 1u face no other way. */
  condensed?: boolean;
  role: KeycapRole;
};

export type PaletteGap = {kind: 'gap'; units: number};

export type PaletteItem = PaletteKey | PaletteGap;

export type PaletteSection = {
  id: string;
  /** English source text for t(); empty when the category name says enough. */
  label: string;
  rows: PaletteItem[][];
};

/**
 * Keycap legend: an explicit "\n" wins; otherwise a long two-word name is stacked
 * like a printed keycap ("Print" over "Screen") instead of being truncated.
 */
export const splitLegend = (name: string): {top: string; bottom: string} => {
  if (name.includes('\n')) {
    const [top, ...rest] = name.split('\n');
    return {top, bottom: rest.join(' ')};
  }
  // Layer keys read as a function over its layer: "MO" above "1".
  const call = /^([A-Za-z]+)\((\d+)\)$/.exec(name);
  if (call) {
    return {top: call[1], bottom: call[2]};
  }
  const space = name.indexOf(' ');
  if (name.length > 6 && space > 0) {
    return {top: name.slice(0, space), bottom: name.slice(space + 1)};
  }
  return {top: name, bottom: ''};
};

// A CJK or Hangul glyph is about as wide as 1.6 Latin ones at the same size.
const WIDE_GLYPH = /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/;

/** Legend length in Latin-letter widths. */
export const legendWidth = (text: string) =>
  [...text].reduce(
    (width, glyph) => width + (WIDE_GLYPH.test(glyph) ? 1.6 : 1),
    0,
  );

// Legends on a 1u face. The keyboard above draws a single character at 22px, a
// short shifted pair at 16px and a word at 13px; a word too wide for the face is
// set smaller and broken over two lines, and VIA's short name is the fallback.
/**
 * Text width across a 1u face: 52px cap − 12px skirt − 6px cap padding, less 1px for
 * the synthesized bold.
 */
export const FACE_TEXT_WIDTH = 33;
const WORD_SIZES = [13, 12, 11, 10, 9];
const MIN_WORD_SIZE = 9;
/**
 * Fira Sans Condensed, which VIA already uses for its tooltips, runs about 92% as wide
 * as the legend face (measured in Chrome). A name that fits at no size in the legend
 * face ("Rainbow", "Gradient") is set in it rather than clipped, as a keycap printer
 * would condense a long word.
 */
export const CONDENSED_WIDTH = 0.92;

// Advance widths of the palette legend font, in em: Fira Sans at weight 700, which the
// app synthesizes from the loaded 400 face. Measured in Chrome; other glyphs fall back
// to an average Latin width, and CJK or Hangul to a full em.
const GLYPH_EM: Record<string, number> = {
  '0': 0.56, '1': 0.42, '2': 0.49, '3': 0.5, '4': 0.53, '5': 0.5, '6': 0.53,
  '7': 0.44, '8': 0.55, '9': 0.53, ' ': 0.27, '!': 0.24, '"': 0.4, '#': 0.52,
  '$': 0.52, '%': 0.83, '&': 0.73, "'": 0.22, '(': 0.32, ')': 0.32, '*': 0.44,
  '+': 0.5, ',': 0.24, '-': 0.4, '.': 0.24, '/': 0.41, ':': 0.24, ';': 0.24,
  '<': 0.5, '=': 0.5, '>': 0.5, '?': 0.43, '@': 1.02, 'A': 0.57, 'B': 0.61,
  'C': 0.54, 'D': 0.64, 'E': 0.54, 'F': 0.49, 'G': 0.63, 'H': 0.68, 'I': 0.29,
  'J': 0.3, 'K': 0.59, 'L': 0.5, 'M': 0.78, 'N': 0.68, 'O': 0.69, 'P': 0.58,
  'Q': 0.69, 'R': 0.6, 'S': 0.53, 'T': 0.52, 'U': 0.66, 'V': 0.56, 'W': 0.83,
  'X': 0.54, 'Y': 0.55, 'Z': 0.52, '[': 0.32, '\\': 0.41, ']': 0.32,
  '^': 0.54, '_': 0.51, '`': 0.3, 'a': 0.54, 'b': 0.59, 'c': 0.46, 'd': 0.6,
  'e': 0.55, 'f': 0.34, 'g': 0.52, 'h': 0.59, 'i': 0.28, 'j': 0.28, 'k': 0.51,
  'l': 0.29, 'm': 0.86, 'n': 0.59, 'o': 0.58, 'p': 0.59, 'q': 0.6, 'r': 0.39,
  's': 0.46, 't': 0.36, 'u': 0.58, 'v': 0.49, 'w': 0.72, 'x': 0.48, 'y': 0.49,
  'z': 0.44, '{': 0.32, '|': 0.4, '}': 0.32, '~': 0.49, '←': 1, '↑': 0.9,
  '→': 1, '↓': 0.9, '▽': 1, '÷': 0.5, '×': 0.5, '¥': 0.54,
};

const glyphEm = (glyph: string) =>
  GLYPH_EM[glyph] ?? (WIDE_GLYPH.test(glyph) ? 1 : 0.6);

export const legendEm = (text: string) =>
  [...text].reduce((em, glyph) => em + glyphEm(glyph), 0);

type Legend = {top: string; bottom: string};
type FittedLegend = Legend & {size: number; condensed?: boolean};

// A "-" key sits next to its "+" key ("Hue -", "Hue +"). It is measured as if it
// ended in the wider "+", so the two break and size the same way.
const asPlus = (line: string) => line.replace(/-$/, '+');

/** Largest size at which every line fits the face, or 0 when none does. */
const fitSize = ({top, bottom}: Legend, sizes: number[], width = 1) => {
  const widest =
    Math.max(legendEm(asPlus(top)), legendEm(asPlus(bottom))) * width;
  return sizes.find((size) => widest * size <= FACE_TEXT_WIDTH) ?? 0;
};

// The pair size is for symbols, digits and codes ("!" over "1", "F13", "SW"). A word
// is set at the word size, as the keyboard sets "Esc" and "Tab", however short it is.
const pairSized = (...lines: string[]) =>
  lines.every((line) => legendWidth(line) <= 3.2 && !/[a-z]/.test(line));

const fitTextAt = (text: string, scale: number): FittedLegend => {
  const explicit = text.includes('\n') || /^[A-Za-z]+\(\d+\)$/.test(text);
  if (explicit) {
    const legend = splitLegend(text);
    const pair = pairSized(legend.top, legend.bottom);
    return {
      ...legend,
      size: fitSize(legend, pair ? [16, ...WORD_SIZES] : WORD_SIZES, scale),
    };
  }
  const width = legendWidth(text);
  if (width <= 1) {
    return {top: text, bottom: '', size: 22};
  }
  const single = {top: text, bottom: ''};
  const singleSize = fitSize(
    single,
    pairSized(text) ? [16, ...WORD_SIZES] : WORD_SIZES,
    scale,
  );
  if (singleSize >= 13) {
    return {...single, size: singleSize};
  }
  const words = text.split(' ');
  let best: FittedLegend = {...single, size: singleSize};
  for (let cut = 1; cut < words.length; cut++) {
    const legend = {
      top: words.slice(0, cut).join(' '),
      bottom: words.slice(cut).join(' '),
    };
    const size = fitSize(legend, WORD_SIZES, scale);
    if (size > best.size) {
      best = {...legend, size};
    }
  }
  return best;
};

const fitText = (text: string): FittedLegend => {
  const fitted = fitTextAt(text, 1);
  if (fitted.size > 0) {
    return fitted;
  }
  const condensed = fitTextAt(text, CONDENSED_WIDTH);
  return condensed.size > 0 ? {...condensed, condensed: true} : fitted;
};

/**
 * The legend a 1u key shows: the full name when it fits at 11px or more,
 * otherwise VIA's short name when that reads larger. A name that fits nowhere is
 * set at the smallest size and clipped; its full name is in the title and footer.
 */
export const fitLegend = (name: string, shortName?: string): FittedLegend => {
  const full = fitText(name);
  const short =
    full.size < 11 && shortName && shortName !== name ? fitText(shortName) : null;
  if (short && short.size > full.size) {
    return short;
  }
  return full.size > 0 ? full : {...splitLegend(name), size: MIN_WORD_SIZE};
};

/**
 * Size for a legend whose lines are already decided (a result, a Tap Dance action):
 * the keyboard's size when the lines fit it, otherwise the largest that fits, in the
 * condensed face when the legend face fits at no size.
 */
export const fitKeycapLegend = (
  top: string,
  bottom: string,
): {size: number; condensed: boolean} => {
  if (!bottom && legendWidth(top) <= 1) {
    return {size: 22, condensed: false};
  }
  const pair = pairSized(top, bottom);
  const size = fitSize({top, bottom}, pair ? [16, ...WORD_SIZES] : WORD_SIZES);
  if (size > 0) {
    return {size, condensed: false};
  }
  const condensed = fitSize({top, bottom}, WORD_SIZES, CONDENSED_WIDTH);
  return condensed > 0
    ? {size: condensed, condensed: true}
    : {size: MIN_WORD_SIZE, condensed: false};
};

/** The first line that fits a 1u face at the smallest legend size, else the last. */
const firstFitting = (lines: string[]) =>
  lines.find((line) => legendEm(line) * MIN_WORD_SIZE <= FACE_TEXT_WIDTH) ??
  lines[lines.length - 1];

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

// Numpad digits share their name with the number row; the second legend tells
// them apart the way a keypad keycap would.
const NUMPAD_DIGIT = /^KC_P[0-9]$/;
// The navigation cluster is 1u on a keyboard, so it uses the short legends.
const SHORT_LEGEND = new Set([
  'KC_INS',
  'KC_UP',
  'KC_DOWN',
  'KC_LEFT',
  'KC_RGHT',
]);

// Names that fit a 1u face only at an unreadable size, or not at all, and have no
// VIA short name. The full name stays in the key's tooltip and accessible name.
const PALETTE_LEGEND: Record<string, string> = {
  KC_MPRV: 'Prev',
  KC_MRWD: 'Rew',
  KC_MFFD: 'Fast\nFwd',
  KC_WWW_FORWARD: 'Fwd',
  KC_WWW_FAVORITES: 'Fav',
  KC_LNUM: 'Locking\nNum',
  KC_LCAP: 'Locking\nCaps',
  KC_LSCR: 'Locking\nScroll',
  // Magic keys the way QMK names them (NK_TOGG, CG_NORM, …): what, over what happens.
  MAGIC_TOGGLE_NKRO: 'NKRO\nTogg',
  MAGIC_SWAP_CTL_GUI: 'CG\nSwap',
  MAGIC_UNSWAP_CTL_GUI: 'CG\nNorm',
  MAGIC_TOGGLE_CTL_GUI: 'CG\nTogg',
  MAGIC_SWAP_ALT_GUI: 'AG\nSwap',
  MAGIC_UNSWAP_ALT_GUI: 'AG\nNorm',
  MAGIC_TOGGLE_ALT_GUI: 'AG\nTogg',
  MAGIC_GUI_ON: 'GUI\nOn',
  MAGIC_GUI_OFF: 'GUI\nOff',
  MAGIC_TOGGLE_GUI: 'GUI\nTogg',
  // On and Off, like the Audio and Music keys beside them (QMK CK_ON, CK_OFF).
  CLICKY_ENABLE: 'Clicky\nOn',
  CLICKY_DISABLE: 'Clicky\nOff',
  // Backlight breathing on/off. VIA's "BR Toggle" read like a second Toggle.
  BL_BRTG: 'BL\nBreath',
};
// A preset reads "Mode" over its effect ("Rainbow"); under its own heading, the
// effect alone. VIA's letter code is the fallback for a preset without a title.
const RGB_MODE_PRESET = /^RGB_M_([A-Z]+)$/;
const CUSTOM_KEYCODE = /^CUSTOM\((\d+)\)$/;

const paletteName = ({code, name, title}: IKeycode) => {
  const preset = RGB_MODE_PRESET.exec(code);
  if (preset) {
    return `Mode\n${title ?? preset[1]}`;
  }
  const custom = CUSTOM_KEYCODE.exec(name);
  if (custom) {
    return `Custom\n${custom[1]}`;
  }
  return PALETTE_LEGEND[code] ?? name;
};

/**
 * A legend without the word its group heading already says: "Btn1" under "Mouse",
 * "1" under "While held (MO)". A bare sign says nothing alone, so "BL -" stays.
 */
const withoutPrefix = (name: string, prefix: string) => {
  if (name.startsWith(`${prefix}(`) && name.endsWith(')')) {
    return name.slice(prefix.length + 1, -1);
  }
  const rest = name.slice(prefix.length + 1);
  return name.startsWith(prefix) &&
    /^[ \n]/.test(name.slice(prefix.length)) &&
    /[^\s+-]/.test(rest)
    ? rest
    : name;
};

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
export const inHostLayout = (
  keycode: IKeycode,
  layout?: KeycodeLUT,
): IKeycode => {
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

export const toPaletteKey = (
  menuKeycode: IKeycode,
  prefix = '',
  layout?: KeycodeLUT,
): PaletteKey => {
  const keycode = inHostLayout(menuKeycode, layout);
  const name = paletteName(keycode);
  const legend = NUMPAD_DIGIT.test(keycode.code)
    ? fitText(`${keycode.name}\nKP`)
    : SHORT_LEGEND.has(keycode.code) && keycode.shortName
      ? fitText(keycode.shortName)
      : prefix
        ? fitLegend(
            withoutPrefix(name, prefix),
            keycode.shortName && withoutPrefix(keycode.shortName, prefix),
          )
        : fitLegend(name, keycode.shortName);
  return {
    kind: 'key',
    keycode,
    ...legend,
    role: MOD_ROLE.has(keycode.code) ? 'mod' : 'alpha',
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
          return [toPaletteKey(keycode, '', layout)];
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
      rows: [other.map((keycode) => toPaletteKey(keycode, '', layout))],
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
  /**
   * What the heading already says ("Mouse", "MO"). Keys in the group drop it from
   * their legend; the full name stays in the tooltip, the footer and search.
   */
  prefix?: string;
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
    {id: 'mo', label: 'While held (MO)', match: startsWith('MO('), prefix: 'MO'},
    {id: 'tg', label: 'Toggle (TG)', match: startsWith('TG('), prefix: 'TG'},
    {
      id: 'tt',
      label: 'Hold or tap to toggle (TT)',
      match: startsWith('TT('),
      prefix: 'TT',
    },
    {
      id: 'osl',
      label: 'Next key only (OSL)',
      match: startsWith('OSL('),
      prefix: 'OSL',
    },
    {id: 'to', label: 'Switch to (TO)', match: startsWith('TO('), prefix: 'TO'},
    {id: 'df', label: 'Default layer (DF)', match: startsWith('DF('), prefix: 'DF'},
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
      prefix: 'Locking',
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
      prefix: 'Mouse',
      rows: [
        oneOf('KC_MS_UP', 'KC_MS_DOWN', 'KC_MS_LEFT', 'KC_MS_RIGHT'),
        startsWith('KC_MS_BTN'),
        startsWith('KC_MS_WH_'),
        startsWith('KC_MS_ACCEL'),
      ],
    },
    {id: 'magic', label: 'Magic', match: startsWith('MAGIC_')},
    {id: 'audio', label: 'Audio', match: startsWith('AU_'), prefix: 'Audio'},
    {
      id: 'clicky',
      label: 'Clicky',
      match: startsWith('CLICKY_'),
      prefix: 'Clicky',
    },
    {id: 'music', label: 'Music', match: startsWith('MU_'), prefix: 'Music'},
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
      prefix: 'Media',
    },
  ],
  qmk_lighting: [
    {
      id: 'backlight',
      label: 'Backlight',
      match: startsWith('BL_'),
      prefix: 'BL',
    },
    {
      id: 'rgb',
      label: 'RGB',
      match: (code) => code.startsWith('RGB_') && !code.startsWith('RGB_M_'),
      prefix: 'RGB',
    },
    {
      id: 'rgb-modes',
      label: 'RGB mode presets',
      match: startsWith('RGB_M_'),
      prefix: 'Mode',
    },
    {
      id: 'rgblight',
      label: 'RGB Light (UG)',
      match: startsWith('UG_'),
      prefix: 'UG',
    },
    {
      id: 'rgb-matrix',
      label: 'RGB Matrix (RM)',
      match: startsWith('RM_'),
      prefix: 'RM',
    },
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
          row.map((keycode) => toPaletteKey(keycode, group.prefix, layout)),
        ),
      });
    }
  }
  const other = keycodes.filter((keycode) => !placed.has(keycode.code));
  if (other.length > 0) {
    sections.push({
      id: `${menu.id}-other`,
      label: 'Other',
      rows: [other.map((keycode) => toPaletteKey(keycode, '', layout))],
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
          .map((keycode) => toPaletteKey(keycode, '', layout)),
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
        .map((keycode) => toPaletteKey(keycode, '', layout)),
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

export type KeycodeDescription = {
  /** The legend the key has in the palette. */
  top: string;
  bottom: string;
  /** Its name in the host layout, else the QMK expression. */
  name: string;
  /** The layout's or the menu's description, if it has one. */
  title: string;
  /** The menu's code for it, else the QMK expression or hex. */
  code: string;
};

/**
 * A keycode value as the palette names it, in the host layout. The palette's
 * header, Tap Dance summaries and footer and a keycode setting's button all use
 * it, so a key reads the same wherever it is shown.
 */
export const describeKeycodeValue = (
  value: number,
  index: Map<number, IKeycode>,
  basicKeyToByte: Record<string, number>,
  byteToKey: Record<number, string>,
  layout?: KeycodeLUT,
): KeycodeDescription => {
  const known = index.get(value);
  if (known) {
    const {top, bottom, keycode} = toPaletteKey(known, '', layout);
    return {
      top,
      bottom,
      name: keycode.name.replace(/\n/g, ' ') || keycode.code,
      title: keycode.title ?? '',
      code: keycode.code,
    };
  }
  const code = formatKeycodeLabel(value, basicKeyToByte, byteToKey);
  const {top, bottom} = fitLegend(code.replace(/^KC_/, ''));
  return {top, bottom, name: code, title: '', code};
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

export const COMPOSE_KINDS = ['LT', 'MT', 'MOD'] as const;
export type ComposeKind = (typeof COMPOSE_KINDS)[number];
export const COMPOSE_MODIFIERS = ['LCTL', 'LSFT', 'LALT', 'LGUI'] as const;
export type ComposeModifier = (typeof COMPOSE_MODIFIERS)[number];
export const MODIFIER_LEGEND: Record<ComposeModifier, string> = {
  LCTL: 'Ctrl',
  LSFT: 'Shift',
  LALT: 'Alt',
  LGUI: 'Win',
};

/** The part of a Basic legend a tap sends: "1" of "!\n1", all of "Esc". */
export const tapLegend = (name: string) =>
  name.includes('\n') ? (name.split('\n').pop() ?? name) : name;

// The result is a 1u keycap, so each of its two lines has to fit one face: a long
// tap key falls back to VIA's short name, and held modifiers to their initials.
const tapLine = (tap: IKeycode) => {
  const name = tapLegend(tap.name);
  return firstFitting([name, tap.shortName ?? name, name.split(' ')[0]]);
};

const heldLine = (modifiers: readonly ComposeModifier[], suffix = '') => {
  const initials = modifiers.map((modifier) => MODIFIER_LEGEND[modifier][0]);
  return firstFitting([
    modifiers.map((modifier) => MODIFIER_LEGEND[modifier]).join('+') + suffix,
    initials.join('+') + suffix,
    initials.join('') + suffix,
  ]);
};

export type ComposeResult = {
  /** Null until a tap key and the hold part are both chosen. */
  value: number | null;
  code: string;
  top: string;
  bottom: string;
};

/**
 * A combined key as it will be written, with a keycap legend that reads the way
 * it acts: Layer-Tap shows the tap key over its layer, Mod-Tap over its
 * modifiers, and a modified key shows the modifiers over the key.
 */
export const buildComposeResult = (
  kind: ComposeKind,
  tap: IKeycode | null,
  layer: number,
  modifiers: readonly ComposeModifier[],
  basicKeyToByte: Record<string, number>,
): ComposeResult => {
  const ordered = COMPOSE_MODIFIERS.filter((modifier) =>
    modifiers.includes(modifier),
  );
  const base = tap?.code ?? 'kc';
  const tapName = tap ? tapLine(tap) : '?';
  if (kind === 'LT') {
    return {
      value: tap ? composeLayerTap(layer, tap.code, basicKeyToByte) : null,
      code: `LT(${layer},${base})`,
      top: tapName,
      bottom: `L${layer}`,
    };
  }
  if (kind === 'MT') {
    const mods = ordered.map((modifier) => `MOD_${modifier}`).join('|');
    return {
      value:
        tap && ordered.length
          ? composeModTap(mods, tap.code, basicKeyToByte)
          : null,
      code: `MT(${mods || 'mods'},${base})`,
      top: tapName,
      bottom: ordered.length ? heldLine(ordered) : '—',
    };
  }
  return {
    value:
      tap && ordered.length
        ? composeModifiers([...ordered], tap.code, basicKeyToByte)
        : null,
    code: ordered.reduceRight(
      (keycode, modifier) => `${modifier}(${keycode})`,
      base,
    ),
    top: ordered.length ? heldLine(ordered, '+') : '—+',
    bottom: tapName,
  };
};

// ---------------------------------------------------------------- Tap Dance

export const TAP_DANCE_ACTION_ROLES = ['tap', 'hold', 'dtap', 'thold'] as const;
export type TapDanceActionRole = (typeof TAP_DANCE_ACTION_ROLES)[number];

export type TapDanceCommand = {
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
  /** Undefined until the firmware confirms support; 0 keeps legacy semantics; 1 waits, 2 sends the first press immediately. */
  mode?: number;
  /** Zero follows term; undefined means this firmware has no advanced timing. */
  holdTerm?: string;
  holdOnOther?: number;
  actions: Record<TapDanceActionRole, number>;
  term: string;
};

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
 * value, in slot order. Returns null when the term draft is not a whole number
 * inside the firmware range, so an invalid draft never writes anything.
 */
export const planTapDanceWrites = (
  slot: TapDanceSlot,
  draft: TapDanceDraft,
  current: TapDanceDraft,
  termBounds: {minMs: number; maxMs: number},
  getDisabledReason?: (value: number | null) => KeycodeDisabledReason | null,
): TapDanceWrite[] | null => {
  const writes: TapDanceWrite[] = [];
  if (draft.mode === 2 && draft.actions.hold !== 1) return null;
  for (const role of TAP_DANCE_ACTION_ROLES) {
    if (draft.actions[role] !== current.actions[role]) {
      const value = draft.actions[role];
      if (
        !Number.isInteger(value) ||
        value < 0 ||
        value > 0xffff ||
        (!(draft.mode && role !== 'tap' && value === 1) && getDisabledReason?.(value))
      ) {
        return null;
      }
      const {name, channel, id} = slot.actions[role];
      writes.push({name, channel, id, value});
    }
  }
  if (slot.term && draft.term !== current.term) {
    if (!isValidTermDraft(draft.term, termBounds.minMs, termBounds.maxMs)) {
      return null;
    }
    const {name, channel, id} = slot.term;
    writes.push({name, channel, id, value: Number(draft.term)});
  }
  if (draft.mode !== undefined && draft.mode !== current.mode) {
    if (!slot.mode || current.mode === undefined || ![0, 1, 2].includes(draft.mode)) return null;
    const {name, channel, id} = slot.mode;
    const modeWrite = {name, channel, id, value: draft.mode};
    // Leave immediate mode before writing a new first-hold action.
    if (current.mode === 2) writes.unshift(modeWrite);
    else writes.push(modeWrite);
  }
  if (draft.holdTerm !== undefined && draft.holdTerm !== current.holdTerm) {
    if (!slot.holdTerm || current.holdTerm === undefined || !isValidTermDraft(draft.holdTerm, 0, 65535)) return null;
    const {name, channel, id} = slot.holdTerm;
    writes.push({name, channel, id, value: Number(draft.holdTerm)});
  }
  if (draft.holdOnOther !== undefined && draft.holdOnOther !== current.holdOnOther) {
    if (!slot.holdOnOther || current.holdOnOther === undefined || ![0, 1].includes(draft.holdOnOther)) return null;
    const {name, channel, id} = slot.holdOnOther;
    writes.push({name, channel, id, value: draft.holdOnOther});
  }
  return writes;
};

/** One-byte stock VIA dropdown plus the firmware's support marker; actions/terms are BE16. */
export const tapDanceWriteBytes = (write: TapDanceWrite): number[] =>
  /_mode$/.test(write.name) ? [write.value, 0xd2] :
  /_hold_other$/.test(write.name) ? [write.value, 0xd3] :
  /_hold_term$/.test(write.name) ? [write.value >> 8, write.value & 0xff, 0xd3] :
  [write.value >> 8, write.value & 0xff];

export type TapDanceField = TapDanceActionRole | 'term' | 'mode' | 'holdTerm' | 'holdOnOther';

/** What the user set on a slot and has not applied, field by field. */
export type TapDanceChanges = Partial<Record<TapDanceActionRole, number>> & {
  term?: string;
  mode?: number;
  holdTerm?: string;
  holdOnOther?: number;
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

/** The changes that still differ from what the keyboard holds. */
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
    (role) => role === 'tap' || (draft.mode === 0
      ? draft.actions[role] !== 0 && draft.actions[role] !== 1
      : draft.actions[role] !== 1),
  );

export const tapDanceImmediate = (draft: TapDanceDraft): boolean =>
  draft.mode === 2 || (draft.mode === 1 && tapDanceVisibleRoles(draft).length === 1);

/** Opening a legacy slot never migrates it; an explicit edit stages the conversion. */
export const editTapDanceBehavior = (
  draft: TapDanceDraft, next: TapDanceChanges,
): TapDanceChanges => draft.mode === 0 ? {
  mode: 1,
  ...Object.fromEntries((['hold', 'dtap', 'thold'] as const).map((role) =>
    [role, draft.actions[role] === 0 ? 1 : draft.actions[role]],
  )),
  ...next,
} : next;
