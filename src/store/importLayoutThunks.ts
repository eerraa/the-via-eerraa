import {KeyboardAPI, shiftFrom16Bit} from '../utils/keyboard-api';
import type {TapDanceWrite} from '../utils/keycode-palette';
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
  updateSelectedCustomMenuData,
} from './menusSlice';
import {
  invalidateStateSyncDomain,
  type StateSyncEncoderMap,
} from './stateSyncCandidateActions';
import {beginForegroundMutation, type StateSyncDomain} from './stateSyncSlice';

export type FullLayoutImport = {
  keymap: number[][];
  /** Every macro slot: they replace the keyboard's macros without reading them. */
  macros?: string[];
  encoders?: StateSyncEncoderMap;
  /** Custom Values a layout file carries (Tap Dance), saved once per channel. */
  customValues?: TapDanceWrite[];
};

/**
 * Writes a whole layout as one transaction: one path reservation, one foreground
 * mutation over every domain it touches, and one reconciliation if any part fails.
 */
export const importLayoutToDevice =
  (
    connectedDevice: ConnectedDevice,
    layout: FullLayoutImport,
  ): AppThunk<Promise<void>> =>
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
    const domains: StateSyncDomain[] = ['keymap'];
    if (layout.macros !== undefined) {
      domains.push('macro');
    }
    if (customValues.length > 0) {
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
            for (const {channel, id, value} of customValues) {
              await reservedApi.setCustomMenuValue(
                channel,
                id,
                ...shiftFrom16Bit(value),
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
                    customValues.map(({name, value}) => [
                      name,
                      shiftFrom16Bit(value),
                    ]),
                  ),
                },
              }),
            );
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
