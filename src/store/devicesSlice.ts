import {createSelector, createSlice, PayloadAction} from '@reduxjs/toolkit';
import type {DefinitionVersion} from '@the-via/reader';
import {KeyboardAPI} from 'src/utils/keyboard-api';
import type {
  AuthorizedDevice,
  AuthorizedDevices,
  ConnectedDevice,
  ConnectedDevices,
  Device,
  VendorProductIdMap,
} from '../types/types';

import type {RootState} from './index';

type DevicesState = {
  selectedDevicePath: string | null;
  selectedConnectionGeneration: number | null;
  selectedConnectionNeedsReload: boolean;
  selectedConnectionLocked: boolean;
  selectionGeneration: number;
  readyDevicePath: string | null;
  connectedDevicePaths: ConnectedDevices;
  unresolvedDefinitionDevicePaths: AuthorizedDevices;
  invalidProtocolDevicePaths: Record<string, Device>;
  supportedIds: VendorProductIdMap;
};

const initialState: DevicesState = {
  selectedDevicePath: null,
  selectedConnectionGeneration: null,
  selectedConnectionNeedsReload: false,
  selectedConnectionLocked: false,
  selectionGeneration: 0,
  readyDevicePath: null,
  connectedDevicePaths: {},
  unresolvedDefinitionDevicePaths: {},
  invalidProtocolDevicePaths: {},
  supportedIds: {},
};

const deviceSlice = createSlice({
  name: 'devices',
  initialState,
  reducers: {
    selectDevice: (
      state,
      action: PayloadAction<{
        device: ConnectedDevice | null;
        connectionGeneration: number | null;
      }>,
    ) => {
      state.readyDevicePath = null;
      state.selectionGeneration += 1;
      state.selectedConnectionGeneration = action.payload.connectionGeneration;
      state.selectedConnectionNeedsReload = false;
      state.selectedConnectionLocked = false;
      if (!action.payload.device) {
        state.selectedDevicePath = null;
      } else {
        state.selectedDevicePath = action.payload.device.path;
      }
    },
    invalidateDeviceConnection: (
      state,
      action: PayloadAction<{
        devicePath: string;
        connectionGeneration: number;
        locked: boolean;
      }>,
    ) => {
      const {devicePath, connectionGeneration, locked} = action.payload;
      if (state.selectedDevicePath === devicePath) {
        state.readyDevicePath = null;
        state.selectedConnectionGeneration = connectionGeneration;
        state.selectedConnectionNeedsReload = true;
        state.selectedConnectionLocked = locked;
        state.selectionGeneration += 1;
      }
    },
    markDeviceReady: (
      state,
      action: PayloadAction<{
        devicePath: string;
        connectionGeneration: number;
        selectionGeneration: number;
      }>,
    ) => {
      const {devicePath, connectionGeneration, selectionGeneration} =
        action.payload;
      if (
        state.selectedDevicePath === devicePath &&
        state.selectedConnectionGeneration === connectionGeneration &&
        state.selectionGeneration === selectionGeneration
      ) {
        state.readyDevicePath = devicePath;
      }
    },
    updateConnectedDevices: (
      state,
      action: PayloadAction<ConnectedDevices>,
    ) => {
      state.connectedDevicePaths = action.payload;
    },
    updateUnresolvedDefinitionDevices: (
      state,
      action: PayloadAction<AuthorizedDevices>,
    ) => {
      state.unresolvedDefinitionDevicePaths = action.payload;
    },
    dismissUnresolvedDefinitionDevice: (
      state,
      action: PayloadAction<AuthorizedDevice>,
    ) => {
      delete state.unresolvedDefinitionDevicePaths[action.payload.path];
    },
    updateInvalidProtocolDevices: (
      state,
      action: PayloadAction<Record<string, Device>>,
    ) => {
      state.invalidProtocolDevicePaths = action.payload;
    },
    dismissInvalidProtocolDevice: (state, action: PayloadAction<Device>) => {
      delete state.invalidProtocolDevicePaths[action.payload.path];
    },
    clearAllDevices: (state) => {
      state.selectedDevicePath = null;
      state.selectedConnectionGeneration = null;
      state.selectedConnectionNeedsReload = false;
      state.selectedConnectionLocked = false;
      state.selectionGeneration += 1;
      state.readyDevicePath = null;
      state.connectedDevicePaths = {};
      state.unresolvedDefinitionDevicePaths = {};
      state.invalidProtocolDevicePaths = {};
    },
    updateSupportedIds: (state, action: PayloadAction<VendorProductIdMap>) => {
      state.supportedIds = action.payload;
    },
    ensureSupportedIds: (
      state,
      action: PayloadAction<{productIds: number[]; version: DefinitionVersion}>,
    ) => {
      const {productIds, version} = action.payload;
      productIds.forEach((productId) => {
        state.supportedIds[productId] = state.supportedIds[productId] ?? {};
        // Side effect
        state.supportedIds[productId][version] = true;
      });
    },
  },
});

export const {
  clearAllDevices,
  selectDevice,
  markDeviceReady,
  invalidateDeviceConnection,
  updateConnectedDevices,
  updateUnresolvedDefinitionDevices,
  dismissUnresolvedDefinitionDevice,
  updateInvalidProtocolDevices,
  dismissInvalidProtocolDevice,
  updateSupportedIds,
  ensureSupportedIds,
} = deviceSlice.actions;

export default deviceSlice.reducer;

export const getConnectedDevices = (state: RootState) =>
  state.devices.connectedDevicePaths;
export const getUnresolvedDefinitionDevices = (state: RootState) =>
  state.devices.unresolvedDefinitionDevicePaths;
export const getUnresolvedDefinitionDeviceWarning = createSelector(
  getUnresolvedDefinitionDevices,
  (devices) => Object.values(devices)[0],
);
export const getInvalidProtocolDevices = (state: RootState) =>
  state.devices.invalidProtocolDevicePaths;
export const getInvalidProtocolDeviceWarning = createSelector(
  getInvalidProtocolDevices,
  (devices) => Object.values(devices)[0],
);
export const getSelectedDevicePath = (state: RootState) =>
  state.devices.selectedDevicePath;
export const getSelectedConnectionGeneration = (state: RootState) =>
  state.devices.selectedConnectionGeneration;
export const getSelectedConnectionNeedsReload = (state: RootState) =>
  state.devices.selectedConnectionNeedsReload;
// A timed-out or failed request locks the connection until the keyboard is
// physically reconnected (ADR 0001); nothing the app sends can unlock it.
export const getSelectedConnectionLocked = (state: RootState) =>
  state.devices.selectedConnectionLocked;
export const getSelectionGeneration = (state: RootState) =>
  state.devices.selectionGeneration;
export const isSelectedDeviceOperationCurrent = (
  state: RootState,
  devicePath: string,
  connectionGeneration: number,
  selectionGeneration: number,
) =>
  state.devices.selectedDevicePath === devicePath &&
  state.devices.selectedConnectionGeneration === connectionGeneration &&
  state.devices.selectionGeneration === selectionGeneration;
export const getIsSelectedDeviceReady = (state: RootState) =>
  state.devices.selectedDevicePath !== null &&
  state.devices.readyDevicePath === state.devices.selectedDevicePath;
export const getSupportedIds = (state: RootState) => state.devices.supportedIds;
export const getSelectedConnectedDevice = createSelector(
  getConnectedDevices,
  getSelectedDevicePath,
  (devices, path) => (path ? devices[path] : null),
);
export const getSelectedKeyboardAPI = createSelector(
  getSelectedDevicePath,
  (path) => path && new KeyboardAPI(path),
);
