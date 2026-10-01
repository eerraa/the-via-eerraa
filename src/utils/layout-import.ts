import {isSameEraBoard} from './era-advanced-metadata';
import {
  isValidTermDraft,
  planTapDanceWrites,
  TAP_DANCE_ACTION_ROLES,
  type TapDanceActionRole,
  type TapDanceDraft,
  type TapDanceSlot,
  type TapDanceWrite,
} from './keycode-palette';

/** One Tap Dance slot as a layout file keeps it: keycode names and the term in ms. */
export type SavedTapDance = Record<TapDanceActionRole, string> & {term?: number};

export type ViaSaveFile = {
  name: string;
  vendorProductId: number;
  layers: string[][];
  macros?: string[];
  encoders?: [string, string][][];
  /**
   * ERA Tap Dance settings, indexed by TD number. Nothing else official VIA's format
   * cannot carry is added: official VIA ignores this field and loads the rest, and
   * a file without it leaves the keyboard's Tap Dance as it is.
   */
  tapDance?: (SavedTapDance | null)[];
};

export const isViaSaveFile = (obj: any): obj is ViaSaveFile =>
  obj && obj.name && obj.layers && obj.vendorProductId;

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
  | 'keyboard-not-ready';

export type LayoutImport = {
  keymap: number[][];
  macros?: string[];
  encoders?: Record<number, [number, number][]>;
  /** Tap Dance values that differ from the keyboard's, in slot order. */
  customValues: TapDanceWrite[];
};

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
  }
  return {tapDance: Array.from(saved, (entry) => entry ?? null)};
};

// A slot the file does not describe, or describes with a keycode this keyboard
// cannot name, is left alone; a term outside the keyboard's range keeps its term.
const planSavedTapDance = (
  saved: unknown,
  {slots, read, termBounds}: TapDanceTarget,
  toByte: (code: string) => number,
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
    return planTapDanceWrites(slot, {actions, term}, known, bounds) ?? [];
  });
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
 * that has it is chosen.
 */
export const planLayoutImport = (
  file: ViaSaveFile,
  target: Target,
  toByte: (code: string) => number,
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

  const customValues = target.tapDance
    ? planSavedTapDance(file.tapDance, target.tapDance, toByte)
    : [];
  if (customValues.length > 0 && !target.tapDance?.available) {
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
  };
};
