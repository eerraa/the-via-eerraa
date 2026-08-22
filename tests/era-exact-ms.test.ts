import {describe, expect, test} from 'bun:test';
import {
  exactTermBoundsForFamily,
  exactTermBoundsFromOptions,
} from '../src/utils/era-exact-ms';
import {QMK_EXACT_TAPPING_TERM_BOUNDS} from '../src/utils/millisecond-field';

describe('ERA exact millisecond controls', () => {
  test('loaded JSON options drive exact-ms bounds per client definition', () => {
    expect(exactTermBoundsForFamily('qmk')).toEqual(
      QMK_EXACT_TAPPING_TERM_BOUNDS,
    );
    expect(exactTermBoundsFromOptions([100, 500], 'qmk')).toEqual({
      minMs: 100,
      maxMs: 500,
    });
    expect(exactTermBoundsFromOptions([1, 65535], 'qmk')).toEqual(
      QMK_EXACT_TAPPING_TERM_BOUNDS,
    );
    expect(exactTermBoundsFromOptions([100, 500], 'h7s')).toEqual({
      minMs: 100,
      maxMs: 500,
    });
    expect(exactTermBoundsFromOptions(undefined, 'qmk')).toEqual(
      QMK_EXACT_TAPPING_TERM_BOUNDS,
    );
  });
});
