import {useCallback, useMemo} from 'react';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import type {AppThunk} from 'src/store/index';
import {
  getSelectedConnectedDevice,
  getSelectedConnectionGeneration,
  getSelectionGeneration,
  isSelectedDeviceOperationCurrent,
} from 'src/store/devicesSlice';
import {
  getBasicKeyToByte,
  getDefinitionSyncIdentity,
} from 'src/store/definitionsSlice';
import {getNumberOfLayers} from 'src/store/keymapSlice';
import {getPaletteMacroCount} from 'src/store/macrosSlice';
import {
  discardDrafts,
  draftKey,
  getSelectedDeviceDrafts,
  setDraft,
} from 'src/store/draftsSlice';
import {
  getSelectedCustomMenuAvailability,
  getSelectedCustomMenuData,
  updateCustomMenuValue,
} from 'src/store/menusSlice';
import {
  tapDanceWriteBytes,
  editedTapDanceChanges,
  getTapDanceSlots,
  tapDanceFieldOf,
  type TapDanceChanges,
  type TapDanceDraft,
  type TapDanceSlot,
  type TapDanceWrite,
} from 'src/utils/keycode-palette';
import {readTapDanceDraft, tapDanceTermBounds} from 'src/utils/tap-dance-values';
import type {EraTapDanceKeycode} from 'src/utils/era-definition';
import {getExactMsFamily} from 'src/utils/era-advanced-metadata';
import {buildEnabledKeycodeMenus} from 'src/utils/keycode-menus';
import {selectKeycodeFromMenuCode} from 'src/utils/keycode-picker';
import {
  getTapDanceKeycodeDisabledReason,
  type KeycodeDisabledReason,
} from 'src/utils/keycode-eligibility';

export type TapDanceBinding = {
  slots: TapDanceSlot[];
  /** The keyboard's values, or null until it has reported every one of them. */
  read: (slot: TapDanceSlot) => TapDanceDraft | null;
  /**
   * What the user set on a slot and has not applied. It belongs to the keyboard,
   * not to the editor, so leaving the editor keeps it until Save writes it,
   * Cancel drops it or the keyboard disconnects.
   */
  changes: (slot: TapDanceSlot) => TapDanceChanges;
  /**
   * A field set back to the keyboard's value is no longer a change. One left as it
   * was stays, and so does one set to the value a write has on its way, even while
   * that write makes it read as the keyboard's.
   */
  setChanges: (slot: TapDanceSlot, changes: TapDanceChanges) => void;
  termBounds: (slot: TapDanceSlot) => {minMs: number; maxMs: number};
  getDisabledReason?: (value: number | null) => KeycodeDisabledReason | null;
  canWrite: boolean;
  /**
   * Firmware that State Sync could not verify keeps ordinary VIA behaviour: its
   * Tap Dance is never read, so only the TD keys themselves are offered.
   */
  unverified: boolean;
  /**
   * The keyboard refused to report its settings, and waiting will not change that
   * answer: as when unverified, only the TD keys themselves are offered.
   */
  failed: boolean;
  /**
   * Sends in order and stops at the first write the keyboard refuses. A field it
   * took is no longer a change, unless it was set again meanwhile.
   */
  write: (slot: TapDanceSlot, writes: TapDanceWrite[]) => Promise<boolean>;
};

const NO_CHANGES: TapDanceChanges = {};

/** A later field cannot follow a selection change onto a different keyboard. */
const writeForSelection = (
  devicePath: string,
  connectionGeneration: number | null,
  selectionGeneration: number,
  definitionIdentity: string | null,
  write: TapDanceWrite,
): AppThunk<Promise<boolean>> => (dispatch, getState) => {
  const state = getState();
  if (
    connectionGeneration === null ||
    !isSelectedDeviceOperationCurrent(
      state,
      devicePath,
      connectionGeneration,
      selectionGeneration,
    ) ||
    getDefinitionSyncIdentity(state, getSelectedConnectedDevice(state)) !==
      definitionIdentity
  ) {
    return Promise.resolve(false);
  }
  return dispatch(
    updateCustomMenuValue(
      write.name,
      write.channel,
      write.id,
      ...tapDanceWriteBytes(write),
    ),
  );
};

// The values Save has sent to a keyboard's slots and not had answered yet, kept
// per keyboard like its drafts, as the editor may be left and opened again
// meanwhile. The keyboard's values show one before it is answered, so an edit that
// sets a field to it again would otherwise read as no change, and be lost if the
// keyboard refused it.
const sending = new Map<string, TapDanceChanges>();

const sendingKey = (devicePath: string, slot: TapDanceSlot) =>
  `${devicePath}\n${draftKey('tapDance', slot.index)}`;

/** Marks a write as on its way; what it returns ends that once it is answered. */
const beginSending = (
  devicePath: string,
  slot: TapDanceSlot,
  write: TapDanceWrite,
) => {
  const field = tapDanceFieldOf(slot, write.name);
  if (!field) {
    return () => undefined;
  }
  const key = sendingKey(devicePath, slot);
  const entry: TapDanceChanges = {...sending.get(key)};
  if (field === 'term' || field === 'holdTerm') {
    entry[field] = String(write.value);
  } else {
    entry[field] = write.value;
  }
  sending.set(key, entry);
  const value = entry[field];
  return () => {
    const rest: TapDanceChanges = {...sending.get(key)};
    if (rest[field] !== value) {
      return;
    }
    delete rest[field];
    if (Object.keys(rest).length > 0) {
      sending.set(key, rest);
    } else {
      sending.delete(key);
    }
  };
};

const settleWrite =
  (devicePath: string, slot: TapDanceSlot, write: TapDanceWrite): AppThunk =>
  (dispatch, getState) => {
    const key = draftKey('tapDance', slot.index);
    const changes = getState().drafts[devicePath]?.[key] as
      | TapDanceChanges
      | undefined;
    const field = tapDanceFieldOf(slot, write.name);
    if (!changes || !field) {
      return;
    }
    const value = changes[field];
    if (value === undefined || Number(value) !== write.value) {
      return;
    }
    const rest = {...changes};
    delete rest[field];
    dispatch(
      Object.keys(rest).length > 0
        ? setDraft({devicePath, key, value: rest})
        : discardDrafts({devicePath, keys: [key]}),
    );
  };

// What the edit left as it was is judged by the store at that moment, not by the
// last render, so a field a write has just settled does not come back.
const storeChanges =
  (
    devicePath: string,
    slot: TapDanceSlot,
    next: TapDanceChanges,
    current: TapDanceDraft | null,
  ): AppThunk =>
  (dispatch, getState) => {
    const key = draftKey('tapDance', slot.index);
    const previous = (getState().drafts[devicePath]?.[key] ??
      NO_CHANGES) as TapDanceChanges;
    const changes = current
      ? editedTapDanceChanges(
          next,
          previous,
          current,
          sending.get(sendingKey(devicePath, slot)),
        )
      : next;
    dispatch(
      Object.keys(changes).length > 0
        ? setDraft({devicePath, key, value: changes})
        : discardDrafts({devicePath, keys: [key]}),
    );
  };

/**
 * Tap Dance settings are Custom Values like any menu row: they are read, written
 * and resynchronised through the same store paths, only edited from KEYMAP.
 */
export const useTapDanceBinding = (
  definition: {tapdanceKeycodes?: EraTapDanceKeycode[]} | null | undefined,
): TapDanceBinding | null => {
  const dispatch = useAppDispatch();
  const device = useAppSelector(getSelectedConnectedDevice);
  const connectionGeneration = useAppSelector(getSelectedConnectionGeneration);
  const selectionGeneration = useAppSelector(getSelectionGeneration);
  const definitionIdentity = useAppSelector((state) =>
    getDefinitionSyncIdentity(state, getSelectedConnectedDevice(state)),
  );
  const menuData = useAppSelector(getSelectedCustomMenuData);
  const availability = useAppSelector(getSelectedCustomMenuAvailability);
  const drafts = useAppSelector(getSelectedDeviceDrafts);
  const {basicKeyToByte} = useAppSelector(getBasicKeyToByte);
  const layerCount = useAppSelector(getNumberOfLayers);
  const macroCount = useAppSelector(getPaletteMacroCount);
  const slots = useMemo(() => getTapDanceSlots(definition), [definition]);
  const vendorProductId = device?.vendorProductId ?? 0;
  const devicePath = device?.path;
  const unverified = availability === 'unverified';
  const failed = availability === 'failed';

  const eligibility = useMemo(() => {
    const menus = definition
      ? buildEnabledKeycodeMenus({
          definition: definition as Parameters<
            typeof buildEnabledKeycodeMenus
          >[0]['definition'],
          basicKeyToByte,
          protocol: device?.protocol,
          macroCount,
        })
      : [];
    return {
      engine: getExactMsFamily(vendorProductId),
      basicKeyToByte,
      layerCount,
      macroCount,
      // Both audited engines reserve KB0–KB7 even if an uploaded definition
      // omits an editor slot or one of its controls.
      tapDanceCount: 8,
      availableKeycodes: new Set(
        menus.flatMap((menu) =>
          menu.keycodes.flatMap((keycode) => {
            const value = selectKeycodeFromMenuCode(keycode.code, basicKeyToByte);
            return value === null ? [] : [value];
          }),
        ),
      ),
    };
  }, [
    definition,
    basicKeyToByte,
    device?.protocol,
    macroCount,
    layerCount,
    vendorProductId,
    slots,
  ]);

  const getDisabledReason = useCallback(
    (value: number | null) => getTapDanceKeycodeDisabledReason(value, eligibility),
    [eligibility],
  );

  const termBounds = useCallback(
    (slot: TapDanceSlot) => tapDanceTermBounds(slot, vendorProductId),
    [vendorProductId],
  );

  const read = useCallback(
    (slot: TapDanceSlot): TapDanceDraft | null =>
      unverified || failed
        ? null
        : readTapDanceDraft(
            slot,
            menuData as Record<string, unknown> | null | undefined,
            termBounds(slot),
          ),
    [unverified, failed, menuData, termBounds],
  );

  const changes = useCallback(
    (slot: TapDanceSlot) =>
      (drafts[draftKey('tapDance', slot.index)] as
        | TapDanceChanges
        | undefined) ?? NO_CHANGES,
    [drafts],
  );

  const setChanges = useCallback(
    (slot: TapDanceSlot, next: TapDanceChanges) => {
      if (!devicePath) {
        return;
      }
      dispatch(storeChanges(devicePath, slot, next, read(slot)));
    },
    [devicePath, dispatch, read],
  );

  const write = useCallback(
    async (slot: TapDanceSlot, writes: TapDanceWrite[]) => {
      if (availability !== 'available' || !devicePath) {
        return false;
      }
      const current = read(slot);
      if (!current) {
        return false;
      }
      // Validate the entire batch before sending its first field. Only changed
      // action fields are judged; untouched firmware values remain as reported.
      const changed = writes.filter((item) => {
        const field = tapDanceFieldOf(slot, item.name);
        return !field || item.value !== Number(
          field === 'term' || field === 'mode' || field === 'holdTerm' || field === 'holdOnOther' ? current[field] : current.actions[field],
        );
      });
      const resultingMode = changed.find((item) => tapDanceFieldOf(slot, item.name) === 'mode')?.value ?? current.mode;
      const resultingHold = changed.find((item) => tapDanceFieldOf(slot, item.name) === 'hold')?.value ?? current.actions.hold;
      if (resultingMode === 2 && resultingHold !== 1) return false;
      for (const item of changed) {
        const field = tapDanceFieldOf(slot, item.name);
        const control = field === 'term' || field === 'mode' || field === 'holdTerm' || field === 'holdOnOther' ? slot[field] : field && slot.actions[field];
        const bounds = termBounds(slot);
        if (
          !field ||
          !control ||
          item.channel !== control.channel ||
          item.id !== control.id ||
          !Number.isInteger(item.value) ||
          item.value < 0 ||
          item.value > 0xffff ||
          (field === 'holdTerm'
            ? current.holdTerm === undefined
            : field === 'holdOnOther'
            ? current.holdOnOther === undefined || ![0, 1].includes(item.value)
            : field === 'mode'
            ? current.mode === undefined || ![0, 1, 2].includes(item.value)
            : field === 'term'
            ? item.value < bounds.minMs || item.value > bounds.maxMs
            : !(resultingMode && field !== 'tap' && item.value === 1) && getDisabledReason(item.value))
        ) {
          return false;
        }
      }
      for (const item of changed) {
        const answered = devicePath
          ? beginSending(devicePath, slot, item)
          : null;
        const accepted = await dispatch(
          writeForSelection(
            devicePath,
            connectionGeneration,
            selectionGeneration,
            definitionIdentity,
            item,
          ),
        ).finally(() => answered?.());
        if (!accepted) {
          return false;
        }
        if (devicePath) {
          dispatch(settleWrite(devicePath, slot, item));
        }
      }
      return true;
    },
    [
      availability,
      devicePath,
      connectionGeneration,
      selectionGeneration,
      definitionIdentity,
      dispatch,
      getDisabledReason,
      read,
      termBounds,
    ],
  );

  return useMemo(
    () =>
      slots.length === 0
        ? null
        : {
            slots,
            read,
            changes,
            setChanges,
            termBounds,
            getDisabledReason,
            canWrite: availability === 'available',
            unverified,
            failed,
            write,
          },
    [
      slots,
      read,
      changes,
      setChanges,
      termBounds,
      getDisabledReason,
      availability,
      unverified,
      failed,
      write,
    ],
  );
};
