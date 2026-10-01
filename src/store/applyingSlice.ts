import {createSlice, type PayloadAction} from '@reduxjs/toolkit';
import {clearAllDevices, updateConnectedDevices} from './devicesSlice';
import type {DraftScope} from './draftsSlice';
import type {RootState} from './index';

// The keyboards an Apply is writing drafts to now, with what those drafts are for,
// and the menu row where a keyboard's last write stopped short. The writes go on
// after the page Apply was pressed on is left, so a page opened again before they
// end keeps its Cancel and Apply off rather than offering them over writes on their
// way, and says where they stopped once they have.

/** A row the keyboard refused a write for, or whose held value did not take. */
export type MenuStop = {command: string; reason: 'refused' | 'notApplied'};

type ApplyingState = {
  writing: Record<string, DraftScope[]>;
  stops: Record<string, MenuStop>;
};

type ApplyTarget = {devicePath: string; scope: DraftScope};

const initialState: ApplyingState = {writing: {}, stops: {}};

const applyingSlice = createSlice({
  name: 'applying',
  initialState,
  reducers: {
    beginApply: (state, action: PayloadAction<ApplyTarget>) => {
      const {devicePath, scope} = action.payload;
      const scopes = (state.writing[devicePath] ??= []);
      if (!scopes.includes(scope)) {
        scopes.push(scope);
      }
    },
    endApply: (state, action: PayloadAction<ApplyTarget>) => {
      const {devicePath, scope} = action.payload;
      const scopes = (state.writing[devicePath] ?? []).filter(
        (other) => other !== scope,
      );
      if (scopes.length > 0) {
        state.writing[devicePath] = scopes;
      } else {
        delete state.writing[devicePath];
      }
    },
    // A stop lasts until the user next changes, cancels, applies or writes a value
    // on the keyboard's menu, or the keyboard goes away with its drafts.
    setMenuStop: (
      state,
      action: PayloadAction<{devicePath: string; stop: MenuStop | null}>,
    ) => {
      const {devicePath, stop} = action.payload;
      if (stop) {
        state.stops[devicePath] = stop;
      } else {
        delete state.stops[devicePath];
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(updateConnectedDevices, (state, action) => {
        Object.keys(state.stops).forEach((devicePath) => {
          if (!action.payload[devicePath]) {
            delete state.stops[devicePath];
          }
        });
      })
      .addCase(clearAllDevices, (state) => {
        state.stops = {};
      });
  },
});

export const {beginApply, endApply, setMenuStop} = applyingSlice.actions;

export default applyingSlice.reducer;

export const isApplying = (
  state: RootState,
  devicePath: string,
  scope: DraftScope,
) => state.applying.writing[devicePath]?.includes(scope) ?? false;

export const getMenuStop = (state: RootState, devicePath: string) =>
  state.applying.stops[devicePath] ?? null;
