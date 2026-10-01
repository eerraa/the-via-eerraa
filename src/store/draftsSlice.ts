import {createSelector, createSlice, type PayloadAction} from '@reduxjs/toolkit';
import {
  clearAllDevices,
  getSelectedDevicePath,
  updateConnectedDevices,
} from './devicesSlice';
import type {RootState} from './index';

// Changes the user has made but not yet written to the keyboard. They live here,
// per keyboard, rather than in the screen they were made on, so leaving for
// another tab, pane or page and coming back finds them as they were, even after
// the keyboard's connection is reloaded. A draft ends only when it is written,
// cancelled, or its keyboard is no longer connected; none outlives the session.

/** Plain data, as everything in the store is. */
export type DraftValue =
  | boolean
  | number
  | string
  | unknown[]
  | {[field: string]: unknown};

/** What a draft is for: a Custom Value command, a macro slot, a Tap Dance slot. */
export type DraftScope = 'menu' | 'macro' | 'tapDance';

export const draftKey = (scope: DraftScope, id: string | number) =>
  `${scope}:${id}`;

type DraftsState = Record<string, Record<string, DraftValue>>;

type DraftTarget = {devicePath: string; key: string};

const isSameDraft = (current: DraftValue | undefined, value: DraftValue) =>
  current === value || JSON.stringify(current) === JSON.stringify(value);

const initialState: DraftsState = {};

const draftsSlice = createSlice({
  name: 'drafts',
  initialState,
  reducers: {
    setDraft: (
      state,
      action: PayloadAction<DraftTarget & {value: DraftValue}>,
    ) => {
      const {devicePath, key, value} = action.payload;
      (state[devicePath] ??= {})[key] = value;
    },
    discardDrafts: (
      state,
      action: PayloadAction<{devicePath: string; keys: string[]}>,
    ) => {
      const {devicePath, keys} = action.payload;
      const drafts = state[devicePath];
      if (!drafts) {
        return;
      }
      keys.forEach((key) => delete drafts[key]);
      if (Object.keys(drafts).length === 0) {
        delete state[devicePath];
      }
    },
    // After a write, the draft that was written is done. One edited while the
    // write was on its way is newer and stays.
    settleWrittenDraft: (
      state,
      action: PayloadAction<DraftTarget & {value: DraftValue}>,
    ) => {
      const {devicePath, key, value} = action.payload;
      const drafts = state[devicePath];
      if (drafts && isSameDraft(drafts[key], value)) {
        delete drafts[key];
        if (Object.keys(drafts).length === 0) {
          delete state[devicePath];
        }
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(updateConnectedDevices, (state, action) => {
        Object.keys(state).forEach((devicePath) => {
          if (!action.payload[devicePath]) {
            delete state[devicePath];
          }
        });
      })
      .addCase(clearAllDevices, () => ({}));
  },
});

export const {setDraft, discardDrafts, settleWrittenDraft} =
  draftsSlice.actions;

export default draftsSlice.reducer;

const NO_DRAFTS: Record<string, DraftValue> = {};

export const getSelectedDeviceDrafts = createSelector(
  (state: RootState) => state.drafts,
  getSelectedDevicePath,
  (drafts, devicePath) => (devicePath && drafts[devicePath]) || NO_DRAFTS,
);
