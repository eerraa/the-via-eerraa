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
import {
  decodeEraFirmwareVersion,
  ERA_FIRMWARE_VERSION_COMMAND,
} from '../src/utils/era-firmware-version';

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

type ConfigSyncOverride = {
  status: 'dirty' | 'refreshing' | 'fresh';
  observedRevision?: number;
  acceptedRevision?: number;
  foregroundWriteDepth?: number;
};

const makeStore = (
  overrides: {
    era?: boolean;
    menuData?: object;
    configSync?: ConfigSyncOverride;
  } = {},
) => {
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
  label: 'RGB Matrix',
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
  label: 'RGB ROW',
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
  label: 'Badge Lighting',
  _id: '-0',
  content: [
    {
      label: 'RGB-Only',
      type: 'toggle',
      _id: '-0-0',
      content: ['id_custom_badge_only', 0, 4],
    },
    {
      label: 'Lock Indicator',
      type: 'dropdown',
      _id: '-0-1',
      content: ['id_custom_indicator_toggle', 0, 0],
      options: [
        ['Off', 0],
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
      expect(html).toContain('Firmware version on this keyboard.');
      expect(html).toContain('Current Version');
      expect(html).not.toContain('<input');
      expect(html).not.toContain('role="combobox"');
      expect((html.match(/<button/g) ?? []).length).toBe(1);
      expect(html).toContain('aria-label="What this means"');
      expect(html).not.toContain('>Save<');
      expect(html).not.toContain('>Apply<');
    }
    expect(h7s).not.toContain('>Year<');
    expect(h7s).not.toContain('>Month<');
    expect(h7s).not.toContain('>Day<');
    expect(h7s).not.toContain('>Rev.<');
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

    expect(html).toContain('Configures speed when using mouse-control keys');
    expect(html).toContain('Cursor Acceleration');
  });

  test('keeps lighting summaries direct and puts Velocikey help only on RGBLight', () => {
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

    expect(matrix).toContain(
      'Configures switch RGB brightness, effects, speed and color.',
    );
    expect(matrix).not.toContain('Velocikey');
    expect(matrix).not.toContain('What this means');
    expect(rgbLight).toContain(
      'Configures RGB lighting brightness, effects, speed and color.',
    );
    expect(rgbLight).toContain('Velocikey');
    expect(rgbLight).toContain('What this means: Velocikey');
    expect(backlight).toContain('Configures backlight brightness and effects.');
    expect(backlight).not.toContain('What this means');
  });

  test('moves badge explanations from the heading to the controls', () => {
    optIn(true);
    const html = render(makeStore({era: true, menuData}), {
      label: 'Lighting',
      content: [badgeSubmenu],
    });

    expect(html).toContain('Configures badge lighting and lock indicators.');
    expect(html).toContain('What this means: RGB-Only');
    expect(html).toContain('What this means: Lock Indicator');
    expect(html).toContain('What this means: Indicator-Only');
    expect(html).toContain('Applies RGB effects only to the badge area.');
    expect(html).not.toContain('Badge-Only RGB');
  });
});

describe('ERA exact-second input', () => {
  test('renders the TOMAK sleep timeout with the same feature-help and deferred-input surface', () => {
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

    expect(html).toContain('Controls automatic RGB sleep.');
    expect(html).toContain('Turning it off disables RGB sleep');
    expect(html).toContain('hidden=""');
    expect(html).toContain('RGB Sleep');
    expect(html).toContain('RGB Sleep Timeout (s)');
    expect(html).toContain('value="600"');
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

    expect(html).toContain('Controls automatic RGB sleep.');
    expect(html).toContain('Turning it off disables RGB sleep');
    expect(html).toContain('hidden=""');
    expect(html).toContain('RGB Sleep');
    expect(html).toContain('RGB Sleep Timeout (s)');
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
      expect(html).not.toContain('RGB Sleep Timeout (s)');
      expect(html).not.toContain('value="600"');
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
    expect(html).toContain('Balanced — The most stable default');
    // Shipped with the row, folded away until asked for.
    expect(visibleText(html)).not.toContain('Balanced — The most stable default');
    // Label, then the button beside it, then the body on the line under both. Put the
    // body before the control and the wrapping row pushes the control onto a third
    // line, which is what the ordering here is guarding.
    expect(html.indexOf('>Debounce Mode<')).toBeLessThan(
      html.indexOf('What this means: Debounce Mode'),
    );
    expect(html.indexOf('What this means: Debounce Mode')).toBeLessThan(
      html.indexOf('Balanced — The most stable default'),
    );
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
    expect(html).toContain('High — 460800 bps; 1 ms polling');
    expect(html).toContain('Medium — 230400 bps; 2 ms polling');
    expect(html).toContain('Low — 115200 bps; 4 ms polling');
    expect(html).toContain('Master–Slave (HOST-PEER) operation changes very little');
    expect(html).toContain('DUAL-HOST layer-sharing response time');
    expect(html).toMatch(/singleValue[^>]*>High<\/div>/);
    expect(html).not.toContain('High - 460800');
    expect(html).toContain(
      'DUAL-HOST layer sharing.\n\nMedium — 230400 bps',
    );
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
    expect(html).toContain(
      'Use this when a tap-hold key is still treated as a tap during fast typing',
    );
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
    expect(html).not.toContain('Balanced — The most stable default');
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
