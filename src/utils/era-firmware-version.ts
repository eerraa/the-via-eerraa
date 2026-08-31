export const ERA_FIRMWARE_VERSION_COMMAND = 'id_qmk_ver_ascii';

export type EraFirmwareVersionSource = 'ascii';

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
