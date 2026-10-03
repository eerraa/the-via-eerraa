import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {configureStore} from '@reduxjs/toolkit';
import i18n from 'i18next';
import {createElement as h} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {I18nextProvider} from 'react-i18next';
import {Provider} from 'react-redux';
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
import {store as appStore} from '../src/store';
import {clearAppErrors, getAppErrors} from '../src/store/errorsSlice';
import devicesReducer, {
  markDeviceReady,
  selectDevice,
  updateConnectedDevices,
} from '../src/store/devicesSlice';
import keymapReducer, {
  getLoadProgress,
  getSelectedKey,
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
  getPaletteMacroCount,
  loadMacroMetadata,
  loadMacros,
  loadMacrosSuccess,
  resetMacrosOnDevice,
  saveMacros,
} from '../src/store/macrosSlice';
import definitionsReducer, {
  getDefinitionSyncIdentity,
  getSelectedDefinition,
  getSelectedKeyDefinitions,
  getSelectedLayoutOptions,
  getSelectedLayoutOptionsPending,
  loadCustomDefinitions,
  reloadDefinitions,
  updateDefinitions,
  updateEraDefinitions,
  updateLayoutOption,
  updateLayoutOptions,
} from '../src/store/definitionsSlice';
import menusReducer, {
  getCustomMenuAvailabilityForDevice,
  getSelectedCustomMenuAvailability,
  getV3Menus,
  refreshCustomMenuValue,
  syncCustomMenuValues,
  completeCustomMenuRangeValueContinuous,
  completeCustomMenuValueContinuous,
  updateCustomMenuRangeValueContinuous,
  updateCustomMenuRangeValue,
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
  canExportLayoutFile,
  exportLayoutFile,
  importLayoutFile,
} from '../src/store/layoutFileThunks';
import definitionNameReducer from '../src/store/definitionNameSlice';
import {
  collectUniqueEncoderIds,
  collectMaxLedIndex,
} from '../src/utils/via-definition-keys';
import type {ConnectedDevice} from '../src/types/types';
import {
  completeContinuousHIDTransactionsForPath,
  hasContinuousHIDTransactionsForPath,
  resetContinuousHIDTransactionsForTesting,
  setContinuousIdleCompletionMsForTesting,
} from '../src/utils/continuous-hid-transaction';
import {selectConnectedDevice} from '../src/store/devicesThunks';
import {getKeysKeys} from '../src/components/n-links/key-group';
import {Pane as LayoutsPane} from '../src/components/panes/configure-panes/layouts';

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
      definitionName: definitionNameReducer,
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
  store.dispatch(
    updateLayoutOptions({
      devicePath: path,
      connectionGeneration: generation,
      options: [firmware.layoutValue],
    }),
  );
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
  const prepareLazyMacros = async (path: string) => {
    const {device} = await connectFake(path);
    const firmware = new FakeStateSyncFirmware(device);
    device.onSend = firmware.onSend;
    const store = makeStore();
    const dispatch = store.dispatch as any;
    const connected = makeConnectedDevice(path, TOMAK_VPID);
    installEraDefinition(store, makeV3Definition(true));
    dispatch(updateConnectedDevices({[path]: connected}));
    const generation = new KeyboardAPI(path).getConnectionGeneration();
    dispatch(selectDevice({device: connected, connectionGeneration: generation}));
    expect(await dispatch(probeStateSyncCapabilityForDevice(connected))).toBe(true);
    await dispatch(loadMacroMetadata(connected));
    expect(
      await dispatch(
        refreshStateSyncDomain(connected, 'keymap', {allowBeforeReady: true}),
      ),
    ).toBe(true);
    dispatch(
      markDeviceReady({
        devicePath: path,
        connectionGeneration: generation,
        selectionGeneration: store.getState().devices.selectionGeneration,
      }),
    );
    dispatch(setConfigureVisible(true));
    await dispatch(pollStateSync());
    expect(firmware.macroBufferReads).toBe(0);
    expect(getIsMacrosReady(store.getState())).toBe(false);
    return {device, firmware, store, dispatch, connected, generation};
  };

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

  test.each(['timeout', 'malformed', 'churn'] as const)(
    'a healthy poll retries the first requested macro snapshot after %s',
    async (failure) => {
      const {device, firmware, store, dispatch, connected} =
        await prepareLazyMacros(`lazy-macro-${failure}`);
      if (failure === 'timeout') {
        firmware.dropNextStateSync = true;
      } else if (failure === 'malformed') {
        firmware.malformNextStateSync = true;
      } else {
        device.onSend = (data) => {
          if (data[0] === 0x0e) {
            firmware.revisions.macro++;
          }
          firmware.onSend(data);
        };
      }

      expect(await dispatch(refreshMacroDomain(connected))).toBe(false);
      expect(getHIDTransportDebugState(connected.path)?.poisoned).toBe(false);
      expect(getIsMacrosReady(store.getState())).toBe(false);
      const failedReads = firmware.macroBufferReads;
      expect(failedReads).toBe(failure === 'churn' ? 3 : 0);

      device.onSend = firmware.onSend;
      firmware.macroText = 'B';
      await dispatch(pollStateSync());
      expect(firmware.macroBufferReads).toBeGreaterThan(failedReads);
      expect(getIsMacrosReady(store.getState())).toBe(true);
      expect(getExpressions(store.getState())).toEqual(['B']);
      expect(store.getState().stateSync.byPath[connected.path]?.macro).toMatchObject({
        status: 'fresh',
        acceptedRevision: firmware.revisions.macro,
      });
    },
  );

  test('a failed full refresh also keeps its first macro read eligible for polling', async () => {
    const {firmware, store, dispatch, connected} =
      await prepareLazyMacros('lazy-macro-full-refresh');
    firmware.dropNextStateSync = true;
    await dispatch(refreshAllDomains(connected));
    expect(firmware.macroBufferReads).toBe(0);
    await dispatch(pollStateSync());
    expect(getIsMacrosReady(store.getState())).toBe(true);
    expect(firmware.macroBufferReads).toBeGreaterThan(0);
  });

  test('a failed ordinary poll does not request the untouched macro buffer', async () => {
    const {firmware, store, dispatch} =
      await prepareLazyMacros('lazy-macro-untouched');
    firmware.dropNextStateSync = true;
    await dispatch(pollStateSync());
    await dispatch(pollStateSync());
    expect(firmware.macroBufferReads).toBe(0);
    expect(getIsMacrosReady(store.getState())).toBe(false);
  });

  test('a macro request joined to a failing poll survives until the page is visible', async () => {
    const {firmware, store, dispatch, connected} =
      await prepareLazyMacros('lazy-macro-coalesced');
    firmware.holdNextStateSync = true;
    const polling = dispatch(pollStateSync());
    await waitUntil(() => !!firmware.heldStateSyncRequest);
    const requested = dispatch(refreshMacroDomain(connected));
    await polling;
    expect(await requested).toBe(false);
    firmware.releaseHeldStateSync();

    dispatch(setDocumentHidden(true));
    const reportsBeforeHiddenPoll = firmware.device.sentReports.length;
    await dispatch(pollStateSync());
    expect(firmware.device.sentReports.length).toBe(reportsBeforeHiddenPoll);
    expect(firmware.macroBufferReads).toBe(0);

    dispatch(setDocumentHidden(false));
    await dispatch(pollStateSync());
    expect(getIsMacrosReady(store.getState())).toBe(true);
    expect(getExpressions(store.getState())).toEqual(['A']);
  });

  test('a new connection does not inherit a failed first macro request', async () => {
    const {device, firmware, store, dispatch, connected, generation} =
      await prepareLazyMacros('lazy-macro-reconnect');
    firmware.dropNextStateSync = true;
    expect(await dispatch(refreshMacroDomain(connected))).toBe(false);

    disconnectHIDDeviceForTesting(connected.path);
    registerHIDDeviceForTesting(connected.path, asHIDDevice(device));
    const reconnected = new HID.HID(connected.path);
    await reconnected.openPromise;
    const nextGeneration = reconnected.getConnectionGeneration();
    expect(nextGeneration).toBeGreaterThan(generation);
    dispatch(
      selectDevice({device: connected, connectionGeneration: nextGeneration}),
    );
    expect(await dispatch(probeStateSyncCapabilityForDevice(connected))).toBe(true);
    await dispatch(loadMacroMetadata(connected));
    dispatch(
      markDeviceReady({
        devicePath: connected.path,
        connectionGeneration: nextGeneration,
        selectionGeneration: store.getState().devices.selectionGeneration,
      }),
    );
    await dispatch(pollStateSync());
    expect(firmware.macroBufferReads).toBe(0);
    expect(getIsMacrosReady(store.getState())).toBe(false);
    expect(await dispatch(refreshMacroDomain(connected))).toBe(true);
    expect(getIsMacrosReady(store.getState())).toBe(true);
  });

  // A macro write reads back its end marker; only a read from offset 0 pulls the
  // macros themselves.
  const macroContentReads = (firmware: FakeStateSyncFirmware) =>
    firmware.device.sentReports.filter(
      ({data}) => data[0] === 0x0e && ((data[1] << 8) | data[2]) === 0,
    ).length;

  test('a layout import replaces the macros without reading the lazy buffer', async () => {
    const {firmware, dispatch, connected} =
      await prepareLazyMacros('lazy-macro-import');
    // An edit rebuilds the set from the macros on screen, so it still needs them.
    await expect(dispatch(saveMacros(connected, ['B']))).rejects.toThrow(
      'Macro state does not belong to the current device',
    );
    firmware.operationLog = [];

    await dispatch(
      importLayoutToDevice(connected, {
        macros: ['C'],
        keymap: [Array.from({length: 20}, () => 0x0004)],
      }),
    );

    expect(macroContentReads(firmware)).toBe(0);
    expect(firmware.operationLog).toContain('macro-payload');
    expect(firmware.operationLog).toContain('keymap');
    expect(firmware.macroText).toBe('C');
  });

  test('a layout import writes its Tap Dance values in the same transaction, saved once per channel', async () => {
    const {firmware, store, dispatch, connected} =
      await prepareLazyMacros('lazy-macro-import-custom');
    firmware.customEvents = [];
    const reportsBefore = firmware.device.sentReports.length;

    await dispatch(
      importLayoutToDevice(connected, {
        keymap: [Array.from({length: 20}, () => 0x0004)],
        customValues: [
          {name: 'id_test_value', channel: 1, id: 1, value: 0x0300},
          {name: 'id_test_value', channel: 1, id: 1, value: 0x0400},
        ],
      }),
    );

    const commands = firmware.device.sentReports
      .slice(reportsBefore)
      .map(({data}) => data[0]);
    expect(commands.indexOf(0x07)).toBeGreaterThan(commands.lastIndexOf(0x13));
    expect(firmware.customEvents).toEqual(['set:3', 'set:4', 'save:1']);
    expect(
      store.getState().menus.customMenuDataMap[connected.path]?.id_test_value,
    ).toEqual([4, 0]);
    expect(
      store.getState().stateSync.byPath[connected.path]?.config,
    ).toMatchObject({mutationEpoch: 1, status: 'dirty'});
  });

  test('saving a layout reads the lazy macros itself', async () => {
    const {firmware, dispatch, connected} =
      await prepareLazyMacros('lazy-macro-export');
    firmware.macroText = 'Q';

    const result = await dispatch(exportLayoutFile(connected));

    expect(macroContentReads(firmware)).toBeGreaterThan(0);
    expect(result).toMatchObject({
      file: {vendorProductId: TOMAK_VPID, macros: ['Q']},
    });
  });
});

// Three layout rows: Enter ANSI/ISO, Space 6.25U/7U, Split Left Shift. The
// board stores 6, ISO Enter with a 7U Space. The two arrangements put different
// keys at the same place in the key list, and ANSI's key at (1, 3) has no ISO
// counterpart.
describe('layout options on a State Sync board', () => {
  const layoutKey = (row: number, col: number, x: number, y: number, w = 1) => ({
    x,
    y,
    w,
    h: 1,
    row,
    col,
    color: 'alpha',
    d: false,
    r: 0,
    rx: 0,
    ry: 0,
  });

  const makeLayoutDefinition = () => ({
    ...makeV3Definition(),
    layouts: {
      keys: [layoutKey(0, 0, 0, 0)],
      labels: [
        ['Enter', 'ANSI', 'ISO'],
        ['Space', '6.25U', '7U'],
        'Split Left Shift',
      ],
      width: 8,
      height: 3,
      optionKeys: {
        0: {
          0: [layoutKey(1, 2, 2, 1, 2.25), layoutKey(1, 3, 4.25, 1)],
          1: [layoutKey(1, 1, 1, 1), layoutKey(1, 2, 2, 1, 1.25)],
        },
        1: {
          0: [layoutKey(2, 0, 0, 2, 6.25)],
          1: [layoutKey(2, 0, 0, 2, 7)],
        },
        2: {1: [layoutKey(2, 3, 7, 2)]},
      },
    },
    matrix: {rows: 3, cols: 4},
  });

  const connectBoard = async (path: string) => {
    const {device} = await connectFake(path);
    const firmware = new FakeStateSyncFirmware(device);
    firmware.layoutValue = 0b110;
    const answer = (data: Uint8Array) => {
      // FIRMWARE_VERSION, read while the board is selected.
      if (data[0] === 0x02 && data[1] === 0x04) {
        device.emit(payload(0x02, 0x04, 0x00, 0x00, 0x00, 0x01));
        return;
      }
      firmware.onSend(data);
    };
    device.onSend = answer;
    const store = makeStore();
    const connected = makeConnectedDevice(path, TOMAK_VPID);
    installEraDefinition(store, makeLayoutDefinition() as any);
    store.dispatch(updateConnectedDevices({[path]: connected}));
    return {
      device,
      firmware,
      store,
      connected,
      answer,
      dispatch: store.dispatch as any,
      state: () => store.getState() as any,
    };
  };
  type Board = Awaited<ReturnType<typeof connectBoard>>;

  // The read before ready gets no value, so the defaults stay on screen until
  // the CONFIG read brings the stored options.
  const refuseFirstLayoutRead = (board: Board) => {
    let refused = false;
    board.device.onSend = (data) => {
      if (!refused && data[0] === 0x02 && data[1] === 0x02) {
        refused = true;
        board.device.emit(payload(0xff, ...Array.from(data.slice(1))));
        return;
      }
      board.answer(data);
    };
  };

  // Holds the CONFIG read that starts at ready: the moment the keyboard has
  // just appeared.
  const selectHoldingConfig = async (board: Board) => {
    const unsubscribe = board.store.subscribe(() => {
      if (board.state().devices.readyDevicePath === board.connected.path) {
        board.firmware.holdNextStateSync = true;
        unsubscribe();
      }
    });
    await board.dispatch(selectConnectedDevice(board.connected));
    await waitUntil(() => board.firmware.heldStateSyncRequest !== undefined);
  };

  const configFresh = (board: Board) =>
    board.state().stateSync.byPath[board.connected.path]?.config.status ===
    'fresh';

  // Clicks the key as the keyboard picture does.
  const pick = (board: Board, row: number, col: number) => {
    const keys = getSelectedKeyDefinitions(board.state());
    const index = keys.findIndex((key) => key.row === row && key.col === col);
    const {coords} = getKeysKeys(
      {keys, definition: getSelectedDefinition(board.state())} as any,
      {},
      board.dispatch,
      () => [0, 0, 0],
    );
    coords[index].onClick({stopPropagation: () => undefined}, index);
  };

  const layoutWrites = (board: Board) =>
    board.device.sentReports
      .filter(({data}) => data[0] === 0x03)
      .map(({data}) => data[5]);

  test('the keyboard is first drawn in its stored layout', async () => {
    const board = await connectBoard('layout-first-drawing');
    let firstDrawing: {options: number[]; config?: string} | undefined;
    const unsubscribe = board.store.subscribe(() => {
      const state = board.state();
      if (!firstDrawing && getLoadProgress(state) === 1) {
        firstDrawing = {
          options: getSelectedLayoutOptions(state),
          config: state.stateSync.byPath[board.connected.path]?.config.status,
        };
      }
    });
    await board.dispatch(selectConnectedDevice(board.connected));
    unsubscribe();

    expect(firstDrawing?.options).toEqual([1, 1, 0]);
    // One plain GET before the keymap; it is not a CONFIG snapshot.
    expect(firstDrawing?.config).not.toBe('fresh');
    const sent = board.device.sentReports.map(({data}) => data);
    const layoutRead = sent.findIndex(
      (data) => data[0] === 0x02 && data[1] === 0x02,
    );
    expect(layoutRead).toBeGreaterThan(-1);
    expect(layoutRead).toBeLessThan(sent.findIndex((data) => data[0] === 0x12));
    await waitUntil(() => configFresh(board));
    expect(board.firmware.layoutReads).toBe(2);
  });

  test('a layout change right after the keyboard appears keeps the stored rows', async () => {
    const board = await connectBoard('layout-early-change');
    await selectHoldingConfig(board);

    const changing = board.dispatch(updateLayoutOption(2, 1));
    board.firmware.releaseHeldStateSync();
    await changing;

    expect(layoutWrites(board)).toEqual([0b111]);
    expect(board.firmware.layoutValue).toBe(0b111);
    expect(
      await board.dispatch(refreshStateSyncDomain(board.connected, 'config')),
    ).toBe(true);
    expect(getSelectedLayoutOptions(board.state())).toEqual([1, 1, 1]);
  });

  test('LAYOUTS waits, and writes nothing, until this connection has read the options', async () => {
    const board = await connectBoard('layout-not-read');
    refuseFirstLayoutRead(board);
    await selectHoldingConfig(board);
    const translations = i18n.createInstance();
    await translations.init({lng: 'en'});
    const renderLayouts = () =>
      renderToStaticMarkup(
        h(
          Provider,
          {store: board.store} as any,
          h(I18nextProvider, {i18n: translations} as any, h(LayoutsPane)),
        ),
      );

    expect(getSelectedLayoutOptionsPending(board.state())).toBe(true);
    expect(renderLayouts()).toContain('Loading...');
    await board.dispatch(updateLayoutOption(2, 1));
    expect(layoutWrites(board)).toEqual([]);
    expect(
      board.state().stateSync.byPath[board.connected.path]?.config
        .mutationEpoch,
    ).toBe(0);

    board.firmware.releaseHeldStateSync();
    await waitUntil(() => configFresh(board));
    const settled = renderLayouts();
    expect(settled).not.toContain('Loading...');
    expect(settled).toContain('ISO');
    await board.dispatch(updateLayoutOption(2, 1));
    expect(layoutWrites(board)).toEqual([0b111]);
  });

  test('a key picked in the default layout is the key written once the stored layout arrives', async () => {
    const board = await connectBoard('layout-picked-key-moves');
    refuseFirstLayoutRead(board);
    await selectHoldingConfig(board);
    pick(board, 1, 2);
    expect(getSelectedKey(board.state())).toBe(1);

    board.firmware.releaseHeldStateSync();
    await waitUntil(() => configFresh(board));

    const selected = getSelectedKey(board.state());
    expect(getSelectedKeyDefinitions(board.state())[selected]).toMatchObject({
      row: 1,
      col: 2,
    });
    await board.dispatch(updateKey(selected, 0x0029));
    expect(
      board.device.sentReports
        .filter(({data}) => data[0] === 0x05)
        .map(({data}) => [data[2], data[3]]),
    ).toEqual([[1, 2]]);
  });

  test('a picked key the stored layout does not have is no longer selected', async () => {
    const board = await connectBoard('layout-picked-key-gone');
    refuseFirstLayoutRead(board);
    await selectHoldingConfig(board);
    pick(board, 1, 3);
    expect(getSelectedKey(board.state())).toBe(2);

    board.firmware.releaseHeldStateSync();
    await waitUntil(() => configFresh(board));

    expect(getSelectedKey(board.state())).toBeNull();
  });
});

// An ordinary VIA keyboard reads its macros at connect, has no State Sync and no
// Tap Dance: layout files must behave exactly as in official VIA.
describe('layout files on an ordinary VIA keyboard', () => {
  const prepareOrdinary = async (path: string) => {
    const {device} = await connectFake(path);
    const firmware = new FakeStateSyncFirmware(device);
    device.onSend = firmware.onSend;
    setEraAdvancedMetadataForTesting({
      schemaVersion: 2,
      definitions: [
        {
          id: 'tomak',
          vendorProductId: TOMAK_VPID,
          stateSync: true,
          exactMsFamily: 'qmk',
        },
      ],
    });
    const store = makeStore();
    const dispatch = store.dispatch as any;
    const connected = makeConnectedDevice(path, ORDINARY_VPID);
    dispatch(
      updateDefinitions({
        [ORDINARY_VPID]: {
          v3: {...makeV3Definition(true), vendorProductId: ORDINARY_VPID},
        },
      } as any),
    );
    dispatch(updateConnectedDevices({[path]: connected}));
    const generation = new KeyboardAPI(path).getConnectionGeneration();
    dispatch(selectDevice({device: connected, connectionGeneration: generation}));
    await dispatch(loadMacros(connected));
    dispatch(
      saveKeymapSuccess({
        devicePath: path,
        connectionGeneration: generation,
        layers: [{keymap: [0x0004], isLoaded: true}],
      }),
    );
    return {firmware, store, dispatch, connected};
  };

  test('saves in official VIA form and loads it back', async () => {
    const {firmware, store, dispatch, connected} =
      await prepareOrdinary('ordinary-layout-round-trip');
    expect(getIsMacrosReady(store.getState())).toBe(true);
    firmware.macroText = 'A';

    const saved = await dispatch(exportLayoutFile(connected));
    expect(saved).toMatchObject({
      file: {vendorProductId: ORDINARY_VPID, macros: ['A'], layers: [['KC_A']]},
    });
    expect(saved.file).not.toHaveProperty('tapDance');

    firmware.customEvents = [];
    const reportsBefore = firmware.device.sentReports.length;
    // A Tap Dance list in the file is ignored: this keyboard has none.
    const loaded = await dispatch(
      importLayoutFile(connected, {
        ...saved.file,
        macros: ['B'],
        tapDance: [
          {tap: 'KC_ESC', hold: 'KC_NO', dtap: 'KC_NO', thold: 'KC_NO', term: 200},
        ],
      }),
    );

    expect(loaded).toEqual({ok: true});
    expect(firmware.macroText).toBe('B');
    const commands = firmware.device.sentReports
      .slice(reportsBefore)
      .map(({data}) => data[0]);
    expect(commands).toContain(0x13);
    expect(commands).not.toContain(0x07);
    expect(firmware.customEvents).toEqual([]);
    expect(firmware.stateSyncReads).toBe(0);
  });

  test('takes only its own identity', async () => {
    const {dispatch, connected} = await prepareOrdinary('ordinary-layout-identity');
    const file = {name: 'TOMAK', vendorProductId: TOMAK_VPID, layers: [['KC_A']]};
    expect(await dispatch(importLayoutFile(connected, file))).toEqual({
      error: 'different-keyboard',
    });
  });
});

describe('layout file operation ownership', () => {
  for (const operation of ['export', 'import'] as const) {
    test(`${operation} stops when selection changes while preparing the file`, async () => {
      const {store, connected, firmware, generation} = await prepareSelectedStateSyncDevice(`layout-prepare-${operation}`);
      const dispatch = store.dispatch as any;
      setEraAdvancedMetadataForTesting({schemaVersion: 2, definitions: []});
      await dispatch(loadMacros(connected));
      const sent = firmware.device.sentReports.length;
      const result = dispatch(operation === 'export' ? exportLayoutFile(connected) : importLayoutFile(connected, {
        name: 'A', vendorProductId: connected.vendorProductId, layers: [['KC_A']],
      }));
      dispatch(selectDevice({device: connected, connectionGeneration: generation}));
      expect(await result).toEqual({error: 'keyboard-not-ready'});
      expect(firmware.device.sentReports).toHaveLength(sent);
    });
  }

  test('replacing a connection at the same path aborts the old backup', async () => {
    const {store, connected} = await prepareSelectedStateSyncDevice('layout-reconnect');
    const dispatch = store.dispatch as any;
    setEraAdvancedMetadataForTesting({schemaVersion: 2, definitions: []});
    await dispatch(loadMacros(connected));
    const result = dispatch(exportLayoutFile(connected));
    const replacement = new FakeHIDDevice();
    registerHIDDeviceForTesting(connected.path, asHIDDevice(replacement));
    await new HID.HID(connected.path).openPromise;
    expect(await result).toEqual({error: 'keyboard-not-ready'});
    expect(replacement.sentReports).toHaveLength(0);
  });

  test('an old file-dialog device cannot export or import the newly selected keyboard', async () => {
    const {store, connected: first} = await prepareSelectedStateSyncDevice('layout-owner-a');
    const dispatch = store.dispatch as any;
    setEraAdvancedMetadataForTesting({schemaVersion: 2, definitions: []});
    await dispatch(loadMacros(first));
    expect(dispatch(canExportLayoutFile(first))).toBe(true);
    const {device} = await connectFake('layout-owner-b');
    const firmware = new FakeStateSyncFirmware(device);
    firmware.macroText = 'B';
    device.onSend = firmware.onSend;
    const second = makeConnectedDevice('layout-owner-b', ORDINARY_VPID);
    dispatch(updateDefinitions({[second.vendorProductId]: {v3: {
      ...makeV3Definition(), name: 'Keyboard B', vendorProductId: second.vendorProductId,
    }}}));
    dispatch(updateConnectedDevices({[first.path]: first, [second.path]: second}));
    const generation = new KeyboardAPI(second.path).getConnectionGeneration();
    dispatch(selectDevice({device: second, connectionGeneration: generation}));
    dispatch(saveKeymapSuccess({devicePath: second.path, connectionGeneration: generation,
      layers: [{keymap: [5], isLoaded: true}]}));
    await dispatch(loadMacros(second));
    const sent = device.sentReports.length;
    expect(dispatch(canExportLayoutFile(first))).toBe(false);
    expect(await dispatch(exportLayoutFile(first))).toEqual({error: 'keyboard-not-ready'});
    expect(await dispatch(importLayoutFile(first, {
      name: 'A', vendorProductId: first.vendorProductId, layers: [['KC_A']],
    }))).toEqual({error: 'keyboard-not-ready'});
    expect(device.sentReports).toHaveLength(sent);
  });

  for (const change of ['selection', 'definition'] as const) {
    test(`a ${change} change during encoder reads aborts the backup`, async () => {
      const {store, connected, firmware, generation} = await prepareSelectedStateSyncDevice(`layout-mid-read-${change}`);
      const dispatch = store.dispatch as any;
      setEraAdvancedMetadataForTesting({schemaVersion: 2, definitions: []});
      await dispatch(loadMacros(connected));
      let changed = false;
      firmware.device.onSend = (data) => {
        if (data[0] === 0x14 && !changed) {
          changed = true;
          if (change === 'selection') {
            // Even returning to the same path must invalidate the old operation.
            dispatch(selectDevice({device: connected, connectionGeneration: generation}));
          } else {
            installEraDefinition(store, makeV3Definition(false, {shape: 'changed'}));
          }
        }
        firmware.onSend(data);
      };
      expect(await dispatch(exportLayoutFile(connected))).toEqual({error: 'keyboard-not-ready'});
      expect(changed).toBe(true);
    });
  }
});

// An ERA board with one Tap Dance slot. Its settings share the fake firmware's one
// Custom Value, which is all the reads and writes below need.
const TAP_DANCE_ROLES = ['tap', 'hold', 'dtap', 'thold'] as const;
const makeTapDanceDefinition = () => ({
  ...makeV3Definition(true),
  tapdanceKeycodes: [
    {
      name: 'TD0',
      title: 'Tap Dance 0',
      shortName: 'TD0',
      controls: TAP_DANCE_ROLES.map((role) => ({
        label: role,
        type: 'keycode',
        content: [`id_qmk_tapdance_1_${role}`, 1, 1],
      })),
    },
  ],
});

describe('layout files and Tap Dance values', () => {
  const prepareTapDance = async (path: string) => {
    const {device} = await connectFake(path);
    const firmware = new FakeStateSyncFirmware(device);
    device.onSend = firmware.onSend;
    const store = makeStore();
    const dispatch = store.dispatch as any;
    const connected = makeConnectedDevice(path, TOMAK_VPID);
    installEraDefinition(store, makeTapDanceDefinition() as any);
    dispatch(updateConnectedDevices({[path]: connected}));
    const generation = new KeyboardAPI(path).getConnectionGeneration();
    dispatch(
      selectDevice({device: connected, connectionGeneration: generation}),
    );
    const markReady = () =>
      dispatch(
        markDeviceReady({
          devicePath: path,
          connectionGeneration: generation,
          selectionGeneration: store.getState().devices.selectionGeneration,
        }),
      );
    return {
      device,
      firmware,
      store,
      dispatch,
      connected,
      generation,
      markReady,
    };
  };

  // Ready, with CONFIG (and so Tap Dance) not read yet.
  const prepareCapable = async (path: string) => {
    const prepared = await prepareTapDance(path);
    const {dispatch, connected} = prepared;
    expect(await dispatch(probeStateSyncCapabilityForDevice(connected))).toBe(
      true,
    );
    await dispatch(loadMacroMetadata(connected));
    expect(
      await dispatch(
        refreshStateSyncDomain(connected, 'keymap', {allowBeforeReady: true}),
      ),
    ).toBe(true);
    prepared.markReady();
    return prepared;
  };

  const prepareAdvancedTiming = async (family: 'h7s' | 'qmk', suffix = '') => {
    const prepared = await prepareCapable(`layout-timing-${family}-${suffix}`);
    const source = family === 'h7s'
      ? 'brick60-h7s/BRICK60-H7S-VIA.json'
      : 'tomak/TOMAK-TKL-L-VIA.json';
    const {tapdanceKeycodes} = JSON.parse(readFileSync(
      `era-definitions/custom/v3/${source}`, 'utf8',
    ));
    installEraDefinition(prepared.store, {...makeV3Definition(true), tapdanceKeycodes} as any);
    const channel = family === 'h7s' ? 16 : 0;
    const termBase = family === 'h7s' ? 41 : 72;
    const modeBase = family === 'h7s' ? 49 : 80;
    const holdBase = family === 'h7s' ? 57 : 88;
    const otherBase = family === 'h7s' ? 65 : 96;
    const values = new Map<number, number[]>();
    for (let index = 0; index < 8; index++) {
      for (let role = 0; role < 4; role++) {
        values.set(index * 5 + role + (family === 'h7s' ? 1 : 32), [0, role === 0 ? 4 + index : 1]);
      }
      values.set(termBase + index, [0, 137 + index]);
      values.set(modeBase + index, [2, 0xd2, 0xd3]);
      values.set(holdBase + index, [1, 81 + index, 0xd3]);
      values.set(otherBase + index, [1, 0xd3]);
    }
    const writes: number[][] = [];
    prepared.device.onSend = (data) => {
      if (data[1] === channel && data[0] === 0x08 && values.has(data[2])) {
        prepared.device.emit(payload(0x08, channel, data[2], ...values.get(data[2])!));
        return;
      }
      if (data[1] === channel && data[0] === 0x07 && values.has(data[2])) {
        const previous = values.get(data[2])!;
        const value = Array.from(data.slice(3, 3 + previous.length));
        if (data[2] >= modeBase && data[2] < modeBase + 8) value[2] = 0xd3;
        values.set(data[2], value);
        writes.push([data[2], ...value]);
        prepared.firmware.revisions.config++;
        prepared.device.emit(data);
        return;
      }
      prepared.firmware.onSend(data);
    };
    return {...prepared, values, writes, channel, termBase, modeBase, holdBase, otherBase};
  };

  test.each(['h7s', 'qmk'] as const)('%s layout JSON round-trips macros and all eight independent Tap Dance timings', async (family) => {
    const {dispatch, connected, firmware, values, writes, channel, termBase, modeBase, holdBase, otherBase} =
      await prepareAdvancedTiming(family);
    const saved = await dispatch(exportLayoutFile(connected));
    expect(saved).toHaveProperty('file.macros', ['A']);
    expect(saved.file.tapDance).toHaveLength(8);
    for (let index = 0; index < 8; index++) {
      expect(saved.file.tapDance[index]).toMatchObject({
        term: 137 + index, holdTerm: 337 + index, holdOnOther: 1, mode: 2,
        hold: 'KC_TRNS', dtap: 'KC_TRNS', thold: 'KC_TRNS',
      });
      values.set(termBase + index, [0, 200]);
      values.set(modeBase + index, [0, 0xd2, 0xd3]);
      values.set(holdBase + index, [0, 0, 0xd3]);
      values.set(otherBase + index, [0, 0xd3]);
    }
    firmware.revisions.config++;
    expect(await dispatch(refreshStateSyncDomain(connected, 'config'))).toBe(true);
    const file = JSON.parse(JSON.stringify(saved.file));
    expect(await dispatch(importLayoutFile(connected, file))).toEqual({ok: true});
    for (let index = 0; index < 8; index++) {
      expect(writes).toContainEqual([termBase + index, 0, 137 + index]);
      expect(writes).toContainEqual([holdBase + index, 1, 81 + index, 0xd3]);
      expect(writes).toContainEqual([otherBase + index, 1, 0xd3]);
      expect(writes).toContainEqual([modeBase + index, 2, 0xd2, 0xd3]);
    }
    expect(firmware.customEvents).toEqual([`save:${channel}`]);
    expect(await dispatch(exportLayoutFile(connected))).toEqual({file});
  });

  test.each(['hold-marker', 'other-marker', 'other-value'])(
    'refuses a backup when advertised advanced timing has an invalid %s', async (fault) => {
      const {dispatch, store, connected, values, holdBase, otherBase} =
        await prepareAdvancedTiming('h7s', fault);
      if (fault === 'hold-marker') values.set(holdBase, [1, 81, 0]);
      if (fault === 'other-marker') values.set(otherBase, [1, 0]);
      if (fault === 'other-value') values.set(otherBase, [2, 0xd3]);
      expect(await dispatch(exportLayoutFile(connected))).toEqual({error: 'keyboard-not-ready'});
      expect(getCustomMenuAvailabilityForDevice(store.getState() as any, connected)).not.toBe('available');
    },
  );

  test('a save waits for Tap Dance values still being read, instead of refusing', async () => {
    const {firmware, store, dispatch, connected} = await prepareCapable(
      'tap-dance-checking-save',
    );
    expect(
      getCustomMenuAvailabilityForDevice(store.getState() as any, connected),
    ).toBe('checking');
    // Nothing that is still being read stops the file dialog from opening.
    expect(dispatch(canExportLayoutFile(connected))).toBe(true);

    const saved = await dispatch(exportLayoutFile(connected));

    expect(firmware.menuReads).toBeGreaterThan(0);
    expect(saved).toMatchObject({
      file: {
        vendorProductId: TOMAK_VPID,
        tapDance: [
          {tap: 'KC_NO', hold: 'KC_NO', dtap: 'KC_NO', thold: 'KC_NO'},
        ],
      },
    });
  });

  test('a load waits for Tap Dance values being read again, then writes them', async () => {
    const {firmware, store, dispatch, connected, generation} =
      await prepareCapable('tap-dance-reconciling-load');
    // Every action of the slot reads back as the same held modifier.
    firmware.menuValue = 4;
    expect(await dispatch(refreshStateSyncDomain(connected, 'config'))).toBe(
      true,
    );
    // Back from a hidden tab: the accepted values are being checked again.
    dispatch(
      setDomainStatus({
        path: connected.path,
        generation,
        domain: 'config',
        status: 'dirty',
      }),
    );
    expect(
      getCustomMenuAvailabilityForDevice(store.getState() as any, connected),
    ).toBe('reconciling');
    const readsBefore = firmware.menuReads;
    firmware.customEvents = [];

    const loaded = await dispatch(
      importLayoutFile(connected, {
        name: 'TOMAK',
        vendorProductId: TOMAK_VPID,
        layers: [['KC_A']],
        tapDance: [
          {tap: 'KC_NO', hold: 'KC_NO', dtap: 'KC_NO', thold: 'KC_NO'},
        ],
      }),
    );

    expect(loaded).toEqual({ok: true});
    expect(firmware.menuReads).toBeGreaterThan(readsBefore);
    expect(firmware.customEvents).toEqual([
      'set:0',
      'set:0',
      'set:0',
      'set:0',
      'save:1',
    ]);
  });

  // Old firmware answers the State Sync query as unhandled. Its Tap Dance is never
  // read, so its files are official VIA's and its Tap Dance is left alone.
  test('firmware that could not be verified saves and loads without Tap Dance', async () => {
    const {
      device,
      firmware,
      store,
      dispatch,
      connected,
      generation,
      markReady,
    } = await prepareTapDance('tap-dance-unverified');
    device.onSend = (data) => {
      if (data[0] === 0x02 && data[1] === ERA_STATE_SYNC_SELECTOR) {
        const response = data.slice();
        response[0] = 0xff;
        device.emit(response);
        return;
      }
      return firmware.onSend(data);
    };
    expect(await dispatch(probeStateSyncCapabilityForDevice(connected))).toBe(
      false,
    );
    await dispatch(loadMacros(connected));
    dispatch(
      saveKeymapSuccess({
        devicePath: connected.path,
        connectionGeneration: generation,
        layers: [{keymap: [0x0004], isLoaded: true}],
      }),
    );
    markReady();
    expect(
      getCustomMenuAvailabilityForDevice(store.getState() as any, connected),
    ).toBe('unverified');
    expect(dispatch(canExportLayoutFile(connected))).toBe(true);

    const saved = await dispatch(exportLayoutFile(connected));
    expect(saved).toMatchObject({
      file: {vendorProductId: TOMAK_VPID, layers: [['KC_A']]},
    });
    expect(saved.file).not.toHaveProperty('tapDance');

    const reportsBefore = firmware.device.sentReports.length;
    const loaded = await dispatch(
      importLayoutFile(connected, {
        ...saved.file,
        layers: [['KC_B']],
        tapDance: [
          {tap: 'KC_ESC', hold: 'KC_NO', dtap: 'KC_NO', thold: 'KC_NO'},
        ],
      }),
    );

    expect(loaded).toEqual({ok: true});
    const commands = firmware.device.sentReports
      .slice(reportsBefore)
      .map(({data}) => data[0]);
    expect(commands).toContain(0x13);
    expect(
      commands.filter((command) => [0x07, 0x08, 0x09].includes(command)),
    ).toEqual([]);
    expect(firmware.menuReads).toBe(0);
  });

  // The file dialog opens before anything is read, so what would refuse the save
  // without waiting is checked first.
  test('a save that could not be completed is refused before the file dialog', async () => {
    const {store, dispatch, connected} =
      await prepareTapDance('tap-dance-unread');
    // An ERA board without State Sync reads its values at connect.
    setEraAdvancedMetadataForTesting({schemaVersion: 2, definitions: []});
    expect(
      getCustomMenuAvailabilityForDevice(store.getState() as any, connected),
    ).toBe('available');
    const tapDanceValues = Object.fromEntries(
      TAP_DANCE_ROLES.map((role) => [`id_qmk_tapdance_1_${role}`, [0, 0]]),
    );
    dispatch(
      updateSelectedCustomMenuData({
        devicePath: connected.path,
        menuData: tapDanceValues,
      }),
    );
    // Macros neither read nor readable on demand.
    expect(dispatch(canExportLayoutFile(connected))).toBe(false);
    await dispatch(loadMacros(connected));
    expect(dispatch(canExportLayoutFile(connected))).toBe(true);
    // A Tap Dance value the keyboard never reported.
    dispatch(
      updateSelectedCustomMenuData({devicePath: connected.path, menuData: {}}),
    );
    expect(dispatch(canExportLayoutFile(connected))).toBe(false);
  });

  // Firmware older than its definition can answer a Tap Dance value as unhandled,
  // and waiting will not change that answer. The save is refused before the file
  // dialog, not after a file has been chosen.
  test('a save is refused before the file dialog once the keyboard has refused its Tap Dance values', async () => {
    const {device, firmware, store, dispatch, connected} = await prepareCapable(
      'tap-dance-refused-save',
    );
    device.onSend = (data) => {
      if (data[0] === 0x08 && data[1] === 0x01 && data[2] === 0x01) {
        device.emit(payload(0xff, ...Array.from(data.slice(1))));
        return;
      }
      return firmware.onSend(data);
    };
    await dispatch(refreshStateSyncDomain(connected, 'config'));
    expect(
      getCustomMenuAvailabilityForDevice(store.getState() as any, connected),
    ).toBe('failed');

    expect(dispatch(canExportLayoutFile(connected))).toBe(false);
    expect(await dispatch(exportLayoutFile(connected))).toEqual({
      error: 'keyboard-not-ready',
    });
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

  // A control that never reports the end of its interaction would otherwise hold
  // the path, and every later write to the keyboard would wait behind it.
  test('an interaction left uncompleted is saved once when idle, freeing the path', async () => {
    const {store, connected, firmware, generation} =
      await prepareSelectedStateSyncDevice('continuous-idle', {withMenu: true});
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.customEvents = [];
    setContinuousIdleCompletionMsForTesting(150);

    await dispatch(updateCustomMenuRangeValueContinuous('id_test_value', 12));
    const later = dispatch(updateCustomMenuValue('id_test_value', 1, 1, 77));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(firmware.customEvents).toEqual(['set:12']);

    expect(await later).toBe(true);
    expect(firmware.customEvents).toEqual([
      'set:12',
      'save:1',
      'set:77',
      'save:1',
    ]);
    expect(
      hasContinuousHIDTransactionsForPath(connected.path, generation),
    ).toBe(false);
    // The control completing late sends nothing more.
    const events = [...firmware.customEvents];
    await dispatch(completeCustomMenuRangeValueContinuous('id_test_value'));
    expect(firmware.customEvents).toEqual(events);
  });

  test('a pressed pointer keeps an idle interaction open until it is released', async () => {
    const {store, connected, firmware} = await prepareSelectedStateSyncDevice(
      'continuous-idle-pressed',
      {withMenu: true},
    );
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.customEvents = [];
    setContinuousIdleCompletionMsForTesting(20);
    const pointer = (type: string) =>
      window.dispatchEvent(Object.assign(new Event(type), {pointerId: 3}));

    pointer('pointerdown');
    await dispatch(updateCustomMenuRangeValueContinuous('id_test_value', 12));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(firmware.customEvents).toEqual(['set:12']);

    pointer('pointerup');
    await waitUntil(() => firmware.customEvents.includes('save:1'), 400);
    expect(firmware.customEvents).toEqual(['set:12', 'save:1']);
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

  // No write goes out on a CONFIG snapshot that is no longer current. One asked for
  // meanwhile is not dropped: it waits for the re-read and goes out after it.
  const dirtyConfigWrite = async (path: string) => {
    const {store, connected, firmware, generation} =
      await prepareSelectedStateSyncDevice(path, {withMenu: true});
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

    firmware.holdNextMenuGet = true;
    const writing = dispatch(updateCustomMenuValue('id_test_value', 1, 1, 88));
    await waitUntil(() => firmware.heldMenuGetRequest !== undefined, 800);
    expect(firmware.customEvents).toEqual([]);
    return {store, firmware, writing};
  };

  test('a capable device with dirty CONFIG writes only after re-reading it', async () => {
    const {firmware, writing} = await dirtyConfigWrite('config-authority-dirty');

    firmware.releaseHeldMenuGet();

    expect(await writing).toBe(true);
    expect(firmware.customEvents).toEqual(['set:88', 'save:1']);
  });

  test('a write waiting for the CONFIG re-read is dropped once another keyboard is selected', async () => {
    const {store, firmware, writing} = await dirtyConfigWrite(
      'config-authority-reselected',
    );

    store.dispatch(selectDevice({device: null, connectionGeneration: null}));
    firmware.releaseHeldMenuGet();

    expect(await writing).toBe(false);
    expect(firmware.customEvents).toEqual([]);
  });
});

// The palette leaves out its Macro category only for a keyboard that has said it
// has no macros. A read that fails on the way must not take the category away.
describe('the palette Macro category', () => {
  const macroFirmware =
    (count: number, bufferSize: number) => (data: Uint8Array) => {
      switch (data[0]) {
        case 0x0d:
          return payload(0x0d, 0x00, bufferSize);
        case 0x0e:
          return payload(0x0e, data[1], data[2], data[3]);
        case 0x0c:
          return payload(0x0c, count);
      }
      return null;
    };

  const paletteMacroCount = async (
    path: string,
    protocol: number,
    answer: (data: Uint8Array) => Uint8Array | null,
  ) => {
    const {device} = await connectFake(path);
    device.onSend = (data) => {
      const reply = answer(data);
      if (reply) {
        device.emit(reply);
      }
    };
    const store = makeStore();
    const dispatch = store.dispatch as any;
    const connected = {...makeConnectedDevice(path, ORDINARY_VPID), protocol};
    dispatch(
      updateDefinitions({
        [ORDINARY_VPID]: {
          v3: {...makeV3Definition(), vendorProductId: ORDINARY_VPID},
        },
      } as any),
    );
    dispatch(updateConnectedDevices({[path]: connected}));
    const generation = new KeyboardAPI(path).getConnectionGeneration();
    dispatch(
      selectDevice({device: connected, connectionGeneration: generation}),
    );
    await dispatch(loadMacros(connected));
    return getPaletteMacroCount(store.getState() as any);
  };

  test('a keyboard with macros offers each slot', async () => {
    expect(
      await paletteMacroCount('palette-macros', 12, macroFirmware(4, 5)),
    ).toBe(4);
  });

  test('a keyboard that says it has none offers no Macro category', async () => {
    expect(
      await paletteMacroCount('palette-old-via', 7, () => null),
    ).toBeNull();
    expect(
      await paletteMacroCount('palette-zero-macros', 12, macroFirmware(0, 1)),
    ).toBeNull();
    expect(
      await paletteMacroCount('palette-unhandled-macros', 12, (data) => {
        const reply = payload(...data);
        reply[0] = 0xff;
        return reply;
      }),
    ).toBeNull();
  });

  test('a macro read that times out does not read as no macros', async () => {
    expect(
      await paletteMacroCount('palette-macro-timeout', 12, () => null),
    ).not.toBeNull();
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
  test('all QMK/H7S exact addresses preserve uint16 bounds through SET/SAVE/GET', async () => {
    const {device} = await connectFake('exact-full-range');
    const values = new Map<string, number>();
    device.onSend = (data) => {
      const key = `${data[1]}:${data[2]}`;
      const response = data.slice();
      if (data[0] === 0x07) values.set(key, (data[3] << 8) | data[4]);
      if (data[0] === 0x08) {
        const stored = values.get(key) ?? 200;
        response[3] = stored >> 8;
        response[4] = stored & 0xff;
      }
      device.emit(response);
    };
    const api = new KeyboardAPI('exact-full-range');
    const addresses = [[15, 5], ...Array.from({length: 8}, (_, i) => [16, 41 + i]),
      ...Array.from({length: 8}, (_, i) => [0, 72 + i])];
    for (const [channel, id] of addresses) {
      for (const value of [1, 99, 137, 500, 501, 1000, 32768, 65535]) {
        await api.setCustomMenuValue(channel, id, ...shiftFrom16Bit(value));
        await api.commitCustomMenu(channel);
        const response = await api.getCustomMenuValue([channel, id]);
        expect(shiftTo16Bit([response[1], response[2]])).toBe(value);
        expect(values.get(`${channel}:${id}`)).toBe(value);
      }
    }
    const writes = device.sentReports.filter(({data}) => data[0] === 0x07);
    expect(writes).toHaveLength(addresses.length * 8);
    expect(Array.from(writes.at(-1)!.data.slice(0, 5))).toEqual([0x07, 0, 79, 255, 255]);
  });

  test('old H7S rejection is not replaced by a legacy SET or clamped value', async () => {
    const {device} = await connectFake('exact-rejected');
    device.onSend = (data) => {
      const response = data.slice();
      response[0] = 0xff;
      device.emit(response);
    };
    const api = new KeyboardAPI('exact-rejected');
    await expect(api.setCustomMenuValue(15, 5, ...shiftFrom16Bit(501))).rejects.toThrow();
    expect(device.sentReports).toHaveLength(1);
    expect(Array.from(device.sentReports[0].data.slice(0, 5))).toEqual([0x07, 15, 5, 1, 245]);
  });

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

  test('SET success and SAVE failure is a failed write that keeps CONFIG dirty for readback', async () => {
    const {store, connected, firmware} = await prepareSelectedStateSyncDevice(
      'set-ok-save-fail',
      {withMenu: true},
    );
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    firmware.rejectNextCustomSave = true;
    expect(
      await dispatch(updateCustomMenuValue('id_test_value', 1, 1, 9)),
    ).toBe(false);
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

  // Firmware older than its definition answers a Custom Value it does not know
  // with id_unhandled, and reading CONFIG again cannot change that answer.
  test('a CONFIG value the firmware does not handle is read and logged once per revision', async () => {
    const {store, connected, firmware, generation} =
      await prepareSelectedStateSyncDevice('config-unhandled', {
        withMenu: true,
      });
    const dispatch = store.dispatch as any;
    const {device} = firmware;
    const isValueRead = (data: Uint8Array) =>
      data[0] === 0x08 && data[1] === 0x01 && data[2] === 0x01;
    device.onSend = (data) => {
      if (isValueRead(data)) {
        device.emit(payload(0xff, ...Array.from(data.slice(1))));
        return;
      }
      return firmware.onSend(data);
    };
    const valueReads = () =>
      device.sentReports.filter(({data}) => isValueRead(data)).length;
    // Entries about this refusal, whatever else the suite has logged.
    const errors = () =>
      getAppErrors(appStore.getState()).filter(
        ({message}) =>
          message.includes('Command: 8 1 1\n') ||
          message.includes('UnhandledCommandError'),
      );
    const sync = () => store.getState().stateSync.byPath[connected.path];
    appStore.dispatch(clearAppErrors());

    await dispatch(probeStateSyncForDevice(connected));
    // The same full refresh goes on to the domains after CONFIG.
    expect(sync()?.macro.status).toBe('fresh');
    dispatch(setConfigureVisible(true));
    for (let poll = 0; poll < 5; poll++) {
      await dispatch(pollStateSync());
    }
    // Coming back to the tab reads every domain again, but not this answer.
    await dispatch(refreshAllDomains(connected));

    expect(valueReads()).toBe(1);
    expect(errors()).toHaveLength(1);
    expect(errors()[0].message).toContain('Command Name: CUSTOM_MENU_GET_VALUE');
    expect(getSelectedCustomMenuAvailability(store.getState() as any)).toBe(
      'failed',
    );
    expect(getHIDTransportDebugState(connected.path)?.poisoned).toBe(false);
    expect(sync()?.keymap.status).toBe('fresh');
    expect(sync()?.macro.status).toBe('fresh');

    // A new revision, or a write to CONFIG, is worth one more read.
    firmware.revisions.config += 1;
    await dispatch(pollStateSync());
    await dispatch(pollStateSync());
    expect(valueReads()).toBe(2);
    expect(errors()).toHaveLength(2);
    dispatch(
      beginForegroundMutation({
        path: connected.path,
        generation,
        domains: ['config'],
      }),
    );
    await dispatch(pollStateSync());
    await dispatch(pollStateSync());
    expect(valueReads()).toBe(3);
    expect(getSelectedCustomMenuAvailability(store.getState() as any)).toBe(
      'failed',
    );

    // Choosing the keyboard again reads it again, as its selection does.
    dispatch(selectDevice({device: connected, connectionGeneration: generation}));
    dispatch(
      markDeviceReady({
        devicePath: connected.path,
        connectionGeneration: generation,
        selectionGeneration: store.getState().devices.selectionGeneration,
      }),
    );
    await dispatch(refreshStateSyncDomain(connected, 'config'));
    expect(valueReads()).toBe(4);
    expect(errors()).toHaveLength(4);

    // A new definition is read again too: it may not even hold that value.
    installEraDefinition(store, makeV3Definition(true, {shape: 'replaced'}));
    expect(getSelectedCustomMenuAvailability(store.getState() as any)).toBe(
      'checking',
    );
    await dispatch(refreshAfterDefinitionChange(TOMAK_VPID));
    expect(valueReads()).toBe(5);
    expect(errors()).toHaveLength(5);
    expect(getSelectedCustomMenuAvailability(store.getState() as any)).toBe(
      'failed',
    );
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


describe('Tap Dance timing capability before Custom GET', () => {
  test('reads advanced fields only after the mode reply advertises them', async () => {
    const {store, connected, firmware, generation} = await prepareSelectedStateSyncDevice('td-timing-capability');
    const definition = makeV3Definition(true);
    definition.menus[0].content[0].content = [
      {label: 'Mode', type: 'range', content: ['id_qmk_tapdance_1_mode', 0, 80], options: [0, 2]},
      {label: 'Hold', type: 'range', content: ['id_qmk_tapdance_1_hold_term', 0, 88], options: [0, 65535]},
      {label: 'Other', type: 'range', content: ['id_qmk_tapdance_1_hold_other', 0, 96], options: [0, 1]},
    ];
    installEraDefinition(store, definition);
    let capable = false;
    const reads: number[] = [];
    firmware.device.onSend = (data) => {
      if (data[0] === 0x08 && data[1] === 0 && [80, 88, 96].includes(data[2])) {
        reads.push(data[2]);
        if (data[2] === 80) firmware.device.emit(payload(0x08, 0, 80, 2, 0xd2, capable ? 0xd3 : 0));
        else if (!capable) firmware.device.emit(payload(0xff, ...Array.from(data.slice(1))));
        else if (data[2] === 88) firmware.device.emit(payload(0x08, 0, 88, 0, 180, 0xd3));
        else firmware.device.emit(payload(0x08, 0, 96, 1, 0xd3));
        return;
      }
      firmware.onSend(data);
    };
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    await dispatch(refreshStateSyncDomain(connected, 'config'));
    expect(reads.length).toBeGreaterThan(0);
    expect(reads).toEqual(reads.map(() => 80));
    expect(getCustomMenuAvailabilityForDevice(store.getState() as any, connected)).toBe('available');
    capable = true; reads.length = 0;
    await dispatch(syncCustomMenuValues(connected.path, generation, ['id_qmk_tapdance_1_hold_term']));
    expect(reads[0]).toBe(80);
    expect(reads).toContain(88);
    expect(store.getState().menus.customMenuDataMap[connected.path]?.id_qmk_tapdance_1_hold_term?.slice(0, 3)).toEqual([0, 180, 0xd3]);
  });
});


describe('asynchronous multi-value CONFIG reads', () => {
  test.each(['legacy', 'unhandled', 'mode-only', 'advanced'] as const)(
    '%s firmware loads settings when HID replies arrive after sendReport',
    async (support) => {
      const {store, connected, firmware, generation} =
        await prepareSelectedStateSyncDevice(`async-config-${support}`, {withMenu: true});
      const definition = makeV3Definition(true);
      const content = definition.menus[0].content[0].content;
      for (let slot = 1; slot <= 8; ++slot) {
        for (const [role, id, maximum] of [
          ['mode', 48 + slot, 2], ['hold_term', 56 + slot, 65535], ['hold_other', 64 + slot, 1],
          ['tap', (slot - 1) * 5 + 1, 65535], ['hold', (slot - 1) * 5 + 2, 65535],
          ['dtap', (slot - 1) * 5 + 3, 65535], ['thold', (slot - 1) * 5 + 4, 65535],
          ['term_exact', 40 + slot, 65535],
        ] as const) {
          content.push({label: role, type: 'range', content: [`id_qmk_tapdance_${slot}_${role}`, 16, id], options: [0, maximum]});
        }
      }
      installEraDefinition(store, definition);
      const emit = firmware.device.emit.bind(firmware.device);
      // WebHID delivers inputreport separately, after sendReport has returned.
      firmware.device.emit = (message) => {setTimeout(() => emit(message), 2);};
      firmware.device.onSend = (data) => {
        if (data[0] === 0x08 && data[1] === 16) {
          const id = data[2];
          if (id >= 49 && id <= 56 && support === 'unhandled') {
            firmware.device.emit(payload(0xff, ...Array.from(data.slice(1))));
            return;
          }
          const value = id >= 65 ? [1, 0xd3] : id >= 57 ? [0, 180, 0xd3] : id >= 49
            ? support === 'legacy' ? [0, 0, 0] : [2, 0xd2, support === 'advanced' ? 0xd3 : 0]
            : id >= 41 ? [0, 200] : [0, 43];
          firmware.device.emit(payload(0x08, 16, id, ...value));
          return;
        }
        firmware.onSend(data);
      };
      appStore.dispatch(clearAppErrors());
      const dispatch = store.dispatch as any;
      await dispatch(probeStateSyncForDevice(connected));
      await dispatch(refreshStateSyncDomain(connected, 'config'));
      expect(getAppErrors(appStore.getState())).toEqual([]);
      expect(getSelectedCustomMenuAvailability(store.getState() as any)).toBe('available');
      const menu = store.getState().menus.customMenuDataMap[connected.path]!;
      expect(menu.id_test_value?.[0]).toBe(0);
      for (let slot = 1; slot <= 8; ++slot) {
        expect(menu[`id_qmk_tapdance_${slot}_tap`]?.slice(0, 2)).toEqual([0, 43]);
        expect(menu[`id_qmk_tapdance_${slot}_term_exact`]?.slice(0, 2)).toEqual([0, 200]);
        expect(menu[`id_qmk_tapdance_${slot}_hold_term`]?.slice(0, 3)).toEqual(
          support === 'advanced' ? [0, 180, 0xd3] : [0, 0, 0],
        );
      }
      const advancedReads = firmware.device.sentReports.filter(({data}) => data[0] === 0x08 && data[1] === 16 && data[2] >= 57);
      expect(advancedReads.length > 0).toBe(support === 'advanced');
      expect(getHIDTransportDebugState(connected.path)).toMatchObject({hasPendingResponse: false, hasActiveReservation: false, poisoned: false});
      await dispatch(syncCustomMenuValues(connected.path, generation, ['id_qmk_tapdance_8_hold_term']));
      expect(getAppErrors(appStore.getState())).toEqual([]);
      expect(getSelectedCustomMenuAvailability(store.getState() as any)).toBe('available');
    },
  );
});

const prepareOrdinaryMenuReadDevice = async (path: string) => {
  const {device} = await connectFake(path);
  const connected = makeConnectedDevice(path, ORDINARY_VPID);
  const definition = {
    ...makeV3Definition(true),
    vendorProductId: ORDINARY_VPID,
  };
  definition.layouts.keys[0].li = undefined;
  definition.menus[0].content[0].content.push({
    label: 'Other',
    type: 'range',
    content: ['id_test_other', 1, 2],
    options: [0, 255],
  });
  const store = makeStore();
  const dispatch = store.dispatch as any;
  dispatch(updateDefinitions({[ORDINARY_VPID]: {v3: definition}} as any));
  dispatch(updateConnectedDevices({[path]: connected}));
  const api = new KeyboardAPI(path);
  const generation = api.getConnectionGeneration();
  dispatch(selectDevice({device: connected, connectionGeneration: generation}));
  dispatch(
    markDeviceReady({
      devicePath: path,
      connectionGeneration: generation,
      selectionGeneration: store.getState().devices.selectionGeneration,
    }),
  );
  dispatch(
    updateSelectedCustomMenuData({
      devicePath: path,
      menuData: {id_test_value: [1], id_test_other: [2]},
    }),
  );
  return {device, connected, store, dispatch, api, generation};
};

for (const target of ['other', 'same'] as const) {
  test(`legacy menu reads: 0x16 partial read preserves ${target} foreground SET`, async () => {
    const path = `audit-partial-${target}`;
    const {device, store, dispatch, api, generation} =
      await prepareOrdinaryMenuReadDevice(path);
    const values: Record<number, number> = {1: 1, 2: 2};
    let release: (() => void) | undefined;
    let firstGet = true;
    device.onSend = (data) => {
      if (data[0] === 0x08) {
        const observed = values[data[2]];
        if (firstGet) {
          firstGet = false;
          release = () =>
            device.emit(payload(0x08, data[1], data[2], observed));
        } else {
          device.emit(payload(0x08, data[1], data[2], observed));
        }
      } else if (data[0] === 0x07) {
        values[data[2]] = data[3];
        device.emit(data);
      } else if (data[0] === 0x09) {
        device.emit(data);
      }
    };
    let sync: Promise<void> | undefined;
    const remove = api.addUISyncRequestHandler((request) => {
      sync = dispatch(
        handleUISyncRequest({
          devicePath: path,
          connectionGeneration: generation,
          request,
        }),
      );
    });
    device.emit(payload(0x16, 1, 1, 1, 1, 1));
    await waitUntil(() => release !== undefined);
    const command = target === 'other' ? 'id_test_other' : 'id_test_value';
    const id = target === 'other' ? 2 : 1;
    const write = dispatch(updateCustomMenuValue(command, 1, id, 9));
    expect(store.getState().menus.customMenuDataMap[path][command][0]).toBe(9);
    release!();
    await sync;
    expect(await write).toBe(true);
    remove();
    expect(values[id]).toBe(9);
    expect(store.getState().menus.customMenuDataMap[path][command][0]).toBe(9);
  });
}

test('legacy menu reads: partial batch preserves newer explicit refresh of its earlier field', async () => {
  const path = 'audit-refresh-between-batch-reads';
  const {device, store, dispatch, generation} =
    await prepareOrdinaryMenuReadDevice(path);
  let releaseFirst: (() => void) | undefined;
  let firstValueRead = true;
  device.onSend = (data) => {
    if (data[0] !== 0x08) return;
    if (data[2] === 1 && firstValueRead) {
      firstValueRead = false;
      releaseFirst = () => device.emit(payload(0x08, 1, 1, 1));
    } else {
      device.emit(payload(0x08, data[1], data[2], data[2] === 1 ? 9 : 2));
    }
  };
  const sync = dispatch(
    syncCustomMenuValues(path, generation, ['id_test_value', 'id_test_other']),
  );
  await waitUntil(() => releaseFirst !== undefined);
  const refresh = dispatch(refreshCustomMenuValue('id_test_value'));
  releaseFirst!();
  await refresh;
  expect(store.getState().menus.customMenuDataMap[path].id_test_value[0]).toBe(
    9,
  );
  await sync;
  expect(store.getState().menus.customMenuDataMap[path].id_test_value[0]).toBe(
    9,
  );
});

test('legacy menu reads: full legacy load preserves later explicit refresh of an earlier field', async () => {
  const path = 'audit-refresh-between-full-load';
  const {device, store, dispatch, connected} =
    await prepareOrdinaryMenuReadDevice(path);
  let releaseFirst: (() => void) | undefined;
  let firstValueRead = true;
  device.onSend = (data) => {
    if (data[0] === 0x08) {
      if (data[2] === 1 && firstValueRead) {
        firstValueRead = false;
        releaseFirst = () => device.emit(payload(0x08, 1, 1, 1));
      } else {
        device.emit(payload(0x08, data[1], data[2], data[2] === 1 ? 9 : 2));
      }
    } else if (data[0] === 0x02 && data[1] === 0x12) {
      device.emit(data);
    }
  };
  const load = dispatch(updateV3MenuData(connected));
  await waitUntil(() => releaseFirst !== undefined);
  const refresh = dispatch(refreshCustomMenuValue('id_test_value'));
  releaseFirst!();
  await refresh;
  expect(store.getState().menus.customMenuDataMap[path].id_test_value[0]).toBe(
    9,
  );
  await load;
  expect(store.getState().menus.customMenuDataMap[path].id_test_value[0]).toBe(
    9,
  );
});

test('legacy menu reads: explicit GET cannot replace foreground SET of the same field', async () => {
  const path = 'audit-direct-read-vs-write';
  const {device, store, dispatch} = await prepareOrdinaryMenuReadDevice(path);
  let release: (() => void) | undefined;
  let firmwareValue = 1;
  let firstGet = true;
  device.onSend = (data) => {
    if (data[0] === 0x08) {
      const observed = firmwareValue;
      if (firstGet) {
        firstGet = false;
        release = () => device.emit(payload(0x08, data[1], data[2], observed));
      } else {
        device.emit(payload(0x08, data[1], data[2], observed));
      }
    } else if (data[0] === 0x07) {
      firmwareValue = data[3];
      device.emit(data);
    } else if (data[0] === 0x09) {
      device.emit(data);
    }
  };
  const refresh = dispatch(refreshCustomMenuValue('id_test_value'));
  await waitUntil(() => release !== undefined);
  const write = dispatch(updateCustomMenuValue('id_test_value', 1, 1, 9));
  expect(store.getState().menus.customMenuDataMap[path].id_test_value[0]).toBe(
    9,
  );
  release!();
  await refresh;
  expect(await write).toBe(true);
  expect(firmwareValue).toBe(9);
  expect(store.getState().menus.customMenuDataMap[path].id_test_value[0]).toBe(
    9,
  );
});

for (const kind of ['value', 'range'] as const) {
  test(`custom menu write lifetime: ${kind} waiting write preserves the definition lifetime it began in`, async () => {
    const path = `audit-authority-definition-${kind}`;
    const {store, connected, firmware, generation} =
      await prepareSelectedStateSyncDevice(path, {withMenu: true});
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    dispatch(
      setDomainStatus({path, generation, domain: 'config', status: 'dirty'}),
    );
    expect(getSelectedCustomMenuAvailability(store.getState() as any)).toBe(
      'reconciling',
    );
    const selection = store.getState().devices.selectionGeneration;
    const originalIdentity = getDefinitionSyncIdentity(
      store.getState() as any,
      connected,
    );
    let newValue = 0;
    firmware.device.onSend = (data) => {
      if (data[0] === 0x08 && data[1] === 1 && data[2] === 2) {
        firmware.device.emit(payload(0x08, 1, 2, newValue));
      } else if (data[0] === 0x07 && data[1] === 1 && data[2] === 2) {
        newValue = data[3];
        firmware.revisions.config++;
        firmware.device.emit(data);
      } else {
        firmware.onSend(data);
      }
    };
    const writing =
      kind === 'value'
        ? dispatch(updateCustomMenuValue('id_test_value', 1, 1, 88))
        : dispatch(updateCustomMenuRangeValue('id_test_value', 88));
    const replacement = makeV3Definition(true);
    replacement.menus[0].content[0].content[0].content = [
      'id_test_value',
      1,
      2,
    ];
    installEraDefinition(store, replacement);
    expect(store.getState().devices.selectionGeneration).toBe(selection);
    expect(
      getDefinitionSyncIdentity(store.getState() as any, connected),
    ).not.toBe(originalIdentity);
    const result = await writing;
    const writes = firmware.device.sentReports.filter(
      ({data}) => data[0] === 0x07,
    );
    expect(result).toBe(false);
    expect(writes).toHaveLength(0);
  });
}

test('custom menu write lifetime: a late overlapping definition fetch cancels a waiting write', async () => {
  const path = 'audit-authority-late-definition-fetch';
  const {device} = await connectFake(path);
  const firmware = new FakeStateSyncFirmware(device);
  const store = makeStore();
  const dispatch = store.dispatch as any;
  const connected = makeConnectedDevice(path, TOMAK_VPID);
  let finishEraJson:
    ((definition: ReturnType<typeof makeV3Definition>) => void) | undefined;
  let officialRequests = 0;
  let eraRequests = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes('/era/')) {
      eraRequests++;
      return eraRequests === 1
        ? ({
            ok: true,
            json: () =>
              new Promise<ReturnType<typeof makeV3Definition>>((resolve) => {
                finishEraJson = resolve;
              }),
          } as any)
        : ({ok: true, json: async () => makeV3Definition(true)} as any);
    }
    officialRequests++;
    return {ok: false} as any;
  }) as typeof fetch;
  try {
    // The second reload began before another completed reload installed the ERA
    // overlay. Its cached snapshot still allows it to replace the installed one.
    const lateReload = dispatch(reloadDefinitions([connected]));
    await waitUntil(() => finishEraJson !== undefined);
    await dispatch(reloadDefinitions([connected]));
    dispatch(updateConnectedDevices({[path]: connected}));
    const generation = new KeyboardAPI(path).getConnectionGeneration();
    dispatch(
      selectDevice({device: connected, connectionGeneration: generation}),
    );
    dispatch(
      markDeviceReady({
        devicePath: path,
        connectionGeneration: generation,
        selectionGeneration: store.getState().devices.selectionGeneration,
      }),
    );
    device.onSend = firmware.onSend;
    await dispatch(probeStateSyncForDevice(connected));
    dispatch(
      setDomainStatus({path, generation, domain: 'config', status: 'dirty'}),
    );
    const selection = store.getState().devices.selectionGeneration;
    const replacement = makeV3Definition(true);
    replacement.menus[0].content[0].content[0].content = [
      'id_test_value',
      1,
      2,
    ];
    let writing: Promise<boolean> | undefined;
    const nextSend = device.onSend;
    device.onSend = (data) => {
      if (data[0] === 0x08 && data[1] === 1 && data[2] === 2) {
        device.emit(payload(0x08, 1, 2, 0));
      } else {
        nextSend?.(data);
      }
    };
    const originalIdentity = getDefinitionSyncIdentity(
      store.getState() as any,
      connected,
    );
    // Completion jobs from the pending fetch are already queued when the input
    // asks for the authority read; both operations use the actual app thunks.
    finishEraJson!(replacement);
    for (let step = 0; step < 3; step++) await Promise.resolve();
    expect(getDefinitionSyncIdentity(store.getState() as any, connected)).toBe(
      originalIdentity,
    );
    writing = dispatch(updateCustomMenuValue('id_test_value', 1, 1, 88));
    await lateReload;
    const result = await writing;
    expect(store.getState().devices.selectionGeneration).toBe(selection);
    expect(officialRequests).toBe(2);
    expect(eraRequests).toBe(2);
    expect(result).toBe(false);
    expect(firmware.customSetCount).toBe(0);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

for (const kind of ['value', 'range'] as const) {
  test(`custom menu write lifetime: ${kind} queued write cannot outlive its definition before first SET`, async () => {
    const path = `audit-queued-definition-${kind}`;
    const {store, connected, firmware, generation} =
      await prepareSelectedStateSyncDevice(path, {withMenu: true});
    const dispatch = store.dispatch as any;
    await dispatch(probeStateSyncForDevice(connected));
    expect(getSelectedCustomMenuAvailability(store.getState() as any)).toBe(
      'available',
    );
    firmware.device.onSend = (data) => {
      if (data[0] === 0x08 && data[1] === 1 && data[2] === 2) {
        firmware.device.emit(payload(0x08, 1, 2, 0));
      } else {
        firmware.onSend(data);
      }
    };
    let acquired = false;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const busy = new KeyboardAPI(path).withPathReservation(
      generation,
      Symbol('queued-write-gate'),
      async () => {
        acquired = true;
        await gate;
      },
    );
    await waitUntil(() => acquired);
    const writing =
      kind === 'value'
        ? dispatch(updateCustomMenuValue('id_test_value', 1, 1, 88))
        : dispatch(updateCustomMenuRangeValue('id_test_value', 88));
    const replacement = makeV3Definition(true);
    replacement.menus[0].content[0].content[0].content = [
      'id_test_value',
      1,
      2,
    ];
    installEraDefinition(store, replacement);
    release!();
    await busy;
    const result = await writing;
    const writes = firmware.device.sentReports.filter(
      ({data}) => data[0] === 0x07,
    );
    expect(result).toBe(false);
    expect(writes).toHaveLength(0);
  });
}

test('legacy menu reads: a queued edit is normalized by GET after its SET reservation', async () => {
  const path = 'audit-menu-read-before-queued-write';
  const {device, store, dispatch, generation} =
    await prepareOrdinaryMenuReadDevice(path);
  let firmwareValue = 1;
  device.onSend = (data) => {
    if (data[0] === 0x08) {
      device.emit(payload(0x08, data[1], data[2], firmwareValue));
    } else if (data[0] === 0x07) {
      firmwareValue = data[3] + 2;
      device.emit(data);
    } else if (data[0] === 0x09) {
      device.emit(data);
    }
  };
  let acquired = false;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const busy = new KeyboardAPI(path).withPathReservation(
    generation,
    Symbol('queued-menu-read-gate'),
    async () => {
      acquired = true;
      await gate;
    },
  );
  await waitUntil(() => acquired);
  const sync = dispatch(
    syncCustomMenuValues(path, generation, ['id_test_value']),
  );
  const write = dispatch(updateCustomMenuValue('id_test_value', 1, 1, 9));
  release!();
  await busy;
  expect(await write).toBe(true);
  await sync;
  expect(firmwareValue).toBe(11);
  expect(store.getState().menus.customMenuDataMap[path].id_test_value[0]).toBe(
    11,
  );
  expect(device.sentReports.map(({data}) => data[0])).toEqual([
    0x07, 0x09, 0x08,
  ]);
});

test('custom menu write lifetime: a failed SET cannot roll back a newer SET of the same value', async () => {
  const path = 'audit-same-value-write-ownership';
  const {device, store, dispatch, generation} =
    await prepareOrdinaryMenuReadDevice(path);
  let releaseRejectedSet: (() => void) | undefined;
  let firstSet = true;
  let firmwareValue = 1;
  device.onSend = (data) => {
    if (data[0] === 0x07 && firstSet) {
      firstSet = false;
      const rejected = data.slice();
      rejected[0] = 0xff;
      releaseRejectedSet = () => device.emit(rejected);
    } else if (data[0] === 0x07) {
      firmwareValue = data[3];
      device.emit(data);
    } else if (data[0] === 0x09) {
      device.emit(data);
    }
  };
  const older = dispatch(updateCustomMenuValue('id_test_value', 1, 1, 9));
  await waitUntil(() => releaseRejectedSet !== undefined);
  const newer = dispatch(updateCustomMenuValue('id_test_value', 1, 1, 9));
  releaseRejectedSet!();
  expect(await older).toBe(false);
  expect(await newer).toBe(true);
  expect(new KeyboardAPI(path).getConnectionGeneration()).toBe(generation);
  expect(firmwareValue).toBe(9);
  expect(store.getState().menus.customMenuDataMap[path].id_test_value[0]).toBe(9);
});
