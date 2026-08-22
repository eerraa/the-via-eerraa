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
import {isCustomMenuCommandContent} from 'src/utils/custom-menu';
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
  getSelectedDefinition,
} from './definitionsSlice';
import {collectMaxLedIndex} from '../utils/via-definition-keys';
import {isEraVIADefinitionV3} from '../utils/era-definition';
import {
  getConnectedDevices,
  getSelectedConnectedDevice,
  getSelectedDevicePath,
  getSelectedKeyboardAPI,
} from './devicesSlice';
import type {AppThunk, RootState} from './index';
import {
  getFirmwareVersionMap,
  getSelectedFirmwareVersion,
} from './firmwareSlice';
import {getPathSyncState} from './stateSyncSlice';
import {isStateSyncOptIn} from 'src/utils/era-advanced-metadata';
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

type CustomMenuAvailability = 'available' | 'checking' | 'unverified';

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
  if (
    sync?.capability === 'capable' &&
    sync.config.acceptedRevision !== 0
  ) {
    return 'available';
  }
  return 'checking';
};

const pendingCustomMenuSyncs: Record<string, PendingCustomMenuSync> = {};

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
  },
  extraReducers: (builder) => {
    builder.addCase(commitStableConfigCandidate, (state, action) => {
      const {devicePath, candidate} = action.payload;
      if (candidate.menuData !== undefined) {
        state.customMenuDataMap[devicePath] = candidate.menuData;
      }
    });
  },
});

export const {
  updateShowKeyPainter,
  updateSelectedCustomMenuData,
  updateCustomMenuData,
} = menusSlice.actions;

export default menusSlice.reducer;

export const updateCustomMenuValue =
  (command: string, ...rest: number[]): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const state = getState();
    const connectedDevice = getSelectedConnectedDevice(state);
    if (
      !connectedDevice ||
      getCustomMenuAvailabilityForDevice(state, connectedDevice) !==
        'available'
    ) {
      return;
    }

    const menuData = getSelectedCustomMenuData(state);
    const commands = getCustomCommands(state);
    const commandBytes = commands[command];
    if (!commandBytes) {
      return;
    }
    const previous: CustomMenuData = menuData || {};
    const data = {
      ...previous,
      [command]: [...rest.slice(commandBytes.length)],
    };
    const {path} = connectedDevice;
    dispatch(
      updateSelectedCustomMenuData({
        menuData: data,
        devicePath: path,
      }),
    );

    const api = getSelectedKeyboardAPI(state) as KeyboardAPI;
    const connectionGeneration = api.getConnectionGeneration();
    const invalidateConfig = () => {
      dispatch(
        invalidateStateSyncDomain({
          devicePath: connectedDevice.path,
          connectionGeneration,
          domain: 'config',
        }),
      );
    };
    try {
      await api.setCustomMenuValue(...rest.slice(0));
    } catch (error) {
      console.warn('Setting custom menu value failed', error);
      dispatch(
        updateSelectedCustomMenuData({
          menuData: previous,
          devicePath: path,
        }),
      );
      invalidateConfig();
      return;
    }
    invalidateConfig();
    try {
      const channel = rest[0];
      await api.commitCustomMenu(channel);
    } catch (error) {
      console.warn('Saving custom menu value failed', error);
      invalidateConfig();
    }
  };

export const updateCustomMenuRangeValue =
  (command: string, requestedValue: number): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
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
      return;
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
      return;
    }

    const updatedMenuData = {...menuData};
    updates.forEach(([id, value]) => {
      updatedMenuData[id] = encodeRangeValue(
        value,
        rangeControls[id].options[1],
      );
    });
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
    try {
      for (const [id, value] of updates) {
        const command = encodeRangeCommand(
          rangeControls[id].content,
          value,
          rangeControls[id].options[1],
        );
        const channel = command[0];
        await api.setCustomMenuValue(...command);
        channels.add(channel);
      }
    } catch (error) {
      console.warn('Setting custom menu range value failed', error);
      dispatch(
        updateSelectedCustomMenuData({
          menuData: previousMenuData,
          devicePath: connectedDevice.path,
        }),
      );
      invalidateConfig();
      return;
    }
    invalidateConfig();
    try {
      for (const channel of channels) {
        await api.commitCustomMenu(channel);
      }
    } catch (error) {
      console.warn('Saving custom menu range value failed', error);
      invalidateConfig();
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
): Promise<StateSyncConfigCandidate | null> => {
  const definition = getDefinitionForDevice(state, connectedDevice);
  const api = new KeyboardAPI(connectedDevice.path);
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

  const commandRequests = commands.map(([name, channelId, ...command]) => ({
    command: name,
    promise: api.getCustomMenuValue([channelId].concat(command)),
  }));
  const commandResponses = await Promise.all(
    commandRequests.map(({promise}) => promise),
  );
  const menuData = commandRequests.reduce<CustomMenuData>(
    (result, request, index) => ({
      ...result,
      [request.command]: commandResponses[index].slice(1),
    }),
    {},
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

const getV3MenusForDefinition = (definition: MenuDefinition): V3Menu[] => {
  if (!isEraVIADefinitionV3(definition)) {
    return [];
  }
  return (definition.menus || [])
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
    menus.map(
      (menu: any, idx) => (isVIAMenu(menu) ? makeCustomMenu(menu, idx) : menu),
    ) as ReturnType<typeof makeCustomMenus>,
);

export const getCustomCommands = createSelector(
  getSelectedDefinition,
  getSelectedFirmwareVersion,
  getV3Menus,
  getSelectedCustomMenuAvailability,
  (definition, firmwareVersion, v3Menus, availability) => {
    if (!definition || availability !== 'available') {
      return {};
    }
    if (isVIADefinitionV2(definition)) {
      return getCustomCommandsForDefinition(definition, firmwareVersion);
    }
    return commandsForMenus(v3Menus, firmwareVersion);
  },
);

export const getCustomRangeControls = createSelector(
  getSelectedDefinition,
  getV3Menus,
  getSelectedCustomMenuAvailability,
  (definition, v3Menus, availability) => {
    if (!definition || availability !== 'available') {
      return {};
    }
    const menus = isVIADefinitionV2(definition)
      ? definition.customMenus || []
      : v3Menus;
    return collectRangeControls(menus);
  },
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
