import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import {configureStore} from '@reduxjs/toolkit';
import {
  configureHIDTransport,
  HID,
  registerHIDDeviceForTesting,
  resetHIDTransportForTesting,
} from '../src/shims/node-hid';
import {KeyboardAPI} from '../src/utils/keyboard-api';
import {
  queryStateSyncEnvelope,
  resetStateSyncTagsForTesting,
  ERA_STATE_SYNC_SELECTOR,
} from '../src/utils/era-state-sync';
import {createExactTermAdapter} from '../src/utils/era-exact-ms';
import {setEraAdvancedMetadataForTesting} from '../src/utils/era-advanced-metadata';
import devicesReducer, {
  markDeviceReady,
  selectDevice,
  updateConnectedDevices,
} from '../src/store/devicesSlice';
import keymapReducer, {getLoadProgress, loadKeymapFromDevice} from '../src/store/keymapSlice';
import definitionsReducer, {updateDefinitions} from '../src/store/definitionsSlice';
import menusReducer from '../src/store/menusSlice';
import firmwareReducer from '../src/store/firmwareSlice';
import stateSyncReducer, {
  setConfigureVisible,
  setDocumentHidden,
} from '../src/store/stateSyncSlice';
import {
  pollStateSync,
  probeStateSyncForDevice,
  stopStateSyncPollingForTesting,
} from '../src/store/stateSyncThunks';
import type {ConnectedDevice} from '../src/types/types';

type InputListener = (event: {data: DataView}) => void;

class FakeHIDDevice {
  opened = false;
  vendorId = 0x4552;
  productId = 0xa002;
  productName = 'Fake VIA';
  collections = [{usagePage: 0xff60, usage: 0x61}];
  listeners = new Set<InputListener>();
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
    [...this.listeners].forEach((listener) =>
      listener({data: new DataView(message.slice().buffer)}),
    );
  }
}

const payload = (...bytes: number[]) => {
  const message = new Uint8Array(32);
  message.set(bytes);
  return message;
};

const waitUntil = async (predicate: () => boolean, timeoutMs = 400) => {
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

const TOMAK_VPID = 1163042818;
const ORDINARY_VPID = 0x12340001;

const makeConnectedDevice = (
  path: string,
  vendorProductId: number,
): ConnectedDevice => ({
  path,
  productId: vendorProductId & 0xffff,
  vendorId: Math.floor(vendorProductId / 65536),
  protocol: 12,
  productName: `Fake ${path}`,
  hasResolvedDefinition: true,
  requiredDefinitionVersion: 'v3',
  vendorProductId,
});

const be32 = (value: number) => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];

const emitEnvelope = (
  device: FakeHIDDevice,
  request: Uint8Array,
  revisions: {keymap: number; macro: number; config: number},
) => {
  device.emit(
    payload(
      0x02,
      ERA_STATE_SYNC_SELECTOR,
      0x01,
      0x00,
      request[4],
      request[5],
      0x07,
      0x00,
      ...be32(revisions.keymap),
      ...be32(revisions.macro),
      ...be32(revisions.config),
    ),
  );
};

const makeStore = () =>
  configureStore({
    reducer: {
      devices: devicesReducer,
      keymap: keymapReducer,
      definitions: definitionsReducer,
      menus: menusReducer,
      firmware: firmwareReducer,
      stateSync: stateSyncReducer,
    },
  });

beforeEach(() => {
  resetHIDTransportForTesting();
  resetStateSyncTagsForTesting();
  stopStateSyncPollingForTesting();
  configureHIDTransport({responseTimeoutMs: 200});
  setEraAdvancedMetadataForTesting({
    schemaVersion: 1,
    definitions: [
      {
        id: 'tomak79h-left',
        vendorProductId: TOMAK_VPID,
        stateSync: true,
        exactMsFamily: 'qmk',
      },
    ],
  });
});

afterEach(() => {
  stopStateSyncPollingForTesting();
  setEraAdvancedMetadataForTesting(null);
  resetHIDTransportForTesting();
});

describe('state-sync probe isolation', () => {
  test('ordinary definitions never send GET 0x06', async () => {
    const {device} = await connectFake('ordinary');
    device.onSend = (data) => {
      if (data[0] === 0x01) {
        device.emit(payload(0x01, 0x00, 0x0c));
      }
    };
    const store = makeStore();
    const connected = makeConnectedDevice('ordinary', ORDINARY_VPID);
    store.dispatch(updateConnectedDevices({[connected.path]: connected}));
    await (store.dispatch as any)(probeStateSyncForDevice(connected));
    expect(
      device.sentReports.some(
        ({data}) => data[0] === 0x02 && data[1] === ERA_STATE_SYNC_SELECTOR,
      ),
    ).toBe(false);
    expect(store.getState().stateSync.byPath[connected.path]).toBeUndefined();
  });

  test('opt-in firmware confirms capability with versioned 0x06 envelope', async () => {
    const {device} = await connectFake('capable');
    device.onSend = (data) => {
      if (data[0] === 0x02 && data[1] === ERA_STATE_SYNC_SELECTOR) {
        emitEnvelope(device, data, {keymap: 4, macro: 5, config: 6});
      }
    };
    const store = makeStore();
    const connected = makeConnectedDevice('capable', TOMAK_VPID);
    store.dispatch(
      updateDefinitions({
        [TOMAK_VPID]: {
          v3: {
            name: 'TOMAK',
            vendorProductId: TOMAK_VPID,
            firmwareVersion: 0,
            menus: [],
            layouts: {keys: [], labels: []},
            matrix: {rows: 1, cols: 1},
          },
        },
      } as any),
    );
    store.dispatch(updateConnectedDevices({[connected.path]: connected}));
    await (store.dispatch as any)(probeStateSyncForDevice(connected));
    const sent = device.sentReports.find(
      ({data}) => data[0] === 0x02 && data[1] === ERA_STATE_SYNC_SELECTOR,
    );
    expect(sent?.data[2]).toBe(0x01);
    expect(store.getState().stateSync.byPath[connected.path]?.capability).toBe(
      'capable',
    );
    expect(store.getState().stateSync.byPath[connected.path]?.revisions).toEqual({
      keymap: 4,
      macro: 5,
      config: 6,
    });
  });

  test('unhandled 0xFF is unsupported and does not retry', async () => {
    const {device} = await connectFake('old-fw');
    device.onSend = (data) => {
      if (data[0] === 0x02 && data[1] === ERA_STATE_SYNC_SELECTOR) {
        device.emit(payload(0xff));
      }
    };
    const store = makeStore();
    const connected = makeConnectedDevice('old-fw', TOMAK_VPID);
    store.dispatch(updateConnectedDevices({[connected.path]: connected}));
    await (store.dispatch as any)(probeStateSyncForDevice(connected));
    await (store.dispatch as any)(probeStateSyncForDevice(connected));
    expect(
      device.sentReports.filter(
        ({data}) => data[0] === 0x02 && data[1] === ERA_STATE_SYNC_SELECTOR,
      ),
    ).toHaveLength(1);
    expect(store.getState().stateSync.byPath[connected.path]?.capability).toBe(
      'unsupported',
    );
  });
});

describe('exact-ms HID transport', () => {
  test('exact SET 137 then GET returns 137 without 20ms snapping', async () => {
    const {device} = await connectFake('exact');
    let stored = 200;
    device.onSend = (data) => {
      if (data[0] === 0x07 && data[1] === 15 && data[2] === 5) {
        stored = (data[3] << 8) | data[4];
        device.emit(payload(0x07, 15, 5, data[3], data[4]));
      } else if (data[0] === 0x09 && data[1] === 15) {
        device.emit(payload(0x09, 15));
      } else if (data[0] === 0x08 && data[1] === 15 && data[2] === 5) {
        device.emit(payload(0x08, 15, 5, (stored >> 8) & 0xff, stored & 0xff));
      }
    };
    const api = new KeyboardAPI('exact');
    const adapter = createExactTermAdapter(api, 15, 5);
    expect(await adapter.write(137)).toBe(137);
    expect(await adapter.read()).toBe(137);
    expect(stored).toBe(137);
  });
});

describe('selected-visible polling', () => {
  test('polls only when selected, ready, visible and capable, and refreshes keymap on revision change', async () => {
    const {device} = await connectFake('poll');
    let keymapRevision = 1;
    device.onSend = (data) => {
      if (data[0] === 0x01) {
        device.emit(payload(0x01, 0x00, 0x0c));
      } else if (data[0] === 0x02 && data[1] === ERA_STATE_SYNC_SELECTOR) {
        emitEnvelope(device, data, {
          keymap: keymapRevision,
          macro: 1,
          config: 1,
        });
      } else if (data[0] === 0x11) {
        device.emit(payload(0x11, 0x01));
      } else if (data[0] === 0x12) {
        device.emit(payload(0x12, data[1], data[2], data[3], 0x00, 0x01));
      }
    };

    const store = makeStore();
    const dispatch = store.dispatch as any;
    const connected = makeConnectedDevice('poll', TOMAK_VPID);
    dispatch(
      updateDefinitions({
        [TOMAK_VPID]: {
          v3: {
            name: 'TOMAK',
            vendorProductId: TOMAK_VPID,
            firmwareVersion: 0,
            menus: [],
            layouts: {keys: [], labels: []},
            matrix: {rows: 1, cols: 1},
          },
        },
      } as any),
    );
    dispatch(updateConnectedDevices({[connected.path]: connected}));
    const generation = new KeyboardAPI(connected.path).getConnectionGeneration();
    dispatch(selectDevice({device: connected, connectionGeneration: generation}));
    dispatch(
      markDeviceReady({
        devicePath: connected.path,
        connectionGeneration: generation,
        selectionGeneration: store.getState().devices.selectionGeneration,
      }),
    );
    await dispatch(probeStateSyncForDevice(connected));
    const afterProbe = device.sentReports.length;

    dispatch(setConfigureVisible(false));
    dispatch(setDocumentHidden(false));
    await dispatch(pollStateSync());
    expect(device.sentReports.length).toBe(afterProbe);

    dispatch(setConfigureVisible(true));
    dispatch(setDocumentHidden(true));
    await dispatch(pollStateSync());
    expect(device.sentReports.length).toBe(afterProbe);

    dispatch(setDocumentHidden(false));
    await dispatch(pollStateSync());
    expect(
      device.sentReports.filter(
        ({data}) => data[0] === 0x02 && data[1] === ERA_STATE_SYNC_SELECTOR,
      ).length,
    ).toBeGreaterThan(1);

    keymapRevision = 2;
    await dispatch(pollStateSync());
    await waitUntil(
      () => device.sentReports.some(({data}) => data[0] === 0x12),
      800,
    );
    expect(getLoadProgress(store.getState() as any)).toBe(1);
    expect(store.getState().keymap.rawDeviceMap[connected.path][0].keymap).toEqual([
      1,
    ]);
  });
});

describe('queryStateSyncEnvelope HID path', () => {
  test('returns null on 0xFF without throwing', async () => {
    const {device} = await connectFake('ff');
    device.onSend = (data) => {
      if (data[0] === 0x02) {
        device.emit(payload(0xff));
      }
    };
    const api = new KeyboardAPI('ff');
    expect(await queryStateSyncEnvelope(api)).toBeNull();
  });
});
