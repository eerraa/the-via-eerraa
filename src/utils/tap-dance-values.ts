import {shiftTo16Bit} from './keyboard-api';
import {getExactMsFamily} from './era-advanced-metadata';
import {exactTermBoundsFromOptions} from './era-exact-ms';
import {
  TAP_DANCE_ACTION_ROLES,
  type TapDanceDraft,
  type TapDanceSlot,
} from './keycode-palette';

export type TermBounds = {minMs: number; maxMs: number};

/** The term range the connected firmware family accepts for this slot. */
export const tapDanceTermBounds = (
  slot: TapDanceSlot,
  vendorProductId: number,
): TermBounds =>
  exactTermBoundsFromOptions(
    slot.term?.options,
    getExactMsFamily(vendorProductId),
  );

/**
 * A slot's values as the keyboard last reported them, or null until it has
 * reported every one. The KEYMAP editor and layout files read them the same way.
 */
export const readTapDanceDraft = (
  slot: TapDanceSlot,
  menuData: Record<string, unknown> | null | undefined,
  termBounds: TermBounds,
): TapDanceDraft | null => {
  if (!menuData) {
    return null;
  }
  const bytes = (name: string) => {
    const value = menuData[name];
    return Array.isArray(value) && typeof value[0] === 'number'
      ? (value as number[])
      : null;
  };
  const actions = {} as TapDanceDraft['actions'];
  for (const role of TAP_DANCE_ACTION_ROLES) {
    const value = bytes(slot.actions[role].name);
    if (!value) {
      return null;
    }
    actions[role] = shiftTo16Bit([value[0], value[1] ?? 0]);
  }
  let term = '';
  if (slot.term) {
    const value = bytes(slot.term.name);
    if (!value) {
      return null;
    }
    term = String(
      termBounds.maxMs > 255 ? shiftTo16Bit([value[0], value[1] ?? 0]) : value[0],
    );
  }
  const response = slot.mode ? bytes(slot.mode.name) : null;
  const mode = response && response[1] === 0xd2 && [0, 1, 2].includes(response[0])
    ? response[0] : undefined;
  const hold = slot.holdTerm ? bytes(slot.holdTerm.name) : null;
  const other = slot.holdOnOther ? bytes(slot.holdOnOther.name) : null;
  const timing = mode !== undefined && response?.[2] === 0xd3 &&
    hold?.[2] === 0xd3 && other?.[1] === 0xd3 && [0, 1].includes(other[0]);
  return {actions, term, ...(mode !== undefined ? {mode} : {}), ...(timing ? {
    holdTerm: String(shiftTo16Bit([hold![0], hold![1]])), holdOnOther: other![0],
  } : {})};
};
