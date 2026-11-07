import {typedModifierProblem} from './advanced-keys';
import {packBits, unpackBits} from './bit-pack';
import {
  ACTION_SWITCHES,
  dropdownChoices,
  HELD_VALUES,
  type CustomMenuControl,
} from './custom-menu';
import {isSameEraBoard} from './era-advanced-metadata';
import {isExactTermCommand} from './era-exact-ms';
import {isExactSecondCommand} from './era-exact-sec';
import {hasMousePrecision, mouseExact, readMouseExact} from './era-mousekey';
import {decodeRangeValue, encodeRangeValue} from './range-constraints';
import {ERA_WIRE} from './era-wire.generated';
import {getByteForCode} from './key';
import deprecatedKeycodes from './key-to-byte/deprecated-keycodes';
import {
  isTapDanceHoldOther,
  isTapDanceMode,
  isValidTermDraft,
  planTapDanceWrites,
  TAP_DANCE_ACTION_ROLES,
  type TapDanceActionRole,
  type TapDanceDraft,
  type TapDanceSlot,
  type TapDanceWrite,
} from './keycode-palette';
import {parseKeycodeInput} from './keycode-picker';
import {
  fitsMacroOptionFlags,
  fitsMacroOptionHold,
  fitsMacroOptionRepeatCount,
  isUntilStoppedWithoutStop,
  type MacroOptionsState,
  type MacroOptionValues,
} from './macro-api/era-macro-options';

/** One Tap Dance slot as a layout file keeps it: keycode names and the term in ms. */
type SavedTapDance = Record<TapDanceActionRole, string> & {term?: number; mode?: number; holdTerm?: number; holdOnOther?: number};

export type ViaSaveFile = {
  name: string;
  vendorProductId: number;
  layers: string[][];
  macros?: string[];
  encoders?: [string, string][][];
  /**
   * ERA Tap Dance settings, indexed by TD number. This and the fields below are
   * what official VIA's format cannot carry: official VIA ignores them and loads
   * the rest, and a file without one leaves those settings as they are.
   */
  tapDance?: (SavedTapDance | null)[];
  /**
   * The layout options as VIA's `id_layout_options` holds them: one integer, the
   * choices packed by the definition's `layouts.labels`, as Vial's `.vil` keeps it.
   */
  layoutOptions?: number;
  /**
   * Custom Menu settings by command name: the value bytes the control writes, a
   * keycode by name as on the layers.
   */
  customMenuValues?: Record<string, number[] | string>;
  /** Per-key RGB as `__perKeyRGB` holds it: [hue, saturation] by LED index. */
  perKeyRGB?: [number, number][];
  /**
   * ERA macro playback options by macro index: the FLAGS byte, the hold time in ms
   * and REPEAT_COUNT (1 once, 2..255 that many times, 0 until stopped).
   */
  macroOptions?: MacroOptionValues[];
};

export const isViaSaveFile = (obj: any): obj is ViaSaveFile =>
  obj && obj.name && obj.layers && obj.vendorProductId;

export {getLayoutImportKeycodes} from './connection-profile';

/**
 * A layout file's keycode name, read as KEYMAP's search box reads a typed code,
 * so what goes in as typed loads as written. A name it cannot read so loads as
 * VIA always loaded it, blank where VIA could not read it either, which keeps the
 * rest of the file loading, and is marked so the key can be named after the load.
 */
export const readLayoutCode = (
  code: string,
  keycodes: Record<string, number>,
): {value: number; asWritten: boolean} => {
  const name = `${(deprecatedKeycodes as Record<string, string>)[code] ?? code}`;
  const named = keycodes[name];
  if (named !== undefined) {
    return {value: named, asWritten: true};
  }
  const typed = typedModifierProblem(name, keycodes)
    ? null
    : parseKeycodeInput(name, keycodes);
  if (typed !== null) {
    return {value: typed, asWritten: true};
  }
  let value = keycodes.KC_NO ?? 0;
  try {
    value = getByteForCode(name, keycodes);
  } catch {
    // Stays blank.
  }
  return {value, asWritten: false};
};

/**
 * The name a save offers: the board and the day, so saving again does not take
 * the name of an older backup.
 */
export const layoutFileName = (boardName: string, date: Date) => {
  const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-');
  return `${boardName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}_${day}.layout.json`;
};

export type LayoutImportError =
  | 'different-keyboard'
  | 'key-count'
  | 'macro-count'
  | 'extra-layers'
  /** Something the file sets cannot be written yet: the keyboard is still loading. */
  | 'keyboard-not-ready'
  | 'tap-dance-mode-unsupported'
  | 'tap-dance-invalid';

/** Where a layout file names a keycode: a key by its switch, an encoder turn, or a Tap Dance action. */
export type LayoutPlace =
  | {layer: number; key: number}
  | {layer: number; encoder: number; clockwise: boolean}
  | {tapDance: number; role: TapDanceActionRole};

/** A keycode the file names that did not load as written, and what loaded instead. */
export type LayoutCodeChange = {place: LayoutPlace; code: string; value: number};

type LayoutImport = {
  keymap: number[][];
  macros?: string[];
  encoders?: Record<number, [number, number][]>;
  /** Tap Dance values that differ from the keyboard's, in slot order. */
  customValues: TapDanceWrite[];
  /** The layout options, when they differ from the keyboard's. */
  layoutOptions?: {value: number; options: number[]};
  /** Custom Menu settings that differ from the keyboard's, in the order they go out. */
  menuValues: CustomMenuWrite[];
  /** Per-key colours that differ from the keyboard's, by LED index. */
  perKeyRGB: PerKeyRGBWrite[];
  /** Macro options that fit the keyboard, written after the macros' contents. */
  macroOptions?: {channel: number; writes: MacroOptionsWrite[]};
  /** What loads other than the file has it, in the order the file names it. */
  changed: LayoutCodeChange[];
};

/** The keyboard's layout options, by the definition's labels. */
export type LayoutOptionsTarget = {
  /** How many choices each label offers. */
  counts: readonly number[];
  /** The choices this connection has read, undefined until it has. */
  current: readonly number[] | undefined;
};

/** The keyboard's Custom Menu, as the menu reads it. */
export type CustomMenuTarget = {
  controls: readonly CustomMenuControl[];
  /** What the keyboard reported for each command, undefined while nothing was read. */
  values: Readonly<Record<string, unknown>> | undefined;
  /** Whether its values are current and may be written, as for the menu. */
  available: boolean;
  /** How many LEDs the definition maps to keys; absent or 0 without per-key RGB. */
  ledCount?: number;
  /** Commands whose last SET the keyboard has not kept, as the menu's edits track them. */
  unsaved?: Readonly<Record<string, boolean>>;
};

/** One Custom Value SET: the command's channel and value id, then the value. */
export type CustomMenuWrite = {name: string; address: number[]; bytes: number[]};

/** Where the menu read keeps per-key RGB among the Custom Menu values. */
export const PER_KEY_RGB = '__perKeyRGB';

/** One per-key RGB SET: the LED index, then [hue, saturation]. */
export type PerKeyRGBWrite = {led: number; bytes: [number, number]};

/**
 * A keyboard asked for macro options. Available: CAPABILITIES reported support
 * and CONFIG is current, with its channel, supported flags, the options it holds,
 * and whether an options SAVE is still owed. Unavailable: their read failed, is
 * not done, or CONFIG is being read again, so they cannot be compared yet.
 */
export type MacroOptionsTarget =
  | {
      available: true;
      channel: number;
      supported: number;
      options: readonly MacroOptionValues[];
      unsaved: boolean;
    }
  | {available: false};

/** One macro's option values a load writes; a value that does not fit is absent. */
export type MacroOptionsWrite = {index: number} & Partial<MacroOptionValues>;

/** The keyboard's Tap Dance, as the KEYMAP editor reads it. */
export type TapDanceTarget = {
  slots: readonly TapDanceSlot[];
  read: (slot: TapDanceSlot) => TapDanceDraft | null;
  termBounds: (slot: TapDanceSlot) => {minMs: number; maxMs: number};
  /** Whether its values are current and may be written, as for the editor. */
  available: boolean;
};

type Target = {
  vendorProductId: number;
  /** What each of the keyboard's layers holds now, one entry per layer. */
  layers: readonly (readonly number[])[];
  /** Null when the keyboard has no macros, undefined while that is not known. */
  macroCount: number | null | undefined;
  /** Absent on a keyboard without Tap Dance. */
  tapDance?: TapDanceTarget;
  /** Absent on a definition without layout options. */
  layoutOptions?: LayoutOptionsTarget;
  /** Absent where the Custom Menu is never read, as on firmware State Sync could not verify. */
  customMenu?: CustomMenuTarget;
  /** Absent where macro options are not asked for or not supported. */
  macroOptions?: MacroOptionsTarget;
};

// KC_NO and KC_TRNS: a layer holding only these does nothing of its own.
const EMPTY_CODES = new Set([0x0000, 0x0001]);
const holdsKeys = (codes: readonly number[]) =>
  codes.some((code) => !EMPTY_CODES.has(code));

/**
 * The keyboard's Tap Dance for a layout file. Nothing is left out quietly: until
 * every slot has been read the save is refused, because a file missing its Tap
 * Dance would restore a keyboard without it.
 */
export const saveTapDance = (
  {slots, read, available}: Pick<TapDanceTarget, 'slots' | 'read' | 'available'>,
  toCode: (byte: number) => string,
): {tapDance?: (SavedTapDance | null)[]} | {error: 'keyboard-not-ready'} => {
  if (slots.length === 0) {
    return {};
  }
  if (!available) {
    return {error: 'keyboard-not-ready'};
  }
  const saved: (SavedTapDance | null)[] = [];
  for (const slot of slots) {
    const draft = read(slot);
    if (!draft) {
      return {error: 'keyboard-not-ready'};
    }
    const actions = Object.fromEntries(
      TAP_DANCE_ACTION_ROLES.map((role) => [role, toCode(draft.actions[role])]),
    ) as Record<TapDanceActionRole, string>;
    saved[slot.index] = draft.term
      ? {...actions, term: Number(draft.term)}
      : actions;
    if (draft.mode !== undefined) saved[slot.index]!.mode = draft.mode;
    if (draft.holdTerm !== undefined) {
      saved[slot.index]!.holdTerm = Number(draft.holdTerm);
      saved[slot.index]!.holdOnOther = draft.holdOnOther ?? ERA_WIRE.TAPDANCE_HOLD_OTHER.DISABLED;
    }
  }
  return {tapDance: Array.from(saved, (entry) => entry ?? null)};
};

// A slot the file does not describe, or describes with a keycode this keyboard
// cannot name, is left alone; a term outside the keyboard's range keeps its term.
const planSavedTapDance = (
  saved: unknown,
  {slots, read, termBounds}: TapDanceTarget,
  toByte: (code: string) => number,
  note: (code: string, value: number, place: LayoutPlace) => void,
): TapDanceWrite[] => {
  if (!Array.isArray(saved)) {
    return [];
  }
  return slots.flatMap((slot) => {
    const entry = saved[slot.index] as Partial<SavedTapDance> | null | undefined;
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const actions = {} as TapDanceDraft['actions'];
    const codes = {} as Record<TapDanceActionRole, string>;
    for (const role of TAP_DANCE_ACTION_ROLES) {
      const code = entry[role];
      if (typeof code !== 'string') {
        return [];
      }
      try {
        actions[role] = toByte(code);
      } catch {
        return [];
      }
      codes[role] = code;
    }
    const bounds = termBounds(slot);
    const current = read(slot);
    const term =
      Number.isInteger(entry.term) &&
      isValidTermDraft(String(entry.term), bounds.minMs, bounds.maxMs)
        ? String(entry.term)
        : current?.term ?? '';
    // Values the keyboard has not reported are written in full.
    const known = current ?? {
      actions: {tap: -1, hold: -1, dtap: -1, thold: -1},
      term: '',
    };
    const mode = current?.mode !== undefined
      ? (entry.mode ?? ERA_WIRE.TAPDANCE_MODES.LEGACY) : undefined;
    const writes = planTapDanceWrites(slot, {actions, term, mode, ...(current?.holdTerm !== undefined ? {
      holdTerm: String(entry.holdTerm ?? 0),
      holdOnOther: entry.holdOnOther ?? ERA_WIRE.TAPDANCE_HOLD_OTHER.DISABLED,
    } : {})}, known, bounds);
    if (writes) {
      for (const role of TAP_DANCE_ACTION_ROLES) {
        note(codes[role], actions[role], {tapDance: slot.index, role});
      }
    }
    return writes ?? [];
  });
};

/** How many choices each layout label offers, as VIA packs them. */
export const layoutOptionCounts = (labels: readonly (string | string[])[]) =>
  labels.map((label) => (Array.isArray(label) ? label.slice(1).length : 2));

const packLayoutOptions = (options: readonly number[], counts: readonly number[]) =>
  packBits(options.map((option, idx) => [option, counts[idx]]));

/** The layout options for a layout file, once this connection has read them. */
export const saveLayoutOptions = (
  target: LayoutOptionsTarget | undefined,
): {layoutOptions?: number} =>
  target?.current
    ? {layoutOptions: packLayoutOptions(target.current, target.counts)}
    : {};

// A value that does not fit the labels, as from a definition with other layout
// options, is left alone rather than read into choices the keyboard lacks.
const planLayoutOptions = (
  saved: unknown,
  {counts, current}: LayoutOptionsTarget,
): LayoutImport['layoutOptions'] => {
  if (
    typeof saved !== 'number' ||
    !Number.isInteger(saved) ||
    saved < 0 ||
    saved > 0xffffffff
  ) {
    return undefined;
  }
  const options = unpackBits(saved, [...counts]);
  if (
    options.some((option, idx) => option >= counts[idx]) ||
    packLayoutOptions(options, counts) !== saved ||
    (current && options.every((option, idx) => option === current[idx]))
  ) {
    return undefined;
  }
  return {value: saved, options};
};

// A switch whose write is an action rather than a setting (the bootloader, EEPROM
// clean, an Apply), and a value the firmware keeps aside until such an Apply puts
// it into effect: the split link speed, and the USB boot polling mode, whose Apply
// restarts the keyboard. A restore writes stored values only, so it sends neither.
// EEPROM SYNC is a stored switch, but turning it on starts the halves' storage
// sync, which replaces one half's settings with the other's for good; only the
// user turns it on.
const NOT_SETTINGS = new Set<string>([
  'id_qmk_eeprom_sync_requested',
  ...ACTION_SWITCHES.keys(),
  ...HELD_VALUES.flatMap((commands) => Object.values(commands)),
  'id_qmk_system_reset_0',
  'id_qmk_system_reset_1',
  'id_qmk_system_reset_done',
  'id_qmk_usb_bootmode',
  'id_qmk_usb_bootmode_apply',
]);

// Two bytes, high first, as VIA sends a 16-bit value.
const WORD = 0xffff;
const isByte = (value: unknown) =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xff;
const boxed = (option: unknown) => (Array.isArray(option) ? option : [option]);
const hasEntry = (record: object, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key);
const toggleOptions = (options: unknown) =>
  Array.isArray(options) ? options : [0, 1];
// The exact presentation of a value another control also sets in steps.
const isExactValue = (name: string) =>
  !!mouseExact(name) || isExactTermCommand(name) || isExactSecondCommand(name);

const rangeBounds = ({content: [name], options}: CustomMenuControl) => {
  const mouse = mouseExact(name);
  if (mouse) {
    return {min: mouse.min, max: mouse.max};
  }
  return Array.isArray(options) &&
    typeof options[0] === 'number' &&
    typeof options[1] === 'number'
    ? {min: options[0], max: options[1]}
    : null;
};

// How many value bytes the control writes, as the Custom Menu writes it; null for
// a control that writes no setting (a label, a button, the per-key palette).
const valueWidth = (control: CustomMenuControl): number | null => {
  const [name] = control.content;
  switch (control.type) {
    case 'toggle':
      return boxed(toggleOptions(control.options)[1]).length;
    case 'dropdown':
      return 1;
    case 'keycode':
    case 'color':
      return 2;
    case 'range': {
      const bounds = rangeBounds(control);
      return bounds && (isExactValue(name) || bounds.max > 255 ? 2 : 1);
    }
    default:
      return null;
  }
};

type MenuSetting = {control: CustomMenuControl; width: number};

// Each setting once, in menu order, but an exact value after the others: written
// before its stepped twin, the step would replace it.
const menuSettings = (controls: readonly CustomMenuControl[]) => {
  const seen = new Set<string>();
  const settings = controls.flatMap((control): MenuSetting[] => {
    const [name] = control.content;
    const width = valueWidth(control);
    if (width === null || NOT_SETTINGS.has(name) || seen.has(name)) {
      return [];
    }
    seen.add(name);
    return [{control, width}];
  });
  return [
    ...settings.filter(({control}) => !isExactValue(control.content[0])),
    ...settings.filter(({control}) => isExactValue(control.content[0])),
  ];
};

// What the keyboard reported, cut to the bytes the control writes; null where it
// reported nothing usable, such as an exact MOUSE value firmware without
// precision support only stands in for.
const reportedBytes = (
  {content: [name]}: CustomMenuControl,
  width: number,
  values: CustomMenuTarget['values'],
): number[] | null => {
  const value = values?.[name];
  if (
    !Array.isArray(value) ||
    value.length < width ||
    !value.slice(0, width).every(isByte)
  ) {
    return null;
  }
  if (mouseExact(name)) {
    try {
      if (!hasMousePrecision(values)) return null;
      readMouseExact(name, value);
    } catch {
      return null;
    }
  }
  return value.slice(0, width);
};

const isColor = (color: unknown): color is [number, number] =>
  Array.isArray(color) && color.length === 2 && color.every(isByte);

// The colours the keyboard reported, one for each LED the definition maps.
const reportedColors = ({values, ledCount = 0}: CustomMenuTarget) => {
  const colors = values?.[PER_KEY_RGB];
  return ledCount > 0 &&
    Array.isArray(colors) &&
    colors.length === ledCount &&
    colors.every(isColor)
    ? colors.map(([hue, sat]): [number, number] => [hue, sat])
    : undefined;
};

/**
 * The keyboard's Custom Menu settings and per-key RGB for a layout file. Until the
 * menu's values are current the save is refused, as for Tap Dance; a value the
 * keyboard did not report is left out, and a keyboard whose menu was never read
 * adds nothing.
 */
export const saveCustomMenuValues = (
  target: CustomMenuTarget | undefined,
  toCode: (byte: number) => string,
):
  | Pick<ViaSaveFile, 'customMenuValues' | 'perKeyRGB'>
  | {error: 'keyboard-not-ready'} => {
  const settings = target ? menuSettings(target.controls) : [];
  if (!target || (settings.length === 0 && !target.ledCount)) {
    return {};
  }
  if (!target.available) {
    return {error: 'keyboard-not-ready'};
  }
  const saved: Record<string, number[] | string> = {};
  for (const {control, width} of settings) {
    const bytes = reportedBytes(control, width, target.values);
    if (bytes) {
      saved[control.content[0]] =
        control.type === 'keycode' ? toCode(decodeRangeValue(bytes, WORD)) : bytes;
    }
  }
  const colors = reportedColors(target);
  return {
    ...(Object.keys(saved).length > 0 && {customMenuValues: saved}),
    ...(colors && {perKeyRGB: colors}),
  };
};

const savedBytes = (
  control: CustomMenuControl,
  width: number,
  entry: unknown,
  toByte: (code: string) => number,
  asWritten: (code: string) => boolean,
): number[] | null => {
  if (control.type === 'keycode') {
    if (typeof entry !== 'string' || !asWritten(entry)) {
      return null;
    }
    try {
      const code = toByte(entry);
      return Number.isInteger(code) && code >= 0 && code <= WORD
        ? encodeRangeValue(code, WORD)
        : null;
    } catch {
      return null;
    }
  }
  if (!Array.isArray(entry) || entry.length !== width || !entry.every(isByte)) {
    return null;
  }
  if (control.type === 'toggle') {
    return toggleOptions(control.options).some((option) => {
      const bytes = boxed(option);
      return bytes.every((byte, idx) => byte === entry[idx]);
    })
      ? entry
      : null;
  }
  if (control.type === 'range') {
    const bounds = rangeBounds(control)!;
    const value = decodeRangeValue(entry, width === 2 ? WORD : 0xff);
    return value >= bounds.min && value <= bounds.max ? entry : null;
  }
  if (control.type === 'dropdown') {
    return Array.isArray(control.options) &&
      dropdownChoices(control.options).some(({value}) => value === entry[0])
      ? entry
      : null;
  }
  return entry;
};

// Only what differs goes out, or what the keyboard has not kept yet, and only to a
// command the keyboard reported: a command it did not answer is never sent. A
// value the file cannot describe for this control, such as a keycode that does
// not load as written or a choice the dropdown lacks, is left alone.
const planCustomMenuValues = (
  saved: unknown,
  target: CustomMenuTarget,
  toByte: (code: string) => number,
  asWritten: (code: string) => boolean,
): CustomMenuWrite[] => {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
    return [];
  }
  return menuSettings(target.controls).flatMap(({control, width}) => {
    const [name, ...address] = control.content;
    if (!hasEntry(saved, name)) {
      return [];
    }
    const current = reportedBytes(control, width, target.values);
    const bytes =
      current &&
      savedBytes(control, width, (saved as Record<string, unknown>)[name], toByte, asWritten);
    if (
      !current ||
      !bytes ||
      (!target.unsaved?.[name] && bytes.every((byte, idx) => byte === current[idx]))
    ) {
      return [];
    }
    return [{name, address, bytes: [...bytes]}];
  });
};

// Colours saved for another LED mapping are left alone, all of them.
const planPerKeyRGB = (
  saved: unknown,
  target: CustomMenuTarget,
): PerKeyRGBWrite[] => {
  const current = reportedColors(target);
  if (
    !current ||
    !Array.isArray(saved) ||
    saved.length !== current.length ||
    !saved.every(isColor)
  ) {
    return [];
  }
  const resend = !!target.unsaved?.[PER_KEY_RGB];
  return current.flatMap(([hue, sat], led) => {
    const [savedHue, savedSat] = saved[led];
    return resend || savedHue !== hue || savedSat !== sat
      ? [{led, bytes: [savedHue, savedSat] as [number, number]}]
      : [];
  });
};

/**
 * The keyboard's macro options for a layout file: none where they are not asked
 * for (null) or unsupported, and the save is refused while they are unread.
 */
export const saveMacroOptions = (
  state: MacroOptionsState | null | undefined,
): Pick<ViaSaveFile, 'macroOptions'> | {error: 'keyboard-not-ready'} =>
  state === null || state?.kind === 'unsupported'
    ? {}
    : state?.kind === 'read'
      ? {
          macroOptions: state.options.map(({flags, holdMs, repeatCount}) => ({
            flags,
            holdMs,
            repeatCount,
          })),
        }
      : {error: 'keyboard-not-ready'};

// A value that fits goes out where it differs from what the keyboard holds, which
// the macro writes before it leave as they were (VIA's macro RESET keeps the
// options). While a SAVE is owed, everything that fits goes out again, as for
// per-key RGB.
const planMacroOptions = (
  saved: unknown,
  {channel, supported, options, unsaved}: Extract<MacroOptionsTarget, {available: true}>,
  macroCount: number | null | undefined,
): LayoutImport['macroOptions'] => {
  if (!Array.isArray(saved) || typeof macroCount !== 'number') {
    return undefined;
  }
  const writes = saved.slice(0, macroCount).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const {flags, holdMs, repeatCount} = entry as Record<string, unknown>;
    const current = options[index];
    const write: MacroOptionsWrite = {index};
    const flagsFit = fitsMacroOptionFlags(supported, flags);
    const countFits = fitsMacroOptionRepeatCount(repeatCount);
    // What the keyboard would hold after the load; until stopped with no stop is
    // never written, so neither of the values that make it goes out.
    const playable = !isUntilStoppedWithoutStop({
      flags: flagsFit ? flags : (current?.flags ?? 0),
      repeatCount: countFits ? repeatCount : (current?.repeatCount ?? 1),
    });
    if (playable && flagsFit && (unsaved || flags !== current?.flags)) {
      write.flags = flags;
    }
    if (playable && countFits && (unsaved || repeatCount !== current?.repeatCount)) {
      write.repeatCount = repeatCount;
    }
    // The hold time serves Stop on hold alone.
    if (
      (supported & ERA_WIRE.MACRO_OPTIONS_FLAGS.HOLD) !== 0 &&
      fitsMacroOptionHold(holdMs) &&
      (unsaved || holdMs !== current?.holdMs)
    ) {
      write.holdMs = holdMs;
    }
    return Object.keys(write).length > 1 ? [write] : [];
  });
  return writes.length > 0 ? {channel, writes} : undefined;
};

/**
 * Checks a saved layout against the keyboard it is loaded onto and fits it there.
 *
 * A file saved under another identity of the same ERA board is accepted: that is
 * what every save from older firmware looks like after the move to maker
 * identities. The same move took most EERRAA boards from four layers to six, so
 * the layer count may differ too. A layer the file lacks keeps what the keyboard
 * has, and a layer the keyboard lacks is dropped only when it holds nothing.
 *
 * Keys are stored per switch position, so they load whatever layout option is
 * showing: a key that option hides is still written, and shows once the option
 * that has it is chosen. The layout options and Custom Menu settings a file
 * carries load where they differ from the keyboard's and fit its definition.
 *
 * A keycode that does not load as written (`asWritten`) does not stop the rest:
 * it loads as `toByte` reads it, and the plan names it with where it goes, so
 * the key can be set again.
 */
export const planLayoutImport = (
  file: ViaSaveFile,
  target: Target,
  toByte: (code: string) => number,
  asWritten: (code: string) => boolean = () => true,
): {error: LayoutImportError} | LayoutImport => {
  if (
    file.vendorProductId !== target.vendorProductId &&
    !isSameEraBoard(file.vendorProductId, target.vendorProductId)
  ) {
    return {error: 'different-keyboard'};
  }
  const layerCount = target.layers.length;
  if (
    file.layers.some(
      (layer, idx) =>
        idx < layerCount && layer.length !== target.layers[idx].length,
    )
  ) {
    return {error: 'key-count'};
  }
  if (file.macros && target.macroCount === undefined) {
    return {error: 'keyboard-not-ready'};
  }
  if (
    typeof target.macroCount === 'number' &&
    file.macros &&
    file.macros.length !== target.macroCount
  ) {
    return {error: 'macro-count'};
  }

  const keymap = file.layers.map((layer) => layer.map(toByte));
  const encoders = file.encoders?.map((encoder) =>
    encoder.map(([ccw, cw]) => [toByte(ccw), toByte(cw)] as [number, number]),
  );
  if (
    keymap.slice(layerCount).some(holdsKeys) ||
    (encoders ?? []).some((encoder) =>
      encoder.slice(layerCount).some(holdsKeys),
    )
  ) {
    return {error: 'extra-layers'};
  }

  if (Array.isArray(file.tapDance) && file.tapDance.some((entry) => entry && (
    (entry.holdTerm !== undefined && (!Number.isInteger(entry.holdTerm) || entry.holdTerm < 0 || entry.holdTerm > 65535)) ||
    (entry.holdOnOther !== undefined && !isTapDanceHoldOther(entry.holdOnOther))
  ))) return {error: 'tap-dance-invalid'};

  if (Array.isArray(file.tapDance) && file.tapDance.some((entry, index) => {
    if (!entry?.holdTerm &&
        (entry?.holdOnOther ?? ERA_WIRE.TAPDANCE_HOLD_OTHER.DISABLED) === ERA_WIRE.TAPDANCE_HOLD_OTHER.DISABLED) {
      return false;
    }
    const slot = target.tapDance?.slots.find((slot) => slot.index === index);
    return !slot || target.tapDance?.read(slot)?.holdTerm === undefined;
  })) return {error: 'tap-dance-mode-unsupported'};

  if (Array.isArray(file.tapDance) && file.tapDance.some((entry, index) => {
    if ((entry?.mode ?? ERA_WIRE.TAPDANCE_MODES.LEGACY) === ERA_WIRE.TAPDANCE_MODES.LEGACY) return false;
    const slot = target.tapDance?.slots.find((slot) => slot.index === index);
    return !slot || target.tapDance?.read(slot)?.mode === undefined;
  })) return {error: 'tap-dance-mode-unsupported'};

  if (Array.isArray(file.tapDance) && file.tapDance.some((entry) => {
    if (!entry || entry.mode === undefined) return false;
    if (!isTapDanceMode(entry.mode)) return true;
    try {
      if (TAP_DANCE_ACTION_ROLES.some((role) => {
        if (typeof entry[role] !== 'string') return true;
        const value = toByte(entry[role]);
        return !Number.isInteger(value) || value < 0 || value > 0xffff;
      })) return true;
      return entry.mode === ERA_WIRE.TAPDANCE_MODES.ON_PRESS && toByte(entry.hold) !== 1;
    } catch {
      return true;
    }
  })) return {error: 'tap-dance-invalid'};

  const changed: LayoutCodeChange[] = [];
  // A cell holds whatever JSON the file has. It is read as text, as official VIA
  // reads it, and named by that text, so whatever it holds can be shown.
  const note = (code: string, value: number, place: LayoutPlace) => {
    if (!asWritten(code)) {
      changed.push({place, code: `${code}`, value});
    }
  };
  keymap.slice(0, layerCount).forEach((values, layer) =>
    values.forEach((value, key) =>
      note(file.layers[layer][key], value, {layer, key}),
    ),
  );
  encoders?.forEach((encoder, id) =>
    encoder.slice(0, layerCount).forEach(([ccw, cw], layer) => {
      const [ccwCode, cwCode] = file.encoders![id][layer];
      note(ccwCode, ccw, {layer, encoder: id, clockwise: false});
      note(cwCode, cw, {layer, encoder: id, clockwise: true});
    }),
  );
  const customValues = target.tapDance
    ? planSavedTapDance(file.tapDance, target.tapDance, toByte, note)
    : [];
  if (customValues.length > 0 && !target.tapDance?.available) {
    return {error: 'keyboard-not-ready'};
  }
  // Values not yet current cannot be compared, and a file's settings are not
  // dropped for that: the load waits, as for Tap Dance.
  const menu = target.customMenu;
  const savedMenu = file.customMenuValues;
  if (
    menu &&
    !menu.available &&
    ((savedMenu &&
      typeof savedMenu === 'object' &&
      menuSettings(menu.controls).some(({control}) =>
        hasEntry(savedMenu, control.content[0]),
      )) ||
      (Array.isArray(file.perKeyRGB) && !!menu.ledCount))
  ) {
    return {error: 'keyboard-not-ready'};
  }
  // Nor are a file's macro options dropped because the keyboard's could not be
  // read or are being read again.
  if (
    target.macroOptions?.available === false &&
    Array.isArray(file.macroOptions) &&
    file.macroOptions.length > 0
  ) {
    return {error: 'keyboard-not-ready'};
  }

  return {
    keymap: target.layers.map((layer, idx) => keymap[idx] ?? [...layer]),
    macros: typeof target.macroCount === 'number' ? file.macros : undefined,
    encoders:
      encoders &&
      Object.fromEntries(
        encoders.map((encoder, id) => [id, encoder.slice(0, layerCount)]),
      ),
    customValues,
    layoutOptions:
      target.layoutOptions &&
      planLayoutOptions(file.layoutOptions, target.layoutOptions),
    menuValues: menu
      ? planCustomMenuValues(savedMenu, menu, toByte, asWritten)
      : [],
    perKeyRGB: menu ? planPerKeyRGB(file.perKeyRGB, menu) : [],
    macroOptions: target.macroOptions?.available
      ? planMacroOptions(file.macroOptions, target.macroOptions, target.macroCount)
      : undefined,
    changed,
  };
};
