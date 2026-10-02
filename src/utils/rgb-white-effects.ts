import {isCustomMenuCommandContent} from './custom-menu';

// QMK quantum/rgblight/rgblight.c and quantum/rgb_matrix/animations:
// These effects vary hue or scale the configured saturation: their main color
// pattern fades near white. Christmas still dims but loses its red/green pattern.
// Both ERA QMK and H7S use the configured saturation for these effect families.
// Exclude brightness/position patterns (Breathing, Snake, Val., Splash, etc.)
// and independently generated saturation (Jellybean Raindrops, Pixel Rain/Flow).
// Match option names, not mode numbers: RGB Matrix numbering depends on the build.
const matrixEffects = new Set([
  'Alphas Mods',
  'Gradient Up/Down',
  'Gradient Left/Right',
  'Band Sat.',
  'Pinwheel Sat.',
  'Spiral Sat.',
  'Cycle All',
  'Cycle Left/Right',
  'Cycle Up/Down',
  'Rainbow Moving Chevron',
  'Cycle Out/In',
  'Cycle Out/In Dual',
  'Cycle Pinwheel',
  'Cycle Spiral',
  'Dual Beacon',
  'Rainbow Beacon',
  'Rainbow Pinwheels',
  'Flower Blooming',
  'Raindrops',
  'Hue Breathing',
  'Hue Pendulum',
  'Hue Wave',
  'Solid Reactive',
]);

// An advisory threshold, not a firmware limit. Saturation is an unsigned byte;
// floor keeps the inclusive bound at or below 5% (12/255).
export const RGB_LOW_SATURATION_MAX = Math.floor(255 * 0.05);

const byte = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 255;

/** The color control for an affected effect, using the current menu state. */
export const rgbEffectColor = (
  item: {type?: string; content?: unknown; options?: unknown},
  menuData: Record<string, unknown>,
): string | null => {
  if (item.type !== 'dropdown' || !isCustomMenuCommandContent(item.content)) {
    return null;
  }
  const [command, channel, valueId] = item.content;
  const family =
    command === 'id_qmk_rgblight_effect' && channel === 2 && valueId === 2
      ? 'rgblight'
      : command === 'id_qmk_rgb_matrix_effect' && channel === 3 && valueId === 2
        ? 'rgb_matrix'
        : null;
  if (!family || !Array.isArray(item.options)) return null;
  const colorCommand = `id_qmk_${family}_color`;
  const color = menuData[colorCommand];
  const effect = menuData[command];
  if (
    !Array.isArray(color) ||
    !byte(color[0]) ||
    !byte(color[1]) ||
    !Array.isArray(effect) ||
    !byte(effect[0]) ||
    effect[0] === 0
  ) {
    return null;
  }
  const selected = item.options.find((option, index) =>
    typeof option === 'string'
      ? index === effect[0]
      : Array.isArray(option) && option[1] === effect[0],
  );
  const label = typeof selected === 'string' ? selected : selected?.[0];
  if (typeof label !== 'string') return null;
  const affected =
    family === 'rgb_matrix'
      ? matrixEffects.has(label)
      : /^(Rainbow Mood [1-3]|Rainbow Swirl [1-6]|Gradient ([1-9]|10)|Christmas)$/.test(
          label,
        );
  return affected ? colorCommand : null;
};

export const lowSaturationRgbEffectColor = (
  item: Parameters<typeof rgbEffectColor>[0],
  menuData: Record<string, unknown>,
): string | null => {
  const command = rgbEffectColor(item, menuData);
  const color = command && menuData[command];
  return Array.isArray(color) && color[1] <= RGB_LOW_SATURATION_MAX
    ? command
    : null;
};
