import './setup';
import {configureStore} from '@reduxjs/toolkit';
import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import i18n from 'i18next';
import {I18nextProvider} from 'react-i18next';
import {Provider} from 'react-redux';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import basicKeyToByte from '../src/utils/key-to-byte/default';
import {TestKeyState} from '../src/types/types';

const originalWarn = console.warn;
console.warn = () => undefined;
await import('../src/utils/keyboard-api');
const {migrateTestKeyboardSounds} = await import('../src/utils/device-store');
const {TestKeyboardSounds, TestKeyboardSoundsMode} =
  await import('../src/components/void/test-keyboard-sounds');
const {ANSI_TEST_LAYOUT, evtToKeyByte, getTestKeyboardKeys, locateTestKey, matrixKeycodes} =
  await import('../src/utils/key-event');
const {useGlobalKeys} = await import('../src/utils/use-global-keys');
const {useMatrixTest} = await import('../src/utils/use-matrix-test');
const {
  initialTestContext,
  TestContext,
  Test: TestPane,
} = await import('../src/components/panes/test');
const {useProgress} = await import('@react-three/drei');
console.warn = originalWarn;

const originalDocument = Object.getOwnPropertyDescriptor(
  globalThis,
  'document',
);
let page: EventTarget & {hidden: boolean};
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  page = Object.assign(new EventTarget(), {hidden: false});
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: page,
  });
});
const unmount = () => {
  act(() => renderer?.unmount());
  renderer = undefined;
};
afterEach(() => {
  unmount();
  if (originalDocument)
    Object.defineProperty(globalThis, 'document', originalDocument);
  else Reflect.deleteProperty(globalThis, 'document');
});
const render = (element: JSX.Element) =>
  act(() => {
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });
type Target = {closest: (selector: string) => object | null};
const settingsControl: Target = {closest: () => ({})};
const otherControl: Target = {
  closest: (selector) => (selector === '[data-key-test-settings]' ? null : {}),
};
const key = (
  type: 'keydown' | 'keyup',
  code: string,
  {target, ...modifiers}: {target?: Target; ctrlKey?: boolean} = {},
) => {
  const event = Object.assign(new Event(type, {cancelable: true}), {
    code,
    key: code,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  });
  if (target) Object.defineProperty(event, 'target', {value: target});
  act(() => window.dispatchEvent(event));
  return event;
};
const colOf = (keycode: number) => matrixKeycodes.indexOf(keycode);
let globalKeys: ReturnType<typeof useGlobalKeys>;
const GlobalKeys = ({enabled}: {enabled: boolean}) => {
  globalKeys = useGlobalKeys(enabled);
  return null;
};

describe('general key testing', () => {
  test('every drawn key maps to its matrix column in every reachable layout', () => {
    const codes = Object.keys(evtToKeyByte) as (keyof typeof evtToKeyByte)[];
    const layouts = new Map(
      codes.map((code) => {
        const layout = locateTestKey({code, key: code}, ANSI_TEST_LAYOUT)!.layout;
        return [JSON.stringify(layout), layout];
      }),
    );
    for (const layout of layouts.values()) {
      for (const drawn of getTestKeyboardKeys(layout)) {
        const byte = matrixKeycodes[drawn.col];
        const code = codes.find(
          (code) =>
            evtToKeyByte[code] === byte ||
            (byte === basicKeyToByte.KC_NUHS && code === 'Backslash'),
        );
        expect(code).toBeDefined();
        expect(locateTestKey({code: code!, key: code!}, layout)).toEqual({
          col: drawn.col,
          layout,
        });
      }
    }
  });

  test('Space and Enter after Clear remain key presses, not another Clear', () => {
    const translations = i18n.createInstance();
    translations.init({lng: 'en', resources: {en: {translation: {}}}});
    const store = configureStore({
      reducer: () =>
        ({
          settings: {
            testKeyboardSoundsSettings: {
              isEnabled: false,
              volume: 50,
              waveform: 'sine',
              mode: TestKeyboardSoundsMode.WickiHayden,
              transpose: 0,
            },
          },
        }) as any,
    });
    let clears = 0;
    render(<GlobalKeys enabled={true} />);
    const keysRenderer = renderer!;
    renderer = undefined;
    useProgress.setState({progress: 100});
    try {
      // This renderer has no DOM for the pane's unrelated tooltip portal.
      Reflect.deleteProperty(globalThis, 'document');
      render(
        <Provider store={store}>
          <I18nextProvider i18n={translations}>
            <TestContext.Provider
              value={[
                {
                  ...initialTestContext,
                  clearTestKeys: () => {
                    clears++;
                    globalKeys.setPressedKeys({});
                  },
                },
                () => undefined,
              ]}
            >
              <TestPane />
            </TestContext.Provider>
          </I18nextProvider>
        </Provider>,
      );
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: page,
      });
      const clear = renderer!.root.find(
        (node) =>
          node.type === 'button' && node.children.join('') === 'Clear',
      );
      for (const [code, byte] of [
        ['Space', basicKeyToByte.KC_SPC],
        ['Enter', basicKeyToByte.KC_ENT],
      ] as const) {
        key('keydown', 'KeyA');
        const mouseDown = new Event('mousedown', {cancelable: true});
        act(() => {
          clear.props.onMouseDown(mouseDown);
          clear.props.onClick();
        });
        expect(mouseDown.defaultPrevented).toBe(true);
        expect(globalKeys.pressedKeys).toEqual({});
        const before = clears;
        for (const type of ['keydown', 'keyup'] as const) {
          const event = key(type, code, {target: otherControl});
          // A native button activation is suppressed when the key is consumed.
          if (!event.defaultPrevented) act(() => clear.props.onClick());
          expect(event.defaultPrevented).toBe(true);
          expect(globalKeys.pressedKeys[colOf(byte)]).toBe(
            type === 'keydown' ? TestKeyState.KeyDown : TestKeyState.KeyUp,
          );
          expect(clears).toBe(before);
        }
      }
    } finally {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: page,
      });
      act(() => keysRenderer.unmount());
    }
  });

  test('held keys are released on blur or hide and input stops off the test screen', () => {
    render(<GlobalKeys enabled={true} />);
    for (const exit of ['blur', 'hidden']) {
      key('keydown', 'KeyA');
      expect(globalKeys.pressedKeys[colOf(basicKeyToByte.KC_A)]).toBe(
        TestKeyState.KeyDown,
      );
      act(() => {
        if (exit === 'blur') window.dispatchEvent(new Event('blur'));
        else {
          page.hidden = true;
          page.dispatchEvent(new Event('visibilitychange'));
        }
      });
      expect(globalKeys.pressedKeys[colOf(basicKeyToByte.KC_A)]).toBe(
        TestKeyState.KeyUp,
      );
    }
    render(<GlobalKeys enabled={false} />);
    key('keydown', 'KeyD');
    expect(globalKeys.pressedKeys[colOf(basicKeyToByte.KC_D)]).toBeUndefined();
  });

  test('international keys appear and light on their first press; unplaced keys are named', () => {
    render(<GlobalKeys enabled={true} />);
    expect(globalKeys.unplacedKey).toBeNull();
    for (const [code, byte] of [
      ['IntlBackslash', basicKeyToByte.KC_NUBS],
      ['IntlRo', basicKeyToByte.KC_RO],
      ['IntlYen', basicKeyToByte.KC_JYEN],
    ] as const) {
      key('keydown', code);
      const col = colOf(byte);
      expect(globalKeys.pressedKeys[col]).toBe(TestKeyState.KeyDown);
      expect(
        getTestKeyboardKeys(globalKeys.layout).some((item) => item.col === col),
      ).toBe(true);
    }
    key('keydown', 'F13');
    expect(globalKeys.unplacedKey?.name).toBe('F13');
  });
});

const device = {
  path: 'key-tester',
  protocol: 12,
  vendorProductId: 0x12345678,
} as any;
const definition = {matrix: {rows: 5, cols: 15}} as any;
const matrixApi = (reply: () => number[]) => {
  const api = {
    reads: 0,
    getKeyboardValue: async (
      _command: number,
      _args: number[],
      size: number,
    ) => {
      api.reads++;
      return reply().concat(Array(size).fill(0)).slice(0, size);
    },
    timeout: () => new Promise((resolve) => setTimeout(resolve, 5)),
  };
  return api;
};
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

describe('explicit matrix testing', () => {
  test('only explicit matrix mode polls, reports switch bits and stops when deselected', async () => {
    for (const [reply, pressed] of [
      [[0, 0, 0, 0b100], true],
      [[], false],
    ] as const) {
      const api = matrixApi(() => [...reply]);
      let keys: TestKeyState[] = [];
      const Matrix = ({chosen}: {chosen: boolean}) => {
        [keys] = useMatrixTest(chosen, api as any, device, definition);
        return null;
      };
      render(<Matrix chosen={initialTestContext.testMatrix} />);
      key('keydown', 'KeyA');
      await settle();
      expect(api.reads).toBe(0);
      render(<Matrix chosen={true} />);
      await settle();
      expect(api.reads).toBeGreaterThan(0);
      expect(keys.includes(TestKeyState.KeyDown)).toBe(pressed);
      render(<Matrix chosen={false} />);
      const stopped = api.reads;
      await settle();
      expect(api.reads).toBe(stopped);
      unmount();
    }
  });

  test('settings receive typing in either mode while browser shortcuts stay blocked', () => {
    const api = matrixApi(() => []);
    const Matrix = () => {
      useMatrixTest(true, api as any, device, definition);
      return null;
    };
    for (const view of [<GlobalKeys enabled={true} />, <Matrix />]) {
      render(view);
      for (const code of ['Tab', 'Space', 'Enter', 'ArrowDown']) {
        for (const type of ['keydown', 'keyup'] as const) {
          expect(
            key(type, code, {target: settingsControl}).defaultPrevented,
          ).toBe(false);
        }
      }
      expect(
        key('keydown', 'KeyF', {target: settingsControl, ctrlKey: true})
          .defaultPrevented,
      ).toBe(true);
      expect(
        key('keydown', 'F5', {target: settingsControl}).defaultPrevented,
      ).toBe(true);
      expect(
        key('keydown', 'Tab', {target: otherControl}).defaultPrevented,
      ).toBe(true);
      unmount();
    }
  });

  test('a matrix failure stops polling but a late failure after leaving is ignored', async () => {
    for (const leave of [false, true]) {
      let rejectRead!: (reason: Error) => void;
      let failures = 0;
      let reads = 0;
      const api = {
        getKeyboardValue: () => {
          reads++;
          return new Promise<number[]>((_resolve, reject) => {
            rejectRead = reject;
          });
        },
      };
      const Matrix = ({chosen}: {chosen: boolean}) => {
        useMatrixTest(chosen, api as any, device, definition, () => {
          failures++;
        });
        return null;
      };
      render(<Matrix chosen={true} />);
      if (leave) render(<Matrix chosen={false} />);
      await act(async () => rejectRead(new Error('not responding')));
      await settle();
      expect(failures).toBe(leave ? 0 : 1);
      expect(reads).toBe(1);
      unmount();
    }
  });

  test('a reply from an earlier matrix session cannot update a later one', async () => {
    const answers: ((flat: number[]) => void)[] = [];
    const api = {
      getKeyboardValue: () =>
        new Promise<number[]>((resolve) => answers.push(resolve)),
      timeout: () => new Promise((resolve) => setTimeout(resolve, 1)),
    };
    let keys: TestKeyState[] = [];
    const Matrix = ({chosen}: {chosen: boolean}) => {
      [keys] = useMatrixTest(chosen, api as any, device, definition);
      return null;
    };
    render(<Matrix chosen={true} />);
    render(<Matrix chosen={false} />);
    render(<Matrix chosen={true} />);
    await act(async () => answers[0]([0, 0, 0, 0b100, 0, 0, 0, 0, 0, 0]));
    expect(answers).toHaveLength(2);
    expect(keys).toEqual([]);
  });
});

test('the matrix switch respects availability and clears an old read failure', () => {
  Reflect.deleteProperty(globalThis, 'document');
  const translations = i18n.createInstance();
  translations.init({lng: 'en', resources: {en: {translation: {}}}});
  const store = configureStore({
    reducer: () =>
      ({
        settings: {
          ShowSliderValuesMode: 'Slider Only',
          testKeyboardSoundsSettings: {
            isEnabled: false,
            volume: 50,
            waveform: 'sine',
            mode: TestKeyboardSoundsMode.WickiHayden,
            transpose: 0,
          },
        },
      }) as any,
  });
  useProgress.setState({progress: 100});
  for (const available of [false, true]) {
    let chosen = {
      ...initialTestContext,
      matrixAvailable: available,
      matrixReadFailed: true,
    };
    const view = () => (
      <Provider store={store}>
        <I18nextProvider i18n={translations}>
          <TestContext.Provider
            value={[
              chosen,
              (next) => {
                chosen = typeof next === 'function' ? next(chosen) : next;
              },
            ]}
          >
            <TestPane />
          </TestContext.Provider>
        </I18nextProvider>
      </Provider>
    );
    render(view());
    const input = () =>
      renderer!.root.find(
        (node) =>
          node.type === 'input' &&
          node.props.type === 'checkbox' &&
          node.props['aria-labelledby'],
      );
    expect(input().props.disabled).toBe(!available);
    act(() => input().props.onChange());
    expect(chosen.testMatrix).toBe(available);
    expect(chosen.matrixReadFailed).toBe(!available);
    if (available) {
      render(view());
      act(() => input().props.onChange());
      expect(chosen.testMatrix).toBe(false);
    }
    unmount();
  }
});

test('key sounds stop when a held key moves to another keyboard picture and is released', () => {
  const sounds: {playing: boolean}[] = [];
  class ParamStub {
    value = 0;
    setValueAtTime() {}
    linearRampToValueAtTime() {}
    cancelScheduledValues() {}
  }
  class NodeStub {
    connect() {}
  }
  class AudioContextStub {
    currentTime = 0;
    destination = new NodeStub();
    createGain() {
      return Object.assign(new NodeStub(), {gain: new ParamStub()});
    }
    createDynamicsCompressor() {
      return Object.assign(new NodeStub(), {
        threshold: new ParamStub(),
        knee: new ParamStub(),
        ratio: new ParamStub(),
        attack: new ParamStub(),
        release: new ParamStub(),
      });
    }
  }
  class OscillatorStub extends NodeStub {
    sound = {playing: false};
    constructor() {
      super();
      sounds.push(this.sound);
    }
    start() {
      this.sound.playing = true;
    }
    stop() {
      this.sound.playing = false;
    }
  }
  Object.assign(globalThis, {
    AudioContext: AudioContextStub,
    OscillatorNode: OscillatorStub,
  });
  const store = configureStore({
    reducer: () =>
      ({
        settings: {
          testKeyboardSoundsSettings: {
            isEnabled: true,
            volume: 50,
            waveform: 'sine',
            mode: TestKeyboardSoundsMode.WickiHayden,
            transpose: 0,
          },
        },
      }) as any,
  });
  try {
    for (const [count, row, col, state, playing] of [
      [6, 5, 3, TestKeyState.KeyDown, 1],
      [5, 4, 0, TestKeyState.KeyDown, 1],
      [5, 4, 0, TestKeyState.KeyUp, 0],
    ]) {
      const keys = Array.from({length: count}, () =>
        Array(4).fill(TestKeyState.Initial),
      );
      keys[row][col] = state;
      render(
        <Provider store={store}>
          <TestKeyboardSounds pressedKeys={keys} />
        </Provider>,
      );
      expect(sounds.filter((sound) => sound.playing).length).toBe(playing);
    }
  } finally {
    unmount();
    Reflect.deleteProperty(globalThis, 'AudioContext');
    Reflect.deleteProperty(globalThis, 'OscillatorNode');
  }
});

test('saved sound settings migrate untouched defaults once and preserve user choices', () => {
  const defaults = {
    isEnabled: true,
    volume: 100,
    waveform: 'sine' as const,
    mode: TestKeyboardSoundsMode.WickiHayden,
    transpose: 0,
  };
  const settings = (sounds: object) =>
    ({themeName: 'OLIVIA_DARK', testKeyboardSoundsSettings: sounds}) as any;
  const migrated = migrateTestKeyboardSounds(settings(defaults));
  expect(migrated.testKeyboardSoundsSettings).toEqual({
    ...defaults,
    isEnabled: false,
    volume: 50,
  });
  expect(
    migrateTestKeyboardSounds({
      ...migrated,
      testKeyboardSoundsSettings: defaults,
    }).testKeyboardSoundsSettings,
  ).toEqual(defaults);
  for (const changes of [
    {volume: 80},
    {transpose: 2},
    {waveform: 'square'},
    {mode: TestKeyboardSoundsMode.Chromatic},
    {isEnabled: false},
  ]) {
    const chosen = {...defaults, ...changes};
    expect(
      migrateTestKeyboardSounds(settings(chosen)).testKeyboardSoundsSettings,
    ).toEqual(chosen);
  }
});
