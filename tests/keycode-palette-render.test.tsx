import {configureStore} from '@reduxjs/toolkit';
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
import i18n from 'i18next';
import type {ReactElement, ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {I18nextProvider} from 'react-i18next';
import {Provider} from 'react-redux';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type TestRendererOptions,
} from 'react-test-renderer';
import {getByteToKey, getKeycodes} from '../src/utils/key';
import v13BasicKeyToByte from '../src/utils/key-to-byte/v13';
import {
  buildEnabledKeycodeMenus,
  menusWithTapDanceKeycodes,
} from '../src/utils/keycode-menus';
import {getTapDanceSlots} from '../src/utils/keycode-palette';
import {selectKeycodeFromMenuCode} from '../src/utils/keycode-picker';
import {setEraAdvancedMetadataForTesting} from '../src/utils/era-advanced-metadata';
import type {TapDanceBinding} from '../src/components/inputs/keycode-palette/use-tap-dance';

// The palette's windows are portalled into the page body, which the test renderer
// has not got, so they are drawn in place. A mocked module stays mocked for the
// test files run after this one, so the real exports, copied before the mock
// replaces them in place, go back once this file is done.
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
const {KeyboardAPI} = await import('../src/utils/keyboard-api');
const {KeycodePalette} =
  await import('../src/components/inputs/keycode-palette/keycode-palette');
const {useTapDanceBinding} =
  await import('../src/components/inputs/keycode-palette/use-tap-dance');
const {PelpiKeycodeInput} =
  await import('../src/components/inputs/pelpi/keycode-input');
const {DirtyDot} = await import('../src/components/inputs/dirty-dot');
const {HID, registerHIDDeviceForTesting, resetHIDTransportForTesting} =
  await import('../src/shims/node-hid');
const {
  default: devicesReducer,
  selectDevice,
  updateConnectedDevices,
} = await import('../src/store/devicesSlice');
const {
  default: definitionsReducer,
  getSelectedKeyDefinitions,
  updateDefinitions,
  updateEraDefinitions,
} = await import('../src/store/definitionsSlice');
const {default: menusReducer, updateSelectedCustomMenuData} =
  await import('../src/store/menusSlice');
const {default: draftsReducer, setDraft} =
  await import('../src/store/draftsSlice');
const {default: stateSyncReducer} = await import('../src/store/stateSyncSlice');
const {default: firmwareReducer} = await import('../src/store/firmwareSlice');
const {default: settingsReducer} = await import('../src/store/settingsSlice');
const {
  default: keymapReducer,
  hoverKey,
  loadEncoderValues,
  loadLayerSuccess,
  setLayer,
  setNumberOfLayers,
  updateEncoderValue,
  updateSelectedKey,
} = await import('../src/store/keymapSlice');
const {default: macrosReducer} = await import('../src/store/macrosSlice');
const {default: configurePlaceReducer} =
  await import('../src/store/configurePlaceSlice');
const {getNextKey} = await import('../src/utils/keyboard-rendering');
const {KeycodePane} =
  await import('../src/components/panes/configure-panes/keycode');
const {Pane: EncoderPane} =
  await import('../src/components/panes/configure-panes/encoder');

const translations = i18n.createInstance();
await translations.init({lng: 'en', resources: {en: {translation: {}}}});

const store = configureStore({
  reducer: (state = {settings: {themeName: 'OLIVIA_DARK'}}) => state,
});
// The app's store, for KEYMAP over a keyboard that answers as VIA firmware does.
const makeStore = () =>
  configureStore({
    reducer: {
      settings: settingsReducer,
      devices: devicesReducer,
      definitions: definitionsReducer,
      menus: menusReducer,
      drafts: draftsReducer,
      stateSync: stateSyncReducer,
      firmware: firmwareReducer,
      keymap: keymapReducer,
      macros: macrosReducer,
      configurePlace: configurePlaceReducer,
    },
  });
type Store = ReturnType<typeof makeStore>;

const definition = JSON.parse(
  readFileSync('public/definitions/era/v3/1163042818.json', 'utf8'),
);
const VPID: number = definition.vendorProductId;
const byteToKey = getByteToKey(v13BasicKeyToByte);
const baseMenus = menusWithTapDanceKeycodes(
  getKeycodes().filter((menu) =>
    ['basic', 'layers', 'macro'].includes(menu.id),
  ),
  definition.tapdanceKeycodes,
);
const tapDanceFirst = [
  baseMenus.find((menu) => menu.id === 'tapdance')!,
  ...baseMenus.filter((menu) => menu.id !== 'tapdance'),
];
const SELECTED = {name: 'Selected key', value: 0x04};
const TD0_VALUE = selectKeycodeFromMenuCode('TD(0)', v13BasicKeyToByte)!;
const MO1 = selectKeycodeFromMenuCode('MO(1)', v13BasicKeyToByte)!;

type Props = Partial<Parameters<typeof KeycodePalette>[0]>;

const binding = (
  read: TapDanceBinding['read'],
  overrides: Partial<TapDanceBinding> = {},
): TapDanceBinding => ({
  slots: getTapDanceSlots(definition),
  read,
  changes: () => ({}),
  setChanges: () => undefined,
  termBounds: () => ({minMs: 1, maxMs: 65535}),
  canWrite: true,
  unverified: false,
  failed: false,
  write: async () => true,
  ...overrides,
});
// Tap Dances the keyboard has reported, keeping what is set on them as the store
// does: TD0 taps Esc and holds Left Ctrl, the others are empty.
const tapDance = (overrides: Partial<TapDanceBinding> = {}) => {
  const changes = new Map<number, ReturnType<TapDanceBinding['changes']>>();
  return binding(
    (slot) => ({
      actions:
        slot.index === 0
          ? {tap: 0x29, hold: 0xe0, dtap: 0, thold: 0}
          : {tap: 0, hold: 0, dtap: 0, thold: 0},
      term: '200',
    }),
    {
      changes: (slot) => changes.get(slot.index) ?? {},
      setChanges: (slot, next) => {
        changes.set(slot.index, next);
      },
      ...overrides,
    },
  );
};

const palette = (
  props: Props = {},
  onAssign: Props['onAssign'] = () => undefined,
) => (
  <Provider store={store}>
    <I18nextProvider i18n={translations}>
      <KeycodePalette
        menus={baseMenus}
        basicKeyToByte={v13BasicKeyToByte}
        byteToKey={byteToKey}
        target={SELECTED}
        onAssign={onAssign}
        layerCount={4}
        {...props}
      />
    </I18nextProvider>
  </Provider>
);
const markup = (props: Props = {}) => renderToStaticMarkup(palette(props));

// The page the palette's windows open over: they make the rest of its body inert,
// and here nothing else is on it. Focus is on the element focused last, if any.
type Focusable = {name: string; focus: () => void};
const page = {children: [] as unknown[]};
let focused: Focusable | null = null;
let renderer: ReactTestRenderer | undefined;
const originalDocument = Object.getOwnPropertyDescriptor(
  globalThis,
  'document',
);

const cleanUp = () => {
  act(() => renderer?.unmount());
  renderer = undefined;
  focused = null;
  resetHIDTransportForTesting();
  setEraAdvancedMetadataForTesting(null);
};

beforeEach(() => {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      body: page,
      get activeElement() {
        return focused ?? page;
      },
    },
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

const mount = (element: ReactElement, options?: TestRendererOptions) => {
  act(() => renderer?.unmount());
  act(() => {
    renderer = create(element, options);
  });
  return renderer!.root;
};
// The palette as a host drives it: every put is recorded, and the host can select
// another key or put a new value on it.
const mountPalette = (props: Props = {}) => {
  const puts: {value: number; stay: boolean}[] = [];
  let current = props;
  const element = () =>
    palette(current, (value, options) =>
      puts.push({value, stay: !!options?.stay}),
    );
  const root = mount(element());
  const update = (next: Props) => {
    current = {...current, ...next};
    act(() => renderer!.update(element()));
  };
  return {root, puts, update};
};

const until = async (done: () => boolean) => {
  for (let tries = 0; tries < 200 && !done(); tries++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
  }
};

// Queries return what a user sees or a screen reader is told; an expectation never
// takes a test instance, whose printout on a failure can exhaust memory.
const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');
// The words a screen reader gets: what is marked aria-hidden is left out.
const spoken = (node: ReactTestInstance | string): string =>
  typeof node === 'string'
    ? node
    : node.props['aria-hidden']
      ? ''
      : node.children.map(spoken).join('');
const buttons = (
  root: ReactTestInstance,
  test: (node: ReactTestInstance) => boolean,
) => root.findAll((node) => node.type === 'button' && test(node));
const button = (root: ReactTestInstance, label: string) =>
  root.find(
    (node) =>
      node.type === 'button' &&
      (node.props['aria-label'] ?? textOf(node)) === label,
  );
// A category tab: a button that says whether it is pressed, named by its text.
const tab = (root: ReactTestInstance, label: string) =>
  root.find(
    (node) =>
      node.type === 'button' &&
      node.props['aria-pressed'] !== undefined &&
      node.props.title === undefined &&
      textOf(node) === label,
  );
const click = (node: ReactTestInstance) => act(() => node.props.onClick());
const search = (root: ReactTestInstance) =>
  root.find((node) => node.type === 'input' && node.props.type === 'search');
const type = (root: ReactTestInstance, value: string) =>
  act(() => search(root).props.onChange({target: {value}}));
const enter = (root: ReactTestInstance) =>
  act(() => search(root).props.onKeyDown({key: 'Enter'}));
const announced = (root: ReactTestInstance) =>
  textOf(
    root.find(
      (node) => node.type === 'span' && node.props['aria-live'] === 'polite',
    ),
  );
// The lines that say why nothing can be done yet.
const statuses = (root: ReactTestInstance) =>
  root
    .findAll(
      (node) =>
        typeof node.type === 'string' &&
        node.props.role === 'status' &&
        node.props['aria-live'] === undefined,
    )
    .map(textOf);
// The keys as a whole, which the pointer and focus leave.
const grid = (root: ReactTestInstance) =>
  root.find(
    (node) =>
      node.type === 'div' && typeof node.props.onMouseLeave === 'function',
  );
const inGrid = (node: ReactTestInstance): boolean =>
  !!node.parent &&
  (typeof node.parent.props.onMouseLeave === 'function' || inGrid(node.parent));
// The corner that describes a key: its QMK code and hex.
const corner = (root: ReactTestInstance) =>
  root.findAll((node) => node.type === 'code' && !inGrid(node)).map(textOf);
const hover = (root: ReactTestInstance, label: string) =>
  act(() => button(root, label).props.onMouseEnter());

// The LT·MT tab's rows of choices, each a group a screen reader names: by their
// English names unless others are given.
const LTMT_ROWS = ['Layer-Tap (LT)', 'Mod-Tap (MT)', 'Modifier combo'];
const ltmtRows = (root: ReactTestInstance, names = LTMT_ROWS) =>
  root.findAll(
    (node) =>
      node.type === 'div' &&
      node.props.role === 'group' &&
      names.includes(node.props['aria-label']),
  );
const ltmtChoice = (root: ReactTestInstance, row: string, label: string) =>
  ltmtRows(root, [row])[0].find(
    (node) => node.type === 'button' && textOf(node) === label,
  );
// What the rows have pressed, as "row: choice".
const ltmtPressed = (root: ReactTestInstance) =>
  ltmtRows(root).flatMap((row) =>
    row
      .findAll(
        (node) => node.type === 'button' && node.props['aria-pressed'] === true,
      )
      .map((node) => `${row.props['aria-label']}: ${textOf(node)}`),
  );
// The name a screen reader gives the hold: its title, which names the key held.
const holdName = (root: ReactTestInstance) => {
  const hold = root.find(
    (node) =>
      node.type === 'div' &&
      node.props.role === 'group' &&
      node.props['aria-labelledby'] !== undefined,
  );
  return textOf(
    root.find(
      (node) =>
        typeof node.type === 'string' &&
        node.props.id === hold.props['aria-labelledby'],
    ),
  );
};

// A Tap Dance is edited in a window over the page, its editor above the keys.
const dialogs = (root: ReactTestInstance) =>
  root.findAll((node) => node.type === 'div' && node.props.role === 'dialog');
const windowOf = (root: ReactTestInstance) =>
  root.find((node) => node.type === 'div' && node.props.role === 'dialog');
const close = (root: ReactTestInstance) =>
  click(button(windowOf(root), 'Close'));
// The editor's actions: the pressable buttons in its group of them.
const slotButtons = (root: ReactTestInstance) =>
  root
    .find(
      (node) =>
        node.type === 'div' &&
        node.props.role === 'group' &&
        node.props['aria-label'] === 'Tap Dance actions',
    )
    .findAll(
      (node) =>
        node.type === 'button' && node.props['aria-pressed'] !== undefined,
    );
const slotButton = (root: ReactTestInstance, role: string) =>
  slotButtons(root).find((node) => spoken(node).startsWith(role))!;
// A key for an action: the action chosen in the editor, then its key in the window.
const pick = (root: ReactTestInstance, role: string, key: string) => {
  click(slotButton(root, role));
  click(button(windowOf(root), `${role}: ${key}`));
};

describe('the palette', () => {
  test('marks the key the target holds, in the grid and in the Tap Dance list', () => {
    const marked = (html: string) =>
      [...html.matchAll(/<button[^>]*aria-current="true"[^>]*>/g)].map(
        ([tag]) => /aria-label="([^"]*)"/.exec(tag)?.[1],
      );
    expect(marked(markup())).toEqual(['A']);
    expect(
      marked(
        markup({
          menus: tapDanceFirst,
          target: {...SELECTED, value: TD0_VALUE},
          tapDance: tapDance(),
        }),
      ),
    ).toEqual(['Put TD0 on the selected key']);
  });

  // Firmware that State Sync could not verify has its Tap Dance left unread, and
  // firmware older than its definition can refuse to report it. Either way the TD
  // keys stay on offer as plain keys, and the tab says once what the feature tabs
  // say. A refusal of an older revision leaves the values read since.
  test('the Tap Dance tab lists what the keyboard reported, or offers the TD keys with the reason it cannot', () => {
    const UNVERIFIED =
      'Unable to verify feature support. Reconnect the keyboard. If the problem persists, update to the latest firmware.';
    const FAILED =
      'Unable to load feature settings. Reconnect the keyboard and try again.';
    const onTapDance = (tapDance: TapDanceBinding) =>
      markup({
        menus: tapDanceFirst,
        target: {...SELECTED, value: TD0_VALUE},
        tapDance,
      });
    // KEYMAP's own binding, over CONFIG as State Sync left it.
    const refused = (acceptedRevision: number, refusedRevision: number) => {
      const path = 'keycode-palette-refused';
      const identity = `${VPID}:v3:0`;
      // Every Tap Dance value, as an earlier read of CONFIG left them.
      const menuData = Object.fromEntries(
        getTapDanceSlots(definition).flatMap((slot) => [
          ...Object.values(slot.actions).map(({name}) => [name, [0, 0]]),
          ...(slot.term ? [[slot.term.name, [0, 200]]] : []),
        ]),
      );
      const state = {
        settings: {themeName: 'OLIVIA_DARK'},
        definitions: {
          definitions: {},
          customDefinitions: {},
          eraDefinitions: {[VPID]: {v3: definition}},
          definitionEpochs: {},
        },
        devices: {
          selectedDevicePath: path,
          selectedConnectionGeneration: 0,
          selectionGeneration: 1,
          connectedDevicePaths: {
            [path]: {
              path,
              vendorProductId: VPID,
              requiredDefinitionVersion: 'v3',
            },
          },
        },
        menus: {
          customMenuDataMap: acceptedRevision ? {[path]: menuData} : {},
        },
        firmware: firmwareReducer(undefined, {type: '@@INIT'}),
        keymap: {
          ...keymapReducer(undefined, {type: '@@INIT'}),
          numberOfLayersMap: {[path]: 4},
        },
        macros: macrosReducer(undefined, {type: '@@INIT'}),
        drafts: {},
        stateSync: {
          byPath: {
            [path]: {
              capability: 'capable',
              generation: 0,
              config: {
                status: 'dirty',
                observedRevision: 2,
                acceptedRevision,
                mutationEpoch: 0,
                foregroundWriteDepth: 0,
                acceptedSelectionGeneration: 1,
                acceptedDefinitionIdentity: identity,
                failedRead: {
                  revision: refusedRevision,
                  mutationEpoch: 0,
                  selectionGeneration: 1,
                  definitionIdentity: identity,
                },
              },
            },
          },
        },
      };
      const Keymap = () => (
        <KeycodePalette
          menus={tapDanceFirst}
          basicKeyToByte={v13BasicKeyToByte}
          byteToKey={byteToKey}
          target={{...SELECTED, value: TD0_VALUE}}
          onAssign={() => undefined}
          layerCount={4}
          tapDance={useTapDanceBinding(definition)}
        />
      );
      setEraAdvancedMetadataForTesting({
        schemaVersion: 2,
        definitions: [
          {
            id: path,
            vendorProductId: VPID,
            stateSync: true,
            exactMsFamily: 'qmk',
          },
        ],
      });
      return renderToStaticMarkup(
        <Provider store={configureStore({reducer: () => state as any})}>
          <I18nextProvider i18n={translations}>
            <Keymap />
          </I18nextProvider>
        </Provider>,
      );
    };
    // [the keyboard, what the tab shows, Edit buttons on and off, TD keys, notes]
    const states: [string, () => string, string, number, number, number][] = [
      [
        'reported',
        () => onTapDance(tapDance()),
        'TD0Esc·Left Ctrl·—·—200 msEdit',
        8,
        0,
        0,
      ],
      [
        'not reported yet',
        () => onTapDance(binding(() => null)),
        'Waiting for the keyboard',
        0,
        8,
        0,
      ],
      [
        'unverified',
        () =>
          onTapDance(binding(() => null, {unverified: true, canWrite: false})),
        UNVERIFIED,
        0,
        0,
        8,
      ],
      ['refused, never read', () => refused(0, 2), FAILED, 0, 0, 8],
      ['refused, read before', () => refused(1, 2), FAILED, 0, 0, 8],
      [
        'refused an older revision',
        () => refused(1, 1),
        'TD0Empty200 msEdit',
        8,
        0,
        0,
      ],
    ];
    for (const [keyboard, html, shows, on, off, keys] of states) {
      const shown = html();
      const text = shown.replace(/<[^>]+>/g, '');
      const edits = shown.match(/<button[^>]*aria-label="Edit TD\d"[^>]*>/g);
      const tdKeys = shown.match(
        /<button[^>]*aria-label="Tap Dance \d"[^>]*>/g,
      );
      const disabled = (tag: string) => tag.includes('disabled=""');
      expect({
        keyboard,
        shows: text.includes(shows),
        on: (edits ?? []).filter((tag) => !disabled(tag)).length,
        off: (edits ?? []).filter(disabled).length,
        keys: (tdKeys ?? []).filter((tag) => !disabled(tag)).length,
        notes: [UNVERIFIED, FAILED].map((note) => text.split(note).length - 1),
      }).toEqual({
        keyboard,
        shows: true,
        on,
        off,
        keys,
        notes: [shows === UNVERIFIED ? 1 : 0, shows === FAILED ? 1 : 0],
      });
    }
  });

  // The palette is for every VIA keyboard. A stock definition has no ERA Tap Dance
  // entries, so its keyboard is not offered a feature its firmware does not have.
  test('a stock VIA keyboard gets the palette without Tap Dance', () => {
    const stock = JSON.parse(
      readFileSync('public/definitions/v3/105185281.json', 'utf8'),
    );
    const menusOf = (keyboard: unknown) =>
      buildEnabledKeycodeMenus({
        definition: keyboard as typeof definition,
        basicKeyToByte: v13BasicKeyToByte,
        protocol: 12,
      });
    const html = markup({menus: menusOf(stock)});
    expect(html).not.toContain('Tap Dance');
    expect(html).not.toMatch(/TD\d/);
    expect(html).toContain('>LT·MT</button>');
    expect(menusOf(definition).map((menu) => menu.id)).toContain('tapdance');
  });

  test('the Layers tab and search offer only the layers the keyboard has', () => {
    const layersFirst = [
      baseMenus.find((menu) => menu.id === 'layers')!,
      ...baseMenus.filter((menu) => menu.id !== 'layers'),
    ];
    const keys = (layerCount: number) =>
      [
        ...markup({menus: layersFirst, layerCount}).matchAll(
          /<button[^>]*aria-label="([^"]*)"/g,
        ),
      ].map(([, label]) => label);
    const two = keys(2);
    expect(two).toContain('Momentary turn layer 1 on');
    expect(two).not.toContain('Momentary turn layer 2 on');
    expect(two).toContain('Hold = Layer 1, Tap = Space');
    expect(two).not.toContain('Hold = Layer 2, Tap = Space');
    expect(two).not.toContain('Hold = Layer 1, Hold with Fn2 = Layer 3');
    expect(keys(4)).toContain('Hold = Layer 1, Hold with Fn2 = Layer 3');

    const {root} = mountPalette({layerCount: 4});
    type(root, 'layer 5');
    expect(textOf(grid(root))).toBe('No matches');
  });

  // What the palette draws itself reads in the app's language, as the tabs beside
  // it do, and a search finds LT·MT by its names in that language.
  test('reads in the app’s language', async () => {
    const ko = i18n.createInstance();
    await ko.init({
      lng: 'ko',
      resources: {
        ko: {
          translation: JSON.parse(readFileSync('src/locales/ko.json', 'utf8')),
        },
      },
    });
    const root = mount(
      <Provider store={store}>
        <I18nextProvider i18n={ko}>
          <KeycodePalette
            menus={baseMenus}
            basicKeyToByte={v13BasicKeyToByte}
            byteToKey={byteToKey}
            target={{name: '선택한 키', value: 0x04}}
            onAssign={() => undefined}
            layerCount={4}
            tapDance={tapDance()}
          />
        </I18nextProvider>
      </Provider>,
    );
    type(root, 'TD');
    expect(textOf(root.find((node) => node.type === 'main'))).toContain(
      '탭댄스 · 8',
    );
    type(root, '');
    click(tab(root, '탭댄스'));
    expect(
      buttons(root, (node) => node.props['aria-label'] === 'TD0 동작 편집')
        .length,
    ).toBe(1);
    for (const words of ['레이어 탭', '모드탭']) {
      type(root, words);
      expect({
        words,
        found: buttons(root, (node) => textOf(node) === 'LT·MT 열기').length,
      }).toEqual({words, found: 1});
    }
    click(button(root, 'LT·MT 열기'));
    expect(holdName(root)).toBe('A 키를 누르고 있으면');
    const rows = ['레이어 탭 (LT)', '모드 탭 (MT)', '수식 키 조합'];
    expect(ltmtRows(root, rows).map((row) => row.props['aria-label'])).toEqual(
      rows,
    );
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('TAPDANCE');
  });
});

describe('picking and putting in', () => {
  // A key picked or a QMK code typed and entered goes on the selected key, which
  // then moves on. On a Layer-Tap or Mod-Tap it is what a tap sends, the hold kept
  // bit for bit; blank, pass-through and another hold replace the key, and a key a
  // tap cannot send takes the hold's place, which the announcement says.
  test('a key picked or a code typed goes on the selected key, keeping the hold a tap can keep', () => {
    const LT1_A = 0x4104;
    const typed = (code: string) => (root: ReactTestInstance) => {
      type(root, code);
      enter(root);
    };
    const picked =
      (...labels: string[]) =>
      (root: ReactTestInstance) =>
        labels.forEach((label) => click(button(root, label)));
    // [what, the key's value, how, the value put, what happens to the hold]
    const cases: [
      string,
      number,
      (root: ReactTestInstance) => void,
      number | null,
      string?,
    ][] = [
      ['a key', 0x04, picked('B'), 0x05],
      ['a code the results show too', 0x04, typed('KC_ESC'), 0x29],
      ['the search box’s example', 0x04, typed('LT(1,KC_SPC)'), 0x412c],
      ['a word, which is only a search', 0x04, typed('space'), null],
      ['a key on a Layer-Tap', LT1_A, picked('B'), 0x4105, 'Hold kept'],
      ['a code on a Mod-Tap', 0x2304, typed('KC_C'), 0x2306, 'Hold kept'],
      [
        'a key a tap cannot send',
        LT1_A,
        picked('Layers', 'Momentary turn layer 1 on'),
        MO1,
        'Hold removed',
      ],
      ['blank', LT1_A, typed('KC_NO'), 0],
      ['pass-through', LT1_A, typed('KC_TRNS'), 1],
      ['another hold', LT1_A, typed('LT(2,KC_D)'), 0x4207],
    ];
    for (const [what, value, how, put, hold] of cases) {
      const {root, puts} = mountPalette({target: {...SELECTED, value}});
      how(root);
      expect({
        what,
        puts,
        box: search(root).props.value,
        hold: hold && announced(root).endsWith(`· ${hold}`),
      }).toEqual({
        what,
        puts: put === null ? [] : [{value: put, stay: false}],
        box: put === null ? 'space' : '',
        hold: hold && true,
      });
    }
  });

  test('with no key selected, or one no hold goes on, nothing is put and the palette says why', () => {
    const SELECT = 'Select a key on the keyboard first';
    const {root, puts, update} = mountPalette({target: null});
    // A key or a typed code waits for a key to go on.
    click(button(root, 'B'));
    expect(announced(root)).toBe(SELECT);
    type(root, 'LT(2,KC_A)');
    enter(root);
    expect(search(root).props.value).toBe('LT(2,KC_A)');
    expect(puts).toEqual([]);
    update({target: SELECTED});
    enter(root);
    expect(puts).toEqual([{value: 0x4204, stay: false}]);

    // The LT·MT tab says why in place of its choices: blank sends nothing for a
    // tap, and a layer key is no tap key.
    click(tab(root, 'LT·MT'));
    for (const [value, says] of [
      [null, SELECT],
      [0x00, 'Choose a tap key first'],
      [MO1, 'LT·MT tap keys must be basic keycodes.'],
    ] as const) {
      update({target: value === null ? null : {...SELECTED, value}});
      expect({
        value,
        says: statuses(root),
        rows: ltmtRows(root).length,
      }).toEqual({value, says: [says], rows: 0});
    }
    update({target: SELECTED});
    click(ltmtChoice(root, 'Layer-Tap (LT)', '1'));
    expect(puts.at(-1)).toEqual({value: 0x4104, stay: true});
  });

  // LT·MT is a tab of its own, which a search by name leads to. Every choice is a
  // toggle that writes the selected key at once and keeps it selected: a layer is
  // one of its row and modifiers add up within theirs, a choice in another row
  // takes the place of what was on, and pressed again what is on comes off.
  test('LT·MT puts a layer or modifiers on the selected key, and a second press takes each off', () => {
    const {root, puts, update} = mountPalette();
    type(root, 'mod-tap');
    click(button(root, 'Open LT·MT'));
    expect(search(root).props.value).toBe('');
    expect(holdName(root)).toBe('While A is held');
    const press = (row: string, label: string) => {
      click(ltmtChoice(root, row, label));
      // The keyboard takes the key.
      update({target: {...SELECTED, value: puts.at(-1)!.value}});
      return ltmtPressed(root);
    };
    expect(press('Layer-Tap (LT)', '2')).toEqual(['Layer-Tap (LT): 2']);
    expect(press('Layer-Tap (LT)', '3')).toEqual(['Layer-Tap (LT): 3']);
    expect(press('Layer-Tap (LT)', '3')).toEqual([]);
    expect(press('Mod-Tap (MT)', 'Ctrl')).toEqual(['Mod-Tap (MT): Ctrl']);
    expect(press('Mod-Tap (MT)', 'Shift')).toEqual([
      'Mod-Tap (MT): Ctrl',
      'Mod-Tap (MT): Shift',
    ]);
    expect(press('Modifier combo', 'Alt')).toEqual(['Modifier combo: Alt']);
    expect(press('Mod-Tap (MT)', 'Win')).toEqual(['Mod-Tap (MT): Win']);
    expect(press('Mod-Tap (MT)', 'Win')).toEqual([]);
    // LT(2,KC_A), LT(3,KC_A), KC_A, MT(MOD_LCTL,KC_A), MT(MOD_LCTL|MOD_LSFT,KC_A),
    // A(KC_A), MT(MOD_LGUI,KC_A), KC_A.
    expect(puts).toEqual(
      [0x4204, 0x4304, 0x04, 0x2104, 0x2304, 0x0404, 0x2804, 0x04].map(
        (value) => ({value, stay: true}),
      ),
    );

    // A right-hand hold stays right-hand as a modifier goes on or off, in either
    // row, and its row says R. LT(0,KC_A) holds layer 0, which the row leaves out,
    // and LT(7,KC_A) a layer past this keyboard's: each gets a choice of its own,
    // lit, which leaves A alone.
    const kept: [number, string, string, string[], number][] = [
      // MT(MOD_RCTL|MOD_RSFT,KC_A) less Shift is MT(MOD_RCTL,KC_A), which with Alt
      // is MT(MOD_RCTL|MOD_RALT,KC_A).
      [
        0x3304,
        'Mod-Tap (MT)',
        'RShift',
        ['Mod-Tap (MT): RCtrl', 'Mod-Tap (MT): RShift'],
        0x3104,
      ],
      [0x3104, 'Mod-Tap (MT)', 'RAlt', ['Mod-Tap (MT): RCtrl'], 0x3504],
      // RCTL(RSFT(KC_A)) less Shift is RCTL(KC_A), which with Alt is
      // RCTL(RALT(KC_A)).
      [
        0x1304,
        'Modifier combo',
        'RShift',
        ['Modifier combo: RCtrl', 'Modifier combo: RShift'],
        0x1104,
      ],
      [0x1104, 'Modifier combo', 'RAlt', ['Modifier combo: RCtrl'], 0x1504],
      [0x4004, 'Layer-Tap (LT)', '0', ['Layer-Tap (LT): 0'], 0x04],
      [0x4704, 'Layer-Tap (LT)', '7', ['Layer-Tap (LT): 7'], 0x04],
    ];
    for (const [value, row, label, before, put] of kept) {
      update({target: {...SELECTED, value}});
      const pressed = ltmtPressed(root);
      click(ltmtChoice(root, row, label));
      expect({value, pressed, put: puts.at(-1)}).toEqual({
        value,
        pressed: before,
        put: {value: put, stay: true},
      });
    }
    // With the hold off, layer 0 is left out again.
    update({target: SELECTED});
    expect(
      ltmtRows(root, ['Layer-Tap (LT)'])[0]
        .findAll((node) => node.type === 'button')
        .map(textOf),
    ).toEqual(['1', '2', '3']);
    // Another category brings the keys back.
    click(tab(root, 'Layers'));
    expect(ltmtRows(root).length).toBe(0);
  });

  // The corner describes the key under the pointer only while it is there: the
  // pointer or focus leaving the keys, other keys on screen or another selected
  // key bring the selected key back. The Tap Dance list has no corner.
  test('the corner describes the key under the pointer, and the selected key once that key is gone', () => {
    const ESC = ['KC_ESC', '0x0029'];
    const A = ['KC_A', '0x0004'];
    const changes: [
      string,
      (root: ReactTestInstance, update: (next: Props) => void) => void,
      string[],
    ][] = [
      [
        'the pointer leaves the keys',
        (root) => act(() => grid(root).props.onMouseLeave()),
        A,
      ],
      [
        'focus leaves the keys',
        (root) =>
          act(() =>
            grid(root).props.onBlur({
              currentTarget: {contains: () => false},
              relatedTarget: null,
            }),
          ),
        A,
      ],
      ['a search is typed', (root) => type(root, 'f1'), A],
      ['another tab is chosen', (root) => click(tab(root, 'Layers')), A],
      [
        'another key is selected',
        (_, update) => update({target: {...SELECTED, value: 0x05}}),
        ['KC_B', '0x0005'],
      ],
    ];
    for (const [change, make, after] of changes) {
      const {root, update} = mountPalette({tapDance: tapDance()});
      hover(root, 'Esc');
      expect({change, corner: corner(root)}).toEqual({change, corner: ESC});
      make(root, update);
      expect({change, corner: corner(root)}).toEqual({change, corner: after});
    }

    const {root} = mountPalette({tapDance: tapDance()});
    click(tab(root, 'Tap Dance'));
    expect(corner(root)).toEqual([]);
    type(root, 'Esc');
    hover(root, 'Esc');
    expect(corner(root)).toEqual(ESC);
  });

  // On KEYMAP the keyboard's key under the pointer is described the same way, and
  // the selected key again once the pointer leaves it; a key in the list under the
  // pointer comes first. The Tap Dance list still has no corner.
  test('the corner describes the keyboard key under the pointer', () => {
    const ESC = ['KC_ESC', '0x0029'];
    const {root, update} = mountPalette({
      tapDance: tapDance(),
      keyboardHover: 0x29,
    });
    expect(corner(root)).toEqual(ESC);
    hover(root, 'B');
    expect(corner(root)).toEqual(['KC_B', '0x0005']);
    act(() => grid(root).props.onMouseLeave());
    expect(corner(root)).toEqual(ESC);
    update({keyboardHover: null});
    expect(corner(root)).toEqual(['KC_A', '0x0004']);
    update({keyboardHover: 0x29});
    click(tab(root, 'Tap Dance'));
    expect(corner(root)).toEqual([]);
  });

  // A live region speaks only when its text changes, so the same key put in again
  // is said after a separate empty update.
  test('each pick is announced, the same key again too', async () => {
    const {root} = mountPalette();
    click(button(root, 'B'));
    expect(announced(root)).toBe('Selected key ← B');
    click(button(root, 'B'));
    expect(announced(root)).toBe('');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(announced(root)).toBe('Selected key ← B');
  });
});

type InputListener = (event: {data: DataView}) => void;

// Echoes every command as VIA firmware does, and refuses the ones it is told to
// the way QMK refuses a value: the request sent back as id_unhandled. A reply it
// is told to hold waits for release(), as a slow keyboard's does.
class Keyboard {
  opened = false;
  vendorId = VPID >>> 16;
  productId = VPID & 0xffff;
  productName = 'Tap Dance';
  collections = [{usagePage: 0xff60, usage: 0x61}];
  listeners = new Set<InputListener>();
  sent: number[][] = [];
  refuse = (_bytes: number[]) => false;
  hold = (_bytes: number[]) => false;
  held: (() => void)[] = [];

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
    const bytes = [
      ...new Uint8Array(
        data instanceof Uint8Array ? data : (data as ArrayBuffer),
      ),
    ];
    this.sent.push(bytes);
    const reply = Uint8Array.from(bytes);
    if (this.refuse(bytes)) {
      reply[0] = 0xff;
    }
    const answer = () =>
      this.listeners.forEach((listener) =>
        listener({data: new DataView(reply.buffer)}),
      );
    if (this.hold(bytes)) {
      this.held.push(answer);
    } else {
      answer();
    }
  }
  release() {
    const replies = this.held;
    this.held = [];
    replies.forEach((answer) => answer());
  }
}

describe('KEYMAP', () => {
  const PATH = 'keycode-palette-keymap';
  const SET_KEY = 0x05;
  const {rows, cols} = definition.matrix;

  // Layer 0 holds A on every key but the selected one, Q, and the key after it, W.
  const connect = async () => {
    const keyboard = new Keyboard();
    registerHIDDeviceForTesting(PATH, keyboard as unknown as HIDDevice);
    await new HID.HID(PATH).openPromise;
    const store = makeStore();
    const device = {
      path: PATH,
      vendorId: VPID >>> 16,
      productId: VPID & 0xffff,
      vendorProductId: VPID,
      productName: 'Keymap',
      protocol: 12,
      hasResolvedDefinition: true,
      requiredDefinitionVersion: 'v3' as const,
    };
    const generation = new KeyboardAPI(PATH).getConnectionGeneration();
    store.dispatch(updateEraDefinitions({[VPID]: {v3: definition}} as any));
    store.dispatch(updateConnectedDevices({[PATH]: device}));
    store.dispatch(selectDevice({device, connectionGeneration: generation}));
    store.dispatch(
      setNumberOfLayers({
        devicePath: PATH,
        numberOfLayers: 4,
        connectionGeneration: generation,
      }),
    );
    const keys = getSelectedKeyDefinitions(store.getState() as any);
    const selected = 0;
    const next = getNextKey(selected, keys)!;
    const at = (index: number) => keys[index].row * cols + keys[index].col;
    const keymap = Array.from({length: rows * cols}, () => 0x04);
    keymap[at(selected)] = 0x14;
    keymap[at(next)] = 0x1a;
    store.dispatch(
      loadLayerSuccess({
        layerIndex: 0,
        keymap,
        devicePath: PATH,
        connectionGeneration: generation,
      }),
    );
    store.dispatch(updateSelectedKey(selected, keys));
    const valueOf = (index: number) =>
      store.getState().keymap.rawDeviceMap[PATH][0].keymap[at(index)];
    return {keyboard, store, keys, selected, next, valueOf};
  };

  test('a key picked is written to the selected key, which moves on to the next', async () => {
    const {keyboard, store, keys, selected, next, valueOf} = await connect();
    const root = mount(
      <Provider store={store}>
        <I18nextProvider i18n={translations}>
          <KeycodePane />
        </I18nextProvider>
      </Provider>,
    );
    click(button(root, 'Nothing'));
    await until(() => valueOf(selected) === 0);
    const {row, col} = keys[selected];
    expect(
      keyboard.sent
        .filter(([command]) => command === SET_KEY)
        .map((bytes) => bytes.slice(0, 6)),
    ).toEqual([[SET_KEY, 0, row, col, 0, 0]]);
    expect(valueOf(selected)).toBe(0);
    expect(valueOf(next)).toBe(0x1a);
    expect(store.getState().keymap.selectedKey).toBe(next);
  });

  // The keyboard's key under the pointer is named in the corner, as a key in the
  // list is. Leaving a key clears only that key, as the next may already be
  // reached; leaving the last brings the selected key back.
  test('the corner names the keyboard key under the pointer', async () => {
    const {store, selected, next} = await connect();
    const root = mount(
      <Provider store={store}>
        <I18nextProvider i18n={translations}>
          <KeycodePane />
        </I18nextProvider>
      </Provider>,
    );
    const Q = ['KC_Q', '0x0014'];
    const W = ['KC_W', '0x001A'];
    expect(corner(root)).toEqual(Q);
    act(() => store.dispatch(hoverKey({index: next, hovered: true})));
    expect(corner(root)).toEqual(W);
    act(() => store.dispatch(hoverKey({index: selected, hovered: false})));
    expect(corner(root)).toEqual(W);
    act(() => store.dispatch(hoverKey({index: next, hovered: false})));
    expect(corner(root)).toEqual(Q);
  });
});

describe('editing a Tap Dance', () => {
  const PATH = 'keycode-palette-editing';
  const SET = 0x07;
  const SAVE = 0x09;
  const MODE = 'id_qmk_tapdance_1_mode';
  const [TD0] = getTapDanceSlots(definition);
  const REFUSED =
    'Could not complete this change. Settings after it were not sent.';

  // TD0 taps Esc and holds Left Ctrl; every other action is empty, every term 200.
  const connect = async () => {
    setEraAdvancedMetadataForTesting({
      schemaVersion: 2,
      definitions: [
        {
          id: PATH,
          vendorProductId: VPID,
          stateSync: false,
          exactMsFamily: 'qmk',
        },
      ],
    });
    const keyboard = new Keyboard();
    registerHIDDeviceForTesting(PATH, keyboard as unknown as HIDDevice);
    await new HID.HID(PATH).openPromise;
    const store = makeStore();
    const device = {
      path: PATH,
      vendorId: VPID >>> 16,
      productId: VPID & 0xffff,
      vendorProductId: VPID,
      productName: 'Tap Dance',
      protocol: 12,
      hasResolvedDefinition: true,
      requiredDefinitionVersion: 'v3' as const,
    };
    store.dispatch(updateEraDefinitions({[VPID]: {v3: definition}} as any));
    store.dispatch(updateConnectedDevices({[PATH]: device}));
    store.dispatch(
      selectDevice({
        device,
        connectionGeneration: new KeyboardAPI(PATH).getConnectionGeneration(),
      }),
    );
    const menuData = Object.fromEntries(
      getTapDanceSlots(definition).flatMap((slot) => [
        ...Object.values(slot.actions).map(({name}) => [name, [0, 0]]),
        ...(slot.term ? [[slot.term.name, [0, 200]]] : []),
      ]),
    );
    menuData[TD0.actions.tap.name] = [0, 0x29];
    menuData[TD0.actions.hold.name] = [0, 0xe0];
    store.dispatch(updateSelectedCustomMenuData({devicePath: PATH, menuData}));
    return {keyboard, store};
  };

  // A second keyboard of the same model, plugged in beside the first.
  const plugIn = async (store: Store, path: string) => {
    const keyboard = new Keyboard();
    registerHIDDeviceForTesting(path, keyboard as unknown as HIDDevice);
    await new HID.HID(path).openPromise;
    const connected = store.getState().devices.connectedDevicePaths;
    const device = {...connected[PATH], path};
    store.dispatch(updateConnectedDevices({...connected, [path]: device}));
    return {keyboard, device};
  };
  const select = (
    store: Store,
    device: ReturnType<
      Store['getState']
    >['devices']['connectedDevicePaths'][string],
  ) =>
    act(() => {
      store.dispatch(
        selectDevice({
          device,
          connectionGeneration: new KeyboardAPI(
            device.path,
          ).getConnectionGeneration(),
        }),
      );
    });

  // TD0 with an Input start control, which the keyboard reports as Legacy.
  const withInputStart = (store: Store) => {
    const modeDefinition = structuredClone(definition);
    modeDefinition.tapdanceKeycodes[0].controls.push({
      label: 'Input start',
      type: 'dropdown',
      content: [MODE, 16, 49],
      options: [
        ['Legacy', 0],
        ['After decision', 1],
        ['On press', 2],
      ],
    });
    store.dispatch(updateEraDefinitions({[VPID]: {v3: modeDefinition}} as any));
    store.dispatch(
      updateSelectedCustomMenuData({
        devicePath: PATH,
        menuData: {
          ...store.getState().menus.customMenuDataMap[PATH],
          [MODE]: [0, 0xd2],
        },
      }),
    );
    return modeDefinition;
  };

  // TD0 as BRICK60 H7S firmware has it, with a hold decision of its own.
  const withHoldDecision = (store: Store) => {
    const holdDefinition = {
      ...definition,
      tapdanceKeycodes: JSON.parse(
        readFileSync(
          'era-definitions/custom/v3/brick60-h7s/BRICK60-H7S-VIA.json',
          'utf8',
        ),
      ).tapdanceKeycodes,
    };
    const [slot] = getTapDanceSlots(holdDefinition);
    store.dispatch(updateEraDefinitions({[VPID]: {v3: holdDefinition}} as any));
    store.dispatch(
      updateSelectedCustomMenuData({
        devicePath: PATH,
        menuData: {
          ...store.getState().menus.customMenuDataMap[PATH],
          [slot.mode!.name]: [1, 0xd2, 0xd3],
          [slot.holdTerm!.name]: [0, 180, 0xd3],
          [slot.holdOnOther!.name]: [0, 0xd3],
        },
      }),
    );
    return holdDefinition;
  };

  const Keymap = ({
    layerCount,
    selectedDefinition,
  }: {
    layerCount: number;
    selectedDefinition: typeof definition;
  }) => (
    <KeycodePalette
      menus={baseMenus}
      basicKeyToByte={v13BasicKeyToByte}
      byteToKey={byteToKey}
      target={SELECTED}
      onAssign={() => undefined}
      layerCount={layerCount}
      tapDance={useTapDanceBinding(selectedDefinition)}
    />
  );

  // KEYMAP as the rail, a route or an encoder leaves it and comes back: built anew.
  const show = (
    store: Store,
    layerCount = 4,
    selectedDefinition = definition,
  ) =>
    mount(
      <Provider store={store}>
        <I18nextProvider i18n={translations}>
          <Keymap
            layerCount={layerCount}
            selectedDefinition={selectedDefinition}
          />
        </I18nextProvider>
      </Provider>,
    );

  // The dot, drawn as itself or placed by a component built on it.
  const hasDot = (node: ReactTestInstance) =>
    node.findAll(
      (child) =>
        typeof child.type === 'string' &&
        String(child.props.className ?? '')
          .split(' ')
          .includes((DirtyDot as any).styledComponentId),
    ).length > 0;
  // A row of the Tap Dance list, found by its Edit button.
  const row = (root: ReactTestInstance, name: string) => {
    let node = button(root, `Edit ${name}`);
    while (node.parent && node.type !== 'div') {
      node = node.parent;
    }
    return node;
  };
  const term = (root: ReactTestInstance) =>
    root.find(
      (node) => node.type === 'input' && node.props.inputMode === 'numeric',
    );
  const typeTerm = (root: ReactTestInstance, value: string) =>
    act(() => term(root).props.onChange({target: {value}}));
  const save = (root: ReactTestInstance) => button(root, 'Save');
  const clickSave = async (root: ReactTestInstance) => {
    await act(async () => {
      await save(root).props.onClick();
    });
  };
  const alerts = (root: ReactTestInstance) =>
    root
      .findAll(
        (node) => typeof node.type === 'string' && node.props.role === 'alert',
      )
      .map(textOf);
  const writes = (keyboard: Keyboard) =>
    keyboard.sent
      .filter(([command]) => command === SET || command === SAVE)
      .map((bytes) => bytes.slice(0, bytes[0] === SET ? 5 : 2));
  const openTd0 = (root: ReactTestInstance) => {
    click(tab(root, 'Tap Dance'));
    click(button(root, 'Edit TD0'));
  };
  // Starts Save and lets it run until the keyboard sits on the write it holds. What
  // it returns answers that write and waits for Save to end.
  const saveHeld = async (
    keyboard: Keyboard,
    root: ReactTestInstance,
    isHeld: (bytes: number[]) => boolean,
  ) => {
    keyboard.hold = isHeld;
    let saving: Promise<void> = Promise.resolve();
    act(() => {
      saving = save(root).props.onClick();
    });
    for (let tries = 0; tries < 100 && keyboard.held.length === 0; tries++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(keyboard.held.length).toBe(1);
    return async () => {
      keyboard.hold = () => false;
      await act(async () => {
        keyboard.release();
        await saving;
      });
    };
  };

  // The keys come in the window with the editor, in every category but Tap Dance:
  // one Tap Dance cannot start another. A key picked goes to the action chosen and
  // the next action is chosen, as a key put on the keyboard moves on to the next.
  test('the editor is a window of keys: a pick fills the action chosen and moves on, and closing keeps it', async () => {
    const {keyboard, store} = await connect();
    const root = show(store);
    openTd0(root);
    expect(
      buttons(
        windowOf(root),
        (node) =>
          node.props['aria-pressed'] !== undefined &&
          node.props.title === undefined,
      ).map(textOf),
    ).toEqual(['Basic', 'Macro', 'Layers', 'Modifiers']);
    pick(root, 'On Double Tap', 'B');
    expect(textOf(slotButton(root, 'On Double Tap'))).toBe('BOn Double Tap');
    expect(slotButton(root, 'Tap+Hold').props['aria-pressed']).toBe(true);
    // The window's own search finds keys too.
    type(windowOf(root), 'f1');
    click(button(windowOf(root), 'Tap+Hold: F1'));
    expect(textOf(slotButton(root, 'Tap+Hold'))).toBe('F1Tap+Hold');

    // Closed, the window keeps what was set for the keyboard, unwritten.
    close(root);
    expect(dialogs(root).length).toBe(0);
    expect(store.getState().drafts[PATH]).toEqual({
      'tapDance:0': {dtap: 0x05, thold: 0x3a},
    });
    expect(hasDot(row(root, 'TD0'))).toBe(true);
    expect(writes(keyboard)).toEqual([]);
  });

  // A Tap Dance tells a tap from a hold itself, so the window of an action offers
  // no Layer-Tap or Mod-Tap: its Modifiers tab puts modifiers with the key, as a
  // change to the Tap Dance.
  test('an action takes modifiers from the Modifiers tab of its window, and no LT or MT', async () => {
    const {keyboard, store} = await connect();
    const root = show(store);
    openTd0(root);
    click(tab(windowOf(root), 'Modifiers'));
    expect(ltmtRows(root).map((row) => row.props['aria-label'])).toEqual([
      'Modifier combo',
    ]);
    // On Tap sends Esc.
    const tapOf = () =>
      store.getState().drafts[PATH]?.['tapDance:0']?.tap ?? 0x29;
    click(ltmtChoice(root, 'Modifier combo', 'Ctrl'));
    // C(KC_ESC), set and not yet written.
    expect(tapOf()).toBe(0x0129);
    expect(ltmtPressed(root)).toEqual(['Modifier combo: Ctrl']);
    // Pressed again, the modifier comes off: On Tap sends Esc alone.
    click(ltmtChoice(root, 'Modifier combo', 'Ctrl'));
    expect(tapOf()).toBe(0x29);
    expect(ltmtPressed(root)).toEqual([]);
    // A key modifiers cannot go with says so there.
    click(tab(windowOf(root), 'Layers'));
    click(button(windowOf(root), 'On Tap: Momentary turn layer 1 on'));
    click(slotButton(root, 'On Tap'));
    click(tab(windowOf(root), 'Modifiers'));
    expect(statuses(windowOf(root))).toContain(
      'Modifiers go with basic keycodes only.',
    );
    expect(writes(keyboard)).toEqual([]);
  });

  test('keys an action cannot take are offered disabled with the reason, and a click puts nothing', async () => {
    const {keyboard, store} = await connect();
    store.dispatch(
      setNumberOfLayers({
        devicePath: PATH,
        numberOfLayers: 2,
        connectionGeneration: new KeyboardAPI(PATH).getConnectionGeneration(),
      }),
    );
    const root = show(store, 2);
    openTd0(root);
    for (const [category, key, reason] of [
      [
        'Layers',
        'Momentary turn layer 3 on',
        'This layer is not available on this keyboard.',
      ],
      // Space Fn1 is a Layer-Tap, which the dance's own hold replaces.
      [
        'Layers',
        'Hold = Layer 1, Tap = Space',
        'Tap Dance decides tap and hold itself, so LT and MT cannot be chosen here.',
      ],
      ['Basic', 'Pass-through', 'Transparent has no action in Tap Dance.'],
    ]) {
      click(tab(windowOf(root), category));
      const offered = button(windowOf(root), `On Tap: ${key}`);
      click(offered);
      expect({
        key,
        disabled: offered.props.disabled,
        says: String(offered.props.title).endsWith(reason),
      }).toEqual({key, disabled: true, says: true});
    }
    expect(store.getState().drafts).toEqual({});
    expect(writes(keyboard)).toEqual([]);
  });

  test('an edit is kept for the keyboard when the editor or KEYMAP is left, until Cancel', async () => {
    const {keyboard, store} = await connect();
    let root = show(store);
    openTd0(root);
    pick(root, 'On Tap', 'A');
    typeTerm(root, '180');
    expect(save(root).props.disabled).toBe(false);

    // Closed with no question asked: the change shows on its row and tab.
    close(root);
    expect(textOf(row(root, 'TD0'))).toBe('TD0A·Left Ctrl·—·—180 msEdit');
    expect(hasDot(row(root, 'TD0'))).toBe(true);
    expect(hasDot(row(root, 'TD1'))).toBe(false);
    expect(hasDot(tab(root, 'Tap Dance'))).toBe(true);

    // KEYMAP left and come back to.
    root = show(store);
    expect(hasDot(tab(root, 'Tap Dance'))).toBe(true);
    openTd0(root);
    expect(term(root).props.value).toBe('180');
    expect(hasDot(slotButton(root, 'On Tap'))).toBe(true);
    expect(hasDot(slotButton(root, 'On Hold'))).toBe(false);
    expect(save(root).props.disabled).toBe(false);

    // Cancel puts the keyboard's values back without writing.
    click(button(root, 'Cancel'));
    expect(textOf(row(root, 'TD0'))).toBe('TD0Esc·Left Ctrl·—·—200 msEdit');
    expect(hasDot(tab(root, 'Tap Dance'))).toBe(false);
    expect(store.getState().drafts).toEqual({});
    expect(writes(keyboard)).toEqual([]);

    // A key set back to what the keyboard holds is no change.
    openTd0(root);
    pick(root, 'On Tap', 'A');
    pick(root, 'On Tap', 'Esc');
    expect(hasDot(slotButton(root, 'On Tap'))).toBe(false);
    expect(save(root).props.disabled).toBe(true);
    expect(store.getState().drafts).toEqual({});

    // Unplugged, the keyboard takes its drafts with it.
    pick(root, 'On Hold', 'A');
    expect(store.getState().drafts[PATH]).toBeDefined();
    act(() => {
      store.dispatch(updateConnectedDevices({}));
    });
    expect(store.getState().drafts).toEqual({});
  });

  // An action added and left without a key is one to choose wherever it shows: the
  // ? of a key not chosen yet on its action, "Select a key" on the list, never the
  // value that stands for it, and Save waits for it. No input is the blank key.
  test('an action added without a key reads as one to choose, and no input as the blank key', async () => {
    const {store} = await connect();
    const root = show(store, 4, withInputStart(store));
    openTd0(root);
    click(button(root, 'Add action: On Double Tap'));
    click(button(root, 'Add action: Tap+Hold'));
    expect(textOf(slotButton(root, 'On Double Tap'))).toBe('?On Double Tap');
    expect(textOf(slotButton(root, 'Tap+Hold'))).toBe('?Tap+Hold');
    expect(save(root).props.disabled).toBe(true);
    close(root);
    expect(textOf(row(root, 'TD0'))).toContain(
      'Esc·Left Ctrl·Select a key·Select a key',
    );
    expect(textOf(root.find((node) => node.type === 'main'))).not.toContain(
      '0xFFFF',
    );

    openTd0(root);
    pick(root, 'On Double Tap', 'Nothing');
    expect(textOf(slotButton(root, 'On Double Tap'))).toBe('On Double Tap');
    close(root);
    expect(textOf(row(root, 'TD0'))).toContain(
      'Esc·Left Ctrl·No input·Select a key',
    );
  });

  test('Input start and the actions added or removed stay drafts, survive a refused write and round-trip', async () => {
    const {keyboard, store} = await connect();
    const root = show(store, 4, withInputStart(store));
    const timing = (label: string) =>
      root.find(
        (node) =>
          node.type === 'input' &&
          node.props.type === 'radio' &&
          node.props['aria-label'] === label,
      );
    openTd0(root);
    expect(slotButtons(root).length).toBe(2);
    click(button(root, 'Remove On Hold'));
    expect(slotButtons(root).length).toBe(1);
    click(button(root, 'Add action: Tap+Hold'));
    pick(root, 'Tap+Hold', 'B');
    act(() => timing('On press').props.onChange());
    expect(slotButtons(root).length).toBe(2);
    expect(writes(keyboard)).toEqual([]);

    // Input start refused: it stays a draft for the next Save.
    keyboard.refuse = (bytes) => bytes[0] === SET && bytes[2] === 49;
    await clickSave(root);
    expect(alerts(root)).toEqual([REFUSED]);
    expect(store.getState().drafts[PATH]).toEqual({'tapDance:0': {mode: 2}});
    keyboard.refuse = () => false;
    await clickSave(root);
    expect(writes(keyboard).slice(-2)).toEqual([
      [SET, 16, 49, 2, 0xd2],
      [SAVE, 16],
    ]);
    // Removed, On Hold sends the base key.
    expect(
      store.getState().menus.customMenuDataMap[PATH][TD0.actions.hold.name],
    ).toEqual([0, 1]);

    // Read back as written; a change cancelled leaves it so.
    openTd0(root);
    expect(timing('On press').props.checked).toBe(true);
    act(() => timing('After decision').props.onChange());
    click(button(root, 'Add action: On Hold'));
    expect(slotButtons(root).length).toBe(3);
    click(button(root, 'Cancel'));
    openTd0(root);
    expect(timing('On press').props.checked).toBe(true);
    expect(slotButtons(root).length).toBe(2);
  });

  test('Save writes the changed fields in slot order and stops at a refusal, which stays a draft', async () => {
    const {keyboard, store} = await connect();
    const root = show(store);
    openTd0(root);
    pick(root, 'On Tap', 'A');
    pick(root, 'On Double Tap', 'B');
    typeTerm(root, '180');
    keyboard.refuse = (bytes) =>
      bytes[0] === SET && bytes[2] === TD0.actions.dtap.id;

    const {channel} = TD0.actions.tap;
    await clickSave(root);
    expect(writes(keyboard)).toEqual([
      [SET, channel, TD0.actions.tap.id, 0, 0x04],
      [SAVE, channel],
      [SET, channel, TD0.actions.dtap.id, 0, 0x05],
    ]);
    expect(alerts(root)).toEqual([REFUSED]);
    // What the keyboard took is no longer a change; the rest still is.
    expect(hasDot(slotButton(root, 'On Tap'))).toBe(false);
    expect(hasDot(slotButton(root, 'On Double Tap'))).toBe(true);
    expect(store.getState().drafts[PATH]).toEqual({
      'tapDance:0': {dtap: 0x05, term: '180'},
    });

    keyboard.refuse = () => false;
    keyboard.sent = [];
    await clickSave(root);
    expect(writes(keyboard)).toEqual([
      [SET, channel, TD0.actions.dtap.id, 0, 0x05],
      [SAVE, channel],
      [SET, TD0.term!.channel, TD0.term!.id, 0, 180],
      [SAVE, TD0.term!.channel],
    ]);
    expect(store.getState().drafts).toEqual({});
    expect(textOf(row(root, 'TD0'))).toBe('TD0A·Left Ctrl·B·—180 msSavedEdit');
    expect(hasDot(row(root, 'TD0'))).toBe(false);
  });

  // The keyboard took the term but refused to SAVE it. Save stays on offer for it,
  // also once the same term is typed again, and it goes to that keyboard alone.
  test('a refused SAVE stays retryable, in a KEYMAP come back to and after another keyboard was selected', async () => {
    for (const switched of [false, true]) {
      cleanUp();
      const {keyboard, store} = await connect();
      const first = store.getState().devices.connectedDevicePaths[PATH];
      const other = await plugIn(store, `${PATH}-other`);
      let root = show(store);
      openTd0(root);
      typeTerm(root, '180');
      keyboard.refuse = ([command]) => command === SAVE;
      if (switched) {
        const answer = await saveHeld(keyboard, root, keyboard.refuse);
        select(store, other.device);
        await answer();
        select(store, first);
      } else {
        await clickSave(root);
        expect(alerts(root)).toEqual([REFUSED]);
      }
      expect(
        store.getState().menus.customMenuDataMap[PATH][TD0.term!.name],
      ).toEqual([0, 180]);

      root = show(store);
      openTd0(root);
      typeTerm(root, '190');
      typeTerm(root, '180');
      expect({switched, off: save(root).props.disabled}).toEqual({
        switched,
        off: false,
      });
      keyboard.refuse = () => false;
      await clickSave(root);
      expect({
        switched,
        drafts: store.getState().drafts[PATH],
        last: writes(keyboard).slice(-2),
        other: writes(other.keyboard),
      }).toEqual({
        switched,
        drafts: undefined,
        last: [
          [SET, TD0.term!.channel, TD0.term!.id, 0, 180],
          [SAVE, TD0.term!.channel],
        ],
        other: [],
      });
    }
  });

  // The rest of a batch belongs to the keyboard it was made for: once another is
  // selected, what is left stays a draft there, and the other keeps its own.
  test('Save stops its batch on a device switch while its first SET or SAVE waits', async () => {
    for (const held of [SET, SAVE]) {
      cleanUp();
      const {keyboard, store} = await connect();
      const other = await plugIn(store, `${PATH}-second`);
      const otherData = {
        ...store.getState().menus.customMenuDataMap[PATH],
        [TD0.actions.tap.name]: [0, 0x07],
        [TD0.actions.dtap.name]: [0, 0x08],
        [TD0.term!.name]: [0, 240],
      };
      store.dispatch(
        updateSelectedCustomMenuData({
          devicePath: other.device.path,
          menuData: otherData,
        }),
      );
      store.dispatch(
        setDraft({
          devicePath: other.device.path,
          key: 'tapDance:0',
          value: {dtap: 0x09},
        }),
      );
      const root = show(store);
      openTd0(root);
      pick(root, 'On Tap', 'A');
      pick(root, 'On Double Tap', 'B');
      typeTerm(root, '180');
      const answer = await saveHeld(
        keyboard,
        root,
        (bytes) =>
          bytes[0] === held &&
          (held === SAVE || bytes[2] === TD0.actions.tap.id),
      );
      select(store, other.device);
      await answer();
      const {devices, drafts, menus} = store.getState();
      const data = menus.customMenuDataMap[PATH];
      expect({
        held,
        selected: devices.selectedDevicePath,
        written: writes(keyboard),
        writtenThere: writes(other.keyboard),
        drafts,
        values: [
          data[TD0.actions.tap.name],
          data[TD0.actions.dtap.name],
          data[TD0.term!.name],
        ],
        valuesThere: menus.customMenuDataMap[other.device.path],
      }).toEqual({
        held,
        selected: other.device.path,
        written: [
          [SET, TD0.actions.tap.channel, TD0.actions.tap.id, 0, 0x04],
          [SAVE, TD0.actions.tap.channel],
        ],
        writtenThere: [],
        drafts: {
          [PATH]: {'tapDance:0': {dtap: 0x05, term: '180'}},
          [other.device.path]: {'tapDance:0': {dtap: 0x09}},
        },
        values: [
          [0, 0x04],
          [0, 0],
          [0, 200],
        ],
        valuesThere: otherData,
      });
    }
  });

  // While a write is on its way the keyboard's values already show it, so a field
  // on its way reads as no change. What is set meanwhile must not be lost, a field
  // set back to the value on its way included, until the keyboard takes that value.
  // Refused, the editor stays open on what is left, with Save on to try again;
  // taken, the write closes the editor and the list shows what is left.
  test('a change made while Save waits stays a change, unless the keyboard takes that very value', async () => {
    const setOf = (id: number) => (bytes: number[]) =>
      bytes[0] === SET && bytes[2] === id;
    const dtap = setOf(TD0.actions.dtap.id);
    const twice =
      (role: string, ...keys: string[]) =>
      (root: ReactTestInstance) => {
        keys.forEach((key) => pick(root, role, key));
        return root;
      };
    // A change as it shows, with its dot: an action or the term in the editor, or
    // TD0 on the list.
    type Shown = [string, boolean];
    const action =
      (role: string) =>
      (view: ReactTestInstance): Shown => {
        const slot = slotButton(view, role);
        return [textOf(slot), hasDot(slot)];
      };
    const termShown = (view: ReactTestInstance): Shown => {
      let label = term(view);
      while (label.type !== 'label') {
        label = label.parent!;
      }
      return [term(view).props.value, hasDot(label)];
    };
    const listed = (view: ReactTestInstance): Shown => {
      const td0 = row(view, 'TD0');
      return [textOf(td0), hasDot(td0)];
    };
    const cases: {
      what: string;
      change: (root: ReactTestInstance) => void;
      held: (bytes: number[]) => boolean;
      refused: boolean;
      meanwhile: (root: ReactTestInstance, store: Store) => ReactTestInstance;
      drafts: object;
      read: (view: ReactTestInstance) => Shown;
      shown: Shown;
    }[] = [
      {
        what: 'other fields, refused',
        change: (root) => pick(root, 'On Double Tap', 'B'),
        held: dtap,
        refused: true,
        meanwhile: (root) => {
          typeTerm(root, '180');
          return twice('Tap+Hold', 'C')(root);
        },
        drafts: {'tapDance:0': {dtap: 0x05, thold: 0x06, term: '180'}},
        read: action('On Double Tap'),
        shown: ['BOn Double Tap', true],
      },
      {
        what: 'another field, taken',
        change: (root) => pick(root, 'On Double Tap', 'B'),
        held: dtap,
        refused: false,
        meanwhile: twice('On Tap', 'D'),
        drafts: {'tapDance:0': {tap: 0x07}},
        read: listed,
        shown: ['TD0D·Left Ctrl·B·—200 msSavedEdit', true],
      },
      {
        what: 'the key on its way set again, refused',
        change: (root) => pick(root, 'On Double Tap', 'B'),
        held: dtap,
        refused: true,
        meanwhile: twice('On Double Tap', 'C', 'B'),
        drafts: {'tapDance:0': {dtap: 0x05}},
        read: action('On Double Tap'),
        shown: ['BOn Double Tap', true],
      },
      {
        what: 'the term on its way typed again, refused',
        change: (root) => typeTerm(root, '180'),
        held: setOf(TD0.term!.id),
        refused: true,
        meanwhile: (root) => {
          typeTerm(root, '18');
          typeTerm(root, '180');
          return root;
        },
        drafts: {'tapDance:0': {term: '180'}},
        read: termShown,
        shown: ['180', true],
      },
      {
        what: 'the blank key on its way put again, refused',
        change: (root) => pick(root, 'On Tap', 'Nothing'),
        held: setOf(TD0.actions.tap.id),
        refused: true,
        meanwhile: twice('On Tap', 'C', 'Nothing'),
        drafts: {'tapDance:0': {tap: 0}},
        read: action('On Tap'),
        shown: ['On Tap', true],
      },
      {
        what: 'the key on its way set again in a KEYMAP come back to, refused',
        change: (root) => pick(root, 'On Double Tap', 'B'),
        held: dtap,
        refused: true,
        meanwhile: (_, store) => {
          const again = show(store);
          openTd0(again);
          return twice('On Double Tap', 'C', 'B')(again);
        },
        drafts: {'tapDance:0': {dtap: 0x05}},
        read: action('On Double Tap'),
        shown: ['BOn Double Tap', true],
      },
      {
        what: 'the key on its way set again, taken',
        change: (root) => pick(root, 'On Double Tap', 'B'),
        held: dtap,
        refused: false,
        meanwhile: twice('On Double Tap', 'C', 'B'),
        drafts: {},
        read: listed,
        shown: ['TD0Esc·Left Ctrl·B·—200 msSavedEdit', false],
      },
    ];
    for (const {
      what,
      change,
      held,
      refused,
      meanwhile,
      drafts,
      read,
      shown,
    } of cases) {
      cleanUp();
      const {keyboard, store} = await connect();
      const root = show(store);
      openTd0(root);
      change(root);
      keyboard.refuse = refused ? held : () => false;
      const answer = await saveHeld(keyboard, root, held);
      const view = meanwhile(root, store);
      await answer();
      expect({
        what,
        drafts: store.getState().drafts[PATH] ?? {},
        shown: read(view),
      }).toEqual({what, drafts, shown});
      if (refused) {
        expect({what, retry: !save(view).props.disabled}).toEqual({
          what,
          retry: true,
        });
        // The editor that sent the write says why; one opened anew in a KEYMAP
        // come back to was not there to hear it.
        if (view === root) {
          expect({what, said: alerts(view)}).toEqual({what, said: [REFUSED]});
        }
      }
    }
  });

  test('a term or hold time the keyboard would refuse is marked with its range, keeps Save off and sends nothing', async () => {
    const fields: [string, (store: Store) => unknown, string[], string][] = [
      ['Term', () => definition, ['0', '65536', '12.5', ''], '180'],
      ['Hold decision', withHoldDecision, ['65536', '-1', '1.5', ''], '65535'],
    ];
    for (const [field, setUp, invalid, valid] of fields) {
      cleanUp();
      const {keyboard, store} = await connect();
      const root = show(store, 4, setUp(store) as typeof definition);
      openTd0(root);
      const input = () =>
        root.find(
          (node) => node.type === 'input' && node.props['aria-label'] === field,
        );
      for (const value of invalid) {
        act(() => input().props.onChange({target: {value}}));
        act(() => input().props.onBlur());
        expect({
          field,
          value,
          invalid: input().props['aria-invalid'],
          said: alerts(root),
          off: save(root).props.disabled,
        }).toEqual({field, value, invalid: true, said: ['1–65535'], off: true});
      }
      act(() => input().props.onChange({target: {value: valid}}));
      expect({field, off: save(root).props.disabled}).toEqual({
        field,
        off: false,
      });
      expect(writes(keyboard)).toEqual([]);
    }
  });

  // A term the keyboard reports outside the range is its own, not a mistake: the
  // editor does not mark it, and it holds up no other change, as in a menu.
  test('a term the keyboard reports outside the range is not marked and holds nothing up', async () => {
    const {keyboard, store} = await connect();
    store.dispatch(
      updateSelectedCustomMenuData({
        devicePath: PATH,
        menuData: {
          ...store.getState().menus.customMenuDataMap[PATH],
          [TD0.term!.name]: [0, 0],
        },
      }),
    );
    const root = show(store);
    openTd0(root);
    expect(term(root).props.value).toBe('0');
    expect(term(root).props['aria-invalid']).toBeFalsy();
    expect(alerts(root)).toEqual([]);

    pick(root, 'On Tap', 'A');
    await clickSave(root);
    const {channel} = TD0.actions.tap;
    expect(writes(keyboard)).toEqual([
      [SET, channel, TD0.actions.tap.id, 0, 0x04],
      [SAVE, channel],
    ]);
    expect(store.getState().drafts).toEqual({});
  });

  // Enter in the term is the editor's Save, and does nothing while Save is off or
  // an input method is still composing.
  test('Enter in the term saves as Save does', async () => {
    const {keyboard, store} = await connect();
    const root = show(store);
    openTd0(root);
    const enterTerm = async (isComposing = false) => {
      await act(async () => {
        term(root).props.onKeyDown({key: 'Enter', nativeEvent: {isComposing}});
      });
      for (let tries = 0; tries < 20; tries++) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      }
    };

    await enterTerm();
    pick(root, 'On Tap', 'A');
    typeTerm(root, '0');
    await enterTerm();
    typeTerm(root, '180');
    await enterTerm(true);
    expect(writes(keyboard)).toEqual([]);
    await enterTerm();
    const {channel} = TD0.actions.tap;
    expect(writes(keyboard)).toEqual([
      [SET, channel, TD0.actions.tap.id, 0, 0x04],
      [SAVE, channel],
      [SET, TD0.term!.channel, TD0.term!.id, 0, 180],
      [SAVE, TD0.term!.channel],
    ]);
    expect(store.getState().drafts).toEqual({});
    expect(textOf(row(root, 'TD0'))).toContain('Saved');
  });

  test('Save keeps an unknown saved action and refuses an unsupported changed action before any write', async () => {
    const {keyboard, store} = await connect();
    store.dispatch(
      updateSelectedCustomMenuData({
        devicePath: PATH,
        menuData: {
          ...store.getState().menus.customMenuDataMap[PATH],
          [TD0.actions.tap.name]: [0x7f, 0xff],
        },
      }),
    );
    const root = show(store);
    openTd0(root);
    typeTerm(root, '180');
    await clickSave(root);
    expect(writes(keyboard)).toEqual([
      [SET, TD0.term!.channel, TD0.term!.id, 0, 180],
      [SAVE, TD0.term!.channel],
    ]);
    expect(
      store.getState().menus.customMenuDataMap[PATH][TD0.actions.tap.name],
    ).toEqual([0x7f, 0xff]);

    // A Tap Dance set as an action, which no key of the window offers.
    openTd0(root);
    act(() =>
      store.dispatch(
        setDraft({
          devicePath: PATH,
          key: 'tapDance:0',
          value: {tap: TD0_VALUE},
        }),
      ),
    );
    expect(save(root).props.disabled).toBe(true);
    expect(save(root).props.title).toContain('cannot start another Tap Dance');
    await clickSave(root);
    expect(writes(keyboard).length).toBe(2);
    expect(store.getState().drafts[PATH]).toBeTruthy();
  });
});

// A knob on a keyboard without State Sync, whose keymap load reads no knob: each
// knob's two keys are read from the keyboard when it is picked.
describe('a knob', () => {
  const PATH = 'keycode-palette-knob';
  const KNOBS_VPID = 0x4b4e0001;
  const GET_ENCODER = 0x14;
  const UNSUPPORTED =
    'Your current firmware does not support rotary encoders. Install the latest firmware for your device.';
  // Key Q, then knob 0 pressed as W and knob 1 pressed as E, on both layers.
  const PRESSED = [0x14, 0x1a, 0x08];
  const KNOB_0 = 1;
  const KNOB_1 = 2;
  const key = (col: number, ei?: number) => ({
    x: col,
    y: 0,
    w: 1,
    h: 1,
    row: 0,
    col,
    color: 'alpha',
    d: false,
    r: 0,
    rx: 0,
    ry: 0,
    ...(ei === undefined ? {} : {ei}),
  });
  const knobs = {
    name: 'Knobs',
    vendorProductId: KNOBS_VPID,
    firmwareVersion: 0,
    keycodes: [],
    menus: [],
    matrix: {rows: 1, cols: 3},
    layouts: {
      keys: [key(0), key(1, 0), key(2, 1)],
      optionKeys: {},
      width: 3,
      height: 1,
    },
  };

  // Each read is answered with the key the knob turns to, by layer, knob and
  // direction (1 is clockwise); a refused read is the bare echo QMK sends.
  class Knobs extends Keyboard {
    turns: Record<string, number> = {
      '0:0:0': 0x04,
      '0:0:1': 0x05,
      '0:1:0': 0x06,
      '0:1:1': 0x07,
      '1:0:0': 0x09,
      '1:0:1': 0x0a,
    };
    async sendReport(reportId: number, data: BufferSource) {
      const bytes = Uint8Array.from(
        data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer),
      );
      if (bytes[0] === GET_ENCODER && !this.refuse([...bytes])) {
        const keycode = this.turns[bytes.slice(1, 4).join(':')] ?? 0;
        bytes[4] = keycode >> 8;
        bytes[5] = keycode & 0xff;
      }
      return super.sendReport(reportId, bytes);
    }
  }

  const connect = async (protocol = 12) => {
    const keyboard = new Knobs();
    registerHIDDeviceForTesting(PATH, keyboard as unknown as HIDDevice);
    await new HID.HID(PATH).openPromise;
    const store = makeStore();
    const device = {
      path: PATH,
      vendorId: KNOBS_VPID >>> 16,
      productId: KNOBS_VPID & 0xffff,
      vendorProductId: KNOBS_VPID,
      productName: 'Knobs',
      protocol,
      hasResolvedDefinition: true,
      requiredDefinitionVersion: 'v3' as const,
    };
    const generation = new KeyboardAPI(PATH).getConnectionGeneration();
    store.dispatch(updateDefinitions({[KNOBS_VPID]: {v3: knobs}} as any));
    store.dispatch(updateConnectedDevices({[PATH]: device}));
    store.dispatch(selectDevice({device, connectionGeneration: generation}));
    store.dispatch(
      setNumberOfLayers({
        devicePath: PATH,
        numberOfLayers: 2,
        connectionGeneration: generation,
      }),
    );
    for (const layerIndex of [0, 1]) {
      store.dispatch(
        loadLayerSuccess({
          layerIndex,
          keymap: PRESSED,
          devicePath: PATH,
          connectionGeneration: generation,
        }),
      );
    }
    const keys = getSelectedKeyDefinitions(store.getState() as any);
    const pickKnob = (index: number) =>
      act(() => {
        store.dispatch(updateSelectedKey(index, keys));
      });
    const reads = () =>
      keyboard.sent.filter(([command]) => command === GET_ENCODER).length;
    const knob = (id: number) =>
      store.getState().keymap.encoderDeviceMap[PATH]?.[id];
    return {keyboard, store, generation, pickKnob, reads, knob};
  };

  const show = (store: Store) =>
    mount(
      <Provider store={store}>
        <I18nextProvider i18n={translations}>
          <EncoderPane />
        </I18nextProvider>
      </Provider>,
    );

  // The faces of the knob's keys: counterclockwise, clockwise, then the press.
  const faces = (root: ReactTestInstance) =>
    buttons(root, () => true).map(textOf);
  const said = () => JSON.stringify(renderer!.toJSON());
  // Answers the read the keyboard holds, once the transport has sent it.
  const answer = async (keyboard: Knobs) => {
    await until(() => keyboard.held.length > 0);
    keyboard.release();
  };

  test('a knob being read shows its two keys empty, and a knob read once shows at once', async () => {
    const {keyboard, store, pickKnob, reads, knob} = await connect();
    keyboard.hold = ([command]) => command === GET_ENCODER;
    pickKnob(KNOB_0);
    const root = show(store);
    expect(faces(root)).toEqual(['', '', 'W']);
    expect(buttons(root, (node) => node.props.disabled).length).toBe(2);
    expect(said()).not.toContain(UNSUPPORTED);

    await answer(keyboard);
    await answer(keyboard);
    await until(() => faces(root)[0] !== '');
    expect(faces(root)).toEqual(['A', 'B', 'W']);
    expect(knob(0)).toEqual([[0x04, 0x05]]);

    // The next knob starts empty rather than with the last one's keys.
    pickKnob(KNOB_1);
    expect(faces(root)).toEqual(['', '', 'E']);
    await answer(keyboard);
    await answer(keyboard);
    await until(() => faces(root)[0] !== '');
    expect(faces(root)).toEqual(['C', 'D', 'E']);

    const before = reads();
    pickKnob(KNOB_0);
    expect(faces(root)).toEqual(['A', 'B', 'W']);
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(reads()).toBe(before);
  });

  test('a reply for a layer left before it came is not shown on the next one', async () => {
    const {keyboard, store, pickKnob, knob} = await connect();
    keyboard.hold = ([command]) => command === GET_ENCODER;
    pickKnob(KNOB_0);
    const root = show(store);
    act(() => {
      store.dispatch(setLayer(1));
    });
    // The reads go out in turn: layer 0 clockwise, layer 1 clockwise, then layer
    // 0 counterclockwise, which completes layer 0 while layer 1 is shown.
    await answer(keyboard);
    await answer(keyboard);
    await answer(keyboard);
    await until(() => knob(0)?.[0] !== undefined);
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(knob(0)?.[0]).toEqual([0x04, 0x05]);
    expect(faces(root)).toEqual(['', '', 'W']);

    await answer(keyboard);
    await until(() => faces(root)[0] !== '');
    expect(faces(root)).toEqual(['F', 'G', 'W']);
    expect(knob(0)).toEqual([
      [0x04, 0x05],
      [0x09, 0x0a],
    ]);
  });

  test('changing one direction keeps the other, and a knob not read gets no guessed key', async () => {
    const {store, pickKnob, knob} = await connect();
    pickKnob(KNOB_0);
    const root = show(store);
    await until(() => faces(root)[0] !== '');
    const [, clockwise] = root.findAllByType(PelpiKeycodeInput);
    act(() => clockwise.props.setValue(0x06));
    await until(() => knob(0)?.[0]?.[1] === 0x06);
    expect(knob(0)).toEqual([[0x04, 0x06]]);
    expect(faces(root)).toEqual(['A', 'C', 'W']);

    await act(() => store.dispatch(updateEncoderValue(0, 1, true, 0x07)));
    expect(knob(1)).toBeUndefined();
  });

  test('a knob read is kept only for the connection it was read on', async () => {
    const {keyboard, store, generation, knob} = await connect();
    await act(() => store.dispatch(loadEncoderValues(0, 0)));
    expect(knob(0)).toEqual([[0x04, 0x05]]);

    // A new connection's keymap starts without it, and a reply read before
    // that is not kept either.
    keyboard.hold = ([command]) => command === GET_ENCODER;
    const late = store.dispatch(loadEncoderValues(0, 1));
    store.dispatch(
      setNumberOfLayers({
        devicePath: PATH,
        numberOfLayers: 2,
        connectionGeneration: generation + 1,
      }),
    );
    expect(knob(0)).toBeUndefined();
    await answer(keyboard);
    await answer(keyboard);
    expect(await late).toEqual([0x06, 0x07]);
    expect(knob(1)).toBeUndefined();
  });

  test('the firmware sentence stays for a keyboard that refuses the read or a protocol too old for it', async () => {
    for (const protocol of [12, 9]) {
      cleanUp();
      const {keyboard, store, pickKnob, reads} = await connect(protocol);
      keyboard.refuse = ([command]) => command === GET_ENCODER;
      pickKnob(KNOB_0);
      const root = show(store);
      await until(() => said().includes(UNSUPPORTED));
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
      expect({
        protocol,
        said: said().includes(UNSUPPORTED),
        faces: faces(root),
        read: reads() > 0,
      }).toEqual({protocol, said: true, faces: [], read: protocol >= 10});
    }
  });
});

// Keyboard focus as far as the palette moves it: an element with a ref can take it.
describe('keyboard focus', () => {
  const made: Focusable[] = [];
  const words = (node: unknown): string =>
    typeof node === 'string' || typeof node === 'number'
      ? String(node)
      : Array.isArray(node)
        ? node.map(words).join('')
        : node && typeof node === 'object' && 'props' in node
          ? words((node as {props: {children?: unknown}}).props.children)
          : '';
  const mountFocusable = (props: Props) =>
    mount(palette(props), {
      createNodeMock: (element) => {
        const node: Focusable = {
          name: element.props['aria-label'] ?? words(element.props.children),
          focus: () => {
            focused = node;
          },
        };
        made.push(node);
        return node;
      },
    });

  // The editor takes focus to its first action. Every way out gives it back to the
  // row's Edit; Save, which turns itself off while it writes, hands it to the action
  // chosen until then.
  test('the Tap Dance editor takes focus and gives it back to its row however it closes', async () => {
    const ways: [string, (root: ReactTestInstance) => Promise<unknown>][] = [
      ['Cancel', async (root) => click(button(root, 'Cancel'))],
      ['Close', async (root) => close(root)],
      [
        'Escape',
        async (root) =>
          act(() =>
            windowOf(root).props.onKeyDown({
              key: 'Escape',
              stopPropagation: () => undefined,
            }),
          ),
      ],
      [
        'a click beside it',
        async (root) =>
          click(
            root.find(
              (node) =>
                node.type === 'div' &&
                typeof node.props.onClick === 'function' &&
                node.children.length === 0,
            ),
          ),
      ],
      [
        'Save',
        async (root) => {
          pick(root, 'On Tap', 'A');
          focused = made.filter((node) => node.name === 'Save').at(-1)!;
          let saving: unknown;
          act(() => {
            saving = button(root, 'Save').props.onClick();
          });
          expect(focused?.name).toBe('On Hold');
          await act(async () => {
            await saving;
          });
        },
      ],
    ];
    for (const [way, shut] of ways) {
      made.length = 0;
      const root = mountFocusable({tapDance: tapDance()});
      click(tab(root, 'Tap Dance'));
      click(button(root, 'Edit TD1'));
      expect({way, opened: focused?.name}).toEqual({way, opened: 'On Tap'});
      await shut(root);
      expect({way, closed: focused?.name}).toEqual({way, closed: 'Edit TD1'});
    }
  });
});

// The keyboard above names keys for the OS layout picked in its layout badge; on a
// German layout the key QMK calls KC_Y is Z. The palette names keys the same way.
describe('the host keyboard layout', () => {
  test('the palette names the keys and the corner as the layout does', () => {
    const german = configureStore({
      reducer: () =>
        ({
          settings: {
            themeName: 'OLIVIA_DARK',
            hostKeyboardLayout: 'keymap_german',
          },
        }) as any,
    });
    const root = mount(
      <Provider store={german}>
        <I18nextProvider i18n={translations}>
          <KeycodePalette
            menus={baseMenus}
            basicKeyToByte={v13BasicKeyToByte}
            byteToKey={byteToKey}
            target={{...SELECTED, value: 0x1c}}
            onAssign={() => undefined}
            layerCount={4}
          />
        </I18nextProvider>
      </Provider>,
    );
    // What a keycap has printed on it: the first span is its face.
    const face = (key: ReactTestInstance) =>
      textOf(key.findAll((node) => node.type === 'span')[0]);
    // The selected key holds KC_Y: its keycap reads Z, and KC_Z's reads Y.
    const current = root.find(
      (node) => node.type === 'button' && node.props['aria-current'] === 'true',
    );
    expect([current.props['aria-label'], face(current)]).toEqual(['Z', 'Z']);
    expect(face(button(root, 'Y'))).toBe('Y');
    // No key has a tooltip of its name, shortened or not: the corner names it.
    const grave = button(root, '◌̂ (dead) and ◌̊');
    expect([face(grave), grave.props.title]).toEqual(['°^', undefined]);
    const backspace = button(root, 'Backspace');
    expect([face(backspace), backspace.props.title]).toEqual([
      'Bksp',
      undefined,
    ]);
    // The corner says Z as well.
    const described = (code: string) =>
      root
        .find(
          (node) =>
            node.type === 'div' && node.children.map(textOf).includes(code),
        )
        .children.map(textOf);
    expect(described('KC_Y')).toEqual(['Z', 'KC_Y', '0x001C', '']);
    // A dead key says so in the corner, as the layout describes it.
    hover(root, '◌̂ (dead) and ◌̊');
    expect(described('KC_GRV')).toEqual([
      '° ^',
      'KC_GRV',
      '0x0035',
      '◌̂ (dead) and ◌̊',
    ]);
  });
});
