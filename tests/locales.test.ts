import {describe, expect, test} from 'bun:test';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

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

  test('every literal translation in source has an English catalog entry', () => {
    const missing: string[] = [];
    let checked = 0;
    const scan = (directory: string) => {
      for (const entry of readdirSync(directory, {withFileTypes: true})) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          scan(file);
        } else if (/\.tsx?$/.test(entry.name)) {
          const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
          const check = (node: ts.Node | undefined) => {
            if (!node || !(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) return;
            checked++;
            const key = node.text;
            // i18next plural keys have suffixed entries instead of a bare key.
            if (!(key in locales.en) && !(`${key}_one` in locales.en && `${key}_other` in locales.en)) {
              missing.push(`${path.relative(localeDir, file)}: ${key}`);
            }
          };
          const visit = (node: ts.Node) => {
            if (ts.isCallExpression(node) &&
                ((ts.isIdentifier(node.expression) && node.expression.text === 't') ||
                 (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 't'))) {
              check(node.arguments[0]);
            }
            if (ts.isJsxAttribute(node) && node.name.getText(source) === 'i18nKey') {
              const value = node.initializer;
              check(value && ts.isJsxExpression(value) ? value.expression : value);
            }
            ts.forEachChild(node, visit);
          };
          visit(source);
        }
      }
    };
    scan(path.join(localeDir, '..'));
    expect(checked).toBeGreaterThan(300);
    expect(missing).toEqual([]);
  });

  test('every palette description has a translated catalog entry', async () => {
    const {getKeycodes} = await import('../src/utils/key');
    const {keycodeTitleText} = await import('../src/utils/keycode-palette');
    const keys = new Set<string>();
    for (const menu of getKeycodes()) {
      for (const key of menu.keycodes) {
        // Shift plus a printed glyph is a key name, like the host-layout glyphs.
        if (key.title && !/^Shift \+ .$/.test(key.title)) keycodeTitleText(key.title, ((key: string) => {
          keys.add(key);
          return key;
        }) as any);
      }
    }
    expect(keys.size).toBeGreaterThan(50);
    expect([...keys].filter((key) => !(key in locales.en))).toEqual([]);
  });

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

  test('palette and millisecond strings are translated, not left as English keys', () => {
    const required = [
      'Search',
      'Keycode categories',
      'Choose a keycode',
      'Modifier',
      'Mod-Tap',
      'Layer-Tap',
      'Apply',
      'Close',
      'Combined key',
      'Selected key',
      'Tap: the key · Hold: a layer',
      'Tap: the key · Hold: modifiers',
      'Sends the key with modifiers held',
      'Choose a tap key first',
      'On Tap',
      'On Hold',
      'On Double Tap',
      'Tap+Hold',
      'Tap once',
      'Press and hold',
      'Tap twice',
      'Tap, then hold',
      'No matches',
      'You can also type a QMK code such as LT(1,KC_SPC) or a hex value such as 0x412C.',
      'Search or enter a keycode',
      'Clear_key',
      'Blank',
      'Put in',
      'Placed',
      'Sets it to blank (KC_NO): pressing it sends nothing.',
      'Unable to verify feature support. Reconnect the keyboard. If the problem persists, update to the latest firmware.',
      'Unable to load feature settings. Reconnect the keyboard and try again.',
    ];
    for (const key of required) {
      expect(locales.en[key]).toBeTruthy();
      for (const lang of ['ko', 'zh', 'ja', 'es', 'de'] as const) {
        expect(locales[lang][key]).toBeTruthy();
        expect(locales[lang][key]).not.toBe(key);
      }
    }
  });

  // The ERA menu help is written in English in `era-feature-help.ts` and translated by
  // key, so a reworded sentence that never reaches the catalogs degrades that menu to
  // English in five languages without failing anything else.
  // The summaries are the only ERA text that is on the screen without being asked for,
  // and they are read one menu at a time, so a menu written in a different shape from
  // its neighbours is the thing a reader notices. Two rules keep them one family: a
  // summary names the setting rather than addressing the reader, and it stays short
  // enough to sit on one line next to the ⓘ button. The detail below is where "you"
  // and the longer explanation belong.
  test('menu summaries stay short and impersonal in every language', async () => {
    const {eraMenuSummaries} = await import('../src/utils/era-feature-help');
    const summaries = eraMenuSummaries();
    expect(summaries.length).toBeGreaterThan(10);
    for (const summary of summaries) {
      expect({summary, words: summary.split(/\s+/).length <= 12}).toEqual({
        summary,
        words: true,
      });
      expect({
        summary,
        secondPerson: /\b(you|your|yours)\b/i.test(summary),
      }).toEqual({
        summary,
        secondPerson: false,
      });
      // One sentence. Korean and Japanese end every sentence with a full stop too, so
      // counting terminators catches a summary that grew a second clause in translation.
      for (const [lang, catalog] of Object.entries(locales)) {
        const value = catalog[summary];
        const sentences = (value.match(/[.。]/g) ?? []).length;
        expect({lang, summary, sentences: sentences <= 1}).toEqual({
          lang,
          summary,
          sentences: true,
        });
      }
    }
  });

  // Summaries read one per menu, so they share one shape: a present-tense verb that
  // names what the setting does ("Sets…", "Resolves…"), never a bare noun phrase.
  test('menu summaries start with the verb that names what they do', async () => {
    const {eraMenuSummaries} = await import('../src/utils/era-feature-help');
    for (const summary of eraMenuSummaries()) {
      expect({summary, verb: /^[A-Z][a-z]+s\b/.test(summary)}).toEqual({
        summary,
        verb: true,
      });
    }
  });

  // Help names things the way the screen does. The keycode palette says 모드 탭,
  // モッドタップ, 修饰点按, Mod-Tipp and toque con modificador, so help that keeps the
  // English "Mod-Tap" or an older word for "tap" reads like a different feature.
  test('ERA help uses the UI terms for tap-hold keys in every translation', async () => {
    const {eraHelpStrings} = await import('../src/utils/era-feature-help');
    const foreign: Record<string, RegExp> = {
      ko: /Mod-Tap|Layer-Tap|Tap-Hold/,
      ja: /Mod-Tap|Layer-Tap|Tap-Hold/,
      zh: /Mod-Tap|Layer-Tap|Tap-Hold|轻点/,
      de: /Mod-Tap|Layer-Tap|Tap-Hold/,
      es: /Mod-Tap|Layer-Tap|tap-hold/i,
    };
    for (const value of eraHelpStrings()) {
      for (const [lang, pattern] of Object.entries(foreign)) {
        const text = locales[lang][value];
        expect({lang, value, foreign: pattern.test(text)}).toEqual({
          lang,
          value,
          foreign: false,
        });
      }
    }
  });

  // One word per thing in each language. A translation that reaches for a synonym
  // (표시등 for 인디케이터, 徽章 for 徽标) reads like a different feature, and nothing
  // else notices: every string still exists and still says something true. The words
  // kept are the ones the catalog already used most, and for the badge the one that
  // matches the on-screen "Badge" label.
  test('ERA help keeps one term per thing in each language', async () => {
    const {eraHelpStrings} = await import('../src/utils/era-feature-help');
    const synonyms: Record<string, RegExp> = {
      ko: /표시등/, // Lock 인디케이터
      ja: /ロック表示/, // Lock インジケーター
      zh: /徽章|锁定状态指示/, // 徽标, Lock 指示灯
      de: /Sperranzeige/, // Lock-Anzeige
      es: /insignia/i, // badge
    };
    for (const value of eraHelpStrings()) {
      for (const [lang, pattern] of Object.entries(synonyms)) {
        const text = locales[lang][value];
        expect({lang, value, synonym: pattern.test(text)}).toEqual({
          lang,
          value,
          synonym: false,
        });
      }
    }
  });

  // The same rule for the keycode palette's labels and tooltips. The Tap Dance tab is
  // the app's own word, translated like the tabs beside it, so it takes the name the
  // help and tooltips give the feature: TAPDANCE beside help that says 탭댄스 read as
  // two features.
  test('the Tap Dance tab names the feature as the rest of the text does', () => {
    const naming = Object.keys(locales.en).filter((key) =>
      key.includes('Tap Dance'),
    );
    expect(naming.length).toBeGreaterThan(4);
    for (const [lang, catalog] of Object.entries(locales)) {
      const tab = catalog['Tap Dance'];
      expect({lang, tab: typeof tab}).toEqual({lang, tab: 'string'});
      for (const key of naming) {
        expect({lang, key, named: catalog[key].includes(tab)}).toEqual({
          lang,
          key,
          named: true,
        });
      }
    }
  });

  // The combined key's empty key is named "On tap" (탭하면), so the tooltip of the
  // disabled Put in asks for the tap key (탭 키), not a "base keycode" or a "Basic key".
  test('the combined key calls its tap key by one name', () => {
    const tapKey: Record<string, RegExp> = {
      en: /\btap key\b/i,
      ko: /탭 키/,
      ja: /タップキー/,
      zh: /点按键/,
      es: /tecla de toque/i,
      de: /Tipp-Taste/,
    };
    for (const [lang, catalog] of Object.entries(locales)) {
      for (const key of ['Choose a tap key first']) {
        expect({lang, key, named: tapKey[lang].test(catalog[key] ?? '')}).toEqual(
          {lang, key, named: true},
        );
      }
    }
  });

  // One word for a keycode in each language, from the search box to the dock of a
  // keycode setting. Spanish and German had two, one of them the English "keycode" on
  // the search placeholder. German keeps Keycode: it is the word QMK uses, and the
  // placeholder has no room for Tastencode.
  test('a keycode has one name in each language', () => {
    const word: Record<string, RegExp> = {
      en: /keycode/i,
      ko: /키코드/,
      ja: /キーコード/,
      zh: /键码/,
      es: /código/i,
      de: /Keycode/,
    };
    const other: Record<string, RegExp> = {es: /keycode/i, de: /Tastencode/i};
    const naming = Object.keys(locales.en).filter((key) => /keycode/i.test(key));
    expect(naming.length).toBeGreaterThan(4);
    for (const [lang, catalog] of Object.entries(locales)) {
      for (const key of naming) {
        const text = catalog[key];
        expect({
          lang,
          key,
          one: word[lang].test(text) && !(other[lang]?.test(text) ?? false),
        }).toEqual({lang, key, one: true});
      }
    }
  });

  // The palette speaks to a Spanish reader as tú, the form its Spanish already used
  // most; a tooltip in usted beside a hint in tú reads like two apps.
  test('the palette addresses a Spanish reader one way', () => {
    const palette = [
      'Search keycodes',
      'Search or enter a keycode',
      'You can also type a QMK code such as LT(1,KC_SPC) or a hex value such as 0x412C.',
      'Choose a keycode',
      'Keycode',
      'Select a key on the keyboard first',
      'Choose a tap key first',
      'Choose at least one modifier',
      'Sets it to blank (KC_NO): pressing it sends nothing.',
    ];
    const usted =
      /\b(Elija|Introduzca|Seleccione|Pulse|Presione|Escriba|Haga|Utilice|Use|puede escribir|usted)\b/;
    for (const key of palette) {
      expect({key, usted: usted.test(locales.es[key])}).toEqual({
        key,
        usted: false,
      });
    }
  });

  // Palette tabs and headings are translated. Only QMK's own names stay in English
  // (Magic, Clicky, Grave Escape, the layer codes, Tap Dance where the help keeps it),
  // as they do on the keys; "Music" or "Locking" left in English beside 오디오 read
  // half-translated. Checked in Korean, Japanese and Chinese, where a leftover English
  // word stands out from the script around it.
  test('palette tabs and headings keep only QMK names in English', async () => {
    const {BASIC_LAYOUT, CATEGORY_GROUPS} = await import(
      '../src/utils/keycode-palette'
    );
    const {getKeycodes} = await import('../src/utils/key');
    const {menusWithTapDanceKeycodes} = await import(
      '../src/utils/keycode-menus'
    );
    const labels = new Set(
      [
        ...menusWithTapDanceKeycodes(getKeycodes(), [{name: 'TD0'}]),
        ...BASIC_LAYOUT,
        ...Object.values(CATEGORY_GROUPS).flat(),
        {label: 'Other'},
      ]
        .map(({label}) => label)
        .filter(Boolean),
    );
    expect(labels.size).toBeGreaterThan(40);
    const qmkNames =
      /\b(Esc|Fn|Shift|Lock|macOS|Magic|Clicky|Grave Escape|Space Cadet|RGB|Light|Matrix|UG|RM|MO|TG|TT|OSL|TO|DF|F13|F24|Tap Dance)\b/g;
    for (const lang of ['ko', 'ja', 'zh']) {
      for (const label of labels) {
        const rest = locales[lang][label].replace(qmkNames, '');
        expect({lang, label, english: /[A-Za-z]/.test(rest)}).toEqual({
          lang,
          label,
          english: false,
        });
      }
    }
  });

  // A saved layout file holds the keys, macros and Tap Dance, not the layout options
  // (ADR 0004 §2), so the options pane and the file are never named alike: loading a
  // file must not read as if it set the options. The file keeps the layout word; the
  // pane is named for the arrangement, English keeping VIA's "Layout Options"; and the
  // load message says only that the file loaded.
  test('the layout options pane and the saved layout file are named apart', () => {
    const fileWord: Record<string, string> = {
      en: 'layout',
      ko: '레이아웃',
      ja: 'レイアウト',
      zh: '布局',
      es: 'diseño',
      de: 'layout',
    };
    const fileText = Object.keys(locales.en).filter((key) =>
      /^(Save Current Layout|Load Saved Layout|Could not (import|save) layout|Failed to write the layout)/.test(
        key,
      ),
    );
    expect(fileText.length).toBeGreaterThan(6);
    for (const [lang, catalog] of Object.entries(locales)) {
      const word = fileWord[lang];
      const pane = catalog.Layouts.toLowerCase();
      const loaded = catalog['Successfully updated layout!'].toLowerCase();
      for (const key of fileText) {
        expect({lang, key, file: catalog[key].toLowerCase().includes(word)}).toEqual({
          lang,
          key,
          file: true,
        });
      }
      expect({
        lang,
        pane: lang === 'en' ? /^layouts?$/.test(pane) : pane.includes(word),
        loaded: loaded.includes(word) || loaded.includes(pane),
      }).toEqual({lang, pane: false, loaded: false});
    }
  });

  // SETTINGS names what happens, in the user's words: after a key is put in, the
  // selection moves on to the next key, and the keyboard is drawn in 2D or 3D. "Fast
  // key mapping" and "render mode" said neither.
  test('SETTINGS names moving on to the next key and the keyboard view plainly', () => {
    const nextKey: Record<string, RegExp> = {
      en: /next key/i,
      ko: /다음 키/,
      ja: /次のキー/,
      zh: /下一个键/,
      es: /siguiente tecla/i,
      de: /nächsten Taste/,
    };
    const keyboard: Record<string, RegExp> = {
      en: /keyboard/i,
      ko: /키보드/,
      ja: /キーボード/,
      zh: /键盘/,
      es: /teclado/i,
      de: /Tastatur/,
    };
    const jargon = /render|mapping|매핑|렌더|レンダー|渲染|mapeo/i;
    for (const [lang, catalog] of Object.entries(locales)) {
      const move = catalog['Fast Key Mapping'];
      const view = catalog['Render Mode'];
      expect({
        lang,
        move: nextKey[lang].test(move),
        view: keyboard[lang].test(view),
        jargon: jargon.test(`${move} ${view}`),
      }).toEqual({lang, move: true, view: true, jargon: false});
    }
  });

  test('every ERA feature-help string is a catalog key', async () => {
    const {eraHelpStrings} = await import('../src/utils/era-feature-help');
    const strings = eraHelpStrings();
    expect(strings.length).toBeGreaterThan(0);
    for (const value of strings) {
      for (const [lang, catalog] of Object.entries(locales)) {
        expect({lang, value, translated: typeof catalog[value]}).toEqual({
          lang,
          value,
          translated: 'string',
        });
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

  // An ERA definition's submenu, row and option names are on the screen as it spells
  // them, in every language (ADR 0003 §7). Text that points at one, like the firmware
  // page's SYSTEM → BOOT → Jump To BOOT, keeps that English in every translation, or it
  // sends the reader looking for a word the screen lacks. A row the menu does not draw
  // is not on the screen: the LINK help's "Apply" is the menu's own translated button.
  test('text naming an ERA definition name keeps it in English in every language', async () => {
    const {eraHelpStrings} = await import('../src/utils/era-feature-help');
    const {isHeldValueSideCommand} = await import('../src/utils/custom-menu');
    const root = path.join(import.meta.dir, '..');
    const manifest = JSON.parse(
      readFileSync(path.join(root, 'config/era-definitions.manifest.json'), 'utf8'),
    ) as {definitions: {path: string}[]};
    const names = new Set<string>();
    const collect = (node: unknown, topLevel: boolean) => {
      if (Array.isArray(node)) {
        node.forEach((child) => collect(child, topLevel));
        return;
      }
      if (!node || typeof node !== 'object') {
        return;
      }
      const {label, options, content} = node as Record<string, unknown>;
      if (Array.isArray(content) && isHeldValueSideCommand(content[0])) {
        return;
      }
      // A top-level menu name the catalog knows is translated in the rail.
      if (typeof label === 'string' && !(topLevel && label in locales.en)) {
        names.add(label);
      }
      for (const option of Array.isArray(options) ? options : []) {
        const name = Array.isArray(option) ? option[0] : option;
        if (typeof name === 'string') {
          names.add(name);
        }
      }
      collect(content, false);
    };
    for (const definition of manifest.definitions) {
      collect(JSON.parse(readFileSync(path.join(root, definition.path), 'utf8')).menus, true);
    }
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const named = [...names]
      .filter((name) => /^[A-Z]/.test(name))
      .map((name) => ({
        name,
        pattern: new RegExp(`(^|[^A-Za-z0-9])${escape(name)}(?![A-Za-z0-9])`),
      }));
    const found = new Set<string>();
    for (const text of [
      ...eraHelpStrings(),
      ...Object.keys(locales.en).filter((key) => key.includes(' → ')),
    ]) {
      for (const {name, pattern} of named.filter(({pattern}) => pattern.test(text))) {
        found.add(name);
        for (const [lang, catalog] of Object.entries(locales)) {
          expect({lang, text, name, kept: catalog[text].includes(name)}).toEqual({
            lang,
            text,
            name,
            kept: true,
          });
        }
      }
    }
    // A scan that finds nothing has lost its inputs rather than passed.
    expect(found.size).toBeGreaterThan(10);
  });

  // The LINK page applies a speed with the page's own Apply button, which each language
  // translates, so the help that tells the reader to press it uses the same word.
  test('the LINK help names Apply the way the Apply button does', () => {
    const help =
      'Apply changes the speed without restarting the keyboard or reconnecting USB.';
    for (const [lang, catalog] of Object.entries(locales)) {
      expect({lang, named: catalog[help].includes(catalog.Apply)}).toEqual({
        lang,
        named: true,
      });
    }
  });

  // "DUAL-HOST" names a firmware relation no screen shows, and "RGBLight" and "bps"
  // are a firmware module and a line rate; the help says what the reader notices.
  test('ERA help uses no firmware names in any language', async () => {
    const {eraHelpStrings} = await import('../src/utils/era-feature-help');
    for (const value of eraHelpStrings()) {
      for (const [lang, catalog] of Object.entries(locales)) {
        expect({lang, value, jargon: /DUAL-HOST|RGBLight|\bbps\b/.test(catalog[value])})
          .toEqual({lang, value, jargon: false});
      }
    }
    for (const [lang, catalog] of Object.entries(locales)) {
      expect({lang, dualHost: Object.values(catalog).some((text) => text.includes('DUAL-HOST'))})
        .toEqual({lang, dualHost: false});
    }
  });
});
