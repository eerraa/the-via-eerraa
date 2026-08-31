export const ERA_FIRMWARE_VERSION_COMMAND = 'id_qmk_ver_ascii';

export const H7S_FIRMWARE_VERSION_COMMANDS = {
  year: 'id_qmk_ver_yy',
  month: 'id_qmk_ver_mm',
  day: 'id_qmk_ver_dd',
  revision: 'id_qmk_ver_rv',
} as const;

export type EraFirmwareVersionSource = 'ascii' | 'h7s-dropdowns';

type CustomMenuData = Record<string, unknown>;

const isByte = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 0xff;

const isFirmwareVersion = (value: string) => {
  const match = /^(\d{2})(\d{2})(\d{2})R([1-9])$/.exec(value);
  if (!match) {
    return false;
  }
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
};

/** Decode the RP2040 ERA value through its first NUL; HID report tail is unrelated. */
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

const decodeDropdownIndex = (value: unknown, max: number): number | null => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !isByte(value[0]) ||
    value[0] > max
  ) {
    return null;
  }
  return value[0];
};

/** Decode the four zero-based H7S dropdown values without exposing dropdown UI. */
export const decodeH7sFirmwareVersion = (
  yearValue: unknown,
  monthValue: unknown,
  dayValue: unknown,
  revisionValue: unknown,
): string | null => {
  const year = decodeDropdownIndex(yearValue, 9);
  const month = decodeDropdownIndex(monthValue, 11);
  const day = decodeDropdownIndex(dayValue, 30);
  const revision = decodeDropdownIndex(revisionValue, 8);
  if (year === null || month === null || day === null || revision === null) {
    return null;
  }
  return `${String(year + 24).padStart(2, '0')}${String(month + 1).padStart(
    2,
    '0',
  )}${String(day + 1).padStart(2, '0')}R${revision + 1}`;
};

export const getEraFirmwareVersionSource = (
  commandNames: readonly unknown[],
): EraFirmwareVersionSource | null => {
  const names = commandNames.filter(
    (name): name is string => typeof name === 'string',
  );
  if (names.length === 1 && names[0] === ERA_FIRMWARE_VERSION_COMMAND) {
    return 'ascii';
  }
  const h7sNames = Object.values(H7S_FIRMWARE_VERSION_COMMANDS);
  return names.length === h7sNames.length &&
    h7sNames.every((name) => names.includes(name))
    ? 'h7s-dropdowns'
    : null;
};

export const readEraFirmwareVersion = (
  source: EraFirmwareVersionSource,
  menuData: CustomMenuData,
): string | null =>
  source === 'ascii'
    ? decodeEraFirmwareVersion(menuData[ERA_FIRMWARE_VERSION_COMMAND])
    : decodeH7sFirmwareVersion(
        menuData[H7S_FIRMWARE_VERSION_COMMANDS.year],
        menuData[H7S_FIRMWARE_VERSION_COMMANDS.month],
        menuData[H7S_FIRMWARE_VERSION_COMMANDS.day],
        menuData[H7S_FIRMWARE_VERSION_COMMANDS.revision],
      );
