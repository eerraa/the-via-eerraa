import {afterAll, describe, expect, mock, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {configureStore} from '@reduxjs/toolkit';
import i18n from 'i18next';
import type {ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {I18nextProvider} from 'react-i18next';
import {Provider} from 'react-redux';
import {act, create} from 'react-test-renderer';
import {ServerStyleSheet} from 'styled-components';
import {Router} from 'wouter';
import staticLocationHook from 'wouter/static-location';

// What /errors and the header's warning show, when a keyboard's errors go away,
// and where a /console link goes while that tab is off.

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
    get length() {
      return values.size;
    },
  };
};
if (!('window' in globalThis)) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: globalThis,
  });
}
// The header imports every pane, and Design reads both storages as it loads.
for (const name of ['localStorage', 'sessionStorage']) {
  if (!(name in globalThis)) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: memoryStorage(),
    });
  }
}
// The loader's picture comes through a Vite alias, which Bun does not resolve.
mock.module('assets/images/chippy_600.png', () => ({default: ''}));

// Every logged error is also copied to the console, as in the app, and the test
// renderer at the end shares the router's provider with the server renderer,
// which React warns about. Neither is what these tests look at.
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (
    args[0] !== 'Error captured:' &&
    !String(args[0]).includes('multiple renderers')
  ) {
    originalConsoleError(...args);
  }
};
afterAll(() => {
  console.error = originalConsoleError;
});

// The store slices import each other; keyboard-api settles that cycle the way the
// app's store does, so it loads before anything that reads the store.
await import('../src/utils/keyboard-api');
const errors = await import('../src/store/errorsSlice');
const devices = await import('../src/store/devicesSlice');
const {errorsListenerMiddleware} = await import('../src/store/errorsListener');
const {Errors} = await import('../src/components/panes/errors');
const {UnconnectedGlobalMenu} = await import('../src/components/menus/global');
const {HIDConsoleRoute} = await import('../src/components/panes/hid-console');
const {default: settingsReducer} = await import('../src/store/settingsSlice');
const {default: menusReducer} = await import('../src/store/menusSlice');

const {APP_ERROR_TITLES, clearDeviceErrors, logAppError, logKeyboardAPIError} =
  errors;

const locale = (lang: string) =>
  JSON.parse(
    readFileSync(path.join(import.meta.dir, `../src/locales/${lang}.json`), 'utf8'),
  );
const en = i18n.createInstance();
await en.init({
  lng: 'en',
  resources: {en: {translation: locale('en')}, ko: {translation: locale('ko')}},
  interpolation: {escapeValue: false},
});
const ko = en.cloneInstance({lng: 'ko'});

const N86 = {vendorId: 0x4552, productId: 0xa002, productName: 'N86', protocol: 12};
const TOMAK = {
  vendorId: 0x4501,
  productId: 0xa003,
  productName: 'TOMAK TKL',
  protocol: 12,
};
// After a replug the keyboard comes back under a new path; VID/PID still name it.
const replugged = {
  ...N86,
  path: 'replugged-n86',
  vendorProductId: N86.vendorId * 0x10000 + N86.productId,
  requiredDefinitionVersion: 'v3' as const,
  hasResolvedDefinition: true,
};

const makeStore = () =>
  configureStore({
    reducer: {
      settings: settingsReducer,
      devices: devices.default,
      menus: menusReducer,
      errors: errors.default,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().prepend(errorsListenerMiddleware.middleware),
  });
type Store = ReturnType<typeof makeStore>;

const logged = (store: Store) =>
  store.getState().errors.appErrors.map(({message}) => message);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const log = (
  store: Store,
  message: string,
  deviceInfo = N86,
  title: errors.AppErrorTitle = APP_ERROR_TITLES.unreadable,
) => store.dispatch(logAppError({message, deviceInfo, title}));

const render = (store: Store, element: ReactNode, translations = en) =>
  renderToStaticMarkup(
    <Provider store={store}>
      <I18nextProvider i18n={translations}>
        <Router hook={staticLocationHook('/')}>{element}</Router>
      </I18nextProvider>
    </Provider>,
  );

describe('error log', () => {
  test('a keyboard clear keeps other keyboards and anything logged after', () => {
    let state = errors.default(undefined, {type: 'init'});
    for (const deviceInfo of [N86, TOMAK, N86]) {
      state = errors.default(
        state,
        logAppError({message: 'x', deviceInfo, title: APP_ERROR_TITLES.unreadable}),
      );
    }
    state = errors.default(
      state,
      logKeyboardAPIError({
        commandName: 'CUSTOM_MENU_GET_VALUE',
        commandBytes: [0x08, 0x00, 0x01],
        responseBytes: [0xff, 0x08, 0x00, 0x01],
        deviceInfo: N86,
      }),
    );
    expect(state.appErrors.map(({id}) => id)).toEqual([0, 1, 2, 3]);
    // A reply that is not what was asked reads as the keyboard not being read.
    expect(state.appErrors[3].title).toBe(APP_ERROR_TITLES.unreadable);

    state = errors.default(
      state,
      clearDeviceErrors({
        vendorId: N86.vendorId,
        productId: N86.productId,
        before: 3,
      }),
    );
    expect(state.appErrors.map(({id}) => id)).toEqual([1, 3]);
  });
});

describe('a keyboard that loads again', () => {
  test('drops what went wrong before the load and keeps what failed during it', async () => {
    const store = makeStore();
    log(store, 'HID response timed out for 5f1c0c2e', N86, APP_ERROR_TITLES.noResponse);
    log(store, 'Loading device failed - retrying', TOMAK);
    store.dispatch(devices.updateConnectedDevices({[replugged.path]: replugged}));
    store.dispatch(
      devices.selectDevice({device: replugged, connectionGeneration: 3}),
    );
    const selectionGeneration = store.getState().devices.selectionGeneration;
    log(store, 'Loading lighting/menu data failed');
    store.dispatch(
      devices.markDeviceReady({
        devicePath: replugged.path,
        connectionGeneration: 3,
        selectionGeneration,
      }),
    );
    await settle();
    expect(logged(store)).toEqual([
      'Loading device failed - retrying',
      'Loading lighting/menu data failed',
    ]);
  });

  test('a load overtaken by a newer one clears nothing; the newer one does', async () => {
    const store = makeStore();
    store.dispatch(devices.updateConnectedDevices({[replugged.path]: replugged}));
    log(store, 'before');
    store.dispatch(
      devices.selectDevice({device: replugged, connectionGeneration: 1}),
    );
    const first = store.getState().devices.selectionGeneration;
    log(store, 'between');
    store.dispatch(
      devices.selectDevice({device: replugged, connectionGeneration: 2}),
    );
    const second = store.getState().devices.selectionGeneration;

    store.dispatch(
      devices.markDeviceReady({
        devicePath: replugged.path,
        connectionGeneration: 1,
        selectionGeneration: first,
      }),
    );
    await settle();
    expect(logged(store)).toEqual(['before', 'between']);

    store.dispatch(
      devices.markDeviceReady({
        devicePath: replugged.path,
        connectionGeneration: 2,
        selectionGeneration: second,
      }),
    );
    await settle();
    expect(logged(store)).toEqual([]);
    // Nothing left, so the header has no warning.
    expect(render(store, <UnconnectedGlobalMenu />)).not.toContain(
      'href="/errors"',
    );
  });
});

describe('/errors', () => {
  // Stack, route id, command bytes and USB ids stay in the downloaded file.
  test('names each error in the user\'s words, with the keyboard and the second', () => {
    const store = makeStore();
    log(
      store,
      'HIDTransportTimeoutError: HID response timed out for 5f1c0c2e\n    at exchange (node-hid.ts:801:15)',
      N86,
      APP_ERROR_TITLES.noResponse,
    );
    store.dispatch(
      logKeyboardAPIError({
        commandName: 'CUSTOM_MENU_GET_VALUE',
        commandBytes: [0x08, 0x00, 0x01],
        responseBytes: [0xff, 0x08, 0x00, 0x01],
        deviceInfo: TOMAK,
      }),
    );
    const html = render(store, <Errors />, ko);
    expect(html).toContain('>키보드 응답 없음<');
    expect(html).toContain('>키보드를 읽지 못함<');
    expect(html).toContain('>N86<');
    expect(html).toContain('>TOMAK TKL<');
    const [first] = store.getState().errors.appErrors;
    expect(html).toContain(`>${first.timestamp.replace(/\.\d+$/, '')}<`);
    expect(html).not.toContain(first.timestamp);
    for (const detail of [
      'timed out',
      '5f1c0c2e',
      'node-hid',
      'CUSTOM_MENU',
      'Command',
      'Response',
      'Vid',
      'Pid',
      '0x4552',
    ]) {
      expect({detail, shown: html.includes(detail)}).toEqual({
        detail,
        shown: false,
      });
    }
  });
});

describe('the header warning', () => {
  // The warning shares the icon group's intrinsic width so the header grid
  // reserves room for it as well as the language and firmware controls.
  test('flows before the screen icons and counts errors in words', () => {
    const store = makeStore();
    log(store, 'x', N86, APP_ERROR_TITLES.noResponse);
    const sheet = new ServerStyleSheet();
    let one = '';
    let css = '';
    try {
      one = render(store, sheet.collectStyles(<UnconnectedGlobalMenu />));
      css = sheet.getStyleTags();
    } finally {
      sheet.seal();
    }
    const [, header, icons, next] =
      /^<div class="([^"]+)"><div class="([^"]+)"><a [^>]*href="\/errors".*?<\/a>(<a [^>]*>)/.exec(
        one,
      ) ?? [];
    expect(next).toContain('href="/"');
    const rules = (classes: string) =>
      classes
        .split(' ')
        .map((name) => new RegExp(`\\.${name}\\{([^}]*)\\}`).exec(css)?.[1])
        .join('');
    expect(rules(header)).toContain('display:grid;');
    expect(rules(header)).toContain('grid-template-columns:1fr auto 1fr;');
    expect(rules(icons)).toContain('grid-column:2;');
    expect(rules(icons)).not.toContain('position:absolute;');
    const external =
      /<span class="([^"]+)"><div[^>]*><button[^>]*aria-expanded=/.exec(one)?.[1];
    expect(external).toBeDefined();
    expect(rules(external!)).toContain('grid-column:3;');
    expect(rules(external!)).toContain('justify-self:end;');
    expect(rules(external!)).not.toContain('position:absolute;');
    expect(one).toContain('aria-label="1 error"');
    expect(one).toContain('>1 error<');

    log(store, 'y');
    expect(render(store, <UnconnectedGlobalMenu />)).toContain('>2 errors<');
    expect(render(store, <UnconnectedGlobalMenu />, ko)).toContain('>오류 2개<');
  });
});

describe('/console', () => {
  test('goes home while the HID Console tab is off, as /diagnostics does', () => {
    const visit = (location: string) => {
      const hook = staticLocationHook(location, {record: true});
      let renderer!: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          <Router hook={hook}>
            <HIDConsoleRoute shown={false} location={location} />
          </Router>,
        );
      });
      act(() => renderer.unmount());
      return hook.history;
    };
    expect(visit('/console')).toEqual(['/console', '/']);
    expect(visit('/settings')).toEqual(['/settings']);
  });
});
