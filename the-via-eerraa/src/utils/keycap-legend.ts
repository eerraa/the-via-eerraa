// Keycap legends: one rule for every keycap the app draws, so a key reads the same
// on the keyboard, 2D or 3D, and in the keycode palette. Lines are placed in the 2D
// keyboard's pixels on the key's top face, which the 3D keyboard scales to its own,
// and text is measured with the legend font's advance widths, so no DOM is needed.

/**
 * A line of legend, its baseline measured down from the face's top edge or its
 * middle, or up from its bottom edge.
 */
type LegendLine = {
  text: string;
  /** Font size in px. */
  size: number;
  /** Left edge of the text, from the face's left edge. */
  x: number;
  y: number;
  from: 'top' | 'middle' | 'bottom';
  opacity: number;
};

export type KeycapLegend = {
  lines: LegendLine[];
};

/** A line's baseline, down from the top of a face `height` px high. */
export const legendBaseline = (line: LegendLine, height: number) =>
  line.from === 'top'
    ? line.y
    : line.from === 'middle'
      ? height / 2 + line.y
      : height - line.y;

export type LegendModifier = 'CTL' | 'SFT' | 'ALT' | 'GUI';

/** A key as the keycode list names it, in the host layout; `shortName` is VIA's. */
export type LegendName = {code: string; name: string; shortName?: string};

export type LegendKey =
  | ({type: 'named'} & LegendName)
  | {
      type: 'combined';
      /** Layer-Tap, Mod-Tap, or a key sent with modifiers held. */
      kind: 'LT' | 'MT' | 'MOD';
      code: string;
      tap: LegendName;
      layer: number;
      modifiers: LegendModifier[];
      /** The modifiers are the right-hand ones. */
      right: boolean;
    };

/** The face every legend is set in, bold. */
export const LEGEND_FONT =
  'Fira Sans, Arial Rounded MT, Arial Rounded MT Bold, Arial';

/** A key's top face on the 2D keyboard in px: 52w − 12 across, 54h − 12 high. */
export const faceSize = (width = 1, height = 1) => ({
  width: 52 * width - 12,
  height: 54 * height - 12,
});

// A CJK or Hangul glyph is about as wide as 1.6 Latin ones at the same size.
const WIDE_GLYPH = /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/;

// Advance widths of the legend font, in em: Fira Sans at weight 700, which the app
// synthesizes from the loaded 400 face. Measured in Chrome; other glyphs fall back to
// an average Latin width, and CJK or Hangul to a full em.
// prettier-ignore
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

/** A line's width in em of the legend font. */
export const legendEm = (text: string) =>
  [...text].reduce((em, glyph) => em + glyphEm(glyph), 0);

// Text starts 4px in from the face's left edge and stops 2px short of its right. A
// top line's baseline is 4px plus three quarters of its size down, each next line
// 1.15 of its own size lower; a bottom line's baseline is 4px up from the bottom edge.
// Lines in the middle are centred on their cap height, as VIA centres a word, in the
// room small legends leave them, 4px clear of each.
const MARGIN = 4;
const RIGHT_MARGIN = 2;
const CAP = 0.75;
const LEADING = 1.15;
const SMALL_GAP = 4;
// A single glyph, a shifted pair, then words at one size on a line or two; smaller
// only to fit, down to 10px, and to 9px only for what fits nothing larger.
const GLYPH_SIZE = 18;
const PAIR_SIZE = 14;
const WORD_SIZE = 13;
const SMALL_SIZES = [12, 11, 10, 9];
// The small legend: what a hold does, the modifiers sent, KP, a layer function, a
// lighting key's system.
const SMALL_LEGEND = 11;
const SMALL_OPACITY = 0.75;
// Two lines of name keep clear of a small legend on a 1u-high face: up to 12px over
// one at the bottom, up to 11px under a combo's modifiers at the top.
const TWO_LINES_OVER_SMALL = 12;
const TWO_LINES_UNDER_SMALL = 11;

// Shorter wordings for names that fit a 1u face only at an unreadable size or not at
// all, and have no VIA short name. The keycode footer names the key in full.
const ABBREVIATION: Record<string, string> = {
  KC_CAPS: 'Caps',
  KC_MPRV: 'Prev',
  KC_MRWD: 'Rew',
  KC_MFFD: 'Fast\nFwd',
  KC_WWW_FORWARD: 'Fwd',
  KC_WWW_FAVORITES: 'Fav',
  KC_LNUM: 'Locking\nNum',
  KC_LCAP: 'Locking\nCaps',
  KC_LSCR: 'Locking\nScroll',
  // On and Off, like the Audio and Music keys beside them (QMK CK_ON, CK_OFF).
  CLICKY_ENABLE: 'Clicky\nOn',
  CLICKY_DISABLE: 'Clicky\nOff',
  // RGB presets too wide even at 9px, shortened as VIA shortens Backspace.
  RGB_M_R: 'Rnbw',
  RGB_M_G: 'Grad',
};
// A lighting key names its system small, as a keypad key says KP: RM Toggle reads
// Toggle over RM. A key whose VIA name reads badly takes a name of its own.
const LIGHTING_SYSTEM = /^(RM|UG|BL|RGB) (.+)$/;
const LIGHTING_NAMES: Record<string, [system: string, name: string]> = {
  // Backlight breathing on/off. VIA's "BR Toggle" read like a second Toggle.
  BL_BRTG: ['BL', 'Breath'],
  // An RGB preset by its effect, as QMK's RGB_MODE_RAINBOW names it.
  RGB_M_P: ['RGB', 'Plain'],
  RGB_M_B: ['RGB', 'Breathe'],
  RGB_M_R: ['RGB', 'Rainbow'],
  RGB_M_SW: ['RGB', 'Swirl'],
  RGB_M_SN: ['RGB', 'Snake'],
  RGB_M_K: ['RGB', 'Knight'],
  RGB_M_X: ['RGB', 'Xmas'],
  RGB_M_G: ['RGB', 'Gradient'],
};
// A custom keycode the keyboard gives no name: "Custom" over its number.
const UNNAMED_CUSTOM = /^CUSTOM\((\d+)\)$/;

const ARROW = /^[↑←→↓]$/;
// A layer key reads as its layer, with the function in small type: MO(1) is 1 over MO.
const LAYER_FUNCTION = /^(MO|TG|TO|DF|OSL|TT)\((\d+)\)$/;
// Keypad keys share their legend with the main block; KP in small type tells them apart.
const KEYPAD = new Set([
  ...Array.from({length: 10}, (_, digit) => `KC_P${digit}`),
  'KC_PSLS',
  'KC_PAST',
  'KC_PMNS',
  'KC_PPLS',
  'KC_PDOT',
  'KC_PCMM',
  'KC_PEQL',
]);

const MODIFIERS: LegendModifier[] = ['CTL', 'SFT', 'ALT', 'GUI'];
// Each modifier's name, then shorter, then its initial.
const MODIFIER_NAMES: Record<LegendModifier, string[]> = {
  CTL: ['Ctrl', 'Ctl', 'C'],
  SFT: ['Shift', 'Sft', 'S'],
  ALT: ['Alt', 'Alt', 'A'],
  GUI: ['Win', 'Win', 'W'],
};

/** A modifier's name; a right-hand one takes an R. */
export const modifierLabel = (modifier: LegendModifier, right: boolean) =>
  (right ? 'R' : '') + MODIFIER_NAMES[modifier][0];

const widest = (lines: string[]) => Math.max(0, ...lines.map(legendEm));

const fits = (lines: string[], size: number, room: number) =>
  widest(lines) * size <= room;

/**
 * Modifiers held, as wide as fits at the small size: Ctrl+Shift, Ctl+Sft, C+S,
 * then CS, which alone is set smaller where it must be, down to 9px.
 */
const heldLabel = (
  modifiers: LegendModifier[],
  right: boolean,
  suffix: string,
  room: number,
): {text: string; size: number} => {
  const held = MODIFIERS.filter((modifier) => modifiers.includes(modifier));
  const hand = right ? 'R' : '';
  const wordings = [
    ...[0, 1, 2].map((tier) =>
      held.map((modifier) => hand + MODIFIER_NAMES[modifier][tier]).join('+'),
    ),
    hand + held.map((modifier) => MODIFIER_NAMES[modifier][2]).join(''),
  ].map((wording) => wording + suffix);
  const text = wordings.find((wording) => fits([wording], SMALL_LEGEND, room));
  if (text) {
    return {text, size: SMALL_LEGEND};
  }
  const initials = wordings[wordings.length - 1];
  const smaller = SMALL_SIZES.filter((size) => size < SMALL_LEGEND);
  return {
    text: initials,
    size:
      smaller.find((size) => fits([initials], size, room)) ??
      smaller[smaller.length - 1],
  };
};

type Setting = {
  lines: string[];
  size: number;
  pair?: boolean;
};

// A shifted pair is printed like a keycap's: one glyph or two a line, no word.
const isShiftedPair = (lines: string[]) =>
  lines.length === 2 &&
  lines.every((line) => {
    const glyphs = [...line].length;
    return glyphs <= 1 || (glyphs === 2 && !/\p{Ll}/u.test(line));
  });

/** The most even break of a wording over two lines at a space, if it has one. */
const broken = (text: string): string[] | null => {
  const words = text.split(' ');
  let best: string[] | null = null;
  for (let cut = 1; cut < words.length; cut++) {
    const lines = [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
    if (!best || widest(lines) < widest(best)) {
      best = lines;
    }
  }
  return best;
};

/**
 * A wording's lines at `size`: as its "\n" breaks them, else on one line or broken
 * over two, where two lines are allowed at that size; else all on one line.
 */
const arrangements = (
  text: string,
  size: number,
  twoLinesUpTo: number,
): string[][] => {
  const twoLines = size <= twoLinesUpTo;
  if (text.includes('\n')) {
    const lines = text.split('\n');
    return twoLines ? [lines] : [[lines.join(' ')]];
  }
  const two = twoLines ? broken(text) : null;
  return two ? [[text], two] : [[text]];
};

/** A wording at the legend's own sizes, or null where it needs a smaller one. */
const atLegendSize = (
  text: string,
  room: number,
  twoLinesUpTo: number,
): Setting | null => {
  if (isShiftedPair(text.split('\n'))) {
    return {lines: text.split('\n'), size: PAIR_SIZE, pair: true};
  }
  if ([...text].length === 1) {
    return {lines: [text], size: GLYPH_SIZE};
  }
  const lines = arrangements(text, WORD_SIZE, twoLinesUpTo).find((option) =>
    fits(option, WORD_SIZE, room),
  );
  return lines ? {lines, size: WORD_SIZE} : null;
};

/**
 * The name at the legend's sizes, else its abbreviation; failing both, the last
 * wording at the largest smaller size it fits, else at the smallest, never cut.
 * Two lines are allowed up to `twoLinesUpTo`px.
 */
const setLegend = (
  wordings: string[],
  room: number,
  twoLinesUpTo = Infinity,
): Setting | null => {
  if (!wordings.length) {
    return null;
  }
  for (const text of wordings) {
    const setting = atLegendSize(text, room, twoLinesUpTo);
    if (setting) {
      return setting;
    }
  }
  const text = wordings[wordings.length - 1];
  for (const size of SMALL_SIZES) {
    const lines = arrangements(text, size, twoLinesUpTo).find((option) =>
      fits(option, size, room),
    );
    if (lines) {
      return {lines, size};
    }
  }
  const size = SMALL_SIZES[SMALL_SIZES.length - 1];
  return {
    lines: arrangements(text, size, twoLinesUpTo).reduce((narrowest, option) =>
      widest(option) < widest(narrowest) ? option : narrowest,
    ),
    size,
  };
};

/**
 * A name, then its abbreviation: VIA's short name, else ours. A tap is the key it
 * sends, so a shifted pair taps its lower glyph.
 */
const wordingsOf = ({code, name, shortName}: LegendName, tap = false) => {
  if (shortName && ARROW.test(shortName)) {
    return [shortName];
  }
  const custom = UNNAMED_CUSTOM.exec(name);
  const wordings = [
    custom ? `Custom\n${custom[1]}` : name,
    shortName ?? ABBREVIATION[code],
  ].flatMap((wording) => {
    if (!wording?.trim()) {
      return [];
    }
    const lines = wording.split('\n');
    return [tap && isShiftedPair(lines) ? lines[1] : wording];
  });
  return [...new Set(wordings)];
};

const topLine = (
  text: string,
  size: number,
  above?: LegendLine,
  opacity = 1,
): LegendLine => ({
  text,
  size,
  x: MARGIN,
  y: above ? above.y + size * LEADING : MARGIN + CAP * size,
  from: 'top',
  opacity,
});

const bottomLine = (
  text: string,
  size: number,
  raise = 0,
  opacity = 1,
): LegendLine => ({
  text,
  size,
  x: MARGIN,
  y: MARGIN + raise,
  from: 'bottom',
  opacity,
});

const smallLine = (text: string, size = SMALL_LEGEND) =>
  bottomLine(text, size, 0, SMALL_OPACITY);

// A low or high glyph of a shifted pair is moved toward the middle, by a share of
// its cap height: "^" down, "," up.
const pairOffsets = (top: string, bottom: string): [number, number] => [
  top.length === 1 && '^*"'.includes(top) ? 0.2 : 0,
  bottom.length !== 1
    ? 0
    : ',.'.includes(bottom)
      ? 0.4
      : "/\\;'[]".includes(bottom)
        ? 0.3
        : bottom === '-'
          ? 0.1
          : 0,
];

/** A setting's lines down from the top, or from under a line already there. */
const placed = (setting: Setting | null, under?: LegendLine): LegendLine[] => {
  if (!setting) {
    return [];
  }
  const {lines, size} = setting;
  if (setting.pair) {
    const [top, bottom] = lines;
    const [topOffset, bottomOffset] = pairOffsets(top, bottom);
    return [
      {...topLine(top, size), y: MARGIN + CAP * size * (1 + topOffset)},
      bottomLine(bottom, size, CAP * size * bottomOffset),
    ];
  }
  return lines.reduce<LegendLine[]>(
    (above, text) => [
      ...above,
      topLine(text, size, above[above.length - 1] ?? under),
    ],
    [],
  );
};

// A letter or a digit is printed at the top left, as on a keycap.
const PRINTED = /^[\p{L}\p{N}]$/u;

/**
 * A setting where VIA puts it: a letter or a digit down from the top, or from under
 * a line already there, a shifted pair at the top and bottom, and a word, an arrow
 * or a symbol in the middle of the room left between `above` px taken at the top
 * and `below` px at the bottom.
 */
const set = (
  setting: Setting | null,
  {
    above = 0,
    below = 0,
    under,
  }: {above?: number; below?: number; under?: LegendLine} = {},
): LegendLine[] => {
  if (
    !setting ||
    setting.pair ||
    (setting.lines.length === 1 && PRINTED.test(setting.lines[0]))
  ) {
    return placed(setting, under);
  }
  const {lines, size} = setting;
  const first =
    (above - below) / 2 +
    (CAP * size - (lines.length - 1) * LEADING * size) / 2;
  return lines.map((text, index) => ({
    text,
    size,
    x: MARGIN,
    y: first + index * LEADING * size,
    from: 'middle',
    opacity: 1,
  }));
};

/** What a small legend takes from the room: its cap height and the gap. */
const smallRoom = (size: number) => CAP * size + SMALL_GAP;

/**
 * A key's legend on a face `width` units wide. The name is set at 18px for one
 * glyph and 14px for a shifted pair, else 13px on a line or broken over two at a
 * space, else in a shorter wording, else smaller down to 10px, 9px for what fits
 * nothing larger; it is never cut. It goes where VIA puts it: a letter or a digit
 * at the top left, a pair at the top and bottom, and a word, an arrow or a symbol
 * in the middle. A hold, the modifiers of a combo, KP, a layer function and a
 * lighting key's system are set small: a combo's modifiers at the top, the others
 * at the bottom, and the name keeps clear of them.
 */
export const keycapLegend = (key: LegendKey, width = 1): KeycapLegend => {
  const room = faceSize(width).width - MARGIN - RIGHT_MARGIN;
  if (key.type === 'combined') {
    const wordings = wordingsOf(key.tap, true);
    if (key.kind === 'MOD') {
      const {text, size} = heldLabel(key.modifiers, key.right, '+', room);
      const held = topLine(text, size, undefined, SMALL_OPACITY);
      const tap = setLegend(wordings, room, TWO_LINES_UNDER_SMALL);
      return {
        lines: [held, ...set(tap, {above: smallRoom(size), under: held})],
      };
    }
    const tap = setLegend(wordings, room, TWO_LINES_OVER_SMALL);
    const hold =
      key.kind === 'LT'
        ? {text: `L${key.layer}`, size: SMALL_LEGEND}
        : heldLabel(key.modifiers, key.right, '', room);
    return {
      lines: [
        ...set(tap, {below: smallRoom(hold.size)}),
        smallLine(hold.text, hold.size),
      ],
    };
  }
  const layer = LAYER_FUNCTION.exec(key.code);
  if (layer) {
    return {
      lines: [
        smallLine(layer[1]),
        ...set(setLegend([layer[2]], room), {below: smallRoom(SMALL_LEGEND)}),
      ],
    };
  }
  const lighting =
    LIGHTING_NAMES[key.code] ??
    LIGHTING_SYSTEM.exec(key.name.replace(/\n/g, ' ').trim())?.slice(1);
  if (lighting) {
    const main = setLegend(
      wordingsOf({code: key.code, name: lighting[1]}),
      room,
      TWO_LINES_OVER_SMALL,
    );
    return {
      lines: [
        ...set(main, {below: smallRoom(SMALL_LEGEND)}),
        smallLine(lighting[0]),
      ],
    };
  }
  const keypad = KEYPAD.has(key.code);
  const main = setLegend(
    wordingsOf(key, keypad),
    room,
    keypad ? TWO_LINES_OVER_SMALL : Infinity,
  );
  return {
    lines: keypad
      ? [...set(main, {below: smallRoom(SMALL_LEGEND)}), smallLine('KP')]
      : set(main),
  };
};

/** A legend on one line, as text: "Ctrl+A", "F3 L1", "MO 1". */
export const legendText = ({lines}: KeycapLegend) =>
  lines.reduce(
    (text, line) =>
      !text || text.endsWith('+') ? text + line.text : `${text} ${line.text}`,
    '',
  );
