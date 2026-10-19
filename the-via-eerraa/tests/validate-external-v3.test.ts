import {afterEach, describe, expect, test} from 'bun:test';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const scriptPath = 'scripts/validate-external-v3.ts';
const tempRoots: string[] = [];
const externalManifest = JSON.parse(
  readFileSync(
    path.join(repoRoot, 'config/external-definitions.manifest.json'),
    'utf8',
  ),
) as {
  definitions: {
    id: string;
    path: string;
    vendorId: string;
    productId: string;
  }[];
};

const tempRoot = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'via-external-v3-'));
  tempRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    if (!path.basename(root).startsWith('via-external-v3-')) {
      throw new Error(`Refusing to remove unexpected test path: ${root}`);
    }
    rmSync(root, {recursive: true, force: true});
  }
});

const definition = (name: string, productId: string, key = '0,0') => ({
  name,
  vendorId: '0x1234',
  productId,
  matrix: {rows: 1, cols: 1},
  layouts: {keymap: [[key]]},
});

const writeJSON = (root: string, name: string, value: unknown) => {
  const filePath = path.join(root, name);
  const source = JSON.stringify(value);
  writeFileSync(filePath, source, 'utf8');
  return {filePath, source};
};

const runValidator = (args: string[]) =>
  spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

describe('external VIA V3 validator', () => {
  test('emits one stable transformed summary per input path without editing inputs', () => {
    const root = tempRoot();
    const first = writeJSON(root, 'first.json', definition('First', '0x0001'));
    const second = writeJSON(
      root,
      'second path.json',
      definition('Second', '0x0002'),
    );
    const args = ['--format', 'json', '--', first.filePath, second.filePath];

    const firstRun = runValidator(args);
    const secondRun = runValidator(args);

    expect(firstRun.status).toBe(0);
    expect(firstRun.stderr).toBe('');
    expect(firstRun.stdout).toBe(secondRun.stdout);
    expect(JSON.parse(firstRun.stdout)).toEqual([
      {
        firmwareVersion: 0,
        name: 'First',
        ok: true,
        path: first.filePath,
        vendorProductId: 0x1234 * 0x10000 + 1,
      },
      {
        firmwareVersion: 0,
        name: 'Second',
        ok: true,
        path: second.filePath,
        vendorProductId: 0x1234 * 0x10000 + 2,
      },
    ]);
    expect(readFileSync(first.filePath, 'utf8')).toBe(first.source);
    expect(readFileSync(second.filePath, 'utf8')).toBe(second.source);
  });

  test('reports parse, schema, transform, and read errors in path order', () => {
    const root = tempRoot();
    const parsePath = path.join(root, 'parse.json');
    writeFileSync(parsePath, '{"name":', 'utf8');
    const schema = definition('Schema', '0x0002') as Record<string, unknown>;
    delete schema.productId;
    const schemaPath = writeJSON(root, 'schema.json', schema).filePath;
    const transformPath = writeJSON(
      root,
      'transform.json',
      definition('Transform', '0x0003', '1,0'),
    ).filePath;
    const missingPath = path.join(root, 'missing.json');

    const args = [
      '--format',
      'json',
      '--',
      parsePath,
      schemaPath,
      transformPath,
      missingPath,
    ];
    const result = runValidator(args);
    const repeated = runValidator(args);
    const records = JSON.parse(result.stdout) as Array<Record<string, unknown>>;

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(repeated.status).toBe(1);
    expect(result.stdout).toBe(repeated.stdout);
    expect(records.map(({path: inputPath}) => inputPath)).toEqual([
      parsePath,
      schemaPath,
      transformPath,
      missingPath,
    ]);
    expect(records.map(({ok, stage}) => ({ok, stage}))).toEqual([
      {ok: false, stage: 'parse'},
      {ok: false, stage: 'schema'},
      {ok: false, stage: 'transform'},
      {ok: false, stage: 'read'},
    ]);
    expect(records[1].errors).toBeArray();
    expect(records[1].errors).not.toHaveLength(0);
    expect(records[2].message).toContain('outside of dimension');
    expect(records[3].code).toBe('ENOENT');
  });

  test('requires the exact format separator and at least one path', () => {
    for (const args of [
      ['--format', 'json', 'file.json'],
      ['--format', 'json', '--'],
      ['--format', 'text', '--', 'file.json'],
    ]) {
      const result = runValidator(args);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe(
        'Usage: bun scripts/validate-external-v3.ts --format json -- <one-or-more JSON paths>\n',
      );
    }
  });
});

describe('managed external VIA V3 definitions', () => {
  test('keeps the Sirind inventory and VID-PID filenames explicit', () => {
    expect(externalManifest.definitions).toEqual([
      {
        id: 'sirind-tomak79l',
        path: 'era-definitions/external/v3/sirind/3151-4040.json',
        vendorId: '0x3151',
        productId: '0x4040',
      },
      {
        id: 'sirind-tomak79r',
        path: 'era-definitions/external/v3/sirind/3151-4047.json',
        vendorId: '0x3151',
        productId: '0x4047',
      },
      {
        id: 'sirind-brickex',
        path: 'era-definitions/external/v3/sirind/5352-4245.json',
        vendorId: '0x5352',
        productId: '0x4245',
      },
    ]);

    for (const entry of externalManifest.definitions) {
      const source = JSON.parse(
        readFileSync(path.join(repoRoot, entry.path), 'utf8'),
      ) as {vendorId: string; productId: string};
      expect(source.vendorId.toLowerCase()).toBe(entry.vendorId.toLowerCase());
      expect(source.productId.toLowerCase()).toBe(
        entry.productId.toLowerCase(),
      );
      expect(path.basename(entry.path)).toBe(
        `${entry.vendorId.slice(2)}-${entry.productId.slice(2)}.json`,
      );
    }
  });

  test('validates every managed source with the app reader', () => {
    const inputPaths = externalManifest.definitions.map(({path: inputPath}) =>
      path.join(repoRoot, inputPath),
    );
    const result = runValidator(['--format', 'json', '--', ...inputPaths]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual([
      {
        firmwareVersion: 0,
        name: 'TOMAK79L',
        ok: true,
        path: inputPaths[0],
        vendorProductId: 827408448,
      },
      {
        firmwareVersion: 0,
        name: 'TOMAK79R',
        ok: true,
        path: inputPaths[1],
        vendorProductId: 827408455,
      },
      {
        firmwareVersion: 0,
        name: 'S.R.Industry BrickEX',
        ok: true,
        path: inputPaths[2],
        vendorProductId: 1397899845,
      },
    ]);
  });
});
