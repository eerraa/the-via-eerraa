import {isEraVIADefinitionV3} from '../utils/era-definition';
import type {DefinitionVersion} from '@the-via/reader';
import type {ConnectedDevice} from '../types/types';
import {KeyboardAPI} from '../utils/keyboard-api';
import {
  isStateSyncOptIn,
  loadEraAdvancedMetadata,
} from '../utils/era-advanced-metadata';
import {
  ERA_STATE_SYNC_POLL_INTERVAL_MS,
  ERA_STATE_SYNC_REFRESH_RETRIES,
  isCapableStateSyncEnvelope,
  queryStateSync,
  type StateSyncEnvelope,
} from '../utils/era-state-sync';
import {
  getDefinitionForDevice,
  getDefinitionSourceForDevice,
  getDefinitionSyncIdentity,
  readLayoutOptionsStateSyncCandidate,
  unloadCustomDefinition,
} from './definitionsSlice';
import {
  getIsSelectedDeviceReady,
  getSelectedConnectedDevice,
  getSelectedDevicePath,
  getSelectionGeneration,
  isSelectedDeviceOperationCurrent,
} from './devicesSlice';
import type {AppThunk, RootState} from './index';
import {readKeymapStateSyncCandidate} from './keymapSlice';
import {readMacrosStateSyncCandidate} from './macrosSlice';
import {readV3MenuStateSyncCandidate} from './menusSlice';
import {
  commitStableConfigCandidate,
  commitStableKeymapCandidate,
  commitStableMacroCandidate,
  type StateSyncConfigCandidate,
  type StateSyncKeymapCandidate,
  type StateSyncMacroCandidate,
} from './stateSyncCandidateActions';
import {
  ensurePathSync,
  getConfigureVisible,
  getDocumentHidden,
  getPathSyncState,
  markPathDirty,
  observePathRevisions,
  setDomainStatus,
  setPathCapability,
  type StateSyncDomain,
} from './stateSyncSlice';

type CoordinatorMode = 'poll' | 'full';
type DomainCandidate =
  StateSyncKeymapCandidate | StateSyncMacroCandidate | StateSyncConfigCandidate;

type CoordinatorOwner = {
  fullPending: Set<StateSyncDomain>;
  selectionGeneration: number;
  definitionIdentity: string;
  initialEnvelope?: StateSyncEnvelope;
  promise: Promise<void>;
};

const domainOrder: StateSyncDomain[] = ['keymap', 'macro', 'config'];
const coordinatorOwners = new Map<string, CoordinatorOwner>();
let pollTimer: ReturnType<typeof setInterval> | undefined;

const ownerKey = (path: string, generation: number) => `${path}:${generation}`;

const isSelectedContextCurrent = (
  getState: () => RootState,
  api: KeyboardAPI,
  connectionGeneration: number,
  selectionGeneration: number,
  definitionIdentity?: string | null,
) => {
  const state = getState();
  const device = getSelectedConnectedDevice(state);
  return (
    api.isConnectionGenerationCurrent(connectionGeneration) &&
    getIsSelectedDeviceReady(state) &&
    isSelectedDeviceOperationCurrent(
      state,
      api.kbAddr,
      connectionGeneration,
      selectionGeneration,
    ) &&
    (definitionIdentity === undefined ||
      (!!device &&
        getDefinitionSyncIdentity(state, device) === definitionIdentity))
  );
};

const shouldPoll = (getState: () => RootState) => {
  const state = getState();
  const path = getSelectedDevicePath(state);
  const device = getSelectedConnectedDevice(state);
  if (!path || !device || !getIsSelectedDeviceReady(state)) {
    return false;
  }
  if (!getConfigureVisible(state) || getDocumentHidden(state)) {
    return false;
  }
  const sync = getPathSyncState(state, path);
  return (
    sync?.capability === 'capable' &&
    sync.generation === new KeyboardAPI(path).getConnectionGeneration()
  );
};

const observeEnvelope = (
  dispatch: (action: any) => any,
  path: string,
  generation: number,
  envelope: StateSyncEnvelope,
) => {
  dispatch(
    observePathRevisions({
      path,
      generation,
      revisions: envelope.revisions,
    }),
  );
};

const queryCapableEnvelope = async (
  dispatch: (action: any) => any,
  getState: () => RootState,
  api: KeyboardAPI,
  generation: number,
  selectionGeneration: number,
): Promise<StateSyncEnvelope | null> => {
  const result = await queryStateSync(api);
  if (
    !isSelectedContextCurrent(getState, api, generation, selectionGeneration)
  ) {
    return null;
  }
  if (
    result.kind === 'envelope' &&
    isCapableStateSyncEnvelope(result.envelope)
  ) {
    return result.envelope;
  }

  // Capability is a connection-level fact once confirmed. A later timeout,
  // malformed reply, or isolated unhandled response invalidates freshness but
  // does not permanently demote this generation to legacy mode.
  dispatch(markPathDirty({path: api.kbAddr, generation}));
  return null;
};

const readDomainCandidate = async (
  domain: StateSyncDomain,
  device: ConnectedDevice,
  state: RootState,
  generation: number,
): Promise<DomainCandidate | null> => {
  if (domain === 'keymap') {
    return readKeymapStateSyncCandidate(device, state, generation);
  }
  if (domain === 'macro') {
    return readMacrosStateSyncCandidate(device, state, generation);
  }

  const layoutCandidate = await readLayoutOptionsStateSyncCandidate(
    device,
    state,
    generation,
  );
  if (layoutCandidate === null) {
    return null;
  }
  const definition = getDefinitionForDevice(state, device);
  if (!isEraVIADefinitionV3(definition)) {
    return layoutCandidate;
  }
  const menuCandidate = await readV3MenuStateSyncCandidate(
    device,
    state,
    generation,
  );
  return menuCandidate === null ? null : {...layoutCandidate, ...menuCandidate};
};

const commitStableCandidate = (
  dispatch: (action: any) => any,
  device: ConnectedDevice,
  generation: number,
  selectionGeneration: number,
  domain: StateSyncDomain,
  revision: number,
  candidate: DomainCandidate,
) => {
  const context = {
    devicePath: device.path,
    connectionGeneration: generation,
    selectionGeneration,
    revision,
  };
  if (domain === 'keymap') {
    dispatch(
      commitStableKeymapCandidate({
        ...context,
        candidate: candidate as StateSyncKeymapCandidate,
      }),
    );
  } else if (domain === 'macro') {
    dispatch(
      commitStableMacroCandidate({
        ...context,
        candidate: candidate as StateSyncMacroCandidate,
      }),
    );
  } else {
    dispatch(
      commitStableConfigCandidate({
        ...context,
        candidate: candidate as StateSyncConfigCandidate,
      }),
    );
  }
};

type RefreshResult = 'stable' | 'unstable' | 'abort';

const refreshDomain = async (
  dispatch: (action: any) => any,
  getState: () => RootState,
  device: ConnectedDevice,
  domain: StateSyncDomain,
  generation: number,
  selectionGeneration: number,
): Promise<RefreshResult> => {
  const api = new KeyboardAPI(device.path);
  const definitionIdentity = getDefinitionSyncIdentity(getState(), device);
  if (definitionIdentity === null) {
    dispatch(
      setDomainStatus({
        path: device.path,
        generation,
        domain,
        status: 'dirty',
      }),
    );
    return 'abort';
  }
  for (let attempt = 0; attempt < ERA_STATE_SYNC_REFRESH_RETRIES; attempt++) {
    if (getDefinitionSyncIdentity(getState(), device) !== definitionIdentity) {
      dispatch(
        setDomainStatus({
          path: device.path,
          generation,
          domain,
          status: 'dirty',
        }),
      );
      return 'abort';
    }
    const startEnvelope = await queryCapableEnvelope(
      dispatch,
      getState,
      api,
      generation,
      selectionGeneration,
    );
    if (!startEnvelope) {
      return 'abort';
    }
    observeEnvelope(dispatch, device.path, generation, startEnvelope);
    const startRevision = startEnvelope.revisions[domain];
    dispatch(
      setDomainStatus({
        path: device.path,
        generation,
        domain,
        status: 'refreshing',
        revision: startRevision,
      }),
    );

    let candidate: DomainCandidate | null;
    try {
      candidate = await readDomainCandidate(
        domain,
        device,
        getState(),
        generation,
      );
    } catch {
      if (
        isSelectedContextCurrent(
          getState,
          api,
          generation,
          selectionGeneration,
          definitionIdentity,
        )
      ) {
        dispatch(
          setDomainStatus({
            path: device.path,
            generation,
            domain,
            status: 'dirty',
          }),
        );
      }
      return 'abort';
    }
    if (
      candidate === null ||
      !isSelectedContextCurrent(
        getState,
        api,
        generation,
        selectionGeneration,
        definitionIdentity,
      )
    ) {
      return 'abort';
    }

    const endEnvelope = await queryCapableEnvelope(
      dispatch,
      getState,
      api,
      generation,
      selectionGeneration,
    );
    if (!endEnvelope) {
      return 'abort';
    }
    observeEnvelope(dispatch, device.path, generation, endEnvelope);
    const endRevision = endEnvelope.revisions[domain];
    if (startRevision !== endRevision) {
      continue;
    }
    if (
      !isSelectedContextCurrent(
        getState,
        api,
        generation,
        selectionGeneration,
        definitionIdentity,
      )
    ) {
      return 'abort';
    }
    commitStableCandidate(
      dispatch,
      device,
      generation,
      selectionGeneration,
      domain,
      endRevision,
      candidate,
    );
    return 'stable';
  }

  dispatch(
    setDomainStatus({
      path: device.path,
      generation,
      domain,
      status: 'dirty',
    }),
  );
  return 'unstable';
};

const runCoordinatorOwner = async (
  owner: CoordinatorOwner,
  dispatch: (action: any) => any,
  getState: () => RootState,
  device: ConnectedDevice,
  generation: number,
) => {
  const api = new KeyboardAPI(device.path);
  let envelope = owner.initialEnvelope;
  owner.initialEnvelope = undefined;
  if (!envelope) {
    envelope =
      (await queryCapableEnvelope(
        dispatch,
        getState,
        api,
        generation,
        owner.selectionGeneration,
      )) ?? undefined;
  }
  if (!envelope) {
    return;
  }
  observeEnvelope(dispatch, device.path, generation, envelope);

  const processedPollDomains = new Set<StateSyncDomain>();
  const exhaustedDomains = new Set<StateSyncDomain>();
  while (
    isSelectedContextCurrent(
      getState,
      api,
      generation,
      owner.selectionGeneration,
    )
  ) {
    const sync = getPathSyncState(getState(), device.path);
    if (!sync || sync.generation !== generation) {
      return;
    }
    const fullDomain = domainOrder.find((candidateDomain) =>
      owner.fullPending.has(candidateDomain),
    );
    const domain =
      fullDomain ??
      domainOrder.find(
        (candidateDomain) =>
          !processedPollDomains.has(candidateDomain) &&
          !exhaustedDomains.has(candidateDomain) &&
          (sync[candidateDomain].status !== 'fresh' ||
            sync[candidateDomain].acceptedRevision !==
              sync[candidateDomain].observedRevision),
      );
    if (!domain) {
      return;
    }
    if (fullDomain) {
      // Delete before the read. A lifecycle full refresh that arrives while
      // this domain is in flight adds it again, forcing a post-boundary read.
      owner.fullPending.delete(domain);
    } else {
      processedPollDomains.add(domain);
    }
    const result = await refreshDomain(
      dispatch,
      getState,
      device,
      domain,
      generation,
      owner.selectionGeneration,
    );
    if (result === 'abort') {
      return;
    }
    if (result === 'unstable') {
      exhaustedDomains.add(domain);
    }
  }
};

const coordinate = async (
  dispatch: (action: any) => any,
  getState: () => RootState,
  device: ConnectedDevice,
  mode: CoordinatorMode,
  initialEnvelope?: StateSyncEnvelope,
): Promise<void> => {
  const api = new KeyboardAPI(device.path);
  const generation = api.getConnectionGeneration();
  const selectionGeneration = getSelectionGeneration(getState());
  const definitionIdentity = getDefinitionSyncIdentity(getState(), device);
  if (
    !definitionIdentity ||
    !isSelectedContextCurrent(getState, api, generation, selectionGeneration)
  ) {
    return;
  }
  const key = ownerKey(device.path, generation);
  const existing = coordinatorOwners.get(key);
  if (existing) {
    if (
      existing.selectionGeneration === selectionGeneration &&
      existing.definitionIdentity === definitionIdentity
    ) {
      if (mode === 'full') {
        domainOrder.forEach((domain) => existing.fullPending.add(domain));
      }
      await existing.promise;
      return;
    }
    await existing.promise;
    return coordinate(dispatch, getState, device, mode, initialEnvelope);
  }

  const owner: CoordinatorOwner = {
    fullPending: new Set(mode === 'full' ? domainOrder : []),
    selectionGeneration,
    definitionIdentity,
    initialEnvelope,
    promise: Promise.resolve(),
  };
  coordinatorOwners.set(key, owner);
  owner.promise = Promise.resolve()
    .then(() =>
      runCoordinatorOwner(owner, dispatch, getState, device, generation),
    )
    .finally(() => {
      if (coordinatorOwners.get(key) === owner) {
        coordinatorOwners.delete(key);
      }
    });
  await owner.promise;
};

export const probeStateSyncForDevice =
  (connectedDevice: ConnectedDevice): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    await loadEraAdvancedMetadata();
    if (
      !isStateSyncOptIn(connectedDevice.vendorProductId) ||
      getDefinitionSourceForDevice(getState(), connectedDevice) !== 'era'
    ) {
      return;
    }
    const api = new KeyboardAPI(connectedDevice.path);
    const generation = api.getConnectionGeneration();
    const existing = getPathSyncState(getState(), connectedDevice.path);
    if (existing?.generation === generation) {
      if (existing.capability === 'unverified') {
        return;
      }
      if (existing.capability === 'capable') {
        const selectionGeneration = getSelectionGeneration(getState());
        if (
          isSelectedContextCurrent(
            getState,
            api,
            generation,
            selectionGeneration,
          )
        ) {
          dispatch(markPathDirty({path: connectedDevice.path, generation}));
          await coordinate(dispatch, getState, connectedDevice, 'full');
        }
        dispatch(syncPolling());
        return;
      }
      if (existing.capability === 'probing') {
        return;
      }
    }

    dispatch(ensurePathSync({path: connectedDevice.path, generation}));
    dispatch(
      setPathCapability({
        path: connectedDevice.path,
        generation,
        capability: 'probing',
      }),
    );
    const result = await queryStateSync(api);
    if (!api.isConnectionGenerationCurrent(generation)) {
      return;
    }
    if (
      result.kind !== 'envelope' ||
      !isCapableStateSyncEnvelope(result.envelope)
    ) {
      dispatch(
        setPathCapability({
          path: connectedDevice.path,
          generation,
          capability: 'unverified',
        }),
      );
      return;
    }

    dispatch(
      setPathCapability({
        path: connectedDevice.path,
        generation,
        capability: 'capable',
      }),
    );
    observeEnvelope(
      dispatch,
      connectedDevice.path,
      generation,
      result.envelope,
    );
    const selectionGeneration = getSelectionGeneration(getState());
    if (
      isSelectedContextCurrent(getState, api, generation, selectionGeneration)
    ) {
      await coordinate(
        dispatch,
        getState,
        connectedDevice,
        'full',
        result.envelope,
      );
    }
    dispatch(syncPolling());
  };

export const pollStateSync =
  (): AppThunk<Promise<void>> => async (dispatch, getState) => {
    if (!shouldPoll(getState)) {
      return;
    }
    const device = getSelectedConnectedDevice(getState());
    if (device) {
      await coordinate(dispatch, getState, device, 'poll');
    }
  };

export const refreshAfterDefinitionChange =
  (vendorProductId: number): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const device = getSelectedConnectedDevice(getState());
    if (!device || device.vendorProductId !== vendorProductId) {
      return;
    }
    const api = new KeyboardAPI(device.path);
    const generation = api.getConnectionGeneration();
    const sync = getPathSyncState(getState(), device.path);
    dispatch(markPathDirty({path: device.path, generation}));
    if (sync?.capability === 'capable' && sync.generation === generation) {
      await dispatch(refreshAllDomains(device));
    }
  };

export const unloadCustomDefinitionWithRefresh =
  (payload: {
    id: number;
    version: DefinitionVersion;
  }): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const selected = getSelectedConnectedDevice(getState());
    const before =
      selected?.vendorProductId === payload.id
        ? getDefinitionSyncIdentity(getState(), selected)
        : null;
    dispatch(unloadCustomDefinition(payload));
    const after =
      selected?.vendorProductId === payload.id
        ? getDefinitionSyncIdentity(getState(), selected)
        : null;
    if (before !== after) {
      await dispatch(refreshAfterDefinitionChange(payload.id));
    }
  };

export const refreshAllDomains =
  (device: ConnectedDevice): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const api = new KeyboardAPI(device.path);
    const generation = api.getConnectionGeneration();
    const sync = getPathSyncState(getState(), device.path);
    if (sync?.capability !== 'capable' || sync.generation !== generation) {
      return;
    }
    dispatch(markPathDirty({path: device.path, generation}));
    await coordinate(dispatch, getState, device, 'full');
  };

export const syncPolling = (): AppThunk => (dispatch, getState) => {
  const active = shouldPoll(getState);
  if (!active) {
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
    return;
  }
  if (pollTimer === undefined) {
    void dispatch(pollStateSync());
    pollTimer = setInterval(() => {
      void dispatch(pollStateSync());
    }, ERA_STATE_SYNC_POLL_INTERVAL_MS);
  }
};

export const stopStateSyncPollingForTesting = () => {
  if (pollTimer !== undefined) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
  coordinatorOwners.clear();
};
