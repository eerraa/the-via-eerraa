import {configureStore} from '@reduxjs/toolkit';
import {afterAll, beforeEach, expect, test} from 'bun:test';
import i18n from 'i18next';
import {Provider} from 'react-redux';
import {I18nextProvider} from 'react-i18next';
import {renderToStaticMarkup} from 'react-dom/server';
import {act, create, type ReactTestInstance} from 'react-test-renderer';
import {
  HID,
  registerHIDDeviceForTesting,
  resetHIDTransportForTesting,
} from '../src/shims/node-hid';

const originalWarn = console.warn;
console.warn = () => undefined;
const {Pane} = await (async () => {
  try {
    await import('../src/utils/keyboard-api');
    return await import('../src/components/panes/configure-panes/save-load');
  } finally {
    console.warn = originalWarn;
  }
})();
const {KeyboardAPI} = await import('../src/utils/keyboard-api');
const translations = i18n.createInstance();
await translations.init({lng: 'en', resources: {en: {translation: {}}}});
const device = {
  path: 'save-load-pane',
  vendorId: 0x4501,
  productId: 0x000c,
  vendorProductId: 0x4501000c,
  productName: 'BRICK60',
  protocol: 12,
  requiredDefinitionVersion: 'v3',
  hasResolvedDefinition: true,
} as const;
const definition = {
  name: 'BRICK60',
  vendorProductId: device.vendorProductId,
  matrix: {rows: 1, cols: 1},
  layouts: {keys: [], labels: [], optionKeys: {}, width: 1, height: 1},
  menus: [],
  keycodes: [],
};
const makeStore = (status: 'metadata' | 'ready', capable = true) => {
  const generation = new KeyboardAPI(device.path).getConnectionGeneration();
  return configureStore({
    reducer: () =>
      ({
        definitions: {
          definitions: {},
          customDefinitions: {},
          eraDefinitions: {[device.vendorProductId]: {v3: definition}},
          layoutOptionsMap: {},
          definitionEpochs: {},
        },
        definitionName: {selectedOptionMap: {}},
        devices: {
          selectedDevicePath: device.path,
          selectedConnectionGeneration: generation,
          selectedConnectionNeedsReload: false,
          selectionGeneration: 1,
          readyDevicePath: device.path,
          connectedDevicePaths: {[device.path]: device},
          unresolvedDefinitionDevicePaths: {},
          invalidProtocolDevicePaths: {},
          supportedIds: {},
          selectedConnectionLocked: false,
        },
        firmware: {firmwareVersionMap: {}, keycodesVersionMap: {}},
        keymap: {
          rawDeviceMap: {[device.path]: [{keymap: [4], isLoaded: true}]},
        },
        macros: {
          ast: [],
          macroBufferSize: 0,
          macroCount: 16,
          isFeatureSupported: true,
          status,
          ownerPath: device.path,
          ownerConnectionGeneration: generation,
          ownerSelectionGeneration: 1,
        },
        menus: {
          customMenuDataMap: {},
          commonMenusMap: {},
          showKeyPainter: false,
        },
        stateSync: {
          byPath: capable ? {[device.path]: {capability: 'capable'}} : {},
          configureVisible: true,
          documentHidden: false,
        },
      }) as any,
  });
};
beforeEach(async () => {
  registerHIDDeviceForTesting(device.path, {
    vendorId: device.vendorId,
    productId: device.productId,
    productName: device.productName,
    opened: false,
    collections: [],
    async open() {
      this.opened = true;
    },
    close: async () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    sendReport: async () => undefined,
  } as unknown as HIDDevice);
  await new HID.HID(device.path).openPromise;
});
afterAll(() => resetHIDTransportForTesting());
const view = (store: ReturnType<typeof makeStore>) => (
  <Provider store={store}>
    <I18nextProvider i18n={translations}>
      <Pane />
    </I18nextProvider>
  </Provider>
);
const textOf = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === 'string' ? child : textOf(child)))
    .join('');

test('Save and Load remain available before and after macros are read', () => {
  for (const status of ['metadata', 'ready'] as const) {
    const html = renderToStaticMarkup(view(makeStore(status)));
    expect(html).not.toContain('Loading...');
    expect(html).toContain('Save Current Layout');
    expect(html).toContain('Load Saved Layout');
  }
});

test('saving refuses an unread keyboard before the dialog, exports the layout, and reports disk errors', async () => {
  const originalPicker = Object.getOwnPropertyDescriptor(
    window,
    'showSaveFilePicker',
  );
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    for (const outcome of ['unread', 'saved', 'disk-full'] as const) {
      const names: string[] = [];
      const written: string[] = [];
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: async ({suggestedName}: {suggestedName: string}) => {
          names.push(suggestedName);
          return {
            createWritable: async () => {
              if (outcome === 'disk-full') throw new Error('The disk is full');
              return {
                write: async (blob: Blob) => {
                  written.push(await blob.text());
                },
                close: async () => undefined,
              };
            },
          };
        },
      });
      let renderer!: ReturnType<typeof create>;
      try {
        await act(async () => {
          renderer = create(
            view(
              makeStore(
                outcome === 'unread' ? 'metadata' : 'ready',
                outcome !== 'unread',
              ),
            ),
          );
        });
        const success = () =>
          renderer.root.find(
            (node) =>
              typeof node.type === 'string' && node.props.role === 'status',
          );
        expect(textOf(success())).toBe('');
        await act(async () => {
          await renderer.root
            .find((node) => node.type === 'button' && textOf(node) === 'Save')
            .props.onClick();
        });
        if (outcome === 'unread') {
          expect(names).toEqual([]);
          expect(textOf(success())).toBe('');
          expect(textOf(renderer.root)).toContain(
            'Could not save layout: the keyboard has not finished loading.',
          );
        } else {
          expect(names).toHaveLength(1);
          expect(names[0]).toMatch(/^brick60_\d{4}-\d{2}-\d{2}\.layout\.json$/);
          if (outcome === 'saved') {
            expect(JSON.parse(written[0])).toMatchObject({
              name: 'BRICK60',
              vendorProductId: device.vendorProductId,
              layers: [['KC_A']],
            });
            expect(textOf(success())).toBe('Saved');
          } else {
            expect(written).toEqual([]);
            expect(textOf(success())).toBe('');
            expect(
              renderer.root
                .findAll(
                  (node) =>
                    typeof node.type === 'string' &&
                    node.props.role === 'alert',
                )
                .map(textOf),
            ).toEqual(['Failed to save.']);
          }
        }
      } finally {
        act(() => renderer.unmount());
      }
    }
  } finally {
    console.warn = originalWarn;
    if (originalPicker)
      Object.defineProperty(window, 'showSaveFilePicker', originalPicker);
    else Reflect.deleteProperty(window, 'showSaveFilePicker');
  }
});
