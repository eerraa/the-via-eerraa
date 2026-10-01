import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test';
import {configureStore} from '@reduxjs/toolkit';
import {LightingValue} from '@the-via/reader';
import i18n from 'i18next';
import {I18nextProvider} from 'react-i18next';
import {Provider} from 'react-redux';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';

// The store slices import each other; keyboard-api settles that cycle the way the
// app's store does, so it loads before anything that reads the store.
const {KeyboardAPI} = await import('../src/utils/keyboard-api');
const {HID, registerHIDDeviceForTesting, resetHIDTransportForTesting} =
  await import('../src/shims/node-hid');
const {setEraAdvancedMetadataForTesting} =
  await import('../src/utils/era-advanced-metadata');
const devices = await import('../src/store/devicesSlice');
const definitions = await import('../src/store/definitionsSlice');
const keymap = await import('../src/store/keymapSlice');
const menus = await import('../src/store/menusSlice');
const macros = await import('../src/store/macrosSlice');
const lighting = await import('../src/store/lightingSlice');
const configurePlace = await import('../src/store/configurePlaceSlice');
const reducer = {
  settings: (await import('../src/store/settingsSlice')).default,
  macros: macros.default,
  devices: devices.default,
  keymap: keymap.default,
  definitions: definitions.default,
  lighting: lighting.default,
  menus: menus.default,
  design: (await import('../src/store/designSlice')).default,
  errors: (await import('../src/store/errorsSlice')).default,
  firmware: (await import('../src/store/firmwareSlice')).default,
  definitionName: (await import('../src/store/definitionNameSlice')).default,
  stateSync: (await import('../src/store/stateSyncSlice')).default,
  drafts: (await import('../src/store/draftsSlice')).default,
  applying: (await import('../src/store/applyingSlice')).default,
  configurePlace: configurePlace.default,
};
// The loader's picture comes through a Vite alias, which Bun does not resolve.
mock.module('assets/images/chippy_600.png', () => ({default: ''}));
// A rail row's tooltip draws into the page body, which the test renderer has not
// got; a plain one keeps the row's name. A mocked module stays mocked for the test
// files run after this one, so the real exports, copied before the mock replaces
// them in place, go back once this file is done.
const RowName = ({children}: {children: string}) => <span>{children}</span>;
const realTooltip = {...(await import('../src/components/inputs/tooltip'))};
mock.module('../src/components/inputs/tooltip', () => ({
  ...realTooltip,
  MenuTooltip: RowName,
}));
afterAll(() => {
  mock.module('../src/components/inputs/tooltip', () => realTooltip);
});
const {ConfigurePane} = await import('../src/components/panes/configure');
const {Row} = await import('../src/components/panes/grid');
const {SubmenuTabBar} = await import('../src/components/panes/submenu-tabs');
const {DirtyDot} = await import('../src/components/inputs/dirty-dot');

const translations = i18n.createInstance();
await translations.init({lng: 'en', resources: {en: {translation: {}}}});

const VENDOR_ID = 0x4553;
const PRODUCT_ID = 0x0c09;
const VPID = VENDOR_ID * 0x10000 + PRODUCT_ID;
const PATH = 'configure-place';

type InputListener = (event: {data: DataView}) => void;

// A keyboard that answers every command by echoing it, as VIA firmware does.
class EchoKeyboard {
  opened = false;
  productName = 'Place test';
  collections = [{usagePage: 0xff60, usage: 0x61}];
  listeners = new Set<InputListener>();

  constructor(
    readonly vendorId: number,
    readonly productId: number,
  ) {}

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
    this.listeners.forEach((listener) =>
      listener({data: new DataView(bytes.slice().buffer)}),
    );
  }
}

const layouts = {
  keys: [
    {
      ...{x: 0, y: 0, w: 1, h: 1, row: 0, col: 0, color: 'alpha'},
      ...{d: false, r: 0, rx: 0, ry: 0},
    },
  ],
  width: 1,
  height: 1,
  optionKeys: {},
};

// FEATURE and SYSTEM as the ERA definitions have them, cut to a row or two each.
const feature = {
  label: 'FEATURE',
  content: [
    {
      label: 'SOCD',
      content: [
        {
          label: 'Left/Right Enable',
          type: 'toggle',
          content: ['id_qmk_kill_switch_enable_lr', 10, 1],
        },
      ],
    },
    {
      label: 'DEBOUNCE',
      content: [
        {
          label: 'Debounce Mode',
          type: 'dropdown',
          content: ['id_qmk_debounce_mode', 14, 1],
          options: [
            ['Balanced', 0],
            ['Fast', 1],
          ],
        },
      ],
    },
    {
      label: 'TAPPING',
      content: [
        {
          label: 'Global Tapping Term (ms)',
          type: 'range',
          content: ['id_qmk_tapping_global_term_exact', 15, 5],
          options: [1, 65535],
        },
      ],
    },
  ],
};
const system = {
  label: 'SYSTEM',
  content: [
    {
      label: 'VERSION',
      content: [
        {
          label: 'Current Version',
          type: 'label',
          content: ['id_qmk_ver_ascii', 8, 5],
        },
      ],
    },
    {
      label: 'USB POLLING',
      content: [
        {
          label: 'Boot Polling Mode',
          type: 'dropdown',
          content: ['id_qmk_usb_bootmode', 13, 1],
          options: [
            ['8 kHz (HS)', 0],
            ['1 kHz (FS)', 3],
          ],
        },
        {
          label: 'Apply Selected Mode',
          type: 'toggle',
          content: ['id_qmk_usb_bootmode_apply', 13, 2],
        },
      ],
    },
    {
      label: 'SLEEP',
      content: [
        {
          label: 'RGB Sleep',
          type: 'toggle',
          content: ['id_qmk_rgb_sleep_enable', 18, 3],
        },
      ],
    },
  ],
};
const eraDefinition = {
  name: 'Place test',
  vendorProductId: VPID,
  firmwareVersion: 0,
  keycodes: [],
  menus: [feature, system],
  matrix: {rows: 1, cols: 1},
  layouts,
};
const menuData = {
  id_qmk_kill_switch_enable_lr: [0],
  id_qmk_debounce_mode: [0],
  id_qmk_tapping_global_term_exact: [0, 200],
  id_qmk_usb_bootmode: [0],
  id_qmk_usb_bootmode_apply: [0],
  id_qmk_rgb_sleep_enable: [1],
};

const {
  BACKLIGHT_BRIGHTNESS,
  BACKLIGHT_EFFECT,
  BACKLIGHT_USE_ISO_ENTER,
  BACKLIGHT_DISABLE_WHEN_USB_SUSPENDED,
} = LightingValue;
// An ordinary VIA keyboard on a V2 definition, its Lighting in three tabs.
const v2Definition = {
  name: 'Place test V2',
  vendorProductId: VPID,
  lighting: {
    extends: 'wt_rgb_backlight',
    supportedLightingValues: [
      BACKLIGHT_BRIGHTNESS,
      BACKLIGHT_USE_ISO_ENTER,
      BACKLIGHT_DISABLE_WHEN_USB_SUSPENDED,
    ],
  },
  matrix: {rows: 1, cols: 1},
  layouts,
};
// An ordinary VIA keyboard on a V3 definition with two of VIA's lighting menus,
// both titled Lighting.
const v3Definition = {
  name: 'Place test V3',
  vendorProductId: VPID,
  firmwareVersion: 0,
  keycodes: ['qmk_lighting'],
  menus: ['qmk_backlight', 'qmk_rgblight'],
  matrix: {rows: 1, cols: 1},
  layouts,
};
const v3LightingData = {
  id_qmk_backlight_brightness: [100],
  id_qmk_backlight_effect: [0],
  id_qmk_rgblight_brightness: [100],
  id_qmk_rgblight_effect: [0],
};
const lightingData = {
  [BACKLIGHT_BRIGHTNESS]: [100],
  [BACKLIGHT_EFFECT]: [0],
  [BACKLIGHT_USE_ISO_ENTER]: [0],
  [BACKLIGHT_DISABLE_WHEN_USB_SUSPENDED]: [0],
};

const makeStore = () => configureStore({reducer});
type Store = ReturnType<typeof makeStore>;

type Board = {
  path: string;
  vendorId: number;
  productId: number;
  vendorProductId: number;
  productName: string;
  protocol: number;
  hasResolvedDefinition: true;
  requiredDefinitionVersion: 'v2' | 'v3';
};

const board = (
  path: string,
  {productId = PRODUCT_ID, version = 'v3' as 'v2' | 'v3'} = {},
): Board => ({
  path,
  vendorId: VENDOR_ID,
  productId,
  vendorProductId: VENDOR_ID * 0x10000 + productId,
  productName: 'Place test',
  protocol: version === 'v2' ? 9 : 12,
  hasResolvedDefinition: true,
  requiredDefinitionVersion: version,
});

// Selects a connected keyboard and loads it as far as Configure needs: its menu
// or lighting values read, its keymap in.
const load = async (store: Store, device: Board) => {
  const connectionGeneration = new KeyboardAPI(
    device.path,
  ).getConnectionGeneration();
  await act(async () => {
    store.dispatch(devices.selectDevice({device, connectionGeneration}));
    store.dispatch(
      device.requiredDefinitionVersion === 'v2'
        ? lighting.updateLighting({[device.path]: lightingData} as any)
        : menus.updateSelectedCustomMenuData({
            devicePath: device.path,
            menuData: {...menuData},
          }),
    );
    store.dispatch(
      keymap.saveKeymapSuccess({
        layers: [{keymap: [4], isLoaded: true}],
        devicePath: device.path,
        connectionGeneration,
      }),
    );
  });
};

// Plugs the keyboards in, then selects and loads the first.
const connect = async (store: Store, ...boards: Board[]) => {
  for (const device of boards) {
    registerHIDDeviceForTesting(
      device.path,
      new EchoKeyboard(
        device.vendorId,
        device.productId,
      ) as unknown as HIDDevice,
    );
    await new HID.HID(device.path).openPromise;
  }
  await act(async () => {
    store.dispatch(
      devices.updateConnectedDevices(
        Object.fromEntries(boards.map((device) => [device.path, device])),
      ),
    );
  });
  await load(store, boards[0]);
};

// Keyboards on the app's own ERA definition.
const openEraKeyboards = async (...boards: Board[]) => {
  setEraAdvancedMetadataForTesting({
    schemaVersion: 2,
    definitions: boards.map(({vendorProductId}) => ({
      id: `configure-place-${vendorProductId}`,
      vendorProductId,
      stateSync: false,
      exactMsFamily: 'qmk',
    })),
  });
  const store = makeStore();
  store.dispatch(
    definitions.updateEraDefinitions(
      Object.fromEntries(
        boards.map(({vendorProductId}) => [
          vendorProductId,
          {v3: {...eraDefinition, vendorProductId}},
        ]),
      ) as any,
    ),
  );
  await connect(store, ...boards);
  return store;
};
const openEraKeyboard = () => openEraKeyboards(board(PATH));

let renderer: ReactTestRenderer | undefined;
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

beforeEach(() => {
  // Dropdowns listen on the document while they are mounted.
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: new EventTarget(),
  });
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  resetHIDTransportForTesting();
  setEraAdvancedMetadataForTesting(null);
  if (originalDocument) {
    Object.defineProperty(globalThis, 'document', originalDocument);
  } else {
    Reflect.deleteProperty(globalThis, 'document');
  }
});

// Configure on its route: built anew each time the route is shown.
const show = async (store: Store) => {
  await act(async () => {
    renderer = create(
      <Provider store={store}>
        <I18nextProvider i18n={translations}>
          <ConfigurePane />
        </I18nextProvider>
      </Provider>,
    );
  });
};

// Another page, such as the firmware page or the key tester: Configure's route no
// longer matches and it unmounts.
const leave = () => {
  act(() => renderer?.unmount());
  renderer = undefined;
};

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');
const rail = () => renderer!.root.findAllByType(Row);
const titleOf = (row: ReactTestInstance): string =>
  row.findByType(RowName).props.children;
const railTitles = () => rail().map(titleOf);
const openMenu = () =>
  rail()
    .filter((row) => row.props.$selected)
    .map(titleOf);
const menu = (title: string) => rail().find((row) => titleOf(row) === title)!;
// Only submenu tabs: the rail rows and keyboard layers are pressed buttons too.
const tabs = () =>
  renderer!.root.findAllByType(SubmenuTabBar).flatMap((bar) =>
    bar.findAll(
      (node) =>
        node.type === 'button' && node.props['aria-pressed'] !== undefined,
    ),
  );
const openTab = () =>
  tabs()
    .filter((node) => node.props['aria-pressed'])
    .map(textOf);
const tab = (label: string) => tabs().find((node) => textOf(node) === label)!;
const click = async (node: ReactTestInstance) => {
  await act(async () => node.props.onClick({}));
};
const field = (label: string) =>
  renderer!.root
    .findAll(
      (node) =>
        node.type === 'div' &&
        String(node.props.id).startsWith('custom_menu') &&
        node.findAll(
          (child) => child.type === 'label' && textOf(child) === label,
        ).length > 0,
    )[0]
    .find(
      (node) => node.type === 'input' && node.props.inputMode === 'numeric',
    );
const hasDot = (node: ReactTestInstance) =>
  node.findAllByType(DirtyDot).length > 0;

describe('Configure opens where it was left', () => {
  test('VERSION, the firmware page and back: SYSTEM is open on VERSION', async () => {
    const store = await openEraKeyboard();
    await show(store);
    expect(railTitles()).toEqual([
      'Keymap',
      'Macros',
      'Save + Load',
      'FEATURE',
      'SYSTEM',
    ]);
    expect(openMenu()).toEqual(['Keymap']);

    await click(menu('SYSTEM'));
    expect(openTab()).toEqual(['VERSION']);

    leave();
    await show(store);
    expect(openMenu()).toEqual(['SYSTEM']);
    expect(openTab()).toEqual(['VERSION']);
  });

  // The keyboard reaches every menu on the rail, and a screen reader names it: the
  // rows are buttons, each named by its menu and pressed while it is open.
  test('the rail rows are buttons named by their menu, the open one pressed', async () => {
    const store = await openEraKeyboard();
    await show(store);
    await click(menu('FEATURE'));
    const rows = rail().map((row) => row.findByType('button').props);
    expect(
      rows.map((props) => [
        props.type,
        props['aria-label'],
        props['aria-pressed'],
      ]),
    ).toEqual([
      ['button', 'Keymap', false],
      ['button', 'Macros', false],
      ['button', 'Save + Load', false],
      ['button', 'FEATURE', true],
      ['button', 'SYSTEM', false],
    ]);
  });

  test('DEBOUNCE, the key tester and back: FEATURE is open on DEBOUNCE, the TAPPING draft kept', async () => {
    const store = await openEraKeyboard();
    await show(store);
    await click(menu('FEATURE'));
    expect(openTab()).toEqual(['SOCD']);
    await click(tab('TAPPING'));
    await act(async () =>
      field('Global Tapping Term').props.onChange({
        target: {value: '137'},
      }),
    );
    await click(tab('DEBOUNCE'));

    leave();
    await show(store);
    expect(openMenu()).toEqual(['FEATURE']);
    expect(openTab()).toEqual(['DEBOUNCE']);
    expect(hasDot(tab('TAPPING'))).toBe(true);
    await click(tab('TAPPING'));
    expect(field('Global Tapping Term').props.value).toBe('137');
  });

  test('a polling change restarts the keyboard onto another path: SYSTEM is open on USB POLLING when it is back', async () => {
    const store = await openEraKeyboard();
    await show(store);
    await click(menu('SYSTEM'));
    await click(tab('USB POLLING'));

    // The keyboard drops off USB while it restarts, and Configure gives way to
    // the loader.
    await act(async () => {
      store.dispatch(devices.updateConnectedDevices({}));
      store.dispatch(
        devices.selectDevice({device: null, connectionGeneration: null}),
      );
    });
    expect(rail()).toEqual([]);

    await connect(store, board(`${PATH}-after-restart`));
    expect(openMenu()).toEqual(['SYSTEM']);
    expect(openTab()).toEqual(['USB POLLING']);
  });

  test('finds a menu again by its name, never by its place on the rail', async () => {
    const store = await openEraKeyboard();
    await show(store);
    await click(menu('FEATURE'));
    leave();

    // Macros turn out unsupported, and every row after MACROS moves up one.
    store.dispatch(macros.setMacrosNotSupported());
    await show(store);
    expect(railTitles()).toEqual(['Keymap', 'Save + Load', 'FEATURE', 'SYSTEM']);
    expect(openMenu()).toEqual(['FEATURE']);
    leave();

    // A menu the keyboard no longer shows opens KEYMAP, not the row in its place.
    store.dispatch(
      configurePlace.openConfigureMenu({board: VPID, menu: 'Macros'}),
    );
    await show(store);
    expect(openMenu()).toEqual(['Keymap']);
  });

  test('two menus of one name: each row opens its own, also when Configure is shown again', async () => {
    const store = makeStore();
    store.dispatch(
      definitions.updateDefinitions({[VPID]: {v3: v3Definition}} as any),
    );
    await connect(store, board(PATH));
    await act(async () => {
      store.dispatch(
        menus.updateSelectedCustomMenuData({
          devicePath: PATH,
          menuData: {...v3LightingData},
        }),
      );
    });
    await show(store);
    expect(railTitles()).toEqual([
      'Keymap',
      'Macros',
      'Save + Load',
      'Lighting',
      'Lighting',
    ]);
    const openRow = () => rail().findIndex((row) => row.props.$selected);

    await click(rail()[4]);
    expect(openRow()).toBe(4);
    expect(openTab()).toEqual(['Underglow']);

    leave();
    await show(store);
    expect(openRow()).toBe(4);
    expect(openTab()).toEqual(['Underglow']);

    await click(rail()[3]);
    expect(openRow()).toBe(3);
    expect(openTab()).toEqual(['Backlight']);
  });

  test('keeps a place for each keyboard model, also when another is chosen from the badge', async () => {
    const first = board(PATH);
    const other = board(`${PATH}-other`, {productId: PRODUCT_ID + 1});
    const store = await openEraKeyboards(first, other);
    await show(store);
    await click(menu('SYSTEM'));

    await load(store, other);
    expect(openMenu()).toEqual(['Keymap']);
    await click(menu('FEATURE'));

    await load(store, first);
    expect(openMenu()).toEqual(['SYSTEM']);
    await load(store, other);
    expect(openMenu()).toEqual(['FEATURE']);
  });

  test("an ordinary VIA keyboard's Lighting opens on the tab it was left on", async () => {
    const store = makeStore();
    store.dispatch(
      definitions.updateDefinitions({[VPID]: {v2: v2Definition}} as any),
    );
    await connect(store, board(PATH, {version: 'v2'}));
    await show(store);
    expect(railTitles()).toEqual([
      'Keymap',
      'Macros',
      'Save + Load',
      'Lighting',
    ]);
    await click(menu('Lighting'));
    expect(tabs().map(textOf)).toEqual(['General', 'Layout', 'Advanced']);
    expect(openTab()).toEqual(['General']);
    await click(tab('Advanced'));

    leave();
    await show(store);
    expect(openMenu()).toEqual(['Lighting']);
    expect(openTab()).toEqual(['Advanced']);
  });
});
