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

  test('interpolation placeholders survive every translation', () => {
    // A translator dropping {{threshold}} turns a factual sentence into a vague one,
    // and i18next renders the loss silently.
    const placeholders = (value: string) =>
      (value.match(/\{\{\w+\}\}/g) ?? []).sort();
    for (const [key, english] of Object.entries(locales.en)) {
      const expected = placeholders(english);
      if (expected.length === 0) {
        continue;
      }
      for (const [lang, catalog] of Object.entries(locales)) {
        expect({lang, key, placeholders: placeholders(catalog[key])}).toEqual({
          lang,
          key,
          placeholders: expected,
        });
      }
    }
  });

  // The diagnostics UI may only state what was observed in the measured window.
  // "No report queue drops were observed" is allowed; "stable", "no problems" and
  // any score are not, because they cover failure categories the test never
  // measured. Hardware validation produced wrong conclusions twice from exactly
  // this kind of over-claiming, so the rule has to survive translation too.
  const DIAGNOSTIC_OBSERVATION_KEYS = [
    'What this {{seconds}}-second test observed',
    'Lost key presses',
    'Not observed',
    '{{times}} observed',
    'USB link changes',
    'Dropped {{resets}} · Reconnected {{configurations}} · Slept {{suspends}} · Speed changed {{speedChanges}}',
    'Firmware pauses (over {{threshold}})',
    'Most waiting to send',
    'Connection speed',
    '{{actual}} — matches {{mode}}',
    '{{actual}} — {{mode}} needs {{required}}',
    'These five lines are everything this test looks at. Anything else that could go wrong is simply outside what it measures.',
    'No keys were pressed during this test. Type while the next one runs.',
    'These were read when the test finished. They do not tick up while you watch.',
  ];

  const VERDICT_WORDING: Record<string, RegExp> = {
    en: /\b(stable|unstable|healthy|perfect|certified|flawless|no problems?)\b/i,
    ko: /(?<!더 )이상\s*없|안정적|불안정|정상입니다|문제\s*없|완벽|양호|점수/,
    ja: /安定|正常です|問題(は)?あり(ま)?せん|問題なし|完璧|良好|スコア/,
    zh: /稳定|不稳定|一切正常|没有问题|无问题|完美|良好|评分/,
    de: /\b(stabil|instabil|einwandfrei|perfekt|fehlerfrei|makellos)\b/i,
    es: /\b(estable|inestable|perfecto|impecable|sin problemas)\b/i,
  };

  test('diagnostics observations never become verdicts in any language', () => {
    for (const key of DIAGNOSTIC_OBSERVATION_KEYS) {
      for (const [lang, catalog] of Object.entries(locales)) {
        const value = catalog[key];
        expect({lang, key, present: typeof value === 'string'}).toEqual({
          lang,
          key,
          present: true,
        });
        expect({lang, key, verdict: VERDICT_WORDING[lang].test(value)}).toEqual(
          {
            lang,
            key,
            verdict: false,
          },
        );
      }
    }
  });

  test('picker and millisecond strings are translated, not left as English keys', () => {
    const required = [
      'Search',
      'Keycode categories',
      'Choose a keycode',
      'Modifier',
      'Mod-Tap',
      'Layer-Tap',
      'Apply',
      'Close',
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
      'Unable to verify feature support. Reconnect the keyboard. If the problem persists, update to the latest firmware.',
      'Unable to load feature settings. Reconnect the keyboard and try again.',
      'Enter an integer',
      'Out of range',
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
