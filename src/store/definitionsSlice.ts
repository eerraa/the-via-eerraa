import {createSelector, createSlice, PayloadAction} from '@reduxjs/toolkit';
import type {
  AuthorizedDevice,
  AuthorizedDevices,
  ConnectedDevice,
  ConnectedDevices,
} from '../types/types';
import {
  bytesIntoNum,
  numIntoBytes,
  packBits,
  unpackBits,
} from '../utils/bit-pack';
import {KeyboardAPI, KeyboardValue} from '../utils/keyboard-api';
import type {
  DefinitionVersion,
  DefinitionVersionMap,
  KeyboardDictionary,
  VIADefinitionV2,
  VIADefinitionV3,
  VIAKey,
} from '@the-via/reader';
import type {AppThunk, RootState} from './index';
import {
  getSelectedDevicePath,
  getSelectedConnectedDevice,
  ensureSupportedIds,
  getSelectedKeyboardAPI,
} from './devicesSlice';
import {fetchBundledDefinition} from 'src/utils/device-store';
import {isEraBundledDefinition} from 'src/utils/era-advanced-metadata';
import {mergeDefinitionLookup} from 'src/utils/definition-priority';
import {getBasicKeyDict} from 'src/utils/key-to-byte/dictionary-store';
import {getByteToKey} from 'src/utils/key';
import {del, entries, setMany, update} from 'idb-keyval';
import {isFulfilledPromise} from 'src/utils/type-predicates';
import {extractDeviceInfo, logAppError} from './errorsSlice';
import {getSelectedKeycodesVersion} from './firmwareSlice';
import {
  commitStableConfigCandidate,
  invalidateStateSyncDomain,
  type StateSyncConfigCandidate,
} from './stateSyncCandidateActions';

type LayoutOption = number;
type LayoutOptionsMap = {[devicePath: string]: LayoutOption[] | null}; // TODO: is this null valid?

// TODO: should we use some redux local storage action instead of our custom via-app-store/device-store caching for definitions?
type DefinitionsState = {
  definitions: KeyboardDictionary;
  customDefinitions: KeyboardDictionary;
  eraDefinitions: KeyboardDictionary;
  layoutOptionsMap: LayoutOptionsMap;
  definitionEpochs: Record<string, number>;
};

const initialState: DefinitionsState = {
  definitions: {},
  customDefinitions: {},
  eraDefinitions: {},
  layoutOptionsMap: {},
  definitionEpochs: {},
};

const definitionVersions = ['v2', 'v3'] as const;
const definitionEpochKey = (id: number, version: DefinitionVersion) =>
  `${id}:${version}`;
const effectiveDefinition = (
  state: DefinitionsState,
  id: number,
  version: DefinitionVersion,
) =>
  state.eraDefinitions[id]?.[version] ??
  state.definitions[id]?.[version] ??
  state.customDefinitions[id]?.[version];
const bumpEffectiveDefinitionEpoch = (
  state: DefinitionsState,
  id: number,
  version: DefinitionVersion,
) => {
  const key = definitionEpochKey(id, version);
  state.definitionEpochs[key] = (state.definitionEpochs[key] ?? 0) + 1;
};
const replaceDefinitionSource = (
  state: DefinitionsState,
  source: 'definitions' | 'eraDefinitions',
  incoming: KeyboardDictionary,
) => {
  Object.entries(incoming).forEach(([rawId, definitionMap]) => {
    const id = Number(rawId);
    const before = Object.fromEntries(
      definitionVersions.map((version) => [
        version,
        effectiveDefinition(state, id, version),
      ]),
    );
    state[source][id] = {...state[source][id], ...definitionMap};
    definitionVersions.forEach((version) => {
      if (before[version] !== effectiveDefinition(state, id, version)) {
        bumpEffectiveDefinitionEpoch(state, id, version);
      }
    });
  });
};

const definitionsSlice = createSlice({
  name: 'definitions',
  initialState,
  reducers: {
    updateDefinitions: (state, action: PayloadAction<KeyboardDictionary>) => {
      replaceDefinitionSource(state, 'definitions', action.payload);
    },
    updateEraDefinitions: (state, action: PayloadAction<KeyboardDictionary>) => {
      replaceDefinitionSource(state, 'eraDefinitions', action.payload);
    },
    loadInitialCustomDefinitions: (
      state,
      action: PayloadAction<KeyboardDictionary>,
    ) => {
      const affectedIds = new Set([
        ...Object.keys(state.customDefinitions).map(Number),
        ...Object.keys(action.payload).map(Number),
      ]);
      const before = new Map(
        Array.from(affectedIds).flatMap((id) =>
          definitionVersions.map((version) => [
            definitionEpochKey(id, version),
            effectiveDefinition(state, id, version),
          ] as const),
        ),
      );
      state.customDefinitions = action.payload;
      affectedIds.forEach((id) =>
        definitionVersions.forEach((version) => {
          if (
            before.get(definitionEpochKey(id, version)) !==
            effectiveDefinition(state, id, version)
          ) {
            bumpEffectiveDefinitionEpoch(state, id, version);
          }
        }),
      );
    },
    unloadCustomDefinition: (
      state,
      action: PayloadAction<{
        id: number;
        version: DefinitionVersion;
      }>,
    ) => {
      const {version, id} = action.payload;
      const definitionEntry = state.customDefinitions[id];
      if (!definitionEntry) {
        return;
      }
      const before = effectiveDefinition(state, id, version);
      if (Object.keys(definitionEntry).length === 1) {
        delete state.customDefinitions[id];
        try {
          void del(id);
        } catch {
          // IndexedDB is absent in some test/host environments.
        }
      } else {
        delete definitionEntry[version];
        try {
          void update(id, (d) => {
            delete d[version];
            return d;
          });
        } catch {
          // IndexedDB is absent in some test/host environments.
        }
      }
      state.customDefinitions = {...state.customDefinitions};
      if (before !== effectiveDefinition(state, id, version)) {
        bumpEffectiveDefinitionEpoch(state, id, version);
      }
    },
    loadCustomDefinitions: (
      state,
      action: PayloadAction<{
        definitions: (VIADefinitionV2 | VIADefinitionV3)[];
        version: DefinitionVersion;
      }>,
    ) => {
      const {version, definitions} = action.payload;
      definitions.forEach((definition) => {
        const before = effectiveDefinition(
          state,
          definition.vendorProductId,
          version,
        );
        const definitionEntry =
          state.customDefinitions[definition.vendorProductId] ?? {};
        if (version === 'v2') {
          definitionEntry[version] = definition as VIADefinitionV2;
        } else {
          definitionEntry[version] = definition as VIADefinitionV3;
        }
        state.customDefinitions[definition.vendorProductId] = definitionEntry;
        if (
          before !==
          effectiveDefinition(state, definition.vendorProductId, version)
        ) {
          bumpEffectiveDefinitionEpoch(
            state,
            definition.vendorProductId,
            version,
          );
        }
      });
    },
    updateLayoutOptions: (state, action: PayloadAction<LayoutOptionsMap>) => {
      state.layoutOptionsMap = {...state.layoutOptionsMap, ...action.payload};
    },
  },
  extraReducers: (builder) => {
    builder.addCase(commitStableConfigCandidate, (state, action) => {
      const {devicePath, candidate} = action.payload;
      if (candidate.layoutOptions !== undefined) {
        state.layoutOptionsMap[devicePath] = candidate.layoutOptions;
      }
    });
  },
});

export const {
  loadCustomDefinitions,
  loadInitialCustomDefinitions,
  updateDefinitions,
  updateEraDefinitions,
  unloadCustomDefinition,
  updateLayoutOptions,
} = definitionsSlice.actions;

export default definitionsSlice.reducer;

export const getBaseDefinitions = (state: RootState) =>
  state.definitions.definitions;
export const getCustomDefinitions = (state: RootState) =>
  state.definitions.customDefinitions;
export const getEraDefinitions = (state: RootState) =>
  state.definitions.eraDefinitions;
export const getLayoutOptionsMap = (state: RootState) =>
  state.definitions.layoutOptionsMap;

export const getDefinitions = createSelector(
  getBaseDefinitions,
  getCustomDefinitions,
  getEraDefinitions,
  (official, sideload, era) => mergeDefinitionLookup(official, sideload, era),
);

export const getSelectedDefinition = createSelector(
  getDefinitions,
  getSelectedConnectedDevice,
  (definitions, connectedDevice) =>
    connectedDevice &&
    definitions &&
    definitions[connectedDevice.vendorProductId] &&
    definitions[connectedDevice.vendorProductId][
      connectedDevice.requiredDefinitionVersion
    ],
);

export const getDefinitionForDevice = (
  state: RootState,
  connectedDevice: ConnectedDevice | AuthorizedDevice,
) =>
  getDefinitions(state)?.[connectedDevice.vendorProductId]?.[
    connectedDevice.requiredDefinitionVersion
  ];

type DefinitionSource = 'era' | 'official' | 'upload';

export const getDefinitionSourceForDevice = (
  state: RootState,
  connectedDevice: ConnectedDevice | AuthorizedDevice,
): DefinitionSource | null => {
  const id = connectedDevice.vendorProductId;
  const version = connectedDevice.requiredDefinitionVersion;
  if (state.definitions.eraDefinitions[id]?.[version]) {
    return 'era';
  }
  if (state.definitions.definitions[id]?.[version]) {
    return 'official';
  }
  if (state.definitions.customDefinitions[id]?.[version]) {
    return 'upload';
  }
  return null;
};

export const getDefinitionSyncIdentity = (
  state: RootState,
  connectedDevice: ConnectedDevice | AuthorizedDevice | null | undefined,
) => {
  if (!connectedDevice) {
    return null;
  }
  const definition = getDefinitionForDevice(state, connectedDevice);
  if (!definition) {
    return null;
  }
  return definitionEpochKey(
    connectedDevice.vendorProductId,
    connectedDevice.requiredDefinitionVersion,
  ) +
    `:${
      state.definitions.definitionEpochs[
        definitionEpochKey(
          connectedDevice.vendorProductId,
          connectedDevice.requiredDefinitionVersion,
        )
      ] ?? 0
    }`;
};

export const getBasicKeyToByte = createSelector(
  getSelectedConnectedDevice,
  getSelectedKeycodesVersion,
  (connectedDevice, keycodesVersion) => {
    const basicKeyToByte = getBasicKeyDict(
      connectedDevice ? connectedDevice.protocol : 0,
      keycodesVersion,
    );
    return {basicKeyToByte, byteToKey: getByteToKey(basicKeyToByte)};
  },
);

export const getSelectedLayoutOptions = createSelector(
  getSelectedDefinition,
  getLayoutOptionsMap,
  getSelectedDevicePath,
  (definition, map, path) =>
    (path && map[path]) ||
    (definition &&
      definition.layouts.labels &&
      definition.layouts.labels.map((_) => 0)) ||
    [],
);

export const getSelectedOptionKeys = createSelector(
  getSelectedLayoutOptions,
  getSelectedDefinition,
  (layoutOptions, definition) =>
    (definition
      ? layoutOptions.flatMap(
          (option, idx) =>
            (definition.layouts.optionKeys[idx] &&
              definition.layouts.optionKeys[idx][option]) ||
            [],
        )
      : []) as VIAKey[],
);

export const getSelectedKeyDefinitions = createSelector(
  getSelectedDefinition,
  getSelectedOptionKeys,
  (definition, optionKeys) => {
    if (definition && optionKeys) {
      return definition.layouts.keys.concat(optionKeys);
    }
    return [];
  },
);

export const updateLayoutOption =
  (index: number, val: number): AppThunk =>
  async (dispatch, getState) => {
    const state = getState();
    const definition = getSelectedDefinition(state);
    const api = getSelectedKeyboardAPI(state);
    const path = getSelectedDevicePath(state);

    if (!definition || !api || !path || !definition.layouts.labels) {
      return;
    }
    const connectionGeneration = api.getConnectionGeneration();

    const optionsNums = definition.layouts.labels.map((layoutLabel) =>
      Array.isArray(layoutLabel) ? layoutLabel.slice(1).length : 2,
    );

    // Clone the existing options into a new array so it can be modified with
    // the new layout index
    const options = [...getSelectedLayoutOptions(state)];
    options[index] = val;

    const bytes = numIntoBytes(
      packBits(options.map((option, idx) => [option, optionsNums[idx]])),
    );

    try {
      await api.setKeyboardValue(KeyboardValue.LAYOUT_OPTIONS, ...bytes);
    } catch (error) {
      console.warn('Setting layout option command not working', error);
      dispatch(
        invalidateStateSyncDomain({
          devicePath: path,
          connectionGeneration,
          domain: 'config',
        }),
      );
      return;
    }

    if (!api.isConnectionGenerationCurrent(connectionGeneration)) {
      return;
    }

    dispatch(
      updateLayoutOptions({
        [path]: options,
      }),
    );
    dispatch(
      invalidateStateSyncDomain({
        devicePath: path,
        connectionGeneration,
        domain: 'config',
      }),
    );
  };

export const storeCustomDefinitions =
  ({
    definitions,
    version,
  }: {
    definitions: (VIADefinitionV2 | VIADefinitionV3)[];
    version: DefinitionVersion;
  }): AppThunk =>
  async (dispatch, getState) => {
    try {
      const allCustomDefinitions = getCustomDefinitions(getState());
      const entries = definitions.map((definition) => {
        return [
          definition.vendorProductId,
          {
            ...allCustomDefinitions[definition.vendorProductId],
            [version]: definition,
          },
        ] as [IDBValidKey, DefinitionVersionMap];
      });
      return setMany(entries);
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

export const loadStoredCustomDefinitions =
  (): AppThunk => async (dispatch) => {
    try {
      const dictionaryEntries = (await entries()) as [
        IDBValidKey,
        DefinitionVersionMap,
      ][];
      const keyboardDictionary: KeyboardDictionary = {};
      const v2Ids: number[] = [];
      const v3Ids: number[] = [];
      dictionaryEntries.forEach(([entryId, definitionVersionMap]) => {
        if (typeof entryId !== 'string' && typeof entryId !== 'number') {
          return;
        }
        const vendorProductId = Number(entryId);
        if (!Number.isFinite(vendorProductId)) {
          return;
        }
        keyboardDictionary[vendorProductId] = definitionVersionMap;
        if (definitionVersionMap.v2) {
          v2Ids.push(vendorProductId);
        }
        if (definitionVersionMap.v3) {
          v3Ids.push(vendorProductId);
        }
      });
      dispatch(loadInitialCustomDefinitions(keyboardDictionary));

      dispatch(ensureSupportedIds({productIds: v2Ids, version: 'v2'}));
      dispatch(ensureSupportedIds({productIds: v3Ids, version: 'v3'}));
    } catch (e) {
      console.error(e);
    }
  };
export const loadLayoutOptions =
  (connectedDevice: ConnectedDevice): AppThunk =>
  async (dispatch, getState) => {
    const state = getState();
    const selectedDefinition = getDefinitionForDevice(state, connectedDevice);
    const api = new KeyboardAPI(connectedDevice.path);
    const connectionGeneration = api.getConnectionGeneration();
    if (
      !selectedDefinition ||
      !selectedDefinition.layouts.labels ||
      !api.isConnectionGenerationCurrent(connectionGeneration)
    ) {
      return;
    }

    const {path} = connectedDevice;
    try {
      const res = await api.getKeyboardValue(
        KeyboardValue.LAYOUT_OPTIONS,
        [],
        4,
      );
      const options = unpackBits(
        bytesIntoNum(res),
        selectedDefinition.layouts.labels.map(
          (layoutLabel: string[] | string) =>
            Array.isArray(layoutLabel) ? layoutLabel.slice(1).length : 2,
        ),
      );
      if (!api.isConnectionGenerationCurrent(connectionGeneration)) {
        return;
      }
      dispatch(
        updateLayoutOptions({
          [path]: options,
        }),
      );
    } catch {
      console.warn('Getting layout options command not working');
    }
  };

export const readLayoutOptionsStateSyncCandidate = async (
  connectedDevice: ConnectedDevice,
  state: RootState,
  connectionGeneration: number,
): Promise<StateSyncConfigCandidate | null> => {
  const definition = getDefinitionForDevice(state, connectedDevice);
  const api = new KeyboardAPI(connectedDevice.path);
  if (!definition || !api.isConnectionGenerationCurrent(connectionGeneration)) {
    return null;
  }
  if (!definition.layouts.labels) {
    return {};
  }

  const response = await api.getKeyboardValue(
    KeyboardValue.LAYOUT_OPTIONS,
    [],
    4,
  );
  const layoutOptions = unpackBits(
    bytesIntoNum(response),
    definition.layouts.labels.map((layoutLabel: string[] | string) =>
      Array.isArray(layoutLabel) ? layoutLabel.slice(1).length : 2,
    ),
  );
  if (!api.isConnectionGenerationCurrent(connectionGeneration)) {
    return null;
  }
  return {layoutOptions};
};

// Take a list of authorized devices and attempt to resolve any missing definitions
export const reloadDefinitions =
  (authorizedDevices: AuthorizedDevice[]): AppThunk =>
  async (dispatch, getState) => {
    const state = getState();
    const officialDefinitions = getBaseDefinitions(state);
    const eraDefinitions = getEraDefinitions(state);
    const sideloadDefinitions = getCustomDefinitions(state);

    const officialFetches = authorizedDevices.filter(
      ({vendorProductId, requiredDefinitionVersion}) =>
        !officialDefinitions?.[vendorProductId]?.[requiredDefinitionVersion],
    );
    const eraFetches = authorizedDevices.filter(
      ({vendorProductId, requiredDefinitionVersion}) =>
        isEraBundledDefinition(vendorProductId) &&
        !eraDefinitions?.[vendorProductId]?.[requiredDefinitionVersion],
    );

    const [officialSettled, eraSettled] = await Promise.all([
      Promise.allSettled(
        officialFetches.map((device) =>
          fetchBundledDefinition(
            device,
            device.requiredDefinitionVersion,
            'official',
          ),
        ),
      ),
      Promise.allSettled(
        eraFetches.map((device) =>
          fetchBundledDefinition(device, device.requiredDefinitionVersion, 'era'),
        ),
      ),
    ]);

    officialSettled.forEach((settledPromise, i) => {
      const device = officialFetches[i];
      if (settledPromise.status !== 'rejected') {
        return;
      }
      const hasFallback =
        Boolean(
          sideloadDefinitions?.[device.vendorProductId]?.[
            device.requiredDefinitionVersion
          ],
        ) ||
        Boolean(
          eraDefinitions?.[device.vendorProductId]?.[
            device.requiredDefinitionVersion
          ],
        ) ||
        isEraBundledDefinition(device.vendorProductId);
      if (hasFallback) {
        return;
      }
      dispatch(
        logAppError({
          message: `Fetching ${device.requiredDefinitionVersion} definition failed`,
          deviceInfo: extractDeviceInfo(device),
        }),
      );
    });
    eraSettled.forEach((settledPromise, i) => {
      const device = eraFetches[i];
      if (settledPromise.status === 'rejected') {
        dispatch(
          logAppError({
            message: `Fetching ERA ${device.requiredDefinitionVersion} definition failed`,
            deviceInfo: extractDeviceInfo(device),
          }),
        );
      }
    });

    const officialFound = officialSettled
      .filter(isFulfilledPromise)
      .map((res) => res.value)
      .filter((value): value is NonNullable<typeof value> => value !== null);
    const eraFound = eraSettled
      .filter(isFulfilledPromise)
      .map((res) => res.value)
      .filter((value): value is NonNullable<typeof value> => value !== null);

    if (officialFound.length) {
      dispatch(
        updateDefinitions(
          officialFound.reduce<KeyboardDictionary>(
            (dictionary, [definition, version]) => {
              dictionary[definition.vendorProductId] = {
                ...dictionary[definition.vendorProductId],
                [version]: definition,
              };
              return dictionary;
            },
            {},
          ),
        ),
      );
    }
    if (eraFound.length) {
      dispatch(
        updateEraDefinitions(
          eraFound.reduce<KeyboardDictionary>(
            (dictionary, [definition, version]) => {
              dictionary[definition.vendorProductId] = {
                ...dictionary[definition.vendorProductId],
                [version]: definition,
              };
              return dictionary;
            },
            {},
          ),
        ),
      );
    }
  };
