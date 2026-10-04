import {afterEach, expect, spyOn, test} from 'bun:test';
import {configureStore} from '@reduxjs/toolkit';
import {readFileSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import {Provider} from 'react-redux';
import {I18nextProvider} from 'react-i18next';
import i18n from 'i18next';
import {Router} from 'wouter';
import staticLocationHook from 'wouter/static-location';

const originalWarn = console.warn;
console.warn = () => undefined;
const {KeyboardAPI, UnhandledCommandError} =
  await import('../src/utils/keyboard-api');
const {
  default: devicesReducer,
  selectDevice,
  updateConnectedDevices,
  invalidateDeviceConnection,
  markDeviceReady,
  getSelectionGeneration,
} = await import('../src/store/devicesSlice');
const {
  default: definitionsReducer,
  updateDefinitions,
  updateEraDefinitions,
  loadInitialCustomDefinitions,
  getDefinitionSyncIdentity,
} = await import('../src/store/definitionsSlice');
const {
  default: menusReducer,
  getCustomCommandsForDefinition,
  getSelectedCustomMenuData,
  getSelectedCustomMenuAvailability,
  updateSelectedCustomMenuData,
  updateV3MenuData,
} = await import('../src/store/menusSlice');
const {
  default: stateSyncReducer,
  ensurePathSync,
  setPathCapability,
  markPathDirty,
  markDomainReadFailed,
} = await import('../src/store/stateSyncSlice');
const {default: settingsReducer} = await import('../src/store/settingsSlice');
const {default: firmwareReducer} = await import('../src/store/firmwareSlice');
const {default: definitionNameReducer} =
  await import('../src/store/definitionNameSlice');
const {commitStableConfigCandidate} =
  await import('../src/store/stateSyncCandidateActions');
const {HID, addHIDTransportGenerationListener, resetHIDTransportForTesting} =
  await import('../src/shims/node-hid');
const {setEraAdvancedMetadataForTesting, eraAdvancedEntry} =
  await import('../src/utils/era-advanced-metadata');
const {useSelectedFirmwareUpdate, setFirmwareDataForTesting} =
  await import('../src/utils/use-firmware-catalog');
const {ERA_FIRMWARE_VERSION_COMMAND} =
  await import('../src/utils/era-firmware-version');
const {ExternalLinks} = await import('../src/components/menus/external-links');
const {FirmwarePane} = await import('../src/components/panes/firmware');
const {FirmwareVersion} =
  await import('../src/components/panes/configure-panes/custom/firmware-version');
const {parseEraV3Definition} = await import('../src/utils/era-definition');
console.warn = originalWarn;

const translations = i18n.createInstance();
await translations.init({lng: 'en', resources: {en: {translation: {}}}});
const manifest = JSON.parse(
  readFileSync('config/era-definitions.manifest.json', 'utf8'),
);
const catalog = JSON.parse(
  readFileSync('config/firmware-catalog.json', 'utf8'),
);
const entry = manifest.definitions.find(
  (value: any) => value.id === 'classicd-a1',
);
// VERSION lifetime tests need a published release even when the live catalog
// intentionally lists this board as not published yet.
const latestVersion = '261003R1';
catalog.makers
  .find((maker: any) => maker.id === 'classicd')
  .boards.find((board: any) => board.board === entry.id).file = {
  version: latestVersion,
  url: '/firmware-files/261003R1/classicd/CLASSICD_A1-V261003R1.zip',
  size: 1,
  sha256: '0'.repeat(64),
};
const ascii = (version: string) => [...new TextEncoder().encode(version), 0];
const originalNavigatorHID = Object.getOwnPropertyDescriptor(navigator, 'hid');

afterEach(() => {
  resetHIDTransportForTesting();
  setEraAdvancedMetadataForTesting(null);
  setFirmwareDataForTesting(null);
  if (originalNavigatorHID)
    Object.defineProperty(navigator, 'hid', originalNavigatorHID);
  else delete (navigator as any).hid;
});

// Real enumeration and connect/disconnect event handlers retain the HIDDevice's
// own path. No caller-forced __path or registerHIDDeviceForTesting is used.
async function setup(
  version = latestVersion,
  options: {
    source?: 'era' | 'official' | 'upload';
    served?: 'current' | 'legacy';
  } = {},
) {
  const source = options.source ?? 'era';
  const identity = options.served === 'legacy' ? entry.legacy : entry;
  const events = new Map<string, Set<(event: {device: HIDDevice}) => void>>();
  const fake = {
    vendorId: Number.parseInt(identity.vendorId, 16),
    productId: Number.parseInt(identity.productId, 16),
    productName: 'CLASSIC.D A1',
    collections: [{usagePage: 0xff60, usage: 0x61}],
    opened: false,
    async open() {
      this.opened = true;
    },
    async close() {
      this.opened = false;
    },
    addEventListener() {},
    removeEventListener() {},
  } as unknown as HIDDevice;
  let present = true;
  Object.defineProperty(navigator, 'hid', {
    configurable: true,
    value: {
      getDevices: async () => (present ? [fake] : []),
      addEventListener: (
        type: string,
        listener: (event: {device: HIDDevice}) => void,
      ) => {
        const listeners = events.get(type) ?? new Set();
        listeners.add(listener);
        events.set(type, listeners);
      },
      removeEventListener: (
        type: string,
        listener: (event: {device: HIDDevice}) => void,
      ) => events.get(type)?.delete(listener),
    },
  });
  const [hid] = await HID.devices();
  const path = hid.path;
  const device = {
    path,
    vendorId: hid.vendorId,
    productId: hid.productId,
    productName: hid.productName,
    vendorProductId: hid.vendorId * 65536 + hid.productId,
    protocol: 12,
    requiredDefinitionVersion: 'v3',
    hasResolvedDefinition: true,
  };
  const store = configureStore({
    reducer: {
      devices: devicesReducer,
      definitions: definitionsReducer,
      menus: menusReducer,
      stateSync: stateSyncReducer,
      settings: settingsReducer,
      firmware: firmwareReducer,
      definitionName: definitionNameReducer,
    },
  });
  const definition = parseEraV3Definition(
    JSON.parse(readFileSync(identity.path, 'utf8')),
  );
  setFirmwareDataForTesting({catalog, manifest});
  setEraAdvancedMetadataForTesting({
    schemaVersion: 2,
    definitions: [eraAdvancedEntry(entry, device.vendorProductId)],
  });
  store.dispatch(updateConnectedDevices({[path]: device} as any));
  store.dispatch(
    (source === 'era'
      ? updateEraDefinitions
      : source === 'official'
        ? updateDefinitions
        : loadInitialCustomDefinitions)({
      [device.vendorProductId]: {v3: definition},
    } as any),
  );
  store.dispatch(
    selectDevice({device: device as any, connectionGeneration: 1}),
  );
  if (source === 'era') {
    store.dispatch(ensurePathSync({path, generation: 1}));
    store.dispatch(
      setPathCapability({path, generation: 1, capability: 'capable'}),
    );
  }
  const accept = (acceptedVersion: string, generation = 1) => {
    store.dispatch(
      commitStableConfigCandidate({
        devicePath: path,
        connectionGeneration: generation,
        selectionGeneration: getSelectionGeneration(store.getState() as any),
        definitionIdentity: getDefinitionSyncIdentity(
          store.getState() as any,
          device as any,
        )!,
        revision: 1,
        mutationEpoch: 0,
        candidate: {
          menuData: {[ERA_FIRMWARE_VERSION_COMMAND]: ascii(acceptedVersion)},
        },
      }),
    );
    store.dispatch(
      markDeviceReady({
        devicePath: path,
        connectionGeneration: generation,
        selectionGeneration: getSelectionGeneration(store.getState() as any),
      }),
    );
  };
  if (source === 'era') accept(version);
  // The same listener Home registers on every route.
  addHIDTransportGenerationListener(({path, generation, poisoned}) => {
    store.dispatch(
      invalidateDeviceConnection({
        devicePath: path,
        connectionGeneration: generation,
        locked: poisoned,
      }),
    );
  });
  const event = (type: 'connect' | 'disconnect') => {
    present = type === 'connect';
    events.get(type)?.forEach((listener) => listener({device: fake}));
  };
  const render = (child: any) =>
    renderToStaticMarkup(
      <Provider store={store}>
        <I18nextProvider i18n={translations}>
          <Router hook={staticLocationHook('/firmware/classicd/classicd-a1')}>
            {child}
          </Router>
        </I18nextProvider>
      </Provider>,
    );
  let status: any;
  let explicitVersion: string | null | undefined;
  function Probe() {
    status = useSelectedFirmwareUpdate(explicitVersion);
    return null;
  }
  const read = (version?: string | null) => {
    explicitVersion = version;
    render(<Probe />);
    return status;
  };
  return {path, store, device, definition, event, read, render, accept};
}

test('same HIDDevice physically reconnects with a reused app path and new generation', async () => {
  const c = await setup();
  expect(c.read().kind).toBe('up-to-date');
  c.event('disconnect');
  expect(await HID.devices()).toEqual([]);
  c.event('connect');
  expect((await HID.devices())[0].path).toBe(c.path);
  expect(c.store.getState().devices.selectedConnectionGeneration).toBe(3);
});

test('old lifetime cannot claim up-to-date after actual disconnect/connect', async () => {
  const c = await setup();
  c.event('disconnect');
  c.event('connect');
  expect(c.read().kind).toBe('no-claim');
});

test('new selection cannot claim current before its CONFIG is accepted', async () => {
  const c = await setup();
  c.store.dispatch(
    selectDevice({device: c.device as any, connectionGeneration: 1}),
  );
  expect(getSelectedCustomMenuAvailability(c.store.getState() as any)).toBe(
    'checking',
  );
  expect(c.read().kind).toBe('no-claim');
});

test('unverified new connection cannot publish the old VERSION', async () => {
  const c = await setup();
  c.event('disconnect');
  c.event('connect');
  c.store.dispatch(
    selectDevice({device: c.device as any, connectionGeneration: 3}),
  );
  c.store.dispatch(
    setPathCapability({path: c.path, generation: 3, capability: 'unverified'}),
  );
  expect(getSelectedCustomMenuAvailability(c.store.getState() as any)).toBe(
    'unverified',
  );
  expect(c.read().kind).toBe('no-claim');
});

test('a new connection whose first CONFIG GET is refused cannot reuse old VERSION', async () => {
  const c = await setup();
  c.event('disconnect');
  c.event('connect');
  c.store.dispatch(
    selectDevice({device: c.device as any, connectionGeneration: 3}),
  );
  c.store.dispatch(
    setPathCapability({path: c.path, generation: 3, capability: 'capable'}),
  );
  c.store.dispatch(
    markDeviceReady({
      devicePath: c.path,
      connectionGeneration: 3,
      selectionGeneration: getSelectionGeneration(c.store.getState() as any),
    }),
  );
  c.store.dispatch(
    markDomainReadFailed({
      path: c.path,
      generation: 3,
      domain: 'config',
      revision: 0,
      mutationEpoch: 0,
      selectionGeneration: getSelectionGeneration(c.store.getState() as any),
      definitionIdentity: getDefinitionSyncIdentity(
        c.store.getState() as any,
        c.device as any,
      )!,
    }),
  );
  expect(getSelectedCustomMenuAvailability(c.store.getState() as any)).toBe(
    'failed',
  );
  expect(c.read().kind).toBe('no-claim');
});

test('a changed definition cannot accept a VERSION read under the previous definition', async () => {
  const c = await setup();
  c.store.dispatch(
    updateEraDefinitions({
      [c.device.vendorProductId]: {
        v3: {...c.definition, name: 'Changed definition'},
      },
    } as any),
  );
  expect(getSelectedCustomMenuAvailability(c.store.getState() as any)).toBe(
    'checking',
  );
  expect(c.read().kind).toBe('no-claim');
});

test('header and firmware route cannot display stale current/update claims', async () => {
  const c = await setup('261001R1');
  c.event('disconnect');
  c.event('connect');
  const header = c.render(<ExternalLinks />);
  const page = c.render(<FirmwarePane />);
  expect(header.includes('data-firmware-update="available"')).toBe(false);
  expect(page.includes('Current 261001R1')).toBe(false);
});

test('same lifetime background CONFIG reconcile retains accepted VERSION display', async () => {
  const c = await setup('261001R1');
  c.store.dispatch(markPathDirty({path: c.path, generation: 1}));
  expect(getSelectedCustomMenuAvailability(c.store.getState() as any)).toBe(
    'reconciling',
  );
  expect(c.read().kind).toBe('update-available');
  expect(c.read().current).toBe('261001R1');
});

test('ordinary VIA full GET refusal after reselection must not revive old VERSION at ready', async () => {
  // A stock-loaded known legacy identity uses ordinary V3 GETs, without State
  // Sync. Keep the actual frozen definition and commands, rather than forcing
  // capability flags that the app cannot produce.
  const c = await setup(latestVersion, {source: 'official', served: 'legacy'});
  const commands = getCustomCommandsForDefinition(c.definition);
  const address = commands[ERA_FIRMWARE_VERSION_COMMAND];
  expect(address).toBeDefined();
  const getValue = spyOn(
    KeyboardAPI.prototype,
    'getCustomMenuValue',
  ).mockImplementation(async (command) => [
    0,
    ...(command.join(',') === address.join(',')
      ? ascii(latestVersion)
      : Array(27).fill(0)),
  ]);
  const getOptional = spyOn(
    KeyboardAPI.prototype,
    'getOptionalCustomMenuValue',
  ).mockImplementation(async () => null);
  const getRGB = spyOn(
    KeyboardAPI.prototype,
    'getPerKeyRGBMatrix',
  ).mockImplementation(async () => []);
  try {
    await c.store.dispatch(updateV3MenuData(c.device as any) as any);
    c.store.dispatch(
      markDeviceReady({
        devicePath: c.path,
        connectionGeneration: 1,
        selectionGeneration: getSelectionGeneration(c.store.getState() as any),
      }),
    );
    expect(c.read().kind).toBe('up-to-date');
    c.store.dispatch(
      selectDevice({device: c.device as any, connectionGeneration: 1}),
    );
    getValue.mockImplementation(async () => {
      throw new UnhandledCommandError();
    });
    await expect(
      c.store.dispatch(updateV3MenuData(c.device as any) as any),
    ).rejects.toBeInstanceOf(UnhandledCommandError);
    // selectConnectedDevice catches this menu refusal and still makes the
    // keymap ready. Readiness alone therefore cannot establish VERSION ownership.
    c.store.dispatch(
      markDeviceReady({
        devicePath: c.path,
        connectionGeneration: 1,
        selectionGeneration: getSelectionGeneration(c.store.getState() as any),
      }),
    );
    expect(getSelectedCustomMenuAvailability(c.store.getState() as any)).toBe(
      'available',
    );
    expect(c.read().kind).toBe('no-claim');
  } finally {
    getValue.mockRestore();
    getOptional.mockRestore();
    getRGB.mockRestore();
  }
});

test('explicit VERSION cannot bypass ownership after reconnect', async () => {
  const c = await setup();
  c.event('disconnect');
  c.event('connect');
  expect(c.read(latestVersion).kind).toBe('no-claim');
});

test('frozen ERA definitions retain VERSION comparison after a current CONFIG read', async () => {
  const c = await setup('260915R1', {served: 'legacy'});
  expect(c.read().kind).toBe('update-available');
  expect(c.read().current).toBe('260915R1');
  c.store.dispatch(
    selectDevice({device: c.device as any, connectionGeneration: 1}),
  );
  expect(c.read().kind).toBe('no-claim');
  c.accept('260915R1');
  expect(c.read().kind).toBe('update-available');
  expect(c.read().current).toBe('260915R1');
});

test('identical VERSION in a new connection regains ownership after its CONFIG is accepted', async () => {
  const c = await setup();
  const previousMenu = getSelectedCustomMenuData(c.store.getState() as any);
  c.event('disconnect');
  c.event('connect');
  c.store.dispatch(
    selectDevice({device: c.device as any, connectionGeneration: 3}),
  );
  c.store.dispatch(
    setPathCapability({path: c.path, generation: 3, capability: 'capable'}),
  );
  expect(c.read().kind).toBe('no-claim');
  c.accept(latestVersion, 3);
  // Equality preserves menu identity; the successful read still establishes
  // the new connection's ownership even though its VERSION is unchanged.
  expect(getSelectedCustomMenuData(c.store.getState() as any)).toBe(
    previousMenu,
  );
  expect(c.read().kind).toBe('up-to-date');
});

test('raw or partial updates never establish a VERSION read in a new selection', async () => {
  const c = await setup();
  c.store.dispatch(
    selectDevice({device: c.device as any, connectionGeneration: 1}),
  );
  c.store.dispatch(
    updateSelectedCustomMenuData({
      devicePath: c.path,
      menuData: {[ERA_FIRMWARE_VERSION_COMMAND]: ascii(latestVersion)},
    }),
  );
  c.store.dispatch(
    markDeviceReady({
      devicePath: c.path,
      connectionGeneration: 1,
      selectionGeneration: getSelectionGeneration(c.store.getState() as any),
    }),
  );
  expect(c.read().kind).toBe('no-claim');
});

test('same lifetime partial menu updates preserve a successful VERSION read', async () => {
  const c = await setup('261001R1');
  c.store.dispatch(
    updateSelectedCustomMenuData({
      devicePath: c.path,
      menuData: {
        ...getSelectedCustomMenuData(c.store.getState() as any),
        id_setting: [1],
      },
    }),
  );
  expect(c.read().kind).toBe('update-available');
  expect(c.read().current).toBe('261001R1');
});

test('ordinary full GET started under an earlier selection cannot claim VERSION for its return', async () => {
  const c = await setup(latestVersion, {source: 'official', served: 'legacy'});
  const address = getCustomCommandsForDefinition(c.definition)[
    ERA_FIRMWARE_VERSION_COMMAND
  ];
  let started!: () => void;
  let release!: () => void;
  const reachedRead = new Promise<void>((resolve) => {
    started = resolve;
  });
  const heldRead = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  const getValue = spyOn(
    KeyboardAPI.prototype,
    'getCustomMenuValue',
  ).mockImplementation(async (command) => {
    if (first) {
      first = false;
      started();
      await heldRead;
    }
    return [
      0,
      ...(command.join(',') === address.join(',')
        ? ascii(latestVersion)
        : Array(27).fill(0)),
    ];
  });
  const getOptional = spyOn(
    KeyboardAPI.prototype,
    'getOptionalCustomMenuValue',
  ).mockImplementation(async () => null);
  const getRGB = spyOn(
    KeyboardAPI.prototype,
    'getPerKeyRGBMatrix',
  ).mockImplementation(async () => []);
  try {
    const oldRead = c.store.dispatch(updateV3MenuData(c.device as any) as any);
    await reachedRead;
    c.store.dispatch(
      selectDevice({device: c.device as any, connectionGeneration: 1}),
    );
    release();
    await oldRead;
    c.store.dispatch(
      markDeviceReady({
        devicePath: c.path,
        connectionGeneration: 1,
        selectionGeneration: getSelectionGeneration(c.store.getState() as any),
      }),
    );
    expect(c.read().kind).toBe('no-claim');
  } finally {
    release();
    getValue.mockRestore();
    getOptional.mockRestore();
    getRGB.mockRestore();
  }
});

test.each(['official', 'upload'] as const)(
  '%s VERSION Current Version row cannot claim old cached value after a failed reload',
  async (source) => {
    const c = await setup(latestVersion, {source, served: 'legacy'});
    const address = getCustomCommandsForDefinition(c.definition)[
      ERA_FIRMWARE_VERSION_COMMAND
    ];
    const getValue = spyOn(
      KeyboardAPI.prototype,
      'getCustomMenuValue',
    ).mockImplementation(async (command) => [
      0,
      ...(command.join(',') === address.join(',')
        ? ascii(latestVersion)
        : Array(27).fill(0)),
    ]);
    const getOptional = spyOn(
      KeyboardAPI.prototype,
      'getOptionalCustomMenuValue',
    ).mockImplementation(async () => null);
    const getRGB = spyOn(
      KeyboardAPI.prototype,
      'getPerKeyRGBMatrix',
    ).mockImplementation(async () => []);
    try {
      await c.store.dispatch(updateV3MenuData(c.device as any) as any);
      c.store.dispatch(
        selectDevice({device: c.device as any, connectionGeneration: 1}),
      );
      getValue.mockImplementation(async () => {
        throw new UnhandledCommandError();
      });
      await expect(
        c.store.dispatch(updateV3MenuData(c.device as any) as any),
      ).rejects.toBeInstanceOf(UnhandledCommandError);
      c.store.dispatch(
        markDeviceReady({
          devicePath: c.path,
          connectionGeneration: 1,
          selectionGeneration: getSelectionGeneration(
            c.store.getState() as any,
          ),
        }),
      );
      expect(getSelectedCustomMenuAvailability(c.store.getState() as any)).toBe(
        'available',
      );
      expect(c.read().kind).toBe('no-claim');
      const html = c.render(<FirmwareVersion source="ascii" />);
      expect(html.match(/role="status"[^>]*>([^<]*)</)?.[1]).toBe('—');
    } finally {
      getValue.mockRestore();
      getOptional.mockRestore();
      getRGB.mockRestore();
    }
  },
);
