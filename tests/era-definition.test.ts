import {describe, expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {
  attachTapDanceKeycodes,
  customKeycodeWireIndex,
  hasCustomKeycodeTab,
  isTapDanceKeycodeName,
  splitTapDanceKeycodesFromRaw,
} from '../src/utils/era-definition';
import {mergeDefinitionLookup} from '../src/utils/definition-priority';
import {findEraFeatureHelp} from '../src/utils/era-feature-help';

type DefinitionEntry = {
  id: string;
  path: string;
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
    (_, index) =>
      `id_qmk_tapdance_${index + 1}_term_exact:0:${72 + index}`,
  ),
].sort();

const expectedQmkDefinitionIds = [
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
    expect(selected(source('official'), source('upload'), {})).toBe(
      'official',
    );
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
  const qmkEntries = manifest.definitions.filter(
    (entry) => expectedQmkDefinitionIds.includes(entry.id),
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
      expect(
        customTerms.filter(({name}) => !name.endsWith('_exact')),
      ).toEqual([]);
      expect(
        customTerms
          .filter(({name}) => name.endsWith('_exact'))
          .map(({options}) => options),
      ).toEqual(Array.from({length: 9}, () => [1, 65535]));
    });
  }

  test('gives exactly the 25 RP2040 definitions one live VERSION label and excludes brick65', () => {
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
    expect(actual).toHaveLength(25);
    expect(actual.sort()).toEqual(expectedRp2040DefinitionIds);
  });

  test('keeps the VERSION definition identical across each RP2040 split pair', () => {
    const pairs = new Map<string, unknown[]>();
    for (const entry of manifest.definitions.filter(({pair}) => pair)) {
      const definition = readJSON(entry.path);
      const system = ((definition.menus ?? []) as {
        label?: string;
        content?: unknown[];
      }[]).find(({label}) => label === 'SYSTEM');
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

  test('preserves the H7S 100-500 custom exact-ms exception', () => {
    const entry = manifest.definitions.find(
      ({exactMsFamily}) => exactMsFamily === 'h7s',
    );
    expect(entry).toBeDefined();
    const customExact = collectTermControls(readJSON(entry!.path)).filter(
      ({name}) => name.endsWith('_exact'),
    );
    expect(customExact.map(({options}) => options)).toEqual(
      Array.from({length: 9}, () => [100, 500]),
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
      ({usbDiagnostics}) => usbDiagnostics === true,
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
          ({name}) => name === 'id_qmk_rgb_sleep_timeout',
        ),
      ).toEqual([
        expect.objectContaining({channel: 18, id: 1, label: 'RGB Sleep Timeout'}),
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

  test('gives only the six TOMAK halves the exact-second RGB sleep control', () => {
    const expected = [
      'tomak-tkl-left',
      'tomak-tkl-right',
      'tomak79h-left',
      'tomak79h-right',
      'tomak79s-left',
      'tomak79s-right',
    ].sort();
    const actual: string[] = [];
    for (const entry of manifest.definitions) {
      const controls = collectCommandControls(readJSON(entry.path)).filter(
        ({name}) => name === 'id_qmk_rgb_sleep_timeout_exact',
      );
      if (controls.length === 0) {
        continue;
      }
      actual.push(entry.id);
      expect(controls).toHaveLength(1);
      expect(controls[0]).toMatchObject({
        channel: 9,
        id: 11,
        options: [1, 65535],
      });
    }
    expect(actual.sort()).toEqual(expected);
  });

  test('hides fixed SOCD and KKUK mode rows and keeps shared control order', () => {
    for (const entry of manifest.definitions) {
      const definition = readJSON(entry.path);
      const serialized = JSON.stringify(definition);
      if (!serialized.includes('id_qmk_kkuk_enable')) {
        continue;
      }
      expect(serialized).not.toContain('id_qmk_kkuk_mode');
      expect(serialized).not.toContain('id_qmk_socd_lr_mode');
      expect(serialized).not.toContain('id_qmk_socd_ud_mode');
      expect(submenuControlLabels(definition, 'FEATURE', 'SOCD')).toEqual([
        'Left/Right Enable',
        'Left Key',
        'Right Key',
        'Up/Down Enable',
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

  // The SOCD menu shipped without help for twenty-five definitions because the RP2040
  // firmware calls it `id_qmk_socd_*` while H7S calls it `id_qmk_kill_switch_*`, and
  // only the second prefix was registered. Nothing failed, because no test asked "does
  // every ERA submenu actually resolve to help?". This one asks, and any submenu that
  // legitimately has none has to be named here rather than passing silently.
  const SUBMENUS_WITHOUT_HELP: string[] = [];

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
      'tomak-tkl-left',
      'tomak-tkl-right',
      'tomak79h-left',
      'tomak79h-right',
      'tomak79s-left',
      'tomak79s-right',
    ],
    id_qmk_rgb_sleep_timeout: [
      'brick60-h7s',
      'brick65-h7s',
      'intigrity80-h7s',
      'may65-h7s',
      'sculpturei-h7s',
    ],
  };

  test('each feature reaches exactly the definitions that are meant to have it', () => {
    for (const [command, expectedIds] of Object.entries(FEATURE_COVERAGE)) {
      const actual = manifest.definitions
        .filter(({path}) => {
          const names = collectCommandControls(readJSON(path)).map(({name}) => name);
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

  test('opts only the five H7S definitions into USB diagnostics', () => {
    const optedIn = manifest.definitions.filter(
      ({usbDiagnostics}) => usbDiagnostics === true,
    );
    expect(optedIn.map(({id}) => id).sort()).toEqual(
      expectedUsbDiagnosticsDefinitionIds,
    );
    for (const entry of optedIn) {
      expect(entry.exactMsFamily).toBe('h7s');
      expect(JSON.stringify(readJSON(entry.path))).not.toContain(
        'id_qmk_usb_autodg_beta',
      );
      expect(JSON.stringify(readJSON(entry.path))).not.toContain(
        'Auto downgrade on USB unstable',
      );
    }
  });
});
