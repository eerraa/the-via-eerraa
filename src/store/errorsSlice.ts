import {RootState} from './index';
import {createSlice, PayloadAction} from '@reduxjs/toolkit';
import {DeviceInfo} from 'src/types/types';

// What /errors names an error by: a catalog key in the user's words, one per
// failure a user can tell apart. The message, stack, bytes and USB ids stay in
// the downloaded file.
export const APP_ERROR_TITLES = {
  noResponse: 'Keyboard not responding',
  unreadable: 'Could not read the keyboard',
  unsupportedFirmware: 'Unsupported keyboard firmware version',
  definition: 'Could not load the keyboard definition',
  screen: 'Could not show this screen',
} as const;

export type AppErrorTitle =
  (typeof APP_ERROR_TITLES)[keyof typeof APP_ERROR_TITLES];

export type KeyboardAPIError = {
  commandName: string;
  commandBytes: number[];
  responseBytes: number[];
  deviceInfo: DeviceInfo;
  details?: string;
  title?: AppErrorTitle;
};

export type AppError = {
  /** Order of logging, so a keyboard's later load can clear what came before. */
  id: number;
  timestamp: string;
  message: string;
  deviceInfo: DeviceInfo;
  title: AppErrorTitle;
};

export const extractDeviceInfo = (device: DeviceInfo): DeviceInfo => ({
  productId: device.productId,
  vendorId: device.vendorId,
  productName: device.productName,
  protocol: device.protocol,
});

type ErrorsState = {
  appErrors: AppError[];
  nextErrorId: number;
};

const initialState: ErrorsState = {
  appErrors: [],
  nextErrorId: 0,
};

export const getErrorTimestamp = () => {
  const now = new Date();
  return `${now.toLocaleTimeString([], {hour12: false})}.${now
    .getMilliseconds()
    .toString()
    .padStart(3, '0')}`;
};

export const extractMessageFromKeyboardAPIError = (error: KeyboardAPIError) =>
  `Command Name: ${error.commandName}
Command: ${formatBytes(error.commandBytes)}
Response: ${formatBytes(error.responseBytes)}${
    error.details ? `\nDetails: ${error.details}` : ''
  }`;
export const getMessageFromError = (e: Error) => e.stack || e.message;
const formatBytes = (bytes: number[]) => bytes.join(' ');

const errorsSlice = createSlice({
  name: 'errors',
  initialState,
  reducers: {
    logAppError: (
      state,
      action: PayloadAction<Omit<AppError, 'id' | 'timestamp'>>,
    ) => {
      state.appErrors.push({
        ...action.payload,
        id: state.nextErrorId++,
        timestamp: getErrorTimestamp(),
      });
    },
    logKeyboardAPIError: (state, action: PayloadAction<KeyboardAPIError>) => {
      const {deviceInfo, title} = action.payload;
      state.appErrors.push({
        id: state.nextErrorId++,
        timestamp: getErrorTimestamp(),
        message: extractMessageFromKeyboardAPIError(action.payload),
        deviceInfo,
        // The keyboard answered, but not with what was asked.
        title: title ?? APP_ERROR_TITLES.unreadable,
      });
    },
    clearAppErrors: (state) => {
      state.appErrors = [];
    },
    /** Drops what this keyboard logged before error `before`. */
    clearDeviceErrors: (
      state,
      action: PayloadAction<{
        vendorId: number;
        productId: number;
        before: number;
      }>,
    ) => {
      const {vendorId, productId, before} = action.payload;
      state.appErrors = state.appErrors.filter(
        ({id, deviceInfo}) =>
          id >= before ||
          deviceInfo.vendorId !== vendorId ||
          deviceInfo.productId !== productId,
      );
    },
  },
});

export const {
  logKeyboardAPIError,
  logAppError,
  clearAppErrors,
  clearDeviceErrors,
} = errorsSlice.actions;

export default errorsSlice.reducer;

export const getAppErrors = (state: RootState) => state.errors.appErrors;
export const getNextAppErrorId = (state: RootState) => state.errors.nextErrorId;
