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
import {I18nextProvider} from 'react-i18next';
import {Provider} from 'react-redux';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';

// The dock is portalled into the page body, which the test renderer has not got,
// so it is drawn in place. A mocked module stays mocked for the test files run
// after this one, so the real exports, copied before the mock replaces them in
// place, go back once this file is done.
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
const {KeycodePalette} =
  await import('../src/components/inputs/keycode-palette/keycode-palette');

const translations = i18n.createInstance();
await translations.init({lng: 'en', resources: {en: {translation: {}}}});

const definition = JSON.parse(
  readFileSync('public/definitions/era/v3/1163042818.json', 'utf8'),
);
const PATH = 'keycode-dock';
const store = configureStore({
  reducer: () =>
    ({
      settings: {themeName: 'OLIVIA_DARK', hostKeyboardLayout: 'keymap_us'},
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

// The page as far as the dock touches it: #root, which it makes inert while it is
// open, the keydown listeners on the document, and the element that has focus.
type Focusable = {props: Record<string, unknown>; focus: () => void};
type KeyListener = (event: {key: string}) => void;
const page = {};
let focused: unknown = page;
const rootAttributes = new Set<string>();
const keydown = new Set<KeyListener>();
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
  keydown.clear();
  made.length = 0;
  assigned.length = 0;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      body: page,
      get activeElement() {
        return focused;
      },
      getElementById: (id: string) =>
        id === 'root'
          ? {
              setAttribute: (name: string) => rootAttributes.add(name),
              removeAttribute: (name: string) => rootAttributes.delete(name),
            }
          : null,
      addEventListener: (type: string, listener: KeyListener) => {
        if (type === 'keydown') {
          keydown.add(listener);
        }
      },
      removeEventListener: (type: string, listener: KeyListener) => {
        if (type === 'keydown') {
          keydown.delete(listener);
        }
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

// A keycode setting holding A; returns the button that opens its dock, the only
// element with a ref while the dock is shut.
const mount = () => {
  act(() => {
    renderer = create(
      <Provider store={store}>
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
  expect(made).toHaveLength(1);
  return made[0];
};

const dialogs = () =>
  renderer!.root.findAll(
    (node) => node.type === 'div' && node.props.role === 'dialog',
  );

// Opened with the keyboard from its button: the page behind goes inert and the
// dock takes focus.
const open = (opener: Focusable) => {
  focused = opener;
  act(() => {
    renderer!.root.findAll((node) => node.type === 'button')[0].props.onClick();
  });
  expect(dialogs()).toHaveLength(1);
  expect(rootAttributes.has('inert')).toBe(true);
  expect(focused).toBe(made.find((node) => node.props.role === 'dialog'));
};

describe('the keycode dock', () => {
  const ways: [string, () => void][] = [
    ['Escape', () => keydown.forEach((listener) => listener({key: 'Escape'}))],
    [
      'a click on the page around it',
      () =>
        renderer!.root
          .find(
            (node) =>
              node.type === 'div' &&
              typeof node.props.onClick === 'function' &&
              node.children.length === 0,
          )
          .props.onClick(),
    ],
    [
      'Close',
      () =>
        renderer!.root
          .find((node) => node.type === 'button' && textOf(node) === 'Close')
          .props.onClick(),
    ],
    [
      'choosing a key',
      () => renderer!.root.findByType(KeycodePalette).props.onAssign(0x05),
    ],
  ];

  for (const [way, shut] of ways) {
    test(`${way} shuts it: the page is live again and focus is back on its button`, () => {
      const opener = mount();
      open(opener);

      act(shut);
      expect(dialogs()).toHaveLength(0);
      expect(rootAttributes.has('inert')).toBe(false);
      expect(keydown.size).toBe(0);
      expect(focused).toBe(opener);
      expect(assigned).toEqual(way === 'choosing a key' ? [0x05] : []);
    });
  }
});
