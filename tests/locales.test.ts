import {describe, expect, test} from 'bun:test';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';

const localeDir = path.join(import.meta.dir, '../src/locales');

const loadLocales = () => {
  const files = readdirSync(localeDir).filter((name) => name.endsWith('.json'));
  return Object.fromEntries(
    files.map((name) => [
      name.replace(/\.json$/, ''),
      JSON.parse(readFileSync(path.join(localeDir, name), 'utf8')) as Record<
        string,
        string
      >,
    ]),
  );
};

describe('VIA locale coverage', () => {
  const locales = loadLocales();
  const englishKeys = Object.keys(locales.en).sort();

  test('supported language files match language-select codes', () => {
    expect(Object.keys(locales).sort()).toEqual([
      'de',
      'en',
      'es',
      'ja',
      'ko',
      'zh',
    ]);
  });

  test('every locale provides the same keys as English', () => {
    for (const [lang, catalog] of Object.entries(locales)) {
      expect({lang, keys: Object.keys(catalog).sort()}).toEqual({
        lang,
        keys: englishKeys,
      });
    }
  });

  test('picker and millisecond strings are translated, not left as English keys', () => {
    const required = [
      'Search',
      'Modifier',
      'Mod-Tap',
      'Layer-Tap',
      'Apply',
      'Close',
      'Exact milliseconds',
      'Compose',
      'Base keycode',
      'Pick from grid',
      'Choose a behavior, then set its key and hold action.',
      'Tap sends the chosen key. Hold activates the layer.',
      'Tap sends the chosen key. Hold applies the selected modifiers.',
      'Send the chosen key with the selected modifiers.',
      'Choose a tap key from the grid. It will not be assigned yet.',
      'Back to Layers',
      'Key',
      'Preview',
    ];
    for (const key of required) {
      expect(locales.en[key]).toBeTruthy();
      for (const lang of ['ko', 'zh', 'ja', 'es', 'de'] as const) {
        expect(locales[lang][key]).toBeTruthy();
        expect(locales[lang][key]).not.toBe(key);
      }
    }
  });

  test('definition menu labels stay in documented English', () => {
    for (const catalog of Object.values(locales)) {
      for (const label of ['FEATURE', 'TAPDANCE', 'SYSTEM']) {
        expect(catalog[label]).toBeUndefined();
      }
    }
  });
});
