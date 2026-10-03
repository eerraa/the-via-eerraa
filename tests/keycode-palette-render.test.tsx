import {configureStore} from '@reduxjs/toolkit';
import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import i18n from 'i18next';
import {Provider} from 'react-redux';
import {I18nextProvider} from 'react-i18next';
import {renderToStaticMarkup} from 'react-dom/server';
import type {ReactElement} from 'react';
import {ServerStyleSheet} from 'styled-components';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';
import {getKeycodes} from '../src/utils/key';
import v13BasicKeyToByte from '../src/utils/key-to-byte/v13';
import {getByteToKey} from '../src/utils/key';
import {
  buildEnabledKeycodeMenus,
  menusWithTapDanceKeycodes,
} from '../src/utils/keycode-menus';
import {getTapDanceSlots} from '../src/utils/keycode-palette';
import {selectKeycodeFromMenuCode} from '../src/utils/keycode-picker';
import {setEraAdvancedMetadataForTesting} from '../src/utils/era-advanced-metadata';
import {THEMES} from '../src/utils/themes';
import type {TapDanceBinding} from '../src/components/inputs/keycode-palette/use-tap-dance';
import {contrast, paint, themedPages} from './theme-colors';

// The store module graph is circular; entering it through keyboard-api first is the
// order the app itself loads it in (see custom-menu-pane.test.tsx).
await import('../src/utils/keyboard-api');
const {KeycodePalette} =
  await import('../src/components/inputs/keycode-palette/keycode-palette');
const {useTapDanceBinding} =
  await import('../src/components/inputs/keycode-palette/use-tap-dance');
const {PelpiKeycodeInput} =
  await import('../src/components/inputs/pelpi/keycode-input');
const {AccentButton, PrimaryAccentButton} =
  await import('../src/components/inputs/accent-button');
const {ToggleButton} =
  await import('../src/components/inputs/keycode-palette/palette-parts');

const translations = i18n.createInstance();
await translations.init({lng: 'en', resources: {en: {translation: {}}}});

const store = configureStore({
  reducer: (state = {settings: {themeName: 'OLIVIA_DARK'}}) => state,
});

const definition = JSON.parse(
  require('node:fs').readFileSync(
    'public/definitions/era/v3/1163042818.json',
    'utf8',
  ),
);
const byteToKey = getByteToKey(v13BasicKeyToByte);
const baseMenus = menusWithTapDanceKeycodes(
  getKeycodes().filter((menu) =>
    ['basic', 'layers', 'macro'].includes(menu.id),
  ),
  definition.tapdanceKeycodes,
);

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

const palette = (
  menus: typeof baseMenus,
  props: Partial<Parameters<typeof KeycodePalette>[0]> = {},
) => (
  <Provider store={store}>
    <I18nextProvider i18n={translations}>
      <KeycodePalette
        menus={menus}
        basicKeyToByte={v13BasicKeyToByte}
        byteToKey={byteToKey}
        target={{name: 'Selected key', sub: 'Layer 0', value: 0x04}}
        onAssign={() => undefined}
        layerCount={4}
        {...props}
      />
    </I18nextProvider>
  </Provider>
);

const render = (
  menus: typeof baseMenus,
  props: Partial<Parameters<typeof KeycodePalette>[0]> = {},
) => renderToStaticMarkup(palette(menus, props));

// The markup with the style rules it was drawn with, to read what a state looks like.
const renderWithStyles = (element: ReactElement) => {
  const sheet = new ServerStyleSheet();
  try {
    const html = renderToStaticMarkup(sheet.collectStyles(element));
    return {html, css: sheet.getStyleTags()};
  } finally {
    sheet.seal();
  }
};

// The declarations one of an element's classes gives it, plain or for a state.
const ruleOf = (css: string, tag: string, state = '') => {
  const classes = /class="([^"]+)"/.exec(tag)?.[1].split(' ') ?? [];
  const selector = state.replace(/[[\]().*+?^$|\\]/g, '\\$&');
  for (const name of classes) {
    const rule = new RegExp(`\\.${name}${selector}\\{([^}]*)\\}`).exec(css);
    if (rule) {
      return rule[1];
    }
  }
  return '';
};

// How far past a key's edge the ring of the current key reaches.
const ringReach = (css: string, tag: string) =>
  -Number(
    /(?:^|;)inset:(-?\d+)px/.exec(
      ruleOf(css, tag, "[aria-current='true']::before"),
    )?.[1],
  );

// Where past a key's edge keyboard focus starts its outline, and how far the outline
// reaches. On the current key, its own rule wins over the one every key has.
const focusBand = (css: string, tag: string) => {
  const every = ruleOf(css, tag, ':focus-visible');
  const own = tag.includes('aria-current="true"')
    ? ruleOf(css, tag, "[aria-current='true']:focus-visible")
    : '';
  const read = (pattern: RegExp) =>
    pattern.exec(own)?.[1] ?? pattern.exec(every)?.[1];
  const offset = Number(read(/(?:^|;)outline-offset:(-?\d+)(?:px)?;/) ?? 0);
  return {offset, reach: offset + Number(read(/(?:^|;)outline:(\d+)px /))};
};

const currentKeycap = (html: string) =>
  /<button[^>]*aria-current="true"[^>]*>(.*?)<\/button>/.exec(html);

describe('keycode palette render', () => {
  test('opens on Basic laid out like a keyboard, with the current key marked', () => {
    const html = render(baseMenus);
    expect(html).toContain('Selected key');
    expect(html).toContain('+ Combined key');
    for (const label of ['Esc · Function', 'Letters', 'Modifiers', 'Numpad']) {
      expect(html).toContain(label);
    }
    // KC_A is the target's value: exactly one keycap is marked current.
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  });

  // The key the target holds is ringed, not labelled: a word on it was fine print
  // beside VIA's type, and the header and the corner already name the key.
  test('the current key carries its ring and no word, in the grid and the Tap Dance list', () => {
    const grid = render(baseMenus);
    expect(currentKeycap(grid)?.[1].replace(/<[^>]+>/g, '')).toBe('A');
    const tapdanceFirst = [
      baseMenus.find((menu) => menu.id === 'tapdance')!,
      ...baseMenus.filter((menu) => menu.id !== 'tapdance'),
    ];
    const list = render(tapdanceFirst, {
      target: {
        name: 'Selected key',
        value: selectKeycodeFromMenuCode('TD(0)', v13BasicKeyToByte),
      },
      tapDance: binding(() => ({
        actions: {tap: 0x29, hold: 0, dtap: 0, thold: 0},
        term: '200',
      })),
    });
    const slot = currentKeycap(list);
    expect(slot?.[0]).toContain('aria-label="Put TD0 on the selected key"');
    expect(slot?.[1].replace(/<[^>]+>/g, '')).toBe('TD0');
    expect(grid + list).not.toContain('Current');
  });

  // Keyboard focus rings a key too, dashed, and on the current key outside its ring,
  // so a focused current key shows both. The current one is not the outline, which
  // VIA's global *:focus rule clears, and it shows on the page under every keycap
  // theme.
  test('the current key keeps a ring that shows under every theme, apart from keyboard focus', () => {
    const {html, css} = renderWithStyles(palette(baseMenus));
    const tag = /<button[^>]*aria-current="true"[^>]*>/.exec(html)![0];
    const ring = ruleOf(css, tag, "[aria-current='true']::before");
    const focus = ruleOf(css, tag, ':focus-visible');
    expect(ruleOf(css, tag)).toMatch(/(^|;)outline:none;/);
    expect(ring).toMatch(/(^|;)border:2px solid /);
    expect(focus).toMatch(/(^|;)outline:2px dashed /);
    expect(focusBand(css, tag).offset).toBeGreaterThan(ringReach(css, tag));

    // At 2:1 a ring is plainly there; one of pure accent came to about 1:1 where a
    // theme's accent is white, grey or black. The palette sits on the page's gradient,
    // so both of its ends count.
    const ringColour = /border:2px solid ([^;]+)/.exec(ring)![1];
    const faint = themedPages(THEMES).flatMap(({page, properties}) =>
      properties
        .get('--bg_gradient')!
        .match(/#[\da-f]{3,6}\b/gi)!
        .map((stop) => ({
          page,
          ratio: contrast(paint(ringColour, properties), paint(stop, properties)),
        }))
        .filter(({ratio}) => ratio < 2),
    );
    expect(faint).toEqual([]);
  });

  // Keys in a row sit only the row's gap apart, and the current key's ring reaches
  // into it. Keyboard focus on the key beside it keeps to that key's side of the gap;
  // drawn as far out as on the current key, its dashes fell on the ring or inside it.
  test('keyboard focus on the key beside the current one stays off its ring', () => {
    const {html, css} = renderWithStyles(palette(baseMenus));
    const at = html.search(/<button[^>]*aria-current="true"/);
    const current = /<button[^>]*>/.exec(html.slice(at))![0];
    const beside = /<button(?![^>]*aria-current)[^>]*>/.exec(
      html.slice(at + current.length),
    )![0];
    expect(beside).toContain('aria-label="S"');
    // The row both keys sit in is the element opened last before the current key.
    const row = [...html.slice(0, at).matchAll(/<div class="[^"]*">/g)].at(-1)![0];
    const gap = Number(/(?:^|;)gap:(\d+)px/.exec(ruleOf(css, row))?.[1]);
    expect(gap).toBeGreaterThan(0);
    expect(focusBand(css, beside).reach).toBeLessThanOrEqual(
      gap - ringReach(css, current),
    );
    // Each dash keeps off its own key, whose skirt some themes colour much like the
    // dash, and the current key's stays out of the key beside it.
    expect(focusBand(css, beside).offset).toBeGreaterThan(0);
    expect(focusBand(css, current).reach).toBeLessThanOrEqual(gap);
  });

  // The accent is too pale for text on the light surface, so an enabled accent button
  // draws in the accent text colour (the pure accent in dark mode) and reads apart
  // from a disabled one's grey. A disabled button still takes the pointer, so its
  // not-allowed cursor and its title can say why, and it does not dim under it.
  // Keyboard focus draws the accent outline.
  test('an enabled accent button reads apart from a disabled one, which still says why', () => {
    const {html, css} = renderWithStyles(
      <>
        <AccentButton type="button">Cancel</AccentButton>
        <PrimaryAccentButton
          type="button"
          disabled
          title="Choose a tap key first"
        >
          Put in
        </PrimaryAccentButton>
        <ToggleButton type="button" $on={false}>
          Ctrl
        </ToggleButton>
      </>,
    );
    // What the element's classes give a property in a state, the later rule winning.
    const valueOf = (tag: string, property: string, state = '') => {
      const classes = /class="([^"]+)"/.exec(tag)?.[1].split(' ') ?? [];
      let value: string | undefined;
      for (const name of classes) {
        const rules = css.matchAll(
          new RegExp(`\\.${name}${state}\\{([^}]*)\\}`, 'g'),
        );
        for (const [, body] of rules) {
          value =
            new RegExp(`(?:^|;)${property}:([^;]+)`).exec(body)?.[1] ?? value;
        }
      }
      return value;
    };
    const [cancel, putIn, ctrl] = html.match(/<button[^>]*>/g)!;
    expect(valueOf(cancel, 'color')).toBe('var(--color_accent-text)');
    expect(valueOf(cancel, 'border-color')).toBe('var(--color_accent-text)');
    expect(valueOf(ctrl, 'color')).toBe('var(--color_accent-text)');
    expect(valueOf(putIn, 'cursor')).toBe('not-allowed');
    expect(putIn).toContain('title="Choose a tap key first"');
    expect(css).not.toContain('pointer-events');
    for (const tag of [cancel, putIn]) {
      expect(valueOf(tag, 'filter', ':hover')).toBeUndefined();
      expect(valueOf(tag, 'filter', ':hover:not\\(:disabled\\)')).toBe(
        'brightness(0.7)',
      );
      expect(valueOf(tag, 'outline', ':focus-visible')).toBe(
        '2px solid var(--color_accent)',
      );
    }
  });

  test('the Tap Dance tab lists slots with their actions and an Edit action', () => {
    const tapdanceFirst = [
      baseMenus.find((menu) => menu.id === 'tapdance')!,
      ...baseMenus.filter((menu) => menu.id !== 'tapdance'),
    ];
    const html = render(tapdanceFirst, {
      tapDance: binding((slot) =>
        slot.index === 0
          ? {actions: {tap: 0x29, hold: 0xe0, dtap: 0, thold: 0}, term: '200'}
          : {actions: {tap: 0, hold: 0, dtap: 0, thold: 0}, term: '200'},
      ),
    });
    // Keys and the dots between them are separate spans, so the dots can step back.
    expect(html.replace(/<[^>]+>/g, '')).toContain('Esc·Left Ctrl·—·—');
    expect(html).toMatch(/Left Ctrl<span class="[^"]+">·<\/span>/);
    expect(html).toContain('200 ms');
    expect(html).toContain('>Empty<');
    expect(html).not.toContain('use Edit');
    // No instruction line above the list: the keycaps and Edit buttons speak for themselves.
    expect(html).not.toContain('A keycap puts that Tap Dance');
    expect(html.match(/>Edit</g)).toHaveLength(8);
  });

  test('a Tap Dance the keyboard has not reported cannot be edited yet', () => {
    const tapdanceFirst = [
      baseMenus.find((menu) => menu.id === 'tapdance')!,
      ...baseMenus.filter((menu) => menu.id !== 'tapdance'),
    ];
    const html = render(tapdanceFirst, {tapDance: binding(() => null)});
    expect(html).toContain('Waiting for the keyboard');
    expect(html.match(/disabled="" aria-label="Edit TD\d"/g)).toHaveLength(8);
  });

  // Firmware that State Sync could not verify has its Tap Dance left unread. Its TD
  // keys are still offered, and the tab says once what the feature tabs say.
  test('an unverified keyboard offers the TD keys with one line in place of their settings', () => {
    const tapdanceFirst = [
      baseMenus.find((menu) => menu.id === 'tapdance')!,
      ...baseMenus.filter((menu) => menu.id !== 'tapdance'),
    ];
    const html = render(tapdanceFirst, {
      tapDance: binding(() => null, {unverified: true, canWrite: false}),
      target: {
        name: 'Selected key',
        sub: 'Layer 0',
        value: selectKeycodeFromMenuCode('TD(0)', v13BasicKeyToByte),
      },
    });
    expect(html.match(/Unable to verify feature support/g)).toHaveLength(1);
    expect(html).not.toContain('Waiting for the keyboard');
    expect(html).not.toContain('>Edit<');
    expect(html).not.toContain('Edit TD0');
    expect(html.match(/<button[^>]*aria-label="Tap Dance \d"/g)).toHaveLength(
      8,
    );
    expect(html).not.toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Tap Dance/,
    );
  });

  // Firmware older than its definition can answer a Tap Dance value as unhandled,
  // and waiting will not change that answer. KEYMAP then does what the feature
  // tabs do: the TD keys stay on offer and the tab says once what those tabs say.
  test('a keyboard that refused its Tap Dance settings offers the TD keys with one line in place of them', () => {
    const tapdanceFirst = [
      baseMenus.find((menu) => menu.id === 'tapdance')!,
      ...baseMenus.filter((menu) => menu.id !== 'tapdance'),
    ];
    const path = 'keycode-palette-refused';
    const {vendorProductId} = definition;
    const identity = `${vendorProductId}:v3:0`;
    // Every Tap Dance value, as an earlier read of CONFIG left them.
    const menuData = Object.fromEntries(
      getTapDanceSlots(definition).flatMap((slot) => [
        ...Object.values(slot.actions).map(({name}) => [name, [0, 0]]),
        ...(slot.term ? [[slot.term.name, [0, 200]]] : []),
      ]),
    );
    // The palette with KEYMAP's own binding, over CONFIG as State Sync left it.
    const renderKeymap = (
      acceptedRevision: number,
      refusedRevision: number,
    ) => {
      const state = {
        settings: {themeName: 'OLIVIA_DARK'},
        definitions: {
          definitions: {},
          customDefinitions: {},
          eraDefinitions: {[vendorProductId]: {v3: definition}},
          definitionEpochs: {},
        },
        devices: {
          selectedDevicePath: path,
          selectedConnectionGeneration: 0,
          selectionGeneration: 1,
          connectedDevicePaths: {
            [path]: {path, vendorProductId, requiredDefinitionVersion: 'v3'},
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
      const Keymap = () => {
        const tapDance = useTapDanceBinding(definition);
        return (
          <KeycodePalette
            menus={tapdanceFirst}
            basicKeyToByte={v13BasicKeyToByte}
            byteToKey={byteToKey}
            target={{
              name: 'Selected key',
              sub: 'Layer 0',
              value: selectKeycodeFromMenuCode('TD(0)', v13BasicKeyToByte),
            }}
            onAssign={() => undefined}
            layerCount={4}
            tapDance={tapDance}
          />
        );
      };
      return renderToStaticMarkup(
        <Provider store={configureStore({reducer: () => state as any})}>
          <I18nextProvider i18n={translations}>
            <Keymap />
          </I18nextProvider>
        </Provider>,
      );
    };
    setEraAdvancedMetadataForTesting({
      schemaVersion: 2,
      definitions: [
        {
          id: 'keycode-palette-refused',
          vendorProductId,
          stateSync: true,
          exactMsFamily: 'qmk',
        },
      ],
    });
    try {
      // Never read, or read before: the refusal of this revision is the answer.
      for (const acceptedRevision of [0, 1]) {
        const html = renderKeymap(acceptedRevision, 2);
        expect(html.match(/Unable to load feature settings/g)).toHaveLength(1);
        expect(html).not.toContain('Waiting for the keyboard');
        expect(html).not.toContain('>Edit<');
        expect(html).not.toContain('Edit TD0');
        expect(
          html.match(/<button[^>]*aria-label="Tap Dance \d"/g),
        ).toHaveLength(8);
        expect(html).not.toMatch(
          /<button[^>]*disabled=""[^>]*aria-label="Tap Dance/,
        );
      }
      // A refusal of an older revision is not: the values read before still show.
      const html = renderKeymap(1, 1);
      expect(html).not.toContain('Unable to load feature settings');
      expect(html.match(/>Edit</g)).toHaveLength(8);
      expect(html).toContain('Edit TD0');
    } finally {
      setEraAdvancedMetadataForTesting(null);
    }
  });

  // The link says one verb; which Tap Dance it opens is in its name and tooltip.
  test('the header offers to edit the key’s Tap Dance only once it has been read', () => {
    const target = {
      name: 'Selected key',
      sub: 'Layer 0',
      value: selectKeycodeFromMenuCode('TD(0)', v13BasicKeyToByte),
    };
    const read = render(baseMenus, {
      tapDance: binding(() => ({
        actions: {tap: 0x29, hold: 0, dtap: 0, thold: 0},
        term: '200',
      })),
      target,
    });
    const link = read.match(/<button[^>]*aria-label="Edit TD0"[^>]*>([^<]*)</);
    expect(link?.[1]).toBe('Edit →');
    expect(link?.[0]).toContain('title="Edit TD0"');
    const unread = render(baseMenus, {tapDance: binding(() => null), target});
    expect(unread).not.toContain('Edit TD0');
  });

  // The palette is for every VIA keyboard. A stock definition has no ERA Tap Dance
  // entries, so a stock keyboard gets the palette without a Tap Dance tab or editor;
  // it must not be offered a feature its firmware does not have.
  test('a stock VIA keyboard gets the palette without Tap Dance', () => {
    const stock = JSON.parse(
      require('node:fs').readFileSync('public/definitions/v3/105185281.json', 'utf8'),
    );
    expect(stock.tapdanceKeycodes).toBeUndefined();
    const menus = buildEnabledKeycodeMenus({
      definition: stock,
      basicKeyToByte: v13BasicKeyToByte,
      protocol: 12,
    });
    expect(menus.map((menu) => menu.id)).not.toContain('tapdance');
    expect(menus.map((menu) => menu.id)).toContain('basic');

    const html = render(menus);
    expect(html).not.toContain('Tap Dance');
    expect(html).not.toMatch(/TD\d/);
    expect(html).toContain('+ Combined key');

    const era = buildEnabledKeycodeMenus({
      definition,
      basicKeyToByte: v13BasicKeyToByte,
      protocol: 12,
    });
    expect(era.map((menu) => menu.id)).toContain('tapdance');
  });

  test('without a selected key it says so instead of naming a target', () => {
    const html = render(baseMenus, {target: null});
    expect(html).toContain('No key selected');
    expect(html).not.toContain('Select a key on the keyboard first');
    expect(html).not.toContain('aria-current="true"');
    // Blanking acts on the selected key, so it waits for one.
    expect(html).toMatch(/disabled=""[^>]*>Clear</);
  });

  // Search and code input are one box, and blanking sits with the key it blanks:
  // the header has no separate Code or Clear action.
  test('the header offers search or code, and blanking beside the selected key', () => {
    const html = render(baseMenus);
    expect(html).toContain('placeholder="Search or enter a keycode"');
    expect(html).not.toMatch(/>Code</);
    expect(html.match(/>Clear</g)).toHaveLength(1);
    const blank = html.indexOf('>Clear<');
    expect(blank).toBeGreaterThan(html.indexOf('Selected key'));
    expect(blank).toBeLessThan(html.indexOf('placeholder="Search or enter a keycode"'));
    expect(html).not.toMatch(/disabled=""[^>]*>Clear</);
  });
});

// KEYMAP and its Tap Dance binding over a store as the app has it, and a keyboard
// that answers each write as VIA firmware does.
const {HID, registerHIDDeviceForTesting, resetHIDTransportForTesting} =
  await import('../src/shims/node-hid');
const {KeyboardAPI} = await import('../src/utils/keyboard-api');
const {
  default: devicesReducer,
  selectDevice,
  updateConnectedDevices,
} = await import('../src/store/devicesSlice');
const {
  default: definitionsReducer,
  getSelectedKeyDefinitions,
  updateEraDefinitions,
} = await import('../src/store/definitionsSlice');
const {default: menusReducer, updateSelectedCustomMenuData} =
  await import('../src/store/menusSlice');
const {default: draftsReducer, setDraft} = await import('../src/store/draftsSlice');
const {default: stateSyncReducer} = await import('../src/store/stateSyncSlice');
const {default: firmwareReducer} = await import('../src/store/firmwareSlice');
const {default: settingsReducer} = await import('../src/store/settingsSlice');
const {DirtyDot} = await import('../src/components/inputs/dirty-dot');
const {
  default: keymapReducer,
  loadLayerSuccess,
  setNumberOfLayers,
  updateSelectedKey,
} = await import('../src/store/keymapSlice');
const {default: macrosReducer} = await import('../src/store/macrosSlice');
const {getNextKey} = await import('../src/utils/keyboard-rendering');
const {KeycodePane} =
  await import('../src/components/panes/configure-panes/keycode');

type InputListener = (event: {data: DataView}) => void;

// Echoes every command as VIA firmware does, and refuses the ones it is told to
// the way QMK refuses a value: the request sent back as id_unhandled. A reply it
// is told to hold waits for release(), as a slow keyboard's does.
class Keyboard {
  opened = false;
  vendorId = definition.vendorProductId >>> 16;
  productId = definition.vendorProductId & 0xffff;
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

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');
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
const tab = (root: ReactTestInstance, label: string) =>
  root.find(
    (node) =>
      node.type === 'button' &&
      node.props['aria-pressed'] !== undefined &&
      node.props.title === undefined &&
      textOf(node) === label,
  );
const click = (node: ReactTestInstance) => act(() => node.props.onClick());

describe('the palette in Korean', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  // The Tap Dance tab is drawn by the app, so it reads in the app's language like the
  // tabs beside it, as do the search heading and the way back from the editor.
  test('names the Tap Dance tab, its search heading and the way back in Korean', async () => {
    const ko = i18n.createInstance();
    await ko.init({
      lng: 'ko',
      resources: {
        ko: {
          translation: JSON.parse(
            require('node:fs').readFileSync('src/locales/ko.json', 'utf8'),
          ),
        },
      },
    });
    act(() => {
      renderer = create(
        <Provider store={store}>
          <I18nextProvider i18n={ko}>
            <KeycodePalette
              menus={baseMenus}
              basicKeyToByte={v13BasicKeyToByte}
              byteToKey={byteToKey}
              target={{name: '선택한 키', value: 0x04}}
              onAssign={() => undefined}
              layerCount={4}
              tapDance={binding(() => ({
                actions: {tap: 0x29, hold: 0, dtap: 0, thold: 0},
                term: '200',
              }))}
            />
          </I18nextProvider>
        </Provider>,
      );
    });
    const root = renderer!.root;
    const search = () =>
      root.find((node) => node.type === 'input' && node.props.type === 'search');
    act(() => search().props.onChange({target: {value: 'TD'}}));
    expect(textOf(root.find((node) => node.type === 'main'))).toContain(
      '탭댄스 · 8',
    );
    act(() => search().props.onChange({target: {value: ''}}));
    click(tab(root, '탭댄스'));
    click(button(root, 'TD0 동작 편집'));
    click(tab(root, '탭댄스'));
    expect(button(root, 'TD0 동작 편집').props.disabled).toBeFalsy();
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('TAPDANCE');
  });
});

describe('editing a Tap Dance', () => {
  const PATH = 'keycode-palette-editing';
  const VPID: number = definition.vendorProductId;
  const SET = 0x07;
  const SAVE = 0x09;
  const [TD0] = getTapDanceSlots(definition);
  const REFUSED =
    'Could not complete this change. Settings after it were not sent.';

  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    resetHIDTransportForTesting();
    setEraAdvancedMetadataForTesting(null);
  });

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
    const store = configureStore({
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
      },
    });
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
    store.dispatch(
      updateSelectedCustomMenuData({devicePath: PATH, menuData}),
    );
    return {keyboard, store};
  };

  type Store = Awaited<ReturnType<typeof connect>>['store'];

  const Keymap = ({layerCount = 4, selectedDefinition = definition}: {layerCount?: number; selectedDefinition?: typeof definition}) => {
    const tapDance = useTapDanceBinding(selectedDefinition);
    return (
      <KeycodePalette
        menus={baseMenus}
        basicKeyToByte={v13BasicKeyToByte}
        byteToKey={byteToKey}
        target={{name: 'Selected key', sub: 'Layer 0', value: 0x04}}
        onAssign={() => undefined}
        layerCount={layerCount}
        tapDance={tapDance}
      />
    );
  };

  // KEYMAP as the rail, a route or an encoder leaves it and comes back: built anew.
  const show = (store: Store, layerCount = 4, selectedDefinition = definition) => {
    act(() => renderer?.unmount());
    act(() => {
      renderer = create(
        <Provider store={store}>
          <I18nextProvider i18n={translations}>
            <Keymap layerCount={layerCount} selectedDefinition={selectedDefinition} />
          </I18nextProvider>
        </Provider>,
      );
    });
    return renderer!.root;
  };

  // The words a screen reader gets: what is marked aria-hidden is left out.
  const spoken = (node: ReactTestInstance | string): string =>
    typeof node === 'string'
      ? node
      : node.props['aria-hidden']
        ? ''
        : node.children.map(spoken).join('');
  // The four slots: the pressable buttons in the editor's group of actions.
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
  const slotButton = (root: ReactTestInstance, role: string) => {
    const [slot] = slotButtons(root).filter((node) =>
      spoken(node).startsWith(role),
    );
    return slot;
  };
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
  const termLabel = (root: ReactTestInstance) =>
    root.find(
      (node) =>
        node.type === 'label' &&
        node.findAll(
          (child) =>
            child.type === 'input' && child.props.inputMode === 'numeric',
        ).length > 0,
    );
  // The underline around the number, which marks a value the keyboard would refuse.
  const termField = (root: ReactTestInstance) =>
    root.find((node) => node.props.$invalid !== undefined);
  const apply = (root: ReactTestInstance) => button(root, 'Save');
  const clickApply = async (root: ReactTestInstance) => {
    await act(async () => {
      await apply(root).props.onClick();
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
  // Starts Apply and lets it run until the keyboard sits on the write it holds. What
  // it returns answers that write and waits for Apply to end.
  const applyHeld = async (
    keyboard: Keyboard,
    root: ReactTestInstance,
    isHeld: (bytes: number[]) => boolean,
  ) => {
    keyboard.hold = isHeld;
    let applying: Promise<void> = Promise.resolve();
    act(() => {
      applying = apply(root).props.onClick();
    });
    for (let tries = 0; tries < 100 && keyboard.held.length === 0; tries++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(keyboard.held).toHaveLength(1);
    return async () => {
      keyboard.hold = () => false;
      await act(async () => {
        keyboard.release();
        await applying;
      });
    };
  };

  test('a refused automatic SAVE remains retryable after the editor is reopened', async () => {
    const {keyboard, store} = await connect();
    let root = show(store);
    openTd0(root);
    typeTerm(root, '180');
    keyboard.refuse = ([command]) => command === SAVE;
    await clickApply(root);
    expect(alerts(root)).toEqual([REFUSED]);
    expect(store.getState().menus.customMenuDataMap[PATH][TD0.term!.name]).toEqual([0, 180]);
    expect(apply(root).props.disabled).toBe(false);
    root = show(store);
    openTd0(root);
    expect(apply(root).props.disabled).toBe(false);
    typeTerm(root, '190');
    typeTerm(root, '180');
    expect(apply(root).props.disabled).toBe(false);
    keyboard.refuse = () => false;
    await clickApply(root);
    expect(writes(keyboard)).toEqual([
      [SET, TD0.term!.channel, TD0.term!.id, 0, 180], [SAVE, TD0.term!.channel],
      [SET, TD0.term!.channel, TD0.term!.id, 0, 180], [SAVE, TD0.term!.channel],
    ]);
    expect(store.getState().drafts[PATH]).toBeUndefined();
  });

  test('an invalid independent hold time disables Save and sends nothing', async () => {
    const {keyboard, store} = await connect();
    const advancedDefinition = {...definition, tapdanceKeycodes: JSON.parse(
      require('node:fs').readFileSync('era-definitions/custom/v3/brick60-h7s/BRICK60-H7S-VIA.json', 'utf8'),
    ).tapdanceKeycodes};
    const [slot] = getTapDanceSlots(advancedDefinition);
    store.dispatch(updateEraDefinitions({[VPID]: {v3: advancedDefinition}} as any));
    store.dispatch(updateSelectedCustomMenuData({devicePath: PATH, menuData: {
      ...store.getState().menus.customMenuDataMap[PATH],
      [slot.mode!.name]: [1, 0xd2, 0xd3],
      [slot.holdTerm!.name]: [0, 180, 0xd3],
      [slot.holdOnOther!.name]: [0, 0xd3],
    }}));
    const root = show(store, 4, advancedDefinition);
    openTd0(root);
    const holdTerm = () => root.find((node) => node.type === 'input' && node.props['aria-label'] === 'Hold decision');
    for (const value of ['65536', '-1', '1.5', '']) {
      act(() => holdTerm().props.onChange({target: {value}}));
      act(() => holdTerm().props.onBlur());
      expect(holdTerm().props['aria-invalid']).toBe(true);
      expect(apply(root).props.disabled).toBe(true);
    }
    act(() => holdTerm().props.onChange({target: {value: '65535'}}));
    expect(apply(root).props.disabled).toBe(false);
    expect(writes(keyboard)).toEqual([]);
  });

  test('added actions and input timing stay drafts, survive refused mode writes, and round-trip', async () => {
    const {keyboard, store} = await connect();
    const modeDefinition = structuredClone(definition);
    const modeName = 'id_qmk_tapdance_1_mode';
    modeDefinition.tapdanceKeycodes[0].controls.push({
      label: 'Input start', type: 'dropdown', content: [modeName, 16, 49],
      options: [['Legacy', 0], ['After decision', 1], ['On press', 2]],
    });
    store.dispatch(updateEraDefinitions({[VPID]: {v3: modeDefinition}} as any));
    store.dispatch(updateSelectedCustomMenuData({devicePath: PATH, menuData: {
      ...store.getState().menus.customMenuDataMap[PATH], [modeName]: [0, 0xd2],
    }}));
    const root = show(store, 4, modeDefinition);
    openTd0(root);
    expect(slotButtons(root)).toHaveLength(2);
    const timing = (label: string) => root.find((node) => node.type === 'input' && node.props.type === 'radio' && node.props['aria-label'] === label);
    const remove = (name: string) => root.find((node) => node.type === 'button' && node.props['aria-label'] === `Remove ${name}`);
    act(() => remove('On Hold').props.onClick());
    expect(slotButtons(root)).toHaveLength(1);
    click(button(root, 'Add action: Tap+Hold'));
    expect(apply(root).props.disabled).toBe(true);
    click(button(root, 'Tap+Hold: B'));
    act(() => timing('On press').props.onChange());
    expect(slotButtons(root)).toHaveLength(2);
    expect(writes(keyboard)).toEqual([]);
    click(button(root, 'Base key: A'));
    expect(slotButton(root, 'Tap+Hold').props['aria-pressed']).toBe(true);
    click(button(root, 'Tap+Hold: B'));
    expect(slotButton(root, 'Base key').props['aria-pressed']).toBe(true);
    keyboard.refuse = (bytes) => bytes[0] === SET && bytes[2] === 49;
    await clickApply(root);
    expect(alerts(root)).toEqual([REFUSED]);
    expect(store.getState().drafts[PATH]).toEqual({'tapDance:0': {mode: 2}});
    keyboard.refuse = () => false;
    await clickApply(root);
    expect(writes(keyboard).slice(-2)).toEqual([[SET, 16, 49, 2, 0xd2], [SAVE, 16]]);
    expect(store.getState().menus.customMenuDataMap[PATH][TD0.actions.hold.name]).toEqual([0, 1]);
    openTd0(root);
    expect(timing('On press').props.checked).toBe(true);
    act(() => timing('After decision').props.onChange());
    click(button(root, 'Add action: On Hold'));
    expect(slotButtons(root)).toHaveLength(3);
    expect(apply(root).props.disabled).toBe(true);
    click(button(root, 'Cancel'));
    openTd0(root);
    expect(timing('On press').props.checked).toBe(true);
    expect(slotButtons(root)).toHaveLength(2);
  });

  test('an edit is kept for the keyboard when the editor, the tab or KEYMAP is left, until Cancel', async () => {
    const {keyboard, store} = await connect();
    let root = show(store);
    openTd0(root);
    click(button(root, 'On Tap: A'));
    typeTerm(root, '180');
    expect(apply(root).props.disabled).toBe(false);

    // Back to the list: no question asked, the change shows on its row and tab.
    click(tab(root, 'Tap Dance'));
    expect(
      root.findAll((node) => node.props.role === 'alertdialog'),
    ).toHaveLength(0);
    expect(textOf(row(root, 'TD0'))).toContain('A·Left Ctrl·—·—');
    expect(textOf(row(root, 'TD0'))).toContain('180 ms');
    expect(hasDot(row(root, 'TD0'))).toBe(true);
    expect(hasDot(row(root, 'TD1'))).toBe(false);
    expect(hasDot(tab(root, 'Tap Dance'))).toBe(true);

    // Another tab, then KEYMAP left and come back to.
    click(tab(root, 'Basic'));
    expect(hasDot(tab(root, 'Tap Dance'))).toBe(true);
    root = show(store);
    expect(hasDot(tab(root, 'Tap Dance'))).toBe(true);
    openTd0(root);
    expect(term(root).props.value).toBe('180');
    expect(hasDot(slotButton(root, 'On Tap'))).toBe(true);
    expect(hasDot(slotButton(root, 'On Hold'))).toBe(false);
    expect(hasDot(termLabel(root))).toBe(true);
    expect(apply(root).props.disabled).toBe(false);
    expect(writes(keyboard)).toEqual([]);

    // Cancel puts the keyboard's values back without writing.
    click(button(root, 'Cancel'));
    expect(textOf(row(root, 'TD0'))).toContain('Esc·Left Ctrl·—·—');
    expect(textOf(row(root, 'TD0'))).toContain('200 ms');
    expect(hasDot(row(root, 'TD0'))).toBe(false);
    expect(hasDot(tab(root, 'Tap Dance'))).toBe(false);
    expect(store.getState().drafts).toEqual({});
    expect(writes(keyboard)).toEqual([]);

    // A key set back to what the keyboard holds is no change.
    click(button(root, 'Edit TD0'));
    click(button(root, 'On Tap: A'));
    click(slotButton(root, 'On Tap'));
    click(button(root, 'On Tap: Esc'));
    expect(hasDot(slotButton(root, 'On Tap'))).toBe(false);
    expect(apply(root).props.disabled).toBe(true);
    expect(store.getState().drafts).toEqual({});

    // Unplugged, the keyboard takes its drafts with it.
    click(button(root, 'On Hold: A'));
    expect(store.getState().drafts[PATH]).toBeDefined();
    act(() => {
      store.dispatch(updateConnectedDevices({}));
    });
    expect(store.getState().drafts).toEqual({});
  });

  test('Apply writes the changed fields in slot order and stops at a refusal, which stays a draft', async () => {
    const {keyboard, store} = await connect();
    const root = show(store);
    openTd0(root);
    click(button(root, 'On Tap: A'));
    click(slotButton(root, 'On Double Tap'));
    click(button(root, 'On Double Tap: B'));
    typeTerm(root, '180');
    keyboard.refuse = (bytes) => bytes[0] === SET && bytes[2] === TD0.actions.dtap.id;

    const {channel} = TD0.actions.tap;
    await clickApply(root);
    expect(writes(keyboard)).toEqual([
      [SET, channel, TD0.actions.tap.id, 0, 0x04],
      [SAVE, channel],
      [SET, channel, TD0.actions.dtap.id, 0, 0x05],
    ]);
    expect(alerts(root)).toEqual([REFUSED]);
    // What the keyboard took is no longer a change; the rest still is.
    expect(hasDot(slotButton(root, 'On Tap'))).toBe(false);
    expect(hasDot(slotButton(root, 'On Double Tap'))).toBe(true);
    expect(hasDot(termLabel(root))).toBe(true);
    expect(store.getState().drafts[PATH]).toEqual({
      'tapDance:0': {dtap: 0x05, term: '180'},
    });

    keyboard.refuse = () => false;
    keyboard.sent = [];
    await clickApply(root);
    expect(writes(keyboard)).toEqual([
      [SET, channel, TD0.actions.dtap.id, 0, 0x05],
      [SAVE, channel],
      [SET, TD0.term!.channel, TD0.term!.id, 0, 180],
      [SAVE, TD0.term!.channel],
    ]);
    expect(store.getState().drafts).toEqual({});
    expect(textOf(row(root, 'TD0'))).toContain('A·Left Ctrl·B·—');
    expect(textOf(row(root, 'TD0'))).toContain('Saved');
    expect(hasDot(row(root, 'TD0'))).toBe(false);
  });

  test('a refused SAVE after switching keyboards stays retryable on the original keyboard', async () => {
    const {keyboard, store} = await connect();
    const deviceA = store.getState().devices.connectedDevicePaths[PATH];
    const pathB = `${PATH}-save-failure`;
    const keyboardB = new Keyboard();
    registerHIDDeviceForTesting(pathB, keyboardB as unknown as HIDDevice);
    await new HID.HID(pathB).openPromise;
    const deviceB = {...deviceA, path: pathB};
    store.dispatch(updateConnectedDevices({[PATH]: deviceA, [pathB]: deviceB}));
    let root = show(store);
    openTd0(root);
    typeTerm(root, '180');
    keyboard.refuse = ([command]) => command === SAVE;
    const answer = await applyHeld(keyboard, root, keyboard.refuse);
    act(() => store.dispatch(selectDevice({device: deviceB,
      connectionGeneration: new KeyboardAPI(pathB).getConnectionGeneration()})));
    await answer();
    expect(writes(keyboardB)).toEqual([]);
    act(() => store.dispatch(selectDevice({device: deviceA,
      connectionGeneration: new KeyboardAPI(PATH).getConnectionGeneration()})));
    root = show(store);
    openTd0(root);
    expect(apply(root).props.disabled).toBe(false);
    keyboard.refuse = () => false;
    await clickApply(root);
    expect(store.getState().drafts[PATH]).toBeUndefined();
    expect(writes(keyboardB)).toEqual([]);
  });

  for (const heldCommand of [SET, SAVE]) {
    test(`Apply stops its batch on a device switch while A's first ${heldCommand === SET ? 'SET' : 'SAVE'} waits`, async () => {
      const {keyboard: keyboardA, store} = await connect();
      const pathB = `${PATH}-second`;
      const keyboardB = new Keyboard();
      registerHIDDeviceForTesting(pathB, keyboardB as unknown as HIDDevice);
      await new HID.HID(pathB).openPromise;
      const deviceA = store.getState().devices.connectedDevicePaths[PATH];
      const deviceB = {...deviceA, path: pathB, productName: 'Tap Dance B'};
      const menuDataB = {
        ...store.getState().menus.customMenuDataMap[PATH],
        [TD0.actions.tap.name]: [0, 0x07],
        [TD0.actions.dtap.name]: [0, 0x08],
        [TD0.term!.name]: [0, 240],
      };
      store.dispatch(
        updateConnectedDevices({[PATH]: deviceA, [pathB]: deviceB}),
      );
      store.dispatch(
        updateSelectedCustomMenuData({devicePath: pathB, menuData: menuDataB}),
      );
      store.dispatch(
        setDraft({devicePath: pathB, key: 'tapDance:0', value: {dtap: 0x09}}),
      );
      const root = show(store);
      openTd0(root);
      click(button(root, 'On Tap: A'));
      click(slotButton(root, 'On Double Tap'));
      click(button(root, 'On Double Tap: B'));
      typeTerm(root, '180');
      const answer = await applyHeld(
        keyboardA,
        root,
        (bytes) =>
          bytes[0] === heldCommand &&
          (heldCommand === SAVE || bytes[2] === TD0.actions.tap.id),
      );
      act(() =>
        store.dispatch(
          selectDevice({
            device: deviceB,
            connectionGeneration: new KeyboardAPI(
              pathB,
            ).getConnectionGeneration(),
          }),
        ),
      );
      await answer();
      expect(store.getState().devices.selectedDevicePath).toBe(pathB);
      expect(writes(keyboardA)).toEqual([
        [SET, TD0.actions.tap.channel, TD0.actions.tap.id, 0, 0x04],
        [SAVE, TD0.actions.tap.channel],
      ]);
      expect(writes(keyboardB)).toEqual([]);
      expect(store.getState().drafts[PATH]).toEqual({
        'tapDance:0': {dtap: 0x05, term: '180'},
      });
      expect(store.getState().drafts[pathB]).toEqual({
        'tapDance:0': {dtap: 0x09},
      });
      expect(
        store.getState().menus.customMenuDataMap[PATH][TD0.actions.tap.name],
      ).toEqual([0, 0x04]);
      expect(
        store.getState().menus.customMenuDataMap[PATH][TD0.actions.dtap.name],
      ).toEqual([0, 0]);
      expect(
        store.getState().menus.customMenuDataMap[PATH][TD0.term!.name],
      ).toEqual([0, 200]);
      expect(store.getState().menus.customMenuDataMap[pathB]).toEqual(
        menuDataB,
      );
    });
  }

  // While a write is on its way the menu data already holds its value, so a field
  // on its way reads as no change. Setting another one meanwhile must not drop it.
  test('a change made while Apply waits for the keyboard keeps the one on its way, taken or refused', async () => {
    const {keyboard, store} = await connect();
    const root = show(store);
    const isDtap = (bytes: number[]) =>
      bytes[0] === SET && bytes[2] === TD0.actions.dtap.id;
    openTd0(root);
    click(slotButton(root, 'On Double Tap'));
    click(button(root, 'On Double Tap: B'));

    // Refused after the term and the next slot were set.
    keyboard.refuse = isDtap;
    let answer = await applyHeld(keyboard, root, isDtap);
    typeTerm(root, '180');
    click(button(root, 'Tap+Hold: C'));
    await answer();
    expect(alerts(root)).toEqual([REFUSED]);
    expect(store.getState().drafts[PATH]).toEqual({
      'tapDance:0': {dtap: 0x05, thold: 0x06, term: '180'},
    });
    expect(textOf(slotButton(root, 'On Double Tap'))).toBe('BOn Double Tap');
    expect(hasDot(slotButton(root, 'On Double Tap'))).toBe(true);
    expect(apply(root).props.disabled).toBe(false);

    // Taken: what was on its way is done, the slot set meanwhile is still a change.
    keyboard.refuse = () => false;
    answer = await applyHeld(keyboard, root, isDtap);
    click(button(root, 'On Tap: D'));
    await answer();
    expect(store.getState().drafts[PATH]).toEqual({'tapDance:0': {tap: 0x07}});
    expect(textOf(row(root, 'TD0'))).toContain('D·Left Ctrl·B·C');
    expect(hasDot(row(root, 'TD0'))).toBe(true);
  });

  // The keyboard's values show the value on its way before the keyboard answers, so
  // a field changed and then set to that value again must not read as no change.
  test('a field set again to the value on its way stays a change until the keyboard takes it', async () => {
    const {keyboard, store} = await connect();
    let root = show(store);
    const writeOf = (id: number) => (bytes: number[]) =>
      bytes[0] === SET && bytes[2] === id;

    // Double Tap: B on its way, C picked, then B again, and the keyboard refuses B.
    openTd0(root);
    click(slotButton(root, 'On Double Tap'));
    click(button(root, 'On Double Tap: B'));
    keyboard.refuse = writeOf(TD0.actions.dtap.id);
    let answer = await applyHeld(keyboard, root, keyboard.refuse);
    click(slotButton(root, 'On Double Tap'));
    click(button(root, 'On Double Tap: C'));
    click(slotButton(root, 'On Double Tap'));
    click(button(root, 'On Double Tap: B'));
    await answer();
    expect(alerts(root)).toEqual([REFUSED]);
    expect(store.getState().drafts[PATH]).toEqual({'tapDance:0': {dtap: 0x05}});
    expect(textOf(slotButton(root, 'On Double Tap'))).toBe('BOn Double Tap');
    expect(hasDot(slotButton(root, 'On Double Tap'))).toBe(true);
    expect(apply(root).props.disabled).toBe(false);

    // Term: 180 on its way, 18 typed, then 180 again.
    click(button(root, 'Cancel'));
    openTd0(root);
    typeTerm(root, '180');
    keyboard.refuse = writeOf(TD0.term!.id);
    answer = await applyHeld(keyboard, root, keyboard.refuse);
    typeTerm(root, '18');
    typeTerm(root, '180');
    await answer();
    expect(store.getState().drafts[PATH]).toEqual({
      'tapDance:0': {term: '180'},
    });
    expect(term(root).props.value).toBe('180');
    expect(hasDot(termLabel(root))).toBe(true);
    expect(apply(root).props.disabled).toBe(false);

    // Clear: the blank on its way, C put in, then cleared again.
    click(button(root, 'Cancel'));
    openTd0(root);
    click(button(root, 'Clear'));
    keyboard.refuse = writeOf(TD0.actions.tap.id);
    answer = await applyHeld(keyboard, root, keyboard.refuse);
    click(button(root, 'On Tap: C'));
    click(slotButton(root, 'On Tap'));
    click(button(root, 'Clear'));
    await answer();
    expect(store.getState().drafts[PATH]).toEqual({'tapDance:0': {tap: 0}});
    expect(hasDot(slotButton(root, 'On Tap'))).toBe(true);
    expect(apply(root).props.disabled).toBe(false);

    // The same in the editor of a KEYMAP left and come back to while B is on its way.
    click(button(root, 'Cancel'));
    openTd0(root);
    click(slotButton(root, 'On Double Tap'));
    click(button(root, 'On Double Tap: B'));
    keyboard.refuse = writeOf(TD0.actions.dtap.id);
    answer = await applyHeld(keyboard, root, keyboard.refuse);
    root = show(store);
    openTd0(root);
    click(slotButton(root, 'On Double Tap'));
    click(button(root, 'On Double Tap: C'));
    click(slotButton(root, 'On Double Tap'));
    click(button(root, 'On Double Tap: B'));
    await answer();
    expect(store.getState().drafts[PATH]).toEqual({'tapDance:0': {dtap: 0x05}});
    expect(hasDot(slotButton(root, 'On Double Tap'))).toBe(true);
    expect(apply(root).props.disabled).toBe(false);

    // Taken: the value set again is the keyboard's now, so no change is left.
    click(button(root, 'Cancel'));
    openTd0(root);
    click(slotButton(root, 'On Double Tap'));
    click(button(root, 'On Double Tap: B'));
    keyboard.refuse = () => false;
    answer = await applyHeld(keyboard, root, writeOf(TD0.actions.dtap.id));
    click(slotButton(root, 'On Double Tap'));
    click(button(root, 'On Double Tap: C'));
    click(slotButton(root, 'On Double Tap'));
    click(button(root, 'On Double Tap: B'));
    await answer();
    expect(store.getState().drafts).toEqual({});
    expect(textOf(row(root, 'TD0'))).toContain('Esc·Left Ctrl·B·—');
    expect(hasDot(row(root, 'TD0'))).toBe(false);
  });

  // The list shows a slot as Apply would leave it. A term Apply cannot write is not
  // one, so the row keeps the keyboard's; its dot says a change is waiting.
  test('a term Apply cannot write reads on the list as the keyboard’s, beside the dot', async () => {
    const {store} = await connect();
    const root = show(store);
    for (const [typed, listed] of [
      ['', '200'],
      ['abc', '200'],
      ['0', '200'],
      ['180', '180'],
    ]) {
      openTd0(root);
      typeTerm(root, typed);
      click(tab(root, 'Tap Dance'));
      expect({typed, row: textOf(row(root, 'TD0'))}).toEqual({
        typed,
        row: `TD0Esc·Left Ctrl·—·—${listed} msEdit`,
      });
      expect(hasDot(row(root, 'TD0'))).toBe(true);
    }
  });

  test('the term is the menus’ millisecond field: a bad value is marked with the range under it and keeps Apply off', async () => {
    const {store} = await connect();
    const root = show(store);
    openTd0(root);
    // The unit sits in the field.
    expect(textOf(termLabel(root))).toBe('Termms');
    expect(termField(root).props.$invalid).toBe(false);
    expect(alerts(root)).toEqual([]);

    for (const value of ['0', '65536', '12.5']) {
      typeTerm(root, value);
      expect({
        value,
        invalid: termField(root).props.$invalid,
        said: alerts(root),
      }).toEqual({value, invalid: true, said: ['1–65535']});
      expect(term(root).props['aria-invalid']).toBe(true);
      // At the field, not on a line of its own under the row.
      expect(textOf(termLabel(root))).toBe('Termms1–65535');
      expect(apply(root).props.disabled).toBe(true);
    }

    // Emptied to type another number, it is marked only once it is left.
    typeTerm(root, '');
    expect(termField(root).props.$invalid).toBe(false);
    expect(alerts(root)).toEqual([]);
    expect(apply(root).props.disabled).toBe(true);
    act(() => term(root).props.onBlur());
    expect(termField(root).props.$invalid).toBe(true);
    expect(alerts(root)).toEqual(['1–65535']);

    typeTerm(root, '200');
    expect(termField(root).props.$invalid).toBe(false);
    expect(alerts(root)).toEqual([]);
    expect(hasDot(termLabel(root))).toBe(false);
    expect(store.getState().drafts).toEqual({});
  });

  // Enter in the term is the editor's Apply, and does nothing while Apply is off or
  // an input method is still composing.
  test('Enter in the term applies the slot as Apply does', async () => {
    const {keyboard, store} = await connect();
    const root = show(store);
    openTd0(root);
    const enter = async (isComposing = false) => {
      await act(async () => {
        term(root).props.onKeyDown({key: 'Enter', nativeEvent: {isComposing}});
      });
      for (let tries = 0; tries < 20; tries++) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      }
    };

    await enter();
    click(button(root, 'On Tap: A'));
    typeTerm(root, '0');
    await enter();
    // Enter marks an emptied term as leaving it does.
    typeTerm(root, '');
    expect(alerts(root)).toEqual([]);
    await enter();
    expect(alerts(root)).toEqual(['1–65535']);
    expect(writes(keyboard)).toEqual([]);

    typeTerm(root, '180');
    await enter(true);
    expect(writes(keyboard)).toEqual([]);
    await enter();
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

  // A term the keyboard reports outside the range is its own, not a mistake: the
  // editor does not mark it, and it holds up no other change, as in a menu.
  test('a term the keyboard reports outside the range is not marked and holds nothing up', async () => {
    const {keyboard, store} = await connect();
    act(() => {
      store.dispatch(
        updateSelectedCustomMenuData({
          devicePath: PATH,
          menuData: {
            ...store.getState().menus.customMenuDataMap[PATH],
            [TD0.term!.name]: [0, 0],
          },
        }),
      );
    });
    const root = show(store);
    openTd0(root);
    expect(term(root).props.value).toBe('0');
    expect(termField(root).props.$invalid).toBe(false);
    expect(alerts(root)).toEqual([]);

    click(button(root, 'On Tap: A'));
    expect(apply(root).props.disabled).toBe(false);
    await clickApply(root);
    const {channel} = TD0.actions.tap;
    expect(writes(keyboard)).toEqual([
      [SET, channel, TD0.actions.tap.id, 0, 0x04],
      [SAVE, channel],
    ]);
    expect(store.getState().drafts).toEqual({});
  });

  // Nothing takes the place of the tabs and search while a slot is edited; the tab
  // being edited remains browsable, with recursive actions disabled per key.
  test('Apply preserves an unknown saved action and rejects an unsupported changed action before any write', async () => {
    const {keyboard, store} = await connect();
    store.dispatch(updateSelectedCustomMenuData({
      devicePath: PATH,
      menuData: {
        ...store.getState().menus.customMenuDataMap[PATH],
        [TD0.actions.tap.name]: [0x7f, 0xff],
      },
    }));
    const root = show(store);
    openTd0(root);
    typeTerm(root, '180');
    expect(apply(root).props.disabled).toBe(false);
    await clickApply(root);
    expect(writes(keyboard)).toEqual([
      [SET, TD0.term!.channel, TD0.term!.id, 0, 180],
      [SAVE, TD0.term!.channel],
    ]);
    expect(
      store.getState().menus.customMenuDataMap[PATH][TD0.actions.tap.name],
    ).toEqual([0x7f, 0xff]);

    openTd0(root);
    act(() => store.dispatch(setDraft({
      devicePath: PATH,
      key: 'tapDance:0',
      value: {tap: selectKeycodeFromMenuCode('TD(0)', v13BasicKeyToByte)},
    })));
    expect(apply(root).props.disabled).toBe(true);
    expect(apply(root).props.title).toContain('cannot start another Tap Dance');
    await clickApply(root);
    expect(writes(keyboard)).toHaveLength(2);
    expect(store.getState().drafts[PATH]).toBeTruthy();
  });

  test('the palette keeps its own tabs and search while a slot is edited', async () => {
    const {store} = await connect();
    const root = show(store);
    openTd0(root);
    expect(tab(root, 'Tap Dance').props.disabled).toBeFalsy();
    expect(tab(root, 'Basic').props.disabled).toBeFalsy();
    expect(
      root.findAll(
        (node) => node.type === 'input' && node.props.type === 'search',
      ),
    ).toHaveLength(1);
  });

  test('a Tap Dance editor shows unavailable layer keys with their native disabled reason', async () => {
    const {store} = await connect();
    store.dispatch(
      setNumberOfLayers({
        devicePath: PATH,
        numberOfLayers: 2,
        connectionGeneration: new KeyboardAPI(PATH).getConnectionGeneration(),
      }),
    );
    const root = show(store, 2);
    openTd0(root);
    click(tab(root, 'Layers'));
    const mo3 = button(root, 'On Tap: Momentary turn layer 3 on');
    expect(mo3.props.disabled).toBe(true);
    expect(mo3.props['aria-disabled']).toBe(true);
    expect(mo3.props.title).toContain(
      'This layer is not available on this keyboard.',
    );
    click(mo3);
    expect(store.getState().drafts).toEqual({});
  });

  test('Tap Dance keeps recursive and unavailable choices visible while rejecting click and typed bypasses', async () => {
    const {keyboard, store} = await connect();
    const root = show(store);
    openTd0(root);
    const search = root.find(
      (node) => node.type === 'input' && node.props.type === 'search',
    );
    act(() => search.props.onChange({target: {value: 'TD'}}));
    const recursive = buttons(root, (node) =>
      node.props.title?.includes('cannot start another Tap Dance'),
    );
    expect(recursive).toHaveLength(8);
    for (const key of recursive) {
      expect(key.props.disabled).toBe(true);
      expect(key.props['aria-disabled']).toBe(true);
      expect(textOf(key)).not.toContain('⊘');
    }
    click(recursive[0]);
    expect(store.getState().drafts).toEqual({});
    for (const input of ['TD(0)', 'MO(15)', '0x00FF', 'KC_TRNS']) {
      act(() => search.props.onChange({target: {value: input}}));
      act(() => search.props.onKeyDown({key: 'Enter'}));
      expect(store.getState().drafts).toEqual({});
      expect(search.props.value).toBe(input);
    }
    expect(writes(keyboard)).toEqual([]);
    act(() => search.props.onChange({target: {value: 'LT(1,KC_A)'}}));
    act(() => search.props.onKeyDown({key: 'Enter'}));
    expect(store.getState().drafts[PATH]).toEqual({'tapDance:0': {tap: 0x4104}});
    expect(writes(keyboard)).toEqual([]);
  });

  test('the editor names each slot by its role only and puts the Tap Dance in with one word', async () => {
    const {store} = await connect();
    const root = show(store);
    openTd0(root);
    expect(
      slotButtons(root).map((node) => [spoken(node), node.props.title]),
    ).toEqual([
      ['On Tap', 'Tap once'],
      ['On Hold', 'Press and hold'],
      ['On Double Tap', 'Tap twice'],
      ['Tap+Hold', 'Tap, then hold'],
    ]);
    const put = button(root, 'Put TD0 on the selected key');
    expect(textOf(put)).toBe('Put in');
    expect(put.props.title).toBe('Put TD0 on the selected key');
  });

  // As on a key, Clear acts on what the header shows and stays there.
  test('Clear blanks the slot being filled and stays on it', async () => {
    const {store} = await connect();
    const root = show(store);
    openTd0(root);
    const clear = () => button(root, 'Clear');
    expect(clear().props.disabled).toBe(false);
    click(clear());
    expect(slotButton(root, 'On Tap').props['aria-pressed']).toBe(true);
    expect(clear().props.disabled).toBe(true);
    // On Hold keeps its Left Ctrl.
    expect(store.getState().drafts[PATH]).toEqual({'tapDance:0': {tap: 0}});
  });

  test('a search with no match says so in two words; the box itself gives the code examples', async () => {
    const {store} = await connect();
    const root = show(store);
    const search = () =>
      root.find((node) => node.type === 'input' && node.props.type === 'search');
    expect(search().props.title).toBe(
      'You can also type a QMK code such as LT(1,KC_SPC) or a hex value such as 0x412C.',
    );
    act(() => search().props.onChange({target: {value: 'zzqq'}}));
    const column = root.find(
      (node) => node.type === 'div' && typeof node.props.onMouseLeave === 'function',
    );
    expect(textOf(column)).toBe('No matches');
  });

  test('the combined key tells its kinds apart on hover and asks for its tap key by one name', async () => {
    const {store} = await connect();
    const root = show(store);
    click(button(root, '+ Combined key'));
    const kinds = buttons(root, (node) => node.props.role === 'radio');
    expect(kinds.map((node) => [textOf(node), node.props.title])).toEqual([
      ['Layer-Tap', 'Tap: the key · Hold: a layer'],
      ['Mod-Tap', 'Tap: the key · Hold: modifiers'],
      ['Modifier', 'Sends the key with modifiers held'],
    ]);
    const builder = root.find(
      (node) => node.type === 'section' && node.props['aria-label'] === 'Combined key',
    );
    // The empty key is named On tap, and the disabled Put in asks for the tap key.
    const tapKey = builder.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'On tap',
    );
    expect(tapKey.props['aria-pressed']).toBe(true);
    expect(tapKey.props.title).toBe('Choose a tap key');
    expect(textOf(tapKey)).toBe('?On tap');
    const putIn = buttons(builder, (node) => textOf(node) === 'Put in');
    expect(putIn.map((node) => [node.props.disabled, node.props.title])).toEqual([
      [true, 'Choose a tap key first'],
    ]);
  });
});

describe('KEYMAP', () => {
  const PATH = 'keycode-palette-keymap';
  const VPID: number = definition.vendorProductId;
  const SET_KEY = 0x05;
  const {rows, cols} = definition.matrix;

  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    resetHIDTransportForTesting();
  });

  // Layer 0 holds A on every key but the selected one, Q, and the key after it, W.
  const connect = async () => {
    const keyboard = new Keyboard();
    registerHIDDeviceForTesting(PATH, keyboard as unknown as HIDDevice);
    await new HID.HID(PATH).openPromise;
    const store = configureStore({
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
      },
    });
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

  const show = (store: Awaited<ReturnType<typeof connect>>['store']) => {
    act(() => {
      renderer = create(
        <Provider store={store}>
          <I18nextProvider i18n={translations}>
            <KeycodePane />
          </I18nextProvider>
        </Provider>,
      );
    });
    return renderer!.root;
  };

  // A key is written, and answered, before the keyboard's value changes.
  const until = async (done: () => boolean) => {
    for (let tries = 0; tries < 200 && !done(); tries++) {
      await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
    }
  };

  test('Clear blanks the selected key and stays on it, so a second click cannot blank the next one', async () => {
    const {keyboard, store, keys, selected, next, valueOf} = await connect();
    expect(next).not.toBeNull();
    const root = show(store);
    const clear = () => button(root, 'Clear');
    const keyWrites = () =>
      keyboard.sent
        .filter(([command]) => command === SET_KEY)
        .map((bytes) => bytes.slice(0, 6));
    expect(clear().props.disabled).toBe(false);

    click(clear());
    await until(() => valueOf(selected) === 0);
    expect(valueOf(selected)).toBe(0);
    expect(store.getState().keymap.selectedKey).toBe(selected);
    expect(clear().props.disabled).toBe(true);
    expect(valueOf(next)).toBe(0x1a);
    const {row, col} = keys[selected];
    expect(keyWrites()).toEqual([[SET_KEY, 0, row, col, 0, 0]]);

    // A key picked from the palette, the blank one too, still moves on (fast remap).
    click(button(root, 'Nothing'));
    await until(() => keyWrites().length === 2);
    expect(store.getState().keymap.selectedKey).toBe(next);
  });
});

// A knob on a keyboard without State Sync, whose keymap load reads no knob: each
// knob's two keys are read from the keyboard when it is picked.
const {Pane: EncoderPane} =
  await import('../src/components/panes/configure-panes/encoder');
const {loadEncoderValues, setLayer, updateEncoderValue} =
  await import('../src/store/keymapSlice');
const {updateDefinitions} = await import('../src/store/definitionsSlice');

describe('a knob', () => {
  const PATH = 'keycode-palette-knob';
  const VPID = 0x4b4e0001;
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
    vendorProductId: VPID,
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

  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    resetHIDTransportForTesting();
  });

  const connect = async (protocol = 12) => {
    const keyboard = new Knobs();
    registerHIDDeviceForTesting(PATH, keyboard as unknown as HIDDevice);
    await new HID.HID(PATH).openPromise;
    const store = configureStore({
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
      },
    });
    const device = {
      path: PATH,
      vendorId: VPID >>> 16,
      productId: VPID & 0xffff,
      vendorProductId: VPID,
      productName: 'Knobs',
      protocol,
      hasResolvedDefinition: true,
      requiredDefinitionVersion: 'v3' as const,
    };
    const generation = new KeyboardAPI(PATH).getConnectionGeneration();
    store.dispatch(updateDefinitions({[VPID]: {v3: knobs}} as any));
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
    const pick = (index: number) =>
      act(() => {
        store.dispatch(updateSelectedKey(index, keys));
      });
    const reads = () =>
      keyboard.sent.filter(([command]) => command === GET_ENCODER).length;
    const knob = (id: number) =>
      store.getState().keymap.encoderDeviceMap[PATH]?.[id];
    return {keyboard, store, generation, pick, reads, knob};
  };

  const show = (store: Awaited<ReturnType<typeof connect>>['store']) => {
    act(() => {
      renderer = create(
        <Provider store={store}>
          <I18nextProvider i18n={translations}>
            <EncoderPane />
          </I18nextProvider>
        </Provider>,
      );
    });
    return renderer!.root;
  };

  const until = async (done: () => boolean) => {
    for (let tries = 0; tries < 200 && !done(); tries++) {
      await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
    }
  };
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
    const {keyboard, store, pick, reads, knob} = await connect();
    keyboard.hold = ([command]) => command === GET_ENCODER;
    pick(KNOB_0);
    const root = show(store);
    expect(faces(root)).toEqual(['', '', 'W']);
    expect(buttons(root, (node) => node.props.disabled)).toHaveLength(2);
    expect(said()).not.toContain(UNSUPPORTED);

    await answer(keyboard);
    await answer(keyboard);
    await until(() => faces(root)[0] !== '');
    expect(faces(root)).toEqual(['A', 'B', 'W']);
    expect(knob(0)).toEqual([[0x04, 0x05]]);

    // The next knob starts empty rather than with the last one's keys.
    pick(KNOB_1);
    expect(faces(root)).toEqual(['', '', 'E']);
    await answer(keyboard);
    await answer(keyboard);
    await until(() => faces(root)[0] !== '');
    expect(faces(root)).toEqual(['C', 'D', 'E']);

    const before = reads();
    pick(KNOB_0);
    expect(faces(root)).toEqual(['A', 'B', 'W']);
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(reads()).toBe(before);
  });

  test('a reply for a layer left before it came is not shown on the next one', async () => {
    const {keyboard, store, pick, knob} = await connect();
    keyboard.hold = ([command]) => command === GET_ENCODER;
    pick(KNOB_0);
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
    const {store, pick, knob} = await connect();
    pick(KNOB_0);
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

  test('the firmware sentence stays for a keyboard that refuses the read', async () => {
    const {keyboard, store, pick} = await connect();
    keyboard.refuse = ([command]) => command === GET_ENCODER;
    pick(KNOB_0);
    const root = show(store);
    await until(() => said().includes(UNSUPPORTED));
    expect(said()).toContain(UNSUPPORTED);
    expect(faces(root)).toEqual([]);
  });

  test('the firmware sentence stays for a protocol too old to read a knob', async () => {
    const {store, pick, reads} = await connect(9);
    pick(KNOB_0);
    show(store);
    expect(said()).toContain(UNSUPPORTED);
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(reads()).toBe(0);
  });
});

// The palette as a host drives it: every put is recorded, and its scrolling body is
// a stand-in whose scroll position can be read.
describe('picking and putting in', () => {
  type Props = Partial<Parameters<typeof KeycodePalette>[0]>;
  const SELECTED = {name: 'Selected key', sub: 'Layer 0', value: 0x04};
  const TD0_VALUE = selectKeycodeFromMenuCode('TD(0)', v13BasicKeyToByte)!;
  // TD0 taps Esc; the other Tap Dances are empty.
  const tapDance = () =>
    binding((slot) => ({
      actions: {tap: slot.index === 0 ? 0x29 : 0, hold: 0, dtap: 0, thold: 0},
      term: '200',
    }));

  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const mount = (props: Props = {}) => {
    const body = {scrollTop: 0};
    const puts: {value: number; stay: boolean}[] = [];
    let current = props;
    const palette = () => (
      <Provider store={store}>
        <I18nextProvider i18n={translations}>
          <KeycodePalette
            menus={baseMenus}
            basicKeyToByte={v13BasicKeyToByte}
            byteToKey={byteToKey}
            target={SELECTED}
            onAssign={(value, options) =>
              puts.push({value, stay: !!options?.stay})
            }
            layerCount={4}
            {...current}
          />
        </I18nextProvider>
      </Provider>
    );
    act(() => {
      renderer = create(palette(), {
        createNodeMock: (node) => (node.type === 'main' ? body : null),
      });
    });
    return {
      root: renderer!.root,
      body,
      puts,
      // What the host changes: another key selected, or a new value on it.
      update: (next: Props) => {
        current = {...current, ...next};
        act(() => renderer!.update(palette()));
      },
    };
  };

  const search = (root: ReactTestInstance) =>
    root.find((node) => node.type === 'input' && node.props.type === 'search');
  const type = (root: ReactTestInstance, value: string) =>
    act(() => search(root).props.onChange({target: {value}}));
  const enter = (root: ReactTestInstance) =>
    act(() => search(root).props.onKeyDown({key: 'Enter'}));
  const panels = (root: ReactTestInstance, label: string) =>
    root.findAll(
      (node) => node.type === 'section' && node.props['aria-label'] === label,
    );
  const putIn = (panel: ReactTestInstance) =>
    panel.find((node) => node.type === 'button' && textOf(node) === 'Put in');
  const hover = (root: ReactTestInstance, label: string) =>
    act(() => button(root, label).props.onMouseEnter());
  // The keys as a whole, which the pointer and focus leave.
  const grid = (root: ReactTestInstance) =>
    root.find(
      (node) =>
        node.type === 'div' && typeof node.props.onMouseLeave === 'function',
    );
  const inGrid = (node: ReactTestInstance): boolean =>
    !!node.parent &&
    (typeof node.parent.props.onMouseLeave === 'function' || inGrid(node.parent));
  // The corner follows the centred grid, as its sibling in the scrolling body.
  const corner = (root: ReactTestInstance) =>
    root.findAll((node) => node.type === 'code' && !inGrid(node)).map(textOf);

  test('the builder and the editor open at the top, however far the keys were scrolled', () => {
    const {root, body} = mount({tapDance: tapDance()});
    body.scrollTop = 420;
    click(button(root, '+ Combined key'));
    expect(body.scrollTop).toBe(0);
    // Going down to pick the tap key does not jump back up.
    body.scrollTop = 500;
    click(button(root, 'A'));
    expect(body.scrollTop).toBe(500);
    click(button(root, 'Cancel'));

    click(tab(root, 'Tap Dance'));
    body.scrollTop = 300;
    click(button(root, 'Edit TD1'));
    expect(body.scrollTop).toBe(0);
    // And the builder opened from the editor.
    body.scrollTop = 380;
    click(button(root, '+ Combined key'));
    expect(body.scrollTop).toBe(0);
  });

  test('the Tap Dance on the selected key opens at the top from the header', () => {
    const {root, body} = mount({
      tapDance: tapDance(),
      target: {...SELECTED, value: TD0_VALUE},
    });
    body.scrollTop = 250;
    click(button(root, 'Edit TD0'));
    expect(body.scrollTop).toBe(0);
  });

  test('with no key selected, a combined key waits for one instead of being dropped', () => {
    const {root, puts, update} = mount({target: null});
    click(button(root, '+ Combined key'));
    click(button(root, 'A'));
    const builder = () => panels(root, 'Combined key')[0];
    expect(putIn(builder()).props.disabled).toBe(true);
    expect(putIn(builder()).props.title).toBe(
      'Select a key on the keyboard first',
    );
    // Selecting a key is all it takes: what was built is still there.
    update({target: SELECTED});
    expect(putIn(builder()).props.disabled).toBe(false);
    click(putIn(builder()));
    expect(puts).toEqual([{value: 0x4104, stay: false}]);
    expect(panels(root, 'Combined key')).toHaveLength(0);
  });

  test('with no key selected, a typed code waits for one and Enter leaves it in the box', () => {
    const {root, puts, update} = mount({target: null});
    type(root, 'LT(2,KC_A)');
    const row = () => panels(root, 'QMK code or hex')[0];
    expect(putIn(row()).props.disabled).toBe(true);
    expect(putIn(row()).props.title).toBe('Select a key on the keyboard first');
    enter(root);
    expect(puts).toEqual([]);
    expect(search(root).props.value).toBe('LT(2,KC_A)');

    update({target: SELECTED});
    expect(putIn(row()).props.disabled).toBe(false);
    enter(root);
    expect(puts).toEqual([{value: 0x4204, stay: false}]);
    expect(search(root).props.value).toBe('');
  });

  test('Enter puts in a typed code even when the results show the same key', () => {
    const {root, puts} = mount();
    type(root, 'KC_ESC');
    // Esc is among the results, so no row offers the code again, and Enter puts it in.
    expect(panels(root, 'QMK code or hex')).toHaveLength(0);
    enter(root);
    expect(puts).toEqual([{value: 0x29, stay: false}]);
    expect(search(root).props.value).toBe('');
    // The example the search box gives, which the Layers tab's Space Fn1 also is.
    type(root, 'LT(1,KC_SPC)');
    expect(panels(root, 'QMK code or hex')).toHaveLength(0);
    enter(root);
    expect(puts[1]).toEqual({value: 0x412c, stay: false});
    // A word is a search, not a code: Enter leaves it.
    type(root, 'space');
    enter(root);
    expect(puts).toHaveLength(2);
    expect(search(root).props.value).toBe('space');
  });

  test('the Layers tab and search offer only the layers the keyboard has', () => {
    const layersFirst = [
      baseMenus.find((menu) => menu.id === 'layers')!,
      ...baseMenus.filter((menu) => menu.id !== 'layers'),
    ];
    const keys = (layerCount: number) =>
      [
        ...render(layersFirst, {layerCount}).matchAll(
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

    const {root} = mount({layerCount: 4});
    type(root, 'layer 5');
    expect(textOf(grid(root))).toBe('No matches');
  });

  test('the builder keeps every category open and accepts a Media tap key without assigning early', () => {
    const media = getKeycodes().find((menu) => menu.id === 'media')!;
    const {root, puts} = mount({menus: [...baseMenus, media], layerCount: 2});
    click(tab(root, 'Media'));
    click(button(root, '+ Combined key'));
    expect(tab(root, 'Media').props['aria-pressed']).toBe(true);
    for (const menu of [...baseMenus, media]) {
      expect(tab(root, menu.label).props.disabled).toBeFalsy();
    }
    const volume = button(root, 'Volume Up');
    expect(volume.props.disabled).toBe(false);
    click(volume);
    expect(puts).toEqual([]);
    expect(button(root, 'On tap: Vol +').props['aria-pressed']).toBe(true);
    click(tab(root, 'Layers'));
    const unavailableLayer = button(root, 'Momentary turn layer 3 on');
    expect(unavailableLayer.props.disabled).toBe(true);
    expect(unavailableLayer.props.title).toContain('8-bit basic keycode');

    click(tab(root, 'Macro'));
    const unsupported = buttons(root, (node) => node.props['aria-disabled'])[0];
    expect(unsupported.props.disabled).toBe(true);
    expect(unsupported.props.title).toContain('8-bit basic keycode');
    expect(textOf(unsupported)).not.toContain('⊘');
    const before = corner(root);
    act(() => unsupported.props.onMouseEnter());
    expect(corner(root)).toEqual(before);
    click(unsupported);
    expect(button(root, 'On tap: Vol +').props['aria-pressed']).toBe(true);
    let prevented = false;
    act(() => unsupported.props.onDragStart({
      preventDefault: () => {prevented = true;},
    }));
    expect(prevented).toBe(true);
    expect(puts).toEqual([]);

    const builder = panels(root, 'Combined key')[0];
    click(putIn(builder));
    expect(puts).toEqual([{
      value: 0x4100 | v13BasicKeyToByte.KC_VOLU,
      stay: false,
    }]);
    expect(tab(root, 'Media').props['aria-pressed']).toBe(true);
  });

  test('typed builder operands reject nested and reserved codes but keep an 8-bit Media draft until Put in', () => {
    const {root, puts} = mount();
    click(button(root, '+ Combined key'));
    for (const input of ['LT(1,KC_A)', '0x00FF']) {
      type(root, input);
      const typed = panels(root, 'QMK code or hex')[0];
      expect(putIn(typed).props.disabled).toBe(true);
      expect(putIn(typed).props['aria-disabled']).toBe(true);
      expect(putIn(typed).props.title).toBeTruthy();
      enter(root);
      click(putIn(typed));
      expect(search(root).props.value).toBe(input);
      expect(puts).toEqual([]);
      expect(button(root, 'On tap').props['aria-pressed']).toBe(true);
    }
    type(root, '0x00AE');
    enter(root);
    expect(search(root).props.value).toBe('');
    expect(puts).toEqual([]);
    click(putIn(panels(root, 'Combined key')[0]));
    expect(puts).toEqual([{value: 0x41ae, stay: false}]);
  });

  test('Clear acts on the builder operand and keeps the keyboard assignment until Put in', () => {
    const {root, puts} = mount();
    click(button(root, '+ Combined key'));
    click(button(root, 'B'));
    click(button(root, 'Clear'));
    expect(puts).toEqual([]);
    expect(button(root, 'Clear').props.disabled).toBe(true);
    click(putIn(panels(root, 'Combined key')[0]));
    expect(puts).toEqual([{value: 0x4100, stay: false}]);
  });

  test('the corner describes the key under the pointer, and the selected key once the pointer leaves the keys', () => {
    const {root} = mount();
    expect(corner(root)).toEqual(['KC_A', '0x0004']);
    hover(root, 'Esc');
    expect(corner(root)).toEqual(['KC_ESC', '0x0029']);
    act(() => grid(root).props.onMouseLeave());
    expect(corner(root)).toEqual(['KC_A', '0x0004']);

    // Focus moving from key to key keeps the one it is on; leaving the keys does not.
    const key = {};
    const keys = {contains: (node: unknown) => node === key};
    act(() => button(root, 'Esc').props.onFocus());
    act(() =>
      grid(root).props.onBlur({currentTarget: keys, relatedTarget: key}),
    );
    expect(corner(root)).toEqual(['KC_ESC', '0x0029']);
    act(() =>
      grid(root).props.onBlur({currentTarget: keys, relatedTarget: null}),
    );
    expect(corner(root)).toEqual(['KC_A', '0x0004']);
  });

  test('search opened from the Tap Dance list still describes ordinary keys', () => {
    const {root} = mount({tapDance: tapDance()});
    click(tab(root, 'Tap Dance'));
    expect(corner(root)).toEqual([]);
    type(root, 'Esc');
    hover(root, 'Esc');
    expect(corner(root)).toEqual(['KC_ESC', '0x0029']);
    type(root, '');
    expect(corner(root)).toEqual([]);
  });

  test('the corner follows a newly selected key and stays hidden on the Tap Dance list', () => {
    const {root, update} = mount({tapDance: tapDance()});
    hover(root, 'Esc');
    update({target: {...SELECTED, value: 0x05}});
    expect(corner(root)).toEqual(['KC_B', '0x0005']);

    click(tab(root, 'Tap Dance'));
    hover(root, 'Put TD0 on the selected key');
    expect(corner(root)).toEqual([]);
    update({target: {...SELECTED, value: 0x06}});
    expect(corner(root)).toEqual([]);
    click(tab(root, 'Basic'));
    expect(corner(root)).toEqual(['KC_C', '0x0006']);
  });

  // The pointer never leaves the keys here; what is on screen changes under it.
  test('the corner goes back to the selected key when the keys under the pointer change', () => {
    const {root, update} = mount({tapDance: tapDance()});
    // A search typed while the pointer rests on a key.
    hover(root, 'Esc');
    type(root, 'f1');
    expect(corner(root)).toEqual(['KC_A', '0x0004']);
    type(root, '');
    // Another tab chosen from the keyboard.
    hover(root, 'Esc');
    click(tab(root, 'Layers'));
    expect(corner(root)).toEqual(['KC_A', '0x0004']);
    click(tab(root, 'Basic'));
    // The builder's tap key, then its Cancel, which sits among the keys.
    click(button(root, '+ Combined key'));
    click(button(root, 'B'));
    expect(corner(root)).toEqual(['KC_B', '0x0005']);
    click(button(root, 'Cancel'));
    expect(corner(root)).toEqual(['KC_A', '0x0004']);
    // The editor opening and closing, with Esc selected: TD0 taps Esc too, so
    // only the keys on screen change.
    update({target: {...SELECTED, value: 0x29}});
    click(tab(root, 'Tap Dance'));
    hover(root, 'Put TD0 on the selected key');
    click(button(root, 'Edit TD0'));
    expect(corner(root)).toEqual([]);
    hover(root, 'On Tap: B');
    click(button(root, 'Cancel'));
    expect(corner(root)).toEqual([]);
    click(tab(root, 'Basic'));
    expect(corner(root)).toEqual(['KC_ESC', '0x0029']);
  });

  // From the header the editor opens over the keys it closes onto, and the key
  // selected meanwhile holds Esc, as TD0's tap does: only the editor goes away.
  test('the corner goes back to the selected key when an editor opened from the header closes', () => {
    const {root, update} = mount({
      tapDance: tapDance(),
      target: {...SELECTED, value: TD0_VALUE},
    });
    click(button(root, 'Edit TD0'));
    update({target: {...SELECTED, value: 0x29}});
    hover(root, 'On Tap: B');
    expect(corner(root)).toEqual([]);
    click(button(root, 'Cancel'));
    expect(corner(root)).toEqual(['KC_ESC', '0x0029']);
  });

  // The selection moves while its value stays, as to another layer where the key
  // is A too, and nothing under the pointer changes.
  test('the corner goes back to the selected key when the selection moves but its value stays', () => {
    const {root, update} = mount();
    hover(root, 'Esc');
    update({target: {...SELECTED, sub: 'Layer 1'}});
    expect(corner(root)).toEqual(['KC_A', '0x0004']);
    hover(root, 'Esc');
    update({target: {...SELECTED, sub: 'Layer 1', name: 'Another key'}});
    expect(corner(root)).toEqual(['KC_A', '0x0004']);
  });

  test('announces assigning the same keycode again through a separate empty update', async () => {
    const {root} = mount();
    const announcement = () => textOf(root.find(
      (node) => node.type === 'span' && node.props['aria-live'] === 'polite',
    ));
    click(button(root, 'Clear'));
    expect(announcement()).toBe('Selected key ← Blank');
    click(button(root, 'Clear'));
    expect(announcement()).toBe('');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(announcement()).toBe('Selected key ← Blank');
  });

  test('blanking a key is announced in words, not as its QMK code', () => {
    const {root, puts} = mount();
    click(button(root, 'Clear'));
    expect(puts).toEqual([{value: 0, stay: true}]);
    const announcement = root.find(
      (node) => node.type === 'span' && node.props['aria-live'] === 'polite',
    );
    expect(textOf(announcement)).toBe('Selected key ← Blank');
  });
});

// Keyboard focus as far as the palette moves it: an element with a ref can take it,
// and focus on one that has gone falls to the page, as it does in a browser.
describe('keyboard focus', () => {
  type Name = {label: string; text: string};
  type Focusable = Name & {
    props: Record<string, unknown>;
    disabled?: boolean;
    focus: () => void;
  };
  const SELECTED = {name: 'Selected key', sub: 'Layer 0', value: 0x04};
  const TD0_VALUE = selectKeycodeFromMenuCode('TD(0)', v13BasicKeyToByte)!;
  const page: Name = {label: 'page', text: ''};
  const words = (node: unknown): string =>
    typeof node === 'string' || typeof node === 'number'
      ? String(node)
      : Array.isArray(node)
        ? node.map(words).join('')
        : node && typeof node === 'object' && 'props' in node
          ? words((node as {props: {children?: unknown}}).props.children)
          : '';
  const nameOf = (props: Record<string, any>): Name => ({
    label: props['aria-label'] ?? words(props.children),
    text: words(props.children),
  });

  let renderer: ReactTestRenderer | undefined;
  let focused: Name | null = null;
  const made: Focusable[] = [];
  const shown = (node: Name) =>
    !!renderer &&
    renderer.root.findAll((host) => {
      if (typeof host.type !== 'string') {
        return false;
      }
      const name = nameOf(host.props);
      return name.label === node.label && name.text === node.text;
    }).length > 0;
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
  );

  beforeEach(() => {
    focused = null;
    made.length = 0;
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        body: page,
        get activeElement() {
          return focused && shown(focused) ? focused : page;
        },
      },
    });
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    if (originalDocument) {
      Object.defineProperty(globalThis, 'document', originalDocument);
    } else {
      Reflect.deleteProperty(globalThis, 'document');
    }
  });

  // Tap Dances the keyboard has reported, keeping what is set on them as the store
  // does. TD0 taps Esc.
  const tapDance = (write: TapDanceBinding['write'] = async () => true) => {
    const drafts = new Map<number, ReturnType<TapDanceBinding['changes']>>();
    return binding(
      (slot) => ({
        actions: {tap: slot.index === 0 ? 0x29 : 0, hold: 0, dtap: 0, thold: 0},
        term: '200',
      }),
      {
        changes: (slot) => drafts.get(slot.index) ?? {},
        setChanges: (slot, changes) => {
          drafts.set(slot.index, changes);
        },
        write,
      },
    );
  };

  const mount = (props: Partial<Parameters<typeof KeycodePalette>[0]> = {}) => {
    act(() => {
      renderer = create(
        <Provider store={store}>
          <I18nextProvider i18n={translations}>
            <KeycodePalette
              menus={baseMenus}
              basicKeyToByte={v13BasicKeyToByte}
              byteToKey={byteToKey}
              target={SELECTED}
              onAssign={() => undefined}
              layerCount={4}
              tapDance={tapDance()}
              {...props}
            />
          </I18nextProvider>
        </Provider>,
        {
          createNodeMock: (element) => {
            const node: Focusable = {
              ...nameOf(element.props),
              props: element.props,
              disabled: element.props.disabled,
              focus: () => {
                focused = node;
              },
            };
            made.push(node);
            return node;
          },
        },
      );
    });
    return renderer!.root;
  };
  // The last element given a ref with this text: the one on screen now.
  const lastMade = (text: string) =>
    made.filter((node) => node.text === text).at(-1)!;
  const inBuilder = (root: ReactTestInstance, label: string) =>
    root
      .find(
        (node) =>
          node.type === 'section' && node.props['aria-label'] === 'Combined key',
      )
      .find((node) => node.type === 'button' && textOf(node) === label);
  const LIST_EDIT_TD1 = {label: 'Edit TD1', text: 'Edit'};

  test('the builder takes focus when it opens and gives it back to + Combined key', () => {
    const root = mount();
    click(button(root, '+ Combined key'));
    expect(focused?.label).toBe('On tap');
    click(inBuilder(root, 'Cancel'));
    expect(focused?.label).toBe('+ Combined key');

    // Putting the result in closes it the same way.
    click(button(root, '+ Combined key'));
    click(button(root, 'A'));
    click(inBuilder(root, 'Put in'));
    expect(focused?.label).toBe('+ Combined key');
  });

  test('a Tap Dance opened from the list takes focus and gives it back to its row', () => {
    const root = mount();
    click(tab(root, 'Tap Dance'));
    click(button(root, 'Edit TD1'));
    expect(focused?.text).toBe('On Tap');
    click(button(root, 'Cancel'));
    expect(focused).toMatchObject(LIST_EDIT_TD1);

    click(button(root, 'Edit TD1'));
    click(tab(root, 'Tap Dance'));
    expect(focused).toMatchObject(LIST_EDIT_TD1);
  });

  // With the Tap Dance tab open the list offers TD0's Edit too; focus goes back to
  // the one that opened the editor.
  test('a Tap Dance opened from the selected key gives focus back to that Edit', () => {
    const root = mount({target: {...SELECTED, value: TD0_VALUE}});
    click(tab(root, 'Tap Dance'));
    const headerEdit = () =>
      root.find(
        (node) =>
          node.type === 'button' &&
          node.props['aria-label'] === 'Edit TD0' &&
          node.props.title === 'Edit TD0',
      );
    click(headerEdit());
    expect(focused?.text).toBe('On Tap');
    click(button(root, 'Cancel'));
    expect(focused).toMatchObject({label: 'Edit TD0', text: 'Edit →'});
  });

  // Apply turns itself off while it writes: focus waits on the slot the next key goes
  // to, then goes back to the row once the editor closes. Focus the user has moved
  // meanwhile stays where they put it.
  test('Apply hands focus to the slot while it writes, then to the row', async () => {
    for (const moveTo of [null, {label: 'Search keycodes', text: ''}]) {
      let finish: (accepted: boolean) => void = () => undefined;
      const root = mount({
        tapDance: tapDance(
          () =>
            new Promise<boolean>((resolve) => {
              finish = resolve;
            }),
        ),
      });
      click(tab(root, 'Tap Dance'));
      click(button(root, 'Edit TD1'));
      click(button(root, 'On Tap: A'));
      focused = lastMade('Save');
      let applying: unknown;
      act(() => {
        applying = button(root, 'Save').props.onClick();
      });
      expect(focused?.text).toBe('On Hold');
      if (moveTo) {
        focused = moveTo;
      }
      await act(async () => {
        finish(true);
        await applying;
      });
      expect(focused).toMatchObject(moveTo ?? LIST_EDIT_TD1);
      act(() => renderer?.unmount());
      renderer = undefined;
    }
  });

  // Putting the Tap Dance on the selected key replaces its button with "Placed".
  test('Put in hands focus to the slot being filled', () => {
    const root = mount();
    click(tab(root, 'Tap Dance'));
    click(button(root, 'Edit TD1'));
    focused = lastMade('Put in');
    click(button(root, 'Put TD1 on the selected key'));
    expect(focused?.text).toBe('On Tap');
  });

  // Blanking turns Clear off, as the key it stays on is blank now.
  test('Clear hands focus to the selected key around it', () => {
    const root = mount();
    focused = lastMade('Clear');
    click(button(root, 'Clear'));
    expect((focused as Focusable).props.tabIndex).toBe(-1);
  });
});

// The keyboard above names keys for the OS layout picked in its layout badge; on a
// German layout the key QMK calls KC_Y is Z. The palette and a keycode setting's
// button name keys the same way.
describe('the host keyboard layout', () => {
  const stateWith = (hostKeyboardLayout: string) => {
    const path = 'keycode-host-layout';
    const {vendorProductId} = definition;
    return {
      settings: {themeName: 'OLIVIA_DARK', hostKeyboardLayout},
      definitions: {
        definitions: {},
        customDefinitions: {},
        eraDefinitions: {[vendorProductId]: {v3: definition}},
        definitionEpochs: {},
      },
      devices: {
        selectedDevicePath: path,
        selectedConnectionGeneration: 0,
        selectionGeneration: 1,
        connectedDevicePaths: {
          [path]: {
            path,
            vendorProductId,
            protocol: 12,
            requiredDefinitionVersion: 'v3',
          },
        },
      },
      firmware: {firmwareVersionMap: {}, keycodesVersionMap: {}},
      macros: {status: 'idle', ast: [], macroCount: 0, isFeatureSupported: true},
      keymap: {numberOfLayersMap: {}},
    };
  };
  const storeWith = (hostKeyboardLayout: string) =>
    configureStore({reducer: () => stateWith(hostKeyboardLayout) as any});

  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  test('the palette names the keys, the selected one and the corner as the layout does', () => {
    act(() => {
      renderer = create(
        <Provider store={storeWith('keymap_german')}>
          <I18nextProvider i18n={translations}>
            <KeycodePalette
              menus={baseMenus}
              basicKeyToByte={v13BasicKeyToByte}
              byteToKey={byteToKey}
              target={{name: 'Selected key', sub: 'Layer 0', value: 0x1c}}
              onAssign={() => undefined}
              layerCount={4}
            />
          </I18nextProvider>
        </Provider>,
      );
    });
    const root = renderer!.root;
    // What a keycap has printed on it: the first span is its face.
    const face = (key: ReactTestInstance) =>
      textOf(key.findAll((node) => node.type === 'span')[0]);
    // The selected key holds KC_Y: its keycap reads Z, and KC_Z's reads Y.
    const current = root.find(
      (node) => node.type === 'button' && node.props['aria-current'] === 'true',
    );
    expect(current.props['aria-label']).toBe('Z');
    expect(face(current)).toBe('Z');
    expect(face(button(root, 'Y'))).toBe('Y');
    // A dead key says so in its tooltip, as the layout describes it.
    const grave = button(root, '◌̂ (dead) and ◌̊');
    expect(face(grave)).toBe('°^');
    expect(grave.props.title).toBe('◌̂ (dead) and ◌̊');
    // The header's keycap and the corner say Z as well.
    const [header] = root.findAll(
      (node) => node.type === 'span' && node.props['aria-hidden'] === 'true',
    );
    expect(textOf(header)).toBe('Z');
    const corner = root.find(
      (node) =>
        node.type === 'div' && node.children.map(textOf).includes('KC_Y'),
    );
    expect(corner.children.map(textOf)).toEqual(['Z', 'KC_Y', '0x001C', '']);
  });

  // A V3 keycode setting (SOCD keys, an encoder) shows the key as the palette draws
  // it, with the QMK code in its tooltip; a blank key says so in words.
  test('a keycode setting shows the key as the palette does, not its QMK code', () => {
    const setting = (value: number, hostKeyboardLayout = 'keymap_us') => {
      const html = renderToStaticMarkup(
        <Provider store={storeWith(hostKeyboardLayout)}>
          <I18nextProvider i18n={translations}>
            <PelpiKeycodeInput
              value={value}
              meta={{label: 'Left Key'}}
              setValue={() => undefined}
            />
          </I18nextProvider>
        </Provider>,
      );
      const [, attributes, label] = html.match(
        /<button([^>]*)>([^<]*)<\/button>/,
      )!;
      return {label, title: /title="([^"]*)"/.exec(attributes)?.[1]};
    };
    expect(setting(0x4f)).toEqual({label: '→', title: 'KC_RGHT'});
    expect(setting(0xe1)).toEqual({label: 'Left Shift', title: 'KC_LSFT'});
    expect(setting(0x04)).toEqual({label: 'A', title: 'KC_A'});
    expect(setting(0x00)).toEqual({label: 'Blank', title: 'KC_NO'});
    expect(setting(0x1c, 'keymap_german')).toEqual({
      label: 'Z',
      title: 'KC_Y',
    });
    // A value without a key in the palette is shown once, as its QMK expression.
    expect(setting(0x0104)).toEqual({label: 'C(KC_A)', title: undefined});
  });
});

// The Tap Dance editor and the combined-key builder each take one line that stays
// above the keys they take from while the keys scroll under it.
describe('the editor and the builder pinned above the keys', () => {
  let renderer: ReactTestRenderer | undefined;
  let sheet: ServerStyleSheet | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    sheet?.seal();
    sheet = undefined;
  });

  const mount = () => {
    sheet = new ServerStyleSheet();
    const element = sheet.collectStyles(
      palette(baseMenus, {
        tapDance: binding(() => ({
          actions: {tap: 0x29, hold: 0, dtap: 0, thold: 0},
          term: '200',
        })),
      }),
    );
    act(() => {
      renderer = create(element, {
        createNodeMock: (node) => (node.type === 'main' ? {scrollTop: 0} : null),
      });
    });
    return renderer!.root;
  };
  const section = (root: ReactTestInstance, label: string) =>
    root.find(
      (node) => node.type === 'section' && node.props['aria-label'] === label,
    );
  const hostAbove = (node: ReactTestInstance) => {
    let parent = node.parent;
    while (parent && typeof parent.type !== 'string') {
      parent = parent.parent;
    }
    return parent!;
  };
  test('each sticks to the top of the scrolling body on an opaque band above the keys', () => {
    const root = mount();
    click(button(root, '+ Combined key'));
    const band = hostAbove(section(root, 'Combined key')).props.className;
    const rules = ruleOf(sheet!.getStyleTags(), `class="${band}"`);
    expect(rules).toMatch(/(^|;)position:sticky;/);
    // Main's top padding is covered too, or key tops show above the band.
    expect(rules).toMatch(/(^|;)top:-20px;/);
    expect(rules).toMatch(/(^|;)z-index:1;/);
    expect(rules).toContain(
      'background:var(--palette-surface, var(--bg_gradient) fixed);',
    );
    click(button(root, 'Cancel'));

    click(tab(root, 'Tap Dance'));
    click(button(root, 'Edit TD0'));
    expect(hostAbove(section(root, 'Edit TD0')).props.className).toBe(band);
  });

  test('the builder reads kind, what a hold does and the tap key on one line, then its buttons', () => {
    const root = mount();
    click(button(root, '+ Combined key'));
    const builder = () => section(root, 'Combined key');
    const parts = () =>
      builder().findAll(
        (node) =>
          typeof node.type === 'string' &&
          (['radiogroup', 'group'].includes(node.props.role) ||
            (node.type === 'button' &&
              (node.props.title === 'Choose a tap key' ||
                ['Cancel', 'Put in'].includes(textOf(node))))),
      );
    const names = () =>
      parts().map((node) => node.props['aria-label'] ?? textOf(node));
    expect(names()).toEqual([
      'Combined key',
      'On hold · layer',
      'On tap',
      'Cancel',
      'Put in',
    ]);
    // The selected tap operand reads like a Tap Dance action.
    expect(textOf(builder())).toContain('On tap');
    expect(textOf(builder())).not.toMatch(/On hold|Result|below|Combined/);

    click(button(root, 'Mod-Tap'));
    click(button(root, 'A'));
    expect(names()).toEqual([
      'Combined key',
      'On hold · modifiers',
      'On tap: A',
      'Cancel',
      'Put in',
    ]);
  });
});
