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
import {
  getSelectedConnectionGeneration,
  getSelectedConnectedDevice,
  getSelectedDevicePath,
  getSelectedKeyboardAPI,
  selectDevice,
} from './devicesSlice';
import {KeyboardAPI} from 'src/utils/keyboard-api';

type KeymapState = {
  rawDeviceMap: DeviceLayerMap;
  numberOfLayersMap: Record<string, number>;
  loadGenerationMap: Record<string, number>;
  selectedLayerIndex: number;
  selectedKey: number | null;
  configureKeyboardIsSelectable: boolean;
  selectedPaletteColor: [number, number];
};

const initialState: KeymapState = {
  rawDeviceMap: {},
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
  },
  extraReducers: (builder) => {
    builder.addCase(selectDevice, (state) => {
      state.selectedKey = null;
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
} = keymapSlice.actions;

export default keymapSlice.reducer;

export const loadKeymapFromDevice =
  (connectedDevice: ConnectedDevice): AppThunk =>
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
      state.keymap.loadGenerationMap[path] === connectionGeneration &&
      cachedLayerCount !== undefined &&
      cachedLayers?.length >= cachedLayerCount &&
      cachedLayers?.slice(0, cachedLayerCount).every((layer) => layer.isLoaded)
    ) {
      return;
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
export const saveRawKeymapToDevice =
  (keymap: number[][], connectedDevice: ConnectedDevice): AppThunk =>
  async (dispatch, getState) => {
    const state = getState();
    const {path} = connectedDevice;
    const api = new KeyboardAPI(path);
    const connectionGeneration = api.getConnectionGeneration();
    const definition = getDefinitionForDevice(state, connectedDevice);
    if (!path || !definition) {
      return;
    }

    const {matrix} = definition;

    await api.writeRawMatrix(matrix, keymap);
    if (!api.isConnectionGenerationCurrent(connectionGeneration)) {
      return;
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
  };

export const getConfigureKeyboardIsSelectable = (state: RootState) =>
  state.keymap.configureKeyboardIsSelectable;
export const getSelectedKey = (state: RootState) => state.keymap.selectedKey;
export const getRawDeviceMap = (state: RootState) => state.keymap.rawDeviceMap;
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
