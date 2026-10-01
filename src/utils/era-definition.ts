import {
  isKeyboardDefinitionV3,
  isVIADefinitionV3,
  keyboardDefinitionV3ToVIADefinitionV3,
  type CustomKeycode,
  type KeyboardDefinitionV3,
  type VIADefinitionV3,
} from '@the-via/reader';

/**
 * One Tap Dance setting, shaped like a V3 custom-menu control so every existing
 * Custom Value path (read, write, deferred Apply, State Sync reread, range limits)
 * treats it exactly as it treated the old TAPDANCE menu row.
 */
export type EraTapDanceControl = {
  label: string;
  type: 'keycode' | 'range' | 'dropdown';
  content: [string, number, number];
  options?: [number, number] | [string, number][];
};

/**
 * The custom JSON keeps each TD's settings next to its keycode instead of in a
 * TAPDANCE menu: the custom app edits Tap Dance from KEYMAP, not from a menu page.
 * Firmware-local stock JSON keeps its TAPDANCE menu for official VIA.
 */
export type EraTapDanceKeycode = CustomKeycode & {
  controls?: EraTapDanceControl[];
};

export type EraVIADefinitionV3 = VIADefinitionV3 & {
  tapdanceKeycodes?: EraTapDanceKeycode[];
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
  definition: {tapdanceKeycodes?: EraTapDanceKeycode[]} | null | undefined,
): EraTapDanceKeycode[] => definition?.tapdanceKeycodes ?? [];

export const TAP_DANCE_MENU_LABEL = 'TAPDANCE';

/**
 * The Tap Dance settings as a V3 menu (one submenu per TD), built from the
 * keycode entries. Custom Value command collection reads it so the values are
 * fetched, written and resynchronised like any other menu row.
 */
export const getTapDanceControlMenu = (
  definition: {tapdanceKeycodes?: EraTapDanceKeycode[]} | null | undefined,
) => {
  const slots = getTapDanceKeycodes(definition).filter(
    (keycode) => keycode.controls && keycode.controls.length > 0,
  );
  if (slots.length === 0) {
    return null;
  }
  return {
    label: TAP_DANCE_MENU_LABEL,
    content: slots.map((keycode) => ({
      label: keycode.name,
      content: keycode.controls as EraTapDanceControl[],
    })),
  };
};

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const parseTapDanceControls = (
  controls: unknown,
  index: number,
): EraTapDanceControl[] => {
  if (!Array.isArray(controls)) {
    throw new Error(`tapdanceKeycodes[${index}].controls must be an array.`);
  }
  return controls.map((control, controlIndex) => {
    const where = `tapdanceKeycodes[${index}].controls[${controlIndex}]`;
    if (!control || typeof control !== 'object') {
      throw new Error(`${where} must be an object.`);
    }
    const {label, type, content, options} = control as Record<string, unknown>;
    if (typeof label !== 'string' || label.length === 0) {
      throw new Error(`${where}.label is required.`);
    }
    if (type !== 'keycode' && type !== 'range' && type !== 'dropdown') {
      throw new Error(`${where}.type must be keycode, range or dropdown.`);
    }
    if (
      !Array.isArray(content) ||
      content.length !== 3 ||
      typeof content[0] !== 'string' ||
      !isNumber(content[1]) ||
      !isNumber(content[2])
    ) {
      throw new Error(`${where}.content must be [command, channel, id].`);
    }
    if (type === 'dropdown' && !/^id_qmk_tapdance_[1-8]_(mode|hold_other)$/.test(content[0])) {
      throw new Error(`${where}: only input mode and hold-on-other use dropdowns.`);
    }
    const parsed: EraTapDanceControl = {
      label,
      type,
      content: [content[0], content[1], content[2]],
    };
    if (type === 'dropdown') {
      if (!Array.isArray(options) || options.length !== (content[0].endsWith('_mode') ? 3 : 2) || options.some((option, i) =>
        !Array.isArray(option) || option.length !== 2 || typeof option[0] !== 'string' || option[1] !== i,
      )) throw new Error(`${where}.options must name each supported value in order.`);
      parsed.options = options as [string, number][];
    }
    if (type === 'range') {
      if (
        !Array.isArray(options) ||
        options.length !== 2 ||
        !isNumber(options[0]) ||
        !isNumber(options[1])
      ) {
        throw new Error(`${where}.options must be [min, max].`);
      }
      parsed.options = [options[0], options[1]];
    }
    return parsed;
  });
};

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
      tapdanceKeycodes: undefined as EraTapDanceKeycode[] | undefined,
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
      controls?: unknown;
    };
    if (typeof record.name !== 'string' || record.name.length === 0) {
      throw new Error(`tapdanceKeycodes[${index}].name is required.`);
    }
    if (typeof record.title !== 'string' || record.title.length === 0) {
      throw new Error(`tapdanceKeycodes[${index}].title is required.`);
    }
    const keycode: EraTapDanceKeycode = {
      name: record.name,
      title: record.title,
    };
    if (typeof record.shortName === 'string') {
      keycode.shortName = record.shortName;
    }
    if (record.controls !== undefined) {
      keycode.controls = parseTapDanceControls(record.controls, index);
    }
    return keycode;
  });
  return {definitionRaw, tapdanceKeycodes: parsed};
};

export const attachTapDanceKeycodes = (
  definition: VIADefinitionV3,
  tapdanceKeycodes: EraTapDanceKeycode[] | undefined,
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
