import {afterEach, expect, spyOn, test} from 'bun:test';
import {createHash} from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {strFromU8, unzipSync} from 'fflate';
import {configureStore} from '@reduxjs/toolkit';
import i18n from 'i18next';
import {useSyncExternalStore, type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {I18nextProvider} from 'react-i18next';
import {Provider} from 'react-redux';
import {act, create, type ReactTestInstance} from 'react-test-renderer';
import {Router} from 'wouter';
import staticLocationHook from 'wouter/static-location';
import {
  classifyFirmwareTransition,
  type FirmwareCatalogSource,
  type FirmwareData,
  type FirmwareManifest,
  formatFirmwareFileSize,
  getBoardDefinitions,
  getFirmwareBoardInfo,
  getFirmwareEepromStatus,
  getFirmwareHistory,
  getFirmwareUpdateStatus,
  getManifestEntryIdentities,
  QMK_STORAGE_PLACEMENT_BOUNDARY,
  resolveFirmwareCatalog,
  resolveFirmwareIdentity,
  validateFirmwareCatalog,
} from '../src/utils/era-firmware-catalog';
import {
  compareEraFirmwareVersions,
  ERA_FIRMWARE_VERSION_COMMAND,
} from '../src/utils/era-firmware-version';
import {
  getFirmwarePath,
  parseFirmwarePath,
  resolveFirmwareRoute,
} from '../src/utils/firmware-route';
import {
  getMakerSharePage,
  toFirmwareSharePage,
  toFirmwareShareRedirects,
} from '../scripts/firmware-share-page';
import {
  readFirmwareData,
  validateFirmwareCatalogAt,
  validateFirmwareCatalogFiles,
} from '../scripts/validate-firmware-catalog';

if (!('window' in globalThis)) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: globalThis,
  });
}
if (!('localStorage' in globalThis)) {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
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
const originalWarn = console.warn;
console.warn = () => undefined;
await import('../src/utils/keyboard-api');
const {setFirmwareDataForTesting} =
  await import('../src/utils/use-firmware-catalog');
const {FirmwareVersion} =
  await import('../src/components/panes/configure-panes/custom/firmware-version');
const {FirmwarePane} = await import('../src/components/panes/firmware');
const {FirmwareDevice} =
  await import('../src/components/panes/firmware-device');
const {HID} = await import('../src/shims/node-hid');
const deviceThunks = await import('../src/store/devicesThunks');
const {ExternalLinks} = await import('../src/components/menus/external-links');
const {default: settingsReducer} = await import('../src/store/settingsSlice');
const {
  default: devicesReducer,
  selectDevice,
  updateConnectedDevices,
  invalidateDeviceConnection,
  getSelectionGeneration,
} = await import('../src/store/devicesSlice');
const {
  default: definitionsReducer,
  updateEraDefinitions,
  getDefinitionSyncIdentity,
} = await import('../src/store/definitionsSlice');
const {default: menusReducer} = await import('../src/store/menusSlice');
const {
  default: stateSyncReducer,
  ensurePathSync,
  setPathCapability,
  markPathDirty,
  markDomainReadFailed,
} = await import('../src/store/stateSyncSlice');
const {commitStableConfigCandidate} =
  await import('../src/store/stateSyncCandidateActions');
const {setEraAdvancedMetadataForTesting, eraAdvancedEntry} =
  await import('../src/utils/era-advanced-metadata');
console.warn = originalWarn;

const translations = i18n.createInstance();
await translations.init({lng: 'en', resources: {en: {translation: {}}}});
const repoRoot = path.join(import.meta.dir, '..');
const readJSON = <T,>(relative: string): T =>
  JSON.parse(readFileSync(path.join(repoRoot, relative), 'utf8'));
const source = readJSON<FirmwareCatalogSource>('config/firmware-catalog.json');
const manifest = readJSON<FirmwareManifest>(
  'config/era-definitions.manifest.json',
);
const dataFor = (catalog = source): FirmwareData => ({
  catalog: resolveFirmwareCatalog(catalog),
  manifest,
});
const committed = dataFor();
const latest = committed.catalog.versions!.at(-1)!.version;
const latestFor = (makerId: string, boardId: string) =>
  committed.catalog.makers
    .find(({id}) => id === makerId)!
    .boards.find(({board}) => board === boardId)!.file!.version;
const a1Latest = latestFor('classicd', 'classicd-a1');
const n86Latest = latestFor('linworks', 'n86');
const cloneSource = () => structuredClone(source);
const usbId = (id: string, legacy = false) => {
  const entry = manifest.definitions.find((entry) => entry.id === id)!;
  const identity = legacy ? entry.legacy! : entry;
  return {
    vendorId: Number(identity.vendorId),
    productId: Number(identity.productId),
  };
};
type Device = ReturnType<typeof usbId>;
const ascii = (value: string) => [...new TextEncoder().encode(value), 0];
const makeStore = (device: Device | null = null, version?: string) => {
  const devicePath = 'firmware-distribution-test';
  const vendorProductId = device
    ? device.vendorId * 0x10000 + device.productId
    : 0;
  const state = {
    settings: settingsReducer(undefined, {type: 'init'}),
    definitions: {
      definitions: device
        ? {[vendorProductId]: {v3: {name: 'Firmware test keyboard'}}}
        : {},
      eraDefinitions: {},
      customDefinitions: {},
      definitionEpochs: {},
    },
    definitionName: {selectedOptionMap: {}},
    devices: {
      selectedDevicePath: device ? devicePath : null,
      selectedConnectionGeneration: device ? 1 : null,
      selectionGeneration: 0,
      selectedConnectionNeedsReload: false,
      connectedDevicePaths: device
        ? {
            [devicePath]: {
              path: devicePath,
              ...device,
              vendorProductId,
              productName: 'Firmware test keyboard',
              protocol: 12,
              requiredDefinitionVersion: 'v3',
              hasResolvedDefinition: true,
            },
          }
        : {},
    },
    menus: {
      readContexts:
        device && version
          ? {
              [devicePath]: {
                connectionGeneration: 1,
                selectionGeneration: 0,
                definitionIdentity: `${vendorProductId}:v3:0`,
              },
            }
          : {},
      customMenuDataMap:
        device && version
          ? {[devicePath]: {[ERA_FIRMWARE_VERSION_COMMAND]: ascii(version)}}
          : {},
    },
  };
  return configureStore({
    reducer: (current = state, action) =>
      action.type === 'test/disconnect'
        ? {
            ...current,
            devices: {
              ...current.devices,
              selectedDevicePath: null,
              connectedDevicePaths: {},
            },
          }
        : current,
  });
};
const providers = (
  child: ReactNode,
  store = makeStore(),
  hook = staticLocationHook('/firmware'),
) => (
  <Provider store={store}>
    <I18nextProvider i18n={translations}>
      <Router hook={hook}>{child}</Router>
    </I18nextProvider>
  </Provider>
);
const globals = (values: Record<string, unknown>) => {
  const descriptors = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  Object.entries(values).forEach(([key, value]) =>
    Object.defineProperty(globalThis, key, {configurable: true, value}),
  );
  return () =>
    descriptors.forEach(([key, descriptor]) =>
      descriptor
        ? Object.defineProperty(globalThis, key, descriptor)
        : Reflect.deleteProperty(globalThis, key),
    );
};
const renderPage = (
  route: string,
  data = committed,
  device: Device | null = null,
  version?: string,
) => {
  const location = new URL(route, 'http://localhost');
  const restore = globals({location});
  setFirmwareDataForTesting(data);
  try {
    return renderToStaticMarkup(
      providers(
        <FirmwarePane />,
        makeStore(device, version),
        staticLocationHook(location.pathname),
      ),
    );
  } finally {
    restore();
  }
};
const mountPage = (route: string, device: Device | null = null) => {
  const location = new URL(route, 'http://localhost');
  const events = new EventTarget();
  const listeners = new Set<() => void>();
  const calls: string[] = [];
  const change = (kind: string, to: string) => {
    calls.push(to);
    location.href = new URL(to, location).href;
    listeners.forEach((callback) => callback());
    events.dispatchEvent(new Event(kind));
  };
  const restore = globals({
    location,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    history: {
      pushState: (_state: unknown, _title: string, to: string) =>
        change('pushState', to),
      replaceState: (_state: unknown, _title: string, to: string) =>
        change('replaceState', to),
    },
  });
  const hook = () =>
    [
      useSyncExternalStore(
        (callback) => {
          listeners.add(callback);
          return () => listeners.delete(callback);
        },
        () => location.pathname,
      ),
      () => undefined,
    ] as ReturnType<ReturnType<typeof staticLocationHook>>;
  const store = makeStore(device, '250101R1');
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(providers(<FirmwarePane />, store, hook));
  });
  return {
    renderer,
    store,
    location,
    calls,
    close: () => {
      act(() => renderer.unmount());
      restore();
    },
  };
};
const text = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === 'string' ? child : text(child)))
    .join('');
const anchor = (root: ReactTestInstance, href: string) =>
  root.findAll((node) => node.type === 'a' && node.props.href === href)[0];

afterEach(() => {
  setFirmwareDataForTesting(null);
  setEraAdvancedMetadataForTesting(null);
});

test('every released keyboard ships the catalogued bytes, version and USB identities', async () => {
  expect(await validateFirmwareCatalogAt(repoRoot)).toEqual([]);
  for (const release of source.versions) {
    for (const [makerId, files] of Object.entries(release.files)) {
      for (const [boardId, file] of Object.entries(files)) {
        const bytes = readFileSync(path.join(repoRoot, 'public', file.url));
        expect(bytes.length).toBe(file.size);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(
          file.sha256,
        );
        const entries = unzipSync(bytes);
        const names = Object.keys(entries);
        expect(names.some((name) => name.endsWith('RELEASE.json'))).toBe(false);
        const images = names.filter((name) => name.endsWith('.uf2'));
        expect(images.length).toBeGreaterThan(0);
        for (const image of images) {
          expect(
            image.endsWith(`-V${release.version}.uf2`) ||
              path.basename(image) === 'Reset.uf2',
          ).toBe(true);
        }
        const maker = source.makers.find(({id}) => id === makerId)!;
        const expected = getBoardDefinitions(manifest, boardId).flatMap(
          (entry) =>
            getManifestEntryIdentities(entry)
              .filter((identity) => identity.vendorId === maker.vendorId)
              .map(
                (identity) =>
                  `${Number(identity.vendorId)}:${Number(identity.productId)}`,
              ),
        );
        const actual = Object.entries(entries)
          .filter(([name]) => /usevia\.app\/.*\.json$/i.test(name))
          .map(([, bytes]) => {
            const raw = JSON.parse(strFromU8(bytes));
            return `${Number(raw.vendorId)}:${Number(raw.productId)}`;
          });
        expect(actual.sort()).toEqual(expected.sort());
      }
    }
  }
});

test('release gates reject broken historical metadata, bytes and identities', async () => {
  const mutations: [
    string,
    (value: FirmwareCatalogSource, manifest: FirmwareManifest) => void,
  ][] = [
    [
      'ZIP under',
      (value) => {
        value.versions[0].files.sirind.divine.url = '/firmware/wrong.zip';
      },
    ],
    [
      'positive byte count',
      (value) => {
        value.versions[0].files.sirind.divine.size = 0;
      },
    ],
    [
      '64 lowercase hex',
      (value) => {
        value.versions[0].files.sirind.divine.sha256 = 'bad';
      },
    ],
    [
      'not distributed',
      (value) => {
        value.versions[0].files.sirind.unknown =
          value.versions[0].files.sirind.divine;
      },
    ],
    [
      'declared twice',
      (value) => {
        value.versions.push(value.versions[0]);
      },
    ],
    [
      'VERSION token',
      (value) => {
        value.versions[0].version = 'invalid';
      },
    ],
    [
      'outside the maker block',
      (value) => {
        value.makers[0].vendorId = '0x4552';
      },
    ],
    [
      'not an ERA identity',
      (_value, manifest) => {
        manifest.definitions[0].vendorId = '0x1234';
      },
    ],
    [
      `board "${source.boards[0].id}" is declared twice`,
      (value) => {
        value.boards.push(value.boards[0]);
      },
    ],
    [
      'is listed twice',
      (value) => {
        value.makers[0].boards.push(value.makers[0].boards[0]);
      },
    ],
    [
      "repeats another maker's VID",
      (value) => {
        value.makers[1].vendorId = value.makers[0].vendorId;
      },
    ],
    [
      'is not a legacy ERA VID/PID',
      (_value, manifest) => {
        manifest.downloadOnlyIdentities![0].vendorId = '0x4501';
      },
    ],
    [
      'is not a legacy ERA VID/PID',
      (_value, manifest) => {
        manifest.downloadOnlyIdentities![0].productId = 'invalid';
      },
    ],
    [
      'names an undeclared board',
      (_value, manifest) => {
        manifest.downloadOnlyIdentities![0].board = 'unknown';
      },
    ],
    [
      'repeats another USB identity',
      (_value, manifest) => {
        manifest.downloadOnlyIdentities!.push(
          manifest.downloadOnlyIdentities![0],
        );
      },
    ],
    [
      'repeats another USB identity',
      (_value, manifest) => {
        const {vendorId, productId} = manifest.definitions.find(
          ({id}) => id === 'classicd-a1',
        )!.legacy!;
        Object.assign(manifest.downloadOnlyIdentities![0], {
          vendorId,
          productId,
        });
      },
    ],
  ];
  for (const [error, mutate] of mutations) {
    const value = cloneSource();
    const testManifest = structuredClone(manifest);
    mutate(value, testManifest);
    expect(
      validateFirmwareCatalog({...dataFor(value), manifest: testManifest}).join(
        '\n',
      ),
    ).toContain(error);
  }
  const root = mkdtempSync(path.join(os.tmpdir(), 'era-release-gate-'));
  const value = cloneSource();
  value.versions = value.versions
    .filter((release) => release.files.sirind?.divine)
    .map((release) => ({
      ...release,
      files: {sirind: {divine: release.files.sirind.divine}},
    }));
  try {
    for (const release of value.versions) {
      const file = release.files.sirind.divine;
      const target = path.join(root, file.url);
      mkdirSync(path.dirname(target), {recursive: true});
      copyFileSync(path.join(repoRoot, 'public', file.url), target);
    }
    expect(await validateFirmwareCatalogFiles(dataFor(value), root)).toEqual(
      [],
    );
    const file = value.versions[0].files.sirind.divine;
    file.size++;
    file.sha256 = '0'.repeat(64);
    const errors = await validateFirmwareCatalogFiles(dataFor(value), root);
    expect(errors.join('\n')).toContain('catalog records');
    expect(errors.join('\n')).toContain('SHA-256 does not match');
    unlinkSync(path.join(root, file.url));
    expect(
      (await validateFirmwareCatalogFiles(dataFor(value), root)).join('\n'),
    ).toContain('file is missing');
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('deleting a defective release and its files restores the previous download everywhere', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'era-withdraw-release-'));
  const value = cloneSource();
  value.boards = value.boards.filter(({id}) => id === 'classicd-a1');
  value.makers = value.makers
    .filter(({id}) => id === 'classicd')
    .map((maker) => ({
      ...maker,
      boards: maker.boards.filter(({board}) => board === 'classicd-a1'),
    }));
  value.versions = value.versions
    .filter((release) => release.files.classicd?.['classicd-a1'])
    .map((release) => ({
      ...release,
      files: {classicd: {'classicd-a1': release.files.classicd['classicd-a1']}},
    }));
  const writeCatalog = () =>
    writeFileSync(
      path.join(root, 'config/firmware-catalog.json'),
      JSON.stringify(value),
    );
  try {
    mkdirSync(path.join(root, 'config'));
    writeFileSync(
      path.join(root, 'config/era-definitions.manifest.json'),
      JSON.stringify({...manifest, downloadOnlyIdentities: []}),
    );
    for (const release of value.versions) {
      const file = release.files.classicd['classicd-a1'];
      const target = path.join(root, 'public', file.url);
      mkdirSync(path.dirname(target), {recursive: true});
      copyFileSync(path.join(repoRoot, 'public', file.url), target);
    }
    writeCatalog();
    expect(await validateFirmwareCatalogAt(root)).toEqual([]);
    const removed = value.versions.pop()!;
    unlinkSync(
      path.join(root, 'public', removed.files.classicd['classicd-a1'].url),
    );
    expect((await validateFirmwareCatalogAt(root)).join('\n')).toContain(
      'file is missing',
    );
    writeCatalog();
    expect(await validateFirmwareCatalogAt(root)).toEqual([]);
    const data = await readFirmwareData(root);
    const previous = value.versions.at(-1)!;
    const file = data.catalog.makers[0].boards[0].file!;
    expect(file.version).toBe(previous.version);
    expect(
      getFirmwareHistory(
        data.catalog,
        'classicd',
        getFirmwareBoardInfo(data, 'classicd-a1'),
      ).map(({file}) => file.version),
    ).toEqual(value.versions.map(({version}) => version));
    expect(
      getFirmwareUpdateStatus(data, {
        ...usbId('classicd-a1'),
        version: previous.version,
      }).kind,
    ).toBe('up-to-date');
    const html = renderPage(
      `/firmware/classicd/classicd-a1?version=${removed.version}`,
      data,
    );
    expect(html).toContain(file.url);
    expect(html).toContain(file.sha256);
    expect(html).not.toContain(removed.files.classicd['classicd-a1'].url);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('current, split, shared legacy and download-only USB identities select only valid makers', () => {
  for (const entry of manifest.definitions) {
    const boardId = entry.pair ?? entry.id;
    const candidates = source.makers.filter((maker) =>
      maker.boards.some(({board}) => board === boardId),
    );
    for (const identity of getManifestEntryIdentities(entry)) {
      const resolved = resolveFirmwareIdentity(
        committed,
        Number(identity.vendorId),
        Number(identity.productId),
      );
      if (!candidates.length) {
        expect(resolved).toBeNull();
        continue;
      }
      expect(resolved?.board.id).toBe(boardId);
      const matching = candidates.filter(
        (maker) => maker.vendorId === identity.vendorId,
      );
      expect(resolved?.makers.map(({id}) => id).sort()).toEqual(
        (matching.length ? matching : candidates).map(({id}) => id).sort(),
      );
    }
  }
  for (const alias of manifest.downloadOnlyIdentities ?? []) {
    const resolved = resolveFirmwareIdentity(
      committed,
      Number(alias.vendorId),
      Number(alias.productId),
    );
    expect(resolved?.board.id).toBe(alias.board);
    expect(resolved?.downloadOnly).toBe(true);
  }
  expect(resolveFirmwareIdentity(committed, 1, 2)).toBeNull();
});

test('version comparison makes an update claim only when every possible maker supports it', () => {
  for (const [current, expected] of [
    ['250101R1', 'update-available'],
    [latest, 'up-to-date'],
    ['271015R1', 'up-to-date'],
    ['bad', 'no-claim'],
    [null, 'no-claim'],
  ] as const) {
    expect(
      getFirmwareUpdateStatus(committed, {
        ...usbId('classicd-a1'),
        version: current,
      }).kind,
    ).toBe(expected);
  }
  expect(compareEraFirmwareVersions('261015R1', '261015R2')).toBe(-1);
  const shared = {...usbId('n86', true), version: '250101R1'};
  expect(getFirmwareUpdateStatus(committed, shared)).toMatchObject({
    kind: 'choose-maker',
    update: {version: n86Latest},
  });
  const mixed = cloneSource();
  delete mixed.versions.findLast((release) => release.files.linworks?.n86)!.files
    .linworks.n86;
  expect(getFirmwareUpdateStatus(dataFor(mixed), shared)).toMatchObject({
    kind: 'choose-maker',
    update: {version: null},
  });
  expect(
    getFirmwareUpdateStatus(dataFor(mixed), {...shared, version: n86Latest}),
  ).not.toHaveProperty('update');
  for (const [withheld, unpublished] of [
    [['linworks', 'keynetix'], false],
    [['linworks'], false],
    [['linworks'], true],
  ] as const) {
    const partial = cloneSource();
    for (const release of partial.versions) {
      if (
        unpublished ||
        compareEraFirmwareVersions('261005R1', release.version) === -1
      ) {
        for (const maker of withheld) delete release.files[maker]?.n86;
      }
    }
    const status = getFirmwareUpdateStatus(dataFor(partial), {
      ...shared,
      version: '261005R1',
    });
    expect(status.kind).toBe('choose-maker');
    expect(status).not.toHaveProperty('update');
  }
  expect(
    getFirmwareUpdateStatus(dataFor({...source, versions: []}), shared).kind,
  ).toBe('unpublished');
  expect(
    getFirmwareUpdateStatus(committed, {
      vendorId: 1,
      productId: 2,
      version: latest,
    }).kind,
  ).toBe('not-distributed');
});

test('board URLs resolve case, short links and invalid routes without guessing a shared maker', () => {
  for (const [route, view, maker, board] of [
    ['/firmware/CLASSICD/CLASSICD-A1', 'board', 'classicd', 'classicd-a1'],
    ['/firmware/classicd-a1', 'board', 'classicd', 'classicd-a1'],
    ['/firmware/n86', 'list', null, undefined],
    ['/firmware/unknown', 'list', null, undefined],
    ['/firmware/classicd/unknown', 'list', 'classicd', undefined],
  ] as const) {
    const result = resolveFirmwareRoute(
      parseFirmwarePath(route)!,
      committed.catalog.makers,
    );
    expect(result.view).toBe(view);
    expect(result.maker?.id ?? null).toBe(maker);
    expect('board' in result ? result.board : undefined).toBe(board);
  }
});

test('VERSION and header actions lead to the available download or ordinary maker selection', () => {
  for (const [device, version, data, destination, label, update] of [
    [
      usbId('classicd-a1'),
      '250101R1',
      committed,
      '/firmware/classicd/classicd-a1',
      `New version ${a1Latest}`,
      true,
    ],
    [
      usbId('classicd-a1'),
      a1Latest,
      committed,
      '/firmware/classicd/classicd-a1',
      'Up to date',
      false,
    ],
    [
      usbId('classicd-a1'),
      'bad',
      committed,
      '/firmware/classicd/classicd-a1',
      `Latest ${a1Latest}`,
      false,
    ],
    [
      usbId('n86', true),
      '250101R1',
      committed,
      '/firmware',
      `Latest ${n86Latest}`,
      true,
    ],
    [
      usbId('classicd-a1'),
      a1Latest,
      dataFor({...source, versions: []}),
      null,
      'Not published',
      false,
    ],
  ] as const) {
    setFirmwareDataForTesting(data);
    const store = makeStore(device, version);
    const row = renderToStaticMarkup(
      providers(<FirmwareVersion source="ascii" />, store),
    );
    expect(row).toContain(label);
    if (destination) expect(row).toContain(`href="${destination}"`);
    else expect(row).not.toContain('href=');
    const header = renderToStaticMarkup(providers(<ExternalLinks />, store));
    expect(header.includes('data-firmware-update="available"')).toBe(update);
  }
});

test('offline board pages offer each latest file, size and checksum without a release date', () => {
  const restore = globals({navigator: {}});
  try {
    for (const maker of committed.catalog.makers) {
      for (const entry of maker.boards) {
        const file = entry.file!;
        const html = renderPage(getFirmwarePath(maker.id, entry.board));
        expect(html).toContain(`href="${file.url}"`);
        expect(html).toContain(`download="${path.basename(file.url)}"`);
        expect(html).toContain(file.sha256);
        expect(html).toContain(formatFirmwareFileSize(file.size));
        expect(html).toContain(file.version);
        expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}/);
        const board = getFirmwareBoardInfo(committed, entry.board);
        expect(html.includes('RPI-RP2')).toBe(board.family === 'qmk');
        expect(html.includes('flash both halves')).toBe(board.split);
        if (board.family === 'qmk') {
          expect(html).toContain(
            board.split
              ? '<li>Enter the bootloader with SYSTEM → BOOT → Jump To BOOT, a QK_BOOT key, or by holding the top-left key of each half while plugging in its USB (Bootmagic).</li>'
              : '<li>Enter the bootloader with SYSTEM → BOOT → Jump To BOOT, a QK_BOOT key, or by holding the top-left key while plugging in USB (Bootmagic).</li>',
          );
          expect(html).toContain(
            '<li>Keyboard settings may reset after updating. Save them in the &quot;Save + Load&quot; menu.</li>',
          );
          expect(html).toContain(
            '<li>Reset.uf2 always resets the keymap and settings.</li>',
          );
        }
      }
    }
    const html = renderPage(
      '/firmware/classicd/classicd-a1',
      dataFor({...source, versions: []}),
    );
    expect(html).toContain('Not published');
    expect(html).not.toContain('download=');
    expect(html).toContain('.uf2');
  } finally {
    restore();
  }
});

test('maker pages list keyboards A-Z by their displayed names', () => {
  const restore = globals({navigator: {}});
  const expected = {
    classicd: ['classicd-a1', 'classicd-a1-ug', 'classicd-core', 'classicd-coreless'],
    keynetix: ['may65-h7s', 'n86', 'n87', 'n8x'],
    linworks: ['fave65s', 'n86', 'n87', 'n8x'],
    newone: ['newone-a1', 'newone-h1', 'newone-odessey60h', 'newone-odessey60s'],
    sirind: [
      'brick60-h7s', 'brick65-h7s', 'brick65s', 'chickpad', 'divine',
      'klein-hs', 'klein-sd', 'n86', 'n87', 'n8x', 'sculpturei-h7s',
      'tomak-tkl', 'tomak79h', 'tomak79s',
    ],
    common: ['7b75', 'era65', 'et-tkl', 'intigrity80-h7s', 'riley'],
  };
  const originalBoards = committed.catalog.makers.map(({boards}) =>
    boards.map(({board}) => board),
  );
  try {
    for (const [makerId, boards] of Object.entries(expected)) {
      const html = renderPage(`/firmware/${makerId}`);
      expect(
        [...html.matchAll(/data-firmware-board="([^"]+)"/g)].map(
          ([, board]) => board,
        ),
      ).toEqual(boards);
    }
    expect(
      committed.catalog.makers.map(({boards}) => boards.map(({board}) => board)),
    ).toEqual(originalBoards);
  } finally {
    restore();
  }
});

test('a connected keyboard’s page names it once, its VERSION leading into the file', () => {
  const restore = globals({navigator: {}});
  try {
    const route = '/firmware/classicd/classicd-a1';
    const device = usbId('classicd-a1');
    const {name} = getFirmwareBoardInfo(committed, 'classicd-a1');
    const named = (html: string) => html.split(`>${name}<`).length - 1;
    const preBoundaryRoute = `${route}?version=261019R1`;
    const outdated = renderPage(preBoundaryRoute, committed, device, '250101R1');
    expect(named(outdated)).toBe(1);
    expect(outdated).toContain('data-firmware-connected="true"');
    expect(outdated).toContain('Current 250101R1 →');
    expect(outdated).toContain('data-firmware-eeprom="unknown"');
    expect(outdated).toContain('data-firmware-eeprom-reason="unverified-current"');
    expect(outdated).toContain('>Settings retention unknown<');
    expect(outdated).toContain(
      '>Compatibility data for the installed firmware version is unavailable; settings retention cannot be determined.<',
    );
    expect(outdated).toContain('Reset.uf2 always resets the keymap and settings.');
    const reset = renderPage(route, committed, device, '261005R1');
    expect(reset).toContain('data-firmware-eeprom="reset"');
    expect(reset).toContain('data-icon="triangle-exclamation"');
    // Pre-boundary QMK -> pre-boundary QMK with equal keys warns about Bootmagic entry.
    const preBoundaryEqual = renderPage(preBoundaryRoute, committed, device, '261005R1');
    expect(preBoundaryEqual).toContain('Current 261005R1 →');
    expect(preBoundaryEqual).toContain('data-firmware-eeprom="unknown"');
    expect(preBoundaryEqual).toContain(
      'data-firmware-eeprom-reason="legacy-bootmagic"',
    );
    expect(preBoundaryEqual).toContain('>Settings retention unknown<');
    expect(preBoundaryEqual).toContain(
      '>Top-left key entry (Bootmagic) resets settings<',
    );
    // Same-version reinstallation on pre-boundary QMK still shows the status.
    const current = renderPage(preBoundaryRoute, committed, device, '261019R1');
    expect(named(current)).toBe(1);
    expect(current).toContain('>Current<');
    expect(current).not.toContain('Current 261019R1');
    expect(current).toContain('data-firmware-eeprom="unknown"');
    expect(current).toContain('data-firmware-eeprom-reason="legacy-bootmagic"');
    // H7S uses direct key comparison without the QMK placement boundary.
    const h7sRoute = '/firmware/sirind/brick60-h7s?version=261015R1';
    const h7sDevice = usbId('brick60-h7s');
    const h7sKept = renderPage(h7sRoute, committed, h7sDevice, '261005R1');
    expect(h7sKept).toContain('data-firmware-eeprom="keep"');
    expect(h7sKept).toContain('data-firmware-eeprom-reason="same-storage"');
    expect(h7sKept).toContain('>EEPROM kept<');
    // A VERSION that makes no claim marks the keyboard but shows no version.
    const unclaimed = renderPage(route, committed, device, 'bad');
    expect(unclaimed).toContain('data-firmware-connected="true"');
    expect(unclaimed).not.toContain('>Current<');
    expect(unclaimed).not.toContain('Current bad');
    expect(unclaimed).toContain('data-firmware-eeprom="unknown"');
    expect(unclaimed).toContain('>Settings retention unknown<');
    expect(unclaimed).toContain(
      '>Current firmware version is unavailable or unverified; settings retention cannot be determined.<',
    );
    const unread = renderPage(route, committed, device);
    expect(unread).toContain('>Settings retention unknown<');
    expect(unread).toContain(
      '>Current firmware version is unavailable or unverified; settings retention cannot be determined.<',
    );
    const disconnected = renderPage(route);
    expect(disconnected).not.toContain('data-firmware-connected');
    expect(disconnected).toContain('data-firmware-eeprom="unknown"');
    expect(disconnected).toContain(
      'data-firmware-eeprom-reason="unverified-current"',
    );
    expect(disconnected).toContain('>Connect keyboard to check<');
    expect(preBoundaryEqual).toContain(
      '<li>Top-left key entry (Bootmagic) resets settings</li>',
    );

    // Real ERA State Sync pending lifecycle: initial connect, definition change, and
    // reconnect show neutral checking without terminal failure text until CONFIG settles.
    const tomakEntry = manifest.definitions.find(
      ({id}) => id === 'tomak-tkl-right',
    )!;
    const tomakDevicePath = 'tomak-pending-test';
    const tomakUsb = usbId('tomak-tkl-right');
    const tomakVpid = tomakUsb.vendorId * 0x10000 + tomakUsb.productId;
    const tomakConnectedDevice = {
      path: tomakDevicePath,
      ...tomakUsb,
      vendorProductId: tomakVpid,
      productName: 'TOMAK_R',
      protocol: 12,
      requiredDefinitionVersion: 'v3' as const,
      hasResolvedDefinition: true,
    };
    setEraAdvancedMetadataForTesting({
      schemaVersion: 2,
      definitions: [
        eraAdvancedEntry(
          {...tomakEntry, stateSync: true, exactMsFamily: 'qmk'},
          tomakVpid,
        ),
      ],
    });
    const liveStore = configureStore({
      reducer: {
        settings: settingsReducer,
        devices: devicesReducer,
        definitions: definitionsReducer,
        menus: menusReducer,
        stateSync: stateSyncReducer,
        definitionName: () => ({selectedOptionMap: {}}),
        firmware: () => ({firmwareVersionMap: {}, keycodesVersionMap: {}}),
      },
    });
    liveStore.dispatch(
      updateConnectedDevices({[tomakDevicePath]: tomakConnectedDevice} as any),
    );
    liveStore.dispatch(
      updateEraDefinitions({
        [tomakVpid]: {v3: {name: 'TOMAK_R'} as any},
      }),
    );
    const renderTomak = () => {
      const location = new URL('/firmware/sirind/tomak-tkl', 'http://localhost');
      const restoreLocation = globals({location});
      setFirmwareDataForTesting(committed);
      try {
        return renderToStaticMarkup(
          providers(
            <FirmwarePane />,
            liveStore as any,
            staticLocationHook(location.pathname),
          ),
        );
      } finally {
        restoreLocation();
      }
    };
    const commitTomakVersion = (acceptedVersion: string, generation = 1) => {
      const state = liveStore.getState();
      liveStore.dispatch(
        commitStableConfigCandidate({
          devicePath: tomakDevicePath,
          connectionGeneration: generation,
          selectionGeneration: getSelectionGeneration(state as any),
          definitionIdentity: getDefinitionSyncIdentity(
            state as any,
            tomakConnectedDevice as any,
          )!,
          revision: 1,
          mutationEpoch: 0,
          candidate: {
            menuData: {
              [ERA_FIRMWARE_VERSION_COMMAND]: ascii(acceptedVersion),
            },
          },
        }),
      );
    };
    liveStore.dispatch(
      selectDevice({
        device: tomakConnectedDevice as any,
        connectionGeneration: 1,
      }),
    );
    liveStore.dispatch(ensurePathSync({path: tomakDevicePath, generation: 1}));
    for (const capability of ['probing', 'capable'] as const) {
      liveStore.dispatch(
        setPathCapability({
          path: tomakDevicePath,
          generation: 1,
          capability,
        }),
      );
      const pendingHtml = renderTomak();
      expect(pendingHtml).toContain('data-firmware-connected="true"');
      expect(pendingHtml).toContain('data-firmware-eeprom="checking"');
      expect(pendingHtml).toContain('>Checking installed firmware…<');
      expect(pendingHtml).not.toContain('Settings retention unknown');
      expect(pendingHtml).not.toContain('role="tooltip"');
    }
    commitTomakVersion(latest);
    const settledKeepHtml = renderTomak();
    expect(settledKeepHtml).toContain('>Current<');
    expect(settledKeepHtml).toContain('data-firmware-eeprom="keep"');
    expect(settledKeepHtml).toContain('>EEPROM kept<');
    expect(settledKeepHtml).not.toContain('role="tooltip"');
    // Background reconciliation retains accepted authority without flickering to checking.
    liveStore.dispatch(markPathDirty({path: tomakDevicePath, generation: 1}));
    expect(renderTomak()).toContain('>EEPROM kept<');
    // Definition replacement returns to checking until the new context commits.
    liveStore.dispatch(
      updateEraDefinitions({
        [tomakVpid]: {v3: {name: 'TOMAK_R updated'} as any},
      }),
    );
    expect(renderTomak()).toContain('data-firmware-eeprom="checking"');
    // Valid read of withdrawn/uncatalogued 261106R1 explains missing compatibility data rather than read failure.
    commitTomakVersion(QMK_STORAGE_PLACEMENT_BOUNDARY);
    const uncataloguedHtml = renderTomak();
    expect(uncataloguedHtml).toContain(
      `Current ${QMK_STORAGE_PLACEMENT_BOUNDARY} →`,
    );
    expect(uncataloguedHtml).toContain('data-firmware-eeprom="unknown"');
    expect(uncataloguedHtml).toContain('>Settings retention unknown<');
    expect(uncataloguedHtml).toContain(
      '>Compatibility data for the installed firmware version is unavailable; settings retention cannot be determined.<',
    );
    expect(uncataloguedHtml).not.toContain(
      'Current firmware version is unavailable or unverified',
    );
    // Terminal failures (unverified capability, refused CONFIG read, locked connection) show the unavailable/unverified warning.
    for (const failTerminal of [
      () => {
        liveStore.dispatch(
          selectDevice({
            device: tomakConnectedDevice as any,
            connectionGeneration: 2,
          }),
        );
        liveStore.dispatch(
          setPathCapability({
            path: tomakDevicePath,
            generation: 2,
            capability: 'unverified',
          }),
        );
      },
      () => {
        liveStore.dispatch(
          selectDevice({
            device: tomakConnectedDevice as any,
            connectionGeneration: 3,
          }),
        );
        liveStore.dispatch(
          setPathCapability({
            path: tomakDevicePath,
            generation: 3,
            capability: 'capable',
          }),
        );
        const state = liveStore.getState();
        liveStore.dispatch(
          markDomainReadFailed({
            path: tomakDevicePath,
            generation: 3,
            domain: 'config',
            revision: 0,
            mutationEpoch: 0,
            selectionGeneration: getSelectionGeneration(state as any),
            definitionIdentity: getDefinitionSyncIdentity(
              state as any,
              tomakConnectedDevice as any,
            )!,
          }),
        );
      },
      () => {
        liveStore.dispatch(
          invalidateDeviceConnection({
            devicePath: tomakDevicePath,
            connectionGeneration: 4,
            locked: true,
          }),
        );
      },
    ]) {
      failTerminal();
      const failedHtml = renderTomak();
      expect(failedHtml).toContain('data-firmware-eeprom="unknown"');
      expect(failedHtml).toContain('>Settings retention unknown<');
      expect(failedHtml).toContain(
        '>Current firmware version is unavailable or unverified; settings retention cannot be determined.<',
      );
    }
    const broken = cloneSource();
    broken.versions.find(({version}) => version === '261019R1')!.families.qmk!.storageKey = {
      QMK_BUILDDATE: '2024-04-23-11:29:54',
      ERA_EEPROM_RESET_KEY: '0x45524199UL',
    };
    const resetting = renderPage(preBoundaryRoute, dataFor(broken), device, '261005R1');
    expect(resetting).toContain('data-firmware-eeprom="reset"');
    expect(resetting).toContain('data-firmware-eeprom-reason="key-change"');
    expect(resetting).toContain('>EEPROM reset<');

    // QMK placement boundary (261106R1) and post-boundary transitions across QMK boards.
    const withBoundary = cloneSource();
    withBoundary.versions = withBoundary.versions.filter(
      ({version}) =>
        compareEraFirmwareVersions(version, QMK_STORAGE_PLACEMENT_BOUNDARY) === -1,
    );
    const lastRelease = withBoundary.versions.at(-1)!;
    withBoundary.versions.push({
      version: QMK_STORAGE_PLACEMENT_BOUNDARY,
      families: {
        qmk: {
          storageKey: structuredClone(lastRelease.families.qmk!.storageKey),
        },
        h7s: {
          storageKey: {reset_key: '0x48375304'},
        },
      },
      files: {
        classicd: {
          'classicd-a1': {
            url: `/firmware-files/${QMK_STORAGE_PLACEMENT_BOUNDARY}/classicd/CLASSIC-D-A1-V${QMK_STORAGE_PLACEMENT_BOUNDARY}.zip`,
            size: 71343,
            sha256: '3616ad8d9cf462bc7eced1faeaff8ee20d1f77ed548772cb48a836ecaa57e260',
          },
        },
        sirind: {
          'tomak-tkl': {
            url: `/firmware-files/${QMK_STORAGE_PLACEMENT_BOUNDARY}/sirind/TOMAK-TKL-V${QMK_STORAGE_PLACEMENT_BOUNDARY}.zip`,
            size: 152553,
            sha256: '1ddfcc7d5cd25749039ff8df7ea670943e3026c6fb6677f460505d5b27d75a9d',
          },
          'brick60-h7s': {
            url: `/firmware-files/${QMK_STORAGE_PLACEMENT_BOUNDARY}/sirind/BRICK60-H7S-V${QMK_STORAGE_PLACEMENT_BOUNDARY}.zip`,
            size: 125736,
            sha256: 'ab0d5b9cd48a55ceb6a11fa5d5221566f7233575ec14ae8efa4e7e0284983032',
          },
        },
      },
    });
    withBoundary.versions.push({
      version: '261110R1',
      families: {
        qmk: {
          storageKey: structuredClone(lastRelease.families.qmk!.storageKey),
        },
      },
      files: {
        sirind: {
          'tomak-tkl': {
            url: '/firmware-files/261110R1/sirind/TOMAK-TKL-V261110R1.zip',
            size: 152553,
            sha256: '1ddfcc7d5cd25749039ff8df7ea670943e3026c6fb6677f460505d5b27d75a9d',
          },
        },
      },
    });
    const boundaryData = dataFor(withBoundary);
    const tomakHistory = getFirmwareHistory(
      boundaryData.catalog,
      'sirind',
      getFirmwareBoardInfo(boundaryData, 'tomak-tkl'),
    );
    const a1BoundaryHistory = getFirmwareHistory(
      boundaryData.catalog,
      'classicd',
      getFirmwareBoardInfo(boundaryData, 'classicd-a1'),
    );
    const h7sBoundaryHistory = getFirmwareHistory(
      boundaryData.catalog,
      'sirind',
      getFirmwareBoardInfo(boundaryData, 'brick60-h7s'),
    );
    // (1) Pre-boundary QMK (< 261106R1, catalogued or uncatalogued) -> >= 261106R1 resets EEPROM.
    for (const [boardHistory, oldVer] of [
      [tomakHistory, '261021R1'],
      [tomakHistory, '250101R1'],
      [a1BoundaryHistory, '261019R1'],
      [a1BoundaryHistory, '250101R1'],
    ] as const) {
      expect(
        classifyFirmwareTransition(
          'qmk',
          boardHistory,
          oldVer,
          QMK_STORAGE_PLACEMENT_BOUNDARY,
        ),
      ).toEqual({
        status: 'reset',
        reason: 'placement-migration',
        formatBreak: true,
      });
    }
    // (2) >= 261106R1 -> >= 261106R1 with equal keys keeps EEPROM; same-version reinstall keeps too.
    expect(
      classifyFirmwareTransition(
        'qmk',
        tomakHistory,
        QMK_STORAGE_PLACEMENT_BOUNDARY,
        '261110R1',
      ),
    ).toEqual({
      status: 'keep',
      reason: 'same-storage',
      formatBreak: false,
    });
    expect(
      classifyFirmwareTransition(
        'qmk',
        tomakHistory,
        QMK_STORAGE_PLACEMENT_BOUNDARY,
        QMK_STORAGE_PLACEMENT_BOUNDARY,
      ),
    ).toEqual({
      status: 'keep',
      reason: 'same-storage',
      formatBreak: false,
    });
    // (3) Pre-boundary -> pre-boundary with equal keys does not break the format timeline.
    expect(
      classifyFirmwareTransition('qmk', tomakHistory, '261019R1', '261021R1'),
    ).toEqual({
      status: 'unknown',
      reason: 'legacy-bootmagic',
      formatBreak: false,
    });
    // (4) QMK downgrade across 261106R1 warns about previous storage rather than claiming reset.
    expect(
      classifyFirmwareTransition(
        'qmk',
        tomakHistory,
        QMK_STORAGE_PLACEMENT_BOUNDARY,
        '261021R1',
      ),
    ).toEqual({
      status: 'unknown',
      reason: 'qmk-downgrade',
      formatBreak: true,
    });
    const downgradeHtml = renderPage(
      '/firmware/sirind/tomak-tkl?version=261021R1',
      boundaryData,
      usbId('tomak-tkl-left'),
      QMK_STORAGE_PLACEMENT_BOUNDARY,
    );
    expect(downgradeHtml).toContain('data-firmware-eeprom="unknown"');
    expect(downgradeHtml).toContain(
      'data-firmware-eeprom-reason="qmk-downgrade"',
    );
    expect(downgradeHtml).toContain(
      '>Uses the previous storage area; current settings do not carry over<',
    );
    expect(downgradeHtml).toContain(
      '<li>Uses the previous storage area; current settings do not carry over</li>',
    );
    // Timeline breaks only at the 261106R1 placement boundary, not between equal-key pre-boundary or post-boundary entries.
    expect(downgradeHtml).toContain(
      `aria-label="261021R1, ${getFirmwareHistory(boundaryData.catalog, 'sirind', getFirmwareBoardInfo(boundaryData, 'tomak-tkl')).find(({file}) => file.version === '261021R1')!.note!.en}, Uses the previous storage area; current settings do not carry over"`,
    );
    expect(downgradeHtml).toContain(
      `aria-label="${QMK_STORAGE_PLACEMENT_BOUNDARY}, Connected keyboard TOMAK TKL, Settings reset across this gap"`,
    );
    expect(downgradeHtml).toContain('aria-label="261110R1"');
    const preBoundaryTimelineHtml = renderPage(
      '/firmware/sirind/tomak-tkl?version=261019R1',
      boundaryData,
      usbId('tomak-tkl-left'),
      '261005R1',
    );
    expect(preBoundaryTimelineHtml).toContain(
      `aria-label="261021R1, ${getFirmwareHistory(boundaryData.catalog, 'sirind', getFirmwareBoardInfo(boundaryData, 'tomak-tkl')).find(({file}) => file.version === '261021R1')!.note!.en}, Top-left key entry (Bootmagic) resets settings"`,
    );
    expect(preBoundaryTimelineHtml).toContain(
      `aria-label="${QMK_STORAGE_PLACEMENT_BOUNDARY}, Resets settings, Settings reset across this gap"`,
    );
    // (5) H7S uses key comparison only: uncatalogued old version is unknown, unequal key resets.
    expect(
      classifyFirmwareTransition(
        'h7s',
        h7sBoundaryHistory,
        '250101R1',
        QMK_STORAGE_PLACEMENT_BOUNDARY,
      ),
    ).toEqual({
      status: 'unknown',
      reason: 'unverified-current',
      formatBreak: null,
    });
    expect(
      classifyFirmwareTransition(
        'h7s',
        h7sBoundaryHistory,
        '261015R1',
        QMK_STORAGE_PLACEMENT_BOUNDARY,
      ),
    ).toEqual({
      status: 'reset',
      reason: 'key-change',
      formatBreak: true,
    });
    // (6) Legacy VID 0x4552 without a read VERSION never guesses a version.
    const legacyUnverified = renderPage(
      '/firmware/sirind/tomak-tkl',
      boundaryData,
      usbId('tomak-tkl-left', true),
    );
    expect(legacyUnverified).toContain('data-firmware-eeprom="unknown"');
    expect(legacyUnverified).toContain(
      'data-firmware-eeprom-reason="unverified-current"',
    );
    // (7) Reset recovery option always initializes even when normal firmware keeps EEPROM.
    expect(
       getFirmwareEepromStatus(
        'qmk',
        tomakHistory,
        QMK_STORAGE_PLACEMENT_BOUNDARY,
        '261110R1',
        {resetImage: true},
      ),
    ).toBe('reset');
  } finally {
    restore();
  }
});

test('an unknown firmware reason uses the common click-to-expand help', () => {
  setFirmwareDataForTesting(committed);
  const page = mountPage(
    '/firmware/classicd/classicd-a1?version=261019R1',
    usbId('classicd-a1'),
  );
  try {
    const renderer = page.renderer;
    const info = () => renderer.root.find(
      (node) =>
        node.type === 'button' &&
        node.props['aria-label'] === 'What this means: Settings retention unknown',
    );
    const explanation = () => renderer.root.find(
      (node) =>
        node.type === 'div' && node.props.id === info().props['aria-controls'],
    );
    const reason =
      'Compatibility data for the installed firmware version is unavailable; settings retention cannot be determined.';
    expect(text(info())).toBe('i');
    expect(info().props['aria-expanded']).toBe(false);
    expect(explanation().props.hidden).toBe(true);
    expect(text(explanation())).toBe(reason);
    expect(text(renderer.root).split(reason)).toHaveLength(2);
    const fileBox = renderer.root.find(
      (node) =>
        node.type === 'div' && node.props['data-firmware-file'] === 'published',
    );
    expect(fileBox.findAll(
      (node) => node.type === 'div' && node.props.id === info().props['aria-controls'],
    )).toHaveLength(1);
    expect(text(renderer.root)).toContain(
      'Keyboard settings may reset after updating. Save them in the "Save + Load" menu.',
    );

    act(() => info().props.onClick());
    expect(info().props['aria-expanded']).toBe(true);
    expect(explanation().props.hidden).toBe(false);
    act(() => info().props.onClick());
    expect(info().props['aria-expanded']).toBe(false);
    expect(explanation().props.hidden).toBe(true);
    expect(text(renderer.root).split(reason)).toHaveLength(2);
  } finally {
    page.close();
  }
});

test('the collapsed version control opens history and selecting a release changes the download', () => {
  setFirmwareDataForTesting(committed);
  const page = mountPage('/firmware/classicd/classicd-a1');
  try {
    const toggle = () =>
      page.renderer.root.find(
        (node) =>
          node.type === 'button' && node.props.title === 'Firmware versions',
      );
    expect(toggle().props['aria-expanded']).toBe(false);
    act(() => toggle().props.onClick());
    expect(toggle().props['aria-expanded']).toBe(true);
    const history = getFirmwareHistory(
      committed.catalog,
      'classicd',
      getFirmwareBoardInfo(committed, 'classicd-a1'),
    );
    for (const {file} of history) {
      const choice = page.renderer.root.find(
        (node) =>
          node.type === 'button' &&
          (node.props['aria-label'] ?? '').split(', ')[0] === file.version,
      );
      act(() => choice.props.onClick());
      expect(page.location.search).toBe(`?version=${file.version}`);
      expect(anchor(page.renderer.root, file.url).props.download).toBe(
        path.basename(file.url),
      );
      expect(text(page.renderer.root)).toContain(file.sha256);
      expect(choice.props['aria-pressed']).toBe(true);
    }
    act(() => toggle().props.onClick());
    expect(toggle().props['aria-expanded']).toBe(false);
  } finally {
    page.close();
  }
});

test('navigation opens details before downloading and disconnecting preserves the board URL', () => {
  setFirmwareDataForTesting(committed);
  const connected = mountPage('/firmware', usbId('classicd-a1'));
  try {
    expect(connected.location.pathname).toBe('/firmware/classicd/classicd-a1');
    const file = committed.catalog.makers
      .find(({id}) => id === 'classicd')!
      .boards.find(({board}) => board === 'classicd-a1')!.file!;
    act(() => connected.store.dispatch({type: 'test/disconnect'}));
    expect(anchor(connected.renderer.root, file.url).props.download).toBe(
      path.basename(file.url),
    );
    expect(connected.location.pathname).toBe('/firmware/classicd/classicd-a1');
  } finally {
    connected.close();
  }
  const page = mountPage('/firmware/linworks', usbId('classicd-a1'));
  try {
    const href = '/firmware/linworks/n86';
    const link = page.renderer.root.find(
      (node) =>
        node.type === 'a' &&
        node.props.href === href &&
        text(node) === 'Download',
    );
    expect(link.props.download).toBeUndefined();
    for (const modifiers of [{ctrlKey: true}, {metaKey: true}, {button: 1}]) {
      let prevented = false;
      act(() =>
        link.props.onClick({
          button: 0,
          ...modifiers,
          preventDefault: () => {
            prevented = true;
          },
        }),
      );
      expect(prevented).toBe(false);
      expect(page.calls).toEqual([]);
    }
    act(() => link.props.onClick({button: 0, preventDefault() {}}));
    expect(page.location.pathname).toBe(href);
    const file = committed.catalog.makers
      .find(({id}) => id === 'linworks')!
      .boards.find(({board}) => board === 'n86')!.file!;
    expect(anchor(page.renderer.root, file.url).props.onClick).toBeUndefined();
  } finally {
    page.close();
  }
});

test('choosing or authorizing a device selects it and routes its identity without changing anything on cancellation', async () => {
  const calls: string[] = [];
  const restore = globals({
    navigator: {hid: {}},
    history: {
      pushState: (_state: unknown, _title: string, to: string) =>
        calls.push(to),
    },
  });
  setFirmwareDataForTesting(committed);
  const store = makeStore();
  const dispatch = spyOn(store, 'dispatch').mockImplementation(
    () => undefined as any,
  );
  const select = spyOn(deviceThunks, 'selectConnectedDeviceByPath')
    .mockImplementation(() => () => undefined);
  const request = spyOn(HID, 'requestDevice');
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(providers(<FirmwareDevice />, store));
  });
  const authorize = async () =>
    act(async () => {
      await renderer.root
        .find(
          (node) => node.type === 'button' && text(node) === 'Authorize device',
        )
        .props.onClick();
    });
  try {
    const identities = [
      ...manifest.definitions.flatMap(getManifestEntryIdentities),
      ...(manifest.downloadOnlyIdentities ?? []),
    ];
    for (const identity of identities) {
      const device = {
        vendorId: Number(identity.vendorId),
        productId: Number(identity.productId),
      };
      const resolved = resolveFirmwareIdentity(
        committed,
        device.vendorId,
        device.productId,
      );
      if (!resolved) continue;
      request.mockResolvedValue({
        ...device,
        __path: 'authorized-keyboard',
      } as any);
      await authorize();
      expect(select).toHaveBeenLastCalledWith('authorized-keyboard');
      expect(dispatch).toHaveBeenLastCalledWith(
        select.mock.results.at(-1)!.value,
      );
      expect(calls.at(-1)).toBe(
        resolved.makers.length === 1
          ? getFirmwarePath(resolved.makers[0].id, resolved.board.id)
          : '/firmware',
      );
    }
    const count = calls.length;
    const dispatchCount = dispatch.mock.calls.length;
    const selectionCount = select.mock.calls.length;
    request.mockResolvedValue(undefined as any);
    await authorize();
    expect(calls).toHaveLength(count);
    expect(dispatch).toHaveBeenCalledTimes(dispatchCount);
    expect(select).toHaveBeenCalledTimes(selectionCount);
    request.mockRejectedValue(new DOMException('Cancelled', 'NotFoundError'));
    await authorize();
    expect(calls).toHaveLength(count);
    expect(dispatch).toHaveBeenCalledTimes(dispatchCount);
    expect(select).toHaveBeenCalledTimes(selectionCount);
    request.mockResolvedValue({
      vendorId: 1,
      productId: 2,
      __path: 'unknown',
    } as any);
    await authorize();
    expect(calls).toHaveLength(count);

    const selectedState = makeStore(usbId('classicd-a1')).getState();
    const otherState = makeStore(usbId('n86')).getState();
    const otherDevice = Object.values(
      otherState.devices.connectedDevicePaths,
    )[0];
    const switchingStore = configureStore({
      reducer: () => ({
        ...selectedState,
        definitions: {
          ...selectedState.definitions,
          definitions: {
            ...selectedState.definitions.definitions,
            [otherDevice.vendorProductId]: {v3: {name: 'Connected N86'}},
          },
        },
        devices: {
          ...selectedState.devices,
          connectedDevicePaths: {
            ...selectedState.devices.connectedDevicePaths,
            'connected-n86': {...otherDevice, path: 'connected-n86'},
          },
        },
      }),
    });
    const switchingDispatch = spyOn(switchingStore, 'dispatch')
      .mockImplementation(() => undefined as any);
    try {
      act(() => renderer.unmount());
      act(() => {
        renderer = create(providers(<FirmwareDevice />, switchingStore));
      });
      for (const [label, devicePath, destination] of [
        ['Connected N86', 'connected-n86', '/firmware/linworks/n86'],
        [
          'Authorize New',
          'new-keyboard',
          '/firmware/classicd/classicd-a1',
        ],
      ]) {
        request.mockResolvedValue({
          ...usbId('classicd-a1'),
          __path: 'new-keyboard',
        } as any);
        select.mockClear();
        switchingDispatch.mockClear();
        const routeCount = calls.length;
        act(() =>
          renderer.root.find(
            (node) =>
              node.type === 'button' &&
              node.props['aria-expanded'] === false,
          ).props.onClick(),
        );
        await act(async () =>
          renderer.root.find(
            (node) => node.type === 'button' && text(node) === label,
          ).props.onClick(),
        );
        expect(select).toHaveBeenCalledTimes(1);
        expect(select).toHaveBeenCalledWith(devicePath);
        expect(switchingDispatch).toHaveBeenCalledTimes(1);
        expect(switchingDispatch).toHaveBeenCalledWith(
          select.mock.results[0].value,
        );
        expect(calls).toHaveLength(routeCount + 1);
        expect(calls.at(-1)).toBe(destination);
      }
    } finally {
      switchingDispatch.mockRestore();
    }
  } finally {
    act(() => renderer.unmount());
    dispatch.mockRestore();
    select.mockRestore();
    request.mockRestore();
    restore();
  }
});

test('published maker links retain crawler metadata and ZIPs bypass the app cache', () => {
  const shell = readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const template = readFileSync(path.join(repoRoot, 'public/_redirects'), 'utf8');
  const redirects = toFirmwareShareRedirects(
    template,
    source.makers,
  );
  const rules = redirects.split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([route]) => route.startsWith('/'));
  const fallback = rules.findIndex(([route]) => route === '/firmware/*');
  expect(fallback).toBeGreaterThanOrEqual(0);
  expect(rules[fallback]).toEqual(['/firmware/*', '/firmware-app', '200']);
  expect(rules).toContainEqual(['/firmware', '/firmware-app', '200']);
  for (const maker of source.makers) {
    expect(toFirmwareSharePage(shell, maker.name)).toContain(
      `${maker.name} — Firmware`,
    );
    const destination = `/${getMakerSharePage(maker.id).replace(/\.html$/, '')}`;
    for (const route of [`/firmware/${maker.id}`, `/firmware/${maker.id}/*`]) {
      const index = rules.findIndex(([from]) => from === route);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(fallback);
      expect(rules[index]).toEqual([route, destination, '200']);
    }
  }
  for (const [name, escaped] of [
    ['A & B', 'A &amp; B'],
    ['<Maker>', '&lt;Maker&gt;'],
    ['"Maker"', '&quot;Maker&quot;'],
  ]) {
    const page = toFirmwareSharePage(shell, name);
    expect(page).toContain(`<title>${escaped} — Firmware</title>`);
    expect(page).toContain(`content="${escaped} — Firmware"`);
  }
  for (const id of ['', '../escape', 'maker/name', '/absolute', 'maker name', 'Maker']) {
    expect(() => getMakerSharePage(id)).toThrow('invalid maker id');
    expect(() => toFirmwareShareRedirects(template, [{id}]))
      .toThrow('invalid maker id');
  }
  for (const invalid of [
    '/firmware /firmware-app 200',
    '/firmware/* /index.html 200',
    '/firmware/* /firmware-app.html 200',
  ]) {
    expect(() => toFirmwareShareRedirects(invalid, source.makers))
      .toThrow('generic rewrite not found');
  }
  const headers = readFileSync(path.join(repoRoot, 'public/_headers'), 'utf8');
  const firmwareHeaders = headers.match(
    /^\/firmware-files\/\*\r?\n((?:[ \t]+[^\r\n]*\r?\n?)+)/m,
  )?.[1];
  expect(firmwareHeaders).toBeDefined();
  expect(firmwareHeaders).toMatch(
    /^[ \t]+Cache-Control: no-store[ \t]*$/m,
  );
});
