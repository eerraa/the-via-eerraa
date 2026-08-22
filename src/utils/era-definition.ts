import {
  isKeyboardDefinitionV3,
  isVIADefinitionV3,
  keyboardDefinitionV3ToVIADefinitionV3,
  type CustomKeycode,
  type KeyboardDefinitionV3,
  type VIADefinitionV3,
} from '@the-via/reader';

export type EraVIADefinitionV3 = VIADefinitionV3 & {
  tapdanceKeycodes?: CustomKeycode[];
};

export const isTapDanceKeycodeName = (name: string) => /^TD[0-7]$/.test(name);

export const isEraVIADefinitionV3 = (
  value: unknown,
): value is EraVIADefinitionV3 => {
  if (isVIADefinitionV3(value)) {
    return true;
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  const {tapdanceKeycodes: _omit, ...rest} = value as Record<string, unknown>;
  return isVIADefinitionV3(rest);
};

export const getTapDanceKeycodes = (
  definition: {tapdanceKeycodes?: CustomKeycode[]} | null | undefined,
) => definition?.tapdanceKeycodes ?? [];

export const hasCustomKeycodeTab = (
  definition: {customKeycodes?: CustomKeycode[]} | null | undefined,
): definition is {customKeycodes: CustomKeycode[]} =>
  Array.isArray(definition?.customKeycodes) &&
  definition.customKeycodes.length > 0;

export const customKeycodeWireIndex = (
  customIndex: number,
  tapdanceCount: number,
) => tapdanceCount + customIndex;

export const splitTapDanceKeycodesFromRaw = (raw: Record<string, unknown>) => {
  const tapdanceKeycodes = raw.tapdanceKeycodes;
  if (tapdanceKeycodes === undefined) {
    return {
      definitionRaw: raw,
      tapdanceKeycodes: undefined as CustomKeycode[] | undefined,
    };
  }
  const {tapdanceKeycodes: _omit, ...definitionRaw} = raw;
  if (!Array.isArray(tapdanceKeycodes)) {
    throw new Error('tapdanceKeycodes must be an array.');
  }
  const parsed = tapdanceKeycodes.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`tapdanceKeycodes[${index}] must be an object.`);
    }
    const record = entry as {
      name?: unknown;
      title?: unknown;
      shortName?: unknown;
    };
    if (typeof record.name !== 'string' || record.name.length === 0) {
      throw new Error(`tapdanceKeycodes[${index}].name is required.`);
    }
    if (typeof record.title !== 'string' || record.title.length === 0) {
      throw new Error(`tapdanceKeycodes[${index}].title is required.`);
    }
    const keycode: CustomKeycode = {name: record.name, title: record.title};
    if (typeof record.shortName === 'string') {
      keycode.shortName = record.shortName;
    }
    return keycode;
  });
  return {definitionRaw, tapdanceKeycodes: parsed};
};

export const attachTapDanceKeycodes = (
  definition: VIADefinitionV3,
  tapdanceKeycodes: CustomKeycode[] | undefined,
): EraVIADefinitionV3 =>
  tapdanceKeycodes?.length ? {...definition, tapdanceKeycodes} : definition;

export const parseEraV3Definition = (raw: unknown): EraVIADefinitionV3 => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Definition must be an object.');
  }
  const {definitionRaw, tapdanceKeycodes} = splitTapDanceKeycodesFromRaw(
    raw as Record<string, unknown>,
  );
  if (isVIADefinitionV3(definitionRaw)) {
    return attachTapDanceKeycodes(definitionRaw, tapdanceKeycodes);
  }
  if (!isKeyboardDefinitionV3(definitionRaw)) {
    throw new Error('Invalid VIA V3 keyboard definition.');
  }
  return attachTapDanceKeycodes(
    keyboardDefinitionV3ToVIADefinitionV3(
      definitionRaw as KeyboardDefinitionV3,
    ),
    tapdanceKeycodes,
  );
};
