import {
  advancedStringToKeycode,
  anyKeycodeToString,
  modifierKeyToValue,
  modMasks,
} from './advanced-keys';
import type {IKeycode, IKeycodeMenu} from './key';
import {getByteForCode, keycodeInMaster} from './key';
import {getComposeKeycodeDisabledReason} from './keycode-eligibility';
export {getComposeKeycodeDisabledReason} from './keycode-eligibility';

const KC_NO_ALIASES = new Set(['KC_NO', 'KC_TRNS', 'KC_TRANSPARENT']);

const isExplicitClearInput = (input: string) =>
  KC_NO_ALIASES.has(input.toUpperCase()) || input.toUpperCase() === 'NO';

export function formatKeycodeHex(value: number): string {
  const clamped = value & 0xffff;
  return `0x${clamped.toString(16).toUpperCase().padStart(4, '0')}`;
}

export function formatKeycodeLabel(
  value: number,
  basicKeyToByte: Record<string, number>,
  byteToKey: Record<number, string>,
): string {
  const named = anyKeycodeToString(value, basicKeyToByte, byteToKey);
  if (named) {
    return named;
  }
  return formatKeycodeHex(value);
}

export function getComposeBaseKeycodes(
  menus: IKeycodeMenu[],
  basicKeyToByte: Record<string, number>,
): IKeycode[] {
  const seen = new Set<string>();
  return menus.flatMap((menu) => menu.keycodes).filter((keycode) => {
    if (!keycode.code || keycode.code === 'text' || seen.has(keycode.code)) {
      return false;
    }
    const parsed = parseKeycodeInput(keycode.code, basicKeyToByte);
    if (getComposeKeycodeDisabledReason(parsed, basicKeyToByte) !== null) {
      return false;
    }
    seen.add(keycode.code);
    return true;
  });
}

export function parseKeycodeInput(
  input: string,
  basicKeyToByte: Record<string, number>,
): number | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  const fromAdvanced = advancedStringToKeycode(
    trimmed.toUpperCase(),
    basicKeyToByte,
  );
  if (Number.isInteger(fromAdvanced) && fromAdvanced !== 0) {
    return fromAdvanced & 0xffff;
  }
  if (/^0x[0-9a-f]{1,4}$/i.test(trimmed)) {
    return Number.parseInt(trimmed, 16) & 0xffff;
  }
  if (/^[0-9a-f]{4}$/i.test(trimmed) && /[a-f]/i.test(trimmed)) {
    return Number.parseInt(trimmed, 16) & 0xffff;
  }
  const normalized = trimmed.toUpperCase();
  if (/[()]/.test(normalized)) {
    // The legacy menu decoder searches inside expressions and clamps ordinals.
    // A failed expression must not re-enter it and become a different keycode.
    const tapDance = normalized.match(/^TD\((\d+)\)$/);
    if (!tapDance) {
      return null;
    }
    const index = Number(tapDance[1]);
    const base = basicKeyToByte._QK_KB;
    const max = basicKeyToByte._QK_KB_MAX;
    return Number.isSafeInteger(index) && index >= 0 && base + index <= max
      ? base + index
      : null;
  }
  const fromBasic = basicKeyToByte[normalized];
  if (fromBasic !== undefined) {
    return fromBasic & 0xffff;
  }
  try {
    const parsed = getByteForCode(normalized, basicKeyToByte) & 0xffff;
    const kcNo = basicKeyToByte.KC_NO ?? 0;
    return parsed === kcNo && !isExplicitClearInput(normalized) ? null : parsed;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ typing slips

// The Korean two-set layout's letters by the key each is on, so a code typed with
// the Korean input method still on reads as the keys pressed: ㅣㅡ is LM. A doubled
// consonant is its key with Shift; a cluster or a compound vowel is the two keys
// typed for it.
const KEY_OF_JAMO: Record<string, string> = {
  ㄱ: 'R', ㄲ: 'R', ㄳ: 'RT', ㄴ: 'S', ㄵ: 'SW', ㄶ: 'SG', ㄷ: 'E', ㄸ: 'E',
  ㄹ: 'F', ㄺ: 'FR', ㄻ: 'FA', ㄼ: 'FQ', ㄽ: 'FT', ㄾ: 'FX', ㄿ: 'FV', ㅀ: 'FG',
  ㅁ: 'A', ㅂ: 'Q', ㅃ: 'Q', ㅄ: 'QT', ㅅ: 'T', ㅆ: 'T', ㅇ: 'D', ㅈ: 'W',
  ㅉ: 'W', ㅊ: 'C', ㅋ: 'Z', ㅌ: 'X', ㅍ: 'V', ㅎ: 'G', ㅏ: 'K', ㅐ: 'O',
  ㅑ: 'I', ㅒ: 'O', ㅓ: 'J', ㅔ: 'P', ㅕ: 'U', ㅖ: 'P', ㅗ: 'H', ㅘ: 'HK',
  ㅙ: 'HO', ㅚ: 'HL', ㅛ: 'Y', ㅜ: 'N', ㅝ: 'NJ', ㅞ: 'NP', ㅟ: 'NL', ㅠ: 'B',
  ㅡ: 'M', ㅢ: 'ML', ㅣ: 'L',
};
// A syllable's parts in Unicode's order: 밋 is ㅁ, ㅣ and ㅅ.
const INITIALS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const MEDIALS = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const FINALS = 'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';

const keysOfHangul = (char: string) => {
  const syllable = char.charCodeAt(0) - 0xac00;
  if (syllable < 0 || syllable >= 11172) {
    return KEY_OF_JAMO[char] ?? char;
  }
  const final = syllable % 28;
  return [
    INITIALS[Math.floor(syllable / 588)],
    MEDIALS[Math.floor((syllable % 588) / 28)],
    final ? FINALS[final - 1] : '',
  ]
    .map((jamo) => KEY_OF_JAMO[jamo] ?? '')
    .join('');
};

/**
 * Typed text in the capitals a code is written in, however it was typed: the
 * full-width forms a Chinese or Japanese input method types, and the keys under
 * what the Korean one typed, read as the ASCII they stand for.
 */
export const typedAsAscii = (input: string) =>
  [...input]
    .map((char) => {
      const code = char.charCodeAt(0);
      return code >= 0xff01 && code <= 0xff5e
        ? String.fromCharCode(code - 0xfee0)
        : char === '\u3000'
          ? ' '
          : char === '、' || char === '。'
            ? ','
            : keysOfHangul(char);
    })
    .join('')
    .toUpperCase();

// What each argument of a code the decoder reads takes. A modifier function such
// as LCTL takes one key, which may be another modifier function.
type Takes = 'layer' | 'number' | 'mods' | 'key';
const TAKES: Record<string, Takes[]> = {
  MT: ['mods', 'key'],
  LT: ['layer', 'key'],
  LM: ['layer', 'mods'],
  OSM: ['mods'],
  MO: ['layer'],
  TG: ['layer'],
  TO: ['layer'],
  DF: ['layer'],
  OSL: ['layer'],
  TT: ['layer'],
  TD: ['number'],
  MACRO: ['number'],
  CUSTOM: ['number'],
};
const takesOf = (name: string): Takes[] | undefined =>
  TAKES[name] ??
  (modifierKeyToValue.hasOwnProperty(name) ? ['key'] : undefined);

// A modifier's kind by the words people use for it: Ctrl is CTL, Win is GUI.
const MOD_KINDS: Record<string, string> = {
  CTL: 'CTL',
  CTRL: 'CTL',
  SFT: 'SFT',
  SHIFT: 'SFT',
  ALT: 'ALT',
  OPT: 'ALT',
  GUI: 'GUI',
  WIN: 'GUI',
  CMD: 'GUI',
};

// A MOD_ mask, written as one or named as a modifier or its key: MOD_LALT, LALT,
// KC_LALT and ALT are all MOD_LALT, since a word with no hand is the left one.
const modMaskOf = (name: string) => {
  const bare = name.replace(/^(MOD_|KC_)/, '');
  if (modMasks.hasOwnProperty(`MOD_${bare}`)) {
    return `MOD_${bare}`;
  }
  const [, hand, word] = /^([LR]?)(.*)$/.exec(bare)!;
  return MOD_KINDS[word] ? `MOD_${hand || 'L'}${MOD_KINDS[word]}` : null;
};

// A key by its code, or with KC_ left off: A is KC_A, SPC is KC_SPC.
const keyCodeOf = (name: string, basicKeyToByte: Record<string, number>) => {
  const named = (code: string) =>
    !code.startsWith('_') && basicKeyToByte[code] !== undefined;
  return /^0X[0-9A-F]{1,4}$/.test(name) || named(name)
    ? name
    : named(`KC_${name}`)
      ? `KC_${name}`
      : null;
};

// The text as words, brackets, commas and bars, keeping its spaces, which can
// stand for a bracket or a comma. A function's name run into its layer or number
// ("LM2") is split from it.
const wordsOf = (text: string) =>
  (text.match(/[A-Z0-9_]+|[(),|]|\s+/g) ?? []).flatMap((token) => {
    const run = /^([A-Z]+)(\d+)$/.exec(token);
    const first = run ? TAKES[run[1]]?.[0] : undefined;
    return run && (first === 'layer' || first === 'number')
      ? [run[1], '(', run[2]]
      : [token];
  });

type Typed = {name: string; args?: Typed[][]};

// A code read as it was meant: the end of the text closes what is left open, a
// bracket closed once too often at the end is let be, and a space stands for a
// comma between arguments, and for the bracket after a function's name of two
// letters or more, so "a b" stays a search. Null where it does not read so.
const readLeniently = (tokens: string[]): Typed | null => {
  let at = 0;
  const isWord = (token?: string) => !!token && /^[A-Z0-9_]+$/.test(token);
  const isSpace = (token?: string) => !!token && /^\s+$/.test(token);
  const skipSpaces = () => {
    while (isSpace(tokens[at])) {
      at++;
    }
  };
  // A function's name opens a call only where one can stand: at the start, or as
  // the key of a modifier function, as in LCTL(LSFT(KC_A)). Anywhere else a name
  // is a value, so MT(LALT A) is MT(LALT,A), not MT(LALT(A)).
  const value = (callable: boolean): Typed | null => {
    skipSpaces();
    const name = tokens[at];
    if (!isWord(name)) {
      return null;
    }
    at++;
    if (!callable || !takesOf(name)) {
      return {name};
    }
    let next = at;
    while (isSpace(tokens[next])) {
      next++;
    }
    if (tokens[next] === '(') {
      at = next + 1;
      return call(name);
    }
    if (name.length > 1 && next > at && isWord(tokens[next])) {
      at = next;
      return call(name);
    }
    return {name};
  };
  // Modifiers joined by bars, or one value.
  const choices = (callable: boolean): Typed[] | null => {
    const list: Typed[] = [];
    for (;;) {
      const one = value(callable);
      if (!one) {
        return null;
      }
      list.push(one);
      skipSpaces();
      if (tokens[at] !== '|') {
        return list;
      }
      at++;
    }
  };
  const call = (name: string): Typed | null => {
    const args: Typed[][] = [];
    for (;;) {
      const arg = choices(!TAKES[name]);
      if (!arg) {
        return null;
      }
      args.push(arg);
      if (tokens[at] === ',') {
        at++;
      } else if (tokens[at] === ')' || at === tokens.length) {
        at = Math.min(at + 1, tokens.length);
        return {name, args};
      } else if (!(isWord(tokens[at]) && isSpace(tokens[at - 1]))) {
        return null;
      }
    }
  };
  const typed = value(true);
  while (tokens[at] === ')' || isSpace(tokens[at])) {
    at++;
  }
  return typed && at === tokens.length ? typed : null;
};

// The code in the decoder's own words, or null where a part names nothing its
// place takes. A layer may be written as the keycaps write it: L2.
const writeTyped = (
  typed: Typed,
  takes: Takes | undefined,
  basicKeyToByte: Record<string, number>,
): string | null => {
  if (typed.args) {
    const wants = takesOf(typed.name)!;
    if (typed.args.length !== wants.length) {
      return null;
    }
    const args = typed.args.map((arg, index) => {
      if (wants[index] === 'mods') {
        const masks = arg.map((one) => (one.args ? null : modMaskOf(one.name)));
        return masks.includes(null) ? null : masks.join('|');
      }
      return arg.length === 1
        ? writeTyped(arg[0], wants[index], basicKeyToByte)
        : null;
    });
    return args.includes(null) ? null : `${typed.name}(${args.join(',')})`;
  }
  switch (takes) {
    case 'layer':
      return /^L?(\d+)$/.exec(typed.name)?.[1] ?? null;
    case 'number':
      return /^\d+$/.test(typed.name) ? typed.name : null;
    case 'key':
      return keyCodeOf(typed.name, basicKeyToByte);
    default:
      return typed.name;
  }
};

/**
 * A code typed in a search box, written as the decoder reads it, with what typing
 * slips leave out or swap put right: a bracket left open, a space for a bracket or
 * a comma, a name run into its layer, [ { ] } for brackets, ; or . for a comma,
 * + or \ for |, - for _, MOD_ or KC_ left off, a modifier key or word for its
 * mask, a layer written L2, and whatever an input method typed (typedAsAscii).
 * Only how a code is written is put right, never which key it names. Text that
 * does not read as a function's code, or not yet, comes back in capitals.
 */
export function correctTypedKeycode(
  input: string,
  basicKeyToByte: Record<string, number>,
): string {
  const text = typedAsAscii(input)
    .replace(/[[{]/g, '(')
    .replace(/[\]}]/g, ')')
    .replace(/[;.]/g, ',')
    .replace(/[+\\]/g, '|')
    .replace(/-/g, '_')
    .trim();
  const typed = /^[A-Z0-9_(),|\s]*$/.test(text)
    ? readLeniently(wordsOf(text))
    : null;
  return (typed?.args && writeTyped(typed, undefined, basicKeyToByte)) || text;
}

export function selectKeycodeFromMenuCode(
  code: string,
  basicKeyToByte: Record<string, number>,
): number | null {
  if (code === 'text') {
    return null;
  }
  if (
    !keycodeInMaster(code, basicKeyToByte) &&
    !code.startsWith('CUSTOM(') &&
    !code.startsWith('TD(')
  ) {
    return null;
  }
  return parseKeycodeInput(code, basicKeyToByte);
}

export function clearKeycodeValue(
  basicKeyToByte: Record<string, number>,
): number {
  return (basicKeyToByte.KC_NO ?? 0) & 0xffff;
}

export function keycodeMatchesQuery(keycode: IKeycode, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  const haystack = [
    keycode.name,
    keycode.code,
    keycode.title,
    keycode.shortName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

export function composeModTap(
  modsExpr: string,
  tapCode: string,
  basicKeyToByte: Record<string, number>,
): number | null {
  if (
    getComposeKeycodeDisabledReason(
      parseKeycodeInput(tapCode, basicKeyToByte),
      basicKeyToByte,
    )
  ) {
    return null;
  }
  return parseKeycodeInput(`MT(${modsExpr},${tapCode})`, basicKeyToByte);
}

export function composeLayerTap(
  layer: number,
  tapCode: string,
  basicKeyToByte: Record<string, number>,
): number | null {
  if (!Number.isInteger(layer) || layer < 0 || layer > 15) {
    return null;
  }
  if (
    getComposeKeycodeDisabledReason(
      parseKeycodeInput(tapCode, basicKeyToByte),
      basicKeyToByte,
    )
  ) {
    return null;
  }
  return parseKeycodeInput(`LT(${layer},${tapCode})`, basicKeyToByte);
}

export function composeModifiers(
  modifierMacros: string[],
  tapCode: string,
  basicKeyToByte: Record<string, number>,
): number | null {
  if (modifierMacros.length === 0) {
    return null;
  }
  if (
    getComposeKeycodeDisabledReason(
      parseKeycodeInput(tapCode, basicKeyToByte),
      basicKeyToByte,
    )
  ) {
    return null;
  }
  const expression = modifierMacros.reduceRight(
    (keycode, modifier) => `${modifier}(${keycode})`,
    tapCode,
  );
  return parseKeycodeInput(expression, basicKeyToByte);
}
