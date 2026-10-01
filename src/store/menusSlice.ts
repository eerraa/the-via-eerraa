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
  getSelectedConnectedDevice,
  getSelectedDevicePath,
  getSelectedKeyboardAPI,
  getSelectionGeneration,
} from './devicesSlice';
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

type MenusState = {
  customMenuDataMap: CustomMenuDataMap;
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

// While CONFIG is being re-read (a returning tab, a change made on the keyboard)
// the menu still shows and takes input. A write asked for then waits for that
// read and goes out after it, rather than being dropped: writing before it would
// act on a snapshot that is no longer current (ADR 0001). False when another
// keyboard was chosen meanwhile; the caller checks availability again either way.
const awaitConfigReread = async (
  dispatch: (action: any) => any,
  getState: () => RootState,
): Promise<boolean> => {
  const selectionGeneration = getSelectionGeneration(getState());
  for (let attempt = 0; attempt < RECONCILE_WRITE_ATTEMPTS; attempt++) {
    const connectedDevice = getSelectedConnectedDevice(getState());
    if (
      !connectedDevice ||
      getCustomMenuAvailabilityForDevice(getState(), connectedDevice) !==
        'reconciling'
    ) {
      break;
    }
    const {refreshStateSyncDomain} = await import('./stateSyncThunks');
    await dispatch(refreshStateSyncDomain(connectedDevice, 'config'));
    if (getSelectionGeneration(getState()) !== selectionGeneration) {
      return false;
    }
  }
  return true;
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
  customMenuDataMap: {},
  commonMenusMap: {},
  showKeyPainter: false,
};

const menusSlice = createSlice({
  name: 'menus',
  initialState,
  reducers: {
    updateShowKeyPainter: (state, action: PayloadAction<boolean>) => {
      state.showKeyPainter = action.payload;
    },
    updateSelectedCustomMenuData: (
      state,
      action: PayloadAction<{menuData: CustomMenuData; devicePath: string}>,
    ) => {
      const {devicePath, menuData} = action.payload;
      state.customMenuDataMap[devicePath] = menuData;
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
    builder.addCase(commitStableConfigCandidate, (state, action) => {
      const {devicePath, candidate} = action.payload;
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
  updateShowKeyPainter,
  updateSelectedCustomMenuData,
  updateCustomMenuData,
  rollbackCustomMenuData,
} = menusSlice.actions;

export default menusSlice.reducer;

export const updateCustomMenuValue =
  (command: string, ...rest: number[]): AppThunk<Promise<boolean>> =>
  async (dispatch, getState) => {
    const authority = awaitCustomMenuWriteAuthority(dispatch, getState);
    if (authority !== true && !(await authority)) {
      return false;
    }
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
    const data = {
      ...previous,
      [command]: nextValue,
    };
    const {path} = connectedDevice;
    const api = getSelectedKeyboardAPI(state) as KeyboardAPI;
    const connectionGeneration = api.getConnectionGeneration();
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
          await reservedApi.setCustomMenuValue(...rest.slice(0));
          setCompleted = true;
          await reservedApi.commitCustomMenu(rest[0]);
        },
      );
      return true;
    } catch (error) {
      console.warn(
        setCompleted
          ? 'Saving custom menu value failed'
          : 'Setting custom menu value failed',
        error,
      );
      if (!setCompleted) {
        dispatch(
          rollbackCustomMenuData({
            devicePath: path,
            expected: {[command]: nextValue},
            previous,
          }),
        );
      }
      // A value the keyboard took but did not save is lost on its next power
      // cycle, so the write did not succeed. The re-read below still shows what
      // the keyboard holds now.
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
    const authority = awaitCustomMenuWriteAuthority(dispatch, getState);
    if (authority !== true && !(await authority)) {
      return false;
    }
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
    let setsCompleted = false;
    try {
      const owner = Symbol(`custom-range:${command}`);
      await api.withPathReservation(
        connectionGeneration,
        owner,
        async (reservedApi) => {
          for (const [id, value] of updates) {
            const encodedCommand = encodeRangeCommand(
              rangeControls[id].content,
              value,
              rangeControls[id].options[1],
            );
            const channel = encodedCommand[0];
            await reservedApi.setCustomMenuValue(...encodedCommand);
            channels.add(channel);
          }
          setsCompleted = true;
          for (const channel of channels) {
            await reservedApi.commitCustomMenu(channel);
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
      if (!setsCompleted) {
        dispatch(
          rollbackCustomMenuData({
            devicePath: connectedDevice.path,
            expected: expectedMenuData,
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
    let value: number[];
    try {
      value = (await api.getCustomMenuValue(commandBytes)).slice(1);
    } catch {
      return null;
    }
    const current = getState();
    const menuData = getSelectedCustomMenuData(current);
    if (
      !menuData ||
      getSelectedDevicePath(current) !== devicePath ||
      !api.isConnectionGenerationCurrent(connectionGeneration)
    ) {
      return null;
    }
    if (!isSameCustomMenuValue(menuData[command], value)) {
      dispatch(
        updateSelectedCustomMenuData({
          devicePath,
          menuData: {...menuData, [command]: value},
        }),
      );
    }
    return value;
  };
};

/** Reads a value the keyboard changes without a CONFIG revision, such as a label. */
export const refreshCustomMenuValue =
  (command: string): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    await customMenuValueReader(getState(), command)?.(dispatch, getState);
  };

/**
 * Reads label values until every one reads `text` and keeps reading it, or the watch
 * runs out. Each changed reading goes into the menu data, so the menu shows the last
 * one.
 */
export const awaitCustomMenuLabels =
  (commands: string[], text: string): AppThunk<Promise<boolean>> =>
  async (dispatch, getState) => {
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
      let reading = true;
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
): Promise<CustomMenuData> => {
  const idsToSync = (ids ?? Object.keys(commands)).filter((id) => commands[id]);
  const commandPromises = idsToSync.map((id) => ({
    id,
    promise: api.getCustomMenuValue(commands[id]),
  }));
  const results = await Promise.all(
    commandPromises.map(({promise}) => promise),
  );

  return commandPromises.reduce<CustomMenuData>(
    (res, {id}, idx) => ({
      ...res,
      [id]: results[idx].slice(1),
    }),
    {},
  );
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
    const menuData = state.menus.customMenuDataMap[devicePath] || {};

    await api.waitForCommandQueueIdle();
    const syncedMenuData = await readCustomMenuValues(api, commands, ids);
    const currentState = getState();
    const currentDevice = getConnectedDevices(currentState)[devicePath];
    if (
      !currentDevice ||
      !api.isConnectionGenerationCurrent(connectionGeneration) ||
      getDefinitionForDevice(currentState, currentDevice) !== definition
    ) {
      return;
    }
    dispatch(
      updateSelectedCustomMenuData({
        devicePath,
        menuData: {
          ...menuData,
          ...syncedMenuData,
        },
      }),
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

  const menuData: CustomMenuData = {};
  for (const [name, channelId, ...command] of commands) {
    const response = await api.getCustomMenuValue(
      [channelId].concat(command),
    );
    menuData[name] = response.slice(1);
  }

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
    if (requiresEraCustomMenuVerification(state, connectedDevice)) {
      return;
    }
    const api = new KeyboardAPI(connectedDevice.path);
    const connectionGeneration = api.getConnectionGeneration();
    const candidate = await readV3MenuStateSyncCandidate(
      connectedDevice,
      state,
      connectionGeneration,
    );
    const currentState = getState();
    const currentDevice =
      getConnectedDevices(currentState)[connectedDevice.path];
    if (
      candidate?.menuData === undefined ||
      !currentDevice ||
      !api.isConnectionGenerationCurrent(connectionGeneration) ||
      getDefinitionForDevice(currentState, currentDevice) !== definition
    ) {
      return;
    }
    dispatch(
      updateSelectedCustomMenuData({
        devicePath: connectedDevice.path,
        menuData: candidate.menuData,
      }),
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
