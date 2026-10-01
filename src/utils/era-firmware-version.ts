export const ERA_FIRMWARE_VERSION_COMMAND = 'id_qmk_ver_ascii';

export type EraFirmwareVersionSource = 'ascii';

type CustomMenuData = Record<string, unknown>;

const isByte = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 0xff;

const FIRMWARE_VERSION_PATTERN = /^(\d{2})(\d{2})(\d{2})R([1-9])$/;

const matchFirmwareVersion = (value: string) => {
  const match = FIRMWARE_VERSION_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? match : null;
};

const isFirmwareVersion = (value: string) => matchFirmwareVersion(value) !== null;

/** Decode the shared ASCII value through its first NUL; HID report tail is unrelated. */
export const decodeEraFirmwareVersion = (value: unknown): string | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const terminator = value.indexOf(0);
  if (terminator <= 0) {
    return null;
  }
  const characters = value.slice(0, terminator);
  if (
    !characters.every(
      (byte) => isByte(byte) && byte >= 0x20 && byte <= 0x7e,
    )
  ) {
    return null;
  }
  const decoded = String.fromCharCode(...characters);
  return isFirmwareVersion(decoded) ? decoded : null;
};

/**
 * The diagnostics wire carries the H7S build define with its leading `V`
 * (`V260928R1`), while VERSION returns the same build without it. Show one
 * token everywhere; anything outside the grammar is shown unchanged rather
 * than guessed. Comparison identity keeps the raw wire string.
 */
export const formatEraFirmwareVersion = (raw: string): string => {
  const unprefixed = raw.startsWith('V') ? raw.slice(1) : raw;
  return isFirmwareVersion(unprefixed) ? unprefixed : raw;
};

export type EraFirmwareVersionParts = {
  year: number;
  month: number;
  day: number;
  /** YYMMDD as one number, so later builds compare greater. */
  date: number;
  revision: number;
};

/** Split a VERSION token (optionally `V`-prefixed) into its date and revision. */
export const parseEraFirmwareVersion = (
  raw: string,
): EraFirmwareVersionParts | null => {
  const match = matchFirmwareVersion(formatEraFirmwareVersion(raw));
  if (!match) {
    return null;
  }
  return {
    year: 2000 + Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    date: Number(`${match[1]}${match[2]}${match[3]}`),
    revision: Number(match[4]),
  };
};

/**
 * Order two builds by (YYMMDD, n). Returns null when either side is outside the
 * grammar, so a caller can refuse to claim "newer" or "up to date" from it.
 */
export const compareEraFirmwareVersions = (
  a: string,
  b: string,
): number | null => {
  const left = parseEraFirmwareVersion(a);
  const right = parseEraFirmwareVersion(b);
  if (!left || !right) {
    return null;
  }
  return Math.sign(left.date - right.date || left.revision - right.revision);
};

/** The release date a VERSION token encodes, as an ISO calendar date. */
export const getEraFirmwareReleaseDate = (raw: string): string | null => {
  const parts = parseEraFirmwareVersion(raw);
  if (!parts) {
    return null;
  }
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
};

export const getEraFirmwareVersionSource = (
  commandNames: readonly unknown[],
): EraFirmwareVersionSource | null => {
  const names = commandNames.filter(
    (name): name is string => typeof name === 'string',
  );
  return names.length === 1 && names[0] === ERA_FIRMWARE_VERSION_COMMAND
    ? 'ascii'
    : null;
};

export const readEraFirmwareVersion = (
  source: EraFirmwareVersionSource,
  menuData: CustomMenuData,
): string | null =>
  source === 'ascii'
    ? decodeEraFirmwareVersion(menuData[ERA_FIRMWARE_VERSION_COMMAND])
    : null;
