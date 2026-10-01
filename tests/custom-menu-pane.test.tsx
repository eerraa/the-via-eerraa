import {configureStore} from '@reduxjs/toolkit';
import {afterAll, describe, expect, test} from 'bun:test';
import i18n from 'i18next';
import {Provider} from 'react-redux';
import {I18nextProvider} from 'react-i18next';
import {renderToStaticMarkup} from 'react-dom/server';
import {ServerStyleSheet} from 'styled-components';
import {setEraAdvancedMetadataForTesting} from '../src/utils/era-advanced-metadata';
import {
  registerHIDDeviceForTesting,
  resetHIDTransportForTesting,
} from '../src/shims/node-hid';
import {
  decodeEraFirmwareVersion,
  ERA_FIRMWARE_VERSION_COMMAND,
  formatEraFirmwareVersion,
} from '../src/utils/era-firmware-version';
import {THEMES} from '../src/utils/themes';
import type {DomainReadFailure} from '../src/store/stateSyncSlice';
import {contrast, paint, themedPages} from './theme-colors';
import enCatalog from '../src/locales/en.json';

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
const {Pane, makeCustomMenu} = await loadPane();
const {Pane: LayoutsPane} = await import('../src/components/panes/configure-panes/layouts');
const {Pane: SaveLoadPane} = await import('../src/components/panes/configure-panes/save-load');
const {Explain} = await import('../src/components/inputs/explain');
const {AccentSlider} = await import('../src/components/inputs/accent-slider');
const {IntegerInput} = await import('../src/components/inputs/integer-input');

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

type ConfigSyncOverride = {
  status: 'dirty' | 'refreshing' | 'fresh';
  observedRevision?: number;
  acceptedRevision?: number;
  foregroundWriteDepth?: number;
  failedRead?: DomainReadFailure;
};

const makeStore = (
  overrides: {
    era?: boolean;
    menuData?: object;
    configSync?: ConfigSyncOverride;
    definition?: object;
  } = {},
) => {
  const definitionEntry = {
    [device.vendorProductId]: {v3: overrides.definition ?? {}},
  };
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
      selectedConnectionLocked: false,
    },
    firmware: {firmwareVersionMap: {}, keycodesVersionMap: {}},
    keymap: {numberOfLayersMap: {[device.path]: 4}},
    // Range rows draw in the saved slider mode.
    settings: {ShowSliderValuesMode: 'Slider Only'},
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
    drafts: {},
    applying: {writing: {}, stops: {}},
    configurePlace: {},
    definitionName: {selectedOptionMap: {}},
    ...(overrides.configSync && {
      stateSync: {
        byPath: {
          [device.path]: {
            capability: 'capable',
            generation: 0,
            config: {
              status: overrides.configSync.status,
              observedRevision:
                overrides.configSync.observedRevision ?? 2,
              acceptedRevision:
                overrides.configSync.acceptedRevision ?? 1,
              mutationEpoch: 0,
              foregroundWriteDepth:
                overrides.configSync.foregroundWriteDepth ?? 0,
              acceptedSelectionGeneration: 1,
              acceptedDefinitionIdentity: `${device.vendorProductId}:v3:0`,
              failedRead: overrides.configSync.failedRead ?? null,
            },
          },
        },
        configureVisible: true,
        documentHidden: false,
      },
    }),
  };
  return configureStore({reducer: () => state as any});
};

const render = (
  store: ReturnType<typeof makeStore>,
  viaMenu: object,
  i18nInstance = translations,
) =>
  renderToStaticMarkup(
    <Provider store={store}>
      <I18nextProvider i18n={i18nInstance}>
        <Pane viaMenu={viaMenu as any} />
      </I18nextProvider>
    </Provider>,
  );

// Only the ERA H7S definitions opt into USB Diagnostics, and the section must not
// exist — let alone probe selector 0x07 — for anything else.
const optIn = (usbDiagnostics: boolean, stateSync = false) =>
  setEraAdvancedMetadataForTesting({
    schemaVersion: 2,
    definitions: [
      {
        id: 'custom-menu-test',
        vendorProductId: device.vendorProductId,
        stateSync,
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

const eraVersionSubmenu = {
  label: 'VERSION',
  _id: '-0',
  content: [
    {
      label: 'Current Version',
      type: 'label',
      _id: '-0-0',
      content: [ERA_FIRMWARE_VERSION_COMMAND, 8, 1],
    },
  ],
};

const h7sVersionSubmenu = {
  label: 'VERSION',
  _id: '-0',
  content: [
    {
      label: 'Current Version',
      type: 'label',
      _id: '-0-0',
      content: [ERA_FIRMWARE_VERSION_COMMAND, 8, 5],
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
  id_qmk_kkuk_enable: [1],
  id_qmk_kkuk_repeat_time: [8],
  id_qmk_kkuk_delay_time: [20],
  id_qmk_tapping_global_term_exact: [0, 200],
  id_qmk_tapping_permissive_hold: [0],
  id_qmk_mousekey_cursor_acceleration: [20],
  id_qmk_rgb_matrix_effect: [1],
  id_qmk_rgb_matrix_brightness: [128],
  id_qmk_rgblight_effect: [1],
  id_qmk_rgblight_brightness: [128],
  id_qmk_velocikey_toggle: [1],
  id_custom_backlight_brightness: [5],
  id_custom_badge_only: [1],
  id_custom_indicator_toggle: [1],
  id_custom_indicator_override: [0],
  id_qmk_rgb_sleep_enable: [1],
  id_qmk_rgb_sleep_timeout_exact: [0x02, 0x58],
  id_qmk_rgb_sleep_timeout: [10],
  id_qmk_backlight_sleep_enable: [1],
  id_qmk_backlight_sleep_timeout_exact: [0x01, 0x2c],
  id_qmk_split_link_level: [0],
  id_qmk_split_link_apply: [0],
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
      label: 'Press & Release Delay',
      type: 'dropdown',
      _id: '-0-1',
      content: ['id_qmk_debounce_time_single', 14, 2],
      options: msOptions,
    },
    {
      showIf: '{id_qmk_debounce_mode} == 1',
      label: 'Press & Release Cooldown',
      type: 'dropdown',
      _id: '-0-2',
      content: ['id_qmk_debounce_time_post', 14, 4],
      options: msOptions,
    },
    {
      showIf: '{id_qmk_debounce_mode} == 2',
      label: 'Release Delay',
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

const kkukSubmenu = {
  label: 'KKUK',
  _id: '-0',
  content: [
    {
      label: 'Enable',
      type: 'toggle',
      _id: '-0-0',
      content: ['id_qmk_kkuk_enable', 12, 1],
    },
    {
      label: 'First Delay Time',
      type: 'dropdown',
      _id: '-0-1',
      content: ['id_qmk_kkuk_delay_time', 12, 2],
      options: [['200 ms', 20]],
    },
    {
      label: 'Repeat Time',
      type: 'dropdown',
      _id: '-0-2',
      content: ['id_qmk_kkuk_repeat_time', 12, 3],
      options: [['80 ms', 8]],
    },
  ],
};

const rgbMatrixSubmenu = {
  label: 'Per-Key RGB',
  _id: '-0',
  content: [
    {
      label: 'Brightness',
      type: 'dropdown',
      _id: '-0-0',
      content: ['id_qmk_rgb_matrix_brightness', 3, 1],
      options: [['128', 128]],
    },
    {
      label: 'Effect',
      type: 'dropdown',
      _id: '-0-1',
      content: ['id_qmk_rgb_matrix_effect', 3, 2],
      options: [['Solid Color', 1]],
    },
  ],
};

const rgbLightSubmenu = {
  label: 'RGB Row',
  _id: '-0',
  content: [
    {
      label: 'Brightness',
      type: 'dropdown',
      _id: '-0-0',
      content: ['id_qmk_rgblight_brightness', 2, 1],
      options: [['128', 128]],
    },
    {
      label: 'Effect',
      type: 'dropdown',
      _id: '-0-1',
      content: ['id_qmk_rgblight_effect', 2, 2],
      options: [['Solid Color', 1]],
    },
    {
      label: 'Velocikey',
      type: 'toggle',
      _id: '-0-2',
      content: ['id_qmk_velocikey_toggle', 2, 5],
    },
  ],
};

const backlightSubmenu = {
  label: 'Backlight',
  _id: '-0',
  content: [
    {
      label: 'Backlight Brightness',
      type: 'dropdown',
      _id: '-0-0',
      content: ['id_custom_backlight_brightness', 0, 0],
      options: [['5', 5]],
    },
  ],
};

const badgeSubmenu = {
  label: 'Badge',
  _id: '-0',
  content: [
    {
      label: 'RGB-Only',
      type: 'toggle',
      _id: '-0-0',
      content: ['id_custom_badge_only', 0, 4],
    },
    {
      label: 'Indicator',
      type: 'dropdown',
      _id: '-0-1',
      content: ['id_custom_indicator_toggle', 0, 0],
      options: [
        ['RGB Effect', 0],
        ['Caps Lock', 1],
      ],
    },
    {
      label: 'Indicator-Only',
      type: 'toggle',
      _id: '-0-2',
      content: ['id_custom_indicator_override', 0, 1],
    },
  ],
};

const sleepSubmenu = {
  label: 'SLEEP',
  _id: '-0',
  content: [
    {
      label: 'RGB Sleep',
      type: 'toggle',
      _id: '-0-0',
      content: ['id_qmk_rgb_sleep_enable', 9, 12],
    },
    {
      label: 'RGB Sleep Timeout (s)',
      type: 'range',
      _id: '-0-1',
      showIf: '{id_qmk_rgb_sleep_enable} == 1',
      content: ['id_qmk_rgb_sleep_timeout_exact', 9, 11],
      options: [1, 65535],
    },
    {
      label: 'Backlight Sleep',
      type: 'toggle',
      _id: '-0-2',
      content: ['id_qmk_backlight_sleep_enable', 9, 13],
    },
    {
      label: 'Backlight Sleep Timeout (s)',
      type: 'range',
      _id: '-0-3',
      showIf: '{id_qmk_backlight_sleep_enable} == 1',
      content: ['id_qmk_backlight_sleep_timeout_exact', 9, 15],
      options: [1, 65535],
    },
  ],
};

const h7sSleepSubmenu = {
  label: 'SLEEP',
  _id: '-0',
  content: [
    {
      label: 'RGB Sleep',
      type: 'toggle',
      _id: '-0-0',
      content: ['id_qmk_rgb_sleep_enable', 18, 3],
    },
    {
      label: 'RGB Sleep Timeout (s)',
      type: 'range',
      _id: '-0-1',
      showIf: '{id_qmk_rgb_sleep_enable} == 1',
      content: ['id_qmk_rgb_sleep_timeout_exact', 18, 2],
      options: [1, 65535],
    },
  ],
};

const linkSubmenu = {
  label: 'LINK',
  _id: '-0',
  content: [
    {
      label: 'Split Link Speed',
      type: 'dropdown',
      _id: '-0-0',
      content: ['id_qmk_split_link_level', 9, 8],
      options: [
        ['High', 0],
        ['Medium', 1],
        ['Low', 2],
      ],
    },
    {
      label: 'Apply',
      type: 'toggle',
      _id: '-0-1',
      content: ['id_qmk_split_link_apply', 9, 9],
    },
  ],
};

// A collapsed disclosure keeps its text in the page, so "shipped" and "on the screen"
// are different questions. This strips the collapsed bodies to ask the second one.
// Folded help stays in the DOM; this drops it to leave what the screen shows.
const visibleText = (html: string) =>
  html.replace(/<(p|div)[^>]*hidden=""[^>]*>.*?<\/\1>/gs, '');

// The words on the screen in reading order, one space apart, so a test can say what
// comes first under the tabs.
const screenText = (html: string) =>
  visibleText(html)
    .replace(/<style[^>]*>.*?<\/style>/gs, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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

describe('read-only ERA firmware version', () => {
  const ascii = (value: string, tail: unknown[] = [0]) => [
    ...new TextEncoder().encode(value),
    ...tail,
  ];

  test('decodes the shared live GET format and rejects malformed values', () => {
    expect(decodeEraFirmwareVersion(ascii('260901R1', [0, 0, 0]))).toBe(
      '260901R1',
    );
    expect(decodeEraFirmwareVersion(ascii('260901R1', [0, 0xa5, 1]))).toBe(
      '260901R1',
    );
    expect(decodeEraFirmwareVersion(ascii('260901R1', [0, 'ignored']))).toBe(
      '260901R1',
    );
    expect(decodeEraFirmwareVersion(ascii('260901R1', []))).toBeNull();
    expect(decodeEraFirmwareVersion(ascii('261301R1'))).toBeNull();
    expect(decodeEraFirmwareVersion([0x32, 0x80, 0])).toBeNull();
    expect(decodeEraFirmwareVersion('260901R1')).toBeNull();
  });

  test('shows the diagnostics build string with the same token as VERSION', () => {
    expect(formatEraFirmwareVersion('V260928R1')).toBe('260928R1');
    expect(formatEraFirmwareVersion('260928R1')).toBe('260928R1');
    // Outside the grammar nothing is guessed: the raw observation stays visible.
    expect(formatEraFirmwareVersion('V261328R1')).toBe('V261328R1');
    expect(formatEraFirmwareVersion('Vdev')).toBe('Vdev');
  });

  test('renders both firmware definitions through one visible, non-editable presentation', () => {
    optIn(false);
    const era = render(
      makeStore({
        era: true,
        menuData: {
          [ERA_FIRMWARE_VERSION_COMMAND]: ascii('260901R1', [0, 0xa5]),
        },
      }),
      {label: 'SYSTEM', content: [eraVersionSubmenu]},
    );
    const h7s = render(
      makeStore({
        era: true,
        menuData: {
          [ERA_FIRMWARE_VERSION_COMMAND]: ascii('260901R1', [0, 0xa5]),
        },
      }),
      {label: 'SYSTEM', content: [h7sVersionSubmenu]},
    );

    for (const html of [era, h7s]) {
      expect((html.match(/260901R1/g) ?? []).length).toBe(1);
      expect(html).toContain('data-era-firmware-version="true"');
      // The version row is the first thing under the tab: no line above it saying
      // that it shows the version.
      expect(screenText(html)).toMatch(/^VERSION Current Version 260901R1/);
      expect(html).not.toContain('<input');
      expect(html).not.toContain('role="combobox"');
      // The submenu tabs are navigation and there is no help to disclose, so there is
      // no other button.
      const buttons = html.match(/<button[^>]*>/g) ?? [];
      expect(buttons.filter((tag) => !tag.includes('aria-pressed'))).toHaveLength(0);
      expect(html).not.toContain('aria-label="What this means"');
      expect(html).not.toContain('>Save<');
      expect(html).not.toContain('>Apply<');
    }
    expect(h7s).not.toContain('>Year<');
    expect(h7s).not.toContain('>Month<');
    expect(h7s).not.toContain('>Day<');
    expect(h7s).not.toContain('>Rev.<');
  });

  // Submenus are tabs across the top, like KEYMAP's categories, not VIA's list
  // on the left: one pressed tab per submenu, the first one showing.
  test('shows its submenus as tabs over the content, the first one selected', () => {
    optIn(false);
    const html = render(
      makeStore({
        era: true,
        menuData: {
          [ERA_FIRMWARE_VERSION_COMMAND]: ascii('260901R1', [0, 0xa5]),
        },
      }),
      {
        label: 'SYSTEM',
        content: [eraVersionSubmenu, {...h7sVersionSubmenu, label: 'ABOUT', _id: '-1'}],
      },
    );
    const tabs = (html.match(/<button[^>]*aria-pressed="(true|false)"[^>]*>/g) ?? []);
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toContain('aria-pressed="true"');
    expect(tabs[1]).toContain('aria-pressed="false"');
    expect(html.indexOf(tabs[0])).toBeLessThan(html.indexOf('data-era-firmware-version'));
  });

  // LAYOUTS and Save + Load have no submenus, yet start their rows under the same
  // tab row, named as the rail names them, so no pane's first row jumps up.
  test('gives LAYOUTS and Save + Load their one tab over the content', () => {
    const store = makeStore({
      era: true,
      definition: {
        name: 'Tab test',
        layouts: {keys: [], labels: ['Split Backspace'], optionKeys: {}, width: 1, height: 1},
      },
    });
    const english = i18n.createInstance();
    english.init({lng: 'en', initImmediate: false, resources: {en: {translation: enCatalog}}});
    for (const [Panel, name, firstRow] of [
      [LayoutsPane, 'Layout Options', 'Split Backspace'],
      [SaveLoadPane, 'Save + Load', 'Save Current Layout'],
    ] as const) {
      const html = renderToStaticMarkup(
        <Provider store={store}>
          <I18nextProvider i18n={english}>
            <Panel />
          </I18nextProvider>
        </Provider>,
      );
      const tabs = html.match(/<button[^>]*aria-pressed="(true|false)"[^>]*>[^<]*/g) ?? [];
      expect(tabs).toHaveLength(1);
      expect(tabs[0]).toContain('aria-pressed="true"');
      expect(tabs[0].endsWith(`>${name}`)).toBe(true);
      expect(html).toContain('role="group"');
      expect(html.indexOf('role="group"')).toBeLessThan(html.indexOf(firstRow));
      expect(html.indexOf(tabs[0])).toBeLessThan(html.indexOf(firstRow));
    }
  });

  // Every pane centres its tabs in the setting column, as KEYMAP centres its
  // categories, and so does a second row of tabs that wraps.
  test('centres its tabs in the setting column', () => {
    optIn(false);
    const sheet = new ServerStyleSheet();
    let html = '';
    let css = '';
    try {
      html = renderToStaticMarkup(
        sheet.collectStyles(
          <Provider
            store={makeStore({
              era: true,
              menuData: {[ERA_FIRMWARE_VERSION_COMMAND]: ascii('260901R1', [0])},
            })}
          >
            <I18nextProvider i18n={translations}>
              <Pane viaMenu={{label: 'SYSTEM', content: [eraVersionSubmenu]} as any} />
            </I18nextProvider>
          </Provider>,
        ),
      );
      css = sheet.getStyleTags();
    } finally {
      sheet.seal();
    }
    const [, column] = /<div class="([^"]+)"><div role="group" /.exec(html) ?? [];
    expect(column).toBeDefined();
    const centred = column
      .split(' ')
      .some((name) =>
        new RegExp(`\\.${name} ?> ?\\*\\{(?:[^}]*;)?justify-content:center;`).test(css),
      );
    expect(centred).toBe(true);
  });
});

describe('Custom menu pane loading failure', () => {
  test('renders an actionable message instead of an empty pane', () => {
    const html = render(makeStore(), {label: 'FEATURES', content: []});

    expect(html).toContain('role="status"');
    expect(html).toContain(loadFailureMessage);
  });
});

describe('State Sync menu continuity', () => {
  test('keeps the accepted controls mounted while external state reconciles', () => {
    optIn(false, true);
    const html = render(
      makeStore({
        era: true,
        menuData,
        configSync: {status: 'dirty'},
      }),
      {label: 'SYSTEM', content: [bootSubmenu]},
    );

    expect(html).toContain('Jump To BOOT');
    expect(html).not.toContain('Loading...');
  });

  test('still uses the loading boundary before the first accepted snapshot', () => {
    optIn(false, true);
    const html = render(makeStore({era: true, menuData}), {
      label: 'SYSTEM',
      content: [bootSubmenu],
    });

    expect(html).toContain('Loading...');
    expect(html).not.toContain('Jump To BOOT');
  });

  // Firmware that answers a CONFIG value as unhandled gives the same answer on
  // every read of that revision, so the menu is not left loading.
  test('shows the load failure once the keyboard has refused the current CONFIG read', () => {
    optIn(false, true);
    const failedRead = {
      revision: 2,
      mutationEpoch: 0,
      selectionGeneration: 1,
      definitionIdentity: `${device.vendorProductId}:v3:0`,
    };
    for (const acceptedRevision of [0, 1]) {
      const html = render(
        makeStore({
          era: true,
          menuData,
          configSync: {status: 'dirty', acceptedRevision, failedRead},
        }),
        {label: 'SYSTEM', content: [bootSubmenu]},
      );

      expect(html).toContain(loadFailureMessage);
      expect(html).not.toContain('Loading...');
      expect(html).not.toContain('Jump To BOOT');
    }
    // A refusal of an older revision is not the current answer.
    const html = render(
      makeStore({
        era: true,
        menuData,
        configSync: {
          status: 'dirty',
          acceptedRevision: 0,
          failedRead: {...failedRead, revision: 1},
        },
      }),
      {label: 'SYSTEM', content: [bootSubmenu]},
    );
    expect(html).toContain('Loading...');
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

    expect(html).toContain('Puts four actions on one key');
    expect(html).toContain('>Term</label>');
    expect(html.indexOf('Puts four actions on one key')).toBeLessThan(
      html.indexOf('>Term</label>'),
    );
    // The long half is shipped but folded away.
    expect(html).toContain('Takes effect once its TD key is on the keymap.');
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
    expect(html).toContain('Restarts the keyboard into the bootloader.');
    expect(html).not.toContain('The switch always reads back off.');
  });

  test('explains the MOUSE menu the H7S definitions now carry', () => {
    optIn(true);
    const html = render(makeStore({era: true, menuData}), {
      label: 'FEATURE',
      content: [mouseSubmenu],
    });

    expect(html).toContain('Sets how fast mouse keys move the pointer and wheel');
    expect(html).toContain('Cursor Acceleration');
  });

  // A lighting page's rows name what it sets, so a line above them saying so again
  // is a band of height for nothing.
  test('puts no line above the lighting rows and keeps Velocikey help on its row', () => {
    optIn(true);
    const matrix = render(makeStore({era: true, menuData}), {
      label: 'Lighting',
      content: [rgbMatrixSubmenu],
    });
    const rgbLight = render(makeStore({era: true, menuData}), {
      label: 'Lighting',
      content: [rgbLightSubmenu],
    });
    const backlight = render(makeStore({era: true, menuData}), {
      label: 'Lighting',
      content: [backlightSubmenu],
    });

    expect(screenText(matrix)).toMatch(/^Per-Key RGB Brightness /);
    expect(matrix).not.toContain('Velocikey');
    expect(matrix).not.toContain('What this means');
    expect(screenText(rgbLight)).toMatch(/^RGB Row Brightness /);
    expect(rgbLight).toContain('What this means: Velocikey');
    expect(rgbLight).toContain(
      'Speeds the lighting effect up and down with typing speed.',
    );
    expect(rgbLight).not.toContain('RGBLight');
    expect(screenText(backlight)).toMatch(/^Backlight Backlight Brightness /);
    expect(backlight).not.toContain('What this means');
  });

  test('moves badge explanations from the heading to the controls', () => {
    optIn(true);
    const html = render(makeStore({era: true, menuData}), {
      label: 'Lighting',
      content: [badgeSubmenu],
    });

    expect(screenText(html)).toMatch(/^Badge RGB-Only /);
    expect(html).toContain('What this means: RGB-Only');
    expect(html).toContain('What this means: Indicator"');
    expect(html).toContain('At RGB Effect the badge keeps the lighting effect.');
    expect(html).toContain('What this means: Indicator-Only');
    expect(html).toContain('Applies RGB effects only to the badge area.');
    expect(html).not.toContain('Badge-Only RGB');
  });

  // Where the indicator LED is part of the lighting the no-lock choice is RGB Effect,
  // where it is an LED of its own it is Off, under the same command id. The row lists
  // what its own dropdown offers, in that order.
  test('explains the lock-indicator choices on the row that picks them', () => {
    optIn(true);
    const locks = ['Caps Lock', 'Scroll Lock', 'Num Lock'];
    for (const [first, text] of [
      ['RGB Effect', 'Follows the lighting effect.'],
      ['Off', 'Stays dark.'],
    ]) {
      const html = render(
        makeStore({era: true, menuData: {id_qmk_custom_ind_1_select: [1]}}),
        {
          label: 'Lighting',
          content: [
            {
              label: 'Indicators',
              _id: '-0',
              content: [
                {
                  label: 'Indicator 1',
                  type: 'dropdown',
                  _id: '-0-0',
                  content: ['id_qmk_custom_ind_1_select', 0, 1],
                  options: [first, ...locks].map((name, idx) => [name, idx]),
                },
              ],
            },
          ],
        },
      );

      expect(screenText(html)).toMatch(/^Indicators Indicator 1 /);
      expect(html).toContain('What this means: Indicator 1');
      expect([...html.matchAll(/<dt[^>]*>([^<]*)/g)].map(([, name]) => name)).toEqual(
        [first, ...locks],
      );
      expect(html).toContain(`<dt>${first}</dt><dd>${text}</dd>`);
      expect(html).toContain(
        '<dt data-current="">Caps Lock</dt><dd>Lights while Caps Lock is on.</dd>',
      );
    }
  });
});

describe('ERA exact-second input', () => {
  test('renders the QMK RGB and backlight sleep timeouts with the same feature-help and deferred-input surface', () => {
    optIn(false, true);
    const html = render(
      makeStore({
        era: true,
        menuData,
        configSync: {
          status: 'fresh',
          observedRevision: 2,
          acceptedRevision: 2,
        },
      }),
      {label: 'SYSTEM', content: [sleepSubmenu]},
    );

    expect(html).toContain('Controls when the lighting turns off by itself.');
    expect(html).toContain('Lock indicators lit by the backlight go out with it.');
    // A switch's shipped state is not something the reader needs to set it.
    expect(html).not.toMatch(/>Default<\/span>/);
    expect(html).toContain('hidden=""');
    expect(html).toContain('RGB Sleep');
    expect(html).toContain('>RGB Sleep Timeout</label>');
    expect(html).toContain('value="600"');
    expect(html).toContain('>Backlight Sleep Timeout</label>');
    expect(html).toContain('value="300"');
    expect(html).toContain('>s</span>');
    expect(html).not.toContain('type="range"');
  });

  test('renders the H7S exact-second sleep field through the shared deferred-input surface', () => {
    optIn(false, true);
    const html = render(
      makeStore({
        era: true,
        menuData,
        configSync: {
          status: 'fresh',
          observedRevision: 2,
          acceptedRevision: 2,
        },
      }),
      {label: 'SYSTEM', content: [h7sSleepSubmenu]},
    );

    expect(html).toContain('Controls when the lighting turns off by itself.');
    // No backlight switch on this page, so nothing about what the backlight lights.
    expect(html).not.toContain('Lock indicators lit by the backlight');
    // A switch's shipped state is not something the reader needs to set it.
    expect(html).not.toMatch(/>Default<\/span>/);
    expect(html).toContain('hidden=""');
    expect(html).toContain('RGB Sleep');
    expect(html).toContain('>RGB Sleep Timeout</label>');
    expect(html).toContain('value="600"');
    expect(html).toContain('>s</span>');
  });

  test('keeps the RGB Sleep toggle visible and hides both timeout surfaces while it is off', () => {
    optIn(false, true);
    const disabledMenuData = {...menuData, id_qmk_rgb_sleep_enable: [0]};
    for (const submenu of [sleepSubmenu, h7sSleepSubmenu]) {
      const html = render(
        makeStore({
          era: true,
          menuData: disabledMenuData,
          configSync: {
            status: 'fresh',
            observedRevision: 2,
            acceptedRevision: 2,
          },
        }),
        {label: 'SYSTEM', content: [submenu]},
      );

      expect(html).toContain('RGB Sleep');
      expect(html).not.toContain('RGB Sleep Timeout');
      expect(html).not.toContain('value="600"');
    }
  });

  test('switches the backlight timeout on its own switch, independent of RGB', () => {
    optIn(false, true);
    const html = render(
      makeStore({
        era: true,
        menuData: {...menuData, id_qmk_backlight_sleep_enable: [0]},
        configSync: {
          status: 'fresh',
          observedRevision: 2,
          acceptedRevision: 2,
        },
      }),
      {label: 'SYSTEM', content: [sleepSubmenu]},
    );

    expect(html).toContain('>RGB Sleep Timeout</label>');
    expect(html).toContain('value="600"');
    expect(html).toContain('Backlight Sleep');
    expect(html).not.toContain('Backlight Sleep Timeout');
    expect(html).not.toContain('value="300"');
  });
});

// Official VIA draws no unit beside a number, so a definition ends such a row's name
// with it. The app's field draws the unit after the number instead.
describe('row names for assistive technology', () => {
  test('toggle, range, dropdown and keycode controls reference their visible row labels', async () => {
    optIn(false);
    const items = [
      {label: 'Enabled', type: 'toggle', content: ['id_test_toggle', 1, 1]},
      {label: 'Brightness', type: 'range', content: ['id_test_range', 1, 2], options: [0, 255]},
      {label: 'Effect', type: 'dropdown', content: ['id_test_select', 1, 3], options: [['Solid', 0], ['Breathing', 1]]},
      {label: 'Clockwise', type: 'keycode', content: ['id_test_key', 1, 4]},
    ];
    const menu = {label: 'Settings', content: [{label: 'Controls', _id: '-0', content: items.map((item, index) => ({...item, _id: `-0-${index}`}))}]};
    const {keyboardDefinitionV3ToVIADefinitionV3} = await import('@the-via/reader');
    const definition = keyboardDefinitionV3ToVIADefinitionV3({
      name: 'Accessible controls', vendorId: '0x1234', productId: '0x5678',
      matrix: {rows: 1, cols: 1}, layouts: {keymap: [['0,0']]}, menus: [{label: 'Settings', content: [{label: 'Controls', content: items}]}],
    } as any);
    const html = render(makeStore({definition, menuData: {
      id_test_toggle: [1], id_test_range: [128], id_test_select: [0], id_test_key: [0, 4],
    }}), menu);
    for (const {label} of items) {
      const id = new RegExp(`<label[^>]*id="([^"]+)"[^>]*>${label}<`).exec(html)?.[1];
      expect(id).toBeDefined();
      const named = [...html.matchAll(/<(?:input|button)[^>]*aria-labelledby="([^"]+)"[^>]*>/g)]
        .find((match) => match[1].split(' ').includes(id!));
      expect(named).toBeDefined();
      if (label === 'Clockwise') {
        const ownId = / id="([^"]+)"/.exec(named![0])?.[1];
        expect(named![1].split(' ')).toEqual([id!, ownId!]);
      }
    }
    expect(html).not.toMatch(/aria-label="id_/);
    expect(html).toMatch(/role="group" aria-label="Settings"/);
  });
});

describe('whole-number field units', () => {
  test('say the unit once, after the number, whichever definition the row is from', () => {
    optIn(false);
    const submenu = {
      label: 'UNITS',
      _id: '-0',
      content: [
        {
          label: 'Global Tapping Term (ms)',
          type: 'range',
          _id: '-0-0',
          content: ['id_qmk_tapping_global_term_exact', 15, 5],
          options: [1, 65535],
        },
        {
          label: 'RGB Sleep Timeout (s)',
          type: 'range',
          _id: '-0-1',
          content: ['id_qmk_rgb_sleep_timeout_exact', 9, 11],
          options: [1, 65535],
        },
        // A row whose control draws no unit keeps the one in its name.
        {
          label: 'Repeat Time (ms)',
          type: 'dropdown',
          _id: '-0-2',
          content: ['id_qmk_kkuk_repeat_time', 12, 3],
          options: [['8 ms', 8]],
        },
      ],
    };
    for (const era of [true, false]) {
      const html = render(makeStore({era, menuData}), {
        label: 'FEATURE',
        content: [submenu],
      });
      const names = [...html.matchAll(/<label[^>]*>([^<]*)<\/label>/g)].map(
        ([, name]) => name,
      );
      expect({era, names}).toEqual({
        era,
        names: ['Global Tapping Term', 'RGB Sleep Timeout', 'Repeat Time (ms)'],
      });
      expect({
        era,
        ms: html.match(/>ms<\/span>/g)?.length,
        s: html.match(/>s<\/span>/g)?.length,
      }).toEqual({era, ms: 1, s: 1});
      // A field goes by its row's name, not by the command it writes.
      expect(html).toContain('aria-label="Global Tapping Term"');
      expect(html).toContain('aria-label="RGB Sleep Timeout"');
      expect(html).not.toContain('aria-label="id_qmk');
    }
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
    expect(html).toContain('A change counts once the switch has settled for the set time');
    // Shipped with the row, folded away until asked for.
    expect(visibleText(html)).not.toContain('A change counts once the switch has settled for the set time');
    // Label, then the button beside it, then the body on the line under both. Put the
    // body before the control and the wrapping row pushes the control onto a third
    // line, which is what the ordering here is guarding.
    expect(html.indexOf('>Debounce Mode<')).toBeLessThan(
      html.indexOf('What this means: Debounce Mode'),
    );
    expect(html.indexOf('What this means: Debounce Mode')).toBeLessThan(
      html.indexOf('A change counts once the switch has settled for the set time'),
    );
    // The choices are a list: the one the row holds reads brighter, and the one the
    // keyboard ships with carries the Default mark, instead of a sentence saying so.
    expect(html).toMatch(/<dt data-current="">Balanced<span[^>]*>Default<\/span><\/dt>/);
    expect(html).toMatch(/<dt>Fast<\/dt>/);
    expect(html).not.toContain('Balanced is recommended');
  });

  // The mark is at the size of the name beside it, not fine print, in the muted label
  // colour after a dot. Beside the current choice's brighter name the colour parts the
  // two under every keycap theme; beside a name as muted as the mark, the dot does. A
  // mark in accent was the colour of the current name under some themes, and
  // 'Balanced Default' read as one name.
  test('sets the shipped choice apart from its name, current or not, under every theme', () => {
    optIn(true);
    for (const current of [true, false]) {
      const sheet = new ServerStyleSheet();
      let html = '';
      let css = '';
      try {
        html = renderToStaticMarkup(
          sheet.collectStyles(
            <Provider
              store={makeStore({era: true, menuData: withDebounceMode(current ? 0 : 1)})}
            >
              <I18nextProvider i18n={translations}>
                <Pane viaMenu={{label: 'FEATURE', content: [debounceSubmenu]} as any} />
              </I18nextProvider>
            </Provider>,
          ),
        );
        css = sheet.getStyleTags();
      } finally {
        sheet.seal();
      }
      const rulesOf = (classes: string, selector = '') =>
        classes
          .split(' ')
          .map((name) => new RegExp(`\\.${name}${selector}\\{([^}]*)\\}`).exec(css)?.[1] ?? '')
          .join(';');
      const colourOf = (rules: string) => /(?:^|;)color:([^;]+)/.exec(rules)?.[1] ?? '';
      const row =
        /<dl class="([^"]+)">(?:(?!<\/dl>).)*?<dt( data-current="")?>Balanced<span class="([^"]+)">Default<\/span><\/dt>/.exec(
          html,
        );
      expect(row).not.toBeNull();
      const [, list, currentMark, markClasses] = row!;
      expect(currentMark !== undefined).toBe(current);
      const mark = rulesOf(markClasses);
      expect(mark).not.toMatch(/font-size|opacity/);
      expect(rulesOf(markClasses, '::before')).toContain("content:' · '");
      if (current) {
        const name = colourOf(rulesOf(list, ' dt\\[data-current\\]'));
        const blended = themedPages(THEMES)
          .map(({page, properties}) => ({
            page,
            ratio: contrast(paint(colourOf(mark), properties), paint(name, properties)),
          }))
          .filter(({ratio}) => ratio < 3);
        expect(blended).toEqual([]);
      }
    }
  });

  // The help toggle, a switch and a number field show keyboard focus with VIA's
  // accent outline; the switch draws it for the hidden checkbox that has the focus.
  // Under the pointer the toggle takes the accent text colour, and a number field is
  // underlined in it, so both still read on the light surface.
  test('menu controls show keyboard focus and read on the light surface', () => {
    const sheet = new ServerStyleSheet();
    let html = '';
    let css = '';
    try {
      html = renderToStaticMarkup(
        sheet.collectStyles(
          <I18nextProvider i18n={translations}>
            <Explain>Why</Explain>
            <AccentSlider isChecked={false} onChange={() => undefined} />
            <IntegerInput
              draft="200"
              savedValue={200}
              min={1}
              max={65535}
              onDraftChange={() => undefined}
              ariaLabel="Term"
              suffix="ms"
            />
          </I18nextProvider>,
        ),
      );
      css = sheet.getStyleTags();
    } finally {
      sheet.seal();
    }
    const classes = (pattern: RegExp) =>
      /class="([^"]+)"/.exec(pattern.exec(html)?.[0] ?? '')?.[1].split(' ') ??
      [];
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declares = (selector: string, declaration: string) =>
      new RegExp(`${escape(selector)}\\{(?:[^}]*;)?${escape(declaration)}`).test(
        css,
      );
    const ring = 'outline:2px solid var(--color_accent)';
    const toggle = classes(/<button [^>]*aria-expanded[^>]*>/);
    expect(toggle.some((name) => declares(`.${name}:focus-visible`, ring))).toBe(
      true,
    );
    expect(
      toggle.some((name) =>
        declares(`.${name}:hover`, 'color:var(--color_accent-text)'),
      ),
    ).toBe(true);
    const [checkbox] = classes(/<input type="checkbox"[^>]*>/);
    const [track] = classes(/<span [^>]*><\/span><\/label>/);
    expect(declares(`.${checkbox}:focus-visible+.${track}`, ring)).toBe(true);
    const field = classes(/<span [^>]*>(?=<input [^>]*aria-label="Term")/);
    expect(
      field.some((name) =>
        declares(`.${name}`, 'border-bottom:1px solid var(--color_accent-text)'),
      ),
    ).toBe(true);
  });

  test('explains split-link rates beside the short speed dropdown', () => {
    optIn(false, true);
    const html = render(
      makeStore({
        era: true,
        menuData,
        configSync: {
          status: 'fresh',
          observedRevision: 2,
          acceptedRevision: 2,
        },
      }),
      {
        label: 'SYSTEM',
        content: [linkSubmenu],
      },
    );

    expect(html).toContain('What this means: Split Link Speed');
    expect(html).toContain(
      'The speed matters mainly for layer sharing when both units are plugged into the computer.',
    );
    // What each speed means to the person choosing it, not the line rate.
    expect(html).toMatch(/<dt[^>]*>High<span[^>]*>Default<\/span><\/dt><dd>Layer changes reach the other unit soonest\.<\/dd>/);
    expect(html).toMatch(/<dt>Medium<\/dt><dd>A little slower; for a cable that is unstable at High\.<\/dd>/);
    expect(html).toMatch(/<dt>Low<\/dt><dd>Slowest; for a cable that is unstable at the faster speeds\.<\/dd>/);
    expect(html).not.toMatch(/bps|DUAL-HOST/);
    expect(html).toMatch(/singleValue[^>]*>High<\/div>/);
  });

  // Only a split board has INPUT SYNC, so the SOCD rule for two units plugged in
  // separately lives there, and the SOCD page of a one-piece board never names it.
  test('keeps the split-only SOCD rule on the INPUT SYNC row', () => {
    optIn(true);
    const sync = render(
      makeStore({era: true, menuData: {id_qmk_input_sync_requested: [1]}}),
      {
        label: 'SYSTEM',
        content: [
          {
            label: 'SYNC',
            _id: '-0',
            content: [
              {
                label: 'INPUT SYNC',
                type: 'toggle',
                _id: '-0-0',
                content: ['id_qmk_input_sync_requested', 9, 6],
              },
            ],
          },
        ],
      },
    );
    const socd = render(
      makeStore({era: true, menuData: {id_qmk_socd_lr_enable: [1]}}),
      {
        label: 'FEATURE',
        content: [
          {
            label: 'SOCD',
            _id: '-0',
            content: [
              {
                label: 'Left/Right Enable',
                type: 'toggle',
                _id: '-0-0',
                content: ['id_qmk_socd_lr_enable', 10, 1],
              },
            ],
          },
        ],
      },
    );

    expect(sync).toContain(
      'With both units plugged into the computer, they share layers and key decisions; both keys of an SOCD pair must be on the same unit.',
    );
    expect(socd).toContain('Resolves simultaneous input between two opposing keys.');
    expect(socd).not.toMatch(/same unit|split keyboard|DUAL-HOST/);
  });

  test('keeps KKUK timing help on the two actual settings', () => {
    optIn(true);
    const html = render(makeStore({era: true, menuData}), {
      label: 'FEATURE',
      content: [kkukSubmenu],
    });

    expect(html).toContain('Repeats multiple keys while they remain held.');
    expect(html).toContain('What this means: First Delay Time');
    expect(html).toContain('What this means: Repeat Time');
    expect(html).not.toContain('Report Pulse');
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
    expect(fast).toContain('The change is sent at once');
    expect(fast).not.toContain('It delays release, not press.');
    expect(advanced).toContain('It delays release, not press.');
    expect(advanced).not.toContain('The change is sent at once');
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
    expect(html).toContain('Use it when a quick hold still comes out as a tap.');
    expect(html).toContain('>Global Tapping Term</label>');
    expect(html).not.toContain('What this means: Global Tapping Term');
  });

  // The catalog has "Neutral" for another board's SOCD menu; the other four ERA
  // names are not in it. Translating the one it knows would mix two languages.
  test('shows ERA option names as the definition spells them, in any language', async () => {
    const korean = i18n.createInstance();
    await korean.init({
      lng: 'ko',
      resources: {ko: {translation: {Neutral: '중립'}}},
    });
    const socdMenu = {
      label: 'FEATURE',
      content: [
        {
          label: 'SOCD',
          _id: '-0',
          content: [
            {
              label: 'Left/Right Mode',
              type: 'dropdown',
              _id: '-0-0',
              content: ['id_qmk_kill_switch_mode_lr', 10, 4],
              options: [
                ['Last Input', 1],
                ['Neutral', 2],
                ['First Input', 3],
                ['Left Priority', 4],
                ['Right Priority', 5],
              ],
            },
          ],
        },
      ],
    };
    const menuData = {id_qmk_kill_switch_mode_lr: [2]};
    optIn(true);
    const era = render(makeStore({era: true, menuData}), socdMenu, korean);
    const official = render(makeStore({menuData}), socdMenu, korean);

    expect(era).toMatch(/singleValue[^>]*>Neutral<\/div>/);
    expect(era).toMatch(/<dt data-current="">Neutral<\/dt>/);
    expect(era).not.toContain('중립');
    // An ordinary VIA keyboard keeps the catalog's translation.
    expect(official).toMatch(/singleValue[^>]*>중립<\/div>/);
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
    expect(html).not.toContain('A change counts once the switch has settled for the set time');
    expect(html).not.toContain('What this means');
  });

  // An ERA keyboard opened with its official or an uploaded definition reads as stock
  // VIA, though every command name in its menus is one the help knows.
  test('keeps ERA help off an ERA keyboard opened through another definition', () => {
    optIn(true);
    const html = render(makeStore({menuData: withDebounceMode(0)}), {
      label: 'FEATURE',
      content: [debounceSubmenu],
    });

    expect(screenText(html)).toMatch(/^DEBOUNCE Debounce Mode /);
    expect(html).not.toContain('What this means');
  });

  // VIA's own shared lighting menus use the id_qmk_rgblight_* and id_qmk_rgb_matrix_*
  // ids the ERA firmware uses too, and about half the bundled keyboards show them.
  test("keeps ERA help off VIA's shared lighting menus", async () => {
    const {keyboardDefinitionV3ToVIADefinitionV3} = await import('@the-via/reader');
    const {getV3Menus} = await import('../src/store/menusSlice');
    optIn(true);
    for (const common of ['qmk_rgb_matrix', 'qmk_rgblight', 'qmk_backlight_rgblight']) {
      const definition = keyboardDefinitionV3ToVIADefinitionV3({
        name: 'Stock lighting',
        vendorId: '0x1234',
        productId: '0x5678',
        matrix: {rows: 1, cols: 1},
        layouts: {keymap: [['0,0']]},
        menus: [common],
        keycodes: ['qmk_lighting'],
      } as any);
      const menus = getV3Menus(makeStore({definition}).getState()) as any[];
      expect(menus.length).toBeGreaterThan(0);
      for (const menu of menus) {
        for (const submenu of menu.content) {
          const items = submenu.content as any[];
          const values = Object.fromEntries(
            items.map(({type, content: [command]}) => [
              command,
              type === 'color' ? [0, 0] : [1],
            ]),
          );
          const html = render(makeStore({definition, menuData: values}), {
            ...menu,
            content: [submenu],
          });

          // The tab, then its first row: no line in between.
          expect({
            common,
            text: screenText(html).startsWith(`${submenu.label} ${items[0].label} `),
          }).toEqual({common, text: true});
          expect(html).not.toContain('What this means');
        }
      }
    }
  });

  // The catalog holds some ERA names for other boards (Indicators, Brightness).
  // Translating only those would mix two languages on one tab bar. The LINK page's
  // Apply is the menu's own button, not the definition's switch, so it is translated
  // like the help that names it.
  test('shows ERA submenu and row names as the definition spells them, in any language', async () => {
    const korean = i18n.createInstance();
    await korean.init({
      lng: 'ko',
      resources: {
        ko: {
          translation: {
            Indicators: '인디케이터',
            Brightness: '밝기',
            Apply: '적용',
            'Split Link Speed': '분할 링크 속도',
            'What this means: {{name}}': '{{name}} 설명',
          },
        },
      },
    });
    const lighting = {
      label: 'Lighting',
      content: [
        {
          label: 'Indicators',
          _id: '-0',
          content: [
            {
              label: 'Brightness',
              type: 'dropdown',
              _id: '-0-0',
              content: ['id_qmk_custom_ind_brightness', 0, 2],
              options: [['128', 128]],
            },
          ],
        },
      ],
    };
    const lightingData = {id_qmk_custom_ind_brightness: [128]};
    const link = {label: 'SYSTEM', content: [linkSubmenu]};
    optIn(true);
    const era = render(makeStore({era: true, menuData: lightingData}), lighting, korean);
    const eraLink = render(makeStore({era: true, menuData}), link, korean);
    const official = render(makeStore({menuData: lightingData}), lighting, korean);
    const officialLink = render(makeStore({menuData}), link, korean);

    expect(screenText(era)).toMatch(/^Indicators Brightness /);
    expect(screenText(eraLink)).toMatch(
      / Split Link Speed i High Cancel 적용$/,
    );
    expect(eraLink).toContain('aria-label="Split Link Speed 설명"');
    for (const html of [era, eraLink]) {
      expect(html).not.toMatch(/인디케이터|밝기|분할 링크 속도/);
    }
    // An ordinary VIA keyboard keeps the catalog's names.
    expect(screenText(official)).toMatch(/^인디케이터 밝기 /);
    expect(screenText(officialLink)).toMatch(/^LINK 분할 링크 속도 High 적용$/);
  });

  // A colour swatch says which row it sets in the words the row shows, then its colour.
  test('names a colour swatch by its row as the row reads, and by its colour', async () => {
    const korean = i18n.createInstance();
    await korean.init({
      lng: 'ko',
      resources: {ko: {translation: {Color: '색상'}}},
    });
    const lighting = {
      label: 'Lighting',
      content: [
        {
          label: 'Indicators',
          _id: '-0',
          content: [
            {
              label: 'Color',
              type: 'color',
              _id: '-0-0',
              content: ['id_qmk_custom_ind_1_color', 0, 9],
            },
          ],
        },
      ],
    };
    const lightingData = {id_qmk_custom_ind_1_color: [85, 255]};
    optIn(true);
    const era = render(makeStore({era: true, menuData: lightingData}), lighting, korean);
    const official = render(makeStore({menuData: lightingData}), lighting, korean);

    expect(era).toContain('aria-label="Color, #00ff00"');
    expect(official).toContain('aria-label="색상, #00ff00"');
  });
});

// The firmware holds a chosen link speed until the Apply switch puts it into effect,
// and names the speed the pair runs and the one it keeps in labels. The ERA menu
// writes the speed with its switch on the page's Apply and shows the running one;
// other definitions stay stock.
describe('ERA LINK and BOOT controls', () => {
  const runningLinkSubmenu = {
    ...linkSubmenu,
    content: [
      ...linkSubmenu.content,
      {
        label: 'Runtime Level',
        type: 'label',
        _id: '-0-2',
        content: ['id_qmk_split_link_runtime', 9, 64],
      },
      {
        label: 'Saved Level',
        type: 'label',
        _id: '-0-3',
        content: ['id_qmk_split_link_stored', 9, 65],
      },
    ],
  };
  const runningLow = {
    ...menuData,
    id_qmk_split_link_runtime: [...new TextEncoder().encode('Low'), 0],
    id_qmk_split_link_stored: [...new TextEncoder().encode('High'), 0],
  };

  test('shows the speed the pair runs, with the page Apply in place of the switch and labels', () => {
    optIn(true);
    const html = render(makeStore({era: true, menuData: runningLow}), {
      label: 'SYSTEM',
      content: [runningLinkSubmenu],
    });

    expect(html).toMatch(/singleValue[^>]*>Low<\/div>/);
    // The help's list marks the speed the dropdown holds.
    expect(html).toMatch(/<dt data-current="">Low<\/dt>/);
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('Runtime Level');
    expect(html).not.toContain('Saved Level');
    expect(screenText(html)).toMatch(/ Split Link Speed i Low Cancel Apply$/);
  });

  test('keeps the stock LINK rows for an official definition', () => {
    optIn(true);
    const html = render(makeStore({menuData: runningLow}), {
      label: 'SYSTEM',
      content: [runningLinkSubmenu],
    });

    expect(html).toContain('type="checkbox"');
    expect(screenText(html)).toBe(
      'LINK Split Link Speed High Apply Runtime Level Low Saved Level High',
    );
  });

  test('draws Jump To BOOT as a Run button, and as the switch on other definitions', () => {
    optIn(true);
    const era = render(makeStore({era: true, menuData}), {
      label: 'SYSTEM',
      content: [bootSubmenu],
    });
    const official = render(makeStore({menuData}), {
      label: 'SYSTEM',
      content: [bootSubmenu],
    });

    expect(era).toMatch(
      /<button[^>]*title="Restart into the bootloader"[^>]*>Run<\/button>/,
    );
    expect(era).not.toContain('type="checkbox"');
    expect(official).toContain('type="checkbox"');
    expect(official).not.toContain('>Run<');
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


describe('H7S shipped exact-term controls', () => {
  test('all five definitions render every global/slot term above the stock limit without an invalid field', async () => {
    optIn(false);
    const paths = [
      'brick60-h7s/BRICK60-H7S-VIA.json', 'brick65-h7s/BRICK65-H7S-VIA.json',
      'intigrity80-h7s/INTIGRITY80-H7S-VIA.json', 'may65-h7s/MAY65-H7S-VIA.json',
      'sculpturei-h7s/SCULPTUREI-H7S-VIA.json',
    ];
    for (const path of paths) {
      const definition = await Bun.file(`era-definitions/custom/v3/${path}`).json();
      const controls: any[] = [];
      const visit = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(visit); return; }
        if (node.type === 'range' && String(node.content?.[0]).endsWith('_term_exact')) {
          controls.push(node);
        }
        Object.values(node).forEach(visit);
      };
      // Global term lives in a menu; the eight TD terms live on tapdanceKeycodes.
      visit(definition);
      expect(controls).toHaveLength(9);
      for (const control of controls) {
        for (const value of [501, 65535]) {
          const html = render(makeStore({era: true, menuData: {
            [control.content[0]]: [value >> 8, value & 255],
          }}), {label: 'TAPPING', content: [{label: 'Term', _id: '-0',
            content: [{...control, _id: '-0-0'}]}]});
          expect(html).toContain(`value="${value}"`);
          expect(html).not.toContain('aria-invalid="true"');
        }
      }
    }
  });
});


describe('ERA configure rail icons', () => {
  const renderIcon = (era: boolean, label: string, commands: string[]) => {
    const {Icon} = makeCustomMenu({
      label,
      content: [{label: 'Nested', content: commands.map((command) => ({
        label: 'Value', type: 'range', options: [0, 1], content: [command, 1, 1],
      }))}],
    } as any, 0);
    return renderToStaticMarkup(<Provider store={makeStore({era})}><Icon /></Provider>);
  };
  test('ERA icons follow commands regardless of translated or misleading labels', () => {
    expect(renderIcon(true, 'RGB display', ['id_qmk_socd_mode'])).toContain('data-icon="sliders"');
    expect(renderIcon(true, 'Audio', ['id_qmk_kill_switch_mode'])).toContain('data-icon="sliders"');
    expect(renderIcon(true, 'Lighting', ['id_qmk_ver_major'])).toContain('data-icon="microchip"');
    expect(renderIcon(true, 'FEATURE', ['id_qmk_socd_mode', 'id_qmk_system_mode'])).toContain('data-icon="microchip"');
  });
  test('ordinary VIA and unknown ERA menus retain label-based icons', () => {
    expect(renderIcon(false, 'RGB display', ['id_qmk_socd_mode'])).toContain('data-icon="lightbulb"');
    expect(renderIcon(false, 'FEATURE', ['id_qmk_socd_mode'])).toContain('data-icon="microchip"');
    expect(renderIcon(true, 'Audio', ['vendor_volume'])).toContain('data-icon="headphones"');
  });
});
