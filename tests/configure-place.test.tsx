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
const {HostKeyboardLayoutBadge} =
  await import('../src/components/panes/configure-panes/host-keyboard-layout-badge');
const {keymapExtras} = await import('../src/utils/keymap-extras');
const {getSettings} = await import('../src/utils/device-store');
const {updateHostKeyboardLayout} = await import('../src/store/settingsSlice');

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
        {
          showIf: '{id_qmk_tapping_hold_on_other_key_press} == 0',
          label: 'Permissive Hold',
          type: 'toggle',
          content: ['id_qmk_tapping_permissive_hold', 15, 2],
        },
        {
          label: 'Hold on Other Key Press',
          type: 'toggle',
          content: ['id_qmk_tapping_hold_on_other_key_press', 15, 3],
        },
        {
          label: 'Retro Tapping',
          type: 'toggle',
          content: ['id_qmk_tapping_retro_tapping', 15, 4],
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
  id_qmk_tapping_permissive_hold: [1],
  id_qmk_tapping_hold_on_other_key_press: [0],
  id_qmk_tapping_retro_tapping: [1],
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
// An ordinary VIA keyboard, on its V2 or V3 definition.
const openViaKeyboard = async (version: 'v2' | 'v3') => {
  const store = makeStore();
  store.dispatch(
    definitions.updateDefinitions({
      [VPID]: version === 'v2' ? {v2: v2Definition} : {v3: v3Definition},
    } as any),
  );
  await connect(store, board(PATH, {version}));
  return store;
};

let renderer: ReactTestRenderer | undefined;
const originalDocument = Object.getOwnPropertyDescriptor(
  globalThis,
  'document',
);

// What one keyboard left behind, for the next to start from nothing.
const cleanUp = () => {
  act(() => renderer?.unmount());
  renderer = undefined;
  resetHIDTransportForTesting();
  setEraAdvancedMetadataForTesting(null);
};

beforeEach(() => {
  // Dropdowns listen on the document while they are mounted.
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: new EventTarget(),
  });
});

afterEach(() => {
  cleanUp();
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

// Queries return what a user sees; an expectation never takes a test instance,
// whose printout on a failure can exhaust memory.
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
  renderer!.root
    .findAllByType(SubmenuTabBar)
    .flatMap((bar) =>
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
  // Configure unmounts while another page is open: the firmware page, the key
  // tester. Back on it, the menu and its tab are as they were left, and so is a
  // value changed but not yet applied in another tab.
  test('back from another page, it opens on the menu and tab it was left on, a draft kept', async () => {
    const TERM = 'Global Tapping Term';
    const places: {
      keyboard: string;
      open: () => Promise<Store>;
      path: string[];
      draft?: string;
    }[] = [
      {keyboard: 'ERA', open: openEraKeyboard, path: ['SYSTEM', 'VERSION']},
      {
        keyboard: 'ERA',
        open: openEraKeyboard,
        path: ['FEATURE', 'TAPPING', 'DEBOUNCE'],
        draft: '137',
      },
      {
        keyboard: 'VIA V2',
        open: () => openViaKeyboard('v2'),
        path: ['Lighting', 'Advanced'],
      },
    ];
    for (const {keyboard, open, path, draft} of places) {
      cleanUp();
      const store = await open();
      await show(store);
      const [title, ...tabsOnTheWay] = path;
      await click(menu(title));
      for (const label of tabsOnTheWay) {
        await click(tab(label));
        if (label === 'TAPPING' && draft) {
          await act(async () =>
            field(TERM).props.onChange({target: {value: draft}}),
          );
        }
      }
      leave();
      await show(store);
      expect({keyboard, menu: openMenu(), tab: openTab()}).toEqual({
        keyboard,
        menu: [title],
        tab: [path.at(-1)],
      });
      if (draft) {
        expect(hasDot(tab('TAPPING'))).toBe(true);
        await click(tab('TAPPING'));
        expect(field(TERM).props.value).toBe(draft);
      }
    }
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
    expect(rail().length).toBe(0);

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
    expect(railTitles()).toEqual([
      'Keymap',
      'Save + Load',
      'FEATURE',
      'SYSTEM',
    ]);
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
    const store = await openViaKeyboard('v3');
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
});

// KEYMAP's LT·MT tab puts a hold on the selected key, says how the keyboard tells
// a tap from a hold and links to the TAPPING settings; from there "To Keymap" goes
// back to the key with the tab open.
describe('LT·MT and TAPPING', () => {
  // KEYMAP with layer 1 of two shown and the keyboard's one key, B there, selected.
  const openKeymap = async () => {
    const store = await openEraKeyboard();
    const connectionGeneration = new KeyboardAPI(
      PATH,
    ).getConnectionGeneration();
    await act(async () => {
      store.dispatch(
        keymap.saveKeymapSuccess({
          layers: [
            {keymap: [4], isLoaded: true},
            {keymap: [5], isLoaded: true},
          ],
          devicePath: PATH,
          connectionGeneration,
        }),
      );
    });
    await show(store);
    await act(async () => {
      store.dispatch(keymap.setLayer(1));
      store.dispatch(
        keymap.updateSelectedKey(
          0,
          definitions.getSelectedKeyDefinitions(store.getState() as any),
        ),
      );
    });
    return store;
  };
  const buttons = (label: string) =>
    renderer!.root.findAll(
      (node) =>
        node.type === 'button' &&
        (node.props['aria-label'] ?? textOf(node)) === label,
    );
  const button = (label: string) => buttons(label)[0];
  const wayBack = () => buttons('To Keymap').length;
  // The tab's rows of choices, each a group a screen reader names.
  const ROWS = ['Layer-Tap (LT)', 'Mod-Tap (MT)', 'Modifier combo'];
  const rows = () =>
    renderer!.root.findAll(
      (node) =>
        node.type === 'div' &&
        node.props.role === 'group' &&
        ROWS.includes(node.props['aria-label']),
    );
  const choice = (row: string, label: string) =>
    rows()
      .find((node) => node.props['aria-label'] === row)!
      .find((node) => node.type === 'button' && textOf(node) === label);
  // What the tab has pressed, row by row.
  const pressed = () =>
    rows().flatMap((row) =>
      row
        .findAll(
          (node) =>
            node.type === 'button' && node.props['aria-pressed'] === true,
        )
        .map((node) => `${row.props['aria-label']}: ${textOf(node)}`),
    );
  // The selected key as the keyboard holds it on layer 1.
  const held = (store: Store) =>
    store.getState().keymap.rawDeviceMap[PATH][1].keymap[0];
  // A choice pressed, once the keyboard has answered the key it writes.
  const press = async (store: Store, row: string, label: string) => {
    const before = held(store);
    await click(choice(row, label));
    for (let tries = 0; tries < 200 && held(store) === before; tries++) {
      await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
    }
  };
  const tappingLine = () =>
    buttons('TAPPING settings').map((link) =>
      link.parent!.parent!.children.map(textOf),
    );

  // Under the hold, the tapping term and the options that are on, read as the
  // TAPPING menu reads them; with any of them not read, no line at all.
  test('the LT·MT tab names the TAPPING settings, and its link opens them with a way back', async () => {
    const store = await openKeymap();
    const readTapping = (data: object) =>
      act(async () => {
        store.dispatch(
          menus.updateSelectedCustomMenuData({
            devicePath: PATH,
            menuData: data,
          }),
        );
      });
    expect(tappingLine()).toEqual([]);
    await click(button('LT·MT'));
    expect(rows().map((row) => row.props['aria-label'])).toEqual(ROWS);
    // Permissive Hold and Retro Tapping are on; Hold on Other Key Press is off.
    expect(tappingLine()).toEqual([
      [
        'Tap-hold decision',
        'Term 200 ms · Permissive Hold · Retro Tapping',
        'TAPPING settings',
      ],
    ]);
    const {id_qmk_tapping_retro_tapping: _, ...withoutRetro} = menuData;
    await readTapping(withoutRetro);
    expect(tappingLine()).toEqual([]);
    await readTapping({...menuData});

    await click(button('TAPPING settings'));
    expect(openMenu()).toEqual(['FEATURE']);
    expect(openTab()).toEqual(['TAPPING']);
    expect(wayBack()).toBe(1);
    // Leaving KEYMAP let go of the key, as leaving it any other way does.
    expect(store.getState().keymap.selectedKey).toBeNull();
    // The way back belongs to the tab the link opened.
    await click(tab('DEBOUNCE'));
    expect(wayBack()).toBe(0);
    await click(tab('TAPPING'));
    expect(wayBack()).toBe(1);
  });

  test('a hold goes on the key itself, and "To Keymap" goes back to the key, the layer and the LT·MT tab', async () => {
    const store = await openKeymap();
    await click(button('LT·MT'));
    expect(pressed()).toEqual([]);
    await press(store, 'Mod-Tap (MT)', 'Shift');
    // MT(MOD_LSFT, KC_B) is written on the key, which stays selected.
    expect(held(store)).toBe(0x2205);
    expect(store.getState().keymap.selectedKey).toBe(0);
    expect(pressed()).toEqual(['Mod-Tap (MT): Shift']);

    await click(button('TAPPING settings'));
    await act(async () => store.dispatch(keymap.setLayer(0)));
    await click(button('To Keymap'));
    expect(openMenu()).toEqual(['Keymap']);
    expect(store.getState().keymap.selectedKey).toBe(0);
    expect(store.getState().keymap.selectedLayerIndex).toBe(1);
    expect(button('LT·MT').props['aria-pressed']).toBe(true);
    expect(pressed()).toEqual(['Mod-Tap (MT): Shift']);
    // Used once: TAPPING opened again from the rail has no way back.
    expect(store.getState().configurePlace[VPID].ltmt).toBeUndefined();
    await click(menu('FEATURE'));
    expect(openTab()).toEqual(['TAPPING']);
    expect(wayBack()).toBe(0);
  });

  test('another menu or another keyboard ends the way back', async () => {
    const store = await openKeymap();
    await click(button('LT·MT'));
    await click(button('TAPPING settings'));
    await click(menu('SYSTEM'));
    await click(menu('FEATURE'));
    expect(openTab()).toEqual(['TAPPING']);
    expect(wayBack()).toBe(0);

    // KEYMAP from the rail opens on its keys, with no key selected.
    await click(menu('Keymap'));
    expect(button('LT·MT').props['aria-pressed']).toBe(false);
    await act(async () => {
      store.dispatch(
        keymap.updateSelectedKey(
          0,
          definitions.getSelectedKeyDefinitions(store.getState() as any),
        ),
      );
    });
    await click(button('LT·MT'));
    await click(button('TAPPING settings'));
    expect(wayBack()).toBe(1);
    await load(store, board(PATH));
    expect(wayBack()).toBe(0);
    expect(store.getState().configurePlace[VPID].ltmt).toBeUndefined();
  });
});

describe('Host keyboard layout menu', () => {
  // On an ordinary VIA keyboard, V2 or V3: Enter or Space on the native button
  // opens the list on the layout in use, the arrow keys move through it and Escape
  // closes it with focus back on the button. A layout chosen is saved as a setting
  // and changes nothing about the keyboard.
  test('the layout badge is worked by keyboard, and a layout chosen is a setting only', async () => {
    for (const version of ['v2', 'v3'] as const) {
      cleanUp();
      const store = await openViaKeyboard(version);
      const initial = store.getState();
      const previousLayout = getSettings().hostKeyboardLayout;
      const focused: string[] = [];
      const nativeButtons = new Map<string, {focus: () => void}>();
      act(() => {
        renderer = create(
          <Provider store={store}>
            <HostKeyboardLayoutBadge />
          </Provider>,
          {
            createNodeMock: ({type, props}) => {
              if (type !== 'button') return null;
              const identity =
                props.role === 'menuitemradio'
                  ? props.children
                  : 'host-layout-trigger';
              const existing = nativeButtons.get(identity);
              if (existing) return existing;
              const node = {
                focus: () => {
                  (document as any).activeElement = node;
                  focused.push(props['aria-label'] ?? props.children);
                },
                getBoundingClientRect: () => ({
                  right: 163,
                  top: 50,
                  bottom: 75,
                }),
              };
              nativeButtons.set(identity, node);
              return node;
            },
          },
        );
      });
      try {
        const root = renderer!.root;
        const trigger = () =>
          root.find(
            (node) =>
              node.type === 'button' && node.props['aria-haspopup'] === 'menu',
          );
        const choices = () =>
          root.findAll(
            (node) =>
              node.type === 'button' && node.props.role === 'menuitemradio',
          );
        const key = (name: string) => {
          const container = root.find(
            (node) => node.type === 'div' && node.props.onKeyDown,
          );
          act(() =>
            container.props.onKeyDown({
              key: name,
              preventDefault: () => undefined,
            }),
          );
        };
        const labels = Object.values(keymapExtras).map(({label}) => label);
        expect(trigger().props['aria-label']).toBe('English (US)');

        // Enter and Space on the native button emit a click with detail 0.
        act(() => trigger().props.onClick({detail: 0}));
        expect(trigger().props['aria-expanded']).toBe(true);
        expect(focused.at(-1)).toBe('English (US)');
        key('ArrowDown');
        expect(focused.at(-1)).toBe(labels[1]);
        expect(store.getState()).toBe(initial);
        key('Escape');
        expect(trigger().props['aria-expanded']).toBe(false);
        expect(focused.at(-1)).toBe('English (US)');

        key('ArrowDown');
        expect(trigger().props['aria-expanded']).toBe(true);
        const canadian = Object.keys(keymapExtras).indexOf(
          'keymap_canadian_multilingual',
        );
        for (let index = 0; index < canadian; index++) key('ArrowDown');
        const choice = choices().find((node) => node.props.tabIndex === 0)!;
        expect(textOf(choice)).toBe('Canadian Multilingual');
        act(() => choice.props.onClick({detail: 0}));

        expect({
          version,
          setting: store.getState().settings.hostKeyboardLayout,
          saved: getSettings().hostKeyboardLayout,
          shown: trigger().props['aria-label'],
          open: trigger().props['aria-expanded'],
        }).toEqual({
          version,
          setting: 'keymap_canadian_multilingual',
          saved: 'keymap_canadian_multilingual',
          shown: 'Canadian Multilingual',
          open: false,
        });
        const {settings: initialSettings, ...initialKeyboard} = initial;
        const {settings: currentSettings, ...currentKeyboard} =
          store.getState();
        expect(currentKeyboard).toEqual(initialKeyboard);
        expect({
          ...currentSettings,
          hostKeyboardLayout: initialSettings.hostKeyboardLayout,
        }).toEqual(initialSettings);
      } finally {
        store.dispatch(updateHostKeyboardLayout(previousLayout));
      }
    }
  });
});
