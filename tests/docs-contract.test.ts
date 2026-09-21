import {describe, expect, test} from 'bun:test';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';

// Docs point at source owners instead of copying source-derived inventories. This checker
// verifies paths, links, script names, document scope, and routing. Product support and
// wire-compatibility assertions below operate on source data rather than documentary copies.

const repoRoot = path.join(import.meta.dir, '..');
const read = (relative: string) =>
  readFileSync(path.join(repoRoot, relative), 'utf8').replaceAll('\r\n', '\n');
const readJSON = (relative: string) => JSON.parse(read(relative));

const MAP = read('docs/MAP.md');
const AGENTS = read('AGENTS.md');

type ManifestEntry = {
  id: string;
  path: string;
  stateSync: boolean;
  usbDiagnostics?: boolean;
  exactMsFamily?: 'qmk' | 'h7s';
  pair?: string;
};

const manifest = readJSON('config/era-definitions.manifest.json') as {
  definitions: ManifestEntry[];
};

const packageJson = readJSON('package.json') as {
  scripts: Record<string, string>;
};

// Repository-local paths named by active docs must exist. Peer-repository paths
// carry the peer repository name and are outside this existence check.
const OWNED_PREFIXES = [
  'src/',
  'tests/',
  'config/',
  'era-definitions/',
  'public/',
  'scripts/',
  'docs/',
  'types/',
  'patches/',
  '.github/',
];

// Paths a document may name even though they are absent. The reason is the point.
const ALLOWED_ABSENT: Record<string, string> = {
  'public/definitions': '빌드 산출물. `bun run build:kbs` 전에는 없다',
  'era-definitions/v3': '만들지 않기로 한 순정 복제 트리. 부재 자체가 계약이다',
};

const docFiles = [
  'AGENTS.md',
  'CLAUDE.md',
  ...readdirSync(path.join(repoRoot, 'docs'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `docs/${name}`),
  ...readdirSync(path.join(repoRoot, 'docs/adr'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `docs/adr/${name}`),
];

describe('definition wire compatibility', () => {
  test('exact-ms addresses match the definitions they came from', () => {
    const addresses = (definitionPath: string) => {
      const found = new Map<string, string>();
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        if (!node || typeof node !== 'object') {
          return;
        }
        const content = (node as {content?: unknown}).content;
        if (
          Array.isArray(content) &&
          typeof content[0] === 'string' &&
          typeof content[1] === 'number' &&
          typeof content[2] === 'number' &&
          content[0].endsWith('_term_exact')
        ) {
          found.set(content[0], `${content[1]}:${content[2]}`);
        }
        Object.values(node as Record<string, unknown>).forEach(walk);
      };
      walk(JSON.parse(read(definitionPath)));
      return found;
    };

    const qmk = addresses(
      manifest.definitions.find(({exactMsFamily}) => exactMsFamily === 'qmk')!
        .path,
    );
    const h7s = addresses(
      manifest.definitions.find(({exactMsFamily}) => exactMsFamily === 'h7s')!
        .path,
    );

    // Global term shares one address across both families; the TD banks do not.
    expect(qmk.get('id_qmk_tapping_global_term_exact')).toBe('15:5');
    expect(h7s.get('id_qmk_tapping_global_term_exact')).toBe('15:5');

    const bank = (
      found: Map<string, string>,
    ): {channel: number; first: number; last: number} => {
      const slots = Array.from({length: 8}, (_, index) => {
        const value = found.get(`id_qmk_tapdance_${index + 1}_term_exact`);
        expect({slot: index + 1, value: typeof value}).toEqual({
          slot: index + 1,
          value: 'string',
        });
        const [channel, id] = value!.split(':').map(Number);
        return {channel, id};
      });
      const channels = new Set(slots.map(({channel}) => channel));
      expect(channels.size).toBe(1);
      return {
        channel: [...channels][0],
        first: slots[0].id,
        last: slots[7].id,
      };
    };

    expect(bank(qmk)).toEqual({channel: 0, first: 72, last: 79});
    expect(bank(h7s)).toEqual({channel: 16, first: 41, last: 48});
  });

  test('H7S RGB sleep exact and enable addresses remain compatible', () => {
    const found: Array<{name: string; channel: number; id: number}> = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (!node || typeof node !== 'object') {
        return;
      }
      const content = (node as {content?: unknown}).content;
      if (
        Array.isArray(content) &&
        (content[0] === 'id_qmk_rgb_sleep_timeout_exact' ||
          content[0] === 'id_qmk_rgb_sleep_enable') &&
        typeof content[0] === 'string' &&
        typeof content[1] === 'number' &&
        typeof content[2] === 'number'
      ) {
        found.push({name: content[0], channel: content[1], id: content[2]});
      }
      Object.values(node as Record<string, unknown>).forEach(walk);
    };
    walk(
      JSON.parse(
        read(
          manifest.definitions.find(({exactMsFamily}) => exactMsFamily === 'h7s')!
            .path,
        ),
      ),
    );
    expect(found).toEqual([
      {name: 'id_qmk_rgb_sleep_enable', channel: 18, id: 3},
      {name: 'id_qmk_rgb_sleep_timeout_exact', channel: 18, id: 2},
    ]);
  });
});

describe('docs only name commands and files that exist', () => {
  test('every `bun run <script>` named in AGENTS.md or MAP.md is defined', () => {
    const named = new Set<string>();
    for (const source of [AGENTS, MAP]) {
      for (const match of source.matchAll(/bun run ([a-z0-9:-]+)/g)) {
        named.add(match[1]);
      }
    }
    expect(named.size).toBeGreaterThan(0);
    for (const script of named) {
      expect({script, defined: script in packageJson.scripts}).toEqual({
        script,
        defined: true,
      });
    }
  });

  test('documents exist to be checked', () => {
    expect(docFiles.length).toBeGreaterThan(5);
  });

  for (const doc of docFiles) {
    test(`${doc} names only real repository paths`, () => {
      const body = read(doc);
      const missing: string[] = [];
      for (const match of body.matchAll(/`([^`\n]+)`/g)) {
        const token = match[1].trim().replace(/[.,:;]$/, '');
        if (!OWNED_PREFIXES.some((prefix) => token.startsWith(prefix))) {
          continue;
        }
        if (/[*{}()\s]/.test(token)) {
          continue;
        }
        const target = token.replace(/:\d+(?:[-,]\d+)*$/, '');
        if (target in ALLOWED_ABSENT) {
          continue;
        }
        if (!existsSync(path.join(repoRoot, target))) {
          missing.push(target);
        }
      }
      expect({doc, missing: [...new Set(missing)].sort()}).toEqual({
        doc,
        missing: [],
      });
    });

      test(`${doc} citations point at a line that exists`, () => {
      // A `path:line` address is right until the next insertion above it and silently
      // wrong afterwards. Borrowed from qmk_firmware_eerraa's `era_doc_refs.py`, which
      // found this rot class first; nothing here uses a citation yet, so this is the
      // guard that lets one be written safely.
      const body = read(doc);
      const broken: string[] = [];
      for (const match of body.matchAll(
        /`([A-Za-z0-9_./-]+\.[A-Za-z0-9]+):(\d+)(?:-(\d+))?`/g,
      )) {
        const [, target, first, last] = match;
        if (!OWNED_PREFIXES.some((prefix) => target.startsWith(prefix))) {
          continue;
        }
        const full = path.join(repoRoot, target);
        if (!existsSync(full)) {
          broken.push(`${target} (파일 없음)`);
          continue;
        }
        const lines = readFileSync(full, 'utf8').split('\n').length;
        const start = Number(first);
        const end = last === undefined ? start : Number(last);
        if (start < 1 || end < start || end > lines) {
          broken.push(`${target}:${first}${last ? `-${last}` : ''} (${lines}줄)`);
        }
      }
      expect({doc, broken: [...new Set(broken)].sort()}).toEqual({doc, broken: []});
    });

  test(`${doc} links only to documents that exist`, () => {
      const body = read(doc);
      const broken: string[] = [];
      for (const match of body.matchAll(/\]\(([^)]+\.md)(?:#[^)]*)?\)/g)) {
        const target = match[1];
        if (/^https?:/.test(target)) {
          continue;
        }
        const resolved = path.resolve(
          path.dirname(path.join(repoRoot, doc)),
          target,
        );
        if (!existsSync(resolved)) {
          broken.push(target);
        }
      }
      expect({doc, broken: [...new Set(broken)].sort()}).toEqual({
        doc,
        broken: [],
      });
    });
  }
});

// This repository keeps document role and ownership machine-checkable with
// Genre/Canonical for. Numbered ADRs additionally carry Status. Task routing
// stays in AGENTS.md/MAP.md rather than being duplicated as Read when fields.
describe('every document declares its own scope', () => {
  const KNOWN_GENRES = ['contract', 'entry', 'manual', 'map', 'state'];
  const KNOWN_STATUS = ['Accepted', 'Proposed', 'Superseded'];

  const documented = docFiles.filter((doc) => doc.startsWith('docs/'));

  test('there are documents to check', () => {
    expect(documented.length).toBeGreaterThan(3);
  });

  for (const doc of documented) {
    test(`${doc} declares Genre and Canonical for`, () => {
      const lines = read(doc).split('\n');
      const fields = new Map<string, string>();
      for (const line of lines.slice(0, 12)) {
        const match = line.match(/^(Status|Genre|Canonical for|Read when):\s*(.*)$/);
        if (match) {
          fields.set(match[1], match[2].trim());
        }
      }

      expect({
        doc,
        missing: ['Genre', 'Canonical for'].filter((key) => !fields.has(key)),
      }).toEqual({doc, missing: []});

      expect({doc, genre: fields.get('Genre')}).toEqual({
        doc,
        genre: KNOWN_GENRES.find((genre) => genre === fields.get('Genre')),
      });

      // An empty declaration is worse than none: it reads as answered.
      expect({
        doc,
        stated: (fields.get('Canonical for') ?? '').length > 0,
      }).toEqual({doc, stated: true});

      // Status belongs to the ADR genre and nowhere else, so a constant cannot creep back in.
      const isAdrRecord = /^docs\/adr\/\d/.test(doc);
      expect({doc, hasStatus: fields.has('Status')}).toEqual({
        doc,
        hasStatus: isAdrRecord,
      });
      if (isAdrRecord) {
        expect({doc, status: fields.get('Status')}).toEqual({
          doc,
          status: KNOWN_STATUS.find((status) => status === fields.get('Status')),
        });
      }

      // Routing is the index's job. A document restating it is the duplicate this set removed.
      expect({doc, hasReadWhen: fields.has('Read when')}).toEqual({
        doc,
        hasReadWhen: false,
      });
    });
  }

  // A document nothing routes to is a document nobody opens. AGENTS.md carries the task
  // table and MAP.md the canonical rules, so between them every document must be named.
  test('every document is reachable from the entry chain', () => {
    const routers = AGENTS + '\n' + MAP;
    const unreachable = documented.filter(
      (doc) => !routers.includes(doc) && !routers.includes(path.basename(doc)),
    );
    expect(unreachable).toEqual([]);
  });
});

describe('every test file is reachable from a package script', () => {
  // Keep known routing debt explicit until the package scripts are fixed.
  const KNOWN_UNRUN = ['deferred-apply.test.ts'];

  test('the unrun set is exactly the list above', () => {
    const referenced = Object.values(packageJson.scripts).join(' ');
    const unrun = readdirSync(path.join(repoRoot, 'tests'))
      .filter((name) => /\.test\.tsx?$/.test(name))
      .filter((name) => statSync(path.join(repoRoot, 'tests', name)).isFile())
      .filter((name) => !referenced.includes(`tests/${name}`))
      .sort();
    expect(unrun).toEqual([...KNOWN_UNRUN].sort());
  });
});
