import {advancedStringToKeycode, anyKeycodeToString} from './advanced-keys';
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
