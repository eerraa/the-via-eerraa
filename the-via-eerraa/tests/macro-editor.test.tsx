import {afterAll, afterEach, beforeAll, describe, expect, test} from 'bun:test';
import {configureStore} from '@reduxjs/toolkit';
import {
  faCircle,
  faClapperboard,
  faCode,
  faSquare,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import i18n from 'i18next';
import {Provider} from 'react-redux';
import {I18nextProvider} from 'react-i18next';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';
import {
  configureHIDTransport,
  disconnectHIDDeviceForTesting,
  HID,
  registerHIDDeviceForTesting,
  resetHIDTransportForTesting,
} from '../src/shims/node-hid';
import ko from '../src/locales/ko.json';
import type {ConnectedDevice} from '../src/types/types';
import type {KeyboardAPI} from '../src/utils/keyboard-api';
import {ERA_WIRE as W} from '../src/utils/era-wire.generated';
import {
  GroupedKeycodeSequenceAction as Grouped,
  RawKeycodeSequenceAction as Action,
  type RawKeycodeSequence,
} from '../src/utils/macro-api/types';

const originalWarn = console.warn;
console.warn = () => undefined;
const modules = await (async () => {
  try {
    await import('../src/utils/keyboard-api');
    return {
      pane: await import('../src/components/panes/configure-panes/macros'),
      viewport: await import('../src/components/panes/configure-panes/submenus/macros/macro-event-viewport'),
      devices: await import('../src/store/devicesSlice'),
      macros: await import('../src/store/macrosSlice'),
      firmware: await import('../src/store/firmwareSlice'),
      settings: await import('../src/store/settingsSlice'),
      stateSync: await import('../src/store/stateSyncSlice'),
      candidates: await import('../src/store/stateSyncCandidateActions'),
      drafts: await import('../src/store/draftsSlice'),
      configurePlace: await import('../src/store/configurePlaceSlice'),
      macroApi: await import('../src/utils/macro-api'),
      common: await import('../src/utils/macro-api/macro-api.common'),
      recordingPreview: await import('../src/utils/macro-recording-preview'),
      definitions: await import('../src/store/definitionsSlice'),
      menus: await import('../src/store/menusSlice'),
      macroOptions: await import('../src/store/macroOptionsSlice'),
      metadata: await import('../src/utils/era-advanced-metadata'),
    };
  } finally {
    console.warn = originalWarn;
  }
})();
const {
  pane,
  devices,
  macros,
  firmware,
  settings,
  stateSync,
  candidates,
  drafts,
  configurePlace,
  macroApi: {getMacroAPI},
  common: {checkMacroDraft, expressionToRawSequence},
  recordingPreview: {createMacroRecordingPreview, getMacroRecordingPreviewStart},
  definitions,
  menus,
  macroOptions,
  metadata,
} = modules;
const translations = i18n.createInstance();
await translations.init({lng: 'ko', resources: {ko: {translation: ko}}});
const macroApiFor = (protocol: number) =>
  getMacroAPI(protocol, protocol >= 13 ? 9 : undefined, {} as KeyboardAPI);
const macroBytes = (...expressions: string[]) =>
  macroApiFor(12).rawKeycodeSequencesToMacroBytes(
    expressions.map(expressionToRawSequence),
  );

describe('macro values', () => {
  test('rejects unplayable input and normalizes values as the keyboard reads them', () => {
    const api = macroApiFor(12);
    for (const [value, problem] of [
      ['é', {type: 'untypeable'}],
      ['A\u0000B', {type: 'untypeable'}],
      ['{KC_A', {type: 'unclosed'}],
      ['{}', {type: 'empty'}],
      ['{+}', {type: 'empty'}],
      ['{,}', {type: 'empty'}],
      ['{+KC_A,KC_B}', {type: 'single-key'}],
      ['{KC_NO}', {type: 'unknown-keys', keys: ['KC_NO']}],
      ['{ +KC_A }', {type: 'unknown-keys', keys: ['+KC_A']}],
      ['{KC_KP_ASTERISK}', {type: 'unknown-keys', keys: ['KC_KP_ASTERISK']}],
      [
        '{_QK_LAYER_MOD_MASK}',
        {type: 'unknown-keys', keys: ['_QK_LAYER_MOD_MASK']},
      ],
    ] as const) {
      expect(checkMacroDraft(api, value).problem).toEqual(problem);
    }
    for (const [value, stored] of [
      ['{KC_LCTL, KC_C}', '{KC_LCTL,KC_C}'],
      ['{kc_a}', '{KC_A}'],
      ['{0100}', '{100}'],
      ['{KC_CLEAR}', '{KC_CLR}'],
      ['{15000}', '{9999}{5001}'],
      ['ls -la\n', 'ls -la\n'],
    ]) {
      expect(checkMacroDraft(api, value)).toMatchObject({stored});
      expect(checkMacroDraft(api, stored).problem).toBeUndefined();
    }
    expect(checkMacroDraft(macroApiFor(10), 'a{100}').problem).toEqual({
      type: 'unknown-keys',
      keys: ['100'],
    });
    expect(checkMacroDraft(macroApiFor(11), 'a{100}').problem).toBeUndefined();
  });

  test('all named key bytes can be saved again across supported VIA protocols', () => {
    for (const protocol of [9, 10, 11, 12, 13]) {
      const api = macroApiFor(protocol);
      const tap = protocol >= 11 ? [1, 1] : [1];
      for (let byte = 1; byte <= 0xff; byte++) {
        const [[[, key]]] = api.macroBytesToRawKeycodeSequences(
          [...tap, byte, 0],
          1,
        );
        if (key !== undefined)
          expect(checkMacroDraft(api, `{${key}}x`).problem).toBeUndefined();
      }
      expect(checkMacroDraft(api, 'a'.repeat(1_000_000)).byteCount).toBe(
        1_000_001,
      );
    }
  });
});

describe('macro provenance', () => {
  test('retains both text origins when deleting the intervening key', () => {
    const trace = modules.common.transformMacroSequenceTracked(
      [[Action.CharacterStream, 'a'], [Action.CharacterStream, 'b']],
      [[0], [2]],
    );
    expect(trace.expression).toBe('ab');
    expect(trace.sequence).toEqual([[Action.CharacterStream, 'ab']]);
    expect(trace.origins).toEqual([[0, 2]]);
    expect(trace.ranges).toEqual([
      {start: 0, end: 1, origins: [0]},
      {start: 1, end: 2, origins: [2]},
    ]);
  });

  test('unions adjacent waits including the edited second wait', () => {
    const trace = modules.common.transformMacroSequenceTracked([
      [Action.Delay, 10],
      [Action.Delay, 25],
      [Action.Delay, 5],
    ]);
    expect(trace.expression).toBe('{40}');
    expect(trace.sequence).toEqual([[Action.Delay, 40]]);
    expect(trace.origins).toEqual([[0, 1, 2]]);
    expect(trace.ranges).toEqual([
      {start: 0, end: 4, origins: [0, 1, 2]},
    ]);
  });

  test('attributes each generated backslash tap without shifting a later wait', () => {
    const trace = modules.common.transformMacroSequenceTracked([
      [Action.CharacterStream, 'a\\'],
      [Action.CharacterStream, '\\'],
      [Action.Tap, 'KC_A'],
      [Action.Delay, 20],
    ]);
    expect(trace.expression).toBe('a{KC_BSLS}{KC_BSLS}{KC_A}{20}');
    expect(trace.sequence).toEqual([
      [Action.CharacterStream, 'a'],
      [Action.Tap, 'KC_BSLS'],
      [Action.Tap, 'KC_BSLS'],
      [Action.Tap, 'KC_A'],
      [Action.Delay, 20],
    ]);
    expect(trace.origins).toEqual([[0], [0], [1], [2], [3]]);
    expect(trace.ranges).toEqual([
      {start: 0, end: 1, origins: [0]},
      {start: 1, end: 10, origins: [0]},
      {start: 10, end: 19, origins: [1]},
      {start: 19, end: 25, origins: [2]},
      {start: 25, end: 29, origins: [3]},
    ]);
  });

  test('uses UTF-16 escaped text ranges and actual scanner token boundaries', () => {
    const trace = modules.common.transformMacroSequenceTracked([
      [Action.CharacterStream, '😀{'],
      [Action.CharacterStream, 'z'],
      [Action.Down, 'KC_A'],
      [Action.Up, 'KC_A'],
    ]);
    expect(trace.expression).toBe('😀\\{z{+KC_A}{-KC_A}');
    expect(trace.sequence).toEqual([
      [Action.CharacterStream, '😀{z'],
      [Action.Down, 'KC_A'],
      [Action.Up, 'KC_A'],
    ]);
    expect(trace.origins).toEqual([[0, 1], [2], [3]]);
    expect(trace.ranges).toEqual([
      {start: 0, end: 4, origins: [0]},
      {start: 4, end: 5, origins: [1]},
      {start: 5, end: 12, origins: [2]},
      {start: 12, end: 19, origins: [3]},
    ]);
    expect(modules.common.splitExpressionTracked('a\\{b{10}{KC_A}')).toEqual([
      {value: 'a\\{b', start: 0, end: 4},
      {value: '{10}', start: 4, end: 8},
      {value: '{KC_A}', start: 8, end: 14},
    ]);
  });

  test('projects taps and chords back onto actual saved down/up events', () => {
    const saved: RawKeycodeSequence = [
      [Action.Down, 'KC_A'],
      [Action.Up, 'KC_A'],
      [Action.Down, 'KC_LCTL'],
      [Action.Down, 'KC_C'],
      [Action.Up, 'KC_C'],
      [Action.Up, 'KC_LCTL'],
      [Action.Delay, 10],
    ];
    const projection = modules.common.projectSavedMacroSequenceTracked(saved);
    expect(projection.expression).toBe('{KC_A}{KC_LCTL,KC_C}{10}');
    expect(projection.expression).toBe(
      modules.common.sequenceToExpression(
        modules.common.rawSequenceToOptimizedSequence(saved),
      ),
    );
    expect(projection.ranges).toEqual([
      {start: 0, end: 6, origins: [0, 1]},
      {start: 6, end: 20, origins: [2, 3, 4, 5]},
      {start: 20, end: 24, origins: [6]},
    ]);
    const edit = modules.common.transformMacroSequenceTracked([
      [Action.Tap, 'KC_A'],
      [Grouped.Chord, ['KC_LCTL', 'KC_C']],
      [Action.Delay, 10],
    ], [[10], [11], [12]]);
    expect(modules.common.mapMacroExpressionOrigins(edit, projection, saved.length))
      .toEqual([[10], [10], [11], [11], [11], [11], [12]]);
    expect(() => modules.common.mapMacroExpressionOrigins(
      {...edit, expression: 'different'},
      projection,
      saved.length,
    )).toThrow('Macro expressions must match');
    expect(saved).toEqual([
      [Action.Down, 'KC_A'],
      [Action.Up, 'KC_A'],
      [Action.Down, 'KC_LCTL'],
      [Action.Down, 'KC_C'],
      [Action.Up, 'KC_C'],
      [Action.Up, 'KC_LCTL'],
      [Action.Delay, 10],
    ]);
  });
});

type Listener = (event: {data: DataView}) => void;
class MacroKeyboard {
  vendorId = 0x4552;
  productId = 0x7e57;
  productName = 'Macro keyboard';
  collections = [{usagePage: 0xff60, usage: 0x61}];
  opened = false;
  listeners = new Set<Listener>();
  commands: number[] = [];
  requests: number[][] = [];
  buffer: number[];
  refuseReset = false;
  eraReplace = false;
  // MACRO_OPTIONS on the EERRAA channel; id_unhandled while unset.
  macroOptions?: {
    supported: number;
    options: {flags: number; holdMs: number; repeatCount: number}[];
  };
  macroOptionsVersion = 2;
  refuseOptionsFlags = false;
  refuseOptionsHold = false;
  refuseOptionsSave = false;
  eraOperations: number[] = [];
  private replacement: number[] = [];
  private replacementCRC: number[] = [];
  private replacementLength = 0;
  constructor(
    size: number,
    contents: number[],
    readonly macroCount: number,
  ) {
    this.buffer = Array.from(
      {length: size},
      (_, index) => contents[index] ?? 0,
    );
  }
  async open() {
    this.opened = true;
  }
  async close() {
    this.opened = false;
  }
  async forget() {
    this.opened = false;
  }
  addEventListener(type: string, listener: Listener) {
    if (type === 'inputreport') this.listeners.add(listener);
  }
  removeEventListener(_type: string, listener: Listener) {
    this.listeners.delete(listener);
  }
  async sendReport(_reportId: number, data: Uint8Array) {
    const request = Array.from(data);
    const reply = request.slice();
    const [command] = request;
    const offset = (request[1] << 8) | request[2];
    const size = request[3];
    this.commands.push(command);
    this.requests.push(request);
    if (request[1] === W.CHANNELS_EERRAA.MACRO_OPTIONS && command >= 7 && command <= 9) {
      const [, , id, index] = request;
      const options = this.macroOptions;
      const entry = options?.options[index];
      if (
        !options ||
        (command !== 9 && id !== W.MACRO_OPTIONS.CAPABILITIES && !entry) ||
        (command === 7 && id === W.MACRO_OPTIONS.FLAGS && this.refuseOptionsFlags) ||
        (command === 7 && id === W.MACRO_OPTIONS.HOLD_MS && this.refuseOptionsHold) ||
        (command === 9 && this.refuseOptionsSave)
      ) {
        reply[0] = 0xff;
      } else if (command === 8 && id === W.MACRO_OPTIONS.CAPABILITIES) {
        reply.splice(3, 6, this.macroOptionsVersion, options.supported, 0x45, 0x4d, 0x4f, 0x31);
      } else if (command === 8) {
        reply.splice(4, 2, ...(id === W.MACRO_OPTIONS.FLAGS
          ? [entry!.flags, 0]
          : id === W.MACRO_OPTIONS.REPEAT_COUNT
            ? [entry!.repeatCount, 0]
            : [entry!.holdMs >>> 8, entry!.holdMs & 0xff]));
      } else if (command === 7 && id === W.MACRO_OPTIONS.FLAGS) {
        entry!.flags = request[4];
      } else if (command === 7 && id === W.MACRO_OPTIONS.REPEAT_COUNT) {
        entry!.repeatCount = request[4];
      } else if (command === 7) {
        entry!.holdMs = (request[4] << 8) | request[5];
      }
    } else if (this.eraReplace && request[1] === W.CHANNELS_EERRAA.MACRO_REPLACE &&
        (command === 7 || command === 8)) {
      const op = request[2];
      if (op === W.MACRO_REPLACE.CAPABILITIES) {
        reply.splice(3, 8, 1, 17, (this.buffer.length - 1) >>> 8,
          (this.buffer.length - 1) & 0xff, 69, 77, 82, 49);
      } else {
        this.eraOperations.push(op);
        if (op === W.MACRO_REPLACE.BEGIN) {
          this.replacement = [];
          this.replacementLength = (request[11] << 8) | request[12];
          this.replacementCRC = request.slice(13, 17);
        } else if (op === W.MACRO_REPLACE.DATA) {
          this.replacement.push(...request.slice(14, 14 + request[13]));
        } else if (op === W.MACRO_REPLACE.COMMIT) {
          this.buffer.fill(0);
          this.buffer.splice(0, this.replacement.length, ...this.replacement);
          reply.splice(24, 4, ...this.replacementCRC);
          reply[28] = this.replacementLength >>> 8;
          reply[29] = this.replacementLength & 0xff;
          reply[30] = 2;
        }
      }
      reply[31] = W.MACRO_REPLACE_RESULT.OK;
    } else if (command === 0x0c) reply[1] = this.macroCount;
    else if (command === 0x0d) {
      reply[1] = this.buffer.length >> 8;
      reply[2] = this.buffer.length & 0xff;
    } else if (command === 0x0e)
      reply.splice(4, size, ...this.buffer.slice(offset, offset + size));
    else if (command === 0x0f)
      this.buffer.splice(offset, size, ...request.slice(4, 4 + size));
    else if (command === 0x10) {
      if (this.refuseReset) reply[0] = 0xff;
      else this.buffer.fill(0);
    }
    const message = Uint8Array.from(reply.slice(0, 32));
    this.listeners.forEach((listener) =>
      listener({data: new DataView(message.buffer)}),
    );
  }
}

const page = {
  fullscreen: false,
  refuseFullscreen: false,
  listeners: new Set<() => void>(),
  keyboard: [] as string[],
};
const setFullscreen = (fullscreen: boolean) => {
  page.fullscreen = fullscreen;
  page.listeners.forEach((listener) => listener());
};
const bounds = () => ({
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
});
const inertWindow = {
  setTimeout,
  clearTimeout,
  performance,
  requestAnimationFrame: (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0),
  cancelAnimationFrame: clearTimeout,
};
const inertElement = () => {
  const listeners = new Map<string, Set<() => void>>();
  const element = {
  style: {} as Record<string, string>,
  classList: {add: () => undefined, remove: () => undefined},
  getBoundingClientRect: bounds,
  ownerDocument: {defaultView: inertWindow},
  querySelectorAll: () => [],
  querySelector: () => null,
  appendChild: () => undefined,
  removeChild: () => undefined,
  contains: () => true,
  addEventListener: (type: string, listener: () => void) => {
    const registered = listeners.get(type) ?? new Set();
    registered.add(listener);
    listeners.set(type, registered);
  },
  removeEventListener: (type: string, listener: () => void) => {
    listeners.get(type)?.delete(listener);
  },
  focus: () => undefined,
  scrollTop: 0,
  scrollHeight: 240,
  clientWidth: 0,
  clientHeight: 0,
  scrollTo: ({top}: {top?: number}) => {
    if (top === undefined || element.scrollTop === top) return;
    element.scrollTop = top;
    listeners.get('scroll')?.forEach((listener) => listener());
  },
  offsetTop: 0,
  offsetLeft: 0,
  };
  return element;
};
const documentElement = {
  addEventListener: (type: string, listener: () => void) => {
    if (type === 'fullscreenchange') page.listeners.add(listener);
  },
  removeEventListener: (_type: string, listener: () => void) => {
    page.listeners.delete(listener);
  },
  requestFullscreen: async () => {
    if (page.refuseFullscreen) throw new Error('Fullscreen was refused');
    setFullscreen(true);
  },
};
const body = inertElement();
const originalDocument = Object.getOwnPropertyDescriptor(
  globalThis,
  'document',
);
const originalKeyboard = Object.getOwnPropertyDescriptor(navigator, 'keyboard');
const originalComputedStyle = Object.getOwnPropertyDescriptor(
  globalThis,
  'getComputedStyle',
);
beforeAll(() => {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      get fullscreenElement() {
        return page.fullscreen ? documentElement : null;
      },
      documentElement,
      exitFullscreen: async () => setFullscreen(false),
      body,
      createElement: inertElement,
      querySelector: () => body,
    },
  });
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: () => ({getPropertyValue: () => '0', paddingBottom: '0px'}),
  });
  Object.defineProperty(navigator, 'keyboard', {
    configurable: true,
    value: {
      lock: async () => {
        page.keyboard.push('lock');
      },
      unlock: () => {
        page.keyboard.push('unlock');
      },
    },
  });
});
afterAll(() => {
  for (const [target, name, descriptor] of [
    [globalThis, 'document', originalDocument],
    [globalThis, 'getComputedStyle', originalComputedStyle],
    [navigator, 'keyboard', originalKeyboard],
  ] as const) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else Reflect.deleteProperty(target, name);
  }
});
let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  resetHIDTransportForTesting();
  page.fullscreen = false;
  page.refuseFullscreen = false;
  page.keyboard = [];
});

const connect = async (
  path: string,
  {size = 64, stored = ['', ''] as string[], protocol = 12, era = false} = {},
) => {
  configureHIDTransport({responseTimeoutMs: 200});
  const keyboard = new MacroKeyboard(
    size,
    macroBytes(...stored),
    stored.length,
  );
  registerHIDDeviceForTesting(path, keyboard as unknown as HIDDevice);
  const hid = new HID.HID(path);
  await hid.openPromise;
  const store = configureStore({
    reducer: {
      devices: devices.default,
      macros: macros.default,
      firmware: firmware.default,
      settings: settings.default,
      stateSync: stateSync.default,
      drafts: drafts.default,
      configurePlace: configurePlace.default,
      // An ERA family board on its own definition, without State Sync.
      ...(era && {
        definitions: definitions.default,
        menus: menus.default,
        macroOptions: macroOptions.default,
      }),
    },
  });
  if (era) {
    metadata.setEraAdvancedMetadataForTesting({
      schemaVersion: 2,
      definitions: [{
        id: 'era',
        vendorProductId: keyboard.vendorId * 65536 + keyboard.productId,
        stateSync: false,
        exactMsFamily: 'qmk',
      }],
    });
    store.dispatch(definitions.updateEraDefinitions({
      [keyboard.vendorId * 65536 + keyboard.productId]: {
        v3: {
          name: 'ERA',
          vendorProductId: keyboard.vendorId * 65536 + keyboard.productId,
          firmwareVersion: 0,
          keycodes: [],
          menus: [],
          layouts: {keys: [], optionKeys: {}},
          matrix: {rows: 1, cols: 1},
        },
      },
    } as any));
  }
  const connected: ConnectedDevice = {
    path,
    vendorId: keyboard.vendorId,
    productId: keyboard.productId,
    productName: keyboard.productName,
    vendorProductId: keyboard.vendorId * 65536 + keyboard.productId,
    protocol,
    requiredDefinitionVersion: 'v3',
    hasResolvedDefinition: true,
  };
  store.dispatch(devices.updateConnectedDevices({[path]: connected}));
  store.dispatch(
    devices.selectDevice({
      device: connected,
      connectionGeneration: hid.getConnectionGeneration(),
    }),
  );
  if (protocol >= 13)
    store.dispatch(
      firmware.updateKeycodesVersion({devicePath: path, version: 9}),
    );
  await store.dispatch(macros.loadMacros(connected) as any);
  keyboard.commands = [];
  return {keyboard, store, connected, hid};
};
type TestStore = Awaited<ReturnType<typeof connect>>['store'];
const textOf = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === 'string' ? child : textOf(child)))
    .join('');
type BoxKey = {
  type: string;
  keyCode: number;
  which: number;
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
};
const scriptBoxElement = () => {
  const keydown = new Set<(event: BoxKey) => void>();
  const rendered = (): string =>
    renderer?.root.findAll((node) => node.type === 'textarea')[0]?.props
      .value ?? '';
  let written: {value: string; over: string} | undefined;
  let caret: number | undefined;
  const element = {
    nodeName: 'TEXTAREA',
    scrollTop: 0,
    keydown,
    get value(): string {
      const shown = rendered();
      if (written && written.over === shown) return written.value;
      written = undefined;
      return shown;
    },
    set value(value: string) {
      written = {value, over: rendered()};
    },
    get selectionEnd(): number {
      return caret ?? element.value.length;
    },
    set selectionEnd(position: number) {
      caret = position;
    },
    addEventListener: (type: string, listener: (event: BoxKey) => void) => {
      if (type === 'keydown') keydown.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: BoxKey) => void) => {
      keydown.delete(listener);
    },
    dispatchEvent: () => true,
    focus: () => undefined,
    setSelectionRange: () => undefined,
    getBoundingClientRect: bounds,
  };
  return element;
};
let scriptBox: ReturnType<typeof scriptBoxElement>;
let sequenceBox: ReturnType<typeof inertElement>;
// Elements given keyboard focus, by the popup they open.
let focused: string[] = [];
const render = async (
  store: TestStore,
  sequenceElement?: ReturnType<typeof inertElement>,
) => {
  await act(async () => {
    renderer = create(
      <Provider store={store}>
        <I18nextProvider i18n={translations}>
          <pane.Pane />
        </I18nextProvider>
      </Provider>,
      {
        createNodeMock: (element) => {
          if (element.props['aria-haspopup']) {
            const popup = String(element.props['aria-haspopup']);
            return {...inertElement(), focus: () => focused.push(popup)};
          }
          if (element.props['aria-label'] === '매크로' && element.props.tabIndex === 0) {
            sequenceBox = sequenceElement ?? inertElement();
            if (!sequenceElement) {
              sequenceBox.clientWidth = 960;
              sequenceBox.clientHeight = 440;
            }
            return sequenceBox;
          }
          if (element.type !== 'textarea') return inertElement();
          scriptBox = scriptBoxElement();
          return scriptBox;
        },
      },
    );
  });
  return renderer!.root;
};
const clickable = (root: ReactTestInstance, icon: unknown) => {
  let node: ReactTestInstance | null = root.find(
    (candidate) => candidate.props.icon === icon,
  );
  while (node && !(typeof node.type === 'string' && node.props.onClick))
    node = node.parent;
  return node!;
};
const openScript = (root: ReactTestInstance) =>
  act(() => clickable(root, faCode).props.onClick());
const openRecorder = (root: ReactTestInstance) =>
  act(() => clickable(root, faClapperboard).props.onClick());
const textarea = (root: ReactTestInstance) =>
  root.find((node) => node.type === 'textarea');
const type = (root: ReactTestInstance, value: string) =>
  act(() =>
    textarea(root).props.onChange({
      target: {value, selectionEnd: value.length},
      persist: () => undefined,
    }),
  );
const button = (root: ReactTestInstance, label: string) =>
  root.find((node) => node.type === 'button' && textOf(node) === label);
const applyButton = (root: ReactTestInstance) => button(root, '적용');
const clickApply = async (root: ReactTestInstance) => {
  await act(async () => {
    await applyButton(root).props.onClick();
  });
};
const clickCancel = (root: ReactTestInstance) =>
  act(() => button(root, '취소').props.onClick());
const waitInputs = (root: ReactTestInstance) =>
  root.findAll((node) => node.type === 'input' && node.props.type === 'number');
const itemDeletes = (root: ReactTestInstance) =>
  root.findAll(
    (node) =>
      node.type === 'button' && node.props['aria-label']?.startsWith('삭제 '),
  );
const alerts = (root: ReactTestInstance) =>
  root
    .findAll(
      (node) => typeof node.type === 'string' && node.props.role === 'alert',
    )
    .map(textOf);
const pressRecord = async (root: ReactTestInstance) => {
  await act(async () => {
    clickable(root, faCircle).props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const key = (type: 'keydown' | 'keyup', code: string) =>
  act(() => {
    globalThis.dispatchEvent(
      Object.assign(new Event(type), {code, repeat: false}),
    );
  });
const tap = (code: string) => {
  key('keydown', code);
  key('keyup', code);
};
const timedKey = (
  type: 'keydown' | 'keyup',
  code: string,
  time: number,
  repeat = false,
) => {
  const event = Object.assign(new Event(type), {code, repeat});
  Object.defineProperty(event, 'timeStamp', {value: time});
  globalThis.dispatchEvent(event);
};

describe('editing and saving macros', () => {
  test('serializes a pending save across pane remounts and preserves a later slot save', async () => {
    const {store, keyboard, connected} = await connect('macro-save-remount', {
      size: 8192,
      stored: ['old0', 'old1'],
    });
    const send = keyboard.sendReport.bind(keyboard);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let first = true;
    keyboard.sendReport = async (report, data) => {
      if (data[0] === 0x0f && first) {
        first = false;
        entered();
        await gate;
      }
      return send(report, data);
    };
    const root = await render(store);
    openScript(root);
    type(root, 'new0');
    let pending!: Promise<void>;
    act(() => {
      pending = applyButton(root).props.onClick();
    });
    await started;
    act(() => renderer!.unmount());
    const reopened = await render(store);
    act(() => button(reopened, 'M1').props.onClick());
    openScript(reopened);
    type(reopened, 'new1');
    expect(applyButton(reopened).props.disabled).toBe(true);
    await expect(
      store.dispatch(macros.saveMacro(connected, 1, 'new1') as any),
    ).rejects.toThrow('already in progress');
    await act(async () => {
      release();
      await pending;
    });
    await clickApply(reopened);
    expect(macros.getExpressions(store.getState() as any)).toEqual([
      'new0',
      'new1',
    ]);
    expect(store.getState().drafts).toEqual({});
  });

  test('invalid imports are refused before any keyboard write', async () => {
    const {store, keyboard, connected} = await connect('macro-invalid-import', {
      stored: ['old0', 'old1'],
    });
    for (const bad of [
      'A\u0000B',
      'é',
      '{KC_A',
      '{}',
      '{KC_NO}',
      '{KC_UNKNOWN}',
      '{+}',
      '{,}',
      '{+KC_A,KC_B}',
    ]) {
      for (const writer of [macros.saveMacros, macros.replaceMacros]) {
        await expect(
          store.dispatch(writer(connected, [bad, 'C']) as any),
        ).rejects.toThrow('Invalid macro expression');
      }
    }
    expect(keyboard.commands).toEqual([]);
    expect(keyboard.buffer.slice(0, 10)).toEqual(macroBytes('old0', 'old1'));
    expect(macros.getExpressions(store.getState() as any)).toEqual([
      'old0',
      'old1',
    ]);
  });

  test('invalid or oversized scripts remain editable without being sent', async () => {
    const {store, keyboard} = await connect('macro-refused', {size: 16});
    const root = await render(store);
    openScript(root);
    for (const [value, blocked] of [
      ['é', true],
      ['{KC_A', false],
      ['{}', false],
      ['{+KC_A,KC_B}', false],
      ['abcdefghijklmn ', true],
      ['a'.repeat(1_000_000), true],
      ['{'.repeat(1_000_000), true],
    ] as const) {
      type(root, value);
      expect(textarea(root).props.value).toBe(value);
      expect(applyButton(root).props.disabled).toBe(blocked);
      if (!blocked) {
        await clickApply(root);
        expect(alerts(root).length).toBeGreaterThan(0);
      }
    }
    expect(keyboard.commands).toEqual([]);
    type(root, 'fixed ');
    expect(applyButton(root).props.disabled).toBe(false);
    expect(alerts(root)).toEqual([]);
  });

  test('supported ERA Apply uses KeyboardAPI and real HID echo matching without RESET', async () => {
    const {store, keyboard} = await connect('macro-era-endpoint');
    keyboard.eraReplace = true;
    const root = await render(store);
    openScript(root);
    type(root, 'dir\n');
    await clickApply(root);
    expect(keyboard.buffer.slice(0, 6)).toEqual([100, 105, 114, 10, 0, 0]);
    expect(keyboard.eraOperations).toEqual([
      W.MACRO_REPLACE.BEGIN, W.MACRO_REPLACE.DATA, W.MACRO_REPLACE.COMMIT,
    ]);
    expect(keyboard.commands).not.toContain(0x10);
    expect(keyboard.commands).not.toContain(0x0d);
    expect(keyboard.commands).not.toContain(0x0f);
    expect(macros.getExpressions(store.getState() as any)[0]).toBe('dir\n');
    expect(applyButton(root).props.disabled).toBe(true);
  });

  test('saves canonical expressions and trailing Enter, then has nothing left to apply', async () => {
    const {store, keyboard} = await connect('macro-saved-state');
    const root = await render(store);
    openScript(root);
    for (const [input, expected] of [
      ['{KC_LCTL, KC_C} {kc_a} {0100} ', '{KC_LCTL,KC_C} {KC_A} {100} '],
      ['{KC_A}{15000}', '{KC_A}{9999}{5001}'],
      ['dir\n', 'dir\n'],
    ]) {
      type(root, input);
      await clickApply(root);
      expect(textarea(root).props.value).toBe(expected);
      expect(macros.getExpressions(store.getState() as any)[0]).toBe(expected);
      const bytes = macroBytes(expected, '');
      expect(keyboard.buffer.slice(0, bytes.length)).toEqual(bytes);
      expect(applyButton(root).props.disabled).toBe(true);
    }
    act(() => renderer!.unmount());
    const reopened = await render(store);
    openScript(reopened);
    expect(textarea(reopened).props.value).toBe('dir\n');
    expect(keyboard.buffer.slice(0, 5)).toEqual([100, 105, 114, 10, 0]);
  });

  test('failed script and recorder saves retain the draft through a reread and can be retried', async () => {
    for (const scriptMode of [true, false]) {
      const {store, keyboard, connected, hid} = await connect(
        `macro-fails-${scriptMode}`,
        {stored: ['{KC_A}{500}{KC_B}', '']},
      );
      const root = await render(store);
      if (scriptMode) {
        openScript(root);
        type(root, 'B\n');
      } else {
        act(() => waitInputs(root)[0].props.onChange({target: {value: '700'}}));
      }
      const expected = scriptMode ? 'B\n' : '{KC_A}{700}{KC_B}';
      keyboard.refuseReset = true;
      await clickApply(root);
      expect(textOf(root)).toContain('저장하지 못했습니다.');
      act(() =>
        store.dispatch(
          candidates.commitStableMacroCandidate({
            devicePath: connected.path,
            connectionGeneration: hid.getConnectionGeneration(),
            selectionGeneration: store.getState().devices.selectionGeneration,
            definitionIdentity: 'test',
            revision: 1,
            mutationEpoch: 0,
            candidate: {
              ast: macroApiFor(12).macroBytesToRawKeycodeSequences(
                macroBytes('{KC_A}{500}{KC_B}', ''),
                2,
              ),
              macroBufferSize: 64,
              macroCount: 2,
              isFeatureSupported: true,
            },
          }),
        ),
      );
      expect(store.getState().drafts[connected.path]['macro:0']).toBe(expected);
      expect(applyButton(root).props.disabled).toBe(false);
      keyboard.refuseReset = false;
      await clickApply(root);
      expect(macros.getExpressions(store.getState() as any)[0]).toBe(expected);
      expect(applyButton(root).props.disabled).toBe(true);
      act(() => renderer!.unmount());
      renderer = undefined;
      resetHIDTransportForTesting();
    }
  });

  test('drafts survive slot, mode and pane changes; Apply and Cancel affect only the current slot', async () => {
    const {store, keyboard} = await connect('macro-drafts', {
      stored: ['A', 'B'],
    });
    let root = await render(store);
    openScript(root);
    type(root, 'one ');
    openRecorder(root);
    act(() => button(root, 'M1').props.onClick());
    openScript(root);
    type(root, 'two ');
    act(() => renderer!.unmount());
    root = await render(store);
    openScript(root);
    expect(textarea(root).props.value).toBe('two ');
    await clickApply(root);
    expect(macros.getExpressions(store.getState() as any)).toEqual([
      'A',
      'two ',
    ]);
    act(() => button(root, 'M0').props.onClick());
    expect(textarea(root).props.value).toBe('one ');
    keyboard.commands = [];
    clickCancel(root);
    expect(textarea(root).props.value).toBe('A');
    expect(keyboard.commands).toEqual([]);
    openRecorder(root);
    act(() => clickable(root, faTrash).props.onClick());
    expect(keyboard.commands).toEqual([]);
    clickCancel(root);
    openScript(root);
    expect(textarea(root).props.value).toBe('A');
    openRecorder(root);
    act(() => clickable(root, faTrash).props.onClick());
    await clickApply(root);
    expect(macros.getExpressions(store.getState() as any)).toEqual([
      '',
      'two ',
    ]);
    openScript(root);
    type(root, 'bye ');
    act(() => store.dispatch(devices.updateConnectedDevices({})));
    expect(store.getState().drafts).toEqual({});
  });

  test('equivalent script spellings are not dirty', async () => {
    const {store, keyboard} = await connect('macro-equivalent', {
      stored: ['{KC_LCTL,KC_C}', ''],
    });
    const root = await render(store);
    openScript(root);
    type(root, 'changed');
    type(root, '{kc_lctl, kc_c}');
    expect(applyButton(root).props.disabled).toBe(true);
    expect(textarea(root).props.value).toBe('{kc_lctl, kc_c}');
    expect(keyboard.commands).toEqual([]);
  });

  test('recorder edits accept integer waits and save aliases without changing rejected scripts', async () => {
    const {store, keyboard} = await connect('macro-recorder-edit', {
      stored: ['{KC_CLEAR}{500}{KC_B}', ''],
    });
    const root = await render(store);
    for (const [input, expected] of [
      ['15000', 500],
      ['777', 777],
      ['1.5', 777],
      ['9999', 9999],
    ] as const) {
      act(() => waitInputs(root)[0].props.onChange({target: {value: input}}));
      expect(waitInputs(root)[0].props.value).toBe(expected);
    }
    await clickApply(root);
    const expected = macroBytes('{KC_CLR}{9999}{KC_B}');
    expect(keyboard.buffer.slice(0, expected.length)).toEqual(expected);
    keyboard.commands = [];
    openScript(root);
    for (const value of ['x{ +KC_A }{100}y', 'a{ }b y']) {
      type(root, value);
      await clickApply(root);
      expect(alerts(root).length).toBeGreaterThan(0);
      openRecorder(root);
      act(() => itemDeletes(root).at(-1)?.props.onClick());
      await clickApply(root);
      openScript(root);
      expect(textarea(root).props.value).toBe(value);
    }
    expect(keyboard.commands).toEqual([]);
    type(root, 'x{kc_a}{100}y');
    openRecorder(root);
    act(() => itemDeletes(root).at(-1)!.props.onClick());
    await clickApply(root);
    expect(macros.getExpressions(store.getState() as any)[0]).toBe(
      'x{KC_A}{100}',
    );
  });

  test('normalizing a wait edit preserves the active input identity', async () => {
    const {store} = await connect('macro-wait-identity', {stored: ['', '']});
    const root = await render(store);
    openScript(root);
    type(root, '{10}{20}');
    openRecorder(root);
    const edited = waitInputs(root)[1];
    act(() => edited.props.onChange({target: {value: '25'}}));
    expect(waitInputs(root).map((field) => field.props.value)).toEqual([35]);
    expect(waitInputs(root)[0] === edited).toBe(true);
    act(() => renderer!.unmount());

    const {store: savedStore} = await connect('macro-wait-saved-identity', {
      stored: ['{+KC_A}{-KC_A}{20}', ''],
    });
    const savedRoot = await render(savedStore);
    openScript(savedRoot);
    type(savedRoot, '{KC_A}{10}');
    openRecorder(savedRoot);
    const savedInput = waitInputs(savedRoot)[0];
    act(() => savedInput.props.onChange({target: {value: '20'}}));
    expect(waitInputs(savedRoot)[0].props.value).toBe(20);
    expect(waitInputs(savedRoot)[0] === savedInput).toBe(true);
    expect(applyButton(savedRoot).props.disabled).toBe(true);
  });

  test('pre-renders wheel-scroll headroom without mounting the whole macro', async () => {
    const {store} = await connect('macro-scroll-headroom', {
      size: 8192,
      stored: ['{KC_A}{1}'.repeat(400), ''],
    });
    const root = await render(store);
    const renderedEvents = () => new Set(
      root.findAll(
        (node) => typeof node.type === 'string' &&
          node.props['data-macro-event'] !== undefined,
      ).map((node) => node.props['data-macro-event']),
    );
    // The 960px-wide, 440px-high fixture fits eight events per 44px row.
    expect(renderedEvents().has(95)).toBe(true);
    expect(renderedEvents().has(799)).toBe(false);
    sequenceBox.scrollHeight = 4400;
    act(() => sequenceBox.scrollTo({top: 1760}));
    expect(renderedEvents().has(296)).toBe(true);
    expect(renderedEvents().has(408)).toBe(true);
    expect(renderedEvents().has(799)).toBe(false);
  });

  test('shrinking a row maximum keeps the visible macro event anchored', async () => {
    const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
    const observers: TestObserver[] = [];
    class TestObserver {
      targets = new Set<Element>();
      constructor(private callback: ResizeObserverCallback) {
        observers.push(this);
      }
      observe(target: Element) { this.targets.add(target); }
      unobserve(target: Element) { this.targets.delete(target); }
      disconnect() { this.targets.clear(); }
      resize(target: Element, height: number) {
        this.callback([{
          target,
          borderBoxSize: [{blockSize: height}],
        }] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
      }
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: TestObserver,
    });
    const heights = new Map([[0, 80], [1, 60]]);
    const cells = new Map<number, ReturnType<typeof inertElement>>();
    const scroller = Object.assign(inertElement(), {
      clientWidth: 214,
      clientHeight: 176,
      offsetWidth: 214,
      offsetHeight: 176,
      scrollHeight: 4400,
      getBoundingClientRect: () => ({
        top: 0, left: 0, right: 214, bottom: 176, width: 214, height: 176,
      }),
    });
    const grid = Object.assign(inertElement(), {
      querySelectorAll: () => Array.from(cells.values()),
    });
    const {MacroEventViewport} = modules.viewport;
    try {
      act(() => {
        renderer = create(
          <MacroEventViewport
            eventCount={80}
            contextKey="row-maximum"
            scrollerElement={scroller as unknown as HTMLElement}
            getViewId={(index) => index}
            getIndexForViewId={(id) => Number(id)}
            renderEvent={(_index, _id, {key, ...props}) => <div key={key} {...props} />}
            hasTrailingAfterPseudo={false}
          />,
          {
            createNodeMock: (element) => {
              const index = element.props['data-macro-event'];
              if (index === undefined) return grid;
              const attributes = new Map<string, string>();
              const cell = Object.assign(inertElement(), {
                isConnected: true,
                getAttribute: (name: string) =>
                  attributes.get(name) ??
                  (element.props[name] === undefined ? null : String(element.props[name])),
                setAttribute: (name: string, value: string) => attributes.set(name, value),
                getBoundingClientRect: () => ({
                  ...bounds(),
                  height: heights.get(index) ?? 36,
                }),
              });
              cells.set(index, cell);
              return cell;
            },
          },
        );
      });
      const first = cells.get(0)! as unknown as Element;
      const second = cells.get(1)! as unknown as Element;
      const observer = observers.find((item) => item.targets.has(first))!;
      act(() => scroller.scrollTo({top: 120}));
      heights.set(0, 40);
      act(() => observer.resize(first, 40));
      expect(scroller.scrollTop).toBe(100);
      heights.set(1, 36);
      act(() => observer.resize(second, 36));
      expect(scroller.scrollTop).toBe(80);
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      if (originalObserver) Object.defineProperty(globalThis, 'ResizeObserver', originalObserver);
      else Reflect.deleteProperty(globalThis, 'ResizeObserver');
    }
  });

  test('editing and deleting a long recording preserves event positions and its tail', async () => {
    const expression = Array.from(
      {length: 170},
      (_, index) => `{KC_A}{${index + 1}}`,
    ).join('');
    const {store} = await connect('macro-list-edits', {
      size: 8192,
      stored: [expression, ''],
    });
    const root = await render(store);
    const event = (index: number) => root.find(
      (node) => typeof node.type === 'string' &&
        node.props['data-macro-event'] === index,
    );
    expect(itemDeletes(root).length).toBeLessThan(340);
    sequenceBox.scrollHeight = 2000;
    act(() => sequenceBox.scrollTo({top: 440}));
    act(() => event(81).findByType('input').props.onChange({target: {value: '7000'}}));
    act(() => event(80).findByType('button').props.onClick());
    await clickApply(root);
    const saved = macros.getExpressions(store.getState() as any)[0];
    expect(saved).toContain('{KC_A}{7040}{KC_A}{42}');
    expect(saved.endsWith('{KC_A}{170}')).toBe(true);
    act(() => sequenceBox.scrollTo({top: 1560}));
    expect(waitInputs(root).some((field) => field.props.value === 170)).toBe(true);
    sequenceBox.scrollTop = 120;
    act(() => button(root, 'M1').props.onClick());
    expect(sequenceBox.scrollTop).toBe(0);
  });
});

describe('recording macros', () => {
  test('an uncropped recording preview preserves its initial wait', () => {
    const preview = createMacroRecordingPreview(true, true);
    preview.append([Action.Up, 'KC_A']);
    preview.append([Action.Delay, 100]);
    preview.append([Action.Down, 'KC_A']);
    const frame = preview.read();
    const start = getMacroRecordingPreviewStart(
      frame.sequence,
      frame.sequence.length,
      frame.totalItems,
    );
    expect(frame.sequence.slice(start)).toEqual([
      [Action.Delay, 100],
      [Action.CharacterStream, 'a'],
    ]);
  });

  test('a cropped recording preview keeps input before its following delay', () => {
    const sequence: RawKeycodeSequence = [
      [Action.Down, 'KC_A'],
      [Action.Delay, 17],
      [Action.Up, 'KC_A'],
      [Action.Delay, 23],
      [Action.Down, 'KC_B'],
      [Action.Delay, 19],
      [Action.Up, 'KC_B'],
      [Action.Delay, 21],
      [Action.Down, 'KC_C'],
    ];
    const start = getMacroRecordingPreviewStart(sequence, 6, sequence.length);
    expect(sequence.slice(start)).toEqual([
      [Action.Down, 'KC_B'],
      [Action.Delay, 19],
      [Action.Up, 'KC_B'],
      [Action.Delay, 21],
      [Action.Down, 'KC_C'],
    ]);
  });

  test('a recording remeasures wrapped rows after aligning its cropped start', async () => {
    const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
    const originalTimeout = globalThis.setTimeout;
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
    // Two 86px columns: trimming a wait separates two tall cells into different rows.
    const layouts: Record<number, [number, number][]> = {
      0: [[14, 36], [14, 36], [58, 36], [58, 36], [102, 60], [102, 60], [170, 36], [170, 36]],
      3: [[14, 60], [14, 60], [82, 60], [82, 60], [150, 36]],
      5: [[14, 60], [14, 60], [82, 36]],
    };
    const element = Object.assign(inertElement(), {
      clientWidth: 214,
      clientHeight: 176,
      clientTop: 0,
      getBoundingClientRect: () => ({
        top: 0, left: 0, right: 214, bottom: 176, width: 214, height: 176,
      }),
      querySelectorAll: () => {
        const cells = renderer!.root.findAll(
          (node) => typeof node.type === 'string' &&
            node.props['data-macro-event'] !== undefined,
        );
        if (!cells.length) return [];
        const layout = layouts[cells[0].props['data-macro-event']];
        return cells.map((_, index) => ({
          getBoundingClientRect: () => {
            const [top, height] = layout[index];
            const left = index % 2 ? 112 : 16;
            return {top, bottom: top + height, left, right: left + 86, width: 86, height};
          },
        }));
      },
    });
    try {
      const {store} = await connect('macro-recording-row-refit');
      store.dispatch(settings.setMacroEditorSettings({
        smartOptimizeEnabled: false,
        recordDelaysEnabled: true,
      }));
      const root = await render(store, element);
      await pressRecord(root);
      let publishPreview!: () => void;
      const timer = originalTimeout(() => undefined, 0);
      clearTimeout(timer);
      globalThis.setTimeout = ((callback: () => void) => {
        publishPreview = callback;
        return timer;
      }) as typeof setTimeout;
      act(() => {
        timedKey('keydown', 'KeyA', 0);
        timedKey('keyup', 'KeyA', 0);
        timedKey('keydown', 'KeyB', 10);
        timedKey('keydown', 'PrintScreen', 10);
        timedKey('keyup', 'PrintScreen', 10);
        timedKey('keydown', 'KeyC', 20);
      });
      globalThis.setTimeout = originalTimeout;
      act(() => publishPreview());
      const indices = root.findAll(
        (node) => typeof node.type === 'string' &&
          node.props['data-macro-event'] !== undefined,
      ).map((node) => node.props['data-macro-event']);
      expect(indices).toEqual([5, 6, 7]);
    } finally {
      globalThis.setTimeout = originalTimeout;
      act(() => renderer?.unmount());
      renderer = undefined;
      if (originalObserver) Object.defineProperty(globalThis, 'ResizeObserver', originalObserver);
      else Reflect.deleteProperty(globalThis, 'ResizeObserver');
    }
  });

  test('recording tooltips require mouse hover and stay dismissed after stop', async () => {
    const {store} = await connect('macro-record-hover');
    const root = await render(store);
    const recordButton = () => clickable(root, faCircle);
    expect(recordButton().props['aria-label']).toBe('키 입력 녹화');
    expect(textOf(root)).not.toContain('키 입력 녹화');
    act(() => recordButton().props.onMouseEnter());
    expect(textOf(root)).toContain('키 입력 녹화');
    act(() => recordButton().props.onMouseLeave());
    expect(textOf(root)).not.toContain('키 입력 녹화');
    await pressRecord(root);
    const stopButton = () => clickable(root, faSquare);
    expect(stopButton().props['aria-label']).toBe('녹화 중지');
    expect(textOf(root)).not.toContain('녹화 중지');
    act(() => stopButton().props.onMouseEnter());
    expect(textOf(root)).toContain('녹화 중지');
    tap('KeyA');
    act(() => stopButton().props.onClick());
    expect(recordButton().props['aria-label']).toBe('키 입력 녹화');
    expect(textOf(root)).not.toContain('키 입력 녹화');
    act(() => recordButton().props.onMouseEnter());
    expect(textOf(root)).toContain('키 입력 녹화');
    act(() => recordButton().props.onMouseLeave());
    expect(textOf(root)).not.toContain('키 입력 녹화');
  });

  test('a pending fullscreen request cannot start twice or survive a slot switch', async () => {
    for (const switchSlot of [false, true]) {
      const path = `macro-pending-${switchSlot}`;
      const {store} = await connect(path);
      const root = await render(store);
      const original = documentElement.requestFullscreen;
      let finish!: () => void;
      let requests = 0;
      documentElement.requestFullscreen = () => {
        requests++;
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      };
      try {
        act(() => clickable(root, faCircle).props.onClick());
        if (switchSlot) {
          act(() => button(root, 'M1').props.onClick());
          act(() => button(root, 'M0').props.onClick());
        } else {
          act(() => setFullscreen(true));
          await pressRecord(root);
        }
        expect(requests).toBe(1);
        await act(async () => {
          setFullscreen(true);
          finish();
        });
        tap('KeyA');
        if (switchSlot) expect(store.getState().drafts[path]).toBeUndefined();
        else {
          act(() => clickable(root, faSquare).props.onClick());
          expect(store.getState().drafts[path]['macro:0']).toBe('a');
        }
      } finally {
        documentElement.requestFullscreen = original;
        act(() => renderer!.unmount());
        renderer = undefined;
        resetHIDTransportForTesting();
        page.fullscreen = false;
      }
    }
  });

  test('fullscreen exit during a pending keyboard lock keeps the existing draft', async () => {
    const path = 'macro-pending-lock';
    const {store} = await connect(path);
    const root = await render(store);
    openScript(root);
    type(root, 'existing');
    openRecorder(root);
    act(() => setFullscreen(true));
    const original = navigator.keyboard.lock;
    let finish!: () => void;
    navigator.keyboard.lock = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    try {
      act(() => clickable(root, faCircle).props.onClick());
      act(() => setFullscreen(false));
      await act(async () => {
        finish();
      });
      tap('KeyA');
      expect(store.getState().drafts[path]['macro:0']).toBe('existing');
    } finally {
      navigator.keyboard.lock = original;
    }
  });

  test('a pending start uses the latest optimization setting', async () => {
    const path = 'macro-pending-settings';
    const {store} = await connect(path);
    const root = await render(store);
    act(() => setFullscreen(true));
    const original = navigator.keyboard.lock;
    let finish!: () => void;
    navigator.keyboard.lock = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    try {
      for (const smart of [false, true]) {
        act(() =>
          store.dispatch(
            settings.setMacroEditorSettings({
              smartOptimizeEnabled: !smart,
              recordDelaysEnabled: false,
            }),
          ),
        );
        act(() => clickable(root, faCircle).props.onClick());
        act(() =>
          store.dispatch(
            settings.setMacroEditorSettings({
              smartOptimizeEnabled: smart,
              recordDelaysEnabled: false,
            }),
          ),
        );
        await act(async () => {
          finish();
        });
        tap('KeyA');
        act(() => clickable(root, faSquare).props.onClick());
        expect(store.getState().drafts[path]['macro:0']).toBe(
          smart ? 'a' : '{+KC_A}{-KC_A}',
        );
      }
    } finally {
      navigator.keyboard.lock = original;
    }
  });

  test('large recordings save every event, including the unpainted tail and other slots', async () => {
    for (const count of [300, 4000]) {
      const {store, keyboard} = await connect(`macro-large-${count}`, {
        size: 65535,
        stored: ['', 'keep'],
      });
      store.dispatch(
        settings.setMacroEditorSettings({
          smartOptimizeEnabled: false,
          recordDelaysEnabled: true,
        }),
      );
      const root = await render(store);
      await pressRecord(root);
      const input: string[] = [];
      const record = (start: number, end: number) =>
        act(() => {
          for (let i = start; i < end; i++) {
            const code = i === count - 1 ? 'KeyZ' : 'KeyA';
            const name = i === count - 1 ? 'KC_Z' : 'KC_A';
            if (i) input.push('{23}');
            input.push(`{+${name}}{17}{-${name}}`);
            timedKey('keydown', code, i * 40);
            timedKey('keyup', code, i * 40 + 17);
          }
        });
      record(0, count - 1);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 70));
      });
      expect(keyboard.commands).toEqual([]);
      record(count - 1, count);
      act(() => clickable(root, faSquare).props.onClick());
      await clickApply(root);
      const expected = macroBytes(input.join(''), 'keep');
      expect(keyboard.buffer.slice(0, expected.length)).toEqual(expected);
      expect(macros.getExpressions(store.getState() as any)).toEqual([
        input.join(''),
        'keep',
      ]);
      act(() => renderer!.unmount());
      renderer = undefined;
      resetHIDTransportForTesting();
      page.fullscreen = false;
    }
  });

  test('event timestamps preserve elapsed time and ignore repeats and unmapped keys', async () => {
    const {store, keyboard} = await connect('macro-clock', {size: 8192});
    store.dispatch(
      settings.setMacroEditorSettings({
        smartOptimizeEnabled: false,
        recordDelaysEnabled: true,
      }),
    );
    const root = await render(store);
    for (const interval of [1000 / 60, 0.4]) {
      await pressRecord(root);
      act(() => {
        for (let i = 0; i < 600; i++) {
          const time = 1000.2 + i * interval;
          timedKey(i % 2 ? 'keyup' : 'keydown', 'KeyA', time);
          if (i === 0) {
            timedKey('keydown', 'Unidentified', time + 0.1);
            timedKey('keydown', 'KeyA', time + 0.2, true);
          }
        }
        clickable(root, faSquare).props.onClick();
      });
      await clickApply(root);
      const [written] = macroApiFor(12).macroBytesToRawKeycodeSequences(
        keyboard.buffer.slice(0, -1),
        2,
      );
      const wait = written.reduce(
        (sum, [action, value]) => sum + (action === 4 ? Number(value) : 0),
        0,
      );
      expect(wait).toBe(Math.round(599 * interval));
    }
  });

  test.each([
    {
      name: 'unoptimized chord on VIA 10',
      protocol: 10,
      smart: false,
      delays: true,
      modifier: 'ControlLeft',
      sequence: [[2, 'KC_LCTL'], [2, 'KC_A'], [3, 'KC_A'], [3, 'KC_LCTL']],
      bytes: [2, 224, 2, 4, 3, 4, 3, 224, 0, 0],
    },
    {
      name: 'unoptimized chord on VIA 12',
      protocol: 12,
      smart: false,
      delays: false,
      modifier: 'ControlLeft',
      sequence: [[2, 'KC_LCTL'], [2, 'KC_A'], [3, 'KC_A'], [3, 'KC_LCTL']],
      bytes: [1, 2, 224, 1, 2, 4, 1, 3, 4, 1, 3, 224, 0, 0],
    },
    {
      name: 'unoptimized chord on VIA 13',
      protocol: 13,
      smart: false,
      delays: false,
      modifier: 'ControlLeft',
      sequence: [[2, 'KC_LCTL'], [2, 'KC_A'], [3, 'KC_A'], [3, 'KC_LCTL']],
      bytes: [1, 2, 224, 1, 2, 4, 1, 3, 4, 1, 3, 224, 0, 0],
    },
    {
      name: 'optimized chord on VIA 10',
      protocol: 10,
      smart: true,
      delays: false,
      modifier: 'ControlLeft',
      sequence: [[2, 'KC_LCTL'], [5, 'a'], [3, 'KC_LCTL']],
      bytes: [2, 224, 97, 3, 224, 0, 0],
    },
    {
      name: 'optimized chord on VIA 12',
      protocol: 12,
      smart: true,
      delays: false,
      modifier: 'ControlLeft',
      sequence: [[2, 'KC_LCTL'], [5, 'a'], [3, 'KC_LCTL']],
      bytes: [1, 2, 224, 97, 1, 3, 224, 0, 0],
    },
    {
      name: 'optimized chord on VIA 13',
      protocol: 13,
      smart: true,
      delays: false,
      modifier: 'ControlLeft',
      sequence: [[2, 'KC_LCTL'], [5, 'a'], [3, 'KC_LCTL']],
      bytes: [1, 2, 224, 97, 1, 3, 224, 0, 0],
    },
    {
      name: 'optimized shifted character',
      protocol: 12,
      smart: true,
      delays: false,
      modifier: 'ShiftLeft',
      sequence: [[5, 'A']],
      bytes: [65, 0, 0],
    },
    {
      name: 'optimized chord preserves waits',
      protocol: 12,
      smart: true,
      delays: true,
      modifier: 'ControlLeft',
      sequence: [
        [2, 'KC_LCTL'], [4, 10], [5, 'a'], [4, 30], [3, 'KC_LCTL'],
      ],
      bytes: [
        1, 2, 224, 1, 4, 49, 48, 124, 97,
        1, 4, 51, 48, 124, 1, 3, 224, 0, 0,
      ],
    },
  ])('records $name with independent sequence and wire expectations', async ({
    name, protocol, smart, delays, modifier, sequence, bytes,
  }) => {
      const {store, keyboard} = await connect(`macro-wire-${name}`, {protocol});
      store.dispatch(
        settings.setMacroEditorSettings({
          smartOptimizeEnabled: smart,
          recordDelaysEnabled: delays,
        }),
      );
      const root = await render(store);
      await pressRecord(root);
      act(() => {
        timedKey('keydown', modifier, 100);
        timedKey('keydown', 'KeyA', 110);
        timedKey('keyup', 'KeyA', 120);
        timedKey('keyup', modifier, 140);
      });
      act(() => clickable(root, faSquare).props.onClick());
      expect(keyboard.commands).toEqual([]);
      await clickApply(root);
      expect(keyboard.buffer.slice(0, bytes.length)).toEqual(bytes);
      expect(macroApiFor(protocol).macroBytesToRawKeycodeSequences(
        keyboard.buffer.slice(0, bytes.length), 2,
      )).toEqual([
        sequence,
        [],
      ]);
  });

  test('records escaped text before commands', async () => {
    const {store, keyboard} = await connect('macro-backslash');
    store.dispatch(
      settings.setMacroEditorSettings({
        smartOptimizeEnabled: true,
        recordDelaysEnabled: false,
      }),
    );
    const root = await render(store);
    await pressRecord(root);
    tap('Backslash');
    tap('Backslash');
    tap('Enter');
    act(() => clickable(root, faSquare).props.onClick());
    await clickApply(root);
    const expected = macroBytes('{KC_BSLS}{KC_BSLS}{KC_ENT}', '');
    expect(keyboard.buffer.slice(0, expected.length)).toEqual(expected);
  });

  test('leaving a slot, mode or fullscreen stops recording in its original slot', async () => {
    for (const exit of ['slot', 'script', 'fullscreen'] as const) {
      const path = `macro-exit-${exit}`;
      const {store} = await connect(path, {stored: ['A', 'B']});
      const root = await render(store);
      await pressRecord(root);
      tap('KeyH');
      tap('KeyI');
      expect(applyButton(root).props.disabled).toBe(true);
      if (exit === 'slot') act(() => button(root, 'M1').props.onClick());
      else if (exit === 'script') openScript(root);
      else {
        key('keydown', 'Escape');
        act(() => setFullscreen(false));
        key('keyup', 'Escape');
      }
      tap('KeyX');
      expect(store.getState().drafts[path]).toEqual({'macro:0': 'hi'});
      expect(page.keyboard.at(-1)).toBe('unlock');
      if (exit === 'slot') act(() => button(root, 'M0').props.onClick());
      await clickApply(root);
      expect(macros.getExpressions(store.getState() as any)).toEqual([
        'hi',
        'B',
      ]);
      act(() => renderer!.unmount());
      renderer = undefined;
      resetHIDTransportForTesting();
      page.fullscreen = false;
    }
  });

  test('fullscreen refusal does not record keys', async () => {
    const {store} = await connect('macro-fullscreen-refused');
    const root = await render(store);
    page.refuseFullscreen = true;
    await pressRecord(root);
    tap('KeyA');
    expect(page.keyboard).toEqual([]);
    expect(store.getState().drafts['macro-fullscreen-refused']).toBeUndefined();
  });

  test('an unpainted recording never leaks into a replacement connection', async () => {
    const path = 'macro-reconnect';
    const {store, keyboard, connected} = await connect(path);
    const root = await render(store);
    await pressRecord(root);
    tap('KeyA');
    disconnectHIDDeviceForTesting(path);
    registerHIDDeviceForTesting(path, keyboard as unknown as HIDDevice);
    const next = new HID.HID(path);
    await next.openPromise;
    act(() => {
      store.dispatch(devices.updateConnectedDevices({}));
      store.dispatch(devices.updateConnectedDevices({[path]: connected}));
      store.dispatch(
        devices.selectDevice({
          device: connected,
          connectionGeneration: next.getConnectionGeneration(),
        }),
      );
    });
    await act(async () => {
      await store.dispatch(macros.loadMacros(connected) as any);
    });
    tap('KeyZ');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 70));
    });
    expect(store.getState().drafts[path]).toBeUndefined();
  });

  test('leaving the device retains its draft but disconnect removes it permanently', async () => {
    const path = 'macro-owner';
    const {store, connected, hid} = await connect(path);
    const root = await render(store);
    await pressRecord(root);
    tap('KeyA');
    act(() =>
      store.dispatch(
        devices.selectDevice({device: null, connectionGeneration: null}),
      ),
    );
    expect(store.getState().drafts[path]).toEqual({'macro:0': 'a'});
    act(() =>
      store.dispatch(
        devices.selectDevice({
          device: connected,
          connectionGeneration: hid.getConnectionGeneration(),
        }),
      ),
    );
    await act(async () => {
      await store.dispatch(macros.loadMacros(connected) as any);
    });
    await pressRecord(renderer!.root);
    tap('KeyB');
    act(() => store.dispatch(devices.updateConnectedDevices({})));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 70));
    });
    expect(store.getState().drafts[path]).toBeUndefined();
  });
});

test('Enter in prose remains a line break while Enter in a keycode block selects a key', async () => {
  const {store} = await connect('macro-script-enter');
  const root = await render(store);
  openScript(root);
  const typeAndSettle = async (value: string) => {
    await act(async () => {
      textarea(root).props.onChange({
        target: {value, selectionEnd: value.length},
        persist: () => undefined,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  const pressEnter = async () => {
    const event: BoxKey = {
      type: 'keydown',
      keyCode: 13,
      which: 13,
      defaultPrevented: false,
      preventDefault() {
        event.defaultPrevented = true;
      },
      stopPropagation: () => undefined,
    };
    await act(async () => {
      scriptBox.keydown.forEach((listener) => listener(event));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return event;
  };
  for (const value of ['Thanks,', 'How are you?']) {
    await typeAndSettle(value);
    expect((await pressEnter()).defaultPrevented).toBe(false);
    expect(textarea(root).props.value).toBe(value);
    await typeAndSettle('');
  }
  await typeAndSettle('{');
  expect((await pressEnter()).defaultPrevented).toBe(true);
  expect(textarea(root).props.value).toMatch(/^\{KC_\w+,$/);
});

describe('macro playback options', () => {
  const F = W.MACRO_OPTIONS_FLAGS;
  const ALL = F.RELEASE | F.RETAP | F.HOLD | F.OTHER | F.IGNORE_MODS | F.BLOCK_OTHERS;
  const DEFAULT = {flags: 0, holdMs: 1000, repeatCount: 1};
  const optionsControl = (root: ReactTestInstance) =>
    root.findAll((node) => typeof node.type === 'string' && node.props['data-macro-options'] !== undefined);
  const settle = () => act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const playback = (root: ReactTestInstance) =>
    root.find((node) => node.type === 'button' && node.props['aria-haspopup'] === 'dialog');
  const form = (root: ReactTestInstance) =>
    root.findAll((node) => typeof node.type === 'string' && node.props.role === 'dialog')[0];
  const openForm = (root: ReactTestInstance) => act(() => playback(root).props.onClick());
  const explanation = (root: ReactTestInstance, label: string) => {
    const toggle = form(root).find(
      (node) => node.type === 'button' && node.props['aria-label'] === label,
    );
    const body = form(root).find(
      (node) => typeof node.type === 'string' &&
        node.props.id === toggle.props['aria-controls'],
    );
    return {toggle, body};
  };
  const checkbox = (root: ReactTestInstance, label: string) =>
    root.find((node) => node.type === 'label' && textOf(node) === label)
      .find((node) => node.type === 'input');
  const toggle = (root: ReactTestInstance, label: string) =>
    act(() => {
      const input = checkbox(root, label);
      input.props.onChange({target: {checked: !input.props.checked}});
    });
  const field = (root: ReactTestInstance, label: string) =>
    root.findAll((node) => node.type === 'input' && node.props['aria-label'] === label)[0];
  const fill = (root: ReactTestInstance, label: string, value: string) =>
    act(() => field(root, label).props.onChange({target: {value}}));
  const repeat = (root: ReactTestInstance, value: string) =>
    act(() => root.find((node) => node.type === 'select').props.onChange({target: {value}}));
  const refusals = (root: ReactTestInstance) =>
    root.findAll((node) => typeof node.type === 'string' && node.props['data-macro-options-refused'])
      .map(textOf);
  const dotted = (root: ReactTestInstance, label: string) =>
    button(root, label).findAll(
      (node) => typeof node.type === 'string' && node.props['aria-hidden'] === 'true',
    ).length > 0;
  // The dot, not the chevron icon beside it.
  const playbackDotted = (root: ReactTestInstance) =>
    playback(root).findAll(
      (node) => node.type === 'span' && node.props['aria-hidden'] === 'true',
    ).length > 0;
  afterEach(() => {
    metadata.setEraAdvancedMetadataForTesting(null);
    focused = [];
  });

  test('the playback form fits above its button without the badge menu height limit', async () => {
    const {badgePopupBounds} = await import('../src/components/inputs/badge-dropdown');
    const anchor = {right: 900, top: 620, bottom: 660};
    const viewport = {width: 1000, height: 1000};
    const badge = badgePopupBounds(anchor, viewport, 480, 480);
    const form = badgePopupBounds(anchor, viewport, 480, 480, {
      maxHeight: viewport.height,
      minBelowHeight: 480,
    });
    expect(badge.top).toBeGreaterThanOrEqual(anchor.bottom);
    expect(form.maxHeight).toBe(480);
    expect(form.top + form.maxHeight).toBeLessThan(anchor.top);
  });

  test('stock, unsupported and other-version firmware leave the editor as it was', async () => {
    const {store: stock, keyboard: stockKeyboard} = await connect('macro-options-stock');
    expect(optionsControl(await render(stock))).toEqual([]);
    await settle();
    expect(stockKeyboard.commands).toEqual([]);
    act(() => renderer!.unmount());

    const {store, keyboard} = await connect('macro-options-unsupported', {era: true});
    const root = await render(store);
    await settle();
    expect(keyboard.commands).toContain(0x08);
    expect(optionsControl(root)).toEqual([]);
    act(() => renderer!.unmount());

    // Version 1 was never released: its reply is no support at all.
    const {store: v1, keyboard: v1Keyboard} = await connect('macro-options-v1', {era: true});
    v1Keyboard.macroOptions = {supported: ALL, options: [{...DEFAULT}, {...DEFAULT}]};
    v1Keyboard.macroOptionsVersion = 1;
    const v1Root = await render(v1);
    await settle();
    expect(optionsControl(v1Root)).toEqual([]);
    expect(
      v1Keyboard.requests.filter(
        (request) => request[1] === W.CHANNELS_EERRAA.MACRO_OPTIONS && request[2] !== W.MACRO_OPTIONS.CAPABILITIES,
      ),
    ).toEqual([]);
  });

  test('the Playback button sits beside the modes and spells out the repeat count', async () => {
    const {store, keyboard} = await connect('macro-options-count', {era: true});
    keyboard.macroOptions = {supported: ALL, options: [{...DEFAULT}, {...DEFAULT}]};
    const root = await render(store);
    await settle();
    // No options line under the editor: one control, in the mode row.
    expect(optionsControl(root).map((node) => node.props['data-macro-options'])).toEqual(['playback']);
    expect(textOf(playback(root))).toBe('재생: 1회');
    expect(playbackDotted(root)).toBe(false);
    expect(form(root)).toBeUndefined();

    openForm(root);
    expect(playback(root).props['aria-expanded']).toBe(true);
    expect(form(root).props['aria-label']).toBe('재생 옵션');
    expect(field(root, '반복 횟수')).toBeUndefined();

    repeat(root, 'times');
    expect(field(root, '반복 횟수').props.value).toBe('2');
    expect(textOf(playback(root))).toBe('재생: 2회');
    expect(applyButton(root).props.disabled).toBe(false);
    for (const wrong of ['1', '256', '']) {
      fill(root, '반복 횟수', wrong);
      expect(refusals(root)).toEqual(['반복 횟수는 2–255회로 입력하세요.']);
      expect(applyButton(root).props.disabled).toBe(true);
    }
    fill(root, '반복 횟수', '255');
    expect(refusals(root)).toEqual([]);
    expect(textOf(playback(root))).toBe('재생: 255회');
    // The count is not another option: no dot for it.
    expect(playbackDotted(root)).toBe(false);

    await clickApply(root);
    await settle();
    expect(keyboard.macroOptions.options[0]).toEqual({...DEFAULT, repeatCount: 255});
    expect(applyButton(root).props.disabled).toBe(true);
    expect(textOf(playback(root))).toBe('재생: 255회');

    repeat(root, 'once');
    expect(field(root, '반복 횟수')).toBeUndefined();
    await clickApply(root);
    await settle();
    expect(keyboard.macroOptions.options[0]).toEqual(DEFAULT);
  });

  test('until stopped needs a stop condition before Apply', async () => {
    const {store, keyboard} = await connect('macro-options-until', {era: true});
    keyboard.macroOptions = {supported: ALL, options: [{...DEFAULT}, {...DEFAULT}]};
    const root = await render(store);
    await settle();
    openForm(root);
    repeat(root, 'until');
    expect(textOf(playback(root))).toBe('재생: 멈출 때까지');
    expect(refusals(root)).toEqual(['멈출 때까지 반복하려면 재생 제어 옵션을 하나 켜세요.']);
    expect(applyButton(root).props.disabled).toBe(true);
    await clickApply(root);
    expect(keyboard.requests.filter(([command]) => command === 0x07)).toEqual([]);

    toggle(root, '다른 키를 누르면 멈춤');
    expect(refusals(root)).toEqual([]);
    expect(playbackDotted(root)).toBe(true);
    keyboard.requests = [];
    await clickApply(root);
    await settle();
    expect(keyboard.macroOptions.options[0]).toEqual({flags: F.OTHER, holdMs: 1000, repeatCount: 0});
    expect(
      keyboard.requests
        .filter(([command, channel]) => command === 0x07 && channel === W.CHANNELS_EERRAA.MACRO_OPTIONS)
        .map((request) => request[2]),
    ).toEqual([W.MACRO_OPTIONS.FLAGS, W.MACRO_OPTIONS.HOLD_MS, W.MACRO_OPTIONS.REPEAT_COUNT]);
  });

  test('playback help describes only controls the firmware supports', async () => {
    const {store, keyboard} = await connect('macro-options-help-capabilities', {era: true});
    keyboard.macroOptions = {
      supported: F.RELEASE | F.RETAP,
      options: [{...DEFAULT}, {...DEFAULT}],
    };
    const root = await render(store);
    await settle();
    openForm(root);
    const help = () => textOf(explanation(root, '재생 제어').body);
    expect(help()).toContain('같은 매크로 키');
    expect(help()).not.toContain('길게');

    toggle(root, '키를 누르는 동안만 재생');
    expect(checkbox(root, '다시 눌렀다 떼면 멈춤').props.disabled).toBe(true);
    expect(help()).not.toContain('길게');
  });

  test('Stop on release makes re-tap and hold inert, keeps their values and says why', async () => {
    const {store, keyboard} = await connect('macro-options-release', {era: true});
    keyboard.macroOptions = {
      supported: F.RELEASE | F.RETAP | F.HOLD,
      options: [{...DEFAULT}, {...DEFAULT}],
    };
    const root = await render(store);
    await settle();
    openForm(root);
    // Only what the firmware supports.
    const text = textOf(form(root));
    for (const label of ['반복', '재생 제어', '키를 누르는 동안만 재생', '다시 눌렀다 떼면 멈춤', '다시 길게 누르면 멈춤']) {
      expect(text).toContain(label);
    }
    expect(explanation(root, '재생 제어').body.props.hidden).toBe(true);
    act(() => explanation(root, '재생 제어').toggle.props.onClick());
    expect(explanation(root, '재생 제어').body.props.hidden).toBe(false);
    expect(text).toContain(
      '다시 누르는 동작으로 멈추는 옵션은 재생 중 같은 매크로 키를 새로 누를 때 적용됩니다.',
    );
    for (const label of ['다른 키를 누르면 멈춤', '다른 키 입력', '수식 키']) {
      expect(text).not.toContain(label);
    }
    expect(field(root, '누름 시간')).toBeUndefined();

    toggle(root, '다시 눌렀다 떼면 멈춤');
    toggle(root, '다시 길게 누르면 멈춤');
    expect(field(root, '누름 시간').props.value).toBe('1000');
    fill(root, '누름 시간', '0');
    expect(refusals(root)).toEqual(['누름 시간은 1–65535 ms로 입력하세요.']);
    expect(applyButton(root).props.disabled).toBe(true);

    toggle(root, '키를 누르는 동안만 재생');
    for (const label of ['다시 눌렀다 떼면 멈춤', '다시 길게 누르면 멈춤']) {
      expect(checkbox(root, label).props).toMatchObject({checked: true, disabled: true});
    }
    expect(field(root, '누름 시간').props).toMatchObject({value: '0', disabled: true});
    expect(textOf(form(root))).toContain(
      '키를 누르는 동안만 재생을 켜면 같은 매크로 키를 다시 눌러 멈추는 옵션은 쓰이지 않습니다.',
    );
    expect(textOf(form(root))).not.toContain(
      '다시 누르는 동작으로 멈추는 옵션은 재생 중 같은 매크로 키를 새로 누를 때 적용됩니다.',
    );
    // An inert hold time blocks nothing; the keyboard keeps its own.
    expect(refusals(root)).toEqual([]);
    await clickApply(root);
    await settle();
    expect(keyboard.macroOptions.options[0]).toEqual({
      flags: F.RELEASE | F.RETAP | F.HOLD,
      holdMs: 1000,
      repeatCount: 1,
    });
  });

  test('other keys are allowed by default; Block says what happens to them and is written', async () => {
    const {store, keyboard} = await connect('macro-options-block', {era: true});
    keyboard.macroOptions = {supported: ALL, options: [{...DEFAULT}, {...DEFAULT}]};
    const root = await render(store);
    await settle();
    openForm(root);
    expect(checkbox(root, '허용').props.checked).toBe(true);
    expect(checkbox(root, '차단').props.checked).toBe(false);
    expect(explanation(root, '다른 키 입력').body.props.hidden).toBe(true);
    act(() => explanation(root, '다른 키 입력').toggle.props.onClick());
    expect(explanation(root, '다른 키 입력').body.props.hidden).toBe(false);
    expect(textOf(form(root))).toContain('다른 키 입력');
    expect(textOf(form(root))).not.toContain('멈추게 한 키의 입력');
    expect(textOf(form(root))).toContain('재생을 계속하며, 새로 누른 일반 키도 동작합니다.');
    expect(textOf(form(root))).toContain(
      '재생 중 누른 다른 매크로 키는 해당 매크로를 시작하거나 예약하지 않습니다.',
    );

    toggle(root, '다른 키를 누르면 멈춤');
    expect(textOf(form(root))).toContain('멈추게 한 키의 입력');
    expect(textOf(form(root))).not.toContain('다른 키 입력');
    expect(textOf(form(root))).toContain('매크로를 멈추고, 누른 일반 키의 동작도 실행합니다.');
    expect(textOf(form(root))).not.toContain('재생을 계속하며, 새로 누른 일반 키도 동작합니다.');
    expect(textOf(form(root))).toContain(
      '재생 중 누른 다른 매크로 키는 해당 매크로를 시작하거나 예약하지 않습니다.',
    );

    toggle(root, '다른 키를 누르면 멈춤');
    act(() => checkbox(root, '차단').props.onChange());
    expect(textOf(form(root))).toContain('다른 키 입력');
    expect(textOf(form(root))).toContain('재생 중에 누른 다른 키는 입력되지 않습니다.');
    expect(textOf(form(root))).toContain(
      '재생 중 누른 다른 매크로 키는 해당 매크로를 시작하거나 예약하지 않습니다.',
    );
    expect(playbackDotted(root)).toBe(true);
    toggle(root, '다른 키를 누르면 멈춤');
    expect(textOf(form(root))).toContain('멈추게 한 키의 입력');
    expect(textOf(form(root))).toContain('다른 키는 매크로를 멈추고, 그 키 입력은 버려집니다.');
    expect(textOf(form(root))).not.toContain('재생 중에 누른 다른 키는 입력되지 않습니다.');
    expect(textOf(form(root))).toContain(
      '재생 중 누른 다른 매크로 키는 해당 매크로를 시작하거나 예약하지 않습니다.',
    );

    await clickApply(root);
    await settle();
    expect(keyboard.macroOptions.options[0]).toEqual({
      ...DEFAULT,
      flags: F.BLOCK_OTHERS | F.OTHER,
    });
    expect(textOf(playback(root))).toBe('재생: 1회');
    expect(playbackDotted(root)).toBe(true);
  });

  test('Escape and a click outside close the form and focus the button; closing keeps the draft', async () => {
    const {store, keyboard} = await connect('macro-options-popover', {era: true});
    keyboard.macroOptions = {supported: ALL, options: [{...DEFAULT}, {...DEFAULT}]};
    const root = await render(store);
    await settle();
    openForm(root);
    toggle(root, '다시 눌렀다 떼면 멈춤');
    repeat(root, 'times');
    fill(root, '반복 횟수', '4');

    // Escape closes it wherever focus went: a key from outside the form, such as
    // the Script tab Shift+Tab reaches, arrives only at the window.
    const escape = () => {
      const event = Object.assign(new Event('keydown', {cancelable: true}), {key: 'Escape'});
      act(() => {
        globalThis.dispatchEvent(event);
      });
      return event;
    };
    expect(escape().defaultPrevented).toBe(true);
    expect(form(root)).toBeUndefined();
    expect(playback(root).props['aria-expanded']).toBe(false);
    expect(focused).toEqual(['dialog']);
    // The draft stays, marked on the button and on its macro.
    expect(textOf(playback(root))).toBe('재생: 4회');
    expect(playbackDotted(root)).toBe(true);
    expect(dotted(root, 'M0')).toBe(true);
    expect(applyButton(root).props.disabled).toBe(false);
    expect(keyboard.requests.filter(([command]) => command === 0x07)).toEqual([]);

    openForm(root);
    expect(checkbox(root, '다시 눌렀다 떼면 멈춤').props.checked).toBe(true);
    expect(field(root, '반복 횟수').props.value).toBe('4');
    act(() =>
      root.find((node) => typeof node.type === 'string' && node.props['data-macro-options-cover'])
        .props.onClick(),
    );
    expect(form(root)).toBeUndefined();
    expect(focused).toEqual(['dialog', 'dialog']);
    expect(textOf(playback(root))).toBe('재생: 4회');

    // A closed form no longer listens.
    expect(escape().defaultPrevented).toBe(false);
    expect(focused).toEqual(['dialog', 'dialog']);

    // Only Cancel discards it.
    clickCancel(root);
    expect(textOf(playback(root))).toBe('재생: 1회');
    expect(playbackDotted(root)).toBe(false);
    expect(dotted(root, 'M0')).toBe(false);
    openForm(root);
    expect(checkbox(root, '다시 눌렀다 떼면 멈춤').props.checked).toBe(false);
  });

  test('a content save through RESET keeps the options, so they are not asked for again', async () => {
    const {store, keyboard} = await connect('macro-options-reset', {era: true});
    keyboard.macroOptions = {
      supported: F.RETAP | F.HOLD,
      options: [{flags: F.RETAP, holdMs: 400, repeatCount: 1}, {...DEFAULT}],
    };
    const root = await render(store);
    await settle();
    keyboard.requests = [];
    openScript(root);
    type(root, 'new0');
    await clickApply(root);
    await settle();
    expect(keyboard.requests.some(([command]) => command === 0x10)).toBe(true);
    expect(keyboard.requests.filter((request) => request[1] === W.CHANNELS_EERRAA.MACRO_OPTIONS))
      .toEqual([]);
    openForm(root);
    expect(checkbox(root, '다시 눌렀다 떼면 멈춤').props.checked).toBe(true);
  });

  test('an options draft belongs to the keyboard: it outlives the pane and marks its macro', async () => {
    const {store, keyboard} = await connect('macro-options-draft', {era: true});
    keyboard.macroOptions = {
      supported: F.RETAP,
      options: [{...DEFAULT}, {...DEFAULT}],
    };
    let root = await render(store);
    await settle();
    openForm(root);
    toggle(root, '다시 눌렀다 떼면 멈춤');
    expect([dotted(root, 'M0'), dotted(root, 'M1')]).toEqual([true, false]);

    act(() => renderer!.unmount());
    root = await render(store);
    await settle();
    openForm(root);
    expect(checkbox(root, '다시 눌렀다 떼면 멈춤').props.checked).toBe(true);
    expect(dotted(root, 'M0')).toBe(true);
    expect(applyButton(root).props.disabled).toBe(false);

    toggle(root, '다시 눌렀다 떼면 멈춤');
    expect(dotted(root, 'M0')).toBe(false);
    expect(keyboard.requests.filter(([command]) => command === 0x07)).toEqual([]);
  });

  test('a write the keyboard takes only in part still saves what it took', async () => {
    const {store, keyboard} = await connect('macro-options-partial', {era: true});
    keyboard.macroOptions = {
      supported: F.RETAP | F.HOLD,
      options: [{...DEFAULT}, {...DEFAULT}],
    };
    keyboard.refuseOptionsHold = true;
    const root = await render(store);
    await settle();
    openForm(root);
    toggle(root, '다시 눌렀다 떼면 멈춤');
    keyboard.requests = [];
    await clickApply(root);
    await settle();
    expect(keyboard.macroOptions.options[0].flags).toBe(F.RETAP);
    expect(
      keyboard.requests.some(
        ([command, channel]) => command === 0x09 && channel === W.CHANNELS_EERRAA.MACRO_OPTIONS,
      ),
    ).toBe(true);
    expect(store.getState().menus.saveRetries['macro-options-partial'] ?? {}).toEqual({});
  });

  test('a refused FLAGS write stops that macro, so until stopped never lands without its stop', async () => {
    const {store, keyboard} = await connect('macro-options-refused-flags', {era: true});
    keyboard.macroOptions = {supported: ALL, options: [{...DEFAULT}, {...DEFAULT}]};
    keyboard.refuseOptionsFlags = true;
    const root = await render(store);
    await settle();
    openForm(root);
    repeat(root, 'until');
    toggle(root, '다시 눌렀다 떼면 멈춤');
    keyboard.requests = [];
    await clickApply(root);
    await settle();
    expect(keyboard.macroOptions.options[0]).toEqual(DEFAULT);
    const sent = keyboard.requests.filter(
      ([command, channel]) =>
        (command === 0x07 || command === 0x09) && channel === W.CHANNELS_EERRAA.MACRO_OPTIONS,
    );
    expect(sent.map((request) => request.slice(0, 3))).toEqual([
      [0x07, W.CHANNELS_EERRAA.MACRO_OPTIONS, W.MACRO_OPTIONS.FLAGS],
    ]);
    expect([dotted(root, 'M0'), dotted(root, 'M1')]).toEqual([true, false]);
    expect(applyButton(root).props.disabled).toBe(false);
  });

  test('a refused SAVE keeps its macro marked while the save is owed', async () => {
    const {store, keyboard} = await connect('macro-options-refused-save', {era: true});
    keyboard.macroOptions = {
      supported: F.RETAP,
      options: [{...DEFAULT}, {...DEFAULT}],
    };
    keyboard.refuseOptionsSave = true;
    const root = await render(store);
    await settle();
    openForm(root);
    toggle(root, '다시 눌렀다 떼면 멈춤');
    await clickApply(root);
    await settle();
    expect(keyboard.macroOptions.options[0].flags).toBe(F.RETAP);
    expect([dotted(root, 'M0'), dotted(root, 'M1')]).toEqual([true, false]);
    expect(applyButton(root).props.disabled).toBe(false);
  });
});
