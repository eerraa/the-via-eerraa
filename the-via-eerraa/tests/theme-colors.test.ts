import {describe, expect, test} from 'bun:test';
import {THEMES} from '../src/utils/themes';
import {htmlCustomProperties, type ThemeMode} from './theme-colors';

// The theme's accent pair is set inline on <html> (color-math.ts).
const {accent} = THEMES.OLIVIA_DARK;
const pageProperties = (mode: ThemeMode) =>
  htmlCustomProperties(mode, {
    '--color_accent': accent.c,
    '--color_inside-accent': accent.t,
  });

describe('theme colours', () => {
  test.each(['dark', 'light'] as const)(
    'every custom property on <html> has a value in %s mode',
    (mode) => {
      const unset = [...pageProperties(mode)]
        .filter(([, value]) => value === undefined)
        .map(([name]) => name);
      expect(unset).toEqual([]);
    },
  );

  // The accent is tuned for fills. VIA's accent buttons and links keep it pure in
  // dark mode, where it reads, and take it mixed toward the label colour on the
  // light surface, where it would read fainter than a disabled button. The
  // palette's text takes the mix in both modes.
  test('accent text is the pure accent in dark mode and mixed in light mode', () => {
    const tidy = (value?: string) =>
      value?.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')');
    const dark = pageProperties('dark');
    const light = pageProperties('light');
    expect(dark.get('--color_accent-text')).toBe(accent.c);
    expect(tidy(light.get('--color_accent-text'))).toBe(
      `color-mix(in srgb, ${accent.c} 55%, #222)`,
    );
    expect(tidy(dark.get('--color_accent-mix'))).toBe(
      `color-mix(in srgb, ${accent.c} 55%, #d9d9d9)`,
    );
    expect(light.get('--color_accent-mix')).toBe(
      light.get('--color_accent-text'),
    );
  });

  test.each(['dark', 'light'] as const)(
    'the error colour keeps the :root red in %s mode',
    (mode) => {
      expect(pageProperties(mode).get('--color_error')).toBe('#d15e5e');
    },
  );
});
