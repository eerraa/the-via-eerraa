import type {VIADefinitionV2, VIADefinitionV3} from '@the-via/reader';
import type {ConnectedDevice} from '../types/types';
import type {AppThunk, RootState} from './index';
import {KeyboardAPI} from '../utils/keyboard-api';
import {getByteForCode, getCodeForByte} from '../utils/key';
import deprecatedKeycodes from '../utils/key-to-byte/deprecated-keycodes';
import {collectDefinitionKeys} from '../utils/via-definition-keys';
import {normalizeLayoutMacros} from '../utils/layout-macros';
import {loadEraAdvancedMetadata} from '../utils/era-advanced-metadata';
import {getTapDanceSlots} from '../utils/keycode-palette';
import {readTapDanceDraft, tapDanceTermBounds} from '../utils/tap-dance-values';
import {
  planLayoutImport,
  saveTapDance,
  type LayoutImportError,
  type TapDanceTarget,
  type ViaSaveFile,
} from '../utils/layout-import';
import {
  getBasicKeyToByte,
  getDefinitionForDevice,
  getDefinitionSyncIdentity,
} from './definitionsSlice';
import {
  getSelectedConnectedDevice,
  getSelectionGeneration,
  isSelectedDeviceOperationCurrent,
} from './devicesSlice';
import {getSelectedDefinitionName} from './definitionNameSlice';
import {getSelectedRawLayers} from './keymapSlice';
import {
  getExpressions,
  getIsMacrosReady,
  getKnownMacroCount,
  getMacroCount,
} from './macrosSlice';
import {
  getCustomMenuAvailabilityForDevice,
  getSelectedCustomMenuData,
} from './menusSlice';
import {getPathSyncState} from './stateSyncSlice';
import {ensureMacroContents, refreshStateSyncDomain} from './stateSyncThunks';
import {importLayoutToDevice} from './importLayoutThunks';

// Layout files are read and written here, not in the pane: each operation gathers
// what it needs from the keyboard itself, so no caller has to prepare it first.

export type LayoutExportResult =
  | {file: ViaSaveFile}
  | {error: 'keyboard-not-ready'};

export type LayoutFileImportError =
  | LayoutImportError
  | 'invalid-data'
  | 'write-failed';

export type LayoutFileImportResult = {ok: true} | {error: LayoutFileImportError};

// Selected-state selectors must never be combined with a different keyboard's
// identity or HID reads. Pin both selection and connection across every await.
const layoutOperation = (state: RootState, device: ConnectedDevice) => {
  const selected = getSelectedConnectedDevice(state);
  if (
    selected?.path !== device.path ||
    selected.vendorProductId !== device.vendorProductId
  ) {
    return () => false;
  }
  const api = new KeyboardAPI(device.path);
  const generation = api.getConnectionGeneration();
  const selection = getSelectionGeneration(state);
  const definition = getDefinitionSyncIdentity(state, device);
  return (next: RootState) =>
    getSelectedConnectedDevice(next)?.vendorProductId === device.vendorProductId &&
    api.isConnectionGenerationCurrent(generation) &&
    isSelectedDeviceOperationCurrent(next, device.path, generation, selection) &&
    definition !== null &&
    getDefinitionSyncIdentity(next, device) === definition;
};

const tapDanceTarget = (
  state: RootState,
  device: ConnectedDevice,
): (TapDanceTarget & {failed: boolean}) | undefined => {
  const slots = getTapDanceSlots(getDefinitionForDevice(state, device) as any);
  const availability = getCustomMenuAvailabilityForDevice(state, device);
  // Firmware that State Sync could not verify keeps ordinary VIA behaviour: its
  // Tap Dance is never read (ADR 0001), so its files are official VIA's alone.
  if (slots.length === 0 || availability === 'unverified') {
    return undefined;
  }
  const menuData = (getSelectedCustomMenuData(state) || undefined) as
    | Record<string, unknown>
    | undefined;
  const termBounds: TapDanceTarget['termBounds'] = (slot) =>
    tapDanceTermBounds(slot, device.vendorProductId);
  return {
    slots,
    termBounds,
    read: (slot) => readTapDanceDraft(slot, menuData, termBounds(slot)),
    available: availability === 'available',
    // Refused rather than still being read: waiting would not read them.
    failed: availability === 'failed',
  };
};

const codeNamer = (state: RootState) => {
  const {basicKeyToByte, byteToKey} = getBasicKeyToByte(state);
  return (byte: number) =>
    getCodeForByte(byte, basicKeyToByte, byteToKey) || '';
};

// Tap Dance values come with CONFIG, which a State Sync keyboard may still be
// reading (just connected, or back from a hidden tab). A layout file waits for
// that read, as it does for the macros, instead of being refused.
const settleTapDance =
  (device: ConnectedDevice): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const tapDance = tapDanceTarget(getState(), device);
    if (tapDance && !tapDance.available) {
      await dispatch(refreshStateSyncDomain(device, 'config'));
    }
  };

const readEncoders = async (
  api: KeyboardAPI,
  definition: VIADefinitionV2 | VIADefinitionV3,
  layerCount: number,
  toCode: (byte: number) => string,
): Promise<[string, string][][]> => {
  const encoderIds = collectDefinitionKeys({layouts: definition.layouts})
    .filter((key) => 'ei' in key)
    .map((key) => key.ei as number);
  if (encoderIds.length === 0) {
    return [];
  }
  const encoderCount = Math.max(...encoderIds) + 1;
  return Promise.all(
    Array.from({length: encoderCount}, (_, encoderId) =>
      Promise.all(
        Array.from({length: layerCount}, (_, layer) =>
          Promise.all([
            api.getEncoderValue(layer, encoderId, false),
            api.getEncoderValue(layer, encoderId, true),
          ]).then(
            (bytes) => bytes.map(toCode) as [string, string],
          ),
        ),
      ),
    ),
  );
};

/**
 * Whether a save can go ahead, decided without waiting. Its file dialog needs the
 * click, so it opens before anything is read; whatever already rules the save out
 * is checked first, so that refusal does not come after a file has been chosen.
 */
export const canExportLayoutFile =
  (device: ConnectedDevice): AppThunk<boolean> =>
  (_dispatch, getState) => {
    const state = getState();
    if (
      !layoutOperation(state, device)(state) ||
      !getDefinitionForDevice(state, device)
    ) {
      return false;
    }
    // Only a State Sync keyboard reads its macros when a save asks for them.
    if (
      !getIsMacrosReady(state) &&
      getPathSyncState(state, device.path)?.capability !== 'capable'
    ) {
      return false;
    }
    // Tap Dance values still being read are waited for after the dialog; values
    // the keyboard refused to report would not come by waiting.
    const tapDance = tapDanceTarget(state, device);
    if (tapDance?.failed) {
      return false;
    }
    return (
      !tapDance?.available ||
      !('error' in saveTapDance(tapDance, codeNamer(state)))
    );
  };

/**
 * The selected keyboard as a layout file: official VIA's format, plus its Tap
 * Dance. The macros are read first when State Sync has not read them yet, Tap
 * Dance values still being read are waited for, and the save is refused rather
 * than written with anything missing.
 */
export const exportLayoutFile =
  (device: ConnectedDevice): AppThunk<Promise<LayoutExportResult>> =>
  async (dispatch, getState) => {
    const isCurrent = layoutOperation(getState(), device);
    if (!isCurrent(getState())) return {error: 'keyboard-not-ready'};
    if (!(await dispatch(ensureMacroContents(device))) || !isCurrent(getState())) {
      return {error: 'keyboard-not-ready'};
    }
    await dispatch(settleTapDance(device));
    if (!isCurrent(getState())) return {error: 'keyboard-not-ready'};
    const state = getState();
    const definition = getDefinitionForDevice(state, device);
    if (!definition) {
      return {error: 'keyboard-not-ready'};
    }
    const toCode = codeNamer(state);
    const tapDance = tapDanceTarget(state, device);
    const savedTapDance = tapDance ? saveTapDance(tapDance, toCode) : {};
    if ('error' in savedTapDance) {
      return savedTapDance;
    }
    const rawLayers = getSelectedRawLayers(state);
    const encoders = await readEncoders(
      new KeyboardAPI(device.path),
      definition,
      rawLayers.length,
      toCode,
    );
    if (!isCurrent(getState())) return {error: 'keyboard-not-ready'};
    return {
      file: {
        name: getSelectedDefinitionName(state),
        vendorProductId: definition.vendorProductId,
        macros: normalizeLayoutMacros(
          getExpressions(state),
          getMacroCount(state),
        ),
        layers: rawLayers.map((layer) => layer.keymap.map(toCode)),
        encoders,
        ...savedTapDance,
      },
    };
  };

/**
 * Loads a layout file onto the selected keyboard as one transaction. Replacing
 * every macro needs only the slot count, so the macro buffer is not read first.
 */
export const importLayoutFile =
  (
    device: ConnectedDevice,
    file: ViaSaveFile,
  ): AppThunk<Promise<LayoutFileImportResult>> =>
  async (dispatch, getState) => {
    const isCurrent = layoutOperation(getState(), device);
    if (!isCurrent(getState())) return {error: 'keyboard-not-ready'};
    // A file from this board's older firmware carries the identity that firmware
    // reported; the metadata that ties the two together is read before comparing.
    await loadEraAdvancedMetadata();
    if (!isCurrent(getState())) return {error: 'keyboard-not-ready'};
    if (file.tapDance !== undefined) {
      await dispatch(settleTapDance(device));
    }
    if (!isCurrent(getState())) return {error: 'keyboard-not-ready'};
    const state = getState();
    const definition = getDefinitionForDevice(state, device);
    if (!definition) {
      return {error: 'keyboard-not-ready'};
    }
    const {basicKeyToByte} = getBasicKeyToByte(state);
    let plan: ReturnType<typeof planLayoutImport>;
    try {
      plan = planLayoutImport(
        file,
        {
          vendorProductId: definition.vendorProductId,
          layers: getSelectedRawLayers(state).map((layer) => layer.keymap),
          macroCount: getKnownMacroCount(state),
          tapDance: tapDanceTarget(state, device),
        },
        (code) =>
          getByteForCode(`${deprecatedKeycodes[code] ?? code}`, basicKeyToByte),
      );
    } catch (error) {
      // A key name this keyboard's keycode set cannot resolve.
      console.warn('Reading layout failed', error);
      return {error: 'invalid-data'};
    }
    if ('error' in plan) {
      return plan;
    }
    try {
      await dispatch(importLayoutToDevice(device, plan));
    } catch (error) {
      console.warn('Loading layout failed', error);
      return {error: 'write-failed'};
    }
    return {ok: true};
  };
