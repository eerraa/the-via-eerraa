import {describe, expect, test} from 'bun:test';
import {
  canApplyMillisecondDraft,
  commitMillisecondDraft,
  parseFailureMessage,
  parseMillisecondDraft,
  QMK_EXACT_TAPPING_TERM_BOUNDS,
  revertMillisecondDraft,
  type MillisecondCommitState,
} from '../src/utils/millisecond-field';
import {FakeMillisecondDevice} from './fixtures/millisecond-fake';
import {
  canApplyIntegerDraft,
  commitIntegerDraft,
  parseIntegerDraft,
} from '../src/utils/integer-field';
import {
  customExactGlobalTermControl,
  exactGlobalTermControl,
  LEGACY_TAPPING_TERM_OPTIONS,
  legacyGlobalTermControl,
} from './fixtures/via-ms-definitions';

const idle = (ms: number): MillisecondCommitState => ({
  authoritativeMs: ms,
  draft: String(ms),
  inFlight: false,
  error: null,
});

describe('parseMillisecondDraft', () => {
  test('accepts integer bounds and a non-grid value', () => {
    expect(parseMillisecondDraft('100', 100, 500)).toEqual({
      ok: true,
      valueMs: 100,
    });
    expect(parseMillisecondDraft('137', 100, 500)).toEqual({
      ok: true,
      valueMs: 137,
    });
    expect(parseMillisecondDraft('499', 100, 500)).toEqual({
      ok: true,
      valueMs: 499,
    });
    expect(parseMillisecondDraft('500', 100, 500)).toEqual({
      ok: true,
      valueMs: 500,
    });
  });

  test('rejects empty decimal NaN and out of range without writing', () => {
    expect(parseMillisecondDraft('', 100, 500).ok).toBe(false);
    expect(parseMillisecondDraft('   ', 100, 500)).toEqual({
      ok: false,
      reason: 'empty',
    });
    expect(parseMillisecondDraft('137.5', 100, 500)).toEqual({
      ok: false,
      reason: 'decimal',
    });
    expect(parseMillisecondDraft('12,0', 100, 500)).toEqual({
      ok: false,
      reason: 'decimal',
    });
    expect(parseMillisecondDraft('NaN', 100, 500)).toEqual({
      ok: false,
      reason: 'nan',
    });
    expect(parseMillisecondDraft('abc', 100, 500)).toEqual({
      ok: false,
      reason: 'nan',
    });
    expect(parseMillisecondDraft('99', 100, 500)).toEqual({
      ok: false,
      reason: 'out_of_range',
    });
    expect(parseMillisecondDraft('501', 100, 500)).toEqual({
      ok: false,
      reason: 'out_of_range',
    });
    expect(parseMillisecondDraft('1', 1, 65535)).toEqual({
      ok: true,
      valueMs: 1,
    });
    expect(parseMillisecondDraft('65535', 1, 65535)).toEqual({
      ok: true,
      valueMs: 65535,
    });
    expect(parseMillisecondDraft('0', 1, 65535)).toEqual({
      ok: false,
      reason: 'out_of_range',
    });
    expect(parseMillisecondDraft('65536', 1, 65535)).toEqual({
      ok: false,
      reason: 'out_of_range',
    });
    expect(parseMillisecondDraft('99999', 1, 65535)).toEqual({
      ok: false,
      reason: 'out_of_range',
    });
    expect(parseFailureMessage('out_of_range')).toBe('Out of range');
  });
});

describe('exact integer duration field', () => {
  test('accepts the exact-second uint16 range and rejects zero or overflow', async () => {
    expect(parseIntegerDraft('1', 1, 65535)).toEqual({ok: true, value: 1});
    expect(parseIntegerDraft('65535', 1, 65535)).toEqual({
      ok: true,
      value: 65535,
    });
    expect(parseIntegerDraft('0', 1, 65535)).toEqual({
      ok: false,
      reason: 'out_of_range',
    });
    expect(parseIntegerDraft('65536', 1, 65535)).toEqual({
      ok: false,
      reason: 'out_of_range',
    });

    const writes: number[] = [];
    const adapter = {
      min: 1,
      max: 65535,
      async write(value: number) {
        writes.push(value);
        return value;
      },
    };
    expect(canApplyIntegerDraft('137', 3600, adapter, false)).toBe(true);
    const result = await commitIntegerDraft(
      '137',
      {
        authoritativeValue: 3600,
        draft: '137',
        inFlight: false,
        error: null,
      },
      adapter,
    );
    expect(result.wrote).toBe(true);
    expect(result.next.authoritativeValue).toBe(137);
    expect(writes).toEqual([137]);
  });
});

describe('canApplyMillisecondDraft', () => {
  const adapter = {minMs: 1, maxMs: 65535};

  test('stays inactive for the already saved value and for values outside the uint16 exact range', () => {
    expect(canApplyMillisecondDraft('0', 200, adapter, false)).toBe(false);
    expect(canApplyMillisecondDraft('200', 200, adapter, false)).toBe(false);
    expect(canApplyMillisecondDraft('2', 200, adapter, false)).toBe(true);
    expect(canApplyMillisecondDraft('20', 200, adapter, false)).toBe(true);
    expect(canApplyMillisecondDraft('137', 200, adapter, false)).toBe(true);
    expect(canApplyMillisecondDraft('137', 200, adapter, true)).toBe(false);
  });
});

describe('commitMillisecondDraft', () => {
  test('exact capability round-trips 137 without HID write on invalid drafts', async () => {
    const device = new FakeMillisecondDevice(200);
    const invalids = ['', '99', '501', '137.2', 'NaN'];
    let state = idle(200);
    for (const draft of invalids) {
      const result = await commitMillisecondDraft(draft, state, device);
      expect(result.wrote).toBe(false);
      expect(device.writes).toEqual([]);
      expect(result.next.authoritativeMs).toBe(200);
      expect(result.next.error).toBeTruthy();
    }

    const committed = await commitMillisecondDraft('137', state, device);
    expect(committed.wrote).toBe(true);
    expect(device.writes).toEqual([137]);
    expect(committed.next.authoritativeMs).toBe(137);
    expect(committed.next.draft).toBe('137');
    expect(device.storedMs).toBe(137);
  });

  test('in-flight state blocks duplicate submit', async () => {
    const device = new FakeMillisecondDevice(200);
    const result = await commitMillisecondDraft(
      '137',
      {
        ...idle(200),
        inFlight: true,
      },
      device,
    );
    expect(result.wrote).toBe(false);
    expect(device.writes).toEqual([]);
  });

  test('Escape restores the last authoritative value', () => {
    const reverted = revertMillisecondDraft({
      authoritativeMs: 200,
      draft: '137',
      inFlight: false,
      error: 'Enter an integer',
    });
    expect(reverted.draft).toBe('200');
    expect(reverted.error).toBeNull();
  });

  test('stock JSON exact options stay 100-500; custom JSON is 1-65535', () => {
    expect(legacyGlobalTermControl.content[2]).toBe(1);
    expect(LEGACY_TAPPING_TERM_OPTIONS[0]).toBe(10);
    expect(LEGACY_TAPPING_TERM_OPTIONS.at(-1)).toBe(50);
    expect(exactGlobalTermControl.options).toEqual([100, 500]);
    expect(customExactGlobalTermControl.options).toEqual([1, 65535]);
    expect(exactGlobalTermControl.type).toBe('range');
    expect(QMK_EXACT_TAPPING_TERM_BOUNDS).toEqual({minMs: 1, maxMs: 65535});
  });

  test('QMK exact adapter commits 1 and 65535 without widening stock JSON options', async () => {
    const device = new FakeMillisecondDevice(200, {
      minMs: QMK_EXACT_TAPPING_TERM_BOUNDS.minMs,
      maxMs: QMK_EXACT_TAPPING_TERM_BOUNDS.maxMs,
    });
    const low = await commitMillisecondDraft('1', idle(200), device);
    expect(low.wrote).toBe(true);
    expect(low.next.authoritativeMs).toBe(1);
    const high = await commitMillisecondDraft('65535', idle(1), device);
    expect(high.wrote).toBe(true);
    expect(high.next.authoritativeMs).toBe(65535);
    expect(exactGlobalTermControl.options).toEqual([100, 500]);
  });

  test('eight independent TD slots keep non-grid values on exact adapters', async () => {
    const slots = Array.from({length: 8}, () => new FakeMillisecondDevice(200));
    const values = [101, 137, 141, 163, 187, 203, 499, 500];
    for (const [index, valueMs] of values.entries()) {
      const result = await commitMillisecondDraft(
        String(valueMs),
        idle(200),
        slots[index],
      );
      expect(result.wrote).toBe(true);
      expect(result.next.authoritativeMs).toBe(valueMs);
    }
    expect(slots.map((slot) => slot.storedMs)).toEqual(values);
  });
});
