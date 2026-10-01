export type ExactMsFamily = 'qmk' | 'h7s';

type EraAdvancedEntry = {
  id: string;
  /** What a saved layout belongs to: the id, or the pair a split half is part of. */
  board?: string;
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

/**
 * The entry the build writes for one identity a manifest definition is served
 * under. Both halves of a split keyboard get their pair as `board`.
 */
export const eraAdvancedEntry = (
  definition: {
    id: string;
    pair?: string;
    stateSync: boolean;
    usbDiagnostics?: boolean;
    exactMsFamily?: ExactMsFamily;
  },
  vendorProductId: number,
): EraAdvancedEntry => ({
  id: definition.id,
  board: definition.pair ?? definition.id,
  vendorProductId,
  stateSync: definition.stateSync === true,
  usbDiagnostics: definition.usbDiagnostics === true,
  exactMsFamily: definition.exactMsFamily ?? null,
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

/**
 * Whether two identities are the same ERA board: the one its JSON is served under,
 * another maker's identity for it, the identity its older firmware reported, or
 * the other half of a split keyboard. The build gives all of them one `board`.
 */
export const isSameEraBoard = (left: number, right: number) => {
  const definitions = getEraAdvancedMetadataSync()?.definitions ?? [];
  const boardOf = (vendorProductId: number) => {
    const entry = definitions.find(
      (item) => item.vendorProductId === vendorProductId,
    );
    return entry && (entry.board ?? entry.id);
  };
  const board = boardOf(left);
  return board !== undefined && board === boardOf(right);
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
