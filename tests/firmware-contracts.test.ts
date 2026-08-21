import {expect, test} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dir, '..');
const lock = JSON.parse(
  readFileSync(
    path.join(projectRoot, 'config', 'era-definitions.lock.json'),
    'utf8',
  ),
) as {
  firmwareSources: Record<string, {commit: string}>;
  definitions: unknown[];
};

test('verify:firmware-contracts reads lock repository commit path as git objects', () => {
  const result = spawnSync('bun', ['run', 'verify:firmware-contracts'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: process.env,
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain(
    `Firmware contract qmk-eerraa: git object ${lock.firmwareSources['qmk-eerraa'].commit}`,
  );
  expect(result.stdout).toContain(
    `Firmware contract h7s: git object ${lock.firmwareSources.h7s.commit}`,
  );
  expect(result.stdout).toContain(
    `Firmware contract verification complete: ${lock.definitions.length} ERA definitions.`,
  );
  expect(result.stdout).not.toContain('raw.githubusercontent.com');
});
