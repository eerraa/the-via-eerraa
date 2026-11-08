import {expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {
  type FirmwareCatalogSource,
  type FirmwareManifest,
  getFirmwareBoardInfo,
  getFirmwareHistory,
  resolveFirmwareCatalog,
  validateFirmwareCatalog,
} from '../src/utils/era-firmware-catalog';

const source = (): FirmwareCatalogSource => JSON.parse(
  readFileSync(new URL('../config/firmware-catalog.json', import.meta.url), 'utf8'),
);
const manifest: FirmwareManifest = JSON.parse(
  readFileSync(new URL('../config/era-definitions.manifest.json', import.meta.url), 'utf8'),
);
const note = (text: string) => Object.fromEntries(
  ['ko', 'en', 'zh', 'ja', 'es', 'de'].map((language) => [language, `${language}: ${text}`]),
) as {en: string} & Record<string, string>;
const dataFor = (catalog: FirmwareCatalogSource) => ({catalog: resolveFirmwareCatalog(catalog), manifest});
const historyFor = (source: FirmwareCatalogSource, maker: string, board: string) => {
  const data = dataFor(source);
  return getFirmwareHistory(data.catalog, maker, getFirmwareBoardInfo(data, board));
};

test('a board description replaces the family description without leaking across boards', () => {
  const catalog = source();
  const release = catalog.versions.find(({version}) => version === '261021R1')!;
  release.families.qmk!.note = note('Common correction');
  release.files.sirind['tomak-tkl'].note = note('Split sync correction');
  release.files.newone['newone-odessey60s'].note = note('Keymap correction');
  for (const [maker, board, expected] of [
    ['sirind', 'tomak-tkl', 'Split sync correction'],
    ['newone', 'newone-odessey60s', 'Keymap correction'],
  ]) {
    const entry = historyFor(catalog, maker, board).find(({file}) => file.version === release.version)!;
    expect(entry.note).toEqual(note(expected));
    expect(JSON.stringify(entry.note)).not.toContain('Common correction');
  }
  expect(validateFirmwareCatalog(dataFor(catalog))).toEqual([]);
});

test('notes without a board override keep their common scope; unknown changes stay absent', () => {
  const catalog = source();
  const history = historyFor(catalog, 'sirind', 'tomak-tkl');
  expect(history.find(({file}) => file.version === '261015R1')!.note)
    .toEqual(catalog.versions.find(({version}) => version === '261015R1')!.families.qmk!.note);
  expect(history.find(({file}) => file.version === '261005R1')!.note).toBeNull();
});

test('runtime fallback stays inside the selected board note while validation catches a missing language', () => {
  const catalog = source();
  const release = catalog.versions.find(({version}) => version === '261021R1')!;
  release.families.qmk!.note = note('Common correction');
  release.files.sirind['tomak-tkl'].note = {en: 'Split correction'};
  const selected = historyFor(catalog, 'sirind', 'tomak-tkl').find(({file}) => file.version === release.version)!.note!;
  expect(selected.de ?? selected.en).toBe('Split correction');
  expect(validateFirmwareCatalog(dataFor(catalog))).toContain('261021R1/sirind/tomak-tkl note is missing de');
});

test('both shared and board notes require non-empty values in every supported language', () => {
  const catalog = source();
  const release = catalog.versions.find(({version}) => version === '261021R1')!;
  release.families.qmk!.note = {...note('Shared'), ko: ' '};
  release.files.newone['newone-odessey60s'].note = {...note('Keymap'), ja: ''};
  expect(validateFirmwareCatalog(dataFor(catalog))).toEqual(expect.arrayContaining([
    '261021R1/qmk note is missing ko',
    '261021R1/newone/newone-odessey60s note is missing ja',
  ]));
});

test('the published mixed release gives each keyboard only its own correction', () => {
  const catalog = source();
  const release = catalog.versions.find(({version}) => version === '261021R1')!;
  expect(release.families.qmk!.note).toBeUndefined();
  for (const board of ['tomak-tkl', 'tomak79s', 'tomak79h']) {
    const entry = historyFor(catalog, 'sirind', board).find(({file}) => file.version === release.version)!;
    expect(entry.note!.ko).toBe('스플릿 동기화·매크로 저장 안정성 개선');
    expect(JSON.stringify(entry.note)).not.toMatch(/odessey/i);
  }
  const odessey = historyFor(catalog, 'newone', 'newone-odessey60s').find(({file}) => file.version === release.version)!;
  expect(odessey.note!.ko).toBe('Odessey60S 키맵 좌표 수정');
  expect(JSON.stringify(odessey.note)).not.toMatch(/tomak|macro|split/i);
});
