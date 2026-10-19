import {
  KeyboardAPI,
  KeyboardValue,
  UnhandledCommandError,
} from './keyboard-api';
import {
  HIDTransportGenerationError,
  HIDTransportTimeoutError,
} from '../shims/node-hid';

export const POLLING_CURRENT = 'id_qmk_usb_polling_current';
export const LINK_RESULT = 'id_qmk_split_link_result';
export const observationAddress = (command: string): number[] | null =>
  command === POLLING_CURRENT
    ? [13, 4]
    : command === LINK_RESULT
      ? [9, 66]
      : null;

export type MenuObservationValue =
  | {status: 'ready'; text: string}
  | {
      status:
        | 'loading'
        | 'unsupported'
        | 'timeout'
        | 'malformed'
        | 'disconnected'
        | 'error';
    };

const POLLING_TEXT = new Set([
  '1000 Hz (FS)',
  '2000 Hz (HS)',
  '4000 Hz (HS)',
  '8000 Hz (HS)',
  'Unavailable',
]);
const LINK_TEXT = new Set([
  'No Apply this boot',
  'Pending',
  'Pending High',
  'Pending Medium',
  'Pending Low',
  'Applied High',
  'Applied Medium',
  'Applied Low',
  'Already set',
  'Busy - retry',
  'Failed - check levels',
  'Cancelled - retry',
]);

export const parseMenuObservation = (
  command: string,
  bytes: number[],
): string => {
  const end = bytes.indexOf(0);
  if (
    bytes.length !== 29 ||
    end < 0 ||
    bytes.slice(0, end).some((byte) => byte < 32 || byte > 126) ||
    (command === POLLING_CURRENT && bytes.slice(end).some((byte) => byte !== 0))
  ) {
    throw new Error('Malformed observation');
  }
  const text = String.fromCharCode(...bytes.slice(0, end));
  if (!(command === POLLING_CURRENT ? POLLING_TEXT : LINK_TEXT).has(text)) {
    throw new Error('Unknown observation');
  }
  return text;
};

// Only id_unhandled means unsupported. Transport failures keep KeyboardAPI's
// existing logging/connection-lock policy and never become a legacy fallback.
export const readMenuObservation = async (
  api: KeyboardAPI,
  command: string,
  current: () => boolean,
): Promise<MenuObservationValue> => {
  try {
    if (command === POLLING_CURRENT) {
      const version = await api.getKeyboardValue(
        KeyboardValue.FIRMWARE_VERSION,
        [],
        4,
      );
      if (!current()) return {status: 'disconnected'};
      const revision = version.reduce((value, byte) => value * 256 + byte, 0);
      if (revision < 1) return {status: 'unsupported'};
    }
    if (!current()) return {status: 'disconnected'};
    const response = await api.getOptionalCustomMenuValue(
      observationAddress(command)!,
    );
    if (!current()) return {status: 'disconnected'};
    if (response === null) return {status: 'unsupported'};
    try {
      return {
        status: 'ready',
        text: parseMenuObservation(command, response.slice(1)),
      };
    } catch {
      return {status: 'malformed'};
    }
  } catch (error) {
    if (error instanceof UnhandledCommandError) return {status: 'unsupported'};
    if (error instanceof HIDTransportTimeoutError) return {status: 'timeout'};
    if (!current() || error instanceof HIDTransportGenerationError)
      return {status: 'disconnected'};
    return {status: 'error'};
  }
};
