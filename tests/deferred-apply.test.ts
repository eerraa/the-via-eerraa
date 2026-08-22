import {describe, expect, test} from 'bun:test';
import {isDeferredApplyCommand} from '../src/components/panes/configure-panes/custom/deferred-apply';
import {canApplyMillisecondDraft} from '../src/utils/millisecond-field';

describe('deferred TAPPING/TAPDANCE apply', () => {
  test('recognizes tapping and tapdance commands and ignores other menus', () => {
    expect(isDeferredApplyCommand('id_qmk_tapping_hold_on_other_key_press')).toBe(
      true,
    );
    expect(isDeferredApplyCommand('id_qmk_tapping_global_term_exact')).toBe(true);
    expect(isDeferredApplyCommand('id_qmk_tapdance_1_tap')).toBe(true);
    expect(isDeferredApplyCommand('id_qmk_tapdance_1_term_exact')).toBe(true);
    expect(isDeferredApplyCommand('id_qmk_rgb_matrix_brightness')).toBe(false);
    expect(isDeferredApplyCommand(undefined)).toBe(false);
  });

  test('Apply stays off for an unchanged ms value and on for a different valid value', () => {
    const adapter = {minMs: 1, maxMs: 65535};
    expect(canApplyMillisecondDraft('200', 200, adapter, false)).toBe(false);
    expect(canApplyMillisecondDraft('137', 200, adapter, false)).toBe(true);
  });
});
