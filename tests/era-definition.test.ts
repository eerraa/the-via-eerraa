import {describe, expect, test} from 'bun:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  attachTapDanceKeycodes,
  customKeycodeWireIndex,
  getTapDanceControlMenu,
  hasCustomKeycodeTab,
  isTapDanceKeycodeName,
  splitTapDanceKeycodesFromRaw,
} from '../src/utils/era-definition';
import {mergeDefinitionLookup} from '../src/utils/definition-priority';
import {
  eraControlHelpEntries,
  findEraControlHelp,
  findEraFeatureHelp,
} from '../src/utils/era-feature-help';

type UsbIdentity = {vendorId: string; productId: string};

type DefinitionEntry = UsbIdentity & {
  id: string;
  path: string;
  identities?: UsbIdentity[];
  legacy?: UsbIdentity & {path: string};
  pair?: string;
  stateSync: boolean;
  usbDiagnostics?: boolean;
  exactMsFamily?: 'qmk' | 'h7s';
};

type TermControl = {
  name: string;
  channel: number;
  id: number;
  options?: unknown;
};

const readJSON = (path: string) =>
  JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

const manifestRaw = readJSON('config/era-definitions.manifest.json');
const manifest = manifestRaw as unknown as {
  definitions: DefinitionEntry[];
};

const collectTermControls = (value: unknown, into: TermControl[] = []) => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectTermControls(item, into));
    return into;
  }
  if (!value || typeof value !== 'object') {
    return into;
  }
  const record = value as {content?: unknown; options?: unknown};
  if (
    Array.isArray(record.content) &&
    typeof record.content[0] === 'string' &&
    /^id_qmk_(?:tapping_global|tapdance_[1-8])_term(?:_exact)?$/.test(
      record.content[0],
    ) &&
    typeof record.content[1] === 'number' &&
    typeof record.content[2] === 'number'
  ) {
    into.push({
      name: record.content[0],
      channel: record.content[1],
      id: record.content[2],
      options: record.options,
    });
  }
  Object.values(record).forEach((item) => collectTermControls(item, into));
  return into;
};

const collectCommandControls = (
  value: unknown,
  into: {
    name: string;
    channel: number;
    id: number;
    label?: string;
    type?: string;
    options?: unknown;
    showIf?: string;
  }[] = [],
) => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectCommandControls(item, into));
    return into;
  }
  if (!value || typeof value !== 'object') {
    return into;
  }
  const record = value as {
    content?: unknown;
    label?: unknown;
    type?: unknown;
    options?: unknown;
    showIf?: unknown;
  };
  if (
    Array.isArray(record.content) &&
    typeof record.content[0] === 'string' &&
    typeof record.content[1] === 'number' &&
    typeof record.content[2] === 'number'
  ) {
    into.push({
      name: record.content[0],
      channel: record.content[1],
      id: record.content[2],
      label: typeof record.label === 'string' ? record.label : undefined,
      type: typeof record.type === 'string' ? record.type : undefined,
      options: record.options,
      showIf: typeof record.showIf === 'string' ? record.showIf : undefined,
    });
  }
  Object.values(record).forEach((item) => collectCommandControls(item, into));
  return into;
};

const submenuLabels = (definition: Record<string, unknown>, menu: string) => {
  const menus = (definition.menus ?? []) as {
    label?: string;
    content?: {label?: string}[];
  }[];
  const found = menus.find(
    (entry) => entry && typeof entry === 'object' && entry.label === menu,
  );
  return (found?.content ?? []).map((entry) => entry.label);
};

const submenuControlLabels = (
  definition: Record<string, unknown>,
  menu: string,
  submenu: string,
) => {
  const menus = (definition.menus ?? []) as {
    label?: string;
    content?: {label?: string; content?: {label?: string}[]}[];
  }[];
  const foundMenu = menus.find((entry) => entry?.label === menu);
  const foundSubmenu = (foundMenu?.content ?? []).find(
    (entry) => entry?.label === submenu,
  );
  return (foundSubmenu?.content ?? []).map((entry) => entry.label);
};

const keycodeNames = (value: unknown) =>
  (Array.isArray(value) ? value : [])
    .map((item) =>
      item && typeof item === 'object' && 'name' in item
        ? String((item as {name: unknown}).name)
        : '',
    )
    .filter(Boolean);

const expectedTapDanceNames = Array.from(
  {length: 8},
  (_, index) => `TD${index}`,
);

const expectedQmkTermAddresses = [
  'id_qmk_tapping_global_term_exact:15:5',
  ...Array.from(
    {length: 8},
    (_, index) => `id_qmk_tapdance_${index + 1}_term_exact:0:${72 + index}`,
  ),
].sort();

const expectedQmkDefinitionIds = [
  '7b75',
  'brick65',
  'brick65s',
  'chickpad',
  'classicd-a1',
  'classicd-a1-ug',
  'classicd-core',
  'classicd-coreless',
  'divine',
  'era65',
  'et-tkl',
  'fave65s',
  'klein-hs',
  'klein-sd',
  'n86',
  'n87',
  'n8x',
  'newone-a1',
  'newone-h1',
  'newone-odessey60h',
  'newone-odessey60s',
  'riley',
  'tomak-tkl-left',
  'tomak-tkl-right',
  'tomak79h-left',
  'tomak79h-right',
  'tomak79s-left',
  'tomak79s-right',
].sort();

const expectedRp2040DefinitionIds = expectedQmkDefinitionIds.filter(
  (id) => id !== 'brick65',
);

const expectedUsbDiagnosticsDefinitionIds = [
  'brick60-h7s',
  'brick65-h7s',
  'intigrity80-h7s',
  'may65-h7s',
  'sculpturei-h7s',
].sort();

const expectedRgbSleepToggleDefinitionIds = [
  '7b75',
  'brick60-h7s',
  'brick65',
  'brick65-h7s',
  'brick65s',
  'chickpad',
  'classicd-a1-ug',
  'classicd-core',
  'classicd-coreless',
  'fave65s',
  'intigrity80-h7s',
  'klein-sd',
  'may65-h7s',
  'n86',
  'n87',
  'newone-odessey60h',
  'newone-odessey60s',
  'riley',
  'sculpturei-h7s',
  'tomak-tkl-left',
  'tomak-tkl-right',
  'tomak79h-left',
  'tomak79h-right',
  'tomak79s-left',
  'tomak79s-right',
].sort();

// Every RGB board but the ATmega brick65 sets the RGB idle timeout in exact seconds.
const expectedRgbSleepTimeoutDefinitionIds =
  expectedRgbSleepToggleDefinitionIds.filter((id) => id !== 'brick65');

// QMK boards whose backlight has its own sleep switch and timeout (SYSTEM 9/13, 9/15).
const expectedBacklightSleepDefinitionIds = [
  '7b75',
  'classicd-a1',
  'classicd-a1-ug',
  'classicd-core',
  'classicd-coreless',
  'divine',
  'era65',
  'et-tkl',
  'klein-hs',
  'klein-sd',
  'n8x',
  'newone-a1',
].sort();

describe('era definition layout options', () => {
  // Schema validation permits a label-free all-switch layout. An independent
  // inventory catches a port that loses the same options on both VIA surfaces.
  const expectedChoices: Record<string, number[]> = {
    '7b75': [2, 2, 2, 2],
    'brick60-h7s': [2, 2],
    'brick65': [2, 2],
    'brick65-h7s': [],
    'brick65s': [2],
    'chickpad': [],
    'classicd-a1': [2, 2, 2, 2, 2],
    'classicd-a1-ug': [2, 2, 2, 2, 2],
    'classicd-core': [2, 2, 2, 2, 2],
    'classicd-coreless': [2, 2, 2, 2, 2],
    'divine': [2, 2],
    'era65': [2, 2, 4],
    'et-tkl': [2, 2, 2, 2],
    'fave65s': [2, 2, 2, 2],
    'intigrity80-h7s': [2, 2],
    'klein-hs': [2, 3],
    'klein-sd': [2, 3],
    'may65-h7s': [2, 2, 2, 2],
    'n86': [2, 2],
    'n87': [2, 2],
    'n8x': [2, 2, 2, 2, 2],
    'newone-a1': [2, 2, 2, 2, 2],
    'newone-h1': [2, 2],
    'newone-odessey60h': [2, 2, 3],
    'newone-odessey60s': [2, 2, 2, 2, 3],
    'riley': [2, 2, 2, 2, 2],
    'sculpturei-h7s': [2, 2, 2],
    'tomak-tkl-left': [2, 2, 2],
    'tomak-tkl-right': [2, 2, 2],
    'tomak79h-left': [2],
    'tomak79h-right': [2],
    'tomak79s-left': [2, 2, 2],
    'tomak79s-right': [2, 2, 2],
  };

  test('every definition retains its layout groups and selectable choice keys', async () => {
    const {keyboardDefinitionV3ToVIADefinitionV3, isKeyboardDefinitionV3} =
      await import('@the-via/reader');
    expect(Object.keys(expectedChoices).sort()).toEqual(
      manifest.definitions.map(({id}) => id).sort(),
    );
    for (const {id, path} of manifest.definitions) {
      const {definitionRaw} = splitTapDanceKeycodesFromRaw(readJSON(path));
      if (!isKeyboardDefinitionV3(definitionRaw)) {
        throw new Error(`${id}: invalid VIA V3 definition`);
      }
      const {layouts} = keyboardDefinitionV3ToVIADefinitionV3(definitionRaw);
      const counts = (layouts.labels ?? []).map((label) =>
        Array.isArray(label) ? label.length - 1 : 2,
      );
      expect({id, counts}).toEqual({id, counts: expectedChoices[id]});
      expect(Object.keys(layouts.optionKeys).sort()).toEqual(
        counts.map((_, group) => String(group)).sort(),
      );
      counts.forEach((count, group) => {
        expect(Object.keys(layouts.optionKeys[group]).sort()).toEqual(
          Array.from({length: count}, (_, choice) => String(choice)).sort(),
        );
        for (let choice = 0; choice < count; choice++) {
          expect(layouts.optionKeys[group][choice].length).toBeGreaterThan(0);
        }
      });
    }
  });

  // LAYOUTS shows these names as written: no locale key translates them.
  test('layout names spell each word one way and name widths their choice draws', async () => {
    const {keyboardDefinitionV3ToVIADefinitionV3, isKeyboardDefinitionV3} =
      await import('@the-via/reader');
    const spellings = new Map<string, Set<string>>();
    for (const {id, path} of manifest.definitions) {
      const {definitionRaw} = splitTapDanceKeycodesFromRaw(readJSON(path));
      if (!isKeyboardDefinitionV3(definitionRaw)) {
        throw new Error(`${id}: invalid VIA V3 definition`);
      }
      const {layouts} = keyboardDefinitionV3ToVIADefinitionV3(definitionRaw);
      (layouts.labels ?? []).forEach((label, group) => {
        const names = Array.isArray(label) ? label : [label];
        for (const word of names.flatMap((name) => name.split(' '))) {
          const seen = spellings.get(word.toLowerCase()) ?? new Set<string>();
          spellings.set(word.toLowerCase(), seen.add(word));
        }
        // A switch names its "on" choice; a dropdown names choice n at n + 1.
        const choices: [string, number][] = Array.isArray(label)
          ? label.slice(1).map((name, choice) => [name, choice])
          : [[label, 1]];
        for (const [name, choice] of choices) {
          const width = /^(\d+(?:\.\d+)?)U\b/.exec(name)?.[1];
          if (width !== undefined) {
            const drawn = layouts.optionKeys[group][choice].some(
              ({w}) => w === Number(width),
            );
            expect({id, name, drawn}).toEqual({id, name, drawn: true});
          }
        }
      });
    }
    expect(
      [...spellings.values()]
        .filter((seen) => seen.size > 1)
        .map((seen) => [...seen]),
    ).toEqual([]);
  });

  // Identity-only upgrades preserve geometry. MAY65 explicitly changes its matrix,
  // so the old firmware keeps its frozen definition and old backups fail closed.
  test('legacy geometry stays compatible except the explicit MAY65 matrix expansion', () => {
    const signature = (path: string) => {
      const raw = readJSON(path) as {
        matrix: unknown;
        tapdanceKeycodes?: {name: string}[];
        customKeycodes?: {name: string}[];
      };
      return {
        matrix: raw.matrix,
        tapdance: (raw.tapdanceKeycodes ?? []).map(({name}) => name),
        custom: (raw.customKeycodes ?? []).map(({name}) => name),
      };
    };
    for (const {id, path, legacy} of manifest.definitions) {
      if (legacy) {
        const previous = signature(legacy.path);
        const current = signature(path);
        if (id === 'may65-h7s') {
          // Insert expands the current matrix; the frozen legacy firmware stays 5x15.
          expect(previous.matrix).toEqual({rows: 5, cols: 15});
          expect(current.matrix).toEqual({rows: 5, cols: 16});
          expect(previous.tapdance).toEqual(current.tapdance);
          expect(previous.custom).toEqual(current.custom);
        } else {
          expect({id, ...previous}).toEqual({id, ...current});
        }
      }
    }
  });

  test('7B75 renders the original four choices and all 16 physical layouts', async () => {
    const {keyboardDefinitionV3ToVIADefinitionV3, isKeyboardDefinitionV3} =
      await import('@the-via/reader');
    const entry = manifest.definitions.find(({id}) => id === '7b75')!;
    const {definitionRaw} = splitTapDanceKeycodesFromRaw(readJSON(entry.path));
    if (!isKeyboardDefinitionV3(definitionRaw)) {
      throw new Error('7B75: invalid VIA V3 definition');
    }
    const {layouts, matrix} =
      keyboardDefinitionV3ToVIADefinitionV3(definitionRaw);
    expect(matrix).toEqual({rows: 6, cols: 16});
    expect(layouts.labels).toEqual([
      ['Backspace', 'Unified', 'Split'],
      ['Enter', 'ANSI', 'ISO'],
      ['Left Shift', 'ANSI', 'ISO'],
      ['Bottom Row', '6U', '6.25U'],
    ]);
    expect([layouts.width, layouts.height]).toEqual([16.25, 6.5]);
    const expected = [
      [[[1, 14, 13, 1.25, 2, 1]],
        [[1, 13, 13, 1.25, 1, 1], [1, 14, 14, 1.25, 1, 1]]],
      [[[2, 14, 13.5, 2.25, 1.5, 1], [3, 14, 12.75, 3.25, 2.25, 1]],
        [[3, 14, 13.75, 2.25, 1.25, 2], [3, 12, 12.75, 3.25, 1, 1]]],
      [[[4, 0, 0, 4.25, 2.25, 1]],
        [[4, 0, 0, 4.25, 1.25, 1], [4, 1, 1.25, 4.25, 1, 1]]],
      [[[5, 0, 0, 5.25, 1.5, 1], [5, 1, 1.5, 5.25, 1, 1],
        [5, 2, 2.5, 5.25, 1.5, 1], [5, 6, 4, 5.25, 6, 1],
        [5, 10, 10, 5.25, 1.5, 1], [5, 11, 11.5, 5.25, 1.5, 1]],
        [[5, 0, 0, 5.25, 1.25, 1], [5, 1, 1.25, 5.25, 1.25, 1],
          [5, 2, 2.5, 5.25, 1.25, 1], [5, 6, 3.75, 5.25, 6.25, 1],
          [5, 10, 10, 5.25, 1.5, 1], [5, 11, 11.5, 5.25, 1.5, 1]]],
    ];
    expected.forEach((choices, group) => {
      choices.forEach((keys, choice) => {
        expect(layouts.optionKeys[group][choice].map(
          ({row, col, x, y, w, h}) => [row, col, x, y, w, h],
        )).toEqual(keys);
      });
    });
    expect(layouts.optionKeys[1][1][0]).toMatchObject({
      w2: 1.5, h2: 1, x2: -0.25,
    });
    const covered = new Set<string>();
    for (let bits = 0; bits < 16; bits++) {
      const choices = Array.from({length: 4}, (_, group) => (bits >> group) & 1);
      const selected = layouts.keys.concat(
        choices.flatMap((choice, group) => layouts.optionKeys[group][choice]),
      );
      const coordinates = selected.map(({row, col}) => `${row},${col}`);
      expect(new Set(coordinates).size).toBe(selected.length);
      expect(selected.length).toBe(80 + choices[0] + choices[2]);
      selected.forEach(({row, col}) => {
        expect(row >= 0 && row < matrix.rows).toBe(true);
        expect(col >= 0 && col < matrix.cols).toBe(true);
      });
      coordinates.forEach((coordinate) => covered.add(coordinate));
    }
    expect([...covered].sort()).toEqual([
      ...Array.from({length: 14}, (_, col) => `0,${col}`),
      ...Array.from({length: 16}, (_, col) => `1,${col}`),
      ...[...Array.from({length: 13}, (_, col) => col), 14, 15]
        .flatMap((col) => [`2,${col}`, `3,${col}`]),
      ...[...Array.from({length: 13}, (_, col) => col), 14].map((col) => `4,${col}`),
      ...[0, 1, 2, 6, 10, 11, 13, 14, 15].map((col) => `5,${col}`),
    ].sort());
  });

  test('MAY65 keeps Insert, Enter and backslash in all 16 solder/hotswap layouts', async () => {
    const {keyboardDefinitionV3ToVIADefinitionV3, isKeyboardDefinitionV3} =
      await import('@the-via/reader');
    const entry = manifest.definitions.find(({id}) => id === 'may65-h7s')!;
    const {definitionRaw} = splitTapDanceKeycodesFromRaw(readJSON(entry.path));
    if (!isKeyboardDefinitionV3(definitionRaw)) {
      throw new Error('MAY65: invalid VIA V3 definition');
    }
    const {layouts, matrix} = keyboardDefinitionV3ToVIADefinitionV3(definitionRaw);
    expect(matrix).toEqual({rows: 5, cols: 16});
    expect([layouts.width, layouts.height]).toEqual([16, 5]);
    expect(layouts.labels).toEqual([
      ['Backspace', 'Unified', 'Split'], ['Enter', 'ANSI', 'ISO'],
      ['Left Shift', 'Unified', 'Split'], ['Bottom Row', '6.25U', '7U'],
    ]);
    // Coordinates from the physical layout, independent of option membership.
    const expected = [
      [[[0, 13, 13, 0, 2, 1]],
        [[0, 14, 13, 0, 1, 1], [0, 13, 14, 0, 1, 1]]],
      [[[1, 13, 13.5, 1, 1.5, 1], [2, 13, 12.75, 2, 2.25, 1]],
        [[2, 13, 13.75, 1, 1.25, 2], [2, 12, 12.75, 2, 1, 1]]],
      [[[3, 0, 0, 3, 2.25, 1]],
        [[3, 0, 0, 3, 1.25, 1], [3, 1, 1.25, 3, 1, 1]]],
      [[[4, 0, 0, 4, 1.25, 1], [4, 1, 1.25, 4, 1.25, 1],
        [4, 2, 2.5, 4, 1.25, 1], [4, 7, 3.75, 4, 6.25, 1],
        [4, 10, 10, 4, 1.25, 1], [4, 11, 11.25, 4, 1.25, 1]],
        [[4, 0, 0, 4, 1.5, 1], [4, 1, 1.5, 4, 1, 1],
          [4, 2, 2.5, 4, 1.5, 1], [4, 7, 4, 4, 7, 1],
          [4, 11, 11, 4, 1.5, 1]]],
    ];
    expected.forEach((choices, group) => choices.forEach((keys, choice) => {
      expect(layouts.optionKeys[group][choice].map(
        ({row, col, x, y, w, h}) => [row, col, x, y, w, h],
      )).toEqual(keys);
    }));
    expect(layouts.optionKeys[1][1][0]).toMatchObject({w2: 1.5, h2: 1, x2: -0.25});
    const rectangles = (key: typeof layouts.keys[number]) => [
      [key.x, key.y, key.w, key.h],
      ...(key.w2 === undefined ? [] : [[
        key.x + (key.x2 ?? 0), key.y + (key.y2 ?? 0), key.w2, key.h2 ?? key.h,
      ]]),
    ];
    for (let bits = 0; bits < 16; bits++) {
      const choices = Array.from({length: 4}, (_, group) => (bits >> group) & 1);
      const selected = layouts.keys.concat(
        choices.flatMap((choice, group) => layouts.optionKeys[group][choice]),
      );
      expect(selected).toHaveLength(67 + choices[0] + choices[2] - choices[3]);
      expect(new Set(selected.map(({row, col}) => `${row},${col}`)).size).toBe(selected.length);
      expect(selected.filter(({row, col}) => row === 0 && col === 15)).toMatchObject([
        {x: 15, y: 0, w: 1, h: 1},
      ]);
      for (const expectedKey of expected[1][choices[1]]) {
        const [row, col, x, y, w, h] = expectedKey;
        expect(selected.filter((key) => key.row === row && key.col === col))
          .toMatchObject([{x, y, w, h}]);
      }
      const overlaps: string[] = [];
      selected.forEach((key, index) => {
        expect(key.row >= 0 && key.row < matrix.rows && key.col >= 0 && key.col < matrix.cols).toBe(true);
        for (const [x, y, w, h] of rectangles(key)) {
          expect(x >= 0 && y >= 0 && x + w <= layouts.width && y + h <= layouts.height).toBe(true);
          for (const other of selected.slice(index + 1)) {
            if (rectangles(other).some(([ox, oy, ow, oh]) =>
              x < ox + ow && ox < x + w && y < oy + oh && oy < y + h,
            )) overlaps.push(`${key.row},${key.col}:${other.row},${other.col}`);
          }
        }
      });
      expect({choices, overlaps}).toEqual({choices, overlaps: []});
    }
    const legacy = readJSON(entry.legacy!.path);
    expect(legacy.matrix).toEqual({rows: 5, cols: 15});
    expect(legacy.layouts.keymap.flat().filter((key: unknown) =>
      typeof key === 'string' && key.split('\n')[0] === '0,15',
    )).toEqual([]);
  });

  test('BRICK65S exposes both firmware-supported Backspace layouts', async () => {
    const {keyboardDefinitionV3ToVIADefinitionV3, isKeyboardDefinitionV3} =
      await import('@the-via/reader');
    const entry = manifest.definitions.find(({id}) => id === 'brick65s')!;
    const {definitionRaw} = splitTapDanceKeycodesFromRaw(readJSON(entry.path));
    if (!isKeyboardDefinitionV3(definitionRaw)) {
      throw new Error('BRICK65S: invalid VIA V3 definition');
    }
    const {layouts} = keyboardDefinitionV3ToVIADefinitionV3(definitionRaw);
    expect(layouts.labels).toEqual([['Backspace', 'Unified', 'Split']]);
    expect(layouts.optionKeys[0][0]).toMatchObject([
      {row: 0, col: 14, x: 13, y: 0, w: 2, h: 1},
    ]);
    expect(layouts.optionKeys[0][1]).toMatchObject([
      {row: 0, col: 13, x: 13, y: 0, w: 1, h: 1},
      {row: 0, col: 14, x: 14, y: 0, w: 1, h: 1},
    ]);
    for (let choice = 0; choice < 2; choice++) {
      const selected = layouts.keys.concat(layouts.optionKeys[0][choice]);
      expect(selected.length).toBe(65 + choice);
      expect(new Set(selected.map(({row, col}) => `${row},${col}`)).size).toBe(
        selected.length,
      );
      expect(selected.find(({row, col}) => row === 0 && col === 15)).toMatchObject({
        x: 15.25, y: 0, w: 1, h: 1,
      });
    }
  });

  test('Riley renders the original five choices and all 32 physical layouts', async () => {
    const {keyboardDefinitionV3ToVIADefinitionV3, isKeyboardDefinitionV3} =
      await import('@the-via/reader');
    const entry = manifest.definitions.find(({id}) => id === 'riley')!;
    const {definitionRaw} = splitTapDanceKeycodesFromRaw(readJSON(entry.path));
    if (!isKeyboardDefinitionV3(definitionRaw)) {
      throw new Error('Riley: invalid VIA V3 definition');
    }
    const {layouts, matrix} =
      keyboardDefinitionV3ToVIADefinitionV3(definitionRaw);
    expect(matrix).toEqual({rows: 5, cols: 14});
    expect(layouts.labels).toEqual([
      ['Backspace', 'Unified', 'Split'],
      ['Enter', 'ANSI', 'ISO'],
      ['Left Shift', 'ANSI', 'ISO'],
      ['Right Shift', 'Unified', 'Split'],
      ['Bottom Row', '7U', 'Split'],
    ]);
    expect([layouts.width, layouts.height]).toEqual([15, 5]);
    const expected = [
      [[[1, 13, 13, 0, 2, 1]], [[0, 13, 13, 0, 1, 1], [1, 13, 14, 0, 1, 1]]],
      [[[2, 13, 13.5, 1, 1.5, 1], [3, 13, 12.75, 2, 2.25, 1]],
        [[3, 13, 13.75, 1, 1.25, 2], [2, 12, 12.75, 2, 1, 1]]],
      [[[3, 0, 0, 3, 2.25, 1]], [[3, 0, 0, 3, 1.25, 1], [3, 1, 1.25, 3, 1, 1]]],
      [[[3, 12, 12.25, 3, 2.75, 1]], [[3, 12, 12.25, 3, 1.75, 1], [4, 13, 14, 3, 1, 1]]],
      [[[4, 6, 4, 4, 7, 1]], [[4, 4, 4, 4, 3, 1], [4, 6, 7, 4, 1, 1], [4, 8, 8, 4, 3, 1]]],
    ];
    expected.forEach((choices, group) => {
      choices.forEach((keys, choice) => {
        expect(layouts.optionKeys[group][choice].map(
          ({row, col, x, y, w, h}) => [row, col, x, y, w, h],
        )).toEqual(keys);
      });
    });
    expect(layouts.optionKeys[1][1][0]).toMatchObject({
      w2: 1.5, h2: 1, x2: -0.25,
    });
    const covered = new Set<string>();
    for (let bits = 0; bits < 32; bits++) {
      const choices = Array.from({length: 5}, (_, group) => (bits >> group) & 1);
      const selected = layouts.keys.concat(
        choices.flatMap((choice, group) => layouts.optionKeys[group][choice]),
      );
      const coordinates = selected.map(({row, col}) => `${row},${col}`);
      expect(new Set(coordinates).size).toBe(selected.length);
      expect(selected.length).toBe(
        58 + choices[0] + choices[2] + choices[3] + 2 * choices[4],
      );
      selected.forEach(({row, col}) => {
        expect(row >= 0 && row < matrix.rows).toBe(true);
        expect(col >= 0 && col < matrix.cols).toBe(true);
      });
      coordinates.forEach((coordinate) => covered.add(coordinate));
    }
    expect([...covered].sort()).toEqual([
      ...Array.from({length: 4}, (_, row) =>
        Array.from({length: 14}, (_, col) => `${row},${col}`),
      ).flat(),
      ...[1, 2, 4, 6, 8, 11, 12, 13].map((col) => `4,${col}`),
    ].sort());
  });
});

describe('era definition tapdanceKeycodes', () => {
  test('strips tapdanceKeycodes so official V3 validation can run', () => {
    const {definitionRaw, tapdanceKeycodes} = splitTapDanceKeycodesFromRaw({
      name: 'Test',
      tapdanceKeycodes: [{name: 'TD0', title: 'Tap Dance 0', shortName: 'TD0'}],
      customKeycodes: [{name: 'USER1'}],
    });
    expect(definitionRaw.tapdanceKeycodes).toBeUndefined();
    expect(definitionRaw.customKeycodes).toEqual([{name: 'USER1'}]);
    expect(tapdanceKeycodes).toEqual([
      {name: 'TD0', title: 'Tap Dance 0', shortName: 'TD0'},
    ]);
  });

  test('reattaches tapdanceKeycodes after conversion', () => {
    const attached = attachTapDanceKeycodes({vendorProductId: 1} as any, [
      {name: 'TD0', title: 'Tap Dance 0'},
    ]);
    expect(attached.tapdanceKeycodes).toEqual([
      {name: 'TD0', title: 'Tap Dance 0'},
    ]);
  });

  test('keeps each TD entry controls and rejects malformed ones', () => {
    const controls = [
      {label: 'On Tap', type: 'keycode', content: ['id_qmk_tapdance_1_tap', 0, 32]},
      {
        label: 'Term (ms)',
        type: 'range',
        content: ['id_qmk_tapdance_1_term_exact', 0, 72],
        options: [1, 65535],
      },
    ];
    const {tapdanceKeycodes} = splitTapDanceKeycodesFromRaw({
      tapdanceKeycodes: [{name: 'TD0', title: 'Tap Dance 0', controls}],
    });
    expect(tapdanceKeycodes?.[0].controls).toEqual(controls as any);
    expect(getTapDanceControlMenu({tapdanceKeycodes})).toEqual({
      label: 'TAPDANCE',
      content: [{label: 'TD0', content: controls}],
    } as any);
    for (const bad of [
      {label: 'On Tap', type: 'toggle', content: ['id_qmk_tapdance_1_tap', 0, 32]},
      {label: 'On Tap', type: 'keycode', content: ['id_qmk_tapdance_1_tap', 0]},
      {label: 'Term', type: 'range', content: ['id_qmk_tapdance_1_term_exact', 0, 72]},
    ]) {
      expect(() =>
        splitTapDanceKeycodesFromRaw({
          tapdanceKeycodes: [{name: 'TD0', title: 'Tap Dance 0', controls: [bad]}],
        }),
      ).toThrow();
    }
  });

  // Custom JSON edits Tap Dance from KEYMAP, so its settings sit on the TD keycodes
  // instead of in a TAPDANCE menu. The stock JSON in the firmware repository keeps
  // the menu for official VIA; only the custom side moved.
  test('custom definitions carry Tap Dance settings on their TD keycodes, not in a menu', () => {
    for (const entry of manifest.definitions) {
      const definition = readJSON(entry.path);
      const menus = (definition.menus ?? []) as {label?: string}[];
      expect({id: entry.id, menu: menus.some((menu) => menu?.label === 'TAPDANCE')}).toEqual({
        id: entry.id,
        menu: false,
      });
      const keycodes = (definition.tapdanceKeycodes ?? []) as {
        name: string;
        controls?: {content: [string, number, number]}[];
      }[];
      if (!entry.exactMsFamily) {
        expect({id: entry.id, count: keycodes.length}).toEqual({id: entry.id, count: 0});
        continue;
      }
      keycodes.forEach((keycode, slot) => {
        expect(keycode.name).toBe(`TD${slot}`);
        expect({
          id: entry.id,
          name: keycode.name,
          roles: (keycode.controls ?? []).map(({content}) =>
            content[0].replace(`id_qmk_tapdance_${slot + 1}_`, ''),
          ),
        }).toEqual({
          id: entry.id,
          name: keycode.name,
          roles: ['mode', 'tap', 'hold', 'dtap', 'thold', 'term_exact', 'hold_term', 'hold_other'],
        });
      });
    }
  });

  test('recognizes only TD0-TD7 names as tap dance labels', () => {
    expect(isTapDanceKeycodeName('TD0')).toBe(true);
    expect(isTapDanceKeycodeName('TD7')).toBe(true);
    expect(isTapDanceKeycodeName('TD8')).toBe(false);
    expect(isTapDanceKeycodeName('USER1')).toBe(false);
  });

  test('Custom tab requires customKeycodes; TAPDANCE tab requires tapdanceKeycodes', () => {
    expect(hasCustomKeycodeTab({tapdanceKeycodes: [{name: 'TD0'}]})).toBe(
      false,
    );
    expect(hasCustomKeycodeTab({customKeycodes: [{name: 'USER1'}]})).toBe(true);
    expect(hasCustomKeycodeTab({customKeycodes: []})).toBe(false);
    expect(hasCustomKeycodeTab({})).toBe(false);
    expect(customKeycodeWireIndex(0, 8)).toBe(8);
    expect(customKeycodeWireIndex(0, 0)).toBe(0);
  });

  test('definition lookup implements the complete ERA > official > upload matrix', () => {
    const source = (name: string) => ({1: {v3: {name} as any}});
    const selected = (
      official: ReturnType<typeof source> | {},
      upload: ReturnType<typeof source> | {},
      era: ReturnType<typeof source> | {},
    ) => mergeDefinitionLookup(official, upload, era)[1]?.v3?.name;

    expect(selected(source('official'), source('upload'), source('era'))).toBe(
      'era',
    );
    expect(selected({}, source('upload'), source('era'))).toBe('era');
    expect(selected(source('official'), {}, source('era'))).toBe('era');
    expect(selected(source('official'), source('upload'), {})).toBe('official');
    expect(selected(source('official'), {}, {})).toBe('official');
    expect(selected({}, source('upload'), {})).toBe('upload');
    expect(selected({}, {}, {})).toBeUndefined();
  });

  test('stored upload, selection switches, and reconnects keep built-in priority', () => {
    const upload = {1: {v3: {name: 'old-upload'} as any}};
    expect(mergeDefinitionLookup({}, upload, {})[1].v3?.name).toBe(
      'old-upload',
    );
    const official = {1: {v3: {name: 'official'} as any}};
    expect(mergeDefinitionLookup(official, upload, {})[1].v3?.name).toBe(
      'official',
    );
    const era = {1: {v3: {name: 'era'} as any}};
    const replacedUpload = {1: {v3: {name: 'new-upload'} as any}};
    expect(
      mergeDefinitionLookup(official, replacedUpload, era)[1].v3?.name,
    ).toBe('era');
    expect(mergeDefinitionLookup(official, {}, era)[1].v3?.name).toBe('era');

    const switched = mergeDefinitionLookup(
      {2: {v3: {name: 'official-2'} as any}},
      {1: {v3: {name: 'upload-1'} as any}},
      {1: {v3: {name: 'era-1'} as any}},
    );
    expect(switched[1].v3?.name).toBe('era-1');
    expect(switched[2].v3?.name).toBe('official-2');

    const afterReconnect = mergeDefinitionLookup(
      {2: {v3: {name: 'official-2'} as any}},
      {
        1: {v3: {name: 'reloaded-upload-1'} as any},
        2: {v3: {name: 'reloaded-upload-2'} as any},
      },
      {1: {v3: {name: 'era-1'} as any}},
    );
    expect(afterReconnect[2].v3?.name).toBe('official-2');
    expect(afterReconnect[1].v3?.name).toBe('era-1');
  });
});

describe('canonical ERA definition inventory', () => {
  const qmkEntries = manifest.definitions.filter((entry) =>
    expectedQmkDefinitionIds.includes(entry.id),
  );

  test('lists every QMK ERA custom definition variant', () => {
    expect(qmkEntries.map(({id}) => id).sort()).toEqual(
      expectedQmkDefinitionIds,
    );
  });

  test('keeps cross-repository provenance out of the app manifest', () => {
    expect(manifestRaw.schemaVersion).toBeUndefined();
    expect(manifestRaw.definitionSource).toBeUndefined();
    expect(manifestRaw.officialDefinitions).toBeUndefined();
    expect(manifestRaw.firmwareSources).toBeUndefined();
    for (const entry of manifest.definitions as (DefinitionEntry &
      Record<string, unknown>)[]) {
      expect(entry.stockPath).toBeUndefined();
      expect(entry.definitionVersion).toBeUndefined();
      expect(entry.firmwareFamily).toBeUndefined();
      expect(entry.firmwareSource).toBeUndefined();
      expect(entry.firmwareChecks).toBeUndefined();
    }
  });

  // ADR 0004 §1-2: current firmware reports a maker identity; older firmware keeps
  // reporting the shared 0x4552 one and is served the definition it shipped with,
  // because the current one reads commands that firmware does not answer.
  const parseUsbId = (value: string) => Number.parseInt(value.slice(2), 16);
  const isMakerIdentity = ({vendorId}: UsbIdentity) =>
    parseUsbId(vendorId) >= 0x4500 && parseUsbId(vendorId) <= 0x453f;

  test('serves every ERA board under a maker identity and its legacy identity', () => {
    const served = new Set<number>();
    for (const entry of manifest.definitions) {
      const identities = [entry, ...(entry.identities ?? [])];
      if (entry.id === 'brick65') {
        // Not an ERA board: its own identity, no maker identity, no legacy one.
        expect(entry.vendorId).toBe('0x5943');
        expect(entry.identities).toBeUndefined();
        expect(entry.legacy).toBeUndefined();
      } else {
        expect({id: entry.id, maker: identities.every(isMakerIdentity)}).toEqual({
          id: entry.id,
          maker: true,
        });
        expect(entry.legacy).toMatchObject({vendorId: '0x4552'});
        expect(entry.legacy!.path).toBe(
          entry.path.replace('era-definitions/custom/v3/', 'era-definitions/legacy/v3/'),
        );
        const legacy = readJSON(entry.legacy!.path);
        expect({vendorId: legacy.vendorId, productId: legacy.productId}).toEqual({
          vendorId: entry.legacy!.vendorId,
          productId: entry.legacy!.productId,
        });
      }
      const custom = readJSON(entry.path);
      expect({vendorId: custom.vendorId, productId: custom.productId}).toEqual({
        vendorId: entry.vendorId,
        productId: entry.productId,
      });
      for (const identity of [...identities, ...(entry.legacy ? [entry.legacy] : [])]) {
        const vpid = parseUsbId(identity.vendorId) * 0x10000 + parseUsbId(identity.productId);
        expect({id: entry.id, duplicate: served.has(vpid)}).toEqual({
          id: entry.id,
          duplicate: false,
        });
        served.add(vpid);
      }
    }
  });

  test('serves each shared N-series board under all three makers from one JSON', () => {
    for (const id of ['n8x', 'n86', 'n87']) {
      const entry = manifest.definitions.find((definition) => definition.id === id)!;
      expect(
        [entry, ...(entry.identities ?? [])].map(({vendorId}) => vendorId).sort(),
      ).toEqual(['0x4501', '0x4502', '0x4504']);
    }
    expect(
      manifest.definitions.filter(({identities}) => identities).map(({id}) => id).sort(),
    ).toEqual(['n86', 'n87', 'n8x']);
  });

  // The legacy tree is what older firmware was released against. It is frozen:
  // current work belongs in the canonical definition, so any edit here is a mistake.
  test('keeps the legacy definitions exactly as they shipped', () => {
    const canonicalize = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(canonicalize)
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.keys(value)
                .sort()
                .map((key) => [
                  key,
                  canonicalize((value as Record<string, unknown>)[key]),
                ]),
            )
          : value;
    const paths = manifest.definitions
      .flatMap(({legacy}) => (legacy ? [legacy.path] : []))
      .sort();
    expect(paths).toHaveLength(32);
    const digest = createHash('sha256');
    for (const legacyPath of paths) {
      digest.update(legacyPath);
      digest.update(JSON.stringify(canonicalize(readJSON(legacyPath))));
    }
    expect(digest.digest('hex')).toBe(
      '085458c07fe93a71a4f68652f1b47e23108f3be01e8060ec983b4d155ef87d65',
    );
  });

  for (const entry of qmkEntries) {
    test(`${entry.id} keeps the custom-client contract`, () => {
      const custom = readJSON(entry.path);
      const customTerms = collectTermControls(custom);

      expect(custom.customKeycodes).not.toEqual([]);

      if (entry.id === 'brick65') {
        expect(entry.stateSync).toBe(false);
        expect(entry.exactMsFamily).toBeUndefined();
        expect(customTerms).toEqual([]);
        expect(custom.tapdanceKeycodes).toBeUndefined();
        return;
      }

      expect(entry.stateSync).toBe(true);
      expect(entry.exactMsFamily).toBe('qmk');
      expect(keycodeNames(custom.tapdanceKeycodes).sort()).toEqual(
        expectedTapDanceNames,
      );
      expect(
        keycodeNames(custom.customKeycodes).filter(isTapDanceKeycodeName),
      ).toEqual([]);
      expect(custom.customKeycodes).toBeUndefined();

      const customAddresses = customTerms
        .map(({name, channel, id}) => `${name}:${channel}:${id}`)
        .sort();
      expect(customAddresses).toEqual(expectedQmkTermAddresses);
      expect(customTerms.filter(({name}) => !name.endsWith('_exact'))).toEqual(
        [],
      );
      expect(
        customTerms
          .filter(({name}) => name.endsWith('_exact'))
          .map(({options}) => options),
      ).toEqual(Array.from({length: 9}, () => [1, 65535]));
    });
  }

  test('gives exactly the 27 RP2040 definitions one live VERSION label and excludes brick65', () => {
    const actual: string[] = [];
    for (const entry of qmkEntries) {
      const definition = readJSON(entry.path);
      const versionControls = collectCommandControls(definition).filter(
        ({name}) => name === 'id_qmk_ver_ascii',
      );
      expect(JSON.stringify(definition)).not.toContain('260901R1');
      if (entry.id === 'brick65') {
        expect(submenuLabels(definition, 'SYSTEM')).not.toContain('VERSION');
        expect(versionControls).toEqual([]);
        continue;
      }
      actual.push(entry.id);
      expect(submenuLabels(definition, 'SYSTEM')[0]).toBe('VERSION');
      expect(
        submenuLabels(definition, 'SYSTEM').filter(
          (label) => label === 'VERSION',
        ),
      ).toEqual(['VERSION']);
      expect(versionControls).toEqual([
        {
          name: 'id_qmk_ver_ascii',
          channel: 8,
          id: 1,
          label: 'Current Version',
          type: 'label',
          options: undefined,
        },
      ]);
    }
    expect(actual).toHaveLength(27);
    expect(actual.sort()).toEqual(expectedRp2040DefinitionIds);
  });

  test('keeps the VERSION definition identical across each RP2040 split pair', () => {
    const pairs = new Map<string, unknown[]>();
    for (const entry of manifest.definitions.filter(({pair}) => pair)) {
      const definition = readJSON(entry.path);
      const system = (
        (definition.menus ?? []) as {
          label?: string;
          content?: unknown[];
        }[]
      ).find(({label}) => label === 'SYSTEM');
      const version = (system?.content ?? []).find(
        (submenu) =>
          !!submenu &&
          typeof submenu === 'object' &&
          'label' in submenu &&
          (submenu as {label: unknown}).label === 'VERSION',
      );
      pairs.set(entry.pair!, [...(pairs.get(entry.pair!) ?? []), version]);
    }
    expect([...pairs.keys()].sort()).toEqual([
      'tomak-tkl',
      'tomak79h',
      'tomak79s',
    ]);
    for (const versions of pairs.values()) {
      expect(versions).toHaveLength(2);
      expect(versions[0]).toEqual(versions[1]);
    }
  });

  test('gives all five H7S definitions one first, read-only ASCII VERSION value', () => {
    const h7s = manifest.definitions.filter(
      ({exactMsFamily}) => exactMsFamily === 'h7s',
    );
    expect(h7s.map(({id}) => id).sort()).toEqual(
      expectedUsbDiagnosticsDefinitionIds,
    );
    for (const entry of h7s) {
      const definition = readJSON(entry.path);
      expect(submenuLabels(definition, 'SYSTEM')[0]).toBe('VERSION');
      expect(
        submenuLabels(definition, 'SYSTEM').filter(
          (label) => label === 'VERSION',
        ),
      ).toEqual(['VERSION']);
      const versionControls = collectCommandControls(definition)
        .filter(({name}) => name.startsWith('id_qmk_ver_'))
        .map(({name, channel, id, label, type, options}) => ({
          name,
          channel,
          id,
          label,
          type,
          options,
        }));
      expect(versionControls).toEqual([
        {
          name: 'id_qmk_ver_ascii',
          channel: 8,
          id: 5,
          label: 'Current Version',
          type: 'label',
          options: undefined,
        },
      ]);
    }
  });

  test('gives H7S the same nonzero uint16 exact-ms range as QMK', () => {
    const entry = manifest.definitions.find(
      ({exactMsFamily}) => exactMsFamily === 'h7s',
    );
    expect(entry).toBeDefined();
    const customExact = collectTermControls(readJSON(entry!.path)).filter(
      ({name}) => name.endsWith('_exact'),
    );
    expect(customExact.map(({options}) => options)).toEqual(
      Array.from({length: 9}, () => [1, 65535]),
    );
    expect(
      collectTermControls(readJSON(entry!.path)).filter(
        ({name}) => !name.endsWith('_exact'),
      ),
    ).toEqual([]);
  });

  // The H7S firmware has implemented the mouse-key page since V260823R1, but on its
  // own channel: the reference QMK number 13 is taken by USB POLLING there, so
  // `via.h` assigns `id_qmk_mousekey = 17`. Value ids 1-6 match the reference.
  test('gives every H7S definition the MOUSE page on channel 17', () => {
    const h7s = manifest.definitions.filter(
      ({exactMsFamily}) => exactMsFamily === 'h7s',
    );
    expect(h7s.map(({id}) => id).sort()).toEqual(
      expectedUsbDiagnosticsDefinitionIds,
    );
    for (const entry of h7s) {
      const definition = readJSON(entry.path);
      expect(submenuLabels(definition, 'FEATURE')).toEqual([
        'SOCD',
        'KKUK',
        'DEBOUNCE',
        'TAPPING',
        'MOUSE',
      ]);
      expect(submenuLabels(definition, 'SYSTEM')).toEqual([
        'VERSION',
        'USB POLLING',
        'SLEEP',
        'BOOT',
        'EEPROM',
      ]);
      expect(
        collectCommandControls(definition).filter(
          ({name}) => name === 'id_qmk_rgb_sleep_timeout_exact',
        ),
      ).toEqual([
        expect.objectContaining({
          channel: 18,
          id: 2,
          label: 'RGB Sleep Timeout (s)',
          options: [1, 65535],
          showIf: '{id_qmk_rgb_sleep_enable} == 1',
        }),
      ]);
      expect(
        collectCommandControls(definition).filter(
          ({name}) => name === 'id_qmk_rgb_sleep_enable',
        ),
      ).toEqual([
        expect.objectContaining({
          channel: 18,
          id: 3,
          label: 'RGB Sleep',
          type: 'toggle',
        }),
      ]);
      const mouse = collectCommandControls(definition).filter(({name}) =>
        name.startsWith('id_qmk_mousekey_'),
      );
      expect(mouse.map(({channel}) => channel)).toEqual(
        Array.from({length: mouse.length}, () => 17),
      );
      expect([...new Set(mouse.map(({id}) => id))].sort()).toEqual([
        1, 2, 3, 4, 5, 6,
      ]);
      // Acceleration off swaps a single "Cursor Speed" row in for the start/top pair.
      const serialized = JSON.stringify(definition);
      expect(serialized).toContain(
        '{id_qmk_mousekey_cursor_acceleration} == 0',
      );
      expect(serialized).toContain(
        '{id_qmk_mousekey_cursor_acceleration} != 0',
      );
      // H7S is always 20-key rollover with no switch, so a toggle would be a lie.
      expect(serialized).not.toContain('id_qmk_custom_nkro');
    }
  });

  test('leaves the QMK definitions on the reference mouse channel', () => {
    const era65 = collectCommandControls(
      readJSON('era-definitions/custom/v3/era65/ERA65-VIA.json'),
    ).filter(({name}) => name.startsWith('id_qmk_mousekey_'));
    expect(era65.length).toBeGreaterThan(0);
    expect([...new Set(era65.map(({channel}) => channel))]).toEqual([13]);
  });

  test('gives every RGB-capable definition the master toggle and, but for brick65, the exact-second timeout', () => {
    const actualToggle: string[] = [];
    const actualTimeout: string[] = [];
    for (const entry of manifest.definitions) {
      const definition = readJSON(entry.path);
      const allControls = collectCommandControls(definition);
      const controls = allControls.filter(
        ({name}) => name === 'id_qmk_rgb_sleep_timeout_exact',
      );
      const toggles = allControls.filter(
        ({name}) => name === 'id_qmk_rgb_sleep_enable',
      );
      if (controls.length === 0 && toggles.length === 0) {
        continue;
      }
      if (toggles.length !== 0) {
        actualToggle.push(entry.id);
        expect(toggles).toHaveLength(1);
        expect(toggles[0]).toMatchObject({label: 'RGB Sleep', type: 'toggle'});
      }
      if (controls.length !== 0) {
        actualTimeout.push(entry.id);
        expect(controls).toHaveLength(1);
        expect(controls[0].showIf).toBe('{id_qmk_rgb_sleep_enable} == 1');
      }
      const serialized = JSON.stringify(definition);
      if (entry.exactMsFamily === 'h7s') {
        expect(controls).toHaveLength(1);
        expect(controls[0]).toMatchObject({
          channel: 18,
          id: 2,
          options: [1, 65535],
        });
        expect(toggles[0]).toMatchObject({channel: 18, id: 3});
        expect(serialized).toContain('id_qmk_rgblight_');
      } else if (expectedRgbSleepTimeoutDefinitionIds.includes(entry.id)) {
        expect(controls).toHaveLength(1);
        expect(controls[0]).toMatchObject({
          channel: 9,
          id: 11,
          options: [1, 65535],
        });
        expect(toggles[0]).toMatchObject({channel: 9, id: 12});
      } else {
        expect(controls).toHaveLength(0);
        expect(toggles[0]).toMatchObject({channel: 9, id: 12});
      }
    }
    expect(actualToggle.sort()).toEqual(expectedRgbSleepToggleDefinitionIds);
    expect(actualTimeout.sort()).toEqual(expectedRgbSleepTimeoutDefinitionIds);
  });

  // The backlight sleeps on its own switch and timeout, beside RGB's on the same
  // SLEEP page, in the same two client forms: official JSON keeps the minute preset
  // (9/14), the custom JSON edits the same stored value in exact seconds (9/15).
  test('gives each backlight board its own sleep switch and exact-second timeout', () => {
    const actual: string[] = [];
    for (const entry of manifest.definitions) {
      const definition = readJSON(entry.path);
      const controls = collectCommandControls(definition).filter(({name}) =>
        name.startsWith('id_qmk_backlight_sleep_'),
      );
      if (controls.length === 0) {
        continue;
      }
      actual.push(entry.id);
      expect({id: entry.id, controls}).toEqual({
        id: entry.id,
        controls: [
          expect.objectContaining({
            name: 'id_qmk_backlight_sleep_enable',
            channel: 9,
            id: 13,
            label: 'Backlight Sleep',
            type: 'toggle',
          }),
          expect.objectContaining({
            name: 'id_qmk_backlight_sleep_timeout_exact',
            channel: 9,
            id: 15,
            label: 'Backlight Sleep Timeout (s)',
            type: 'range',
            options: [1, 65535],
            showIf: '{id_qmk_backlight_sleep_enable} == 1',
          }),
        ],
      });
      expect(submenuLabels(definition, 'SYSTEM')).toContain('SLEEP');
      expect(
        submenuControlLabels(definition, 'SYSTEM', 'SLEEP').slice(-2),
      ).toEqual(['Backlight Sleep', 'Backlight Sleep Timeout (s)']);
    }
    expect(actual.sort()).toEqual(expectedBacklightSleepDefinitionIds);
  });

  // Both firmware families choose the SOCD resolution per pair (value 4 of each
  // pair's channel, 1..5), so the custom JSON offers the same Mode row as the
  // official one. KKUK still has a single behaviour, so its mode stays hidden.
  test('offers the SOCD mode per pair, hides the KKUK mode and keeps shared control order', () => {
    const modeOptions = (first: string, second: string) => [
      ['Last Input', 1],
      ['Neutral', 2],
      ['First Input', 3],
      [`${first} Priority`, 4],
      [`${second} Priority`, 5],
    ];
    for (const entry of manifest.definitions) {
      const definition = readJSON(entry.path);
      const serialized = JSON.stringify(definition);
      if (!serialized.includes('id_qmk_kkuk_enable')) {
        continue;
      }
      expect(serialized).not.toContain('id_qmk_kkuk_mode');
      const h7s = entry.exactMsFamily === 'h7s';
      const controls = collectCommandControls(definition);
      for (const [pair, channel, first, second] of [
        ['lr', 10, 'Left', 'Right'],
        ['ud', 11, 'Up', 'Down'],
      ] as const) {
        const mode = h7s ? `id_qmk_kill_switch_mode_${pair}` : `id_qmk_socd_${pair}_mode`;
        const enable = h7s ? `id_qmk_kill_switch_enable_${pair}` : `id_qmk_socd_${pair}_enable`;
        expect({id: entry.id, mode: controls.filter(({name}) => name === mode)}).toEqual({
          id: entry.id,
          mode: [
            expect.objectContaining({
              channel,
              id: 4,
              type: 'dropdown',
              options: modeOptions(first, second),
              showIf: `{${enable}} == 1`,
            }),
          ],
        });
        // Every choice is explained where it is picked.
        const help = findEraControlHelp(mode, `${pair === 'lr' ? 'Left/Right' : 'Up/Down'} Mode`);
        expect(help?.choices?.map(({name}) => name)).toEqual(
          modeOptions(first, second).map(([label]) => label),
        );
      }
      expect(submenuControlLabels(definition, 'FEATURE', 'SOCD')).toEqual([
        'Left/Right Enable',
        'Left/Right Mode',
        'Left Key',
        'Right Key',
        'Up/Down Enable',
        'Up/Down Mode',
        'Up Key',
        'Down Key',
      ]);
      expect(submenuControlLabels(definition, 'FEATURE', 'KKUK')).toEqual([
        'Enable',
        'First Delay Time',
        'Repeat Time',
      ]);
      expect(submenuControlLabels(definition, 'FEATURE', 'DEBOUNCE')).toEqual([
        'Debounce Mode',
        'Press & Release Delay',
        'Press Delay',
        'Press & Release Cooldown',
        'Release Delay',
      ]);
      expect(submenuControlLabels(definition, 'FEATURE', 'TAPPING')).toEqual([
        'Global Tapping Term (ms)',
        'Permissive Hold',
        'Hold on Other Key Press',
        'Retro Tapping',
      ]);
    }
  });

  // Both firmware families ship official JSON that hides these rows while the
  // setting that overrides them is active. The H7S and TOMAK79H custom JSON once
  // kept showing them, so the same keyboard looked different in each client.
  test('shares the official JSON visibility rules for overridden rows', () => {
    const rules = {
      id_qmk_tapping_permissive_hold:
        '{id_qmk_tapping_hold_on_other_key_press} == 0',
      id_qmk_rgb_matrix_brightness: '{id_qmk_rgb_matrix_effect} != 0',
    } as const;
    for (const entry of manifest.definitions) {
      const controls = collectCommandControls(readJSON(entry.path));
      for (const [name, showIf] of Object.entries(rules)) {
        for (const control of controls.filter((c) => c.name === name)) {
          expect({id: entry.id, showIf: control.showIf}).toEqual({
            id: entry.id,
            showIf,
          });
        }
      }
    }
  });

  test('gives every H7S definition the lighting keycode tab', () => {
    for (const entry of manifest.definitions.filter(
      ({exactMsFamily}) => exactMsFamily === 'h7s',
    )) {
      expect({
        id: entry.id,
        keycodes: readJSON(entry.path).keycodes,
      }).toEqual({id: entry.id, keycodes: ['qmk_lighting']});
    }
  });

  // The SOCD menu shipped without help for twenty-five definitions because the RP2040
  // firmware calls it `id_qmk_socd_*` while H7S calls it `id_qmk_kill_switch_*`, and
  // only the second prefix was registered. Nothing failed, because no test asked "does
  // every ERA submenu actually resolve to help?". This one asks, and any submenu that
  // legitimately has none has to be named here rather than passing silently. These
  // have none because their rows already say everything a line above them would.
  const SUBMENUS_WITHOUT_HELP: string[] = [
    'Backlight',
    'Badge',
    'Indicators',
    'Per-Key RGB',
    'RGB LEDs',
    'RGB Row',
    'Underglow',
    'VERSION',
  ];

  test('every ERA submenu resolves to feature help, or is listed as not having any', () => {
    const uncovered = new Map<string, string[]>();
    for (const entry of manifest.definitions) {
      const definition = readJSON(entry.path);
      const menus = (definition.menus ?? []) as {content?: unknown[]}[];
      for (const menu of menus) {
        if (!menu || typeof menu !== 'object' || !Array.isArray(menu.content)) {
          continue;
        }
        for (const submenu of menu.content) {
          if (
            !submenu ||
            typeof submenu !== 'object' ||
            !('label' in submenu) ||
            typeof (submenu as {label: unknown}).label !== 'string'
          ) {
            continue;
          }
          const label = (submenu as {label: string}).label;
          const commands = collectCommandControls(submenu).map(
            ({name}) => name,
          );
          if (commands.length === 0 || findEraFeatureHelp(commands)) {
            continue;
          }
          uncovered.set(label, [...(uncovered.get(label) ?? []), entry.id]);
        }
      }
    }
    expect([...uncovered.keys()].sort()).toEqual(
      [...SUBMENUS_WITHOUT_HELP].sort(),
    );
  });

  test('both firmware families name the same SOCD feature', () => {
    // H7S: id_qmk_kill_switch_*. RP2040: id_qmk_socd_*. Same feature, one explanation.
    const h7s = findEraFeatureHelp(['id_qmk_kill_switch_enable_lr']);
    const rp2040 = findEraFeatureHelp(['id_qmk_socd_lr_enable']);
    expect(h7s).not.toBeNull();
    expect(rp2040).toEqual(h7s!);
  });

  // Help that lists named choices is held to the dropdowns it explains: every option a
  // definition offers is described, in the dropdown's order, and nothing else is; the
  // marked default is one of them. A firmware that renames or adds a choice fails here
  // instead of leaving the help describing a different menu. One list can serve two
  // spellings of a command (a lock indicator's RGB Effect or Off), so a dropdown shows
  // the part it offers, and every choice has to be offered by some dropdown.
  test('help choices match the options of every dropdown they explain', () => {
    const checked = new Set<string>();
    const offered = new Map<unknown, Set<string>>();
    for (const entry of manifest.definitions) {
      for (const control of collectCommandControls(readJSON(entry.path))) {
        if (control.type !== 'dropdown' || !Array.isArray(control.options)) {
          continue;
        }
        const options = (control.options as ([string, number] | string)[]).map(
          (option) => (typeof option === 'string' ? option : option[0]),
        );
        const listed = findEraControlHelp(control.name, control.label);
        const help = findEraControlHelp(control.name, control.label, options);
        if (!listed?.choices) {
          continue;
        }
        expect({
          id: entry.id,
          command: control.name,
          names: help?.choices?.map(({name}) => name),
        }).toEqual({id: entry.id, command: control.name, names: options});
        options.forEach((option) =>
          offered.set(listed, (offered.get(listed) ?? new Set()).add(option)),
        );
        checked.add(control.name);
      }
    }
    for (const {command, help} of eraControlHelpEntries()) {
      if (help.defaultChoice) {
        expect({command, names: help.choices?.map(({name}) => name) ?? []})
          .toMatchObject({command, names: expect.arrayContaining([help.defaultChoice])});
      }
      for (const {name} of help.choices ?? []) {
        expect({command, name, offered: offered.get(help)?.has(name)}).toEqual({
          command,
          name,
          offered: true,
        });
      }
    }
    expect(checked.size).toBeGreaterThanOrEqual(5);
  });

  test('both firmware families use the same RGB sleep help', () => {
    const h7s = findEraFeatureHelp(['id_qmk_rgb_sleep_timeout']);
    const rp2040 = findEraFeatureHelp(['id_qmk_rgb_sleep_timeout_exact']);
    expect(h7s).not.toBeNull();
    expect(rp2040).toEqual(h7s!);
  });

  test('keeps refreshed lighting labels consistent across ERA definitions', () => {
    const tomakIds = [
      'tomak-tkl-left',
      'tomak-tkl-right',
      'tomak79h-left',
      'tomak79h-right',
      'tomak79s-left',
      'tomak79s-right',
    ];
    for (const entry of manifest.definitions) {
      const serialized = JSON.stringify(readJSON(entry.path));
      expect(serialized).not.toContain('Breating Period');
      if (tomakIds.includes(entry.id)) {
        expect(serialized).toContain('RGB-Only');
        expect(serialized).toContain('Indicator-Only');
        expect(serialized).not.toContain('Badge-Only RGB');
        expect(serialized).not.toContain('Indicator Only');
      }
    }
  });

  test('keeps Riley on RGB Effect plus three independent lock-indicator slots without a persistent All Off choice', () => {
    const entry = manifest.definitions.find(({id}) => id === 'riley');
    expect(entry).toBeDefined();
    const definition = readJSON(entry!.path);
    const controls = collectCommandControls(definition);
    const byName = new Map(controls.map((control) => [control.name, control]));

    expect(byName.get('id_qmk_rgblight_effect')?.options).toEqual(
      expect.arrayContaining([
        ['Solid Color', 1],
        ['Rainbow Swirl 1', 9],
        ['Twinkle 6', 42],
      ]),
    );
    expect(
      JSON.stringify(byName.get('id_qmk_rgblight_effect')?.options),
    ).not.toContain('All Off');
    expect(
      (byName.get('id_qmk_rgblight_effect')?.options as unknown[][]).map(
        (option) => option[1],
      ),
    ).not.toContain(0);

    expect(byName.get('id_qmk_custom_riley_indicator_only')).toMatchObject({
      channel: 0,
      id: 22,
      label: 'Indicator-Only',
      type: 'toggle',
    });

    for (const [slot, base] of [
      [1, 13],
      [2, 16],
      [3, 19],
    ] as const) {
      expect(byName.get(`id_qmk_custom_riley_ind${slot}_mode`)).toMatchObject({
        channel: 0,
        id: base,
        label: `Indicator ${slot}`,
        type: 'dropdown',
        options: [
          ['RGB Effect', 0],
          ['Caps Lock', 1],
          ['Scroll Lock', 2],
          ['Num Lock', 3],
        ],
      });
      expect(
        byName.get(`id_qmk_custom_riley_ind${slot}_brightness`),
      ).toMatchObject({
        channel: 0,
        id: base + 1,
        label: `Indicator ${slot} Brightness`,
        type: 'range',
        options: [0, 255],
      });
      expect(byName.get(`id_qmk_custom_riley_ind${slot}_color`)).toMatchObject({
        channel: 0,
        id: base + 2,
        label: `Indicator ${slot} Color`,
        type: 'color',
      });
    }
  });

  // H7S once listed Pulse first and numbered On before Off (43 On / 44 Off). Both
  // firmware families now share one numbering, and every list reads in value order.
  test('numbers the RGBLight Pulse effects alike on both firmware families', () => {
    const pulse = [
      ['Pulse Off Press', 43],
      ['Pulse On Press', 44],
      ['Pulse Off Press (Hold)', 45],
      ['Pulse On Press (Hold)', 46],
    ];
    const withPulse: string[] = [];
    for (const entry of manifest.definitions) {
      const effect = collectCommandControls(readJSON(entry.path)).find(
        ({name}) => name === 'id_qmk_rgblight_effect',
      );
      const options = (effect?.options ?? []) as [string, number][];
      if (!options.some(([label]) => label.startsWith('Pulse'))) {
        continue;
      }
      withPulse.push(entry.id);
      const values = options.map(([, value]) => value);
      expect({id: entry.id, ordered: values}).toEqual({
        id: entry.id,
        ordered: [...values].sort((a, b) => a - b),
      });
      expect({
        id: entry.id,
        pulse: options.filter(([label]) => label.startsWith('Pulse')),
      }).toEqual({id: entry.id, pulse});
    }
    expect(withPulse).toEqual(
      expect.arrayContaining(expectedUsbDiagnosticsDefinitionIds),
    );
  });

  test('uses the six common Backlight modes without retired Blink labels', () => {
    const expectedModes = [
      ['Steady', 0],
      ['Breathing', 1],
      ['Pulse Off Press', 2],
      ['Pulse On Press', 3],
      ['Pulse Off Press (Hold)', 4],
      ['Pulse On Press (Hold)', 5],
    ];
    for (const entry of manifest.definitions) {
      const definition = readJSON(entry.path);
      const controls = collectCommandControls(definition);
      const effect = controls.find(
        ({name}) => name === 'id_custom_backlight_effect',
      );
      if (!effect) {
        continue;
      }
      expect({id: entry.id, modes: effect.options}).toEqual({
        id: entry.id,
        modes: expectedModes,
      });
      const serialized = JSON.stringify(definition);
      expect(serialized).not.toContain('Blink-Out on Keypress');
      expect(serialized).not.toContain('Blink-In on Keypress');
      expect(serialized).not.toContain('Blink Speed');
      expect(serialized).toContain('Pulse Speed');
      // Pulse Speed is the same full slider as RGBLight's Effect Speed: the
      // firmware maps 0..255 to a 5 + speed ms pulse on both families.
      const pulseSpeed = controls.find(
        ({name}) => name === 'id_custom_blink_speed',
      );
      expect({id: entry.id, options: pulseSpeed?.options}).toEqual({
        id: entry.id,
        options: [0, 255],
      });
    }
  });

  // N86, N87 and KLEIN_SD once used VIA's built-in RGB Matrix menu, whose list lacks
  // Flower Blooming, the Starlight effects and Riverflow, so every name from 23 on
  // was shifted and some effects could not be chosen. Every explicit list is this one.
  test('keeps every RGB Matrix effect menu on the firmware wire ids', () => {
    // This is the supported firmware wire order, not a comparison against a
    // sibling JSON: two halves can share the same mistaken labels and ids.
    const labels = [
      'All Off', 'Solid Color', 'Alphas Mods', 'Gradient Up/Down',
      'Gradient Left/Right', 'Breathing', 'Band Sat.', 'Band Val.',
      'Pinwheel Sat.', 'Pinwheel Val.', 'Spiral Sat.', 'Spiral Val.',
      'Cycle All', 'Cycle Left/Right', 'Cycle Up/Down',
      'Rainbow Moving Chevron', 'Cycle Out/In', 'Cycle Out/In Dual',
      'Cycle Pinwheel', 'Cycle Spiral', 'Dual Beacon', 'Rainbow Beacon',
      'Rainbow Pinwheels', 'Flower Blooming', 'Raindrops', 'Jellybean Raindrops',
      'Hue Breathing', 'Hue Pendulum', 'Hue Wave', 'Pixel Rain', 'Pixel Flow',
      'Pixel Fractal', 'Typing Heatmap', 'Digital Rain', 'Solid Reactive Simple',
      'Solid Reactive', 'Solid Reactive Wide', 'Solid Reactive Multi Wide',
      'Solid Reactive Cross', 'Solid Reactive Multi Cross', 'Solid Reactive Nexus',
      'Solid Reactive Multi Nexus', 'Splash', 'Multi Splash', 'Solid Splash',
      'Solid Multi Splash', 'Starlight Smooth', 'Starlight', 'Starlight Dual Sat.',
      'Starlight Dual Hue.', 'Riverflow',
    ];
    const expected = labels.map((label, id) => [label, id]);
    const withEffect: string[] = [];
    for (const entry of manifest.definitions) {
      const definition = readJSON(entry.path);
      const effect = collectCommandControls(definition).find(
        ({name}) => name === 'id_qmk_rgb_matrix_effect',
      );
      if (!effect) {
        continue;
      }
      withEffect.push(entry.id);
      expect({definition: entry.id, effect}).toEqual({
        definition: entry.id,
        effect: expect.objectContaining({channel: 3, id: 2, options: expected}),
      });
    }
    expect(withEffect.sort()).toEqual(
      [
        'chickpad',
        'fave65s',
        'klein-sd',
        'n86',
        'n87',
        'tomak-tkl-left',
        'tomak-tkl-right',
        'tomak79h-left',
        'tomak79h-right',
        'tomak79s-left',
        'tomak79s-right',
      ].sort(),
    );
    // Only the ATmega brick65 keeps VIA's built-in menu.
    for (const entry of manifest.definitions) {
      const builtIn = ((readJSON(entry.path).menus ?? []) as unknown[]).filter(
        (menu) => typeof menu === 'string',
      );
      expect({id: entry.id, builtIn}).toEqual({
        id: entry.id,
        builtIn: entry.id === 'brick65' ? ['qmk_rgb_matrix'] : [],
      });
    }
  });

  // Lighting submenus are named after where the LEDs sit, never after the engine
  // driving them, and lock indicators live in one Indicators submenu under Lighting.
  test('names Lighting submenus by LED location and keeps indicators under Lighting', () => {
    const locations = new Set([
      'Per-Key RGB',
      'Underglow',
      'Backlight',
      'Badge',
      'RGB Row',
      'RGB LEDs',
      'Indicators',
    ]);
    for (const entry of manifest.definitions) {
      if (entry.id === 'brick65') {
        continue;
      }
      const definition = readJSON(entry.path);
      const menus = ((definition.menus ?? []) as {label?: string}[]).map(
        ({label}) => label,
      );
      expect({id: entry.id, menus: menus.filter((label) => label !== 'Lighting')}).toEqual({
        id: entry.id,
        menus: menus.filter((label) => label === 'FEATURE' || label === 'SYSTEM'),
      });
      for (const label of submenuLabels(definition, 'Lighting')) {
        expect({id: entry.id, label, known: locations.has(label)}).toEqual({
          id: entry.id,
          label,
          known: true,
        });
      }
    }
  });

  // Value 0 of a lock-indicator dropdown says what the LED does when it shows no lock:
  // an LED the lighting effect also drives goes back to the effect, a dedicated one is off.
  test('names each lock-indicator dropdown Indicator and its value 0 after the LED', () => {
    const indicatorControls = [
      'id_qmk_custom_ind_selec',
      'id_qmk_custom_ind_1_select',
      'id_qmk_custom_ind_2_select',
      'id_qmk_custom_riley_ind1_mode',
      'id_qmk_custom_riley_ind2_mode',
      'id_qmk_custom_riley_ind3_mode',
      'id_custom_indicator_toggle',
    ];
    const effectShared = new Set([
      'brick60-h7s',
      'fave65s',
      'intigrity80-h7s',
      'n86',
      'n87',
      'riley',
      'tomak-tkl-left',
      'tomak-tkl-right',
      'tomak79h-left',
      'tomak79h-right',
      'tomak79s-left',
      'tomak79s-right',
    ]);
    const seen = new Set<string>();
    for (const entry of manifest.definitions) {
      const dropdowns = collectCommandControls(readJSON(entry.path)).filter(
        ({name}) => indicatorControls.includes(name),
      );
      if (dropdowns.length === 0) {
        continue;
      }
      seen.add(entry.id);
      dropdowns.forEach((dropdown) => {
        const slot = dropdowns.length === 1 ? '' : ` ${dropdowns.indexOf(dropdown) + 1}`;
        expect({id: entry.id, label: dropdown.label, zero: (dropdown.options as unknown[][])[0]}).toEqual({
          id: entry.id,
          label: `Indicator${slot}`,
          zero: [effectShared.has(entry.id) ? 'RGB Effect' : 'Off', 0],
        });
      });
    }
    expect([...seen].sort()).toEqual(
      [
        ...effectShared,
        'brick65-h7s',
        'brick65s',
        'may65-h7s',
        'newone-odessey60h',
        'newone-odessey60s',
        'sculpturei-h7s',
      ].sort(),
    );
  });

  // TOMAK79H shipped for the whole life of this repo without MOUSE, NKRO or LINK in
  // its custom definition, while its own official VIA JSON and both sibling split
  // boards had all three. Nothing failed, because no test asked which definitions carry
  // which feature — a definition could quietly miss a menu the firmware supports and
  // only the custom app's users would lose it. This table is the answer, written down.
  // Adding a keyboard or a feature means editing it on purpose.
  const FEATURE_COVERAGE: Record<string, string[]> = {
    // Every ERA keyboard supports mouse keys. `brick65` is the ATmega32U4 exception
    // documented in PROJECT_DIRECTION: stock VIA only, no ERA feature menus at all.
    id_qmk_mousekey: [
      '7b75',
      'brick60-h7s',
      'brick65-h7s',
      'brick65s',
      'chickpad',
      'classicd-a1',
      'classicd-a1-ug',
      'classicd-core',
      'classicd-coreless',
      'divine',
      'era65',
      'et-tkl',
      'fave65s',
      'intigrity80-h7s',
      'klein-hs',
      'klein-sd',
      'may65-h7s',
      'n86',
      'n87',
      'n8x',
      'newone-a1',
      'newone-h1',
      'newone-odessey60h',
      'newone-odessey60s',
      'riley',
      'sculpturei-h7s',
      'tomak-tkl-left',
      'tomak-tkl-right',
      'tomak79h-left',
      'tomak79h-right',
      'tomak79s-left',
      'tomak79s-right',
    ],
    // Every RP2040 keyboard has the toggle. H7S is always 20-key with no switch, so a
    // toggle there would offer a choice the firmware does not have.
    id_qmk_custom_nkro: [
      '7b75',
      'brick65s',
      'chickpad',
      'classicd-a1',
      'classicd-a1-ug',
      'classicd-core',
      'classicd-coreless',
      'divine',
      'era65',
      'et-tkl',
      'fave65s',
      'klein-hs',
      'klein-sd',
      'n86',
      'n87',
      'n8x',
      'newone-a1',
      'newone-h1',
      'newone-odessey60h',
      'newone-odessey60s',
      'riley',
      'tomak-tkl-left',
      'tomak-tkl-right',
      'tomak79h-left',
      'tomak79h-right',
      'tomak79s-left',
      'tomak79s-right',
    ],
    // Both live firmware families expose one NUL-terminated read-only ASCII value.
    // brick65 is the stock-VIA ATmega exception and does not run either ERA layer.
    id_qmk_ver_ascii: [
      '7b75',
      'brick60-h7s',
      'brick65-h7s',
      'brick65s',
      'chickpad',
      'classicd-a1',
      'classicd-a1-ug',
      'classicd-core',
      'classicd-coreless',
      'divine',
      'era65',
      'et-tkl',
      'fave65s',
      'intigrity80-h7s',
      'klein-hs',
      'klein-sd',
      'may65-h7s',
      'n86',
      'n87',
      'n8x',
      'newone-a1',
      'newone-h1',
      'newone-odessey60h',
      'newone-odessey60s',
      'riley',
      'sculpturei-h7s',
      'tomak-tkl-left',
      'tomak-tkl-right',
      'tomak79h-left',
      'tomak79h-right',
      'tomak79s-left',
      'tomak79s-right',
    ],
    // Split-only: there is no cable to set a speed on, and nothing to sync, unless the
    // keyboard comes in two units.
    id_qmk_split_link: [
      'tomak-tkl-left',
      'tomak-tkl-right',
      'tomak79h-left',
      'tomak79h-right',
      'tomak79s-left',
      'tomak79s-right',
    ],
    id_qmk_eeprom_sync: [
      'tomak-tkl-left',
      'tomak-tkl-right',
      'tomak79h-left',
      'tomak79h-right',
      'tomak79s-left',
      'tomak79s-right',
    ],
    id_qmk_rgb_sleep_timeout_exact: [
      ...expectedRgbSleepTimeoutDefinitionIds,
    ],
    id_qmk_rgb_sleep_enable: [
      ...expectedRgbSleepToggleDefinitionIds,
    ],
    id_qmk_backlight_sleep: [...expectedBacklightSleepDefinitionIds],
  };

  test('each feature reaches exactly the definitions that are meant to have it', () => {
    for (const [command, expectedIds] of Object.entries(FEATURE_COVERAGE)) {
      const actual = manifest.definitions
        .filter(({path}) => {
          const names = collectCommandControls(readJSON(path)).map(
            ({name}) => name,
          );
          if (
            command === 'id_qmk_ver_ascii' ||
            command === 'id_qmk_rgb_sleep_timeout' ||
            command === 'id_qmk_rgb_sleep_timeout_exact'
          ) {
            return names.includes(command);
          }
          return names.some(
            (name) => name === command || name.startsWith(`${command}_`),
          );
        })
        .map(({id}) => id)
        .sort();
      expect({command, ids: actual}).toEqual({
        command,
        ids: [...expectedIds].sort(),
      });
    }
  });

  test('retires diagnostics and exposes revision-gated polling TEXT on five H7S definitions', () => {
    const optedIn = manifest.definitions.filter(
      ({exactMsFamily}) => exactMsFamily === 'h7s',
    );
    expect(optedIn.map(({id}) => id).sort()).toEqual(
      expectedUsbDiagnosticsDefinitionIds,
    );
    for (const entry of optedIn) {
      expect(entry.usbDiagnostics).not.toBe(true);
      expect(JSON.stringify(readJSON(entry.path))).toContain('id_qmk_usb_polling_current');
      expect(JSON.stringify(readJSON(entry.path))).not.toContain(
        'id_qmk_usb_autodg_beta',
      );
      expect(JSON.stringify(readJSON(entry.path))).not.toContain(
        'Auto downgrade on USB unstable',
      );
    }
  });
});
