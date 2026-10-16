import {isKeyboardDefinitionV3} from '@the-via/reader';

const lightingModules = {
  none: undefined,
  backlight: 'qmk_backlight_keycodes',
  rgblight: 'qmk_rgblight_keycodes',
  backlight_rgblight: 'qmk_backlight_rgblight_keycodes',
  rgb_matrix: 'qmk_rgb_matrix_keycodes',
} as const;

export type DefinitionLighting = keyof typeof lightingModules;

const containsQmkLighting = (value: unknown): boolean =>
  value === 'qmk_lighting' ||
  (Array.isArray(value)
    ? value.some(containsQmkLighting)
    : value !== null &&
      typeof value === 'object' &&
      Object.values(value).some(containsQmkLighting));

/** Shared strict guard for custom sources and STOCK release-package JSON. */
export const validateV3Definition = (raw: unknown): string[] => {
  const errors: string[] = [];
  if (containsQmkLighting(raw)) {
    errors.push('qmk_lighting is forbidden; declare the board-specific module');
  }
  if (!isKeyboardDefinitionV3(raw)) {
    errors.push(
      `Invalid VIA V3 definition: ${JSON.stringify(isKeyboardDefinitionV3.errors)}`,
    );
  }
  return errors;
};

export const validateCustomDefinition = (
  raw: Record<string, unknown>,
  entry: {
    lighting: DefinitionLighting;
    vendorId?: string;
    productId?: string;
  },
): string[] => {
  // Only this app extension is excluded; other unknown fields must still fail.
  const {tapdanceKeycodes, ...v3} = raw;
  const errors = validateV3Definition(v3);
  // Inspect the app extension as well, even though it is not part of V3.
  if (containsQmkLighting(tapdanceKeycodes)) {
    errors.push('qmk_lighting is forbidden in tapdanceKeycodes');
  }
  if (!Object.hasOwn(lightingModules, entry.lighting)) {
    errors.push('Manifest lighting must declare a supported lighting kind');
  } else {
    const expected = lightingModules[entry.lighting];
    const actual = (Array.isArray(raw.keycodes) ? raw.keycodes : []).filter(
      (module) => Object.values(lightingModules).includes(module),
    );
    if (
      actual.length !== (expected ? 1 : 0) ||
      (expected && actual[0] !== expected)
    ) {
      errors.push(
        `Lighting keycode module must match manifest lighting ${entry.lighting}`,
      );
    }
  }
  for (const key of ['vendorId', 'productId'] as const) {
    if (entry[key] !== undefined && Number(raw[key]) !== Number(entry[key])) {
      errors.push(`${key} does not match the manifest`);
    }
  }
  return errors;
};
