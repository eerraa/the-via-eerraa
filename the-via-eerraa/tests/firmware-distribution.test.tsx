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
  type FirmwareCatalogSource,
  type FirmwareData,
  type FirmwareManifest,
  formatFirmwareFileSize,
  getBoardDefinitions,
  getFirmwareBoardInfo,
  getFirmwareHistory,
  getFirmwareUpdateStatus,
  getManifestEntryIdentities,
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

afterEach(() => setFirmwareDataForTesting(null));

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
          expect(image.endsWith(`-V${release.version}.uf2`)).toBe(true);
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
  value.versions = value.versions.map((release) => ({
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
  value.versions = value.versions.map((release) => ({
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
    update: {version: latest},
  });
  const mixed = cloneSource();
  delete mixed.versions.at(-1)!.files.linworks.n86;
  expect(getFirmwareUpdateStatus(dataFor(mixed), shared)).toMatchObject({
    kind: 'choose-maker',
    update: {version: null},
  });
  expect(
    getFirmwareUpdateStatus(dataFor(mixed), {...shared, version: latest}),
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
        for (const maker of withheld) delete release.files[maker].n86;
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
      `New version ${latest}`,
      true,
    ],
    [
      usbId('classicd-a1'),
      latest,
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
      `Latest ${latest}`,
      false,
    ],
    [
      usbId('n86', true),
      '250101R1',
      committed,
      '/firmware',
      `Latest ${latest}`,
      true,
    ],
    [
      usbId('classicd-a1'),
      latest,
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

test('a connected keyboard’s page names it once, its VERSION leading into the file', () => {
  const restore = globals({navigator: {}});
  try {
    const route = '/firmware/classicd/classicd-a1';
    const device = usbId('classicd-a1');
    const {name} = getFirmwareBoardInfo(committed, 'classicd-a1');
    const named = (html: string) => html.split(`>${name}<`).length - 1;
    const outdated = renderPage(route, committed, device, '250101R1');
    expect(named(outdated)).toBe(1);
    expect(outdated).toContain('data-firmware-connected="true"');
    expect(outdated).toContain('Current 250101R1 →');
    const current = renderPage(route, committed, device, latest);
    expect(named(current)).toBe(1);
    expect(current).toContain('>Current<');
    expect(current).not.toContain(`Current ${latest}`);
    // A VERSION that makes no claim marks the keyboard but shows no version.
    const unclaimed = renderPage(route, committed, device, 'bad');
    expect(unclaimed).toContain('data-firmware-connected="true"');
    expect(unclaimed).not.toContain('>Current');
    expect(renderPage(route)).not.toContain('data-firmware-connected');
  } finally {
    restore();
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
