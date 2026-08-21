import {advancedStringToKeycode, anyKeycodeToString} from './advanced-keys';
import type {IKeycode, IKeycodeMenu} from './key';
import {getByteForCode, keycodeInMaster} from './key';

const KC_NO_ALIASES = new Set(['KC_NO', 'KC_TRNS', 'KC_TRANSPARENT']);

const isExplicitClearInput = (input: string) =>
  KC_NO_ALIASES.has(input.toUpperCase()) || input.toUpperCase() === 'NO';

const isComposeBaseValue = (value: number) =>
  Number.isInteger(value) && value >= 0 && value <= 0xff;

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

export const COMPOSER_CATEGORY_ID = 'layers';

export const isComposerCategory = (categoryId: string | undefined) =>
  categoryId === COMPOSER_CATEGORY_ID;

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
    if (menu.id !== 'basic') {
      continue;
    }
    for (const keycode of menu.keycodes) {
      if (!keycode.code || keycode.code === 'text') {
        continue;
      }
      if (
        keycode.code.toLowerCase() === needle ||
        keycode.name.toLowerCase() === needle ||
        keycode.shortName?.toLowerCase() === needle
      ) {
        const parsed = basicKeyToByte[keycode.code];
        return parsed !== undefined && isComposeBaseValue(parsed)
          ? keycode.code
          : null;
      }
    }
  }
  // A compose base is a tap key, never another wrapper such as MO(), MT(), or
  // LT(). Menu-name matches above still allow descriptive Basic-key labels.
  if (/[()]/.test(trimmed)) {
    return null;
  }
  const parsed = parseKeycodeInput(trimmed, basicKeyToByte);
  if (parsed === null || !isComposeBaseValue(parsed)) {
    return null;
  }
  const kcNo = basicKeyToByte.KC_NO ?? 0;
  if (parsed === kcNo) {
    if (!isExplicitClearInput(needle)) {
      return null;
    }
  }
  return byteToKey[parsed] ?? formatKeycodeHex(parsed);
}

export function getComposeBaseKeycodes(
  menus: IKeycodeMenu[],
  basicKeyToByte: Record<string, number>,
): IKeycode[] {
  const basicMenu = menus.find((menu) => menu.id === 'basic');
  if (!basicMenu) {
    return [];
  }

  const seen = new Set<string>();
  return basicMenu.keycodes.filter((keycode) => {
    if (!keycode.code || keycode.code === 'text' || seen.has(keycode.code)) {
      return false;
    }
    const parsed = parseKeycodeInput(keycode.code, basicKeyToByte);
    if (parsed === null || !isComposeBaseValue(parsed)) {
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
  return composeModifiers([modifierMacro], tapCode, basicKeyToByte);
}

export function composeModifiers(
  modifierMacros: string[],
  tapCode: string,
  basicKeyToByte: Record<string, number>,
): number | null {
  if (modifierMacros.length === 0) {
    return null;
  }
  const expression = modifierMacros.reduceRight(
    (keycode, modifier) => `${modifier}(${keycode})`,
    tapCode,
  );
  return parseKeycodeInput(expression, basicKeyToByte);
}

export function isClearKeycode(
  value: number,
  basicKeyToByte: Record<string, number>,
): boolean {
  const kcNo = basicKeyToByte.KC_NO ?? 0;
  if (value === kcNo) {
    return true;
  }
  return [...KC_NO_ALIASES].some((alias) => basicKeyToByte[alias] === value);
}
