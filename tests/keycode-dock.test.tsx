import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test';
import {readFileSync} from 'node:fs';
import {configureStore} from '@reduxjs/toolkit';
import i18n from 'i18next';
import type {ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {I18nextProvider} from 'react-i18next';
import {Provider} from 'react-redux';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';

// A keycode setting picks its key in a window portalled into the page body, which
// the test renderer has not got, so it is drawn in place. A mocked module stays
// mocked for the test files run after this one, so the real exports, copied before
// the mock replaces them in place, go back once this file is done.
const realReactDom = {...(await import('react-dom'))};
mock.module('react-dom', () => ({
  ...realReactDom,
  createPortal: (children: ReactNode) => children,
}));
afterAll(() => {
  mock.module('react-dom', () => realReactDom);
});

// The store module graph is circular; entering it through keyboard-api first is the
// order the app itself loads it in.
await import('../src/utils/keyboard-api');
const {PelpiKeycodeInput} =
  await import('../src/components/inputs/pelpi/keycode-input');

const translations = i18n.createInstance();
await translations.init({lng: 'en', resources: {en: {translation: {}}}});

const definition = JSON.parse(
  readFileSync('public/definitions/era/v3/1163042818.json', 'utf8'),
);
const PATH = 'keycode-dock';
const storeWith = (hostKeyboardLayout = 'keymap_us') =>
  configureStore({
    reducer: () =>
      ({
        settings: {themeName: 'OLIVIA_DARK', hostKeyboardLayout},
        definitions: {
          definitions: {},
          customDefinitions: {},
          eraDefinitions: {[definition.vendorProductId]: {v3: definition}},
          definitionEpochs: {},
        },
        devices: {
          selectedDevicePath: PATH,
          selectedConnectionGeneration: 0,
          selectionGeneration: 1,
          connectedDevicePaths: {
            [PATH]: {
              path: PATH,
              vendorProductId: definition.vendorProductId,
              protocol: 12,
              requiredDefinitionVersion: 'v3',
            },
          },
        },
        firmware: {firmwareVersionMap: {}, keycodesVersionMap: {}},
        macros: {
          status: 'idle',
          ast: [],
          macroCount: 0,
          isFeatureSupported: true,
        },
        keymap: {numberOfLayersMap: {}},
      }) as any,
  });

// The page as far as the window touches it: #root, the body's other child, which
// it makes inert while it is open, and the element that has focus.
type Focusable = {props: Record<string, unknown>; focus: () => void};
const page = {};
let focused: unknown = page;
const rootAttributes = new Set<string>();
const appRoot = {
  hasAttribute: (name: string) => rootAttributes.has(name),
  setAttribute: (name: string) => rootAttributes.add(name),
  removeAttribute: (name: string) => rootAttributes.delete(name),
};
// Every element given a ref, in the order they were made.
const made: Focusable[] = [];
const assigned: number[] = [];
let renderer: ReactTestRenderer | undefined;
const originalDocument = Object.getOwnPropertyDescriptor(
  globalThis,
  'document',
);

beforeEach(() => {
  focused = page;
  rootAttributes.clear();
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      body: {children: [appRoot]},
      get activeElement() {
        return focused;
      },
    },
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

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');
const button = (root: ReactTestInstance, label: string) =>
  root.find(
    (node) =>
      node.type === 'button' &&
      (node.props['aria-label'] ?? textOf(node)) === label,
  );
const click = (node: ReactTestInstance) => act(() => node.props.onClick());
const dialogs = () =>
  renderer!.root.findAll(
    (node) => node.type === 'div' && node.props.role === 'dialog',
  );

// A keycode setting holding A, and its button, the only element with a ref while
// the window is shut.
const mount = () => {
  act(() => renderer?.unmount());
  made.length = 0;
  assigned.length = 0;
  act(() => {
    renderer = create(
      <Provider store={storeWith()}>
        <I18nextProvider i18n={translations}>
          <PelpiKeycodeInput
            value={0x04}
            meta={{label: 'Left Key'}}
            setValue={(value) => assigned.push(value)}
          />
        </I18nextProvider>
      </Provider>,
      {
        createNodeMock: (element) => {
          const node: Focusable = {
            props: element.props,
            focus: () => {
              focused = node;
            },
          };
          made.push(node);
          return node;
        },
      },
    );
  });
  expect(made.length).toBe(1);
  return made[0];
};

// Opened with the keyboard from its button, which has focus.
const open = (opener: Focusable) => {
  focused = opener;
  click(renderer!.root.find((node) => node.type === 'button'));
  return dialogs()[0];
};

describe('a keycode setting’s key window', () => {
  // The window is modal: the page behind is inert and focus starts on the category
  // shown. A key picked sets the setting and closes it; Escape, Close and a click
  // beside it close it with nothing set; an LT·MT choice sets the setting and
  // leaves it open for the next. Closed, the page is live again and focus is back
  // on the setting.
  test('it opens over an inert page, and a key or every way out closes it with focus back on the setting', () => {
    const ways: [string, (dialog: ReactTestInstance) => void, number[]][] = [
      [
        'Escape',
        (dialog) =>
          act(() =>
            dialog.props.onKeyDown({
              key: 'Escape',
              stopPropagation: () => undefined,
            }),
          ),
        [],
      ],
      ['Close', (dialog) => click(button(dialog, 'Close')), []],
      [
        'a click beside it',
        () =>
          click(
            renderer!.root.find(
              (node) =>
                node.type === 'div' &&
                typeof node.props.onClick === 'function' &&
                node.children.length === 0,
            ),
          ),
        [],
      ],
      ['a key', (dialog) => click(button(dialog, 'B')), [0x05]],
      [
        'an LT·MT choice',
        (dialog) => {
          click(button(dialog, 'LT·MT'));
          click(
            dialogs()[0]
              .find(
                (node) =>
                  node.props.role === 'group' &&
                  node.props['aria-label'] === 'Layer-Tap (LT)',
              )
              .find((node) => node.type === 'button' && textOf(node) === '1'),
          );
        },
        // LT(1,KC_A).
        [0x4104],
      ],
    ];
    for (const [way, choose, values] of ways) {
      const opener = mount();
      const dialog = open(opener);
      expect({
        way,
        open: dialogs().length,
        inert: rootAttributes.has('inert'),
        focus: (focused as Focusable).props.children,
      }).toEqual({way, open: 1, inert: true, focus: 'Basic'});

      choose(dialog);
      const stays = way === 'an LT·MT choice';
      expect({
        way,
        open: dialogs().length,
        inert: rootAttributes.has('inert'),
        back: focused === opener,
        assigned,
      }).toEqual({
        way,
        open: stays ? 1 : 0,
        inert: stays,
        back: !stays,
        assigned: values,
      });
    }
  });

  test('Tab and Shift+Tab go round inside it', () => {
    const dialog = open(mount());
    const moved: unknown[] = [];
    const stop = () => {
      const node = {
        focus: () => {
          focused = node;
          moved.push(node);
        },
      };
      return node;
    };
    const [first, middle, last] = [stop(), stop(), stop()];
    const press = (shiftKey: boolean) => {
      let prevented = false;
      act(() =>
        dialog.props.onKeyDown({
          key: 'Tab',
          shiftKey,
          currentTarget: {querySelectorAll: () => [first, middle, last]},
          preventDefault: () => {
            prevented = true;
          },
        }),
      );
      return prevented;
    };
    focused = last;
    expect(press(false)).toBe(true);
    expect(focused === first).toBe(true);
    expect(press(true)).toBe(true);
    expect(focused === last).toBe(true);
    // Between the ends the browser moves focus itself.
    focused = middle;
    expect(press(false)).toBe(false);
    expect(moved.length).toBe(2);
  });

  // The setting's button shows the key as the palette draws it, on one line, in the
  // OS layout picked in the layout badge, with the QMK code in its tooltip; a blank
  // key says so in words.
  test('its button shows the key as the palette draws it, with the QMK code in the tooltip', () => {
    const cases: [number, string, string, string][] = [
      [0x4f, 'keymap_us', '→', 'KC_RGHT'],
      [0xe1, 'keymap_us', 'Left Shift', 'KC_LSFT'],
      [0x00, 'keymap_us', 'Blank', 'KC_NO'],
      [0x1c, 'keymap_german', 'Z', 'KC_Y'],
      // C(KC_A), the modifier over the key, as the keyboard draws it.
      [0x0104, 'keymap_us', 'Ctrl+A', 'C(KC_A)'],
    ];
    for (const [value, layout, label, title] of cases) {
      const html = renderToStaticMarkup(
        <Provider store={storeWith(layout)}>
          <I18nextProvider i18n={translations}>
            <PelpiKeycodeInput
              value={value}
              meta={{label: 'Left Key'}}
              setValue={() => undefined}
            />
          </I18nextProvider>
        </Provider>,
      );
      const [, attributes, shown] = html.match(
        /<button([^>]*)>([^<]*)<\/button>/,
      )!;
      expect({
        value,
        label: shown,
        title: /title="([^"]*)"/.exec(attributes)?.[1],
      }).toEqual({value, label, title});
    }
  });
});
