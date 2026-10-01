import './setup';
import {configureStore} from '@reduxjs/toolkit';
import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import i18n from 'i18next';
import {I18nextProvider} from 'react-i18next';
import {Provider} from 'react-redux';
import {renderToStaticMarkup} from 'react-dom/server';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import basicKeyToByte from '../src/utils/key-to-byte/default';
import {TestKeyState} from '../src/types/types';

// The store slices import each other; keyboard-api settles that cycle the way
// the app's store does, so it loads before anything that reads the store.
const originalWarn = console.warn;
console.warn = () => undefined;
await import('../src/utils/keyboard-api');
const {migrateTestKeyboardSounds} = await import('../src/utils/device-store');
const {TestKeyboardSounds, TestKeyboardSoundsMode} = await import(
  '../src/components/void/test-keyboard-sounds'
);
const {
  ANSI_TEST_LAYOUT,
  evtToKeyByte,
  getTestKeyboardKeys,
  locateTestKey,
  matrixKeycodes,
} = await import('../src/utils/key-event');
const {useGlobalKeys} = await import('../src/utils/use-global-keys');
const {useMatrixTest} = await import('../src/utils/use-matrix-test');
const {initialTestContext, TestContext, Test: TestPane} = await import('../src/components/panes/test');
const {HelpRow, HelpText} = await import('../src/components/panes/configure-panes/custom/feature-help');
const {useProgress} = await import('@react-three/drei');
console.warn = originalWarn;

type Layout = number[];
type Target = {closest: (selector: string) => object | null};

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

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  if (originalDocument) {
    Object.defineProperty(globalThis, 'document', originalDocument);
  } else {
    Reflect.deleteProperty(globalThis, 'document');
  }
});

const render = (element: JSX.Element) =>
  act(() => {
    if (renderer) {
      renderer.update(element);
    } else {
      renderer = create(element);
    }
  });

const unmount = () => {
  act(() => renderer?.unmount());
  renderer = undefined;
};

/** A key event as the browser dispatches it on the window. */
const key = (
  type: 'keydown' | 'keyup',
  code: string,
  {
    key = code,
    target,
    ...modifiers
  }: {key?: string; target?: Target; ctrlKey?: boolean} = {},
) => {
  const event = Object.assign(new Event(type, {cancelable: true}), {
    code,
    key,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  });
  if (target) {
    Object.defineProperty(event, 'target', {value: target});
  }
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
};

// A control in the test settings, and a control elsewhere on the page.
const settingsControl: Target = {closest: () => ({})};
const otherControl: Target = {
  closest: (selector) => (selector === '[data-key-test-settings]' ? null : {}),
};

const colOf = (keycode: number) => matrixKeycodes.indexOf(keycode);
const drawnKey = (layout: Layout, col: number) =>
  getTestKeyboardKeys(layout).find((k) => k.col === col);

let globalKeys: ReturnType<typeof useGlobalKeys>;
const GlobalKeys = ({enabled}: {enabled: boolean}) => {
  globalKeys = useGlobalKeys(enabled);
  return null;
};

describe('key test on the full-size picture', () => {
  test('a key still held when the window loses focus or is hidden shows as tested', () => {
    render(<GlobalKeys enabled={true} />);
    const a = colOf(basicKeyToByte.KC_A);
    const s = colOf(basicKeyToByte.KC_S);
    key('keydown', 'KeyA', {key: 'a'});
    expect(globalKeys.pressedKeys[a]).toBe(TestKeyState.KeyDown);

    // Alt+Tab: the keyup goes to another window.
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(globalKeys.pressedKeys[a]).toBe(TestKeyState.KeyUp);

    key('keydown', 'KeyS', {key: 's'});
    act(() => {
      page.dispatchEvent(new Event('visibilitychange'));
    });
    // Still visible, so the key is still held.
    expect(globalKeys.pressedKeys[s]).toBe(TestKeyState.KeyDown);
    page.hidden = true;
    act(() => {
      page.dispatchEvent(new Event('visibilitychange'));
    });
    expect(globalKeys.pressedKeys[s]).toBe(TestKeyState.KeyUp);
    expect(globalKeys.pressedKeys[a]).toBe(TestKeyState.KeyUp);

    // Off the test screen nothing listens any more.
    render(<GlobalKeys enabled={false} />);
    key('keydown', 'KeyD', {key: 'd'});
    expect(
      globalKeys.pressedKeys[colOf(basicKeyToByte.KC_D)],
    ).toBeUndefined();
  });

  test('keys typed into a test setting reach it, and browser shortcuts stay blocked', () => {
    render(<GlobalKeys enabled={true} />);
    for (const code of ['Tab', 'Space', 'Enter', 'ArrowDown']) {
      const target = settingsControl;
      expect(key('keydown', code, {target}).defaultPrevented).toBe(false);
      expect(key('keyup', code, {target}).defaultPrevented).toBe(false);
    }
    // The key still shows as tested.
    expect(globalKeys.pressedKeys[colOf(basicKeyToByte.KC_TAB)]).toBe(
      TestKeyState.KeyUp,
    );
    const target = settingsControl;
    expect(
      key('keydown', 'KeyF', {key: 'f', ctrlKey: true, target})
        .defaultPrevented,
    ).toBe(true);
    expect(key('keydown', 'F5', {target}).defaultPrevented).toBe(true);
    // Anywhere but a test setting, the key is only tested.
    expect(
      key('keydown', 'Tab', {target: otherControl}).defaultPrevented,
    ).toBe(true);
    expect(key('keydown', 'Tab').defaultPrevented).toBe(true);
    expect(key('keydown', 'Space').defaultPrevented).toBe(true);
  });

  test('every key the picture draws lights up, in the ANSI, ISO and JIS pictures', () => {
    const press = (layout: Layout, code: string) =>
      locateTestKey({code, key: ''}, layout)!;
    const iso = press(ANSI_TEST_LAYOUT, 'IntlBackslash').layout;
    const jis = ['IntlRo', 'IntlYen', 'NonConvert'].reduce(
      (layout, code) => press(layout, code).layout,
      ANSI_TEST_LAYOUT,
    );
    for (const layout of [ANSI_TEST_LAYOUT, iso, jis]) {
      const lit = new Set(
        Object.keys(evtToKeyByte)
          .map((code) => press(layout, code))
          .filter((found) => found.layout === layout)
          .map((found) => found.col),
      );
      const dark = getTestKeyboardKeys(layout).filter((k) => !lit.has(k.col));
      expect({layout, dark}).toEqual({layout, dark: []});
    }
    // No Sleep key: a browser never receives it.
    expect(colOf(basicKeyToByte.KC_SLEP)).toBe(-1);
  });

  test('Menu, Han/Yeong and Hanja light the keys where they sit', () => {
    const at = (code: string) => {
      const {col, layout} = locateTestKey({code, key: ''}, ANSI_TEST_LAYOUT)!;
      const {x, y} = drawnKey(layout, col)!;
      return {x, y};
    };
    expect(at('ContextMenu')).toEqual({x: 12.5, y: 5.25});
    expect(at('Lang1')).toEqual(at('AltRight'));
    expect(at('Lang2')).toEqual(at('ControlRight'));
  });

  test('an ISO or JIS key brings its layout and lights on the first press', () => {
    const backslash = (layout: Layout) => {
      const {col} = locateTestKey({code: 'Backslash', key: '\\'}, layout)!;
      return drawnKey(layout, col)!.y;
    };
    expect(backslash(ANSI_TEST_LAYOUT)).toBe(2.25);

    render(<GlobalKeys enabled={true} />);
    key('keydown', 'IntlBackslash', {key: '\\'});
    const iso = globalKeys.layout;
    const nubs = colOf(basicKeyToByte.KC_NUBS);
    expect(globalKeys.pressedKeys[nubs]).toBe(TestKeyState.KeyDown);
    expect(drawnKey(iso, nubs)).toBeDefined();
    expect(drawnKey(iso, colOf(basicKeyToByte.KC_LSFT))!.w).toBe(1.25);
    expect(drawnKey(iso, colOf(basicKeyToByte.KC_ENT))!.h).toBe(2);
    // On an ISO keyboard Backslash is the key beside Enter on the home row.
    expect(backslash(iso)).toBe(3.25);

    // Brazilian ABNT2 keyboards have both the ISO key and Ro.
    key('keydown', 'IntlRo', {key: '/'});
    const abnt2 = globalKeys.layout;
    expect(drawnKey(abnt2, nubs)).toBeDefined();
    expect(drawnKey(abnt2, colOf(basicKeyToByte.KC_RO))).toBeDefined();
    expect(drawnKey(abnt2, colOf(basicKeyToByte.KC_RSFT))!.w).toBe(1.75);

    key('keydown', 'IntlYen', {key: '¥'});
    const bspc = colOf(basicKeyToByte.KC_BSPC);
    expect(drawnKey(globalKeys.layout, bspc)!.w).toBe(1);
    expect(globalKeys.pressedKeys[colOf(basicKeyToByte.KC_JYEN)]).toBe(
      TestKeyState.KeyDown,
    );
  });

  test('no two keys overlap in any picture', () => {
    type Key = ReturnType<typeof getTestKeyboardKeys>[number];
    const rects = (k: Key) => [
      [k.x, k.y, k.w, k.h],
      ...(k.w2
        ? [[k.x + (k.x2 ?? 0), k.y + (k.y2 ?? 0), k.w2, k.h2 ?? 1]]
        : []),
    ];
    const overlap = (a: number[], b: number[]) =>
      Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]) > 0.01 &&
      Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]) > 0.01;
    const clash = (a: Key, b: Key) =>
      rects(a).some((ra) => rects(b).some((rb) => overlap(ra, rb)));
    for (const layout of [ANSI_TEST_LAYOUT, [1, 1, 1, 1, 1]]) {
      const keys = getTestKeyboardKeys(layout);
      const clashes = keys.flatMap((a, i) =>
        keys
          .slice(i + 1)
          .filter((b) => clash(a, b))
          .map((b) => [a.col, b.col]),
      );
      expect({layout, clashes}).toEqual({layout, clashes: []});
    }
  });

  test('a key the picture has no place for is named for a moment', () => {
    render(<GlobalKeys enabled={true} />);
    key('keydown', 'KeyA', {key: 'a'});
    expect(globalKeys.unplacedKey).toBeNull();
    key('keydown', 'F13');
    expect(globalKeys.unplacedKey?.name).toBe('F13');
    key('keydown', 'NumpadEqual', {key: '='});
    expect(globalKeys.unplacedKey?.name).toBe('=');
    expect(globalKeys.layout).toBe(ANSI_TEST_LAYOUT);
  });

  test('the name is drawn at its own size, however small the picture is drawn', async () => {
    const {KeyboardCanvas} = await import(
      '../src/components/two-string/keyboard-canvas'
    );
    const {DisplayMode} = await import('../src/types/keyboard-rendering');
    const {default: definition} = await import(
      '../src/utils/test-keyboard-definition.json'
    );
    const reducer = {
      settings: (await import('../src/store/settingsSlice')).default,
      devices: (await import('../src/store/devicesSlice')).default,
      definitions: (await import('../src/store/definitionsSlice')).default,
      keymap: (await import('../src/store/keymapSlice')).default,
      macros: (await import('../src/store/macrosSlice')).default,
      firmware: (await import('../src/store/firmwareSlice')).default,
      menus: (await import('../src/store/menusSlice')).default,
    };
    const keys = getTestKeyboardKeys(ANSI_TEST_LAYOUT);
    // An 820px wide window draws the full-size picture at about two thirds. The
    // keycaps' server render warns of what only a page runs.
    const originalError = console.error;
    console.error = () => undefined;
    let html: string;
    try {
      html = renderToStaticMarkup(
        <Provider store={configureStore({reducer})}>
          <KeyboardCanvas
            keys={keys as any}
            matrixKeycodes={keys.map(({col}) => matrixKeycodes[col])}
            definition={definition as any}
            pressedKeys={[]}
            selectable={false}
            containerDimensions={{width: 820, height: 600} as DOMRect}
            mode={DisplayMode.Test}
            cornerNote="F13"
          />
        </Provider>,
      );
    } finally {
      console.error = originalError;
    }
    const scaleFrom = (at: number) =>
      Number(/transform:scale\(([\d.]+)/.exec(html.slice(at))?.[1] ?? 1);
    const picture = scaleFrom(0);
    const name = scaleFrom(html.lastIndexOf('<div', html.indexOf('F13')));
    expect(picture).toBeLessThan(0.7);
    expect(picture * name).toBeCloseTo(1, 6);
  });
});

describe('explicit matrix test', () => {
  const device = (protocol = 12) =>
    ({path: 'key-tester', protocol, vendorProductId: 0x12345678}) as any;
  const definition = {matrix: {rows: 5, cols: 15}} as any;
  const matrixApi = (reply: () => number[]) => {
    const api = {
      reads: 0,
      getKeyboardValue: async (
        _command: number,
        _args: number[],
        size: number,
      ) => {
        api.reads += 1;
        return reply().concat(Array(size).fill(0)).slice(0, size);
      },
      timeout: () => new Promise((resolve) => setTimeout(resolve, 5)),
    };
    return api;
  };

  test('the default general test never polls the connected keyboard matrix', async () => {
    const api = matrixApi(() => [0, 0, 0, 0b100]);
    const Matrix = () => {
      useMatrixTest(initialTestContext.testMatrix, api as any, device(), definition);
      return null;
    };
    render(<Matrix />);
    key('keydown', 'KeyA');
    await act(() => new Promise((resolve) => setTimeout(resolve, 15)));
    expect(initialTestContext.testMatrix).toBe(false);
    expect(api.reads).toBe(0);
  });

  test('matrix polling starts only when explicitly chosen and stops when general test is chosen', async () => {
    const api = matrixApi(() => []);
    const Matrix = (props: {chosen: boolean}) => {
      useMatrixTest(props.chosen, api as any, device(), definition);
      return null;
    };
    render(<Matrix chosen={false} />);
    expect(api.reads).toBe(0);
    render(<Matrix chosen={true} />);
    await act(() => new Promise((resolve) => setTimeout(resolve, 15)));
    expect(api.reads).toBeGreaterThan(0);
    render(<Matrix chosen={false} />);
    const stoppedAt = api.reads;
    await act(() => new Promise((resolve) => setTimeout(resolve, 15)));
    expect(api.reads).toBe(stoppedAt);
  });

  test('a failed matrix read reports failure and stops polling', async () => {
    let failed = 0;
    const onReadFailed = () => {failed += 1;};
    const api = matrixApi(() => {throw new Error('not responding');});
    const Matrix = () => {
      useMatrixTest(true, api as any, device(), definition, onReadFailed);
      return null;
    };
    render(<Matrix />);
    await act(() => new Promise((resolve) => setTimeout(resolve, 15)));
    expect(failed).toBe(1);
    expect(api.reads).toBe(1);
  });

  test('matrix pressed keys follow switch bits while a zero reply stays untested', async () => {
    for (const [reply, reported] of [
      [[0, 0, 0, 0b100], true],
      [[], false],
    ] as const) {
      const api = matrixApi(() => [...reply]);
      let keys: TestKeyState[] = [];
      const Matrix = () => {
        [keys] = useMatrixTest(true, api as any, device(), definition);
        return null;
      };
      render(<Matrix />);
      await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
      expect(keys.some((state) => state === TestKeyState.KeyDown)).toBe(reported);
      unmount();
    }
  });

  test('a read under way when the picture of the keyboard itself goes is dropped, even once the picture is back', async () => {
    const answers: ((flat: number[]) => void)[] = [];
    const api = {
      reads: 0,
      getKeyboardValue: () => {
        api.reads += 1;
        return new Promise<number[]>((resolve) => answers.push(resolve));
      },
      timeout: () => new Promise((resolve) => setTimeout(resolve, 1)),
    };
    let keys: TestKeyState[] = [];
    const Matrix = (props: {drawn: boolean}) => {
      [keys] = useMatrixTest(props.drawn, api as any, device(), definition);
      return null;
    };
    render(<Matrix drawn={true} />);
    render(<Matrix drawn={false} />);
    render(<Matrix drawn={true} />);
    expect(api.reads).toBe(2);
    await act(async () => {
      answers[0]([0, 0, 0, 0b100, 0, 0, 0, 0, 0, 0]);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(api.reads).toBe(2);
    expect(keys).toEqual([]);
  });

  test('a late read failure after leaving matrix mode does not change the current test', async () => {
    let rejectRead = (_reason: Error) => {};
    let failed = 0;
    const onReadFailed = () => {failed += 1;};
    const api = {
      getKeyboardValue: () => new Promise((_resolve, reject) => {rejectRead = reject;}),
    };
    const Matrix = (props: {chosen: boolean}) => {
      useMatrixTest(props.chosen, api as any, device(), definition, onReadFailed);
      return null;
    };
    render(<Matrix chosen={true} />);
    render(<Matrix chosen={false} />);
    await act(async () => rejectRead(new Error('late error')));
    expect(failed).toBe(0);
  });

  test('keys typed into a test setting reach it while the keyboard is read', () => {
    const api = matrixApi(() => []);
    const Matrix = () => {
      useMatrixTest(true, api as any, device(), definition);
      return null;
    };
    render(<Matrix />);
    const target = settingsControl;
    expect(key('keydown', 'Space', {target}).defaultPrevented).toBe(false);
    expect(key('keyup', 'Space', {target}).defaultPrevented).toBe(false);
    expect(key('keydown', 'F5', {target}).defaultPrevented).toBe(true);
    expect(key('keydown', 'Space').defaultPrevented).toBe(true);
  });
});

describe('key test settings', () => {
  const translations = i18n.createInstance();
  translations.init({lng: 'en', resources: {en: {translation: {}}}});

  // Rendered as markup, the menu tooltip has no document to open in.
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, 'document');
  });

  const pane = (isEnabled: boolean) => {
    const store = configureStore({
      reducer: () =>
        ({
          settings: {
            ShowSliderValuesMode: 'Slider Only',
            testKeyboardSoundsSettings: {
              isEnabled,
              volume: 50,
              waveform: 'sine',
              mode: TestKeyboardSoundsMode.WickiHayden,
              transpose: 0,
            },
          },
        }) as any,
    });
    if (useProgress.getState().progress !== 100) {
      useProgress.setState({progress: 100});
    }
    return (
      <Provider store={store}>
        <I18nextProvider i18n={translations}>
          <TestPane />
        </I18nextProvider>
      </Provider>
    );
  };
  const markup = (isEnabled: boolean) => {
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      if (!String(args[0]).includes('useLayoutEffect does nothing on the server')) {
        originalError(...args);
      }
    };
    try {
      return renderToStaticMarkup(pane(isEnabled));
    } finally {
      console.error = originalError;
    }
  };

  test('matrix testing is off by default and clearing pressed keys remains available', () => {
    const html = markup(false);
    expect(html).toContain('Pressed keys');
    expect(html).toContain('>Clear<');
    expect(html).toContain('data-key-test-settings');
    expect(html).not.toContain('Reset');
    expect(html).toContain('Matrix test');
    expect(html).not.toContain('<select');
    expect(html).toMatch(/<input type="checkbox" aria-labelledby="[^"]+"[^>]* disabled=""/);
    expect(html).not.toContain(' checked=""');
    expect(html).not.toContain('Matrix testing requires firmware permission');
  });

  test('the matrix switch changes only the test mode and clears a previous read failure', () => {
    let chosen = {...initialTestContext, matrixAvailable: true, matrixReadFailed: true};
    const view = () => (
      <TestContext.Provider value={[chosen, (next) => {
        chosen = typeof next === 'function' ? next(chosen) : next;
      }]}>
        {pane(false)}
      </TestContext.Provider>
    );
    render(view());
    const matrixSwitch = () => renderer!.root.find(
      (node) => node.type === 'input' && node.props.type === 'checkbox' && node.props['aria-labelledby'],
    );
    expect(matrixSwitch().props.checked).toBe(false);
    expect(matrixSwitch().props.disabled).toBe(false);
    const labelId = matrixSwitch().props['aria-labelledby'];
    const label = renderer!.root.find(
      (node) => node.type === 'label' && node.props.id === labelId,
    );
    expect(label.children).toEqual(['Matrix test']);
    act(() => matrixSwitch().props.onChange());
    expect(chosen.testMatrix).toBe(true);
    expect(chosen.matrixReadFailed).toBe(false);
    expect(chosen.clearTestKeys).toBe(initialTestContext.clearTestKeys);
    render(view());
    expect(matrixSwitch().props.checked).toBe(true);
    act(() => matrixSwitch().props.onChange());
    expect(chosen.testMatrix).toBe(false);
  });

  test('the unsupported matrix switch is disabled and cannot change the mode', () => {
    let updated = false;
    render(
      <TestContext.Provider value={[initialTestContext, () => {updated = true;}]}>
        {pane(false)}
      </TestContext.Provider>,
    );
    const input = renderer!.root.find(
      (node) => node.type === 'input' && node.props.type === 'checkbox' && node.props['aria-labelledby'],
    );
    expect(input.props.disabled).toBe(true);
    expect(input.props.checked).toBe(false);
    act(() => input.props.onChange());
    expect(updated).toBe(false);
  });

  test('matrix permission and failure notes reuse the configuration help row and type', () => {
    const view = (testMatrix: boolean, matrixReadFailed: boolean) => (
      <TestContext.Provider value={[{...initialTestContext, matrixAvailable: true, testMatrix, matrixReadFailed}, () => {}]}>
        {pane(false)}
      </TestContext.Provider>
    );
    render(view(true, false));
    expect(renderer!.root.findAllByType(HelpRow)).toHaveLength(1);
    expect(renderer!.root.findByType(HelpText).props.children).toBe(
      'Matrix testing requires firmware permission. If keys do not respond, use General key test.',
    );
    render(view(false, true));
    expect(renderer!.root.findByType(HelpRow).props.role).toBe('status');
    expect(renderer!.root.findByType(HelpText).props.children).toBe(
      'The matrix could not be read. General key test is active.',
    );
    const input = renderer!.root.find(
      (node) => node.type === 'input' && node.props.type === 'checkbox' && node.props['aria-labelledby'],
    );
    expect(input.props.checked).toBe(false);
  });

  test('matrix mode explains firmware permission without claiming whether VIA_INSECURE is enabled', () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      const html = renderToStaticMarkup(
        <TestContext.Provider value={[{...initialTestContext, matrixAvailable: true, testMatrix: true}, () => {}]}>
          {pane(false)}
        </TestContext.Provider>,
      );
      expect(html).toContain('Matrix testing requires firmware permission');
      expect(html).toContain('If keys do not respond, use General key test.');
      expect(html).not.toContain('VIA_INSECURE');
    } finally {
      console.error = originalError;
    }
  });

  test('a click on Clear keeps focus off it, so Space and Enter stay keys to test', () => {
    render(pane(false));
    const clear = renderer!.root.find(
      (node) => node.type === 'button' && node.children.includes('Clear'),
    );
    let prevented = false;
    act(() => clear.props.onMouseDown({preventDefault: () => (prevented = true)}));
    expect(prevented).toBe(true);
  });

  test('the sound rows appear only while key sounds are on', () => {
    const soundRows = ['Volume', 'Transpose', 'Waveform', 'Note layout'];
    const off = markup(false);
    expect(off).toContain('Key Sounds');
    for (const row of soundRows) {
      expect(off).not.toContain(row);
    }
    const on = markup(true);
    for (const row of soundRows) {
      expect(on).toContain(row);
    }
    expect(on).not.toContain('>Mode<');
  });
});

describe('key sounds', () => {
  // Each note's oscillator, and whether it still sounds.
  let sounds: {playing: boolean}[] = [];
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

  beforeEach(() => {
    sounds = [];
    Object.assign(globalThis, {
      AudioContext: AudioContextStub,
      OscillatorNode: OscillatorStub,
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'AudioContext');
    Reflect.deleteProperty(globalThis, 'OscillatorNode');
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
  const play = (pressedKeys: TestKeyState[][]) =>
    render(
      <Provider store={store}>
        <TestKeyboardSounds pressedKeys={pressedKeys} />
      </Provider>,
    );
  const playing = () => sounds.filter((sound) => sound.playing).length;
  const rows = (count: number, held?: [number, number, TestKeyState]) => {
    const keys = Array.from({length: count}, () =>
      Array(4).fill(TestKeyState.Initial),
    );
    if (held) {
      keys[held[0]][held[1]] = held[2];
    }
    return keys;
  };

  test('a key held while the screen draws another picture stops sounding once it is up', () => {
    // Space held on the bottom row of the full-size picture, its sixth.
    play(rows(6, [5, 3, TestKeyState.KeyDown]));
    expect(playing()).toBe(1);
    // The keyboard's own picture has five rows, and shows the key held on its last.
    play(rows(5, [4, 0, TestKeyState.KeyDown]));
    expect(playing()).toBe(1);
    play(rows(5, [4, 0, TestKeyState.KeyUp]));
    expect(playing()).toBe(0);
  });
});

describe('saved key sounds', () => {
  const sounds = (changes: object = {}) => ({
    isEnabled: true,
    volume: 100,
    waveform: 'sine' as const,
    mode: TestKeyboardSoundsMode.WickiHayden,
    transpose: 0,
    ...changes,
  });
  const settings = (testKeyboardSoundsSettings: object) =>
    ({themeName: 'OLIVIA_DARK', testKeyboardSoundsSettings}) as any;

  test('the old untouched default moves to quiet and off, once', () => {
    const migrated = migrateTestKeyboardSounds(settings(sounds()));
    expect(migrated.testKeyboardSoundsSettings).toEqual(
      sounds({isEnabled: false, volume: 50}),
    );
    expect(migrated.themeName).toBe('OLIVIA_DARK');
    // Turned back on at full volume after the move, it stays on.
    const chosen = {...migrated, testKeyboardSoundsSettings: sounds()};
    expect(migrateTestKeyboardSounds(chosen)).toBe(chosen);
  });

  test('sounds someone changed stay as they were', () => {
    for (const changed of [
      sounds({volume: 80}),
      sounds({transpose: 2}),
      sounds({waveform: 'square'}),
      sounds({mode: TestKeyboardSoundsMode.Chromatic}),
      sounds({isEnabled: false}),
    ]) {
      const migrated = migrateTestKeyboardSounds(settings(changed));
      expect(migrated.testKeyboardSoundsSettings).toEqual(changed);
      expect(migrated.testKeyboardSoundsVersion).toBeGreaterThan(0);
    }
  });
});
