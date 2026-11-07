import {createSlice, type PayloadAction} from '@reduxjs/toolkit';
import type {ConnectedDevice} from '../types/types';
import type {AppThunk, RootState} from './index';
import {KeyboardAPI, UnhandledCommandError} from '../utils/keyboard-api';
import {getExactMsFamily} from '../utils/era-advanced-metadata';
import {
  fitsMacroOptionFlags,
  fitsMacroOptionHold,
  fitsMacroOptionRepeatCount,
  isUntilStoppedWithoutStop,
  MACRO_OPTIONS_SAVE_RETRY,
  macroOptionsChannel,
  MacroOptionsReplyError,
  readMacroOptions,
  writeMacroOptions,
  type MacroOptionsState,
  type MacroOptionValues,
} from '../utils/macro-api/era-macro-options';
import {getDefinitionSourceForDevice} from './definitionsSlice';
import {
  getConnectedDevices,
  getSelectedConnectedDevice,
  getSelectedConnectionGeneration,
} from './devicesSlice';
import {
  awaitCustomMenuWriteAuthority,
  getCustomMenuAvailabilityForDevice,
  selectedMenuWriteIsCurrent,
  setMenuSaveRetry,
} from './menusSlice';
import {
  commitStableConfigCandidate,
  invalidateStateSyncDomain,
} from './stateSyncCandidateActions';
import {
  beginForegroundMutation,
  beginForegroundWriteSession,
  endForegroundWriteSession,
  getPathSyncState,
} from './stateSyncSlice';

// The macro playback options the keyboard holds, by path. They are CONFIG state:
// a State Sync keyboard reads them with CONFIG, any other keyboard when the
// MACROS pane, a layout file or a write asks for them.

type MacroOptionsEntry = {generation: number; state: MacroOptionsState};

const macroOptionsSlice = createSlice({
  name: 'macroOptions',
  initialState: {} as Record<string, MacroOptionsEntry>,
  reducers: {
    macroOptionsRead: (
      state,
      action: PayloadAction<{path: string} & MacroOptionsEntry>,
    ) => {
      const {path, ...entry} = action.payload;
      state[path] = entry;
    },
    macroOptionsWritten: (
      state,
      action: PayloadAction<{
        path: string;
        generation: number;
        index: number;
        values: Partial<MacroOptionValues>;
      }>,
    ) => {
      const {path, generation, index, values} = action.payload;
      const entry = state[path];
      if (entry?.generation === generation && entry.state.kind === 'read' && entry.state.options[index]) {
        Object.assign(entry.state.options[index], values);
      }
    },
  },
  // A macro write leaves them alone: VIA's macro RESET keeps the options, so
  // nothing here follows the macro domain. An EEPROM clear reaches them as a
  // CONFIG change or a new connection.
  extraReducers: (builder) => {
    builder.addCase(commitStableConfigCandidate, (state, action) => {
      const {devicePath, connectionGeneration, candidate} = action.payload;
      if (candidate.macroOptions !== undefined) {
        state[devicePath] = {generation: connectionGeneration, state: candidate.macroOptions};
      }
    });
  },
});

export const {macroOptionsRead, macroOptionsWritten} = macroOptionsSlice.actions;
export default macroOptionsSlice.reducer;

/**
 * The MACRO_OPTIONS channel to ask, or null: only an ERA family's own definition,
 * never stock firmware, an official or uploaded definition, or firmware State
 * Sync could not verify, whose CONFIG is never read.
 */
export const getMacroOptionsChannel = (state: RootState, device: ConnectedDevice) => {
  const channel = macroOptionsChannel(getExactMsFamily(device.vendorProductId));
  return channel !== null &&
    getDefinitionSourceForDevice(state, device) === 'era' &&
    getCustomMenuAvailabilityForDevice(state, device) !== 'unverified'
    ? channel
    : null;
};

const getMacroOptionsAt = (state: RootState, path: string, generation: number) => {
  const entry = state.macroOptions?.[path];
  return entry?.generation === generation ? entry.state : undefined;
};

export const getMacroOptionsForDevice = (state: RootState, device: ConnectedDevice) =>
  getMacroOptionsAt(state, device.path, new KeyboardAPI(device.path).getConnectionGeneration());

export const getSelectedMacroOptions = (state: RootState) => {
  const device = getSelectedConnectedDevice(state);
  const generation = getSelectedConnectionGeneration(state);
  return device && generation !== null
    ? getMacroOptionsAt(state, device.path, generation)
    : undefined;
};

/** Whether an options SET is still owed its SAVE. */
export const getSelectedMacroOptionsUnsaved = (state: RootState) => {
  const device = getSelectedConnectedDevice(state);
  return !!device && !!state.menus?.saveRetries?.[device.path]?.[MACRO_OPTIONS_SAVE_RETRY];
};

/**
 * Reads every macro's options. With `strict`, as State Sync reads CONFIG, only a
 * reply the registry does not describe or a refused GET becomes a failed read;
 * a transport failure still aborts the read. Without it every failure does.
 */
export const readMacroOptionsFromDevice = async (
  api: KeyboardAPI,
  channel: number,
  strict = true,
): Promise<MacroOptionsState> => {
  try {
    return await readMacroOptions(
      {
        probe: (bytes) => api.getOptionalCustomMenuValue(bytes),
        get: async (bytes) => (await api.getCustomMenuValue(bytes)).slice(1),
      },
      channel,
      await api.getMacroCount(),
    );
  } catch (error) {
    if (
      strict &&
      !(error instanceof MacroOptionsReplyError) &&
      !(error instanceof UnhandledCommandError)
    ) {
      throw error;
    }
    return {kind: 'failed', reason: error instanceof Error ? error.message : String(error)};
  }
};

/**
 * The keyboard's macro options, read unless this connection already has them.
 * Null where they are not asked for, or not read yet.
 */
export const ensureMacroOptions =
  (device: ConnectedDevice): AppThunk<Promise<MacroOptionsState | null>> =>
  async (dispatch, getState) => {
    const channel = getMacroOptionsChannel(getState(), device);
    if (channel === null) return null;
    const known = getMacroOptionsForDevice(getState(), device);
    if (known && known.kind !== 'failed') return known;
    if (getPathSyncState(getState(), device.path)?.capability === 'capable') {
      const {refreshStateSyncDomain} = await import('./stateSyncThunks');
      await dispatch(refreshStateSyncDomain(device, 'config'));
      return getMacroOptionsForDevice(getState(), device) ?? null;
    }
    if (getCustomMenuAvailabilityForDevice(getState(), device) !== 'available') return null;
    const api = new KeyboardAPI(device.path);
    const generation = api.getConnectionGeneration();
    try {
      const read = await api.withPathReservation(
        generation,
        Symbol('macro-options-read'),
        (reservedApi) => readMacroOptionsFromDevice(reservedApi, channel, false),
      );
      if (!api.isConnectionGenerationCurrent(generation)) return null;
      dispatch(macroOptionsRead({path: device.path, generation, state: read}));
      return read;
    } catch {
      return null;
    }
  };

/**
 * Writes and saves one macro's options. As for a Custom Menu edit, it is pinned
 * to the selected keyboard and definition, waits for a CONFIG re-read the
 * keyboard owes, and a SET the keyboard took stays owed its SAVE until one is
 * acknowledged; CONFIG is read again afterwards whatever happened. As in a load,
 * a SET the keyboard refuses ends the writes (writeMacroOptions) and what it took
 * before is still saved. True only when every value was taken and saved.
 */
export const saveMacroOptionsToDevice =
  (
    device: ConnectedDevice,
    index: number,
    values: MacroOptionValues,
  ): AppThunk<Promise<boolean>> =>
  async (dispatch, getState) => {
    if (getSelectedConnectedDevice(getState())?.path !== device.path) return false;
    const requestIsCurrent = selectedMenuWriteIsCurrent(getState);
    const authority = awaitCustomMenuWriteAuthority(dispatch, getState);
    if (authority !== true && !(await authority)) return false;
    // Read first: the supported mask and the macro count decide what may go out.
    const read = await dispatch(ensureMacroOptions(device));
    const channel = getMacroOptionsChannel(getState(), device);
    if (
      !requestIsCurrent() ||
      getCustomMenuAvailabilityForDevice(getState(), device) !== 'available' ||
      channel === null ||
      read?.kind !== 'read' ||
      index >= read.options.length ||
      !fitsMacroOptionFlags(read.supported, values.flags) ||
      !fitsMacroOptionHold(values.holdMs) ||
      !fitsMacroOptionRepeatCount(values.repeatCount) ||
      isUntilStoppedWithoutStop(values)
    ) {
      return false;
    }
    const {path} = device;
    const api = new KeyboardAPI(path);
    const generation = api.getConnectionGeneration();
    const session = {path, generation, domains: ['config' as const]};
    dispatch(beginForegroundWriteSession(session));
    dispatch(beginForegroundMutation(session));
    let saved = false;
    try {
      await api.withPathReservation(generation, Symbol('macro-options-write'), async (reservedApi) => {
        if (!requestIsCurrent()) throw new Error('Macro options write context changed before SET');
        const taken: Partial<MacroOptionValues> = {};
        let complete = false;
        try {
          complete = await writeMacroOptions(
            async (bytes) => {
              try {
                await reservedApi.setCustomMenuValue(...bytes);
                return true;
              } catch (error) {
                if (!(error instanceof UnhandledCommandError)) throw error;
                return false;
              }
            },
            channel,
            index,
            values,
            (value) => {
              Object.assign(taken, value);
              // Owed from the first SET the keyboard took, whatever fails after it.
              if (getConnectedDevices(getState())[path]) {
                dispatch(setMenuSaveRetry({devicePath: path, command: MACRO_OPTIONS_SAVE_RETRY, retry: true}));
              }
            },
          );
        } finally {
          if (Object.keys(taken).length > 0) {
            dispatch(macroOptionsWritten({path, generation, index, values: taken}));
          }
        }
        if (Object.keys(taken).length === 0) return;
        await reservedApi.commitCustomMenu(channel);
        dispatch(setMenuSaveRetry({devicePath: path, command: MACRO_OPTIONS_SAVE_RETRY, retry: false}));
        saved = complete;
      });
    } catch (error) {
      console.warn('Saving macro options failed', error);
    } finally {
      dispatch(invalidateStateSyncDomain({devicePath: path, connectionGeneration: generation, domain: 'config'}));
      try {
        if (api.isConnectionGenerationCurrent(generation)) {
          if (getPathSyncState(getState(), path)?.capability === 'capable') {
            const {refreshConfigDomain} = await import('./stateSyncThunks');
            await dispatch(refreshConfigDomain(device));
          } else {
            const reread = await api.withPathReservation(
              generation,
              Symbol('macro-options-read'),
              (reservedApi) => readMacroOptionsFromDevice(reservedApi, channel, false),
            );
            if (api.isConnectionGenerationCurrent(generation)) {
              dispatch(macroOptionsRead({path, generation, state: reread}));
            }
          }
        }
      } catch {
        // The connection ended; the next one reads them again.
      } finally {
        dispatch(endForegroundWriteSession(session));
      }
    }
    return saved;
  };
