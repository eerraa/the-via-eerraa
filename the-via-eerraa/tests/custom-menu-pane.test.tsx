import {configureStore} from '@reduxjs/toolkit';
import {afterAll, describe, expect, spyOn, test} from 'bun:test';
import i18n from 'i18next';
import {Provider} from 'react-redux';
import {I18nextProvider} from 'react-i18next';
import {renderToStaticMarkup} from 'react-dom/server';
import {act, create, type ReactTestInstance} from 'react-test-renderer';
import {keyboardDefinitionV3ToVIADefinitionV3} from '@the-via/reader';
import {setEraAdvancedMetadataForTesting} from '../src/utils/era-advanced-metadata';
import {
  decodeEraFirmwareVersion,
  ERA_FIRMWARE_VERSION_COMMAND,
} from '../src/utils/era-firmware-version';
import type {DomainReadFailure} from '../src/store/stateSyncSlice';
import n87Definition from '../era-definitions/custom/v3/n87/N87-VIA.json';
import h7sDefinition from '../era-definitions/custom/v3/brick65-h7s/BRICK65-H7S-VIA.json';
import qmkDefinition from '../era-definitions/custom/v3/7b75/7B75-VIA.json';

const originalWarn = console.warn;
console.warn = () => undefined;
const {Pane, elemLabeler} = await (async () => {
  try {
    await import('../src/utils/keyboard-api');
    return await import('../src/components/panes/configure-panes/custom/menu-generator');
  } finally {
    console.warn = originalWarn;
  }
})();

const failure =
  'Unable to load feature settings. Reconnect the keyboard and try again.';
const translations = i18n.createInstance();
await translations.init({lng: 'en', resources: {en: {translation: {}}}});
const device = {
  path: 'custom-menu',
  vendorId: 0x1234,
  productId: 0x5678,
  vendorProductId: 0x12345678,
  productName: 'Custom menu keyboard',
  protocol: 11,
  requiredDefinitionVersion: 'v3',
  hasResolvedDefinition: true,
} as const;
type ConfigSync = {
  status: 'dirty' | 'refreshing' | 'fresh';
  observedRevision?: number;
  acceptedRevision?: number;
  failedRead?: DomainReadFailure;
};
const makeStore = (
  menuData?: object,
  {
    era = true,
    sync,
    definition = {},
  }: {
    era?: boolean;
    sync?: ConfigSync;
    definition?: object;
  } = {},
) => {
  const entry = {[device.vendorProductId]: {v3: definition}};
  const state = {
    definitions: {
      definitions: era ? {} : entry,
      customDefinitions: {},
      eraDefinitions: era ? entry : {},
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
    settings: {ShowSliderValuesMode: 'Slider Only'},
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
      readContexts: menuData
        ? {
            [device.path]: {
              connectionGeneration: 0,
              selectionGeneration: 1,
              definitionIdentity: `${device.vendorProductId}:v3:0`,
            },
          }
        : {},
      customMenuDataMap: menuData ? {[device.path]: menuData} : {},
      commonMenusMap: {},
      showKeyPainter: false,
    },
    drafts: {},
    applying: {writing: {}, stops: {}},
    configurePlace: {},
    definitionName: {selectedOptionMap: {}},
    ...(sync && {
      stateSync: {
        byPath: {
          [device.path]: {
            capability: 'capable',
            generation: 0,
            config: {
              status: sync.status,
              observedRevision: sync.observedRevision ?? 2,
              acceptedRevision: sync.acceptedRevision ?? 1,
              mutationEpoch: 0,
              foregroundWriteDepth: 0,
              acceptedSelectionGeneration: 1,
              acceptedDefinitionIdentity: `${device.vendorProductId}:v3:0`,
              failedRead: sync.failedRead ?? null,
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
  menu: object,
  data?: object,
  options?: Parameters<typeof makeStore>[1],
) =>
  renderToStaticMarkup(
    <Provider store={makeStore(data, options)}>
      <I18nextProvider i18n={translations}>
        <Pane viaMenu={menu as any} />
      </I18nextProvider>
    </Provider>,
  );
const optIn = (stateSync = false) =>
  setEraAdvancedMetadataForTesting({
    schemaVersion: 2,
    definitions: [
      {
        id: 'custom-menu-test',
        vendorProductId: device.vendorProductId,
        stateSync,
        usbDiagnostics: true,
        exactMsFamily: 'h7s',
      },
    ],
  });
afterAll(() => setEraAdvancedMetadataForTesting(null));
const menu = (content: object[]) => ({
  label: 'SYSTEM',
  content: [{label: 'Controls', _id: '-0', content}],
});
const boot = menu([
  {
    label: 'Jump To BOOT',
    type: 'toggle',
    _id: '-0-0',
    content: ['id_qmk_system_dfu', 9, 1],
  },
]);
const bootData = {id_qmk_system_dfu: [0]};

describe('custom menu values and availability', () => {
  test.each(['menu', 'submenu', 'item'] as const)(
    'missing %s showIf values hide guarded content without sending defaults',
    (level) => {
      optIn(true);
      for (const showIf of [
        '{id_qmk_rgblight_effect} != 0',
        '{id_qmk_rgblight_effect} == 0',
      ]) {
        const guarded = {
          label: 'Guarded control',
          type: 'toggle',
          _id: '-0-1',
          content: ['id_guarded', 8, 1],
        };
        const remaining = {
          label: 'Remaining control',
          type: 'button',
          _id: '-0-0',
          content: ['id_remaining', 8, 2],
        };
        const pages =
          level === 'menu'
            ? [
                {...menu([guarded]), label: 'Guarded menu', showIf},
                menu([remaining]),
              ]
            : level === 'submenu'
              ? [
                  {
                    label: 'SYSTEM',
                    content: [
                      menu([remaining]).content[0],
                      {
                        ...menu([guarded]).content[0],
                        label: 'Guarded submenu',
                        _id: '-1',
                        showIf,
                      },
                    ],
                  },
                ]
              : [menu([remaining, {...guarded, showIf}])];
        const store = makeStore(
          {id_remaining: [1], id_guarded: [1]},
          {sync: {status: 'fresh', acceptedRevision: 2}},
        );
        const dispatch = spyOn(store, 'dispatch');
        let renderer!: ReturnType<typeof create>;
        try {
          act(() => {
            renderer = create(
              <Provider store={store}>
                <I18nextProvider i18n={translations}>
                  {pages.map((page, index) => (
                    <Pane key={index} viaMenu={page as any} />
                  ))}
                </I18nextProvider>
              </Provider>,
            );
          });
          const text = (node: ReactTestInstance): string =>
            node.children
              .map((child) => (typeof child === 'string' ? child : text(child)))
              .join('');
          expect(text(renderer.root)).toContain('Remaining control');
          expect(text(renderer.root)).not.toContain('Guarded control');
          expect(text(renderer.root)).not.toContain(
            'The keyboard did not send this value.',
          );
          expect(
            renderer.root.findAll((node) => node.type === 'button')
              .some((node) => text(node) === 'Click'),
          ).toBe(true);
          expect(
            renderer.root.findAll((node) => node.type === 'input'),
          ).toHaveLength(0);
          expect(dispatch).not.toHaveBeenCalled();
        } finally {
          act(() => renderer.unmount());
          dispatch.mockRestore();
        }
      }
    },
  );

  test('generated render predicates require every referenced value without replacing zero', () => {
    const item = {
      label: 'Guarded control',
      type: 'toggle',
      content: ['id_guarded', 8, 1],
    };
    for (const elem of [item, {content: [item]}, menu([item])]) {
      const {_renderIf} = elemLabeler({
        ...elem,
        showIf: '{id_known} == 0 && {id_qmk_rgblight_effect} == 0',
      });
      expect(_renderIf({id_known: [0]})).toBe(false);
      expect(
        _renderIf({id_known: [0], id_qmk_rgblight_effect: undefined}),
      ).toBe(false);
      expect(
        _renderIf({id_known: [0], id_qmk_rgblight_effect: null}),
      ).toBe(false);
      expect(
        _renderIf({id_known: [0], id_qmk_rgblight_effect: [0]}),
      ).toBe(true);
      expect(
        _renderIf({id_known: [0], id_qmk_rgblight_effect: [1]}),
      ).toBe(false);
    }
  });

  test('missing control values leave the menu intact without sending defaults', () => {
    optIn(true);
    for (const type of ['color', 'keycode', 'range', 'toggle', 'dropdown']) {
      const page = menu([
        {
          label: 'Missing value',
          type,
          _id: '-0-0',
          content: ['id_missing', 8, 1],
          options: type === 'dropdown' ? ['First', 'Second'] : [0, 255],
        },
        {
          label: 'Remaining control',
          type: 'button',
          _id: '-0-1',
          content: ['id_remaining', 8, 2],
        },
      ]);
      const store = makeStore(
        {id_remaining: [1]},
        {sync: {status: 'fresh', acceptedRevision: 2}},
      );
      const dispatch = spyOn(store, 'dispatch');
      let renderer!: ReturnType<typeof create>;
      try {
        act(() => {
          renderer = create(
            <Provider store={store}>
              <I18nextProvider i18n={translations}>
                <Pane viaMenu={page as any} />
              </I18nextProvider>
            </Provider>,
          );
        });
        const text = (node: ReactTestInstance): string =>
          node.children
            .map((child) => (typeof child === 'string' ? child : text(child)))
            .join('');
        expect(text(renderer.root)).toContain('Remaining control');
        expect(text(renderer.root)).toContain(
          'The keyboard did not send this value.',
        );
        expect(
          renderer.root.findAll((node) => node.type === 'button')
            .some((node) => text(node) === 'Click'),
        ).toBe(true);
        expect(
          renderer.root.findAll(
            (node) =>
              typeof node.type === 'string' &&
              ['input', 'select'].includes(node.type),
          ),
        ).toHaveLength(0);
        expect(dispatch).not.toHaveBeenCalled();
      } finally {
        act(() => renderer.unmount());
        dispatch.mockRestore();
      }
    }
  });

  test('missing values stay silent until menu data is authoritative', () => {
    optIn(true);
    const page = menu([
      {
        label: 'Missing color',
        type: 'color',
        _id: '-0-0',
        content: ['id_missing_color', 8, 1],
      },
      {
        label: 'Remaining control',
        type: 'button',
        _id: '-0-1',
        content: ['id_remaining', 8, 2],
      },
    ]);
    for (const sync of [
      undefined,
      {status: 'dirty', acceptedRevision: 0},
      {status: 'dirty', acceptedRevision: 1},
      {status: 'refreshing', acceptedRevision: 1},
      {
        status: 'dirty',
        acceptedRevision: 1,
        failedRead: {
          revision: 2,
          mutationEpoch: 0,
          selectionGeneration: 1,
          definitionIdentity: `${device.vendorProductId}:v3:0`,
        },
      },
    ] satisfies (ConfigSync | undefined)[]) {
      const html = render(page, {id_remaining: [1]}, {sync});
      expect(html).not.toContain('The keyboard did not send this value.');
      expect(html).not.toContain('<input');
      if (sync && !sync.failedRead && sync.acceptedRevision === 1) {
        expect(html).toContain('Remaining control');
      }
    }
  });

  test('decodes terminated firmware versions and keeps the version read-only', () => {
    optIn();
    const ascii = (value: string, tail: unknown[] = [0]) => [
      ...new TextEncoder().encode(value),
      ...tail,
    ];
    for (const bytes of [
      ascii('260901R1'),
      ascii('260901R1', [0, 0xa5]),
      ascii('260901R1', [0, 'ignored']),
    ]) {
      expect(decodeEraFirmwareVersion(bytes)).toBe('260901R1');
    }
    for (const bytes of [
      ascii('260901R1', []),
      ascii('261301R1'),
      [0x32, 0x80, 0],
      '260901R1',
    ]) {
      expect(decodeEraFirmwareVersion(bytes)).toBeNull();
    }
    for (const command of [1, 5]) {
      const html = render(
        menu([
          {
            label: 'Current Version',
            type: 'label',
            _id: '-0-0',
            content: [ERA_FIRMWARE_VERSION_COMMAND, 8, command],
          },
        ]),
        {[ERA_FIRMWARE_VERSION_COMMAND]: ascii('260901R1')},
      );
      expect(html).toContain('260901R1');
      expect(html).not.toContain('<input');
      expect(html).not.toContain('>Apply<');
    }
  });

  test('keeps accepted controls during refresh but reports loading and current read refusals', () => {
    optIn(true);
    const failedRead = {
      revision: 2,
      mutationEpoch: 0,
      selectionGeneration: 1,
      definitionIdentity: `${device.vendorProductId}:v3:0`,
    };
    const cases: [ConfigSync | undefined, string][] = [
      [undefined, 'Loading...'],
      [{status: 'dirty'}, 'Jump To BOOT'],
      [{status: 'refreshing'}, 'Jump To BOOT'],
      [{status: 'dirty', acceptedRevision: 0, failedRead}, failure],
      [{status: 'dirty', acceptedRevision: 1, failedRead}, failure],
      [
        {
          status: 'dirty',
          acceptedRevision: 0,
          failedRead: {...failedRead, revision: 1},
        },
        'Loading...',
      ],
    ];
    for (const [sync, expected] of cases) {
      const html = render(boot, bootData, {sync});
      expect(html).toContain(expected);
      for (const other of ['Loading...', 'Jump To BOOT', failure].filter(
        (text) => text !== expected,
      )) {
        expect(html).not.toContain(other);
      }
    }
    optIn();
    expect(render(boot)).toContain(failure);
  });

  test('shows exact sleep values only while their independent switches are on', () => {
    optIn(true);
    for (const channel of [9, 18]) {
      const rows = [
        {
          label: 'RGB Sleep',
          type: 'toggle',
          _id: '-0-0',
          content: ['id_qmk_rgb_sleep_enable', channel, channel === 9 ? 12 : 3],
        },
        {
          label: 'RGB Sleep Timeout (s)',
          type: 'range',
          _id: '-0-1',
          showIf: '{id_qmk_rgb_sleep_enable} == 1',
          content: [
            'id_qmk_rgb_sleep_timeout_exact',
            channel,
            channel === 9 ? 11 : 2,
          ],
          options: [1, 65535],
        },
        ...(channel === 9
          ? [
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
            ]
          : []),
      ];
      for (const [rgb, backlight] of [
        [1, 1],
        [0, 1],
        [1, 0],
        [0, 0],
      ]) {
        const html = render(
          menu(rows),
          {
            id_qmk_rgb_sleep_enable: [rgb],
            id_qmk_rgb_sleep_timeout_exact: [2, 88],
            id_qmk_backlight_sleep_enable: [backlight],
            id_qmk_backlight_sleep_timeout_exact: [1, 44],
          },
          {sync: {status: 'fresh', acceptedRevision: 2}},
        );
        expect(html).toContain('RGB Sleep');
        expect(html.includes('value="600"')).toBe(Boolean(rgb));
        expect(html.includes('value="300"')).toBe(
          channel === 9 && Boolean(backlight),
        );
      }
    }
  });

  test('shows the running ERA link speed while stock definitions retain their saved speed', () => {
    optIn();
    const link = menu([
      {
        label: 'Split Link Speed',
        type: 'dropdown',
        _id: '-0-0',
        content: ['id_qmk_split_link_level', 9, 8],
        options: [
          ['High', 0],
          ['Low', 2],
        ],
      },
      {
        label: 'Apply',
        type: 'toggle',
        _id: '-0-1',
        content: ['id_qmk_split_link_apply', 9, 9],
      },
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
    ]);
    const data = {
      id_qmk_split_link_level: [0],
      id_qmk_split_link_apply: [0],
      id_qmk_split_link_runtime: [...new TextEncoder().encode('Low'), 0],
      id_qmk_split_link_stored: [...new TextEncoder().encode('High'), 0],
    };
    for (const era of [true, false]) {
      const html = render(link, data, {era});
      expect(html).toMatch(
        era ? /singleValue[^>]*>Low</ : /singleValue[^>]*>High</,
      );
      expect(html.includes('Runtime Level')).toBe(!era);
      expect(render(boot, bootData, {era}).includes('>Run<')).toBe(era);
    }
  });

  test('accepts the full exact-term range in every shipped H7S definition', async () => {
    optIn();
    for (const path of [
      'brick60-h7s/BRICK60-H7S-VIA.json',
      'brick65-h7s/BRICK65-H7S-VIA.json',
      'intigrity80-h7s/INTIGRITY80-H7S-VIA.json',
      'may65-h7s/MAY65-H7S-VIA.json',
      'sculpturei-h7s/SCULPTUREI-H7S-VIA.json',
    ]) {
      const definition = await Bun.file(
        `era-definitions/custom/v3/${path}`,
      ).json();
      const controls: any[] = [];
      const visit = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (
          node.type === 'range' &&
          String(node.content?.[0]).endsWith('_term_exact')
        )
          controls.push(node);
        Object.values(node).forEach(visit);
      };
      visit(definition);
      expect(controls).toHaveLength(9);
      for (const control of controls) {
        for (const value of [501, 65535]) {
          const html = render(menu([{...control, _id: '-0-0'}]), {
            [control.content[0]]: [value >> 8, value & 255],
          });
          expect(html).toContain(`value="${value}"`);
          expect(html).not.toContain('aria-invalid="true"');
        }
      }
    }
  });

  test('never offers retired diagnostics, including for stale opt-in metadata', () => {
    optIn();
    for (const era of [true, false]) {
      const html = render(
        menu([
          {
            label: 'Apply Selected Mode',
            type: 'toggle',
            _id: '-0-0',
            content: ['id_qmk_usb_bootmode_apply', 13, 2],
          },
        ]),
        {id_qmk_usb_bootmode_apply: [0]},
        {era},
      );
      expect(html).toContain('Apply Selected Mode');
      expect(html).not.toContain('USB Polling Diagnostics');
    }
  });
});

test('near-white RGB guidance respects effect, saturation, definition source and available color data', () => {
  optIn();
  for (const [definition, mode] of [
    [qmkDefinition, 6],
    [n87Definition, 24],
    [h7sDefinition, 9],
  ] as const) {
    const lighting = definition.menus.find(
      (item: any) => item.label === 'Lighting',
    ) as any;
    const submenu = lighting.content.find((sub: any) =>
      sub.content.some((item: any) =>
        ['id_qmk_rgblight_effect', 'id_qmk_rgb_matrix_effect'].includes(
          item.content?.[0],
        ),
      ),
    );
    const page = {
      ...lighting,
      content: [
        {
          ...submenu,
          _id: '-rgb',
          content: submenu.content.map((item: any, index: number) => ({
            ...item,
            _id: `-rgb-${index}`,
          })),
        },
      ],
    };
    const converted = keyboardDefinitionV3ToVIADefinitionV3({
      name: 'RGB guidance test',
      vendorId: '0x1234',
      productId: '0x5678',
      matrix: {rows: 1, cols: 1},
      layouts: {keymap: [['0,0']]},
      menus: [
        JSON.parse(
          JSON.stringify(page, (key, value) =>
            key === '_id' ? undefined : value,
          ),
        ),
      ],
      keycodes: ['qmk_lighting'],
    } as any);
    for (const [effect, saturation, era, colorAvailable, warning] of [
      [mode, 0, true, true, true],
      [mode, 3, true, true, true],
      [mode, 12, true, true, true],
      [mode, 13, true, true, false],
      [5, 0, true, true, false],
      [mode, 0, false, true, false],
      ...(definition === qmkDefinition
        ? [[mode, 0, true, false, false] as const]
        : []),
    ] as const) {
      const data = Object.fromEntries(
        page.content[0].content
          .filter((item: any) => colorAvailable || item.type !== 'color')
          .map((item: any) => [
            item.content[0],
            item.type === 'color'
              ? [37, saturation]
              : item.type === 'dropdown'
                ? [effect]
                : [128],
          ]),
      );
      const html = render(page, data, {era, definition: converted});
      expect(html.includes('Near-white colors')).toBe(warning);
      if (warning) expect(html).toContain('aria-label="Color, #');
    }
  }
});
