import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export type WireEntry = {
  value: string;
  status: 'current' | 'legacy' | 'retired';
  note?: string;
};
export type WireRegistry = {
  schemaVersion: 1;
  via: {
    protocolVersion: string;
    keycodesVersion: string;
    official: Record<'commands' | 'keyboardValues' | 'channels', Record<string, string>>;
  };
  era: {
    reserved: Record<string, {min: string; max: string}[]>;
    groups: Record<string, {
      namespace: string;
      users: ('app' | 'eerraa' | 'h7s')[];
      entries: Record<string, WireEntry>;
    }>;
  };
};

const object = (value: unknown, where: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${where} must be an object`);
  }
  return value as Record<string, unknown>;
};
const hex = (value: unknown, where: string, max = 0xffffffff): number => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,8}$/.test(value)) {
    throw new Error(`${where}: malformed hex`);
  }
  const number = Number(value);
  if (number > max) throw new Error(`${where}: out of range`);
  return number;
};

export function validateRegistry(value: unknown): asserts value is WireRegistry {
  const root = object(value, 'registry');
  if (root.schemaVersion !== 1) throw new Error('Unsupported schemaVersion');
  const via = object(root.via, 'via');
  hex(via.protocolVersion, 'via.protocolVersion', 0xffff);
  hex(via.keycodesVersion, 'via.keycodesVersion');
  const official = object(via.official, 'via.official');
  const officialValues = new Map<string, Set<number>>();
  for (const namespace of ['commands', 'keyboardValues', 'channels']) {
    const entries = object(official[namespace], `via.official.${namespace}`);
    const seen = new Set<number>();
    if (!Object.keys(entries).length) throw new Error(`Empty official ${namespace}`);
    for (const [name, raw] of Object.entries(entries)) {
      if (!/^id_[a-z0-9_]+$/.test(name)) throw new Error(`Invalid official name ${name}`);
      const number = hex(raw, name, 0xff);
      if (seen.has(number)) throw new Error(`Duplicate official ${namespace}: ${raw}`);
      seen.add(number);
    }
    officialValues.set(namespace, seen);
  }
  const era = object(root.era, 'era');
  const reserved = object(era.reserved, 'era.reserved');
  const ranges = new Map<string, {min: number; max: number}[]>();
  for (const [namespace, raw] of Object.entries(reserved)) {
    if (!Array.isArray(raw) || !raw.length) throw new Error(`Missing ranges: ${namespace}`);
    ranges.set(namespace, raw.map((item) => {
      const range = object(item, namespace);
      const min = hex(range.min, `${namespace}.min`, 0xff);
      const max = hex(range.max, `${namespace}.max`, 0xff);
      if (min > max) throw new Error(`Reversed range: ${namespace}`);
      return {min, max};
    }));
  }
  const groups = object(era.groups, 'era.groups');
  if (!Object.keys(groups).length) throw new Error('Empty ERA groups');
  const seen = new Map<string, Set<number>>();
  const macros = new Set<string>();
  for (const [groupName, raw] of Object.entries(groups)) {
    const group = object(raw, groupName);
    if (!/^[A-Z][A-Z0-9_]*$/.test(groupName)) throw new Error(`Invalid group ${groupName}`);
    if (typeof group.namespace !== 'string' || !group.namespace.length) {
      throw new Error(`Missing namespace: ${groupName}`);
    }
    const namespace = group.namespace;
    if (!Array.isArray(group.users) || !group.users.length ||
        group.users.some((user) => !['app', 'eerraa', 'h7s'].includes(user))) {
      throw new Error(`Invalid users: ${groupName}`);
    }
    const entries = object(group.entries, `${groupName}.entries`);
    if (!Object.keys(entries).length) throw new Error(`Empty ERA group ${groupName}`);
    const values = seen.get(namespace) ?? new Set<number>();
    seen.set(namespace, values);
    for (const [name, rawEntry] of Object.entries(entries)) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`Invalid name ${groupName}.${name}`);
      const macro = `${groupName}_${name}`;
      if (macros.has(macro)) throw new Error(`Duplicate macro: ${macro}`);
      macros.add(macro);
      const entry = object(rawEntry, macro);
      // Every ERA entry is one wire byte. Commands, keyboard values, channels
      // and value IDs are addressed: a current entry also needs a reservation.
      const addressed = /^(commands$|keyboardValues|channels(?:\.|$)|values\.)/.test(namespace);
      const number = hex(entry.value, macro, 0xff);
      if (!['current', 'legacy', 'retired'].includes(entry.status as string)) {
        throw new Error(`Invalid status: ${macro}`);
      }
      if (entry.status !== 'current' &&
          (typeof entry.note !== 'string' || !entry.note.trim())) {
        throw new Error(`Legacy/retired entry requires a note: ${macro}`);
      }
      if (values.has(number)) throw new Error(`Duplicate ERA value in ${namespace}: ${entry.value}`);
      values.add(number);
      if (entry.status !== 'current') continue;
      const officialNamespace = namespace.split('.')[0];
      if (officialValues.get(officialNamespace)?.has(number)) {
        throw new Error(`Official ${officialNamespace} collision: ${macro}`);
      }
      if (addressed && !ranges.get(namespace)?.some(({min, max}) => number >= min && number <= max)) {
        throw new Error(`Outside reserved range ${namespace}: ${macro}`);
      }
    }
  }
}

const cNumber = (value: string) => `${value}${value.length > 6 ? 'UL' : 'U'}`;
const officialNames = {
  commands: 'COMMANDS',
  keyboardValues: 'KEYBOARD_VALUES',
  channels: 'CHANNELS',
} as const;

export function generateEraWire(bytes: Uint8Array | string) {
  const registry: unknown = JSON.parse(typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('utf8'));
  validateRegistry(registry);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const banner = 'GENERATED — do not edit. Source: the-via-eerraa/config/era-wire.json; generator: the-via-eerraa/scripts/generate-era-wire.ts; command: bun run era-wire:generate; contract: the-via-eerraa/docs/adr/0005-era-wire-registry.md';
  const ts = [
    `// ${banner}`,
    `export const ERA_WIRE_REGISTRY_SHA256 = '${sha256}';`,
    `export const ERA_WIRE_VIA_PROTOCOL_VERSION = ${registry.via.protocolVersion};`,
    `export const ERA_WIRE_VIA_KEYCODES_VERSION = ${registry.via.keycodesVersion};`,
  ];
  const header = [
    `/* ${banner} */`,
    '#ifndef ERA_WIRE_H',
    '#define ERA_WIRE_H',
    '',
    `#define ERA_WIRE_REGISTRY_SHA256 "${sha256}"`,
    `#define ERA_WIRE_VIA_PROTOCOL_VERSION ${cNumber(registry.via.protocolVersion)}`,
    `#define ERA_WIRE_VIA_KEYCODES_VERSION ${cNumber(registry.via.keycodesVersion)}`,
    '',
  ];
  for (const key of Object.keys(officialNames) as (keyof typeof officialNames)[]) {
    const entries = Object.entries(registry.via.official[key]);
    const name = officialNames[key];
    ts.push(`export const VIA_${name} = {`);
    ts.push(...entries.map(([entry, value]) => `  ${entry}: ${value},`));
    ts.push('} as const;');
    header.push(`#define ERA_WIRE_VIA_OFFICIAL_${name}(X) \\`);
    header.push(...entries.map(([entry, value], index) =>
      `    X(${entry}, ${value})${index === entries.length - 1 ? '' : ' \\'}`));
    header.push('');
  }
  ts.push('export const ERA_WIRE = {');
  for (const [name, group] of Object.entries(registry.era.groups)) {
    ts.push(`  ${name}: {`);
    for (const [key, entry] of Object.entries(group.entries)) {
      if (entry.status !== 'current') ts.push(`    // ${entry.status}: ${entry.note}`);
      ts.push(`    ${key}: ${entry.value},`);
      if (entry.status === 'current') {
        header.push(`#define ERA_WIRE_${name}_${key} ${cNumber(entry.value)}`);
      }
    }
    ts.push('  },');
  }
  ts.push('} as const;', '');
  header.push('', '#endif /* ERA_WIRE_H */', '');
  return {typescript: ts.join('\n'), header: header.join('\n'), registry, sha256};
}

export function runEraWire(args: string[]) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const targets: {path: string; kind: 'typescript' | 'header'}[] = [
    {path: path.join(root, 'src/utils/era-wire.generated.ts'), kind: 'typescript'},
  ];
  let check = false;
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (option === '--check') { check = true; continue; }
    if ((option !== '--eerraa' && option !== '--h7s') || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error(`Usage: bun run era-wire:generate [--check] [--eerraa <root>] [--h7s <root>]; invalid option ${option}`);
    }
    const relative = option === '--eerraa'
      ? 'keyboards/era/common/system/era_wire.h'
      : 'src/ap/modules/qmk/port/era_wire.h';
    targets.push({path: path.resolve(args[++i], relative), kind: 'header'});
  }
  const generated = generateEraWire(readFileSync(path.join(root, 'config/era-wire.json')));
  for (const target of targets) {
    const content = generated[target.kind];
    if (check) {
      if (!readFileSync(target.path).equals(Buffer.from(content))) {
        throw new Error(`Stale generated ERA wire file: ${target.path}; run bun run era-wire:generate with the same firmware roots`);
      }
    } else {
      writeFileSync(target.path, content);
    }
  }
  console.log(`ERA wire ${check ? 'check' : 'generate'}: ${targets.length} file(s)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runEraWire(process.argv.slice(2));
}
