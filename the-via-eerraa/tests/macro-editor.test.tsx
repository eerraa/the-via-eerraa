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

const originalWarn = console.warn;
console.warn = () => undefined;
const modules = await (async () => {
  try {
    await import('../src/utils/keyboard-api');
    return {
      pane: await import('../src/components/panes/configure-panes/macros'),
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

type Listener = (event: {data: DataView}) => void;
class MacroKeyboard {
  vendorId = 0x4552;
  productId = 0x7e57;
  productName = 'Macro keyboard';
  collections = [{usagePage: 0xff60, usage: 0x61}];
  opened = false;
  listeners = new Set<Listener>();
  commands: number[] = [];
  buffer: number[];
  refuseReset = false;
  eraReplace = false;
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
    if (this.eraReplace && request[1] === W.CHANNELS_EERRAA.MACRO_REPLACE &&
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
const inertElement = () => ({
  style: {} as Record<string, string>,
  classList: {add: () => undefined, remove: () => undefined},
  getBoundingClientRect: bounds,
  appendChild: () => undefined,
  removeChild: () => undefined,
  contains: () => true,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  focus: () => undefined,
  scrollTop: 0,
  offsetTop: 0,
  offsetLeft: 0,
});
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
  {size = 64, stored = ['', ''] as string[], protocol = 12} = {},
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
    },
  });
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
const render = async (store: TestStore) => {
  await act(async () => {
    renderer = create(
      <Provider store={store}>
        <I18nextProvider i18n={translations}>
          <pane.Pane />
        </I18nextProvider>
      </Provider>,
      {
        createNodeMock: (element) => {
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
    act(() => waitInputs(root)[40].props.onChange({target: {value: '7000'}}));
    act(() => itemDeletes(root)[80].props.onClick());
    await clickApply(root);
    const saved = macros.getExpressions(store.getState() as any)[0];
    expect(saved).toContain('{KC_A}{7040}{KC_A}{42}');
    expect(saved.endsWith('{KC_A}{170}')).toBe(true);
  });
});

describe('recording macros', () => {
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
