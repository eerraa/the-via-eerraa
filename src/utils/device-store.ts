import {current} from '@reduxjs/toolkit';
import {
  DefinitionVersionMap,
  getTheme,
  KeyboardDefinitionIndex,
  KeyboardDictionary,
  ThemeDefinition,
} from '@the-via/reader';
import {TestKeyboardSoundsMode} from 'src/components/void/test-keyboard-sounds';
import {THEMES} from 'src/utils/themes';
import {Store} from '../shims/via-app-store';
import type {
  AuthorizedDevice,
  DefinitionIndex,
  Settings,
  VendorProductIdMap,
} from '../types/types';
import {getVendorProductId} from './hid-keyboards';
let deviceStore: Store;
const defaultStoreData = {
  definitionIndex: {
    generatedAt: -1,
    hash: '',
    version: '2.0.0',
    theme: getTheme(),
    accentColor: '#ad7070',
    supportedVendorProductIdMap: {},
  },
  definitions: {},
  settings: {
    showDesignTab: false,
    showConsoleTab: false,
    disableFastRemap: false,
    ShowSliderValuesMode: 'Slider Only' as const,
    renderMode: '2D' as const,
    themeMode: 'dark' as const,
    designDefinitionVersion: 'v3' as const,
    themeName: 'OLIVIA_DARK',
    hostKeyboardLayout: 'keymap_us',
    macroEditor: {
      smartOptimizeEnabled: true,
      recordDelaysEnabled: false,
      tapEnterAtEOMEnabled: false,
    },
    testKeyboardSoundsSettings: {
      isEnabled: true,
      volume: 100,
      waveform: 'sine' as const,
      mode: TestKeyboardSoundsMode.WickiHayden,
      transpose: 0,
    },
  },
};

function initDeviceStore() {
  deviceStore = new Store(defaultStoreData);
}

initDeviceStore();

// TODO: invalidate cache if we change cache structure

/** Retreives the latest definition index and invalidates the definition cache if a new one is found */
export async function syncStore(): Promise<DefinitionIndex> {
  const currentDefinitionIndex = deviceStore.get('definitionIndex');

  // TODO: fall back to cache if can't hit endpoint, notify user
  try {
    // Get hash file
    //    const hash = await (await fetch('/definitions/hash.json')).json();
    const hash = document.getElementById('definition_hash')?.dataset.hash || '';

    if (hash === currentDefinitionIndex.hash) {
      return currentDefinitionIndex;
    }
    // Get definition index file
    const response = await fetch('/definitions/supported_kbs.json', {
      cache: 'reload',
    });
    const json: KeyboardDefinitionIndex = await response.json();

    // TODO: maybe we should just export this shape from keyboards repo
    // v3 is a superset of v2 - if the def is avail in v2, it is also avail in v3
    const v2vpidMap = json.vendorProductIds.v2.reduce(
      (acc: VendorProductIdMap, id) => {
        acc[id] = acc[id] || {};
        acc[id].v2 = acc[id].v3 = true;
        return acc;
      },
      {},
    );

    const vpidMap = json.vendorProductIds.v3.reduce(
      (acc: VendorProductIdMap, def) => {
        acc[def] = acc[def] || {};
        acc[def].v3 = true;
        return acc;
      },
      v2vpidMap,
    );

    const newIndex = {
      ...json,
      hash,
      supportedVendorProductIdMap: vpidMap,
    };
    deviceStore.set('definitionIndex', newIndex);
    deviceStore.set('definitions', {});

    return newIndex;
  } catch (e) {
    console.warn(e);
  }

  return currentDefinitionIndex;
}

const fetchDefinitionJson = async <K extends keyof DefinitionVersionMap>(
  url: string,
): Promise<DefinitionVersionMap[K] | null> => {
  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as DefinitionVersionMap[K];
};

const cacheOfficialDefinition = <K extends keyof DefinitionVersionMap>(
  vpid: number,
  version: K,
  json: DefinitionVersionMap[K],
) => {
  let definitions = deviceStore.get('definitions');
  const newDefinitions = {
    ...definitions,
    [vpid]: {
      ...definitions[vpid],
      [version]: json,
    },
  };
  try {
    deviceStore.set('definitions', newDefinitions);
  } catch (err) {
    localStorage.clear();
    initDeviceStore();
    definitions = deviceStore.get('definitions');
    deviceStore.set('definitions', {
      ...definitions,
      [vpid]: {
        ...definitions[vpid],
        [version]: json,
      },
    });
  }
};

export const fetchBundledDefinition = async <
  K extends keyof DefinitionVersionMap,
>(
  device: AuthorizedDevice,
  version: K,
  source: 'official' | 'era',
): Promise<[DefinitionVersionMap[K], K] | null> => {
  const vpid = getVendorProductId(device.vendorId, device.productId);
  const url =
    source === 'era'
      ? `/definitions/era/${version}/${vpid}.json`
      : `/definitions/${version}/${vpid}.json`;
  const json = await fetchDefinitionJson<K>(url);
  if (!json) {
    return null;
  }
  if (source === 'official') {
    cacheOfficialDefinition(vpid, version, json);
  }
  return [json, version];
};

export const getSupportedIdsFromStore = (): VendorProductIdMap =>
  deviceStore.get('definitionIndex')?.supportedVendorProductIdMap;

export const getDefinitionsFromStore = (): KeyboardDictionary =>
  deviceStore.get('definitions');

export const getThemeFromStore = (): ThemeDefinition =>
  THEMES[getThemeNameFromStore() as keyof typeof THEMES] ||
  deviceStore.get('definitionIndex')?.theme;

export const getThemeModeFromStore = (): 'dark' | 'light' => {
  return deviceStore.get('settings')?.themeMode;
};

export const getThemeNameFromStore = () => {
  return deviceStore.get('settings')?.themeName;
};

export const getSettings = (): Settings => deviceStore.get('settings');

export const setSettings = (settings: Settings) => {
  deviceStore.set('settings', current(settings));
};
