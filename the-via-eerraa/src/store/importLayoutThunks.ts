import {numIntoBytes} from '../utils/bit-pack';
import {tapDanceWriteBytes} from '../utils/keycode-palette';
import {
  KeyboardAPI,
  KeyboardValue,
  UnhandledCommandError,
} from '../utils/keyboard-api';
import type {TapDanceWrite} from '../utils/keycode-palette';
import {
  PER_KEY_RGB,
  type CustomMenuWrite,
  type MacroOptionsWrite,
  type PerKeyRGBWrite,
} from '../utils/layout-import';
import {
  MACRO_OPTIONS_SAVE_RETRY,
  writeMacroOptions,
} from '../utils/macro-api/era-macro-options';
import {macroOptionsWritten} from './macroOptionsSlice';
import {updateLayoutOptions} from './definitionsSlice';
import type {ConnectedDevice} from '../types/types';
import type {AppThunk} from './index';
import {
  getSelectionGeneration,
  isSelectedDeviceOperationCurrent,
} from './devicesSlice';
import {replaceEncoderMap, saveRawKeymapToDevice} from './keymapSlice';
import {replaceMacros} from './macrosSlice';
import {
  getSelectedCustomMenuData,
  setMenuSaveRetry,
  updateSelectedCustomMenuData,
} from './menusSlice';
import {
  invalidateStateSyncDomain,
  type StateSyncEncoderMap,
} from './stateSyncCandidateActions';
import {beginForegroundMutation, type StateSyncDomain} from './stateSyncSlice';

type FullLayoutImport = {
  keymap: number[][];
  /** Every macro slot: they replace the keyboard's macros without reading them. */
  macros?: string[];
  encoders?: StateSyncEncoderMap;
  /** Custom Values a layout file carries (Tap Dance), saved once per channel. */
  customValues?: TapDanceWrite[];
  /** Layout options: the packed value SET sends, and the choices it stands for. */
  layoutOptions?: {value: number; options: number[]};
  /** Custom Menu settings, saved once per channel. */
  menuValues?: CustomMenuWrite[];
  /** Per-key colours, saved with the Custom Menu channel the painter saves. */
  perKeyRGB?: PerKeyRGBWrite[];
  /** Macro options, written after the macros and saved on their channel. */
  macroOptions?: {channel: number; writes: MacroOptionsWrite[]};
};

// The channel per-key RGB lives on, as the painter saves it.
const PER_KEY_RGB_CHANNEL = 0;

// A setting the keyboard answers as unhandled is left as it is and the rest goes
// on: ordinary VIA firmware need not take every value its definition names.
// Any other failure still fails the import.
const unlessUnhandled = async (write: () => Promise<void>) => {
  try {
    await write();
    return true;
  } catch (error) {
    if (!(error instanceof UnhandledCommandError)) {
      throw error;
    }
    console.warn('Layout import left a setting the keyboard does not handle', error);
    return false;
  }
};

/**
 * Writes a whole layout as one transaction: one path reservation, one foreground
 * mutation over every domain it touches, and one reconciliation if any part fails.
 * False when the keyboard refused to keep Custom Menu settings it took.
 */
export const importLayoutToDevice =
  (
    connectedDevice: ConnectedDevice,
    layout: FullLayoutImport,
  ): AppThunk<Promise<boolean>> =>
  async (dispatch, getState) => {
    const api = new KeyboardAPI(connectedDevice.path);
    const connectionGeneration = api.getConnectionGeneration();
    const selectionGeneration = getSelectionGeneration(getState());
    if (
      !isSelectedDeviceOperationCurrent(
        getState(),
        connectedDevice.path,
        connectionGeneration,
        selectionGeneration,
      )
    ) {
      throw new Error('Layout import does not belong to the current device');
    }
    const customValues = layout.customValues ?? [];
    const menuValues = layout.menuValues ?? [];
    const perKeyRGB = layout.perKeyRGB ?? [];
    let allSaved = true;
    const domains: StateSyncDomain[] = ['keymap'];
    if (layout.macros !== undefined) {
      domains.push('macro');
    }
    if (
      customValues.length > 0 ||
      menuValues.length > 0 ||
      perKeyRGB.length > 0 ||
      layout.layoutOptions !== undefined ||
      layout.macroOptions !== undefined
    ) {
      domains.push('config');
    }
    const assertCurrent = (reservedApi: KeyboardAPI) => {
      if (
        !reservedApi.isConnectionGenerationCurrent(connectionGeneration) ||
        !isSelectedDeviceOperationCurrent(
          getState(),
          connectedDevice.path,
          connectionGeneration,
          selectionGeneration,
        )
      ) {
        throw new Error('Layout import context changed before completion');
      }
    };
    dispatch(
      beginForegroundMutation({
        path: connectedDevice.path,
        generation: connectionGeneration,
        domains,
      }),
    );

    const owner = Symbol(`layout-import:${connectedDevice.path}`);
    try {
      await api.withPathReservation(
        connectionGeneration,
        owner,
        async (reservedApi) => {
          if (layout.macros !== undefined) {
            await dispatch(
              replaceMacros(connectedDevice, layout.macros, {
                api: reservedApi,
                mutationEpochAlreadyAdvanced: true,
                reconcileOnFailure: false,
              }),
            );
          }

          await dispatch(
            saveRawKeymapToDevice(layout.keymap, connectedDevice, {
              api: reservedApi,
              mutationEpochAlreadyAdvanced: true,
              reconcileOnFailure: false,
            }),
          );

          if (layout.encoders !== undefined) {
            const encoderIds = Object.keys(layout.encoders)
              .map(Number)
              .sort((left, right) => left - right);
            for (const encoderId of encoderIds) {
              const layers = layout.encoders[encoderId] ?? [];
              for (let layerId = 0; layerId < layers.length; layerId++) {
                const [counterclockwise, clockwise] = layers[layerId];
                await reservedApi.setEncoderValue(
                  layerId,
                  encoderId,
                  false,
                  counterclockwise,
                );
                await reservedApi.setEncoderValue(
                  layerId,
                  encoderId,
                  true,
                  clockwise,
                );
              }
            }
            assertCurrent(reservedApi);
            dispatch(
              replaceEncoderMap({
                devicePath: connectedDevice.path,
                encoders: layout.encoders,
              }),
            );
          }

          if (customValues.length > 0) {
            for (const write of customValues) {
              const {channel, id} = write;
              await reservedApi.setCustomMenuValue(
                channel,
                id,
                ...tapDanceWriteBytes(write),
              );
            }
            for (const channel of new Set(
              customValues.map((write) => write.channel),
            )) {
              await reservedApi.commitCustomMenu(channel);
            }
            assertCurrent(reservedApi);
            dispatch(
              updateSelectedCustomMenuData({
                devicePath: connectedDevice.path,
                menuData: {
                  ...getSelectedCustomMenuData(getState()),
                  ...Object.fromEntries(
                    customValues.map((write) => [
                      write.name,
                      tapDanceWriteBytes(write),
                    ]),
                  ),
                },
              }),
            );
          }

          if (layout.layoutOptions !== undefined) {
            const {value, options} = layout.layoutOptions;
            const written = await unlessUnhandled(() =>
              reservedApi.setKeyboardValue(
                KeyboardValue.LAYOUT_OPTIONS,
                ...numIntoBytes(value),
              ),
            );
            assertCurrent(reservedApi);
            if (written) {
              dispatch(
                updateLayoutOptions({
                  devicePath: connectedDevice.path,
                  connectionGeneration,
                  options,
                }),
              );
            }
          }

          if (menuValues.length > 0 || perKeyRGB.length > 0) {
            const written: CustomMenuWrite[] = [];
            for (const write of menuValues) {
              if (
                await unlessUnhandled(() =>
                  reservedApi.setCustomMenuValue(...write.address, ...write.bytes),
                )
              ) {
                written.push(write);
              }
            }
            const colors: PerKeyRGBWrite[] = [];
            for (const color of perKeyRGB) {
              if (
                await unlessUnhandled(() =>
                  reservedApi.setPerKeyRGBMatrix(color.led, ...color.bytes),
                )
              ) {
                colors.push(color);
              }
            }
            const owed = new Map<number, string[]>();
            for (const {name, address: [channel]} of written) {
              owed.set(channel, [...(owed.get(channel) ?? []), name]);
            }
            if (colors.length > 0) {
              owed.set(PER_KEY_RGB_CHANNEL, [
                ...(owed.get(PER_KEY_RGB_CHANNEL) ?? []),
                PER_KEY_RGB,
              ]);
            }
            // As for an edit (updateCustomMenuValue): a SET the keyboard took
            // stays owed a SAVE until one is acknowledged, so a refused SAVE
            // leaves its channel's values to be sent again; other channels go on.
            const owe = (commands: string[], retry: boolean) =>
              commands.forEach((command) =>
                dispatch(
                  setMenuSaveRetry({
                    devicePath: connectedDevice.path,
                    command,
                    retry,
                  }),
                ),
              );
            for (const [channel, commands] of owed) {
              assertCurrent(reservedApi);
              owe(commands, true);
              if (await unlessUnhandled(() => reservedApi.commitCustomMenu(channel))) {
                owe(commands, false);
              } else {
                allSaved = false;
              }
            }
            assertCurrent(reservedApi);
            // The cache holds what the keyboard runs, kept or not, as for an edit.
            const menuData = getSelectedCustomMenuData(getState()) || {};
            const leds = [
              ...((menuData?.[PER_KEY_RGB] as number[][] | undefined) ?? []),
            ];
            colors.forEach(({led, bytes}) => {
              leds[led] = bytes;
            });
            dispatch(
              updateSelectedCustomMenuData({
                devicePath: connectedDevice.path,
                menuData: {
                  ...menuData,
                  ...Object.fromEntries(
                    written.map(({name, bytes}) => [name, bytes]),
                  ),
                  ...(colors.length > 0 && {[PER_KEY_RGB]: leds}),
                },
              }),
            );
          }

          // After the macros above, which leave the options as they were (VIA's
          // macro RESET keeps them); only differences were planned.
          if (layout.macroOptions !== undefined) {
            const {channel, writes} = layout.macroOptions;
            const written: MacroOptionsWrite[] = [];
            for (const {index, ...values} of writes) {
              const took: MacroOptionsWrite = {index};
              const complete = await writeMacroOptions(
                (bytes) => unlessUnhandled(() => reservedApi.setCustomMenuValue(...bytes)),
                channel,
                index,
                values,
                (value) => Object.assign(took, value),
              );
              // A refused SET fails the load; what the keyboard took is still saved.
              if (!complete) allSaved = false;
              if (Object.keys(took).length > 1) written.push(took);
            }
            if (written.length > 0) {
              // As for the Custom Menu values above.
              const owe = (retry: boolean) =>
                dispatch(
                  setMenuSaveRetry({
                    devicePath: connectedDevice.path,
                    command: MACRO_OPTIONS_SAVE_RETRY,
                    retry,
                  }),
                );
              assertCurrent(reservedApi);
              owe(true);
              if (await unlessUnhandled(() => reservedApi.commitCustomMenu(channel))) {
                owe(false);
              } else {
                allSaved = false;
              }
              assertCurrent(reservedApi);
              written.forEach(({index, ...values}) =>
                dispatch(
                  macroOptionsWritten({
                    path: connectedDevice.path,
                    generation: connectionGeneration,
                    index,
                    values,
                  }),
                ),
              );
            }
          }

          if (domains.includes('config')) {
            dispatch(
              invalidateStateSyncDomain({
                devicePath: connectedDevice.path,
                connectionGeneration,
                domain: 'config',
              }),
            );
          }
        },
      );
      return allSaved;
    } catch (error) {
      domains.forEach((domain) => {
        dispatch(
          invalidateStateSyncDomain({
            devicePath: connectedDevice.path,
            connectionGeneration,
            domain,
          }),
        );
      });
      if (api.isConnectionGenerationCurrent(connectionGeneration)) {
        const {refreshAllDomains} = await import('./stateSyncThunks');
        await dispatch(refreshAllDomains(connectedDevice));
      }
      throw error;
    }
  };
