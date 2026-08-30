import {describe, expect, test} from 'bun:test';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';

// The docs are a derivative of the code, not a second copy of it. Every number and every
// repository path a document states is recomputed here from the source it was derived from,
// so a document cannot drift silently: it either matches or this file goes red.
//
// The precedent is `tests/locales.test.ts`, which reads its own key list from source rather
// than restating it, and `tests/era-definition.test.ts`, which holds the feature-coverage
// table. Nothing below hard-codes a fact that also lives in a document; it computes the fact
// and asserts the document agrees.

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

// A repository path that quietly stops existing is the most common way a document turns
// into a lie: comments cited `src/utils/pane-config.ts` with a `.tsx` suffix even though
// the file was never `.tsx`, because nothing ever asked. A path that belongs to another
// repository has to carry that repository's name, so this check can tell the two apart.
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

// `docs/MAP.md` §2 is a two-column table. Read the value the document claims for a row so the
// assertion compares document text against a computed number, never number against number.
const mapTableValue = (label: string) => {
  const row = MAP.split('\n').find((line) =>
    line.startsWith(`| ${label} |`),
  );
  expect({label, row: typeof row}).toEqual({label, row: 'string'});
  const cell = row!.split('|')[2].trim();
  return Number(cell.replace(/\*/g, ''));
};

describe('docs state the same counts the manifest does', () => {
  const h7s = manifest.definitions.filter(
    ({usbDiagnostics}) => usbDiagnostics === true,
  );

  const claims: [string, number][] = [
    ['ERA custom definitions', manifest.definitions.length],
    ['├ QMK (RP2040 + ATmega32U4)', manifest.definitions.length - h7s.length],
    ['└ H7S', h7s.length],
    [
      'State Sync opt-in (`stateSync: true`)',
      manifest.definitions.filter(({stateSync}) => stateSync).length,
    ],
    [
      'exact-ms `qmk` family (`options: [1, 65535]`)',
      manifest.definitions.filter(({exactMsFamily}) => exactMsFamily === 'qmk')
        .length,
    ],
    [
      'exact-ms `h7s` family (`options: [100, 500]`)',
      manifest.definitions.filter(({exactMsFamily}) => exactMsFamily === 'h7s')
        .length,
    ],
    ['USB diagnostics opt-in (`usbDiagnostics: true`)', h7s.length],
    [
      'split pair entries (left/right each)',
      manifest.definitions.filter(({pair}) => typeof pair === 'string').length,
    ],
  ];

  for (const [label, actual] of claims) {
    test(`${label} == ${actual}`, () => {
      expect({label, documented: mapTableValue(label)}).toEqual({
        label,
        documented: actual,
      });
    });
  }

  test('ERA menu summaries count matches era-feature-help', async () => {
    const {eraMenuSummaries} = await import('../src/utils/era-feature-help');
    expect(mapTableValue('ERA menu summaries')).toBe(eraMenuSummaries().length);
  });

  test('official snapshot sizes match the installed package', () => {
    const countJSON = (relative: string) => {
      const root = path.join(repoRoot, relative);
      expect({relative, installed: existsSync(root)}).toEqual({
        relative,
        installed: true,
      });
      let total = 0;
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, {withFileTypes: true})) {
          const child = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(child);
          } else if (entry.name.endsWith('.json')) {
            total += 1;
          }
        }
      };
      walk(root);
      return total;
    };

    const grouped = (value: number) => value.toLocaleString('en-US');
    expect(MAP).toContain(
      `src/**/*.json   ${grouped(countJSON('node_modules/via-keyboards/src'))}`,
    );
    expect(MAP).toContain(
      `v3/**/*.json    ${grouped(countJSON('node_modules/via-keyboards/v3'))}`,
    );
  });

  test('locale count and key count match the catalogs', () => {
    const dir = path.join(repoRoot, 'src/locales');
    const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
    const keyCounts = new Set(
      files.map(
        (name) =>
          Object.keys(JSON.parse(readFileSync(path.join(dir, name), 'utf8')))
            .length,
      ),
    );
    expect(keyCounts.size).toBe(1);
    const documented = MAP.split('\n').find((line) =>
      line.startsWith('| Locales |'),
    );
    expect(documented).toContain(`${files.length} (`);
    expect(documented).toContain(`${[...keyCounts][0]} keys`);
  });
});

describe('docs state the same wire constants the source does', () => {
  test('selector, command and poll interval', async () => {
    const stateSync = await import('../src/utils/era-state-sync');
    const diagnostics = await import('../src/utils/era-usb-diagnostics');

    const hex = (value: number) =>
      `0x${value.toString(16).padStart(2, '0')}`;

    expect(MAP).toContain(
      `\`GET_KEYBOARD_VALUE ${hex(stateSync.ERA_STATE_SYNC_COMMAND)}\` + selector \`${hex(
        stateSync.ERA_STATE_SYNC_SELECTOR,
      )}\``,
    );
    expect(MAP).toContain(
      `selector \`${hex(diagnostics.ERA_USB_DIAGNOSTICS_SELECTOR)}\``,
    );
    expect(MAP).toContain(
      `ERA_STATE_SYNC_POLL_INTERVAL_MS = ${stateSync.ERA_STATE_SYNC_POLL_INTERVAL_MS}`,
    );
  });

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
    expect(MAP).toContain('| Global TAPPING term | channel 15 / value 5 |');

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

    const qmkBank = bank(qmk);
    const h7sBank = bank(h7s);
    expect(MAP).toContain(
      `| TD0–TD7 term | channel ${qmkBank.channel} / value ${qmkBank.first}–${qmkBank.last} | channel ${h7sBank.channel} / value ${h7sBank.first}–${h7sBank.last} |`,
    );
  });
});

describe('docs only name commands and files that exist', () => {
  // The pass count moves whenever a case is added, so the documents state the file count
  // instead: that only moves when a file leaves a script, which is the failure worth catching.
  test('documented test-file counts match the scripts', () => {
    for (const script of ['test:transport', 'test:p1'] as const) {
      const files = [
        ...packageJson.scripts[script].matchAll(/tests\/[\w.-]+\.test\.tsx?/g),
      ].length;
      for (const [name, body] of [
        ['AGENTS.md', AGENTS],
        ['docs/MAP.md', MAP],
      ] as const) {
        const line = body
          .split('\n')
          .find((candidate) => candidate.includes(`bun run ${script}`));
        expect({script, name, line: typeof line}).toEqual({
          script,
          name,
          line: 'string',
        });
        const fileCountPhrase =
          name === 'AGENTS.md' ? `${files}개 파일` : `${files} files`;
        expect({script, name, states: line!.includes(fileCountPhrase)}).toEqual(
          {script, name, states: true},
        );
      }
    }
  });

  test('AGENTS.md states the definition count the build emits', () => {
    expect(AGENTS).toContain(`ERA 정의 ${manifest.definitions.length}종`);
  });

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

// The header convention the four ERA repositories share — this app, `qmk_firmware_eerraa`,
// `eerraa-qmk-h7s-fw` and `eerraa-54lm20-fw`. Two fields, because those are the two that
// carry information at every scale:
//
//   Genre:         what kind of sentence this document may hold
//   Canonical for: the facts this document is the single source of
//
// `Status:` is required only under `docs/adr/`, where it genuinely varies (Proposed →
// Accepted → Superseded). Elsewhere a document is either current or deleted, so the field
// would be a constant. Measured in `qmk_firmware_eerraa`, where the convention started:
// 19 of 21 documents said `active`, and the two that did not differed from each other only
// by a trailing period — a field nobody reads and nothing checks.
//
// `Read when:` is deliberately absent. It states, from the document's side, the same fact
// the entry index states from the task's side, and both were maintained by hand. That is
// the defect this whole document set was reorganised to remove, and it is present in the
// repository the convention was borrowed from: `era_wire_contract.md` says "editing payload
// encode/decode, scheduler IO, responder, or router" while the index row for the same
// document says "wire payloads, compact IO, responder admission". Routing lives in the
// index alone, and `every document is reachable from the entry chain` below keeps it honest.
//
// One scale-driven difference remains: there, genre is the directory (21 documents over
// four of them). Here there are seven, so the genre is declared rather than encoded in a
// path. The repo-root entry files carry no header in either repository — `AGENTS.md` is
// the chain, not a document routed to by it.
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
  // A test no script runs proves nothing. `SUBMENUS_WITHOUT_HELP` in
  // `tests/era-definition.test.ts` uses the same shape: being on the list means somebody
  // decided, and nothing slips through unnoticed.
  //
  // `deferred-apply.test.ts` is on this list as a defect, not a decision. It passes when run
  // by hand (`bun test tests/deferred-apply.test.ts`) but neither `test:transport` nor
  // `test:p1` mentions it, so a regression in the deferred TAPPING/TAPDANCE Apply gate would
  // not fail anything. Either add it to a script or delete it; do not just extend this list.
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
