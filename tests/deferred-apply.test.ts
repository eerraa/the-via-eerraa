import {describe, expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {
  isDeferredApplyCommand,
  shouldDeferApplyCommand,
} from '../src/components/panes/configure-panes/custom/deferred-apply';
import {canApplyIntegerDraft} from '../src/utils/integer-field';
import {canApplyMillisecondDraft} from '../src/utils/millisecond-field';

const source = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8').replaceAll(
    '\r\n',
    '\n',
  );

describe('deferred TAPPING/TAPDANCE/SLEEP apply', () => {
  test('recognizes the three deferred command families and ignores other menus', () => {
    expect(isDeferredApplyCommand('id_qmk_tapping_hold_on_other_key_press')).toBe(
      true,
    );
    expect(isDeferredApplyCommand('id_qmk_tapping_global_term_exact')).toBe(true);
    expect(isDeferredApplyCommand('id_qmk_tapdance_1_tap')).toBe(true);
    expect(isDeferredApplyCommand('id_qmk_tapdance_1_term_exact')).toBe(true);
    expect(isDeferredApplyCommand('id_qmk_rgb_sleep_timeout_exact')).toBe(true);
    expect(isDeferredApplyCommand('id_qmk_rgb_sleep_timeout')).toBe(false);
    expect(isDeferredApplyCommand('id_qmk_rgb_matrix_brightness')).toBe(false);
    expect(isDeferredApplyCommand(undefined)).toBe(false);
  });

  test('defers only the matching command, not every control in the same submenu', () => {
    expect(
      shouldDeferApplyCommand(true, 'id_qmk_rgb_sleep_timeout_exact'),
    ).toBe(true);
    expect(shouldDeferApplyCommand(true, 'id_qmk_rgb_sleep_enable')).toBe(false);
    expect(
      shouldDeferApplyCommand(false, 'id_qmk_rgb_sleep_timeout_exact'),
    ).toBe(false);
  });

  test('Apply stays off for an unchanged ms value and on for a different valid value', () => {
    const adapter = {minMs: 1, maxMs: 65535};
    expect(canApplyMillisecondDraft('200', 200, adapter, false)).toBe(false);
    expect(canApplyMillisecondDraft('137', 200, adapter, false)).toBe(true);
  });

  test('SLEEP Apply stays off at the saved seconds and on only for a different valid value', () => {
    const adapter = {min: 1, max: 65535};
    expect(canApplyIntegerDraft('600', 600, adapter, false)).toBe(false);
    expect(canApplyIntegerDraft('601', 600, adapter, false)).toBe(true);
    expect(canApplyIntegerDraft('0', 600, adapter, false)).toBe(false);
    expect(canApplyIntegerDraft('65536', 600, adapter, false)).toBe(false);
  });
});

describe('continuous control lifecycle wiring', () => {
  test('range completion covers pointer, touch, keyboard, blur, cancel, and unmount', () => {
    const range = source('../src/components/inputs/accent-range.tsx');

    for (const handler of [
      'onPointerUp',
      'onPointerCancel',
      'onTouchEnd',
      'onTouchCancel',
      'onKeyUp',
      'onBlur',
    ]) {
      expect(range).toContain(handler);
    }
    expect(range).toContain('completionRef.current?.()');
    expect(range).toContain('onInteractionCancel ?? onInteractionComplete');
  });

  test('color completion covers pointer release/cancel, close, blur, keyboard, and unmount', () => {
    const picker = source('../src/components/inputs/color-picker.tsx');

    expect(picker).toContain('onPointerUp={this.onPointerUp}');
    expect(picker).toContain('onPointerCancel={this.onPointerCancel}');
    expect(picker).toContain('handleHexBlur');
    expect(picker).toContain("e.key === 'Enter'");
    expect(picker).toContain("e.key === 'Escape'");
    expect(picker).toContain('onDocumentClick');
    expect(picker).toContain('componentWillUnmount()');
    expect(picker).toContain('this.props.onInteractionComplete?.()');
  });

  test('only verified range/color paths are shaped', () => {
    const custom = source(
      '../src/components/panes/configure-panes/custom/custom-control.tsx',
    );
    const lighting = source(
      '../src/components/panes/configure-panes/submenus/lighting/lighting-control.tsx',
    );

    expect(custom).toContain('<DeferredRangeControl');
    expect(custom).toContain('props.updateContinuousRangeValue(name, val)');
    expect(custom).toContain('props.updateContinuousValue(name, ...command, hue, sat)');
    expect(custom).toContain('props.updateValue(name, ...command, +option.value)');
    expect(custom).toContain('return null;');
    expect(lighting).toContain('updateBacklightValueContinuous(command, val)');
    expect(lighting).toContain('dispatch(updateBacklightValue(command, +val))');
  });
});
