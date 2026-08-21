import {describe, expect, test} from 'bun:test';
import {
  encodeStateSyncRequest,
  isCapableStateSyncEnvelope,
  parseStateSyncEnvelope,
  ERA_STATE_SYNC_COMMAND,
  ERA_STATE_SYNC_SELECTOR,
  ERA_STATE_SYNC_ENVELOPE_VERSION,
  ERA_STATE_SYNC_STATUS_OK,
  ERA_STATE_SYNC_DOMAIN_MASK_INITIAL,
} from '../src/utils/era-state-sync';
import {
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
) => {
  const bytes = encodeStateSyncRequest(0xabcd);
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

describe('GET 0x06 envelope', () => {
  test('encodes selector 0x06 version 0x01 and parses capable revisions', () => {
    const request = encodeStateSyncRequest(0x0102);
    expect(request[0]).toBe(ERA_STATE_SYNC_COMMAND);
    expect(request[1]).toBe(ERA_STATE_SYNC_SELECTOR);
    expect(request[2]).toBe(ERA_STATE_SYNC_ENVELOPE_VERSION);
    expect(request[4]).toBe(0x01);
    expect(request[5]).toBe(0x02);
    expect(request[3]).toBe(0);
    expect(request.slice(6)).toEqual(new Array(26).fill(0));

    const parsed = parseStateSyncEnvelope(envelope());
    expect(isCapableStateSyncEnvelope(parsed)).toBe(true);
    expect(parsed?.revisions).toEqual({keymap: 1, macro: 2, config: 3});
    expect(parsed?.tag).toBe(0xabcd);
  });

  test('requires the echoed tag, exact known mask, v1 and nonzero equality tokens', () => {
    expect(parseStateSyncEnvelope(envelope(), 0xabcd)?.tag).toBe(0xabcd);
    expect(parseStateSyncEnvelope(envelope(), 0x1234)).toBeNull();
    expect(parseStateSyncEnvelope(envelope({mask: 0x0f}))).toBeNull();

    const unsupportedVersion = envelope();
    unsupportedVersion[2] = 0x02;
    expect(
      isCapableStateSyncEnvelope(
        parseStateSyncEnvelope(unsupportedVersion, 0xabcd),
      ),
    ).toBe(false);

    const zeroRevision = envelope();
    zeroRevision.fill(0, 8, 12);
    expect(
      isCapableStateSyncEnvelope(parseStateSyncEnvelope(zeroRevision, 0xabcd)),
    ).toBe(false);
  });

  test('unhandled 0xFF, bad reserved bytes and incomplete mask are not capable', () => {
    const unhandled = new Uint8Array(32);
    unhandled[0] = 0xff;
    expect(parseStateSyncEnvelope(unhandled)).toBeNull();
    expect(
      isCapableStateSyncEnvelope(
        parseStateSyncEnvelope(envelope({reserved: 1})),
      ),
    ).toBe(false);
    expect(
      isCapableStateSyncEnvelope(parseStateSyncEnvelope(envelope({tail: 1}))),
    ).toBe(false);
    expect(
      isCapableStateSyncEnvelope(
        parseStateSyncEnvelope(envelope({mask: 0x01})),
      ),
    ).toBe(false);
    expect(
      isCapableStateSyncEnvelope(parseStateSyncEnvelope(envelope({status: 1}))),
    ).toBe(false);
    expect(parseStateSyncEnvelope(envelope().slice(0, 31))).toBeNull();
    expect(parseStateSyncEnvelope([...envelope(), 0])).toBeNull();
  });
});

describe('definition opt-in', () => {
  test('only lock-listed vendorProductIds are probe candidates', () => {
    setEraAdvancedMetadataForTesting({
      schemaVersion: 1,
      definitions: [
        {
          id: 'tomak79h-left',
          vendorProductId: 1163042818,
          stateSync: true,
          exactMsFamily: 'qmk',
        },
      ],
    });
    expect(isStateSyncOptIn(1163042818)).toBe(true);
    expect(isStateSyncOptIn(1)).toBe(false);
    setEraAdvancedMetadataForTesting(null);
  });
});
