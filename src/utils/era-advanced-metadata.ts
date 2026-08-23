export type ExactMsFamily = 'qmk' | 'h7s';

type EraAdvancedEntry = {
  id: string;
  vendorProductId: number;
  stateSync: boolean;
  usbDiagnostics?: boolean;
  exactMsFamily: ExactMsFamily | null;
};

type EraAdvancedMetadata = {
  schemaVersion: number;
  definitions: EraAdvancedEntry[];
};

let injected: EraAdvancedMetadata | null = null;
let loaded: EraAdvancedMetadata | null = null;
let loadPromise: Promise<EraAdvancedMetadata> | null = null;

const emptyMetadata = (): EraAdvancedMetadata => ({
  schemaVersion: 2,
  definitions: [],
});

export const setEraAdvancedMetadataForTesting = (
  metadata: EraAdvancedMetadata | null,
) => {
  injected = metadata;
  loaded = metadata;
};

const getEraAdvancedMetadataSync = () => injected ?? loaded;

// Opt-in gates that decide whether a component exists at all need to answer on the
// first render, or the component appears and then disappears once the fetch settles.
export const isEraAdvancedMetadataLoaded = () =>
  getEraAdvancedMetadataSync() !== null;

export const isStateSyncOptIn = (vendorProductId: number) => {
  const metadata = getEraAdvancedMetadataSync();
  if (!metadata) {
    return false;
  }
  return metadata.definitions.some(
    (entry) => entry.vendorProductId === vendorProductId && entry.stateSync,
  );
};

export const isUsbDiagnosticsOptIn = (vendorProductId: number) => {
  const metadata = getEraAdvancedMetadataSync();
  if (!metadata) {
    return false;
  }
  return metadata.definitions.some(
    (entry) =>
      entry.vendorProductId === vendorProductId &&
      entry.usbDiagnostics === true,
  );
};

export const shouldProbeUsbDiagnostics = (
  definitionSource: 'era' | 'official' | 'upload' | null,
  vendorProductId: number,
) => definitionSource === 'era' && isUsbDiagnosticsOptIn(vendorProductId);

export const getExactMsFamily = (
  vendorProductId: number,
): ExactMsFamily | null => {
  const metadata = getEraAdvancedMetadataSync();
  const entry = metadata?.definitions.find(
    (item) => item.vendorProductId === vendorProductId,
  );
  return entry?.exactMsFamily ?? null;
};

export const isEraBundledDefinition = (vendorProductId: number) => {
  const metadata = getEraAdvancedMetadataSync();
  if (!metadata) {
    return false;
  }
  return metadata.definitions.some(
    (entry) => entry.vendorProductId === vendorProductId,
  );
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
