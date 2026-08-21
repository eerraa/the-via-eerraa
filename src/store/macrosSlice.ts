import {createSelector, createSlice, PayloadAction} from '@reduxjs/toolkit';
import {KeyboardAPI} from 'src/utils/keyboard-api';
import {getMacroAPI, isDelaySupported} from 'src/utils/macro-api';
import {
  expressionToSequence,
  optimizedSequenceToRawSequence,
  rawSequenceToOptimizedSequence,
  sequenceToExpression,
} from 'src/utils/macro-api/macro-api.common';
import {RawKeycodeSequence} from 'src/utils/macro-api/types';
import type {ConnectedDevice} from '../types/types';
import {
  getSelectedConnectedDevice,
  getSelectionGeneration,
  isSelectedDeviceOperationCurrent,
} from './devicesSlice';
import type {AppThunk, RootState} from './index';
import {getKeycodesVersionMap} from './firmwareSlice';
import {
  commitStableMacroCandidate,
  invalidateStateSyncDomain,
  type StateSyncMacroCandidate,
} from './stateSyncCandidateActions';

type MacrosState = {
  ast: RawKeycodeSequence[];
  macroBufferSize: number;
  macroCount: number;
  isFeatureSupported: boolean;
};

const macrosInitialState: MacrosState = {
  ast: [],
  macroBufferSize: 0,
  macroCount: 0,
  isFeatureSupported: true,
};

const macrosSlice = createSlice({
  name: 'macros',
  initialState: macrosInitialState,
  reducers: {
    loadMacrosSuccess: (
      state,
      action: PayloadAction<{
        ast: RawKeycodeSequence[];
        macroBufferSize: number;
        macroCount: number;
      }>,
    ) => {
      state.ast = action.payload.ast;
      state.macroBufferSize = action.payload.macroBufferSize;
      state.macroCount = action.payload.macroCount;
      state.isFeatureSupported = true;
    },
    saveMacrosSuccess: (
      state,
      action: PayloadAction<{ast: RawKeycodeSequence[]}>,
    ) => {
      state.ast = action.payload.ast;
    },
    setMacrosNotSupported: (state) => {
      state.isFeatureSupported = false;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(commitStableMacroCandidate, (state, action) => {
      const {candidate} = action.payload;
      state.ast = candidate.ast;
      state.macroBufferSize = candidate.macroBufferSize;
      state.macroCount = candidate.macroCount;
      state.isFeatureSupported = candidate.isFeatureSupported;
    });
  },
});

export const {loadMacrosSuccess, saveMacrosSuccess, setMacrosNotSupported} =
  macrosSlice.actions;

export default macrosSlice.reducer;

export const readMacrosStateSyncCandidate = async (
  connectedDevice: ConnectedDevice,
  state: RootState,
  connectionGeneration: number,
): Promise<StateSyncMacroCandidate | null> => {
  const api = new KeyboardAPI(connectedDevice.path);
  if (!api.isConnectionGenerationCurrent(connectionGeneration)) {
    return null;
  }
  if (connectedDevice.protocol < 8) {
    return {
      ast: [],
      macroBufferSize: 0,
      macroCount: 0,
      isFeatureSupported: false,
    };
  }

  const keycodesVersion = getKeycodesVersionMap(state)[connectedDevice.path];
  const macroApi = getMacroAPI(connectedDevice.protocol, keycodesVersion, api);
  const ast = await macroApi.readRawKeycodeSequences();
  const macroBufferSize = await api.getMacroBufferSize();
  const macroCount = await api.getMacroCount();
  if (!api.isConnectionGenerationCurrent(connectionGeneration)) {
    return null;
  }
  return {
    ast,
    macroBufferSize,
    macroCount,
    isFeatureSupported: true,
  };
};

export const loadMacros =
  (connectedDevice: ConnectedDevice): AppThunk =>
  async (dispatch, getState) => {
    const {protocol} = connectedDevice;
    const state = getState();
    const api = new KeyboardAPI(connectedDevice.path);
    const connectionGeneration = api.getConnectionGeneration();
    const selectionGeneration = getSelectionGeneration(state);
    const isCurrentSelection = () =>
      api.isConnectionGenerationCurrent(connectionGeneration) &&
      isSelectedDeviceOperationCurrent(
        getState(),
        connectedDevice.path,
        connectionGeneration,
        selectionGeneration,
      );
    if (protocol < 8) {
      if (isCurrentSelection()) {
        dispatch(setMacrosNotSupported());
      }
    } else {
      try {
        const keycodesVersion =
          getKeycodesVersionMap(state)[connectedDevice.path];
        const macroApi = getMacroAPI(protocol, keycodesVersion, api);
        if (macroApi) {
          const sequences = await macroApi.readRawKeycodeSequences();
          const macroBufferSize = await api.getMacroBufferSize();
          const macroCount = await api.getMacroCount();
          if (isCurrentSelection()) {
            dispatch(
              loadMacrosSuccess({ast: sequences, macroBufferSize, macroCount}),
            );
          }
        }
      } catch (err) {
        if (isCurrentSelection()) {
          dispatch(setMacrosNotSupported());
        }
      }
    }
  };

export const saveMacros =
  (connectedDevice: ConnectedDevice, macros: string[]): AppThunk =>
  async (dispatch, getState) => {
    const state = getState();
    const api = new KeyboardAPI(connectedDevice.path);
    const connectionGeneration = api.getConnectionGeneration();
    const selectionGeneration = getSelectionGeneration(state);
    const keycodesVersion = getKeycodesVersionMap(state)[connectedDevice.path];
    const {protocol} = connectedDevice;
    const macroApi = getMacroAPI(protocol, keycodesVersion, api);
    if (macroApi) {
      const sequences = macros.map((expression) => {
        const optimizedSequence = expressionToSequence(expression);
        const rawSequence = optimizedSequenceToRawSequence(optimizedSequence);
        return rawSequence;
      });
      await macroApi.writeRawKeycodeSequences(sequences);
      if (
        api.isConnectionGenerationCurrent(connectionGeneration) &&
        isSelectedDeviceOperationCurrent(
          getState(),
          connectedDevice.path,
          connectionGeneration,
          selectionGeneration,
        )
      ) {
        dispatch(saveMacrosSuccess({ast: sequences}));
        dispatch(
          invalidateStateSyncDomain({
            devicePath: connectedDevice.path,
            connectionGeneration,
            domain: 'macro',
          }),
        );
      }
    }
  };

export const getIsMacroFeatureSupported = (state: RootState) =>
  state.macros.isFeatureSupported;

export const getAST = (state: RootState) => state.macros.ast;
export const getMacroBufferSize = (state: RootState) =>
  state.macros.macroBufferSize;
export const getMacroCount = (state: RootState) => state.macros.macroCount;

export const getExpressions = createSelector(getAST, (sequences) =>
  sequences.map((sequence) => {
    const optimizedSequence = rawSequenceToOptimizedSequence(sequence);
    const expression = sequenceToExpression(optimizedSequence);
    return expression;
  }),
);

export const getIsDelaySupported = createSelector(
  getSelectedConnectedDevice,
  (device) => !!device && isDelaySupported(device.protocol),
);
