import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import {configureStore} from '@reduxjs/toolkit';
import {
  addHIDTransportGenerationListener,
  configureHIDTransport,
  disconnectHIDDeviceForTesting,
  getHIDTransportDebugState,
  HID,
  isHIDTransportLifecycleCancellationError,
  HIDTransportTimeoutError,
  registerHIDDeviceForTesting,
  resetHIDTransportForTesting,
} from '../src/shims/node-hid';
import {KeyboardAPI} from '../src/utils/keyboard-api';
import {store as appStore} from '../src/store';
import errorsReducer, {
  clearAppErrors,
  getAppErrors,
} from '../src/store/errorsSlice';
import {reloadConnectedDevices} from '../src/store/devicesThunks';
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
  updateDefinitions,
} from '../src/store/definitionsSlice';
import menusReducer, {
  getCustomCommandsForDefinition,
  syncCustomMenuValuesFromRequest,
} from '../src/store/menusSlice';
import firmwareReducer from '../src/store/firmwareSlice';
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
  onSend?: (data: Uint8Array) => void | Promise<void>;

  async open() {
    this.opened = true;
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

const installFakeNavigatorHID = (getDevices: () => HIDDevice[]) => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'hid');
  const listeners = new Map<string, Set<(event: {device: HIDDevice}) => void>>();
  const hid = {
    getDevices: async () => getDevices(),
    requestDevice: async () => getDevices(),
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

    const errors = getAppErrors(appStore.getState());
    expect(errors).toHaveLength(1);
    expect(errors[0].message.length).toBeGreaterThan(0);
  });

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
      ({path, generation}) =>
        dispatch(
          invalidateDeviceConnection({
            devicePath: path,
            connectionGeneration: generation,
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
      }),
    );
    expect(state.readyDevicePath).toBeNull();
    expect(state.selectedConnectionNeedsReload).toBe(true);
    expect(state.selectionGeneration).toBe(currentSelectionGeneration + 1);
  });
});
