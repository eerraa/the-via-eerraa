import {configureStore} from '@reduxjs/toolkit';
import {afterAll, afterEach, beforeEach, describe, expect, test} from 'bun:test';
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

const loadPane = async () => {
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    await import('../src/utils/keyboard-api');
    return await import('../src/components/panes/configure-panes/save-load');
  } finally {
    console.warn = originalWarn;
  }
};
const {Pane} = await loadPane();
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

const makeStore = (
  macroStatus: 'metadata' | 'ready',
  capability: 'capable' | 'none' = 'capable',
) => {
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
        keymap: {rawDeviceMap: {[device.path]: [{keymap: [4], isLoaded: true}]}},
        macros: {
          ast: [],
          macroBufferSize: 0,
          macroCount: 16,
          isFeatureSupported: true,
          status: macroStatus,
          ownerPath: device.path,
          ownerConnectionGeneration: generation,
          ownerSelectionGeneration: 1,
        },
        menus: {customMenuDataMap: {}, commonMenusMap: {}, showKeyPainter: false},
        stateSync: {
          byPath: capability === 'capable' ? {[device.path]: {capability}} : {},
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
  async open() { this.opened = true; },
  close: async () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  sendReport: async () => undefined,
} as unknown as HIDDevice);
  await new HID.HID(device.path).openPromise;
});

afterAll(() => resetHIDTransportForTesting());

const render = (store: ReturnType<typeof makeStore>) =>
  renderToStaticMarkup(
    <Provider store={store}>
      <I18nextProvider i18n={translations}>
        <Pane />
      </I18nextProvider>
    </Provider>,
  );

describe('Save + Load pane', () => {
  // The pane knows nothing about State Sync: saving reads the macros itself and
  // loading replaces them without reading, so neither waits on the macro buffer.
  test('offers Save and Load while the macros are still unread', () => {
    for (const status of ['metadata', 'ready'] as const) {
      const html = render(makeStore(status));
      expect(html).not.toContain('Loading...');
      expect(html).toContain('Save Current Layout');
      expect(html).toContain('Load Saved Layout');
      // Live regions must exist before a result is inserted to announce it.
      expect(html).toMatch(/<div[^>]*role="status"[^>]*><\/div>/);
      expect(html).toMatch(/<div[^>]*role="alert"[^>]*><\/div>/);
    }
  });
});

describe('saving from the Save + Load pane', () => {
  const textOf = (node: ReactTestInstance): string =>
    node.children
      .map((child) => (typeof child === 'string' ? child : textOf(child)))
      .join('');

  // A stand-in for the browser's save dialog and the file it hands back.
  const stubPicker = ({failWrite = false} = {}) => {
    const picker = {names: [] as string[], written: [] as string[]};
    (window as any).showSaveFilePicker = async ({
      suggestedName,
    }: {
      suggestedName: string;
    }) => {
      picker.names.push(suggestedName);
      return {
        createWritable: async () => {
          if (failWrite) {
            throw new Error('The disk is full');
          }
          return {
            write: async (blob: Blob) => {
              picker.written.push(await blob.text());
            },
            close: async () => undefined,
          };
        },
      };
    };
    return picker;
  };
  afterEach(() => {
    delete (window as any).showSaveFilePicker;
  });

  const save = async (store: ReturnType<typeof makeStore>) => {
    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
      let renderer: ReturnType<typeof create> | undefined;
      await act(async () => {
        renderer = create(
          <Provider store={store}>
            <I18nextProvider i18n={translations}>
              <Pane />
            </I18nextProvider>
          </Provider>,
        );
      });
      const button = renderer!.root.find(
        (node) => node.type === 'button' && textOf(node) === 'Save',
      );
      await act(async () => {
        await button.props.onClick();
      });
      const text = textOf(renderer!.root);
      const status = renderer!.root
        .findAll(
          (node) =>
            typeof node.type === 'string' && node.props.role === 'status',
        )
        .map(textOf);
      const alerts = renderer!.root
        .findAll((node) => typeof node.type === 'string' && node.props.role === 'alert')
        .map(textOf);
      act(() => renderer!.unmount());
      return {text, status, alerts};
    } finally {
      console.warn = originalWarn;
    }
  };

  // The dialog needs the click and opens before anything is read, so a save the
  // keyboard cannot complete is refused before a file is chosen.
  test('refuses before the file dialog when the macros cannot be read', async () => {
    const picker = stubPicker();
    const {text} = await save(makeStore('metadata', 'none'));
    expect(picker.names).toEqual([]);
    expect(text).toContain(
      'Could not save layout: the keyboard has not finished loading.',
    );
  });

  test('offers the board and the day as the name, and says the file was saved', async () => {
    const picker = stubPicker();
    const {status} = await save(makeStore('ready'));
    expect(picker.names).toHaveLength(1);
    expect(picker.names[0]).toMatch(
      /^brick60_\d{4}-\d{2}-\d{2}\.layout\.json$/,
    );
    expect(JSON.parse(picker.written[0])).toMatchObject({
      name: 'BRICK60',
      vendorProductId: device.vendorProductId,
      layers: [['KC_A']],
    });
    expect(status).toEqual(['Saved']);
  });

  test('says so when the file cannot be written', async () => {
    stubPicker({failWrite: true});
    const {text, status, alerts} = await save(makeStore('ready'));
    expect(text).toContain('Failed to save.');
    expect(status).toEqual(['']);
    expect(alerts).toEqual(['Failed to save.']);
  });
});
