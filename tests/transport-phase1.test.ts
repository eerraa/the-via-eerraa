import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import path from 'node:path';
import {configureStore} from '@reduxjs/toolkit';
import {LightingValue} from '@the-via/reader';
import i18n from 'i18next';
import {
  createElement as h,
  type ComponentType,
  type ReactElement,
  type ReactNode,
  useSyncExternalStore,
} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {getI18n, I18nextProvider, setI18n} from 'react-i18next';
import {Provider, useSelector} from 'react-redux';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';
import {Route, Router} from 'wouter';
import staticLocationHook from 'wouter/static-location';
import {ServerStyleSheet} from 'styled-components';
import {
  addHIDTransportGenerationListener,
  configureHIDTransport,
  disconnectHIDDeviceForTesting,
  getHIDTransportDebugState,
  HID,
  isHIDTransportLifecycleCancellationError,
  HIDTransportInvalidReportError,
  HIDTransportTimeoutError,
  registerHIDDeviceForTesting,
  resetHIDTransportForTesting,
} from '../src/shims/node-hid';
import {usbDetect} from '../src/shims/usb-detection';
import {KeyboardAPI, UnhandledCommandError} from '../src/utils/keyboard-api';
import {store as appStore} from '../src/store';
import errorsReducer, {
  clearAppErrors,
  getAppErrors,
} from '../src/store/errorsSlice';
import {
  reloadConnectedDevices,
  selectConnectedDevice,
  selectConnectedDeviceByPath,
} from '../src/store/devicesThunks';
import {
  getUISyncCommandIds,
  parseUISyncRequest,
  UISyncRequestType,
} from '../src/utils/ui-sync';
import devicesReducer, {
  getSelectionGeneration,
  invalidateDeviceConnection,
  markDeviceReady,
  selectDevice,
  updateConnectedDevices,
  updateSupportedIds,
} from '../src/store/devicesSlice';
import keymapReducer, {
  getLoadProgress,
  loadKeymapFromDevice,
} from '../src/store/keymapSlice';
import definitionsReducer, {
  getBasicKeyToByte,
  updateDefinitions,
} from '../src/store/definitionsSlice';
import menusReducer, {
  getCustomCommandsForDefinition,
  getV3MenuComponents,
  getV3Menus,
  syncCustomMenuValuesFromRequest,
} from '../src/store/menusSlice';
import firmwareReducer, {
  updateKeycodesVersion,
} from '../src/store/firmwareSlice';
import settingsReducer from '../src/store/settingsSlice';
import macrosReducer from '../src/store/macrosSlice';
import lightingReducer from '../src/store/lightingSlice';
import designReducer from '../src/store/designSlice';
import definitionNameReducer from '../src/store/definitionNameSlice';
import stateSyncReducer from '../src/store/stateSyncSlice';
import {setEraAdvancedMetadataForTesting} from '../src/utils/era-advanced-metadata';
import {
  decodeKeycodesVersion,
  KeycodesVersionProtocolError,
  UnsupportedKeycodesVersionError,
} from '../src/utils/keycodes-version';
import koTranslation from '../src/locales/ko.json';
import type {ConnectedDevice} from '../src/types/types';

type InputListener = (event: {data: DataView}) => void;

class FakeHIDDevice {
  opened = false;
  vendorId = 0x4552;
  productId = 0xa002;
  productName = 'Fake VIA';
  collections = [{usagePage: 0xff60, usage: 0x61}];
  listeners = new Set<InputListener>();
  listenerHistory: InputListener[] = [];
  sentReports: {reportId: number; data: Uint8Array}[] = [];
  openCount = 0;
  closeCount = 0;
  onSend?: (data: Uint8Array) => void | Promise<void>;

  async open() {
    this.opened = true;
    this.openCount += 1;
  }

  async close() {
    this.opened = false;
    this.closeCount += 1;
  }

  async forget() {
    this.opened = false;
  }

  addEventListener(type: string, listener: InputListener) {
    if (type === 'inputreport') {
      this.listeners.add(listener);
      this.listenerHistory.push(listener);
    }
  }

  removeEventListener(type: string, listener: InputListener) {
    if (type === 'inputreport') {
      this.listeners.delete(listener);
    }
  }

  async sendReport(reportId: number, data: BufferSource) {
    const bytes =
      data instanceof Uint8Array
        ? data.slice()
        : new Uint8Array(data as ArrayBuffer).slice();
    this.sentReports.push({reportId, data: bytes});
    await this.onSend?.(bytes);
  }

  emit(message: Uint8Array) {
    [...this.listeners].forEach((listener) => this.emitTo(listener, message));
  }

  emitTo(listener: InputListener, message: Uint8Array) {
    const copy = message.slice();
    listener({data: new DataView(copy.buffer)});
  }
}

const payload = (...bytes: number[]) => {
  const message = new Uint8Array(32);
  message.set(bytes);
  return message;
};

const report = (...bytes: number[]) => [0, ...payload(...bytes)];

const matchesPrefix =
  (...prefix: number[]) =>
  (message: Uint8Array) =>
    message.length === 32 &&
    prefix.every((value, index) => message[index] === value);

const waitUntil = async (predicate: () => boolean, timeoutMs = 250) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for fake HID state');
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const asHIDDevice = (device: FakeHIDDevice) => device as unknown as HIDDevice;

const installFakeNavigatorHID = (
  getDevices: () => HIDDevice[],
  requestDevice: () => Promise<HIDDevice[]> = async () => getDevices(),
) => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'hid');
  const listeners = new Map<string, Set<(event: {device: HIDDevice}) => void>>();
  const hid = {
    getDevices: async () => getDevices(),
    requestDevice,
    addEventListener: (
      type: string,
      listener: (event: {device: HIDDevice}) => void,
    ) => {
      const typeListeners = listeners.get(type) ?? new Set();
      typeListeners.add(listener);
      listeners.set(type, typeListeners);
    },
    removeEventListener: (
      type: string,
      listener: (event: {device: HIDDevice}) => void,
    ) => listeners.get(type)?.delete(listener),
  };
  Object.defineProperty(navigator, 'hid', {
    configurable: true,
    value: hid,
  });
  return {
    emit: (type: 'connect' | 'disconnect', device: HIDDevice) =>
      listeners.get(type)?.forEach((listener) => listener({device})),
    listenerCount: (type: 'connect' | 'disconnect') =>
      listeners.get(type)?.size ?? 0,
    restore: () => {
      if (originalDescriptor) {
        Object.defineProperty(navigator, 'hid', originalDescriptor);
      } else {
        delete (navigator as Navigator & {hid?: HID}).hid;
      }
    },
  };
};

const connectFake = async (path: string, device = new FakeHIDDevice()) => {
  registerHIDDeviceForTesting(path, asHIDDevice(device));
  const hid = new HID.HID(path);
  await hid.openPromise;
  return {device, hid};
};

type MacroHarnessOptions = {
  size: number;
  logicalBytes?: number[];
  verificationMarkers?: number[];
  failAt?: 'reset' | 'opener' | 'payload' | 'closer';
  dirtyPadding?: boolean;
  onVerificationRead?: () => void;
};

const attachMacroHarness = (
  device: FakeHIDDevice,
  options: MacroHarnessOptions,
) => {
  const markerOffset = options.size - 1;
  const logicalBytes = Array.from(
    {length: Math.max(0, options.size)},
    (_, index) => options.logicalBytes?.[index] ?? 0,
  );
  const verificationMarkers = [...(options.verificationMarkers ?? [0])];
  const getRequests: {offset: number; size: number}[] = [];
  let closeAcknowledged = false;
  let verificationReadCount = 0;

  device.onSend = (data) => {
    if (data[0] === 0x0d) {
      device.emit(payload(0x0d, (options.size >> 8) & 0xff, options.size & 0xff));
      return;
    }
    if (data[0] === 0x10) {
      if (options.failAt === 'reset') {
        throw new Error('reset failed');
      }
      device.emit(payload(0x10));
      return;
    }
    if (data[0] === 0x0f) {
      const offset = (data[1] << 8) | data[2];
      const size = data[3];
      const bytes = Array.from(data.slice(4, 4 + size));
      const isMarkerWrite = offset === markerOffset && size === 1;
      const isOpener = isMarkerWrite && bytes[0] === 0xff;
      const isCloser = isMarkerWrite && bytes[0] === 0;
      if (
        (options.failAt === 'opener' && isOpener) ||
        (options.failAt === 'payload' && !isMarkerWrite) ||
        (options.failAt === 'closer' && isCloser)
      ) {
        throw new Error(`${options.failAt} failed`);
      }
      bytes.forEach((value, index) => {
        if (offset + index < logicalBytes.length) {
          logicalBytes[offset + index] = value;
        }
      });
      if (isCloser) {
        closeAcknowledged = true;
      }
      device.emit(payload(...Array.from(data)));
      return;
    }
    if (data[0] === 0x0e) {
      const offset = (data[1] << 8) | data[2];
      const size = data[3];
      getRequests.push({offset, size});
      const bytes = logicalBytes.slice(offset, offset + size);
      if (closeAcknowledged && offset === markerOffset && size === 1) {
        options.onVerificationRead?.();
        bytes[0] =
          verificationMarkers[
            Math.min(verificationReadCount, verificationMarkers.length - 1)
          ] ?? 0;
        verificationReadCount += 1;
      }
      const response = payload(0x0e, data[1], data[2], size, ...bytes);
      if (options.dirtyPadding) {
        response.fill(0xa5, 4 + size);
      }
      device.emit(response);
    }
  };

  return {getRequests, logicalBytes, get verificationReadCount() {
    return verificationReadCount;
  }};
};

beforeEach(() => {
  resetHIDTransportForTesting();
  configureHIDTransport({
    responseTimeoutMs: 200,
    lifecycleConfirmationMs: 10,
  });
  appStore.dispatch(clearAppErrors());
});

afterEach(() => {
  resetHIDTransportForTesting();
  appStore.dispatch(clearAppErrors());
});

describe('WebHID lifecycle monitoring', () => {
  test('startMonitoring registers one connect/disconnect listener per navigator', () => {
    const fake = new FakeHIDDevice();
    const webDevice = asHIDDevice(fake);
    const navigatorHID = installFakeNavigatorHID(() => [webDevice]);
    let changeCount = 0;
    const onChange = () => {
      changeCount += 1;
    };
    try {
      usbDetect.on('change', onChange);
      usbDetect.startMonitoring();
      usbDetect.startMonitoring();

      expect(navigatorHID.listenerCount('connect')).toBe(1);
      expect(navigatorHID.listenerCount('disconnect')).toBe(1);
      navigatorHID.emit('connect', webDevice);
      expect(changeCount).toBe(1);
    } finally {
      usbDetect.off('change', onChange);
      usbDetect.stopMonitoring();
      navigatorHID.restore();
    }
  });
});

describe('per-device WebHID transport', () => {
  test('timestamp, listener, pending matcher, diagnostic buffer and queue stay path-local', async () => {
    let clock = 0;
    configureHIDTransport({now: () => ++clock});
    const {device: deviceA, hid: hidA} = await connectFake('A');
    const {device: deviceB, hid: hidB} = await connectFake('B');
    const secondA = new HID.HID('A');
    await secondA.openPromise;

    expect(deviceA.listeners.size).toBe(1);
    expect(deviceB.listeners.size).toBe(1);

    const firstA = hidA.exchange(report(0x01), matchesPrefix(0x01));
    await waitUntil(() => deviceA.sentReports.length === 1);
    const aAfterWrite = getHIDTransportDebugState('A');
    expect(aAfterWrite?.lastWriteTimestamp).toBe(1);
    expect(getHIDTransportDebugState('B')?.lastWriteTimestamp).toBe(0);

    const secondQueuedA = hidA.exchange(report(0x02), matchesPrefix(0x02));
    const firstB = hidB.exchange(report(0x03), matchesPrefix(0x03));
    await waitUntil(() => deviceB.sentReports.length === 1);
    expect(getHIDTransportDebugState('A')?.commandQueueDepth).toBe(1);
    expect(getHIDTransportDebugState('B')?.lastWriteTimestamp).toBe(2);
    expect(getHIDTransportDebugState('A')?.lastWriteTimestamp).toBe(1);

    // A's write must not fast-forward or invalidate B's pending response.
    deviceB.emit(payload(0x03, 0xaa));
    expect(Array.from(await firstB).slice(0, 2)).toEqual([0x03, 0xaa]);

    deviceA.emit(payload(0x01, 0xbb));
    await firstA;
    await waitUntil(() => deviceA.sentReports.length === 2);
    deviceA.emit(payload(0x02, 0xcc));
    await secondQueuedA;

    deviceB.emit(payload(0x7f));
    expect(getHIDTransportDebugState('B')?.diagnosticCount).toBe(1);
    expect(getHIDTransportDebugState('A')?.diagnosticCount).toBe(0);
    expect(getHIDTransportDebugState('A')?.hasPendingResponse).toBe(false);
    expect(getHIDTransportDebugState('B')?.hasPendingResponse).toBe(false);
  });

  test('strict 0x16 v1 reports bypass the pending legacy response without consuming it', async () => {
    const {device, hid} = await connectFake('sync');
    const requests: unknown[] = [];
    hid.addInputReportHandler(
      (message) => parseUISyncRequest(message) !== undefined,
      (message) => requests.push(parseUISyncRequest(message)),
    );

    const pending = hid.exchange(
      report(0x08, 0x03, 0x01),
      matchesPrefix(0x08, 0x03, 0x01),
    );
    await waitUntil(() => device.sentReports.length === 1);

    device.emit(payload(0x16, 0x01, 0x01, 0x01, 0x03, 0x01));
    expect(requests).toHaveLength(1);
    expect(getHIDTransportDebugState('sync')?.hasPendingResponse).toBe(true);

    // Count 15 cannot fit 15 channel/command pairs in a 32-byte payload.
    device.emit(payload(0x16, 0x01, 0x01, 0x0f));
    expect(requests).toHaveLength(1);
    expect(getHIDTransportDebugState('sync')?.diagnosticCount).toBe(1);
    expect(getHIDTransportDebugState('sync')?.hasPendingResponse).toBe(true);

    const response = payload(0x08, 0x03, 0x01, 0x5a);
    device.emit(response);
    expect(Array.from(await pending)).toEqual(Array.from(response));
    expect(requests).toHaveLength(1);
  });

  test('timeout poisons the generation and a late identical response cannot satisfy a replacement request', async () => {
    configureHIDTransport({responseTimeoutMs: 15});
    const oldDevice = new FakeHIDDevice();
    oldDevice.onSend = () => new Promise<void>(() => undefined);
    const {hid: oldHID} = await connectFake('late', oldDevice);
    const oldListener = oldDevice.listenerHistory[0];
    const firstGeneration = oldHID.getConnectionGeneration();

    const firstRequest = oldHID.exchange(report(0x01), matchesPrefix(0x01));
    const queuedRequest = oldHID
      .exchange(report(0x02), matchesPrefix(0x02))
      .catch((error) => error);
    let timeoutError: unknown;
    try {
      await firstRequest;
    } catch (error) {
      timeoutError = error;
    }
    expect(timeoutError).toBeInstanceOf(HIDTransportTimeoutError);
    expect(await queuedRequest).toHaveProperty(
      'message',
      expect.stringContaining('timed out'),
    );
    expect(getHIDTransportDebugState('late')?.poisoned).toBe(true);
    expect(getHIDTransportDebugState('late')?.generation).toBeGreaterThan(
      firstGeneration,
    );

    await expect(
      oldHID.exchange(report(0x01), matchesPrefix(0x01)),
    ).rejects.toThrow('poisoned');
    expect(oldDevice.sentReports).toHaveLength(1);

    const replacement = new FakeHIDDevice();
    const {hid: replacementHID} = await connectFake('late', replacement);
    const next = replacementHID.exchange(report(0x01), matchesPrefix(0x01));
    await waitUntil(() => replacement.sentReports.length === 1);

    oldDevice.emitTo(oldListener, payload(0x01, 0x00, 0x07));
    expect(getHIDTransportDebugState('late')?.hasPendingResponse).toBe(true);
    replacement.emit(payload(0x01, 0x00, 0x0d));
    expect(Array.from(await next).slice(0, 3)).toEqual([0x01, 0x00, 0x0d]);
  });

  test.each([false, true])(
    'enumeration (authorize=%s) cannot accept a delayed legacy reply after timeout',
    async (authorize) => {
      configureHIDTransport({responseTimeoutMs: 15});
      const fake = new FakeHIDDevice();
      const webDevice = asHIDDevice(fake);
      const navigatorHID = installFakeNavigatorHID(() => [webDevice]);
      try {
        const path = `poisoned-enumeration-${authorize}`;
        await connectFake(path, fake);
        const api = new KeyboardAPI(path);
        await expect(api.getKeymapBuffer(0, 2)).rejects.toBeInstanceOf(
          HIDTransportTimeoutError,
        );
        const poisonedGeneration = getHIDTransportDebugState(path)?.generation;

        await HID.devices(authorize);
        await HID.devices(false);
        fake.onSend = () => {
          // The device finishes the old request after a host handle was reopened.
          // Both replies arrive at the CURRENT listener, not an old JS closure.
          fake.emit(payload(0x12, 0, 0, 2, 0, 4)); // previous KC_A
          fake.emit(payload(0x12, 0, 0, 2, 0, 5)); // current KC_B
        };
        await expect(api.getKeymapBuffer(0, 2)).rejects.toThrow('poisoned');
        expect(fake.sentReports).toHaveLength(1);
        expect(fake.closeCount).toBe(0);
        expect(fake.openCount).toBe(1);
        expect(fake.listeners.size).toBe(0);
        expect(getHIDTransportDebugState(path)).toMatchObject({
          generation: poisonedGeneration,
          poisoned: true,
          hasPendingResponse: false,
        });
      } finally {
        navigatorHID.restore();
      }
    },
  );

  test('physical disconnect and reconnect allow a fresh read after a legacy timeout', async () => {
    configureHIDTransport({responseTimeoutMs: 15});
    const fake = new FakeHIDDevice();
    const webDevice = asHIDDevice(fake);
    const navigatorHID = installFakeNavigatorHID(() => [webDevice]);
    try {
      const path = 'poisoned-physical-reconnect';
      await connectFake(path, fake);
      await HID.devices(false);
      const retiredListener = fake.listenerHistory[0];
      const api = new KeyboardAPI(path);
      await expect(api.getKeymapBuffer(0, 2)).rejects.toBeInstanceOf(
        HIDTransportTimeoutError,
      );

      fake.opened = false;
      navigatorHID.emit('disconnect', webDevice);
      expect(getHIDTransportDebugState(path)?.disconnected).toBe(true);
      navigatorHID.emit('connect', webDevice);
      await HID.devices(false);
      const response = api.getKeymapBuffer(0, 2);
      await waitUntil(() => fake.sentReports.length === 2);

      fake.emitTo(retiredListener, payload(0x12, 0, 0, 2, 0, 4));
      expect(getHIDTransportDebugState(path)?.hasPendingResponse).toBe(true);
      fake.emit(payload(0x12, 0, 0, 2, 0, 5));
      expect(await response).toEqual([0, 5]);
      expect(fake.listeners.size).toBe(1);
      expect(getHIDTransportDebugState(path)?.poisoned).toBe(false);
    } finally {
      navigatorHID.restore();
    }
  });

  test('a genuine KeyboardAPI timeout remains user-visible', async () => {
    configureHIDTransport({responseTimeoutMs: 15});
    await connectFake('app-timeout');
    const api = new KeyboardAPI('app-timeout');

    await expect(api.getProtocolVersion()).rejects.toBeInstanceOf(
      HIDTransportTimeoutError,
    );

    const errors = getAppErrors(appStore.getState());
    expect(errors).toHaveLength(1);
    expect(errors[0].message.length).toBeGreaterThan(0);
    expect(getHIDTransportDebugState('app-timeout')?.poisoned).toBe(true);
    expect(getHIDTransportDebugState('app-timeout')?.disconnected).toBe(false);
  });

  test('a wrong-prefix response remains a user-visible failed protocol exchange', async () => {
    configureHIDTransport({responseTimeoutMs: 15});
    const {device} = await connectFake('bad-response');
    device.onSend = () => {
      device.emit(payload(0x7f, 0x00, 0x0d));
    };
    const api = new KeyboardAPI('bad-response');

    const request = api.getProtocolVersion().then(
      () => undefined,
      (error) => error,
    );
    await waitUntil(
      () => getHIDTransportDebugState('bad-response')?.diagnosticCount === 1,
    );
    expect(getHIDTransportDebugState('bad-response')?.hasPendingResponse).toBe(
      true,
    );
    expect(await request).toBeInstanceOf(HIDTransportTimeoutError);
    expect(getHIDTransportDebugState('bad-response')?.poisoned).toBe(true);

    const errors = getAppErrors(appStore.getState());
    expect(errors).toHaveLength(1);
    expect(errors[0].message.length).toBeGreaterThan(0);
  });

  test('an unhandled reply fails only its own request, at once, and keeps the connection', async () => {
    const {device, hid} = await connectFake('unhandled');
    const generation = hid.getConnectionGeneration();
    device.onSend = (data) => {
      if (data[0] === 0x08) {
        // id_unhandled: the request comes back with its first byte set to 0xFF.
        device.emit(Uint8Array.from([0xff, ...data.slice(1)]));
      } else if (data[0] === 0x01) {
        device.emit(payload(0x01, 0x00, 0x0c));
      }
    };
    const api = new KeyboardAPI('unhandled');

    await expect(api.getCustomMenuValue([0x05, 0x02])).rejects.toBeInstanceOf(
      UnhandledCommandError,
    );
    expect(getHIDTransportDebugState('unhandled')).toMatchObject({
      generation,
      poisoned: false,
      disconnected: false,
      hasPendingResponse: false,
      diagnosticCount: 0,
    });
    expect(await api.getProtocolVersion()).toBe(12);

    // One entry: the reply with its bytes, not a second one for the same failure.
    const errors = getAppErrors(appStore.getState());
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Command Name: CUSTOM_MENU_GET_VALUE');
    expect(errors[0].message).toContain('Response: 255 5 2 0');
  });

  test('a 0xFF report that does not echo the pending request is not its reply', async () => {
    const {device} = await connectFake('stray-unhandled');
    const api = new KeyboardAPI('stray-unhandled');
    const version = api.getProtocolVersion();
    await waitUntil(() => device.sentReports.length === 1);

    // A late unhandled State Sync answer also starts with 0xFF.
    device.emit(payload(0xff, 0x06, 0x01, 0x00, 0x00, 0x01));
    expect(getHIDTransportDebugState('stray-unhandled')).toMatchObject({
      hasPendingResponse: true,
      diagnosticCount: 1,
    });
    device.emit(payload(0x01, 0x00, 0x0c));
    expect(await version).toBe(12);
  });

  test.each([300, -1, 1.5])(
    'a report value that is not a byte (%s) is refused before anything is sent',
    async (value) => {
      const path = `not-a-byte-${value}`;
      const {device, hid} = await connectFake(path);
      const generation = hid.getConnectionGeneration();
      device.onSend = (data) => device.emit(data);
      const api = new KeyboardAPI(path);

      await expect(
        api.setBacklightValue(LightingValue.BACKLIGHT_BRIGHTNESS, value),
      ).rejects.toBeInstanceOf(HIDTransportInvalidReportError);
      expect(device.sentReports).toHaveLength(0);
      expect(getHIDTransportDebugState(path)).toMatchObject({
        generation,
        poisoned: false,
        hasPendingResponse: false,
        commandQueueDepth: 0,
      });

      await api.setBacklightValue(LightingValue.BACKLIGHT_BRIGHTNESS, 255);
      expect(Array.from(device.sentReports[0].data.slice(0, 3))).toEqual([
        0x07, 0x09, 0xff,
      ]);
    },
  );

  test('a write failure while the WebHID device is still connected remains user-visible', async () => {
    const fake = new FakeHIDDevice();
    const webDevice = asHIDDevice(fake);
    const navigatorHID = installFakeNavigatorHID(() => [webDevice]);
    try {
      await connectFake('connected-write-failure', fake);
      fake.onSend = () => {
        throw new Error('connected write failed');
      };
      const api = new KeyboardAPI('connected-write-failure');

      await expect(api.getProtocolVersion()).rejects.toThrow(
        'connected write failed',
      );

      await waitUntil(() => getAppErrors(appStore.getState()).length === 1);
      const errors = getAppErrors(appStore.getState());
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('connected write failed');
      expect(
        getHIDTransportDebugState('connected-write-failure')?.poisoned,
      ).toBe(true);
      expect(
        getHIDTransportDebugState('connected-write-failure')?.disconnected,
      ).toBe(false);
    } finally {
      navigatorHID.restore();
    }
  });

  test('device disappearance turns the failed write and queued work into silent lifecycle cancellation', async () => {
    const fake = new FakeHIDDevice();
    const webDevice = asHIDDevice(fake);
    let connected = true;
    const navigatorHID = installFakeNavigatorHID(() =>
      connected ? [webDevice] : [],
    );
    const generationChanges: {path: string; generation: number; reason: string}[] =
      [];
    const removeGenerationListener = addHIDTransportGenerationListener(
      (change) => generationChanges.push(change),
    );
    try {
      const {hid} = await connectFake('disappeared-write', fake);
      const initialGeneration = hid.getConnectionGeneration();
      fake.onSend = () => {
        connected = false;
        throw new Error('generic write rejection after removal');
      };
      const api = new KeyboardAPI('disappeared-write');

      const results = await Promise.allSettled([
        api.getProtocolVersion(),
        api.getProtocolVersion(),
        api.getLayerCount(),
      ]);

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') {
          expect(isHIDTransportLifecycleCancellationError(result.reason)).toBe(
            true,
          );
        }
      });
      expect(getAppErrors(appStore.getState())).toHaveLength(0);
      expect(getHIDTransportDebugState('disappeared-write')?.generation).toBe(
        initialGeneration + 1,
      );
      expect(getHIDTransportDebugState('disappeared-write')?.poisoned).toBe(
        false,
      );
      expect(getHIDTransportDebugState('disappeared-write')?.disconnected).toBe(
        true,
      );
      expect(generationChanges).toHaveLength(1);
      expect(generationChanges[0].reason).toBe('failed during write');
    } finally {
      removeGenerationListener();
      navigatorHID.restore();
    }
  });

  test('a delayed WebHID disconnect after write rejection stays silent after the device was already loaded', async () => {
    const fake = new FakeHIDDevice();
    const webDevice = asHIDDevice(fake);
    let connected = true;
    const navigatorHID = installFakeNavigatorHID(() =>
      connected ? [webDevice] : [],
    );
    try {
      await connectFake('post-load-disconnect-race', fake);
      await HID.getFilteredDevices();
      fake.onSend = () => {
        setTimeout(() => {
          connected = false;
          navigatorHID.emit('disconnect', webDevice);
        }, 5);
        throw new Error('write rejected just before disconnect event');
      };
      const api = new KeyboardAPI('post-load-disconnect-race');

      await expect(api.getProtocolVersion()).rejects.toThrow(
        'write rejected just before disconnect event',
      );
      await waitUntil(
        () => getHIDTransportDebugState('post-load-disconnect-race')?.disconnected === true,
      );

      expect(getAppErrors(appStore.getState())).toHaveLength(0);
    } finally {
      navigatorHID.restore();
    }
  });

  test('disconnect/reconnect rejects old work and discards the old listener generation', async () => {
    const {device, hid} = await connectFake('reconnect');
    const generationChanges: {path: string; generation: number}[] = [];
    const removeGenerationListener = addHIDTransportGenerationListener(
      ({path, generation}) => generationChanges.push({path, generation}),
    );
    const oldListener = device.listenerHistory[0];
    const oldRequest = hid.exchange(report(0x04), matchesPrefix(0x04));
    await waitUntil(() => device.sentReports.length === 1);

    disconnectHIDDeviceForTesting('reconnect');
    await expect(oldRequest).rejects.toThrow('disconnected');
    registerHIDDeviceForTesting('reconnect', asHIDDevice(device));
    const reconnected = new HID.HID('reconnect');
    await reconnected.openPromise;

    const next = reconnected.exchange(report(0x05), matchesPrefix(0x05));
    await waitUntil(() => device.sentReports.length === 2);
    device.emitTo(oldListener, payload(0x05, 0xaa));
    expect(getHIDTransportDebugState('reconnect')?.hasPendingResponse).toBe(
      true,
    );
    device.emit(payload(0x05, 0xbb));
    expect(Array.from(await next).slice(0, 2)).toEqual([0x05, 0xbb]);
    expect(device.listeners.size).toBe(1);
    expect(generationChanges.map(({path}) => path)).toEqual([
      'reconnect',
      'reconnect',
    ]);
    removeGenerationListener();
  });

  test('ordinary KeyboardAPI command transcript remains a 32-byte VIA payload', async () => {
    const {device} = await connectFake('transcript');
    device.onSend = (data) => {
      if (data[0] === 0x01) {
        device.emit(payload(0x01, 0x00, 0x0d));
      }
    };

    const api = new KeyboardAPI('transcript');
    expect(await api.getProtocolVersion()).toBe(13);
    expect(device.sentReports).toHaveLength(1);
    expect(device.sentReports[0].reportId).toBe(0);
    expect(device.sentReports[0].data).toHaveLength(32);
    expect(Array.from(device.sentReports[0].data)).toEqual(
      Array.from(payload(0x01)),
    );
  });

  test('a reservation owns one path while other paths and owner-direct exchanges keep progressing', async () => {
    const {device: deviceA, hid: hidA} = await connectFake('reserved-A');
    const {device: deviceB, hid: hidB} = await connectFake('reserved-B');
    const owner = Symbol('foreground-operation');
    const generation = hidA.getConnectionGeneration();
    let releaseOwner = () => undefined;
    const ownerGate = new Promise<void>((resolve) => {
      releaseOwner = resolve;
    });

    const reservation = hidA.withPathReservation(
      generation,
      owner,
      async () => {
        const first = hidA.exchange(report(0x31), matchesPrefix(0x31), {
          reservationOwner: owner,
          expectedGeneration: generation,
        });
        await waitUntil(() => deviceA.sentReports.length === 1);
        deviceA.emit(payload(0x31, 0x01));
        await first;
        await ownerGate;
        return hidA.withPathReservation(generation, owner, async () => {
          const second = hidA.exchange(report(0x32), matchesPrefix(0x32), {
            reservationOwner: owner,
            expectedGeneration: generation,
          });
          await waitUntil(() => deviceA.sentReports.length === 2);
          deviceA.emit(payload(0x32, 0x02));
          return second;
        });
      },
    );
    await waitUntil(
      () => getHIDTransportDebugState('reserved-A')?.hasActiveReservation === true,
    );

    await expect(
      hidA.exchange(report(0x7e), matchesPrefix(0x7e), {
        reservationOwner: Symbol('wrong-owner'),
        expectedGeneration: generation,
      }),
    ).rejects.toThrow('no matching reservation');

    const queuedA = hidA.exchange(report(0x33), matchesPrefix(0x33));
    const independentB = hidB.exchange(report(0x41), matchesPrefix(0x41));
    await waitUntil(() => deviceB.sentReports.length === 1);
    deviceB.emit(payload(0x41, 0x0b));
    expect(Array.from(await independentB).slice(0, 2)).toEqual([0x41, 0x0b]);
    expect(deviceA.sentReports.map(({data}) => data[0])).toEqual([0x31]);

    releaseOwner();
    expect(Array.from(await reservation).slice(0, 2)).toEqual([0x32, 0x02]);
    await waitUntil(() => deviceA.sentReports.length === 3);
    expect(deviceA.sentReports.map(({data}) => data[0])).toEqual([
      0x31, 0x32, 0x33,
    ]);
    deviceA.emit(payload(0x33, 0x03));
    await queuedA;
  });

  test('a preserved timeout releases a reservation and later queued work runs', async () => {
    configureHIDTransport({responseTimeoutMs: 15});
    const {device, hid} = await connectFake('reservation-timeout');
    const generation = hid.getConnectionGeneration();
    const owner = Symbol('timing-out-operation');

    const reservation = hid.withPathReservation(
      generation,
      owner,
      () =>
        hid.exchange(report(0x51), matchesPrefix(0x51), {
          reservationOwner: owner,
          expectedGeneration: generation,
          timeoutBehavior: 'preserve-generation',
        }),
    );
    const queued = hid.exchange(report(0x52), matchesPrefix(0x52));

    await expect(reservation).rejects.toBeInstanceOf(HIDTransportTimeoutError);
    await waitUntil(() => device.sentReports.length === 2);
    expect(getHIDTransportDebugState('reservation-timeout')?.hasActiveReservation).toBe(
      false,
    );
    device.emit(payload(0x52, 0x01));
    await queued;
  });

  test('a malformed operation releases its reservation without stranding the path', async () => {
    const {device, hid} = await connectFake('reservation-malformed');
    const generation = hid.getConnectionGeneration();
    const owner = Symbol('malformed-operation');
    const reservation = hid.withPathReservation(
      generation,
      owner,
      async () => {
        const response = hid.exchange(report(0x61), matchesPrefix(0x61), {
          reservationOwner: owner,
          expectedGeneration: generation,
        });
        await waitUntil(() => device.sentReports.length === 1);
        device.emit(payload(0x61, 0xff));
        if ((await response)[1] !== 0) {
          throw new Error('malformed response');
        }
      },
    );
    const queued = hid.exchange(report(0x62), matchesPrefix(0x62));

    await expect(reservation).rejects.toThrow('malformed response');
    await waitUntil(() => device.sentReports.length === 2);
    device.emit(payload(0x62));
    await queued;
  });

  test('disconnect rejects an active reservation and every waiter', async () => {
    const device = new FakeHIDDevice();
    const {hid} = await connectFake('reservation-replaced', device);
    const generation = hid.getConnectionGeneration();
    const owner = Symbol('replaced-operation');
    const active = hid.withPathReservation(
      generation,
      owner,
      () =>
        hid.exchange(report(0x71), matchesPrefix(0x71), {
          reservationOwner: owner,
          expectedGeneration: generation,
        }),
    );
    const waiter = hid.exchange(report(0x72), matchesPrefix(0x72));
    const waitingReservation = hid.withPathReservation(
      generation,
      Symbol('waiting-operation'),
      async () => undefined,
    );
    const activeResult = active.catch((error) => error as Error);
    const waiterResult = waiter.catch((error) => error as Error);
    const waitingResult = waitingReservation.catch((error) => error as Error);
    await waitUntil(() => device.sentReports.length === 1);

    disconnectHIDDeviceForTesting('reservation-replaced');
    expect((await activeResult).message).toContain('disconnected');
    expect((await waiterResult).message).toContain('disconnected');
    expect((await waitingResult).message).toContain('disconnected');
    expect(getHIDTransportDebugState('reservation-replaced')?.hasActiveReservation).toBe(
      false,
    );

    registerHIDDeviceForTesting('reservation-replaced', asHIDDevice(device));
    const replacement = new HID.HID('reservation-replaced');
    await replacement.openPromise;
    const next = replacement.exchange(report(0x73), matchesPrefix(0x73));
    await waitUntil(() => device.sentReports.length === 2);
    device.emit(payload(0x73));
    await next;
  });

  test('generation replacement rejects active and waiting owners without a disconnect event', async () => {
    const oldDevice = new FakeHIDDevice();
    const {hid} = await connectFake('reservation-device-replaced', oldDevice);
    const generation = hid.getConnectionGeneration();
    const owner = Symbol('device-replaced-operation');
    const active = hid.withPathReservation(
      generation,
      owner,
      () =>
        hid.exchange(report(0x74), matchesPrefix(0x74), {
          reservationOwner: owner,
          expectedGeneration: generation,
        }),
    );
    const waitingReservation = hid.withPathReservation(
      generation,
      Symbol('device-replaced-waiter'),
      async () => undefined,
    );
    const activeResult = active.catch((error) => error as Error);
    const waitingResult = waitingReservation.catch((error) => error as Error);
    await waitUntil(() => oldDevice.sentReports.length === 1);

    const replacementDevice = new FakeHIDDevice();
    registerHIDDeviceForTesting(
      'reservation-device-replaced',
      asHIDDevice(replacementDevice),
    );

    expect((await activeResult).message).toContain('was replaced');
    expect((await waitingResult).message).toContain('was replaced');
    expect(
      getHIDTransportDebugState('reservation-device-replaced')
        ?.hasActiveReservation,
    ).toBe(false);

    const replacement = new HID.HID('reservation-device-replaced');
    await replacement.openPromise;
    const next = replacement.exchange(report(0x75), matchesPrefix(0x75));
    await waitUntil(() => replacementDevice.sentReports.length === 1);
    replacementDevice.emit(payload(0x75));
    await next;
  });

  test('slow keymap writes resolve only after every SET and propagate the first failure', async () => {
    const {device} = await connectFake('slow-keymap-completion');
    let setCount = 0;
    device.onSend = (data) => {
      if (data[0] !== 0x05) {
        return;
      }
      setCount += 1;
      if (setCount === 1) {
        device.emit(payload(...Array.from(data)));
      }
    };
    let settled = false;
    const writing = new KeyboardAPI('slow-keymap-completion')
      .slowWriteRawMatrix({rows: 1, cols: 2}, [[0x0101, 0x0202]])
      .then(() => {
        settled = true;
      });
    await waitUntil(() => device.sentReports.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    device.emit(payload(...Array.from(device.sentReports[1].data)));
    await writing;
    expect(settled).toBe(true);

    const {device: failing} = await connectFake('slow-keymap-failure');
    let failingSetCount = 0;
    failing.onSend = (data) => {
      if (data[0] !== 0x05) {
        return;
      }
      failingSetCount += 1;
      if (failingSetCount === 2) {
        throw new Error('second key failed');
      }
      failing.emit(payload(...Array.from(data)));
    };
    await expect(
      new KeyboardAPI('slow-keymap-failure').slowWriteRawMatrix(
        {rows: 1, cols: 3},
        [[0x0101, 0x0202, 0x0303]],
      ),
    ).rejects.toThrow('second key failed');
    expect(failing.sentReports).toHaveLength(2);
  });
});

const makeProtocolReloadStore = () =>
  configureStore({
    reducer: {
      devices: devicesReducer,
      definitions: definitionsReducer,
      errors: errorsReducer,
    },
  });

describe('protocol probe lifecycle classification', () => {
  test('a successful but unsupported protocol response remains an invalid-protocol error', async () => {
    const fake = new FakeHIDDevice();
    const webDevice = asHIDDevice(fake);
    (webDevice as HIDDevice & {__path?: string}).__path = 'invalid-protocol';
    fake.onSend = (data) => {
      if (data[0] === 0x01) {
        fake.emit(payload(0x01, 0x00, 0x06));
      }
    };
    const navigatorHID = installFakeNavigatorHID(() => [webDevice]);
    try {
      const protocolStore = makeProtocolReloadStore();
      const dispatch = protocolStore.dispatch as any;
      const vendorProductId = fake.vendorId * 65536 + fake.productId;
      dispatch(
        updateSupportedIds({
          [vendorProductId]: {v2: true, v3: true},
        }),
      );

      await dispatch(reloadConnectedDevices());

      const state = protocolStore.getState();
      expect(state.errors.appErrors).toHaveLength(1);
      expect(state.errors.appErrors[0].message).toBe(
        'Received invalid protocol version from device',
      );
      expect(
        state.devices.invalidProtocolDevicePaths['invalid-protocol'],
      ).toBeDefined();
    } finally {
      navigatorHID.restore();
    }
  });

  test('device disappearance during protocol probing is neither an AppError nor invalid protocol', async () => {
    const fake = new FakeHIDDevice();
    const webDevice = asHIDDevice(fake);
    (webDevice as HIDDevice & {__path?: string}).__path =
      'protocol-probe-disappeared';
    let connected = true;
    fake.onSend = () => {
      connected = false;
      throw new Error('write rejected after device removal');
    };
    const navigatorHID = installFakeNavigatorHID(() =>
      connected ? [webDevice] : [],
    );
    try {
      const protocolStore = makeProtocolReloadStore();
      const dispatch = protocolStore.dispatch as any;
      const vendorProductId = fake.vendorId * 65536 + fake.productId;
      dispatch(
        updateSupportedIds({
          [vendorProductId]: {v2: true, v3: true},
        }),
      );

      await dispatch(reloadConnectedDevices());

      const state = protocolStore.getState();
      expect(state.errors.appErrors).toHaveLength(0);
      expect(Object.keys(state.devices.invalidProtocolDevicePaths)).toHaveLength(
        0,
      );
      expect(getAppErrors(appStore.getState())).toHaveLength(0);
      expect(
        getHIDTransportDebugState('protocol-probe-disappeared')?.disconnected,
      ).toBe(true);
    } finally {
      navigatorHID.restore();
    }
  });
});

describe('exact macro buffer transactions', () => {
  test('writes RESET, FF, bounded payload chunks, zero, then an exact marker GET', async () => {
    const {device} = await connectFake('macro-transcript');
    const harness = attachMacroHarness(device, {size: 31});
    const data = Array.from({length: 29}, (_, index) => index + 1);

    await new KeyboardAPI('macro-transcript').setMacroBytes(data);

    expect(device.sentReports.map(({data: reportData}) => reportData[0])).toEqual([
      0x0d, 0x10, 0x0f, 0x0f, 0x0f, 0x0f, 0x0e,
    ]);
    const writes = device.sentReports
      .filter(({data: reportData}) => reportData[0] === 0x0f)
      .map(({data: reportData}) => ({
        offset: (reportData[1] << 8) | reportData[2],
        size: reportData[3],
        bytes: Array.from(reportData.slice(4, 4 + reportData[3])),
      }));
    expect(writes).toEqual([
      {offset: 30, size: 1, bytes: [0xff]},
      {offset: 0, size: 28, bytes: data.slice(0, 28)},
      {offset: 28, size: 1, bytes: data.slice(28)},
      {offset: 30, size: 1, bytes: [0]},
    ]);
    expect(harness.getRequests).toEqual([{offset: 30, size: 1}]);
  });

  test('rejects B=0 before RESET and handles the B=1 empty-payload boundary', async () => {
    const {device: invalid} = await connectFake('macro-size-zero');
    attachMacroHarness(invalid, {size: 0});
    await expect(
      new KeyboardAPI('macro-size-zero').setMacroBytes([]),
    ).rejects.toThrow('completion marker');
    expect(invalid.sentReports.map(({data}) => data[0])).toEqual([0x0d]);

    const {device: boundary} = await connectFake('macro-size-one');
    const harness = attachMacroHarness(boundary, {size: 1});
    const api = new KeyboardAPI('macro-size-one');
    expect(await api.getMacroBytes()).toEqual([]);
    await api.setMacroBytes([]);
    expect(
      boundary.sentReports
        .filter(({data}) => data[0] === 0x0f)
        .map(({data}) => data[4]),
    ).toEqual([0xff, 0]);
    expect(harness.getRequests.at(-1)).toEqual({offset: 0, size: 1});
  });

  test('never writes across the marker capacity', async () => {
    const {device} = await connectFake('macro-capacity');
    attachMacroHarness(device, {size: 4});

    await expect(
      new KeyboardAPI('macro-capacity').setMacroBytes([1, 2, 3, 4]),
    ).rejects.toThrow('payload capacity (3)');
    expect(device.sentReports.map(({data}) => data[0])).toEqual([0x0d]);
  });

  // The transport would refuse such a value only in the payload, after RESET had
  // already erased every macro on the keyboard.
  test('refuses a payload value outside 0-255 before RESET, so the macros stay', async () => {
    const {device} = await connectFake('macro-not-a-byte');
    const harness = attachMacroHarness(device, {
      size: 4,
      logicalBytes: [65, 0, 0, 0],
    });
    const api = new KeyboardAPI('macro-not-a-byte');

    // 0xd55c is a Korean syllable typed into a script.
    for (const value of [0xd55c, 256, -1, 1.5, undefined]) {
      await expect(api.setMacroBytes([72, value as number, 0])).rejects.toThrow(
        'not 0-255',
      );
    }
    expect(device.sentReports).toEqual([]);
    expect(harness.logicalBytes).toEqual([65, 0, 0, 0]);
  });

  test('reads exactly B logical bytes, trims HID padding, and sizes the final request', async () => {
    const {device} = await connectFake('macro-read-exact');
    const payloadBytes = Array.from({length: 29}, (_, index) => index + 1);
    const harness = attachMacroHarness(device, {
      size: 30,
      logicalBytes: [...payloadBytes, 0],
      dirtyPadding: true,
    });

    expect(await new KeyboardAPI('macro-read-exact').getMacroBytes()).toEqual(
      payloadBytes,
    );
    expect(harness.getRequests).toEqual([
      {offset: 0, size: 28},
      {offset: 28, size: 2},
    ]);
  });

  test('rejects a nonzero logical completion marker', async () => {
    const {device} = await connectFake('macro-open-read');
    attachMacroHarness(device, {size: 3, logicalBytes: [65, 0, 0xff]});
    await expect(
      new KeyboardAPI('macro-open-read').getMacroBytes(),
    ).rejects.toThrow('incomplete');
  });

  for (const failAt of ['reset', 'opener', 'payload'] as const) {
    test(`${failAt} failure never sends the final zero`, async () => {
      const {device} = await connectFake(`macro-fail-${failAt}`);
      attachMacroHarness(device, {size: 3, failAt});
      await expect(
        new KeyboardAPI(`macro-fail-${failAt}`).setMacroBytes([65, 0]),
      ).rejects.toThrow(`${failAt} failed`);
      const markerWrites = device.sentReports
        .filter(({data}) => {
          const offset = (data[1] << 8) | data[2];
          return data[0] === 0x0f && offset === 2 && data[3] === 1;
        })
        .map(({data}) => data[4]);
      expect(markerWrites).not.toContain(0);
    });
  }

  test('final-zero failure is attempted once and never retries a mutation', async () => {
    const {device} = await connectFake('macro-fail-closer');
    attachMacroHarness(device, {size: 3, failAt: 'closer'});
    await expect(
      new KeyboardAPI('macro-fail-closer').setMacroBytes([65, 0]),
    ).rejects.toThrow('closer failed');
    const commands = device.sentReports.map(({data}) => data[0]);
    expect(commands).toEqual([0x0d, 0x10, 0x0f, 0x0f, 0x0f]);
    expect(
      device.sentReports.filter(
        ({data}) => data[0] === 0x0f && data[4] === 0,
      ),
    ).toHaveLength(1);
  });

  test('retries marker-only GETs with no mutation retry until FF becomes zero', async () => {
    const {device} = await connectFake('macro-marker-retry');
    const harness = attachMacroHarness(device, {
      size: 3,
      verificationMarkers: [0xff, 0xff, 0xff, 0],
    });
    await new KeyboardAPI('macro-marker-retry').setMacroBytes([65, 0]);
    expect(harness.verificationReadCount).toBe(4);
    expect(
      device.sentReports.filter(({data}) => data[0] === 0x0e),
    ).toHaveLength(4);
    expect(
      device.sentReports.filter(({data}) => data[0] === 0x0f),
    ).toHaveLength(3);
  });

  test('accepts one FF marker followed by zero using GET-only retry', async () => {
    const {device} = await connectFake('macro-marker-one-retry');
    const harness = attachMacroHarness(device, {
      size: 3,
      verificationMarkers: [0xff, 0],
    });

    await new KeyboardAPI('macro-marker-one-retry').setMacroBytes([65, 0]);

    expect(harness.verificationReadCount).toBe(2);
    expect(
      device.sentReports.filter(({data}) => data[0] === 0x0e),
    ).toHaveLength(2);
    expect(
      device.sentReports.filter(({data}) => data[0] === 0x0f),
    ).toHaveLength(3);
  });

  test(
    'a permanently open marker fails at the bounded verification deadline',
    async () => {
      const {device} = await connectFake('macro-marker-deadline');
      const harness = attachMacroHarness(device, {
        size: 1,
        verificationMarkers: [0xff],
      });
      const startedAt = Date.now();
      await expect(
        new KeyboardAPI('macro-marker-deadline').setMacroBytes([]),
      ).rejects.toThrow('verification timed out');
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(4900);
      expect(harness.verificationReadCount).toBeGreaterThan(5);
      expect(
        device.sentReports.filter(({data}) => data[0] === 0x0f),
      ).toHaveLength(2);
    },
    7000,
  );

  test('malformed read timeout and generation replacement fail the operation', async () => {
    configureHIDTransport({responseTimeoutMs: 15});
    const {device: malformed} = await connectFake('macro-malformed');
    malformed.onSend = (data) => {
      if (data[0] === 0x0d) {
        malformed.emit(payload(0x0d, 0x00, 0x02));
      } else if (data[0] === 0x0e) {
        malformed.emit(new Uint8Array(31));
      }
    };
    await expect(
      new KeyboardAPI('macro-malformed').getMacroBytes(),
    ).rejects.toBeInstanceOf(HIDTransportTimeoutError);

    const path = 'macro-generation-replaced';
    const {device: replaced} = await connectFake(path);
    attachMacroHarness(replaced, {
      size: 1,
      onVerificationRead: () => disconnectHIDDeviceForTesting(path),
    });
    await expect(
      new KeyboardAPI(path).setMacroBytes([]),
    ).rejects.toThrow('disconnected');
  });
});

describe('strict UI_SYNC_REQUEST v1 grammar', () => {
  test('validates length, version, type, count and payload bounds while preserving all three semantics', () => {
    expect(parseUISyncRequest(payload(0x16, 1, 0, 0))).toEqual({
      type: UISyncRequestType.CUSTOM_MENU_ALL,
    });
    expect(parseUISyncRequest(payload(0x16, 1, 0, 1))).toBeUndefined();
    expect(parseUISyncRequest(payload(0x16, 2, 0, 0))).toBeUndefined();
    expect(parseUISyncRequest(payload(0x16, 1, 3, 0))).toBeUndefined();
    expect(parseUISyncRequest(new Uint8Array([0x16, 1, 0, 0]))).toBeUndefined();
    expect(parseUISyncRequest(payload(0x16, 1, 1, 15))).toBeUndefined();
    expect(parseUISyncRequest(payload(0x16, 1, 2, 29))).toBeUndefined();

    const commands = {alpha: [3, 1], beta: [3, 2], gamma: [4, 1]};
    const all = parseUISyncRequest(payload(0x16, 1, 0, 0));
    const targets = parseUISyncRequest(payload(0x16, 1, 1, 2, 3, 2, 4, 1));
    const ids = parseUISyncRequest(payload(0x16, 1, 2, 1, 1));
    expect(all && getUISyncCommandIds(all, commands)).toBeUndefined();
    expect(targets && getUISyncCommandIds(targets, commands)).toEqual([
      'beta',
      'gamma',
    ]);
    expect(ids && getUISyncCommandIds(ids, commands)).toEqual([
      'alpha',
      'gamma',
    ]);
  });
});

const makeConnectedDevice = (
  path: string,
  vendorProductId: number,
): ConnectedDevice => ({
  path,
  productId: vendorProductId & 0xffff,
  vendorId: Math.floor(vendorProductId / 65536),
  protocol: 13,
  productName: `Fake ${path}`,
  hasResolvedDefinition: true,
  requiredDefinitionVersion: 'v3',
  vendorProductId,
});

const makeCacheTestStore = () =>
  configureStore({
    reducer: {
      devices: devicesReducer,
      keymap: keymapReducer,
      definitions: definitionsReducer,
      menus: menusReducer,
      firmware: firmwareReducer,
    },
  });

describe('explicit device and cache generation ownership', () => {
  test('disconnect during keymap load invalidates the selected lifecycle and cannot commit a late layer', async () => {
    const vendorProductId = 1163042818;
    const generatedDefinition = await Bun.file(
      'public/definitions/era/v3/1163042818.json',
    ).json();
    const definition = {
      ...generatedDefinition,
      matrix: {rows: 1, cols: 1},
    };
    const connectedDevice = makeConnectedDevice(
      'keymap-disconnect',
      vendorProductId,
    );
    const {device: fake, hid} = await connectFake(connectedDevice.path);
    let releaseKeymapResponse: (() => void) | undefined;
    fake.onSend = (data) => {
      if (data[0] === 0x01) {
        fake.emit(payload(0x01, 0x00, 0x0d));
      } else if (data[0] === 0x11) {
        fake.emit(payload(0x11, 0x01));
      } else if (data[0] === 0x12) {
        releaseKeymapResponse = () =>
          fake.emit(payload(0x12, data[1], data[2], data[3], 0x12, 0x34));
      }
    };

    const cacheStore = makeCacheTestStore();
    const dispatch = cacheStore.dispatch as any;
    dispatch(
      updateDefinitions({
        [vendorProductId]: {v3: definition},
      } as any),
    );
    dispatch(
      updateConnectedDevices({
        [connectedDevice.path]: connectedDevice,
      }),
    );
    const initialGeneration = hid.getConnectionGeneration();
    dispatch(
      selectDevice({
        device: connectedDevice,
        connectionGeneration: initialGeneration,
      }),
    );
    const selectionGeneration = getSelectionGeneration(cacheStore.getState() as any);
    const removeGenerationListener = addHIDTransportGenerationListener(
      ({path, generation, poisoned}) =>
        dispatch(
          invalidateDeviceConnection({
            devicePath: path,
            connectionGeneration: generation,
            locked: poisoned,
          }),
        ),
    );

    try {
      const loadResult = Promise.resolve(
        dispatch(loadKeymapFromDevice(connectedDevice)),
      ).then(
        () => undefined,
        (error) => error,
      );
      await waitUntil(() => releaseKeymapResponse !== undefined);

      disconnectHIDDeviceForTesting(connectedDevice.path);
      const error = await loadResult;
      releaseKeymapResponse?.();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(isHIDTransportLifecycleCancellationError(error)).toBe(true);
      const state = cacheStore.getState();
      expect(state.devices.selectedConnectionNeedsReload).toBe(true);
      expect(state.devices.selectionGeneration).toBe(selectionGeneration + 1);
      expect(state.devices.selectedConnectionGeneration).toBe(
        initialGeneration + 1,
      );
      expect(state.keymap.rawDeviceMap[connectedDevice.path]).toHaveLength(1);
      expect(state.keymap.rawDeviceMap[connectedDevice.path][0].isLoaded).toBe(
        false,
      );
      expect(getLoadProgress(state as any)).toBe(0);
      expect(getAppErrors(appStore.getState())).toHaveLength(0);
    } finally {
      removeGenerationListener();
    }
  });

  test('a keymap read continues on its captured API and cannot complete the newly selected device cache', async () => {
    const vendorProductId = 1163042818;
    const generatedDefinition = await Bun.file(
      'public/definitions/era/v3/1163042818.json',
    ).json();
    const definition = {
      ...generatedDefinition,
      matrix: {rows: 1, cols: 1},
    };
    const deviceA = makeConnectedDevice('keymap-A', vendorProductId);
    const deviceB = makeConnectedDevice('keymap-B', vendorProductId);
    const {device: fakeA} = await connectFake(deviceA.path);
    const {hid: hidB} = await connectFake(deviceB.path);
    let releaseKeymapResponse: (() => void) | undefined;
    fakeA.onSend = (data) => {
      if (data[0] === 0x01) {
        fakeA.emit(payload(0x01, 0x00, 0x0d));
      } else if (data[0] === 0x11) {
        fakeA.emit(payload(0x11, 0x01));
      } else if (data[0] === 0x12) {
        releaseKeymapResponse = () =>
          fakeA.emit(payload(0x12, data[1], data[2], data[3], 0x12, 0x34));
      }
    };

    const cacheStore = makeCacheTestStore();
    const dispatch = cacheStore.dispatch as any;
    dispatch(
      updateDefinitions({
        [vendorProductId]: {v3: definition},
      } as any),
    );
    dispatch(
      updateConnectedDevices({
        [deviceA.path]: deviceA,
        [deviceB.path]: deviceB,
      }),
    );
    const generationA = new KeyboardAPI(deviceA.path).getConnectionGeneration();
    dispatch(
      selectDevice({device: deviceA, connectionGeneration: generationA}),
    );

    const load = dispatch(loadKeymapFromDevice(deviceA));
    await waitUntil(() => releaseKeymapResponse !== undefined);
    dispatch(
      selectDevice({
        device: deviceB,
        connectionGeneration: hidB.getConnectionGeneration(),
      }),
    );
    releaseKeymapResponse?.();
    await load;

    const state = cacheStore.getState();
    expect(state.keymap.rawDeviceMap[deviceA.path][0].keymap).toEqual([0x1234]);
    expect(state.keymap.rawDeviceMap[deviceB.path]).toBeUndefined();
    expect(getLoadProgress(state as any)).toBe(0);
    expect(fakeA.sentReports.map(({data}) => data[0])).toEqual([
      0x01, 0x11, 0x01, 0x12,
    ]);
  });

  // Tap Dance settings moved from a TAPDANCE menu onto the TD keycodes in custom
  // JSON. They must still be fetched, written and resynchronised as Custom Values.
  test('Tap Dance settings on TD keycodes are still collected as Custom Value commands', async () => {
    const definition = await Bun.file(
      'public/definitions/era/v3/1163042818.json',
    ).json();
    const commands = getCustomCommandsForDefinition(definition);
    const tapDance = Object.keys(commands).filter((name) =>
      name.startsWith('id_qmk_tapdance_'),
    );
    expect(tapDance).toHaveLength(40);
    expect(commands.id_qmk_tapdance_1_tap).toEqual([0, 32]);
    expect(commands.id_qmk_tapdance_8_term_exact).toEqual([0, 79]);
    // They are edited from KEYMAP, so Configure lists every other menu but not them.
    const menus = getV3Menus.resultFunc(definition);
    const titles = getV3MenuComponents
      .resultFunc(menus)
      .map((menu: any) => menu.Title);
    expect(titles).toEqual(definition.menus.map((menu: any) => menu.label));
    expect(titles).not.toContain('TAPDANCE');
  });

  test('0x16 refresh uses the reporting device definition/API even after selection switches', async () => {
    const vendorProductId = 1163042818;
    const definition = await Bun.file(
      'public/definitions/era/v3/1163042818.json',
    ).json();
    const commands = getCustomCommandsForDefinition(definition);
    const [id, [channelId, commandId]] = Object.entries(commands)[0];
    const deviceA = makeConnectedDevice('menu-A', vendorProductId);
    const deviceB = makeConnectedDevice('menu-B', vendorProductId);
    const {device: fakeA} = await connectFake(deviceA.path);
    const {hid: hidB} = await connectFake(deviceB.path);
    let releaseMenuResponse: (() => void) | undefined;
    fakeA.onSend = (data) => {
      if (data[0] === 0x08) {
        releaseMenuResponse = () =>
          fakeA.emit(payload(0x08, data[1], data[2], 0x5a));
      }
    };

    const cacheStore = makeCacheTestStore();
    const dispatch = cacheStore.dispatch as any;
    dispatch(
      updateDefinitions({
        [vendorProductId]: {v3: definition},
      } as any),
    );
    dispatch(
      updateConnectedDevices({
        [deviceA.path]: deviceA,
        [deviceB.path]: deviceB,
      }),
    );
    dispatch(
      selectDevice({
        device: deviceB,
        connectionGeneration: hidB.getConnectionGeneration(),
      }),
    );

    const apiA = new KeyboardAPI(deviceA.path);
    const generationA = apiA.getConnectionGeneration();
    let refresh: Promise<void> | undefined;
    const removeHandler = apiA.addUISyncRequestHandler((request) => {
      refresh = dispatch(
        syncCustomMenuValuesFromRequest({
          devicePath: deviceA.path,
          connectionGeneration: generationA,
          request,
        }),
      );
    });

    fakeA.emit(payload(0x16, 0x01, 0x01, 0x01, channelId, commandId));
    await waitUntil(() => releaseMenuResponse !== undefined);
    releaseMenuResponse?.();
    await refresh;
    removeHandler();

    const state = cacheStore.getState();
    expect(state.menus.customMenuDataMap[deviceA.path][id][0]).toBe(0x5a);
    expect(state.menus.customMenuDataMap[deviceB.path]).toBeUndefined();
    expect(fakeA.sentReports.map(({data}) => data[0])).toEqual([0x08]);
  });

  test('an old selection generation cannot mark the new selected device ready', () => {
    const vendorProductId = 1163042818;
    const deviceA = makeConnectedDevice('ready-A', vendorProductId);
    const deviceB = makeConnectedDevice('ready-B', vendorProductId);
    let state = devicesReducer(undefined, {type: 'init'});
    state = devicesReducer(
      state,
      selectDevice({device: deviceA, connectionGeneration: 1}),
    );
    const selectionGeneration = getSelectionGeneration({devices: state} as any);
    state = devicesReducer(
      state,
      selectDevice({device: deviceB, connectionGeneration: 2}),
    );
    state = devicesReducer(
      state,
      markDeviceReady({
        devicePath: deviceA.path,
        connectionGeneration: 1,
        selectionGeneration,
      }),
    );
    expect(state.selectedDevicePath).toBe(deviceB.path);
    expect(state.readyDevicePath).toBeNull();

    const currentSelectionGeneration = state.selectionGeneration;
    state = devicesReducer(
      state,
      markDeviceReady({
        devicePath: deviceB.path,
        connectionGeneration: 2,
        selectionGeneration: currentSelectionGeneration,
      }),
    );
    expect(state.readyDevicePath).toBe(deviceB.path);
    state = devicesReducer(
      state,
      invalidateDeviceConnection({
        devicePath: deviceB.path,
        connectionGeneration: 3,
        locked: false,
      }),
    );
    expect(state.readyDevicePath).toBeNull();
    expect(state.selectedConnectionNeedsReload).toBe(true);
    expect(state.selectionGeneration).toBe(currentSelectionGeneration + 1);
  });
});

// Current QMK boards report VIA protocol 13 and a QMK keycodes version that the
// app must read before it can name any key.
const P13_VENDOR_ID = 0x1234;
const P13_PRODUCT_ID = 0x5678;
const p13VendorProductId = P13_VENDOR_ID * 65536 + P13_PRODUCT_ID;
const p13Definition = {
  name: 'Protocol 13 board',
  vendorProductId: p13VendorProductId,
  firmwareVersion: 0,
  menus: [],
  keycodes: [],
  matrix: {rows: 1, cols: 1},
  layouts: {
    width: 1,
    height: 1,
    optionKeys: {},
    keys: [
      {
        row: 0,
        col: 0,
        x: 0,
        y: 0,
        r: 0,
        rx: 0,
        ry: 0,
        d: false,
        h: 1,
        w: 1,
        color: 'alpha',
      },
    ],
  },
};
const UNSUPPORTED_VERSION_TITLE = 'Unsupported keyboard firmware version';

const makeAppTestStore = () => {
  const testStore = configureStore({
    reducer: {
      settings: settingsReducer,
      macros: macrosReducer,
      devices: devicesReducer,
      keymap: keymapReducer,
      definitions: definitionsReducer,
      lighting: lightingReducer,
      menus: menusReducer,
      design: designReducer,
      errors: errorsReducer,
      firmware: firmwareReducer,
      definitionName: definitionNameReducer,
      stateSync: stateSyncReducer,
    },
  });
  testStore.dispatch(
    updateSupportedIds({[p13VendorProductId]: {v2: true, v3: true}}),
  );
  testStore.dispatch(
    updateDefinitions({[p13VendorProductId]: {v3: p13Definition}} as any),
  );
  return testStore;
};

/** A stock QMK board; anything it has no data for is echoed back as zeros. */
const makeProtocol13Board = (boardPath: string, versionBytes: number[]) => {
  const fake = new FakeHIDDevice();
  fake.vendorId = P13_VENDOR_ID;
  fake.productId = P13_PRODUCT_ID;
  fake.productName = boardPath;
  (fake as unknown as {__path: string}).__path = boardPath;
  const heldVersionReplies: Uint8Array[] = [];
  let holdingVersion = false;
  fake.onSend = (data) => {
    if (data[0] === 0x02 && data[1] === 0x06) {
      const reply = payload(0x02, 0x06, ...versionBytes);
      if (holdingVersion) {
        heldVersionReplies.push(reply);
      } else {
        fake.emit(reply);
      }
      return;
    }
    if (data[0] === 0x01) {
      fake.emit(payload(0x01, 0x00, 0x0d));
    } else if (data[0] === 0x11) {
      fake.emit(payload(0x11, 0x01));
    } else {
      fake.emit(payload(...Array.from(data)));
    }
  };
  const connectedDevice: ConnectedDevice = {
    path: boardPath,
    vendorId: P13_VENDOR_ID,
    productId: P13_PRODUCT_ID,
    productName: boardPath,
    protocol: 13,
    hasResolvedDefinition: true,
    requiredDefinitionVersion: 'v3',
    vendorProductId: p13VendorProductId,
  };
  return {
    fake,
    connectedDevice,
    path: boardPath,
    holdVersion: () => {
      holdingVersion = true;
    },
    releaseVersion: () => {
      holdingVersion = false;
      heldVersionReplies.splice(0).forEach((reply) => fake.emit(reply));
    },
    heldVersionReplies: () => heldVersionReplies.length,
    commands: () => fake.sentReports.map(({data}) => data[0]),
  };
};

const stubGlobals = (values: Record<string, unknown>) => {
  const originals = Object.keys(values).map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, name, {configurable: true, value});
  }
  return () => {
    for (const [name, original] of originals) {
      if (original) {
        Object.defineProperty(globalThis, name, original);
      } else {
        Reflect.deleteProperty(globalThis, name);
      }
    }
  };
};

type AppShell = {
  Home: ComponentType<{hasHIDSupport: boolean; children?: ReactNode}>;
  UnconnectedGlobalMenu: ComponentType;
  FirmwarePane: ComponentType;
  panes: {key: string; path: string; component: ComponentType<any>}[];
  translations: typeof i18n;
};

let appShell: Promise<AppShell> | undefined;
// The header imports every pane. `assets/` is a Vite alias, and override.ts
// reads location when it loads.
const loadAppShell = () =>
  (appShell ??= (async () => {
    Bun.plugin({
      name: 'vite-assets-alias',
      setup(build) {
        build.onResolve({filter: /^assets\//}, ({path: specifier}) => ({
          path: path.join(import.meta.dir, '../src', specifier),
        }));
      },
    });
    const restore = stubGlobals({
      location: {href: 'http://localhost/'},
    });
    try {
      const {Home} = await import('../src/components/Home');
      const {UnconnectedGlobalMenu} =
        await import('../src/components/menus/global');
      const {FirmwarePane} = await import('../src/components/panes/firmware');
      const {default: panes} = await import('../src/utils/pane-config');
      const translations = i18n.createInstance();
      await translations.init({
        lng: 'ko',
        resources: {ko: {translation: koTranslation}},
      });
      return {
        Home,
        UnconnectedGlobalMenu,
        FirmwarePane,
        panes,
        translations,
      } as AppShell;
    } finally {
      restore();
    }
  })());

/** The header and Home with the given routes, as Routes.tsx composes them. */
const appShellElement = (
  shell: AppShell,
  testStore: ReturnType<typeof makeAppTestStore>,
  hook: () => [string, (to: string) => void],
  routes: ReactNode,
) =>
  h(
    Provider,
    {store: testStore} as any,
    h(
      I18nextProvider,
      {i18n: shell.translations} as any,
      h(
        Router,
        {hook} as any,
        h(shell.UnconnectedGlobalMenu),
        h(shell.Home, {hasHIDSupport: true}, routes),
      ),
    ),
  );

const appRoutes = (shell: AppShell, location: string) => [
  ...shell.panes
    .filter((pane) => pane.key !== 'console')
    .map((pane) =>
      h(Route, {key: pane.key, path: pane.path, component: pane.component}),
    ),
  location.startsWith('/firmware')
    ? h(shell.FirmwarePane, {key: 'firmware'})
    : null,
];

const renderAppShell = (
  shell: AppShell,
  testStore: ReturnType<typeof makeAppTestStore>,
  location: string,
) =>
  renderToStaticMarkup(
    appShellElement(
      shell,
      testStore,
      staticLocationHook(location) as any,
      appRoutes(shell, location),
    ),
  );

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('QMK VIA protocol 13 keycodes version', () => {
  beforeEach(() => {
    setEraAdvancedMetadataForTesting({schemaVersion: 2, definitions: []});
  });

  afterEach(() => {
    setEraAdvancedMetadataForTesting(null);
  });

  test('QMK keycode versions 0.0.8 and 0.0.9 are supported, other versions are not', () => {
    expect(decodeKeycodesVersion([0, 0, 0, 0x08])).toBe(0x08);
    expect(decodeKeycodesVersion([0, 0, 0, 0x09])).toBe(0x09);
    for (const bytes of [
      [0, 0, 0, 0x07],
      [0, 0, 0, 0x10],
      [0, 0, 0x01, 0x00],
    ]) {
      expect(() => decodeKeycodesVersion(bytes)).toThrow(
        UnsupportedKeycodesVersionError,
      );
    }
    for (const bytes of [
      [0, 0, 0, 0],
      [0, 0, 0, 0x0a],
      [0, 0, 0x09],
    ]) {
      expect(() => decodeKeycodesVersion(bytes)).toThrow(
        KeycodesVersionProtocolError,
      );
    }
  });

  test('key names wait for the keycodes version instead of throwing', () => {
    const testStore = makeAppTestStore();
    const {connectedDevice} = makeProtocol13Board(
      'p13-key-names',
      [0, 0, 0, 9],
    );
    testStore.dispatch(
      updateConnectedDevices({[connectedDevice.path]: connectedDevice}),
    );
    testStore.dispatch(
      selectDevice({device: connectedDevice, connectionGeneration: 1}),
    );
    expect(getBasicKeyToByte(testStore.getState() as any)).toEqual({
      basicKeyToByte: {},
      byteToKey: {},
    });

    testStore.dispatch(
      updateKeycodesVersion({devicePath: connectedDevice.path, version: 9}),
    );
    expect(
      getBasicKeyToByte(testStore.getState() as any).basicKeyToByte.KC_A,
    ).toBe(0x04);
  });

  test('a board is selected only after its keycodes version is read', async () => {
    const board = makeProtocol13Board('p13-supported', [0, 0, 0, 0x09]);
    const navigatorHID = installFakeNavigatorHID(() => [
      asHIDDevice(board.fake),
    ]);
    const testStore = makeAppTestStore();
    let versionWhenSelected: number | null | undefined;
    const unsubscribe = testStore.subscribe(() => {
      const state = testStore.getState();
      if (
        versionWhenSelected === undefined &&
        state.devices.selectedDevicePath === board.path
      ) {
        versionWhenSelected =
          state.firmware.keycodesVersionMap[board.path] ?? null;
      }
    });
    try {
      await testStore.dispatch(reloadConnectedDevices() as any);
      await waitUntil(
        () => testStore.getState().devices.readyDevicePath === board.path,
        2000,
      );

      expect(versionWhenSelected).toBe(0x09);
      expect(testStore.getState().errors.appErrors).toEqual([]);
      expect(getAppErrors(appStore.getState())).toEqual([]);
    } finally {
      unsubscribe();
      navigatorHID.restore();
    }
  });

  test('an unsupported or malformed version never selects the board and is reported once', async () => {
    for (const [boardPath, versionBytes] of [
      ['p13-unsupported', [0, 0, 0, 0x10]],
      ['p13-malformed', [0, 0, 0, 0x0a]],
    ] as const) {
      const board = makeProtocol13Board(boardPath, [...versionBytes]);
      const navigatorHID = installFakeNavigatorHID(() => [
        asHIDDevice(board.fake),
      ]);
      const testStore = makeAppTestStore();
      try {
        // A USB change reloads the device list twice.
        await testStore.dispatch(reloadConnectedDevices() as any);
        await waitUntil(() => testStore.getState().errors.appErrors.length > 0);
        await testStore.dispatch(reloadConnectedDevices() as any);
        await settle();

        const state = testStore.getState();
        expect(state.devices.selectedDevicePath).toBeNull();
        expect(state.errors.appErrors).toHaveLength(1);
        expect(state.errors.appErrors[0].title).toBe(UNSUPPORTED_VERSION_TITLE);
        expect(state.errors.appErrors[0].message).toContain('KEYCODES_VERSION');
        // Protocol, keycodes version, protocol: no keymap or macro is read.
        expect(board.commands()).toEqual([0x01, 0x02, 0x01]);
      } finally {
        navigatorHID.restore();
      }
    }
  });

  test('an unsupported board neither replaces nor blocks a working one', async () => {
    const unsupported = makeProtocol13Board('p13-blocker', [0, 0, 0, 0x10]);
    const malformed = makeProtocol13Board('p13-garbled', [0, 0, 0, 0x0a]);
    const working = makeProtocol13Board('p13-working', [0, 0, 0, 0x08]);
    const navigatorHID = installFakeNavigatorHID(() => [
      asHIDDevice(unsupported.fake),
      asHIDDevice(malformed.fake),
      asHIDDevice(working.fake),
    ]);
    const testStore = makeAppTestStore();
    const dispatch = testStore.dispatch as any;
    try {
      // The app scans once when it opens. The rejected boards are listed
      // first, so they are tried first, once each.
      await dispatch(reloadConnectedDevices());
      await waitUntil(
        () => testStore.getState().devices.readyDevicePath === working.path,
        2000,
      );
      expect(testStore.getState().errors.appErrors).toHaveLength(2);
      expect(unsupported.commands()).toEqual([0x01, 0x02]);
      expect(malformed.commands()).toEqual([0x01, 0x02]);

      // Picking it from the device list leaves the working board in place.
      await dispatch(selectConnectedDeviceByPath(unsupported.path));
      await settle();
      const state = testStore.getState();
      expect(state.devices.selectedDevicePath).toBe(working.path);
      expect(state.devices.readyDevicePath).toBe(working.path);
    } finally {
      navigatorHID.restore();
    }
  });

  test('an unsupported board is reported each time it is picked from the device list', async () => {
    const working = makeProtocol13Board('p13-kept', [0, 0, 0, 0x09]);
    const unsupported = makeProtocol13Board('p13-picked', [0, 0, 0, 0x10]);
    const navigatorHID = installFakeNavigatorHID(() => [
      asHIDDevice(working.fake),
      asHIDDevice(unsupported.fake),
    ]);
    const testStore = makeAppTestStore();
    const dispatch = testStore.dispatch as any;
    try {
      await dispatch(reloadConnectedDevices());
      await waitUntil(
        () => testStore.getState().devices.readyDevicePath === working.path,
        2000,
      );

      // /errors is cleared before each pick.
      for (const pick of [1, 2]) {
        testStore.dispatch(clearAppErrors());
        const sent = unsupported.commands().length;
        await dispatch(selectConnectedDeviceByPath(unsupported.path));
        await waitUntil(() =>
          unsupported.commands().slice(sent).includes(0x02),
        );
        await settle();
        const state = testStore.getState();
        expect({
          pick,
          errors: state.errors.appErrors.map(({title}) => title),
        }).toEqual({pick, errors: [UNSUPPORTED_VERSION_TITLE]});
        expect(state.devices.readyDevicePath).toBe(working.path);
      }
    } finally {
      navigatorHID.restore();
    }
  });

  test('an older selection still reading its version cannot take over from a newer one', async () => {
    const older = makeProtocol13Board('p13-older', [0, 0, 0, 0x09]);
    const newer = makeProtocol13Board('p13-newer', [0, 0, 0, 0x09]);
    await connectFake(older.path, older.fake);
    await connectFake(newer.path, newer.fake);
    const testStore = makeAppTestStore();
    const dispatch = testStore.dispatch as any;
    dispatch(
      updateConnectedDevices({
        [older.path]: older.connectedDevice,
        [newer.path]: newer.connectedDevice,
      }),
    );
    const selections: string[] = [];
    const unsubscribe = testStore.subscribe(() => {
      const selected = testStore.getState().devices.selectedDevicePath;
      if (selected && selections[selections.length - 1] !== selected) {
        selections.push(selected);
      }
    });
    older.holdVersion();
    newer.holdVersion();
    try {
      const olderSelection = dispatch(
        selectConnectedDevice(older.connectedDevice),
      );
      const newerSelection = dispatch(
        selectConnectedDevice(newer.connectedDevice),
      );
      await waitUntil(
        () =>
          older.heldVersionReplies() === 1 && newer.heldVersionReplies() === 1,
      );

      older.releaseVersion();
      await olderSelection;
      expect(testStore.getState().devices.selectedDevicePath).toBeNull();

      newer.releaseVersion();
      await newerSelection;
      expect(testStore.getState().devices.readyDevicePath).toBe(newer.path);
      expect(selections).toEqual([newer.path]);
    } finally {
      unsubscribe();
    }
  });

  test('a board that locks while its keycodes version is read asks for a reconnect', async () => {
    const shell = await loadAppShell();
    const locking = makeProtocol13Board('p13-locking', [0, 0, 0, 0x09]);
    const navigatorHID = installFakeNavigatorHID(() => [
      asHIDDevice(locking.fake),
    ]);
    const testStore = makeAppTestStore();
    try {
      // It answers the protocol probe but never the keycodes version, so the
      // read times out and locks the connection before it is selected.
      locking.holdVersion();
      await testStore.dispatch(reloadConnectedDevices() as any);
      await waitUntil(
        () => testStore.getState().devices.selectedConnectionLocked,
        2000,
      );
      expect(testStore.getState().devices.selectedDevicePath).toBe(
        locking.path,
      );
      const configure = renderAppShell(shell, testStore, '/');
      expect(configure).toContain('키보드를 재연결하세요');
      expect(configure).not.toContain('기기 검색 중...');
    } finally {
      navigatorHID.restore();
    }

    // Unplugged during that read instead, it is neither selected nor locked.
    const unplugged = makeProtocol13Board('p13-unplugged', [0, 0, 0, 0x09]);
    await connectFake(unplugged.path, unplugged.fake);
    const unpluggedStore = makeAppTestStore();
    unpluggedStore.dispatch(
      updateConnectedDevices({[unplugged.path]: unplugged.connectedDevice}),
    );
    unplugged.holdVersion();
    const selection = unpluggedStore.dispatch(
      selectConnectedDevice(unplugged.connectedDevice) as any,
    );
    await waitUntil(() => unplugged.heldVersionReplies() === 1);
    disconnectHIDDeviceForTesting(unplugged.path);
    await selection;
    expect(unpluggedStore.getState().devices).toMatchObject({
      selectedDevicePath: null,
      selectedConnectionLocked: false,
    });
  });

  test('plugged in with the app open, a board that locks while its keycodes version is read asks for a reconnect', async () => {
    const shell = await loadAppShell();
    const locking = makeProtocol13Board('p13-locking-rescan', [0, 0, 0, 0x09]);
    const navigatorHID = installFakeNavigatorHID(() => [
      asHIDDevice(locking.fake),
    ]);
    const testStore = makeAppTestStore();
    const dispatch = testStore.dispatch as any;
    try {
      // Home scans twice after a keyboard is plugged in. The first scan starts
      // reading the keycodes version, and the second starts before that read
      // times out, while nothing is selected yet.
      locking.holdVersion();
      await dispatch(reloadConnectedDevices());
      await waitUntil(() => locking.heldVersionReplies() === 1);
      expect(testStore.getState().devices.selectedDevicePath).toBeNull();
      await dispatch(reloadConnectedDevices());
      await settle();
      expect(testStore.getState().devices).toMatchObject({
        selectedDevicePath: locking.path,
        selectedConnectionLocked: true,
      });
      const configure = renderAppShell(shell, testStore, '/');
      expect(configure).toContain('키보드를 재연결하세요');
      expect(configure).not.toContain('기기 인증');
    } finally {
      navigatorHID.restore();
    }
  });

  test('the header, CONFIGURE, /firmware and /errors render around a protocol-13 board', async () => {
    const shell = await loadAppShell();

    // Selected before its version is known: this used to blank the whole app.
    const pending = makeProtocol13Board('p13-shell-pending', [0, 0, 0, 0x09]);
    await connectFake(pending.path, pending.fake);
    const pendingStore = makeAppTestStore();
    pendingStore.dispatch(
      updateConnectedDevices({[pending.path]: pending.connectedDevice}),
    );
    pendingStore.dispatch(
      selectDevice({device: pending.connectedDevice, connectionGeneration: 1}),
    );
    for (const location of ['/', '/firmware', '/errors']) {
      const html = renderAppShell(shell, pendingStore, location);
      expect({location, header: html.includes('href="/settings"')}).toEqual({
        location,
        header: true,
      });
    }
    expect(renderAppShell(shell, pendingStore, '/')).toContain('로딩 중...');
    expect(renderAppShell(shell, pendingStore, '/firmware')).toContain(
      'data-firmware-page="true"',
    );

    // An unsupported version is one short entry in /errors and nothing else.
    const unsupported = makeProtocol13Board(
      'p13-shell-unsupported',
      [0, 0, 0, 0x10],
    );
    const navigatorHID = installFakeNavigatorHID(() => [
      asHIDDevice(unsupported.fake),
    ]);
    const unsupportedStore = makeAppTestStore();
    try {
      await unsupportedStore.dispatch(reloadConnectedDevices() as any);
      await waitUntil(
        () => unsupportedStore.getState().errors.appErrors.length > 0,
      );
    } finally {
      navigatorHID.restore();
    }
    const errorsPage = renderAppShell(shell, unsupportedStore, '/errors');
    expect(errorsPage).toContain('href="/errors"');
    expect(errorsPage).toContain('지원하지 않는 키보드 펌웨어 버전');
    expect(errorsPage).not.toContain('KEYCODES_VERSION');
    const configure = renderAppShell(shell, unsupportedStore, '/');
    expect(configure).not.toContain('로딩 중...');
    expect(renderAppShell(shell, unsupportedStore, '/firmware')).toContain(
      'data-firmware-page="true"',
    );
  });

  // The keyboard reaches every screen from the header: its icons are links named by
  // their screen, the current one marked, and the language button says what it is
  // and whether its list is open. The closed list is hidden, not only faded, so its
  // buttons are out of the Tab order and Enter cannot change the language unseen.
  test('the header reaches every screen and the language list from the keyboard', async () => {
    const shell = await loadAppShell();
    const sheet = new ServerStyleSheet();
    let html = '';
    let css = '';
    try {
      html = renderToStaticMarkup(
        sheet.collectStyles(
          appShellElement(
            shell,
            makeAppTestStore(),
            staticLocationHook('/settings') as any,
            [],
          ),
        ),
      );
      css = sheet.getStyleTags();
    } finally {
      sheet.seal();
    }
    const tag = (pattern: RegExp) => pattern.exec(html)?.[0] ?? '';
    const settings = tag(/<a [^>]*href="\/settings"[^>]*>/);
    const configure = tag(/<a [^>]*href="\/"[^>]*>/);
    expect(settings).toContain('aria-label="설정"');
    expect(settings).toContain('aria-current="page"');
    expect(configure).toContain('aria-label="구성"');
    expect(configure).not.toContain('aria-current');

    const language = tag(/<button [^>]*aria-expanded="[^"]*"[^>]*>/);
    expect(language).toContain('type="button"');
    expect(language).toContain('aria-label="언어"');
    expect(language).toContain('aria-expanded="false"');
    const listId = /aria-controls="([^"]+)"/.exec(language)?.[1] ?? '';
    const list = html.slice(html.indexOf(`<ul id="${listId}"`));
    expect(list).toMatch(/^<ul [^>]*>(<button[^>]*>[^<]*<\/button>){6}<\/ul>/);
    const hidden = (/class="([^"]+)"/.exec(list)?.[1] ?? '')
      .split(' ')
      .some((name) =>
        new RegExp(`\\.${name}\\{[^}]*visibility:hidden`).test(css),
      );
    expect(hidden).toBe(true);
  });

  test('a route that fails to render leaves the header and /errors working', async () => {
    const shell = await loadAppShell();
    const navigatorHID = installFakeNavigatorHID(() => []);
    const restoreDocument = stubGlobals({
      document: {
        hidden: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        getElementById: () => null,
      },
    });
    const originalConsoleError = console.error;
    const testStore = makeAppTestStore();
    let location = '/';
    const locationListeners = new Set<() => void>();
    const navigate = (to: string) => {
      location = to;
      locationListeners.forEach((listener) => listener());
    };
    const useTestLocation = (): [string, (to: string) => void] => [
      useSyncExternalStore(
        (listener) => {
          locationListeners.add(listener);
          return () => locationListeners.delete(listener);
        },
        () => location,
      ),
      navigate,
    ];
    const Broken = () => {
      throw new Error('route failed to render');
    };
    // The real /errors pane opens its tooltips in a DOM portal, which the test
    // renderer lacks; the server render above covers that pane.
    const ErrorLines = () =>
      h(
        'ul',
        null,
        useSelector(getAppErrors).map((appError, index) =>
          h('li', {key: index}, appError.message.split('\n')[0]),
        ),
      );
    let renderer: ReactTestRenderer | undefined;
    // React reports every error a boundary catches.
    console.error = () => undefined;
    try {
      await act(async () => {
        renderer = create(
          appShellElement(shell, testStore, useTestLocation, [
            h(Route, {key: 'broken', path: '/', component: Broken}),
            h(Route, {key: 'errors', path: '/errors', component: ErrorLines}),
          ]),
        );
      });
      // Home's device scan finds no keyboard and settles.
      await waitUntil(
        () => testStore.getState().devices.selectionGeneration > 0,
        2000,
      );

      const appErrors = testStore.getState().errors.appErrors;
      expect(appErrors).toHaveLength(1);
      expect(appErrors[0].message).toContain('route failed to render');
      const tree = JSON.stringify(renderer!.toJSON());
      expect(tree).toContain('"href":"/settings"');
      expect(tree).toContain('"href":"/errors"');

      await act(async () => navigate('/errors'));
      expect(JSON.stringify(renderer!.toJSON())).toContain(
        'Error: route failed to render',
      );
    } finally {
      act(() => renderer?.unmount());
      console.error = originalConsoleError;
      usbDetect.stopMonitoring();
      restoreDocument();
      navigatorHID.restore();
    }
  });
});

/**
 * WebHID as a browser behaves: the device chooser opens only while a click is
 * being handled, and a scan lists only the keyboards the browser allows.
 */
const installChooserBrowser = () => {
  const plugged = new Set<HIDDevice>();
  const allowed = new Set<HIDDevice>();
  let clicking = false;
  let offered: HIDDevice | undefined;
  let chooserOpened = 0;
  let scans = 0;
  const navigatorHID = installFakeNavigatorHID(
    () => {
      scans += 1;
      return [...plugged].filter((device) => allowed.has(device));
    },
    async () => {
      chooserOpened += 1;
      if (!clicking) {
        throw new DOMException(
          'Must be handling a user gesture to show a permission request.',
          'SecurityError',
        );
      }
      if (!offered) {
        return [];
      }
      allowed.add(offered);
      return [offered];
    },
  );
  return {
    restore: navigatorHID.restore,
    chooserOpened: () => chooserOpened,
    scans: () => scans,
    /** Only a keyboard the browser allows is announced. */
    plugIn: (device: HIDDevice, remembered = false) => {
      plugged.add(device);
      if (remembered) {
        allowed.add(device);
        navigatorHID.emit('connect', device);
      }
    },
    unplug: (device: HIDDevice) => {
      plugged.delete(device);
      if (allowed.has(device)) {
        navigatorHID.emit('disconnect', device);
      }
    },
    /** The click's user activation lasts until its work has settled. */
    click: async (
      handler: () => unknown,
      settled: () => boolean,
      offer?: HIDDevice,
    ) => {
      offered = offer;
      clicking = true;
      try {
        await handler();
        await waitUntil(settled, 2000);
      } finally {
        clicking = false;
        offered = undefined;
      }
    },
  };
};

const textOf = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === 'string' ? child : textOf(child)))
    .join('');

const findButton = (
  renderer: ReactTestRenderer,
  matches: (text: string) => boolean,
) =>
  renderer.root.find((node) => node.type === 'button' && matches(textOf(node)));

const withStore = (
  shell: AppShell,
  testStore: ReturnType<typeof makeAppTestStore>,
  component: ComponentType,
) =>
  h(
    Provider,
    {store: testStore} as any,
    h(I18nextProvider, {i18n: shell.translations} as any, h(component)),
  );

describe('device chooser and reconnect', () => {
  beforeEach(() => {
    setEraAdvancedMetadataForTesting({schemaVersion: 2, definitions: []});
  });

  afterEach(() => {
    setEraAdvancedMetadataForTesting(null);
  });

  test('a scan never asks for the chooser, and a refused chooser keeps the allowed keyboards', async () => {
    const browser = installChooserBrowser();
    try {
      expect(await HID.devices()).toEqual([]);
      expect(browser.chooserOpened()).toBe(0);

      const fake = new FakeHIDDevice();
      (fake as unknown as {__path: string}).__path = 'chooser-refused';
      browser.plugIn(asHIDDevice(fake), true);
      // Outside a click the browser refuses the chooser.
      const devices = await HID.devices(true);
      expect(browser.chooserOpened()).toBe(1);
      expect(devices.map(({path}) => path)).toEqual(['chooser-refused']);
    } finally {
      browser.restore();
    }
  });

  test('a keyboard that restarts is found and loaded again without a click', async () => {
    const browser = installChooserBrowser();
    const testStore = makeAppTestStore();
    const dispatch = testStore.dispatch as any;
    try {
      const before = makeProtocol13Board('restart-before', [0, 0, 0, 0x09]);
      browser.plugIn(asHIDDevice(before.fake), true);
      await dispatch(reloadConnectedDevices());
      await waitUntil(
        () => testStore.getState().devices.readyDevicePath === before.path,
        2000,
      );

      // USB polling Apply, a reset or flashing restarts the keyboard.
      browser.unplug(asHIDDevice(before.fake));
      await dispatch(reloadConnectedDevices());
      expect(testStore.getState().devices.selectedDevicePath).toBeNull();

      // It comes back as a new WebHID device that the browser still allows.
      const after = makeProtocol13Board('restart-after', [0, 0, 0, 0x09]);
      browser.plugIn(asHIDDevice(after.fake), true);
      await dispatch(reloadConnectedDevices());
      await waitUntil(
        () => testStore.getState().devices.readyDevicePath === after.path,
        2000,
      );
      expect(browser.chooserOpened()).toBe(0);
    } finally {
      browser.restore();
    }
  });

  test('Authorize device, the keyboard list and Authorize New open the chooser only for their own click, once', async () => {
    const shell = await loadAppShell();
    const {Badge} =
      await import('../src/components/panes/configure-panes/badge');
    const ConfigurePane = shell.panes.find(
      (pane) => pane.key === 'default',
    )!.component;
    const browser = installChooserBrowser();
    const testStore = makeAppTestStore();
    const dispatch = testStore.dispatch as any;
    let loader: ReactTestRenderer | undefined;
    let badge: ReactTestRenderer | undefined;
    try {
      // A first visit: the browser allows no keyboard yet.
      const first = makeProtocol13Board('chooser-first', [0, 0, 0, 0x09]);
      browser.plugIn(asHIDDevice(first.fake));
      await dispatch(reloadConnectedDevices());
      expect(browser.chooserOpened()).toBe(0);

      await act(async () => {
        loader = create(withStore(shell, testStore, ConfigurePane));
      });
      // Held so that CONFIGURE still shows its loader when the click settles.
      first.holdVersion();
      await act(async () => {
        await browser.click(
          () =>
            findButton(loader!, (text) => text === '기기 인증').props.onClick(),
          () => first.heldVersionReplies() === 1,
          asHIDDevice(first.fake),
        );
      });
      act(() => loader!.unmount());
      loader = undefined;
      first.releaseVersion();
      await waitUntil(
        () => testStore.getState().devices.readyDevicePath === first.path,
        2000,
      );
      expect(browser.chooserOpened()).toBe(1);

      await act(async () => {
        badge = create(withStore(shell, testStore, Badge));
      });
      const selectionGeneration =
        testStore.getState().devices.selectionGeneration;
      await act(async () => {
        await browser.click(
          () =>
            findButton(
              badge!,
              (text) => !text.includes('새 키보드 인증'),
            ).props.onClick(),
          () =>
            testStore.getState().devices.selectionGeneration >
              selectionGeneration &&
            testStore.getState().devices.readyDevicePath === first.path,
        );
      });
      expect(browser.chooserOpened()).toBe(1);

      const second = makeProtocol13Board('chooser-second', [0, 0, 0, 0x09]);
      browser.plugIn(asHIDDevice(second.fake));
      await act(async () => {
        await browser.click(
          () =>
            findButton(badge!, (text) =>
              text.includes('새 키보드 인증'),
            ).props.onClick(),
          () => testStore.getState().devices.readyDevicePath === second.path,
          asHIDDevice(second.fake),
        );
      });
      expect(browser.chooserOpened()).toBe(2);
    } finally {
      act(() => {
        loader?.unmount();
        badge?.unmount();
      });
      browser.restore();
    }
  });

  test('a locked connection asks for a reconnect, and plugging the keyboard back in loads it again', async () => {
    const shell = await loadAppShell();
    const browser = installChooserBrowser();
    const restoreDocument = stubGlobals({
      document: {
        hidden: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        getElementById: () => null,
      },
    });
    const testStore = makeAppTestStore();
    const dispatch = testStore.dispatch as any;
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(
          appShellElement(shell, testStore, staticLocationHook('/') as any, []),
        );
      });
      // Home's first scan finds nothing. It also loaded the built-in keyboard
      // lists, which do not have the test board.
      await waitUntil(
        () => testStore.getState().devices.selectionGeneration > 0,
        2000,
      );
      dispatch(
        updateSupportedIds({[p13VendorProductId]: {v2: true, v3: true}}),
      );
      dispatch(
        updateDefinitions({[p13VendorProductId]: {v3: p13Definition}} as any),
      );

      const board = makeProtocol13Board('locked-before', [0, 0, 0, 0x09]);
      const scans = browser.scans();
      browser.plugIn(asHIDDevice(board.fake), true);
      await waitUntil(
        () => testStore.getState().devices.readyDevicePath === board.path,
        3000,
      );
      // Home scans twice after a USB change; let the second scan finish first.
      await waitUntil(() => browser.scans() >= scans + 2, 3000);
      await settle();

      board.fake.onSend = () => undefined;
      await expect(
        new KeyboardAPI(board.path).getProtocolVersion(),
      ).rejects.toBeInstanceOf(HIDTransportTimeoutError);
      expect(testStore.getState().devices.selectedConnectionLocked).toBe(true);
      const locked = renderAppShell(shell, testStore, '/');
      expect(locked).toContain('키보드를 재연결하세요');
      expect(locked).not.toContain('로딩 중...');
      expect(locked).not.toContain('기기 인증');

      browser.unplug(asHIDDevice(board.fake));
      expect(testStore.getState().devices.selectedConnectionLocked).toBe(false);
      await waitUntil(
        () => testStore.getState().devices.selectedDevicePath === null,
        3000,
      );

      const back = makeProtocol13Board('locked-after', [0, 0, 0, 0x09]);
      browser.plugIn(asHIDDevice(back.fake), true);
      await waitUntil(
        () => testStore.getState().devices.readyDevicePath === back.path,
        3000,
      );
      expect(testStore.getState().devices.selectedConnectionLocked).toBe(false);
      expect(getLoadProgress(testStore.getState() as any)).toBe(1);
      expect(browser.chooserOpened()).toBe(0);
    } finally {
      act(() => renderer?.unmount());
      usbDetect.stopMonitoring();
      restoreDocument();
      browser.restore();
    }
  });

  test('a locked keyboard keeps asking for a reconnect when another keyboard is unplugged', async () => {
    const shell = await loadAppShell();
    const browser = installChooserBrowser();
    const restoreDocument = stubGlobals({
      document: {
        hidden: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        getElementById: () => null,
      },
    });
    const testStore = makeAppTestStore();
    const dispatch = testStore.dispatch as any;
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(
          appShellElement(shell, testStore, staticLocationHook('/') as any, []),
        );
      });
      await waitUntil(
        () => testStore.getState().devices.selectionGeneration > 0,
        2000,
      );
      dispatch(
        updateSupportedIds({[p13VendorProductId]: {v2: true, v3: true}}),
      );
      dispatch(
        updateDefinitions({[p13VendorProductId]: {v3: p13Definition}} as any),
      );

      const selected = makeProtocol13Board('kept-selected', [0, 0, 0, 0x09]);
      const other = makeProtocol13Board('kept-other', [0, 0, 0, 0x09]);
      const scans = browser.scans();
      browser.plugIn(asHIDDevice(selected.fake), true);
      browser.plugIn(asHIDDevice(other.fake), true);
      await waitUntil(
        () =>
          testStore.getState().devices.readyDevicePath === selected.path &&
          browser.scans() >= scans + 4,
        3000,
      );
      await settle();

      selected.fake.onSend = () => undefined;
      await expect(
        new KeyboardAPI(selected.path).getProtocolVersion(),
      ).rejects.toBeInstanceOf(HIDTransportTimeoutError);

      // Home scans again, and the locked keyboard fails that scan's probe.
      const scansBeforeUnplug = browser.scans();
      browser.unplug(asHIDDevice(other.fake));
      await waitUntil(() => browser.scans() >= scansBeforeUnplug + 2, 3000);
      await settle();
      expect(testStore.getState().devices).toMatchObject({
        selectedDevicePath: selected.path,
        selectedConnectionLocked: true,
      });
      const configure = renderAppShell(shell, testStore, '/');
      expect(configure).toContain('키보드를 재연결하세요');
      expect(configure).not.toContain('기기 인증');

      // Unplugging the locked keyboard itself still clears it.
      browser.unplug(asHIDDevice(selected.fake));
      await waitUntil(
        () => testStore.getState().devices.selectedDevicePath === null,
        3000,
      );
      expect(testStore.getState().devices.selectedConnectionLocked).toBe(false);
    } finally {
      act(() => renderer?.unmount());
      usbDetect.stopMonitoring();
      restoreDocument();
      browser.restore();
    }
  });

  test('in 3D, the loader outside the Redux Provider authorizes a keyboard, then asks for a reconnect instead of spinning', async () => {
    const shell = await loadAppShell();
    const {LoaderStatus, useLoaderStatus} = await import(
      '../src/components/three-fiber/loader-status'
    );
    const browser = installChooserBrowser();
    const testStore = makeAppTestStore();
    // The canvas reads the store inside the Provider. drei's Html renders the
    // loader in a React root of its own, with no Provider around it, and
    // index.tsx registers i18next for every root.
    const loader = () => {
      let element: ReactElement | undefined;
      const Canvas = () => {
        element = h(LoaderStatus, useLoaderStatus());
        return null;
      };
      renderToStaticMarkup(h(Provider, {store: testStore} as any, h(Canvas)));
      return element!;
    };
    const status = () => renderToStaticMarkup(loader());
    const registeredI18n = getI18n();
    setI18n(shell.translations);
    let overlay: ReactTestRenderer | undefined;
    try {
      const board = makeProtocol13Board('locked-3d', [0, 0, 0, 0x09]);
      browser.plugIn(asHIDDevice(board.fake));
      await act(async () => {
        overlay = create(loader());
      });
      await act(async () => {
        await browser.click(
          () =>
            findButton(overlay!, (text) => text === '기기 인증').props.onClick(),
          () => testStore.getState().devices.readyDevicePath === board.path,
          asHIDDevice(board.fake),
        );
      });
      expect(browser.chooserOpened()).toBe(1);
      expect(status()).toContain('data-icon="spinner"');

      testStore.dispatch(
        invalidateDeviceConnection({
          devicePath: board.path,
          connectionGeneration:
            testStore.getState().devices.selectedConnectionGeneration! + 1,
          locked: true,
        }),
      );
      // A later scan leaves it out of the device list, and it stays selected.
      for (const connectedDevices of [
        {[board.path]: board.connectedDevice},
        {},
      ]) {
        testStore.dispatch(updateConnectedDevices(connectedDevices));
        const locked = status();
        expect(locked).toContain('키보드를 재연결하세요');
        expect(locked).not.toContain('data-icon="spinner"');
        expect(locked).not.toContain('기기 인증');
      }
    } finally {
      act(() => overlay?.unmount());
      setI18n(registeredI18n);
      browser.restore();
    }
  });
});

/** A storage that lasts one test, as sessionStorage lasts one visit. */
const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, String(value));
    },
  };
};

/**
 * The test renderer has no DOM, so each <dialog> gets a stand-in that records
 * showModal() and close(). A dialog is known by the message it describes itself with.
 */
const dialogMocks = () => {
  const dialogs = new Map<string, {open: boolean}>();
  return {
    createNodeMock: (element: ReactElement) => {
      if (element.type !== 'dialog') {
        return null;
      }
      const dialog = {
        open: false,
        showModal: () => {
          dialog.open = true;
        },
        close: () => {
          dialog.open = false;
        },
      };
      dialogs.set(element.props['aria-describedby'], dialog);
      return dialog;
    },
    openMessages: (renderer: ReactTestRenderer) =>
      renderer.root
        .findAll((node) => node.type === 'dialog')
        .filter((node) => dialogs.get(node.props['aria-describedby'])?.open)
        .map((node) => {
          const id = node.props['aria-describedby'];
          const [message] = id
            ? node.findAll(
                (child) => child.type === 'div' && child.props.id === id,
              )
            : [];
          return message ? textOf(message) : '';
        }),
  };
};

const pressEscape = (dialog: ReactTestInstance) =>
  act(async () => {
    dialog.props.onCancel({preventDefault: () => undefined});
  });

describe('dialogs', () => {
  beforeEach(() => {
    setEraAdvancedMetadataForTesting({schemaVersion: 2, definitions: []});
  });

  afterEach(() => {
    setEraAdvancedMetadataForTesting(null);
  });

  test('a keyboard with no definition reaches the upload in one click, and Escape closes the device dialogs', async () => {
    const shell = await loadAppShell();
    const {updateInvalidProtocolDevices, updateUnresolvedDefinitionDevices} =
      await import('../src/store/devicesSlice');
    const {setShowDesignTab} = await import('../src/store/settingsSlice');
    const DesignTab = shell.panes.find(
      (pane) => pane.key === 'design',
    )!.component;
    const navigatorHID = installFakeNavigatorHID(() => []);
    const restoreSession = stubGlobals({sessionStorage: memoryStorage()});
    let restoreDocument: (() => void) | undefined = stubGlobals({
      document: {
        hidden: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        getElementById: () => null,
      },
    });
    const testStore = makeAppTestStore();
    const dialogs = dialogMocks();
    let location = '/';
    const locationListeners = new Set<() => void>();
    const useTestLocation = (): [string, (to: string) => void] => [
      useSyncExternalStore(
        (listener) => {
          locationListeners.add(listener);
          return () => locationListeners.delete(listener);
        },
        () => location,
      ),
      (to: string) => {
        location = to;
        locationListeners.forEach((listener) => listener());
      },
    ];
    const board = (path: string, productName: string) => ({
      path,
      vendorId: 0x1234,
      productId: 0x5678,
      productName,
      protocol: 12,
      hasResolvedDefinition: false,
      requiredDefinitionVersion: 'v3' as const,
      vendorProductId: 0x12345678,
    });
    let app: ReactTestRenderer | undefined;
    let design: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        app = create(appShellElement(shell, testStore, useTestLocation, []), {
          createNodeMock: dialogs.createNodeMock,
        });
      });
      // Home's device scan finds no keyboard and settles.
      await waitUntil(
        () => testStore.getState().devices.selectionGeneration > 0,
        2000,
      );
      expect(JSON.stringify(app!.toJSON())).not.toContain('"href":"/design"');

      await act(async () => {
        testStore.dispatch(
          updateInvalidProtocolDevices({silent: board('silent', 'Silent Board')}),
        );
        testStore.dispatch(
          updateUnresolvedDefinitionDevices({
            mystery: board('mystery', 'Mystery Board'),
          }),
        );
      });
      expect(dialogs.openMessages(app!)).toEqual([
        expect.stringContaining('Silent Board'),
      ]);
      await pressEscape(app!.root.findByType('dialog'));
      expect(testStore.getState().devices.invalidProtocolDevicePaths).toEqual(
        {},
      );
      expect(dialogs.openMessages(app!)).toEqual([
        expect.stringContaining('Mystery Board'),
      ]);
      expect(
        app!.root
          .findByType('dialog')
          .findAll((node) => node.type === 'button')
          .map(textOf),
      ).toEqual([expect.any(String), '올리기']);

      await act(async () =>
        findButton(app!, (text) => text === '올리기').props.onClick(),
      );
      expect({
        location,
        showDesignTab: testStore.getState().settings.showDesignTab,
        unresolved: testStore.getState().devices.unresolvedDefinitionDevicePaths,
        dialogs: dialogs.openMessages(app!),
      }).toEqual({
        location: '/design',
        showDesignTab: true,
        unresolved: {},
        dialogs: [],
      });
      expect(JSON.stringify(app!.toJSON())).toContain('"href":"/design"');

      // The tab it opens shows the upload without its warning.
      act(() => app!.unmount());
      app = undefined;
      restoreDocument();
      restoreDocument = undefined;
      await act(async () => {
        design = create(withStore(shell, testStore, DesignTab), {
          createNodeMock: dialogs.createNodeMock,
        });
      });
      expect(design!.root.findAllByType('dialog')).toHaveLength(1);
      expect(dialogs.openMessages(design!)).toEqual([]);
    } finally {
      act(() => {
        app?.unmount();
        design?.unmount();
      });
      testStore.dispatch(setShowDesignTab(false));
      usbDetect.stopMonitoring();
      restoreDocument?.();
      restoreSession();
      navigatorHID.restore();
    }
  });

  test('Escape on the Design tab warning only closes it, and SETTINGS asks nothing after', async () => {
    const shell = await loadAppShell();
    const {setShowDesignTab} = await import('../src/store/settingsSlice');
    const pane = (key: string) =>
      shell.panes.find((candidate) => candidate.key === key)!.component;
    const DesignTab = pane('design');
    const restoreSession = stubGlobals({sessionStorage: memoryStorage()});
    const testStore = makeAppTestStore();
    const dialogs = dialogMocks();
    let location = '/design';
    const DesignRoute = () =>
      h(
        Router,
        {
          hook: () => [
            location,
            (to: string) => {
              location = to;
            },
          ],
        } as any,
        h(DesignTab),
      );
    let renderer: ReactTestRenderer | undefined;
    try {
      testStore.dispatch(setShowDesignTab(true));
      await act(async () => {
        renderer = create(withStore(shell, testStore, DesignRoute), {
          createNodeMock: dialogs.createNodeMock,
        });
      });
      expect(dialogs.openMessages(renderer!)).toEqual([
        expect.stringContaining('디자인 탭을 사용해'),
      ]);

      await pressEscape(renderer!.root.findByType('dialog'));
      expect({
        dialogs: dialogs.openMessages(renderer!),
        location,
        showDesignTab: testStore.getState().settings.showDesignTab,
        hiddenThisSession: sessionStorage.getItem('hideDesignWarning'),
        seen: localStorage.getItem('designWarningSeen'),
      }).toEqual({
        dialogs: [],
        location: '/design',
        showDesignTab: true,
        hiddenThisSession: '1',
        seen: '1',
      });
      expect(
        renderToStaticMarkup(withStore(shell, testStore, pane('settings'))),
      ).not.toContain('<dialog');
    } finally {
      act(() => renderer?.unmount());
      testStore.dispatch(setShowDesignTab(false));
      localStorage.removeItem('designWarningSeen');
      restoreSession();
    }
  });
});

describe('SETTINGS, DESIGN and the app error file', () => {
  test('SETTINGS shows the VIA protocol as a value, and without WebGL keeps every slider mode but not the keyboard view row', async () => {
    const shell = await loadAppShell();
    const {updateShowSliderValuesMode} =
      await import('../src/store/settingsSlice');
    const {webGLIsAvailable} = await import('../src/utils/test-webgl');
    const Settings = shell.panes.find(
      (pane) => pane.key === 'settings',
    )!.component;
    const testStore = makeAppTestStore();
    const savedMode = testStore.getState().settings.ShowSliderValuesMode;
    const markup = () =>
      renderToStaticMarkup(withStore(shell, testStore, Settings));
    const board = makeConnectedDevice('settings-board', p13VendorProductId);
    try {
      expect(webGLIsAvailable).toBe(false);
      testStore.dispatch(updateShowSliderValuesMode('Slider & Input Field'));
      expect(markup()).toMatch(/>VIA 프로토콜<\/label><span[^>]*>—<\/span>/);
      expect(markup()).toContain('>슬라이더 및 입력 필드<');
      expect(markup()).not.toContain('키보드 보기');

      testStore.dispatch(updateConnectedDevices({[board.path]: board}));
      testStore.dispatch(
        selectDevice({device: board, connectionGeneration: 1}),
      );
      expect(markup()).toMatch(/>VIA 프로토콜<\/label><span[^>]*>13<\/span>/);
    } finally {
      testStore.dispatch(updateShowSliderValuesMode(savedMode));
    }
  });

  test('DESIGN marks only the uploads a bundled definition of their version outranks', async () => {
    const shell = await loadAppShell();
    const {loadCustomDefinitions, updateEraDefinitions} =
      await import('../src/store/definitionsSlice');
    const Design = shell.panes.find((pane) => pane.key === 'design')!.component;
    const draft = (name: string, vendorProductId: number) =>
      ({...p13Definition, name, vendorProductId}) as any;
    const eraId = 0x45520001;
    const olderId = 0x12340002;
    // makeAppTestStore bundles an official v3 definition for p13VendorProductId.
    const testStore = makeAppTestStore();
    testStore.dispatch(
      updateEraDefinitions({[eraId]: {v3: draft('ERA', eraId)}}),
    );
    testStore.dispatch(
      updateDefinitions({[olderId]: {v2: draft('Older', olderId)}}),
    );
    testStore.dispatch(
      loadCustomDefinitions({
        version: 'v3',
        definitions: [
          draft('Official upload', p13VendorProductId),
          draft('ERA upload', eraId),
          draft('Older upload', olderId),
          draft('New upload', 0x12340003),
        ],
      }),
    );
    const restoreSession = stubGlobals({sessionStorage: memoryStorage()});
    try {
      const markup = renderToStaticMarkup(withStore(shell, testStore, Design));
      // The draft list comes last, after the select that also shows a name.
      const mark = (name: string) => {
        const start = markup.lastIndexOf(`>${name}<`);
        if (start < 0) {
          return 'missing';
        }
        const row = markup.slice(start, markup.indexOf('</button>', start));
        return row.includes('>내장 정의 사용<') ? 'built-in used' : 'plain';
      };
      expect(
        ['Official upload', 'ERA upload', 'Older upload', 'New upload'].map(
          (name) => [name, mark(name)],
        ),
      ).toEqual([
        ['Official upload', 'built-in used'],
        ['ERA upload', 'built-in used'],
        ['Older upload', 'plain'],
        ['New upload', 'plain'],
      ]);
    } finally {
      restoreSession();
    }
  });

  test('the app error file keeps the VIA protocol each error came with', async () => {
    const {saveAppErrors} = await import('../src/components/panes/errors');
    let written: Blob | undefined;
    const restore = stubGlobals({
      showSaveFilePicker: async () => ({
        createWritable: async () => ({
          write: async (blob: Blob) => {
            written = blob;
          },
          close: async () => undefined,
        }),
      }),
    });
    const deviceInfo = {
      vendorId: 0x1234,
      productId: 0x5678,
      productName: 'Board',
    };
    try {
      await saveAppErrors([
        {
          timestamp: '10:00:00.000',
          message: 'Failed',
          deviceInfo: {...deviceInfo, protocol: 12},
        },
        {timestamp: '10:00:01.000', message: 'Lost', deviceInfo},
      ]);
      expect((await written?.text())?.split('\n')).toEqual([
        'timestamp, productName, vendorId, productId, protocol, message',
        '10:00:00.000, Board, 0x1234, 0x5678, 12, "Failed"',
        '10:00:01.000, Board, 0x1234, 0x5678, , "Lost"',
      ]);
    } finally {
      restore();
    }
  });
});

describe('slider number field', () => {
  test('a typed number outside the range writes the nearest bound', async () => {
    const {updateShowSliderValuesMode} =
      await import('../src/store/settingsSlice');
    const {AccentRange} = await import('../src/components/inputs/accent-range');
    const {webGLIsAvailable} = await import('../src/utils/test-webgl');
    // A saved mode reaches the slider without WebGL too: the field is DOM.
    expect(webGLIsAvailable).toBe(false);
    const savedMode = appStore.getState().settings.ShowSliderValuesMode;
    appStore.dispatch(updateShowSliderValuesMode('Slider & Input Field'));
    const writes: number[] = [];
    let value = 10;
    const element = () =>
      h(
        Provider,
        {store: appStore} as any,
        h(AccentRange, {
          min: 0,
          max: 255,
          value,
          onChange: (next: number) => {
            writes.push(next);
            value = next;
          },
        }),
      );
    let renderer: ReactTestRenderer | undefined;
    try {
      act(() => {
        renderer = create(element());
      });
      const field = () =>
        renderer!.root.find(
          (node) => node.type === 'input' && node.props.type === 'number',
        );
      const typeValue = (text: string) =>
        act(() => {
          field().props.onFocus();
          field().props.onChange({target: {value: text}});
        });

      typeValue('300');
      act(() => field().props.onBlur());
      act(() => renderer!.update(element()));
      expect(writes).toEqual([255]);
      expect(field().props.value).toBe('255');

      typeValue('-5');
      act(() =>
        field().props.onKeyDown({
          key: 'Enter',
          currentTarget: {blur: () => field().props.onBlur()},
        }),
      );
      act(() => renderer!.update(element()));
      expect(writes).toEqual([255, 0]);
      expect(field().props.value).toBe('0');
    } finally {
      act(() => renderer?.unmount());
      appStore.dispatch(updateShowSliderValuesMode(savedMode));
    }
  });
});
