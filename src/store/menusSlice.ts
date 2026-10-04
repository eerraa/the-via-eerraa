import {createSelector, createSlice, PayloadAction} from '@reduxjs/toolkit';
import {
  commonMenus,
  isVIADefinitionV2,
  isVIAMenu,
  DisplayLabel,
  VIAMenu,
} from '@the-via/reader';
import {evalExpr, parseExpr} from '@the-via/pelpi';
import {
  makeCustomMenu,
  makeCustomMenus,
} from 'src/components/panes/configure-panes/custom/menu-generator';
import {KeyboardAPI} from 'src/utils/keyboard-api';
import {MOUSE_PRECISION, hasMousePrecision, mouseExact, readMouseExact} from 'src/utils/era-mousekey';
import {getUISyncCommandIds, type UISyncRequest} from 'src/utils/ui-sync';
import {
  decodeCustomMenuText,
  isCustomMenuCommandContent,
} from 'src/utils/custom-menu';
import {
  collectRangeControls,
  decodeRangeValue,
  encodeRangeCommand,
  encodeRangeValue,
  resolveRangeChange,
} from 'src/utils/range-constraints';
import type {CommonMenusMap, ConnectedDevice} from '../types/types';
import {
  getDefinitionForDevice,
  getDefinitionSourceForDevice,
  getDefinitionSyncIdentity,
  getSelectedDefinition,
} from './definitionsSlice';
import {collectMaxLedIndex} from '../utils/via-definition-keys';
import {
  getTapDanceControlMenu,
  isEraVIADefinitionV3,
} from '../utils/era-definition';
import {
  getConnectedDevices,
  getSelectedConnectionGeneration,
  getSelectedConnectionNeedsReload,
  getSelectedConnectedDevice,
  getSelectedDevicePath,
  getSelectedKeyboardAPI,
  getSelectionGeneration,
  isSelectedDeviceOperationCurrent,
  clearAllDevices,
  updateConnectedDevices,
} from './devicesSlice';
import {discardDrafts, draftKey} from './draftsSlice';
import {
  observationAddress,
  type MenuObservationValue,
} from '../utils/menu-observation';
import {menuObservationScope, refreshMenuObservation} from './menuObservationThunks';
import type {AppThunk, RootState} from './index';
import {
  getFirmwareVersionMap,
  getSelectedFirmwareVersion,
} from './firmwareSlice';
import {
  beginForegroundMutation,
  beginForegroundWriteSession,
  endForegroundWriteSession,
  getPathSyncState,
  isDomainReadFailed,
} from './stateSyncSlice';
import {isStateSyncOptIn} from 'src/utils/era-advanced-metadata';
import {
  completeContinuousHIDTransaction,
  enqueueContinuousHIDUpdate,
  hasContinuousHIDTransaction,
} from 'src/utils/continuous-hid-transaction';
import {
  commitStableConfigCandidate,
  invalidateStateSyncDomain,
  type StateSyncConfigCandidate,
} from './stateSyncCandidateActions';

type CustomMenuData = {
  [commandName: string]: number[] | number[][];
};
type CustomMenuDataMap = {[devicePath: string]: CustomMenuData};

type MenuReadContext = {
  connectionGeneration: number;
  selectionGeneration: number;
  definitionIdentity: string;
};

type MenusState = {
  observations: Record<
    string,
    {scope: string; request: number; value: MenuObservationValue}
  >;
  saveRetries: Record<string, Record<string, boolean>>;
  customMenuDataMap: CustomMenuDataMap;
  readContexts: Record<string, MenuReadContext>;
  commonMenusMap: CommonMenusMap;
  showKeyPainter: boolean;
};

type PendingCustomMenuSync = {
  isSyncing: boolean;
  syncAll: boolean;
  ids: Set<string>;
};

type CustomMenuAvailability =
  | 'available'
  | 'reconciling'
  | 'checking'
  | 'failed'
  | 'unverified';

const isSameCustomMenuValue = (
  current: number[] | number[][] | undefined,
  next: number[] | number[][] | undefined,
): boolean => {
  if (current === next) {
    return true;
  }
  if (!current || !next) {
    return false;
  }
  const currentIsFlat = current.every((value) => typeof value === 'number');
  const nextIsFlat = next.every((value) => typeof value === 'number');
  if (currentIsFlat && nextIsFlat) {
    // Authoritative GETs retain the zero padding from the 32-byte VIA report,
    // while an optimistic SET stores only its semantic payload.
    const length = Math.max(current.length, next.length);
    for (let index = 0; index < length; index++) {
      if ((current[index] ?? 0) !== (next[index] ?? 0)) {
        return false;
      }
    }
    return true;
  }
  if (current.length !== next.length) {
    return false;
  }
  return current.every((value, index) => {
    const nextValue = next[index];
    if (Array.isArray(value)) {
      return Array.isArray(nextValue) && isSameCustomMenuValue(value, nextValue);
    }
    return typeof nextValue === 'number' && value === nextValue;
  });
};

const isSameCustomMenuData = (
  current: CustomMenuData | undefined,
  next: CustomMenuData,
) => {
  if (!current) {
    return false;
  }
  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);
  return (
    currentKeys.length === nextKeys.length &&
    nextKeys.every((key) => isSameCustomMenuValue(current[key], next[key]))
  );
};

const isSameNumberArray = (
  current: number[] | number[][] | undefined,
  next: number[],
) => isSameCustomMenuValue(current, next);

const requiresEraCustomMenuVerification = (
  state: RootState,
  connectedDevice: ConnectedDevice,
) =>
  getDefinitionSourceForDevice(state, connectedDevice) === 'era' &&
  isStateSyncOptIn(connectedDevice.vendorProductId);

export const getCustomMenuAvailabilityForDevice = (
  state: RootState,
  connectedDevice: ConnectedDevice,
): CustomMenuAvailability => {
  if (!requiresEraCustomMenuVerification(state, connectedDevice)) {
    return 'available';
  }
  const sync = getPathSyncState(state, connectedDevice.path);
  if (sync?.capability === 'unverified') {
    return 'unverified';
  }
  const definitionIdentity = getDefinitionSyncIdentity(
    state,
    connectedDevice,
  );
  const isSelectedConnection =
    sync?.capability === 'capable' &&
    sync.generation === getSelectedConnectionGeneration(state) &&
    connectedDevice.path === getSelectedDevicePath(state);
  const hasCurrentSnapshot =
    isSelectedConnection &&
    sync.config.acceptedRevision !== 0 &&
    sync.config.acceptedSelectionGeneration === getSelectionGeneration(state) &&
    definitionIdentity !== null &&
    sync.config.acceptedDefinitionIdentity === definitionIdentity;
  // Waiting would not load a CONFIG read the firmware refused.
  const readFailed =
    isSelectedConnection &&
    isDomainReadFailed(
      sync.config,
      getSelectionGeneration(state),
      definitionIdentity,
    );
  if (!hasCurrentSnapshot) {
    return readFailed ? 'failed' : 'checking';
  }
  if (
    (sync.config.status === 'fresh' &&
      sync.config.acceptedRevision === sync.config.observedRevision) ||
    sync.config.foregroundWriteDepth > 0
  ) {
    return 'available';
  }
  return readFailed ? 'failed' : 'reconciling';
};

const pendingCustomMenuSyncs: Record<string, PendingCustomMenuSync> = {};

const reconcileCapableConfig = async (
  dispatch: (action: any) => any,
  connectedDevice: ConnectedDevice,
  api: KeyboardAPI,
  connectionGeneration: number,
) => {
  if (!api.isConnectionGenerationCurrent(connectionGeneration)) {
    return;
  }
  const {refreshConfigDomain} = await import('./stateSyncThunks');
  await dispatch(refreshConfigDomain(connectedDevice));
};

// How many CONFIG re-reads a write waits through before it gives up. A second
// read covers a keyboard whose settings changed while the first was running.
const RECONCILE_WRITE_ATTEMPTS = 2;

// Legacy menu reads have no revision bracket. Keep GET and its cache commit in
// the same FIFO reservation, and reject a read crossed by a foreground edit.
// Pin the epoch before queueing: a later write publishes its optimistic value
// before its own reservation starts. Requeue only after such an invalidation,
// behind that write; transport failures are not retried here.
const readCurrentMenuValue = async <T>(
  api: KeyboardAPI,
  generation: number,
  getState: () => RootState,
  current: () => boolean,
  read: (reservedApi: KeyboardAPI) => Promise<T>,
  commit: (value: T) => void,
): Promise<T | null> => {
  const epoch = () => getPathSyncState(getState(), api.kbAddr)?.config.mutationEpoch ?? 0;
  while (current()) {
    const started = epoch();
    let invalidated = false;
    const value = await api.withPathReservation(
      generation,
      Symbol('custom-menu-read'),
      async (reservedApi) => {
        if (!current()) return null;
        if (epoch() !== started) {
          invalidated = true;
          return null;
        }
        const result = await read(reservedApi);
        if (!current()) return null;
        if (epoch() !== started) {
          invalidated = true;
          return null;
        }
        commit(result);
        return result;
      },
    );
    if (!invalidated) return value;
  }
  return null;
};

// While CONFIG is being re-read (a returning tab, a change made on the keyboard)
// the menu still shows and takes input. A write asked for then waits for that
// read and goes out after it, rather than being dropped: writing before it would
// act on a snapshot that is no longer current (ADR 0001). False when another
// keyboard was chosen meanwhile; the caller checks availability again either way.
const selectedMenuWriteIsCurrent = (getState: () => RootState) => {
  const state = getState();
  const device = getSelectedConnectedDevice(state);
  if (!device) return () => false;
  const api = new KeyboardAPI(device.path);
  const generation = api.getConnectionGeneration();
  const selectionGeneration = getSelectionGeneration(state);
  const definitionIdentity = getDefinitionSyncIdentity(state, device);
  return () =>
    definitionIdentity !== null &&
    api.isConnectionGenerationCurrent(generation) &&
    isSelectedDeviceOperationCurrent(getState(), device.path, generation, selectionGeneration) &&
    getDefinitionSyncIdentity(getState(), device) === definitionIdentity;
};

const awaitConfigReread = async (
  dispatch: (action: any) => any,
  getState: () => RootState,
): Promise<boolean> => {
  const current = selectedMenuWriteIsCurrent(getState);
  for (let attempt = 0; attempt < RECONCILE_WRITE_ATTEMPTS; attempt++) {
    if (!current()) return false;
    const connectedDevice = getSelectedConnectedDevice(getState());
    if (
      !connectedDevice ||
      getCustomMenuAvailabilityForDevice(getState(), connectedDevice) !==
        'reconciling'
    ) {
      break;
    }
    const {refreshStateSyncDomain} = await import('./stateSyncThunks');
    if (!current()) return false;
    await dispatch(refreshStateSyncDomain(connectedDevice, 'config'));
    if (!current()) {
      return false;
    }
  }
  return current();
};

// A write that may go out now starts in the same tick, so its value shows at
// once; only one waiting on a re-read is deferred.
const awaitCustomMenuWriteAuthority = (
  dispatch: (action: any) => any,
  getState: () => RootState,
): boolean | Promise<boolean> =>
  getSelectedCustomMenuAvailability(getState()) === 'reconciling'
    ? awaitConfigReread(dispatch, getState)
    : true;

const beginConfigWriteSession = (
  dispatch: (action: any) => any,
  path: string,
  generation: number,
) => {
  dispatch(
    beginForegroundWriteSession({
      path,
      generation,
      domains: ['config'],
    }),
  );
};

const endConfigWriteSession = (
  dispatch: (action: any) => any,
  path: string,
  generation: number,
) => {
  dispatch(
    endForegroundWriteSession({
      path,
      generation,
      domains: ['config'],
    }),
  );
};

const getPendingCustomMenuSyncKey = (
  devicePath: string,
  connectionGeneration: number,
) => `${devicePath}:${connectionGeneration}`;

const initialState: MenusState = {
  observations: {},
  saveRetries: {},
  customMenuDataMap: {},
  readContexts: {},
  commonMenusMap: {},
  showKeyPainter: false,
};

const menusSlice = createSlice({
  name: 'menus',
  initialState,
  reducers: {
    setMenuObservation: (
      state,
      action: PayloadAction<{
        command: string;
        scope: string;
        request: number;
        value: MenuObservationValue;
      }>,
    ) => {
      const {command, ...observation} = action.payload;
      state.observations[command] = observation;
    },
    setMenuSaveRetry: (
      state,
      action: PayloadAction<{devicePath: string; command: string; retry: boolean}>,
    ) => {
      const {devicePath, command, retry} = action.payload;
      if (retry) (state.saveRetries[devicePath] ??= {})[command] = true;
      else delete state.saveRetries[devicePath]?.[command];
    },
    updateShowKeyPainter: (state, action: PayloadAction<boolean>) => {
      state.showKeyPainter = action.payload;
    },
    updateSelectedCustomMenuData: (
      state,
      action: PayloadAction<{
        menuData: CustomMenuData;
        devicePath: string;
        readContext?: MenuReadContext;
      }>,
    ) => {
      const {devicePath, menuData, readContext} = action.payload;
      state.customMenuDataMap[devicePath] = menuData;
      if (readContext) state.readContexts[devicePath] = readContext;
    },
    updateCommonMenus: (
      state,
      action: PayloadAction<{commonMenuMap: CommonMenusMap}>,
    ) => {
      const {commonMenuMap} = action.payload;
      state.commonMenusMap = commonMenuMap;
    },
    updateCustomMenuData: (state, action: PayloadAction<CustomMenuDataMap>) => {
      state.customMenuDataMap = {...state.customMenuDataMap, ...action.payload};
    },
    rollbackCustomMenuData: (
      state,
      action: PayloadAction<{
        devicePath: string;
        expected: CustomMenuData;
        previous: CustomMenuData;
      }>,
    ) => {
      const {devicePath, expected, previous} = action.payload;
      const current = state.customMenuDataMap[devicePath];
      if (!current) {
        return;
      }
      Object.entries(expected).forEach(([command, expectedValue]) => {
        if (!isSameCustomMenuValue(current[command], expectedValue)) {
          return;
        }
        const previousValue = previous[command];
        if (previousValue === undefined) {
          delete current[command];
        } else {
          current[command] = previousValue;
        }
      });
    },
  },
  extraReducers: (builder) => {
    builder.addCase(discardDrafts, (state, {payload: {devicePath, keys}}) => {
      for (const command of Object.keys(state.saveRetries[devicePath] ?? {})) {
        if (keys.includes(draftKey('menu', command))) {
          delete state.saveRetries[devicePath][command];
        }
      }
    });
    builder.addCase(updateConnectedDevices, (state, action) => {
      for (const path of Object.keys(state.saveRetries)) {
        if (!action.payload[path]) delete state.saveRetries[path];
      }
      for (const path of Object.keys(state.readContexts)) {
        if (!action.payload[path]) delete state.readContexts[path];
      }
    });
    builder.addCase(clearAllDevices, (state) => {
      state.saveRetries = {};
      state.observations = {};
      state.readContexts = {};
    });
    builder.addCase(commitStableConfigCandidate, (state, action) => {
      const {devicePath, candidate} = action.payload;
      if (candidate.menuData !== undefined) {
        const {connectionGeneration, selectionGeneration, definitionIdentity} = action.payload;
        state.readContexts[devicePath] = {
          connectionGeneration, selectionGeneration, definitionIdentity,
        };
      }
      if (
        candidate.menuData !== undefined &&
        !isSameCustomMenuData(
          state.customMenuDataMap[devicePath],
          candidate.menuData,
        )
      ) {
        state.customMenuDataMap[devicePath] = candidate.menuData;
      }
    });
  },
});

export const {
  setMenuObservation,
  setMenuSaveRetry,
  updateShowKeyPainter,
  updateSelectedCustomMenuData,
  updateCustomMenuData,
  rollbackCustomMenuData,
} = menusSlice.actions;

export default menusSlice.reducer;

export const updateCustomMenuValue =
  (command: string, ...rest: number[]): AppThunk<Promise<boolean>> =>
  async (dispatch, getState) => {
    const requestIsCurrent = selectedMenuWriteIsCurrent(getState);
    const authority = awaitCustomMenuWriteAuthority(dispatch, getState);
    if (authority !== true && !(await authority)) {
      return false;
    }
    if (!requestIsCurrent()) return false;
    const state = getState();
    const connectedDevice = getSelectedConnectedDevice(state);
    if (
      !connectedDevice ||
      getCustomMenuAvailabilityForDevice(state, connectedDevice) !==
        'available'
    ) {
      return false;
    }

    const menuData = getSelectedCustomMenuData(state);
    const commands = getCustomCommands(state);
    const commandBytes = commands[command];
    if (!commandBytes) {
      return false;
    }
    const previous: CustomMenuData = menuData || {};
    const nextValue = [...rest.slice(commandBytes.length)];
    if (mouseExact(command) && getDefinitionSourceForDevice(state, connectedDevice) === 'era') {
      if (!hasMousePrecision(menuData || undefined) || rest[0] !== commandBytes[0] || rest[1] !== mouseExact(command).id || nextValue.length !== 2) return false;
      try { readMouseExact(command, [...nextValue, 0xe4]); } catch { return false; }
    }
    const data = {
      ...previous,
      [command]: nextValue,
    };
    const {path} = connectedDevice;
    const readContext = state.menus.readContexts[path];
    const api = getSelectedKeyboardAPI(state) as KeyboardAPI;
    const connectionGeneration = api.getConnectionGeneration();
    const definitionIdentity = getDefinitionSyncIdentity(state, connectedDevice);
    const currentWrite = () =>
      api.isConnectionGenerationCurrent(connectionGeneration) &&
      getConnectedDevices(getState())[path] !== undefined &&
      getDefinitionSyncIdentity(getState(), connectedDevice) === definitionIdentity;
    beginConfigWriteSession(dispatch, path, connectionGeneration);
    dispatch(
      beginForegroundMutation({
        path,
        generation: connectionGeneration,
        domains: ['config'],
      }),
    );
    dispatch(
      updateSelectedCustomMenuData({
        menuData: data,
        devicePath: path,
      }),
    );

    const invalidateConfig = () => {
      dispatch(
        invalidateStateSyncDomain({
          devicePath: connectedDevice.path,
          connectionGeneration,
          domain: 'config',
        }),
      );
    };
    let setCompleted = false;
    try {
      const owner = Symbol(`custom-menu:${command}`);
      await api.withPathReservation(
        connectionGeneration,
        owner,
        async (reservedApi) => {
          if (!requestIsCurrent()) throw new Error('Custom menu write context changed before SET');
          await reservedApi.setCustomMenuValue(...rest.slice(0));
          setCompleted = true;
          // A timeout can retire the transport generation before catch runs.
          // Record the persistence obligation while SET is acknowledged; only
          // SAVE acknowledgement or an explicit draft discard can clear it.
          if (getConnectedDevices(getState())[path]) {
            dispatch(setMenuSaveRetry({devicePath: path, command, retry: true}));
          }
          await reservedApi.commitCustomMenu(rest[0]);
        },
      );
      if (currentWrite()) {
        dispatch(setMenuSaveRetry({devicePath: path, command, retry: false}));
      }
      return true;
    } catch (error) {
      console.warn(
        setCompleted
          ? 'Saving custom menu value failed'
          : 'Setting custom menu value failed',
        error,
      );
      // A failed send may already have retired the transport. Roll back only
      // this write's optimistic patch, unless a newer full read has accepted it.
      if (!setCompleted &&
          getDefinitionSyncIdentity(getState(), connectedDevice) === definitionIdentity &&
          getState().menus.readContexts[path] === readContext &&
          getState().menus.customMenuDataMap[path]?.[command] === nextValue) {
        dispatch(
          rollbackCustomMenuData({
            devicePath: path,
            expected: {[command]: nextValue},
            previous,
          }),
        );
      }
      // SET alone does not confirm persistence. If automatic SAVE fails, report
      // the operation as unsuccessful; GET below still shows the running value.
      return false;
    } finally {
      invalidateConfig();
      try {
        await reconcileCapableConfig(
          dispatch,
          connectedDevice,
          api,
          connectionGeneration,
        );
      } finally {
        endConfigWriteSession(dispatch, path, connectionGeneration);
      }
    }
  };

export const updateCustomMenuRangeValue =
  (command: string, requestedValue: number): AppThunk<Promise<boolean>> =>
  async (dispatch, getState) => {
    const requestIsCurrent = selectedMenuWriteIsCurrent(getState);
    const authority = awaitCustomMenuWriteAuthority(dispatch, getState);
    if (authority !== true && !(await authority)) {
      return false;
    }
    if (!requestIsCurrent()) return false;
    const state = getState();
    const connectedDevice = getSelectedConnectedDevice(state);
    const api = getSelectedKeyboardAPI(state) as KeyboardAPI | undefined;
    const menuData = getSelectedCustomMenuData(state);
    const rangeControls = getCustomRangeControls(state);
    const control = rangeControls[command];

    if (
      !connectedDevice ||
      getCustomMenuAvailabilityForDevice(state, connectedDevice) !==
        'available' ||
      !api ||
      !menuData ||
      !control
    ) {
      return false;
    }
    const connectionGeneration = api.getConnectionGeneration();
    const definitionIdentity = getDefinitionSyncIdentity(state, connectedDevice);
    const readContext = state.menus.readContexts[connectedDevice.path];

    const logicalValues = Object.entries(rangeControls).reduce<
      Record<string, number>
    >((values, [id, range]) => {
      const rawValue = menuData[id];
      if (Array.isArray(rawValue) && typeof rawValue[0] === 'number') {
        values[id] = decodeRangeValue(rawValue as number[], range.options[1]);
      }
      return values;
    }, {});
    const resolvedValues = resolveRangeChange(
      command,
      requestedValue,
      rangeControls,
      logicalValues,
    );
    const updates = Object.entries(resolvedValues).filter(
      ([id, value]) =>
        (logicalValues[id] !== value ||
          (id === command && state.menus.saveRetries[connectedDevice.path]?.[id])) &&
        rangeControls[id],
    );

    if (!updates.length) {
      return true;
    }

    beginConfigWriteSession(
      dispatch,
      connectedDevice.path,
      connectionGeneration,
    );
    dispatch(
      beginForegroundMutation({
        path: connectedDevice.path,
        generation: connectionGeneration,
        domains: ['config'],
      }),
    );

    const updatedMenuData = {...menuData};
    updates.forEach(([id, value]) => {
      updatedMenuData[id] = encodeRangeValue(
        value,
        rangeControls[id].options[1],
      );
    });
    const expectedMenuData = updates.reduce<CustomMenuData>(
      (expected, [id]) => {
        expected[id] = updatedMenuData[id];
        return expected;
      },
      {},
    );
    const previousMenuData = menuData;
    dispatch(
      updateSelectedCustomMenuData({
        menuData: updatedMenuData,
        devicePath: connectedDevice.path,
      }),
    );

    const invalidateConfig = () => {
      dispatch(
        invalidateStateSyncDomain({
          devicePath: connectedDevice.path,
          connectionGeneration,
          domain: 'config',
        }),
      );
    };
    const channels = new Set<number>();
    const accepted = new Set<string>();
    let setsCompleted = false;
    try {
      const owner = Symbol(`custom-range:${command}`);
      await api.withPathReservation(
        connectionGeneration,
        owner,
        async (reservedApi) => {
          if (!requestIsCurrent()) throw new Error('Custom range write context changed before SET');
          for (const [id, value] of updates) {
            const encodedCommand = encodeRangeCommand(
              rangeControls[id].content,
              value,
              rangeControls[id].options[1],
            );
            const channel = encodedCommand[0];
            await reservedApi.setCustomMenuValue(...encodedCommand);
            accepted.add(id);
            if (getConnectedDevices(getState())[connectedDevice.path]) {
              dispatch(setMenuSaveRetry({
                devicePath: connectedDevice.path, command: id, retry: true,
              }));
            }
            channels.add(channel);
          }
          setsCompleted = true;
          for (const channel of channels) {
            await reservedApi.commitCustomMenu(channel);
            for (const id of accepted) {
              if (rangeControls[id].content[1] === channel) {
                dispatch(setMenuSaveRetry({
                  devicePath: connectedDevice.path, command: id, retry: false,
                }));
              }
            }
          }
        },
      );
      return true;
    } catch (error) {
      console.warn(
        setsCompleted
          ? 'Saving custom menu range value failed'
          : 'Setting custom menu range value failed',
        error,
      );
      if (!setsCompleted &&
          getDefinitionSyncIdentity(getState(), connectedDevice) === definitionIdentity &&
          getState().menus.readContexts[connectedDevice.path] === readContext) {
        dispatch(
          rollbackCustomMenuData({
            devicePath: connectedDevice.path,
            expected: Object.fromEntries(
              Object.entries(expectedMenuData).filter(([id, value]) =>
                !accepted.has(id) &&
                getState().menus.customMenuDataMap[connectedDevice.path]?.[id] === value,
              ),
            ),
            previous: previousMenuData,
          }),
        );
      }
      return false;
    } finally {
      invalidateConfig();
      try {
        await reconcileCapableConfig(
          dispatch,
          connectedDevice,
          api,
          connectionGeneration,
        );
      } finally {
        endConfigWriteSession(
          dispatch,
          connectedDevice.path,
          connectionGeneration,
        );
      }
    }
  };

// How Apply watches a held value take effect. The split link pair has five seconds
// to agree on a new speed, and a speed the cable cannot hold falls back 200 ms after
// the switch, so the new name has to stay past that to count.
const LABEL_WATCH = {intervalMs: 250, holdMs: 500, timeoutMs: 6000};
let labelWatch = LABEL_WATCH;

export const setLabelWatchForTesting = (timing: typeof LABEL_WATCH | null) => {
  labelWatch = timing ?? LABEL_WATCH;
};

// Reads one Custom Value of the selected keyboard into its menu data. A reading is
// merged as it arrives, so a CONFIG read that finished meanwhile keeps the rest. It
// gives null when the keyboard did not answer or is no longer the one selected.
const customMenuValueReader = (state: RootState, command: string) => {
  const scope = menuObservationScope(state);
  const devicePath = getSelectedDevicePath(state);
  const api = getSelectedKeyboardAPI(state) as KeyboardAPI | undefined;
  const commandBytes = getCustomCommandsForSelectedDefinition(state)[command];
  if (!devicePath || !api || !commandBytes) {
    return null;
  }
  const connectionGeneration = api.getConnectionGeneration();
  return async (
    dispatch: (action: any) => any,
    getState: () => RootState,
  ): Promise<number[] | null> => {
    const current = () =>
      menuObservationScope(getState()) === scope &&
      api.isConnectionGenerationCurrent(connectionGeneration);
    try {
      return await readCurrentMenuValue(
        api,
        connectionGeneration,
        getState,
        current,
        async (reservedApi) => (await reservedApi.getCustomMenuValue(commandBytes)).slice(1),
        (value) => {
          const menuData = getSelectedCustomMenuData(getState());
          if (menuData && !isSameCustomMenuValue(menuData[command], value)) {
            dispatch(updateSelectedCustomMenuData({
              devicePath,
              menuData: {...menuData, [command]: value},
            }));
          }
        },
      );
    } catch {
      return null;
    }
  };
};

/** Reads a value the keyboard changes without a CONFIG revision, such as a label. */
export const refreshCustomMenuValue =
  (command: string): AppThunk<Promise<number[] | null>> =>
  async (dispatch, getState) => {
    return await customMenuValueReader(getState(), command)?.(dispatch, getState) ?? null;
  };

/**
 * Reads label values until every one reads `text` and keeps reading it, or the watch
 * runs out. Each changed reading goes into the menu data, so the menu shows the last
 * one.
 */
export const awaitCustomMenuLabels =
  (
    commands: string[], text: string, resultCommand?: string,
  ): AppThunk<Promise<boolean>> =>
  async (dispatch, getState) => {
    const scope = menuObservationScope(getState());
    const reads = commands.flatMap((command) => {
      const read = customMenuValueReader(getState(), command);
      return read ? [read] : [];
    });
    if (reads.length === 0 || reads.length < commands.length) {
      return false;
    }
    const {intervalMs, holdMs, timeoutMs} = labelWatch;
    const start = Date.now();
    let readingSince: number | null = null;
    while (Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      if (menuObservationScope(getState()) !== scope) return false;
      let reading = true;
      if (resultCommand) {
        const result = await dispatch(refreshMenuObservation(resultCommand));
        if (!result) return false;
        if (result.status === 'ready') {
          if (/^(Busy|Failed|Cancelled)/.test(result.text)) return false;
          reading =
            result.text === `Applied ${text}` || result.text === 'Already set';
        } else if (result.status !== 'unsupported') return false;
      }
      for (const read of reads) {
        const value = await read(dispatch, getState);
        if (!value) {
          return false;
        }
        reading = reading && decodeCustomMenuText(value) === text;
      }
      if (!reading) {
        readingSince = null;
      } else if (readingSince === null) {
        readingSince = Date.now();
      } else if (Date.now() - readingSince >= holdMs) {
        return true;
      }
    }
    return false;
  };

const continuousMenuKey = (kind: 'range' | 'color', command: string) =>
  `custom-menu:${kind}:${command}`;

const continuousConfig = (
  key: string,
  dispatch: (action: any) => any,
  connectedDevice: ConnectedDevice,
  api: KeyboardAPI,
  connectionGeneration: number,
) => ({
  key,
  path: connectedDevice.path,
  generation: connectionGeneration,
  onStarted: () => {
    beginConfigWriteSession(
      dispatch,
      connectedDevice.path,
      connectionGeneration,
    );
    dispatch(
      beginForegroundMutation({
        path: connectedDevice.path,
        generation: connectionGeneration,
        domains: ['config'],
      }),
    );
  },
  save: (reservedApi: KeyboardAPI, channel: string) =>
    reservedApi.commitCustomMenu(Number(channel)),
  onSettled: async () => {
    dispatch(
      invalidateStateSyncDomain({
        devicePath: connectedDevice.path,
        connectionGeneration,
        domain: 'config',
      }),
    );
    try {
      await reconcileCapableConfig(
        dispatch,
        connectedDevice,
        api,
        connectionGeneration,
      );
    } finally {
      endConfigWriteSession(
        dispatch,
        connectedDevice.path,
        connectionGeneration,
      );
    }
  },
  onInterrupted: () => {
    dispatch(
      invalidateStateSyncDomain({
        devicePath: connectedDevice.path,
        connectionGeneration,
        domain: 'config',
      }),
    );
  },
});

export const updateCustomMenuValueContinuous =
  (command: string, ...rest: number[]): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const state = getState();
    const connectedDevice = getSelectedConnectedDevice(state);
    const api = getSelectedKeyboardAPI(state) as KeyboardAPI | undefined;
    if (!connectedDevice || !api) {
      return;
    }
    const connectionGeneration = api.getConnectionGeneration();
    const key = continuousMenuKey('color', command);
    const active = hasContinuousHIDTransaction(
      key,
      connectedDevice.path,
      connectionGeneration,
    );
    if (
      !active &&
      getCustomMenuAvailabilityForDevice(state, connectedDevice) !== 'available'
    ) {
      return;
    }
    const commands = getCustomCommandsForSelectedDefinition(state);
    const commandBytes = commands[command];
    if (!commandBytes) {
      return;
    }
    const menuData = getSelectedCustomMenuData(state) || {};
    const nextValue = rest.slice(commandBytes.length);
    if (isSameNumberArray(menuData[command], nextValue)) {
      return;
    }
    try {
      const update = enqueueContinuousHIDUpdate(
        continuousConfig(
          key,
          dispatch,
          connectedDevice,
          api,
          connectionGeneration,
        ),
        {
          dedupeKey: rest.join(','),
          execute: async (reservedApi) => {
            await reservedApi.setCustomMenuValue(...rest);
            return [String(rest[0])];
          },
        },
      );
      dispatch(
        updateSelectedCustomMenuData({
          devicePath: connectedDevice.path,
          menuData: {
            ...menuData,
            [command]: [...nextValue],
          },
        }),
      );
      await update;
    } catch (error) {
      console.warn('Continuous custom menu SET failed', error);
    }
  };

export const completeCustomMenuValueContinuous =
  (command: string): AppThunk<Promise<void>> =>
  async () => {
    try {
      await completeContinuousHIDTransaction(
        continuousMenuKey('color', command),
      );
    } catch (error) {
      console.warn('Continuous custom menu SAVE failed', error);
    }
  };

export const updateCustomMenuRangeValueContinuous =
  (command: string, requestedValue: number): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const state = getState();
    const connectedDevice = getSelectedConnectedDevice(state);
    const api = getSelectedKeyboardAPI(state) as KeyboardAPI | undefined;
    const menuData = getSelectedCustomMenuData(state);
    const rangeControls = getCustomRangeControlsForSelectedDefinition(state);
    const control = rangeControls[command];
    if (!connectedDevice || !api || !menuData || !control) {
      return;
    }
    const connectionGeneration = api.getConnectionGeneration();
    const key = continuousMenuKey('range', command);
    const active = hasContinuousHIDTransaction(
      key,
      connectedDevice.path,
      connectionGeneration,
    );
    if (
      !active &&
      getCustomMenuAvailabilityForDevice(state, connectedDevice) !== 'available'
    ) {
      return;
    }
    const logicalValues = Object.entries(rangeControls).reduce<
      Record<string, number>
    >((values, [id, range]) => {
      const rawValue = menuData[id];
      if (Array.isArray(rawValue) && typeof rawValue[0] === 'number') {
        values[id] = decodeRangeValue(rawValue as number[], range.options[1]);
      }
      return values;
    }, {});
    const resolvedValues = resolveRangeChange(
      command,
      requestedValue,
      rangeControls,
      logicalValues,
    );
    const updates = Object.entries(resolvedValues).filter(
      ([id, value]) => logicalValues[id] !== value && rangeControls[id],
    );
    if (!updates.length) {
      return;
    }
    const updatedMenuData = {...menuData};
    updates.forEach(([id, value]) => {
      updatedMenuData[id] = encodeRangeValue(
        value,
        rangeControls[id].options[1],
      );
    });
    const encodedUpdates = updates.map(([id, value]) => ({
      id,
      command: encodeRangeCommand(
        rangeControls[id].content,
        value,
        rangeControls[id].options[1],
      ),
    }));
    try {
      const update = enqueueContinuousHIDUpdate(
        continuousConfig(
          key,
          dispatch,
          connectedDevice,
          api,
          connectionGeneration,
        ),
        {
          dedupeKey: encodedUpdates
            .map(({id, command: bytes}) => `${id}:${bytes.join(',')}`)
            .join('|'),
          execute: async (reservedApi) => {
            const channels = new Set<string>();
            for (const {command: bytes} of encodedUpdates) {
              await reservedApi.setCustomMenuValue(...bytes);
              channels.add(String(bytes[0]));
            }
            return channels;
          },
        },
      );
      dispatch(
        updateSelectedCustomMenuData({
          devicePath: connectedDevice.path,
          menuData: updatedMenuData,
        }),
      );
      await update;
    } catch (error) {
      console.warn('Continuous custom range SET failed', error);
    }
  };

export const completeCustomMenuRangeValueContinuous =
  (command: string): AppThunk<Promise<void>> =>
  async () => {
    try {
      await completeContinuousHIDTransaction(
        continuousMenuKey('range', command),
      );
    } catch (error) {
      console.warn('Continuous custom range SAVE failed', error);
    }
  };

const readCustomMenuValues = async (
  api: KeyboardAPI,
  commands: Record<string, number[]>,
  ids?: string[],
  separateObservations = false,
): Promise<CustomMenuData> => {
  const idsToSync = (ids ?? Object.keys(commands)).filter(
    (id) => commands[id] && !(separateObservations && observationAddress(id)),
  );
  const mouseFields = separateObservations ? idsToSync.filter((id) => mouseExact(id)) : [];
  const mouseProbe = separateObservations && commands[MOUSE_PRECISION] &&
    (mouseFields.length > 0 || idsToSync.includes(MOUSE_PRECISION));
  const advanced = idsToSync.filter((id) => /^id_qmk_tapdance_[1-8]_hold_(term|other)$/.test(id));
  const modeOf = (id: string) => id.replace(/hold_(term|other)$/, 'mode');
  const baseIds = [...new Set([
    ...idsToSync.filter((id) => !advanced.includes(id) && !mouseFields.includes(id) && !(mouseProbe && id === MOUSE_PRECISION)),
    ...advanced.map(modeOf).filter((id) => commands[id]),
  ])];
  // A State Sync candidate holds the path reservation. Reserved calls run
  // directly, without the outer FIFO; await each reply before sending another.
  const data: CustomMenuData = {};
  if (mouseProbe) {
    const probe = (await api.getOptionalCustomMenuValue(commands[MOUSE_PRECISION]))?.slice(1);
    // Old H7S answered unknown ids with zero. Only that legacy shape or an
    // explicit unhandled reply means absent; transport errors remain errors.
    if (probe && !probe.every((v) => v === 0) && !hasMousePrecision({[MOUSE_PRECISION]: probe})) {
      throw new Error('Invalid MOUSE precision capability');
    }
    data[MOUSE_PRECISION] = probe ?? [0, 0];
    for (const id of mouseFields) {
      if (!hasMousePrecision(data)) { data[id] = [0, 0, 0]; continue; }
      const value = (await api.getCustomMenuValue(commands[id])).slice(1);
      readMouseExact(id, value);
      data[id] = value;
    }
  }
  for (const id of baseIds) {
    // Old firmware can reject the newly added mode probe. Only this optional
    // capability query may be absent; existing actions/settings stay required.
    const response = /^id_qmk_tapdance_[1-8]_mode$/.test(id)
      ? await api.getOptionalCustomMenuValue(commands[id])
      : await api.getCustomMenuValue(commands[id]);
    data[id] = response?.slice(1) ?? [0, 0, 0];
  }
  for (const id of advanced) {
    const mode = data[modeOf(id)];
    if (mode?.[1] !== 0xd2 || ![0, 1, 2].includes(mode[0] as number) || mode[2] !== 0xd3) {
      data[id] = [0, 0, 0];
      continue;
    }
    const value = (await api.getCustomMenuValue(commands[id])).slice(1);
    const valid = id.endsWith('_hold_term')
      ? value[2] === 0xd3
      : value[1] === 0xd3 && [0, 1].includes(value[0] as number);
    // Once advertised, these values are required. Do not accept a CONFIG
    // snapshot that would silently drop independent timing from a backup.
    if (!valid) {
      throw new Error(`Invalid Tap Dance timing response: ${id}`);
    }
    data[id] = value;
  }
  return data;
};

export const syncCustomMenuValues =
  (
    devicePath: string,
    connectionGeneration: number,
    ids?: string[],
  ): AppThunk =>
  async (dispatch, getState) => {
    const state = getState();
    const connectedDevice = getConnectedDevices(state)[devicePath];

    if (!connectedDevice) {
      return;
    }
    const api = new KeyboardAPI(devicePath);
    if (!api.isConnectionGenerationCurrent(connectionGeneration)) {
      return;
    }
    const definition = getDefinitionForDevice(state, connectedDevice);
    if (
      !definition ||
      getCustomMenuAvailabilityForDevice(state, connectedDevice) !==
        'available'
    ) {
      return;
    }
    const firmwareVersion = getFirmwareVersionMap(state)[devicePath];
    const commands = getCustomCommandsForDefinition(
      definition,
      firmwareVersion,
    );
    const current = () => {
      const next = getState();
      const device = getConnectedDevices(next)[devicePath];
      return !!device && api.isConnectionGenerationCurrent(connectionGeneration) &&
        getDefinitionForDevice(next, device) === definition;
    };
    await readCurrentMenuValue(
      api,
      connectionGeneration,
      getState,
      current,
      (reservedApi) => readCustomMenuValues(
        reservedApi, commands, ids,
        getDefinitionSourceForDevice(state, connectedDevice) === 'era',
      ),
      (syncedMenuData) => dispatch(updateSelectedCustomMenuData({
        devicePath,
        menuData: {...getState().menus.customMenuDataMap[devicePath], ...syncedMenuData},
      })),
    );
  };

const enqueueCustomMenuSync = (
  devicePath: string,
  connectionGeneration: number,
  ids?: string[],
) => {
  const key = getPendingCustomMenuSyncKey(devicePath, connectionGeneration);
  const pending = (pendingCustomMenuSyncs[key] = pendingCustomMenuSyncs[
    key
  ] || {
    isSyncing: false,
    syncAll: false,
    ids: new Set<string>(),
  });

  if (ids === undefined) {
    pending.syncAll = true;
    pending.ids.clear();
  } else if (!pending.syncAll) {
    ids.forEach((id) => pending.ids.add(id));
  }

  return pending;
};

const runPendingCustomMenuSyncs =
  (devicePath: string, connectionGeneration: number): AppThunk =>
  async (dispatch) => {
    const key = getPendingCustomMenuSyncKey(devicePath, connectionGeneration);
    const pending = pendingCustomMenuSyncs[key];
    if (!pending || pending.isSyncing) {
      return;
    }

    pending.isSyncing = true;
    try {
      while (pending.syncAll || pending.ids.size) {
        const ids = pending.syncAll ? undefined : Array.from(pending.ids);
        pending.syncAll = false;
        pending.ids.clear();

        await dispatch(
          syncCustomMenuValues(devicePath, connectionGeneration, ids),
        );

        const api = new KeyboardAPI(devicePath);
        if (!api.isConnectionGenerationCurrent(connectionGeneration)) {
          pending.syncAll = false;
          pending.ids.clear();
          break;
        }
      }
    } finally {
      pending.isSyncing = false;
      if (!pending.syncAll && !pending.ids.size) {
        delete pendingCustomMenuSyncs[key];
      }
    }
  };

export const syncCustomMenuValuesFromRequest =
  ({
    devicePath,
    connectionGeneration,
    request,
  }: {
    devicePath: string;
    connectionGeneration: number;
    request: UISyncRequest;
  }): AppThunk =>
  async (dispatch, getState) => {
    const state = getState();
    const connectedDevice = getConnectedDevices(state)[devicePath];
    if (!connectedDevice) {
      return;
    }
    const api = new KeyboardAPI(devicePath);
    if (!api.isConnectionGenerationCurrent(connectionGeneration)) {
      return;
    }
    const definition = getDefinitionForDevice(state, connectedDevice);
    if (
      !definition ||
      getCustomMenuAvailabilityForDevice(state, connectedDevice) !==
        'available'
    ) {
      return;
    }
    const commands = getCustomCommandsForDefinition(
      definition,
      getFirmwareVersionMap(state)[devicePath],
    );
    const ids = getUISyncCommandIds(request, commands);
    if (ids === undefined || ids.length) {
      enqueueCustomMenuSync(devicePath, connectionGeneration, ids);
      await dispatch(
        runPendingCustomMenuSyncs(devicePath, connectionGeneration),
      );
    }
  };

// COMMON MENU IDENTIFIER RESOLVES INTO ACTUAL MODULE
type V3Menu = VIAMenu<DisplayLabel>;

const tryResolveCommonMenu = (id: V3Menu | string): V3Menu | V3Menu[] => {
  // Only convert to menu object if it is found in common menus, else return
  if (typeof id === 'string') {
    return commonMenus[id as keyof typeof commonMenus];
  }
  return id;
};

export const readV3MenuStateSyncCandidate = async (
  connectedDevice: ConnectedDevice,
  state: RootState,
  connectionGeneration: number,
  reservedApi?: KeyboardAPI,
): Promise<StateSyncConfigCandidate | null> => {
  const definition = getDefinitionForDevice(state, connectedDevice);
  const api = reservedApi ?? new KeyboardAPI(connectedDevice.path);
  if (!isEraVIADefinitionV3(definition)) {
    throw new Error('V3 menus are only compatible with V3 VIA definitions.');
  }
  if (!api.isConnectionGenerationCurrent(connectionGeneration)) {
    return null;
  }

  if (
    requiresEraCustomMenuVerification(state, connectedDevice) &&
    getPathSyncState(state, connectedDevice.path)?.capability !== 'capable'
  ) {
    return null;
  }

  const firmwareVersion = getFirmwareVersionMap(state)[connectedDevice.path];
  const menus = getV3MenusForDefinition(definition);
  const commands = menus.flatMap((menu) =>
    extractCommands(menu, firmwareVersion),
  );
  if (commands.length === 0 || connectedDevice.protocol < 11) {
    return {};
  }

  const menuData = await readCustomMenuValues(
    api, Object.fromEntries(commands.map(([name, ...bytes]) => [name, bytes])),
    undefined,
    getDefinitionSourceForDevice(state, connectedDevice) === 'era',
  );

  const maxLedIndex = collectMaxLedIndex(definition);
  if (maxLedIndex >= 0) {
    menuData.__perKeyRGB = await api.getPerKeyRGBMatrix(
      Array(maxLedIndex + 1)
        .fill(0)
        .map((_, index) => index),
    );
  }
  if (!api.isConnectionGenerationCurrent(connectionGeneration)) {
    return null;
  }
  return {
    menuData: {
      ...menuData,
      ...(firmwareVersion !== undefined && {
        id_firmware_version: [firmwareVersion],
      }),
    },
  };
};

export const updateV3MenuData =
  (connectedDevice: ConnectedDevice): AppThunk =>
  async (dispatch, getState) => {
    const state = getState();
    const definition = getDefinitionForDevice(state, connectedDevice);
    const definitionIdentity = getDefinitionSyncIdentity(state, connectedDevice);
    const selectionGeneration = getSelectionGeneration(state);
    if (requiresEraCustomMenuVerification(state, connectedDevice)) {
      return;
    }
    const api = new KeyboardAPI(connectedDevice.path);
    const connectionGeneration = api.getConnectionGeneration();
    const current = () => {
      const next = getState();
      const device = getConnectedDevices(next)[connectedDevice.path];
      return !!device && api.isConnectionGenerationCurrent(connectionGeneration) &&
        getDefinitionForDevice(next, device) === definition &&
        getSelectionGeneration(next) === selectionGeneration;
    };
    await readCurrentMenuValue(
      api,
      connectionGeneration,
      getState,
      current,
      (reservedApi) => readV3MenuStateSyncCandidate(
        connectedDevice, state, connectionGeneration, reservedApi,
      ),
      (candidate) => {
        if (candidate?.menuData !== undefined && definitionIdentity !== null) {
          dispatch(updateSelectedCustomMenuData({
            devicePath: connectedDevice.path,
            menuData: candidate.menuData,
            readContext: {connectionGeneration, selectionGeneration, definitionIdentity},
          }));
        }
      },
    );
  };

// Returns true if the showIf expression references only id_firmware_version
const isFirmwareOnlyExpr = (showIf: string): boolean => {
  try {
    const {state} = parseExpr(showIf);
    const keys = Object.keys(state);
    return (
      keys.length > 0 && keys.every((key) => key === 'id_firmware_version')
    );
  } catch {
    return false;
  }
};

// TODO: properly type the input and add proper type guards
const extractCommands = (
  menuOrControls: any,
  firmwareVersion?: number,
): any[] => {
  if (typeof menuOrControls === 'string') {
    return [];
  }
  // Prune firmware-gated branches early when firmware version is known
  if (
    firmwareVersion !== undefined &&
    'showIf' in menuOrControls &&
    typeof menuOrControls.showIf === 'string' &&
    isFirmwareOnlyExpr(menuOrControls.showIf) &&
    !evalExpr(menuOrControls.showIf, {id_firmware_version: [firmwareVersion]})
  ) {
    return [];
  }
  return 'type' in menuOrControls
    ? isCustomMenuCommandContent(menuOrControls.content)
      ? [menuOrControls.content]
      : []
    : 'content' in menuOrControls && typeof menuOrControls.content !== 'string'
      ? menuOrControls.content.flatMap((item: any) =>
          extractCommands(item, firmwareVersion),
        )
      : [];
};

type MenuDefinition = NonNullable<ReturnType<typeof getDefinitionForDevice>>;

// Marks the Tap Dance menu rebuilt from TD keycodes. Its commands are real Custom
// Values, but the settings are edited from KEYMAP, so Configure does not list it.
const COMMANDS_ONLY_MENU = '_eraCommandsOnly';

const getV3MenusForDefinition = (definition: MenuDefinition): V3Menu[] => {
  if (!isEraVIADefinitionV3(definition)) {
    return [];
  }
  // Tap Dance settings live on the TD keycodes in custom JSON. Adding them back as
  // a menu keeps every Custom Value path (fetch, write, State Sync reread, range
  // limits) identical to when they were a TAPDANCE menu page.
  const tapDanceMenu = getTapDanceControlMenu(definition);
  return [
    ...(definition.menus || []),
    ...(tapDanceMenu
      ? [{...tapDanceMenu, [COMMANDS_ONLY_MENU]: true} as unknown as V3Menu]
      : []),
  ]
    .flatMap(tryResolveCommonMenu)
    .map((menu, idx) =>
      isVIAMenu(menu) ? compileMenu('custom_menu', 3, menu, idx) : menu,
    );
};

const commandsForMenus = (menus: any[], firmwareVersion?: number) =>
  menus
    .flatMap((menu: any) => extractCommands(menu, firmwareVersion))
    .reduce((commands: Record<string, number[]>, command: any[]) => {
      commands[command[0]] = command.slice(1);
      return commands;
    }, {});

export const getCustomCommandsForDefinition = (
  definition: MenuDefinition,
  firmwareVersion?: number,
): Record<string, number[]> => {
  const menus = isVIADefinitionV2(definition)
    ? definition.customMenus
    : getV3MenusForDefinition(definition);

  if (!menus) {
    return {};
  }
  return commandsForMenus(menus, firmwareVersion);
};

export const getCommonMenusDataMap = (state: RootState) =>
  state.menus.commonMenusMap;

export const getShowKeyPainter = (state: RootState) =>
  state.menus.showKeyPainter;

export const getCustomMenuDataMap = (state: RootState) =>
  state.menus.customMenuDataMap;

export const getSelectedCustomMenuData = createSelector(
  getCustomMenuDataMap,
  getSelectedDevicePath,
  (map, path) => path && map[path],
);

// Consumers outside Configure's loading boundary (notably firmware guidance)
// may use only a full read from this selection, connection and definition.
// Same-context background reconciliation keeps that proof and the display.
export const getSelectedCurrentCustomMenuData = (state: RootState) => {
  const device = getSelectedConnectedDevice(state);
  if (!device || getSelectedConnectionNeedsReload(state)) return null;
  const context = state.menus.readContexts?.[device.path];
  return context &&
    context.connectionGeneration === getSelectedConnectionGeneration(state) &&
    context.selectionGeneration === getSelectionGeneration(state) &&
    context.definitionIdentity === getDefinitionSyncIdentity(state, device)
    ? state.menus.customMenuDataMap[device.path]
    : null;
};

export const getSelectedCustomMenuAvailability = (state: RootState) => {
  const connectedDevice = getSelectedConnectedDevice(state);
  return connectedDevice
    ? getCustomMenuAvailabilityForDevice(state, connectedDevice)
    : 'available';
};

export const getV3Menus = createSelector(
  getSelectedDefinition,
  (definition) => (definition ? getV3MenusForDefinition(definition) : []),
);

export const getV3MenuComponents = createSelector(
  getV3Menus,
  (menus) =>
    menus.flatMap((menu: any, idx) =>
      menu[COMMANDS_ONLY_MENU]
        ? []
        : [isVIAMenu(menu) ? makeCustomMenu(menu, idx) : menu],
    ) as ReturnType<typeof makeCustomMenus>,
);

const getCustomCommandsForSelectedDefinition = createSelector(
  getSelectedDefinition,
  getSelectedFirmwareVersion,
  getV3Menus,
  (definition, firmwareVersion, v3Menus) => {
    if (!definition) {
      return {};
    }
    if (isVIADefinitionV2(definition)) {
      return getCustomCommandsForDefinition(definition, firmwareVersion);
    }
    return commandsForMenus(v3Menus, firmwareVersion);
  },
);

export const getCustomRangeControlsForSelectedDefinition = createSelector(
  getSelectedDefinition,
  getV3Menus,
  (definition, v3Menus) => {
    if (!definition) {
      return {};
    }
    const menus = isVIADefinitionV2(definition)
      ? definition.customMenus || []
      : v3Menus;
    return collectRangeControls(menus);
  },
);

export const getCustomCommands = createSelector(
  getCustomCommandsForSelectedDefinition,
  getSelectedCustomMenuAvailability,
  (commands, availability) => (availability === 'available' ? commands : {}),
);

export const getCustomRangeControls = createSelector(
  getCustomRangeControlsForSelectedDefinition,
  getSelectedCustomMenuAvailability,
  (controls, availability) => (availability === 'available' ? controls : {}),
);

const compileMenu = (partial: string, depth = 0, val: any, idx: number) => {
  return depth === 0
    ? val
    : {
        ...val,
        _id: `${partial}_${idx}`,
        content:
          val.label !== undefined
            ? typeof val.content === 'string'
              ? val.content
              : val.content.map((contentVal: any, contentIdx: number) =>
                  compileMenu(
                    `${partial}_${contentIdx}`,
                    depth - 1,
                    contentVal,
                    idx,
                  ),
                )
            : val.content.map((contentVal: any, contentIdx: number) =>
                compileMenu(`${partial}_${contentIdx}`, depth, contentVal, idx),
              ),
      };
};
