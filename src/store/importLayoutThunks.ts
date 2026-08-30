import {KeyboardAPI} from '../utils/keyboard-api';
import type {ConnectedDevice} from '../types/types';
import type {AppThunk} from './index';
import {
  getSelectionGeneration,
  isSelectedDeviceOperationCurrent,
} from './devicesSlice';
import {replaceEncoderMap, saveRawKeymapToDevice} from './keymapSlice';
import {saveMacros} from './macrosSlice';
import {
  invalidateStateSyncDomain,
  type StateSyncEncoderMap,
} from './stateSyncCandidateActions';
import {beginForegroundMutation, type StateSyncDomain} from './stateSyncSlice';

export type FullLayoutImport = {
  keymap: number[][];
  macros?: string[];
  encoders?: StateSyncEncoderMap;
};

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
    const domains: StateSyncDomain[] = ['keymap'];
    if (layout.macros !== undefined) {
      domains.push('macro');
    }
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
              saveMacros(connectedDevice, layout.macros, {
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
            if (
              !reservedApi.isConnectionGenerationCurrent(
                connectionGeneration,
              ) ||
              !isSelectedDeviceOperationCurrent(
                getState(),
                connectedDevice.path,
                connectionGeneration,
                selectionGeneration,
              )
            ) {
              throw new Error(
                'Layout import context changed before completion',
              );
            }
            dispatch(
              replaceEncoderMap({
                devicePath: connectedDevice.path,
                encoders: layout.encoders,
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
