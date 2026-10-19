import {afterEach, expect, spyOn, test} from 'bun:test';
import {configureStore} from '@reduxjs/toolkit';
import {readFileSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import {Provider} from 'react-redux';
import {I18nextProvider} from 'react-i18next';
import i18n from 'i18next';
import {Router} from 'wouter';
import staticLocationHook from 'wouter/static-location';
import {
  type FirmwareCatalogSource,
  type FirmwareManifest,
  resolveFirmwareCatalog,
} from '../src/utils/era-firmware-catalog';

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
const manifest: FirmwareManifest = JSON.parse(
  readFileSync('config/era-definitions.manifest.json', 'utf8'),
);
const catalog = resolveFirmwareCatalog(
  JSON.parse(
    readFileSync('config/firmware-catalog.json', 'utf8'),
  ) as FirmwareCatalogSource,
);
const entry = manifest.definitions.find(({id}) => id === 'classicd-a1')!;
const latestVersion = catalog.makers
  .find(({id}) => id === 'classicd')!
  .boards.find(({board}) => board === entry.id)!.file!.version;
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

// Enumerate a real HIDDevice-shaped object so disconnect/reconnect exercises
// the transport's own path and generation rather than a forced test path.
async function setup(
  version = latestVersion,
  source: 'era' | 'official' | 'upload' = 'era',
  legacy = false,
) {
  resetHIDTransportForTesting();
  const identity = legacy ? entry.legacy! : entry;
  const events = new Map<string, Set<(event: {device: HIDDevice}) => void>>();
  const fake = {
    vendorId: Number(identity.vendorId),
    productId: Number(identity.productId),
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
  const definitionPath = (identity as typeof identity & {path: string}).path;
  const definition = parseEraV3Definition(
    JSON.parse(readFileSync(definitionPath, 'utf8')),
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
  const select = (generation = 1) =>
    store.dispatch(
      selectDevice({device: device as any, connectionGeneration: generation}),
    );
  const ready = (generation = 1) =>
    store.dispatch(
      markDeviceReady({
        devicePath: path,
        connectionGeneration: generation,
        selectionGeneration: getSelectionGeneration(store.getState() as any),
      }),
    );
  const context = (generation = 1) => ({
    path,
    generation,
    selectionGeneration: getSelectionGeneration(store.getState() as any),
    definitionIdentity: getDefinitionSyncIdentity(
      store.getState() as any,
      device as any,
    )!,
  });
  select();
  if (source === 'era') {
    store.dispatch(ensurePathSync({path, generation: 1}));
    store.dispatch(
      setPathCapability({path, generation: 1, capability: 'capable'}),
    );
  }
  const accept = (acceptedVersion: string, generation = 1) => {
    const {selectionGeneration, definitionIdentity} = context(generation);
    store.dispatch(
      commitStableConfigCandidate({
        devicePath: path,
        connectionGeneration: generation,
        selectionGeneration,
        definitionIdentity,
        revision: 1,
        mutationEpoch: 0,
        candidate: {
          menuData: {[ERA_FIRMWARE_VERSION_COMMAND]: ascii(acceptedVersion)},
        },
      }),
    );
    ready(generation);
  };
  if (source === 'era') accept(version);
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
  const render = (child: React.ReactNode) =>
    renderToStaticMarkup(
      <Provider store={store}>
        <I18nextProvider i18n={translations}>
          <Router hook={staticLocationHook('/firmware/classicd/classicd-a1')}>
            {child}
          </Router>
        </I18nextProvider>
      </Provider>,
    );
  let status: ReturnType<typeof useSelectedFirmwareUpdate>;
  const read = (version?: string) => {
    function Probe() {
      status = useSelectedFirmwareUpdate(version);
      return null;
    }
    render(<Probe />);
    return status!;
  };
  return {
    path,
    store,
    device,
    definition,
    event,
    read,
    render,
    accept,
    select,
    ready,
    context,
  };
}
type Connection = Awaited<ReturnType<typeof setup>>;
const mockVersionRead = (connection: Connection) => {
  const address = getCustomCommandsForDefinition(connection.definition)[
    ERA_FIRMWARE_VERSION_COMMAND
  ];
  const value = spyOn(
    KeyboardAPI.prototype,
    'getCustomMenuValue',
  ).mockImplementation(async (command) => [
    0,
    ...(command.join(',') === address.join(',')
      ? ascii(latestVersion)
      : Array(27).fill(0)),
  ]);
  const optional = spyOn(
    KeyboardAPI.prototype,
    'getOptionalCustomMenuValue',
  ).mockImplementation(async () => null);
  const rgb = spyOn(
    KeyboardAPI.prototype,
    'getPerKeyRGBMatrix',
  ).mockImplementation(async () => []);
  return {
    value,
    restore: () => {
      value.mockRestore();
      optional.mockRestore();
      rgb.mockRestore();
    },
  };
};

test('a physical reconnect requires a new accepted CONFIG for both current and frozen definitions', async () => {
  for (const legacy of [false, true]) {
    const c = await setup(latestVersion, 'era', legacy);
    expect(c.read()?.kind).toBe('up-to-date');
    c.event('disconnect');
    expect(await HID.devices()).toEqual([]);
    c.event('connect');
    expect((await HID.devices())[0].path).toBe(c.path);
    expect(c.store.getState().devices.selectedConnectionGeneration).toBe(3);
    expect(c.read()?.kind).toBe('no-claim');
    expect(c.read(latestVersion)?.kind).toBe('no-claim');
    c.select(3);
    c.store.dispatch(
      setPathCapability({path: c.path, generation: 3, capability: 'capable'}),
    );
    expect(c.read()?.kind).toBe('no-claim');
    c.accept(latestVersion, 3);
    expect(c.read()?.kind).toBe('up-to-date');
  }
});

test('reselection, unverified or refused CONFIG, changed definitions and partial writes cannot revive VERSION', async () => {
  const changes: ((c: Connection) => void)[] = [
    (c) => {
      c.select();
    },
    (c) => {
      c.select();
      c.store.dispatch(
        setPathCapability({
          path: c.path,
          generation: 1,
          capability: 'unverified',
        }),
      );
    },
    (c) => {
      c.select();
      c.ready();
      c.store.dispatch(
        markDomainReadFailed({
          ...c.context(),
          domain: 'config',
          revision: 0,
          mutationEpoch: 0,
        }),
      );
    },
    (c) => {
      c.store.dispatch(
        updateEraDefinitions({
          [c.device.vendorProductId]: {
            v3: {...c.definition, name: 'Changed definition'},
          },
        } as any),
      );
    },
    (c) => {
      c.select();
      c.store.dispatch(
        updateSelectedCustomMenuData({
          devicePath: c.path,
          menuData: {[ERA_FIRMWARE_VERSION_COMMAND]: ascii('250101R1')},
        }),
      );
      c.ready();
    },
  ];
  for (const change of changes) {
    const c = await setup('250101R1');
    expect(c.read()?.kind).toBe('update-available');
    change(c);
    expect(c.read()?.kind).toBe('no-claim');
    expect(c.read('250101R1')?.kind).toBe('no-claim');
    expect(c.render(<ExternalLinks />)).not.toContain(
      'data-firmware-update="available"',
    );
    expect(c.render(<FirmwarePane />)).not.toContain('Current 250101R1');
  }
});

test('background reconcile and partial updates retain an accepted VERSION in the same lifetime', async () => {
  const c = await setup('250101R1');
  c.store.dispatch(markPathDirty({path: c.path, generation: 1}));
  c.store.dispatch(
    updateSelectedCustomMenuData({
      devicePath: c.path,
      menuData: {
        ...getSelectedCustomMenuData(c.store.getState() as any),
        id_setting: [1],
      },
    }),
  );
  expect(c.read()).toMatchObject({
    kind: 'update-available',
    current: '250101R1',
  });
});

test('ordinary and uploaded definitions clear the visible VERSION after a refused full reload', async () => {
  for (const source of ['official', 'upload'] as const) {
    const c = await setup(latestVersion, source, true);
    const api = mockVersionRead(c);
    try {
      await c.store.dispatch(updateV3MenuData(c.device as any) as any);
      c.ready();
      expect(c.read()?.kind).toBe('up-to-date');
      c.select();
      api.value.mockImplementation(async () => {
        throw new UnhandledCommandError();
      });
      await expect(
        c.store.dispatch(updateV3MenuData(c.device as any) as any),
      ).rejects.toBeInstanceOf(UnhandledCommandError);
      c.ready();
      expect(c.read()?.kind).toBe('no-claim');
      const html = c.render(<FirmwareVersion source="ascii" />);
      expect(html).not.toContain('Up to date');
      expect(html.match(/role="status"[^>]*>([^<]*)</)?.[1]).toBe('—');
    } finally {
      api.restore();
    }
  }
});

test('a full GET started under an earlier selection cannot claim VERSION when it returns', async () => {
  const c = await setup(latestVersion, 'official', true);
  const api = mockVersionRead(c);
  let started!: () => void;
  let release!: () => void;
  const reachedRead = new Promise<void>((resolve) => {
    started = resolve;
  });
  const heldRead = new Promise<void>((resolve) => {
    release = resolve;
  });
  const readValue = api.value.getMockImplementation()!;
  let first = true;
  api.value.mockImplementation(async (...args) => {
    if (first) {
      first = false;
      started();
      await heldRead;
    }
    return readValue(...args);
  });
  try {
    const oldRead = c.store.dispatch(updateV3MenuData(c.device as any) as any);
    await reachedRead;
    c.select();
    release();
    await oldRead;
    c.ready();
    expect(c.read()?.kind).toBe('no-claim');
  } finally {
    release();
    api.restore();
  }
});
