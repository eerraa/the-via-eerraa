import {createSelector, createSlice, PayloadAction} from '@reduxjs/toolkit';
import type {
  ConnectedDevice,
  DeviceLayerMap,
  Keymap,
  Layer,
} from '../types/types';
import type {AppThunk, RootState} from './index';
import {
  getDefinitionForDevice,
  getSelectedDefinition,
  getSelectedKeyDefinitions,
} from './definitionsSlice';
import {collectUniqueEncoderIds} from '../utils/via-definition-keys';
import {
  getSelectedConnectionGeneration,
  getSelectedConnectedDevice,
  getSelectedDevicePath,
  getSelectedKeyboardAPI,
  getSelectionGeneration,
  isSelectedDeviceOperationCurrent,
  selectDevice,
} from './devicesSlice';
import {KeyboardAPI} from 'src/utils/keyboard-api';
import {
  commitStableKeymapCandidate,
  invalidateStateSyncDomain,
  type StateSyncEncoderMap,
  type StateSyncKeymapCandidate,
} from './stateSyncCandidateActions';
import {beginForegroundMutation} from './stateSyncSlice';

type KeymapState = {
  rawDeviceMap: DeviceLayerMap;
  encoderDeviceMap: Record<string, StateSyncEncoderMap>;
  numberOfLayersMap: Record<string, number>;
  loadGenerationMap: Record<string, number>;
  selectedLayerIndex: number;
  selectedKey: number | null;
  configureKeyboardIsSelectable: boolean;
  selectedPaletteColor: [number, number];
};

const initialState: KeymapState = {
  rawDeviceMap: {},
  encoderDeviceMap: {},
  numberOfLayersMap: {},
  loadGenerationMap: {},
  selectedLayerIndex: 0,
  selectedKey: null,
  configureKeyboardIsSelectable: false,
  selectedPaletteColor: [0, 0],
};

const keymapSlice = createSlice({
  name: 'keymap',
  initialState,
  reducers: {
    resetKeymapCache: (state, action: PayloadAction<string>) => {
      delete state.rawDeviceMap[action.payload];
      delete state.encoderDeviceMap[action.payload];
      delete state.numberOfLayersMap[action.payload];
      delete state.loadGenerationMap[action.payload];
    },
    setSelectedPaletteColor: (
      state,
      action: PayloadAction<[number, number]>,
    ) => {
      state.selectedPaletteColor = action.payload;
    },
    setNumberOfLayers: (
      state,
      action: PayloadAction<{
        devicePath: string;
        numberOfLayers: number;
        connectionGeneration: number;
      }>,
    ) => {
      const {devicePath, numberOfLayers, connectionGeneration} = action.payload;
      if (
        state.loadGenerationMap[devicePath] !== connectionGeneration ||
        state.rawDeviceMap[devicePath]?.length !== numberOfLayers
      ) {
        state.rawDeviceMap[devicePath] = Array.from(
          {length: numberOfLayers},
          () => ({keymap: [], isLoaded: false}),
        );
      }
      state.numberOfLayersMap[devicePath] = numberOfLayers;
      state.loadGenerationMap[devicePath] = connectionGeneration;
    },
    setConfigureKeyboardIsSelectable: (
      state,
      action: PayloadAction<boolean>,
    ) => {
      state.configureKeyboardIsSelectable = action.payload;
    },
    // Writes a single layer to the device layer map
    loadLayerSuccess: (
      state,
      action: PayloadAction<{
        layerIndex: number;
        keymap: Keymap;
        devicePath: string;
        connectionGeneration: number;
      }>,
    ) => {
      const {layerIndex, keymap, devicePath, connectionGeneration} =
        action.payload;
      if (state.loadGenerationMap[devicePath] !== connectionGeneration) {
        return;
      }
      state.rawDeviceMap[devicePath] =
        state.rawDeviceMap[devicePath] ||
        Array.from({length: state.numberOfLayersMap[devicePath] ?? 0}, () => ({
          keymap: [],
          isLoaded: false,
        }));
      state.rawDeviceMap[devicePath][layerIndex] = {
        keymap,
        isLoaded: true,
      };
    },
    setLayer: (state, action: PayloadAction<number>) => {
      state.selectedLayerIndex = action.payload;
    },
    clearSelectedKey: (state) => {
      state.selectedKey = null;
    },
    updateSelectedKey: (state, action: PayloadAction<number | null>) => {
      state.selectedKey = action.payload;
    },
    saveKeymapSuccess: (
      state,
      action: PayloadAction<{
        layers: Layer[];
        devicePath: string;
        connectionGeneration: number;
      }>,
    ) => {
      const {layers, devicePath, connectionGeneration} = action.payload;
      state.rawDeviceMap[devicePath] = layers;
      state.numberOfLayersMap[devicePath] = layers.length;
      state.loadGenerationMap[devicePath] = connectionGeneration;
    },
    setKey: (
      state,
      action: PayloadAction<{
        devicePath: string;
        layerIndex: number;
        keymapIndex: number;
        value: number;
      }>,
    ) => {
      const {keymapIndex, value, devicePath, layerIndex} = action.payload;
      state.rawDeviceMap[devicePath][layerIndex].keymap[keymapIndex] = value;
    },
    setEncoderValue: (
      state,
      action: PayloadAction<{
        devicePath: string;
        encoderId: number;
        layerIndex: number;
        isClockwise: boolean;
        value: number;
      }>,
    ) => {
      const {devicePath, encoderId, layerIndex, isClockwise, value} =
        action.payload;
      const current = state.encoderDeviceMap[devicePath] ?? {};
      const layers = current[encoderId] ? [...current[encoderId]] : [];
      const pair: [number, number] = layers[layerIndex]
        ? [...layers[layerIndex]]
        : [0, 0];
      pair[isClockwise ? 1 : 0] = value;
      layers[layerIndex] = pair;
      state.encoderDeviceMap[devicePath] = {
        ...current,
        [encoderId]: layers,
      };
    },
    replaceEncoderMap: (
      state,
      action: PayloadAction<{
        devicePath: string;
        encoders: StateSyncEncoderMap;
      }>,
    ) => {
      state.encoderDeviceMap[action.payload.devicePath] =
        action.payload.encoders;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(selectDevice, (state) => {
        state.selectedKey = null;
      })
      .addCase(commitStableKeymapCandidate, (state, action) => {
        const {devicePath, connectionGeneration, candidate} = action.payload;
        state.rawDeviceMap[devicePath] = candidate.layers;
        state.encoderDeviceMap[devicePath] = candidate.encoders;
        state.numberOfLayersMap[devicePath] = candidate.layers.length;
        state.loadGenerationMap[devicePath] = connectionGeneration;
      });
  },
});

export const {
  setNumberOfLayers,
  setLayer,
  loadLayerSuccess,
  clearSelectedKey,
  setKey,
  updateSelectedKey,
  saveKeymapSuccess,
  setConfigureKeyboardIsSelectable,
  setSelectedPaletteColor,
  resetKeymapCache,
  setEncoderValue,
  replaceEncoderMap,
} = keymapSlice.actions;

export default keymapSlice.reducer;

export const readKeymapStateSyncCandidate = async (
  connectedDevice: ConnectedDevice,
  state: RootState,
  connectionGeneration: number,
  reservedApi?: KeyboardAPI,
): Promise<StateSyncKeymapCandidate | null> => {
  const {path} = connectedDevice;
  const api = reservedApi ?? new KeyboardAPI(path);
  const definition = getDefinitionForDevice(state, connectedDevice);
  if (!definition || !api.isConnectionGenerationCurrent(connectionGeneration)) {
    return null;
  }

  const numberOfLayers = await api.getLayerCount();
  if (!api.isConnectionGenerationCurrent(connectionGeneration)) {
    return null;
  }
  const layers: Layer[] = [];
  for (let layerIndex = 0; layerIndex < numberOfLayers; layerIndex++) {
    const keymap = await api.readRawMatrix(definition.matrix, layerIndex);
    if (!api.isConnectionGenerationCurrent(connectionGeneration)) {
      return null;
    }
    layers.push({keymap, isLoaded: true});
  }

  const encoderIds = collectUniqueEncoderIds(definition);
  const encoders: StateSyncEncoderMap = {};
  if (connectedDevice.protocol >= 10) {
    for (const encoderId of encoderIds) {
      encoders[encoderId] = [];
      for (let layerIndex = 0; layerIndex < numberOfLayers; layerIndex++) {
        const counterclockwise = await api.getEncoderValue(
          layerIndex,
          encoderId,
          false,
        );
        const clockwise = await api.getEncoderValue(
          layerIndex,
          encoderId,
          true,
        );
        if (!api.isConnectionGenerationCurrent(connectionGeneration)) {
          return null;
        }
        encoders[encoderId].push([counterclockwise, clockwise]);
      }
    }
  }
  return {layers, encoders};
};

export const loadKeymapFromDevice =
  (connectedDevice: ConnectedDevice, options?: {force?: boolean}): AppThunk =>
  async (dispatch, getState) => {
    const state = getState();
    const {path} = connectedDevice;
    const api = new KeyboardAPI(path);
    const connectionGeneration = api.getConnectionGeneration();
    const definition = getDefinitionForDevice(state, connectedDevice);
    if (!definition) {
      return;
    }

    const cachedLayerCount = state.keymap.numberOfLayersMap[path];
    const cachedLayers = state.keymap.rawDeviceMap[path];
    if (
      !options?.force &&
      state.keymap.loadGenerationMap[path] === connectionGeneration &&
      cachedLayerCount !== undefined &&
      cachedLayers?.length >= cachedLayerCount &&
      cachedLayers?.slice(0, cachedLayerCount).every((layer) => layer.isLoaded)
    ) {
      return;
    }

    if (options?.force) {
      dispatch(resetKeymapCache(path));
    }

    const numberOfLayers = await api.getLayerCount();
    if (!api.isConnectionGenerationCurrent(connectionGeneration)) {
      return;
    }
    dispatch(
      setNumberOfLayers({
        devicePath: path,
        numberOfLayers,
        connectionGeneration,
      }),
    );

    const {matrix} = definition;

    for (var layerIndex = 0; layerIndex < numberOfLayers; layerIndex++) {
      const keymap = await api.readRawMatrix(matrix, layerIndex);
      if (!api.isConnectionGenerationCurrent(connectionGeneration)) {
        return;
      }
      dispatch(
        loadLayerSuccess({
          layerIndex,
          keymap,
          devicePath: path,
          connectionGeneration,
        }),
      );
    }
  };

// TODO: why isn't this keymap of type Keymap i.e. number[]?
// TODO: should this be using the current selected device? not sure
export type SaveRawKeymapOptions = {
  api?: KeyboardAPI;
  mutationEpochAlreadyAdvanced?: boolean;
  reconcileOnFailure?: boolean;
};

export const saveRawKeymapToDevice =
  (
    keymap: number[][],
    connectedDevice: ConnectedDevice,
    options: SaveRawKeymapOptions = {},
  ): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const state = getState();
    const {path} = connectedDevice;
    const api = options.api ?? new KeyboardAPI(path);
    const connectionGeneration = api.getConnectionGeneration();
    const selectionGeneration = getSelectionGeneration(state);
    const definition = getDefinitionForDevice(state, connectedDevice);
    if (!path || !definition) {
      throw new Error('Cannot write keymap without a resolved definition');
    }
    if (
      !isSelectedDeviceOperationCurrent(
        state,
        path,
        connectionGeneration,
        selectionGeneration,
      )
    ) {
      throw new Error('Keymap write does not belong to the current device');
    }

    const {matrix} = definition;
    if (!options.mutationEpochAlreadyAdvanced) {
      dispatch(
        beginForegroundMutation({
          path,
          generation: connectionGeneration,
          domains: ['keymap'],
        }),
      );
    }

    try {
      await api.writeRawMatrix(matrix, keymap);
      if (
        !api.isConnectionGenerationCurrent(connectionGeneration) ||
        !isSelectedDeviceOperationCurrent(
          getState(),
          path,
          connectionGeneration,
          selectionGeneration,
        )
      ) {
        throw new Error('Keymap write context changed before completion');
      }
      const layers = keymap.map((layer) => ({
        keymap: layer,
        isLoaded: true,
      }));
      dispatch(
        saveKeymapSuccess({
          layers,
          devicePath: path,
          connectionGeneration,
        }),
      );
      dispatch(
        invalidateStateSyncDomain({
          devicePath: path,
          connectionGeneration,
          domain: 'keymap',
        }),
      );
    } catch (error) {
      dispatch(
        invalidateStateSyncDomain({
          devicePath: path,
          connectionGeneration,
          domain: 'keymap',
        }),
      );
      if (
        options.reconcileOnFailure !== false &&
        api.isConnectionGenerationCurrent(connectionGeneration)
      ) {
        const {refreshAllDomains} = await import('./stateSyncThunks');
        await dispatch(refreshAllDomains(connectedDevice));
      }
      throw error;
    }
  };

export const updateKey =
  (keyIndex: number, value: number): AppThunk =>
  async (dispatch, getState) => {
    const state = getState();
    const keys = getSelectedKeyDefinitions(state);
    const connectedDevice = getSelectedConnectedDevice(state);
    const api = getSelectedKeyboardAPI(state);
    const selectedDefinition = getSelectedDefinition(state);
    if (!connectedDevice || !keys || !selectedDefinition || !api) {
      return;
    }

    const selectedLayerIndex = getSelectedLayerIndex(state);
    const {path} = connectedDevice;
    const connectionGeneration = api.getConnectionGeneration();
    const {row, col} = keys[keyIndex];
    await api.setKey(selectedLayerIndex, row, col, value);
    if (!api.isConnectionGenerationCurrent(connectionGeneration)) {
      return;
    }

    const {matrix} = selectedDefinition;
    const keymapIndex = row * matrix.cols + col;

    dispatch(
      setKey({
        keymapIndex,
        value,
        devicePath: path,
        layerIndex: selectedLayerIndex,
      }),
    );
    dispatch(
      invalidateStateSyncDomain({
        devicePath: path,
        connectionGeneration,
        domain: 'keymap',
      }),
    );
  };

export const updateEncoderValue =
  (
    layerIndex: number,
    encoderId: number,
    isClockwise: boolean,
    value: number,
  ): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const state = getState();
    const connectedDevice = getSelectedConnectedDevice(state);
    const api = getSelectedKeyboardAPI(state);
    if (!connectedDevice || !api) {
      return;
    }
    const connectionGeneration = api.getConnectionGeneration();
    dispatch(
      beginForegroundMutation({
        path: connectedDevice.path,
        generation: connectionGeneration,
        domains: ['keymap'],
      }),
    );
    try {
      await api.setEncoderValue(layerIndex, encoderId, isClockwise, value);
    } catch (error) {
      dispatch(
        invalidateStateSyncDomain({
          devicePath: connectedDevice.path,
          connectionGeneration,
          domain: 'keymap',
        }),
      );
      throw error;
    }
    if (api.isConnectionGenerationCurrent(connectionGeneration)) {
      dispatch(
        setEncoderValue({
          devicePath: connectedDevice.path,
          encoderId,
          layerIndex,
          isClockwise,
          value,
        }),
      );
      dispatch(
        invalidateStateSyncDomain({
          devicePath: connectedDevice.path,
          connectionGeneration,
          domain: 'keymap',
        }),
      );
    }
  };

export const getConfigureKeyboardIsSelectable = (state: RootState) =>
  state.keymap.configureKeyboardIsSelectable;
export const getSelectedKey = (state: RootState) => state.keymap.selectedKey;
export const getRawDeviceMap = (state: RootState) => state.keymap.rawDeviceMap;
export const getEncoderDeviceMap = (state: RootState) =>
  state.keymap.encoderDeviceMap;
export const getSelectedEncoderMap = createSelector(
  getEncoderDeviceMap,
  getSelectedDevicePath,
  (map, path) => (path ? map[path] : undefined),
);
export const getNumberOfLayersMap = (state: RootState) =>
  state.keymap.numberOfLayersMap;
export const getKeymapLoadGenerationMap = (state: RootState) =>
  state.keymap.loadGenerationMap;
export const getNumberOfLayers = createSelector(
  getNumberOfLayersMap,
  getSelectedDevicePath,
  (layerCountMap, devicePath) => (devicePath && layerCountMap[devicePath]) || 4,
);
export const getSelectedLayerIndex = (state: RootState) =>
  state.keymap.selectedLayerIndex;
export const getSelected256PaletteColor = (state: RootState) =>
  state.keymap.selectedPaletteColor;
export const getSelectedPaletteColor = createSelector(
  getSelected256PaletteColor,
  ([hue, sat]) => {
    return [(360 * hue) / 255, sat / 255] as [number, number];
  },
);

export const getSelectedRawLayers = createSelector(
  getRawDeviceMap,
  getSelectedDevicePath,
  (rawDeviceMap, devicePath) => (devicePath && rawDeviceMap[devicePath]) || [],
);

export const getLoadProgress = createSelector(
  getSelectedRawLayers,
  getNumberOfLayers,
  getKeymapLoadGenerationMap,
  getSelectedDevicePath,
  getSelectedConnectionGeneration,
  (layers, layerCount, loadGenerationMap, devicePath, connectionGeneration) =>
    !devicePath || loadGenerationMap[devicePath] !== connectionGeneration
      ? 0
      : layers && layers.filter((layer) => layer.isLoaded).length / layerCount,
);

export const getSelectedRawLayer = createSelector(
  getSelectedRawLayers,
  getSelectedLayerIndex,
  (deviceLayers, layerIndex) => deviceLayers && deviceLayers[layerIndex],
);

export const getSelectedKeymaps = createSelector(
  getSelectedKeyDefinitions,
  getSelectedDefinition,
  getSelectedRawLayers,
  (keys, definition, layers) => {
    if (definition && layers) {
      const rawKeymaps = layers.map((layer) => layer.keymap);
      const {
        matrix: {cols},
      } = definition;
      return rawKeymaps.map((keymap) =>
        keys.map(({row, col}) => keymap[row * cols + col]),
      );
    }
    return undefined;
  },
);

export const getSelectedKeymap = createSelector(
  getSelectedKeymaps,
  getSelectedLayerIndex,
  (deviceLayers, layerIndex) => deviceLayers && deviceLayers[layerIndex],
);
