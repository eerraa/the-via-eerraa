import {createListenerMiddleware} from '@reduxjs/toolkit';
import {
  clearDeviceErrors,
  extractMessageFromKeyboardAPIError,
  getNextAppErrorId,
  logAppError,
  logKeyboardAPIError,
} from './errorsSlice';
import {markDeviceReady, selectDevice} from './devicesSlice';
import type {RootState} from './index';
import {formatNumberAsHex} from 'src/utils/format';
import {DeviceInfo} from 'src/types/types';

export const errorsListenerMiddleware = createListenerMiddleware();

const captureError = (message: string, deviceInfo: DeviceInfo) => {
  console.error('Error captured:', {
    message,
    deviceInfo: {
      productName: deviceInfo.productName,
      vendorId: formatNumberAsHex(deviceInfo.vendorId, 4),
      protocol: deviceInfo.protocol,
    },
  });
};

errorsListenerMiddleware.startListening({
  actionCreator: logAppError,
  effect: async ({payload: {message, deviceInfo}}, listenerApi) => {
    captureError(message, deviceInfo);
  },
});

errorsListenerMiddleware.startListening({
  actionCreator: logKeyboardAPIError,
  effect: async ({payload}, listenerApi) => {
    captureError(
      extractMessageFromKeyboardAPIError(payload),
      payload.deviceInfo,
    );
  },
});

// A keyboard that finishes loading has recovered from what went wrong before
// that load began, so those errors go, and with the last of them the header's
// warning. VID/PID names the keyboard, as a replug brings a new path. What
// failed during the load itself stays.
errorsListenerMiddleware.startListening({
  actionCreator: selectDevice,
  effect: async ({payload: {device}}, listenerApi) => {
    // A newer selection is a new load.
    listenerApi.cancelActiveListeners();
    if (!device) {
      return;
    }
    const selected = listenerApi.getState() as RootState;
    const {selectionGeneration} = selected.devices;
    const before = getNextAppErrorId(selected);
    const [, ready] = await listenerApi.take(
      (action) =>
        markDeviceReady.match(action) &&
        action.payload.devicePath === device.path &&
        action.payload.selectionGeneration === selectionGeneration,
    );
    if ((ready as RootState).devices.readyDevicePath !== device.path) {
      return;
    }
    listenerApi.dispatch(
      clearDeviceErrors({
        vendorId: device.vendorId,
        productId: device.productId,
        before,
      }),
    );
  },
});