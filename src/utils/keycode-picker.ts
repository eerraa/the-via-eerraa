import {
  advancedStringToKeycode,
  anyKeycodeToString,
} from './advanced-keys';
import type {IKeycode, IKeycodeMenu} from './key';
import {getByteForCode, keycodeInMaster} from './key';

const KC_NO_ALIASES = new Set(['KC_NO', 'KC_TRNS', 'KC_TRANSPARENT']);

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

export function resolveComposeBaseCode(
  input: string,
  menus: IKeycodeMenu[],
  basicKeyToByte: Record<string, number>,
  byteToKey: Record<number, string>,
): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  const needle = trimmed.toLowerCase();
  for (const menu of menus) {
    for (const keycode of menu.keycodes) {
      if (!keycode.code || keycode.code === 'text') {
        continue;
      }
      if (
        keycode.code.toLowerCase() === needle ||
        keycode.name.toLowerCase() === needle ||
        keycode.shortName?.toLowerCase() === needle
      ) {
        return keycode.code;
      }
    }
  }
  const parsed = parseKeycodeInput(trimmed, basicKeyToByte);
  if (parsed === null) {
    return null;
  }
  const kcNo = basicKeyToByte.KC_NO ?? 0;
  if (parsed === kcNo) {
    const explicitNo =
      needle === 'kc_no' ||
      needle === 'kc_trns' ||
      needle === 'kc_transparent' ||
      needle === 'no';
    if (!explicitNo) {
      return null;
    }
  }
  return byteToKey[parsed] ?? formatKeycodeHex(parsed);
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
  if (fromAdvanced) {
    return fromAdvanced & 0xffff;
  }
  if (/^0x[0-9a-f]{1,4}$/i.test(trimmed)) {
    return Number.parseInt(trimmed, 16) & 0xffff;
  }
  if (/^[0-9a-f]{4}$/i.test(trimmed) && /[a-f]/i.test(trimmed)) {
    return Number.parseInt(trimmed, 16) & 0xffff;
  }
  try {
    return getByteForCode(trimmed.toUpperCase(), basicKeyToByte) & 0xffff;
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
  if (!keycodeInMaster(code, basicKeyToByte) && !code.startsWith('CUSTOM(')) {
    return null;
  }
  try {
    return getByteForCode(code, basicKeyToByte) & 0xffff;
  } catch {
    return parseKeycodeInput(code, basicKeyToByte);
  }
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
  const haystack = [keycode.name, keycode.code, keycode.title, keycode.shortName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

export function filterKeycodeMenus(
  menus: IKeycodeMenu[],
  query: string,
): IKeycodeMenu[] {
  const needle = query.trim();
  if (!needle) {
    return menus;
  }
  return menus
    .map((menu) => ({
      ...menu,
      keycodes: menu.keycodes.filter((keycode) =>
        keycodeMatchesQuery(keycode, needle),
      ),
    }))
    .filter((menu) => menu.keycodes.length > 0);
}

export function composeModTap(
  modsExpr: string,
  tapCode: string,
  basicKeyToByte: Record<string, number>,
): number | null {
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
  return parseKeycodeInput(`LT(${layer},${tapCode})`, basicKeyToByte);
}

export function composeModifier(
  modifierMacro: string,
  tapCode: string,
  basicKeyToByte: Record<string, number>,
): number | null {
  return parseKeycodeInput(`${modifierMacro}(${tapCode})`, basicKeyToByte);
}

export function isClearKeycode(
  value: number,
  basicKeyToByte: Record<string, number>,
): boolean {
  const kcNo = basicKeyToByte.KC_NO ?? 0;
  if (value === kcNo) {
    return true;
  }
  return [...KC_NO_ALIASES].some(
    (alias) => basicKeyToByte[alias] === value,
  );
}
