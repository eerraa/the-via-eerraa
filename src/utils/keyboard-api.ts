import type {Device, Keymap} from '../types/types';
import type {LightingValue, MatrixInfo} from '@the-via/reader';
import {logCommand} from './command-logger';
import {initAndConnectDevice} from './usb-hid';
import {store} from 'src/store/index';
import {
  extractDeviceInfo,
  getErrorTimestamp,
  getMessageFromError,
  logAppError,
  logKeyboardAPIError,
} from 'src/store/errorsSlice';
import {KeyboardValue} from './keyboard-values';
import {parseUISyncRequest, type UISyncRequest} from './ui-sync';
import type {
  HIDExchangeOptions,
  HIDPathReservationOwner,
  ResponseMatcher,
} from '../shims/node-hid';
export {KeyboardValue} from './keyboard-values';
export {
  parseUISyncRequest,
  UISyncRequestType,
  type UISyncCustomMenuCommandTarget,
  type UISyncRequest,
} from './ui-sync';

// VIA Command IDs

const COMMAND_START = 0x00; // This is really a HID Report ID
const PER_KEY_RGB_CHANNEL_COMMAND = [0, 1];

enum APICommand {
  GET_PROTOCOL_VERSION = 0x01,
  GET_KEYBOARD_VALUE = 0x02,
  SET_KEYBOARD_VALUE = 0x03,
  DYNAMIC_KEYMAP_GET_KEYCODE = 0x04,
  DYNAMIC_KEYMAP_SET_KEYCODE = 0x05,
  //  DYNAMIC_KEYMAP_CLEAR_ALL = 0x06,
  CUSTOM_MENU_SET_VALUE = 0x07,
  CUSTOM_MENU_GET_VALUE = 0x08,
  CUSTOM_MENU_SAVE = 0x09,

  EEPROM_RESET = 0x0a,
  BOOTLOADER_JUMP = 0x0b,
  DYNAMIC_KEYMAP_MACRO_GET_COUNT = 0x0c,
  DYNAMIC_KEYMAP_MACRO_GET_BUFFER_SIZE = 0x0d,
  DYNAMIC_KEYMAP_MACRO_GET_BUFFER = 0x0e,
  DYNAMIC_KEYMAP_MACRO_SET_BUFFER = 0x0f,
  DYNAMIC_KEYMAP_MACRO_RESET = 0x10,
  DYNAMIC_KEYMAP_GET_LAYER_COUNT = 0x11,
  DYNAMIC_KEYMAP_GET_BUFFER = 0x12,
  DYNAMIC_KEYMAP_SET_BUFFER = 0x13,
  DYNAMIC_KEYMAP_GET_ENCODER = 0x14,
  DYNAMIC_KEYMAP_SET_ENCODER = 0x15,

  UI_SYNC_REQUEST = 0x16,

  // DEPRECATED:
  BACKLIGHT_CONFIG_SET_VALUE = 0x07,
  BACKLIGHT_CONFIG_GET_VALUE = 0x08,
  BACKLIGHT_CONFIG_SAVE = 0x09,
}

const APICommandValueToName = Object.entries(APICommand).reduce(
  (acc: any, [key, value]) => ({...acc, [value]: key}),
  {} as Record<APICommand, string>,
);

// RGB Backlight Value IDs
// const BACKLIGHT_USE_SPLIT_BACKSPACE = 0x01;
// const BACKLIGHT_USE_SPLIT_LEFT_SHIFT = 0x02;
// const BACKLIGHT_USE_SPLIT_RIGHT_SHIFT = 0x03;
// const BACKLIGHT_USE_7U_SPACEBAR = 0x04;
// const BACKLIGHT_USE_ISO_ENTER = 0x05;
// const BACKLIGHT_DISABLE_HHKB_BLOCKER_LEDS = 0x06;
// const BACKLIGHT_DISABLE_WHEN_USB_SUSPENDEd = 0x07;
// const BACKLIGHT_DISABLE_AFTER_TIMEOUT = 0x08;
const BACKLIGHT_BRIGHTNESS = 0x09;
const BACKLIGHT_EFFECT = 0x0a;
// const BACKLIGHT_EFFECT_SPEED = 0x0b;
const BACKLIGHT_COLOR_1 = 0x0c;
const BACKLIGHT_COLOR_2 = 0x0d;
// const BACKLIGHT_CAPS_LOCK_INDICATOR_COLOR = 0x0e;
// const BACKLIGHT_CAPS_LOCK_INDICATOR_ROW_Col = 0x0f;
// const BACKLIGHT_LAYER_1_INDICATOR_COLOR = 0x10;
// const BACKLIGHT_LAYER_1_INDICATOR_ROW_COL = 0x11;
// const BACKLIGHT_LAYER_2_INDICATOR_COLOR = 0x12;
// const BACKLIGHT_LAYER_2_INDICATOR_ROW_COL = 0x13;
// const BACKLIGHT_LAYER_3_INDICATOR_COLOR = 0x14;
// const BACKLIGHT_LAYER_3_INDICATOR_ROW_COL = 0x15;
// const BACKLIGHT_ALPHAS_MODS = 0x16;
const BACKLIGHT_CUSTOM_COLOR = 0x17;
const MAX_VIA_BUFFER_PAYLOAD = 28;
const MACRO_CLOSE_VERIFICATION_DEADLINE_MS = 5000;
const MACRO_CLOSE_RETRY_DELAYS_MS = [25, 50, 100, 200] as const;
const MACRO_CLOSE_RETRY_CAP_MS = 250;

export const PROTOCOL_ALPHA = 7;
export const PROTOCOL_BETA = 8;
export const PROTOCOL_GAMMA = 9;

const cache: {[addr: string]: {hid: any}} = {};

const eqArr = <T>(arr1: T[], arr2: T[]) => {
  if (arr1.length !== arr2.length) {
    return false;
  }
  return arr1.every((val, idx) => arr2[idx] === val);
};

export const shiftTo16Bit = ([hi, lo]: [number, number]): number =>
  (hi << 8) | lo;

export const shiftFrom16Bit = (value: number): [number, number] => [
  value >> 8,
  value & 255,
];

const shiftBufferTo16Bit = (buffer: number[]): number[] => {
  const shiftedBuffer = [];
  for (let i = 0; i < buffer.length; i += 2) {
    shiftedBuffer.push(shiftTo16Bit([buffer[i], buffer[i + 1]]));
  }
  return shiftedBuffer;
};

const shiftBufferFrom16Bit = (buffer: number[]): number[] =>
  buffer.map(shiftFrom16Bit).flatMap((value) => value);

type Command = number;
type HIDAddress = string;
type Layer = number;
type Row = number;
type Column = number;

export const canConnect = (device: Device) => {
  try {
    new KeyboardAPI(device.path);
    return true;
  } catch (e) {
    console.error('Skipped ', device, e);
    return false;
  }
};

export class KeyboardAPI {
  kbAddr: HIDAddress;
  private reservationOwner?: HIDPathReservationOwner;
  private reservationGeneration?: number;

  constructor(path: string) {
    this.kbAddr = path;
    if (!cache[path]) {
      const device = initAndConnectDevice({path});
      cache[path] = {hid: device};
    }
  }

  private asReserved(
    owner: HIDPathReservationOwner,
    generation: number,
  ): KeyboardAPI {
    const api = new KeyboardAPI(this.kbAddr);
    api.reservationOwner = owner;
    api.reservationGeneration = generation;
    return api;
  }

  async withPathReservation<T>(
    expectedGeneration: number,
    owner: HIDPathReservationOwner,
    callback: (api: KeyboardAPI) => Promise<T>,
  ): Promise<T> {
    if (this.reservationOwner !== undefined) {
      if (
        this.reservationOwner !== owner ||
        this.reservationGeneration !== expectedGeneration
      ) {
        throw new Error('Cannot nest a different HID path reservation owner');
      }
      return callback(this);
    }
    return this.getHID().withPathReservation(
      expectedGeneration,
      owner,
      () => callback(this.asReserved(owner, expectedGeneration)),
    );
  }

  private async withAutomaticPathReservation<T>(
    callback: (api: KeyboardAPI) => Promise<T>,
  ): Promise<T> {
    if (this.reservationOwner !== undefined) {
      return callback(this);
    }
    const generation = this.getConnectionGeneration();
    return this.withPathReservation(generation, Symbol('via-operation'), callback);
  }

  refresh(kbAddr: HIDAddress) {
    this.kbAddr = kbAddr;
    cache[kbAddr] = {
      ...cache[kbAddr],
      hid: initAndConnectDevice({path: kbAddr}),
    };
  }

  async getProtocolVersion() {
    try {
      const [, hi, lo] = await this.hidCommand(APICommand.GET_PROTOCOL_VERSION);
      return shiftTo16Bit([hi, lo]);
    } catch (e) {
      return -1;
    }
  }

  async getKey(layer: Layer, row: Row, col: Column) {
    const buffer = await this.hidCommand(
      APICommand.DYNAMIC_KEYMAP_GET_KEYCODE,
      [layer, row, col],
    );
    return shiftTo16Bit([buffer[4], buffer[5]]);
  }

  async getLayerCount() {
    const version = await this.getProtocolVersion();
    if (version >= PROTOCOL_BETA) {
      const [, count] = await this.hidCommand(
        APICommand.DYNAMIC_KEYMAP_GET_LAYER_COUNT,
      );
      return count;
    }

    return 4;
  }

  async readRawMatrix(matrix: MatrixInfo, layer: number): Promise<Keymap> {
    const version = await this.getProtocolVersion();
    if (version >= PROTOCOL_BETA) {
      return this.fastReadRawMatrix(matrix, layer);
    }
    if (version === PROTOCOL_ALPHA) {
      return this.slowReadRawMatrix(matrix, layer);
    }
    throw new Error('Unsupported protocol version');
  }

  async getKeymapBuffer(offset: number, size: number): Promise<number[]> {
    if (size > 28) {
      throw new Error('Max data length is 28');
    }
    // id_dynamic_keymap_get_buffer <offset> <size> ^<data>
    // offset is 16bit. size is 8bit. data is 16bit keycode values, maximum 28 bytes.
    const res = await this.hidCommand(APICommand.DYNAMIC_KEYMAP_GET_BUFFER, [
      ...shiftFrom16Bit(offset),
      size,
    ]);
    return [...res].slice(4, size + 4);
  }

  async fastReadRawMatrix(
    {rows, cols}: MatrixInfo,
    layer: number,
  ): Promise<number[]> {
    const length = rows * cols;
    const MAX_KEYCODES_PARTIAL = 14;
    const result: number[] = [];
    for (let remaining = length; remaining > 0; ) {
      const keycodeCount = Math.min(MAX_KEYCODES_PARTIAL, remaining);
      const offset = layer * length * 2 + 2 * (length - remaining);
      result.push(
        ...shiftBufferTo16Bit(
          await this.getKeymapBuffer(offset, keycodeCount * 2),
        ),
      );
      remaining -= keycodeCount;
    }
    return result;
  }

  async slowReadRawMatrix(
    {rows, cols}: MatrixInfo,
    layer: number,
  ): Promise<number[]> {
    const length = rows * cols;
    const result: number[] = [];
    for (let index = 0; index < length; index++) {
      result.push(await this.getKey(layer, ~~(index / cols), index % cols));
    }
    return result;
  }

  async writeRawMatrix(
    matrixInfo: MatrixInfo,
    keymap: number[][],
  ): Promise<void> {
    return this.withAutomaticPathReservation(async (api) => {
      const version = await api.getProtocolVersion();
      if (version >= PROTOCOL_BETA) {
        return api.fastWriteRawMatrix(keymap);
      }
      if (version === PROTOCOL_ALPHA) {
        return api.slowWriteRawMatrix(matrixInfo, keymap);
      }
      throw new Error('Unsupported protocol version');
    });
  }

  async slowWriteRawMatrix(
    {cols}: MatrixInfo,
    keymap: number[][],
  ): Promise<void> {
    return this.withAutomaticPathReservation(async (api) => {
      for (let layerIdx = 0; layerIdx < keymap.length; layerIdx++) {
        for (let keyIdx = 0; keyIdx < keymap[layerIdx].length; keyIdx++) {
          await api.setKey(
            layerIdx,
            ~~(keyIdx / cols),
            keyIdx % cols,
            keymap[layerIdx][keyIdx],
          );
        }
      }
    });
  }

  async fastWriteRawMatrix(keymap: number[][]): Promise<void> {
    return this.withAutomaticPathReservation(async (api) => {
      const data = keymap.flatMap((layer) => layer.map((key) => key));
      const shiftedData = shiftBufferFrom16Bit(data);
      for (
        let offset = 0;
        offset < shiftedData.length;
        offset += MAX_VIA_BUFFER_PAYLOAD
      ) {
        const buffer = shiftedData.slice(
          offset,
          offset + MAX_VIA_BUFFER_PAYLOAD,
        );
        await api.hidCommand(APICommand.DYNAMIC_KEYMAP_SET_BUFFER, [
          ...shiftFrom16Bit(offset),
          buffer.length,
          ...buffer,
        ]);
      }
    });
  }

  async getKeyboardValue(
    command: KeyboardValue,
    parameters: number[],
    resultLength = 1,
  ): Promise<number[]> {
    const bytes = [command, ...parameters];
    const res = await this.hidCommand(APICommand.GET_KEYBOARD_VALUE, bytes);
    return res.slice(1 + bytes.length, 1 + bytes.length + resultLength);
  }

  async setKeyboardValue(command: KeyboardValue, ...rest: number[]) {
    const bytes = [command, ...rest];
    await this.hidCommand(APICommand.SET_KEYBOARD_VALUE, bytes);
  }

  async getEncoderValue(
    layer: number,
    id: number,
    isClockwise: boolean,
  ): Promise<number> {
    const bytes = [layer, id, +isClockwise];
    const res = await this.hidCommand(
      APICommand.DYNAMIC_KEYMAP_GET_ENCODER,
      bytes,
    );
    return shiftTo16Bit([res[4], res[5]]);
  }

  async setEncoderValue(
    layer: number,
    id: number,
    isClockwise: boolean,
    keycode: number,
  ): Promise<void> {
    const bytes = [layer, id, +isClockwise, ...shiftFrom16Bit(keycode)];
    await this.hidCommand(APICommand.DYNAMIC_KEYMAP_SET_ENCODER, bytes);
  }

  async getCustomMenuValue(commandBytes: number[]): Promise<number[]> {
    const res = await this.hidCommand(
      APICommand.CUSTOM_MENU_GET_VALUE,
      commandBytes,
      'CUSTOM_MENU_GET_VALUE',
    );
    return res.slice(0 + commandBytes.length);
  }

  async setCustomMenuValue(...args: number[]): Promise<void> {
    await this.hidCommand(
      APICommand.CUSTOM_MENU_SET_VALUE,
      args,
      'CUSTOM_MENU_SET_VALUE',
    );
  }

  async getPerKeyRGBMatrix(ledIndexMapping: number[]): Promise<number[][]> {
    const result: number[][] = [];
    for (const ledIndex of ledIndexMapping) {
      const response = await this.hidCommand(
        APICommand.CUSTOM_MENU_GET_VALUE,
        [
          ...PER_KEY_RGB_CHANNEL_COMMAND,
          ledIndex,
          1, // count
        ],
        'CUSTOM_MENU_GET_VALUE',
      );
      result.push([...response.slice(5, 7)]);
    }
    return result;
  }

  async setPerKeyRGBMatrix(
    index: number,
    hue: number,
    sat: number,
  ): Promise<void> {
    await this.hidCommand(
      APICommand.CUSTOM_MENU_SET_VALUE,
      [
        ...PER_KEY_RGB_CHANNEL_COMMAND,
        index,
        1, // count
        hue,
        sat,
      ],
      'CUSTOM_MENU_SET_VALUE',
    );
  }

  async getBacklightValue(
    command: LightingValue,
    resultLength = 1,
  ): Promise<number[]> {
    const bytes = [command];
    const res = await this.hidCommand(
      APICommand.BACKLIGHT_CONFIG_GET_VALUE,
      bytes,
    );
    return res.slice(2, 2 + resultLength);
  }

  async setBacklightValue(command: LightingValue, ...rest: number[]) {
    const bytes = [command, ...rest];
    await this.hidCommand(APICommand.BACKLIGHT_CONFIG_SET_VALUE, bytes);
  }

  async getRGBMode() {
    const bytes = [BACKLIGHT_EFFECT];
    const [, , val] = await this.hidCommand(
      APICommand.BACKLIGHT_CONFIG_GET_VALUE,
      bytes,
    );
    return val;
  }

  async getBrightness() {
    const bytes = [BACKLIGHT_BRIGHTNESS];
    const [, , brightness] = await this.hidCommand(
      APICommand.BACKLIGHT_CONFIG_GET_VALUE,
      bytes,
    );
    return brightness;
  }

  async getColor(colorNumber: number) {
    const bytes = [colorNumber === 1 ? BACKLIGHT_COLOR_1 : BACKLIGHT_COLOR_2];
    const [, , hue, sat] = await this.hidCommand(
      APICommand.BACKLIGHT_CONFIG_GET_VALUE,
      bytes,
    );
    return {hue, sat};
  }

  async setColor(colorNumber: number, hue: number, sat: number) {
    const bytes = [
      colorNumber === 1 ? BACKLIGHT_COLOR_1 : BACKLIGHT_COLOR_2,
      hue,
      sat,
    ];
    await this.hidCommand(APICommand.BACKLIGHT_CONFIG_SET_VALUE, bytes);
  }

  async getCustomColor(colorNumber: number) {
    const bytes = [BACKLIGHT_CUSTOM_COLOR, colorNumber];
    const [, , , hue, sat] = await this.hidCommand(
      APICommand.BACKLIGHT_CONFIG_GET_VALUE,
      bytes,
    );
    return {hue, sat};
  }

  async setCustomColor(colorNumber: number, hue: number, sat: number) {
    const bytes = [BACKLIGHT_CUSTOM_COLOR, colorNumber, hue, sat];
    await this.hidCommand(APICommand.BACKLIGHT_CONFIG_SET_VALUE, bytes);
  }

  async setRGBMode(effect: number) {
    const bytes = [BACKLIGHT_EFFECT, effect];
    await this.hidCommand(APICommand.BACKLIGHT_CONFIG_SET_VALUE, bytes);
  }

  async commitCustomMenu(channel: number) {
    await this.hidCommand(
      APICommand.CUSTOM_MENU_SAVE,
      [channel],
      'CUSTOM_MENU_SAVE',
    );
  }

  async saveLighting() {
    await this.hidCommand(APICommand.BACKLIGHT_CONFIG_SAVE);
  }

  async resetEEPROM() {
    await this.hidCommand(APICommand.EEPROM_RESET);
  }

  async jumpToBootloader() {
    await this.hidCommand(APICommand.BOOTLOADER_JUMP);
  }

  async setKey(layer: Layer, row: Row, column: Column, val: number) {
    const res = await this.hidCommand(APICommand.DYNAMIC_KEYMAP_SET_KEYCODE, [
      layer,
      row,
      column,
      ...shiftFrom16Bit(val),
    ]);
    return shiftTo16Bit([res[4], res[5]]);
  }

  async getMacroCount() {
    const [, count] = await this.hidCommand(
      APICommand.DYNAMIC_KEYMAP_MACRO_GET_COUNT,
    );
    return count;
  }

  // size is 16 bit
  async getMacroBufferSize() {
    const [, hi, lo] = await this.hidCommand(
      APICommand.DYNAMIC_KEYMAP_MACRO_GET_BUFFER_SIZE,
    );
    return shiftTo16Bit([hi, lo]);
  }

  // From protocol: id_dynamic_keymap_macro_get_buffer <offset> <size> ^<data>
  // offset is 16bit. size is 8bit.
  async getMacroBytes(): Promise<number[]> {
    return this.withAutomaticPathReservation(async (api) => {
      const macroBufferSize = await api.getMacroBufferSize();
      if (macroBufferSize < 1) {
        throw new Error('Macro buffer must contain a completion marker');
      }

      const logicalBytes: number[] = [];
      for (let offset = 0; offset < macroBufferSize; ) {
        const size = Math.min(
          MAX_VIA_BUFFER_PAYLOAD,
          macroBufferSize - offset,
        );
        logicalBytes.push(...(await api.getMacroBuffer(offset, size)));
        offset += size;
      }
      if (logicalBytes.length !== macroBufferSize) {
        throw new Error('Macro buffer response was shorter than requested');
      }
      if (logicalBytes[macroBufferSize - 1] !== 0) {
        throw new Error('Macro buffer write is incomplete');
      }
      return logicalBytes.slice(0, macroBufferSize - 1);
    });
  }

  private async getMacroBuffer(
    offset: number,
    size: number,
    responseTimeoutMs?: number,
  ): Promise<number[]> {
    if (size < 1 || size > MAX_VIA_BUFFER_PAYLOAD) {
      throw new Error('Macro buffer request size must be between 1 and 28');
    }
    const response = await this.hidCommand(
      APICommand.DYNAMIC_KEYMAP_MACRO_GET_BUFFER,
      [...shiftFrom16Bit(offset), size],
      undefined,
      responseTimeoutMs === undefined ? undefined : {responseTimeoutMs},
    );
    const bytes = response.slice(4, 4 + size);
    if (bytes.length !== size) {
      throw new Error('Macro buffer response was shorter than requested');
    }
    return bytes;
  }

  // From protocol: id_dynamic_keymap_macro_set_buffer <offset> <size> <data>
  // offset is 16bit. size is 8bit. data is ASCII characters and null (0x00) delimiters/terminator, maximum 28 bytes.
  // async setMacros(macros: Macros[]) {
  async setMacroBytes(data: number[]): Promise<void> {
    return this.withAutomaticPathReservation(async (api) => {
      const macroBufferSize = await api.getMacroBufferSize();
      if (macroBufferSize < 1) {
        throw new Error('Macro buffer must contain a completion marker');
      }
      const payloadCapacity = macroBufferSize - 1;
      if (data.length > payloadCapacity) {
        throw new Error(
          `Macro size (${data.length}) exceeds payload capacity (${payloadCapacity})`,
        );
      }

      const markerOffset = macroBufferSize - 1;

      // RESET is a standalone mutation. A failed RESET/opener/payload must never
      // be followed by the final zero marker.
      await api.resetMacros();
      // set last byte in buffer to non-zero (0xFF) to indicate write-in-progress
      await api.hidCommand(APICommand.DYNAMIC_KEYMAP_MACRO_SET_BUFFER, [
        ...shiftFrom16Bit(markerOffset),
        1,
        0xff,
      ]);

      for (
        let offset = 0;
        offset < data.length;
        offset += MAX_VIA_BUFFER_PAYLOAD
      ) {
        const buffer = data.slice(offset, offset + MAX_VIA_BUFFER_PAYLOAD);
        await api.hidCommand(APICommand.DYNAMIC_KEYMAP_MACRO_SET_BUFFER, [
          ...shiftFrom16Bit(offset),
          buffer.length,
          ...buffer,
        ]);
      }

      await api.hidCommand(APICommand.DYNAMIC_KEYMAP_MACRO_SET_BUFFER, [
        ...shiftFrom16Bit(markerOffset),
        1,
        0x00,
      ]);
      const closeAcknowledgedAt = Date.now();
      let retry = 0;
      let isImmediateRead = true;
      while (true) {
        const remaining =
          MACRO_CLOSE_VERIFICATION_DEADLINE_MS -
          (Date.now() - closeAcknowledgedAt);
        if (!isImmediateRead && remaining <= 0) {
          throw new Error('Macro completion marker verification timed out');
        }
        const [marker] = await api.getMacroBuffer(
          markerOffset,
          1,
          Math.max(1, remaining),
        );
        isImmediateRead = false;
        if (marker === 0) {
          return;
        }

        const elapsed = Date.now() - closeAcknowledgedAt;
        if (elapsed >= MACRO_CLOSE_VERIFICATION_DEADLINE_MS) {
          throw new Error('Macro completion marker verification timed out');
        }
        const delay =
          MACRO_CLOSE_RETRY_DELAYS_MS[retry] ?? MACRO_CLOSE_RETRY_CAP_MS;
        retry += 1;
        await api.timeout(
          Math.min(delay, MACRO_CLOSE_VERIFICATION_DEADLINE_MS - elapsed),
        );
      }
    });
  }

  async resetMacros() {
    await this.hidCommand(APICommand.DYNAMIC_KEYMAP_MACRO_RESET);
  }

  async timeout(time: number) {
    return this.getHID().enqueueDelay(time, {
      reservationOwner: this.reservationOwner,
      expectedGeneration: this.reservationGeneration,
    });
  }

  isCommandQueueIdle() {
    return this.getHID().isCommandQueueIdle();
  }

  async waitForCommandQueueIdle() {
    await this.getHID().waitForCommandQueueIdle();
  }

  async hidCommand(
    command: Command,
    bytes: Array<number> = [],
    commandName?: string,
    options?: HIDExchangeOptions,
  ): Promise<number[]> {
    try {
      return await this._hidCommand(command, bytes, commandName, options);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      const deviceInfo = extractDeviceInfo(this.getHID());
      store.dispatch(
        logAppError({
          message: getMessageFromError(error),
          deviceInfo,
        }),
      );
      throw e;
    }
  }

  getHID() {
    return cache[this.kbAddr].hid;
  }

  getConnectionGeneration(): number {
    return this.getHID().getConnectionGeneration();
  }

  isConnectionGenerationCurrent(generation: number): boolean {
    return this.getHID().isConnectionGenerationCurrent(generation);
  }

  addUISyncRequestHandler(handler: (request: UISyncRequest) => void) {
    return this.getHID().addInputReportHandler(
      (buffer: Uint8Array) => parseUISyncRequest(buffer) !== undefined,
      (buffer: Uint8Array) => {
        const request = parseUISyncRequest(buffer);
        if (request) {
          handler(request);
        }
      },
    );
  }

  async exchangeHID(
    report: number[],
    matches: ResponseMatcher,
    options?: HIDExchangeOptions,
  ): Promise<Uint8Array> {
    return this.getHID().exchange(report, matches, {
      ...options,
      reservationOwner: this.reservationOwner,
      expectedGeneration: this.reservationGeneration,
    });
  }

  async _hidCommand(
    command: Command,
    bytes: Array<number> = [],
    commandName?: string,
    options?: HIDExchangeOptions,
  ): Promise<any> {
    const commandBytes = [...[COMMAND_START, command], ...bytes];
    const paddedArray = new Array(33).fill(0);
    commandBytes.forEach((val, idx) => {
      paddedArray[idx] = val;
    });

    const requestBytes = commandBytes.slice(1);
    const response = (await this.exchangeHID(
      paddedArray,
      (message: Uint8Array) =>
        message.length === 32 &&
        eqArr(requestBytes, Array.from(message.slice(0, requestBytes.length))),
      options,
    )) as Uint8Array;
    const buffer = Array.from(response);
    const bufferCommandBytes = buffer.slice(0, requestBytes.length);
    logCommand(this.kbAddr, commandBytes, buffer);
    if (!eqArr(requestBytes, bufferCommandBytes)) {
      console.error(
        `Command for ${this.kbAddr}:`,
        commandBytes,
        'Bad Resp:',
        buffer,
      );

      const deviceInfo = extractDeviceInfo(this.getHID());
      store.dispatch(
        logKeyboardAPIError({
          commandName: commandName ?? APICommandValueToName[command],
          commandBytes: commandBytes.slice(1),
          responseBytes: buffer,
          deviceInfo,
        }),
      );

      throw new Error('Receiving incorrect response for command');
    }
    return buffer;
  }
}
