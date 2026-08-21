import {createSelector, createSlice, PayloadAction} from '@reduxjs/toolkit';
import type {
  StateSyncCapability,
  StateSyncRevisions,
} from '../utils/era-state-sync';
import type {RootState} from './index';
import {getSelectedDevicePath} from './devicesSlice';
import {
  commitStableConfigCandidate,
  commitStableKeymapCandidate,
  commitStableMacroCandidate,
  invalidateStateSyncDomain,
} from './stateSyncCandidateActions';

export type StateSyncDomain = keyof StateSyncRevisions;
export type DomainFreshness = 'unknown' | 'dirty' | 'refreshing' | 'fresh';

export type DomainState = {
  status: DomainFreshness;
  observedRevision: number;
  acceptedRevision: number;
  generation: number;
};

export type PathSyncState = {
  capability: StateSyncCapability;
  generation: number;
  keymap: DomainState;
  macro: DomainState;
  config: DomainState;
};

type StateSyncState = {
  byPath: Record<string, PathSyncState>;
  configureVisible: boolean;
  documentHidden: boolean;
};

const domains: StateSyncDomain[] = ['keymap', 'macro', 'config'];

const initialDomain = (generation: number): DomainState => ({
  status: 'unknown',
  observedRevision: 0,
  acceptedRevision: 0,
  generation,
});

export const initialPathSyncState = (generation: number): PathSyncState => ({
  capability: 'unknown',
  generation,
  keymap: initialDomain(generation),
  macro: initialDomain(generation),
  config: initialDomain(generation),
});

const initialState: StateSyncState = {
  byPath: {},
  configureVisible: false,
  documentHidden: false,
};

const acceptStableRevision = (
  state: StateSyncState,
  payload: {
    devicePath: string;
    connectionGeneration: number;
    revision: number;
  },
  domain: StateSyncDomain,
) => {
  const {devicePath, connectionGeneration, revision} = payload;
  const current = state.byPath[devicePath];
  if (!current || current.generation !== connectionGeneration) {
    return;
  }
  current[domain] = {
    status: 'fresh',
    observedRevision: revision,
    acceptedRevision: revision,
    generation: connectionGeneration,
  };
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
    observePathRevisions: (
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
      domains.forEach((domain) => {
        const domainState = current[domain];
        domainState.observedRevision = revisions[domain];
        if (domainState.acceptedRevision !== revisions[domain]) {
          domainState.status = 'dirty';
        }
      });
    },
    markPathDirty: (
      state,
      action: PayloadAction<{path: string; generation: number}>,
    ) => {
      const {path, generation} = action.payload;
      const current = state.byPath[path];
      if (!current || current.generation !== generation) {
        return;
      }
      domains.forEach((domain) => {
        current[domain].status = 'dirty';
      });
    },
    setDomainStatus: (
      state,
      action: PayloadAction<{
        path: string;
        generation: number;
        domain: StateSyncDomain;
        status: DomainFreshness;
        revision?: number;
      }>,
    ) => {
      const {path, generation, domain, status, revision} = action.payload;
      const current = state.byPath[path];
      if (!current || current.generation !== generation) {
        return;
      }
      current[domain].status = status;
      if (revision !== undefined) {
        current[domain].observedRevision = revision;
      }
    },
    clearPathSync: (state, action: PayloadAction<string>) => {
      delete state.byPath[action.payload];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(commitStableKeymapCandidate, (state, action) => {
        acceptStableRevision(state, action.payload, 'keymap');
      })
      .addCase(commitStableMacroCandidate, (state, action) => {
        acceptStableRevision(state, action.payload, 'macro');
      })
      .addCase(commitStableConfigCandidate, (state, action) => {
        acceptStableRevision(state, action.payload, 'config');
      })
      .addCase(invalidateStateSyncDomain, (state, action) => {
        const {devicePath, connectionGeneration, domain} = action.payload;
        const current = state.byPath[devicePath];
        if (current?.generation === connectionGeneration) {
          current[domain].status = 'dirty';
        }
      });
  },
});

export const {
  setConfigureVisible,
  setDocumentHidden,
  ensurePathSync,
  setPathCapability,
  observePathRevisions,
  markPathDirty,
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
