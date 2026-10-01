import {createSelector, createSlice, PayloadAction} from '@reduxjs/toolkit';
import {KeyboardAPI} from 'src/utils/keyboard-api';
import {getMacroAPI, isDelaySupported} from 'src/utils/macro-api';
import {
  expressionToRawSequence,
  rawSequenceToOptimizedSequence,
  sequenceToExpression,
} from 'src/utils/macro-api/macro-api.common';
import {RawKeycodeSequence} from 'src/utils/macro-api/types';
import type {ConnectedDevice} from '../types/types';
import {
  getSelectedConnectedDevice,
  getSelectedConnectionGeneration,
  getSelectionGeneration,
  isSelectedDeviceOperationCurrent,
  selectDevice,
} from './devicesSlice';
import type {AppThunk, RootState} from './index';
import {getKeycodesVersionMap} from './firmwareSlice';
import {
  commitStableMacroCandidate,
  invalidateStateSyncDomain,
  type StateSyncMacroCandidate,
} from './stateSyncCandidateActions';
import {beginForegroundMutation} from './stateSyncSlice';

type MacrosStatus = 'idle' | 'metadata' | 'loading' | 'ready';

type MacrosState = {
  ast: RawKeycodeSequence[];
  macroBufferSize: number;
  macroCount: number;
  isFeatureSupported: boolean;
  status: MacrosStatus;
  ownerPath: string | null;
  ownerConnectionGeneration: number | null;
  ownerSelectionGeneration: number | null;
};

const macrosInitialState: MacrosState = {
  ast: [],
  macroBufferSize: 0,
  macroCount: 0,
  isFeatureSupported: true,
  status: 'idle',
  ownerPath: null,
  ownerConnectionGeneration: null,
  ownerSelectionGeneration: null,
};

const macrosSlice = createSlice({
  name: 'macros',
  initialState: macrosInitialState,
  reducers: {
    macrosLoadStarted: (
      state,
      action: PayloadAction<{
        path: string;
        connectionGeneration: number;
        selectionGeneration: number;
      }>,
    ) => {
      state.ast = [];
      state.macroBufferSize = 0;
      state.macroCount = 0;
      state.isFeatureSupported = true;
      state.status = 'loading';
      state.ownerPath = action.payload.path;
      state.ownerConnectionGeneration = action.payload.connectionGeneration;
      state.ownerSelectionGeneration = action.payload.selectionGeneration;
    },
    macroMetadataLoaded: (
      state,
      action: PayloadAction<{
        macroCount: number;
        path: string;
        connectionGeneration: number;
        selectionGeneration: number;
      }>,
    ) => {
      state.ast = [];
      state.macroBufferSize = 0;
      state.macroCount = action.payload.macroCount;
      state.isFeatureSupported = true;
      state.status = 'metadata';
      state.ownerPath = action.payload.path;
      state.ownerConnectionGeneration = action.payload.connectionGeneration;
      state.ownerSelectionGeneration = action.payload.selectionGeneration;
    },
    loadMacrosSuccess: (
      state,
      action: PayloadAction<{
        ast: RawKeycodeSequence[];
        macroBufferSize: number;
        macroCount: number;
        path?: string;
        connectionGeneration?: number;
        selectionGeneration?: number;
      }>,
    ) => {
      const {path, connectionGeneration, selectionGeneration} = action.payload;
      if (
        path !== undefined &&
        (state.ownerPath !== path ||
          state.ownerConnectionGeneration !== connectionGeneration ||
          state.ownerSelectionGeneration !== selectionGeneration)
      ) {
        return;
      }
      state.ast = action.payload.ast;
      state.macroBufferSize = action.payload.macroBufferSize;
      state.macroCount = action.payload.macroCount;
      state.isFeatureSupported = true;
      state.status = 'ready';
      if (path !== undefined) {
        state.ownerPath = path;
        state.ownerConnectionGeneration = connectionGeneration ?? null;
        state.ownerSelectionGeneration = selectionGeneration ?? null;
      }
    },
    saveMacrosSuccess: (
      state,
      action: PayloadAction<{ast: RawKeycodeSequence[]}>,
    ) => {
      state.ast = action.payload.ast;
    },
    setMacrosNotSupported: (
      state,
      action: PayloadAction<
        | {
            path: string;
            connectionGeneration: number;
            selectionGeneration: number;
          }
        | undefined
      >,
    ) => {
      if (
        action.payload &&
        (state.ownerPath !== action.payload.path ||
          state.ownerConnectionGeneration !==
            action.payload.connectionGeneration ||
          state.ownerSelectionGeneration !== action.payload.selectionGeneration)
      ) {
        return;
      }
      state.ast = [];
      state.macroBufferSize = 0;
      state.macroCount = 0;
      state.isFeatureSupported = false;
      state.status = 'ready';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(selectDevice, () => macrosInitialState)
      .addCase(commitStableMacroCandidate, (state, action) => {
        const {devicePath, connectionGeneration, selectionGeneration, candidate} =
          action.payload;
        state.ownerPath = devicePath;
        state.ownerConnectionGeneration = connectionGeneration;
        state.ownerSelectionGeneration = selectionGeneration;
        state.ast = candidate.ast;
        state.macroBufferSize = candidate.macroBufferSize;
        state.macroCount = candidate.macroCount;
        state.isFeatureSupported = candidate.isFeatureSupported;
        state.status = 'ready';
      });
  },
});

export const {
  macrosLoadStarted,
  macroMetadataLoaded,
  loadMacrosSuccess,
  saveMacrosSuccess,
  setMacrosNotSupported,
} = macrosSlice.actions;

export default macrosSlice.reducer;

export const readMacrosStateSyncCandidate = async (
  connectedDevice: ConnectedDevice,
  state: RootState,
  connectionGeneration: number,
  reservedApi?: KeyboardAPI,
): Promise<StateSyncMacroCandidate | null> => {
  const api = reservedApi ?? new KeyboardAPI(connectedDevice.path);
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
    if (isCurrentSelection()) {
      dispatch(
        macrosLoadStarted({
          path: connectedDevice.path,
          connectionGeneration,
          selectionGeneration,
        }),
      );
    }
    if (protocol < 8) {
      if (isCurrentSelection()) {
        dispatch(
          setMacrosNotSupported({
            path: connectedDevice.path,
            connectionGeneration,
            selectionGeneration,
          }),
        );
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
              loadMacrosSuccess({
                ast: sequences,
                macroBufferSize,
                macroCount,
                path: connectedDevice.path,
                connectionGeneration,
                selectionGeneration,
              }),
            );
          }
        }
      } catch (err) {
        if (isCurrentSelection()) {
          dispatch(
            setMacrosNotSupported({
              path: connectedDevice.path,
              connectionGeneration,
              selectionGeneration,
            }),
          );
        }
      }
    }
  };

export type SaveMacrosOptions = {
  api?: KeyboardAPI;
  mutationEpochAlreadyAdvanced?: boolean;
  reconcileOnFailure?: boolean;
};

// What a write needs read first. An edit rebuilds the whole set from the macros on
// screen, so it needs their contents; a replacement brings every macro itself and
// needs only the slot count, which a State Sync keyboard reads at connect.
type MacroWriteNeeds = 'contents' | 'count';

const writeMacroSet =
  (
    connectedDevice: ConnectedDevice,
    macros: string[],
    options: SaveMacrosOptions,
    needs: MacroWriteNeeds,
  ): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const state = getState();
    const api = options.api ?? new KeyboardAPI(connectedDevice.path);
    const connectionGeneration = api.getConnectionGeneration();
    const selectionGeneration = getSelectionGeneration(state);
    const keycodesVersion = getKeycodesVersionMap(state)[connectedDevice.path];
    const {protocol} = connectedDevice;
    const macroApi = getMacroAPI(protocol, keycodesVersion, api);
    const macroState = getState().macros;
    const isCurrentOwner =
      macroState.ownerPath === connectedDevice.path &&
      macroState.ownerConnectionGeneration === connectionGeneration &&
      macroState.ownerSelectionGeneration === selectionGeneration &&
      (macroState.status === 'ready' ||
        (needs === 'count' && macroState.status === 'metadata'));
    if (!isCurrentOwner) {
      throw new Error('Macro state does not belong to the current device');
    }
    const sequences = macros.map(expressionToRawSequence);

    if (!options.mutationEpochAlreadyAdvanced) {
      dispatch(
        beginForegroundMutation({
          path: connectedDevice.path,
          generation: connectionGeneration,
          domains: ['macro'],
        }),
      );
    }

    try {
      await macroApi.writeRawKeycodeSequences(sequences);
      if (
        !api.isConnectionGenerationCurrent(connectionGeneration) ||
        !isSelectedDeviceOperationCurrent(
          getState(),
          connectedDevice.path,
          connectionGeneration,
          selectionGeneration,
        )
      ) {
        throw new Error('Macro write context changed before completion');
      }
      // Kept as the keyboard reads it back, the form the editor compares a draft to.
      dispatch(
        saveMacrosSuccess({
          ast: macroApi.macroBytesToRawKeycodeSequences(
            macroApi.rawKeycodeSequencesToMacroBytes(sequences),
            sequences.length,
          ),
        }),
      );
      dispatch(
        invalidateStateSyncDomain({
          devicePath: connectedDevice.path,
          connectionGeneration,
          domain: 'macro',
        }),
      );
    } catch (error) {
      dispatch(
        invalidateStateSyncDomain({
          devicePath: connectedDevice.path,
          connectionGeneration,
          domain: 'macro',
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

/** Writes a set rebuilt from the macros on screen, so they must have been read. */
export const saveMacros = (
  connectedDevice: ConnectedDevice,
  macros: string[],
  options: SaveMacrosOptions = {},
) => writeMacroSet(connectedDevice, macros, options, 'contents');

/**
 * Replaces every macro, as loading a layout file does. The keyboard's current
 * macros are not needed, so a keyboard that has read only its macro count does
 * not pull the whole buffer first.
 */
export const replaceMacros = (
  connectedDevice: ConnectedDevice,
  macros: string[],
  options: SaveMacrosOptions = {},
) => writeMacroSet(connectedDevice, macros, options, 'count');

export const loadMacroMetadata =
  (connectedDevice: ConnectedDevice): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const api = new KeyboardAPI(connectedDevice.path);
    const connectionGeneration = api.getConnectionGeneration();
    const selectionGeneration = getSelectionGeneration(getState());
    const isCurrentSelection = () =>
      api.isConnectionGenerationCurrent(connectionGeneration) &&
      isSelectedDeviceOperationCurrent(
        getState(),
        connectedDevice.path,
        connectionGeneration,
        selectionGeneration,
      );
    if (connectedDevice.protocol < 8) {
      if (isCurrentSelection()) {
        dispatch(
          setMacrosNotSupported({
            path: connectedDevice.path,
            connectionGeneration,
            selectionGeneration,
          }),
        );
      }
      return;
    }
    try {
      const macroCount = await api.getMacroCount();
      if (isCurrentSelection()) {
        dispatch(
          macroMetadataLoaded({
            macroCount,
            path: connectedDevice.path,
            connectionGeneration,
            selectionGeneration,
          }),
        );
      }
    } catch {
      if (isCurrentSelection()) {
        dispatch(
          setMacrosNotSupported({
            path: connectedDevice.path,
            connectionGeneration,
            selectionGeneration,
          }),
        );
      }
    }
  };

export const resetMacrosOnDevice = (): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const state = getState();
    const connectedDevice = getSelectedConnectedDevice(state);
    if (!connectedDevice) {
      return;
    }
    const api = new KeyboardAPI(connectedDevice.path);
    const connectionGeneration = api.getConnectionGeneration();
    dispatch(
      beginForegroundMutation({
        path: connectedDevice.path,
        generation: connectionGeneration,
        domains: ['macro'],
      }),
    );
    try {
      await api.resetMacros();
    } catch (error) {
      dispatch(
        invalidateStateSyncDomain({
          devicePath: connectedDevice.path,
          connectionGeneration,
          domain: 'macro',
        }),
      );
      if (api.isConnectionGenerationCurrent(connectionGeneration)) {
        const {refreshAllDomains} = await import('./stateSyncThunks');
        await dispatch(refreshAllDomains(connectedDevice));
      }
      throw error;
    }
    dispatch(
      invalidateStateSyncDomain({
        devicePath: connectedDevice.path,
        connectionGeneration,
        domain: 'macro',
      }),
    );
    if (api.isConnectionGenerationCurrent(connectionGeneration)) {
      const {refreshAllDomains} = await import('./stateSyncThunks');
      await dispatch(refreshAllDomains(connectedDevice));
    }
  };

export const getIsMacrosReady = (state: RootState) => {
  const device = getSelectedConnectedDevice(state);
  const macros = state.macros;
  return (
    !!device &&
    macros.status === 'ready' &&
    macros.ownerPath === device.path &&
    macros.ownerConnectionGeneration ===
      getSelectedConnectionGeneration(state) &&
    macros.ownerSelectionGeneration === getSelectionGeneration(state)
  );
};

const getIsMacroStateCurrent = (state: RootState) => {
  const device = getSelectedConnectedDevice(state);
  const macros = state.macros;
  return (
    !!device &&
    macros.status !== 'idle' &&
    macros.ownerPath === device.path &&
    macros.ownerConnectionGeneration === getSelectedConnectionGeneration(state) &&
    macros.ownerSelectionGeneration === getSelectionGeneration(state)
  );
};

export const getIsMacroFeatureSupported = (state: RootState) =>
  state.macros.isFeatureSupported;

const emptyMacroAst: RawKeycodeSequence[] = [];

export const getAST = (state: RootState) =>
  getIsMacrosReady(state) ? state.macros.ast : emptyMacroAst;
export const getMacroBufferSize = (state: RootState) =>
  getIsMacrosReady(state) ? state.macros.macroBufferSize : 0;
export const getMacroCount = (state: RootState) =>
  getIsMacroStateCurrent(state) ? state.macros.macroCount : 0;

/**
 * The keyboard's macro slot count: null when it has no macros, undefined while
 * that is not known yet. Enough for a write that replaces every macro.
 */
export const getKnownMacroCount = (
  state: RootState,
): number | null | undefined => {
  if (
    !getIsMacroStateCurrent(state) ||
    (state.macros.status !== 'ready' && state.macros.status !== 'metadata')
  ) {
    return undefined;
  }
  return state.macros.isFeatureSupported ? state.macros.macroCount : null;
};

/**
 * The macro slots the keycode palette offers: null once this connection has
 * settled on none (VIA before protocol 8, a count of zero, or a keyboard that
 * answered the macro read without usable macros, such as one that does not
 * handle the command). A read that fails in transport ends the connection
 * before anything is recorded, so it never reads as none.
 */
export const getPaletteMacroCount = (state: RootState): number | null => {
  const known = getKnownMacroCount(state);
  return known === null || known === 0 ? null : getMacroCount(state);
};

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
