import {HIDTransportTimeoutError} from '../shims/node-hid';
import type {KeyboardAPI} from './keyboard-api';
import {ERA_WIRE, VIA_COMMANDS} from './era-wire.generated';
import {
  isExactUnhandledEcho,
  queryConnectionStateSync,
  resetConnectionProfilesForTesting,
} from './connection-profile';

export const ERA_STATE_SYNC_COMMAND = VIA_COMMANDS.id_get_keyboard_value;
export const ERA_STATE_SYNC_SELECTOR = ERA_WIRE.STATE_SYNC_SELECTORS.CURRENT;
export const ERA_STATE_SYNC_LEGACY_SELECTOR = ERA_WIRE.STATE_SYNC_SELECTORS.LEGACY;
export const ERA_STATE_SYNC_ENVELOPE_VERSION = ERA_WIRE.STATE_SYNC.ENVELOPE_VERSION;
export const ERA_STATE_SYNC_STATUS_OK = ERA_WIRE.STATE_SYNC_STATUS.OK;
export const ERA_STATE_SYNC_POLL_INTERVAL_MS = 500;
export const ERA_STATE_SYNC_REFRESH_RETRIES = 3;

export const ERA_STATE_SYNC_DOMAIN_MASK_INITIAL = ERA_WIRE.STATE_SYNC_DOMAINS.MASK_INITIAL;

export type StateSyncCapability =
  'unknown' | 'probing' | 'capable' | 'unverified';

export type StateSyncRevisions = {
  keymap: number;
  macro: number;
  config: number;
};

export type StateSyncEnvelope = {
  version: number;
  status: number;
  tag: number;
  domainMask: number;
  revisions: StateSyncRevisions;
};

export type StateSyncQueryResult =
  | {kind: 'envelope'; envelope: StateSyncEnvelope}
  | {kind: 'unhandled' | 'timeout' | 'malformed'};

const tags = new Map<string, number>();

const nextStateSyncTag = (path: string) => {
  const next = ((tags.get(path) ?? 0) + 1) & 0xffff;
  const tag = next === 0 ? 1 : next;
  tags.set(path, tag);
  return tag;
};

export const resetStateSyncTagsForTesting = () => {
  tags.clear();
  resetConnectionProfilesForTesting();
};

export const encodeStateSyncRequest = (tag: number, selector: number) => {
  const bytes = new Array(ERA_WIRE.VIA_REPORT.SIZE).fill(0);
  bytes[0] = ERA_STATE_SYNC_COMMAND;
  bytes[1] = selector;
  bytes[2] = ERA_STATE_SYNC_ENVELOPE_VERSION;
  bytes[4] = (tag >> 8) & 0xff;
  bytes[5] = tag & 0xff;
  return bytes;
};

const be32 = (bytes: number[] | Uint8Array, offset: number) =>
  ((bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]) >>>
  0;

export const parseStateSyncEnvelope = (
  bytes: number[] | Uint8Array,
  selector: number,
  expectedTag?: number,
): StateSyncEnvelope | null => {
  if (bytes.length !== ERA_WIRE.VIA_REPORT.SIZE) {
    return null;
  }
  if (bytes[0] === VIA_COMMANDS.id_unhandled) {
    return null;
  }
  if (
    bytes[0] !== ERA_STATE_SYNC_COMMAND ||
    bytes[1] !== selector
  ) {
    return null;
  }
  const tag = (bytes[4] << 8) | bytes[5];
  if (
    (expectedTag !== undefined && tag !== expectedTag) ||
    (bytes[6] & ~ERA_STATE_SYNC_DOMAIN_MASK_INITIAL) !== 0 ||
    bytes[7] !== 0
  ) {
    return null;
  }
  for (let i = 20; i < ERA_WIRE.VIA_REPORT.SIZE; i++) {
    if (bytes[i] !== 0) {
      return null;
    }
  }
  return {
    version: bytes[2],
    status: bytes[3],
    tag,
    domainMask: bytes[6],
    revisions: {
      keymap: be32(bytes, 8),
      macro: be32(bytes, 12),
      config: be32(bytes, 16),
    },
  };
};

export const isCapableStateSyncEnvelope = (
  envelope: StateSyncEnvelope | null,
) =>
  envelope !== null &&
  envelope.version === ERA_STATE_SYNC_ENVELOPE_VERSION &&
  envelope.status === ERA_STATE_SYNC_STATUS_OK &&
  envelope.domainMask === ERA_STATE_SYNC_DOMAIN_MASK_INITIAL &&
  envelope.revisions.keymap !== 0 &&
  envelope.revisions.macro !== 0 &&
  envelope.revisions.config !== 0;

async function queryStateSyncSelector(
  api: KeyboardAPI,
  selector: number,
): Promise<StateSyncQueryResult> {
  const tag = nextStateSyncTag(api.kbAddr);
  const requestBytes = encodeStateSyncRequest(tag, selector);
  const padded = new Array(ERA_WIRE.VIA_REPORT.SIZE + 1).fill(0);
  requestBytes.forEach((value, index) => {
    padded[index + 1] = value;
  });
  try {
    const response = (await api.exchangeHID(
      padded,
      (message: Uint8Array) => {
        if (message.length !== ERA_WIRE.VIA_REPORT.SIZE) {
          return false;
        }
        if (message[0] === VIA_COMMANDS.id_unhandled) {
          return isExactUnhandledEcho(requestBytes, message);
        }
        return (
          message[0] === ERA_STATE_SYNC_COMMAND &&
          message[1] === selector &&
          message[4] === ((tag >> 8) & 0xff) &&
          message[5] === (tag & 0xff)
        );
      },
      {timeoutBehavior: 'preserve-generation'},
    )) as Uint8Array;
    if (response[0] === VIA_COMMANDS.id_unhandled) {
      return {kind: 'unhandled'};
    }
    const envelope = parseStateSyncEnvelope(response, selector, tag);
    return envelope ? {kind: 'envelope', envelope} : {kind: 'malformed'};
  } catch (error) {
    if (error instanceof HIDTransportTimeoutError) {
      return {kind: 'timeout'};
    }
    return {kind: 'malformed'};
  }
}

export async function queryStateSync(
  api: KeyboardAPI,
): Promise<StateSyncQueryResult> {
  return queryConnectionStateSync(
    api,
    (selector) => queryStateSyncSelector(api, selector),
    (result) => result.kind === 'envelope' && isCapableStateSyncEnvelope(result.envelope),
  );
}
