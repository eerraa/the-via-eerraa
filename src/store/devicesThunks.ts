// This is conceptually an extension of devicesSlice, but has been separated to remove circular module dependencies between deviceSlice and other slices that import from it

import {
  getDefinitionsFromStore,
  getSupportedIdsFromStore,
  syncStore,
} from '../utils/device-store';
import {getRecognisedDevices, getVendorProductId, isDownloadOnlyFirmwareDevice} from '../utils/hid-keyboards';
import {
  isSupportedVIAProtocolVersion,
  KeyboardAPI,
} from '../utils/keyboard-api';
import type {AppThunk, RootState} from './index';
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
import {loadMacroMetadata, loadMacros} from './macrosSlice';
import {updateV3MenuData} from './menusSlice';
import {
  clearAllDevices,
  getConnectedDevices,
  getSelectedConnectionGeneration,
  getSelectedConnectionNeedsReload,
  getSelectedDevicePath,
  getSelectionGeneration,
  getSupportedIds,
  invalidateDeviceConnection,
  isSelectedDeviceOperationCurrent,
  selectDevice,
  markDeviceReady,
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
import {
  APP_ERROR_TITLES,
  extractDeviceInfo,
  logAppError,
} from './errorsSlice';
import {tryForgetDevice} from 'src/shims/node-hid';
import {isAuthorizedDeviceConnected} from 'src/utils/type-predicates';
import {
  hasUnsupportedKeycodesVersion,
  loadFirmwareVersion,
  loadKeycodesVersion,
} from './firmwareSlice';
import {
  probeStateSyncCapabilityForDevice,
  refreshStateSyncDomain,
  syncPolling,
} from './stateSyncThunks';
import {
  isStateSyncOptIn,
  loadEraAdvancedMetadata,
} from '../utils/era-advanced-metadata';
import {
  clearDefinitionNameOption,
  loadDefinitionName,
} from './definitionNameSlice';
import {KeycodesVersionProtocolError} from 'src/utils/keycodes-version';

const selectConnectedDeviceRetry = createRetry(8, 100);
// A request that has not selected its board yet is stale once a newer request
// starts; selectDevice's generation cannot tell them apart before then.
let latestSelectionRequest = 0;

// A board whose keycodes version was rejected on this connection is never
// selected, so it must not keep the next board from being chosen.
const isSelectableDevice = (state: RootState, device: ConnectedDevice) =>
  device.protocol < 13 ||
  !hasUnsupportedKeycodesVersion(
    state,
    device.path,
    new KeyboardAPI(device.path).getConnectionGeneration(),
  );

export const selectConnectedDeviceByPath =
  (path: string): AppThunk =>
  async (dispatch, getState) => {
    // John you drongo, don't trust the compiler, dispatches are totes awaitable for async thunks
    await dispatch(reloadConnectedDevices());
    const connectedDevice = getConnectedDevices(getState())[path];
    if (connectedDevice) {
      dispatch(selectConnectedDevice(connectedDevice, {picked: true}));
    }
  };

// TODO: should we change these other thunks to use the selected device state instead of params?
// Maybe not? the nice this about this is we don't have to null check the device
export const selectConnectedDevice =
  (
    connectedDevice: ConnectedDevice,
    {picked = false}: {picked?: boolean} = {},
  ): AppThunk =>
  async (dispatch, getState) => {
    const deviceInfo = extractDeviceInfo(connectedDevice);
    const api = new KeyboardAPI(connectedDevice.path);
    const connectionGeneration = api.getConnectionGeneration();
    const selectionRequest = ++latestSelectionRequest;
    let selectionGeneration: number | null = null;
    const isCurrentSelection = () =>
      api.isConnectionGenerationCurrent(connectionGeneration) &&
      (selectionGeneration === null
        ? selectionRequest === latestSelectionRequest
        : isSelectedDeviceOperationCurrent(
            getState(),
            connectedDevice.path,
            connectionGeneration,
            selectionGeneration,
          ));
    try {
      // As in upstream VIA, the keycodes version is read before selection,
      // and a board this app cannot remap is never selected.
      await dispatch(loadKeycodesVersion(connectedDevice, {picked}));
      if (!isCurrentSelection()) return;
      dispatch(selectDevice({device: connectedDevice, connectionGeneration}));
      selectionGeneration = getSelectionGeneration(getState());

      await loadEraAdvancedMetadata();
      if (!isCurrentSelection()) return;
      const requiresCustomMenuVerification =
        getDefinitionSourceForDevice(getState(), connectedDevice) === 'era' &&
        isStateSyncOptIn(connectedDevice.vendorProductId);
      const stateSyncCapable = requiresCustomMenuVerification
        ? await dispatch(probeStateSyncCapabilityForDevice(connectedDevice))
        : false;
      if (!isCurrentSelection()) return;

      if (stateSyncCapable) {
        // The keycode picker only needs the count. Keep the stock full-capacity
        // macro read lazy until the Macro pane is actually opened.
        await dispatch(loadMacroMetadata(connectedDevice));
      } else {
        // Ordinary VIA and unverifiable ERA firmware keep the upstream load
        // transcript unchanged.
        await dispatch(loadMacros(connectedDevice));
      }
      if (!isCurrentSelection()) return;
      // Read before the keymap so the keyboard is first drawn in the board's own
      // layout. State Sync confirms it with the CONFIG read after ready.
      await dispatch(loadLayoutOptions(connectedDevice));
      if (!isCurrentSelection()) return;

      const {protocol} = connectedDevice;
      try {
        if (protocol < 11) {
          // John you drongo, don't trust the compiler, dispatches are totes awaitable for async thunks
          await dispatch(updateLightingData(connectedDevice));
        } else if (protocol >= 11) {
          const advancedCommandsVerified =
            !requiresCustomMenuVerification || stateSyncCapable;
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
        if (isCurrentSelection()) {
          dispatch(
            logAppError({
              message: 'Loading lighting/menu data failed',
              deviceInfo,
              title: APP_ERROR_TITLES.unreadable,
            }),
          );
        }
      }
      if (!isCurrentSelection()) return;

      if (stateSyncCapable) {
        const keymapReady = await dispatch(
          refreshStateSyncDomain(connectedDevice, 'keymap', {
            allowBeforeReady: true,
          }),
        );
        if (!keymapReady) {
          throw new Error('State Sync keymap did not reach a stable snapshot');
        }
      } else {
        // John you drongo, don't trust the compiler, dispatches are totes awaitable for async thunks
        await dispatch(loadKeymapFromDevice(connectedDevice));
      }
      if (!isCurrentSelection()) return;
      dispatch(
        markDeviceReady({
          devicePath: connectedDevice.path,
          connectionGeneration,
          selectionGeneration,
        }),
      );
      if (stateSyncCapable) {
        // CONFIG is much cheaper than the large macro domain and backs all of
        // Lighting/FEATURE/TAPDANCE/SYSTEM. Prefetch it immediately without
        // delaying the first interactive keymap frame.
        void dispatch(refreshStateSyncDomain(connectedDevice, 'config'));
        dispatch(syncPolling());
      }
      selectConnectedDeviceRetry.clear();
    } catch (e) {
      if (
        selectionGeneration === null &&
        selectionRequest === latestSelectionRequest &&
        api.isConnectionLocked()
      ) {
        // Its connection locked while the keycodes version was read, before it
        // was selected. It is selected locked, so it asks for a reconnect like
        // a board that locks after selection.
        const lockedGeneration = api.getConnectionGeneration();
        dispatch(
          selectDevice({
            device: connectedDevice,
            connectionGeneration: lockedGeneration,
          }),
        );
        dispatch(
          invalidateDeviceConnection({
            devicePath: connectedDevice.path,
            connectionGeneration: lockedGeneration,
            locked: true,
          }),
        );
        return;
      }
      if (!isCurrentSelection()) {
        return;
      }
      if (e instanceof KeycodesVersionProtocolError) {
        selectConnectedDeviceRetry.clear();
        // The app scans only once when it opens, so the board after a
        // rejected one is chosen here rather than by a later scan.
        const state = getState();
        const selectedDevicePath = getSelectedDevicePath(state);
        const connectedDevices = getConnectedDevices(state);
        if (!selectedDevicePath || !connectedDevices[selectedDevicePath]) {
          const nextDevice = Object.values(connectedDevices).find((device) =>
            isSelectableDevice(state, device),
          );
          if (nextDevice) {
            dispatch(selectConnectedDevice(nextDevice));
          }
        }
        return;
      }
      if (selectConnectedDeviceRetry.retriesLeft()) {
        dispatch(
          logAppError({
            message: 'Loading device failed - retrying',
            deviceInfo,
            title: APP_ERROR_TITLES.unreadable,
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
            title: APP_ERROR_TITLES.unreadable,
          }),
        );
        console.log('Hard resetting device store:', e);
        dispatch(clearAllDevices());
      }
    }
  };

// This scans for potentially compatible devices, filter out the ones that have the correct protocol
// and then optionally will select the first one if the current selection is non-existent
//
// Only an Authorize device click passes `authorize`: it opens the browser's
// device chooser, and a keyboard without a definition then gets its dialog.
export const reloadConnectedDevices =
  ({authorize = false}: {authorize?: boolean} = {}): AppThunk =>
  async (dispatch, getState) => {
    const state = getState();
    const selectedDevicePath = getSelectedDevicePath(state);
    const selectedConnectionGeneration = getSelectedConnectionGeneration(state);
    const selectedConnectionNeedsReload =
      getSelectedConnectionNeedsReload(state);

    // TODO: should we store in local storage for when offline?
    // Might be worth looking at whole store to work out which bits to store locally
    const supportedIds = getSupportedIds(state);

    const recognisedDevices = await getRecognisedDevices(
      supportedIds,
      authorize,
    );

    const protocolProbes = await Promise.all(
      recognisedDevices.map(async (device) => {
        try {
          return {
            device,
            protocol: await new KeyboardAPI(device.path).getProtocolVersion(),
          } as const;
        } catch (error) {
          // hidCommand owns user-facing logging for genuine transport failures.
          // Lifecycle cancellations are deliberately silent and simply remove
          // the disappeared device from this reload generation.
          return {device, error} as const;
        }
      }),
    );
    const successfulProtocolProbes = protocolProbes.filter(
      (
        probe,
      ): probe is Extract<(typeof protocolProbes)[number], {protocol: number}> =>
        'protocol' in probe,
    );
    const recognisedDevicesWithBadProtocol = successfulProtocolProbes
      .filter(({protocol}) => !isSupportedVIAProtocolVersion(protocol))
      .map(({device}) => device);

    if (recognisedDevicesWithBadProtocol.length) {
      // Should we exit early??
      recognisedDevicesWithBadProtocol.forEach((device: WebVIADevice) => {
        const deviceInfo = extractDeviceInfo(device);
        dispatch(
          logAppError({
            message: 'Received invalid protocol version from device',
            deviceInfo,
            title: APP_ERROR_TITLES.unsupportedFirmware,
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

    const authorizedDevices: AuthorizedDevice[] = successfulProtocolProbes
      .filter(({protocol}) => isSupportedVIAProtocolVersion(protocol))
      .map(({device, protocol}) => {
        const {path, productId, vendorId, productName} = device;
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
      .filter((device) => !isAuthorizedDeviceConnected(device, newDefinitions) &&
        !isDownloadOnlyFirmwareDevice(device))
      .forEach(tryForgetDevice);

    const validDevicesArr = Object.entries(connectedDevices);
    validDevicesArr.forEach(([path, d]) => {
      console.info('Setting connected device:', d.protocol, path, d);
    });
    dispatch(updateConnectedDevices(connectedDevices));

    const selectableDevicesArr = validDevicesArr.filter(([, device]) =>
      isSelectableDevice(getState(), device),
    );
    // A locked keyboard fails its probe until it is unplugged, so it is missing
    // from the list while still plugged in. It stays selected to keep asking
    // for a reconnect; unplugging it clears it. The selection is read here,
    // not when the scan started: a board whose keycodes version read locks is
    // selected locked while this scan waits behind that read.
    const currentSelectedPath = getSelectedDevicePath(getState());
    const selectedDeviceLocked =
      currentSelectedPath !== null &&
      recognisedDevices.some(({path}) => path === currentSelectedPath) &&
      new KeyboardAPI(currentSelectedPath).isConnectionLocked();

    // John you drongo, don't trust the compiler, dispatches are totes awaitable for async thunks
    // If we haven't chosen a selected device yet and there is a valid device, try that
    if (
      (!selectedDevicePath || !connectedDevices[selectedDevicePath]) &&
      selectableDevicesArr.length > 0
    ) {
      const firstConnectedDevice = selectableDevicesArr[0][1];

      dispatch(selectConnectedDevice(firstConnectedDevice));
    } else if (
      selectedDevicePath &&
      connectedDevices[selectedDevicePath] &&
      (selectedConnectionNeedsReload ||
        new KeyboardAPI(selectedDevicePath).getConnectionGeneration() !==
          selectedConnectionGeneration)
    ) {
      dispatch(selectConnectedDevice(connectedDevices[selectedDevicePath]));
    } else if (validDevicesArr.length === 0 && !selectedDeviceLocked) {
      dispatch(selectDevice({device: null, connectionGeneration: null}));
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
