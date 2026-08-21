import {KeyboardAPI} from '../utils/keyboard-api';
import {
  getExactMsFamily,
  isStateSyncOptIn,
  loadEraAdvancedMetadata,
} from '../utils/era-advanced-metadata';
import {
  ERA_STATE_SYNC_POLL_INTERVAL_MS,
  ERA_STATE_SYNC_REFRESH_RETRIES,
  isCapableStateSyncEnvelope,
  queryStateSyncEnvelope,
  type StateSyncRevisions,
} from '../utils/era-state-sync';
import type {ConnectedDevice} from '../types/types';
import type {AppThunk, RootState} from './index';
import {
  getIsSelectedDeviceReady,
  getSelectedConnectedDevice,
  getSelectedDevicePath,
} from './devicesSlice';
import {loadKeymapFromDevice} from './keymapSlice';
import {loadMacros} from './macrosSlice';
import {isVIADefinitionV3} from '@the-via/reader';
import {getDefinitionForDevice, loadLayoutOptions} from './definitionsSlice';
import {updateV3MenuData} from './menusSlice';
import {
  ensurePathSync,
  getConfigureVisible,
  getDocumentHidden,
  getPathSyncState,
  setDomainStatus,
  setPathCapability,
  setPathRevisions,
} from './stateSyncSlice';

const inFlightPoll = new Set<string>();
const inFlightRefresh = new Set<string>();
let pollTimer: ReturnType<typeof setInterval> | undefined;

const pollKey = (path: string, generation: number) => `${path}:${generation}`;

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
  return sync?.capability === 'capable' && sync.generation === new KeyboardAPI(path).getConnectionGeneration();
};

export const probeStateSyncForDevice =
  (connectedDevice: ConnectedDevice): AppThunk =>
  async (dispatch, getState) => {
    await loadEraAdvancedMetadata();
    if (!isStateSyncOptIn(connectedDevice.vendorProductId)) {
      return;
    }
    const api = new KeyboardAPI(connectedDevice.path);
    const generation = api.getConnectionGeneration();
    const existing = getPathSyncState(getState(), connectedDevice.path);
    if (
      existing?.generation === generation &&
      (existing.capability === 'capable' || existing.capability === 'unsupported')
    ) {
      return;
    }
    dispatch(ensurePathSync({path: connectedDevice.path, generation}));
    dispatch(
      setPathCapability({
        path: connectedDevice.path,
        generation,
        capability: 'probing',
      }),
    );
    const envelope = await queryStateSyncEnvelope(api);
    if (!api.isConnectionGenerationCurrent(generation)) {
      return;
    }
    if (!isCapableStateSyncEnvelope(envelope)) {
      dispatch(
        setPathCapability({
          path: connectedDevice.path,
          generation,
          capability: 'unsupported',
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
    dispatch(
      setPathRevisions({
        path: connectedDevice.path,
        generation,
        revisions: envelope!.revisions,
      }),
    );
    dispatch(
      setDomainStatus({
        path: connectedDevice.path,
        generation,
        domain: 'keymap',
        status: 'fresh',
        revision: envelope!.revisions.keymap,
      }),
    );
    dispatch(
      setDomainStatus({
        path: connectedDevice.path,
        generation,
        domain: 'macro',
        status: 'fresh',
        revision: envelope!.revisions.macro,
      }),
    );
    dispatch(
      setDomainStatus({
        path: connectedDevice.path,
        generation,
        domain: 'config',
        status: 'fresh',
        revision: envelope!.revisions.config,
      }),
    );
    const definition = getDefinitionForDevice(getState(), connectedDevice);
    if (isVIADefinitionV3(definition)) {
      await dispatch(updateV3MenuData(connectedDevice));
    }
    dispatch(syncPolling());
  };

const refreshDomain = async (
  dispatch: (action: any) => any,
  getState: () => RootState,
  device: ConnectedDevice,
  domain: 'keymap' | 'macro' | 'config',
  before: number,
) => {
  const api = new KeyboardAPI(device.path);
  const generation = api.getConnectionGeneration();
  dispatch(
    setDomainStatus({
      path: device.path,
      generation,
      domain,
      status: 'refreshing',
      revision: before,
    }),
  );
  for (let attempt = 0; attempt < ERA_STATE_SYNC_REFRESH_RETRIES; attempt++) {
    if (!api.isConnectionGenerationCurrent(generation)) {
      return;
    }
    if (domain === 'keymap') {
      await dispatch(loadKeymapFromDevice(device, {force: true}));
    } else if (domain === 'macro') {
      await dispatch(loadMacros(device));
    } else {
      await dispatch(loadLayoutOptions(device));
      const definition = getDefinitionForDevice(getState(), device);
      if (isVIADefinitionV3(definition)) {
        await dispatch(updateV3MenuData(device));
      }
    }
    const afterEnvelope = await queryStateSyncEnvelope(api);
    if (!api.isConnectionGenerationCurrent(generation)) {
      return;
    }
    if (!isCapableStateSyncEnvelope(afterEnvelope)) {
      dispatch(
        setDomainStatus({
          path: device.path,
          generation,
          domain,
          status: 'dirty',
        }),
      );
      return;
    }
    const after = afterEnvelope!.revisions[domain];
    if (after === before) {
      dispatch(
        setDomainStatus({
          path: device.path,
          generation,
          domain,
          status: 'fresh',
          revision: after,
        }),
      );
      dispatch(
        setPathRevisions({
          path: device.path,
          generation,
          revisions: afterEnvelope!.revisions,
        }),
      );
      return;
    }
    before = after;
  }
  dispatch(
    setDomainStatus({
      path: device.path,
      generation,
      domain,
      status: 'dirty',
    }),
  );
};

export const pollStateSync = (): AppThunk => async (dispatch, getState) => {
  if (!shouldPoll(getState)) {
    return;
  }
  const device = getSelectedConnectedDevice(getState());
  if (!device) {
    return;
  }
  const api = new KeyboardAPI(device.path);
  const generation = api.getConnectionGeneration();
  const key = pollKey(device.path, generation);
  if (inFlightPoll.has(key)) {
    return;
  }
  inFlightPoll.add(key);
  try {
    const envelope = await queryStateSyncEnvelope(api);
    if (!api.isConnectionGenerationCurrent(generation)) {
      return;
    }
    if (!isCapableStateSyncEnvelope(envelope)) {
      dispatch(
        setPathCapability({
          path: device.path,
          generation,
          capability: 'unsupported',
        }),
      );
      return;
    }
    const current = getPathSyncState(getState(), device.path);
    const previous = current?.revisions ?? {keymap: 0, macro: 0, config: 0};
    const next = envelope!.revisions;
    dispatch(
      setPathRevisions({path: device.path, generation, revisions: next}),
    );
    const domains: (keyof StateSyncRevisions)[] = ['keymap', 'macro', 'config'];
    for (const domain of domains) {
      if (previous[domain] !== next[domain]) {
        await refreshDomain(dispatch, getState, device, domain, next[domain]);
      }
    }
  } finally {
    inFlightPoll.delete(key);
  }
};

export const refreshAllDomains =
  (device: ConnectedDevice): AppThunk =>
  async (dispatch, getState) => {
    const api = new KeyboardAPI(device.path);
    const generation = api.getConnectionGeneration();
    const key = pollKey(device.path, generation);
    if (inFlightRefresh.has(key)) {
      return;
    }
    inFlightRefresh.add(key);
    try {
      const envelope = await queryStateSyncEnvelope(api);
      if (!isCapableStateSyncEnvelope(envelope) || !api.isConnectionGenerationCurrent(generation)) {
        return;
      }
      const revisions = envelope!.revisions;
      await refreshDomain(dispatch, getState, device, 'keymap', revisions.keymap);
      await refreshDomain(dispatch, getState, device, 'macro', revisions.macro);
      await refreshDomain(dispatch, getState, device, 'config', revisions.config);
    } finally {
      inFlightRefresh.delete(key);
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
  inFlightPoll.clear();
  inFlightRefresh.clear();
};

export const getExactMsFamilyForDevice = (vendorProductId: number) =>
  getExactMsFamily(vendorProductId);
