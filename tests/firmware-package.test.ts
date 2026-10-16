import {expect, test} from 'bun:test';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {strToU8, unzipSync, zipSync} from 'fflate';
import {
  auditFirmwarePackagesAt,
  validateFirmwarePackage,
} from '../scripts/audit-firmware-packages';
import type {FirmwareCatalogSource} from '../src/utils/era-firmware-catalog';

const stock = () => {
  const raw = JSON.parse(
    readFileSync('era-definitions/custom/v3/brick65/BRICK65-VIA.json', 'utf8'),
  );
  delete raw.tapdanceKeycodes;
  return raw;
};
const packageWith = (definitions: Record<string, unknown>) =>
  zipSync(
    Object.fromEntries(
      Object.entries(definitions).map(([name, raw]) => [
        `usevia.app/${name}.json`,
        strToU8(JSON.stringify(raw)),
      ]),
    ),
  );

test('STOCK gate validates every definition and rejects malformed or missing packages', () => {
  expect(validateFirmwarePackage(packageWith({board: stock()}))).toEqual([]);
  for (const [raw, error] of [
    [{...stock(), menus: ['qmk_lighting']}, 'qmk_lighting is forbidden'],
    [
      {...stock(), matrix: {rows: 'invalid', cols: 1}},
      'Invalid VIA V3 definition',
    ],
    [{...stock(), tapdanceKeycodes: []}, 'Invalid VIA V3 definition'],
  ] as const) {
    expect(
      validateFirmwarePackage(packageWith({good: stock(), bad: raw})).join(
        '\n',
      ),
    ).toContain(`usevia.app/bad.json: ${error}`);
  }
  for (const [bytes, error] of [
    [zipSync({'usevia.app/bad.json': strToU8('{')}), 'Invalid JSON'],
    [strToU8('not a ZIP'), 'Invalid firmware ZIP'],
    [zipSync({'readme.txt': strToU8('no definitions')}), 'no STOCK'],
  ] as const) {
    expect(validateFirmwarePackage(bytes).join('\n')).toContain(error);
  }
});

test('hosted audit grandfathers only original bytes, never a filename or repacked release', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'era-package-gate-'));
  try {
    const catalog: FirmwareCatalogSource = JSON.parse(
      readFileSync('config/firmware-catalog.json', 'utf8'),
    );
    const file = catalog.versions.find(({version}) => version === '261005R1')!
      .files.sirind.divine;
    const published = readFileSync(path.join('public', file.url));
    const target = path.join(root, path.basename(file.url));
    writeFileSync(target, published);
    expect(await auditFirmwarePackagesAt(root)).toEqual([]);
    const contents = unzipSync(published);
    const name = Object.keys(contents).find((name) => name.endsWith('.json'))!;
    contents[name] = strToU8(
      JSON.stringify({...stock(), menus: ['qmk_lighting']}),
    );
    for (const [bytes, error] of [
      [zipSync(contents), 'qmk_lighting is forbidden'],
      [
        packageWith({board: {...stock(), matrix: {rows: 'invalid'}}}),
        'Invalid VIA V3 definition',
      ],
      [packageWith({board: stock()}), null],
    ] as const) {
      writeFileSync(target, bytes);
      const errors = await auditFirmwarePackagesAt(root);
      if (error) expect(errors.join('\n')).toContain(error);
      else expect(errors).toEqual([]);
    }
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
