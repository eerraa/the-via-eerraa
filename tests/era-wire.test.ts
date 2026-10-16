import {describe, expect, test} from 'bun:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {generateEraWire, validateRegistry, type WireRegistry} from '../scripts/generate-era-wire';
import {parseUISyncRequest, UISyncRequestType} from '../src/utils/ui-sync';

const root = path.resolve(import.meta.dir, '..');
const bytes = readFileSync(path.join(root, 'config/era-wire.json'));
const source = (): WireRegistry => JSON.parse(bytes.toString('utf8'));

describe('ERA wire generation', () => {
  test('app-only check runs without firmware repositories', () => {
    const result = Bun.spawnSync(['bun', 'run', 'era-wire:check'], {cwd: root});
    expect({code: result.exitCode, stderr: result.exitCode ? result.stderr.toString() : ''})
      .toEqual({code: 0, stderr: ''});
  });

  test('outputs every current number, preserves compatibility TS numbers and hashes exact bytes', () => {
    const generated = generateEraWire(bytes);
    const registry = source();
    expect(generated.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(generateEraWire(Buffer.concat([bytes, Buffer.from('\n')])).sha256).not.toBe(generated.sha256);
    expect(generated.header).toContain('GENERATED — do not edit');
    expect(generated.header).toContain('Source: the-via-eerraa/config/era-wire.json');
    expect(generated.header).toContain('generator: the-via-eerraa/scripts/generate-era-wire.ts');
    expect(generated.header).toContain('contract: the-via-eerraa/docs/adr/0005-era-wire-registry.md');
    expect(generated.header).toContain('bun run era-wire:generate');
    expect(generated.header).toContain(`#define ERA_WIRE_REGISTRY_SHA256 "${generated.sha256}"`);
    expect(generated.header).toContain('#ifndef ERA_WIRE_H\n#define ERA_WIRE_H');
    expect(generated.header).toContain('#endif /* ERA_WIRE_H */');
    expect(generated.header).not.toContain('#include');
    expect(generated.header).toContain(`#define ERA_WIRE_VIA_PROTOCOL_VERSION ${registry.via.protocolVersion}U`);
    expect(generated.header).toContain(`#define ERA_WIRE_VIA_KEYCODES_VERSION ${registry.via.keycodesVersion}UL`);
    for (const [group, {entries}] of Object.entries(registry.era.groups)) {
      for (const [name, entry] of Object.entries(entries)) {
        const macro = `#define ERA_WIRE_${group}_${name} `;
        expect(generated.typescript).toContain(`${name}: ${entry.value},`);
        if (entry.status === 'current') {
          expect(generated.header).toContain(`${macro}${entry.value}${entry.value.length > 6 ? 'UL' : 'U'}\n`);
        } else {
          expect(generated.header).not.toContain(macro);
        }
      }
    }
    const tables = {
      commands: 'COMMANDS', keyboardValues: 'KEYBOARD_VALUES', channels: 'CHANNELS',
    } as const;
    for (const key of Object.keys(tables) as (keyof typeof tables)[]) {
      const entries = Object.entries(registry.via.official[key]);
      const expected = `#define ERA_WIRE_VIA_OFFICIAL_${tables[key]}(X) \\\n` +
        entries.map(([name, value], index) =>
          `    X(${name}, ${value})${index < entries.length - 1 ? ' \\' : ''}`).join('\n');
      expect(generated.header).toContain(expected);
    }
  });
});

describe('registry-backed UI Sync compatibility', () => {
  test('decodes each shipped request type with registry command, version and size', () => {
    const registry = source();
    const number = (group: string, name: string) =>
      Number(registry.era.groups[group].entries[name].value);
    const request = (type: number, count: number, ...payload: number[]) => {
      const bytes = new Uint8Array(number('VIA_REPORT', 'SIZE'));
      bytes.set([number('UI_SYNC', 'REQUEST'), number('UI_SYNC_VERSION', 'ENVELOPE'), type, count, ...payload]);
      return bytes;
    };
    const all = number('UI_SYNC_TYPES', 'CUSTOM_MENU_ALL');
    const targets = number('UI_SYNC_TYPES', 'CUSTOM_MENU_COMMANDS');
    const ids = number('UI_SYNC_TYPES', 'CUSTOM_MENU_COMMAND_IDS');
    expect(UISyncRequestType.CUSTOM_MENU_ALL).toBe(all);
    expect(UISyncRequestType.CUSTOM_MENU_COMMANDS).toBe(targets);
    expect(UISyncRequestType.CUSTOM_MENU_COMMAND_IDS).toBe(ids);
    expect(parseUISyncRequest(request(all, 0))).toEqual({type: all});
    expect(parseUISyncRequest(request(targets, 2, 3, 2, 4, 1))).toEqual({
      type: targets, targets: [{channelId: 3, commandId: 2}, {channelId: 4, commandId: 1}],
    });
    expect(parseUISyncRequest(request(ids, 2, 5, 7))).toEqual({type: ids, commandIds: [5, 7]});
    expect(parseUISyncRequest(request(all, 1))).toBeUndefined();
    expect(parseUISyncRequest(request(targets, 15))).toBeUndefined();
    expect(parseUISyncRequest(request(ids, 29))).toBeUndefined();
    expect(parseUISyncRequest(request(all, 0).slice(1))).toBeUndefined();
    const unsupported = request(all, 0);
    unsupported[1]++;
    expect(parseUISyncRequest(unsupported)).toBeUndefined();
  });
});

describe('ERA wire validation', () => {
  test.each(['0x', '0xGG', '0x80trailing', '80', '-0x01', '0x100000000', ' 0x80', 128])(
    'rejects malformed hex %s', (invalid) => {
      const registry = source();
      registry.era.groups.STATE_SYNC_SELECTORS.entries.CURRENT.value = invalid as string;
      expect(() => validateRegistry(registry)).toThrow();
    },
  );
  test('duplicate detection normalizes hex and spans feature groups in one namespace', () => {
    const registry = source();
    registry.era.groups.COLLISION = {
      namespace: 'keyboardValues', users: ['app'],
      entries: {DUPLICATE: {value: '0x0080', status: 'current'}},
    };
    expect(() => validateRegistry(registry)).toThrow('Duplicate ERA value');
  });
  test.each(['commands', 'keyboardValues', 'channels'])('current %s cannot collide with official VIA', (namespace) => {
    const registry = source();
    if (namespace === 'commands') {
      registry.era.groups.UI_SYNC.entries.REQUEST = {
        value: registry.via.official.commands.id_dynamic_keymap_set_encoder, status: 'current',
      };
    } else if (namespace === 'keyboardValues') {
      delete registry.era.groups.STATE_SYNC_SELECTORS.entries.LEGACY;
      registry.era.groups.STATE_SYNC_SELECTORS.entries.CURRENT.value = registry.via.official.keyboardValues.id_keycodes_version;
    } else {
      registry.era.groups.CHANNELS_EERRAA.entries.VERSION.value = registry.via.official.channels.id_qmk_backlight_channel;
    }
    expect(() => validateRegistry(registry)).toThrow('Official');
  });
  test.each(['STATE_SYNC_SELECTORS', 'CHANNELS_EERRAA', 'CHANNELS_H7S', 'MOUSEKEY'])(
    'current %s must stay inside its reserved range', (group) => {
      const registry = source();
      Object.values(registry.era.groups[group].entries)[0].value = '0x7F';
      expect(() => validateRegistry(registry)).toThrow('Outside reserved range');
    },
  );
  test('a current ERA command needs a reserved command range', () => {
    const registry = source();
    registry.era.groups.UI_SYNC.entries.REQUEST.status = 'current';
    expect(() => validateRegistry(registry)).toThrow('Outside reserved range commands');
  });
  test.each(['STATE_SYNC_SELECTORS', 'USB_DIAGNOSTICS_SELECTORS'])(
    'legacy/retired %s requires a compatibility note', (group) => {
      const registry = source();
      const entry = Object.values(registry.era.groups[group].entries).find(({status}) => status !== 'current')!;
      delete entry.note;
      expect(() => validateRegistry(registry)).toThrow('requires a note');
      entry.note = ' ';
      expect(() => validateRegistry(registry)).toThrow('requires a note');
    },
  );
  test('shipped selector collision is allowed only as documented legacy, never current', () => {
    const registry = source();
    expect(() => validateRegistry(registry)).not.toThrow();
    expect(registry.era.groups.STATE_SYNC_SELECTORS.entries.LEGACY).toMatchObject({
      value: registry.via.official.keyboardValues.id_keycodes_version, status: 'legacy',
    });
    expect(registry.era.groups.USB_DIAGNOSTICS_SELECTORS.entries.RETIRED.status).toBe('retired');
  });
  test('rejects invalid schema, statuses, ranges, identifiers and byte overflow', () => {
    for (const change of [
      (r: any) => { r.schemaVersion = 2; },
      (r: any) => { r.era.groups.STATE_SYNC_SELECTORS.entries.CURRENT.status = 'unknown'; },
      (r: any) => { r.era.reserved.keyboardValues[0].min = '0xFF'; r.era.reserved.keyboardValues[0].max = '0x80'; },
      (r: any) => { delete r.era.reserved['channels.h7s']; },
      (r: any) => { r.era.groups.STATE_SYNC_SELECTORS.entries['INVALID NAME'] = {value: '0x81', status: 'current'}; },
      (r: any) => { r.era.groups.STATE_SYNC_SELECTORS.entries.CURRENT.value = '0x100'; },
      (r: any) => { r.era.groups.UI_SYNC.entries.REQUEST.value = '0x100'; },
      (r: any) => { r.era.groups.STATE_SYNC_STATUS.entries.INVALID.value = '0x100'; },
    ]) {
      const registry = source();
      change(registry);
      expect(() => validateRegistry(registry)).toThrow();
    }
  });
});
