import {
  DEFAULT_TAPPING_TERM_BOUNDS,
  QMK_EXACT_TAPPING_TERM_BOUNDS,
} from './millisecond-field';
import type {ExactMsFamily} from './era-advanced-metadata';

export const isExactTermCommand = (name: string) =>
  name === 'id_qmk_tapping_global_term_exact' ||
  /^id_qmk_tapdance_[1-8]_term_exact$/.test(name);

export const isLegacyTermCommand = (name: string) =>
  name === 'id_qmk_tapping_global_term' ||
  /^id_qmk_tapdance_[1-8]_term$/.test(name);

/** Fallback when a definition omits exact range options. */
export const exactTermBoundsForFamily = (family: ExactMsFamily | null) =>
  family === 'qmk'
    ? QMK_EXACT_TAPPING_TERM_BOUNDS
    : DEFAULT_TAPPING_TERM_BOUNDS;

/** Loaded JSON `options` win. Stock [100, 500] vs custom QMK [1, 65535]. */
export const exactTermBoundsFromOptions = (
  options: unknown,
  family: ExactMsFamily | null,
) => {
  const fallback = exactTermBoundsForFamily(family);
  const minMs =
    Array.isArray(options) && typeof options[0] === 'number'
      ? options[0]
      : fallback.minMs;
  const maxMs =
    Array.isArray(options) && typeof options[1] === 'number'
      ? options[1]
      : fallback.maxMs;
  return {
    minMs: Math.max(1, minMs),
    maxMs: Math.min(65535, maxMs),
  };
};
