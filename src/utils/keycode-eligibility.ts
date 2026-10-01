export type KeycodeDisabledReason =
  | 'invalid-keycode'
  | 'requires-basic-keycode'
  | 'recursive-tapdance'
  | 'unavailable-layer'
  | 'unavailable-macro'
  | 'unavailable-keycode'
  | 'tapdance-no-action'
  | 'unverified-tapdance';

/** English source strings; the palette translates them at the point of use. */
export const KEYCODE_DISABLED_MESSAGES: Record<KeycodeDisabledReason, string> = {
  'invalid-keycode': 'This keycode is invalid.',
  'requires-basic-keycode': 'Combined keys require an 8-bit basic keycode.',
  'recursive-tapdance': 'Tap Dance actions cannot start another Tap Dance.',
  'unavailable-layer': 'This layer is not available on this keyboard.',
  'unavailable-macro': 'This macro is not available on this keyboard.',
  'unavailable-keycode': 'This key is not available on this keyboard.',
  'tapdance-no-action': 'Transparent has no action in Tap Dance.',
  'unverified-tapdance':
    'Tap Dance action support is not verified for this keyboard.',
};

const isKeycode = (value: number | null): value is number =>
  value !== null && Number.isInteger(value) && value >= 0 && value <= 0xffff;

export const getComposeKeycodeDisabledReason = (
  value: number | null,
  basicKeyToByte?: Record<string, number>,
): KeycodeDisabledReason | null =>
  !isKeycode(value)
    ? 'invalid-keycode'
    : value > 0xff
      ? 'requires-basic-keycode'
      : basicKeyToByte &&
          !Object.entries(basicKeyToByte).some(
            ([code, byte]) => !code.startsWith('_') && byte === value,
          )
        ? 'unavailable-keycode'
      : null;

export type TapDanceEligibilityContext = {
  /** Both audited ERA engines dispatch actions and quantum keycodes. */
  engine: 'qmk' | 'h7s' | null;
  basicKeyToByte: Record<string, number>;
  layerCount: number;
  macroCount: number | null;
  tapDanceCount: number;
  /** The connected definition's enabled palette, including declared Custom keys. */
  availableKeycodes: ReadonlySet<number>;
};

const inRange = (
  value: number,
  base: string,
  dictionary: Record<string, number>,
) =>
  Number.isInteger(dictionary[base]) &&
  Number.isInteger(dictionary[`${base}_MAX`]) &&
  value >= dictionary[base] &&
  value <= dictionary[`${base}_MAX`];

/**
 * ERA QMK and H7S run QMK actions, then fall back to quantum handlers for macros,
 * lighting, system and declared Custom keys. Both explicitly suppress TD output
 * that starts another TD. The definition owns feature availability, not a host
 * guess that all quantum keycodes are unsupported.
 */
export const getTapDanceKeycodeDisabledReason = (
  value: number | null,
  context: TapDanceEligibilityContext,
): KeycodeDisabledReason | null => {
  if (!isKeycode(value)) {
    return 'invalid-keycode';
  }
  const dictionary = context.basicKeyToByte;
  // KC_NO clears an action. A transparent key does not resolve a layer in an
  // injected TD action: both engines omit it entirely.
  if (value === (dictionary.KC_NO ?? 0)) {
    return null;
  }
  if (value === (dictionary.KC_TRNS ?? 1)) {
    return 'tapdance-no-action';
  }
  if (context.engine === null) {
    return 'unverified-tapdance';
  }
  if (
    (value >= 0x5700 && value <= 0x57ff) ||
    (Number.isInteger(dictionary._QK_KB) &&
      value >= dictionary._QK_KB &&
      value < dictionary._QK_KB + context.tapDanceCount)
  ) {
    return 'recursive-tapdance';
  }
  if (inRange(value, '_QK_MACRO', dictionary)) {
    return context.macroCount !== null &&
      value - dictionary._QK_MACRO < context.macroCount
      ? null
      : 'unavailable-macro';
  }
  let layer: number | null = null;
  if (inRange(value, '_QK_LAYER_TAP', dictionary)) {
    layer = (value >> 8) & 0xf;
  } else if (inRange(value, '_QK_LAYER_MOD', dictionary)) {
    const mask = dictionary._QK_LAYER_MOD_MASK;
    layer = (value - dictionary._QK_LAYER_MOD) >> Math.log2(mask + 1);
  } else {
    for (const range of [
      '_QK_TO',
      '_QK_MOMENTARY',
      '_QK_DEF_LAYER',
      '_QK_TOGGLE_LAYER',
      '_QK_ONE_SHOT_LAYER',
      '_QK_LAYER_TAP_TOGGLE',
    ]) {
      if (inRange(value, range, dictionary)) {
        layer = value - dictionary[range];
        break;
      }
    }
  }
  if (layer !== null) {
    if (!Number.isInteger(layer) || layer < 0 || layer >= context.layerCount) {
      return 'unavailable-layer';
    }
    if (inRange(value, '_QK_LAYER_TAP', dictionary)) {
      return getComposeKeycodeDisabledReason(value & 0xff, dictionary);
    }
    if (
      inRange(value, '_QK_LAYER_MOD', dictionary) &&
      (value & dictionary._QK_LAYER_MOD_MASK & 0xf) === 0
    ) {
      return 'unavailable-keycode';
    }
    return null;
  }
  if (inRange(value, '_QK_MODS', dictionary)) {
    return (value & 0xf00) !== 0
      ? getComposeKeycodeDisabledReason(value & 0xff, dictionary)
      : 'unavailable-keycode';
  }
  if (inRange(value, '_QK_MOD_TAP', dictionary)) {
    return (value & 0xf00) !== 0
      ? getComposeKeycodeDisabledReason(value & 0xff, dictionary)
      : 'unavailable-keycode';
  }
  if (inRange(value, '_QK_ONE_SHOT_MOD', dictionary)) {
    return ((value - dictionary._QK_ONE_SHOT_MOD) & 0xf) !== 0
      ? null
      : 'unavailable-keycode';
  }
  // These four ERA quantum core actions are not feature-module keycodes. The
  // palette has no separate menu card for every one (for example EEPROM reset).
  if (value >= 0x7c00 && value <= 0x7c03) {
    return null;
  }
  if (context.availableKeycodes.has(value)) {
    return null;
  }
  return 'unavailable-keycode';
};
