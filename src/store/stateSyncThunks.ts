import {isEraVIADefinitionV3} from '../utils/era-definition';
import type {DefinitionVersion} from '@the-via/reader';
import type {ConnectedDevice} from '../types/types';
import type {HIDPathReservationOwner} from '../shims/node-hid';
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
import type {UISyncRequest} from '../utils/ui-sync';
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
import {
  readV3MenuStateSyncCandidate,
  syncCustomMenuValuesFromRequest,
} from './menusSlice';
import {
  commitStableConfigCandidate,
  commitStableKeymapCandidate,
  commitStableMacroCandidate,
  invalidateStateSyncDomain,
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

type CoordinatorMode =
  | 'poll'
  | 'full'
  | 'keymap'
  | 'macro'
  | 'config';
type DomainCandidate =
  StateSyncKeymapCandidate | StateSyncMacroCandidate | StateSyncConfigCandidate;

type CoordinatorOwner = {
  fullPending: Set<StateSyncDomain>;
  processDirtyAfterPending: boolean;
  requireReady: boolean;
  selectionGeneration: number;
  definitionIdentity: string;
  initialEnvelope?: StateSyncEnvelope;
  transportOwner: HIDPathReservationOwner;
  promise: Promise<void>;
};

// Initial/foreground UX prioritises the immediately-visible keymap and custom
// controls. The large macro buffer is intentionally last and remains lazy until
// the Macro pane requests its first authoritative snapshot.
const domainOrder: StateSyncDomain[] = ['keymap', 'config', 'macro'];
const coordinatorOwners = new Map<string, CoordinatorOwner>();
let pollTimer: ReturnType<typeof setInterval> | undefined;

const ownerKey = (path: string, generation: number) => `${path}:${generation}`;

const isSelectedContextCurrent = (
  getState: () => RootState,
  api: KeyboardAPI,
  connectionGeneration: number,
  selectionGeneration: number,
  definitionIdentity?: string | null,
  requireReady = true,
) => {
  const state = getState();
  const device = getSelectedConnectedDevice(state);
  return (
    api.isConnectionGenerationCurrent(connectionGeneration) &&
    (!requireReady || getIsSelectedDeviceReady(state)) &&
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
  requireReady = true,
): Promise<StateSyncEnvelope | null> => {
  const result = await queryStateSync(api);
  if (
    !isSelectedContextCurrent(
      getState,
      api,
      generation,
      selectionGeneration,
      undefined,
      requireReady,
    )
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
  api: KeyboardAPI,
): Promise<DomainCandidate | null> => {
  if (domain === 'keymap') {
    return readKeymapStateSyncCandidate(device, state, generation, api);
  }
  if (domain === 'macro') {
    return readMacrosStateSyncCandidate(device, state, generation, api);
  }

  const layoutCandidate = await readLayoutOptionsStateSyncCandidate(
    device,
    state,
    generation,
    api,
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
    api,
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
  definitionIdentity: string,
  mutationEpoch: number,
  candidate: DomainCandidate,
) => {
  const context = {
    devicePath: device.path,
    connectionGeneration: generation,
    selectionGeneration,
    definitionIdentity,
    revision,
    mutationEpoch,
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
  transportOwner: HIDPathReservationOwner,
  requireReady: boolean,
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
    try {
      const result = await api.withPathReservation(
        generation,
        transportOwner,
        async (reservedApi): Promise<RefreshResult | 'retry'> => {
          if (
            getDefinitionSyncIdentity(getState(), device) !== definitionIdentity ||
            !isSelectedContextCurrent(
              getState,
              reservedApi,
              generation,
              selectionGeneration,
              definitionIdentity,
              requireReady,
            )
          ) {
            return 'abort';
          }

          const startEnvelope = await queryCapableEnvelope(
            dispatch,
            getState,
            reservedApi,
            generation,
            selectionGeneration,
            requireReady,
          );
          if (!startEnvelope) {
            return 'abort';
          }
          observeEnvelope(dispatch, device.path, generation, startEnvelope);
          const startRevision = startEnvelope.revisions[domain];
          const startSync = getPathSyncState(getState(), device.path);
          if (!startSync || startSync.generation !== generation) {
            return 'abort';
          }
          const mutationEpoch = startSync[domain].mutationEpoch;
          dispatch(
            setDomainStatus({
              path: device.path,
              generation,
              domain,
              status: 'refreshing',
              revision: startRevision,
            }),
          );

          const candidate = await readDomainCandidate(
            domain,
            device,
            getState(),
            generation,
            reservedApi,
          );
          if (
            candidate === null ||
            !isSelectedContextCurrent(
              getState,
              reservedApi,
              generation,
              selectionGeneration,
              definitionIdentity,
              requireReady,
            )
          ) {
            return 'abort';
          }

          const endEnvelope = await queryCapableEnvelope(
            dispatch,
            getState,
            reservedApi,
            generation,
            selectionGeneration,
            requireReady,
          );
          if (!endEnvelope) {
            return 'abort';
          }
          observeEnvelope(dispatch, device.path, generation, endEnvelope);
          const endRevision = endEnvelope.revisions[domain];
          const currentSync = getPathSyncState(getState(), device.path);
          if (
            startRevision !== endRevision ||
            !currentSync ||
            currentSync.generation !== generation ||
            currentSync[domain].mutationEpoch !== mutationEpoch
          ) {
            return 'retry';
          }
          if (
            !isSelectedContextCurrent(
              getState,
              reservedApi,
              generation,
              selectionGeneration,
              definitionIdentity,
              requireReady,
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
            definitionIdentity,
            mutationEpoch,
            candidate,
          );
          return 'stable';
        },
      );
      if (result === 'retry') {
        continue;
      }
      return result;
    } catch {
      if (
        isSelectedContextCurrent(
          getState,
          api,
          generation,
          selectionGeneration,
          definitionIdentity,
          requireReady,
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
        owner.requireReady,
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
      owner.definitionIdentity,
      owner.requireReady,
    )
  ) {
    const sync = getPathSyncState(getState(), device.path);
    if (!sync || sync.generation !== generation) {
      return;
    }
    const fullDomain = domainOrder.find((candidateDomain) =>
      owner.fullPending.has(candidateDomain),
    );
    const pollDomain = owner.processDirtyAfterPending
      ? domainOrder.find((candidateDomain) => {
          const candidate = sync[candidateDomain];
          // The macro buffer can be very large. Before the Macro pane has ever
          // requested an authoritative snapshot, revision polling observes its
          // token but does not eagerly pull the whole stock VIA buffer.
          const lazyMacroIsUninitialised =
            candidateDomain === 'macro' &&
            candidate.acceptedRevision === 0 &&
            candidate.mutationEpoch === 0;
          return (
            !lazyMacroIsUninitialised &&
            !processedPollDomains.has(candidateDomain) &&
            !exhaustedDomains.has(candidateDomain) &&
            (candidate.status !== 'fresh' ||
              candidate.acceptedRevision !== candidate.observedRevision)
          );
        })
      : undefined;
    const domain = fullDomain ?? pollDomain;
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
      owner.transportOwner,
      owner.requireReady,
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
  requireReady = true,
): Promise<void> => {
  const api = new KeyboardAPI(device.path);
  const generation = api.getConnectionGeneration();
  const selectionGeneration = getSelectionGeneration(getState());
  const definitionIdentity = getDefinitionSyncIdentity(getState(), device);
  if (
    !definitionIdentity ||
    !isSelectedContextCurrent(
      getState,
      api,
      generation,
      selectionGeneration,
      definitionIdentity,
      requireReady,
    )
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
      } else if (mode !== 'poll') {
        existing.fullPending.add(mode);
      }
      if (mode === 'full' || mode === 'poll') {
        existing.processDirtyAfterPending = true;
      }
      existing.requireReady = existing.requireReady && requireReady;
      await existing.promise;
      return;
    }
    await existing.promise;
    return coordinate(
      dispatch,
      getState,
      device,
      mode,
      initialEnvelope,
      requireReady,
    );
  }

  const owner: CoordinatorOwner = {
    fullPending: new Set(
      mode === 'full' ? domainOrder : mode === 'poll' ? [] : [mode],
    ),
    processDirtyAfterPending: mode === 'full' || mode === 'poll',
    requireReady,
    selectionGeneration,
    definitionIdentity,
    initialEnvelope,
    transportOwner: Symbol(`state-sync:${key}`),
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

export const probeStateSyncCapabilityForDevice =
  (connectedDevice: ConnectedDevice): AppThunk<Promise<boolean>> =>
  async (dispatch, getState) => {
    await loadEraAdvancedMetadata();
    if (
      !isStateSyncOptIn(connectedDevice.vendorProductId) ||
      getDefinitionSourceForDevice(getState(), connectedDevice) !== 'era'
    ) {
      return false;
    }
    const api = new KeyboardAPI(connectedDevice.path);
    const generation = api.getConnectionGeneration();
    const existing = getPathSyncState(getState(), connectedDevice.path);
    if (existing?.generation === generation) {
      if (existing.capability === 'unverified') {
        return false;
      }
      if (existing.capability === 'capable') {
        return true;
      }
      if (existing.capability === 'probing') {
        return false;
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
      return false;
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
      return false;
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
    return true;
  };

export const probeStateSyncForDevice =
  (connectedDevice: ConnectedDevice): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const capable = await dispatch(
      probeStateSyncCapabilityForDevice(connectedDevice),
    );
    if (!capable) {
      return;
    }
    const api = new KeyboardAPI(connectedDevice.path);
    const generation = api.getConnectionGeneration();
    const selectionGeneration = getSelectionGeneration(getState());
    if (
      isSelectedContextCurrent(getState, api, generation, selectionGeneration)
    ) {
      dispatch(markPathDirty({path: connectedDevice.path, generation}));
      await coordinate(
        dispatch,
        getState,
        connectedDevice,
        'full',
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

const isAcceptedDomainCurrent = (
  state: RootState,
  device: ConnectedDevice,
  domain: StateSyncDomain,
) => {
  const api = new KeyboardAPI(device.path);
  const generation = api.getConnectionGeneration();
  const selectionGeneration = getSelectionGeneration(state);
  const definitionIdentity = getDefinitionSyncIdentity(state, device);
  const sync = getPathSyncState(state, device.path);
  const domainState = sync?.[domain];
  return (
    !!definitionIdentity &&
    sync?.capability === 'capable' &&
    sync.generation === generation &&
    domainState?.status === 'fresh' &&
    domainState.acceptedRevision !== 0 &&
    domainState.acceptedRevision === domainState.observedRevision &&
    domainState.acceptedSelectionGeneration === selectionGeneration &&
    domainState.acceptedDefinitionIdentity === definitionIdentity
  );
};

export const refreshStateSyncDomain =
  (
    device: ConnectedDevice,
    domain: StateSyncDomain,
    options: {allowBeforeReady?: boolean} = {},
  ): AppThunk<Promise<boolean>> =>
  async (dispatch, getState) => {
    const api = new KeyboardAPI(device.path);
    const generation = api.getConnectionGeneration();
    const sync = getPathSyncState(getState(), device.path);
    if (sync?.capability !== 'capable' || sync.generation !== generation) {
      return false;
    }
    await coordinate(
      dispatch,
      getState,
      device,
      domain,
      undefined,
      !options.allowBeforeReady,
    );
    return isAcceptedDomainCurrent(getState(), device, domain);
  };

export const refreshMacroDomain =
  (device: ConnectedDevice): AppThunk<Promise<boolean>> =>
  (dispatch) => dispatch(refreshStateSyncDomain(device, 'macro'));

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

export const refreshConfigDomain =
  (device: ConnectedDevice): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const api = new KeyboardAPI(device.path);
    const generation = api.getConnectionGeneration();
    const sync = getPathSyncState(getState(), device.path);
    if (sync?.capability !== 'capable' || sync.generation !== generation) {
      return;
    }
    dispatch(
      invalidateStateSyncDomain({
        devicePath: device.path,
        connectionGeneration: generation,
        domain: 'config',
      }),
    );
    await coordinate(dispatch, getState, device, 'config');
  };

export const handleUISyncRequest =
  ({
    devicePath,
    connectionGeneration,
    request,
  }: {
    devicePath: string;
    connectionGeneration: number;
    request: UISyncRequest;
  }): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    await loadEraAdvancedMetadata();
    const state = getState();
    const device = state.devices.connectedDevicePaths[devicePath];
    if (!device) {
      return;
    }
    const api = new KeyboardAPI(devicePath);
    if (!api.isConnectionGenerationCurrent(connectionGeneration)) {
      return;
    }

    const isTrustedOptIn =
      getDefinitionSourceForDevice(state, device) === 'era' &&
      isStateSyncOptIn(device.vendorProductId);
    if (!isTrustedOptIn) {
      await dispatch(
        syncCustomMenuValuesFromRequest({
          devicePath,
          connectionGeneration,
          request,
        }),
      );
      return;
    }

    dispatch(ensurePathSync({path: devicePath, generation: connectionGeneration}));
    dispatch(
      invalidateStateSyncDomain({
        devicePath,
        connectionGeneration,
        domain: 'config',
      }),
    );
    const sync = getPathSyncState(getState(), devicePath);
    if (
      sync?.generation === connectionGeneration &&
      sync.capability === 'capable'
    ) {
      await coordinate(dispatch, getState, device, 'config');
    }
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
