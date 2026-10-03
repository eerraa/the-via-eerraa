import {afterEach, describe, expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {configureStore} from '@reduxjs/toolkit';
import {LightingValue} from '@the-via/reader';
import i18n from 'i18next';
import {createElement as h} from 'react';
import {I18nextProvider} from 'react-i18next';
import {Provider} from 'react-redux';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';
import {canApplyIntegerDraft} from '../src/utils/integer-field';
import {canApplyMillisecondDraft} from '../src/utils/millisecond-field';

await import('./setup');
// The store slices import each other; keyboard-api settles that cycle the way the
// app's store does, so it loads before anything that reads the store.
const {KeyboardAPI} = await import('../src/utils/keyboard-api');
const {refreshMenuObservation, getMenuObservation} = await import('../src/store/menuObservationThunks');
const {POLLING_CURRENT, LINK_RESULT} = await import('../src/utils/menu-observation');
const {collectDeferredItems, DeferredApplyButtons, isDeferredApplyCommand} =
  await import('../src/components/panes/configure-panes/custom/deferred-apply');

const source = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8').replaceAll(
    '\r\n',
    '\n',
  );

describe('deferred TAPPING/TAPDANCE/SLEEP apply', () => {
  test('recognizes the three deferred command families and ignores other menus', () => {
    expect(isDeferredApplyCommand('id_qmk_tapping_hold_on_other_key_press')).toBe(
      true,
    );
    expect(isDeferredApplyCommand('id_qmk_tapping_global_term_exact')).toBe(true);
    expect(isDeferredApplyCommand('id_qmk_tapdance_1_tap')).toBe(true);
    expect(isDeferredApplyCommand('id_qmk_tapdance_1_term_exact')).toBe(true);
    expect(isDeferredApplyCommand('id_qmk_rgb_sleep_timeout_exact')).toBe(true);
    expect(isDeferredApplyCommand('id_qmk_rgb_sleep_timeout')).toBe(false);
    expect(
      isDeferredApplyCommand('id_qmk_backlight_sleep_timeout_exact'),
    ).toBe(true);
    expect(isDeferredApplyCommand('id_qmk_backlight_sleep_timeout')).toBe(false);
    expect(isDeferredApplyCommand('id_qmk_backlight_sleep_enable')).toBe(false);
    expect(isDeferredApplyCommand('id_qmk_rgb_matrix_brightness')).toBe(false);
    expect(isDeferredApplyCommand(undefined)).toBe(false);
  });

  test('Apply stays off for an unchanged ms value and on for a different valid value', () => {
    const adapter = {minMs: 1, maxMs: 65535};
    expect(canApplyMillisecondDraft('200', 200, adapter, false)).toBe(false);
    expect(canApplyMillisecondDraft('137', 200, adapter, false)).toBe(true);
  });

  test('SLEEP Apply stays off at the saved seconds and on only for a different valid value', () => {
    const bounds = {min: 1, max: 65535};
    expect(canApplyIntegerDraft('600', 600, bounds)).toBe(false);
    expect(canApplyIntegerDraft('601', 600, bounds)).toBe(true);
    expect(canApplyIntegerDraft('0', 600, bounds)).toBe(false);
    expect(canApplyIntegerDraft('65536', 600, bounds)).toBe(false);
  });
});

describe('continuous control lifecycle wiring', () => {
  test('range completion covers pointer, touch, keyboard, blur, cancel, and unmount', () => {
    const range = source('../src/components/inputs/accent-range.tsx');

    for (const handler of [
      'onPointerUp',
      'onPointerCancel',
      'onTouchEnd',
      'onTouchCancel',
      'onKeyUp',
      'onBlur',
    ]) {
      expect(range).toContain(handler);
    }
    expect(range).toContain('completionRef.current?.()');
    expect(range).toContain('onInteractionCancel ?? onInteractionComplete');
  });

  test('only verified range/color paths are shaped', () => {
    const custom = source(
      '../src/components/panes/configure-panes/custom/custom-control.tsx',
    );
    const lighting = source(
      '../src/components/panes/configure-panes/submenus/lighting/lighting-control.tsx',
    );

    expect(custom).toContain('<DeferredRangeControl');
    expect(custom).toContain('props.updateContinuousRangeValue(name, val)');
    expect(custom).toContain('props.updateContinuousValue(name, ...command, hue, sat)');
    expect(custom).toContain('props.updateValue(name, ...command, +option.value)');
    expect(custom).toContain('return null;');
    expect(lighting).toContain('updateBacklightValueContinuous(command, val)');
    expect(lighting).toContain('dispatch(updateBacklightValue(command, +val))');
  });
});

// The lighting pane of a board on VIA before protocol 11 (a V2 definition). A colour
// drag holds the keyboard's command queue until the drag ends; the end must SAVE the
// colour and let the next command through.
const {HID, registerHIDDeviceForTesting, resetHIDTransportForTesting, configureHIDTransport} =
  await import('../src/shims/node-hid');
const {resetContinuousHIDTransactionsForTesting} =
  await import('../src/utils/continuous-hid-transaction');
const {
  default: devicesReducer,
  selectDevice,
  updateConnectedDevices,
} = await import('../src/store/devicesSlice');
const {default: definitionsReducer, updateDefinitions} =
  await import('../src/store/definitionsSlice');
const {default: lightingReducer, updateLighting} =
  await import('../src/store/lightingSlice');
// Brightness is a range row, which draws in the saved slider mode.
const {default: settingsReducer} = await import('../src/store/settingsSlice');
const {GeneralPane} =
  await import('../src/components/panes/configure-panes/submenus/lighting/general');
const {AdvancedPane} =
  await import('../src/components/panes/configure-panes/submenus/lighting/advanced');
const {ColorPicker} = await import('../src/components/inputs/color-picker');

const translations = i18n.createInstance();
await translations.init({lng: 'en', resources: {en: {translation: {}}}});

type InputListener = (event: {data: DataView}) => void;

// A keyboard that answers every command by echoing it, as VIA firmware does.
class EchoKeyboard {
  opened = false;
  vendorId = 0x5241;
  productId = 0x006b;
  productName = 'V2 RGB';
  collections = [{usagePage: 0xff60, usage: 0x61}];
  listeners = new Set<InputListener>();
  sent: number[][] = [];

  async open() {
    this.opened = true;
  }

  async close() {
    this.opened = false;
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

  async sendReport(_reportId: number, data: BufferSource) {
    const bytes = new Uint8Array(
      data instanceof Uint8Array ? data : (data as ArrayBuffer),
    );
    this.sent.push([...bytes]);
    this.listeners.forEach((listener) =>
      listener({data: new DataView(bytes.slice().buffer)}),
    );
  }
}

describe('V2 lighting Color rows', () => {
  const PATH = 'v2-lighting';
  const VPID = 0x5241006b;
  const SET = 0x07;
  const SAVE = 0x09;
  const SET_KEYCODE = 0x05;
  const CUSTOM_COLOR = 0x17;
  const {BACKLIGHT_BRIGHTNESS, BACKLIGHT_COLOR_1, BACKLIGHT_COLOR_2} =
    LightingValue;

  // Effect 2 of wt_rgb_backlight takes Color 1 and Color 2.
  const rgbBacklight = {
    lighting: {
      extends: 'wt_rgb_backlight',
      supportedLightingValues: [BACKLIGHT_BRIGHTNESS, 12, 13],
    },
    data: {
      [BACKLIGHT_BRIGHTNESS]: [100],
      [LightingValue.BACKLIGHT_EFFECT]: [2],
      [BACKLIGHT_COLOR_1]: [0, 255],
      [BACKLIGHT_COLOR_2]: [0, 255],
    },
  };
  // An effect with more than two colours takes the board's custom colours instead.
  const customColors = {
    lighting: {
      extends: 'wt_rgb_backlight',
      effects: [
        ['All Off', 0],
        ['Solid Color 1', 1],
        ['Custom Colors', 6],
      ],
      supportedLightingValues: [BACKLIGHT_BRIGHTNESS, 23],
    },
    data: {
      [BACKLIGHT_BRIGHTNESS]: [100],
      [LightingValue.BACKLIGHT_EFFECT]: [2],
      customColors: Array.from({length: 6}, () => ({hue: 0, sat: 255})),
    },
  };
  // The Caps Lock indicator's colour is on the pane of advanced settings.
  const capsLockColor = {
    lighting: {
      extends: 'wt_rgb_backlight',
      supportedLightingValues: [LightingValue.BACKLIGHT_CAPS_LOCK_INDICATOR_COLOR],
    },
    data: {[LightingValue.BACKLIGHT_CAPS_LOCK_INDICATOR_COLOR]: [85, 255]},
  };

  let renderer: ReactTestRenderer | undefined;
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
  );

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    resetContinuousHIDTransactionsForTesting();
    resetHIDTransportForTesting();
    if (originalDocument) {
      Object.defineProperty(globalThis, 'document', originalDocument);
    } else {
      Reflect.deleteProperty(globalThis, 'document');
    }
  });

  const waitUntil = async (predicate: () => boolean, timeoutMs = 1000) => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for the keyboard');
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  const openPane = async (
    board: {lighting: unknown; data: object},
    pane = GeneralPane,
  ) => {
    const keyboard = new EchoKeyboard();
    registerHIDDeviceForTesting(PATH, keyboard as unknown as HIDDevice);
    await new HID.HID(PATH).openPromise;
    const store = configureStore({
      reducer: {
        devices: devicesReducer,
        definitions: definitionsReducer,
        lighting: lightingReducer,
        settings: settingsReducer,
      },
    });
    const device = {
      path: PATH,
      vendorId: 0x5241,
      productId: 0x006b,
      vendorProductId: VPID,
      productName: 'V2 RGB',
      protocol: 9,
      hasResolvedDefinition: true,
      requiredDefinitionVersion: 'v2' as const,
    };
    const key = {
      ...{x: 0, y: 0, w: 1, h: 1, row: 0, col: 0, color: 'alpha'},
      ...{d: false, r: 0, rx: 0, ry: 0},
    };
    store.dispatch(
      updateDefinitions({
        [VPID]: {
          v2: {
            name: 'V2 RGB',
            vendorProductId: VPID,
            lighting: board.lighting,
            matrix: {rows: 1, cols: 1},
            layouts: {keys: [key], optionKeys: {}, width: 1, height: 1},
          },
        },
      } as any),
    );
    store.dispatch(updateConnectedDevices({[PATH]: device}));
    store.dispatch(
      selectDevice({
        device,
        connectionGeneration: new KeyboardAPI(PATH).getConnectionGeneration(),
      }),
    );
    store.dispatch(updateLighting({[PATH]: board.data} as any));
    // The picker listens on the document for clicks outside it.
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: new EventTarget(),
    });
    await act(async () => {
      renderer = create(
        h(
          Provider,
          {store},
          h(I18nextProvider, {i18n: translations}, h(pane)),
        ),
        {
          createNodeMock: () => ({
            getBoundingClientRect: () => ({
              left: 0,
              top: 0,
              width: 180,
              height: 180,
            }),
            // Opening the picker puts the cursor in its hex field.
            focus: () => undefined,
            style: {},
          }),
        },
      );
    });
    return keyboard;
  };

  const hostWith = (node: ReactTestInstance, handler: string) =>
    node.find(
      (child) =>
        typeof child.type === 'string' &&
        typeof child.props[handler] === 'function',
    );
  const at = (x: number, y: number) => ({
    clientX: x,
    clientY: y,
    pointerId: 1,
    currentTarget: {
      setPointerCapture: () => undefined,
      hasPointerCapture: () => false,
      releasePointerCapture: () => undefined,
    },
  });

  // Opens a row's picker and drags from its middle up and to the right.
  const drag = async (row: number, end: 'onPointerUp' | 'onPointerCancel') => {
    const picker = () => renderer!.root.findAllByType(ColorPicker)[row];
    await act(async () => hostWith(picker(), 'onClick').props.onClick());
    const steps = [
      ['onPointerDown', at(90, 90)],
      ['onPointerMove', at(120, 40)],
      [end, at(120, 40)],
    ] as const;
    for (const [handler, event] of steps) {
      await act(async () => hostWith(picker(), handler).props[handler](event));
    }
  };

  const within = <T>(promise: Promise<T>, what: string) =>
    Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`${what} never reached the keyboard`)),
          1000,
        ),
      ),
    ]);

  for (const {name, board, row, end, value} of [
    {
      name: 'Color 1, released',
      board: rgbBacklight,
      row: 0,
      end: 'onPointerUp',
      value: [BACKLIGHT_COLOR_1],
    },
    {
      name: 'Color 2, cancelled',
      board: rgbBacklight,
      row: 1,
      end: 'onPointerCancel',
      value: [BACKLIGHT_COLOR_2],
    },
    {
      name: 'a custom colour, released',
      board: customColors,
      row: 0,
      end: 'onPointerUp',
      value: [CUSTOM_COLOR, 0],
    },
  ] as const) {
    test(`${name}: the colour is saved and later commands still go out`, async () => {
      const keyboard = await openPane(board);

      await drag(row, end);
      await waitUntil(() =>
        keyboard.sent.some(([command]) => command === SAVE),
      );
      expect(
        keyboard.sent.map((bytes) => bytes.slice(0, value.length + 3)),
      ).toEqual([
        [SET, ...value, 128, 128],
        [SET, ...value, 170, 198],
        [SAVE, ...value.map(() => 0), 0, 0],
      ]);

      // A keymap write and a brightness drag after it are not held back.
      const sent = keyboard.sent.length;
      await within(
        new KeyboardAPI(PATH).setKey(0, 0, 0, 4),
        'The keymap write',
      );
      const brightness = () =>
        renderer!.root.find(
          (node) => node.type === 'input' && node.props.type === 'range',
        );
      await act(async () =>
        brightness().props.onChange({target: {value: '200'}}),
      );
      await act(async () => brightness().props.onPointerUp({}));
      await waitUntil(() => keyboard.sent.length === sent + 3);
      expect(
        keyboard.sent.slice(sent).map((bytes) => bytes.slice(0, 6)),
      ).toEqual([
        [SET_KEYCODE, 0, 0, 0, 0, 4],
        [SET, BACKLIGHT_BRIGHTNESS, 200, 0, 0, 0],
        [SAVE, 0, 0, 0, 0, 0],
      ]);
    });
  }

  // A swatch is a button that says which row it sets and the colour it holds.
  const swatchNames = () =>
    renderer!.root
      .findAllByType(ColorPicker)
      .map((picker) => picker.findByType('button').props['aria-label']);

  test('each colour swatch is named by its row and its colour', async () => {
    await openPane(rgbBacklight);
    expect(swatchNames()).toEqual(['Color 1, #ff0000', 'Color 2, #ff0000']);
  });

  test('an indicator colour swatch is named by its row too', async () => {
    await openPane(capsLockColor, AdvancedPane);
    expect(swatchNames()).toEqual(['Caps Lock indicator color, #00ff00']);
  });
});

// The colour popup opens over the whole window beside its swatch, its hex field shows
// the colour just set, and it works from the keyboard.
const {placeColorPopup} = await import('../src/components/inputs/color-picker');
const {useState} = await import('react');

describe('the colour popup', () => {
  const popupSize = {width: 188, height: 252};

  test('opens below its swatch and left of it where the window has room', () => {
    expect(
      placeColorPopup({left: 1434.5, top: 769.5, height: 33}, popupSize, {
        width: 1920,
        height: 1080,
      }),
    ).toEqual({top: 709, left: 1229.5, arrowTop: 66});
  });

  test('opens upward where the window has no room below, the arrow still on the swatch', () => {
    expect(
      placeColorPopup({left: 1434.5, top: 800, height: 33}, popupSize, {
        width: 1920,
        height: 969,
      }),
    ).toEqual({top: 641.5, left: 1229.5, arrowTop: 164});
  });

  test('stays inside a window with room neither way', () => {
    expect(
      placeColorPopup({left: 900, top: 133.5, height: 33}, popupSize, {
        width: 1366,
        height: 300,
      }),
    ).toEqual({top: 40, left: 695, arrowTop: 99});
    // Shorter than the popup: its top, with the code, stays in the window.
    expect(
      placeColorPopup({left: 900, top: 83.5, height: 33}, popupSize, {
        width: 1366,
        height: 200,
      }),
    ).toEqual({top: 8, left: 695, arrowTop: 81});
    // A swatch at the left edge of the window.
    expect(
      placeColorPopup({left: 100, top: 769.5, height: 33}, popupSize, {
        width: 1920,
        height: 1080,
      }).left,
    ).toBe(8);
  });

  let renderer: ReactTestRenderer | undefined;
  let sent: number[][] = [];
  let done: string[] = [];
  let focused: string[] = [];
  let swatchTop = 769.5;
  let setElsewhere = (_color: {hue: number; sat: number}) => {};
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
  );
  const originalElement = Object.getOwnPropertyDescriptor(
    globalThis,
    'Element',
  );

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    Reflect.deleteProperty(globalThis, 'innerWidth');
    Reflect.deleteProperty(globalThis, 'innerHeight');
    if (originalDocument) {
      Object.defineProperty(globalThis, 'document', originalDocument);
    } else {
      Reflect.deleteProperty(globalThis, 'document');
    }
    if (originalElement) {
      Object.defineProperty(globalThis, 'Element', originalElement);
    } else {
      Reflect.deleteProperty(globalThis, 'Element');
    }
  });

  // A row that keeps the colour it is given, as the lighting and menu rows do.
  const Row = () => {
    const [color, setColor] = useState({hue: 0, sat: 255});
    setElsewhere = setColor;
    return h(ColorPicker, {
      label: 'Color',
      color,
      setColor: (hue: number, sat: number) => {
        sent.push([hue, sat]);
        setColor({hue, sat});
      },
      onInteractionComplete: () => done.push('complete'),
      onInteractionCancel: () => done.push('cancel'),
    });
  };

  // The swatch, the gradient and the popup as the page measures them.
  const show = async () => {
    sent = [];
    done = [];
    focused = [];
    swatchTop = 769.5;
    // The picker listens on the document for clicks outside it and for Esc.
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: new EventTarget(),
    });
    await act(async () => {
      renderer = create(h(Row), {
        createNodeMock: (node) => ({
          getBoundingClientRect: () =>
            node.type === 'button'
              ? {
                  left: 1434.5,
                  top: swatchTop,
                  bottom: swatchTop + 33,
                  width: 33,
                  height: 33,
                }
              : node.props.onPointerDown
                ? {left: 0, top: 0, width: 180, height: 180}
                : {left: 0, top: 0, ...popupSize},
          contains: () => false,
          focus: () =>
            focused.push(node.type === 'button' ? 'swatch' : 'hex field'),
          style: {},
        }),
      });
    });
  };
  const swatch = () => renderer!.root.findByType('button');
  const hexField = () => renderer!.root.findByType('input');
  const isOpen = () => renderer!.root.findAllByType('input').length > 0;
  const popup = () =>
    renderer!.root.find(
      (node) =>
        node.type === 'div' && typeof node.props.onKeyDown === 'function',
    );
  const gradient = () =>
    renderer!.root.find(
      (node) =>
        node.type === 'div' && typeof node.props.onPointerDown === 'function',
    );
  const press = () => act(async () => swatch().props.onClick());
  const type = (text: string) =>
    act(async () => hexField().props.onChange({target: {value: text}}));
  const pointer = (x: number, y: number) => ({
    clientX: x,
    clientY: y,
    pointerId: 1,
    currentTarget: {
      setPointerCapture: () => undefined,
      hasPointerCapture: () => false,
      releasePointerCapture: () => undefined,
    },
  });
  const onDocument = (event: string, key?: string) =>
    act(async () => {
      document.dispatchEvent(Object.assign(new Event(event), {key}));
    });

  test('the swatch is a button named by its row and colour, and opens and closes the popup', async () => {
    await show();
    expect(swatch().props['aria-label']).toBe('Color, #ff0000');
    expect(swatch().props['aria-expanded']).toBe(false);

    await press();
    expect(isOpen()).toBe(true);
    expect(swatch().props['aria-expanded']).toBe(true);
    expect(focused).toEqual(['hex field']);

    // Pressed again, it closes and keeps the colour, as a click outside does.
    await press();
    expect(isOpen()).toBe(false);
    expect(swatch().props['aria-expanded']).toBe(false);
    expect(done).toEqual(['complete']);
    expect(sent).toEqual([]);
  });

  test('opens where its swatch is in the window, and moves when the window changes', async () => {
    Object.assign(globalThis, {innerWidth: 1920, innerHeight: 1080});
    await show();
    await press();
    expect(popup().props.style).toEqual({
      top: 709,
      left: 1229.5,
      '--arrow-top': '66px',
    });

    // A shorter window has no room below the swatch.
    Object.assign(globalThis, {innerHeight: 900});
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(popup().props.style).toEqual({
      top: 611,
      left: 1229.5,
      '--arrow-top': '164px',
    });
  });

  test('follows its swatch as the pane scrolls, and closes once the swatch is out of sight', async () => {
    Object.assign(globalThis, {innerWidth: 1920, innerHeight: 1080});
    // A scrolling area of the page, as the popup asks about it.
    class Element {}
    Object.defineProperty(globalThis, 'Element', {
      configurable: true,
      value: Element,
    });
    const area = (holdsSwatch: boolean) =>
      Object.assign(new Element(), {
        contains: () => holdsSwatch,
        getBoundingClientRect: () => ({top: 100, bottom: 900}),
      });
    const scroll = (target: object) =>
      act(async () => {
        const event = new Event('scroll');
        Object.defineProperty(event, 'target', {value: target});
        window.dispatchEvent(event);
      });
    await show();
    await press();
    expect(popup().props.style.top).toBe(709);

    // The pane scrolls the swatch 100px up, and the popup goes with it.
    swatchTop -= 100;
    await scroll(area(true));
    expect(popup().props.style).toEqual({
      top: 609,
      left: 1229.5,
      '--arrow-top': '66px',
    });

    // Scrolled above the pane's top, the swatch is out of sight. Another area
    // scrolling leaves the popup be; the pane closes it as a click outside does.
    swatchTop = 50;
    await scroll(area(false));
    expect(isOpen()).toBe(true);
    await scroll(area(true));
    expect(isOpen()).toBe(false);
    expect(done).toEqual(['complete']);
    expect(focused).toEqual(['hex field']);
    // Closed, it follows no more.
    await scroll(area(true));
    expect(done).toEqual(['complete']);
  });

  test('the hex field shows the colour a press on the gradient just set', async () => {
    await show();
    await press();
    await act(async () =>
      gradient().props.onPointerDown({
        clientX: 90,
        clientY: 90,
        pointerId: 1,
        currentTarget: {setPointerCapture: () => undefined},
      }),
    );
    expect(sent).toEqual([[128, 128]]);
    expect(hexField().props.value).toBe('#7ffdff');
  });

  test('a press on the gradient drops a code half typed, so a drag stays one change', async () => {
    await show();
    await press();
    await type('12');
    await act(async () => gradient().props.onPointerDown(pointer(90, 90)));
    // The press takes focus from the field.
    await act(async () => hexField().props.onBlur());
    await act(async () => gradient().props.onPointerMove(pointer(120, 40)));
    await act(async () => gradient().props.onPointerUp(pointer(120, 40)));
    expect(sent).toEqual([
      [128, 128],
      [170, 198],
    ]);
    expect(done).toEqual(['complete']);
  });

  test('a complete code applies on Enter or on leaving the field, which then shows the colour set', async () => {
    await show();
    await press();
    await type('404040');
    expect(hexField().props.value).toBe('#404040');
    await act(async () => hexField().props.onKeyDown({key: 'Enter'}));
    // Grey keeps only its hue and saturation, which make white: brightness has a
    // control of its own.
    expect(sent).toEqual([[0, 0]]);
    expect(hexField().props.value).toBe('#ffffff');

    // Leaving the field applies a complete code too, three digits as well as six.
    await type('00f');
    await act(async () => hexField().props.onBlur());
    expect(sent).toEqual([
      [0, 0],
      [170, 255],
    ]);
    expect(hexField().props.value).toBe('#0000ff');

    // A code left half typed goes back to the colour in use, sending nothing.
    await type('12');
    await act(async () => hexField().props.onBlur());
    expect(sent).toHaveLength(2);
    expect(hexField().props.value).toBe('#0000ff');
    expect(done).toEqual(['complete', 'complete']);
  });

  test('a colour set elsewhere shows in the field, unless the user is typing there', async () => {
    await show();
    await press();
    await act(async () => setElsewhere({hue: 85, sat: 255}));
    expect(hexField().props.value).toBe('#00ff00');

    await type('12');
    await act(async () => setElsewhere({hue: 170, sat: 255}));
    expect(hexField().props.value).toBe('#12');
  });

  test('a click outside keeps a complete code typed into the field', async () => {
    await show();
    await press();
    await type('00ff00');
    await onDocument('mousedown');
    expect(isOpen()).toBe(false);
    expect(sent).toEqual([[85, 255]]);
    expect(swatch().props['aria-label']).toBe('Color, #00ff00');
  });

  test('Esc drops a typed code, closes the popup and goes back to the swatch', async () => {
    await show();
    await press();
    await type('00ff00');
    await onDocument('keydown', 'Escape');
    expect(isOpen()).toBe(false);
    expect(sent).toEqual([]);
    expect(done).toEqual(['cancel', 'complete']);
    expect(focused).toEqual(['hex field', 'swatch']);

    // Opened again, the field holds the colour in use, not the code typed.
    await press();
    expect(hexField().props.value).toBe('#ff0000');
  });

  test('Tab goes back to the swatch, keeping a complete code', async () => {
    await show();
    await press();
    await type('0000ff');
    let prevented = false;
    await act(async () =>
      popup().props.onKeyDown({
        key: 'Tab',
        preventDefault: () => (prevented = true),
      }),
    );
    expect(prevented).toBe(true);
    expect(isOpen()).toBe(false);
    expect(sent).toEqual([[170, 255]]);
    expect(focused).toEqual(['hex field', 'swatch']);
    expect(swatch().props['aria-label']).toBe('Color, #0000ff');
  });
});

// What the user sets on an ERA menu row written only on Apply is kept per keyboard
// in the store, so it outlives the sub-tab, the pane and the page it was set on.
const {
  default: draftsReducer,
  discardDrafts,
  draftKey,
  setDraft,
  settleWrittenDraft,
} = await import('../src/store/draftsSlice');
const {default: applyingReducer} = await import('../src/store/applyingSlice');
const {default: configurePlaceReducer} =
  await import('../src/store/configurePlaceSlice');
const {clearAllDevices, invalidateDeviceConnection} =
  await import('../src/store/devicesSlice');
const {updateEraDefinitions} = await import('../src/store/definitionsSlice');
const {
  default: menusReducer,
  getV3Menus,
  setLabelWatchForTesting,
  updateSelectedCustomMenuData,
  updateCustomMenuRangeValue,
  readV3MenuStateSyncCandidate,
} = await import('../src/store/menusSlice');
const {default: stateSyncReducer} = await import('../src/store/stateSyncSlice');
const {default: firmwareReducer} = await import('../src/store/firmwareSlice');
const {setEraAdvancedMetadataForTesting} =
  await import('../src/utils/era-advanced-metadata');
const {Pane} =
  await import('../src/components/panes/configure-panes/custom/menu-generator');
const {AccentSlider} = await import('../src/components/inputs/accent-slider');
const {AccentSelect} = await import('../src/components/inputs/accent-select');
const {DirtyDot} = await import('../src/components/inputs/dirty-dot');

describe('the draft store', () => {
  const keyboard = (path: string) => ({
    path,
    vendorId: 0x4553,
    productId: 0x0001,
    vendorProductId: 0x45530001,
    productName: path,
    protocol: 12,
    hasResolvedDefinition: true,
    requiredDefinitionVersion: 'v3' as const,
  });

  test('keeps a keyboard\'s drafts until they are written, cancelled or it goes away', () => {
    const store = configureStore({
      reducer: {devices: devicesReducer, drafts: draftsReducer},
    });
    const a = keyboard('kb-a');
    const b = keyboard('kb-b');
    const term = draftKey('menu', 'id_qmk_tapping_global_term_exact');
    store.dispatch(updateConnectedDevices({[a.path]: a, [b.path]: b}));
    store.dispatch(selectDevice({device: a, connectionGeneration: 1}));
    // One store holds a menu row's, a macro slot's and a Tap Dance slot's drafts.
    store.dispatch(setDraft({devicePath: a.path, key: term, value: '137'}));
    store.dispatch(
      setDraft({devicePath: a.path, key: draftKey('macro', 3), value: 'abc'}),
    );
    store.dispatch(
      setDraft({
        devicePath: a.path,
        key: draftKey('tapDance', 0),
        value: {tap: 4},
      }),
    );
    store.dispatch(setDraft({devicePath: b.path, key: term, value: '300'}));

    // Choosing another keyboard, coming back, and a reload of the same connection
    // lose nothing.
    store.dispatch(selectDevice({device: b, connectionGeneration: 1}));
    store.dispatch(selectDevice({device: a, connectionGeneration: 2}));
    store.dispatch(
      invalidateDeviceConnection({
        devicePath: a.path,
        connectionGeneration: 3,
        locked: false,
      }),
    );
    store.dispatch(updateConnectedDevices({[a.path]: a, [b.path]: b}));
    expect(store.getState().drafts[a.path]).toEqual({
      [term]: '137',
      'macro:3': 'abc',
      'tapDance:0': {tap: 4},
    });

    // A write ends only the draft it wrote, not one edited since.
    store.dispatch(
      settleWrittenDraft({devicePath: a.path, key: term, value: '138'}),
    );
    expect(store.getState().drafts[a.path][term]).toBe('137');
    store.dispatch(
      settleWrittenDraft({devicePath: a.path, key: term, value: '137'}),
    );
    expect(store.getState().drafts[a.path][term]).toBeUndefined();
    store.dispatch(discardDrafts({devicePath: a.path, keys: ['macro:3']}));
    expect(Object.keys(store.getState().drafts[a.path])).toEqual([
      'tapDance:0',
    ]);

    // A keyboard that is no longer connected takes its drafts with it.
    store.dispatch(updateConnectedDevices({[a.path]: a}));
    expect(store.getState().drafts[b.path]).toBeUndefined();
    expect(store.getState().drafts[a.path]).toBeDefined();
    store.dispatch(clearAllDevices());
    expect(store.getState().drafts).toEqual({});
  });
});

describe('the switch', () => {
  // A write the keyboard never took must not leave the switch looking flipped.
  test('shows only the value its owner holds', () => {
    const asked: boolean[] = [];
    const onChange = (value: boolean) => {
      asked.push(value);
    };
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(h(AccentSlider, {isChecked: false, onChange}));
    });
    const input = () => renderer.root.findByType('input');

    act(() => input().props.onChange({}));
    expect(asked).toEqual([true]);
    expect(input().props.checked).toBe(false);

    act(() => renderer.update(h(AccentSlider, {isChecked: false, onChange})));
    expect(input().props.checked).toBe(false);
    act(() => renderer.update(h(AccentSlider, {isChecked: true, onChange})));
    expect(input().props.checked).toBe(true);
    act(() => renderer.unmount());
  });
});

describe('Cancel and Apply', () => {
  // Both turn themselves off once used. Keyboard focus on either waits on their row
  // rather than falling to the page; a click that never focused one moves nothing.
  test('hand keyboard focus to their row before they turn off', async () => {
    const originalDocument = Object.getOwnPropertyDescriptor(
      globalThis,
      'document',
    );
    const nodes = new Map<string, {focus: () => void}>();
    const page = {};
    let focused: unknown = page;
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        body: page,
        get activeElement() {
          return focused;
        },
      },
    });
    const pressed: string[] = [];
    let renderer!: ReactTestRenderer;
    try {
      act(() => {
        renderer = create(
          h(
            I18nextProvider,
            {i18n: translations},
            h(DeferredApplyButtons, {
              canCancel: true,
              canApply: true,
              onCancel: () => pressed.push('Cancel'),
              onApply: async () => {
                pressed.push('Apply');
              },
            }),
          ),
          {
            createNodeMock: (element) => {
              const name =
                element.type === 'div' ? 'row' : String(element.props.children);
              const node = {
                focus: () => {
                  focused = node;
                },
              };
              nodes.set(name, node);
              return node;
            },
          },
        );
      });
      const button = (label: string) =>
        renderer.root.find(
          (node) => node.type === 'button' && node.props.children === label,
        );
      // Without these the checks below would compare nothing with nothing.
      expect([...nodes.keys()].sort()).toEqual(['Apply', 'Cancel', 'row']);

      focused = nodes.get('Apply');
      await act(async () => {
        await button('Apply').props.onClick();
      });
      expect(focused).toBe(nodes.get('row'));

      focused = nodes.get('Cancel');
      act(() => button('Cancel').props.onClick());
      expect(focused).toBe(nodes.get('row'));

      focused = page;
      act(() => button('Cancel').props.onClick());
      expect(focused).toBe(page);
      expect(pressed).toEqual(['Apply', 'Cancel', 'Cancel']);
    } finally {
      act(() => renderer?.unmount());
      if (originalDocument) {
        Object.defineProperty(globalThis, 'document', originalDocument);
      } else {
        Reflect.deleteProperty(globalThis, 'document');
      }
    }
  });
});

describe('ERA menu drafts', () => {
  const PATH = 'era-drafts';
  const VENDOR_ID = 0x4553;
  const PRODUCT_ID = 0x0001;
  const VPID = 0x45530001;
  const SET = 0x07;
  const SAVE = 0x09;
  const REFUSED =
    'Could not complete this change. Settings after it were not sent.';

  const featureMenu = {
    label: 'FEATURE',
    content: [
      {
        label: 'TAPPING',
        content: [
          {
            label: 'Global Tapping Term (ms)',
            type: 'range',
            content: ['id_qmk_tapping_global_term_exact', 15, 5],
            options: [1, 65535],
          },
          {
            showIf: '{id_qmk_tapping_hold_on_other_key_press} == 0',
            label: 'Permissive Hold',
            type: 'toggle',
            content: ['id_qmk_tapping_permissive_hold', 15, 2],
          },
          {
            label: 'Hold on Other Key Press',
            type: 'toggle',
            content: ['id_qmk_tapping_hold_on_other_key_press', 15, 3],
          },
        ],
      },
      {
        label: 'SLEEP',
        content: [
          {
            label: 'RGB Sleep',
            type: 'toggle',
            content: ['id_qmk_rgb_sleep_enable', 9, 12],
          },
          {
            showIf: '{id_qmk_rgb_sleep_enable} == 1',
            label: 'RGB Sleep Timeout (s)',
            type: 'range',
            content: ['id_qmk_rgb_sleep_timeout_exact', 9, 11],
            options: [1, 65535],
          },
        ],
      },
    ],
  };
  const storedValues = {
    id_qmk_tapping_global_term_exact: [0, 200],
    id_qmk_tapping_permissive_hold: [1],
    id_qmk_tapping_hold_on_other_key_press: [0],
    id_qmk_rgb_sleep_enable: [1],
    id_qmk_rgb_sleep_timeout_exact: [0x02, 0x58],
  };

  // Echoes every command as VIA firmware does, and refuses the ones it is told to
  // the way QMK refuses a value: the request sent back as id_unhandled.
  class MenuKeyboard extends EchoKeyboard {
    vendorId = VENDOR_ID;
    productId = PRODUCT_ID;
    productName = 'ERA drafts';
    refuse = (_bytes: number[]) => false;
    respond = (_bytes: number[], _reply: Uint8Array) => {};
    holding: {
      picks: (bytes: number[]) => boolean;
      held: (answer: () => void) => void;
    } | null = null;

    // Keeps the answer to the next command it picks, as a keyboard still at work
    // on it, and gives what sends the answer.
    hold(picks: (bytes: number[]) => boolean) {
      return new Promise<() => void>((held) => {
        this.holding = {picks, held};
      });
    }

    async sendReport(_reportId: number, data: BufferSource) {
      const bytes = [
        ...new Uint8Array(
          data instanceof Uint8Array ? data : (data as ArrayBuffer),
        ),
      ];
      this.sent.push(bytes);
      const reply = Uint8Array.from(bytes);
      if (this.refuse(bytes)) {
        reply[0] = 0xff;
      } else {
        this.respond(bytes, reply);
      }
      const answer = () =>
        this.listeners.forEach((listener) =>
          listener({data: new DataView(reply.buffer)}),
        );
      const holding = this.holding;
      if (holding?.picks(bytes)) {
        this.holding = null;
        holding.held(answer);
        return;
      }
      answer();
    }
  }

  let renderer: ReactTestRenderer | undefined;
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
  );

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    resetContinuousHIDTransactionsForTesting();
    resetHIDTransportForTesting();
    setEraAdvancedMetadataForTesting(null);
    setLabelWatchForTesting(null);
    if (originalDocument) {
      Object.defineProperty(globalThis, 'document', originalDocument);
    } else {
      Reflect.deleteProperty(globalThis, 'document');
    }
  });

  const openKeyboard = async (
    source: 'era' | 'official' = 'era',
    menu: object = featureMenu,
    values: object = storedValues,
    keyboard: MenuKeyboard = new MenuKeyboard(),
  ) => {
    setEraAdvancedMetadataForTesting({
      schemaVersion: 2,
      definitions: [
        {
          id: 'era-drafts',
          vendorProductId: VPID,
          stateSync: false,
          exactMsFamily: 'qmk',
        },
      ],
    });
    registerHIDDeviceForTesting(PATH, keyboard as unknown as HIDDevice);
    await new HID.HID(PATH).openPromise;
    const store = configureStore({
      reducer: {
        devices: devicesReducer,
        definitions: definitionsReducer,
        menus: menusReducer,
        drafts: draftsReducer,
        applying: applyingReducer,
        configurePlace: configurePlaceReducer,
        stateSync: stateSyncReducer,
        firmware: firmwareReducer,
      },
    });
    const device = {
      path: PATH,
      vendorId: VENDOR_ID,
      productId: PRODUCT_ID,
      vendorProductId: VPID,
      productName: 'ERA drafts',
      protocol: 12,
      hasResolvedDefinition: true,
      requiredDefinitionVersion: 'v3' as const,
    };
    const definition = {
      name: 'ERA drafts',
      vendorProductId: VPID,
      firmwareVersion: 0,
      keycodes: [],
      menus: [menu],
      matrix: {rows: 1, cols: 1},
      layouts: {
        keys: [
          {
            ...{x: 0, y: 0, w: 1, h: 1, row: 0, col: 0, color: 'alpha'},
            ...{d: false, r: 0, rx: 0, ry: 0},
          },
        ],
        width: 1,
        height: 1,
        optionKeys: {},
      },
    };
    store.dispatch(
      (source === 'era' ? updateEraDefinitions : updateDefinitions)({
        [VPID]: {v3: definition},
      } as any),
    );
    store.dispatch(updateConnectedDevices({[PATH]: device}));
    const connect = () =>
      store.dispatch(
        selectDevice({
          device,
          connectionGeneration: new KeyboardAPI(PATH).getConnectionGeneration(),
        }),
      );
    connect();
    store.dispatch(
      updateSelectedCustomMenuData({devicePath: PATH, menuData: {...values}}),
    );
    expect(getV3Menus(store.getState() as any)).toHaveLength(1);
    return {keyboard, store, device, connect};
  };

  // Connects a second keyboard of the same model beside the first, and gives what
  // chooses it.
  const addKeyboard = async (
    {store, device}: Awaited<ReturnType<typeof openKeyboard>>,
    keyboard: MenuKeyboard,
    values: object = storedValues,
  ) => {
    const other = {...device, path: `${PATH}-other`};
    registerHIDDeviceForTesting(other.path, keyboard as unknown as HIDDevice);
    await new HID.HID(other.path).openPromise;
    store.dispatch(
      updateConnectedDevices({[device.path]: device, [other.path]: other}),
    );
    store.dispatch(
      updateSelectedCustomMenuData({
        devicePath: other.path,
        menuData: {...values},
      }),
    );
    return () =>
      act(() => {
        store.dispatch(
          selectDevice({
            device: other,
            connectionGeneration: new KeyboardAPI(
              other.path,
            ).getConnectionGeneration(),
          }),
        );
      });
  };

  // Opens the menu as the rail does, on the submenu it was last left on.
  const show = async (store: {getState: () => unknown}) => {
    act(() => renderer?.unmount());
    await act(async () => {
      renderer = create(
        h(
          Provider,
          {store: store as any},
          h(
            I18nextProvider,
            {i18n: translations},
            h(Pane, {viaMenu: getV3Menus(store.getState() as any)[0]}),
          ),
        ),
      );
    });
  };

  const textOf = (node: ReactTestInstance | string): string =>
    typeof node === 'string' ? node : node.children.map(textOf).join('');
  const button = (name: string) =>
    renderer!.root.find(
      (node) => node.type === 'button' && textOf(node) === name,
    );
  // The Cancel and Apply pair, when the open submenu shows it.
  const buttons = () =>
    renderer!.root.findAll(
      (node) =>
        node.type === 'button' && ['Apply', 'Cancel'].includes(textOf(node)),
    );
  const tab = (name: string) =>
    renderer!.root.find(
      (node) =>
        node.type === 'button' &&
        node.props['aria-pressed'] !== undefined &&
        textOf(node) === name,
    );
  // A row of the open submenu, by its label; undefined while it is hidden.
  const row = (label: string) =>
    renderer!.root.findAll(
      (node) =>
        node.type === 'div' &&
        String(node.props.id).startsWith('custom_menu') &&
        node.findAll(
          (child) => child.type === 'label' && textOf(child) === label,
        ).length > 0,
    )[0] as ReactTestInstance | undefined;
  const hasDot = (node: ReactTestInstance) =>
    node.findAllByType(DirtyDot).length > 0;
  const toggle = (label: string) =>
    row(label)!.find(
      (node) => node.type === 'input' && node.props.type === 'checkbox',
    );
  const field = (label: string) =>
    row(label)!.find(
      (node) => node.type === 'input' && node.props.inputMode === 'numeric',
    );
  const refusal = (label: string) =>
    row(label)!.findAll(
      (node) => node.props.role === 'alert' && textOf(node) === REFUSED,
    ).length > 0;
  // As text: a failing comparison of the nodes themselves prints them all and runs
  // out of memory.
  const alerts = () =>
    renderer!.root
      .findAll(
        (node) => typeof node.type === 'string' && node.props.role === 'alert',
      )
      .map(textOf);
  // SET and SAVE as sent: a SET carries up to two value bytes, the rest padding.
  const writes = (keyboard: MenuKeyboard) =>
    keyboard.sent
      .filter(([command]) => command === SET || command === SAVE)
      .map((bytes) => bytes.slice(0, bytes[0] === SET ? 5 : 2));

  const draftTapping = async () => {
    await act(async () =>
      field('Global Tapping Term').props.onChange({
        target: {value: '137'},
      }),
    );
    await act(async () => toggle('Hold on Other Key Press').props.onChange({}));
  };

  const mouseMenu = {label: 'FEATURE', content: [{label: 'MOUSE', content: [
    {label: 'Cursor Start Speed', type: 'dropdown', content: ['id_qmk_mousekey_cursor_min_speed', 13, 1], options: [['4 px', 4], ['8 px', 8]]},
    {label: 'Precision Support', showIf: '0', type: 'label', content: ['id_qmk_mousekey_precision', 13, 7]},
    {label: 'Cursor Start Speed', showIf: '0', type: 'range', content: ['id_qmk_mousekey_cursor_start_exact', 13, 8], options: [1, 127]},
    {label: 'Cursor Acceleration Time', showIf: '0', type: 'range', content: ['id_qmk_mousekey_cursor_ramp_exact', 13, 10], options: [0, 65535]},
  ]}]};
  const mouseValues = {
    id_qmk_mousekey_cursor_min_speed: [4], id_qmk_mousekey_precision: [0xe4, 1],
    id_qmk_mousekey_cursor_start_exact: [0, 4, 0xe4], id_qmk_mousekey_cursor_ramp_exact: [3, 232, 0xe4],
  };
  const precisionToggle = () => renderer!.root.findAllByType(AccentSlider).at(-1)!;
  const precisionLabel = () => renderer!.root.find(
    (node) => node.type === 'label' && textOf(node) === 'Advanced settings',
  );
  const mouseKeyboard = () => {
    const keyboard = new MenuKeyboard();
    const running: Record<number, number[]> = {1: [4], 7: [0xe4, 1], 8: [0, 4, 0xe4], 10: [3, 232, 0xe4]};
    keyboard.respond = (bytes, reply) => {
      if (bytes[1] !== 13) return;
      if (bytes[0] === 7) running[bytes[2]] = [bytes[3], bytes[4], 0xe4];
      if (bytes[0] === 8) reply.set(running[bytes[2]] ?? [0], 3);
    };
    return {keyboard, running};
  };

  test('MOUSE tab marks advanced drafts while shown or hidden, including failed SAVE', async () => {
    const {keyboard} = mouseKeyboard();
    const {store} = await openKeyboard('era', mouseMenu, mouseValues, keyboard);
    await showLink(store);
    expect(hasDot(tab('MOUSE'))).toBe(false);
    await act(async () => precisionToggle().props.onChange(true));
    expect(hasDot(tab('MOUSE'))).toBe(false);
    expect(hasDot(precisionLabel())).toBe(false);
    await act(async () => field('Cursor Start Speed').props.onChange({target: {value: '17'}}));
    expect(hasDot(row('Cursor Start Speed')!)).toBe(true);
    expect(hasDot(tab('MOUSE'))).toBe(true);
    expect(hasDot(precisionLabel())).toBe(false);
    await act(async () => precisionToggle().props.onChange(false));
    expect(hasDot(tab('MOUSE'))).toBe(true);
    expect(hasDot(precisionLabel())).toBe(false);
    expect(writes(keyboard)).toEqual([]);
    await act(async () => precisionToggle().props.onChange(true));
    keyboard.refuse = ([command]) => command === SAVE;
    await act(async () => button('Apply').props.onClick());
    expect(hasDot(row('Cursor Start Speed')!)).toBe(true);
    expect(hasDot(tab('MOUSE'))).toBe(true);
    keyboard.refuse = () => false;
    await act(async () => button('Apply').props.onClick());
    expect(hasDot(row('Cursor Start Speed')!)).toBe(false);
    expect(hasDot(tab('MOUSE'))).toBe(false);
    await act(async () => field('Cursor Start Speed').props.onChange({target: {value: '19'}}));
    await act(async () => button('Cancel').props.onClick());
    expect(hasDot(tab('MOUSE'))).toBe(false);
  });

  test('MOUSE SAVE failure reports incomplete Apply while retaining the accepted runtime and retry', async () => {
    const {keyboard, running} = mouseKeyboard();
    const {store} = await openKeyboard('era', mouseMenu, mouseValues, keyboard);
    await showLink(store);
    await act(async () => precisionToggle().props.onChange(true));
    await act(async () => field('Cursor Acceleration Time').props.onChange({target: {value: '1200'}}));
    keyboard.refuse = ([command]) => command === SAVE;
    await act(async () => button('Apply').props.onClick());

    expect(writes(keyboard)).toEqual([[SET, 13, 10, 4, 176], [SAVE, 13]]);
    expect(running[10]).toEqual([4, 176, 0xe4]);
    expect(store.getState().menus.customMenuDataMap[PATH].id_qmk_mousekey_cursor_ramp_exact).toEqual([4, 176]);
    expect(store.getState().menus.saveRetries[PATH].id_qmk_mousekey_cursor_ramp_exact).toBe(true);
    expect(button('Apply').props.disabled).toBe(false);
    expect(alerts()).toContain('Could not complete this change. Settings after it were not sent.');
  });

  test('an earlier MOUSE SAVE retry remains after a later SET refusal without describing its failure stage', async () => {
    const {keyboard, running} = mouseKeyboard();
    const {store} = await openKeyboard('era', mouseMenu, mouseValues, keyboard);
    await showLink(store);
    await act(async () => precisionToggle().props.onChange(true));
    await act(async () => field('Cursor Acceleration Time').props.onChange({target: {value: '1200'}}));
    keyboard.refuse = ([command]) => command === SAVE;
    await act(async () => button('Apply').props.onClick());

    const before = writes(keyboard).length;
    await act(async () => field('Cursor Acceleration Time').props.onChange({target: {value: '1300'}}));
    keyboard.refuse = ([command]) => command === SET;
    await act(async () => button('Apply').props.onClick());

    expect(writes(keyboard).slice(before)).toEqual([[SET, 13, 10, 5, 20]]);
    expect(running[10]).toEqual([4, 176, 0xe4]);
    expect(store.getState().menus.customMenuDataMap[PATH].id_qmk_mousekey_cursor_ramp_exact).toEqual([4, 176]);
    expect(store.getState().menus.saveRetries[PATH].id_qmk_mousekey_cursor_ramp_exact).toBe(true);
    expect(field('Cursor Acceleration Time').props.value).toBe('1300');
    expect(button('Apply').props.disabled).toBe(false);
    expect(alerts()).toHaveLength(1);
  });

  test('MOUSE precision toggle preserves integer drafts without writes; same-value SAVE retry works', async () => {
    const {keyboard} = mouseKeyboard();
    const {store} = await openKeyboard('era', mouseMenu, mouseValues, keyboard);
    await showLink(store);
    await act(async () => precisionToggle().props.onChange(true));
    expect(field('Cursor Start Speed').props.value).toBe('4'); // BE16 even below 256
    await act(async () => field('Cursor Start Speed').props.onChange({target: {value: '17'}}));
    await act(async () => precisionToggle().props.onChange(false));
    await act(async () => precisionToggle().props.onChange(true));
    expect(field('Cursor Start Speed').props.value).toBe('17');
    expect(writes(keyboard)).toEqual([]);
    keyboard.refuse = ([id]) => id === SAVE;
    await act(async () => button('Apply').props.onClick());
    expect(alerts()).toContain(REFUSED);
    expect(button('Apply').props.disabled).toBe(false);
    expect(store.getState().menus.saveRetries[PATH].id_qmk_mousekey_cursor_start_exact).toBe(true);
    keyboard.refuse = () => false;
    await act(async () => button('Apply').props.onClick());
    expect(writes(keyboard)).toEqual([[SET,13,8,0,17],[SAVE,13],[SET,13,8,0,17],[SAVE,13]]);
    expect(button('Apply').props.disabled).toBe(true);
    await act(async () => field('Cursor Acceleration Time').props.onChange({target: {value: '137.5'}}));
    expect(button('Apply').props.disabled).toBe(true);
    await act(async () => field('Cursor Acceleration Time').props.onChange({target: {value: '137'}}));
    await act(async () => button('Apply').props.onClick());
    expect(writes(keyboard).at(-2)).toEqual([SET,13,10,0,137]);
  });
  for (const absent of ['unhandled', 'zero'] as const) {
    test(`MOUSE ${absent} capability keeps legacy CONFIG usable and never reads exact ids`, async () => {
      const {keyboard, running} = mouseKeyboard();
      running[7] = [0, 0];
      keyboard.refuse = ([op, channel, id]) => absent === 'unhandled' && op === 8 && channel === 13 && id === 7;
      const {store, device} = await openKeyboard('era', mouseMenu, {}, keyboard);
      const candidate = await readV3MenuStateSyncCandidate(device, store.getState() as any, new KeyboardAPI(PATH).getConnectionGeneration());
      expect(candidate).not.toBeNull();
      expect(keyboard.sent.some(([op,ch,id]) => op===8 && ch===13 && id>=8)).toBe(false);
      store.dispatch(updateSelectedCustomMenuData({devicePath: PATH, menuData: candidate!.menuData}));
      await showLink(store);
      expect(renderer!.root.findAllByType(AccentSlider)).toHaveLength(0);
    });
  }
  test('advertised MOUSE precision rejects malformed values instead of publishing zeros', async () => {
    const {keyboard, running} = mouseKeyboard(); running[8] = [0,17,0];
    const {store, device} = await openKeyboard('era', mouseMenu, {}, keyboard);
    await expect(readV3MenuStateSyncCandidate(device, store.getState() as any, new KeyboardAPI(PATH).getConnectionGeneration())).rejects.toThrow('Invalid MOUSE precision response');
  });
  test('MOUSE precision mode and draft do not leak across devices', async () => {
    const {keyboard} = mouseKeyboard();
    const opened = await openKeyboard('era', mouseMenu, mouseValues, keyboard);
    const chooseOther = await addKeyboard(opened, new MenuKeyboard(), mouseValues);
    await showLink(opened.store);
    await act(async () => precisionToggle().props.onChange(true));
    await act(async () => field('Cursor Start Speed').props.onChange({target: {value:'17'}}));
    chooseOther();
    expect(precisionToggle().props.isChecked).toBe(false);
    await act(async () => precisionToggle().props.onChange(true));
    expect(field('Cursor Start Speed').props.value).toBe('4');
    expect(writes(keyboard)).toEqual([]);
  });

  test('MOUSE held probe followed by reconnect cannot publish old CONFIG', async () => {
    const {updateV3MenuData} = await import('../src/store/menusSlice');
    const {disconnectHIDDeviceForTesting} = await import('../src/shims/node-hid');
    const {keyboard} = mouseKeyboard();
    const {store, device, connect} = await openKeyboard('era', mouseMenu, mouseValues, keyboard);
    const held = keyboard.hold(([op,ch,id]) => op===8 && ch===13 && id===7);
    const pending = store.dispatch(updateV3MenuData(device) as any).catch((e:unknown) => e);
    const release = await held;
    disconnectHIDDeviceForTesting(PATH);
    const newer = mouseKeyboard();
    newer.running[8] = [0,23,0xe4];
    registerHIDDeviceForTesting(PATH, newer.keyboard as any);
    await new HID.HID(PATH).openPromise;
    connect();
    await store.dispatch(updateV3MenuData(device) as any);
    release();
    const result = await pending;
    expect(result).toBeInstanceOf(Error);
    expect(store.getState().menus.customMenuDataMap[PATH].id_qmk_mousekey_cursor_start_exact.slice(0,3)).toEqual([0,23,0xe4]);
    expect(keyboard.sent.filter(([op,ch,id]) => op===8 && ch===13 && id>=8)).toHaveLength(0);
    expect(writes(keyboard)).toEqual([]);
    expect(writes(newer.keyboard)).toEqual([]);
  });

  test('MOUSE held probe followed by definition replacement cannot publish stale CONFIG', async () => {
    const {updateV3MenuData} = await import('../src/store/menusSlice');
    const {keyboard} = mouseKeyboard();
    const {store, device} = await openKeyboard('era', mouseMenu, mouseValues, keyboard);
    const held = keyboard.hold(([op,ch,id]) => op===8 && ch===13 && id===7);
    const pending = store.dispatch(updateV3MenuData(device) as any);
    const release = await held;
    const oldDefinition = store.getState().definitions.eraDefinitions[VPID].v3;
    store.dispatch(updateEraDefinitions({[VPID]: {v3: {...oldDefinition, name:'Replacement', menus:[featureMenu]}}} as any));
    store.dispatch(updateSelectedCustomMenuData({devicePath:PATH,menuData:{replacement:[99]}}));
    release(); await pending;
    expect(store.getState().menus.customMenuDataMap[PATH]).toEqual({replacement:[99]});
    expect(writes(keyboard)).toEqual([]);
  });

  test('MOUSE held probe timeout is error and never unsupported fresh CONFIG', async () => {
    const {updateV3MenuData} = await import('../src/store/menusSlice');
    const {keyboard} = mouseKeyboard();
    const {store, device} = await openKeyboard('era', mouseMenu, mouseValues, keyboard);
    configureHIDTransport({responseTimeoutMs:25});
    const held = keyboard.hold(([op,ch,id]) => op===8 && ch===13 && id===7);
    const pending = store.dispatch(updateV3MenuData(device) as any).catch((e:unknown) => e);
    const release = await held;
    const result = await pending;
    expect(result).toBeInstanceOf(Error);
    expect(new KeyboardAPI(PATH).isConnectionLocked()).toBe(true);
    expect(store.getState().menus.customMenuDataMap[PATH]).toEqual(mouseValues);
    expect(keyboard.sent.filter(([op,ch,id]) => op===8 && ch===13 && id>=8)).toHaveLength(0);
    release();
    expect(store.getState().menus.customMenuDataMap[PATH]).toEqual(mouseValues);
    expect(writes(keyboard)).toEqual([]);
  });

  for(const source of ['official','era'] as const) {
    test(`MOUSE ${source} legacy-only V3 still reads and writes normal dropdown without probe`, async () => {
      const {updateV3MenuData} = await import('../src/store/menusSlice');
      const legacy={label:'FEATURE',content:[{label:'MOUSE',content:[mouseMenu.content[0].content[0]]}]};
      const {keyboard} = mouseKeyboard();
      const {store,device}=await openKeyboard(source,legacy,{},keyboard);
      await store.dispatch(updateV3MenuData(device) as any);
      expect(keyboard.sent.filter(([op])=>op===8).map(b=>b.slice(0,3))).toEqual([[8,13,1]]);
      await showLink(store);
      expect(renderer!.root.findAllByType(AccentSlider)).toHaveLength(0);
      expect(renderer!.root.findAllByType(DeferredApplyButtons)).toHaveLength(0);
      await act(async()=>renderer!.root.findByType(AccentSelect).props.onChange({value:8}));
      expect(writes(keyboard)).toEqual([[SET,13,1,8,0],[SAVE,13]]);
      expect(keyboard.sent.some(([op,ch,id])=>op===8&&ch===13&&id>=7)).toBe(false);
    });
  }

  const expectTappingDrafts = () => {
    expect(field('Global Tapping Term').props.value).toBe('137');
    expect(toggle('Hold on Other Key Press').props.checked).toBe(true);
    expect(hasDot(row('Global Tapping Term')!)).toBe(true);
    expect(hasDot(row('Hold on Other Key Press')!)).toBe(true);
    expect(hasDot(tab('TAPPING'))).toBe(true);
    expect(button('Apply').props.disabled).toBe(false);
    expect(button('Cancel').props.disabled).toBe(false);
  };

  // Presses Apply and, while the keyboard is still at work on a SET (the first one
  // unless `picks` says which), does what `meanwhile` does; then lets the keyboard
  // answer and Apply finish.
  const applyWhile = async (
    keyboard: MenuKeyboard,
    meanwhile: () => unknown,
    picks = (bytes: number[]) => bytes[0] === SET,
  ) => {
    const held = keyboard.hold(picks);
    let applying!: Promise<void>;
    await act(async () => {
      applying = button('Apply').props.onClick();
    });
    const answer = await held;
    await meanwhile();
    await act(async () => {
      answer();
      await applying;
    });
  };

  const pollingMenu = {label: 'SYSTEM', content: [{label: 'USB POLLING', content: [
    {label: 'Boot Polling Mode', type: 'dropdown', content: ['id_qmk_usb_bootmode', 13, 1], options: [['8 kHz (HS)', 0], ['1 kHz (FS)', 3]]},
    {label: 'Current Polling', type: 'label', content: [POLLING_CURRENT, 13, 4], showIf: '{id_firmware_version} >= 1'},
  ]}]};
  const pollingKeyboard = () => {
    const keyboard = new MenuKeyboard();
    const reply = {revision: 1, text: '8000 Hz (HS)', malformed: false};
    keyboard.respond = ([command, channel, id], bytes) => {
      if (command === 2 && channel === 4) { bytes.fill(0, 2); bytes[5] = reply.revision; }
      if (command === 8 && channel === 13 && id === 4) {
        bytes.fill(reply.malformed ? 65 : 0, 3);
        if (!reply.malformed) bytes.set(new TextEncoder().encode(reply.text), 3);
      }
    };
    return {keyboard, reply};
  };

  test('polling TEXT verifies live support, refreshes on activation and cannot be restored by CONFIG', async () => {
    const {keyboard, reply} = pollingKeyboard();
    const {store, connect} = await openKeyboard('era', pollingMenu, {id_qmk_usb_bootmode: [0], id_firmware_version: [0]}, keyboard);
    await showLink(store);
    expect(textOf(renderer!.root)).toContain('8000 Hz (HS)');
    expect(keyboard.sent.slice(0, 2).map((bytes) => bytes.slice(0, 3))).toEqual([[2, 4, 0], [8, 13, 4]]);
    expect(keyboard.sent.some(([command, selector]) => command === 2 && selector === 7)).toBe(false);
    act(() => store.dispatch(updateSelectedCustomMenuData({devicePath: PATH, menuData: {id_qmk_usb_bootmode: [3], [POLLING_CURRENT]: [...new TextEncoder().encode('1000 Hz (FS)'), 0]}})));
    expect(textOf(renderer!.root)).toContain('8000 Hz (HS)');
    reply.malformed = true;
    expect(renderer!.root.findAllByType('button').some(node => textOf(node) === 'Refresh')).toBe(false);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(textOf(renderer!.root)).toContain('Invalid response');
    act(() => store.dispatch(updateSelectedCustomMenuData({devicePath: PATH, menuData: {id_qmk_usb_bootmode: [3], [POLLING_CURRENT]: [...new TextEncoder().encode('1000 Hz (FS)'), 0]}})));
    expect(textOf(renderer!.root)).not.toContain('1000 Hz (FS)');
    reply.malformed = false;
    reply.text = '1000 Hz (FS)';
    act(() => connect());
    await show(store);
    expect(textOf(renderer!.root)).toContain('1000 Hz (FS)');
    reply.revision = 0;
    const before = keyboard.sent.length;
    await show(store);
    expect(textOf(renderer!.root)).toContain('Not supported by this firmware');
    expect(keyboard.sent.slice(before).every(([command]) => command === 2)).toBe(true);
  });

  test('polling observation refreshes automatically without blanking and recovers malformed replies', async () => {
    const {keyboard, reply} = pollingKeyboard();
    const {store} = await openKeyboard('era', pollingMenu, {id_qmk_usb_bootmode: [0]}, keyboard);
    await showLink(store);
    expect(renderer!.root.findAllByType('button').some(node => textOf(node) === 'Refresh')).toBe(false);
    reply.malformed = true;
    const held = keyboard.hold(([command]) => command === GET);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    const answer = await held;
    expect(textOf(renderer!.root)).toContain('8000 Hz (HS)');
    expect(textOf(renderer!.root)).not.toContain('Loading...');
    await act(async () => { answer(); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(textOf(renderer!.root)).toContain('Invalid response');
    expect(textOf(renderer!.root)).not.toContain('8000 Hz (HS)');
    reply.malformed = false;
    reply.text = '1000 Hz (FS)';
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
    expect(textOf(renderer!.root)).toContain('1000 Hz (FS)');
    const reads = keyboard.sent.length;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
    expect(keyboard.sent.length).toBe(reads);
  });

  test('polling unhandled is optional; a late response after definition replacement cannot publish', async () => {
    const {keyboard} = pollingKeyboard();
    const {store} = await openKeyboard('era', pollingMenu, {}, keyboard);
    keyboard.refuse = ([command]) => command === 8;
    expect(await store.dispatch(refreshMenuObservation(POLLING_CURRENT) as any)).toEqual({status: 'unsupported'});
    expect(new KeyboardAPI(PATH).isConnectionLocked()).toBe(false);
    keyboard.refuse = () => false;
    const held = keyboard.hold(([command]) => command === 8);
    const pending = store.dispatch(refreshMenuObservation(POLLING_CURRENT) as any);
    const answer = await held;
    const old = store.getState().definitions.eraDefinitions[VPID].v3!;
    store.dispatch(updateEraDefinitions({[VPID]: {v3: {...old, name: 'replacement'}}} as any));
    answer();
    await pending;
    expect(getMenuObservation(store.getState() as any, POLLING_CURRENT)).toBeUndefined();
  });

  test('switching devices during support GET never sends polling TEXT to either new context', async () => {
    const {keyboard} = pollingKeyboard();
    const opened = await openKeyboard('era', pollingMenu, {}, keyboard);
    const other = new MenuKeyboard();
    const chooseOther = await addKeyboard(opened, other, {});
    const held = keyboard.hold(([command]) => command === 2);
    const pending = opened.store.dispatch(refreshMenuObservation(POLLING_CURRENT) as any);
    const answer = await held;
    chooseOther();
    answer();
    expect(await pending).toBeNull();
    expect(other.sent).toEqual([]);
    expect(keyboard.sent.every(([command]) => command !== 8)).toBe(true);
    expect(getMenuObservation(opened.store.getState() as any, POLLING_CURRENT)).toBeUndefined();
  });

  test('FEATURE SAVE refusal remains retryable at the accepted runtime value across reread and reentry', async () => {
    const opened = await openKeyboard();
    const {keyboard, store, connect} = opened;
    keyboard.refuse = ([command]) => command === SAVE;
    await show(store);
    await act(async () => field('Global Tapping Term').props.onChange({target: {value: '137'}}));
    await act(async () => { await button('Apply').props.onClick(); });
    expect(store.getState().menus.customMenuDataMap[PATH].id_qmk_tapping_global_term_exact).toEqual([0, 137]);
    expect(refusal('Global Tapping Term')).toBe(true);
    expect(hasDot(row('Global Tapping Term')!)).toBe(true);
    expect(hasDot(tab('TAPPING'))).toBe(true);
    expect(button('Apply').props.disabled).toBe(false);
    expect(button('Cancel').props.disabled).toBe(false);
    // An authoritative GET of the running value does not acknowledge SAVE.
    store.dispatch(updateSelectedCustomMenuData({devicePath: PATH, menuData: {...storedValues, id_qmk_tapping_global_term_exact: [0, 137]}}));
    const chooseOther = await addKeyboard(opened, new MenuKeyboard());
    chooseOther();
    await show(store);
    expect(button('Apply').props.disabled).toBe(true);
    act(() => connect());
    await show(store);
    expect(button('Apply').props.disabled).toBe(false);
    keyboard.refuse = () => false;
    await act(async () => { await button('Apply').props.onClick(); });
    expect(writes(keyboard)).toEqual([[SET, 15, 5, 0, 137], [SAVE, 15], [SET, 15, 5, 0, 137], [SAVE, 15]]);
    expect(store.getState().drafts).toEqual({});
    expect(store.getState().menus.saveRetries[PATH]).toEqual({});
    expect(button('Apply').props.disabled).toBe(true);
  });

  test('editing and cancelling a failed SAVE never roll back the accepted runtime value', async () => {
    const {keyboard, store} = await openKeyboard();
    keyboard.refuse = ([command]) => command === SAVE;
    await show(store);
    await act(async () => field('Global Tapping Term').props.onChange({target: {value: '137'}}));
    await act(async () => { await button('Apply').props.onClick(); });
    await act(async () => field('Global Tapping Term').props.onChange({target: {value: ''}}));
    expect(button('Apply').props.disabled).toBe(true);
    await act(async () => field('Global Tapping Term').props.onChange({target: {value: '137'}}));
    expect(button('Apply').props.disabled).toBe(false);
    await act(async () => button('Cancel').props.onClick());
    expect(field('Global Tapping Term').props.value).toBe('137');
    expect(button('Apply').props.disabled).toBe(true);
    expect(store.getState().menus.saveRetries[PATH]).toEqual({});
    expect(writes(keyboard)).toHaveLength(2);
    store.dispatch(updateConnectedDevices({}));
    expect(store.getState().menus.saveRetries).toEqual({});
  });

  test('SAVE timeout preserves retry across transport retirement and connection reload', async () => {
    const {keyboard, store, device, connect} = await openKeyboard();
    configureHIDTransport({responseTimeoutMs: 25});
    await show(store);
    await act(async () => field('Global Tapping Term').props.onChange({target: {value: '137'}}));
    const held = keyboard.hold(([command]) => command === SAVE);
    await act(async () => { await button('Apply').props.onClick(); });
    await held;
    expect(new KeyboardAPI(PATH).isConnectionLocked()).toBe(true);
    expect(store.getState().menus.saveRetries[PATH].id_qmk_tapping_global_term_exact).toBe(true);
    // Reload preserves the session's intent; GET equality still cannot prove SAVE.
    resetHIDTransportForTesting();
    registerHIDDeviceForTesting(PATH, keyboard as any);
    await new HID.HID(PATH).openPromise;
    act(() => {
      store.dispatch(updateConnectedDevices({[PATH]: device}));
      connect();
      store.dispatch(updateSelectedCustomMenuData({devicePath: PATH, menuData: {...storedValues, id_qmk_tapping_global_term_exact: [0, 137]}}));
    });
    await show(store);
    expect(button('Apply').props.disabled).toBe(false);
    await act(async () => { await button('Apply').props.onClick(); });
    expect(store.getState().menus.saveRetries[PATH]).toEqual({});
  });

  test('applying another range never writes an unrelated failed SAVE retry', async () => {
    const menu = {...featureMenu, content: [...featureMenu.content, {label: 'TD', content: [{label: 'Hold decision time', type: 'range', content: ['id_qmk_tapdance_1_hold_term', 0, 88], options: [0, 65535]}]}]};
    const {keyboard, store} = await openKeyboard('era', menu, {...storedValues, id_qmk_tapdance_1_hold_term: [0, 0]});
    keyboard.refuse = ([command]) => command === SAVE;
    await show(store);
    await act(async () => field('Global Tapping Term').props.onChange({target: {value: '137'}}));
    await act(async () => { await button('Apply').props.onClick(); });
    const before = keyboard.sent.length;
    keyboard.refuse = () => false;
    await act(async () => { await store.dispatch(updateCustomMenuRangeValue('id_qmk_tapdance_1_hold_term', 100) as any); });
    expect(keyboard.sent.slice(before).filter(([cmd]) => cmd === SET || cmd === SAVE).map(b => b.slice(0, b[0] === SET ? 5 : 2))).toEqual([[SET, 0, 88, 0, 100], [SAVE, 0]]);
    expect(store.getState().menus.saveRetries[PATH].id_qmk_tapping_global_term_exact).toBe(true);
  });

  test('generic CONFIG excludes both observation commands even when legacy firmware would reject them', async () => {
    const {keyboard} = pollingKeyboard();
    keyboard.refuse = ([cmd, channel, id]) => cmd === 8 && ((channel === 13 && id === 4) || (channel === 9 && id === 66));
    const menu = {label: 'SYSTEM', content: [...pollingMenu.content, {label: 'LINK', content: [{label: 'Last Apply', type: 'label', content: [LINK_RESULT, 9, 66]}]}]};
    const {store, device} = await openKeyboard('era', menu, {}, keyboard);
    const candidate = await readV3MenuStateSyncCandidate(device, store.getState() as any, new KeyboardAPI(PATH).getConnectionGeneration());
    expect(candidate?.menuData?.[POLLING_CURRENT]).toBeUndefined();
    expect(candidate?.menuData?.[LINK_RESULT]).toBeUndefined();
    expect(keyboard.sent.every(([cmd, ch, id]) => !(cmd === 8 && ((ch === 13 && id === 4) || (ch === 9 && id === 66))))).toBe(true);
  });

  test('shows a draft where it was set and keeps it across the sub-tab, the pane and a reconnect', async () => {
    const {keyboard, store, device, connect} = await openKeyboard();
    await show(store);
    expect(button('Apply').props.disabled).toBe(true);
    expect(button('Cancel').props.disabled).toBe(true);
    expect(hasDot(tab('TAPPING'))).toBe(false);

    await draftTapping();
    expectTappingDrafts();
    // Permissive Hold only applies while Hold on Other Key Press is off, so the
    // drafted switch hides it at once.
    expect(row('Permissive Hold')).toBeUndefined();
    expect(hasDot(tab('SLEEP'))).toBe(false);
    expect(writes(keyboard)).toEqual([]);

    // Another sub-tab and back.
    await act(async () => tab('SLEEP').props.onClick());
    expect(row('RGB Sleep Timeout')).toBeDefined();
    expect(hasDot(tab('TAPPING'))).toBe(true);
    await act(async () => tab('TAPPING').props.onClick());
    expectTappingDrafts();

    // Another pane or page and back: the menu is built anew.
    await show(store);
    expectTappingDrafts();

    // Its connection reloaded, then another keyboard chosen and this one again.
    store.dispatch(
      invalidateDeviceConnection({
        devicePath: PATH,
        connectionGeneration: new KeyboardAPI(PATH).getConnectionGeneration(),
        locked: false,
      }),
    );
    store.dispatch(updateConnectedDevices({[PATH]: device}));
    connect();
    store.dispatch(selectDevice({device: null, connectionGeneration: null}));
    connect();
    await show(store);
    expectTappingDrafts();
    expect(writes(keyboard)).toEqual([]);

    // Unplugged: its drafts go with it.
    store.dispatch(updateConnectedDevices({}));
    expect(store.getState().drafts).toEqual({});
  });

  test('Apply writes the drafts in row order and they become the saved values', async () => {
    const {keyboard, store} = await openKeyboard();
    await show(store);
    await draftTapping();

    await act(async () => {
      await button('Apply').props.onClick();
    });

    expect(writes(keyboard)).toEqual([
      [SET, 15, 5, 0, 137],
      [SAVE, 15],
      [SET, 15, 3, 1, 0],
      [SAVE, 15],
    ]);
    expect(store.getState().drafts).toEqual({});
    expect(field('Global Tapping Term').props.value).toBe('137');
    expect(toggle('Hold on Other Key Press').props.checked).toBe(true);
    expect(hasDot(row('Global Tapping Term')!)).toBe(false);
    expect(hasDot(tab('TAPPING'))).toBe(false);
    expect(button('Apply').props.disabled).toBe(true);
    expect(row('Permissive Hold')).toBeUndefined();
  });

  test('Apply stops at the first change the keyboard refuses and keeps the drafts from there', async () => {
    const {keyboard, store} = await openKeyboard();
    await show(store);
    await draftTapping();
    keyboard.refuse = (bytes) => bytes[0] === SET && bytes[2] === 5;

    await act(async () => {
      await button('Apply').props.onClick();
    });

    // The refused term was the first write; nothing after it went out.
    expect(writes(keyboard)).toEqual([[SET, 15, 5, 0, 137]]);
    expect(refusal('Global Tapping Term')).toBe(true);
    expect(refusal('Hold on Other Key Press')).toBe(false);
    expectTappingDrafts();

    // Editing again clears the refusal.
    await act(async () =>
      field('Global Tapping Term').props.onChange({
        target: {value: '140'},
      }),
    );
    expect(refusal('Global Tapping Term')).toBe(false);
  });

  test('Cancel puts the saved values back without writing', async () => {
    const {keyboard, store} = await openKeyboard();
    await show(store);
    await draftTapping();

    await act(async () => button('Cancel').props.onClick());

    expect(store.getState().drafts).toEqual({});
    expect(field('Global Tapping Term').props.value).toBe('200');
    expect(toggle('Hold on Other Key Press').props.checked).toBe(false);
    expect(row('Permissive Hold')).toBeDefined();
    expect(hasDot(tab('TAPPING'))).toBe(false);
    expect(button('Apply').props.disabled).toBe(true);
    expect(button('Cancel').props.disabled).toBe(true);
    expect(writes(keyboard)).toEqual([]);
  });

  // Whatever is wrong with a draft, the field says only the range it takes. A field
  // cleared to type another number is not marked on the way, only once it is left.
  test('a whole-number field shows the range it takes, and an empty one only once left', async () => {
    const {keyboard, store} = await openKeyboard();
    await show(store);
    const term = () => field('Global Tapping Term');
    const shown = () => ({
      said: row('Global Tapping Term')!
        .findAll(
          (node) => typeof node.type === 'string' && node.props.role === 'alert',
        )
        .map(textOf),
      invalid: term().props['aria-invalid'],
    });
    const type = (value: string) =>
      act(async () => term().props.onChange({target: {value}}));

    for (const value of ['0', '65536', '13.7', 'abc']) {
      await type(value);
      expect({value, ...shown()}).toEqual({
        value,
        said: ['1–65535'],
        invalid: true,
      });
    }
    await type('');
    expect(shown()).toEqual({said: [], invalid: undefined});
    await act(async () => term().props.onBlur());
    expect(shown()).toEqual({said: ['1–65535'], invalid: true});
    await type('137');
    expect(shown()).toEqual({said: [], invalid: undefined});
    expect(writes(keyboard)).toEqual([]);
  });

  // Enter in a whole-number field is the page's Apply, and does nothing while Apply
  // has nothing to write or an input method is still composing.
  test('Enter in a whole-number field applies the page as Apply does', async () => {
    const {keyboard, store} = await openKeyboard();
    await show(store);
    const said = () =>
      row('Global Tapping Term')!
        .findAll(
          (node) => typeof node.type === 'string' && node.props.role === 'alert',
        )
        .map(textOf);
    const enter = async (isComposing = false) => {
      await act(async () =>
        field('Global Tapping Term').props.onKeyDown({
          key: 'Enter',
          nativeEvent: {isComposing},
        }),
      );
      for (let tries = 0; tries < 20; tries++) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      }
    };

    await enter();
    await act(async () =>
      field('Global Tapping Term').props.onChange({target: {value: '0'}}),
    );
    await enter();
    expect(writes(keyboard)).toEqual([]);
    // Enter reveals an emptied field as leaving it does.
    await act(async () =>
      field('Global Tapping Term').props.onChange({target: {value: ''}}),
    );
    expect(said()).toEqual([]);
    await enter();
    expect(said()).toEqual(['1–65535']);

    await draftTapping();
    await enter(true);
    expect(writes(keyboard)).toEqual([]);
    await enter();
    expect(writes(keyboard)).toEqual([
      [SET, 15, 5, 0, 137],
      [SAVE, 15],
      [SET, 15, 3, 1, 0],
      [SAVE, 15],
    ]);
    expect(store.getState().drafts).toEqual({});
    expect(button('Apply').props.disabled).toBe(true);
  });

  // Each write goes to the keyboard chosen when it is sent.
  test('Apply stops once another keyboard is chosen, and sends that one nothing', async () => {
    const opened = await openKeyboard();
    const {keyboard, store, connect} = opened;
    const other = new MenuKeyboard();
    const chooseOther = await addKeyboard(opened, other);
    await show(store);
    await draftTapping();

    await applyWhile(keyboard, chooseOther);

    // The term was already on its way; Hold on Other Key Press after it stays a
    // draft.
    expect(writes(keyboard)).toEqual([
      [SET, 15, 5, 0, 137],
      [SAVE, 15],
    ]);
    expect(other.sent).toEqual([]);
    expect(store.getState().drafts).toEqual({
      [PATH]: {
        [draftKey('menu', 'id_qmk_tapping_hold_on_other_key_press')]: true,
      },
    });

    act(() => {
      connect();
    });
    expect(field('Global Tapping Term').props.value).toBe('137');
    expect(hasDot(row('Global Tapping Term')!)).toBe(false);
    expect(toggle('Hold on Other Key Press').props.checked).toBe(true);
    expect(hasDot(row('Hold on Other Key Press')!)).toBe(true);
    await act(async () => {
      await button('Apply').props.onClick();
    });
    expect(writes(keyboard).slice(2)).toEqual([
      [SET, 15, 3, 1, 0],
      [SAVE, 15],
    ]);
    expect(other.sent).toEqual([]);
    expect(store.getState().drafts).toEqual({});
  });

  test('Apply stops when the keyboard is chosen again meanwhile, as on a reconnect', async () => {
    const {keyboard, store, connect} = await openKeyboard();
    await show(store);
    await draftTapping();

    await applyWhile(keyboard, () =>
      act(() => {
        connect();
      }),
    );

    expect(writes(keyboard)).toEqual([
      [SET, 15, 5, 0, 137],
      [SAVE, 15],
    ]);
    expect(store.getState().drafts).toEqual({
      [PATH]: {
        [draftKey('menu', 'id_qmk_tapping_hold_on_other_key_press')]: true,
      },
    });
    expect(button('Apply').props.disabled).toBe(false);
  });

  test('a page opened again while Apply writes keeps Cancel and Apply off until it is done', async () => {
    const {keyboard, store} = await openKeyboard();
    await show(store);
    await draftTapping();

    await applyWhile(keyboard, async () => {
      await act(async () => tab('SLEEP').props.onClick());
      await act(async () => tab('TAPPING').props.onClick());
      expect(button('Apply').props.disabled).toBe(true);
      expect(button('Cancel').props.disabled).toBe(true);
      // Another pane and back.
      await show(store);
      expect(hasDot(row('Hold on Other Key Press')!)).toBe(true);
      expect(button('Apply').props.disabled).toBe(true);
      expect(button('Cancel').props.disabled).toBe(true);
    });

    expect(writes(keyboard)).toEqual([
      [SET, 15, 5, 0, 137],
      [SAVE, 15],
      [SET, 15, 3, 1, 0],
      [SAVE, 15],
    ]);
    expect(store.getState().drafts).toEqual({});
    expect(store.getState().applying).toEqual({writing: {}, stops: {}});
    expect(hasDot(tab('TAPPING'))).toBe(false);
    expect(button('Apply').props.disabled).toBe(true);
    await act(async () => toggle('Hold on Other Key Press').props.onChange({}));
    expect(button('Apply').props.disabled).toBe(false);
    expect(button('Cancel').props.disabled).toBe(false);
  });

  test('a page opened again while Apply writes shows the change the keyboard refused', async () => {
    const {keyboard, store} = await openKeyboard();
    await show(store);
    await draftTapping();
    keyboard.refuse = (bytes) => bytes[0] === SET && bytes[2] === 5;

    await applyWhile(keyboard, async () => {
      await act(async () => tab('SLEEP').props.onClick());
      await act(async () => tab('TAPPING').props.onClick());
    });

    expect(writes(keyboard)).toEqual([[SET, 15, 5, 0, 137]]);
    expect(refusal('Global Tapping Term')).toBe(true);
    expectTappingDrafts();
    // Another pane and back.
    await show(store);
    expect(refusal('Global Tapping Term')).toBe(true);
    // Only the page of the refused row says so.
    await act(async () => tab('SLEEP').props.onClick());
    expect(alerts()).toEqual([]);
    await act(async () => tab('TAPPING').props.onClick());

    await act(async () => button('Cancel').props.onClick());
    expect(refusal('Global Tapping Term')).toBe(false);
  });

  test('a row set back while Apply writes the one before it is not written', async () => {
    const {keyboard, store} = await openKeyboard();
    await show(store);
    await draftTapping();

    await applyWhile(keyboard, () =>
      act(async () => toggle('Hold on Other Key Press').props.onChange({})),
    );

    expect(writes(keyboard)).toEqual([
      [SET, 15, 5, 0, 137],
      [SAVE, 15],
    ]);
    expect(toggle('Hold on Other Key Press').props.checked).toBe(false);
    expect(row('Permissive Hold')).toBeDefined();
    expect(store.getState().drafts).toEqual({});
  });

  test('a switch written at once goes out while the timeout beside it waits, and keeps its draft while hidden', async () => {
    const {keyboard, store} = await openKeyboard();
    await show(store);
    await act(async () => tab('SLEEP').props.onClick());
    await act(async () =>
      field('RGB Sleep Timeout').props.onChange({target: {value: '300'}}),
    );

    await act(async () => {
      await toggle('RGB Sleep').props.onChange({});
    });

    expect(writes(keyboard)).toEqual([
      [SET, 9, 12, 0, 0],
      [SAVE, 9],
    ]);
    expect(toggle('RGB Sleep').props.checked).toBe(false);
    expect(hasDot(row('RGB Sleep')!)).toBe(false);
    // The timeout row is hidden while its switch is off, and with it the only
    // change Apply would write. The tab still marks the retained draft.
    expect(row('RGB Sleep Timeout')).toBeUndefined();
    expect(hasDot(tab('SLEEP'))).toBe(true);
    expect(buttons()).toEqual([]);

    await act(async () => {
      await toggle('RGB Sleep').props.onChange({});
    });
    expect(field('RGB Sleep Timeout').props.value).toBe('300');
    expect(hasDot(row('RGB Sleep Timeout')!)).toBe(true);
    expect(button('Apply').props.disabled).toBe(false);
    await act(async () => button('Cancel').props.onClick());
    expect(hasDot(tab('SLEEP'))).toBe(false);
  });

  test('a switch the keyboard refuses stays at the saved value and says so on its row', async () => {
    const {keyboard, store} = await openKeyboard();
    await show(store);
    await act(async () => tab('SLEEP').props.onClick());
    keyboard.refuse = (bytes) => bytes[0] === SET && bytes[2] === 12;

    await act(async () => {
      await toggle('RGB Sleep').props.onChange({});
    });

    expect(writes(keyboard)).toEqual([[SET, 9, 12, 0, 0]]);
    expect(toggle('RGB Sleep').props.checked).toBe(true);
    expect(refusal('RGB Sleep')).toBe(true);
    expect(store.getState().drafts).toEqual({});
  });

  test('an ordinary VIA keyboard writes each change at once and shows no Cancel or Apply', async () => {
    const {keyboard, store} = await openKeyboard(
      'official',
      {
        label: 'LIGHTING',
        content: [
          {
            label: 'BACKLIGHT',
            content: [
              {
                label: 'Breathing',
                type: 'toggle',
                content: ['id_qmk_backlight_breathing', 1, 3],
              },
            ],
          },
        ],
      },
      {id_qmk_backlight_breathing: [0]},
    );
    await show(store);

    await act(async () => {
      await toggle('Breathing').props.onChange({});
    });

    expect(writes(keyboard)).toEqual([
      [SET, 1, 3, 1, 0],
      [SAVE, 1],
    ]);
    expect(toggle('Breathing').props.checked).toBe(true);
    expect(buttons()).toEqual([]);
    expect(renderer!.root.findAllByType(DirtyDot)).toEqual([]);
    expect(store.getState().drafts).toEqual({});
  });

  // Rows are written only on Apply by their command, and no definition an ordinary
  // keyboard loads names such a command.
  test('no official or bundled stock definition has a row written only on Apply', async () => {
    let scanned = 0;
    const found: string[] = [];
    for (const root of [
      'node_modules/via-keyboards/v3',
      'era-definitions/external/v3',
    ]) {
      for await (const path of new Bun.Glob('**/*.json').scan(root)) {
        scanned++;
        const text = await Bun.file(`${root}/${path}`).text();
        for (const [, name] of text.matchAll(/"(id_\w+)"/g)) {
          if (isDeferredApplyCommand(name)) {
            found.push(`${root}/${path}: ${name}`);
          }
        }
      }
    }
    expect(scanned).toBeGreaterThan(1000);
    expect(found).toEqual([]);
  });

  // The firmware only holds a chosen link speed until its Apply switch is turned on,
  // and reports the speed the pair runs, and the one it keeps for the next start, by
  // their names.
  const GET = 0x08;
  const LINK_SPEEDS = ['High', 'Medium', 'Low'];

  class LinkKeyboard extends MenuKeyboard {
    held = 0;
    running = 'Low';
    stored = 'High';
    // What the pair does when the switch goes on; by default it switches.
    switches = true;
    // Whether it keeps the speed it switched to, as a keyboard that cannot write its
    // storage does not.
    keeps = true;
    // How many readings the new speed lasts before it falls back to Low, as a speed
    // the cable cannot hold does.
    lasts = Infinity;
    readings = 0;

    async sendReport(reportId: number, data: BufferSource) {
      const bytes = [
        ...new Uint8Array(
          data instanceof Uint8Array ? data : (data as ArrayBuffer),
        ),
      ];
      const [command, channel, id, value] = bytes;
      if (command === SET && channel === 9 && id === 8) {
        this.held = value;
      }
      if (
        command === SET &&
        channel === 9 &&
        id === 9 &&
        value &&
        this.switches
      ) {
        this.running = LINK_SPEEDS[this.held];
        if (this.keeps) {
          this.stored = LINK_SPEEDS[this.held];
        }
        this.readings = 0;
      }
      if (command !== GET || channel !== 9 || (id !== 64 && id !== 65)) {
        return super.sendReport(reportId, data);
      }
      this.sent.push(bytes);
      if (id === 64 && ++this.readings > this.lasts) {
        this.running = 'Low';
      }
      const reply = Uint8Array.from(bytes).fill(0, 3);
      reply.set(
        new TextEncoder().encode(id === 64 ? this.running : this.stored),
        3,
      );
      this.listeners.forEach((listener) =>
        listener({data: new DataView(reply.buffer)}),
      );
    }
  }

  const linkMenu = (withLabels = true) => ({
    label: 'SYSTEM',
    content: [
      {
        label: 'LINK',
        content: [
          {
            label: 'Split Link Speed',
            type: 'dropdown',
            options: [
              ['High', 0],
              ['Medium', 1],
              ['Low', 2],
            ],
            content: ['id_qmk_split_link_level', 9, 8],
          },
          {
            label: 'Apply',
            type: 'toggle',
            content: ['id_qmk_split_link_apply', 9, 9],
          },
          ...(withLabels
            ? [
                {
                  label: 'Runtime Level',
                  type: 'label',
                  content: ['id_qmk_split_link_runtime', 9, 64],
                },
                {
                  label: 'Saved Level',
                  type: 'label',
                  content: ['id_qmk_split_link_stored', 9, 65],
                },
              ]
            : []),
        ],
      },
      {
        label: 'BOOT',
        content: [
          {
            label: 'Jump To BOOT',
            type: 'toggle',
            content: ['id_qmk_system_dfu', 9, 1],
          },
        ],
      },
    ],
  });
  // The menu keeps a value as it reads it: the rest of the reply, zeros and all.
  const asRead = (value: number) => [value, ...new Array(28).fill(0)];
  // The pair would agree on the stored High, but runs at Low.
  const linkValues = {
    id_qmk_split_link_level: asRead(0),
    id_qmk_split_link_apply: [0],
    id_qmk_split_link_runtime: [...new TextEncoder().encode('Low'), 0],
    id_qmk_split_link_stored: [...new TextEncoder().encode('High'), 0],
    id_qmk_system_dfu: [0],
  };

  // The dropdown listens on the document while it is mounted.
  const showLink = async (store: {getState: () => unknown}) => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: new EventTarget(),
    });
    await show(store);
  };
  const speed = () => row('Split Link Speed')!.findByType(AccentSelect);
  const chooseSpeed = async (name: string) => {
    const option = speed().props.options.find(
      ({label}: {label: string}) => label === name,
    );
    await act(async () => {
      await speed().props.onChange(option);
    });
  };
  // The row names on the screen; a switch draws an empty label of its own.
  const labels = () =>
    renderer!.root
      .findAll((node) => node.type === 'label')
      .map((node) => textOf(node))
      .filter(Boolean);
  const failed = () =>
    renderer!.root.findAll(
      (node) => node.props.role === 'alert' && textOf(node) === 'Failed',
    ).length > 0;
  const apply = async () => {
    await act(async () => {
      await button('Apply').props.onClick();
    });
  };

  const resultMenu = () => {
    const menu = linkMenu();
    menu.content[0].content.push({label: 'Last Apply', type: 'label', content: [LINK_RESULT, 9, 66]} as any);
    return menu;
  };
  class ResultKeyboard extends LinkKeyboard {
    result = 'No Apply this boot';
    nextResult = 'Applied Medium';
    resultReads = 0;
    pendingReads = 0;
    respond = ([command, channel, id]: number[], bytes: Uint8Array) => {
      if (command === SET && channel === 9 && id === 9) this.result = this.nextResult;
      if (command === GET && channel === 9 && id === 66) {
        this.resultReads++;
        const text = this.pendingReads-- > 0 ? 'Pending Medium' : this.result;
        bytes.fill(0, 3); bytes.set(new TextEncoder().encode(text), 3);
      }
    };
  }

  test('Last Apply reads Pending through completion, catches later failure and retries the same speed', async () => {
    const keyboard = new ResultKeyboard();
    const {store} = await openKeyboard('era', resultMenu(), linkValues, keyboard);
    setLabelWatchForTesting({intervalMs: 1, holdMs: 5, timeoutMs: 1000});
    await showLink(store);
    expect(textOf(renderer!.root)).toContain('No Apply this boot');
    await chooseSpeed('Medium');
    keyboard.pendingReads = 2;
    await apply();
    expect(keyboard.resultReads).toBeGreaterThan(3);
    expect(textOf(renderer!.root)).toContain('Applied Medium');
    expect(store.getState().drafts).toEqual({});
    keyboard.result = 'Failed - check levels';
    keyboard.running = 'Low';
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1200)); });
    expect(textOf(renderer!.root)).toContain('Failed - check levels');
    expect(speed().props.value.label).toBe('Low');
    keyboard.nextResult = 'Already set';
    await chooseSpeed('Medium');
    await apply();
    expect(textOf(renderer!.root)).toContain('Already set');
    // An explicit choice at the same running/stored speed is still an Apply request.
    await chooseSpeed('Medium');
    expect(button('Apply').props.disabled).toBe(false);
    await apply();
    expect(store.getState().drafts).toEqual({});
  });

  for (const result of ['Busy - retry', 'Failed - check levels', 'Cancelled - retry']) {
    test(`Last Apply ${result} does not accept matching levels as success`, async () => {
      const keyboard = new ResultKeyboard();
      keyboard.nextResult = result;
      const {store} = await openKeyboard('era', resultMenu(), linkValues, keyboard);
      setLabelWatchForTesting({intervalMs: 1, holdMs: 5, timeoutMs: 1000});
      await showLink(store);
      await chooseSpeed('Medium');
      await apply();
      expect(textOf(renderer!.root)).toContain(result);
      expect(button('Apply').props.disabled).toBe(false);
      expect(failed()).toBe(true);
      expect(store.getState().drafts[PATH]).toBeDefined();
    });
  }

  test('legacy value 66 unhandled falls back to Runtime/Saved checks and never locks the connection', async () => {
    const keyboard = new ResultKeyboard();
    keyboard.refuse = ([command, channel, id]) => command === GET && channel === 9 && id === 66;
    const {store} = await openKeyboard('era', resultMenu(), linkValues, keyboard);
    setLabelWatchForTesting({intervalMs: 1, holdMs: 5, timeoutMs: 1000});
    await showLink(store);
    expect(textOf(renderer!.root)).toContain('Not supported by this firmware');
    await chooseSpeed('Medium');
    await apply();
    expect(store.getState().drafts).toEqual({});
    expect(new KeyboardAPI(PATH).isConnectionLocked()).toBe(false);
  });

  test('visibility activation must keep one polling loop', async () => {
    let signal!: () => void;
    let release!: () => void;
    let delayRuntime = false;
    const waiting = new Promise<void>(resolve => { signal = resolve; });
    class DelayedKeyboard extends ResultKeyboard {
      async sendReport(reportId: number, data: BufferSource) {
        const bytes = [...new Uint8Array(data instanceof Uint8Array ? data : data as ArrayBuffer)];
        if (delayRuntime && bytes[0] === GET && bytes[1] === 9 && bytes[2] === 64) {
          delayRuntime = false;
          signal();
          await new Promise<void>(resolve => { release = resolve; });
        }
        return super.sendReport(reportId, data);
      }
    }
    const keyboard = new DelayedKeyboard();
    const {store} = await openKeyboard('era', resultMenu(), linkValues, keyboard);
    await showLink(store);
    delayRuntime = true;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waiting;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => { release(); await new Promise(resolve => setTimeout(resolve, 30)); });
    const baseline = keyboard.resultReads;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
    expect(keyboard.resultReads - baseline).toBe(1);
  });

  test('LINK recovers a malformed result automatically without a Refresh button', async () => {
    const keyboard = new ResultKeyboard();
    keyboard.result = 'Malformed';
    const {store} = await openKeyboard('era', resultMenu(), linkValues, keyboard);
    await showLink(store);
    expect(textOf(renderer!.root)).toContain('Invalid response');
    keyboard.result = 'Applied High';
    expect(renderer!.root.findAllByType('button').some(node => textOf(node) === 'Refresh')).toBe(false);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
    expect(textOf(renderer!.root)).toContain('Applied High');
    keyboard.result = 'Failed - check levels';
    const baseline = keyboard.resultReads;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
    expect(textOf(renderer!.root)).toContain('Failed - check levels');
    expect(keyboard.resultReads - baseline).toBe(1);
  });

  test('background LINK reads retain the receipt until completion and invalidate it on failure', async () => {
    let signal!: () => void;
    let release!: () => void;
    let delay = false;
    const waiting = new Promise<void>(resolve => { signal = resolve; });
    class DelayedResultKeyboard extends ResultKeyboard {
      async sendReport(reportId: number, data: BufferSource) {
        const bytes = [...new Uint8Array(data instanceof Uint8Array ? data : data as ArrayBuffer)];
        if (delay && bytes[0] === GET && bytes[1] === 9 && bytes[2] === 66) {
          delay = false;
          signal();
          await new Promise<void>(resolve => { release = resolve; });
        }
        return super.sendReport(reportId, data);
      }
    }
    const keyboard = new DelayedResultKeyboard();
    keyboard.result = 'Applied High';
    const {store} = await openKeyboard('era', resultMenu(), linkValues, keyboard);
    await showLink(store);
    delay = true;
    let read!: Promise<unknown>;
    act(() => { read = store.dispatch(refreshMenuObservation(LINK_RESULT)); });
    await waiting;
    expect(textOf(renderer!.root)).toContain('Applied High');
    expect(textOf(renderer!.root)).not.toContain('Loading...');
    let note = renderer!.root.findAllByType('span').find(node => textOf(node).startsWith('Result for this unit only'))!;
    expect(note).toBeDefined();
    while (note && !note.props.hidden) note = note.parent!;
    expect(note?.props.hidden).toBe(true);
    expect(getMenuObservation(store.getState(), LINK_RESULT)).toEqual({status: 'ready', text: 'Applied High'});
    keyboard.result = 'Malformed';
    await act(async () => { release(); await read; });
    expect(textOf(renderer!.root)).toContain('Invalid response');
    expect(textOf(renderer!.root)).not.toContain('Applied High');
  });
  test('LINK shows the speed the pair runs, and Apply sends a new one with its switch', async () => {
    const keyboard = new LinkKeyboard();
    const {store} = await openKeyboard('era', linkMenu(), linkValues, keyboard);
    setLabelWatchForTesting({intervalMs: 1, holdMs: 5, timeoutMs: 1000});
    await showLink(store);

    expect(speed().props.value.label).toBe('Low');
    // Neither the switch nor the label that names the running speed has a row.
    expect(labels()).toEqual(['Split Link Speed']);
    expect(button('Apply').props.disabled).toBe(true);

    await chooseSpeed('Medium');
    expect(speed().props.value.label).toBe('Medium');
    expect(hasDot(row('Split Link Speed')!)).toBe(true);
    expect(hasDot(tab('LINK'))).toBe(true);
    expect(writes(keyboard)).toEqual([]);

    await apply();

    expect(writes(keyboard)).toEqual([
      [SET, 9, 8, 1, 0],
      [SAVE, 9],
      [SET, 9, 9, 1, 0],
      [SAVE, 9],
    ]);
    expect(keyboard.running).toBe('Medium');
    expect(store.getState().drafts).toEqual({});
    expect(speed().props.value.label).toBe('Medium');
    expect(hasDot(tab('LINK'))).toBe(false);
    expect(button('Apply').props.disabled).toBe(true);
    expect(failed()).toBe(false);
    const announced = () => renderer!.root.findAll(
      (node) => typeof node.type === 'string' && node.props.role === 'status',
    ).map(textOf);
    expect(announced()).toContain('Applied');
    await chooseSpeed('High');
    expect(announced()).not.toContain('Applied');
  });

  // Waits for the readings a page sends as it opens to come back.
  const settle = async (done: () => boolean) => {
    for (let wait = 0; wait < 100 && !done(); wait++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }
  };
  const readings = (keyboard: LinkKeyboard, label: number) =>
    keyboard.sent.filter(
      ([command, channel, id]) =>
        command === GET && channel === 9 && id === label,
    );
  const labelText = (store: {getState: () => any}, command: string) =>
    String.fromCharCode(
      ...(store.getState().menus.customMenuDataMap[PATH]?.[command] ?? []),
    ).split('\0')[0];

  // The pair reaches its stored speed after the menu was read, or falls back to Low
  // without the menu hearing of it, and the other unit can change the speed kept; the
  // page reads both as it opens.
  test('opening LINK reads the running speed again', async () => {
    const keyboard = new LinkKeyboard();
    keyboard.running = 'High';
    keyboard.stored = 'Low';
    const {store} = await openKeyboard('era', linkMenu(), linkValues, keyboard);
    await showLink(store);
    await settle(
      () =>
        speed().props.value.label === 'High' &&
        labelText(store, 'id_qmk_split_link_stored') === 'Low',
    );

    expect(speed().props.value.label).toBe('High');
    expect(readings(keyboard, 64)).toHaveLength(1);
    expect(readings(keyboard, 65)).toHaveLength(1);
    expect(button('Apply').props.disabled).toBe(true);
    // The speed kept is Low now, so the one shown is a change to keep.
    await chooseSpeed('High');
    expect(hasDot(row('Split Link Speed')!)).toBe(true);
    expect(button('Apply').props.disabled).toBe(false);
    expect(writes(keyboard)).toEqual([]);
  });

  // A speed the cable cannot hold is tried again at every start until another is
  // kept, so the speed the pair fell back to can be applied although it is shown.
  test('the running speed can be applied to keep it while the keyboard keeps another', async () => {
    const keyboard = new LinkKeyboard();
    const {store} = await openKeyboard('era', linkMenu(), linkValues, keyboard);
    setLabelWatchForTesting({intervalMs: 1, holdMs: 5, timeoutMs: 1000});
    await showLink(store);
    expect(speed().props.value.label).toBe('Low');
    expect(hasDot(row('Split Link Speed')!)).toBe(false);
    expect(button('Apply').props.disabled).toBe(true);

    await chooseSpeed('Low');

    expect(hasDot(row('Split Link Speed')!)).toBe(true);
    expect(hasDot(tab('LINK'))).toBe(true);
    expect(button('Apply').props.disabled).toBe(false);
    expect(button('Cancel').props.disabled).toBe(false);

    await apply();

    expect(writes(keyboard)).toEqual([
      [SET, 9, 8, 2, 0],
      [SAVE, 9],
      [SET, 9, 9, 1, 0],
      [SAVE, 9],
    ]);
    expect(keyboard.stored).toBe('Low');
    expect(store.getState().drafts).toEqual({});
    expect(hasDot(tab('LINK'))).toBe(false);
    expect(button('Apply').props.disabled).toBe(true);
    expect(failed()).toBe(false);

    // Running and kept, it is no change.
    await chooseSpeed('Low');
    expect(store.getState().drafts).toEqual({});
    expect(button('Apply').props.disabled).toBe(true);
  });

  // A keyboard that runs the new speed but could not keep it starts at the old one
  // next time.
  test('Apply says Failed when the pair runs the new speed but the keyboard does not keep it', async () => {
    const keyboard = new LinkKeyboard();
    keyboard.keeps = false;
    const {store} = await openKeyboard('era', linkMenu(), linkValues, keyboard);
    setLabelWatchForTesting({intervalMs: 1, holdMs: 5, timeoutMs: 60});
    await showLink(store);
    await chooseSpeed('Medium');

    await apply();

    expect(keyboard.running).toBe('Medium');
    expect(keyboard.stored).toBe('High');
    expect(failed()).toBe(true);
    expect(hasDot(row('Split Link Speed')!)).toBe(true);
    expect(button('Apply').props.disabled).toBe(false);

    // Without the choice the page shows the speed the pair runs, which stays a
    // change to keep.
    await act(async () => button('Cancel').props.onClick());
    expect(speed().props.value.label).toBe('Medium');
    expect(button('Apply').props.disabled).toBe(true);
    await chooseSpeed('Medium');
    expect(button('Apply').props.disabled).toBe(false);

    keyboard.keeps = true;
    await apply();

    expect(keyboard.stored).toBe('Medium');
    expect(failed()).toBe(false);
    expect(store.getState().drafts).toEqual({});
    expect(button('Apply').props.disabled).toBe(true);
  });

  test('Apply says Failed when the pair does not stay at the new speed, and keeps the choice', async () => {
    const keyboard = new LinkKeyboard();
    // The other half is not there, so the pair never switches.
    keyboard.switches = false;
    const {store} = await openKeyboard('era', linkMenu(), linkValues, keyboard);
    setLabelWatchForTesting({intervalMs: 1, holdMs: 5, timeoutMs: 60});
    await showLink(store);
    await chooseSpeed('High');

    await apply();

    expect(writes(keyboard)).toEqual([
      [SET, 9, 8, 0, 0],
      [SAVE, 9],
      [SET, 9, 9, 1, 0],
      [SAVE, 9],
    ]);
    expect(failed()).toBe(true);
    // Only the apply result is announced: both writes were accepted, so no row
    // says the keyboard refused one.
    expect(alerts()).toEqual(['Failed']);
    // The choice stays for another Apply.
    expect(speed().props.value.label).toBe('High');
    expect(hasDot(row('Split Link Speed')!)).toBe(true);
    expect(button('Apply').props.disabled).toBe(false);
    expect(Object.values(store.getState().drafts[PATH])).toEqual([0]);

    await chooseSpeed('Medium');
    expect(failed()).toBe(false);

    // The pair switches, but the cable cannot hold the speed and it falls back.
    keyboard.switches = true;
    keyboard.lasts = 1;
    await apply();

    expect(keyboard.running).toBe('Low');
    expect(failed()).toBe(true);
    expect(speed().props.value.label).toBe('Medium');
    expect(Object.values(store.getState().drafts[PATH])).toEqual([1]);

    await act(async () => button('Cancel').props.onClick());
    expect(failed()).toBe(false);
    expect(speed().props.value.label).toBe('Low');

    // The pair keeps Medium and would try it again at the next start, so the Low it
    // fell back to is still a change to keep.
    expect(keyboard.stored).toBe('Medium');
    await chooseSpeed('Low');
    expect(button('Apply').props.disabled).toBe(false);
    await apply();

    expect(writes(keyboard).slice(-4)).toEqual([
      [SET, 9, 8, 2, 0],
      [SAVE, 9],
      [SET, 9, 9, 1, 0],
      [SAVE, 9],
    ]);
    expect(keyboard.stored).toBe('Low');
    expect(failed()).toBe(false);
    expect(store.getState().drafts).toEqual({});
  });

  for (const {held, id, sent} of [
    {held: 'the speed', id: 8, sent: [[SET, 9, 8, 1, 0], [SAVE, 9]]},
    {
      held: 'its switch',
      id: 9,
      sent: [
        [SET, 9, 8, 1, 0],
        [SAVE, 9],
        [SET, 9, 9, 1, 0],
        [SAVE, 9],
      ],
    },
  ]) {
    test(`a keyboard chosen while ${held} is on its way is sent nothing of the new speed`, async () => {
      const keyboard = new LinkKeyboard();
      const opened = await openKeyboard('era', linkMenu(), linkValues, keyboard);
      const other = new LinkKeyboard();
      const chooseOther = await addKeyboard(opened, other, linkValues);
      setLabelWatchForTesting({intervalMs: 1, holdMs: 5, timeoutMs: 60});
      await showLink(opened.store);
      await chooseSpeed('Medium');

      await applyWhile(
        keyboard,
        chooseOther,
        (bytes) => bytes[0] === SET && bytes[2] === id,
      );

      // Neither its switch nor a reading of the speed it runs goes to the other
      // keyboard, whose page says nothing of this one's Apply.
      expect(writes(keyboard)).toEqual(sent);
      expect(other.sent).toEqual([]);
      expect(other.running).toBe('Low');
      expect(Object.values(opened.store.getState().drafts[PATH])).toEqual([1]);
      expect(failed()).toBe(false);
      expect(alerts()).toEqual([]);
    });
  }

  // The pair takes a speed only when its switch goes out, so a speed set back while
  // the new one is on its way leaves the pair where it runs.
  test('a speed set back while the new one is on its way is not switched to', async () => {
    const keyboard = new LinkKeyboard();
    keyboard.stored = 'Low';
    const {store} = await openKeyboard(
      'era',
      linkMenu(),
      {
        ...linkValues,
        id_qmk_split_link_stored: [...new TextEncoder().encode('Low'), 0],
      },
      keyboard,
    );
    setLabelWatchForTesting({intervalMs: 1, holdMs: 5, timeoutMs: 60});
    await showLink(store);
    await chooseSpeed('Medium');

    await applyWhile(
      keyboard,
      () => chooseSpeed('Low'),
      (bytes) => bytes[0] === SET && bytes[2] === 8,
    );

    // The speed held before goes back, as nothing switches to the one sent.
    expect(writes(keyboard)).toEqual([
      [SET, 9, 8, 1, 0],
      [SAVE, 9],
      [SET, 9, 8, 0, 0],
      [SAVE, 9],
    ]);
    expect(keyboard.held).toBe(0);
    expect(keyboard.running).toBe('Low');
    expect(keyboard.stored).toBe('Low');
    // Running and kept, Low is no change, and nothing says Apply went wrong.
    expect(store.getState().drafts).toEqual({});
    expect(speed().props.value.label).toBe('Low');
    expect(hasDot(tab('LINK'))).toBe(false);
    expect(button('Apply').props.disabled).toBe(true);
    expect(failed()).toBe(false);
    expect(alerts()).toEqual([]);
  });

  test('a speed set back while the new one is on its way waits for Apply while the keyboard keeps another', async () => {
    const keyboard = new LinkKeyboard();
    const {store} = await openKeyboard('era', linkMenu(), linkValues, keyboard);
    setLabelWatchForTesting({intervalMs: 1, holdMs: 5, timeoutMs: 60});
    await showLink(store);
    await chooseSpeed('Medium');

    await applyWhile(
      keyboard,
      () => chooseSpeed('Low'),
      (bytes) => bytes[0] === SET && bytes[2] === 8,
    );

    expect(writes(keyboard)).toEqual([
      [SET, 9, 8, 1, 0],
      [SAVE, 9],
      [SET, 9, 8, 0, 0],
      [SAVE, 9],
    ]);
    expect(keyboard.held).toBe(0);
    expect(keyboard.running).toBe('Low');
    expect(keyboard.stored).toBe('High');
    // The keyboard keeps High, so Low stays a change to keep.
    expect(Object.values(store.getState().drafts[PATH])).toEqual([2]);
    expect(speed().props.value.label).toBe('Low');
    expect(hasDot(row('Split Link Speed')!)).toBe(true);
    expect(button('Apply').props.disabled).toBe(false);
    expect(failed()).toBe(false);
    expect(alerts()).toEqual([]);

    await apply();

    expect(writes(keyboard).slice(4)).toEqual([
      [SET, 9, 8, 2, 0],
      [SAVE, 9],
      [SET, 9, 9, 1, 0],
      [SAVE, 9],
    ]);
    expect(keyboard.stored).toBe('Low');
    expect(store.getState().drafts).toEqual({});
    expect(failed()).toBe(false);
  });

  // Without the running speed, like the page older firmware is served, the page
  // shows the speed the keyboard holds, so one sent but not switched to goes back.
  test('a speed set back while the new one is on its way goes back on a LINK page without the running speed', async () => {
    const keyboard = new LinkKeyboard();
    keyboard.held = 1;
    keyboard.running = 'Medium';
    keyboard.stored = 'Medium';
    const {store} = await openKeyboard(
      'era',
      linkMenu(false),
      {...linkValues, id_qmk_split_link_level: asRead(1)},
      keyboard,
    );
    await showLink(store);
    await chooseSpeed('Low');

    await applyWhile(
      keyboard,
      () => chooseSpeed('Medium'),
      (bytes) => bytes[0] === SET && bytes[2] === 8,
    );

    expect(writes(keyboard)).toEqual([
      [SET, 9, 8, 2, 0],
      [SAVE, 9],
      [SET, 9, 8, 1, 0],
      [SAVE, 9],
    ]);
    expect(keyboard.held).toBe(1);
    expect(keyboard.running).toBe('Medium');
    expect(failed()).toBe(false);
    expect(alerts()).toEqual([]);

    await act(async () => button('Cancel').props.onClick());
    expect(speed().props.value.label).toBe('Medium');
  });

  // Apply goes on watching the speed after its page is left.
  test('a page opened again while the speed is on its way says Failed once the pair does not take it', async () => {
    const keyboard = new LinkKeyboard();
    keyboard.switches = false;
    const {store} = await openKeyboard('era', linkMenu(), linkValues, keyboard);
    setLabelWatchForTesting({intervalMs: 1, holdMs: 5, timeoutMs: 60});
    await showLink(store);
    await chooseSpeed('Medium');

    await applyWhile(
      keyboard,
      async () => {
        await act(async () => tab('BOOT').props.onClick());
        await act(async () => tab('LINK').props.onClick());
        expect(button('Apply').props.disabled).toBe(true);
        expect(button('Cancel').props.disabled).toBe(true);
      },
      (bytes) => bytes[0] === SET && bytes[2] === 9,
    );

    expect(failed()).toBe(true);
    expect(hasDot(row('Split Link Speed')!)).toBe(true);
    expect(button('Apply').props.disabled).toBe(false);
    // Another pane and back.
    await showLink(store);
    expect(failed()).toBe(true);

    // The pair takes the speed after all, and the page opened next reads it.
    keyboard.running = 'Medium';
    keyboard.stored = 'Medium';
    await showLink(store);
    await settle(() => !hasDot(row('Split Link Speed')!));
    expect(hasDot(row('Split Link Speed')!)).toBe(false);
    expect(failed()).toBe(false);
    expect(button('Apply').props.disabled).toBe(true);
  });

  // A definition that has no label for the running speed, like the one older firmware
  // is served, shows the stored speed and trusts the switch it took.
  test('LINK without the running speed shows the stored one and settles once the switch is taken', async () => {
    const keyboard = new LinkKeyboard();
    const {store} = await openKeyboard(
      'era',
      linkMenu(false),
      {...linkValues, id_qmk_split_link_level: asRead(1)},
      keyboard,
    );
    await showLink(store);
    expect(speed().props.value.label).toBe('Medium');
    expect(labels()).toEqual(['Split Link Speed']);

    await chooseSpeed('Low');
    await apply();

    expect(writes(keyboard)).toEqual([
      [SET, 9, 8, 2, 0],
      [SAVE, 9],
      [SET, 9, 9, 1, 0],
      [SAVE, 9],
    ]);
    expect(
      keyboard.sent.filter(
        ([command, channel, id]) =>
          command === GET && channel === 9 && id === 64,
      ),
    ).toEqual([]);
    expect(store.getState().drafts).toEqual({});
    expect(speed().props.value.label).toBe('Low');
    expect(failed()).toBe(false);

    // It cannot tell whether the pair took the speed, so the one shown can be sent
    // again, as after an agreement the other unit was not there for.
    await chooseSpeed('Low');
    expect(hasDot(row('Split Link Speed')!)).toBe(true);
    expect(button('Apply').props.disabled).toBe(false);
    await apply();

    expect(writes(keyboard).slice(4)).toEqual([
      [SET, 9, 8, 2, 0],
      [SAVE, 9],
      [SET, 9, 9, 1, 0],
      [SAVE, 9],
    ]);
    expect(store.getState().drafts).toEqual({});
  });

  test('an official definition keeps the LINK switch and writes the speed at once', async () => {
    const keyboard = new LinkKeyboard();
    const {store} = await openKeyboard(
      'official',
      linkMenu(),
      linkValues,
      keyboard,
    );
    await showLink(store);
    expect(speed().props.value.label).toBe('High');
    expect(labels()).toEqual([
      'Split Link Speed',
      'Apply',
      'Runtime Level',
      'Saved Level',
    ]);
    expect(buttons()).toEqual([]);

    await chooseSpeed('Medium');

    expect(writes(keyboard)).toEqual([
      [SET, 9, 8, 1, 0],
      [SAVE, 9],
    ]);
    expect(store.getState().drafts).toEqual({});
  });

  test('Jump To BOOT is a button that turns the switch on', async () => {
    const keyboard = new LinkKeyboard();
    const {store} = await openKeyboard('era', linkMenu(), linkValues, keyboard);
    await showLink(store);
    await act(async () => tab('BOOT').props.onClick());

    const run = button('Run');
    expect(run.props.title).toBe('Restart into the bootloader');
    expect(
      row('Jump To BOOT')!.findAll((node) => node.type === 'input'),
    ).toEqual([]);
    expect(buttons()).toEqual([]);

    await act(async () => {
      await run.props.onClick();
    });

    expect(writes(keyboard)).toEqual([
      [SET, 9, 1, 1, 0],
      [SAVE, 9],
    ]);
  });

  // The app reads what the pair runs and keeps through the definition, so older
  // firmware, which is served a definition without those labels, is never asked.
  test('every definition with the LINK switch names the running and kept speeds with the options it offers', async () => {
    const manifest = await Bun.file(
      'config/era-definitions.manifest.json',
    ).json();
    const found: string[] = [];
    for (const {path} of manifest.definitions as {path: string}[]) {
      const definition = await Bun.file(path).json();
      const link = collectDeferredItems({content: definition.menus}).find(
        ({content}) => content[0] === 'id_qmk_split_link_level',
      );
      if (!link) {
        continue;
      }
      found.push(path);
      expect({
        path,
        running: link.held?.running?.content,
        stored: link.held?.stored?.content,
      }).toEqual({
        path,
        running: ['id_qmk_split_link_runtime', 9, 64],
        stored: ['id_qmk_split_link_stored', 9, 65],
      });
      expect({
        path,
        options: (link.options as [string, number][]).map(([name]) => name),
      }).toEqual({path, options: LINK_SPEEDS});
    }
    expect(found).toHaveLength(6);
  });
});
