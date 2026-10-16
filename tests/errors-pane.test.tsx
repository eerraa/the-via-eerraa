import {afterAll, expect, mock, test} from 'bun:test';
import {configureStore} from '@reduxjs/toolkit';
import i18n from 'i18next';
import type {ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {I18nextProvider} from 'react-i18next';
import {Provider} from 'react-redux';
import {act, create} from 'react-test-renderer';
import {Router} from 'wouter';
import staticLocationHook from 'wouter/static-location';
import enCatalog from '../src/locales/en.json';
import koCatalog from '../src/locales/ko.json';

if (!('window' in globalThis))
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: globalThis,
  });
for (const name of ['localStorage', 'sessionStorage']) {
  if (!(name in globalThis)) {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        key: (index: number) => Array.from(values.keys())[index] ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
        get length() {
          return values.size;
        },
      },
    });
  }
}
mock.module('assets/images/chippy_600.png', () => ({default: ''}));
const originalError = console.error;
console.error = (...args: unknown[]) => {
  if (
    args[0] !== 'Error captured:' &&
    !String(args[0]).includes('multiple renderers')
  )
    originalError(...args);
};
afterAll(() => {
  console.error = originalError;
});
await import('../src/utils/keyboard-api');
const errors = await import('../src/store/errorsSlice');
const devices = await import('../src/store/devicesSlice');
const {errorsListenerMiddleware} = await import('../src/store/errorsListener');
const {Errors} = await import('../src/components/panes/errors');
const {UnconnectedGlobalMenu} = await import('../src/components/menus/global');
const {HIDConsoleRoute} = await import('../src/components/panes/hid-console');
const {default: settings} = await import('../src/store/settingsSlice');
const {default: menus} = await import('../src/store/menusSlice');
const {APP_ERROR_TITLES, logAppError, logKeyboardAPIError} = errors;
const en = i18n.createInstance();
await en.init({
  lng: 'en',
  resources: {en: {translation: enCatalog}, ko: {translation: koCatalog}},
});
const ko = en.cloneInstance({lng: 'ko'});
const N86 = {
  vendorId: 0x4552,
  productId: 0xa002,
  productName: 'N86',
  protocol: 12,
};
const TOMAK = {
  vendorId: 0x4501,
  productId: 0xa003,
  productName: 'TOMAK TKL',
  protocol: 12,
};
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
      settings,
      devices: devices.default,
      menus,
      errors: errors.default,
    },
    middleware: (getDefault) =>
      getDefault().prepend(errorsListenerMiddleware.middleware),
  });
type Store = ReturnType<typeof makeStore>;
const log = (store: Store, message: string, deviceInfo = N86) =>
  store.dispatch(
    logAppError({message, deviceInfo, title: APP_ERROR_TITLES.unreadable}),
  );
const logged = (store: Store) =>
  store.getState().errors.appErrors.map(({message}) => message);
const render = (store: Store, element: ReactNode, translations = en) =>
  renderToStaticMarkup(
    <Provider store={store}>
      <I18nextProvider i18n={translations}>
        <Router hook={staticLocationHook('/')}>{element}</Router>
      </I18nextProvider>
    </Provider>,
  );
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('reloading a keyboard clears only its earlier errors, never a superseded load or a new error', async () => {
  for (const superseded of [false, true]) {
    const store = makeStore();
    log(store, 'old');
    log(store, 'other keyboard', TOMAK);
    store.dispatch(
      devices.updateConnectedDevices({[replugged.path]: replugged}),
    );
    store.dispatch(
      devices.selectDevice({device: replugged, connectionGeneration: 1}),
    );
    const first = store.getState().devices.selectionGeneration;
    if (superseded) {
      store.dispatch(
        devices.selectDevice({device: replugged, connectionGeneration: 2}),
      );
      store.dispatch(
        devices.markDeviceReady({
          devicePath: replugged.path,
          connectionGeneration: 1,
          selectionGeneration: first,
        }),
      );
      await settle();
      expect(logged(store)).toEqual(['old', 'other keyboard']);
    }
    log(store, 'during load');
    store.dispatch(
      devices.markDeviceReady({
        devicePath: replugged.path,
        connectionGeneration: superseded ? 2 : 1,
        selectionGeneration: store.getState().devices.selectionGeneration,
      }),
    );
    await settle();
    expect(logged(store)).toEqual(['other keyboard', 'during load']);
  }
});

test('errors show localized summaries and keyboard names without exposing raw transport details', () => {
  const store = makeStore();
  store.dispatch(
    logAppError({
      message:
        'HIDTransportTimeoutError: HID response timed out for 5f1c0c2e\n at exchange (node-hid.ts:801:15)',
      deviceInfo: N86,
      title: APP_ERROR_TITLES.noResponse,
    }),
  );
  store.dispatch(
    logKeyboardAPIError({
      commandName: 'CUSTOM_MENU_GET_VALUE',
      commandBytes: [0x08, 0, 1],
      responseBytes: [0xff, 0x08, 0, 1],
      deviceInfo: TOMAK,
    }),
  );
  const html = render(store, <Errors />, ko);
  for (const summary of [
    '키보드 응답 없음',
    '키보드를 읽지 못함',
    'N86',
    'TOMAK TKL',
  ])
    expect(html).toContain(summary);
  for (const detail of [
    'timed out',
    '5f1c0c2e',
    'node-hid',
    'CUSTOM_MENU',
    'Command',
    'Response',
    '0x4552',
  ])
    expect(html).not.toContain(detail);
});

test('the header counts errors and removes its warning when they are cleared', () => {
  const store = makeStore();
  expect(render(store, <UnconnectedGlobalMenu />)).not.toContain(
    'href="/errors"',
  );
  for (const [count, english, korean] of [
    [1, '1 error', '오류 1개'],
    [2, '2 errors', '오류 2개'],
  ] as const) {
    log(store, String(count));
    expect(render(store, <UnconnectedGlobalMenu />)).toContain(english);
    expect(render(store, <UnconnectedGlobalMenu />, ko)).toContain(korean);
  }
  store.dispatch(
    errors.clearDeviceErrors({
      vendorId: N86.vendorId,
      productId: N86.productId,
      before: 2,
    }),
  );
  expect(render(store, <UnconnectedGlobalMenu />)).not.toContain(
    'href="/errors"',
  );
});

test('a hidden console redirects its old route without redirecting unrelated pages', () => {
  for (const location of ['/console', '/settings']) {
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
    expect(hook.history).toEqual(
      location === '/console' ? ['/console', '/'] : ['/settings'],
    );
  }
});
