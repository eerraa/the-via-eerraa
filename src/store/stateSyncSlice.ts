import {createSelector, createSlice, PayloadAction} from '@reduxjs/toolkit';
import type {StateSyncCapability, StateSyncRevisions} from '../utils/era-state-sync';
import type {RootState} from './index';
import {getSelectedDevicePath} from './devicesSlice';

export type DomainFreshness = 'unknown' | 'dirty' | 'refreshing' | 'fresh';

export type DomainState = {
  status: DomainFreshness;
  revision: number;
  generation: number;
};

export type PathSyncState = {
  capability: StateSyncCapability;
  generation: number;
  revisions: StateSyncRevisions;
  keymap: DomainState;
  macro: DomainState;
  config: DomainState;
};

type StateSyncState = {
  byPath: Record<string, PathSyncState>;
  configureVisible: boolean;
  documentHidden: boolean;
};

const initialDomain = (generation: number): DomainState => ({
  status: 'unknown',
  revision: 0,
  generation,
});

export const initialPathSyncState = (generation: number): PathSyncState => ({
  capability: 'unknown',
  generation,
  revisions: {keymap: 0, macro: 0, config: 0},
  keymap: initialDomain(generation),
  macro: initialDomain(generation),
  config: initialDomain(generation),
});

const initialState: StateSyncState = {
  byPath: {},
  configureVisible: false,
  documentHidden: false,
};

const stateSyncSlice = createSlice({
  name: 'stateSync',
  initialState,
  reducers: {
    setConfigureVisible: (state, action: PayloadAction<boolean>) => {
      state.configureVisible = action.payload;
    },
    setDocumentHidden: (state, action: PayloadAction<boolean>) => {
      state.documentHidden = action.payload;
    },
    ensurePathSync: (
      state,
      action: PayloadAction<{path: string; generation: number}>,
    ) => {
      const {path, generation} = action.payload;
      const current = state.byPath[path];
      if (!current || current.generation !== generation) {
        state.byPath[path] = initialPathSyncState(generation);
      }
    },
    setPathCapability: (
      state,
      action: PayloadAction<{
        path: string;
        generation: number;
        capability: StateSyncCapability;
      }>,
    ) => {
      const {path, generation, capability} = action.payload;
      const current = state.byPath[path];
      if (!current || current.generation !== generation) {
        state.byPath[path] = initialPathSyncState(generation);
      }
      state.byPath[path].capability = capability;
    },
    setPathRevisions: (
      state,
      action: PayloadAction<{
        path: string;
        generation: number;
        revisions: StateSyncRevisions;
      }>,
    ) => {
      const {path, generation, revisions} = action.payload;
      const current = state.byPath[path];
      if (!current || current.generation !== generation) {
        return;
      }
      current.revisions = revisions;
    },
    setDomainStatus: (
      state,
      action: PayloadAction<{
        path: string;
        generation: number;
        domain: 'keymap' | 'macro' | 'config';
        status: DomainFreshness;
        revision?: number;
      }>,
    ) => {
      const {path, generation, domain, status, revision} = action.payload;
      const current = state.byPath[path];
      if (!current || current.generation !== generation) {
        return;
      }
      current[domain] = {
        status,
        revision: revision ?? current[domain].revision,
        generation,
      };
    },
    clearPathSync: (state, action: PayloadAction<string>) => {
      delete state.byPath[action.payload];
    },
  },
});

export const {
  setConfigureVisible,
  setDocumentHidden,
  ensurePathSync,
  setPathCapability,
  setPathRevisions,
  setDomainStatus,
  clearPathSync,
} = stateSyncSlice.actions;

export default stateSyncSlice.reducer;

export const getStateSyncState = (state: RootState) => state.stateSync;
export const getConfigureVisible = (state: RootState) =>
  state.stateSync?.configureVisible ?? false;
export const getDocumentHidden = (state: RootState) =>
  state.stateSync?.documentHidden ?? false;

export const getPathSyncState = (state: RootState, path: string | null) =>
  path ? state.stateSync?.byPath[path] : undefined;

export const getSelectedStateSyncCapability = createSelector(
  getStateSyncState,
  getSelectedDevicePath,
  (sync, path) => (path ? sync?.byPath[path]?.capability : undefined),
);
