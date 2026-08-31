import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import {configureStore} from '@reduxjs/toolkit';
import {
  configureHIDTransport,
  disconnectHIDDeviceForTesting,
  getHIDTransportDebugState,
  HID,
  registerHIDDeviceForTesting,
  resetHIDTransportForTesting,
} from '../src/shims/node-hid';
import {
  KeyboardAPI,
  shiftFrom16Bit,
  shiftTo16Bit,
} from '../src/utils/keyboard-api';
import {
  queryStateSync,
  resetStateSyncTagsForTesting,
  ERA_STATE_SYNC_SELECTOR,
} from '../src/utils/era-state-sync';
import {UISyncRequestType} from '../src/utils/ui-sync';
import {setEraAdvancedMetadataForTesting} from '../src/utils/era-advanced-metadata';
import devicesReducer, {
  markDeviceReady,
  selectDevice,
  updateConnectedDevices,
} from '../src/store/devicesSlice';
import keymapReducer, {
  getLoadProgress,
  loadKeymapFromDevice,
  replaceEncoderMap,
  setLayer,
  updateEncoderValue,
  updateKey,
} from '../src/store/keymapSlice';
import {saveKeymapSuccess} from '../src/store/keymapSlice';
import macrosReducer, {
  getExpressions,
  getIsMacrosReady,
  getMacroCount,
  loadMacroMetadata,
  loadMacros,
  loadMacrosSuccess,
  resetMacrosOnDevice,
  saveMacros,
} from '../src/store/macrosSlice';
import definitionsReducer, {
  getDefinitionSyncIdentity,
  loadCustomDefinitions,
  updateDefinitions,
  updateEraDefinitions,
  updateLayoutOption,
  updateLayoutOptions,
} from '../src/store/definitionsSlice';
import menusReducer, {
  getCustomMenuAvailabilityForDevice,
  getSelectedCustomMenuAvailability,
  getV3Menus,
  syncCustomMenuValues,
  completeCustomMenuRangeValueContinuous,
  completeCustomMenuValueContinuous,
  updateCustomMenuRangeValueContinuous,
  updateCustomMenuValue,
  updateCustomMenuValueContinuous,
  updateSelectedCustomMenuData,
  updateV3MenuData,
  rollbackCustomMenuData,
} from '../src/store/menusSlice';
import firmwareReducer from '../src/store/firmwareSlice';
import stateSyncReducer, {
  beginForegroundMutation,
  ensurePathSync,
  setConfigureVisible,
  setDocumentHidden,
  setDomainStatus,
} from '../src/store/stateSyncSlice';
import {commitStableKeymapCandidate} from '../src/store/stateSyncCandidateActions';
import {
  handleUISyncRequest,
  pollStateSync,
  probeStateSyncCapabilityForDevice,
  probeStateSyncForDevice,
  refreshAfterDefinitionChange,
  refreshAllDomains,
  refreshMacroDomain,
  refreshStateSyncDomain,
  syncPolling,
  stopStateSyncPollingForTesting,
  unloadCustomDefinitionWithRefresh,
} from '../src/store/stateSyncThunks';
import {keyColorsFromPerKeyRGB} from '../src/utils/use-color-painter';
import {importLayoutToDevice} from '../src/store/importLayoutThunks';
import {
  collectUniqueEncoderIds,
  collectMaxLedIndex,
} from '../src/utils/via-definition-keys';
import type {ConnectedDevice} from '../src/types/types';
import {
  completeContinuousHIDTransactionsForPath,
  hasContinuousHIDTransactionsForPath,
  resetContinuousHIDTransactionsForTesting,
} from '../src/utils/continuous-hid-transaction';

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

const makeV3Definition = (
  withMenu = false,
  extras?: {optionEncoder?: boolean; optionRgb?: boolean; shape?: string},
) => ({
  name: extras?.shape ? `TOMAK-${extras.shape}` : 'TOMAK',
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
        ei: extras?.optionEncoder ? undefined : 0,
        li: extras?.optionRgb ? undefined : 0,
      },
    ],
    labels: [['Layout', 'A', 'B']],
    width: 1,
    height: 1,
    optionKeys:
      extras?.optionEncoder || extras?.optionRgb
        ? {
            0: {
              1: [
                {
                  x: 1,
                  y: 0,
                  w: 1,
                  h: 1,
                  row: 0,
                  col: 1,
                  color: 'alpha',
                  d: false,
                  r: 0,
                  rx: 0,
                  ry: 0,
                  ei: extras?.optionEncoder ? 1 : undefined,
                  li: extras?.optionRgb ? 3 : undefined,
                },
              ],
            },
          }
        : {},
  },
  matrix: {rows: 1, cols: extras?.optionEncoder || extras?.optionRgb ? 2 : 1},
});

const installEraDefinition = (
  store: ReturnType<typeof makeStore>,
  definition = makeV3Definition(),
) =>
  store.dispatch(
    updateEraDefinitions({
      [TOMAK_VPID]: {v3: definition},
    } as any),
  );

class FakeStateSyncFirmware {
  revisions = {keymap: 1, macro: 1, config: 1};
  keymapValue = 1;
  macroText = 'A';
  layoutValue = 0;
  menuValue = 0;
  perKeyRGB: [number, number] = [10, 20];
  perKeyRGBMap: Record<number, [number, number]> = {};
  encoderValues: [number, number] = [100, 101];
  encoderValuesById: Record<number, [number, number]> = {};
  stateSyncReads = 0;
  keymapReads = 0;
  macroBufferReads = 0;
  layoutReads = 0;
  menuReads = 0;
  encoderReads = 0;
  customSetCount = 0;
  customSaveCount = 0;
  dropNextStateSync = false;
  malformNextStateSync = false;
  holdNextStateSync = false;
  holdAfterMacroBufferRead = 0;
  holdAfterKeymapRead = 0;
  holdAfterLayoutRead = 0;
  holdAfterMenuRead = 0;
  holdAfterEncoderRead = 0;
  holdNextMenuGet = false;
  holdNextMacroBuffer = false;
  changeConfigOnNextKeymapRead = false;
  churnKeymapReads = 0;
  churnEveryKeymapRead = false;
  rejectNextCustomSet = false;
  rejectNextCustomSave = false;
  holdNextCustomSet = false;
  rejectNextMacroPayload = false;
  rejectNextKeymapSet = false;
  macroClosed = false;
  macroVerificationMarkers: number[] = [];
  macroVerificationReadCount = 0;
  operationLog: string[] = [];
  customEvents: string[] = [];
  rejectNextEncoderSet = false;
  rejectNextLayoutSet = false;
  publishedConfigRuntime = false;
  heldStateSyncRequest?: Uint8Array;
  heldMenuGetRequest?: Uint8Array;
  heldMenuGetValue?: number;
  heldMacroBufferRequest?: Uint8Array;

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
        (this.holdAfterKeymapRead > 0 &&
          this.keymapReads >= this.holdAfterKeymapRead) ||
        (this.holdAfterMacroBufferRead > 0 &&
          this.macroBufferReads >= this.holdAfterMacroBufferRead) ||
        (this.holdAfterLayoutRead > 0 &&
          this.layoutReads >= this.holdAfterLayoutRead &&
          this.menuReads >= this.holdAfterMenuRead) ||
        (this.holdAfterEncoderRead > 0 &&
          this.encoderReads >= this.holdAfterEncoderRead);
      if (shouldHold) {
        this.holdNextStateSync = false;
        this.holdAfterKeymapRead = 0;
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
      if (this.churnEveryKeymapRead || this.churnKeymapReads > 0) {
        if (this.churnKeymapReads > 0) {
          this.churnKeymapReads--;
        }
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
      const encoderId = data[2];
      const pair = this.encoderValuesById[encoderId] ?? this.encoderValues;
      const value = pair[data[3] ? 1 : 0];
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
    if (data[0] === 0x15) {
      if (this.rejectNextEncoderSet) {
        this.rejectNextEncoderSet = false;
        throw new Error('rejected encoder SET');
      }
      const encoderId = data[2];
      const pair = [
        ...(this.encoderValuesById[encoderId] ?? this.encoderValues),
      ] as [number, number];
      const value = (data[4] << 8) | data[5];
      this.operationLog.push('encoder');
      pair[data[3] ? 1 : 0] = value;
      this.encoderValuesById[encoderId] = pair;
      if (encoderId === 0) {
        this.encoderValues = pair;
      }
      this.revisions.keymap++;
      this.device.emit(
        payload(0x15, data[1], data[2], data[3], data[4], data[5]),
      );
      return;
    }
    if (data[0] === 0x0d) {
      // One payload byte, its macro terminator, and the final completion marker.
      this.device.emit(payload(0x0d, 0x00, 0x03));
      return;
    }
    if (data[0] === 0x10) {
      this.operationLog.push('macro-reset');
      this.macroClosed = false;
      this.device.emit(payload(0x10));
      return;
    }
    if (data[0] === 0x0f) {
      const offset = (data[1] << 8) | data[2];
      const size = data[3];
      const markerWrite = offset === 2 && size === 1;
      if (this.rejectNextMacroPayload && !markerWrite) {
        this.rejectNextMacroPayload = false;
        throw new Error('rejected macro payload');
      }
      if (!markerWrite && offset === 0 && size > 0) {
        this.macroText = String.fromCharCode(data[4]);
      }
      if (markerWrite && data[4] === 0) {
        this.macroClosed = true;
        this.revisions.macro += 1;
      }
      this.operationLog.push(
        markerWrite ? (data[4] === 0 ? 'macro-close' : 'macro-open') : 'macro-payload',
      );
      this.device.emit(payload(...Array.from(data)));
      return;
    }
    if (data[0] === 0x0e) {
      this.macroBufferReads++;
      if (this.holdNextMacroBuffer) {
        this.holdNextMacroBuffer = false;
        this.heldMacroBufferRequest = data.slice();
        return;
      }
      const offset = (data[1] << 8) | data[2];
      const logicalBytes = [this.macroText.charCodeAt(0), 0, 0];
      const bytes = logicalBytes.slice(offset, offset + data[3]);
      if (
        this.macroClosed &&
        offset === 2 &&
        data[3] === 1 &&
        this.macroVerificationMarkers.length
      ) {
        bytes[0] =
          this.macroVerificationMarkers[
            Math.min(
              this.macroVerificationReadCount,
              this.macroVerificationMarkers.length - 1,
            )
          ];
        this.macroVerificationReadCount += 1;
      }
      this.device.emit(payload(0x0e, data[1], data[2], data[3], ...bytes));
      return;
    }
    if (data[0] === 0x13) {
      if (this.rejectNextKeymapSet) {
        this.rejectNextKeymapSet = false;
        throw new Error('rejected keymap SET');
      }
      this.operationLog.push('keymap');
      this.device.emit(payload(...Array.from(data)));
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
      if (this.holdNextMenuGet) {
        this.holdNextMenuGet = false;
        this.heldMenuGetRequest = data.slice();
        this.heldMenuGetValue = this.menuValue;
        return;
      }
      this.device.emit(payload(0x08, 0x01, 0x01, this.menuValue));
      return;
    }
    if (data[0] === 0x07 && data[1] === 0x01 && data[2] === 0x01) {
      if (this.rejectNextCustomSet) {
        this.rejectNextCustomSet = false;
        throw new Error('rejected SET');
      }
      this.customSetCount++;
      this.customEvents.push(`set:${data[3]}`);
      if (this.holdNextCustomSet) {
        this.holdNextCustomSet = false;
        return;
      }
      if (this.menuValue !== data[3]) {
        this.menuValue = data[3];
        this.revisions.config++;
        this.publishedConfigRuntime = true;
      }
      this.device.emit(payload(0x07, 0x01, 0x01, data[3]));
      return;
    }
    if (data[0] === 0x09) {
      if (this.rejectNextCustomSave) {
        this.rejectNextCustomSave = false;
        throw new Error('rejected SAVE');
      }
      this.customSaveCount++;
      this.customEvents.push(`save:${data[1]}`);
      this.publishedConfigRuntime = false;
      this.device.emit(payload(0x09, data[1]));
      return;
    }
    if (data[0] === 0x03) {
      if (this.rejectNextLayoutSet) {
        this.rejectNextLayoutSet = false;
        throw new Error('rejected layout SET');
      }
      this.layoutValue = data[5] ?? data[2];
      this.revisions.config++;
      this.device.emit(
        payload(0x03, data[1], data[2], data[3], data[4], data[5]),
      );
      return;
    }
    if (data[0] === 0x07 && data[1] === 0x00 && data[2] === 0x01) {
      if (this.rejectNextCustomSet) {
        this.rejectNextCustomSet = false;
        throw new Error('rejected SET');
      }
      const ledIndex = data[3];
      this.perKeyRGBMap[ledIndex] = [data[5], data[6]];
      if (ledIndex === 0) {
        this.perKeyRGB = [data[5], data[6]];
      }
      this.revisions.config++;
      this.publishedConfigRuntime = true;
      this.device.emit(
        payload(0x07, 0x00, 0x01, data[3], data[4], data[5], data[6]),
      );
      return;
    }
    if (data[0] === 0x08 && data[1] === 0x00 && data[2] === 0x01) {
      const color = this.perKeyRGBMap[data[3]] ?? this.perKeyRGB ?? [10, 20];
      this.device.emit(payload(0x08, 0x00, 0x01, data[3], data[4], ...color));
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

  releaseHeldMenuGet() {
    if (!this.heldMenuGetRequest) {
      throw new Error('No custom menu GET is held');
    }
    const request = this.heldMenuGetRequest;
    const value = this.heldMenuGetValue ?? this.menuValue;
    this.heldMenuGetRequest = undefined;
    this.heldMenuGetValue = undefined;
    this.device.emit(payload(0x08, 0x01, 0x01, value));
    void request;
  }

  releaseHeldMacroBuffer() {
    if (!this.heldMacroBufferRequest) {
      throw new Error('No macro buffer GET is held');
    }
    const request = this.heldMacroBufferRequest;
    this.heldMacroBufferRequest = undefined;
    const bytes = new Array(28).fill(0);
    bytes[0] = this.macroText.charCodeAt(0);
    this.device.emit(
      payload(0x0e, request[1], request[2], request[3], ...bytes),
    );
  }
}

const prepareSelectedStateSyncDevice = async (
  path: string,
  options?: {
    withMenu?: boolean;
    revisions?: Partial<FakeStateSyncFirmware['revisions']>;
    definitionExtras?: {
      optionEncoder?: boolean;
      optionRgb?: boolean;
      shape?: string;
    };
  },
) => {
  const {device} = await connectFake(path);
  const firmware = new FakeStateSyncFirmware(device);
  firmware.revisions = {...firmware.revisions, ...options?.revisions};
  device.onSend = firmware.onSend;
  const store = makeStore();
  const connected = makeConnectedDevice(path, TOMAK_VPID);
  installEraDefinition(
    store,
    makeV3Definition(options?.withMenu, options?.definitionExtras),
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
  resetContinuousHIDTransactionsForTesting();
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
  resetContinuousHIDTransactionsForTesting();
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

  test('an official definition with an ERA VPID is not treated as the ERA overlay', async () => {
    const {device} = await connectFake('official-same-vpid');
    const store = makeStore();
    const connected = makeConnectedDevice('official-same-vpid', TOMAK_VPID);
    store.dispatch(
      updateDefinitions({
        [TOMAK_VPID]: {v3: makeV3Definition()},
      } as any),
    );
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
    installEraDefinition(store);
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
    expect(
      getCustomMenuAvailabilityForDevice(
        store.getState() as any,
        connected,
      ),
    ).toBe('checking');
  });

  test('unhandled 0xFF is unverified, keeps raw menus, blocks Custom I/O, and does not retry', async () => {
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
    installEraDefinition(store, makeV3Definition(true));
    store.dispatch(updateConnectedDevices({[connected.path]: connected}));
    const generation = new KeyboardAPI(
      connected.path,
    ).getConnectionGeneration();
    store.dispatch(
      selectDevice({device: connected, connectionGeneration: generation}),
    );
    await (store.dispatch as any)(probeStateSyncForDevice(connected));
    await (store.dispatch as any)(probeStateSyncForDevice(connected));
    await (store.dispatch as any)(updateV3MenuData(connected));
    await (store.dispatch as any)(
      syncCustomMenuValues(connected.path, generation),
    );
    await (store.dispatch as any)(
      updateCustomMenuValue('id_test_value', 1, 1, 9),
    );
    expect(
      device.sentReports.filter(
        ({data}) => data[0] === 0x02 && data[1] === ERA_STATE_SYNC_SELECTOR,
      ),
    ).toHaveLength(1);
    expect(store.getState().stateSync.byPath[connected.path]?.capability).toBe(
      'unverified',
    );
    expect(getSelectedCustomMenuAvailability(store.getState() as any)).toBe(
      'unverified',
    );
    expect(getV3Menus(store.getState() as any).map((menu) => menu.label)).toEqual(
      ['CONFIG'],
    );
    expect(
      device.sentReports.filter(({data}) =>
        [0x07, 0x08, 0x09].includes(data[0]),
      ),
    ).toHaveLength(0);
  });

  test('initial timeout becomes unverified once without poisoning ordinary VIA traffic', async () => {
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
    installEraDefinition(store);
    store.dispatch(updateConnectedDevices({[connected.path]: connected}));

    await (store.dispatch as any)(probeStateSyncForDevice(connected));
    await (store.dispatch as any)(probeStateSyncForDevice(connected));

    expect(
      device.sentReports.filter(
        ({data}) => data[0] === 0x02 && data[1] === ERA_STATE_SYNC_SELECTOR,
      ),
    ).toHaveLength(1);
    expect(store.getState().stateSync.byPath[connected.path]?.capability).toBe(
      'unverified',
    );
    expect(await new KeyboardAPI(connected.path).getProtocolVersion()).toBe(12);
  });

  test('initial malformed envelope becomes unverified once without an error path', async () => {
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
    installEraDefinition(store);
    store.dispatch(updateConnectedDevices({[connected.path]: connected}));

    await (store.dispatch as any)(probeStateSyncForDevice(connected));
    await (store.dispatch as any)(probeStateSyncForDevice(connected));

    expect(
      device.sentReports.filter(
        ({data}) => data[0] === 0x02 && data[1] === ERA_STATE_SYNC_SELECTOR,
      ),
    ).toHaveLength(1);
    expect(store.getState().stateSync.byPath[connected.path]?.capability).toBe(
      'unverified',
    );
  });

  test('an initial wrong-tag envelope times out into unverified', async () => {
    configureHIDTransport({responseTimeoutMs: 15});
    const {device} = await connectFake('old-wrong-tag');
    device.onSend = (data) => {
      if (data[0] === 0x02 && data[1] === ERA_STATE_SYNC_SELECTOR) {
        const wrongTagRequest = data.slice();
        wrongTagRequest[5] = (wrongTagRequest[5] + 1) & 0xff;
        emitEnvelope(device, wrongTagRequest, {
          keymap: 1,
          macro: 1,
          config: 1,
        });
      }
    };
    const store = makeStore();
    const connected = makeConnectedDevice('old-wrong-tag', TOMAK_VPID);
    installEraDefinition(store);
    store.dispatch(updateConnectedDevices({[connected.path]: connected}));

    await (store.dispatch as any)(probeStateSyncForDevice(connected));

    expect(store.getState().stateSync.byPath[connected.path]?.capability).toBe(
      'unverified',
    );
    expect(
      device.sentReports.filter(
        ({data}) => data[0] === 0x02 && data[1] === ERA_STATE_SYNC_SELECTOR,
      ),
    ).toHaveLength(1);
  });

  test('reconnect gives an unverified ERA device one fresh capability probe', async () => {
    const {device: oldDevice} = await connectFake('old-reconnect');
    oldDevice.onSend = (data) => {
      if (data[0] === 0x02 && data[1] === ERA_STATE_SYNC_SELECTOR) {
        const response = data.slice();
        response[0] = 0xff;
        oldDevice.emit(response);
      }
    };
    const store = makeStore();
    const connected = makeConnectedDevice('old-reconnect', TOMAK_VPID);
    installEraDefinition(store);
    store.dispatch(updateConnectedDevices({[connected.path]: connected}));

    await (store.dispatch as any)(probeStateSyncForDevice(connected));
    const firstGeneration = new KeyboardAPI(
      connected.path,
    ).getConnectionGeneration();
    expect(store.getState().stateSync.byPath[connected.path]).toMatchObject({
      capability: 'unverified',
      generation: firstGeneration,
    });

    const replacementDevice = new FakeHIDDevice();
    replacementDevice.onSend = (data) => {
      if (data[0] === 0x02 && data[1] === ERA_STATE_SYNC_SELECTOR) {
        emitEnvelope(replacementDevice, data, {
          keymap: 2,
          macro: 2,
          config: 2,
        });
      }
    };
    registerHIDDeviceForTesting(
      connected.path,
      asHIDDevice(replacementDevice),
    );
    const replacementHID = new HID.HID(connected.path);
    await replacementHID.openPromise;

    await (store.dispatch as any)(probeStateSyncForDevice(connected));

    const replacementGeneration = new KeyboardAPI(
      connected.path,
    ).getConnectionGeneration();
    expect(replacementGeneration).not.toBe(firstGeneration);
    expect(store.getState().stateSync.byPath[connected.path]).toMatchObject({
      capability: 'capable',
      generation: replacementGeneration,
    });
    expect(
      replacementDevice.sentReports.filter(
        ({data}) => data[0] === 0x02 && data[1] === ERA_STATE_SYNC_SELECTOR,
      ),
    ).toHaveLength(1);
  });
});

describe('progressive State Sync initial load', () => {
  test('opens on a stable keymap, prefetches CONFIG, and keeps the stock macro buffer lazy', async () => {
    const {device} = await connectFake('progressive-initial');
    const firmware = new FakeStateSyncFirmware(device);
    device.onSend = firmware.onSend;
    const store = makeStore();
    const dispatch = store.dispatch as any;
    const connected = makeConnectedDevice('progressive-initial', TOMAK_VPID);
    installEraDefinition(store, makeV3Definition(true));
    dispatch(updateConnectedDevices({[connected.path]: connected}));
    const generation = new KeyboardAPI(
      connected.path,
    ).getConnectionGeneration();
    dispatch(selectDevice({device: connected, connectionGeneration: generation}));

    expect(await dispatch(probeStateSyncCapabilityForDevice(connected))).toBe(
      true,
    );
    await dispatch(loadMacroMetadata(connected));
    expect(getMacroCount(store.getState())).toBe(1);
    expect(getIsMacrosReady(store.getState())).toBe(false);
    expect(firmware.macroBufferReads).toBe(0);

    expect(
      await dispatch(
        refreshStateSyncDomain(connected, 'keymap', {allowBeforeReady: true}),
      ),
    ).toBe(true);
    expect(getLoadProgress(store.getState())).toBe(1);
    expect(firmware.keymapReads).toBeGreaterThan(0);
    expect(firmware.layoutReads).toBe(0);
    expect(firmware.menuReads).toBe(0);
    expect(firmware.macroBufferReads).toBe(0);

    dispatch(
      markDeviceReady({
        devicePath: connected.path,
        connectionGeneration: generation,
        selectionGeneration: store.getState().devices.selectionGeneration,
      }),
    );
    dispatch(setConfigureVisible(true));
    await dispatch(pollStateSync());

    expect(firmware.layoutReads).toBeGreaterThan(0);
    expect(firmware.menuReads).toBeGreaterThan(0);
    expect(firmware.macroBufferReads).toBe(0);
    expect(getSelectedCustomMenuAvailability(store.getState() as any)).toBe(
      'available',
    );

    expect(await dispatch(refreshMacroDomain(connected))).toBe(true);
    expect(firmware.macroBufferReads).toBeGreaterThan(0);
    expect(getIsMacrosReady(store.getState())).toBe(true);
    expect(getExpressions(store.getState())).toEqual(['A']);
  });
});

describe('continuous custom controls', () => {
  test('range changes deduplicate identical values and SAVE once on completion', async () => {
    const {store, connected, firmware, generation} =
      await prepareSelectedStateSyncDevice('continuous-range', {withMenu: true});
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.customEvents = [];

    const changes = [
      dispatch(updateCustomMenuRangeValueContinuous('id_test_value', 10)),
      dispatch(updateCustomMenuRangeValueContinuous('id_test_value', 20)),
      dispatch(updateCustomMenuRangeValueContinuous('id_test_value', 20)),
      dispatch(updateCustomMenuRangeValueContinuous('id_test_value', 30)),
    ];
    await Promise.all(changes);

    expect(firmware.customEvents).toEqual(['set:10', 'set:20', 'set:30']);
    expect(hasContinuousHIDTransactionsForPath(connected.path, generation)).toBe(
      true,
    );
    await dispatch(completeCustomMenuRangeValueContinuous('id_test_value'));

    expect(firmware.customEvents).toEqual([
      'set:10',
      'set:20',
      'set:30',
      'save:1',
    ]);
    expect(
      store.getState().stateSync.byPath[connected.path]?.config,
    ).toMatchObject({mutationEpoch: 1, status: 'fresh'});
  });

  test('color changes use the same interaction owner and SAVE once', async () => {
    const {store, connected, firmware} = await prepareSelectedStateSyncDevice(
      'continuous-color',
      {withMenu: true},
    );
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.customEvents = [];

    await Promise.all([
      dispatch(
        updateCustomMenuValueContinuous('id_test_value', 1, 1, 40),
      ),
      dispatch(
        updateCustomMenuValueContinuous('id_test_value', 1, 1, 80),
      ),
      dispatch(
        updateCustomMenuValueContinuous('id_test_value', 1, 1, 80),
      ),
    ]);
    await dispatch(completeCustomMenuValueContinuous('id_test_value'));

    expect(firmware.customEvents).toEqual(['set:40', 'set:80', 'save:1']);
  });

  test('disconnect rejects a pending interaction without silently sending SAVE', async () => {
    const {store, connected, firmware, generation} =
      await prepareSelectedStateSyncDevice('continuous-disconnect', {
        withMenu: true,
      });
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.customEvents = [];
    firmware.holdNextCustomSet = true;

    const changing = dispatch(
      updateCustomMenuRangeValueContinuous('id_test_value', 55),
    );
    await waitUntil(() => firmware.customSetCount === 1, 800);
    disconnectHIDDeviceForTesting(connected.path);
    await changing;
    await dispatch(completeCustomMenuRangeValueContinuous('id_test_value'));

    expect(firmware.customEvents).toEqual(['set:55']);
    expect(firmware.customSaveCount).toBe(0);
    expect(store.getState().stateSync.byPath[connected.path]).toMatchObject({
      generation,
      config: {mutationEpoch: 1, status: 'dirty'},
    });
    expect(hasContinuousHIDTransactionsForPath(connected.path, generation)).toBe(
      false,
    );
  });

  test('path-level lifecycle flush preserves a pending SAVE outside the component', async () => {
    const {store, connected, firmware, generation} =
      await prepareSelectedStateSyncDevice('continuous-path-flush', {
        withMenu: true,
      });
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.customEvents = [];

    await dispatch(
      updateCustomMenuRangeValueContinuous('id_test_value', 66),
    );
    await completeContinuousHIDTransactionsForPath(
      connected.path,
      generation,
    );

    expect(firmware.customEvents).toEqual(['set:66', 'save:1']);
  });

  test('discrete controls still SET and SAVE immediately', async () => {
    const {store, connected, firmware} = await prepareSelectedStateSyncDevice(
      'continuous-discrete',
      {withMenu: true},
    );
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.customEvents = [];

    await dispatch(updateCustomMenuValue('id_test_value', 1, 1, 77));

    expect(firmware.customEvents).toEqual(['set:77', 'save:1']);
  });

  test('a rebooting discrete control stops at disconnect and closes its old-generation session', async () => {
    const {store, connected, firmware, generation} =
      await prepareSelectedStateSyncDevice('discrete-reboot', {
        withMenu: true,
      });
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.customEvents = [];
    const normalSend = firmware.onSend;
    let rebootOnSet = true;
    firmware.device.onSend = (data) => {
      if (
        rebootOnSet &&
        data[0] === 0x07 &&
        data[1] === 0x01 &&
        data[2] === 0x01
      ) {
        rebootOnSet = false;
        firmware.customSetCount++;
        firmware.customEvents.push(`set:${data[3]}`);
        disconnectHIDDeviceForTesting(connected.path);
        return;
      }
      return normalSend(data);
    };

    expect(
      await dispatch(updateCustomMenuValue('id_test_value', 1, 1, 99)),
    ).toBe(false);

    expect(firmware.customEvents).toEqual(['set:99']);
    expect(firmware.customSaveCount).toBe(0);
    expect(store.getState().stateSync.byPath[connected.path]).toMatchObject({
      generation,
      config: {
        status: 'dirty',
        foregroundWriteDepth: 0,
      },
    });
  });

  test('a local write session keeps rapid discrete changes live through reconciliation', async () => {
    const {store, connected, firmware} = await prepareSelectedStateSyncDevice(
      'discrete-write-session',
      {withMenu: true},
    );
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.customEvents = [];
    firmware.holdAfterLayoutRead = firmware.layoutReads + 1;
    firmware.holdAfterMenuRead = firmware.menuReads + 1;

    const first = dispatch(updateCustomMenuValue('id_test_value', 1, 1, 10));
    await waitUntil(() => firmware.heldStateSyncRequest !== undefined, 800);
    expect(getSelectedCustomMenuAvailability(store.getState() as any)).toBe(
      'available',
    );

    const second = dispatch(updateCustomMenuValue('id_test_value', 1, 1, 20));
    expect(
      store.getState().menus.customMenuDataMap[connected.path]
        ?.id_test_value?.[0],
    ).toBe(20);
    expect(
      store.getState().stateSync.byPath[connected.path]?.config
        .foregroundWriteDepth,
    ).toBe(2);

    firmware.releaseHeldStateSync();
    await Promise.all([first, second]);

    expect(firmware.customEvents).toEqual([
      'set:10',
      'save:1',
      'set:20',
      'save:1',
    ]);
    expect(
      store.getState().menus.customMenuDataMap[connected.path]
        ?.id_test_value?.[0],
    ).toBe(20);
    expect(store.getState().stateSync.byPath[connected.path]?.config).toMatchObject(
      {
        status: 'fresh',
        foregroundWriteDepth: 0,
        acceptedRevision: firmware.revisions.config,
      },
    );
  });

  test('an equal authoritative readback preserves the optimistic menu object', async () => {
    const {store, connected} = await prepareSelectedStateSyncDevice(
      'discrete-structural-sharing',
      {withMenu: true},
    );
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));

    const writing = dispatch(
      updateCustomMenuValue('id_test_value', 1, 1, 77),
    );
    const optimisticMenuData =
      store.getState().menus.customMenuDataMap[connected.path];
    await writing;

    expect(store.getState().menus.customMenuDataMap[connected.path]).toBe(
      optimisticMenuData,
    );
  });

  test('a failed earlier write cannot roll back a later optimistic value', async () => {
    const {store, connected} = await prepareSelectedStateSyncDevice(
      'discrete-conditional-rollback',
      {withMenu: true},
    );
    store.dispatch(
      updateSelectedCustomMenuData({
        devicePath: connected.path,
        menuData: {id_test_value: [20]},
      }),
    );
    store.dispatch(
      rollbackCustomMenuData({
        devicePath: connected.path,
        expected: {id_test_value: [10]},
        previous: {id_test_value: [0]},
      }),
    );

    expect(
      store.getState().menus.customMenuDataMap[connected.path]
        ?.id_test_value?.[0],
    ).toBe(20);
  });

  test('a capable device with dirty CONFIG cannot start another mutation', async () => {
    const {store, connected, firmware, generation} =
      await prepareSelectedStateSyncDevice('config-authority-dirty', {
        withMenu: true,
      });
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    dispatch(
      setDomainStatus({
        path: connected.path,
        generation,
        domain: 'config',
        status: 'dirty',
      }),
    );
    firmware.customEvents = [];

    expect(getSelectedCustomMenuAvailability(store.getState() as any)).toBe(
      'reconciling',
    );

    expect(
      await dispatch(updateCustomMenuValue('id_test_value', 1, 1, 88)),
    ).toBe(false);
    expect(firmware.customEvents).toEqual([]);
  });
});

describe('incoming 0x16 routing', () => {
  const allCustomValues = {type: UISyncRequestType.CUSTOM_MENU_ALL} as const;

  test('a capable opt-in dirties CONFIG and refreshes it through a revision bracket', async () => {
    const {store, connected, firmware} = await prepareSelectedStateSyncDevice(
      'sync-request-capable',
      {withMenu: true},
    );
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    const menuReadsBefore = firmware.menuReads;
    firmware.menuValue = 23;
    firmware.revisions.config += 1;
    firmware.holdNextStateSync = true;

    const routing = dispatch(
      handleUISyncRequest({
        devicePath: connected.path,
        connectionGeneration: new KeyboardAPI(
          connected.path,
        ).getConnectionGeneration(),
        request: allCustomValues,
      }),
    );
    await waitUntil(() => firmware.heldStateSyncRequest !== undefined, 800);
    expect(
      store.getState().stateSync.byPath[connected.path]?.config.status,
    ).toBe('dirty');
    expect(firmware.menuReads).toBe(menuReadsBefore);
    firmware.releaseHeldStateSync();
    await routing;

    expect(firmware.menuReads).toBe(menuReadsBefore + 1);
    expect(
      store.getState().menus.customMenuDataMap[connected.path]
        ?.id_test_value?.[0],
    ).toBe(23);
    expect(
      store.getState().stateSync.byPath[connected.path]?.config,
    ).toMatchObject({
      status: 'fresh',
      acceptedRevision: firmware.revisions.config,
      observedRevision: firmware.revisions.config,
    });
    expect(
      firmware.device.sentReports.some(({data}) => data[0] === 0x16),
    ).toBe(false);
  });

  test('an ordinary device keeps the legacy targeted/full Custom GET path', async () => {
    const {device} = await connectFake('sync-request-ordinary');
    const firmware = new FakeStateSyncFirmware(device);
    firmware.menuValue = 17;
    device.onSend = firmware.onSend;
    const store = makeStore();
    const connected = makeConnectedDevice(
      'sync-request-ordinary',
      ORDINARY_VPID,
    );
    store.dispatch(
      updateDefinitions({
        [ORDINARY_VPID]: {
          v3: {...makeV3Definition(true), vendorProductId: ORDINARY_VPID},
        },
      } as any),
    );
    store.dispatch(updateConnectedDevices({[connected.path]: connected}));
    const generation = new KeyboardAPI(
      connected.path,
    ).getConnectionGeneration();

    await (store.dispatch as any)(
      handleUISyncRequest({
        devicePath: connected.path,
        connectionGeneration: generation,
        request: allCustomValues,
      }),
    );

    expect(firmware.menuReads).toBe(1);
    expect(firmware.stateSyncReads).toBe(0);
    expect(
      store.getState().menus.customMenuDataMap[connected.path]
        ?.id_test_value?.[0],
    ).toBe(17);
  });

  test('an unverified opt-in treats 0x16 as invalidation without advanced I/O', async () => {
    const {store, connected, firmware} = await prepareSelectedStateSyncDevice(
      'sync-request-unverified',
      {withMenu: true},
    );
    firmware.device.onSend = (data) => {
      if (data[0] === 0x02 && data[1] === ERA_STATE_SYNC_SELECTOR) {
        const response = data.slice();
        response[0] = 0xff;
        firmware.device.emit(response);
        return;
      }
      return firmware.onSend(data);
    };
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    const reportsBefore = firmware.device.sentReports.length;

    await dispatch(
      handleUISyncRequest({
        devicePath: connected.path,
        connectionGeneration: new KeyboardAPI(
          connected.path,
        ).getConnectionGeneration(),
        request: allCustomValues,
      }),
    );

    expect(firmware.device.sentReports).toHaveLength(reportsBefore);
    expect(firmware.menuReads).toBe(0);
    expect(firmware.customSetCount).toBe(0);
    expect(firmware.customSaveCount).toBe(0);
    expect(
      store.getState().stateSync.byPath[connected.path],
    ).toMatchObject({capability: 'unverified', config: {status: 'dirty'}});
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
    await api.setCustomMenuValue(15, 5, ...shiftFrom16Bit(137));
    await api.commitCustomMenu(15);
    const response = await api.getCustomMenuValue([15, 5]);
    expect(shiftTo16Bit([response[1], response[2]])).toBe(137);
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
    installEraDefinition(store, {
      name: 'TOMAK',
      vendorProductId: TOMAK_VPID,
      firmwareVersion: 0,
      menus: [],
      layouts: {keys: [], labels: []},
      matrix: {rows: 1, cols: 1},
    } as any);
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
  test('a foreground reservation blocks State Sync on the same path', async () => {
    const {store, connected, firmware, generation} =
      await prepareSelectedStateSyncDevice('foreground-blocks-state-sync');
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.revisions.keymap += 1;
    dispatch(setConfigureVisible(true));

    let releaseForeground = () => undefined;
    const foregroundGate = new Promise<void>((resolve) => {
      releaseForeground = resolve;
    });
    const api = new KeyboardAPI(connected.path);
    const foreground = api.withPathReservation(
      generation,
      Symbol('foreground-blocker'),
      async () => foregroundGate,
    );
    await waitUntil(
      () =>
        getHIDTransportDebugState(connected.path)?.hasActiveReservation ===
        true,
      800,
    );
    const stateSyncReadsBefore = firmware.stateSyncReads;
    const polling = dispatch(pollStateSync());
    await waitUntil(
      () =>
        (getHIDTransportDebugState(connected.path)?.commandQueueDepth ?? 0) > 0,
      800,
    );
    expect(firmware.stateSyncReads).toBe(stateSyncReadsBefore);

    releaseForeground();
    await Promise.all([foreground, polling]);
    expect(firmware.stateSyncReads).toBeGreaterThan(stateSyncReadsBefore);
  });

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
    expect(
      getSelectedCustomMenuAvailability(store.getState() as any),
    ).toBe('available');
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

  test('a failed macro payload never commits optimistic Redux state or closes the marker', async () => {
    const {store, connected, firmware} =
      await prepareSelectedStateSyncDevice('macro-save-failure');
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    const beforeAst = store.getState().macros.ast;
    const reportsBefore = firmware.device.sentReports.length;
    firmware.rejectNextMacroPayload = true;

    await expect(dispatch(saveMacros(connected, ['B']))).rejects.toThrow(
      'rejected macro payload',
    );

    expect(store.getState().macros.ast).toEqual(beforeAst);
    expect(
      store.getState().stateSync.byPath[connected.path]?.macro,
    ).toMatchObject({status: 'dirty', mutationEpoch: 1});
    const markerValues = firmware.device.sentReports
      .slice(reportsBefore)
      .filter(({data}) => {
        const offset = (data[1] << 8) | data[2];
        return data[0] === 0x0f && offset === 2 && data[3] === 1;
      })
      .map(({data}) => data[4]);
    expect(markerValues).toEqual([0xff]);
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

  test('a CONFIG mutation epoch rejects an in-flight candidate before the queued SET runs', async () => {
    const {store, connected, firmware} = await prepareSelectedStateSyncDevice(
      'config-set-interleave',
      {withMenu: true},
    );
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.revisions.config += 1;
    firmware.holdNextMenuGet = true;
    dispatch(setConfigureVisible(true));
    const polling = dispatch(pollStateSync());
    await waitUntil(() => firmware.heldMenuGetRequest !== undefined, 800);
    dispatch(
      beginForegroundMutation({
        path: connected.path,
        generation: new KeyboardAPI(connected.path).getConnectionGeneration(),
        domains: ['config'],
      }),
    );
    const api = new KeyboardAPI(connected.path);
    const generation = api.getConnectionGeneration();
    const owner = Symbol('already-authorized-config-interaction');
    const setPromise = api.withPathReservation(
      generation,
      owner,
      async (reservedApi) => {
        await reservedApi.setCustomMenuValue(1, 1, 9);
        await reservedApi.commitCustomMenu(1);
      },
    );
    await waitUntil(
      () =>
        (getHIDTransportDebugState(connected.path)?.commandQueueDepth ?? 0) > 0,
      800,
    );
    expect(firmware.customSetCount).toBe(0);
    firmware.releaseHeldMenuGet();
    await polling;
    await setPromise;
    expect(firmware.customSetCount).toBe(1);
    expect(firmware.menuValue).toBe(9);
    expect(
      store.getState().menus.customMenuDataMap[connected.path]
        ?.id_test_value?.[0],
    ).toBe(9);
  });

  test('a KEYMAP mutation epoch rejects a pre-mutation candidate', async () => {
    const {store, connected, firmware, generation} =
      await prepareSelectedStateSyncDevice('keymap-mutation-epoch');
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    dispatch(
      setDomainStatus({
        path: connected.path,
        generation,
        domain: 'keymap',
        status: 'dirty',
      }),
    );
    dispatch(setConfigureVisible(true));
    firmware.holdAfterKeymapRead = firmware.keymapReads + 1;
    const polling = dispatch(pollStateSync());
    await waitUntil(() => firmware.heldStateSyncRequest !== undefined, 800);
    dispatch(
      beginForegroundMutation({
        path: connected.path,
        generation,
        domains: ['keymap'],
      }),
    );
    const api = new KeyboardAPI(connected.path);
    const owner = Symbol('keymap-foreground');
    const foreground = api.withPathReservation(generation, owner, (reserved) =>
      reserved.setKey(0, 0, 0, 9),
    );
    firmware.releaseHeldStateSync();
    await Promise.all([polling, foreground]);

    expect(
      store.getState().keymap.rawDeviceMap[connected.path][0].keymap,
    ).toEqual([9]);
    expect(
      store.getState().stateSync.byPath[connected.path]?.keymap,
    ).toMatchObject({
      status: 'fresh',
      mutationEpoch: 1,
      acceptedRevision: firmware.revisions.keymap,
    });
  });

  test('a MACRO mutation epoch rejects a pre-mutation candidate', async () => {
    const {store, connected, firmware, generation} =
      await prepareSelectedStateSyncDevice('macro-mutation-epoch');
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    dispatch(
      setDomainStatus({
        path: connected.path,
        generation,
        domain: 'macro',
        status: 'dirty',
      }),
    );
    dispatch(setConfigureVisible(true));
    firmware.holdAfterMacroBufferRead = firmware.macroBufferReads + 1;
    const polling = dispatch(pollStateSync());
    await waitUntil(() => firmware.heldStateSyncRequest !== undefined, 800);
    dispatch(
      beginForegroundMutation({
        path: connected.path,
        generation,
        domains: ['macro'],
      }),
    );
    const api = new KeyboardAPI(connected.path);
    const owner = Symbol('macro-foreground');
    const foreground = api.withPathReservation(generation, owner, (reserved) =>
      reserved.setMacroBytes([66, 0]),
    );
    firmware.releaseHeldStateSync();
    await Promise.all([polling, foreground]);

    expect(getExpressions(store.getState() as any)).toEqual(['B']);
    expect(
      store.getState().stateSync.byPath[connected.path]?.macro,
    ).toMatchObject({
      status: 'fresh',
      mutationEpoch: 1,
      acceptedRevision: firmware.revisions.macro,
    });
  });

  test('standalone macro RESET advances the epoch without writing a marker', async () => {
    const {store, connected, firmware} =
      await prepareSelectedStateSyncDevice('macro-reset-standalone');
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    const reportsBefore = firmware.device.sentReports.length;

    await dispatch(resetMacrosOnDevice());

    const mutationReports = firmware.device.sentReports
      .slice(reportsBefore)
      .filter(({data}) => [0x0f, 0x10].includes(data[0]));
    expect(mutationReports.map(({data}) => data[0])).toEqual([0x10]);
    expect(
      store.getState().stateSync.byPath[connected.path]?.macro.mutationEpoch,
    ).toBe(1);
  });

  test('no-op SET does not raise CONFIG revision and SAVE of a published SET raises it once', async () => {
    const {store, connected, firmware} = await prepareSelectedStateSyncDevice(
      'config-set-save-once',
      {withMenu: true},
    );
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    const before = firmware.revisions.config;
    await dispatch(updateCustomMenuValue('id_test_value', 1, 1, 0));
    expect(firmware.revisions.config).toBe(before);
    await dispatch(updateCustomMenuValue('id_test_value', 1, 1, 11));
    expect(firmware.revisions.config).toBe(before + 1);
    expect(firmware.customSaveCount).toBe(2);
  });

  test('rejected SET rolls back menu cache and leaves CONFIG dirty', async () => {
    const {store, connected, firmware} = await prepareSelectedStateSyncDevice(
      'rejected-set',
      {withMenu: true},
    );
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.rejectNextCustomSet = true;
    await dispatch(updateCustomMenuValue('id_test_value', 1, 1, 9));
    expect(
      store.getState().menus.customMenuDataMap[connected.path]
        ?.id_test_value?.[0],
    ).toBe(0);
    expect(
      store.getState().stateSync.byPath[connected.path]?.config.status,
    ).toBe('dirty');
    expect(
      store.getState().stateSync.byPath[connected.path]?.config.mutationEpoch,
    ).toBe(1);
  });

  test('SET success and SAVE failure keeps CONFIG dirty for readback', async () => {
    const {store, connected, firmware} = await prepareSelectedStateSyncDevice(
      'set-ok-save-fail',
      {withMenu: true},
    );
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.rejectNextCustomSave = true;
    await dispatch(updateCustomMenuValue('id_test_value', 1, 1, 9));
    expect(firmware.menuValue).toBe(9);
    expect(
      store.getState().menus.customMenuDataMap[connected.path]
        ?.id_test_value?.[0],
    ).toBe(9);
    expect(
      store.getState().stateSync.byPath[connected.path]?.config.status,
    ).toBe('dirty');
  });

  test('rejected layout SET does not keep the intended option as current', async () => {
    const {store, connected, firmware} =
      await prepareSelectedStateSyncDevice('rejected-layout');
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.rejectNextLayoutSet = true;
    await dispatch(updateLayoutOption(0, 1));
    expect(
      store.getState().definitions.layoutOptionsMap[connected.path],
    ).toEqual([0]);
    expect(
      store.getState().stateSync.byPath[connected.path]?.config.status,
    ).toBe('dirty');
    expect(
      store.getState().stateSync.byPath[connected.path]?.config.mutationEpoch,
    ).toBe(1);
  });

  test('definition replace while a domain read is pending discards the old candidate', async () => {
    const {store, connected, firmware} = await prepareSelectedStateSyncDevice(
      'definition-replace',
      {withMenu: true},
    );
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.revisions.config += 1;
    firmware.holdNextMenuGet = true;
    dispatch(setConfigureVisible(true));
    const polling = dispatch(pollStateSync());
    await waitUntil(() => firmware.heldMenuGetRequest !== undefined, 800);
    dispatch(
      updateEraDefinitions({
        [TOMAK_VPID]: {
          v3: makeV3Definition(true, {shape: 'replaced'}) as any,
        },
      } as any),
    );
    await dispatch(refreshAfterDefinitionChange(TOMAK_VPID));
    firmware.releaseHeldMenuGet();
    await polling;
    expect(
      store.getState().definitions.eraDefinitions[TOMAK_VPID]?.v3?.name,
    ).toBe('TOMAK-replaced');
    expect(
      store.getState().stateSync.byPath[connected.path]?.config.status,
    ).not.toBe('fresh');
  });

  test('upload replace/unload cannot invalidate or replace an ERA overlay', async () => {
    const {store, connected, firmware} = await prepareSelectedStateSyncDevice(
      'definition-unload',
      {withMenu: true},
    );
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    const identityBefore = getDefinitionSyncIdentity(
      store.getState() as any,
      connected,
    );
    const keymapReadsBeforeUpload = firmware.keymapReads;
    dispatch(
      loadCustomDefinitions({
        definitions: [makeV3Definition(true, {shape: 'draft'}) as any],
        version: 'v3',
      }),
    );
    expect(getDefinitionSyncIdentity(store.getState() as any, connected)).toBe(
      identityBefore,
    );
    dispatch(
      loadCustomDefinitions({
        definitions: [makeV3Definition(true, {shape: 'replaced'}) as any],
        version: 'v3',
      }),
    );
    expect(getDefinitionSyncIdentity(store.getState() as any, connected)).toBe(
      identityBefore,
    );
    await dispatch(
      unloadCustomDefinitionWithRefresh({
        id: TOMAK_VPID,
        version: 'v3',
      }),
    );
    expect(getDefinitionSyncIdentity(store.getState() as any, connected)).toBe(
      identityBefore,
    );
    expect(firmware.keymapReads).toBe(keymapReadsBeforeUpload);
    expect(
      store.getState().definitions.eraDefinitions[TOMAK_VPID]?.v3?.name,
    ).toBe('TOMAK');
  });

  test('optionKeys-only encoder and per-key RGB are included in candidates', async () => {
    const encoderDef = makeV3Definition(true, {optionEncoder: true});
    const rgbDef = makeV3Definition(true, {optionRgb: true});
    expect(collectUniqueEncoderIds(encoderDef)).toEqual([1]);
    expect(collectMaxLedIndex(rgbDef)).toBe(3);
    const baseDef = makeV3Definition(true);
    expect(collectUniqueEncoderIds(baseDef)).toEqual([0]);
    expect(collectMaxLedIndex(baseDef)).toBe(0);

    const {store, connected, firmware} = await prepareSelectedStateSyncDevice(
      'option-keys-candidate',
      {
        withMenu: true,
        definitionExtras: {optionEncoder: true, optionRgb: true},
      },
    );
    firmware.encoderValuesById[1] = [210, 211];
    firmware.perKeyRGBMap[3] = [80, 90];
    const dispatch = store.dispatch as any;
    const encoderReadsBefore = firmware.encoderReads;
    await dispatch(probeStateSyncForDevice(connected));
    expect(firmware.encoderReads - encoderReadsBefore).toBeGreaterThanOrEqual(
      2,
    );
    expect(
      store.getState().keymap.encoderDeviceMap[connected.path]?.[1]?.[0],
    ).toEqual([210, 211]);
    const perKey =
      store.getState().menus.customMenuDataMap[connected.path]?.__perKeyRGB;
    expect(Array.isArray(perKey)).toBe(true);
    expect((perKey as number[][]).length).toBe(4);
  });

  test('same-length per-key RGB refresh updates derived painter colors', async () => {
    const keys = [{li: 0}, {li: 1}] as any;
    const first = keyColorsFromPerKeyRGB(
      [
        [10, 20],
        [30, 40],
      ],
      keys,
    );
    const second = keyColorsFromPerKeyRGB(
      [
        [80, 90],
        [100, 110],
      ],
      keys,
    );
    expect(first).not.toEqual(second);
    expect(second.length).toBe(first.length);
  });

  test('encoder SET updates cache so a layer switch does not restore the old value', async () => {
    const {store, connected, firmware} =
      await prepareSelectedStateSyncDevice('encoder-set-cache');
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    expect(
      store.getState().keymap.encoderDeviceMap[connected.path]?.[0]?.[0],
    ).toEqual([100, 101]);
    await dispatch(updateEncoderValue(0, 0, true, 201));
    expect(firmware.encoderValues[1]).toBe(201);
    dispatch(setLayer(0));
    expect(
      store.getState().keymap.encoderDeviceMap[connected.path]?.[0]?.[0],
    ).toEqual([100, 201]);
  });

  test('layout option change keeps optionKeys-only encoder and RGB coverage', async () => {
    const {store, connected, firmware} = await prepareSelectedStateSyncDevice(
      'option-change-refresh',
      {
        withMenu: true,
        definitionExtras: {optionEncoder: true, optionRgb: true},
      },
    );
    firmware.encoderValuesById[1] = [210, 211];
    firmware.perKeyRGBMap[3] = [80, 90];
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    expect(
      store.getState().keymap.encoderDeviceMap[connected.path]?.[1]?.[0],
    ).toEqual([210, 211]);
    await dispatch(updateLayoutOption(0, 1));
    expect(
      store.getState().stateSync.byPath[connected.path]?.config.status,
    ).toBe('dirty');
    expect(
      store.getState().keymap.encoderDeviceMap[connected.path]?.[1]?.[0],
    ).toEqual([210, 211]);
    expect(
      collectUniqueEncoderIds(makeV3Definition(true, {optionEncoder: true})),
    ).toEqual([1]);
  });

  test('bulk encoder load replaces the cache for every encoder id', async () => {
    const {store, connected} = await prepareSelectedStateSyncDevice(
      'encoder-bulk-load',
      {definitionExtras: {optionEncoder: true}},
    );
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    dispatch(
      replaceEncoderMap({
        devicePath: connected.path,
        encoders: {
          0: [[1, 2]],
          1: [[3, 4]],
        },
      }),
    );
    expect(store.getState().keymap.encoderDeviceMap[connected.path]).toEqual({
      0: [[1, 2]],
      1: [[3, 4]],
    });
  });

  test('failed encoder SET does not overwrite the firmware cache', async () => {
    const {store, connected, firmware} =
      await prepareSelectedStateSyncDevice('encoder-set-fail');
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.rejectNextEncoderSet = true;
    await expect(
      dispatch(updateEncoderValue(0, 0, true, 201)),
    ).rejects.toBeTruthy();
    expect(
      store.getState().keymap.encoderDeviceMap[connected.path]?.[0]?.[0],
    ).toEqual([100, 101]);
    expect(
      store.getState().stateSync.byPath[connected.path]?.keymap.status,
    ).toBe('dirty');
  });

  test('device switch does not display or save the previous device macros', async () => {
    const {
      store,
      connected: deviceA,
      firmware: firmwareA,
    } = await prepareSelectedStateSyncDevice('macro-owner-a');
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(deviceA));
    const {device: fakeB} = await connectFake('macro-owner-b');
    const firmwareB = new FakeStateSyncFirmware(fakeB);
    firmwareB.macroText = 'B';
    firmwareB.holdNextMacroBuffer = true;
    fakeB.onSend = firmwareB.onSend;
    const deviceB = makeConnectedDevice('macro-owner-b', TOMAK_VPID);
    store.dispatch(
      updateConnectedDevices({
        [deviceA.path]: deviceA,
        [deviceB.path]: deviceB,
      }),
    );
    store.dispatch(
      saveKeymapSuccess({
        devicePath: deviceB.path,
        connectionGeneration: new KeyboardAPI(
          deviceB.path,
        ).getConnectionGeneration(),
        layers: [{keymap: [1], isLoaded: true}],
      }),
    );
    const generationB = new KeyboardAPI(deviceB.path).getConnectionGeneration();
    store.dispatch(
      selectDevice({device: deviceB, connectionGeneration: generationB}),
    );
    store.dispatch(
      markDeviceReady({
        devicePath: deviceB.path,
        connectionGeneration: generationB,
        selectionGeneration: store.getState().devices.selectionGeneration,
      }),
    );
    expect(getLoadProgress(store.getState())).toBe(1);
    expect(getIsMacrosReady(store.getState())).toBe(false);
    expect(getExpressions(store.getState())).toEqual([]);
    const delayedLoad = dispatch(loadMacros(deviceB));
    await waitUntil(() => firmwareB.heldMacroBufferRequest !== undefined, 800);
    firmwareA.macroText = 'late-A';
    await dispatch(loadMacros(deviceA));
    expect(getExpressions(store.getState())).toEqual([]);
    firmwareB.releaseHeldMacroBuffer();
    await delayedLoad;
    expect(getIsMacrosReady(store.getState())).toBe(true);
    expect(getExpressions(store.getState()).join('')).not.toContain('late-A');
  });

  test('a continuously churning full refresh stops after three attempts and retries on the next poll', async () => {
    const {store, connected, firmware} =
      await prepareSelectedStateSyncDevice('full-refresh-three');
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.churnEveryKeymapRead = true;
    const keymapReadsBefore = firmware.keymapReads;
    dispatch(setConfigureVisible(true));
    await dispatch(refreshAllDomains(connected));
    expect(firmware.keymapReads - keymapReadsBefore).toBe(3);
    expect(
      store.getState().stateSync.byPath[connected.path]?.keymap.status,
    ).toBe('dirty');
    firmware.churnEveryKeymapRead = false;
    firmware.revisions.keymap += 1;
    firmware.keymapValue = firmware.revisions.keymap;
    await dispatch(pollStateSync());
    expect(
      store.getState().stateSync.byPath[connected.path]?.keymap.status,
    ).toBe('fresh');
  });
});

describe('full layout import transaction', () => {
  test('awaits macro verification, keeps fast keymap packets and encoders under one owner', async () => {
    const {store, connected, firmware} =
      await prepareSelectedStateSyncDevice('full-import-owner');
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.operationLog = [];
    firmware.macroVerificationMarkers = [0xff, 0];
    firmware.macroVerificationReadCount = 0;
    const reportsBefore = firmware.device.sentReports.length;

    const importing = dispatch(
      importLayoutToDevice(connected, {
        macros: ['B'],
        keymap: [Array.from({length: 20}, (_, index) => 0x1200 + index)],
        encoders: {0: [[0x0200, 0x0201]]},
      }),
    );
    await waitUntil(() => firmware.macroVerificationReadCount === 1, 800);
    expect(firmware.operationLog).not.toContain('keymap');
    const outsideCommand = new KeyboardAPI(
      connected.path,
    ).getProtocolVersion();

    await importing;
    expect(await outsideCommand).toBe(12);
    expect(firmware.operationLog).toEqual([
      'macro-reset',
      'macro-open',
      'macro-payload',
      'macro-close',
      'keymap',
      'keymap',
      'encoder',
      'encoder',
    ]);
    const commands = firmware.device.sentReports
      .slice(reportsBefore)
      .map(({data}) => data[0]);
    expect(commands.at(-1)).toBe(0x01);
    expect(commands.indexOf(0x13)).toBeGreaterThan(commands.lastIndexOf(0x0e));
    expect(
      store.getState().stateSync.byPath[connected.path],
    ).toMatchObject({
      macro: {mutationEpoch: 1, status: 'dirty'},
      keymap: {mutationEpoch: 1, status: 'dirty'},
    });
  });

  test('a macro failure stops keymap and encoder writes and preserves macro state', async () => {
    const {store, connected, firmware} =
      await prepareSelectedStateSyncDevice('full-import-macro-failure');
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    const beforeAst = store.getState().macros.ast;
    firmware.operationLog = [];
    firmware.rejectNextMacroPayload = true;

    await expect(
      dispatch(
        importLayoutToDevice(connected, {
          macros: ['B'],
          keymap: [[0x1234]],
          encoders: {0: [[0x0200, 0x0201]]},
        }),
      ),
    ).rejects.toThrow('rejected macro payload');

    expect(firmware.operationLog).not.toContain('keymap');
    expect(firmware.operationLog).not.toContain('encoder');
    expect(store.getState().macros.ast).toEqual(beforeAst);
  });

  test('a same-generation partial failure releases the owner and requests one reconciliation', async () => {
    const {store, connected, firmware} =
      await prepareSelectedStateSyncDevice('full-import-reconcile');
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.operationLog = [];
    const stateSyncReadsBefore = firmware.stateSyncReads;
    const encoders = {} as StateSyncEncoderMap;
    Object.defineProperty(encoders, '0', {
      enumerable: true,
      get: () => {
        throw new Error('encoder import decode failed');
      },
    });

    await expect(
      dispatch(
        importLayoutToDevice(connected, {
          keymap: [[0x1234]],
          encoders,
        }),
      ),
    ).rejects.toThrow('encoder import decode failed');

    expect(firmware.operationLog).toContain('keymap');
    expect(firmware.operationLog).not.toContain('encoder');
    expect(firmware.stateSyncReads).toBeGreaterThan(stateSyncReadsBefore);
    expect(
      store.getState().stateSync.byPath[connected.path]?.keymap.status,
    ).toBe('fresh');
  });
});

describe('mutation epoch path and generation ownership', () => {
  test('mutating one path does not reject another path candidate and reconnect starts a new epoch space', () => {
    let state = stateSyncReducer(
      undefined,
      ensurePathSync({path: 'epoch-A', generation: 1}),
    );
    state = stateSyncReducer(
      state,
      ensurePathSync({path: 'epoch-B', generation: 1}),
    );
    state = stateSyncReducer(
      state,
      beginForegroundMutation({
        path: 'epoch-A',
        generation: 1,
        domains: ['keymap'],
      }),
    );
    state = stateSyncReducer(
      state,
      commitStableKeymapCandidate({
        devicePath: 'epoch-B',
        connectionGeneration: 1,
        selectionGeneration: 4,
        definitionIdentity: 'definition-B',
        revision: 7,
        mutationEpoch: 0,
        candidate: {layers: [], encoders: {}},
      }),
    );
    expect(state.byPath['epoch-B'].keymap).toMatchObject({
      status: 'fresh',
      acceptedRevision: 7,
      mutationEpoch: 0,
    });

    state = stateSyncReducer(
      state,
      ensurePathSync({path: 'epoch-A', generation: 2}),
    );
    expect(state.byPath['epoch-A'].keymap.mutationEpoch).toBe(0);
    state = stateSyncReducer(
      state,
      commitStableKeymapCandidate({
        devicePath: 'epoch-A',
        connectionGeneration: 1,
        selectionGeneration: 4,
        definitionIdentity: 'old-definition-A',
        revision: 99,
        mutationEpoch: 1,
        candidate: {layers: [], encoders: {}},
      }),
    );
    expect(state.byPath['epoch-A'].keymap).toMatchObject({
      status: 'unknown',
      acceptedRevision: 0,
      mutationEpoch: 0,
    });

    state = stateSyncReducer(
      state,
      beginForegroundMutation({
        path: 'epoch-A',
        generation: 1,
        domains: ['keymap'],
      }),
    );
    expect(state.byPath['epoch-A']).toMatchObject({
      generation: 2,
      keymap: {status: 'unknown', mutationEpoch: 0},
    });
  });
});

describe('queryStateSync HID path', () => {
  test('classifies 0xFF as unhandled without throwing', async () => {
    const {device} = await connectFake('ff');
    device.onSend = (data) => {
      if (data[0] === 0x02) {
        const response = data.slice();
        response[0] = 0xff;
        device.emit(response);
      }
    };
    const api = new KeyboardAPI('ff');
    expect(await queryStateSync(api)).toEqual({kind: 'unhandled'});
  });
});
