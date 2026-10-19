import {
  compareEraFirmwareVersions,
  parseEraFirmwareVersion,
} from './era-firmware-version';

// Firmware distribution data model (docs/adr/0004-firmware-distribution.md).
// `config/firmware-catalog.json` lists makers, which boards each maker
// distributes, and every published version (kept cumulatively, each entry
// self-contained); a board's file resolves to the newest version that ships
// it (`resolveFirmwareCatalog`). USB identity and the
// firmware family stay with `config/era-definitions.manifest.json`; this module
// only reads them. Nothing here imports JSON, so the build script can validate
// the same catalog with the same rules the app resolves it with.

/**
 * One published release file. A board a maker lists before any version ships
 * it resolves to `file: null`; `url` is the same-origin path
 * under `/firmware-files/<version>/<maker>/`, outside the `/firmware` route
 * prefix so a route rewrite can never answer a file request.
 */
export type FirmwareFile = {
  version: string;
  url: string;
  size: number;
  sha256: string;
};

type FirmwareCatalogBoard = {
  id: string;
  name: string;
};

type FirmwareMakerBoard = {
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

type FirmwareCatalog = {
  boards: FirmwareCatalogBoard[];
  makers: FirmwareMaker[];
  /** Every published version, oldest first (`resolveFirmwareCatalog`). */
  versions?: FirmwareVersion[];
};

type FirmwareFamily = 'qmk' | 'h7s';

/** What one version means for one firmware family. */
type FirmwareVersionFamily = {
  /**
   * The storage-format key the family's source records for the build: H7S
   * `tools/eeprom_reset_key.json`, QMK
   * `keyboards/era/common/tools/era_storage_key.json`. Builds whose keys
   * differ do not keep each other's settings.
   */
  storageKey: Record<string, string>;
  /**
   * One short line per app language; English is the fallback. Left out where
   * what changed cannot be told.
   */
  note?: {en: string} & Record<string, string>;
  /** The note is a placeholder still to be written. */
  draft?: boolean;
};

/**
 * One published version, self-contained: its notes, storage keys and files,
 * which live under `/firmware-files/<version>/`. Nothing else refers to it, so
 * deleting the entry and that folder removes the version as if it had never
 * been published; each board falls back to the newest version left.
 */
type FirmwareVersion = {
  version: string;
  families: Partial<Record<FirmwareFamily, FirmwareVersionFamily>>;
  /** Maker id → board id → file. */
  files: Record<string, Record<string, Omit<FirmwareFile, 'version'>>>;
};

/** `config/firmware-catalog.json` as written: a board names no file itself. */
export type FirmwareCatalogSource = {
  boards: FirmwareCatalogBoard[];
  makers: (Omit<FirmwareMaker, 'boards'> & {boards: {board: string}[]})[];
  versions: FirmwareVersion[];
};

type FirmwareManifestIdentity = {
  vendorId: string;
  productId: string;
};

type FirmwareManifestEntry = FirmwareManifestIdentity & {
  id: string;
  /** Further maker identities the same definition serves. */
  identities?: FirmwareManifestIdentity[];
  /** The identity older firmware reports, served by a frozen definition. */
  legacy?: FirmwareManifestIdentity;
  pair?: string;
  exactMsFamily?: string;
};

export type FirmwareManifest = {
  definitions: FirmwareManifestEntry[];
  /** Older identities used only for downloads, never as Custom definitions. */
  downloadOnlyIdentities?: (FirmwareManifestIdentity & {board: string})[];
};

export type FirmwareData = {
  catalog: FirmwareCatalog;
  manifest: FirmwareManifest;
};

/** The shared ERA VID that firmware built before maker identities reports. */
const LEGACY_ERA_VENDOR_ID = 0x4552;
/** The ERA maker VID block (ADR 0004 §1). */
const MAKER_VENDOR_ID_BLOCK = {first: 0x4500, last: 0x453f} as const;

const FIRMWARE_FAMILIES: readonly FirmwareFamily[] = ['qmk', 'h7s'];

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
  manifest.definitions.filter((entry) => (entry.pair ?? entry.id) === boardId);

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
      families.size === 1 &&
      FIRMWARE_FAMILIES.includes(family as FirmwareFamily)
        ? (family as FirmwareFamily)
        : null,
    split: definitions.some((entry) => entry.pair !== undefined),
  };
};

export const getMakerBoard = (maker: FirmwareMaker, boardId: string) =>
  maker.boards.find((entry) => entry.board === boardId) ?? null;

/**
 * The catalog the app reads. A maker board's file is the newest version that
 * ships it, so removing a version needs no other edit.
 */
export const resolveFirmwareCatalog = (
  source: FirmwareCatalogSource,
): FirmwareCatalog => {
  const versions = [...source.versions].sort(
    (a, b) => compareEraFirmwareVersions(a.version, b.version) ?? 0,
  );
  return {
    boards: source.boards,
    makers: source.makers.map((maker) => ({
      ...maker,
      boards: maker.boards.map(({board}) => {
        const newest = [...versions]
          .reverse()
          .find((entry) => entry.files[maker.id]?.[board]);
        return {
          board,
          file: newest
            ? {version: newest.version, ...newest.files[maker.id][board]}
            : null,
        };
      }),
    })),
    versions,
  };
};

/** One version of a board as its release line shows it. */
export type FirmwareHistoryEntry = {
  file: FirmwareFile;
  storageKey: Record<string, string> | null;
  note: FirmwareVersionFamily['note'] | null;
  draft: boolean;
  /** Prototype `?demo=history` sample: never published, has no file. */
  sample?: true;
};

/** Every version a maker publishes for a board, oldest first. */
export const getFirmwareHistory = (
  catalog: FirmwareCatalog,
  makerId: string,
  board: FirmwareBoardInfo,
): FirmwareHistoryEntry[] =>
  (catalog.versions ?? []).flatMap((entry) => {
    const file = entry.files[makerId]?.[board.id];
    const family = board.family ? entry.families[board.family] : undefined;
    return file
      ? [
          {
            file: {version: entry.version, ...file},
            storageKey: family?.storageKey ?? null,
            note: family?.note ?? null,
            draft: family?.draft === true,
          },
        ]
      : [];
  });

/**
 * Whether two builds keep each other's stored settings: their storage-format
 * keys match. Null when either key is unknown, so nothing is claimed.
 */
export const isSameStorageFormat = (
  a: Record<string, string> | null,
  b: Record<string, string> | null,
): boolean | null =>
  a && b
    ? [...new Set([...Object.keys(a), ...Object.keys(b)])].every(
        (key) => a[key] === b[key],
      )
    : null;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const getFirmwareFileUrlPrefix = (version: string, makerId: string) =>
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
          vid === null ||
          (vid !== LEGACY_ERA_VENDOR_ID && !isMakerVendorId(vid))
        );
      });
      if (foreign) {
        errors.push(
          `board "${board.id}" includes "${entry.id}", which is not an ERA identity`,
        );
      }
    }
  }

  const servedIdentities = new Set(
    manifest.definitions.flatMap((entry) =>
      getManifestEntryIdentities(entry).map(
        (identity) =>
          `${parseUsbId(identity.vendorId)}:${parseUsbId(identity.productId)}`,
      ),
    ),
  );
  const downloadIdentities = new Set<string>();
  for (const identity of manifest.downloadOnlyIdentities ?? []) {
    const vid = parseUsbId(identity.vendorId);
    const pid = parseUsbId(identity.productId);
    const key = `${vid}:${pid}`;
    if (vid !== LEGACY_ERA_VENDOR_ID || pid === null) {
      errors.push(
        `download-only identity for "${identity.board}" is not a legacy ERA VID/PID`,
      );
    }
    if (!boardIds.has(identity.board)) {
      errors.push(
        `download-only identity names an undeclared board "${identity.board}"`,
      );
    }
    if (servedIdentities.has(key) || downloadIdentities.has(key)) {
      errors.push(`download-only identity ${key} repeats another USB identity`);
    }
    downloadIdentities.add(key);
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
    }
  }

  for (const boardId of boardIds) {
    if (!listedBoards.has(boardId)) {
      errors.push(`board "${boardId}" is not distributed by any maker`);
    }
  }
  const versionIds = new Set<string>();
  for (const release of catalog.versions ?? []) {
    if (
      parseEraFirmwareVersion(release.version) === null ||
      release.version.startsWith('V')
    ) {
      errors.push(`${release.version} is not a VERSION token`);
    }
    if (versionIds.has(release.version)) {
      errors.push(`version "${release.version}" is declared twice`);
    }
    versionIds.add(release.version);
    for (const [makerId, files] of Object.entries(release.files)) {
      const maker = catalog.makers.find(({id}) => id === makerId);
      for (const [boardId, file] of Object.entries(files)) {
        const label = `${release.version}/${makerId}/${boardId}`;
        if (!maker?.boards.some(({board}) => board === boardId)) {
          errors.push(`${label} is not distributed by this maker`);
        }
        const prefix = getFirmwareFileUrlPrefix(release.version, makerId);
        if (
          typeof file.url !== 'string' ||
          !file.url.startsWith(prefix) ||
          !/^[A-Za-z0-9._-]+\.zip$/.test(file.url.slice(prefix.length))
        ) {
          errors.push(`${label} url must be a ZIP under ${prefix}`);
        }
        if (!Number.isInteger(file.size) || file.size <= 0) {
          errors.push(`${label} size must be a positive byte count`);
        }
        if (
          typeof file.sha256 !== 'string' ||
          !SHA256_PATTERN.test(file.sha256)
        ) {
          errors.push(`${label} sha256 must be 64 lowercase hex digits`);
        }
      }
    }
  }
  return errors;
};

type FirmwareIdentity = {
  board: FirmwareBoardInfo;
  /** Makers that distribute this board, in display order. */
  makers: FirmwareMaker[];
  /** No current Custom definition is safe to serve under this identity. */
  downloadOnly?: true;
};

/**
 * ADR 0004 §3. A VID/PID resolves to a board through the manifest. A maker VID
 * narrows the makers to that maker; a legacy identity leaves every maker that
 * distributes the board, and unresolved makers use the ordinary firmware selection page.
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
  const downloadIdentity =
    !definition &&
    data.manifest.downloadOnlyIdentities?.find(
      (identity) =>
        parseUsbId(identity.vendorId) === vendorId &&
        parseUsbId(identity.productId) === productId,
    );
  const boardId =
    definition?.pair ??
    definition?.id ??
    (downloadIdentity && downloadIdentity.board);
  if (!boardId) {
    return null;
  }
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
    ...(downloadIdentity ? {downloadOnly: true as const} : {}),
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
  }: {
    vendorId: number;
    productId: number;
    version: string | null;
  },
): FirmwareUpdateStatus => {
  const identity = resolveFirmwareIdentity(data, vendorId, productId);
  if (!identity) {
    return {kind: 'not-distributed'};
  }
  const {board, makers} = identity;
  if (makers.length > 1) {
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
      update: {
        version: versions.size === 1 ? (files[0]?.version ?? null) : null,
      },
    };
  }
  const maker = makers[0];
  const file = getMakerBoard(maker, board.id)?.file ?? null;
  if (!file) {
    return {kind: 'unpublished', board, maker, makers};
  }
  const order =
    version === null ? null : compareEraFirmwareVersions(version, file.version);
  return {
    kind:
      order === null
        ? 'no-claim'
        : order < 0
          ? 'update-available'
          : 'up-to-date',
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
