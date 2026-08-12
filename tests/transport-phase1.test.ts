import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import {configureStore} from '@reduxjs/toolkit';
import {
  addHIDTransportGenerationListener,
  configureHIDTransport,
  disconnectHIDDeviceForTesting,
  getHIDTransportDebugState,
  HID,
  HIDTransportTimeoutError,
  registerHIDDeviceForTesting,
  resetHIDTransportForTesting,
} from '../src/shims/node-hid';
import {KeyboardAPI} from '../src/utils/keyboard-api';
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

const connectFake = async (path: string, device = new FakeHIDDevice()) => {
  registerHIDDeviceForTesting(path, asHIDDevice(device));
  const hid = new HID.HID(path);
  await hid.openPromise;
  return {device, hid};
};

beforeEach(() => {
  resetHIDTransportForTesting();
  configureHIDTransport({responseTimeoutMs: 200});
});

afterEach(() => {
  resetHIDTransportForTesting();
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
  test('a keymap read continues on its captured API and cannot complete the newly selected device cache', async () => {
    const vendorProductId = 1163042818;
    const generatedDefinition = await Bun.file(
      'public/definitions/v3/1163042818.json',
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
      'public/definitions/v3/1163042818.json',
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
