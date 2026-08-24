import {configureStore} from '@reduxjs/toolkit';
import {afterAll, describe, expect, test} from 'bun:test';
import i18n from 'i18next';
import {Provider} from 'react-redux';
import {I18nextProvider} from 'react-i18next';
import {renderToStaticMarkup} from 'react-dom/server';
import {setEraAdvancedMetadataForTesting} from '../src/utils/era-advanced-metadata';
import {
  registerHIDDeviceForTesting,
  resetHIDTransportForTesting,
} from '../src/shims/node-hid';

const loadPane = async () => {
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    await import('../src/utils/keyboard-api');
    return await import('../src/components/panes/configure-panes/custom/menu-generator');
  } finally {
    console.warn = originalWarn;
  }
};
const {Pane} = await loadPane();

const loadFailureMessage =
  'Unable to load feature settings. Reconnect the keyboard and try again.';

const translations = i18n.createInstance();
await translations.init({
  lng: 'en',
  resources: {
    en: {
      translation: {[loadFailureMessage]: loadFailureMessage},
    },
  },
});

const device = {
  path: 'custom-menu-load-failure',
  vendorId: 0x1234,
  productId: 0x5678,
  vendorProductId: 0x12345678,
  productName: 'Custom menu test keyboard',
  protocol: 11,
  requiredDefinitionVersion: 'v3',
  hasResolvedDefinition: true,
} as const;

const makeStore = (overrides: {era?: boolean; menuData?: object} = {}) => {
  const definitionEntry = {[device.vendorProductId]: {v3: {}}};
  const state = {
    definitions: {
      definitions: overrides.era ? {} : definitionEntry,
      customDefinitions: {},
      eraDefinitions: overrides.era ? definitionEntry : {},
      layoutOptionsMap: {},
      definitionEpochs: {},
    },
    devices: {
      selectedDevicePath: device.path,
      selectedConnectionGeneration: 0,
      selectedConnectionNeedsReload: false,
      selectionGeneration: 1,
      readyDevicePath: device.path,
      connectedDevicePaths: {[device.path]: device},
      unresolvedDefinitionDevicePaths: {},
      invalidProtocolDevicePaths: {},
      supportedIds: {},
      forceAuthorize: false,
    },
    firmware: {firmwareVersionMap: {}, keycodesVersionMap: {}},
    // TAPDANCE rows are keycode pickers, which read macro state to render.
    macros: {
      ast: [],
      macroBufferSize: 0,
      macroCount: 0,
      isFeatureSupported: true,
      status: 'idle',
      ownerPath: null,
      ownerConnectionGeneration: null,
      ownerSelectionGeneration: null,
    },
    menus: {
      customMenuDataMap: overrides.menuData
        ? {[device.path]: overrides.menuData}
        : {},
      commonMenusMap: {},
      showKeyPainter: false,
    },
  };
  return configureStore({reducer: () => state as any});
};

const render = (store: ReturnType<typeof makeStore>, viaMenu: object) =>
  renderToStaticMarkup(
    <Provider store={store}>
      <I18nextProvider i18n={translations}>
        <Pane viaMenu={viaMenu as any} />
      </I18nextProvider>
    </Provider>,
  );

// Only the ERA H7S definitions opt into USB Diagnostics, and the section must not
// exist — let alone probe selector 0x07 — for anything else.
const optIn = (usbDiagnostics: boolean) =>
  setEraAdvancedMetadataForTesting({
    schemaVersion: 2,
    definitions: [
      {
        id: 'custom-menu-test',
        vendorProductId: device.vendorProductId,
        // State Sync verification is a separate gate that would hold the menu in a
        // checking state; this test is about the diagnostics opt-in only.
        stateSync: false,
        usbDiagnostics,
        exactMsFamily: 'h7s',
      },
    ],
  });

const pollingSubmenu = {
  label: 'USB POLLING',
  _id: '-0',
  content: [
    {
      label: 'Boot Polling Mode',
      type: 'dropdown',
      _id: '-0-0',
      content: ['id_qmk_usb_bootmode', 13, 1],
      options: [
        ['8 kHz (HS)', 0],
        ['1 kHz (FS)', 3],
      ],
    },
    {
      label: 'Apply Selected Mode',
      type: 'toggle',
      _id: '-0-1',
      content: ['id_qmk_usb_bootmode_apply', 13, 2],
    },
  ],
};

const bootSubmenu = {
  label: 'BOOT',
  _id: '-0',
  content: [
    {
      label: 'Jump To BOOT',
      type: 'toggle',
      _id: '-0-0',
      content: ['id_qmk_system_dfu', 9, 1],
    },
  ],
};

const menuData = {
  id_qmk_usb_bootmode: [0],
  id_qmk_usb_bootmode_apply: [0],
  id_qmk_system_dfu: [0],
  id_qmk_tapdance_1_term_exact: [0, 200],
};

// The diagnostics section resolves the selected device's KeyboardAPI while it
// decides whether to render, and that constructor reads the WebHID cache.
registerHIDDeviceForTesting(device.path, {
  vendorId: device.vendorId,
  productId: device.productId,
  productName: device.productName,
  opened: false,
  open: async () => undefined,
  close: async () => undefined,
  sendReport: async () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
} as unknown as HIDDevice);

afterAll(() => {
  setEraAdvancedMetadataForTesting(null);
  resetHIDTransportForTesting();
});

describe('Custom menu pane loading failure', () => {
  test('renders an actionable message instead of an empty pane', () => {
    const html = render(makeStore(), {label: 'FEATURES', content: []});

    expect(html).toContain('role="status"');
    expect(html).toContain(loadFailureMessage);
  });
});

const tapdanceSubmenu = {
  label: 'TD0',
  _id: '-0',
  content: [
    {
      label: 'Term (ms)',
      type: 'range',
      _id: '-0-0',
      content: ['id_qmk_tapdance_1_term_exact', 10, 5],
      options: [1, 65535],
    },
  ],
};

describe('ERA feature help', () => {
  // The help is keyed off the ERA firmware's own command ids, so a keyboard whose
  // menu happens to share a label never picks up text about a different feature.
  test('explains an ERA feature menu above its controls', () => {
    optIn(true);
    const html = render(makeStore({era: true, menuData}), {
      label: 'TAPDANCE',
      content: [tapdanceSubmenu],
    });

    expect(html).toContain('One key, four actions');
    expect(html).toContain('Term (ms)');
    expect(html.indexOf('One key, four actions')).toBeLessThan(
      html.indexOf('Term (ms)'),
    );
    // The long half is shipped but folded away.
    expect(html).toContain('KEYMAP → CUSTOM');
    expect(html).toContain('hidden=""');
  });

  test('explains the polling menu it shares with the diagnostics block', () => {
    optIn(true);
    const html = render(makeStore({era: true, menuData}), {
      label: 'SYSTEM',
      content: [pollingSubmenu],
    });

    expect(html).toContain('How often the keyboard reports to the PC');
  });

  test('says nothing about a menu that is not an ERA feature', () => {
    optIn(true);
    const html = render(makeStore({era: true, menuData}), {
      label: 'SYSTEM',
      content: [bootSubmenu],
    });

    expect(html).toContain('Jump To BOOT');
    expect(html).toContain('bootloader mode');
  });
});

describe('USB diagnostics placement', () => {
  test('renders the diagnostics block under the polling-mode controls', () => {
    optIn(true);
    const html = render(makeStore({era: true, menuData}), {
      label: 'SYSTEM',
      content: [pollingSubmenu],
    });

    expect(html).toContain('Apply Selected Mode');
    expect(html).toContain('USB Polling Diagnostics');
    // The measurement follows the control it explains, so it comes after it.
    expect(html.indexOf('USB Polling Diagnostics')).toBeGreaterThan(
      html.indexOf('Apply Selected Mode'),
    );
  });

  test('omits the block from submenus without a polling-mode control', () => {
    optIn(true);
    const html = render(makeStore({era: true, menuData}), {
      label: 'SYSTEM',
      content: [bootSubmenu],
    });

    expect(html).toContain('Jump To BOOT');
    expect(html).not.toContain('USB Polling Diagnostics');
  });

  test('omits the block for a definition that does not opt in', () => {
    optIn(false);
    const html = render(makeStore({era: true, menuData}), {
      label: 'SYSTEM',
      content: [pollingSubmenu],
    });

    expect(html).toContain('Apply Selected Mode');
    expect(html).not.toContain('USB Polling Diagnostics');
  });

  test('omits the block for an official or uploaded definition', () => {
    // shouldProbeUsbDiagnostics also requires the bundled ERA source, so a keyboard
    // resolved from the official snapshot never reaches the selector probe.
    optIn(true);
    const html = render(makeStore({menuData}), {
      label: 'SYSTEM',
      content: [pollingSubmenu],
    });

    expect(html).toContain('Apply Selected Mode');
    expect(html).not.toContain('USB Polling Diagnostics');
  });
});
