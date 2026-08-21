import {describe, expect, test} from 'bun:test';
import {
  commitMillisecondDraft,
  parseMillisecondDraft,
  projectLegacyMs,
  revertMillisecondDraft,
  type MillisecondCommitState,
} from '../src/utils/millisecond-field';
import {FakeMillisecondDevice} from './fixtures/millisecond-fake';

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
  });
});

describe('commitMillisecondDraft', () => {
  test('exact capability round-trips 137 without HID write on invalid drafts', async () => {
    const device = new FakeMillisecondDevice('exact', 200);
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
    expect(await device.read()).toBe(137);
  });

  test('legacy capability exposes the 20ms step instead of pretending exact', async () => {
    const device = new FakeMillisecondDevice('legacy', 200);
    const committed = await commitMillisecondDraft('137', idle(200), device);
    expect(committed.wrote).toBe(true);
    expect(device.writes).toEqual([137]);
    expect(committed.next.authoritativeMs).toBe(120);
    expect(projectLegacyMs(137, 100, 500, 20)).toBe(120);
  });

  test('unsupported capability never HID-writes', async () => {
    const device = new FakeMillisecondDevice('unsupported', 200);
    const result = await commitMillisecondDraft('137', idle(200), device);
    expect(result.wrote).toBe(false);
    expect(device.writes).toEqual([]);
    expect(result.next.error).toContain('does not support');
  });

  test('in-flight state blocks duplicate submit', async () => {
    const device = new FakeMillisecondDevice('exact', 200);
    const result = await commitMillisecondDraft('137', {
      ...idle(200),
      inFlight: true,
    }, device);
    expect(result.wrote).toBe(false);
    expect(device.writes).toEqual([]);
  });

  test('Escape restores the last authoritative value', () => {
    const reverted = revertMillisecondDraft({
      authoritativeMs: 200,
      draft: '137',
      inFlight: false,
      error: 'Enter an integer millisecond value.',
    });
    expect(reverted.draft).toBe('200');
    expect(reverted.error).toBeNull();
  });
});
