import {configureStore} from '@reduxjs/toolkit';
import {describe, expect, test} from 'bun:test';
import i18n from 'i18next';
import {Provider} from 'react-redux';
import {I18nextProvider} from 'react-i18next';
import {renderToStaticMarkup} from 'react-dom/server';

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

const makeStore = () => {
  const state = {
    definitions: {
      definitions: {
        [device.vendorProductId]: {v3: {}},
      },
      customDefinitions: {},
      eraDefinitions: {},
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
    menus: {customMenuDataMap: {}, commonMenusMap: {}, showKeyPainter: false},
  };
  return configureStore({reducer: () => state as any});
};

describe('Custom menu pane loading failure', () => {
  test('renders an actionable message instead of an empty pane', () => {
    const html = renderToStaticMarkup(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={translations}>
          <Pane viaMenu={{label: 'FEATURES', content: []} as any} />
        </I18nextProvider>
      </Provider>,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain(loadFailureMessage);
  });
});
