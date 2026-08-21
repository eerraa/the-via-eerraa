import {expect, test} from 'bun:test';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dir, '..');

test('verify:firmware-contracts reads lock repository commit path as git objects', () => {
  const result = spawnSync('bun', ['run', 'verify:firmware-contracts'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: process.env,
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain(
    'Firmware contract qmk-eerraa: git object 0ac4a79bd039d1c35e859c67d77a241e024aadf8',
  );
  expect(result.stdout).toContain(
    'Firmware contract h7s: git object cd4473b7896549bb5481b873901da7fc8b5320e4',
  );
  expect(result.stdout).toContain(
    'Firmware contract verification complete: 3 ERA definitions.',
  );
  expect(result.stdout).not.toContain('raw.githubusercontent.com');
});
