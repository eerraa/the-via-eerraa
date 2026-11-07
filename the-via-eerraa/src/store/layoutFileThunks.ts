import type {VIADefinitionV2, VIADefinitionV3} from '@the-via/reader';
import type {ConnectedDevice} from '../types/types';
import type {AppThunk, RootState} from './index';
import {KeyboardAPI} from '../utils/keyboard-api';
import {getCodeForByte} from '../utils/key';
import {collectDefinitionKeys} from '../utils/via-definition-keys';
import {normalizeLayoutMacros} from '../utils/layout-macros';
import {loadEraAdvancedMetadata} from '../utils/era-advanced-metadata';
import {getTapDanceSlots} from '../utils/keycode-palette';
import {readTapDanceDraft, tapDanceTermBounds} from '../utils/tap-dance-values';
import {requireConnectionProtocol} from '../utils/connection-profile';
import {collectMaxLedIndex} from '../utils/via-definition-keys';
import {getFirmwareVersionMap, getSelectedKeycodesVersion} from './firmwareSlice';
import {
  layoutOptionCounts,
  planLayoutImport,
  readLayoutCode,
  saveCustomMenuValues,
  saveLayoutOptions,
  saveMacroOptions,
  saveTapDance,
  type CustomMenuTarget,
  type LayoutImportError,
  type LayoutOptionsTarget,
  type MacroOptionsTarget,
  type LayoutPlace,
  type TapDanceTarget,
  type ViaSaveFile,
} from '../utils/layout-import';
import {
  getBasicKeyToByte,
  getDefinitionForDevice,
  getDefinitionSyncIdentity,
  getSelectedLayoutOptionsPending,
} from './definitionsSlice';
import {
  getSelectedConnectedDevice,
  getSelectedConnectionGeneration,
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
  getCustomMenuControlsForDefinition,
  getSelectedCustomMenuData,
} from './menusSlice';
import {
  ensureMacroOptions,
  getMacroOptionsChannel,
  getMacroOptionsForDevice,
} from './macroOptionsSlice';
import {MACRO_OPTIONS_SAVE_RETRY} from '../utils/macro-api/era-macro-options';
import {getPathSyncState} from './stateSyncSlice';
import {ensureMacroContents, refreshStateSyncDomain} from './stateSyncThunks';
import {importLayoutToDevice} from './importLayoutThunks';

// Layout files are read and written here, not in the pane: each operation gathers
// what it needs from the keyboard itself, so no caller has to prepare it first.

type LayoutExportResult =
  | {file: ViaSaveFile}
  | {error: 'keyboard-not-ready'};

export type LayoutFileImportError =
  | LayoutImportError
  | 'invalid-data'
  | 'write-failed';

/**
 * A keycode the file names that went in as something else: where, by layer and
 * matrix position for a key, the file's name, and the name of what went in.
 */
export type LayoutFileChange = {
  place:
    | Exclude<LayoutPlace, {key: number}>
    | {layer: number; row: number; col: number};
  code: string;
  loaded: string;
};

/** Loaded; `changed` lists what went in other than the file has it, if anything did. */
type LayoutFileImportResult =
  | {ok: true; changed?: LayoutFileChange[]}
  | {error: LayoutFileImportError};

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

// The Custom Menu as the menu reads it. Firmware that State Sync could not verify
// has its menu values never read (ADR 0001), so its files carry none, as for Tap Dance.
const customMenuTarget = (
  state: RootState,
  device: ConnectedDevice,
): (CustomMenuTarget & {failed: boolean}) | undefined => {
  const definition = getDefinitionForDevice(state, device);
  const availability = getCustomMenuAvailabilityForDevice(state, device);
  if (!definition || availability === 'unverified') {
    return undefined;
  }
  return {
    controls: getCustomMenuControlsForDefinition(
      definition,
      getFirmwareVersionMap(state)[device.path],
    ),
    values: state.menus.customMenuDataMap[device.path],
    available: availability === 'available',
    ledCount: collectMaxLedIndex(definition) + 1,
    unsaved: state.menus.saveRetries?.[device.path],
    failed: availability === 'failed',
  };
};

// Options a previous connection read are not this keyboard's now.
const layoutOptionsTarget = (
  state: RootState,
  device: ConnectedDevice,
): LayoutOptionsTarget | undefined => {
  const labels = getDefinitionForDevice(state, device)?.layouts.labels;
  if (!labels?.length) {
    return undefined;
  }
  const {layoutOptionsMap, layoutOptionsGenerationMap} = state.definitions;
  const current =
    layoutOptionsGenerationMap[device.path] ===
    getSelectedConnectionGeneration(state)
      ? layoutOptionsMap[device.path] ?? undefined
      : undefined;
  return {counts: layoutOptionCounts(labels), current};
};

// None where they are not asked for, as firmware State Sync could not verify is
// not (getMacroOptionsChannel), or where CAPABILITIES reported no support. Options
// whose read failed, is not done, or that CONFIG is reading again are unavailable,
// as for the Custom Menu.
const macroOptionsTarget = (
  state: RootState,
  device: ConnectedDevice,
): MacroOptionsTarget | undefined => {
  const channel = getMacroOptionsChannel(state, device);
  const read = getMacroOptionsForDevice(state, device);
  if (channel === null || read?.kind === 'unsupported') return undefined;
  return read?.kind === 'read' &&
    getCustomMenuAvailabilityForDevice(state, device) === 'available'
    ? {
        available: true,
        channel,
        supported: read.supported,
        options: read.options,
        unsaved: !!state.menus.saveRetries?.[device.path]?.[MACRO_OPTIONS_SAVE_RETRY],
      }
    : {available: false};
};

// Null where the keyboard is not asked for them; undefined while they are unread.
const readMacroOptionsForFile =
  (device: ConnectedDevice): AppThunk<Promise<Parameters<typeof saveMacroOptions>[0]>> =>
  async (dispatch, getState) =>
    getMacroOptionsChannel(getState(), device) === null
      ? null
      : (await dispatch(ensureMacroOptions(device))) ?? undefined;

const codeNamer = (state: RootState) => {
  const {basicKeyToByte, byteToKey} = getBasicKeyToByte(state);
  return (byte: number) =>
    getCodeForByte(byte, basicKeyToByte, byteToKey) || '';
};

// Tap Dance values, the Custom Menu values and the layout options come with
// CONFIG, which a State Sync keyboard may still be reading (just connected, or
// back from a hidden tab). A layout file waits for that read, as it does for the
// macros, instead of being refused.
const settleConfig =
  (device: ConnectedDevice): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const menu = customMenuTarget(getState(), device);
    if ((menu && !menu.available) || getSelectedLayoutOptionsPending(getState())) {
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
    // Tap Dance and menu values still being read are waited for after the dialog;
    // values the keyboard refused to report would not come by waiting.
    const tapDance = tapDanceTarget(state, device);
    if (tapDance?.failed) {
      return false;
    }
    const menu = customMenuTarget(state, device);
    if (menu?.failed && 'error' in saveCustomMenuValues(menu, codeNamer(state))) {
      return false;
    }
    return (
      !tapDance?.available ||
      !('error' in saveTapDance(tapDance, codeNamer(state)))
    );
  };

/**
 * The selected keyboard as a layout file: official VIA's format, plus its Tap
 * Dance, layout options, Custom Menu settings and per-key RGB. The macros are read first when
 * State Sync has not read them yet, CONFIG values still being read are waited
 * for, and the save is refused rather than written with anything missing.
 */
export const exportLayoutFile =
  (device: ConnectedDevice): AppThunk<Promise<LayoutExportResult>> =>
  async (dispatch, getState) => {
    const isCurrent = layoutOperation(getState(), device);
    if (!isCurrent(getState())) return {error: 'keyboard-not-ready'};
    if (!(await dispatch(ensureMacroContents(device))) || !isCurrent(getState())) {
      return {error: 'keyboard-not-ready'};
    }
    await dispatch(settleConfig(device));
    if (!isCurrent(getState())) return {error: 'keyboard-not-ready'};
    const savedMacroOptions = saveMacroOptions(
      await dispatch(readMacroOptionsForFile(device)),
    );
    if (!isCurrent(getState())) return {error: 'keyboard-not-ready'};
    if ('error' in savedMacroOptions) {
      return savedMacroOptions;
    }
    const state = getState();
    const definition = getDefinitionForDevice(state, device);
    if (!definition || getSelectedLayoutOptionsPending(state)) {
      return {error: 'keyboard-not-ready'};
    }
    const toCode = codeNamer(state);
    const tapDance = tapDanceTarget(state, device);
    const savedTapDance = tapDance ? saveTapDance(tapDance, toCode) : {};
    if ('error' in savedTapDance) {
      return savedTapDance;
    }
    const savedMenu = saveCustomMenuValues(customMenuTarget(state, device), toCode);
    if ('error' in savedMenu) {
      return savedMenu;
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
        ...saveLayoutOptions(layoutOptionsTarget(state, device)),
        ...savedMenu,
        ...savedMacroOptions,
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
    if (
      file.tapDance !== undefined ||
      file.layoutOptions !== undefined ||
      file.customMenuValues !== undefined ||
      file.perKeyRGB !== undefined ||
      file.macroOptions !== undefined
    ) {
      await dispatch(settleConfig(device));
    }
    // After CONFIG: options it has made stale are compared only once read again.
    if (file.macroOptions !== undefined) {
      await dispatch(ensureMacroOptions(device));
    }
    if (!isCurrent(getState())) return {error: 'keyboard-not-ready'};
    const state = getState();
    const definition = getDefinitionForDevice(state, device);
    if (!definition) {
      return {error: 'keyboard-not-ready'};
    }
    const profile = requireConnectionProtocol(new KeyboardAPI(device.path), {
      protocol: device.protocol,
      keycodesVersion: getSelectedKeycodesVersion(state),
    });
    const importKeycodes = profile.layoutImportKeycodes ?? {};
    const read = (code: string) => readLayoutCode(code, importKeycodes);
    let plan: ReturnType<typeof planLayoutImport>;
    try {
      plan = planLayoutImport(
        file,
        {
          vendorProductId: definition.vendorProductId,
          layers: getSelectedRawLayers(state).map((layer) => layer.keymap),
          macroCount: getKnownMacroCount(state),
          tapDance: tapDanceTarget(state, device),
          layoutOptions: layoutOptionsTarget(state, device),
          customMenu: customMenuTarget(state, device),
          macroOptions: macroOptionsTarget(state, device),
        },
        (code) => read(code).value,
        (code) => read(code).asWritten,
      );
    } catch (error) {
      // Data no layout file holds, such as a layer that is not a list of names.
      console.warn('Reading layout failed', error);
      return {error: 'invalid-data'};
    }
    if ('error' in plan) {
      return plan;
    }
    try {
      // Settings the keyboard took but refused to keep are not loaded, as an
      // edit whose SAVE is refused is not done.
      if (!(await dispatch(importLayoutToDevice(device, plan)))) {
        return {error: 'write-failed'};
      }
    } catch (error) {
      console.warn('Loading layout failed', error);
      return {error: 'write-failed'};
    }
    if (plan.changed.length === 0) {
      return {ok: true};
    }
    const toCode = codeNamer(state);
    const {cols} = definition.matrix;
    return {
      ok: true,
      changed: plan.changed.map(({place, code, value}) => ({
        place:
          'key' in place
            ? {
                layer: place.layer,
                row: Math.floor(place.key / cols),
                col: place.key % cols,
              }
            : place,
        code,
        loaded: toCode(value),
      })),
    };
  };
