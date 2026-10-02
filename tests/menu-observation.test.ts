import {describe, expect, test} from 'bun:test';
await import('./setup');
const {KeyboardAPI} = await import('../src/utils/keyboard-api');
const {HIDTransportTimeoutError, HIDTransportGenerationError} =
  await import('../src/shims/node-hid');
const {
  POLLING_CURRENT,
  LINK_RESULT,
  parseMenuObservation,
  readMenuObservation,
} = await import('../src/utils/menu-observation');
const payload = (text: string) => [
  ...new TextEncoder().encode(text),
  ...Array(29 - text.length).fill(0),
];

describe('read-only menu observations', () => {
  test('polling accepts only the five NUL-terminated, zero-padded ASCII values', () => {
    for (const text of [
      '1000 Hz (FS)',
      '2000 Hz (HS)',
      '4000 Hz (HS)',
      '8000 Hz (HS)',
      'Unavailable',
    ]) {
      expect(parseMenuObservation(POLLING_CURRENT, payload(text))).toBe(text);
    }
    for (const bytes of [
      payload('8000 Hz'),
      payload('8000 Hz (FS)'),
      Array(29).fill(65),
      payload('8000 Hz (HS)').slice(0, 28),
      [...payload('8000 Hz (HS)').slice(0, 28), 1],
      [255, ...Array(28).fill(0)],
    ]) {
      expect(() => parseMenuObservation(POLLING_CURRENT, bytes)).toThrow();
    }
  });
  test('link receipt validates current firmware spellings including terminal failures', () => {
    for (const text of [
      'No Apply this boot',
      'Pending High',
      'Pending Medium',
      'Pending Low',
      'Applied High',
      'Applied Medium',
      'Applied Low',
      'Already set',
      'Busy - retry',
      'Failed - check levels',
      'Cancelled - retry',
    ]) {
      expect(parseMenuObservation(LINK_RESULT, payload(text))).toBe(text);
    }
    expect(() =>
      parseMenuObservation(LINK_RESULT, payload('Success')),
    ).toThrow();
  });
  test('unhandled alone is optional; timeout, malformed, disconnect and I/O remain distinct', async () => {
    const run = (get: () => Promise<number[] | null>) =>
      readMenuObservation(
        {getOptionalCustomMenuValue: get} as KeyboardAPI,
        LINK_RESULT,
        () => true,
      );
    expect(await run(async () => null)).toEqual({status: 'unsupported'});
    expect(
      await run(async () => {
        throw new HIDTransportTimeoutError();
      }),
    ).toEqual({status: 'timeout'});
    expect(
      await run(async () => {
        throw new HIDTransportGenerationError();
      }),
    ).toEqual({status: 'disconnected'});
    expect(
      await run(async () => {
        throw new Error('I/O');
      }),
    ).toEqual({status: 'error'});
    expect(await run(async () => [66, ...payload('invalid')])).toEqual({
      status: 'malformed',
    });
  });
});
