import {afterAll, afterEach, beforeAll, describe, expect, test} from 'bun:test';
import {configureStore} from '@reduxjs/toolkit';
import {
  faCircle,
  faClapperboard,
  faCode,
  faSquare,
  faTrash,
  faXmarkCircle,
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
  HID,
  registerHIDDeviceForTesting,
  resetHIDTransportForTesting,
} from '../src/shims/node-hid';
import ko from '../src/locales/ko.json';
import type {ConnectedDevice} from '../src/types/types';
import type {KeyboardAPI} from '../src/utils/keyboard-api';

const loadModules = async () => {
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    await import('../src/utils/keyboard-api');
    return {
      pane: await import('../src/components/panes/configure-panes/macros'),
      script:
        await import('../src/components/panes/configure-panes/submenus/macros/script-mode'),
      dirtyDot: await import('../src/components/inputs/dirty-dot'),
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
};
const {
  pane,
  script,
  dirtyDot: {DirtyDot},
  devices,
  macros,
  firmware,
  settings,
  stateSync,
  candidates,
  drafts,
  configurePlace,
  macroApi: {getMacroAPI},
  common: {checkMacroDraft, expressionToRawSequence, splitLongDelays},
} = await loadModules();

const translations = i18n.createInstance();
await translations.init({lng: 'ko', resources: {ko: {translation: ko}}});

// Only the byte conversions of the macro API are used without a keyboard.
const noKeyboard = {} as KeyboardAPI;
const macroApiFor = (protocol: number) =>
  getMacroAPI(protocol, protocol >= 13 ? 9 : undefined, noKeyboard);

const macroBytes = (...expressions: string[]) =>
  macroApiFor(12).rawKeycodeSequencesToMacroBytes(
    expressions.map(expressionToRawSequence),
  );

describe('what a macro draft can hold', () => {
  const problemOf = (expression: string, protocol = 12) =>
    checkMacroDraft(macroApiFor(protocol), expression).problem;

  test('only characters an English keyboard types, plus Enter and Tab', () => {
    for (const text of [
      '한',
      'é',
      '“quoted”',
      '😀',
      '\u0001',
      '\u007f',
      '\r',
    ]) {
      expect({text, problem: problemOf(`ab${text}c`)}).toEqual({
        text,
        problem: {type: 'untypeable'},
      });
    }
    expect(problemOf('Hello, world! ~`\t{KC_ENT}\n')).toBeUndefined();
  });

  test('names blocks that are unclosed or empty and keys a macro cannot send', () => {
    expect(problemOf('{KC_A')).toEqual({type: 'unclosed'});
    expect(problemOf('{KC_A{KC_B}')).toEqual({type: 'unclosed'});
    expect(problemOf('\\{KC_A')).toBeUndefined();
    expect(problemOf('a{ }b')).toEqual({type: 'empty'});
    expect(problemOf('{KC_FOO}{kc_bar}')).toEqual({
      type: 'unknown-keys',
      keys: ['KC_FOO', 'KC_BAR'],
    });
    // In the autocomplete list but in no keycode table, and a zero byte that
    // would end the macro early: neither can be written.
    expect(problemOf('{KC_KP_ASTERISK}{KC_NO}')).toEqual({
      type: 'unknown-keys',
      keys: ['KC_KP_ASTERISK', 'KC_NO'],
    });
    // A padded block is read as a key name, as the save reads it.
    expect(problemOf('{ +KC_A }{ 100 }')).toEqual({
      type: 'unknown-keys',
      keys: ['+KC_A', '100'],
    });
    expect(
      problemOf('{KC_A}{100}{KC_LCTL, KC_C}{+KC_LSFT}ab{-KC_LSFT}'),
    ).toBeUndefined();
  });

  test('a board without waits does not know {100}', () => {
    expect(problemOf('a{100}', 10)).toEqual({
      type: 'unknown-keys',
      keys: ['100'],
    });
    expect(problemOf('a{100}', 11)).toBeUndefined();
  });

  test('a draft is compared in the form the keyboard reads back', () => {
    const storedAs = (expression: string) =>
      checkMacroDraft(macroApiFor(12), expression).stored;
    expect(storedAs('{KC_LCTL, KC_C}')).toBe('{KC_LCTL,KC_C}');
    expect(storedAs('{kc_a}')).toBe('{KC_A}');
    expect(storedAs('{0100}')).toBe('{100}');
    expect(storedAs('{KC_CLEAR}')).toBe('{KC_CLR}');
    expect(storedAs('ls -la\n')).toBe('ls -la\n');
  });

  test('a key the keyboard reads back under another name is accepted again', () => {
    const {stored} = checkMacroDraft(macroApiFor(12), '{KC_CLEAR}');
    expect(problemOf(`${stored}x`)).toBeUndefined();
    // Every key byte a keycode table names reads back as a name a save accepts.
    for (const protocol of [9, 10, 11, 12, 13]) {
      const api = macroApiFor(protocol);
      const tap = protocol >= 11 ? [1, 1] : [1];
      const refused: string[] = [];
      for (let byte = 1; byte <= 0xff; byte++) {
        const [[[, key]]] = api.macroBytesToRawKeycodeSequences(
          [...tap, byte, 0],
          1,
        );
        if (key !== undefined && checkMacroDraft(api, `{${key}}x`).problem) {
          refused.push(String(key));
        }
      }
      expect({protocol, refused}).toEqual({protocol, refused: []});
    }
    // A table's mask is not a key, even one that fits in a byte.
    expect(problemOf('{_QK_LAYER_MOD_MASK}')).toEqual({
      type: 'unknown-keys',
      keys: ['_QK_LAYER_MOD_MASK'],
    });
  });

  test('a wait longer than four digits is written as several', () => {
    expect(splitLongDelays([[4, 15000]])).toEqual([
      [4, 9999],
      [4, 5001],
    ]);
    expect(splitLongDelays([[4, 19998]])).toEqual([
      [4, 9999],
      [4, 9999],
    ]);
    expect(splitLongDelays([[4, 9999]])).toEqual([[4, 9999]]);
    const draft = checkMacroDraft(macroApiFor(12), '{15000}');
    expect(draft).toMatchObject({stored: '{9999}{5001}', byteCount: 15});
    // A wait no buffer could hold is cut short, then refused as too large.
    expect(
      checkMacroDraft(macroApiFor(12), '{99999999999999999999}').byteCount,
    ).toBeGreaterThan(0xffff);
  });
});

type Listener = (event: {data: DataView}) => void;

/** A stock VIA keyboard (protocol 12) with a macro buffer. */
class MacroKeyboard {
  vendorId = 0x4552;
  productId = 0x7e57;
  productName = 'Macro keyboard';
  collections = [{usagePage: 0xff60, usage: 0x61}];
  opened = false;
  listeners = new Set<Listener>();
  commands: number[] = [];
  buffer: number[];
  /** Answers RESET as a command it does not handle, so a save fails at once. */
  refuseReset = false;

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
    if (type === 'inputreport') {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.delete(listener);
  }

  async sendReport(_reportId: number, data: Uint8Array) {
    const request = Array.from(data);
    const reply = request.slice();
    const [command] = request;
    const offset = (request[1] << 8) | request[2];
    const size = request[3];
    this.commands.push(command);
    if (command === 0x0c) {
      reply[1] = this.macroCount;
    } else if (command === 0x0d) {
      reply[1] = this.buffer.length >> 8;
      reply[2] = this.buffer.length & 0xff;
    } else if (command === 0x0e) {
      reply.splice(4, size, ...this.buffer.slice(offset, offset + size));
    } else if (command === 0x0f) {
      this.buffer.splice(offset, size, ...request.slice(4, 4 + size));
    } else if (command === 0x10) {
      if (this.refuseReset) {
        reply[0] = 0xff;
      } else {
        this.buffer.fill(0);
      }
    }
    const message = Uint8Array.from(reply.slice(0, 32));
    this.listeners.forEach((listener) =>
      listener({data: new DataView(message.buffer)}),
    );
  }
}

// The page around the editor: fullscreen and the keyboard lock as the tests drive
// them, and the few measurements the keycode list takes to place itself.
const page = {
  fullscreen: false,
  refuseFullscreen: false,
  fullscreenListeners: new Set<() => void>(),
  keyboard: [] as string[],
};

const setFullscreen = (fullscreen: boolean) => {
  page.fullscreen = fullscreen;
  page.fullscreenListeners.forEach((listener) => listener());
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
  scrollTop: 0,
  offsetTop: 0,
  offsetLeft: 0,
});

const documentElement = {
  addEventListener: (type: string, listener: () => void) => {
    if (type === 'fullscreenchange') {
      page.fullscreenListeners.add(listener);
    }
  },
  removeEventListener: (_type: string, listener: () => void) => {
    page.fullscreenListeners.delete(listener);
  },
  requestFullscreen: async () => {
    if (page.refuseFullscreen) {
      throw new Error('Fullscreen was refused');
    }
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
    value: () => ({getPropertyValue: () => '0'}),
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
  if (originalDocument) {
    Object.defineProperty(globalThis, 'document', originalDocument);
  } else {
    Reflect.deleteProperty(globalThis, 'document');
  }
  if (originalKeyboard) {
    Object.defineProperty(navigator, 'keyboard', originalKeyboard);
  } else {
    Reflect.deleteProperty(navigator, 'keyboard');
  }
  if (originalComputedStyle) {
    Object.defineProperty(
      globalThis,
      'getComputedStyle',
      originalComputedStyle,
    );
  } else {
    Reflect.deleteProperty(globalThis, 'getComputedStyle');
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

/**
 * The script box's element. Its value is the one React last gave it, until the
 * keycode list writes one straight into it, as a browser's textarea behaves.
 */
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
      if (written && written.over === shown) {
        return written.value;
      }
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
      if (type === 'keydown') {
        keydown.add(listener);
      }
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

let scriptBox: ReturnType<typeof scriptBoxElement> | undefined;

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
          if (element.type === 'textarea') {
            scriptBox = scriptBoxElement();
            return scriptBox;
          }
          return inertElement();
        },
      },
    );
  });
  return renderer!.root;
};

/** The element that takes a click for the control drawn with this icon. */
const clickable = (root: ReactTestInstance, icon: unknown) => {
  let node: ReactTestInstance | null = root.find(
    (candidate) => candidate.props.icon === icon,
  );
  while (node && !(typeof node.type === 'string' && node.props.onClick)) {
    node = node.parent;
  }
  return node!;
};

const openScript = (root: ReactTestInstance) => {
  const mode = clickable(root, faCode);
  expect(mode.type).toBe('button');
  expect(mode.props['aria-label']).toBe('스크립트');
  act(() => mode.props.onClick());
  expect(mode.props['aria-pressed']).toBe(true);
};

const openRecorder = (root: ReactTestInstance) => {
  const mode = clickable(root, faClapperboard);
  expect(mode.type).toBe('button');
  expect(mode.props['aria-label']).toBe('녹화');
  act(() => mode.props.onClick());
  expect(mode.props['aria-pressed']).toBe(true);
};

// Typed text ends in whitespace so the box's keycode search stays closed.
const type = (root: ReactTestInstance, value: string) => {
  const textarea = root.find((node) => node.type === 'textarea');
  act(() =>
    textarea.props.onChange({
      target: {value, selectionEnd: value.length},
      persist: () => undefined,
    }),
  );
};

const button = (root: ReactTestInstance, label: string) =>
  root.find((node) => node.type === 'button' && textOf(node) === label);

const applyButton = (root: ReactTestInstance) => button(root, '적용');
const cancelButton = (root: ReactTestInstance) => button(root, '취소');
const tab = (root: ReactTestInstance, name: string) => button(root, name);

const clickApply = async (root: ReactTestInstance) => {
  await act(async () => {
    await applyButton(root).props.onClick();
  });
};

const clickCancel = (root: ReactTestInstance) => {
  act(() => cancelButton(root).props.onClick());
};

const hasDot = (node: ReactTestInstance) =>
  node.findAll((child) => child.type === DirtyDot).length > 0;

const textarea = (root: ReactTestInstance) =>
  root.find((node) => node.type === 'textarea');

/** The recorder's box: its sequence, outlined dashed while it holds a draft. */
const sequenceBox = (root: ReactTestInstance) =>
  root.find((node) => node.props.$isModified !== undefined);

const marks = (root: ReactTestInstance) =>
  root.findAll((node) => node.type === 'mark').map(textOf);

describe('saving a macro script', () => {
  test('a character the keyboard cannot type is marked, named and never sent', async () => {
    const {store, keyboard} = await connect('macro-untypeable');
    const root = await render(store);
    openScript(root);

    type(root, 'Aé 한 “x”\n');
    expect(marks(root)).toEqual(['é', '한', '“', '”']);
    expect(textOf(root)).toContain('영문 자판 글자만');
    expect(applyButton(root).props.disabled).toBe(true);
    expect(keyboard.commands).toEqual([]);

    type(root, 'Ae x\n');
    expect(marks(root)).toEqual([]);
    expect(textOf(root)).not.toContain('영문 자판 글자만');
    expect(applyButton(root).props.disabled).toBe(false);
  });

  test('after a save nothing is left to save, and a final Enter stays', async () => {
    const {store, keyboard} = await connect('macro-saved-state');
    const root = await render(store);
    openScript(root);

    type(root, '{KC_LCTL, KC_C} {kc_a} {0100} ');
    await clickApply(root);
    expect(macros.getExpressions(store.getState() as any)[0]).toBe(
      '{KC_LCTL,KC_C} {KC_A} {100} ',
    );
    // The box then shows what the keyboard holds.
    expect(textarea(root).props.value).toBe('{KC_LCTL,KC_C} {KC_A} {100} ');
    expect(applyButton(root).props.disabled).toBe(true);

    type(root, 'dir\n');
    await clickApply(root);
    expect(keyboard.buffer.slice(0, 5)).toEqual([100, 105, 114, 10, 0]);
    expect(applyButton(root).props.disabled).toBe(true);

    // Opened again, the macro still ends in Enter and reads as saved.
    act(() => renderer!.unmount());
    const reopened = await render(store);
    openScript(reopened);
    expect(reopened.find((node) => node.type === 'textarea').props.value).toBe(
      'dir\n',
    );
    expect(applyButton(reopened).props.disabled).toBe(true);
  });

  test('a failed write keeps the draft and says so quietly', async () => {
    const {store, keyboard} = await connect('macro-save-fails', {
      stored: ['A', ''],
    });
    const root = await render(store);
    openScript(root);

    type(root, 'B\n');
    keyboard.refuseReset = true;
    await clickApply(root);
    const messages = root
      .findAll(
        (node) => typeof node.type === 'string' && node.props.role === 'status',
      )
      .map(textOf)
      .filter(Boolean);
    // The shared Apply row also keeps an empty live region mounted.
    expect(messages).toEqual(['저장하지 못했습니다.']);
    expect(root.find((node) => node.type === 'textarea').props.value).toBe(
      'B\n',
    );
    expect(applyButton(root).props.disabled).toBe(false);
    expect(macros.getExpressions(store.getState() as any)[0]).toBe('A');

    keyboard.refuseReset = false;
    await clickApply(root);
    expect(textOf(root)).not.toContain('저장하지 못했습니다.');
    expect(applyButton(root).props.disabled).toBe(true);
    expect(macros.getExpressions(store.getState() as any)[0]).toBe('B\n');
  });

  test('a script the keyboard cannot play is named in a few words, and not sent', async () => {
    const {store, keyboard} = await connect('macro-refused');
    const root = await render(store);
    openScript(root);

    for (const [script, words] of [
      ['{KC_FOO} ', '알 수 없는 키: KC_FOO'],
      ['{KC_A ', '닫는 } 없음'],
      ['a{ } ', '빈 {}'],
    ]) {
      type(root, script);
      await clickApply(root);
      const alert = root.find(
        (node) => typeof node.type === 'string' && node.props.role === 'alert',
      );
      expect(textOf(alert)).toBe(words);
    }
    expect(keyboard.commands).toEqual([]);

    type(root, 'fixed ');
    expect(
      root.findAll(
        (node) => typeof node.type === 'string' && node.props.role === 'alert',
      ),
    ).toEqual([]);
  });

  test('the usage bar measures the draft, and a draft that does not fit is not sent', async () => {
    // 16 bytes: 15 for the macros and the completion marker.
    const {store, keyboard} = await connect('macro-too-large', {size: 16});
    const root = await render(store);
    const bar = () => root.find((node) => node.props.$over !== undefined);
    expect(bar().props.$over).toBe(false);
    expect(textOf(root)).toContain('2 / 15 Bytes');

    openScript(root);
    type(root, 'abcdefghijklmn ');
    expect(textOf(root)).toContain('17 / 15 Bytes');
    expect(bar().props.$over).toBe(true);
    expect(applyButton(root).props.disabled).toBe(true);
    expect(keyboard.commands).toEqual([]);
  });
});

describe('saving a recorded macro', () => {
  const waitInput = (root: ReactTestInstance) =>
    root.find((node) => node.type === 'input' && node.props.type === 'number');

  test('a failed save keeps the recording and its outline, even when the macros are read again', async () => {
    const {store, keyboard, connected, hid} = await connect(
      'macro-recording-fails',
      {stored: ['{KC_A}{500}{KC_B}', '']},
    );
    const root = await render(store);
    act(() => waitInput(root).props.onChange({target: {value: '700'}}));
    expect(sequenceBox(root).props.$isModified).toBe(true);

    keyboard.refuseReset = true;
    await clickApply(root);
    expect(textOf(root)).toContain('저장하지 못했습니다.');
    expect(sequenceBox(root).props.$isModified).toBe(true);

    // A State Sync keyboard reads its macros again after a failed write.
    const state = store.getState();
    act(() => {
      store.dispatch(
        candidates.commitStableMacroCandidate({
          devicePath: connected.path,
          connectionGeneration: hid.getConnectionGeneration(),
          selectionGeneration: state.devices.selectionGeneration,
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
      );
    });
    expect(sequenceBox(root).props.$isModified).toBe(true);
    expect(waitInput(root).props.value).toBe(700);

    keyboard.refuseReset = false;
    await clickApply(root);
    expect(sequenceBox(root).props.$isModified).toBe(false);
    expect(macros.getExpressions(store.getState() as any)[0]).toBe(
      '{KC_A}{700}{KC_B}',
    );
  });

  test('a wait takes at most four digits', async () => {
    const {store} = await connect('macro-wait-field', {
      stored: ['{KC_A}{500}{KC_B}', ''],
    });
    const root = await render(store);
    expect(waitInput(root).props.placeholder).toBe('XXXX');
    act(() => waitInput(root).props.onChange({target: {value: '15000'}}));
    expect(waitInput(root).props.value).toBe(500);
    act(() => waitInput(root).props.onChange({target: {value: '9999'}}));
    expect(waitInput(root).props.value).toBe(9999);
  });

  test('a recording holding a key the keyboard names differently is saved again', async () => {
    // {KC_CLEAR} is held as 0x9C, which reads back as {KC_CLR}.
    const {store, keyboard} = await connect('macro-recording-read-back', {
      stored: ['{KC_CLEAR}{500}{KC_B}', ''],
    });
    const root = await render(store);
    act(() => waitInput(root).props.onChange({target: {value: '700'}}));
    await clickApply(root);
    expect(
      root
        .findAll(
          (node) =>
            typeof node.type === 'string' && node.props.role === 'alert',
        )
        .map(textOf),
    ).toEqual([]);
    expect(sequenceBox(root).props.$isModified).toBe(false);
    expect(keyboard.buffer.slice(0, 13)).toEqual(
      macroBytes('{KC_CLR}{700}{KC_B}'),
    );
  });
});

describe('writing macros', () => {
  test('a long wait is written as four-digit waits and kept as the keyboard reads it', async () => {
    const {store, keyboard, connected} = await connect('macro-write-split');
    await store.dispatch(
      macros.saveMacros(connected, ['{KC_A}{15000}', '{KC_CLEAR}']) as any,
    );
    expect(keyboard.buffer.slice(0, 22)).toEqual(
      macroBytes('{KC_A}{9999}{5001}', '{KC_CLR}'),
    );
    expect(macros.getExpressions(store.getState() as any)).toEqual([
      '{KC_A}{9999}{5001}',
      '{KC_CLR}',
    ]);
  });
});

describe('macro drafts', () => {
  test('a slot keeps its draft across M tabs, Record and Script, and leaving the pane', async () => {
    const {store, keyboard} = await connect('macro-draft-kept', {
      stored: ['A', 'B'],
    });
    let root = await render(store);
    openScript(root);
    type(root, 'hello\n');
    expect(hasDot(tab(root, 'M0'))).toBe(true);
    expect(hasDot(tab(root, 'M1'))).toBe(false);
    expect(textarea(root).props.style.borderStyle).toBe('dashed');

    act(() => tab(root, 'M1').props.onClick());
    expect(textarea(root).props.value).toBe('B');
    expect(applyButton(root).props.disabled).toBe(true);
    act(() => tab(root, 'M0').props.onClick());
    expect(textarea(root).props.value).toBe('hello\n');
    expect(applyButton(root).props.disabled).toBe(false);

    // The recorder shows the same draft, outlined as not written.
    openRecorder(root);
    expect(textOf(sequenceBox(root))).toContain('hello');
    expect(sequenceBox(root).props.$isModified).toBe(true);

    // Another pane and back: the pane is built anew.
    act(() => renderer!.unmount());
    root = await render(store);
    expect(hasDot(tab(root, 'M0'))).toBe(true);
    openScript(root);
    expect(textarea(root).props.value).toBe('hello\n');
    expect(cancelButton(root).props.disabled).toBe(false);
    expect(keyboard.commands).toEqual([]);

    // Cancel puts the keyboard's macro back without writing.
    clickCancel(root);
    expect(textarea(root).props.value).toBe('A');
    expect(textarea(root).props.style.borderStyle).toBe('solid');
    expect(hasDot(tab(root, 'M0'))).toBe(false);
    expect(applyButton(root).props.disabled).toBe(true);
    expect(cancelButton(root).props.disabled).toBe(true);
    expect(keyboard.commands).toEqual([]);

    // Unplugged, the keyboard takes its drafts with it.
    type(root, 'bye ');
    act(() => {
      store.dispatch(devices.updateConnectedDevices({}));
    });
    expect(store.getState().drafts).toEqual({});
  });

  test('Apply writes the slot it is on and leaves the drafts of the others', async () => {
    const {store} = await connect('macro-apply-one', {stored: ['A', 'B']});
    const root = await render(store);
    openScript(root);
    type(root, 'one ');
    act(() => tab(root, 'M1').props.onClick());
    type(root, 'two ');
    await clickApply(root);
    expect(macros.getExpressions(store.getState() as any)).toEqual([
      'A',
      'two ',
    ]);
    expect(hasDot(tab(root, 'M0'))).toBe(true);
    expect(hasDot(tab(root, 'M1'))).toBe(false);
    act(() => tab(root, 'M0').props.onClick());
    expect(textarea(root).props.value).toBe('one ');
  });

  test('a draft spelled differently from the macro has nothing to write', async () => {
    const {store} = await connect('macro-same-draft', {
      stored: ['{KC_LCTL,KC_C}', ''],
    });
    const root = await render(store);
    openScript(root);
    type(root, 'changed');
    expect(applyButton(root).props.disabled).toBe(false);
    type(root, '{kc_lctl, kc_c}');
    expect(hasDot(tab(root, 'M0'))).toBe(false);
    expect(applyButton(root).props.disabled).toBe(true);
    expect(textarea(root).props.value).toBe('{kc_lctl, kc_c}');
  });

  test('the slot open when the pane is left is open when it comes back', async () => {
    const {store} = await connect('macro-slot-kept', {stored: ['A', 'B']});
    let root = await render(store);
    act(() => tab(root, 'M1').props.onClick());

    // Another pane or page and back: the pane is built anew.
    act(() => renderer!.unmount());
    root = await render(store);
    expect(tab(root, 'M1').props['aria-pressed']).toBe(true);
    expect(tab(root, 'M0').props['aria-pressed']).toBe(false);
    openScript(root);
    expect(textarea(root).props.value).toBe('B');
  });
});

describe('a script shown in the recorder', () => {
  const itemDeletes = (root: ReactTestInstance) =>
    sequenceBox(root).findAll((node) => node.props.icon === faXmarkCircle);

  const waitInputs = (root: ReactTestInstance) =>
    sequenceBox(root).findAll(
      (node) => node.type === 'input' && node.props.type === 'number',
    );

  const alerts = (root: ReactTestInstance) =>
    root
      .findAll(
        (node) => typeof node.type === 'string' && node.props.role === 'alert',
      )
      .map(textOf);

  test('one the keyboard refuses is not rewritten into one it takes', async () => {
    const {store, keyboard} = await connect('macro-recorder-refused-script');
    const root = await render(store);
    openScript(root);
    for (const [script, words] of [
      // Written back as the recorder reads it, the key would be {+KC_A}: A held down.
      ['x{ +KC_A }{100}y', '알 수 없는 키: +KC_A'],
      // The empty block is not among the recorder's items at all.
      ['a{ }b y', '빈 {}'],
    ]) {
      type(root, script);
      await clickApply(root);
      expect(alerts(root)).toEqual([words]);

      openRecorder(root);
      // Taking out the last item is all it would take.
      const deletes = itemDeletes(root);
      act(() => deletes[deletes.length - 1]?.props.onClick());
      await clickApply(root);
      expect(alerts(root)).toEqual([words]);
      expect(waitInputs(root).every((input) => input.props.disabled)).toBe(
        true,
      );

      openScript(root);
      expect(textarea(root).props.value).toBe(script);
    }
    expect(keyboard.commands).toEqual([]);
  });

  test('a key with no name of its own shows the name it was typed with', async () => {
    const {store} = await connect('macro-recorder-unknown-key');
    const root = await render(store);
    openScript(root);
    type(root, 'x{ +KC_A }{KC_FOO}{KC_LCTL,KC_BAR}');
    openRecorder(root);
    const shown = textOf(sequenceBox(root));
    for (const name of ['+KC_A', 'KC_FOO', 'KC_BAR']) {
      expect({name, shown: shown.includes(name)}).toEqual({name, shown: true});
    }
  });

  test('one the keyboard takes is edited item by item', async () => {
    const {store} = await connect('macro-recorder-valid-script');
    const root = await render(store);
    openScript(root);
    type(root, 'x{kc_a}{100}y');
    openRecorder(root);
    expect(waitInputs(root).map((input) => !input.props.disabled)).toEqual([
      true,
    ]);
    const deletes = itemDeletes(root);
    expect(deletes.length).toBe(4);
    act(() => deletes[3].props.onClick());
    await clickApply(root);
    expect(alerts(root)).toEqual([]);
    expect(macros.getExpressions(store.getState() as any)[0]).toBe(
      'x{KC_A}{100}',
    );
  });
});

describe('recording a macro', () => {
  const draftsOf = (store: TestStore, path: string) =>
    store.getState().drafts[path] ?? {};

  /** A key event on the page, as the recorder hears it. */
  const key = (type: 'keydown' | 'keyup', code: string) => {
    const event = Object.assign(new Event(type), {code, repeat: false});
    act(() => {
      globalThis.dispatchEvent(event);
    });
  };

  const tap = (code: string) => {
    key('keydown', code);
    key('keyup', code);
  };

  /** Presses ● and lets fullscreen and the keyboard lock answer. */
  const pressRecord = async (root: ReactTestInstance) => {
    await act(async () => {
      clickable(root, faCircle).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  test('one press goes to fullscreen and records, and another M tab ends the recording in its own slot', async () => {
    const path = 'macro-record-tab';
    const {store, keyboard} = await connect(path, {stored: ['A', 'B']});
    const root = await render(store);
    expect(clickable(root, faCircle).props.disabled).toBeFalsy();

    await pressRecord(root);
    expect(page.fullscreen).toBe(true);
    expect(page.keyboard).toEqual(['lock']);
    tap('KeyH');
    tap('KeyI');
    expect(textOf(sequenceBox(root))).toBe('hi');
    expect(clickable(root, faSquare).props.disabled).toBeFalsy();
    expect(applyButton(root).props.disabled).toBe(true);

    act(() => tab(root, 'M1').props.onClick());
    expect(page.keyboard).toEqual(['lock', 'unlock']);
    expect(textOf(sequenceBox(root))).toBe('B');
    expect(hasDot(tab(root, 'M0'))).toBe(true);
    expect(hasDot(tab(root, 'M1'))).toBe(false);
    tap('KeyX');
    expect(draftsOf(store, path)).toEqual({'macro:0': 'hi'});

    act(() => tab(root, 'M0').props.onClick());
    expect(textOf(sequenceBox(root))).toBe('hi');
    expect(keyboard.commands).toEqual([]);
    await clickApply(root);
    expect(macros.getExpressions(store.getState() as any)).toEqual(['hi', 'B']);
    expect(hasDot(tab(root, 'M0'))).toBe(false);
  });

  test('leaving fullscreen ends the recording, without the Escape held to leave', async () => {
    const path = 'macro-record-exit';
    const {store} = await connect(path);
    const root = await render(store);
    await pressRecord(root);
    tap('KeyA');
    key('keydown', 'Escape');
    // The browser leaves fullscreen while Escape is held.
    act(() => setFullscreen(false));
    expect(page.keyboard).toEqual(['lock', 'unlock']);
    expect(clickable(root, faCircle).props.disabled).toBeFalsy();
    expect(draftsOf(store, path)).toEqual({'macro:0': 'a'});
    expect(sequenceBox(root).props.$isModified).toBe(true);

    key('keyup', 'Escape');
    tap('KeyB');
    expect(draftsOf(store, path)).toEqual({'macro:0': 'a'});
  });

  test('a refused fullscreen leaves the recorder waiting', async () => {
    const path = 'macro-record-refused';
    const {store} = await connect(path);
    const root = await render(store);
    page.refuseFullscreen = true;
    await pressRecord(root);
    expect(page.keyboard).toEqual([]);
    expect(clickable(root, faCircle).props.disabled).toBeFalsy();
    tap('KeyA');
    expect(draftsOf(store, path)).toEqual({});
  });

  test('the script box shows a recording that was going when it was opened', async () => {
    const path = 'macro-record-script';
    const {store} = await connect(path, {stored: ['A', '']});
    const root = await render(store);
    await pressRecord(root);
    tap('KeyO');
    tap('KeyK');
    openScript(root);
    expect(page.keyboard).toEqual(['lock', 'unlock']);
    expect(textarea(root).props.value).toBe('ok');
    expect(applyButton(root).props.disabled).toBe(false);
    tap('KeyX');
    expect(textarea(root).props.value).toBe('ok');
  });

  test('the bin empties the editor as a draft, which Cancel takes back', async () => {
    const {store, keyboard} = await connect('macro-clear', {
      stored: ['abc', ''],
    });
    const root = await render(store);
    const bin = clickable(root, faTrash);
    expect(textOf(bin)).toBe('비우기');
    act(() => bin.props.onClick());
    expect(keyboard.commands).toEqual([]);
    expect(textOf(sequenceBox(root))).toBe(
      '아직 매크로가 기록되지 않았습니다...',
    );
    expect(sequenceBox(root).props.$isModified).toBe(true);
    expect(hasDot(tab(root, 'M0'))).toBe(true);

    clickCancel(root);
    expect(textOf(sequenceBox(root))).toBe('abc');
    expect(hasDot(tab(root, 'M0'))).toBe(false);
    expect(keyboard.commands).toEqual([]);

    act(() => clickable(root, faTrash).props.onClick());
    await clickApply(root);
    expect(macros.getExpressions(store.getState() as any)).toEqual(['', '']);
    expect(hasDot(tab(root, 'M0'))).toBe(false);
  });
});

describe('the script box', () => {
  /** Types into the box and lets the keycode list look up what it offers. */
  const typeAndSettle = async (root: ReactTestInstance, value: string) => {
    await act(async () => {
      textarea(root).props.onChange({
        target: {value, selectionEnd: value.length},
        persist: () => undefined,
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  /** A key pressed in the box, as the box's own listeners take it. */
  const pressInBox = async (keyCode: number) => {
    const event: BoxKey = {
      type: 'keydown',
      keyCode,
      which: keyCode,
      defaultPrevented: false,
      preventDefault() {
        event.defaultPrevented = true;
      },
      stopPropagation: () => undefined,
    };
    await act(async () => {
      scriptBox!.keydown.forEach((listener) => listener(event));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return event;
  };

  const keycodeList = (root: ReactTestInstance) =>
    root.findAll((node) => node.type === 'li');

  test('Enter after a comma or a question mark stays a line break', async () => {
    const {store} = await connect('macro-script-enter');
    const root = await render(store);
    openScript(root);
    for (const text of ['Thanks,', 'How are you?']) {
      await typeAndSettle(root, text);
      const enter = await pressInBox(13);
      expect({
        text,
        taken: enter.defaultPrevented,
        list: keycodeList(root).length,
        value: textarea(root).props.value,
      }).toEqual({text, taken: false, list: 0, value: text});
      await typeAndSettle(root, '');
    }

    // Inside a keycode block the list opens, Enter picks from it, and the comma it
    // writes offers the next key of a chord.
    await typeAndSettle(root, '{');
    expect(keycodeList(root).length).toBeGreaterThan(0);
    const pick = await pressInBox(13);
    expect(pick.defaultPrevented).toBe(true);
    expect(textarea(root).props.value).toMatch(/^\{KC_\w+,$/);
    expect(keycodeList(root).length).toBeGreaterThan(0);
  });

  test('one line of examples sits under the box, without a wait where the keyboard has none', async () => {
    const examples = [
      'abc',
      '{KC_ENT}',
      '{KC_LCTL,KC_C}',
      '{+KC_LSFT}',
      '{-KC_LSFT}',
    ];
    for (const [protocol, expected] of [
      [12, [...examples, '{100}']],
      [10, examples],
    ] as const) {
      const {store} = await connect(`macro-examples-${protocol}`, {protocol});
      const root = await render(store);
      openScript(root);
      const line = root.findByType(script.ScriptExample);
      expect({
        protocol,
        examples: line
          .findAll((node) => node.type === 'span')
          .map((node) => textOf(node)),
      }).toEqual({protocol, examples: [...expected]});
      expect(textarea(root).props.placeholder).toBeUndefined();
      expect(textOf(root)).not.toContain('?');
      act(() => renderer!.unmount());
      renderer = undefined;
      resetHIDTransportForTesting();
    }
  });
});
