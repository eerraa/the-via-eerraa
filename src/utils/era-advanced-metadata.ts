export type ExactMsFamily = 'qmk' | 'h7s';

export type EraAdvancedEntry = {
  id: string;
  vendorProductId: number;
  stateSync: boolean;
  exactMsFamily: ExactMsFamily | null;
};

export type EraAdvancedMetadata = {
  schemaVersion: number;
  definitions: EraAdvancedEntry[];
};

let injected: EraAdvancedMetadata | null = null;
let loaded: EraAdvancedMetadata | null = null;
let loadPromise: Promise<EraAdvancedMetadata> | null = null;

const emptyMetadata = (): EraAdvancedMetadata => ({
  schemaVersion: 1,
  definitions: [],
});

export const setEraAdvancedMetadataForTesting = (
  metadata: EraAdvancedMetadata | null,
) => {
  injected = metadata;
  loaded = metadata;
};

export const getEraAdvancedMetadataSync = () => injected ?? loaded;

export const isStateSyncOptIn = (vendorProductId: number) => {
  const metadata = getEraAdvancedMetadataSync();
  if (!metadata) {
    return false;
  }
  return metadata.definitions.some(
    (entry) => entry.vendorProductId === vendorProductId && entry.stateSync,
  );
};

export const getExactMsFamily = (
  vendorProductId: number,
): ExactMsFamily | null => {
  const metadata = getEraAdvancedMetadataSync();
  const entry = metadata?.definitions.find(
    (item) => item.vendorProductId === vendorProductId && item.stateSync,
  );
  return entry?.exactMsFamily ?? null;
};

export const loadEraAdvancedMetadata = async () => {
  if (injected) {
    return injected;
  }
  if (loaded) {
    return loaded;
  }
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const response = await fetch('/definitions/era_advanced.json');
        if (!response.ok) {
          loaded = emptyMetadata();
          return loaded;
        }
        const json = (await response.json()) as EraAdvancedMetadata;
        loaded = json;
        return loaded;
      } catch {
        loaded = emptyMetadata();
        return loaded;
      }
    })();
  }
  return loadPromise;
};
