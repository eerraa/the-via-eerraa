import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {KeyboardDefinitionV3, VIADefinitionV3} from '@the-via/reader';

type DefinitionVersion = 'v3';
type IdentityField = 'vendorId' | 'productId';

type FirmwareSource = {
  repository: string;
  commit: string;
};

type CMacroCheck = {
  type: 'cMacro';
  path: string;
  macro: string;
  matches: IdentityField;
};

type JSONPathCheck = {
  type: 'jsonPath';
  path: string;
  jsonPath: string[];
  matches: IdentityField;
};

type FirmwareCheck = CMacroCheck | JSONPathCheck;

type DefinitionEntry = {
  id: string;
  path: string;
  definitionVersion: DefinitionVersion;
  vendorId: string;
  productId: string;
  pair?: string;
  firmwareSource: string;
  firmwareChecks: FirmwareCheck[];
};

type DefinitionManifest = {
  schemaVersion: number;
  definitionSource: 'app-repository';
  officialDefinitions: {
    bunTag: string;
    outputCounts: Record<'v2' | 'v3', number>;
    indexCounts: Record<'v2' | 'v3', number>;
  };
  firmwareSources: Record<string, FirmwareSource>;
  definitions: DefinitionEntry[];
};

type DefinitionIndex = {
  generatedAt: number;
  version: string;
  theme: unknown;
  vendorProductIds: Record<'v2' | 'v3', number[]>;
};

type CompiledDefinition = {
  entry: DefinitionEntry;
  raw: KeyboardDefinitionV3;
  via: VIADefinitionV3;
};

const projectRoot = process.cwd();
const manifestPath = path.join(
  projectRoot,
  'config',
  'era-definitions.lock.json',
);
const definitionsOutputPath = path.join(projectRoot, 'public', 'definitions');
const eraDefinitionsRoot = path.join(projectRoot, 'era-definitions', 'v3');
const officialBuilderPath = path.join(
  projectRoot,
  'node_modules',
  'via-keyboards',
  'scripts',
  'build-all.ts',
);
const officialBunTagPath = path.join(
  projectRoot,
  'node_modules',
  'via-keyboards',
  '.bun-tag',
);

const firmwareFilePromises = new Map<string, Promise<string>>();
const localFirmwareRootsPath = path.join(
  projectRoot,
  'config',
  'era-firmware-sources.local.json',
);

const parseLocalRootMap = (value: unknown, label: string) => {
  invariant(isRecord(value), `${label} must be an object.`);
  const roots: Record<string, string> = {};
  for (const [sourceId, root] of Object.entries(value)) {
    invariant(
      typeof root === 'string' && root.length > 0,
      `${label}.${sourceId} must be a directory path.`,
    );
    roots[sourceId] = root;
  }
  return roots;
};

let localFirmwareRootsPromise: Promise<Record<string, string>> | undefined;

const loadLocalFirmwareRoots = () => {
  if (!localFirmwareRootsPromise) {
    localFirmwareRootsPromise = (async () => {
      const roots: Record<string, string> = {};
      const envJson = process.env.ERA_FIRMWARE_LOCAL_ROOTS;
      if (envJson && envJson.trim()) {
        Object.assign(
          roots,
          parseLocalRootMap(JSON.parse(envJson), 'ERA_FIRMWARE_LOCAL_ROOTS'),
        );
      }
      try {
        const fileRoots = parseLocalRootMap(
          JSON.parse(await readFile(localFirmwareRootsPath, 'utf8')),
          'config/era-firmware-sources.local.json',
        );
        for (const [sourceId, root] of Object.entries(fileRoots)) {
          if (!(sourceId in roots)) {
            roots[sourceId] = root;
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
      return roots;
    })();
  }
  return localFirmwareRootsPromise;
};

const localRootForSource = async (sourceId: string) => {
  const envName = `ERA_FIRMWARE_${sourceId
    .replace(/-/g, '_')
    .toUpperCase()}_ROOT`;
  const envRoot = process.env[envName];
  if (envRoot && envRoot.trim()) {
    return envRoot.trim();
  }
  const roots = await loadLocalFirmwareRoots();
  return roots[sourceId];
};

const runGit = (repoRoot: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: repoRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk as Buffer));
    child.stderr.on('data', (chunk) => stderr.push(chunk as Buffer));
    child.once('error', reject);
    child.once('close', (code) => {
      const out = Buffer.concat(stdout).toString('utf8');
      const err = Buffer.concat(stderr).toString('utf8').trim();
      if (code === 0) {
        resolve(out);
        return;
      }
      reject(
        new Error(
          `git ${args.join(' ')} failed in ${repoRoot} (${code})${
            err ? `: ${err}` : ''
          }.`,
        ),
      );
    });
  });

const normalizeGitRemoteUrl = (url: string) =>
  url
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/:/g, '/')
    .replace(/\.git$/u, '');

const assertLocalRepoMatchesLock = async (
  sourceId: string,
  source: FirmwareSource,
  repoRoot: string,
) => {
  const objectType = (await runGit(repoRoot, ['cat-file', '-t', source.commit]))
    .trim();
  invariant(
    objectType === 'commit',
    `${sourceId}: ${repoRoot} does not contain immutable commit ${source.commit}.`,
  );

  const remotes = await runGit(repoRoot, ['remote', '-v']);
  const expected = source.repository.toLowerCase();
  const matchesLockRepo = remotes.split(/\r?\n/).some((line) => {
    const url = line.trim().split(/\s+/)[1] ?? '';
    const normalized = normalizeGitRemoteUrl(url);
    return (
      normalized.includes(`/${expected}`) ||
      normalized.endsWith(`/${expected}`) ||
      normalized.endsWith(expected)
    );
  });
  invariant(
    matchesLockRepo,
    `${sourceId}: ${repoRoot} remotes do not identify ${source.repository}.`,
  );
};

const readFirmwareGitObject = async (
  sourceId: string,
  source: FirmwareSource,
  sourcePath: string,
  repoRoot: string,
) => {
  await assertLocalRepoMatchesLock(sourceId, source, repoRoot);
  const contents = await runGit(repoRoot, [
    'cat-file',
    '-p',
    `${source.commit}:${sourcePath}`,
  ]);
  console.log(
    `Firmware contract ${sourceId}: git object ${source.commit} ${sourcePath}`,
  );
  return contents.replace(/^\uFEFF/, '');
};

const githubFirmwareHeaders = () => {
  const headers: Record<string, string> = {
    'User-Agent': 'eerraa-the-via-definition-build',
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPositiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) > 0;

const isHexId = (value: unknown): value is string =>
  typeof value === 'string' && /^0x[0-9a-f]{4}$/i.test(value);

const parseId = (value: string) => Number.parseInt(value.slice(2), 16);

const vendorProductId = (vendorId: string, productId: string) =>
  parseId(vendorId) * 65536 + parseId(productId);

function validateRelativePath(
  value: unknown,
  label: string,
): asserts value is string {
  invariant(
    typeof value === 'string' && value.length > 0,
    `${label} is empty.`,
  );
  invariant(!value.includes('\\'), `${label} must use POSIX separators.`);
  invariant(!path.posix.isAbsolute(value), `${label} must be relative.`);
  invariant(
    !value.split('/').includes('..'),
    `${label} must not traverse outside its repository.`,
  );
}

function validateFirmwareCheck(
  check: unknown,
  definitionId: string,
  index: number,
): asserts check is FirmwareCheck {
  const label = `${definitionId}.firmwareChecks[${index}]`;
  invariant(isRecord(check), `${label} must be an object.`);
  invariant(
    check.matches === 'vendorId' || check.matches === 'productId',
    `${label}.matches is invalid.`,
  );
  validateRelativePath(check.path, `${label}.path`);

  if (check.type === 'cMacro') {
    invariant(
      typeof check.macro === 'string' && /^[A-Z0-9_]+$/.test(check.macro),
      `${label}.macro is invalid.`,
    );
    return;
  }

  invariant(check.type === 'jsonPath', `${label}.type is invalid.`);
  invariant(
    Array.isArray(check.jsonPath) &&
      check.jsonPath.length > 0 &&
      check.jsonPath.every((segment) =>
        Boolean(typeof segment === 'string' && segment.length),
      ),
    `${label}.jsonPath is invalid.`,
  );
}

function validateManifest(value: unknown): asserts value is DefinitionManifest {
  invariant(isRecord(value), 'Definition manifest must be an object.');
  invariant(value.schemaVersion === 2, 'Unsupported manifest schemaVersion.');
  invariant(
    value.definitionSource === 'app-repository',
    'definitionSource must be app-repository.',
  );
  invariant(
    isRecord(value.officialDefinitions),
    'officialDefinitions must be an object.',
  );
  invariant(
    typeof value.officialDefinitions.bunTag === 'string' &&
      value.officialDefinitions.bunTag.length > 0,
    'officialDefinitions.bunTag is invalid.',
  );

  for (const countGroup of ['outputCounts', 'indexCounts'] as const) {
    const counts = value.officialDefinitions[countGroup];
    invariant(
      isRecord(counts) &&
        isPositiveInteger(counts.v2) &&
        isPositiveInteger(counts.v3),
      `officialDefinitions.${countGroup} is invalid.`,
    );
  }

  invariant(
    isRecord(value.firmwareSources),
    'firmwareSources must be an object.',
  );
  invariant(
    Object.keys(value.firmwareSources).length > 0,
    'firmwareSources must not be empty.',
  );
  for (const [sourceId, source] of Object.entries(value.firmwareSources)) {
    invariant(isRecord(source), `${sourceId} source must be an object.`);
    invariant(
      typeof source.repository === 'string' &&
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repository),
      `${sourceId}.repository is invalid.`,
    );
    invariant(
      typeof source.commit === 'string' &&
        /^[0-9a-f]{40}$/i.test(source.commit),
      `${sourceId}.commit must be a full Git commit SHA.`,
    );
  }

  invariant(Array.isArray(value.definitions), 'definitions must be an array.');
  invariant(value.definitions.length > 0, 'definitions must not be empty.');
  const definitionIds = new Set<string>();
  for (const definition of value.definitions) {
    invariant(isRecord(definition), 'Each definition must be an object.');
    invariant(
      typeof definition.id === 'string' && /^[a-z0-9-]+$/.test(definition.id),
      'Definition id is invalid.',
    );
    const definitionId = definition.id;
    invariant(
      !definitionIds.has(definition.id),
      `Duplicate id: ${definition.id}`,
    );
    definitionIds.add(definition.id);
    validateRelativePath(definition.path, `${definition.id}.path`);
    invariant(
      definition.path.startsWith('era-definitions/v3/') &&
        /\.json$/i.test(definition.path),
      `${definition.id}.path must point to a JSON file under era-definitions/v3.`,
    );
    invariant(
      definition.definitionVersion === 'v3',
      `${definition.id} must use a V3 definition.`,
    );
    invariant(
      isHexId(definition.vendorId),
      `${definition.id}.vendorId is invalid.`,
    );
    invariant(
      isHexId(definition.productId),
      `${definition.id}.productId is invalid.`,
    );
    invariant(
      definition.pair === undefined ||
        (typeof definition.pair === 'string' && definition.pair.length > 0),
      `${definition.id}.pair is invalid.`,
    );
    invariant(
      typeof definition.firmwareSource === 'string' &&
        definition.firmwareSource in value.firmwareSources,
      `${definition.id}.firmwareSource is unknown.`,
    );
    invariant(
      Array.isArray(definition.firmwareChecks) &&
        definition.firmwareChecks.length > 0,
      `${definition.id}.firmwareChecks must be a non-empty array.`,
    );
    definition.firmwareChecks.forEach((check, index) =>
      validateFirmwareCheck(check, definitionId, index),
    );
  }
}

const loadManifest = async () => {
  const value: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  validateManifest(value);
  return value;
};

const firmwareSourceUrl = (source: FirmwareSource, sourcePath: string) => {
  const encodedPath = sourcePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `https://raw.githubusercontent.com/${source.repository}/${source.commit}/${encodedPath}`;
};

const readFirmwareFile = (
  sourceId: string,
  source: FirmwareSource,
  sourcePath: string,
) => {
  const cacheKey = `${sourceId}:${source.commit}:${sourcePath}`;
  const pending = firmwareFilePromises.get(cacheKey);
  if (pending) {
    return pending;
  }

  const request = (async () => {
    const localRoot = await localRootForSource(sourceId);
    if (localRoot) {
      return readFirmwareGitObject(sourceId, source, sourcePath, localRoot);
    }

    const response = await fetch(firmwareSourceUrl(source, sourcePath), {
      headers: githubFirmwareHeaders(),
      signal: AbortSignal.timeout(30_000),
    });
    invariant(
      response.ok,
      `Failed to fetch ${sourceId}:${sourcePath} (${response.status} ${response.statusText}). Provide GITHUB_TOKEN for private GitHub raw access, or set ERA_FIRMWARE_LOCAL_ROOTS / config/era-firmware-sources.local.json to a clone that contains lock commit ${source.commit}.`,
    );
    console.log(
      `Firmware contract ${sourceId}: GitHub ${source.repository}@${source.commit} ${sourcePath}`,
    );
    return (await response.text()).replace(/^\uFEFF/, '');
  })();
  firmwareFilePromises.set(cacheKey, request);
  return request;
};

const parseNumericValue = (value: unknown, label: string) => {
  invariant(
    typeof value === 'string' || typeof value === 'number',
    `${label} must be numeric.`,
  );
  const match = String(value).match(/0x[0-9a-f]+|\d+/i);
  invariant(match, `${label} does not contain a numeric value.`);
  return Number.parseInt(
    match[0],
    match[0].toLowerCase().startsWith('0x') ? 16 : 10,
  );
};

const resolveJSONPath = (value: unknown, segments: string[], label: string) => {
  let current = value;
  for (const segment of segments) {
    invariant(isRecord(current) && segment in current, `${label} is missing.`);
    current = current[segment];
  }
  return current;
};

const validateFirmwareIdentity = async (
  manifest: DefinitionManifest,
  entry: DefinitionEntry,
) => {
  const source = manifest.firmwareSources[entry.firmwareSource];
  for (const check of entry.firmwareChecks) {
    const contents = await readFirmwareFile(
      entry.firmwareSource,
      source,
      check.path,
    );
    const expected = parseId(entry[check.matches]);
    let actual: number;

    if (check.type === 'cMacro') {
      const escapedMacro = check.macro.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = contents.match(
        new RegExp(`^\\s*#\\s*define\\s+${escapedMacro}\\s+([^\\r\\n]+)`, 'm'),
      );
      invariant(match, `${entry.id}: macro ${check.macro} was not found.`);
      actual = parseNumericValue(match[1], `${entry.id}:${check.macro}`);
    } else {
      const json: unknown = JSON.parse(contents);
      actual = parseNumericValue(
        resolveJSONPath(
          json,
          check.jsonPath,
          `${entry.id}:${check.jsonPath.join('.')}`,
        ),
        `${entry.id}:${check.jsonPath.join('.')}`,
      );
    }

    invariant(
      actual === expected,
      `${entry.id}: firmware ${check.matches} 0x${actual
        .toString(16)
        .padStart(4, '0')} does not match manifest ${entry[check.matches]}.`,
    );
  }
};

const resolveLocalDefinitionPath = async (entry: DefinitionEntry) => {
  const relativePath = entry.path.split('/');
  let currentPath = projectRoot;
  for (const segment of relativePath) {
    const entries = await readdir(currentPath);
    invariant(
      entries.includes(segment),
      `${entry.id}: local definition path is missing or has incorrect casing: ${entry.path}`,
    );
    currentPath = path.join(currentPath, segment);
  }

  const relativeToDefinitionsRoot = path.relative(
    eraDefinitionsRoot,
    currentPath,
  );
  invariant(
    relativeToDefinitionsRoot.length > 0 &&
      !relativeToDefinitionsRoot.startsWith(`..${path.sep}`) &&
      relativeToDefinitionsRoot !== '..' &&
      !path.isAbsolute(relativeToDefinitionsRoot),
    `${entry.id}: local definition must stay under era-definitions/v3.`,
  );
  return currentPath;
};

const compileDefinition = async (
  entry: DefinitionEntry,
): Promise<CompiledDefinition> => {
  const definitionPath = await resolveLocalDefinitionPath(entry);
  const contents = (await readFile(definitionPath, 'utf8')).replace(
    /^\uFEFF/,
    '',
  );
  const raw: unknown = JSON.parse(contents);
  invariant(isRecord(raw), `${entry.id}: definition must be an object.`);
  invariant(
    String(raw.vendorId).toLowerCase() === entry.vendorId.toLowerCase(),
    `${entry.id}: vendorId does not match the manifest.`,
  );
  invariant(
    String(raw.productId).toLowerCase() === entry.productId.toLowerCase(),
    `${entry.id}: productId does not match the manifest.`,
  );

  let via: VIADefinitionV3;
  try {
    const {keyboardDefinitionV3ToVIADefinitionV3} =
      await import('@the-via/reader');
    via = keyboardDefinitionV3ToVIADefinitionV3(raw as KeyboardDefinitionV3);
  } catch (error) {
    throw new Error(`${entry.id}: VIA V3 validation failed.`, {cause: error});
  }

  const expectedVendorProductId = vendorProductId(
    entry.vendorId,
    entry.productId,
  );
  invariant(
    via.vendorProductId === expectedVendorProductId,
    `${entry.id}: generated VPID ${via.vendorProductId} does not match ${expectedVendorProductId}.`,
  );
  return {entry, raw: raw as KeyboardDefinitionV3, via};
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};

const canonicalJSON = (value: unknown) => JSON.stringify(canonicalize(value));

const pairComparableDefinition = (definition: KeyboardDefinitionV3) => {
  const {name: _name, productId: _productId, ...comparable} = definition;
  return comparable;
};

const validatePairs = (definitions: CompiledDefinition[]) => {
  const pairs = definitions.reduce<Record<string, CompiledDefinition[]>>(
    (acc, definition) => {
      const pair = definition.entry.pair;
      if (pair) {
        acc[pair] = [...(acc[pair] ?? []), definition];
      }
      return acc;
    },
    {},
  );

  for (const [pair, members] of Object.entries(pairs)) {
    invariant(
      members.length === 2,
      `${pair}: expected exactly two pair members.`,
    );
    const [first, second] = members;
    invariant(
      canonicalJSON(pairComparableDefinition(first.raw)) ===
        canonicalJSON(pairComparableDefinition(second.raw)),
      `${pair}: paired definitions differ beyond name and productId.`,
    );
  }
};

const runOfficialBuilder = () =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', officialBuilderPath, definitionsOutputPath],
      {cwd: projectRoot, stdio: 'inherit'},
    );
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Official definition builder failed (${signal ? `signal ${signal}` : `exit ${code}`}).`,
        ),
      );
    });
  });

const countJSONFiles = async (directory: string) =>
  (await readdir(directory, {withFileTypes: true})).filter(
    (entry) => entry.isFile() && entry.name.endsWith('.json'),
  ).length;

const readJSON = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await readFile(filePath, 'utf8')) as T;

const validateOfficialOutput = async (manifest: DefinitionManifest) => {
  const bunTag = (await readFile(officialBunTagPath, 'utf8')).trim();
  invariant(
    bunTag === manifest.officialDefinitions.bunTag,
    `via-keyboards changed from ${manifest.officialDefinitions.bunTag} to ${bunTag}; update the lock manifest and patch deliberately.`,
  );

  const outputCounts = {
    v2: await countJSONFiles(path.join(definitionsOutputPath, 'v2')),
    v3: await countJSONFiles(path.join(definitionsOutputPath, 'v3')),
  };
  invariant(
    outputCounts.v2 === manifest.officialDefinitions.outputCounts.v2 &&
      outputCounts.v3 === manifest.officialDefinitions.outputCounts.v3,
    `Official definition output count mismatch: expected ${JSON.stringify(
      manifest.officialDefinitions.outputCounts,
    )}, received ${JSON.stringify(outputCounts)}.`,
  );

  const index = await readJSON<DefinitionIndex>(
    path.join(definitionsOutputPath, 'supported_kbs.json'),
  );
  const indexCounts = {
    v2: index.vendorProductIds.v2.length,
    v3: index.vendorProductIds.v3.length,
  };
  invariant(
    indexCounts.v2 === manifest.officialDefinitions.indexCounts.v2 &&
      indexCounts.v3 === manifest.officialDefinitions.indexCounts.v3,
    `Official definition index count mismatch: expected ${JSON.stringify(
      manifest.officialDefinitions.indexCounts,
    )}, received ${JSON.stringify(indexCounts)}.`,
  );
  return index;
};

const outputDefinitionIds = async (version: 'v2' | 'v3') =>
  new Set(
    (
      await readdir(path.join(definitionsOutputPath, version), {
        withFileTypes: true,
      })
    )
      .filter((entry) => entry.isFile() && /^\d+\.json$/.test(entry.name))
      .map((entry) => Number.parseInt(entry.name.slice(0, -5), 10)),
  );

const writeEraOverlay = async (
  manifest: DefinitionManifest,
  officialIndex: DefinitionIndex,
) => {
  const definitions = await Promise.all(
    manifest.definitions.map((entry) => compileDefinition(entry)),
  );
  validatePairs(definitions);

  const officialV2Ids = await outputDefinitionIds('v2');
  const officialV3Ids = await outputDefinitionIds('v3');
  const eraIds = new Set<number>();
  for (const definition of definitions) {
    const id = definition.via.vendorProductId;
    invariant(
      !eraIds.has(id),
      `${definition.entry.id}: duplicate ERA VPID ${id}.`,
    );
    invariant(
      !officialV2Ids.has(id) && !officialV3Ids.has(id),
      `${definition.entry.id}: VPID ${id} conflicts with an official VIA definition.`,
    );
    eraIds.add(id);
  }

  await Promise.all(
    definitions.map((definition) =>
      writeFile(
        path.join(
          definitionsOutputPath,
          'v3',
          `${definition.via.vendorProductId}.json`,
        ),
        JSON.stringify(definition.via),
      ),
    ),
  );

  const mergedIndex: DefinitionIndex = {
    ...officialIndex,
    vendorProductIds: {
      v2: officialIndex.vendorProductIds.v2,
      v3: [...officialIndex.vendorProductIds.v3, ...eraIds].sort(
        (a, b) => a - b,
      ),
    },
  };
  await writeFile(
    path.join(definitionsOutputPath, 'supported_kbs.json'),
    JSON.stringify(mergedIndex),
  );

  const namesPath = path.join(definitionsOutputPath, 'keyboard_names.json');
  const officialNames = await readJSON<unknown[]>(namesPath);
  invariant(
    officialNames.every((name) => typeof name === 'string'),
    'Official keyboard names must be strings.',
  );
  const eraNames = definitions.map((definition) => definition.via.name);
  invariant(
    eraNames.every((name) => typeof name === 'string'),
    'ERA definitions must currently use static string names.',
  );
  const mergedNames = Array.from(
    new Set([...officialNames, ...(eraNames as string[])]),
  ).sort();
  await writeFile(namesPath, JSON.stringify(mergedNames));

  const officialHash = await readJSON<string>(
    path.join(definitionsOutputPath, 'hash.json'),
  );
  const {generatedAt: _generatedAt, ...stableIndex} = mergedIndex;
  const eraSourceMetadata = definitions.map(({entry, via}) => ({
    id: entry.id,
    path: entry.path,
    firmwareSource: entry.firmwareSource,
    firmwareRepository:
      manifest.firmwareSources[entry.firmwareSource].repository,
    firmwareCommit: manifest.firmwareSources[entry.firmwareSource].commit,
    vendorProductId: via.vendorProductId,
    name: via.name,
  }));
  const combinedHash = createHash('sha256')
    .update(
      canonicalJSON({
        officialHash,
        stableIndex,
        definitions: definitions.map(({via}) => via),
      }),
    )
    .digest('hex');
  await writeFile(
    path.join(definitionsOutputPath, 'hash.json'),
    JSON.stringify(combinedHash),
  );
  await writeFile(
    path.join(definitionsOutputPath, 'era_definition_sources.json'),
    JSON.stringify({
      schemaVersion: manifest.schemaVersion,
      definitions: eraSourceMetadata,
    }),
  );

  for (const definition of definitions) {
    console.log(
      `Added ERA definition ${definition.entry.id}: ${definition.via.vendorProductId} (${definition.entry.path})`,
    );
  }
  return {definitions, mergedIndex};
};

const verifyFirmwareContracts = async (manifest: DefinitionManifest) => {
  await Promise.all(
    manifest.definitions.map((entry) =>
      validateFirmwareIdentity(manifest, entry),
    ),
  );
  console.log(
    `Firmware contract verification complete: ${manifest.definitions.length} ERA definitions.`,
  );
};

const validateFinalOutput = async (
  manifest: DefinitionManifest,
  definitions: CompiledDefinition[],
  mergedIndex: DefinitionIndex,
) => {
  const expectedOutputCounts = {
    v2: manifest.officialDefinitions.outputCounts.v2,
    v3: manifest.officialDefinitions.outputCounts.v3 + definitions.length,
  };
  const actualOutputCounts = {
    v2: await countJSONFiles(path.join(definitionsOutputPath, 'v2')),
    v3: await countJSONFiles(path.join(definitionsOutputPath, 'v3')),
  };
  invariant(
    actualOutputCounts.v2 === expectedOutputCounts.v2 &&
      actualOutputCounts.v3 === expectedOutputCounts.v3,
    `Final definition output count mismatch: expected ${JSON.stringify(
      expectedOutputCounts,
    )}, received ${JSON.stringify(actualOutputCounts)}.`,
  );

  const expectedIndexCounts = {
    v2: manifest.officialDefinitions.indexCounts.v2,
    v3: manifest.officialDefinitions.indexCounts.v3 + definitions.length,
  };
  const actualIndexCounts = {
    v2: mergedIndex.vendorProductIds.v2.length,
    v3: mergedIndex.vendorProductIds.v3.length,
  };
  invariant(
    actualIndexCounts.v2 === expectedIndexCounts.v2 &&
      actualIndexCounts.v3 === expectedIndexCounts.v3,
    `Final definition index count mismatch: expected ${JSON.stringify(
      expectedIndexCounts,
    )}, received ${JSON.stringify(actualIndexCounts)}.`,
  );

  for (const definition of definitions) {
    const outputPath = path.join(
      definitionsOutputPath,
      'v3',
      `${definition.via.vendorProductId}.json`,
    );
    const output = await readJSON<VIADefinitionV3>(outputPath);
    invariant(
      output.vendorProductId === definition.via.vendorProductId &&
        output.name === definition.via.name,
      `${definition.entry.id}: generated output identity is invalid.`,
    );
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  invariant(
    args.every((arg) => arg === '--verify-firmware-contracts'),
    `Unknown argument: ${args.find(
      (arg) => arg !== '--verify-firmware-contracts',
    )}`,
  );
  invariant(
    path.resolve(definitionsOutputPath) ===
      path.resolve(projectRoot, 'public', 'definitions'),
    'Refusing to remove an unexpected definitions output directory.',
  );
  const manifest = await loadManifest();
  if (args.includes('--verify-firmware-contracts')) {
    await verifyFirmwareContracts(manifest);
    return;
  }
  await rm(definitionsOutputPath, {recursive: true, force: true});
  await mkdir(definitionsOutputPath, {recursive: true});
  await runOfficialBuilder();
  const officialIndex = await validateOfficialOutput(manifest);
  const {definitions, mergedIndex} = await writeEraOverlay(
    manifest,
    officialIndex,
  );
  await validateFinalOutput(manifest, definitions, mergedIndex);
  console.log(
    `Definition build complete: ${mergedIndex.vendorProductIds.v2.length} V2 index entries, ${mergedIndex.vendorProductIds.v3.length} V3-only index entries, ${definitions.length} ERA definitions.`,
  );
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
