import {
  compareEraFirmwareVersions,
  parseEraFirmwareVersion,
} from './era-firmware-version';

// Firmware distribution data model (docs/adr/0004-firmware-distribution.md).
// `config/firmware-catalog.json` lists makers, which boards each maker
// distributes and the published file per (maker, board). USB identity and the
// firmware family stay with `config/era-definitions.manifest.json`; this module
// only reads them. Nothing here imports JSON, so the build script can validate
// the same catalog with the same rules the app resolves it with.

/**
 * One published release file. A board a maker lists before its file is
 * published carries `file: null` in the catalog; `url` is the same-origin path
 * under `/firmware-files/<version>/<maker>/`, outside the `/firmware` route
 * prefix so a route rewrite can never answer a file request.
 */
export type FirmwareFile = {
  version: string;
  url: string;
  size: number;
  sha256: string;
};

export type FirmwareCatalogBoard = {
  id: string;
  name: string;
};

export type FirmwareMakerBoard = {
  board: string;
  file: FirmwareFile | null;
};

export type FirmwareMaker = {
  id: string;
  name: string;
  /** The maker's VID, which firmware built with maker identities reports. */
  vendorId?: string;
  boards: FirmwareMakerBoard[];
};

export type FirmwareCatalog = {
  boards: FirmwareCatalogBoard[];
  makers: FirmwareMaker[];
};

export type FirmwareFamily = 'qmk' | 'h7s';

export type FirmwareManifestIdentity = {
  vendorId: string;
  productId: string;
};

export type FirmwareManifestEntry = FirmwareManifestIdentity & {
  id: string;
  /** Further maker identities the same definition serves. */
  identities?: FirmwareManifestIdentity[];
  /** The identity older firmware reports, served by a frozen definition. */
  legacy?: FirmwareManifestIdentity;
  pair?: string;
  exactMsFamily?: string;
};

export type FirmwareManifest = {definitions: FirmwareManifestEntry[]};

export type FirmwareData = {
  catalog: FirmwareCatalog;
  manifest: FirmwareManifest;
};

/** The shared ERA VID that firmware built before maker identities reports. */
export const LEGACY_ERA_VENDOR_ID = 0x4552;
/** The ERA maker VID block (ADR 0004 §1). */
export const MAKER_VENDOR_ID_BLOCK = {first: 0x4500, last: 0x453f} as const;

export const FIRMWARE_FAMILIES: readonly FirmwareFamily[] = ['qmk', 'h7s'];

const COMMON_MAKER_ID = 'common';

/**
 * Maker display order. Deliberate and changeable in this one place:
 * alphabetical by display name, case-insensitive, so a new maker lands in a
 * stable position; COMMON is a catch-all rather than a brand, so it stays last.
 * Board counts are shown next to a maker but never drive the order, because an
 * order that reshuffles whenever a board is added breaks scanning.
 */
export const sortMakersForDisplay = <T extends {id: string; name: string}>(
  makers: readonly T[],
): T[] =>
  [...makers].sort((a, b) => {
    const aCommon = a.id === COMMON_MAKER_ID;
    const bCommon = b.id === COMMON_MAKER_ID;
    if (aCommon !== bCommon) {
      return aCommon ? 1 : -1;
    }
    return a.name.localeCompare(b.name, 'en', {sensitivity: 'base'});
  });

export const parseUsbId = (value: unknown): number | null =>
  typeof value === 'string' && /^0x[0-9a-f]{4}$/i.test(value)
    ? Number.parseInt(value.slice(2), 16)
    : null;

const isMakerVendorId = (vid: number) =>
  vid >= MAKER_VENDOR_ID_BLOCK.first && vid <= MAKER_VENDOR_ID_BLOCK.last;

/** Every USB identity a manifest definition is served under, legacy included. */
export const getManifestEntryIdentities = (
  entry: FirmwareManifestEntry,
): FirmwareManifestIdentity[] => [
  {vendorId: entry.vendorId, productId: entry.productId},
  ...(entry.identities ?? []),
  ...(entry.legacy ? [entry.legacy] : []),
];

/** Manifest definitions that make up a catalog board (split halves share one). */
export const getBoardDefinitions = (
  manifest: FirmwareManifest,
  boardId: string,
) =>
  manifest.definitions.filter(
    (entry) => (entry.pair ?? entry.id) === boardId,
  );

export type FirmwareBoardInfo = {
  id: string;
  name: string;
  family: FirmwareFamily | null;
  split: boolean;
};

export const getFirmwareBoardInfo = (
  data: FirmwareData,
  boardId: string,
): FirmwareBoardInfo => {
  const definitions = getBoardDefinitions(data.manifest, boardId);
  const families = new Set(definitions.map((entry) => entry.exactMsFamily));
  const [family] = [...families];
  return {
    id: boardId,
    name:
      data.catalog.boards.find((board) => board.id === boardId)?.name ??
      boardId,
    family:
      families.size === 1 && FIRMWARE_FAMILIES.includes(family as FirmwareFamily)
        ? (family as FirmwareFamily)
        : null,
    split: definitions.some((entry) => entry.pair !== undefined),
  };
};

export const getMakerBoard = (maker: FirmwareMaker, boardId: string) =>
  maker.boards.find((entry) => entry.board === boardId) ?? null;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const getFirmwareFileUrlPrefix = (version: string, makerId: string) =>
  `/firmware-files/${version}/${makerId}/`;

/**
 * Structural rules of ADR 0004 §5 that need no file system: every entry maps
 * to a manifest identity of that maker, maker VIDs lie in the block and do not
 * repeat, no board repeats under a maker, and a published file is well formed.
 */
export const validateFirmwareCatalog = ({
  catalog,
  manifest,
}: FirmwareData): string[] => {
  const errors: string[] = [];
  const boardIds = new Set<string>();

  for (const board of catalog.boards) {
    if (!ID_PATTERN.test(board.id)) {
      errors.push(`board id "${board.id}" is not a lowercase slug`);
    }
    if (boardIds.has(board.id)) {
      errors.push(`board "${board.id}" is declared twice`);
    }
    boardIds.add(board.id);
    if (typeof board.name !== 'string' || !board.name.trim()) {
      errors.push(`board "${board.id}" has no display name`);
    }
    const definitions = getBoardDefinitions(manifest, board.id);
    if (definitions.length === 0) {
      errors.push(`board "${board.id}" is not a manifest definition or pair`);
      continue;
    }
    const families = new Set(definitions.map((entry) => entry.exactMsFamily));
    if (
      families.size !== 1 ||
      !FIRMWARE_FAMILIES.includes([...families][0] as FirmwareFamily)
    ) {
      errors.push(`board "${board.id}" has no single firmware family`);
    }
    for (const entry of definitions) {
      // A board ERA did not build keeps its own identity and is not distributed.
      const foreign = getManifestEntryIdentities(entry).some((identity) => {
        const vid = parseUsbId(identity.vendorId);
        return (
          vid === null || (vid !== LEGACY_ERA_VENDOR_ID && !isMakerVendorId(vid))
        );
      });
      if (foreign) {
        errors.push(
          `board "${board.id}" includes "${entry.id}", which is not an ERA identity`,
        );
      }
    }
  }

  const makerIds = new Set<string>();
  const makerVendorIds = new Set<number>();
  const listedBoards = new Set<string>();
  for (const maker of catalog.makers) {
    if (!ID_PATTERN.test(maker.id)) {
      errors.push(`maker id "${maker.id}" is not a lowercase slug`);
    }
    if (makerIds.has(maker.id)) {
      errors.push(`maker "${maker.id}" is declared twice`);
    }
    makerIds.add(maker.id);
    if (typeof maker.name !== 'string' || !maker.name.trim()) {
      errors.push(`maker "${maker.id}" has no display name`);
    }
    let makerVid: number | null = null;
    if (maker.vendorId !== undefined) {
      makerVid = parseUsbId(maker.vendorId);
      if (makerVid === null || !isMakerVendorId(makerVid)) {
        errors.push(`maker "${maker.id}" VID is outside the maker block`);
      } else if (makerVendorIds.has(makerVid)) {
        errors.push(`maker "${maker.id}" repeats another maker's VID`);
      } else {
        makerVendorIds.add(makerVid);
      }
    }

    const makerBoards = new Set<string>();
    for (const entry of maker.boards) {
      const label = `${maker.id}/${entry.board}`;
      if (makerBoards.has(entry.board)) {
        errors.push(`${label} is listed twice`);
      }
      makerBoards.add(entry.board);
      listedBoards.add(entry.board);
      if (!boardIds.has(entry.board)) {
        errors.push(`${label} names an undeclared board`);
        continue;
      }
      // A distributed board needs a current identity under the maker that ships it;
      // the shared legacy identity names no maker.
      const definitions = getBoardDefinitions(manifest, entry.board);
      const servesMaker = definitions.some((definition) =>
        [
          {vendorId: definition.vendorId, productId: definition.productId},
          ...(definition.identities ?? []),
        ].some((identity) => {
          const vid = parseUsbId(identity.vendorId);
          return vid !== null && vid === makerVid;
        }),
      );
      if (definitions.length > 0 && !servesMaker) {
        errors.push(`${label} has no manifest identity of that maker`);
      }
      if (entry.file === null) {
        continue;
      }
      const file = entry.file as Partial<FirmwareFile> | undefined;
      if (!file || typeof file !== 'object') {
        errors.push(`${label} file must be null or a published file`);
        continue;
      }
      if (
        typeof file.version !== 'string' ||
        parseEraFirmwareVersion(file.version) === null ||
        file.version.startsWith('V')
      ) {
        errors.push(`${label} version is not a VERSION token`);
        continue;
      }
      const prefix = getFirmwareFileUrlPrefix(file.version, maker.id);
      if (
        typeof file.url !== 'string' ||
        !file.url.startsWith(prefix) ||
        !/^[A-Za-z0-9._-]+\.zip$/.test(file.url.slice(prefix.length))
      ) {
        errors.push(`${label} url must be a ZIP under ${prefix}`);
      }
      if (!Number.isInteger(file.size) || (file.size as number) <= 0) {
        errors.push(`${label} size must be a positive byte count`);
      }
      if (typeof file.sha256 !== 'string' || !SHA256_PATTERN.test(file.sha256)) {
        errors.push(`${label} sha256 must be 64 lowercase hex digits`);
      }
    }
  }

  for (const boardId of boardIds) {
    if (!listedBoards.has(boardId)) {
      errors.push(`board "${boardId}" is not distributed by any maker`);
    }
  }
  return errors;
};

export type FirmwareIdentity = {
  board: FirmwareBoardInfo;
  /** Makers that distribute this board, in display order. */
  makers: FirmwareMaker[];
};

/**
 * ADR 0004 §3. A VID/PID resolves to a board through the manifest. A maker VID
 * narrows the makers to that maker; a legacy identity leaves every maker that
 * distributes the board, and the caller asks when there is more than one.
 */
export const resolveFirmwareIdentity = (
  data: FirmwareData,
  vendorId: number,
  productId: number,
): FirmwareIdentity | null => {
  const definition = data.manifest.definitions.find((entry) =>
    getManifestEntryIdentities(entry).some(
      (identity) =>
        parseUsbId(identity.vendorId) === vendorId &&
        parseUsbId(identity.productId) === productId,
    ),
  );
  if (!definition) {
    return null;
  }
  const boardId = definition.pair ?? definition.id;
  if (!data.catalog.boards.some((board) => board.id === boardId)) {
    return null;
  }
  const candidates = sortMakersForDisplay(
    data.catalog.makers.filter((maker) => getMakerBoard(maker, boardId)),
  );
  if (candidates.length === 0) {
    return null;
  }
  const byVendor = candidates.filter(
    (maker) => parseUsbId(maker.vendorId) === vendorId,
  );
  return {
    board: getFirmwareBoardInfo(data, boardId),
    makers: byVendor.length === 1 ? byVendor : candidates,
  };
};

export type FirmwareUpdateStatus =
  | {kind: 'not-distributed'}
  | {
      kind: 'choose-maker';
      board: FirmwareBoardInfo;
      makers: FirmwareMaker[];
      /**
       * Set when every maker's file is newer than VERSION, so an update is due
       * whichever maker sold the keyboard: the version they share, or null
       * when their versions differ.
       */
      update?: {version: string | null};
    }
  | {
      kind: 'unpublished';
      board: FirmwareBoardInfo;
      maker: FirmwareMaker | null;
      makers: FirmwareMaker[];
    }
  | {
      kind: 'no-claim' | 'up-to-date' | 'update-available';
      board: FirmwareBoardInfo;
      maker: FirmwareMaker;
      makers: FirmwareMaker[];
      file: FirmwareFile;
      current: string | null;
    };

/**
 * ADR 0004 §6. Compare the keyboard's VERSION value with the catalog. A
 * missing or malformed version makes no claim either way.
 */
export const getFirmwareUpdateStatus = (
  data: FirmwareData,
  {
    vendorId,
    productId,
    version,
    rememberedMaker,
  }: {
    vendorId: number;
    productId: number;
    version: string | null;
    rememberedMaker?: (boardId: string) => string | null;
  },
): FirmwareUpdateStatus => {
  const identity = resolveFirmwareIdentity(data, vendorId, productId);
  if (!identity) {
    return {kind: 'not-distributed'};
  }
  const {board, makers} = identity;
  let maker: FirmwareMaker | undefined = makers[0];
  if (makers.length > 1) {
    const remembered = rememberedMaker?.(board.id);
    maker = makers.find((candidate) => candidate.id === remembered);
    if (!maker) {
      const files = makers.map(
        (candidate) => getMakerBoard(candidate, board.id)?.file ?? null,
      );
      if (!files.some(Boolean)) {
        return {kind: 'unpublished', board, maker: null, makers};
      }
      // Still no guess at the maker: the update is shown only when it holds
      // for every one of them.
      const allNewer = files.every(
        (file) =>
          file !== null &&
          version !== null &&
          (compareEraFirmwareVersions(version, file.version) ?? 0) < 0,
      );
      if (!allNewer) {
        return {kind: 'choose-maker', board, makers};
      }
      const versions = new Set(files.map((file) => file?.version));
      return {
        kind: 'choose-maker',
        board,
        makers,
        update: {version: versions.size === 1 ? files[0]?.version ?? null : null},
      };
    }
  }
  const file = getMakerBoard(maker, board.id)?.file ?? null;
  if (!file) {
    return {kind: 'unpublished', board, maker, makers};
  }
  const order =
    version === null ? null : compareEraFirmwareVersions(version, file.version);
  return {
    kind:
      order === null ? 'no-claim' : order < 0 ? 'update-available' : 'up-to-date',
    board,
    maker,
    makers,
    file,
    current: order === null ? null : version,
  };
};

/** The single maker a status points at, if the keyboard resolved to one. */
export const getStatusMaker = (status: FirmwareUpdateStatus | null) =>
  status && 'maker' in status ? status.maker : null;

export const formatFirmwareFileSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;

export const getFirmwareFileName = (file: FirmwareFile) =>
  file.url.slice(file.url.lastIndexOf('/') + 1);

// Which maker sold a legacy shared board is a per-browser convenience, never a
// claim about the keyboard. Storage can be missing or blocked; every access is
// guarded and the app works without it.
const MAKER_CHOICE_PREFIX = 'era-firmware-maker:';
const makerChoiceListeners = new Set<() => void>();
// The latest choice in this page view also survives blocked storage reads/writes.
const pageViewChoices = new Map<string, string | null>();
let makerChoiceRevision = 0;

export const readRememberedMaker = (boardId: string): string | null => {
  if (pageViewChoices.has(boardId)) {
    return pageViewChoices.get(boardId) ?? null;
  }
  try {
    const storage = globalThis.localStorage;
    const stored = storage?.getItem(MAKER_CHOICE_PREFIX + boardId);
    if (stored) {
      return stored;
    }
  } catch {
    // Fall through to the page-view choice.
  }
  return pageViewChoices.get(boardId) ?? null;
};

export const rememberMaker = (boardId: string, makerId: string | null) => {
  pageViewChoices.set(boardId, makerId);
  try {
    const storage = globalThis.localStorage;
    if (makerId === null) {
      storage?.removeItem(MAKER_CHOICE_PREFIX + boardId);
    } else {
      storage?.setItem(MAKER_CHOICE_PREFIX + boardId, makerId);
    }
  } catch {
    // Storage blocked or full: the page-view choice above still applies.
  }
  makerChoiceRevision += 1;
  makerChoiceListeners.forEach((listener) => listener());
};

export const subscribeRememberedMakers = (listener: () => void) => {
  makerChoiceListeners.add(listener);
  return () => {
    makerChoiceListeners.delete(listener);
  };
};

export const getRememberedMakerRevision = () => makerChoiceRevision;
