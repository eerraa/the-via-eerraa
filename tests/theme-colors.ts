import {readFileSync} from 'node:fs';
import path from 'node:path';

export type ThemeMode = 'dark' | 'light';
export type Rgb = [number, number, number];

// <html> always carries data-theme-mode, so it matches :root and one theme block, and
// the block wins. A custom property whose var() chain leads back to itself is a cycle,
// which CSS leaves without a value even when the var() has a fallback; every rule that
// reads it then silently drops the colour. They are resolved here the way a browser does.
const stylesheet = readFileSync(
  path.join(import.meta.dir, '..', 'src/app.global.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

const declaredBy = (selector: string) =>
  [...stylesheet.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.trim() === selector)
    .flatMap(([, , body]) => [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]*);/g)])
    .map(([, name, value]): [string, string] => [name, value.trim()]);

// `inline` is what the app sets in <html>'s own style attribute, over the stylesheet.
export const htmlCustomProperties = (
  mode: ThemeMode,
  inline: Record<string, string> = {},
) => {
  const declared = new Map([
    ...declaredBy(':root'),
    ...declaredBy(`html[data-theme-mode='${mode}']`),
    ...Object.entries(inline),
  ]);
  const references = (name: string) =>
    [...(declared.get(name) ?? '').matchAll(/var\(\s*(--[\w-]+)/g)].map(
      ([, reference]) => reference,
    );
  const inCycle = (name: string) => {
    const seen = new Set<string>();
    const pending = references(name);
    while (pending.length > 0) {
      const next = pending.pop()!;
      if (next === name) {
        return true;
      }
      if (!seen.has(next)) {
        seen.add(next);
        pending.push(...references(next));
      }
    }
    return false;
  };
  const compute = (name: string): string | undefined => {
    const value = declared.get(name);
    if (value === undefined || inCycle(name)) {
      return undefined;
    }
    let complete = true;
    const substituted = value.replace(
      /var\(\s*(--[\w-]+)\s*(?:,([^()]*))?\)/g,
      (_, reference: string, fallback?: string) => {
        const resolved = compute(reference) ?? fallback?.trim();
        complete &&= resolved !== undefined;
        return resolved ?? '';
      },
    );
    return complete ? substituted : undefined;
  };
  return new Map([...declared.keys()].map((name) => [name, compute(name)]));
};

export type ThemedPage = {
  page: string;
  properties: Map<string, string | undefined>;
};

// Every page a colour can be drawn on: each mode under each keycap theme, whose accent
// the app writes onto <html> itself (updateCSSVariables in src/utils/color-math.ts).
export const themedPages = (
  themes: Record<string, {accent: {c: string; t: string}}>,
): ThemedPage[] =>
  (['dark', 'light'] as const).flatMap((mode) =>
    Object.entries(themes).map(([theme, {accent}]) => ({
      page: `${theme} ${mode}`,
      properties: htmlCustomProperties(mode, {
        '--color_accent': accent.c,
        '--color_inside-accent': accent.t,
      }),
    })),
  );

// A CSS colour as a page paints it: var() looked up, color-mix() in sRGB mixed.
export const paint = (
  value: string,
  properties: ThemedPage['properties'],
): Rgb => {
  const resolved = value
    .trim()
    .replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, name: string) => {
      const property = properties.get(name);
      if (property === undefined) {
        throw new Error(`${name} has no value`);
      }
      return property;
    });
  const mix = /^color-mix\(\s*in srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+?)\s*\)$/.exec(
    resolved,
  );
  if (mix) {
    const share = Number(mix[2]) / 100;
    const [first, second] = [paint(mix[1], properties), paint(mix[3], properties)];
    return first.map(
      (channel, index) => channel * share + second[index] * (1 - share),
    ) as Rgb;
  }
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(resolved);
  if (!hex) {
    throw new Error(`not a colour this reads: ${resolved}`);
  }
  const pairs =
    hex[1].length === 3
      ? [...hex[1]].map((digit) => digit + digit)
      : hex[1].match(/../g)!;
  return pairs.map((pair) => parseInt(pair, 16)) as Rgb;
};

/** The WCAG contrast ratio of two colours, 1 to 21. */
export const contrast = (a: Rgb, b: Rgb) => {
  const luminance = (colour: Rgb) => {
    const [r, g, bl] = colour.map((channel) => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};
