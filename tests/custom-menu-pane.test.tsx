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
  id_qmk_debounce_mode: [0],
  id_qmk_debounce_time_single: [5],
  id_qmk_debounce_time_pre: [5],
  id_qmk_debounce_time_post: [5],
  id_qmk_tapping_global_term_exact: [0, 200],
  id_qmk_tapping_permissive_hold: [0],
  id_qmk_mousekey_cursor_acceleration: [20],
};

// The ms rows a DEBOUNCE mode shows are not the ones another mode shows, and Fast and
// Advanced spend the same command id on rows that mean different things, so the
// fixtures carry the real labels and the real showIf expressions from the definitions.
const msOptions = [
  ['1 ms', 1],
  ['5 ms', 5],
];

const debounceSubmenu = {
  label: 'DEBOUNCE',
  _id: '-0',
  content: [
    {
      label: 'Debounce Mode',
      type: 'dropdown',
      _id: '-0-0',
      content: ['id_qmk_debounce_mode', 14, 1],
      options: [
        ['Balanced', 0],
        ['Fast', 1],
        ['Advanced', 2],
      ],
    },
    {
      showIf: '{id_qmk_debounce_mode} == 0',
      label: 'Press & Release - delay before and after (same value)',
      type: 'dropdown',
      _id: '-0-1',
      content: ['id_qmk_debounce_time_single', 14, 2],
      options: msOptions,
    },
    {
      showIf: '{id_qmk_debounce_mode} == 1',
      label: 'Press & Release - delay after change (post-only)',
      type: 'dropdown',
      _id: '-0-2',
      content: ['id_qmk_debounce_time_post', 14, 4],
      options: msOptions,
    },
    {
      showIf: '{id_qmk_debounce_mode} == 2',
      label: 'Release - delay before and after release (pre+post window)',
      type: 'dropdown',
      _id: '-0-3',
      content: ['id_qmk_debounce_time_post', 14, 4],
      options: msOptions,
    },
  ],
};

const withDebounceMode = (mode: number) => ({
  ...menuData,
  id_qmk_debounce_mode: [mode],
});

const tappingSubmenu = {
  label: 'TAPPING',
  _id: '-0',
  content: [
    {
      label: 'Global Tapping Term (ms)',
      type: 'range',
      _id: '-0-0',
      content: ['id_qmk_tapping_global_term_exact', 15, 5],
      options: [100, 500],
    },
    {
      label: 'Permissive Hold',
      type: 'toggle',
      _id: '-0-1',
      content: ['id_qmk_tapping_permissive_hold', 15, 2],
    },
  ],
};

const mouseSubmenu = {
  label: 'MOUSE',
  _id: '-0',
  content: [
    {
      label: 'Cursor Acceleration',
      type: 'dropdown',
      _id: '-0-0',
      content: ['id_qmk_mousekey_cursor_acceleration', 17, 3],
      options: [
        ['Off (constant speed)', 0],
        ['1.0 s', 20],
      ],
    },
  ],
};

// A collapsed disclosure keeps its text in the page, so "shipped" and "on the screen"
// are different questions. This strips the collapsed bodies to ask the second one.
const visibleText = (html: string) =>
  html.replace(/<p[^>]*hidden=""[^>]*>.*?<\/p>/gs, '');

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

    expect(html).toContain('Four actions on one key');
    expect(html).toContain('Term (ms)');
    expect(html.indexOf('Four actions on one key')).toBeLessThan(
      html.indexOf('Term (ms)'),
    );
    // The long half is shipped but folded away.
    expect(html).toContain('KEYMAP → TAPDANCE');
    expect(html).toContain('hidden=""');
  });

  test('explains the polling menu it shares with the diagnostics block', () => {
    optIn(true);
    const html = render(makeStore({era: true, menuData}), {
      label: 'SYSTEM',
      content: [pollingSubmenu],
    });

    expect(html).toContain('Sets the USB polling rate');
  });

  test('says nothing about a menu that is not an ERA feature', () => {
    optIn(true);
    const html = render(makeStore({era: true, menuData}), {
      label: 'SYSTEM',
      content: [bootSubmenu],
    });

    expect(html).toContain('Jump To BOOT');
    expect(html).toContain('Enters the bootloader');
  });

  test('explains the MOUSE menu the H7S definitions now carry', () => {
    optIn(true);
    const html = render(makeStore({era: true, menuData}), {
      label: 'FEATURE',
      content: [mouseSubmenu],
    });

    expect(html).toContain('Speed of the mouse keys on the keymap');
    expect(html).toContain('Cursor Acceleration');
  });
});

// Per-control help exists because a submenu's one paragraph cannot answer for a row
// whose meaning depends on another value in the same menu, and because the reader is
// looking at that row, not at the top of the page.
describe('ERA per-control help', () => {
  test('puts a disclosure on the control whose choices are proper nouns', () => {
    optIn(true);
    const html = render(makeStore({era: true, menuData: withDebounceMode(0)}), {
      label: 'FEATURE',
      content: [debounceSubmenu],
    });

    expect(html).toContain('Debounce Mode');
    expect(html).toContain('Start with Balanced');
    // Shipped with the row, folded away until asked for.
    expect(visibleText(html)).not.toContain('Start with Balanced');
    // Label, then the button beside it, then the body on the line under both. Put the
    // body before the control and the wrapping row pushes the control onto a third
    // line, which is what the ordering here is guarding.
    expect(html.indexOf('>Debounce Mode<')).toBeLessThan(
      html.indexOf('What this means: Debounce Mode'),
    );
    expect(html.indexOf('What this means: Debounce Mode')).toBeLessThan(
      html.indexOf('Start with Balanced'),
    );
  });

  test('reads the same command id differently on either side of the mode', () => {
    optIn(true);
    const fast = render(makeStore({era: true, menuData: withDebounceMode(1)}), {
      label: 'FEATURE',
      content: [debounceSubmenu],
    });
    const advanced = render(
      makeStore({era: true, menuData: withDebounceMode(2)}),
      {label: 'FEATURE', content: [debounceSubmenu]},
    );

    // Both rows are id_qmk_debounce_time_post; only the label tells them apart.
    expect(fast).toContain('The change is sent immediately');
    expect(fast).not.toContain('The release side.');
    expect(advanced).toContain('The release side.');
    expect(advanced).not.toContain('The change is sent immediately');
  });

  test('leaves alone the control the submenu summary is already about', () => {
    optIn(true);
    const html = render(makeStore({era: true, menuData}), {
      label: 'FEATURE',
      content: [tappingSubmenu],
    });

    // The three switches each need their own answer; the term does not, because the
    // line above the controls is already about it.
    expect(html).toContain('Permissive Hold');
    expect(html).toContain('For holds that do not take when you type fast');
    expect(html).toContain('Global Tapping Term (ms)');
    expect(html).not.toContain('What this means: Global Tapping Term (ms)');
  });

  test('never reaches a keyboard that is not running ERA firmware', () => {
    optIn(true);
    const html = render(makeStore({menuData: {id_generic_mode: [0]}}), {
      label: 'FEATURE',
      content: [
        {
          label: 'Debounce Mode',
          _id: '-0',
          content: [
            {
              label: 'Debounce Mode',
              type: 'dropdown',
              _id: '-0-0',
              content: ['id_generic_mode', 14, 1],
              options: [
                ['Balanced', 0],
                ['Fast', 1],
              ],
            },
          ],
        },
      ],
    });

    expect(html).toContain('Debounce Mode');
    expect(html).not.toContain('Start with Balanced');
    expect(html).not.toContain('What this means');
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
