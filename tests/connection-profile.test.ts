import {beforeEach, describe, expect, test} from 'bun:test';
import {
  getConnectionProfile,
  getProtocolProfile,
  isExactUnhandledEcho,
  queryConnectionStateSync,
  requireConnectionProtocol,
  requireKeycodeDictionary,
  resetConnectionProfilesForTesting,
} from '../src/utils/connection-profile';
import {ERA_WIRE, VIA_COMMANDS} from '../src/utils/era-wire.generated';
import {isCapableStateSyncEnvelope, type StateSyncQueryResult} from '../src/utils/era-state-sync';
import defaultKeys from '../src/utils/key-to-byte/default';
import v10 from '../src/utils/key-to-byte/v10';
import v11 from '../src/utils/key-to-byte/v11';
import v12 from '../src/utils/key-to-byte/v12';
import v13 from '../src/utils/key-to-byte/v13';

beforeEach(resetConnectionProfilesForTesting);
const identity = (path = 'profile-test') => {
  let generation = 1;
  return {
    kbAddr: path,
    getConnectionGeneration: () => generation,
    isConnectionGenerationCurrent: (value: number) => value === generation,
    reconnect: () => generation++,
  };
};
const capable: StateSyncQueryResult = {
  kind: 'envelope',
  envelope: {
    version: ERA_WIRE.STATE_SYNC.ENVELOPE_VERSION,
    status: ERA_WIRE.STATE_SYNC_STATUS.OK,
    tag: 1,
    domainMask: ERA_WIRE.STATE_SYNC_DOMAINS.MASK_INITIAL,
    revisions: {keymap: 1, macro: 2, config: 3},
  },
};
const isCapable = (result: StateSyncQueryResult) =>
  result.kind === 'envelope' && isCapableStateSyncEnvelope(result.envelope);
const {CURRENT, LEGACY} = ERA_WIRE.STATE_SYNC_SELECTORS;

describe('protocol facts', () => {
  test.each([
    [0, undefined, defaultKeys, 'legacy'],
    [9, undefined, defaultKeys, 'legacy'],
    [10, undefined, v10, 'legacy'],
    [11, undefined, v11, 'v11'],
    [12, undefined, v12, 'v11'],
    [13, 8, v13, 'v11'],
    [13, 9, v13, 'v11'],
    [14, 9, v13, 'v11'],
  ] as const)('protocol %i / keycodes %s', (protocol, keycodesVersion, keys, encoding) => {
    const profile = getProtocolProfile({protocol, keycodesVersion});
    expect(profile.protocolVersion).toBe(protocol);
    expect(profile.keycodesVersion).toBe(keycodesVersion);
    expect(requireKeycodeDictionary(profile)).toBe(keys);
    expect(profile.macroEncoding).toBe(encoding);
  });

  test('unknown protocol-13 keycodes remain unavailable rather than defaulting', () => {
    const profile = getProtocolProfile({protocol: 13});
    expect(profile.keycodesReady).toBe(false);
    expect(profile.basicKeyToByte).toBeUndefined();
    expect(profile.layoutImportKeycodes).toBeUndefined();
    expect(() => requireKeycodeDictionary(profile)).toThrow('requires a QMK keycodes version');
  });

  test('connection facts update after keycodes arrive and reset on reconnect', () => {
    const api = identity();
    expect(requireConnectionProtocol(api, {protocol: 13}).keycodesReady).toBe(false);
    const ready = requireConnectionProtocol(api, {protocol: 13, keycodesVersion: 8});
    expect(ready.basicKeyToByte).toBe(v13);
    expect(requireConnectionProtocol(api, {protocol: 13, keycodesVersion: 8})).toBe(ready);
    api.reconnect();
    expect(getConnectionProfile(api).protocol).toBeUndefined();
    expect(requireConnectionProtocol(api, {protocol: 12}).basicKeyToByte).toBe(v12);
  });

  test('legacy lighting aliases are import-only, with protocol-12 bytes', () => {
    const modern = getProtocolProfile({protocol: 13, keycodesVersion: 8});
    expect(modern.basicKeyToByte).not.toHaveProperty('RGB_TOG');
    expect(modern.layoutImportKeycodes?.RGB_TOG).toBe(v12.RGB_TOG);
    expect(modern.layoutImportKeycodes?.RGB_MODE_RGBTEST).toBe(v12.RGB_MODE_RGBTEST);
    expect(modern.layoutImportKeycodes?.UG_TOGG).toBe(v13.UG_TOGG);
    expect(modern.layoutImportKeycodes?.RM_TOGG).toBe(v13.RM_TOGG);
    const legacy = getProtocolProfile({protocol: 12});
    expect(legacy.layoutImportKeycodes).toBe(legacy.basicKeyToByte);
  });
});

describe('State Sync connection selector', () => {
  test.each([CURRENT, LEGACY])('pins capable selector %i until reconnect', async (selected) => {
    const api = identity();
    const calls: number[] = [];
    const query = async (selector: number): Promise<StateSyncQueryResult> => {
      calls.push(selector);
      return selector === selected ? capable : {kind: 'unhandled'};
    };
    await queryConnectionStateSync(api, query, isCapable);
    await queryConnectionStateSync(api, query, isCapable);
    expect(calls).toEqual(selected === CURRENT ? [CURRENT, CURRENT] : [CURRENT, LEGACY, LEGACY]);
    calls.length = 0;
    api.reconnect();
    await queryConnectionStateSync(api, query, isCapable);
    expect(calls).toEqual(selected === CURRENT ? [CURRENT] : [CURRENT, LEGACY]);
  });

  test.each(['timeout', 'malformed', 'non-capable'] as const)('%s never permits fallback or pinning', async (kind) => {
    const api = identity();
    const calls: number[] = [];
    const result: StateSyncQueryResult = kind === 'non-capable'
      ? {kind: 'envelope', envelope: {...capable.envelope, status: ERA_WIRE.STATE_SYNC_STATUS.INVALID}}
      : {kind};
    const query = async (selector: number) => { calls.push(selector); return result; };
    await queryConnectionStateSync(api, query, isCapable);
    await queryConnectionStateSync(api, query, isCapable);
    expect(calls).toEqual([CURRENT, CURRENT]);
    expect(getConnectionProfile(api).stateSyncSelector).toBeUndefined();
  });

  test('a pinned selector does not migrate after later unhandled responses', async () => {
    const api = identity();
    await queryConnectionStateSync(api, async () => capable, isCapable);
    const calls: number[] = [];
    await queryConnectionStateSync(api, async (selector) => {
      calls.push(selector); return {kind: 'unhandled'};
    }, isCapable);
    expect(calls).toEqual([CURRENT]);
  });

  test.each([CURRENT, LEGACY])('stale probe at %i cannot pin a new connection', async (disconnectAt) => {
    const api = identity();
    const calls: number[] = [];
    await queryConnectionStateSync(api, async (selector) => {
      calls.push(selector);
      if (selector === disconnectAt) api.reconnect();
      return selector === CURRENT ? {kind: 'unhandled'} : capable;
    }, isCapable);
    expect(calls).toEqual(disconnectAt === CURRENT ? [CURRENT] : [CURRENT, LEGACY]);
    expect(getConnectionProfile(api).stateSyncSelector).toBeUndefined();
  });

  test('two device paths cannot share selector decisions', async () => {
    const first = identity('first');
    const second = identity('second');
    await queryConnectionStateSync(first, async (selector) =>
      selector === CURRENT ? {kind: 'unhandled'} : capable, isCapable);
    expect(getConnectionProfile(first).stateSyncSelector).toBe(LEGACY);
    expect(getConnectionProfile(second).stateSyncSelector).toBeUndefined();
  });

  test('unhandled must echo every request byte except the command', () => {
    const request = new Array(ERA_WIRE.VIA_REPORT.SIZE).fill(0);
    request[0] = VIA_COMMANDS.id_get_keyboard_value;
    request[1] = CURRENT;
    request[2] = ERA_WIRE.STATE_SYNC.ENVELOPE_VERSION;
    request[5] = 42;
    const echo = Uint8Array.from(request);
    echo[0] = VIA_COMMANDS.id_unhandled;
    expect(isExactUnhandledEcho(request, echo)).toBe(true);
    for (let index = 1; index < echo.length; index++) {
      const wrong = echo.slice();
      wrong[index] ^= 1;
      expect(isExactUnhandledEcho(request, wrong)).toBe(false);
    }
    expect(isExactUnhandledEcho(request, echo.slice(0, -1))).toBe(false);
    expect(isExactUnhandledEcho(request, Uint8Array.from([...echo, 0]))).toBe(false);
    expect(isExactUnhandledEcho(request, Uint8Array.from(request))).toBe(false);
  });
});
