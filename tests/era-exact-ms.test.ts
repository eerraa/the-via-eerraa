import {describe, expect, test} from 'bun:test';
import {
  exactTermBoundsForFamily,
  exactTermBoundsFromOptions,
} from '../src/utils/era-exact-ms';
import {
  DEFAULT_TAPPING_TERM_BOUNDS,
  EXACT_TAPPING_TERM_BOUNDS,
  parseMillisecondDraft,
} from '../src/utils/millisecond-field';

describe('ERA exact millisecond controls', () => {
  for (const family of ['qmk', 'h7s'] as const) {
    test(`${family} exact fields accept nonzero uint16 milliseconds`, () => {
      const fallback = exactTermBoundsForFamily(family);
      expect(fallback).toEqual(EXACT_TAPPING_TERM_BOUNDS);
      expect(exactTermBoundsFromOptions(undefined, family)).toEqual(fallback);
      const bounds = exactTermBoundsFromOptions([1, 65535], family);
      expect(bounds).toEqual(EXACT_TAPPING_TERM_BOUNDS);
      for (const value of [1, 99, 137, 500, 501, 1000, 32767, 32768, 65534, 65535]) {
        expect(parseMillisecondDraft(String(value), bounds.minMs, bounds.maxMs))
          .toEqual({ok: true, valueMs: value});
      }
      for (const draft of ['0', '-1', '65536', '99999', '', '1.5', 'NaN']) {
        expect(parseMillisecondDraft(draft, bounds.minMs, bounds.maxMs).ok).toBe(false);
      }
    });

    test(`${family} still honors loaded stock-shaped options`, () => {
      const stock = exactTermBoundsFromOptions([100, 500], family);
      expect(stock).toEqual(DEFAULT_TAPPING_TERM_BOUNDS);
      expect(parseMillisecondDraft('500', stock.minMs, stock.maxMs).ok).toBe(true);
      expect(parseMillisecondDraft('501', stock.minMs, stock.maxMs).ok).toBe(false);
    });
  }

  test('unknown families retain the conservative fallback', () => {
    expect(exactTermBoundsForFamily(null)).toEqual(DEFAULT_TAPPING_TERM_BOUNDS);
  });
});
