import {createSelector, createSlice, PayloadAction} from '@reduxjs/toolkit';
import type {RootState, AppThunk} from './index';
import {getSelectedDevicePath} from './devicesSlice';
import {KeyboardAPI} from 'src/utils/keyboard-api';
import {KeyboardValue} from 'src/utils/keyboard-values';
import {
  formatKeycodesVersion,
  KeycodesVersionProtocolError,
  MAXIMUM_SUPPORTED_KEYCODES_VERSION,
  MINIMUM_SUPPORTED_KEYCODES_VERSION,
  readKeycodesVersion,
  UnsupportedKeycodesVersionError,
} from 'src/utils/keycodes-version';
import type {ConnectedDevice} from '../types/types';
import {extractDeviceInfo, logKeyboardAPIError} from './errorsSlice';

type FirmwareVersionMap = {[devicePath: string]: number};
type KeycodesVersionMap = {[devicePath: string]: number};
type ConnectionGenerationMap = {[devicePath: string]: number};

type FirmwareState = {
  firmwareVersionMap: FirmwareVersionMap;
  keycodesVersionMap: KeycodesVersionMap;
  unsupportedKeycodesVersionMap: ConnectionGenerationMap;
};

const initialState: FirmwareState = {
  firmwareVersionMap: {},
  keycodesVersionMap: {},
  unsupportedKeycodesVersionMap: {},
};

export const firmwareSlice = createSlice({
  name: 'firmware',
  initialState,
  reducers: {
    updateFirmwareVersion: (
      state,
      action: PayloadAction<{devicePath: string; version: number}>,
    ) => {
      const {devicePath, version} = action.payload;
      state.firmwareVersionMap[devicePath] = version;
    },
    updateKeycodesVersion: (
      state,
      action: PayloadAction<{devicePath: string; version: number}>,
    ) => {
      const {devicePath, version} = action.payload;
      state.keycodesVersionMap[devicePath] = version;
    },
    markKeycodesVersionUnsupported: (
      state,
      action: PayloadAction<{devicePath: string; connectionGeneration: number}>,
    ) => {
      const {devicePath, connectionGeneration} = action.payload;
      state.unsupportedKeycodesVersionMap[devicePath] = connectionGeneration;
    },
  },
});

export const {
  updateFirmwareVersion,
  updateKeycodesVersion,
  markKeycodesVersionUnsupported,
} = firmwareSlice.actions;

export default firmwareSlice.reducer;

// Selectors
export const getFirmwareVersionMap = (state: RootState) =>
  (state.firmware as FirmwareState).firmwareVersionMap;
export const getKeycodesVersionMap = (state: RootState) =>
  (state.firmware as FirmwareState).keycodesVersionMap;
export const hasUnsupportedKeycodesVersion = (
  state: RootState,
  devicePath: string,
  connectionGeneration: number,
) =>
  (state.firmware as FirmwareState).unsupportedKeycodesVersionMap[
    devicePath
  ] === connectionGeneration;

export const getSelectedFirmwareVersion = createSelector(
  getFirmwareVersionMap,
  getSelectedDevicePath,
  (map, path) => (path ? map[path] : undefined),
);

export const getSelectedKeycodesVersion = createSelector(
  getKeycodesVersionMap,
  getSelectedDevicePath,
  (map, path) => (path ? map[path] : undefined),
);

export const loadKeycodesVersion =
  (
    connectedDevice: ConnectedDevice,
    {picked = false}: {picked?: boolean} = {},
  ): AppThunk =>
  async (dispatch, getState) => {
    if (connectedDevice.protocol < 13) {
      return;
    }

    const api = new KeyboardAPI(connectedDevice.path);
    const connectionGeneration = api.getConnectionGeneration();
    let version: number;
    try {
      version = await readKeycodesVersion(api);
    } catch (error) {
      // Such a board is never selected. It is reported once per connection,
      // and again each time it is picked from the keyboard list.
      if (
        error instanceof KeycodesVersionProtocolError &&
        api.isConnectionGenerationCurrent(connectionGeneration) &&
        (picked ||
          !hasUnsupportedKeycodesVersion(
            getState(),
            connectedDevice.path,
            connectionGeneration,
          ))
      ) {
        dispatch(
          markKeycodesVersionUnsupported({
            devicePath: connectedDevice.path,
            connectionGeneration,
          }),
        );
        const details =
          error instanceof UnsupportedKeycodesVersionError
            ? `Device reports unsupported QMK keycode version ${formatKeycodesVersion(error.version)}. This version of VIA supports ${formatKeycodesVersion(MINIMUM_SUPPORTED_KEYCODES_VERSION)} through ${formatKeycodesVersion(MAXIMUM_SUPPORTED_KEYCODES_VERSION)}. Update VIA before assigning keycodes.`
            : `Device reports VIA protocol ${connectedDevice.protocol}, but ${error.message.toLowerCase()}. Firmware may contain incompatible VIA and QMK revisions.`;
        dispatch(
          logKeyboardAPIError({
            commandName: 'GET_KEYBOARD_VALUE / KEYCODES_VERSION',
            commandBytes: [0x02, KeyboardValue.KEYCODES_VERSION],
            responseBytes: [
              0x02,
              KeyboardValue.KEYCODES_VERSION,
              ...error.responseBytes,
            ],
            deviceInfo: extractDeviceInfo(connectedDevice),
            details,
            title: 'Unsupported keyboard firmware version',
          }),
        );
      }
      throw error;
    }
    if (api.isConnectionGenerationCurrent(connectionGeneration)) {
      dispatch(
        updateKeycodesVersion({devicePath: connectedDevice.path, version}),
      );
    }
  };

// Thunk to load firmware version from device
export const loadFirmwareVersion =
  (connectedDevice: ConnectedDevice): AppThunk =>
  async (dispatch) => {
    const {path} = connectedDevice;
    const api = new KeyboardAPI(path);
    const connectionGeneration = api.getConnectionGeneration();

    try {
      const result = await api.getKeyboardValue(
        KeyboardValue.FIRMWARE_VERSION,
        [],
        4, // Read 4 bytes for 32-bit value
      );

      // Parse 32-bit value from 4 bytes (big-endian)
      const version =
        (result[0] << 24) | (result[1] << 16) | (result[2] << 8) | result[3];

      if (api.isConnectionGenerationCurrent(connectionGeneration)) {
        dispatch(updateFirmwareVersion({devicePath: path, version}));
      }
    } catch (e) {
      console.error('Failed to load firmware version:', e);
    }
  };
