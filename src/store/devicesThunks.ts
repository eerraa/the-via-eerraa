// This is conceptually an extension of devicesSlice, but has been separated to remove circular module dependencies between deviceSlice and other slices that import from it

import {
  getDefinitionsFromStore,
  getSupportedIdsFromStore,
  syncStore,
} from '../utils/device-store';
import {getRecognisedDevices, getVendorProductId} from '../utils/hid-keyboards';
import {KeyboardAPI} from '../utils/keyboard-api';
import type {AppThunk} from './index';
import {
  reloadDefinitions,
  loadLayoutOptions,
  updateDefinitions,
  getDefinitions,
  getDefinitionSourceForDevice,
  loadStoredCustomDefinitions,
} from './definitionsSlice';
import {loadKeymapFromDevice} from './keymapSlice';
import {updateLightingData} from './lightingSlice';
import {loadMacros} from './macrosSlice';
import {updateV3MenuData} from './menusSlice';
import {
  clearAllDevices,
  getConnectedDevices,
  getForceAuthorize,
  getSelectedConnectionGeneration,
  getSelectedConnectionNeedsReload,
  getSelectedDevicePath,
  getSelectionGeneration,
  getSupportedIds,
  isSelectedDeviceOperationCurrent,
  selectDevice,
  markDeviceReady,
  setForceAuthorize,
  updateConnectedDevices,
  updateInvalidProtocolDevices,
  updateUnresolvedDefinitionDevices,
  updateSupportedIds,
} from './devicesSlice';
import type {
  AuthorizedDevice,
  AuthorizedDevices,
  ConnectedDevice,
  ConnectedDevices,
  Device,
  WebVIADevice,
} from 'src/types/types';
import {createRetry} from 'src/utils/retry';
import {extractDeviceInfo, logAppError} from './errorsSlice';
import {tryForgetDevice} from 'src/shims/node-hid';
import {isAuthorizedDeviceConnected} from 'src/utils/type-predicates';
import {loadFirmwareVersion, loadKeycodesVersion} from './firmwareSlice';
import {probeStateSyncForDevice} from './stateSyncThunks';
import {
  isStateSyncOptIn,
  loadEraAdvancedMetadata,
} from '../utils/era-advanced-metadata';
import {
  clearDefinitionNameOption,
  loadDefinitionName,
} from './definitionNameSlice';
import {KeycodesVersionProtocolError} from 'src/utils/keycodes-version';
import {getPathSyncState} from './stateSyncSlice';

const selectConnectedDeviceRetry = createRetry(8, 100);

export const selectConnectedDeviceByPath =
  (path: string): AppThunk =>
  async (dispatch, getState) => {
    // John you drongo, don't trust the compiler, dispatches are totes awaitable for async thunks
    await dispatch(reloadConnectedDevices());
    const connectedDevice = getConnectedDevices(getState())[path];
    if (connectedDevice) {
      dispatch(selectConnectedDevice(connectedDevice));
    }
  };

// TODO: should we change these other thunks to use the selected device state instead of params?
// Maybe not? the nice this about this is we don't have to null check the device
const selectConnectedDevice =
  (connectedDevice: ConnectedDevice): AppThunk =>
  async (dispatch, getState) => {
    const deviceInfo = extractDeviceInfo(connectedDevice);
    const api = new KeyboardAPI(connectedDevice.path);
    const connectionGeneration = api.getConnectionGeneration();
    dispatch(selectDevice({device: connectedDevice, connectionGeneration}));
    const selectionGeneration = getSelectionGeneration(getState());
    const isCurrentSelection = () =>
      api.isConnectionGenerationCurrent(connectionGeneration) &&
      isSelectedDeviceOperationCurrent(
        getState(),
        connectedDevice.path,
        connectionGeneration,
        selectionGeneration,
      );
    try {
      await loadEraAdvancedMetadata();
      if (!isCurrentSelection()) return;
      const requiresCustomMenuVerification =
        getDefinitionSourceForDevice(getState(), connectedDevice) === 'era' &&
        isStateSyncOptIn(connectedDevice.vendorProductId);
      if (requiresCustomMenuVerification) {
        await dispatch(probeStateSyncForDevice(connectedDevice));
        if (!isCurrentSelection()) return;
      }

      await dispatch(loadKeycodesVersion(connectedDevice));
      if (!isCurrentSelection()) return;
      // John you drongo, don't trust the compiler, dispatches are totes awaitable for async thunks
      await dispatch(loadMacros(connectedDevice));
      if (!isCurrentSelection()) return;
      await dispatch(loadLayoutOptions(connectedDevice));
      if (!isCurrentSelection()) return;

      const {protocol} = connectedDevice;
      try {
        if (protocol < 11) {
          // John you drongo, don't trust the compiler, dispatches are totes awaitable for async thunks
          await dispatch(updateLightingData(connectedDevice));
        } else if (protocol >= 11) {
          const advancedCommandsVerified =
            !requiresCustomMenuVerification ||
            getPathSyncState(getState(), connectedDevice.path)?.capability ===
              'capable';
          if (advancedCommandsVerified) {
            await dispatch(loadDefinitionName(connectedDevice));
            if (!isCurrentSelection()) return;
            await dispatch(loadFirmwareVersion(connectedDevice));
            if (!isCurrentSelection()) return;
          } else {
            dispatch(
              clearDefinitionNameOption({devicePath: connectedDevice.path}),
            );
          }
          if (!requiresCustomMenuVerification) {
            // John you drongo, don't trust the compiler, dispatches are totes awaitable for async thunks
            await dispatch(updateV3MenuData(connectedDevice));
          }
        }
      } catch (e) {
        dispatch(
          logAppError({
            message: 'Loading lighting/menu data failed',
            deviceInfo,
          }),
        );
      }
      if (!isCurrentSelection()) return;

      // John you drongo, don't trust the compiler, dispatches are totes awaitable for async thunks
      await dispatch(loadKeymapFromDevice(connectedDevice));
      if (!isCurrentSelection()) return;
      dispatch(
        markDeviceReady({
          devicePath: connectedDevice.path,
          connectionGeneration,
          selectionGeneration,
        }),
      );
      if (requiresCustomMenuVerification) {
        await dispatch(probeStateSyncForDevice(connectedDevice));
      }
      selectConnectedDeviceRetry.clear();
    } catch (e) {
      if (!isCurrentSelection()) {
        return;
      }
      if (e instanceof KeycodesVersionProtocolError) {
        selectConnectedDeviceRetry.clear();
        return;
      }
      if (selectConnectedDeviceRetry.retriesLeft()) {
        dispatch(
          logAppError({
            message: 'Loading device failed - retrying',
            deviceInfo,
          }),
        );
        selectConnectedDeviceRetry.retry(() => {
          dispatch(selectConnectedDevice(connectedDevice));
        });
      } else {
        dispatch(
          logAppError({
            message: 'All retries failed for attempting connection with device',
            deviceInfo,
          }),
        );
        console.log('Hard resetting device store:', e);
        dispatch(clearAllDevices());
      }
    }
  };

// This scans for potentially compatible devices, filter out the ones that have the correct protocol
// and then optionally will select the first one if the current selection is non-existent
export const reloadConnectedDevices =
  (): AppThunk => async (dispatch, getState) => {
    const state = getState();
    const selectedDevicePath = getSelectedDevicePath(state);
    const selectedConnectionGeneration = getSelectedConnectionGeneration(state);
    const selectedConnectionNeedsReload =
      getSelectedConnectionNeedsReload(state);
    const forceRequest = getForceAuthorize(state);

    // TODO: should we store in local storage for when offline?
    // Might be worth looking at whole store to work out which bits to store locally
    const supportedIds = getSupportedIds(state);

    const recognisedDevices = await getRecognisedDevices(
      supportedIds,
      forceRequest,
    );

    const protocolVersions = await Promise.all(
      recognisedDevices.map((device) =>
        new KeyboardAPI(device.path).getProtocolVersion(),
      ),
    );

    const recognisedDevicesWithBadProtocol = recognisedDevices.filter(
      (_, i) => protocolVersions[i] === -1,
    );

    if (recognisedDevicesWithBadProtocol.length) {
      // Should we exit early??
      recognisedDevicesWithBadProtocol.forEach((device: WebVIADevice) => {
        const deviceInfo = extractDeviceInfo(device);
        dispatch(
          logAppError({
            message: 'Received invalid protocol version from device',
            deviceInfo,
          }),
        );
      });
    }
    dispatch(
      updateInvalidProtocolDevices(
        recognisedDevicesWithBadProtocol.reduce<Record<string, Device>>(
          (devices, device) => {
            const {
              path,
              productId,
              vendorId,
              productName,
              interface: intf,
            } = device;
            devices[path] = {
              path,
              productId,
              vendorId,
              productName,
              interface: intf,
            };
            return devices;
          },
          {},
        ),
      ),
    );

    const authorizedDevices: AuthorizedDevice[] = recognisedDevices
      .filter((_, i) => protocolVersions[i] !== -1)
      .map((device, idx) => {
        const {path, productId, vendorId, productName} = device;
        const protocol = protocolVersions[idx];
        return {
          path,
          productId,
          vendorId,
          protocol,
          productName,
          hasResolvedDefinition: false,
          requiredDefinitionVersion: protocol >= 11 ? 'v3' : 'v2',
          vendorProductId: getVendorProductId(
            device.vendorId,
            device.productId,
          ),
        };
      });

    await dispatch(reloadDefinitions(authorizedDevices));

    const newDefinitions = getDefinitions(getState());
    const connectedDevices = authorizedDevices
      .filter((device, i) =>
        isAuthorizedDeviceConnected(device, newDefinitions),
      )
      .reduce<ConnectedDevices>((devices, device, idx) => {
        devices[device.path] = {
          ...device,
          hasResolvedDefinition: true,
        };
        return devices;
      }, {});

    const unresolvedDefinitionDevices = authorizedDevices
      .filter((device) => !isAuthorizedDeviceConnected(device, newDefinitions))
      .reduce<AuthorizedDevices>((devices, device) => {
        devices[device.path] = device;
        return devices;
      }, {});

    dispatch(updateUnresolvedDefinitionDevices(unresolvedDefinitionDevices));

    // Remove authorized devices that we could not find definitions for
    authorizedDevices
      .filter((device) => !isAuthorizedDeviceConnected(device, newDefinitions))
      .forEach(tryForgetDevice);

    const validDevicesArr = Object.entries(connectedDevices);
    validDevicesArr.forEach(([path, d]) => {
      console.info('Setting connected device:', d.protocol, path, d);
    });
    dispatch(updateConnectedDevices(connectedDevices));

    // John you drongo, don't trust the compiler, dispatches are totes awaitable for async thunks
    // If we haven't chosen a selected device yet and there is a valid device, try that
    if (
      (!selectedDevicePath || !connectedDevices[selectedDevicePath]) &&
      validDevicesArr.length > 0
    ) {
      const firstConnectedDevice = validDevicesArr[0][1];

      dispatch(selectConnectedDevice(firstConnectedDevice));
    } else if (
      selectedDevicePath &&
      connectedDevices[selectedDevicePath] &&
      (selectedConnectionNeedsReload ||
        new KeyboardAPI(selectedDevicePath).getConnectionGeneration() !==
          selectedConnectionGeneration)
    ) {
      dispatch(selectConnectedDevice(connectedDevices[selectedDevicePath]));
    } else if (validDevicesArr.length === 0) {
      dispatch(selectDevice({device: null, connectionGeneration: null}));
      dispatch(setForceAuthorize(true));
    }
  };

export const loadSupportedIds = (): AppThunk => async (dispatch) => {
  await loadEraAdvancedMetadata();
  await syncStore();
  dispatch(updateSupportedIds(getSupportedIdsFromStore()));
  // John you drongo, don't trust the compiler, dispatches are totes awaitable for async thunks
  await dispatch(updateDefinitions(getDefinitionsFromStore()));
  dispatch(loadStoredCustomDefinitions());
  dispatch(reloadConnectedDevices());
};
