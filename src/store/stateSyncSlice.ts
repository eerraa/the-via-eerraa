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
  mutationEpoch: number;
  foregroundWriteDepth: number;
  acceptedSelectionGeneration: number | null;
  acceptedDefinitionIdentity: string | null;
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

const initialDomain = (): DomainState => ({
  status: 'unknown',
  observedRevision: 0,
  acceptedRevision: 0,
  mutationEpoch: 0,
  foregroundWriteDepth: 0,
  acceptedSelectionGeneration: null,
  acceptedDefinitionIdentity: null,
});

const initialPathSyncState = (generation: number): PathSyncState => ({
  capability: 'unknown',
  generation,
  keymap: initialDomain(),
  macro: initialDomain(),
  config: initialDomain(),
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
  const {
    devicePath,
    connectionGeneration,
    revision,
    selectionGeneration,
    definitionIdentity,
    mutationEpoch,
  } = payload as typeof payload & {
    selectionGeneration: number;
    definitionIdentity: string;
    mutationEpoch: number;
  };
  const current = state.byPath[devicePath];
  if (
    !current ||
    current.generation !== connectionGeneration ||
    current[domain].mutationEpoch !== mutationEpoch
  ) {
    return;
  }
  current[domain] = {
    status: 'fresh',
    observedRevision: revision,
    acceptedRevision: revision,
    mutationEpoch,
    foregroundWriteDepth: current[domain].foregroundWriteDepth,
    acceptedSelectionGeneration: selectionGeneration,
    acceptedDefinitionIdentity: definitionIdentity,
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
    beginForegroundMutation: (
      state,
      action: PayloadAction<{
        path: string;
        generation: number;
        domains: StateSyncDomain[];
      }>,
    ) => {
      const {path, generation, domains: affectedDomains} = action.payload;
      const current = state.byPath[path];
      if (!current || current.generation !== generation) {
        if (current && current.generation > generation) {
          return;
        }
        state.byPath[path] = initialPathSyncState(generation);
      }
      affectedDomains.forEach((domain) => {
        state.byPath[path][domain].mutationEpoch += 1;
        state.byPath[path][domain].status = 'dirty';
      });
    },
    beginForegroundWriteSession: (
      state,
      action: PayloadAction<{
        path: string;
        generation: number;
        domains: StateSyncDomain[];
      }>,
    ) => {
      const {path, generation, domains: affectedDomains} = action.payload;
      const current = state.byPath[path];
      if (!current || current.generation !== generation) {
        return;
      }
      affectedDomains.forEach((domain) => {
        current[domain].foregroundWriteDepth += 1;
      });
    },
    endForegroundWriteSession: (
      state,
      action: PayloadAction<{
        path: string;
        generation: number;
        domains: StateSyncDomain[];
      }>,
    ) => {
      const {path, generation, domains: affectedDomains} = action.payload;
      const current = state.byPath[path];
      if (!current || current.generation !== generation) {
        return;
      }
      affectedDomains.forEach((domain) => {
        current[domain].foregroundWriteDepth = Math.max(
          0,
          current[domain].foregroundWriteDepth - 1,
        );
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
  beginForegroundMutation,
  beginForegroundWriteSession,
  endForegroundWriteSession,
  setDomainStatus,
} = stateSyncSlice.actions;

export default stateSyncSlice.reducer;

const getStateSyncState = (state: RootState) => state.stateSync;
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
