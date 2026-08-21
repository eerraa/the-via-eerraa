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
import keymapReducer, {
  getLoadProgress,
  loadKeymapFromDevice,
  updateKey,
} from '../src/store/keymapSlice';
import {saveKeymapSuccess} from '../src/store/keymapSlice';
import macrosReducer, {loadMacrosSuccess} from '../src/store/macrosSlice';
import definitionsReducer, {
  updateDefinitions,
  updateLayoutOptions,
} from '../src/store/definitionsSlice';
import menusReducer, {
  updateSelectedCustomMenuData,
} from '../src/store/menusSlice';
import firmwareReducer from '../src/store/firmwareSlice';
import stateSyncReducer, {
  setConfigureVisible,
  setDocumentHidden,
  setDomainStatus,
} from '../src/store/stateSyncSlice';
import {
  pollStateSync,
  probeStateSyncForDevice,
  refreshAllDomains,
  syncPolling,
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
      macros: macrosReducer,
      definitions: definitionsReducer,
      menus: menusReducer,
      firmware: firmwareReducer,
      stateSync: stateSyncReducer,
    },
  });

const macroAst = (text: string) =>
  [[[5, text]]] as unknown as ReturnType<
    typeof loadMacrosSuccess
  >['payload']['ast'];

const makeV3Definition = (withMenu = false) => ({
  name: 'TOMAK',
  vendorProductId: TOMAK_VPID,
  firmwareVersion: 0,
  keycodes: [],
  menus: withMenu
    ? [
        {
          label: 'CONFIG',
          content: [
            {
              label: 'Values',
              content: [
                {
                  label: 'Value',
                  type: 'range',
                  content: ['id_test_value', 1, 1],
                  options: [0, 255],
                },
              ],
            },
          ],
        },
      ]
    : [],
  layouts: {
    keys: [
      {
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        row: 0,
        col: 0,
        color: 'alpha',
        d: false,
        r: 0,
        rx: 0,
        ry: 0,
        ei: 0,
        li: 0,
      },
    ],
    labels: [['Layout', 'A', 'B']],
    width: 1,
    height: 1,
    optionKeys: {},
  },
  matrix: {rows: 1, cols: 1},
});

class FakeStateSyncFirmware {
  revisions = {keymap: 1, macro: 1, config: 1};
  keymapValue = 1;
  macroText = 'A';
  layoutValue = 0;
  menuValue = 0;
  perKeyRGB: [number, number] = [10, 20];
  encoderValues: [number, number] = [100, 101];
  stateSyncReads = 0;
  keymapReads = 0;
  macroBufferReads = 0;
  layoutReads = 0;
  menuReads = 0;
  encoderReads = 0;
  dropNextStateSync = false;
  malformNextStateSync = false;
  holdNextStateSync = false;
  holdAfterMacroBufferRead = 0;
  holdAfterLayoutRead = 0;
  holdAfterMenuRead = 0;
  holdAfterEncoderRead = 0;
  changeConfigOnNextKeymapRead = false;
  churnKeymapReads = 0;
  heldStateSyncRequest?: Uint8Array;

  constructor(readonly device: FakeHIDDevice) {}

  onSend = (data: Uint8Array) => {
    if (data[0] === 0x01) {
      this.device.emit(payload(0x01, 0x00, 0x0c));
      return;
    }
    if (data[0] === 0x02 && data[1] === ERA_STATE_SYNC_SELECTOR) {
      this.stateSyncReads++;
      if (this.dropNextStateSync) {
        this.dropNextStateSync = false;
        return;
      }
      if (this.malformNextStateSync) {
        this.malformNextStateSync = false;
        const malformed = payload(
          0x02,
          ERA_STATE_SYNC_SELECTOR,
          0x01,
          0x00,
          data[4],
          data[5],
          0x07,
          0x01,
          ...be32(this.revisions.keymap),
          ...be32(this.revisions.macro),
          ...be32(this.revisions.config),
        );
        this.device.emit(malformed);
        return;
      }
      const shouldHold =
        this.holdNextStateSync ||
        (this.holdAfterMacroBufferRead > 0 &&
          this.macroBufferReads >= this.holdAfterMacroBufferRead) ||
        (this.holdAfterLayoutRead > 0 &&
          this.layoutReads >= this.holdAfterLayoutRead &&
          this.menuReads >= this.holdAfterMenuRead) ||
        (this.holdAfterEncoderRead > 0 &&
          this.encoderReads >= this.holdAfterEncoderRead);
      if (shouldHold) {
        this.holdNextStateSync = false;
        this.holdAfterMacroBufferRead = 0;
        this.holdAfterLayoutRead = 0;
        this.holdAfterMenuRead = 0;
        this.holdAfterEncoderRead = 0;
        this.heldStateSyncRequest = data.slice();
        return;
      }
      emitEnvelope(this.device, data, this.revisions);
      return;
    }
    if (data[0] === 0x11) {
      this.device.emit(payload(0x11, 0x01));
      return;
    }
    if (data[0] === 0x12) {
      this.keymapReads++;
      if (this.changeConfigOnNextKeymapRead) {
        this.changeConfigOnNextKeymapRead = false;
        this.revisions.config++;
        this.layoutValue = 1;
      }
      if (this.churnKeymapReads > 0) {
        this.churnKeymapReads--;
        this.revisions.keymap++;
        this.keymapValue = this.revisions.keymap;
      }
      this.device.emit(
        payload(
          0x12,
          data[1],
          data[2],
          data[3],
          (this.keymapValue >> 8) & 0xff,
          this.keymapValue & 0xff,
        ),
      );
      return;
    }
    if (data[0] === 0x05) {
      this.revisions.keymap++;
      this.keymapValue = (data[4] << 8) | data[5];
      this.device.emit(
        payload(0x05, data[1], data[2], data[3], data[4], data[5]),
      );
      return;
    }
    if (data[0] === 0x14) {
      this.encoderReads++;
      const value = this.encoderValues[data[3] ? 1 : 0];
      this.device.emit(
        payload(
          0x14,
          data[1],
          data[2],
          data[3],
          (value >> 8) & 0xff,
          value & 0xff,
        ),
      );
      return;
    }
    if (data[0] === 0x0d) {
      this.device.emit(payload(0x0d, 0x00, 0x02));
      return;
    }
    if (data[0] === 0x0e) {
      this.macroBufferReads++;
      const bytes = new Array(28).fill(0);
      bytes[0] = this.macroText.charCodeAt(0);
      this.device.emit(payload(0x0e, data[1], data[2], data[3], ...bytes));
      return;
    }
    if (data[0] === 0x0c) {
      this.device.emit(payload(0x0c, 0x01));
      return;
    }
    if (data[0] === 0x02 && data[1] === 0x02) {
      this.layoutReads++;
      this.device.emit(payload(0x02, 0x02, 0x00, 0x00, 0x00, this.layoutValue));
      return;
    }
    if (data[0] === 0x08 && data[1] === 0x01 && data[2] === 0x01) {
      this.menuReads++;
      this.device.emit(payload(0x08, 0x01, 0x01, this.menuValue));
      return;
    }
    if (data[0] === 0x08 && data[1] === 0x00 && data[2] === 0x01) {
      this.device.emit(
        payload(0x08, 0x00, 0x01, data[3], data[4], ...this.perKeyRGB),
      );
    }
  };

  releaseHeldStateSync() {
    if (!this.heldStateSyncRequest) {
      throw new Error('No State Sync request is held');
    }
    const request = this.heldStateSyncRequest;
    this.heldStateSyncRequest = undefined;
    emitEnvelope(this.device, request, this.revisions);
  }
}

const prepareSelectedStateSyncDevice = async (
  path: string,
  options?: {
    withMenu?: boolean;
    revisions?: Partial<FakeStateSyncFirmware['revisions']>;
  },
) => {
  const {device} = await connectFake(path);
  const firmware = new FakeStateSyncFirmware(device);
  firmware.revisions = {...firmware.revisions, ...options?.revisions};
  device.onSend = firmware.onSend;
  const store = makeStore();
  const connected = makeConnectedDevice(path, TOMAK_VPID);
  store.dispatch(
    updateDefinitions({
      [TOMAK_VPID]: {v3: makeV3Definition(options?.withMenu)},
    } as any),
  );
  store.dispatch(updateConnectedDevices({[path]: connected}));
  const generation = new KeyboardAPI(path).getConnectionGeneration();
  store.dispatch(
    selectDevice({device: connected, connectionGeneration: generation}),
  );
  store.dispatch(
    markDeviceReady({
      devicePath: path,
      connectionGeneration: generation,
      selectionGeneration: store.getState().devices.selectionGeneration,
    }),
  );
  store.dispatch(
    saveKeymapSuccess({
      devicePath: path,
      connectionGeneration: generation,
      layers: [{keymap: [firmware.keymapValue], isLoaded: true}],
    }),
  );
  store.dispatch(
    loadMacrosSuccess({
      ast: macroAst(firmware.macroText),
      macroBufferSize: 2,
      macroCount: 1,
    }),
  );
  store.dispatch(updateLayoutOptions({[path]: [firmware.layoutValue]}));
  if (options?.withMenu) {
    store.dispatch(
      updateSelectedCustomMenuData({
        devicePath: path,
        menuData: {
          id_test_value: [firmware.menuValue],
          __perKeyRGB: [firmware.perKeyRGB],
        },
      }),
    );
  }
  return {store, connected, firmware, generation};
};

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
    const sync = store.getState().stateSync.byPath[connected.path];
    expect({
      keymap: sync?.keymap.observedRevision,
      macro: sync?.macro.observedRevision,
      config: sync?.config.observedRevision,
    }).toEqual({keymap: 4, macro: 5, config: 6});
  });

  test('unhandled 0xFF is unsupported and does not retry', async () => {
    const {device} = await connectFake('old-fw');
    device.onSend = (data) => {
      if (data[0] === 0x02 && data[1] === ERA_STATE_SYNC_SELECTOR) {
        const response = data.slice();
        response[0] = 0xff;
        device.emit(response);
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

  test('initial timeout falls back once without poisoning ordinary VIA traffic', async () => {
    configureHIDTransport({responseTimeoutMs: 15});
    const {device} = await connectFake('old-timeout');
    let timedOutRequest: Uint8Array | undefined;
    device.onSend = (data) => {
      if (data[0] === 0x02 && data[1] === ERA_STATE_SYNC_SELECTOR) {
        timedOutRequest = data.slice();
        return;
      }
      if (data[0] === 0x01) {
        if (timedOutRequest) {
          const lateUnhandled = timedOutRequest.slice();
          lateUnhandled[0] = 0xff;
          device.emit(lateUnhandled);
          timedOutRequest = undefined;
        }
        device.emit(payload(0x01, 0x00, 0x0c));
      }
    };
    const store = makeStore();
    const connected = makeConnectedDevice('old-timeout', TOMAK_VPID);
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
    expect(await new KeyboardAPI(connected.path).getProtocolVersion()).toBe(12);
  });

  test('initial malformed envelope falls back once without an error path', async () => {
    const {device} = await connectFake('old-malformed');
    device.onSend = (data) => {
      if (data[0] === 0x02 && data[1] === ERA_STATE_SYNC_SELECTOR) {
        device.emit(
          payload(
            0x02,
            ERA_STATE_SYNC_SELECTOR,
            0x01,
            0x00,
            data[4],
            data[5],
            0x07,
            0x01,
            ...be32(1),
            ...be32(1),
            ...be32(1),
          ),
        );
      }
    };
    const store = makeStore();
    const connected = makeConnectedDevice('old-malformed', TOMAK_VPID);
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
    const generation = new KeyboardAPI(
      connected.path,
    ).getConnectionGeneration();
    dispatch(
      selectDevice({device: connected, connectionGeneration: generation}),
    );
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
    expect(
      store.getState().keymap.rawDeviceMap[connected.path][0].keymap,
    ).toEqual([1]);
  });
});

describe('State Sync freshness coordinator regressions', () => {
  test('capability probe cannot attach a newer revision to the stale lifecycle snapshot', async () => {
    const {store, connected, firmware} =
      await prepareSelectedStateSyncDevice('probe-race');
    firmware.revisions.keymap = 2;
    firmware.keymapValue = 2;

    await (store.dispatch as any)(probeStateSyncForDevice(connected));

    expect(
      store.getState().keymap.rawDeviceMap[connected.path][0].keymap,
    ).toEqual([2]);
    const keymapFreshness =
      store.getState().stateSync.byPath[connected.path]?.keymap;
    expect(keymapFreshness?.status).toBe('fresh');
    expect((keymapFreshness as any)?.acceptedRevision).toBe(2);
  });

  test('a keymap end query cannot swallow a concurrent config revision', async () => {
    const {store, connected, firmware} = await prepareSelectedStateSyncDevice(
      'cross-domain',
      {revisions: {config: 5}},
    );
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    const configReadsAfterProbe = firmware.layoutReads;
    firmware.revisions.keymap = 2;
    firmware.keymapValue = 2;
    firmware.changeConfigOnNextKeymapRead = true;
    dispatch(setConfigureVisible(true));

    await dispatch(pollStateSync());
    await dispatch(pollStateSync());

    expect(firmware.layoutReads).toBeGreaterThan(configReadsAfterProbe);
    expect(
      store.getState().definitions.layoutOptionsMap[connected.path],
    ).toEqual([1]);
    expect(
      (store.getState().stateSync.byPath[connected.path]?.config as any)
        ?.acceptedRevision,
    ).toBe(6);
  });

  test('one capable timeout preserves capability and converges on the next poll', async () => {
    configureHIDTransport({responseTimeoutMs: 15});
    const {store, connected, firmware} =
      await prepareSelectedStateSyncDevice('transient-query');
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    const keymapReadsAfterProbe = firmware.keymapReads;
    dispatch(setConfigureVisible(true));
    firmware.dropNextStateSync = true;

    await dispatch(pollStateSync());
    expect(store.getState().stateSync.byPath[connected.path]?.capability).toBe(
      'capable',
    );

    await dispatch(pollStateSync());
    expect(store.getState().stateSync.byPath[connected.path]?.capability).toBe(
      'capable',
    );
    expect(
      store.getState().stateSync.byPath[connected.path]?.keymap.status,
    ).toBe('fresh');
    expect(firmware.keymapReads).toBeGreaterThan(keymapReadsAfterProbe);
  });

  test('dirty domain retries even when the observed revision is unchanged', async () => {
    const {store, connected, firmware, generation} =
      await prepareSelectedStateSyncDevice('dirty-equality');
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    const keymapReadsAfterProbe = firmware.keymapReads;
    dispatch(
      setDomainStatus({
        path: connected.path,
        generation,
        domain: 'keymap',
        status: 'dirty',
        revision: firmware.revisions.keymap,
      }),
    );
    dispatch(setConfigureVisible(true));

    await dispatch(pollStateSync());

    expect(firmware.keymapReads).toBeGreaterThan(keymapReadsAfterProbe);
    expect(
      store.getState().stateSync.byPath[connected.path]?.keymap.status,
    ).toBe('fresh');
  });

  test('successful SET is optimistic but stays dirty until an authoritative bracket', async () => {
    const {store, connected} =
      await prepareSelectedStateSyncDevice('set-invalidation');
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));

    await dispatch(updateKey(0, 9));

    expect(
      store.getState().keymap.rawDeviceMap[connected.path][0].keymap,
    ).toEqual([9]);
    expect(
      store.getState().stateSync.byPath[connected.path]?.keymap,
    ).toMatchObject({
      status: 'dirty',
      observedRevision: 1,
      acceptedRevision: 1,
    });

    dispatch(setConfigureVisible(true));
    await dispatch(pollStateSync());

    expect(
      store.getState().stateSync.byPath[connected.path]?.keymap,
    ).toMatchObject({
      status: 'fresh',
      observedRevision: 2,
      acceptedRevision: 2,
    });
    expect(
      store.getState().keymap.rawDeviceMap[connected.path][0].keymap,
    ).toEqual([9]);
  });

  test('three unstable keymap candidates stay private, then the next poll converges', async () => {
    const {store, connected, firmware} =
      await prepareSelectedStateSyncDevice('keymap-churn');
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.revisions.keymap = 2;
    firmware.keymapValue = 2;
    firmware.churnKeymapReads = 3;
    dispatch(setConfigureVisible(true));

    await dispatch(pollStateSync());

    expect(
      store.getState().keymap.rawDeviceMap[connected.path][0].keymap,
    ).toEqual([1]);
    expect(
      store.getState().stateSync.byPath[connected.path]?.keymap.status,
    ).toBe('dirty');

    await dispatch(pollStateSync());
    expect(
      store.getState().keymap.rawDeviceMap[connected.path][0].keymap,
    ).toEqual([5]);
    expect(
      store.getState().stateSync.byPath[connected.path]?.keymap.status,
    ).toBe('fresh');
  });

  test('matrix layers and encoder mappings stay private until one stable keymap commit', async () => {
    const {store, connected, firmware} = await prepareSelectedStateSyncDevice(
      'keymap-encoder-atomic',
    );
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.revisions.keymap = 2;
    firmware.keymapValue = 2;
    firmware.encoderValues = [200, 201];
    firmware.holdAfterEncoderRead = firmware.encoderReads + 2;
    dispatch(setConfigureVisible(true));

    const polling = dispatch(pollStateSync());
    await waitUntil(() => firmware.heldStateSyncRequest !== undefined, 800);
    const layersBeforeCommit =
      store.getState().keymap.rawDeviceMap[connected.path][0].keymap;
    const encodersBeforeCommit =
      store.getState().keymap.encoderDeviceMap[connected.path]?.[0]?.[0];
    firmware.releaseHeldStateSync();
    await polling;

    expect(layersBeforeCommit).toEqual([1]);
    expect(encodersBeforeCommit).toEqual([100, 101]);
    expect(
      store.getState().keymap.rawDeviceMap[connected.path][0].keymap,
    ).toEqual([2]);
    expect(
      store.getState().keymap.encoderDeviceMap[connected.path]?.[0]?.[0],
    ).toEqual([200, 201]);
  });

  test('macro candidate is not exposed before its stable end revision', async () => {
    const {store, connected, firmware} =
      await prepareSelectedStateSyncDevice('macro-atomic');
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.revisions.macro = 2;
    firmware.macroText = 'B';
    firmware.holdAfterMacroBufferRead = firmware.macroBufferReads + 1;
    dispatch(setConfigureVisible(true));

    const polling = dispatch(pollStateSync());
    await waitUntil(() => firmware.heldStateSyncRequest !== undefined, 800);
    const candidateWasPrivate = store.getState().macros.ast;
    firmware.releaseHeldStateSync();
    await polling;
    expect(candidateWasPrivate).toEqual(macroAst('A'));
    expect(store.getState().macros.ast).toEqual(macroAst('B'));
  });

  test('layout and menu candidates commit together only after a stable config bracket', async () => {
    const {store, connected, firmware} = await prepareSelectedStateSyncDevice(
      'config-atomic',
      {withMenu: true},
    );
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.revisions.config = 2;
    firmware.layoutValue = 1;
    firmware.menuValue = 9;
    firmware.perKeyRGB = [30, 40];
    firmware.holdAfterLayoutRead = firmware.layoutReads + 1;
    firmware.holdAfterMenuRead = firmware.menuReads + 1;
    dispatch(setConfigureVisible(true));

    const polling = dispatch(pollStateSync());
    await waitUntil(() => firmware.heldStateSyncRequest !== undefined, 800);
    const layoutBeforeCommit =
      store.getState().definitions.layoutOptionsMap[connected.path];
    const menuBeforeCommit =
      store.getState().menus.customMenuDataMap[connected.path]?.id_test_value;
    const perKeyBeforeCommit =
      store.getState().menus.customMenuDataMap[connected.path]?.__perKeyRGB;
    firmware.releaseHeldStateSync();
    await polling;
    expect(layoutBeforeCommit).toEqual([0]);
    expect(menuBeforeCommit?.[0]).toBe(0);
    expect(perKeyBeforeCommit).toEqual([[10, 20]]);
    expect(
      store.getState().definitions.layoutOptionsMap[connected.path],
    ).toEqual([1]);
    expect(
      store.getState().menus.customMenuDataMap[connected.path]
        ?.id_test_value?.[0],
    ).toBe(9);
    expect(
      store.getState().menus.customMenuDataMap[connected.path]?.__perKeyRGB,
    ).toEqual([[30, 40]]);
  });

  test('poll and resume full refresh share one path/domain owner', async () => {
    const {store, connected, firmware} =
      await prepareSelectedStateSyncDevice('coalesced-owner');
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    const baselineReads = firmware.keymapReads;
    firmware.revisions.keymap = 2;
    firmware.keymapValue = 2;
    firmware.holdNextStateSync = true;
    dispatch(setConfigureVisible(true));

    const polling = dispatch(pollStateSync());
    await waitUntil(() => firmware.heldStateSyncRequest !== undefined, 800);
    const resuming = dispatch(refreshAllDomains(connected));
    firmware.releaseHeldStateSync();
    await Promise.all([polling, resuming]);

    expect(firmware.keymapReads - baselineReads).toBe(1);
    expect(
      store.getState().keymap.rawDeviceMap[connected.path][0].keymap,
    ).toEqual([2]);
  });

  test('a full refresh arriving after a poll domain rereads that domain after the lifecycle boundary', async () => {
    const {store, connected, firmware} = await prepareSelectedStateSyncDevice(
      'coalesced-full-boundary',
    );
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    const baselineKeymapReads = firmware.keymapReads;
    firmware.revisions.keymap = 2;
    firmware.keymapValue = 2;
    firmware.revisions.macro = 2;
    firmware.macroText = 'B';
    firmware.holdAfterMacroBufferRead = firmware.macroBufferReads + 1;
    dispatch(setConfigureVisible(true));

    const polling = dispatch(pollStateSync());
    await waitUntil(
      () =>
        firmware.keymapReads > baselineKeymapReads &&
        firmware.heldStateSyncRequest !== undefined,
      800,
    );
    const resuming = dispatch(refreshAllDomains(connected));
    firmware.releaseHeldStateSync();
    await Promise.all([polling, resuming]);

    expect(firmware.keymapReads - baselineKeymapReads).toBe(2);
    expect(
      store.getState().stateSync.byPath[connected.path]?.keymap.status,
    ).toBe('fresh');
  });

  test('hidden state emits no periodic traffic and resume forces a full refresh', async () => {
    const {store, connected, firmware} =
      await prepareSelectedStateSyncDevice('visibility');
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    const stateSyncReadsBeforeHidden = firmware.stateSyncReads;
    const keymapReadsBeforeResume = firmware.keymapReads;
    dispatch(setConfigureVisible(true));
    dispatch(setDocumentHidden(true));
    dispatch(syncPolling());

    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(firmware.stateSyncReads).toBe(stateSyncReadsBeforeHidden);

    dispatch(setDocumentHidden(false));
    await dispatch(refreshAllDomains(connected));
    expect(firmware.keymapReads).toBeGreaterThan(keymapReadsBeforeResume);
    expect(
      store.getState().stateSync.byPath[connected.path]?.config.status,
    ).toBe('fresh');
  });

  test('A/B selection generations discard the old candidate and refresh on every return', async () => {
    const {
      store,
      connected: deviceA,
      firmware: firmwareA,
      generation: generationA,
    } = await prepareSelectedStateSyncDevice('device-a');
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(deviceA));
    firmwareA.revisions.keymap = 2;
    firmwareA.keymapValue = 2;
    firmwareA.holdNextStateSync = true;
    dispatch(setConfigureVisible(true));
    const stalePoll = dispatch(pollStateSync());
    await waitUntil(() => firmwareA.heldStateSyncRequest !== undefined, 800);

    const {device: fakeB} = await connectFake('device-b');
    const firmwareB = new FakeStateSyncFirmware(fakeB);
    firmwareB.revisions = {keymap: 9, macro: 9, config: 9};
    firmwareB.keymapValue = 9;
    firmwareB.macroText = 'Z';
    firmwareB.layoutValue = 1;
    fakeB.onSend = firmwareB.onSend;
    const deviceB = makeConnectedDevice('device-b', TOMAK_VPID);
    dispatch(
      updateConnectedDevices({
        [deviceA.path]: deviceA,
        [deviceB.path]: deviceB,
      }),
    );
    const generationB = new KeyboardAPI(deviceB.path).getConnectionGeneration();
    dispatch(
      selectDevice({device: deviceB, connectionGeneration: generationB}),
    );
    dispatch(
      markDeviceReady({
        devicePath: deviceB.path,
        connectionGeneration: generationB,
        selectionGeneration: store.getState().devices.selectionGeneration,
      }),
    );
    firmwareA.releaseHeldStateSync();
    await stalePoll;
    await dispatch(probeStateSyncForDevice(deviceB));

    expect(
      store.getState().keymap.rawDeviceMap[deviceA.path][0].keymap,
    ).toEqual([1]);
    expect(
      store.getState().keymap.rawDeviceMap[deviceB.path][0].keymap,
    ).toEqual([9]);
    expect(store.getState().macros.ast).toEqual(macroAst('Z'));

    dispatch(
      selectDevice({device: deviceA, connectionGeneration: generationA}),
    );
    dispatch(
      markDeviceReady({
        devicePath: deviceA.path,
        connectionGeneration: generationA,
        selectionGeneration: store.getState().devices.selectionGeneration,
      }),
    );
    await dispatch(probeStateSyncForDevice(deviceA));
    expect(
      store.getState().keymap.rawDeviceMap[deviceA.path][0].keymap,
    ).toEqual([2]);
    expect(
      store.getState().stateSync.byPath[deviceA.path]?.keymap.acceptedRevision,
    ).toBe(2);
  });

  test('reconnect generation rejects an old candidate and accepts only new-device reads', async () => {
    const {
      store,
      connected,
      firmware: oldFirmware,
    } = await prepareSelectedStateSyncDevice('generation-reconnect');
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    oldFirmware.revisions.keymap = 2;
    oldFirmware.keymapValue = 2;
    oldFirmware.holdNextStateSync = true;
    dispatch(setConfigureVisible(true));
    const stalePoll = dispatch(pollStateSync());
    await waitUntil(() => oldFirmware.heldStateSyncRequest !== undefined, 800);

    const replacementDevice = new FakeHIDDevice();
    const replacementFirmware = new FakeStateSyncFirmware(replacementDevice);
    replacementFirmware.revisions = {keymap: 7, macro: 7, config: 7};
    replacementFirmware.keymapValue = 7;
    replacementFirmware.macroText = 'R';
    replacementDevice.onSend = replacementFirmware.onSend;
    registerHIDDeviceForTesting(connected.path, asHIDDevice(replacementDevice));
    const replacementHID = new HID.HID(connected.path);
    await replacementHID.openPromise;
    oldFirmware.releaseHeldStateSync();
    await stalePoll;

    const replacementGeneration = new KeyboardAPI(
      connected.path,
    ).getConnectionGeneration();
    dispatch(
      selectDevice({
        device: connected,
        connectionGeneration: replacementGeneration,
      }),
    );
    dispatch(
      markDeviceReady({
        devicePath: connected.path,
        connectionGeneration: replacementGeneration,
        selectionGeneration: store.getState().devices.selectionGeneration,
      }),
    );
    await dispatch(probeStateSyncForDevice(connected));

    expect(store.getState().stateSync.byPath[connected.path]?.generation).toBe(
      replacementGeneration,
    );
    expect(
      store.getState().stateSync.byPath[connected.path]?.keymap
        .acceptedRevision,
    ).toBe(7);
    expect(
      store.getState().keymap.rawDeviceMap[connected.path][0].keymap,
    ).toEqual([7]);
  });
});

describe('queryStateSyncEnvelope HID path', () => {
  test('returns null on 0xFF without throwing', async () => {
    const {device} = await connectFake('ff');
    device.onSend = (data) => {
      if (data[0] === 0x02) {
        const response = data.slice();
        response[0] = 0xff;
        device.emit(response);
      }
    };
    const api = new KeyboardAPI('ff');
    expect(await queryStateSyncEnvelope(api)).toBeNull();
  });
});
