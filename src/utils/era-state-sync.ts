import {HIDTransportTimeoutError} from '../shims/node-hid';
import type {KeyboardAPI} from './keyboard-api';

export const ERA_STATE_SYNC_COMMAND = 0x02;
export const ERA_STATE_SYNC_SELECTOR = 0x06;
export const ERA_STATE_SYNC_ENVELOPE_VERSION = 0x01;
export const ERA_STATE_SYNC_STATUS_OK = 0x00;
export const ERA_STATE_SYNC_STATUS_UNSUPPORTED_VERSION = 0x01;
export const ERA_STATE_SYNC_POLL_INTERVAL_MS = 500;
export const ERA_STATE_SYNC_REFRESH_RETRIES = 3;

export const ERA_STATE_SYNC_DOMAIN_KEYMAP = 0x01;
export const ERA_STATE_SYNC_DOMAIN_MACRO = 0x02;
export const ERA_STATE_SYNC_DOMAIN_CONFIG = 0x04;
export const ERA_STATE_SYNC_DOMAIN_MASK_INITIAL = 0x07;

export type StateSyncCapability = 'unknown' | 'probing' | 'capable' | 'unsupported';

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

const tags = new Map<string, number>();

export const nextStateSyncTag = (path: string) => {
  const next = ((tags.get(path) ?? 0) + 1) & 0xffff;
  const tag = next === 0 ? 1 : next;
  tags.set(path, tag);
  return tag;
};

export const resetStateSyncTagsForTesting = () => {
  tags.clear();
};

export const encodeStateSyncRequest = (tag: number) => {
  const bytes = new Array(32).fill(0);
  bytes[0] = ERA_STATE_SYNC_COMMAND;
  bytes[1] = ERA_STATE_SYNC_SELECTOR;
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
): StateSyncEnvelope | null => {
  if (bytes.length < 32) {
    return null;
  }
  if (bytes[0] === 0xff) {
    return null;
  }
  if (bytes[0] !== ERA_STATE_SYNC_COMMAND || bytes[1] !== ERA_STATE_SYNC_SELECTOR) {
    return null;
  }
  if (bytes[7] !== 0) {
    return null;
  }
  for (let i = 20; i < 32; i++) {
    if (bytes[i] !== 0) {
      return null;
    }
  }
  return {
    version: bytes[2],
    status: bytes[3],
    tag: (bytes[4] << 8) | bytes[5],
    domainMask: bytes[6],
    revisions: {
      keymap: be32(bytes, 8),
      macro: be32(bytes, 12),
      config: be32(bytes, 16),
    },
  };
};

export const isCapableStateSyncEnvelope = (envelope: StateSyncEnvelope | null) =>
  envelope !== null &&
  envelope.version === ERA_STATE_SYNC_ENVELOPE_VERSION &&
  envelope.status === ERA_STATE_SYNC_STATUS_OK &&
  (envelope.domainMask & ERA_STATE_SYNC_DOMAIN_MASK_INITIAL) ===
    ERA_STATE_SYNC_DOMAIN_MASK_INITIAL;

export async function queryStateSyncEnvelope(
  api: KeyboardAPI,
): Promise<StateSyncEnvelope | null> {
  const tag = nextStateSyncTag(api.kbAddr);
  const requestBytes = encodeStateSyncRequest(tag);
  const padded = new Array(33).fill(0);
  requestBytes.forEach((value, index) => {
    padded[index + 1] = value;
  });
  try {
    const response = (await api.getHID().exchange(padded, (message: Uint8Array) => {
      if (message.length !== 32) {
        return false;
      }
      if (message[0] === 0xff) {
        return true;
      }
      return (
        message[0] === ERA_STATE_SYNC_COMMAND &&
        message[1] === ERA_STATE_SYNC_SELECTOR &&
        message[4] === ((tag >> 8) & 0xff) &&
        message[5] === (tag & 0xff)
      );
    })) as Uint8Array;
    return parseStateSyncEnvelope(response);
  } catch (error) {
    if (error instanceof HIDTransportTimeoutError) {
      return null;
    }
    return null;
  }
}
