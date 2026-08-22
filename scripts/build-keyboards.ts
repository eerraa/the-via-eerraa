import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {access, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {KeyboardDefinitionV3} from '@the-via/reader';
import {
  isTapDanceKeycodeName,
  parseEraV3Definition,
  type EraVIADefinitionV3,
} from '../src/utils/era-definition';
import {
  isExactTermCommand,
  isLegacyTermCommand,
} from '../src/utils/era-exact-ms';

type ExactMsFamily = 'qmk' | 'h7s';

type DefinitionEntry = {
  id: string;
  path: string;
  vendorId: string;
  productId: string;
  pair?: string;
  stateSync: boolean;
  exactMsFamily?: ExactMsFamily;
};

type DefinitionManifest = {
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
  via: EraVIADefinitionV3;
};

const projectRoot = process.cwd();
const manifestPath = path.join(
  projectRoot,
  'config',
  'era-definitions.manifest.json',
);
const definitionsOutputPath = path.join(projectRoot, 'public', 'definitions');
const eraDefinitionsRoot = path.join(projectRoot, 'era-definitions');
const customDefinitionsRoot = path.join(eraDefinitionsRoot, 'custom', 'v3');
const officialBuilderPath = path.join(
  projectRoot,
  'node_modules',
  'via-keyboards',
  'scripts',
  'build-all.ts',
);

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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

function validateManifest(value: unknown): asserts value is DefinitionManifest {
  invariant(isRecord(value), 'Definition manifest must be an object.');
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
      definition.path.startsWith('era-definitions/custom/v3/') &&
        /\.json$/i.test(definition.path),
      `${definition.id}.path must point to a JSON file under era-definitions/custom/v3.`,
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
      typeof definition.stateSync === 'boolean',
      `${definition.id}.stateSync must be a boolean.`,
    );
    invariant(
      definition.exactMsFamily === undefined ||
        definition.exactMsFamily === 'qmk' ||
        definition.exactMsFamily === 'h7s',
      `${definition.id}.exactMsFamily must be qmk or h7s.`,
    );
  }
}

const loadManifest = async () => {
  const value: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  validateManifest(value);
  return value;
};

type TermControlRef = {
  name: string;
  type: string;
  channel: number;
  id: number;
  options: unknown;
};

const collectMenuControls = (
  value: unknown,
  into: TermControlRef[] = [],
): TermControlRef[] => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectMenuControls(item, into));
    return into;
  }
  if (!isRecord(value)) {
    return into;
  }
  const {content, options, type} = value;
  if (
    typeof type === 'string' &&
    Array.isArray(content) &&
    typeof content[0] === 'string' &&
    typeof content[1] === 'number' &&
    typeof content[2] === 'number'
  ) {
    into.push({
      name: content[0],
      type,
      channel: content[1],
      id: content[2],
      options,
    });
    return into;
  }
  if (Array.isArray(content)) {
    collectMenuControls(content, into);
  }
  return into;
};

const assertUnderRoot = (
  filePath: string,
  root: string,
  label: string,
  expectedPrefix: string,
) => {
  const relativeToRoot = path.relative(root, filePath);
  invariant(
    relativeToRoot.length > 0 &&
      !relativeToRoot.startsWith(`..${path.sep}`) &&
      relativeToRoot !== '..' &&
      !path.isAbsolute(relativeToRoot),
    `${label}: local definition must stay under ${expectedPrefix}.`,
  );
};

const resolveRepoPath = async (relativePath: string, label: string) => {
  const segments = relativePath.split('/');
  let currentPath = projectRoot;
  for (const segment of segments) {
    const entries = await readdir(currentPath);
    invariant(
      entries.includes(segment),
      `${label}: local definition path is missing or has incorrect casing: ${relativePath}`,
    );
    currentPath = path.join(currentPath, segment);
  }
  return currentPath;
};

const resolveCustomDefinitionPath = async (entry: DefinitionEntry) => {
  const currentPath = await resolveRepoPath(entry.path, `${entry.id}.path`);
  assertUnderRoot(
    currentPath,
    customDefinitionsRoot,
    `${entry.id}.path`,
    'era-definitions/custom/v3',
  );
  return currentPath;
};

const readDefinitionJSON = async (filePath: string, label: string) => {
  const contents = (await readFile(filePath, 'utf8')).replace(/^\uFEFF/, '');
  const raw: unknown = JSON.parse(contents);
  invariant(isRecord(raw), `${label}: definition must be an object.`);
  return raw;
};

const termKey = (control: TermControlRef) =>
  `${control.name}:${control.channel}:${control.id}`;

const expectedTermKeys = (family: ExactMsFamily) => {
  const tapDanceChannel = family === 'qmk' ? 0 : 16;
  const exactBase = family === 'qmk' ? 72 : 41;
  return [
    'id_qmk_tapping_global_term_exact:15:5',
    ...Array.from(
      {length: 8},
      (_, index) =>
        `id_qmk_tapdance_${index + 1}_term_exact:${tapDanceChannel}:${
          exactBase + index
        }`,
    ),
  ].sort();
};

const tapDanceActionNames = ['tap', 'hold', 'dtap', 'thold'] as const;
const expectedTapDanceActionKeys = (family: ExactMsFamily) =>
  Array.from({length: 8}, (_, index) =>
    tapDanceActionNames.map((action, offset) =>
      [
        `id_qmk_tapdance_${index + 1}_${action}`,
        family === 'qmk' ? 0 : 16,
        (family === 'qmk' ? 32 : 1) + index * 5 + offset,
      ].join(':'),
    ),
  )
    .flat()
    .sort();

const keycodeName = (item: unknown) =>
  item && typeof item === 'object' && 'name' in item
    ? String((item as {name: unknown}).name)
    : '';

const validateCustomDefinitionContract = (
  entry: DefinitionEntry,
  customRaw: Record<string, unknown>,
) => {
  const menuControls = collectMenuControls(customRaw.menus);
  const customTerms = menuControls.filter(
    ({name}) => isExactTermCommand(name) || isLegacyTermCommand(name),
  );
  const customLegacy = customTerms.filter(({name}) =>
    isLegacyTermCommand(name),
  );
  invariant(
    customLegacy.length === 0,
    `${entry.id}: custom definitions must not expose legacy tapping-term dropdowns.`,
  );

  if (entry.exactMsFamily) {
    const expected = expectedTermKeys(entry.exactMsFamily);
    const customExactKeys = customTerms
      .filter((control) => isExactTermCommand(control.name))
      .map(termKey)
      .sort();
    invariant(
      customExactKeys.join('|') === expected.join('|'),
      `${entry.id}: ${entry.exactMsFamily} exact-ms command addresses are invalid.`,
    );
  } else {
    invariant(
      customTerms.length === 0,
      `${entry.id}: term controls require an exactMsFamily contract.`,
    );
  }

  const expectedExactOptions =
    entry.exactMsFamily === 'qmk' ? [1, 65535] : [100, 500];
  for (const control of customTerms) {
    if (isExactTermCommand(control.name)) {
      invariant(
        control.type === 'range',
        `${entry.id}: custom ${control.name} must be a range control.`,
      );
      invariant(
        Array.isArray(control.options) &&
          control.options[0] === expectedExactOptions[0] &&
          control.options[1] === expectedExactOptions[1],
        `${entry.id}: custom ${control.name} options must be [${expectedExactOptions.join(', ')}].`,
      );
    }
  }

  const tapDanceControls = menuControls.filter(({name}) =>
    name.startsWith('id_qmk_tapdance_'),
  );
  invariant(
    entry.exactMsFamily || tapDanceControls.length === 0,
    `${entry.id}: Tap Dance controls require an exactMsFamily contract.`,
  );
  const tapDanceActions = tapDanceControls.filter(({name}) =>
    /^id_qmk_tapdance_[1-8]_(?:tap|hold|dtap|thold)$/.test(name),
  );
  const expectedTapDanceActions = entry.exactMsFamily
    ? expectedTapDanceActionKeys(entry.exactMsFamily)
    : [];
  invariant(
    tapDanceActions.map(termKey).sort().join('|') ===
      expectedTapDanceActions.join('|') &&
      tapDanceActions.every(({type}) => type === 'keycode'),
    `${entry.id}: Tap Dance action controls or command addresses are invalid.`,
  );
  const tappingToggles = menuControls.filter(({name}) =>
      [
        'id_qmk_tapping_permissive_hold',
        'id_qmk_tapping_hold_on_other_key_press',
        'id_qmk_tapping_retro_tapping',
      ].includes(name),
    );
  const tappingToggleKeys = tappingToggles.map(termKey).sort();
  const expectedTappingToggleKeys = entry.exactMsFamily
    ? [
        'id_qmk_tapping_permissive_hold:15:2',
        'id_qmk_tapping_hold_on_other_key_press:15:3',
        'id_qmk_tapping_retro_tapping:15:4',
      ].sort()
    : [];
  invariant(
    tappingToggleKeys.join('|') === expectedTappingToggleKeys.join('|') &&
      tappingToggles.every(({type}) => type === 'toggle'),
    `${entry.id}: non-term tapping toggles or command addresses are invalid.`,
  );

  invariant(
    customRaw.customKeycodes === undefined ||
      (Array.isArray(customRaw.customKeycodes) &&
        customRaw.customKeycodes.length > 0),
    `${entry.id}: customKeycodes must be omitted when empty.`,
  );
  invariant(
    customRaw.tapdanceKeycodes === undefined ||
      (Array.isArray(customRaw.tapdanceKeycodes) &&
        customRaw.tapdanceKeycodes.length > 0),
    `${entry.id}: tapdanceKeycodes must be omitted when empty.`,
  );
  const customCustom = Array.isArray(customRaw.customKeycodes)
    ? customRaw.customKeycodes
    : [];
  const customTapdance = Array.isArray(customRaw.tapdanceKeycodes)
    ? customRaw.tapdanceKeycodes
    : [];
  const customTdNames = customTapdance
    .map(keycodeName)
    .filter(isTapDanceKeycodeName)
    .sort();
  invariant(
    customTdNames.length === customTapdance.length,
    `${entry.id}: tapdanceKeycodes may contain only TD0-TD7 entries.`,
  );
  const leakedTd = customCustom.map(keycodeName).filter(isTapDanceKeycodeName);
  invariant(
    leakedTd.length === 0,
    `${entry.id}: custom JSON must put tap dance keycodes in tapdanceKeycodes, not customKeycodes.`,
  );
  const expectedTapDanceNames = entry.exactMsFamily
    ? Array.from({length: 8}, (_, index) => `TD${index}`)
    : [];
  invariant(
    customTdNames.join('|') === expectedTapDanceNames.join('|'),
    `${entry.id}: tap dance slot identity must be ${
      entry.exactMsFamily ? 'TD0-TD7' : 'empty'
    }.`,
  );
};

const compileDefinition = async (
  entry: DefinitionEntry,
): Promise<CompiledDefinition> => {
  const definitionPath = await resolveCustomDefinitionPath(entry);
  const raw = await readDefinitionJSON(definitionPath, `${entry.id}.path`);
  invariant(
    String(raw.vendorId).toLowerCase() === entry.vendorId.toLowerCase(),
    `${entry.id}: vendorId does not match the manifest.`,
  );
  invariant(
    String(raw.productId).toLowerCase() === entry.productId.toLowerCase(),
    `${entry.id}: productId does not match the manifest.`,
  );
  validateCustomDefinitionContract(entry, raw);

  let via: EraVIADefinitionV3;
  try {
    via = parseEraV3Definition(raw);
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

type DirectorySnapshot = {count: number; digest: string};
type OfficialSnapshot = Record<'v2' | 'v3', DirectorySnapshot>;

const snapshotJSONDirectory = async (
  directory: string,
): Promise<DirectorySnapshot> => {
  const names = (await readdir(directory, {withFileTypes: true}))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map(({name}) => name)
    .sort();
  const digest = createHash('sha256');
  for (const name of names) {
    digest.update(name);
    digest.update(await readFile(path.join(directory, name)));
  }
  return {count: names.length, digest: digest.digest('hex')};
};

const snapshotOfficialOutput = async (): Promise<OfficialSnapshot> => ({
  v2: await snapshotJSONDirectory(path.join(definitionsOutputPath, 'v2')),
  v3: await snapshotJSONDirectory(path.join(definitionsOutputPath, 'v3')),
});

const readJSON = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await readFile(filePath, 'utf8')) as T;

const validateOfficialOutput = async () => {
  const snapshot = await snapshotOfficialOutput();
  invariant(
    snapshot.v2.count > 0 && snapshot.v3.count > 0,
    'Installed via-keyboards snapshot produced an empty official bundle.',
  );
  const index = await readJSON<DefinitionIndex>(
    path.join(definitionsOutputPath, 'supported_kbs.json'),
  );
  for (const version of ['v2', 'v3'] as const) {
    const ids = index.vendorProductIds[version];
    invariant(
      Array.isArray(ids) && ids.length > 0,
      `Installed via-keyboards ${version} index is empty.`,
    );
    invariant(
      new Set(ids).size === ids.length,
      `Installed via-keyboards ${version} index contains duplicate VPIDs.`,
    );
  }
  return {index, snapshot};
};

const writeEraOverlay = async (
  manifest: DefinitionManifest,
  officialIndex: DefinitionIndex,
) => {
  const definitions = await Promise.all(
    manifest.definitions.map((entry) => compileDefinition(entry)),
  );
  validatePairs(definitions);

  const eraIds = new Set<number>();
  for (const definition of definitions) {
    const id = definition.via.vendorProductId;
    invariant(
      !eraIds.has(id),
      `${definition.entry.id}: duplicate ERA VPID ${id}.`,
    );
    eraIds.add(id);
  }

  const eraOutputDir = path.join(definitionsOutputPath, 'era', 'v3');
  await mkdir(eraOutputDir, {recursive: true});
  await Promise.all(
    definitions.map(async (definition) => {
      const vpid = definition.via.vendorProductId;
      await writeFile(
        path.join(eraOutputDir, `${vpid}.json`),
        JSON.stringify(definition.via),
      );
    }),
  );

  const mergedIndex: DefinitionIndex = {
    ...officialIndex,
    vendorProductIds: {
      v2: officialIndex.vendorProductIds.v2,
      v3: Array.from(
        new Set([...officialIndex.vendorProductIds.v3, ...eraIds]),
      ).sort((a, b) => a - b),
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
    path.join(definitionsOutputPath, 'era_advanced.json'),
    JSON.stringify({
      schemaVersion: 1,
      definitions: definitions.map(({entry, via}) => ({
        id: entry.id,
        vendorProductId: via.vendorProductId,
        stateSync: entry.stateSync === true,
        exactMsFamily: entry.exactMsFamily ?? null,
      })),
    }),
  );

  for (const definition of definitions) {
    console.log(
      `Added ERA definition ${definition.entry.id}: ${definition.via.vendorProductId} (${definition.entry.path})`,
    );
  }
  return {definitions, mergedIndex};
};

const validateFinalOutput = async (
  definitions: CompiledDefinition[],
  mergedIndex: DefinitionIndex,
  officialIndex: DefinitionIndex,
  officialSnapshot: OfficialSnapshot,
) => {
  const finalOfficialSnapshot = await snapshotOfficialOutput();
  invariant(
    canonicalJSON(finalOfficialSnapshot) === canonicalJSON(officialSnapshot),
    'ERA overlay changed, removed, or added an official definition file.',
  );

  const expectedIndex = {
    v2: officialIndex.vendorProductIds.v2,
    v3: Array.from(
      new Set([
        ...officialIndex.vendorProductIds.v3,
        ...definitions.map(({via}) => via.vendorProductId),
      ]),
    ).sort((a, b) => a - b),
  };
  const outputIndex = await readJSON<DefinitionIndex>(
    path.join(definitionsOutputPath, 'supported_kbs.json'),
  );
  invariant(
    canonicalJSON(outputIndex.vendorProductIds) === canonicalJSON(expectedIndex) &&
      canonicalJSON(mergedIndex.vendorProductIds) === canonicalJSON(expectedIndex),
    'Final definition index is not the unique official/ERA VPID union.',
  );

  const eraOutputCount = await countJSONFiles(
    path.join(definitionsOutputPath, 'era', 'v3'),
  );
  invariant(
    eraOutputCount === definitions.length,
    `ERA definition output count mismatch: expected ${definitions.length}, received ${eraOutputCount}.`,
  );

  for (const definition of definitions) {
    const outputPath = path.join(
      definitionsOutputPath,
      'era',
      'v3',
      `${definition.via.vendorProductId}.json`,
    );
    const output = await readJSON<EraVIADefinitionV3>(outputPath);
    invariant(
      output.vendorProductId === definition.via.vendorProductId &&
        output.name === definition.via.name,
      `${definition.entry.id}: generated output identity is invalid.`,
    );
    validateCustomDefinitionContract(
      definition.entry,
      output as unknown as Record<string, unknown>,
    );
    const expectedTapDanceCount = definition.entry.exactMsFamily ? 8 : 0;
    invariant(
      (output.tapdanceKeycodes?.length ?? 0) === expectedTapDanceCount,
      `${definition.entry.id}: custom output tapdanceKeycodes count must be ${expectedTapDanceCount}.`,
    );
  }
};

const pathExists = async (filePath: string) => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const listJSONFilesRecursively = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, {withFileTypes: true});
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return listJSONFilesRecursively(entryPath);
      }
      return entry.isFile() && /\.json$/i.test(entry.name) ? [entryPath] : [];
    }),
  );
  return nested.flat();
};

const validateSourceInventory = async (manifest: DefinitionManifest) => {
  const expected = manifest.definitions.map(({path: definitionPath}) =>
    definitionPath.replaceAll('\\', '/'),
  );
  const actual = (await listJSONFilesRecursively(customDefinitionsRoot)).map(
    (filePath) => path.relative(projectRoot, filePath).replaceAll('\\', '/'),
  );
  expected.sort();
  actual.sort();
  invariant(
    expected.join('|') === actual.join('|'),
    `Custom definition manifest/source inventory differs: expected ${expected.length}, found ${actual.length}.`,
  );
};

const validateForbiddenOutputsAbsent = async () => {
  invariant(
    !(await pathExists(path.join(eraDefinitionsRoot, 'v3'))),
    'era-definitions/v3 must not exist; official definitions come from via-keyboards.',
  );
  invariant(
    !(await pathExists(
      path.join(definitionsOutputPath, 'era_definition_sources.json'),
    )),
    'Unused definition provenance output must not be generated.',
  );
};

const main = async () => {
  const args = process.argv.slice(2);
  invariant(args.length === 0, `Unknown argument: ${args[0]}`);
  invariant(
    path.resolve(definitionsOutputPath) ===
      path.resolve(projectRoot, 'public', 'definitions'),
    'Refusing to remove an unexpected definitions output directory.',
  );
  const manifest = await loadManifest();
  await validateSourceInventory(manifest);
  await validateForbiddenOutputsAbsent();
  await rm(definitionsOutputPath, {recursive: true, force: true});
  await mkdir(definitionsOutputPath, {recursive: true});
  await runOfficialBuilder();
  const {index: officialIndex, snapshot: officialSnapshot} =
    await validateOfficialOutput();
  const {definitions, mergedIndex} = await writeEraOverlay(
    manifest,
    officialIndex,
  );
  await validateFinalOutput(
    definitions,
    mergedIndex,
    officialIndex,
    officialSnapshot,
  );
  await validateForbiddenOutputsAbsent();
  console.log(
    `Definition build complete: ${mergedIndex.vendorProductIds.v2.length} V2 index entries, ${mergedIndex.vendorProductIds.v3.length} V3-only index entries, ${definitions.length} ERA definitions.`,
  );
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
