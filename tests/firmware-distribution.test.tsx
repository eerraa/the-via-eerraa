import {afterEach, describe, expect, spyOn, test} from 'bun:test';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {configureStore} from '@reduxjs/toolkit';
import i18n from 'i18next';
import {useSyncExternalStore} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ServerStyleSheet} from 'styled-components';
import {I18nextProvider} from 'react-i18next';
import {Provider} from 'react-redux';
import {act, create, type ReactTestInstance} from 'react-test-renderer';
import {Router} from 'wouter';
import staticLocationHook from 'wouter/static-location';
import {
  type FirmwareCatalog,
  type FirmwareData,
  type FirmwareFile,
  type FirmwareManifest,
  getFirmwareUpdateStatus,
  readRememberedMaker,
  rememberMaker,
  resolveFirmwareIdentity,
  sortMakersForDisplay,
  validateFirmwareCatalog,
} from '../src/utils/era-firmware-catalog';
import {
  compareEraFirmwareVersions,
  ERA_FIRMWARE_VERSION_COMMAND,
  getEraFirmwareReleaseDate,
} from '../src/utils/era-firmware-version';
import {
  getFirmwarePath,
  getPageTitle,
  isFirmwarePath,
  parseFirmwarePath,
  resolveFirmwareRoute,
} from '../src/utils/firmware-route';
import {
  FIRMWARE_SHARE_DESCRIPTION,
  FIRMWARE_SHARE_TITLE,
  getMakerSharePage,
  toFirmwareSharePage,
  toFirmwareShareRedirects,
} from '../scripts/firmware-share-page';
import {
  validateFirmwareCatalogAt,
  validateFirmwareCatalogFiles,
} from '../scripts/validate-firmware-catalog';

// ADR 0004: catalog validation, identity resolution, version comparison, and
// the VERSION row and firmware page in their published and not-yet-published
// states. Component renders are static, as in custom-menu-pane.test.tsx.

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

const repoRoot = path.join(import.meta.dir, '..');
const readJSON = <T,>(relative: string): T =>
  JSON.parse(readFileSync(path.join(repoRoot, relative), 'utf8'));

const committed: FirmwareData = {
  catalog: readJSON<FirmwareCatalog>('config/firmware-catalog.json'),
  manifest: readJSON<FirmwareManifest>('config/era-definitions.manifest.json'),
};
const clone = (data: FirmwareData): FirmwareData =>
  JSON.parse(JSON.stringify(data));

/** Publication scenarios stay explicit when the shipped catalog gains releases. */
const unpublishedData = (): FirmwareData => {
  const data = clone(committed);
  data.catalog.makers.forEach((maker) =>
    maker.boards.forEach((board) => { board.file = null; }),
  );
  return data;
};

/** The identity current firmware reports, or with `legacy` the shared 0x4552 one. */
const usbId = (definitionId: string, served: 'current' | 'legacy' = 'current') => {
  const entry = committed.manifest.definitions.find(
    ({id}) => id === definitionId,
  );
  if (!entry) {
    throw new Error(`no manifest definition ${definitionId}`);
  }
  const identity = served === 'legacy' ? entry.legacy : entry;
  if (!identity) {
    throw new Error(`manifest definition ${definitionId} has no legacy identity`);
  }
  return {
    vendorId: Number.parseInt(identity.vendorId, 16),
    productId: Number.parseInt(identity.productId, 16),
  };
};

const makersOf = (data: FirmwareData, boardId: string) =>
  data.catalog.makers
    .filter((maker) => maker.boards.some(({board}) => board === boardId))
    .map(({id}) => id)
    .sort();

const publishedFile = (
  maker: string,
  version: string,
  name: string,
): FirmwareFile => ({
  version,
  url: `/firmware-files/${version}/${maker}/${name}`,
  size: 65628,
  sha256: 'a'.repeat(64),
});

/** The committed membership with some files published, for the stateful paths. */
const published = (): FirmwareData => {
  const data = unpublishedData();
  const publish = (makerId: string, boardId: string, file: FirmwareFile) => {
    const entry = data.catalog.makers
      .find(({id}) => id === makerId)!
      .boards.find(({board}) => board === boardId)!;
    entry.file = file;
  };
  publish('classicd', 'classicd-a1', publishedFile('classicd', '260916R1', 'CLASSICD_A1-V260916R1.zip'));
  publish('sirind', 'n86', publishedFile('sirind', '260916R1', 'N86-V260916R1.zip'));
  publish('linworks', 'n86', publishedFile('linworks', '260916R1', 'N86-V260916R1.zip'));
  publish('sirind', 'tomak-tkl', publishedFile('sirind', '260916R1', 'TOMAK-TKL-V260916R1.zip'));
  publish('sirind', 'brick60-h7s', publishedFile('sirind', '260913R1', 'BRICK60-H7S-V260913R1.zip'));
  return data;
};

/** N86 published by all three of its makers: KEYNETIX, LINWORKS, SR Industry. */
const everyMakerPublished = (...versions: [string, string, string]) => {
  const data = unpublishedData();
  ['keynetix', 'linworks', 'sirind'].forEach((makerId, index) => {
    data.catalog.makers
      .find(({id}) => id === makerId)!
      .boards.find(({board}) => board === 'n86')!.file = publishedFile(
      makerId,
      versions[index],
      `N86-V${versions[index]}.zip`,
    );
  });
  return data;
};

afterEach(() => {
  for (const board of ['n86', 'n87', 'n8x']) {
    rememberMaker(board, null);
  }
});

test('a failed maker storage write or removal overrides stale storage for this page', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!;
  const storage = globalThis.localStorage;
  storage.setItem('era-firmware-maker:n86', 'linworks');
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {
    getItem: (key: string) => storage.getItem(key),
    setItem: () => { throw new Error('Storage full'); },
    removeItem: () => { throw new Error('Storage blocked'); },
  }});
  try {
    rememberMaker('n86', 'sirind');
    expect(readRememberedMaker('n86')).toBe('sirind');
    rememberMaker('n86', null);
    expect(readRememberedMaker('n86')).toBeNull();
    expect(storage.getItem('era-firmware-maker:n86')).toBe('linworks');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', descriptor);
  }
  rememberMaker('n86', 'keynetix');
  expect(readRememberedMaker('n86')).toBe('keynetix');
  expect(storage.getItem('era-firmware-maker:n86')).toBe('keynetix');
});

describe('firmware catalog', () => {
  test('the committed catalog passes the build validation', async () => {
    expect(validateFirmwareCatalog(committed)).toEqual([]);
    expect(await validateFirmwareCatalogAt(repoRoot)).toEqual([]);
  });

  test('every board is an ERA manifest definition or split pair, and brick65 is never listed', () => {
    const manifestBoards = new Set(
      committed.manifest.definitions.map((entry) => entry.pair ?? entry.id),
    );
    for (const board of committed.catalog.boards) {
      expect({board: board.id, known: manifestBoards.has(board.id)}).toEqual({
        board: board.id,
        known: true,
      });
    }
    expect(committed.catalog.boards.map(({id}) => id)).not.toContain('brick65');
    expect(makersOf(committed, 'brick65')).toEqual([]);
    const brick65 = usbId('brick65');
    expect(
      resolveFirmwareIdentity(committed, brick65.vendorId, brick65.productId),
    ).toBeNull();
  });

  test('makers are unique and list each board once', () => {
    const makerIds = committed.catalog.makers.map(({id}) => id);
    expect(new Set(makerIds).size).toBe(makerIds.length);
    for (const maker of committed.catalog.makers) {
      const boards = maker.boards.map(({board}) => board);
      expect({maker: maker.id, unique: new Set(boards).size === boards.length}).toEqual({
        maker: maker.id,
        unique: true,
      });
    }
    // The N-series is one product distributed by three makers.
    for (const board of ['n8x', 'n86', 'n87']) {
      expect(makersOf(committed, board)).toEqual(['keynetix', 'linworks', 'sirind']);
    }
    expect(makersOf(committed, 'tomak-tkl')).toEqual(['sirind']);
  });

  test('rejects entries that break ADR 0004 §5', () => {
    const errorsFor = (mutate: (data: FirmwareData) => void) => {
      const data = clone(committed);
      mutate(data);
      return validateFirmwareCatalog(data).join('\n');
    };
    const sirind = (data: FirmwareData) =>
      data.catalog.makers.find(({id}) => id === 'sirind')!;

    expect(
      errorsFor((data) => {
        data.catalog.boards.push({id: 'brick65', name: 'BRICK65'});
        sirind(data).boards.push({board: 'brick65', file: null});
      }),
    ).toContain('not an ERA identity');
    expect(
      errorsFor((data) => sirind(data).boards.push({board: 'n86', file: null})),
    ).toContain('sirind/n86 is listed twice');
    expect(
      errorsFor((data) => sirind(data).boards.push({board: 'missing', file: null})),
    ).toContain('undeclared board');
    expect(
      errorsFor((data) => {
        sirind(data).vendorId = '0x4552';
      }),
    ).toContain('outside the maker block');
    expect(
      errorsFor((data) => {
        sirind(data).vendorId = '0x4500';
      }),
    ).toContain("repeats another maker's VID");
    expect(
      errorsFor((data) => {
        sirind(data).boards[0].file = {
          version: 'V260916R1',
          url: '/firmware-files/260916R1/sirind/DIVINE-V260916R1.zip',
          size: 1,
          sha256: 'a'.repeat(64),
        };
      }),
    ).toContain('version is not a VERSION token');
    const badFile = errorsFor((data) => {
      sirind(data).boards[0].file = {
        version: '260916R1',
        url: '/firmware/sirind/DIVINE-V260916R1.zip',
        size: 0,
        sha256: 'XYZ',
      };
    });
    expect(badFile).toContain('url must be a ZIP under /firmware-files/260916R1/sirind/');
    expect(badFile).toContain('size must be a positive byte count');
    expect(badFile).toContain('sha256 must be 64 lowercase hex digits');
  });

  test('a published file must exist with the recorded size and SHA-256', async () => {
    const publicRoot = mkdtempSync(path.join(os.tmpdir(), 'era-firmware-'));
    try {
      const bytes = Buffer.from('uf2 zip stand-in');
      const url = '/firmware-files/260916R1/sirind/N86-V260916R1.zip';
      mkdirSync(path.join(publicRoot, 'firmware-files/260916R1/sirind'), {
        recursive: true,
      });
      writeFileSync(path.join(publicRoot, url), bytes);
      const withFile = (file: Partial<FirmwareFile>) => {
        const data = unpublishedData();
        data.catalog.makers
          .find(({id}) => id === 'sirind')!
          .boards.find(({board}) => board === 'n86')!.file = {
          version: '260916R1',
          url,
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          ...file,
        };
        return data;
      };

      expect(validateFirmwareCatalog(withFile({}))).toEqual([]);
      expect(await validateFirmwareCatalogFiles(withFile({}), publicRoot)).toEqual([]);
      expect(
        (await validateFirmwareCatalogFiles(withFile({size: 1}), publicRoot)).join('\n'),
      ).toContain('catalog records 1');
      expect(
        (
          await validateFirmwareCatalogFiles(
            withFile({sha256: 'b'.repeat(64)}),
            publicRoot,
          )
        ).join('\n'),
      ).toContain('SHA-256 does not match');
      expect(
        (
          await validateFirmwareCatalogFiles(
            withFile({url: '/firmware-files/260916R1/sirind/N87-V260916R1.zip'}),
            publicRoot,
          )
        ).join('\n'),
      ).toContain('file is missing');
    } finally {
      rmSync(publicRoot, {recursive: true, force: true});
    }
  });
});

describe('maker display order', () => {
  test('is alphabetical by display name with COMMON last', () => {
    expect(
      sortMakersForDisplay(committed.catalog.makers).map(({name}) => name),
    ).toEqual(['CLASSIC.D', 'KEYNETIX', 'LINWORKS', 'NEWONE', 'SR Industry', 'COMMON']);
  });

  test('places a new maker by name, ignoring case and board count', () => {
    const makers = [
      {id: 'common', name: 'COMMON', boards: []},
      {id: 'zeta', name: 'zeta works', boards: []},
      {id: 'big', name: 'Big', boards: new Array(40).fill({board: 'x', file: null})},
      {id: 'aardvark', name: 'aardvark', boards: []},
    ];
    expect(sortMakersForDisplay(makers).map(({id}) => id)).toEqual([
      'aardvark',
      'big',
      'zeta',
      'common',
    ]);
  });
});

describe('connected keyboard identity', () => {
  test('a legacy identity of a one-maker board resolves straight to that maker', () => {
    const {vendorId, productId} = usbId('classicd-a1', 'legacy');
    const identity = resolveFirmwareIdentity(committed, vendorId, productId);
    expect(identity?.board).toMatchObject({id: 'classicd-a1', family: 'qmk', split: false});
    expect(identity?.makers.map(({id}) => id)).toEqual(['classicd']);
  });

  test('both split halves resolve to one product', () => {
    for (const half of ['tomak-tkl-left', 'tomak-tkl-right']) {
      const {vendorId, productId} = usbId(half);
      const identity = resolveFirmwareIdentity(committed, vendorId, productId);
      expect(identity?.board).toMatchObject({id: 'tomak-tkl', split: true});
      expect(identity?.makers.map(({id}) => id)).toEqual(['sirind']);
    }
  });

  test('a legacy shared N-series board resolves to every maker that distributes it', () => {
    const {vendorId, productId} = usbId('n86', 'legacy');
    const identity = resolveFirmwareIdentity(committed, vendorId, productId);
    expect(identity?.makers.map(({id}) => id)).toEqual(['keynetix', 'linworks', 'sirind']);
  });

  test('an unknown identity resolves to nothing', () => {
    expect(resolveFirmwareIdentity(committed, 0x1234, 0x5678)).toBeNull();
  });

  test('each maker identity of a shared board resolves to that maker', () => {
    for (const [vendorId, productId, maker] of [
      [0x4501, 0x0006, 'sirind'],
      [0x4502, 0x0002, 'linworks'],
      [0x4504, 0x0002, 'keynetix'],
    ] as const) {
      const identity = resolveFirmwareIdentity(committed, vendorId, productId);
      expect(identity?.board.id).toBe('n86');
      expect(identity?.makers.map(({id}) => id)).toEqual([maker]);
    }
  });

  test('a current identity resolves to its maker without a choice', () => {
    const {vendorId, productId} = usbId('classicd-a1');
    expect(
      resolveFirmwareIdentity(committed, vendorId, productId)?.makers.map(({id}) => id),
    ).toEqual(['classicd']);
  });
});

describe('VERSION comparison', () => {
  test('orders builds by date, then revision', () => {
    expect(compareEraFirmwareVersions('260913R1', '260916R1')).toBe(-1);
    expect(compareEraFirmwareVersions('260916R1', '260916R2')).toBe(-1);
    expect(compareEraFirmwareVersions('261001R1', '260930R9')).toBe(1);
    expect(compareEraFirmwareVersions('260916R1', 'V260916R1')).toBe(0);
    expect(compareEraFirmwareVersions('260916R1', 'dev')).toBeNull();
    expect(compareEraFirmwareVersions('261316R1', '260916R1')).toBeNull();
    expect(getEraFirmwareReleaseDate('260916R1')).toBe('2026-09-16');
    expect(getEraFirmwareReleaseDate('garbage')).toBeNull();
  });
});

describe('update status', () => {
  const statusFor = (
    data: FirmwareData,
    definitionId: string,
    version: string | null,
    served: 'current' | 'legacy' = 'current',
  ) =>
    getFirmwareUpdateStatus(data, {
      ...usbId(definitionId, served),
      version,
      rememberedMaker: readRememberedMaker,
    });

  test('compares the keyboard version with the maker file', () => {
    const data = published();
    expect(statusFor(data, 'classicd-a1', '260913R1').kind).toBe('update-available');
    expect(statusFor(data, 'classicd-a1', '260916R1').kind).toBe('up-to-date');
    expect(statusFor(data, 'classicd-a1', '261001R1').kind).toBe('up-to-date');
    // A missing or malformed version makes no claim.
    expect(statusFor(data, 'classicd-a1', null).kind).toBe('no-claim');
    expect(statusFor(data, 'classicd-a1', 'dev').kind).toBe('no-claim');
    expect(statusFor(data, 'tomak-tkl-right', '260913R1').kind).toBe('update-available');
  });

  test('asks which maker sold a shared board, then remembers the answer', () => {
    const data = published();
    const ask = statusFor(data, 'n86', '260913R1', 'legacy');
    expect(ask.kind).toBe('choose-maker');
    expect('makers' in ask && ask.makers.map(({id}) => id)).toEqual([
      'keynetix',
      'linworks',
      'sirind',
    ]);
    rememberMaker('n86', 'linworks');
    const chosen = statusFor(data, 'n86', '260913R1', 'legacy');
    expect(chosen.kind).toBe('update-available');
    expect('maker' in chosen && chosen.maker?.id).toBe('linworks');
    rememberMaker('n86', 'keynetix');
    expect(statusFor(data, 'n86', '260913R1', 'legacy').kind).toBe('unpublished');
  });

  // The maker is still asked, never guessed: the update only counts when it
  // holds whichever maker sold the keyboard.
  test('a shared board is due an update when every maker has a newer file', () => {
    expect(
      statusFor(everyMakerPublished('260916R1', '260916R1', '260916R1'), 'n86', '260913R1', 'legacy'),
    ).toMatchObject({kind: 'choose-maker', update: {version: '260916R1'}});
    // Makers on different versions: an update, but no single number.
    expect(
      statusFor(everyMakerPublished('260916R1', '260917R1', '260916R1'), 'n86', '260913R1', 'legacy'),
    ).toMatchObject({kind: 'choose-maker', update: {version: null}});

    const noClaim = [
      // One maker's file is not newer.
      statusFor(everyMakerPublished('260916R1', '260913R1', '260916R1'), 'n86', '260913R1', 'legacy'),
      // KEYNETIX has no file.
      statusFor(published(), 'n86', '260913R1', 'legacy'),
      // VERSION could not be read.
      statusFor(everyMakerPublished('260916R1', '260916R1', '260916R1'), 'n86', null, 'legacy'),
    ];
    for (const status of noClaim) {
      expect(status.kind).toBe('choose-maker');
      expect('update' in status).toBe(false);
    }

    // A remembered maker is compared on its own.
    rememberMaker('n86', 'linworks');
    expect(
      statusFor(everyMakerPublished('260916R1', '260913R1', '260916R1'), 'n86', '260913R1', 'legacy')
        .kind,
    ).toBe('up-to-date');
  });

  test('a listed board without a published file makes no version claim', () => {
    const classic = statusFor(unpublishedData(), 'classicd-a1', '260913R1');
    expect(classic.kind).toBe('unpublished');
    expect('maker' in classic && classic.maker?.id).toBe('classicd');
    const shared = statusFor(unpublishedData(), 'n86', '260913R1', 'legacy');
    expect(shared.kind).toBe('unpublished');
    expect('maker' in shared && shared.maker).toBeNull();
    expect(
      getFirmwareUpdateStatus(unpublishedData(), {
        vendorId: 0x1234,
        productId: 0x5678,
        version: '260913R1',
      }).kind,
    ).toBe('not-distributed');
  });
});

describe('firmware routes', () => {
  test('public/_redirects rewrites the firmware routes to the firmware shell', () => {
    const redirects = readFileSync(path.join(repoRoot, 'public/_redirects'), 'utf8');
    expect(redirects).toMatch(/^\/firmware\s+\/firmware-app\s+200$/m);
    expect(redirects).toMatch(/^\/firmware\/\*\s+\/firmware-app\s+200$/m);
    // Files are served outside the route prefix, so no rewrite can shadow one.
    expect(redirects).not.toMatch(/^\/firmware-files/m);
  });

  test('parses and builds maker and board paths', () => {
    expect(isFirmwarePath('/firmware')).toBe(true);
    expect(isFirmwarePath('/firmware/sirind/n86')).toBe(true);
    expect(isFirmwarePath('/firmware-files/x.zip')).toBe(false);
    expect(isFirmwarePath('/firmwarex')).toBe(false);
    expect(parseFirmwarePath('/firmware')).toEqual({maker: null, board: null});
    expect(parseFirmwarePath('/firmware/sirind')).toEqual({maker: 'sirind', board: null});
    expect(parseFirmwarePath('/firmware/sirind/n86/')).toEqual({maker: 'sirind', board: 'n86'});
    expect(parseFirmwarePath('/settings')).toBeNull();
    expect(getFirmwarePath()).toBe('/firmware');
    expect(getFirmwarePath('sirind')).toBe('/firmware/sirind');
    expect(getFirmwarePath('sirind', 'n86')).toBe('/firmware/sirind/n86');
  });

  const resolve = (location: string, remembered: string | null = null) => {
    const route = resolveFirmwareRoute(
      parseFirmwarePath(location)!,
      committed.catalog.makers,
      () => remembered,
    );
    return route.view === 'board'
      ? {
          view: route.view,
          board: route.board,
          maker: route.maker?.id ?? null,
          makers: route.makers.map(({id}) => id).sort(),
        }
      : {view: route.view, maker: route.maker?.id ?? null};
  };

  test('a board link opens its page, whatever the case of the typed ids', () => {
    expect(resolve('/firmware/sirind/brick60-h7s')).toEqual({
      view: 'board', board: 'brick60-h7s', maker: 'sirind', makers: ['sirind'],
    });
    expect(resolve('/firmware/SIRIND/BRICK60-H7S')).toEqual({
      view: 'board', board: 'brick60-h7s', maker: 'sirind', makers: ['sirind'],
    });
    expect(resolve('/firmware/Sirind')).toEqual({view: 'list', maker: 'sirind'});
  });

  test('the short link finds the maker, or asks when several sell the board', () => {
    expect(resolve('/firmware/brick60-h7s')).toEqual({
      view: 'board', board: 'brick60-h7s', maker: 'sirind', makers: ['sirind'],
    });
    expect(resolve('/firmware/n86')).toEqual({
      view: 'board', board: 'n86', maker: null, makers: ['keynetix', 'linworks', 'sirind'],
    });
    // The maker this browser remembered for the board is taken without asking.
    expect(resolve('/firmware/n86', 'linworks')).toMatchObject({maker: 'linworks'});
  });

  test('anything unknown falls back to the list', () => {
    expect(resolve('/firmware/nobody')).toEqual({view: 'list', maker: null});
    expect(resolve('/firmware/sirind/nothing')).toEqual({view: 'list', maker: 'sirind'});
    expect(resolve('/firmware/brick60-h7s/extra')).toEqual({view: 'list', maker: null});
  });
});

// A chat preview reads only the HTML head, so the firmware routes are served a
// copy of the shell with their own title and description.
describe('firmware share page', () => {
  const index = readFileSync(path.join(repoRoot, 'index.html'), 'utf8');

  test('every canonical maker link has its own crawler title before the fallback', () => {
    const {makers} = JSON.parse(readFileSync(path.join(repoRoot, 'config/firmware-catalog.json'), 'utf8'));
    const source = readFileSync(path.join(repoRoot, 'public/_redirects'), 'utf8');
    const redirects = toFirmwareShareRedirects(source, makers);
    for (const maker of makers) {
      const page = toFirmwareSharePage(index, maker.name);
      expect(page).toContain(`<title>${maker.name} — Firmware</title>`);
      expect(page).toContain(`property="og:title" content="${maker.name} — Firmware"`);
      expect(page).not.toContain('og:image');
      expect(page).toContain('<div id="root"></div>');
      const destination = `/${getMakerSharePage(maker.id).replace(/\.html$/, '')}`;
      for (const route of [`/firmware/${maker.id}`, `/firmware/${maker.id}/*`]) {
        const rule = `${route} ${destination} 200`;
        expect(redirects).toContain(rule);
        expect(redirects.indexOf(rule)).toBeLessThan(redirects.indexOf('/firmware/*'));
      }
    }
    expect(redirects).toContain('/firmware    /firmware-app  200');
    expect(redirects).not.toMatch(/^\/firmware-files\//m);
    expect(() => toFirmwareShareRedirects('', makers)).toThrow('generic rewrite');
    expect(() => getMakerSharePage('../outside')).toThrow('invalid maker id');
  });

  test('maker text is escaped and never interpreted as replacement syntax', () => {
    const page = toFirmwareSharePage(index, 'A & <B> "C" $& $1');
    const title = 'A &amp; &lt;B&gt; &quot;C&quot; $&amp; $1 — Firmware';
    expect(page).toContain(`<title>${title}</title>`);
    expect(page).toContain(`property="og:title" content="${title}"`);
    expect(page).not.toContain('<B>');
  });

  test('carries the firmware title and description and drops the VIA logo', () => {
    const page = toFirmwareSharePage(index);
    expect(page).toContain(`<title>${FIRMWARE_SHARE_TITLE}</title>`);
    expect(page).toContain(`property="og:title" content="${FIRMWARE_SHARE_TITLE}"`);
    // The supplier's name stays out of what a shared link shows.
    expect(FIRMWARE_SHARE_TITLE).not.toContain('ERA');
    expect(FIRMWARE_SHARE_DESCRIPTION).not.toContain('ERA');
    expect(page).toContain(`property="og:description" content="${FIRMWARE_SHARE_DESCRIPTION}"`);
    expect(page).toContain(`name="description" content="${FIRMWARE_SHARE_DESCRIPTION}"`);
    expect(page).not.toContain('og:image');
    expect(page).not.toContain('twitter:image');
    expect(page).not.toContain('best friend');
    // Everything else is the shell itself.
    expect(page).toContain('<div id="root"></div>');
  });

  test('refuses a shell whose head no longer has the tags it rewrites', () => {
    expect(() =>
      toFirmwareSharePage(index.replace(/property="og:title"/, 'property="og:name"')),
    ).toThrow('og:title');
  });

  // Browsing into or out of the firmware page retitles the tab the way opening a
  // link to it would, with no board or maker name.
  test('the tab title follows the route', () => {
    for (const location of ['/firmware', '/firmware/n86', '/firmware/sirind/n86']) {
      expect(getPageTitle(location)).toBe(FIRMWARE_SHARE_TITLE);
    }
    expect(index).toContain('<title>VIA</title>');
    for (const location of ['/', '/settings', '/errors', '/firmware-files/x.zip']) {
      expect(getPageTitle(location)).toBe('VIA');
    }
  });
});

// Components are imported after the globals above exist.
const originalWarn = console.warn;
console.warn = () => undefined;
// Same entry order as custom-menu-pane.test.tsx: the store slices import each
// other, and keyboard-api settles that cycle the way the app's store does.
await import('../src/utils/keyboard-api');
const {setFirmwareDataForTesting} = await import('../src/utils/use-firmware-catalog');
const {FirmwareVersion} = await import(
  '../src/components/panes/configure-panes/custom/firmware-version'
);
const {FirmwarePane} = await import('../src/components/panes/firmware');
const {FirmwareDevice} = await import('../src/components/panes/firmware-device');
const {Badge: DeviceBadge} = await import('../src/components/panes/configure-panes/badge');
const {HID} = await import('../src/shims/node-hid');
const {BadgeDropdown, badgePopupBounds} = await import('../src/components/inputs/badge-dropdown');
const {ExternalLinks} = await import('../src/components/menus/external-links');
const {default: settingsReducer} = await import('../src/store/settingsSlice');
console.warn = originalWarn;

const translations = i18n.createInstance();
await translations.init({lng: 'en', resources: {en: {translation: {}}}});

const ascii = (value: string) => [...new TextEncoder().encode(value), 0, 0xa5];

const makeStore = (
  device: {vendorId: number; productId: number} | null,
  version?: string,
) => {
  const path = 'firmware-distribution-test';
  const state = {
    settings: settingsReducer(undefined, {type: 'init'}),
    definitions: {
      definitions: device
        ? {[device.vendorId * 0x10000 + device.productId]: {v3: {name: 'Firmware test keyboard'}}}
        : {},
      eraDefinitions: {},
      customDefinitions: {},
      definitionEpochs: {},
    },
    definitionName: {selectedOptionMap: {}},
    devices: {
      selectedDevicePath: device ? path : null,
      selectedConnectionGeneration: device ? 1 : null,
      selectionGeneration: 0,
      selectedConnectionNeedsReload: false,
      connectedDevicePaths: device
        ? {
            [path]: {
              path,
              ...device,
              vendorProductId: device.vendorId * 0x10000 + device.productId,
              productName: 'Firmware test keyboard',
              protocol: 12,
              requiredDefinitionVersion: 'v3',
              hasResolvedDefinition: true,
            },
          }
        : {},
    },
    menus: {
      readContexts: device && version ? {[path]: {
        connectionGeneration: 1,
        selectionGeneration: 0,
        definitionIdentity: `${device.vendorId * 0x10000 + device.productId}:v3:0`,
      }} : {},
      customMenuDataMap:
        device && version
          ? {[path]: {[ERA_FIRMWARE_VERSION_COMMAND]: ascii(version)}}
          : {},
    },
  };
  return configureStore({reducer: () => state as any});
};

const renderVersionRow = (
  data: FirmwareData,
  device: {vendorId: number; productId: number},
  version: string,
) => {
  setFirmwareDataForTesting(data);
  try {
    return renderToStaticMarkup(
      <Provider store={makeStore(device, version)}>
        <I18nextProvider i18n={translations}>
          <FirmwareVersion
            source="ascii"
          />
        </I18nextProvider>
      </Provider>,
    );
  } finally {
    setFirmwareDataForTesting(null);
  }
};

// The router owns pathname, while the browser owns query and hash. Keep those
// separate so catalogue-entry queries render the way real links navigate.
const withPageLocation = <T,>(route: string, render: (pathname: string) => T): T => {
  const url = new URL(route, 'http://localhost');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: {pathname: url.pathname, search: url.search, hash: url.hash},
  });
  try {
    return render(url.pathname);
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, 'location', descriptor);
    } else {
      delete (globalThis as {location?: unknown}).location;
    }
  }
};

const renderPage = (
  data: FirmwareData,
  location: string,
  device: {vendorId: number; productId: number} | null = null,
  version?: string,
) => {
  setFirmwareDataForTesting(data);
  try {
    return withPageLocation(location, (pathname) => renderToStaticMarkup(
      <Provider store={makeStore(device, version)}>
        <I18nextProvider i18n={translations}>
          <Router hook={staticLocationHook(pathname)}>
            <FirmwarePane />
          </Router>
        </I18nextProvider>
      </Provider>,
    ));
  } finally {
    setFirmwareDataForTesting(null);
  }
};

const readOnly = (html: string) => {
  expect(html).not.toContain('<input');
  expect(html).not.toContain('>Save<');
  expect(html).not.toContain('>Apply<');
};

describe('VERSION firmware update row', () => {
  // One verb for the board page in every state; "Download" is kept for the ZIP.
  test('a newer release opens the board page', () => {
    const html = renderVersionRow(published(), usbId('classicd-a1'), '260913R1');
    expect(html).toContain('data-era-firmware-update="update-available"');
    expect(html).toContain('Firmware update');
    expect(html).toContain('New version 260916R1');
    expect(html).toMatch(/<a [^>]*href="\/firmware\/classicd\/classicd-a1"[^>]*>Open<\/a>/);
    expect(html).not.toContain('Download');
    expect(html).not.toContain('<button');
    readOnly(html);
  });

  test('an up-to-date keyboard opens the same page', () => {
    const html = renderVersionRow(published(), usbId('classicd-a1'), '260916R1');
    expect(html).toContain('data-era-firmware-update="up-to-date"');
    expect(html).toContain('Up to date');
    expect(html).toMatch(/<a [^>]*href="\/firmware\/classicd\/classicd-a1"[^>]*>Open<\/a>/);
    expect(html).not.toContain('Download');
    expect(html).not.toContain('New version');
    readOnly(html);
  });

  test('a legacy shared board asks which maker sold it', () => {
    const html = renderVersionRow(published(), usbId('n86', 'legacy'), '260913R1');
    expect(html).toContain('data-era-firmware-update="choose-maker"');
    expect(html).toContain('Which maker sold this keyboard?');
    expect((html.match(/<button/g) ?? []).length).toBe(3);
    for (const name of ['KEYNETIX', 'LINWORKS', 'SR Industry']) {
      expect(html).toContain(`>${name}</button>`);
    }
    expect(html).not.toContain('Latest');
    readOnly(html);
  });

  test('a shared board shows a newer release from every maker before asking', () => {
    const html = renderVersionRow(
      everyMakerPublished('260916R1', '260916R1', '260916R1'),
      usbId('n86', 'legacy'),
      '260913R1',
    );
    expect(html).toContain('data-era-firmware-update="choose-maker"');
    const latest = html.indexOf('Latest 260916R1');
    expect(latest).toBeGreaterThan(-1);
    expect(latest).toBeLessThan(html.indexOf('Which maker sold this keyboard?'));
    expect((html.match(/<button/g) ?? []).length).toBe(3);
    expect(html).not.toContain('href=');

    const mixed = renderVersionRow(
      everyMakerPublished('260916R1', '260917R1', '260916R1'),
      usbId('n86', 'legacy'),
      '260913R1',
    );
    expect(mixed).toContain('New version');
    expect(mixed).not.toContain('Latest');
  });

  test('a malformed version makes no claim', () => {
    const html = renderVersionRow(published(), usbId('classicd-a1'), '261399R1');
    expect(html).toContain('data-era-firmware-update="no-claim"');
    expect(html).toContain('Latest 260916R1');
    expect(html).not.toContain('Up to date');
    expect(html).not.toContain('New version');
  });

  // With no file there is nothing to go to: the page's own word, and no button.
  test('a keyboard without a file is not published and has no link', () => {
    const unknown = renderVersionRow(published(), {vendorId: 0x1234, productId: 0x5678}, '260913R1');
    expect(unknown).toContain('data-era-firmware-update="not-distributed"');
    expect(unknown).toContain('Not published');
    expect(unknown).not.toContain('href=');

    // One maker, and a shared board whose makers have no file yet.
    for (const device of [usbId('classicd-a1'), usbId('n86', 'legacy')]) {
      const unpublished = renderVersionRow(unpublishedData(), device, '260913R1');
      expect(unpublished).toContain('data-era-firmware-update="unpublished"');
      expect(unpublished).toContain('Not published');
      expect(unpublished).not.toContain('No distributed file');
      expect(unpublished).not.toContain('href=');
      expect(unpublished).not.toContain('New version');
      readOnly(unpublished);
    }
  });
});

describe('firmware page', () => {
  const makerIds = ['classicd', 'keynetix', 'linworks', 'newone', 'sirind', 'common'];
  const makerOrder = (html: string) =>
    [...html.matchAll(/data-firmware-maker="([^"]+)"/g)].map((match) => match[1]);
  const openingTag = (html: string, attribute: string) =>
    html.match(new RegExp(`<[^>]*${attribute}[^>]*>`))?.[0] ?? '';

  const noSelectors = (html: string) => {
    expect(html).not.toContain('data-firmware-selectors=');
    expect(html).not.toContain('data-firmware-maker-selector=');
    expect(html).not.toContain('data-firmware-board-selector=');
    expect(html).not.toContain('data-firmware-maker-picker=');
    expect(html).not.toContain('data-firmware-back-to-list=');
    expect(html).not.toMatch(/>\s*Keyboard maker\s*</);
    expect(html).not.toMatch(/>\s*All keyboards\s*</);
    expect(html).toMatch(/<nav [^>]*aria-label="Keyboard maker"[^>]*>/);
  };
  const sharedStage = (html: string) => {
    expect(html.match(/data-firmware-stage="true"/g)).toHaveLength(1);
    const stage = html.indexOf('data-firmware-stage="true"');
    expect(html.indexOf('data-firmware-maker-navigation=')).toBeGreaterThan(stage);
  };
  const selectionPlaceholder = (html: string) => {
    sharedStage(html);
    expect(html.match(/data-firmware-placeholder="true"/g)).toHaveLength(1);
    expect(html).toContain('Find firmware');
    expect(html).not.toContain('data-firmware-keyboard=');
  };
  const makerChooser = (html: string) => {
    expect(html).toContain('data-firmware-view="makers"');
    expect(html).toContain('data-firmware-maker-navigation="chooser"');
    expect(makerOrder(html)).toEqual(makerIds);
    for (const id of makerIds) {
      const link = openingTag(html, `data-firmware-maker="${id}"`);
      expect(link).toMatch(/^<a /);
      expect(link).toContain(`href="/firmware/${id}"`);
      expect(link).not.toContain('aria-current=');
    }
    selectionPlaceholder(html);
    expect(html).not.toContain('data-firmware-board=');
    expect(html).not.toContain(' download=');
    noSelectors(html);
  };

  test('without a keyboard, catalogue entry shows every maker without choosing one', () => {
    const html = renderPage(unpublishedData(), '/firmware');
    expect(html).toContain('data-firmware-page="true"');
    makerChooser(html);
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('/firmware-files/');
    readOnly(html);
  });

  test('unknown routes and non-distributed keyboards keep every maker reachable', () => {
    for (const location of ['/firmware/nobody', '/firmware/brick60-h7s/extra']) {
      makerChooser(renderPage(published(), location, usbId('brick60-h7s')));
    }
    makerChooser(renderPage(published(), '/firmware', {vendorId: 0x1234, productId: 0x5678}));
  });

  test('catalogue entry can be requested even while an ERA keyboard is connected', () => {
    makerChooser(renderPage(published(), '/firmware?makers=1', usbId('brick60-h7s'), '260913R1'));
  });

  test('an explicit maker lists its own boards even when another keyboard is connected', () => {
    const html = renderPage(unpublishedData(), '/firmware/classicd', usbId('brick60-h7s'));
    expect(html).toContain('data-firmware-view="list"');
    expect(openingTag(html, 'data-firmware-maker="classicd"')).toContain('aria-current="page"');
    expect(openingTag(html, 'data-firmware-maker="sirind"')).not.toContain('aria-current=');
    expect(makerOrder(html)).toEqual(makerIds);
    expect(html).toContain('Not published');
    expect(html).toContain('href="/firmware/classicd/classicd-a1"');
    selectionPlaceholder(html);
    noSelectors(html);
  });

  test('an invalid board under a valid maker returns to that maker list', () => {
    const html = renderPage(published(), '/firmware/classicd/nothing', usbId('brick60-h7s'));
    expect(html).toContain('data-firmware-view="list"');
    expect(openingTag(html, 'data-firmware-maker="classicd"')).toContain('aria-current="page"');
    expect(html).toContain('href="/firmware/classicd/classicd-a1"');
    selectionPlaceholder(html);
    noSelectors(html);
  });

  // Most users do not know what an MCU is: the page names boards and makers only.
  test('names no chip or firmware family', () => {
    for (const location of ['/firmware/sirind', '/firmware/sirind/brick60-h7s']) {
      const html = renderPage(committed, location);
      expect(html).not.toContain('RP2040');
      expect(html).not.toContain('STM32');
      expect(html).not.toContain('data-firmware-family');
    }
  });

  test('a published board opens its details from the list before downloading', () => {
    const html = renderPage(published(), '/firmware/classicd');
    expect(html).toMatch(/<a [^>]*href="\/firmware\/classicd\/classicd-a1"[^>]*>Download<\/a>/);
    expect(html).not.toContain('/firmware-files/');
    expect(html).not.toContain(' download=');
    expect(html).toContain('260916R1');
  });

  // The accent is too pale as text on the light surface, so the version, Download and
  // a board name under the pointer take the accent text colour (the pure accent in
  // dark mode). Keyboard focus draws VIA's accent outline on every link, the header's
  // firmware entry included, which also looks as it does under the pointer.
  test('links show keyboard focus and read on the light surface', () => {
    setFirmwareDataForTesting(published());
    const sheet = new ServerStyleSheet();
    let html = '';
    let css = '';
    try {
      html = renderToStaticMarkup(
        sheet.collectStyles(
          <Provider store={makeStore(null)}>
            <I18nextProvider i18n={translations}>
              <Router hook={staticLocationHook('/firmware/classicd')}>
                <ExternalLinks />
                <FirmwarePane />
              </Router>
            </I18nextProvider>
          </Provider>,
        ),
      );
      css = sheet.getStyleTags();
    } finally {
      sheet.seal();
      setFirmwareDataForTesting(null);
    }
    const tag = (pattern: RegExp) => pattern.exec(html)?.[0] ?? '';
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Whether one of the element's classes declares this in a rule for the selector.
    const declares = (
      element: string,
      selector: (name: string) => string,
      declaration: string,
    ) =>
      (/class="([^"]+)"/.exec(element)?.[1].split(' ') ?? []).some((name) =>
        new RegExp(
          `${escape(selector(name))}\\{(?:[^}]*;)?${escape(declaration)}`,
        ).test(css),
      );
    const board = tag(/<a [^>]*href="\/firmware\/classicd\/classicd-a1"[^>]*>/);
    const download = tag(/<a [^>]*href="\/firmware\/classicd\/classicd-a1"[^>]*>(?=Download<\/a>)/);
    const pill = tag(/<a [^>]*aria-label="ERA · Firmware"[^>]*>/);
    const version = tag(/<span [^>]*>(?=260916R1<)/);
    const maker = tag(/<a [^>]*data-firmware-maker="linworks"[^>]*>/);
    const text = 'color:var(--color_accent-text)';
    for (const link of [board, download, pill, maker]) {
      expect(
        declares(
          link,
          (name) => `.${name}:focus-visible`,
          'outline:2px solid var(--color_accent)',
        ),
      ).toBe(true);
    }
    expect(declares(download, (name) => `.${name}`, text)).toBe(true);
    expect(declares(version, (name) => `.${name}`, text)).toBe(true);
    expect(declares(board, (name) => `.${name}:hover`, text)).toBe(true);
    expect(
      declares(pill, (name) => `.${name}:hover,.${name}:focus-visible`, text),
    ).toBe(true);
  });

  test("a board's page shows the board, its file, hash and flashing steps", () => {
    const html = renderPage(published(), '/firmware/classicd/classicd-a1');
    expect(html).toContain('data-firmware-view="board"');
    expect(html).toContain('data-firmware-keyboard="classicd-a1"');
    sharedStage(html);
    expect(html).not.toContain('data-firmware-placeholder=');
    expect(html).not.toContain('Find firmware');
    expect(html).toContain('data-firmware-board-name=');
    expect(html).toContain('>CLASSIC.D A1<');
    expect(html).toContain('Latest firmware');
    expect(html).toContain('href="/firmware-files/260916R1/classicd/CLASSICD_A1-V260916R1.zip"');
    expect(html).toContain('download="CLASSICD_A1-V260916R1.zip"');
    expect(html).toContain('2026-09-16');
    expect(html).toContain('a'.repeat(64));
    expect(html).toContain('How to flash');
    expect(html).toContain('RPI-RP2');
    const stage = html.indexOf('data-firmware-stage="true"');
    const navigation = html.indexOf('data-firmware-maker-navigation=');
    const file = html.indexOf('data-firmware-file=');
    expect(navigation).toBeGreaterThan(stage);
    expect(navigation).toBeLessThan(file);
    expect(openingTag(html, 'data-firmware-maker="classicd"')).toContain(
      'href="/firmware/classicd"',
    );
    expect(html).not.toContain('<select');
    expect(openingTag(html, 'data-firmware-maker="classicd"')).toContain('aria-current="page"');
    noSelectors(html);
  });

  test('an unpublished board page still explains how to flash', () => {
    const html = renderPage(unpublishedData(), '/firmware/classicd/classicd-a1');
    expect(html).toContain('data-firmware-file="none"');
    expect(html).toContain('Not published');
    expect(html).toContain('How to flash');
    expect(html).not.toContain('SHA-256');
  });

  test('split and H7S boards get their own steps', () => {
    const split = renderPage(published(), '/firmware/sirind/tomak-tkl');
    expect(split).toContain('Split keyboard: flash both halves with the same .uf2 file');
    // A release can change the stored format, so the QMK note never promises settings survive.
    expect(split).toContain(
      'Settings may reset after updating.',
    );
    expect(split).not.toContain('A normal update keeps stored settings');
    // The backup names what a layout file brings back: not the VIA settings.
    expect(split).toContain(
      'Export a backup first.',
    );

    const h7s = renderPage(published(), '/firmware/sirind/brick60-h7s');
    expect(h7s).toContain(
      'Enter the bootloader with SYSTEM → BOOT → Jump To BOOT, a QK_BOOT key, or by holding the top-left key while plugging in USB.',
    );
    expect(h7s).toContain('bootloader&#x27;s removable disk');
    expect(h7s).toContain(
      'Settings may reset after updating. Export a backup first.',
    );
    expect(h7s).not.toContain('Installing a different firmware version resets');
    const may65 = renderPage(published(), '/firmware/keynetix/may65-h7s');
    expect(may65).toContain('backups from before Insert was added require manual keymap reconfiguration');
    expect(may65).toContain('manual keymap reconfiguration');
    expect(h7s).not.toContain('manual keymap reconfiguration');
    expect(h7s).toContain('>SR Industry<');
    expect(h7s).not.toContain('RPI-RP2');
    expect(h7s).not.toContain('Bootmagic');
    expect(h7s).not.toContain('resets the keymap and settings');
  });

  test('every H7S and EERRAA board shares the short reset and export warning', () => {
    for (const maker of committed.catalog.makers) {
      for (const entry of maker.boards) {
        const html = renderPage(committed, `/firmware/${maker.id}/${entry.board}`);
        expect(html).toContain('Settings may reset after updating. Export a backup first.');
        expect(html).not.toContain('Installing a different firmware version resets');
      }
    }
  });

  // The right half reads its own top-left key, Bootmagic clears the stored
  // keymap and settings, and VERSION shows only the half on USB.
  test('the steps name the Bootmagic key and reset, and a split board checks each half', () => {
    const split = renderPage(published(), '/firmware/sirind/tomak-tkl');
    expect(split).toContain(
      'holding the top-left key of each half while plugging in its USB (Bootmagic, resets the keymap and settings).',
    );
    expect(split).toContain(
      'one half at a time, and check SYSTEM → VERSION on each half.',
    );
    expect(split).not.toContain('Check SYSTEM → VERSION after the update.');

    const single = renderPage(published(), '/firmware/classicd/classicd-a1');
    expect(single).toContain(
      'holding the top-left key while plugging in USB (Bootmagic, resets the keymap and settings).',
    );
    expect(single).not.toContain('each half');
    expect(single).toContain('Check SYSTEM → VERSION after the update.');
  });

  // The note names what to do with the button VIA shows, not a USB detail.
  test('the notes say what to press when the keyboard does not come back', () => {
    const html = renderPage(published(), '/firmware/classicd/classicd-a1');
    expect(html).toContain(
      'If the keyboard doesn&#x27;t appear after the update, press Authorize device again.',
    );
    expect(html).not.toContain('USB identity');
  });

  test('the short link opens the board, and a shared board asks for its maker', () => {
    const short = renderPage(published(), '/firmware/brick60-h7s');
    expect(short).toContain('data-firmware-view="board"');
    expect(short).toContain('BRICK60-H7S-V260913R1.zip');

    const shared = renderPage(published(), '/firmware/n86');
    expect(shared).toContain('Which maker sold this keyboard?');
    expect(shared).toContain('href="/firmware/linworks/n86"');
    expect(shared).toContain('href="/firmware/sirind/n86"');
    expect(shared).not.toContain(' download=');
  });

  /** The connected keyboard's row, up to the next row. */
  const connectedRow = (html: string) => {
    const start = html.lastIndexOf('<', html.indexOf('data-firmware-status='));
    const ends = ['data-firmware-board=', 'data-firmware-file=']
      .map((mark) => html.indexOf(mark, start))
      .filter((index) => index > start);
    return html.slice(start, Math.min(...ends));
  };

  test('browsing another maker marks the connected maker without adding its board to the list', () => {
    const html = renderPage(published(), '/firmware/classicd', usbId('brick60-h7s'), '260910R1');
    expect(html).not.toContain('data-firmware-status=');
    expect(html).not.toContain('data-firmware-board="brick60-h7s"');
    expect(html).not.toContain('href="/firmware/sirind/brick60-h7s"');
    expect(html.match(/data-firmware-connected-maker="sirind"/g)).toHaveLength(1);
    expect(openingTag(html, 'data-firmware-maker="classicd"')).toContain('aria-current="page"');
    expect(openingTag(html, 'data-firmware-maker="sirind"')).toContain('title="Connected keyboard BRICK60 H7S"');
  });

  test('the connected board appears once at its catalog position with its name emphasis', () => {
    const html = renderPage(published(), '/firmware/sirind', usbId('tomak-tkl-left'), '260910R1');
    const expected = published().catalog.makers.find(({id}) => id === 'sirind')!.boards.map(({board}) => board);
    expect([...html.matchAll(/data-firmware-board="([^"]+)"/g)].map((match) => match[1])).toEqual(expected);
    expect(html.match(/data-firmware-board="tomak-tkl"/g)).toHaveLength(1);
    expect(openingTag(html, 'data-firmware-board="tomak-tkl"')).toContain('data-firmware-connected="true"');
    expect(html.match(/data-firmware-connected-maker="sirind"/g)).toHaveLength(1);
    expect(html).not.toContain('data-firmware-status=');
  });

  test('maker connection dots require a resolved supported identity and follow a remembered legacy maker', () => {
    for (const device of [null, {vendorId: 0x1234, productId: 0x5678}, usbId('n86', 'legacy')]) {
      expect(renderPage(published(), '/firmware?makers=1', device)).not.toContain('data-firmware-connected-maker=');
    }
    rememberMaker('n86', 'linworks');
    const html = renderPage(published(), '/firmware?makers=1', usbId('n86', 'legacy'));
    expect(html.match(/data-firmware-connected-maker="linworks"/g)).toHaveLength(1);
    expect(html).not.toContain('data-firmware-connected-maker="sirind"');
  });

  test('catalogue entry opens the recognised board and keeps its comparison before the file', () => {
    rememberMaker('n86', 'sirind');
    const html = renderPage(published(), '/firmware', usbId('n86', 'legacy'), '260913R1');
    const row = connectedRow(html);
    expect(html).toContain('data-firmware-view="board"');
    expect(html).toContain('data-firmware-keyboard="n86"');
    expect(row).toContain('>N86<');
    expect(row).not.toContain('Connected keyboard');
    expect(row).not.toContain('href=');
    expect(row).toContain('Current 260913R1 →');
    expect(row).toContain('Latest 260916R1');
    expect(row).not.toContain(' download=');
    expect(html.match(/download="N86-V260916R1.zip"/g)).toHaveLength(1);
    expect(html.indexOf('data-firmware-status=')).toBeLessThan(html.indexOf('data-firmware-file='));
    expect(row).not.toContain('Show file');
    // One short verb; the name still says what it changes.
    expect(row).toMatch(/<button [^>]*title="Change maker"[^>]*>Change<\/button>/);
    // The remembered maker resolves the board; it is not guessed from display order.
    expect(openingTag(html, 'data-firmware-maker="sirind"')).toContain(
      'aria-current="page"',
    );
    noSelectors(html);
  });

  test('a connected keyboard without a file opens its own unpublished board', () => {
    const html = renderPage(unpublishedData(), '/firmware', usbId('classicd-a1'), '260913R1');
    const row = connectedRow(html);
    expect(row).toContain('Not published');
    expect(row).not.toContain('No distributed file');
    expect(html).toContain('data-firmware-keyboard="classicd-a1"');
    expect(row).not.toContain('href=');
    expect(row).not.toContain(' download=');
    expect(html).not.toContain(' download=');
  });

  test('a shared unpublished board opens without choosing its first maker', () => {
    const html = renderPage(unpublishedData(), '/firmware', usbId('n86', 'legacy'), '260913R1');
    const row = connectedRow(html);
    expect(html).toContain('data-firmware-view="board"');
    expect(html).toContain('data-firmware-keyboard="n86"');
    expect(row).not.toContain('href=');
    expect(row).toContain('Not published');
    expect(html).toContain('Which maker sold this keyboard?');
    expect(html).toContain('href="/firmware/keynetix/n86"');
    expect(html).not.toContain('aria-current="page"');
    noSelectors(html);
  });

  test('on its own page the connected row neither links to itself nor repeats the file', () => {
    rememberMaker('n86', 'sirind');
    const html = renderPage(published(), '/firmware/sirind/n86', usbId('n86', 'legacy'), '260913R1');
    const row = connectedRow(html);
    expect(row).toContain('>N86<');
    expect(row).not.toContain('Connected keyboard');
    expect(row).not.toContain('href=');
    expect(row).not.toContain(' download=');
    expect(html).toContain('download="N86-V260916R1.zip"');
  });

  test('an unchosen shared board asks for the maker on the page too', () => {
    const html = renderPage(published(), '/firmware', usbId('n86', 'legacy'), '260913R1');
    expect(html).toContain('data-firmware-status="choose-maker"');
    expect(html).toContain('href="/firmware/linworks/n86"');
    expect(connectedRow(html)).not.toContain('Latest');
  });

  test('an unchosen shared board with a newer release from every maker says so first', () => {
    const html = renderPage(
      everyMakerPublished('260916R1', '260916R1', '260916R1'),
      '/firmware',
      usbId('n86', 'legacy'),
      '260913R1',
    );
    const row = connectedRow(html);
    const latest = row.indexOf('Latest 260916R1');
    expect(latest).toBeGreaterThan(-1);
    expect(latest).toBeLessThan(row.indexOf('Which maker sold this keyboard?'));
    expect(row).not.toContain(' download=');
  });

  test('an explicit board takes precedence over the device and its current maker tab opens the list', () => {
    const known = renderPage(published(), '/firmware/classicd/classicd-a1', usbId('brick60-h7s'));
    expect(known).toContain('data-firmware-keyboard="classicd-a1"');
    expect(known).not.toContain('data-firmware-keyboard="brick60-h7s"');
    expect(openingTag(known, 'data-firmware-maker="classicd"')).toContain('aria-current="page"');
    expect(openingTag(known, 'data-firmware-maker="classicd"')).toContain('href="/firmware/classicd"');
    noSelectors(known);
  });

  test('a shared board link keeps its maker unchosen with every maker visible', () => {
    const asked = renderPage(published(), '/firmware/n86');
    expect(asked).toContain('data-firmware-keyboard="n86"');
    expect(asked).not.toContain('aria-current="page"');
    expect(makerOrder(asked)).toEqual(makerIds);
    expect(asked).toContain('Which maker sold this keyboard?');
    noSelectors(asked);
  });
});

describe('header firmware entry', () => {
  const renderHeader = (
    data: FirmwareData,
    device: {vendorId: number; productId: number},
    version: string,
  ) => {
    setFirmwareDataForTesting(data);
    try {
      return renderToStaticMarkup(
        <Provider store={makeStore(device, version)}>
          <I18nextProvider i18n={translations}>
            <Router hook={staticLocationHook('/')}>
              <ExternalLinks />
            </Router>
          </I18nextProvider>
        </Provider>,
      );
    } finally {
      setFirmwareDataForTesting(null);
    }
  };
  const entry = (html: string) =>
    html.match(/<a [^>]*aria-label="ERA · [^"]*"[^>]*>/)?.[0] ?? '';

  // It opens the board's page, so it promises no download.
  test('a newer release fills the entry and names the board and version', () => {
    const html = renderHeader(published(), usbId('classicd-a1'), '260913R1');
    expect(entry(html)).toContain('data-firmware-update="available"');
    expect(entry(html)).toContain('href="/firmware/classicd/classicd-a1"');
    expect(html).toContain('>CLASSIC.D A1 260916R1<');
    expect(html).not.toContain('Download');
  });

  test('a shared board lights it only for a newer release from every maker, and goes to the question', () => {
    const due = renderHeader(
      everyMakerPublished('260916R1', '260916R1', '260916R1'),
      usbId('n86', 'legacy'),
      '260913R1',
    );
    expect(entry(due)).toContain('data-firmware-update="available"');
    expect(entry(due)).toContain('href="/firmware/n86"');
    expect(due).toContain('>N86 260916R1<');

    // Makers on different versions: no number.
    const mixed = renderHeader(
      everyMakerPublished('260916R1', '260917R1', '260916R1'),
      usbId('n86', 'legacy'),
      '260913R1',
    );
    expect(entry(mixed)).toContain('data-firmware-update="available"');
    expect(mixed).toContain('>N86<');

    for (const data of [published(), unpublishedData()]) {
      const plain = renderHeader(data, usbId('n86', 'legacy'), '260913R1');
      expect(entry(plain)).not.toContain('data-firmware-update');
      expect(entry(plain)).toContain('href="/firmware/n86"');
    }
  });
});

// Last in the file: the test renderer and the server renderer share the context
// providers, and React warns about the pair once the second one renders them.
describe('firmware badge dropdown', () => {
  test('opens and closes like a badge, and keyboard activation focuses one selected choice', () => {
    const picked: string[] = [];
    const focused: string[] = [];
    const longName = 'CLASSIC.D 코어리스 키보드 펌웨어';
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <BadgeDropdown
          label="Keyboard"
          title={longName}
          value="classicd-coreless"
          triggerAttributes={{'data-firmware-board-selector': 'true'}}
          options={[
            {value: '', label: 'All keyboards'},
            {value: 'classicd-coreless', label: longName},
            {value: 'classicd-a1', label: 'CLASSIC.D A1'},
          ]}
          onChange={(value) => picked.push(value)}
        />,
        {createNodeMock: ({type, props}) => type === 'button' ? {
          focus: () => focused.push(props['aria-label'] ?? props.children),
          getBoundingClientRect: () => ({right: 375, top: 50, bottom: 75}),
        } : null},
      );
    });
    try {
      const root = renderer.root;
      const trigger = () => root.find((node) =>
        node.type === 'button' && node.props['data-firmware-board-selector'],
      );
      const list = () => root.find((node) => node.type === 'ul');
      const choices = () => root.findAll((node) =>
        node.type === 'button' && node.props.role === 'menuitemradio',
      );
      const key = (name: string) => {
        const container = root.find((node) => node.type === 'div' && node.props.onKeyDown);
        act(() => container.props.onKeyDown({key: name, preventDefault: () => undefined}));
      };
      expect(trigger().props['aria-expanded']).toBe(false);
      expect(list().props['aria-hidden']).toBe(true);
      expect(choices().every((node) => node.props.tabIndex === -1)).toBe(true);
      expect(trigger().props.title).toBe(longName);

      // Pointer activation keeps the title focused; the same title closes again.
      act(() => trigger().props.onClick({detail: 1}));
      expect(trigger().props['aria-expanded']).toBe(true);
      expect(list().props['aria-hidden']).toBe(false);
      expect(focused).toEqual([]);
      act(() => trigger().props.onClick({detail: 1}));
      expect(trigger().props['aria-expanded']).toBe(false);

      // Enter and Space produce a native button click with detail 0.
      act(() => trigger().props.onClick({detail: 0}));
      expect(focused.at(-1)).toBe(longName);
      expect(choices().filter((node) => node.props.tabIndex === 0)).toHaveLength(1);
      key('Escape');
      expect(trigger().props['aria-expanded']).toBe(false);
      expect(focused.at(-1)).toBe('Keyboard');

      act(() => trigger().props.onClick({detail: 1}));
      key('ArrowUp'); // Focus still on the title: go to the final choice.
      expect(focused.at(-1)).toBe('CLASSIC.D A1');
      key('Tab');
      expect(trigger().props['aria-expanded']).toBe(false);
      expect(choices().every((node) => node.props.tabIndex === -1)).toBe(true);

      act(() => trigger().props.onClick({detail: 1}));
      const cover = root.find((node) => node.type === 'div' && node.props['data-badge-dropdown-overlay']);
      act(() => cover.props.onClick());
      expect(trigger().props['aria-expanded']).toBe(false);
      expect(focused.at(-1)).toBe('Keyboard');

      act(() => trigger().props.onClick({detail: 1}));
      act(() => choices()[1].props.onClick());
      expect(picked).toEqual(['classicd-coreless']);
      expect(trigger().props['aria-expanded']).toBe(false);
      expect(list().props['aria-hidden']).toBe(true);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test('a long board badge anchors a scrollable menu inside small viewport bounds', () => {
    for (const viewport of [{width: 390, height: 844}, {width: 844, height: 390}]) {
      for (const right of [90, viewport.width - 15]) {
        const anchor = {right, top: 50, bottom: 75};
        const bounds = badgePopupBounds(anchor, viewport);
        expect(bounds.left).toBeGreaterThanOrEqual(8);
        expect(bounds.left + bounds.width).toBeLessThanOrEqual(viewport.width - 8);
        expect(bounds.top).toBe(80);
        expect(bounds.top + bounds.maxHeight).toBeLessThanOrEqual(viewport.height - 8);
        expect(bounds.maxHeight).toBeGreaterThan(0);
      }
    }
    const bottom = badgePopupBounds({right: 200, top: 340, bottom: 365}, {width: 390, height: 390}, 220, 200);
    expect(bottom.top).toBeLessThan(340);
    expect(bottom.top + bottom.maxHeight).toBeLessThanOrEqual(335);
  });
});

describe('firmware HID device badge', () => {
  const setup = (device: {vendorId: number; productId: number} | null = null) => {
    const descriptors = ['navigator', 'history'].map((key) =>
      [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
    );
    const navigations: string[] = [];
    Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {hid: {}}});
    Object.defineProperty(globalThis, 'history', {
      configurable: true,
      value: {pushState: (_state: unknown, _title: string, to: string) => navigations.push(to)},
    });
    const store = makeStore(device);
    // Connection transport has its own integration suite. Here assert that
    // every explicit choice invokes it, without opening real HID devices.
    const dispatch = spyOn(store, 'dispatch').mockImplementation(() => undefined);
    const request = spyOn(HID, 'requestDevice');
    let renderer!: ReturnType<typeof create>;
    const render = (child = <FirmwareDevice />) => (
      <Provider store={store}>
        <I18nextProvider i18n={translations}>{child}</I18nextProvider>
      </Provider>
    );
    act(() => { renderer = create(render()); });
    return {
      navigations, dispatch, request, renderer,
      button: (text: string) => renderer.root.find((node) =>
        node.type === 'button' && node.children.includes(text),
      ),
      render,
      cleanup: () => {
        act(() => renderer.unmount());
        dispatch.mockRestore();
        request.mockRestore();
        descriptors.forEach(([key, descriptor]) => {
          if (descriptor) Object.defineProperty(globalThis, key, descriptor);
          else Reflect.deleteProperty(globalThis, key);
        });
      },
    };
  };

  test('authorizing a new keyboard opens its board, resolving maker and legacy identities', async () => {
    const context = setup();
    try {
      for (const [device, destination] of [
        [usbId('may65-h7s'), '/firmware/keynetix/may65-h7s'],
        [usbId('classicd-a1'), '/firmware/classicd/classicd-a1'],
        [usbId('n86', 'legacy'), '/firmware/n86'],
      ] as const) {
        context.request.mockResolvedValue({...device, __path: 'new-keyboard'} as any);
        await act(async () => { await context.button('Authorize device').props.onClick(); });
        expect(context.navigations.at(-1)).toBe(destination);
      }
      rememberMaker('n86', 'linworks');
      await act(async () => { await context.button('Authorize device').props.onClick(); });
      expect(context.navigations.at(-1)).toBe('/firmware/linworks/n86');
      expect(context.dispatch).toHaveBeenCalledTimes(4);
      expect(context.dispatch.mock.calls.every(([action]) => typeof action === 'function')).toBe(true);
    } finally { context.cleanup(); }
  });

  test('explicitly selecting an already connected keyboard navigates, and Authorize New stays available', async () => {
    const context = setup(usbId('may65-h7s'));
    try {
      expect(context.navigations).toEqual([]);
      const title = () => context.renderer.root.find((node) =>
        node.type === 'button' && node.props['aria-expanded'] !== undefined,
      );
      expect(context.button('Authorize New').props.tabIndex).toBe(-1);
      expect(context.renderer.root.findByType('ul').props['aria-hidden']).toBe(true);
      act(() => title().props.onClick());
      expect(title().props['aria-expanded']).toBe(true);
      expect(context.button('Authorize New').props.tabIndex).toBe(0);
      expect(context.renderer.root.findByType('ul').props['aria-hidden']).toBe(false);
      const option = context.renderer.root.find((node) =>
        node.type === 'button' && node.children.includes('Firmware test keyboard') &&
        node.props['aria-expanded'] === undefined,
      );
      act(() => option.props.onClick());
      expect(context.navigations).toEqual(['/firmware/keynetix/may65-h7s']);
      expect(title().props['aria-expanded']).toBe(false);
      expect(option.props.tabIndex).toBe(-1);
      expect(context.request).not.toHaveBeenCalled();
      act(() => title().props.onClick());
      context.request.mockResolvedValue({...usbId('classicd-a1'), __path: 'new-keyboard'} as any);
      await act(async () => { await context.button('Authorize New').props.onClick(); });
      expect(context.navigations.at(-1)).toBe('/firmware/classicd/classicd-a1');
      expect(context.dispatch).toHaveBeenCalledTimes(2);
    } finally { context.cleanup(); }
  });

  test('cancellation, refusal and an unknown keyboard preserve the download address', async () => {
    const context = setup();
    try {
      context.request.mockResolvedValue(undefined as any);
      await act(async () => { await context.button('Authorize device').props.onClick(); });
      context.request.mockRejectedValue(new DOMException('Cancelled', 'NotFoundError'));
      await act(async () => { await context.button('Authorize device').props.onClick(); });
      expect(context.dispatch).not.toHaveBeenCalled();
      context.request.mockResolvedValue({vendorId: 1, productId: 2, __path: 'unknown'} as any);
      await act(async () => { await context.button('Authorize device').props.onClick(); });
      expect(context.dispatch).toHaveBeenCalledTimes(1);
      expect(context.navigations).toEqual([]);
    } finally { context.cleanup(); }
  });

  test('download-only browsers omit HID controls and Configure keeps its unconnected behavior', () => {
    const context = setup();
    try {
      act(() => context.renderer.update(context.render(<DeviceBadge />)));
      expect(context.renderer.toJSON()).toBeNull();
      Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {}});
      act(() => context.renderer.update(context.render()));
      expect(context.renderer.toJSON()).toBeNull();
      expect(context.request).not.toHaveBeenCalled();
      expect(context.navigations).toEqual([]);
    } finally { context.cleanup(); }
  });
});

describe('firmware page history', () => {
  test('connected catalogue entry fixes the board URL and keeps its file page after disconnect', () => {
    const historyDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'history');
    setFirmwareDataForTesting(published());
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      if (!String(args[0]).includes('multiple renderers')) originalError(...args);
    };
    try {
      for (const entry of [
        {route: '/firmware', device: usbId('classicd-a1'), board: 'classicd-a1', to: '/firmware/classicd/classicd-a1'},
        {route: '/firmware/', device: usbId('classicd-a1'), board: 'classicd-a1', to: '/firmware/classicd/classicd-a1'},
        {route: '/firmware', device: usbId('n86', 'legacy'), board: 'n86', to: '/firmware/n86'},
      ]) {
        withPageLocation(entry.route, (initialPath) => {
          let pathname = initialPath;
          const listeners = new Set<() => void>();
          const subscribe = (callback: () => void) => {
            listeners.add(callback);
            return () => listeners.delete(callback);
          };
          const snapshot = () => pathname;
          const hook = () => [
            useSyncExternalStore(subscribe, snapshot, snapshot),
            () => undefined,
          ] as ReturnType<ReturnType<typeof staticLocationHook>>;
          const calls: string[] = [];
          Object.defineProperty(globalThis, 'history', {
            configurable: true,
            value: {
              pushState: (_state: unknown, _title: string, to: string) => calls.push(`push ${to}`),
              replaceState: (_state: unknown, _title: string, to: string) => {
                calls.push(`replace ${to}`);
                const url = new URL(to, 'http://localhost');
                pathname = url.pathname;
                Object.assign(globalThis.location, {pathname, search: url.search, hash: url.hash});
                listeners.forEach((callback) => callback());
              },
            },
          });
          const initial = makeStore(entry.device, '260913R1').getState();
          const store = configureStore({
            reducer: (state = initial, action) => action.type === 'test/disconnect'
              ? {...state, devices: {...state.devices, selectedDevicePath: null, connectedDevicePaths: {}}}
              : state,
          });
          let renderer!: ReturnType<typeof create>;
          act(() => {
            renderer = create(
              <Provider store={store}>
                <I18nextProvider i18n={translations}>
                  <Router hook={hook}>
                    <FirmwarePane />
                  </Router>
                </I18nextProvider>
              </Provider>,
            );
          });
          try {
            const board = () => renderer.root.findAll((node) =>
              typeof node.type === 'string' && node.props['data-firmware-keyboard'] === entry.board,
            );
            expect(calls).toEqual([`replace ${entry.to}`]);
            expect(pathname).toBe(entry.to);
            expect(board()).toHaveLength(1);
            expect(renderer.root.findAll((node) =>
              typeof node.type === 'string' && node.props['data-firmware-status'],
            )).toHaveLength(1);
            act(() => store.dispatch({type: 'test/disconnect'}));
            expect(board()).toHaveLength(1);
            expect(renderer.root.findAll((node) =>
              typeof node.type === 'string' && node.props['data-firmware-status'],
            )).toHaveLength(0);
            expect(calls).toEqual([`replace ${entry.to}`]);
            if (entry.board === 'n86') {
              expect(renderer.root.findAll((node) =>
                node.type === 'a' && node.props.href === '/firmware/linworks/n86',
              ).length).toBeGreaterThan(0);
            } else {
              expect(renderer.root.findAll((node) =>
                node.type === 'a' && node.props.download === 'CLASSICD_A1-V260916R1.zip',
              )).toHaveLength(1);
            }
          } finally {
            act(() => renderer.unmount());
          }
        });
      }
    } finally {
      console.error = originalError;
      setFirmwareDataForTesting(null);
      if (historyDescriptor) {
        Object.defineProperty(globalThis, 'history', historyDescriptor);
      } else {
        delete (globalThis as {history?: unknown}).history;
      }
    }
  });

  test('navigation and download links preserve board context and browser clicks', () => {
    const calls: string[] = [];
    const historyDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'history');
    Object.defineProperty(globalThis, 'history', {
      configurable: true,
      value: {
        pushState: (_state: unknown, _title: string, url: string) =>
          calls.push(`push ${url}`),
        replaceState: (_state: unknown, _title: string, url: string) =>
          calls.push(`replace ${url}`),
      },
    });
    const click = (
      node: ReactTestInstance,
      modifiers: Partial<{
        button: number;
        metaKey: boolean;
        ctrlKey: boolean;
        shiftKey: boolean;
        altKey: boolean;
        defaultPrevented: boolean;
      }> = {},
    ) => {
      const event = {
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
        ...modifiers,
        preventDefault: () => {
          event.defaultPrevented = true;
        },
      };
      act(() => node.props.onClick(event));
      return event.defaultPrevented;
    };
    const anchor = (root: ReactTestInstance, matches: (props: any) => boolean) =>
      root.find((node) => node.type === 'a' && matches(node.props));
    const maker = (root: ReactTestInstance, id: string) =>
      anchor(root, (props) => props['data-firmware-maker'] === id);
    setFirmwareDataForTesting(published());
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      if (!String(args[0]).includes('multiple renderers')) {
        originalError(...args);
      }
    };
    try {
      const tree = (
        location: string,
        device: {vendorId: number; productId: number} | null = null,
      ) => {
        let renderer!: ReturnType<typeof create>;
        withPageLocation(location, (pathname) => act(() => {
          renderer = create(
            <Provider store={makeStore(device)}>
              <I18nextProvider i18n={translations}>
                <Router hook={staticLocationHook(pathname)}>
                  <FirmwarePane />
                </Router>
              </I18nextProvider>
            </Provider>,
          );
        }));
        return renderer;
      };

      // Explicit routes and catalogue-entry queries must never redirect to USB.
      for (const [location, view] of [
        ['/firmware?makers=1', 'makers'],
        ['/firmware/classicd', 'list'],
        ['/firmware/classicd/classicd-a1', 'board'],
        ['/firmware/n86', 'board'],
        ['/firmware/nobody', 'makers'],
        ['/firmware/classicd/nothing', 'list'],
      ]) {
        const explicit = tree(location, usbId('brick60-h7s'));
        expect(explicit.root.findAll((node) =>
          typeof node.type === 'string' && node.props['data-firmware-view'] === view,
        )).toHaveLength(1);
        expect(calls).toEqual([]);
        act(() => explicit.unmount());
      }

      // List Download links open details first. Only the second click on the
      // board page's file link starts the native ZIP download.
      for (const entry of [
        {route: '/firmware/classicd', device: null, maker: 'classicd', board: 'classicd-a1', file: 'CLASSICD_A1-V260916R1.zip', version: '260916R1'},
        {route: '/firmware/linworks', device: null, maker: 'linworks', board: 'n86', file: 'N86-V260916R1.zip', version: '260916R1'},
        {route: '/firmware/sirind', device: usbId('brick60-h7s'), maker: 'sirind', board: 'brick60-h7s', file: 'BRICK60-H7S-V260913R1.zip', version: '260913R1'},
      ]) {
        calls.length = 0;
        rememberMaker('n86', null);
        const downloadPage = tree(entry.route, entry.device);
        const href = `/firmware/${entry.maker}/${entry.board}`;
        const download = anchor(downloadPage.root, (props) => props.href === href && props.children === 'Download');
        expect(download.props.href).toBe(href);
        expect(download.props.download).toBeUndefined();
        expect(downloadPage.root.findAll((node) =>
          node.type === 'a' && node.props.download,
        )).toHaveLength(0);
        expect(typeof download.props.onClick).toBe('function');
        for (const modifier of [
          {button: 1},
          {button: 2},
          {ctrlKey: true},
          {metaKey: true},
          {shiftKey: true},
          {altKey: true},
        ]) {
          expect(click(download, modifier)).toBe(false);
          expect(calls).toEqual([]);
          expect(readRememberedMaker('n86')).toBeNull();
        }
        expect(click(download, {defaultPrevented: true})).toBe(true);
        expect(calls).toEqual([]);
        expect(click(download)).toBe(true);
        expect(calls).toEqual([`push ${href}`]);
        act(() => downloadPage.unmount());
        const details = tree(href, entry.device);
        const file = anchor(details.root, (props) => props.download === entry.file);
        expect(file.props.href).toBe(`/firmware-files/${entry.version}/${entry.maker}/${entry.file}`);
        expect(file.props.download).toBe(entry.file);
        expect(file.props.onClick).toBeUndefined();
        expect(calls).toEqual([`push ${href}`]);
        act(() => details.unmount());
      }
      calls.length = 0;

      const chooser = tree('/firmware');
      expect(click(maker(chooser.root, 'linworks'))).toBe(true);
      act(() => chooser.unmount());
      expect(calls).toEqual(['push /firmware/linworks']);

      calls.length = 0;
      const list = tree('/firmware/classicd');
      expect(click(maker(list.root, 'classicd'), {ctrlKey: true})).toBe(false);
      expect(calls).toEqual([]);
      expect(click(maker(list.root, 'classicd'))).toBe(true);
      expect(calls).toEqual([]);
      expect(click(maker(list.root, 'linworks'))).toBe(true);
      click(anchor(list.root, (props) => props.href === '/firmware/classicd/classicd-a1' && props.children === 'CLASSIC.D A1'));
      act(() => list.unmount());
      expect(calls).toEqual([
        'replace /firmware/linworks',
        'push /firmware/classicd/classicd-a1',
      ]);

      calls.length = 0;
      const board = tree('/firmware/classicd/classicd-a1');
      expect(maker(board.root, 'classicd').props.href).toBe('/firmware/classicd');
      expect(click(maker(board.root, 'classicd'), {ctrlKey: true})).toBe(false);
      expect(calls).toEqual([]);
      expect(click(maker(board.root, 'classicd'))).toBe(true);
      // The page offers only routes its catalogue can resolve.
      expect(board.root.findAll((node) =>
        node.type === 'a' && node.props.href === '/firmware/classicd/n86',
      )).toHaveLength(0);
      expect(board.root.findAll((node) => node.props['data-firmware-maker'] === 'unknown')).toHaveLength(0);
      expect(board.root.findAll((node) =>
        typeof node.type === 'string' && node.props['data-firmware-back-to-list'],
      )).toHaveLength(0);
      const file = anchor(board.root, (props) => props.download === 'CLASSICD_A1-V260916R1.zip');
      expect(file.props.href).toBe('/firmware-files/260916R1/classicd/CLASSICD_A1-V260916R1.zip');
      expect(file.props.onClick).toBeUndefined();
      act(() => board.unmount());
      expect(calls).toEqual(['replace /firmware/classicd']);

      calls.length = 0;
      const shared = tree('/firmware/sirind/n86');
      expect(maker(shared.root, 'linworks').props.href).toBe('/firmware/linworks/n86');
      click(maker(shared.root, 'linworks'));
      expect(readRememberedMaker('n86')).toBe('linworks');
      expect(maker(shared.root, 'classicd').props.href).toBe('/firmware/classicd');
      click(maker(shared.root, 'classicd'));
      expect(readRememberedMaker('n86')).toBe('linworks');
      act(() => shared.unmount());
      expect(calls).toEqual([
        'replace /firmware/linworks/n86',
        'replace /firmware/classicd',
      ]);

      calls.length = 0;
      rememberMaker('n86', null);
      const unchosen = tree('/firmware/n86');
      const sharedChoice = maker(unchosen.root, 'sirind');
      for (const modifier of [
        {button: 1},
        {ctrlKey: true},
        {metaKey: true},
        {shiftKey: true},
        {altKey: true},
      ]) {
        expect(click(sharedChoice, modifier)).toBe(false);
        expect(calls).toEqual([]);
        expect(readRememberedMaker('n86')).toBeNull();
      }
      click(sharedChoice);
      act(() => unchosen.unmount());
      expect(calls).toEqual(['replace /firmware/sirind/n86']);
      expect(readRememberedMaker('n86')).toBe('sirind');

      calls.length = 0;
      const selectedShared = tree('/firmware/sirind/n86');
      expect(maker(selectedShared.root, 'sirind').props.href).toBe('/firmware/sirind');
      click(maker(selectedShared.root, 'sirind'));
      act(() => selectedShared.unmount());
      expect(calls).toEqual(['replace /firmware/sirind']);
      const sharedList = tree('/firmware/sirind');
      expect(click(maker(sharedList.root, 'sirind'))).toBe(true);
      expect(maker(sharedList.root, 'linworks').props.href).toBe('/firmware/linworks');
      act(() => sharedList.unmount());
      expect(calls).toEqual(['replace /firmware/sirind']);
    } finally {
      console.error = originalError;
      setFirmwareDataForTesting(null);
      if (historyDescriptor) {
        Object.defineProperty(globalThis, 'history', historyDescriptor);
      } else {
        delete (globalThis as {history?: unknown}).history;
      }
    }
  });
});
