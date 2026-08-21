import {createSelector, createSlice, PayloadAction} from '@reduxjs/toolkit';
import {
  commonMenus,
  isVIADefinitionV2,
  isVIADefinitionV3,
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
  getSelectedDefinition,
} from './definitionsSlice';
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
import {getSelectedStateSyncCapability, getPathSyncState} from './stateSyncSlice';
import {filterMenuTree} from 'src/utils/era-menu-filter';
import type {StateSyncCapability} from 'src/utils/era-state-sync';

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
});

export const {
  updateShowKeyPainter,
  updateSelectedCustomMenuData,
  updateCustomMenuData,
} = menusSlice.actions;

export default menusSlice.reducer;

export const updateCustomMenuValue =
  (command: string, ...rest: number[]): AppThunk =>
  async (dispatch, getState) => {
    const state = getState();
    const connectedDevice = getSelectedConnectedDevice(state);
    if (!connectedDevice) {
      return;
    }

    const menuData = getSelectedCustomMenuData(state);
    const commands = getCustomCommands(state);
    const data = {
      ...menuData,
      [command]: [...rest.slice(commands[command].length)],
    };
    const {path} = connectedDevice;
    dispatch(
      updateSelectedCustomMenuData({
        menuData: data,
        devicePath: path,
      }),
    );

    const api = getSelectedKeyboardAPI(state) as KeyboardAPI;
    api.setCustomMenuValue(...rest.slice(0));

    const channel = rest[0];
    api.commitCustomMenu(channel);
  };

export const updateCustomMenuRangeValue =
  (command: string, requestedValue: number): AppThunk =>
  async (dispatch, getState) => {
    const state = getState();
    const connectedDevice = getSelectedConnectedDevice(state);
    const api = getSelectedKeyboardAPI(state) as KeyboardAPI | undefined;
    const menuData = getSelectedCustomMenuData(state);
    const rangeControls = getCustomRangeControls(state);
    const control = rangeControls[command];

    if (!connectedDevice || !api || !menuData || !control) {
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
    dispatch(
      updateSelectedCustomMenuData({
        menuData: updatedMenuData,
        devicePath: connectedDevice.path,
      }),
    );

    const channels = new Set<number>();
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
    for (const channel of channels) {
      await api.commitCustomMenu(channel);
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
    if (!definition) {
      return;
    }
    const firmwareVersion = getFirmwareVersionMap(state)[devicePath];
    const capability = getPathSyncState(state, devicePath)?.capability;
    const commands = getCustomCommandsForDefinition(
      definition,
      firmwareVersion,
      capability,
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
    if (!definition) {
      return;
    }
    const commands = getCustomCommandsForDefinition(
      definition,
      getFirmwareVersionMap(state)[devicePath],
      getPathSyncState(state, devicePath)?.capability,
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

export const updateV3MenuData =
  (connectedDevice: ConnectedDevice): AppThunk =>
  async (dispatch, getState) => {
    const state = getState();
    const definition = getDefinitionForDevice(state, connectedDevice);
    const api = new KeyboardAPI(connectedDevice.path);
    const connectionGeneration = api.getConnectionGeneration();

    if (!isVIADefinitionV3(definition)) {
      throw new Error('V3 menus are only compatible with V3 VIA definitions.');
    }
    const firmwareVersion = getFirmwareVersionMap(state)[connectedDevice.path];
    const capability = getPathSyncState(state, connectedDevice.path)?.capability;
    const menus = getV3MenusForDefinition(definition, capability);
    const commands = menus.flatMap((menu) =>
      extractCommands(menu, firmwareVersion),
    );
    const {protocol, path} = connectedDevice;

    if (commands.length !== 0 && protocol >= 11) {
      let props = {} as CustomMenuData;
      const commandPromises = commands.map(([name, channelId, ...command]) => ({
        command: name,
        promise: api.getCustomMenuValue([channelId].concat(command)),
      }));
      const commandPromisesRes = await Promise.all(
        commandPromises.map((c) => c.promise),
      );
      props = commandPromises.reduce(
        ({res, ref}, n, idx) => ({
          ref,
          res: {...res, [n.command]: ref[idx].slice(1)},
        }),
        {res: props, ref: commandPromisesRes},
      ).res;

      // Update to detect instance of color-palette control and an li on a key
      const maxLedIndex = Math.max(
        ...definition.layouts.keys.map((key) => key.li ?? -1),
      );
      console.debug(maxLedIndex, 'maxLedIndex');

      if (maxLedIndex >= 0) {
        // Ask for PerKeyRGBValues -- hardcoded to 62
        const perKeyRGB = await api.getPerKeyRGBMatrix(
          Array(maxLedIndex + 1)
            .fill(0)
            .map((_, i) => i),
        );
        props.__perKeyRGB = perKeyRGB;
      }

      const currentState = getState();
      const currentDevice = getConnectedDevices(currentState)[path];
      if (
        !currentDevice ||
        !api.isConnectionGenerationCurrent(connectionGeneration) ||
        getDefinitionForDevice(currentState, currentDevice) !== definition
      ) {
        return;
      }

      dispatch(
        updateSelectedCustomMenuData({
          devicePath: path,
          menuData: {
            ...props,
            ...(firmwareVersion !== undefined && {
              id_firmware_version: [firmwareVersion],
            }),
          },
        }),
      );
    }
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

const getV3MenusForDefinition = (
  definition: MenuDefinition,
  capability?: StateSyncCapability,
): V3Menu[] => {
  if (!isVIADefinitionV3(definition)) {
    return [];
  }
  return (definition.menus || [])
    .flatMap(tryResolveCommonMenu)
    .map((menu, idx) =>
      isVIAMenu(menu) ? compileMenu('custom_menu', 3, menu, idx) : menu,
    )
    .map((menu) => filterMenuTree(menu, capability));
};

export const getCustomCommandsForDefinition = (
  definition: MenuDefinition,
  firmwareVersion?: number,
  capability?: StateSyncCapability,
): Record<string, number[]> => {
  const menus = isVIADefinitionV2(definition)
    ? filterMenuTree(definition.customMenus, capability)
    : getV3MenusForDefinition(definition, capability);

  if (!menus) {
    return {};
  }
  return menus
    .flatMap((menu: any) => extractCommands(menu, firmwareVersion))
    .reduce(
      (commands: Record<string, number[]>, command: any[]) => ({
        ...commands,
        [command[0]]: command.slice(1),
      }),
      {},
    );
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

export const getV3Menus = createSelector(
  getSelectedDefinition,
  getSelectedStateSyncCapability,
  (definition, capability) =>
    definition ? getV3MenusForDefinition(definition, capability) : [],
);

export const getV3MenuComponents = createSelector(
  getSelectedDefinition,
  getSelectedStateSyncCapability,
  (definition, capability) => {
    if (!definition || !isVIADefinitionV3(definition)) {
      return [];
    }

    return getV3MenusForDefinition(definition, capability).map((menu: any, idx) =>
      isVIAMenu(menu)
        ? makeCustomMenu(menu, idx)
        : menu,
    ) as ReturnType<typeof makeCustomMenus>;
  },
);

export const getCustomCommands = createSelector(
  getSelectedDefinition,
  getSelectedFirmwareVersion,
  getSelectedStateSyncCapability,
  (definition, firmwareVersion, capability) =>
    definition
      ? getCustomCommandsForDefinition(definition, firmwareVersion, capability)
      : {},
);

export const getCustomRangeControls = createSelector(
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
