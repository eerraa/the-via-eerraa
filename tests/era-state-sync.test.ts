import {describe, expect, test} from 'bun:test';
import {
  encodeStateSyncRequest,
  isCapableStateSyncEnvelope,
  parseStateSyncEnvelope,
  ERA_STATE_SYNC_COMMAND,
  ERA_STATE_SYNC_ENVELOPE_VERSION,
  ERA_STATE_SYNC_STATUS_OK,
  ERA_STATE_SYNC_DOMAIN_MASK_INITIAL,
} from '../src/utils/era-state-sync';
import {
  getExactMsFamily,
  isStateSyncOptIn,
  setEraAdvancedMetadataForTesting,
} from '../src/utils/era-advanced-metadata';

const envelope = (
  extras: Partial<{
    status: number;
    mask: number;
    reserved: number;
    tail: number;
  }> = {},
  selector = 0x80,
) => {
  const bytes = encodeStateSyncRequest(0xabcd, selector);
  bytes[3] = extras.status ?? ERA_STATE_SYNC_STATUS_OK;
  bytes[6] = extras.mask ?? ERA_STATE_SYNC_DOMAIN_MASK_INITIAL;
  bytes[7] = extras.reserved ?? 0;
  bytes[11] = 1;
  bytes[15] = 2;
  bytes[19] = 3;
  if (extras.tail !== undefined) {
    bytes[20] = extras.tail;
  }
  return bytes;
};

describe.each([0x80, 0x06])('selector %i State Sync envelope', (selector) => {
  const makeEnvelope = (extras: Parameters<typeof envelope>[0] = {}) =>
    envelope(extras, selector);
  const parse = (bytes: number[] | Uint8Array, tag?: number) =>
    parseStateSyncEnvelope(bytes, selector, tag);

  test('encodes the selected selector, version 0x01 and capable revisions', () => {
    const request = encodeStateSyncRequest(0x0102, selector);
    expect(request[0]).toBe(ERA_STATE_SYNC_COMMAND);
    expect(request[1]).toBe(selector);
    expect(request[2]).toBe(ERA_STATE_SYNC_ENVELOPE_VERSION);
    expect(request[4]).toBe(0x01);
    expect(request[5]).toBe(0x02);
    expect(request[3]).toBe(0);
    expect(request.slice(6)).toEqual(new Array(26).fill(0));

    const parsed = parse(makeEnvelope());
    expect(isCapableStateSyncEnvelope(parsed)).toBe(true);
    expect(parsed?.revisions).toEqual({keymap: 1, macro: 2, config: 3});
    expect(parsed?.tag).toBe(0xabcd);
  });

  test('requires the echoed tag, exact known mask, v1 and nonzero equality tokens', () => {
    expect(parse(makeEnvelope(), 0xabcd)?.tag).toBe(0xabcd);
    expect(parse(makeEnvelope(), 0x1234)).toBeNull();
    expect(parse(makeEnvelope({mask: 0x0f}))).toBeNull();
    const wrongSelector = makeEnvelope();
    wrongSelector[1] = selector === 0x80 ? 0x06 : 0x80;
    expect(parse(wrongSelector)).toBeNull();

    const unsupportedVersion = makeEnvelope();
    unsupportedVersion[2] = 0x02;
    const zeroRevision = makeEnvelope();
    zeroRevision.fill(0, 8, 12);
    for (const bytes of [unsupportedVersion, zeroRevision]) {
      expect(isCapableStateSyncEnvelope(parse(bytes, 0xabcd))).toBe(false);
    }
  });

  test('unhandled 0xFF, bad reserved bytes and incomplete mask are not capable', () => {
    const unhandled = new Uint8Array(32);
    unhandled[0] = 0xff;
    expect(parse(unhandled)).toBeNull();
    for (const extras of [
      {reserved: 1},
      {tail: 1},
      {mask: 0x01},
      {status: 1},
    ]) {
      expect(isCapableStateSyncEnvelope(parse(makeEnvelope(extras)))).toBe(false);
    }
    expect(parse(makeEnvelope().slice(0, 31))).toBeNull();
    expect(parse([...makeEnvelope(), 0])).toBeNull();
  });
});

test('a protocol-13 QMK keycodes version reply is never a capable envelope', () => {
  const keycodesVersion = new Uint8Array(32);
  keycodesVersion.set([0x02, 0x06, 0x00, 0x00, 0x00, 0x08]);
  expect(parseStateSyncEnvelope(keycodesVersion, 0x80)).toBeNull();
  expect(isCapableStateSyncEnvelope(parseStateSyncEnvelope(keycodesVersion, 0x06)))
    .toBe(false);
});

describe('definition opt-in', () => {
  test('only manifest-listed vendorProductIds are probe candidates', () => {
    setEraAdvancedMetadataForTesting({
      schemaVersion: 1,
      definitions: [
        {
          id: 'tomak79h-left',
          vendorProductId: 1163042818,
          stateSync: true,
          exactMsFamily: 'qmk',
        },
        {
          id: 'exact-without-state-sync',
          vendorProductId: 2,
          stateSync: false,
          exactMsFamily: 'qmk',
        },
      ],
    });
    expect(isStateSyncOptIn(1163042818)).toBe(true);
    expect(isStateSyncOptIn(1)).toBe(false);
    expect(isStateSyncOptIn(2)).toBe(false);
    expect(getExactMsFamily(2)).toBe('qmk');
    setEraAdvancedMetadataForTesting(null);
  });
});
