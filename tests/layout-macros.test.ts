import {describe, expect, test} from 'bun:test';
import {normalizeLayoutMacros} from '../src/utils/layout-macros';

describe('layout macro slots', () => {
  test('pads a partially parsed device image to the firmware slot count', () => {
    expect(normalizeLayoutMacros(['first', 'second'], 4)).toEqual([
      'first',
      'second',
      '',
      '',
    ]);
  });

  test('does not retain expressions beyond the firmware slot count', () => {
    expect(normalizeLayoutMacros(['first', 'second', 'stale'], 2)).toEqual([
      'first',
      'second',
    ]);
  });
});
