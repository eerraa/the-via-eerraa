import {getBasicKeyDict} from './key-to-byte/dictionary-store';
import v12Keycodes from './key-to-byte/v12';
import {ERA_WIRE, ERA_WIRE_VIA_PROTOCOL_VERSION, VIA_COMMANDS} from './era-wire.generated';
import type {KeyboardAPI} from './keyboard-api';
import type {StateSyncQueryResult} from './era-state-sync';

export type KeycodeDictionary = Record<string, number>;
type ProtocolFacts = {protocol: number; keycodesVersion?: number};

// Import-only aliases retain the original bytes. Never expose these names to
// the live picker or to macro encoding as RGB Matrix aliases.
export const getLayoutImportKeycodes = (
  protocol: number,
  basicKeyToByte: KeycodeDictionary,
): KeycodeDictionary =>
  protocol < ERA_WIRE_VIA_PROTOCOL_VERSION
    ? basicKeyToByte
    : {
        ...basicKeyToByte,
        ...Object.fromEntries([
          'RGB_TOG', 'RGB_MOD', 'RGB_RMOD', 'RGB_HUI', 'RGB_HUD',
          'RGB_SAI', 'RGB_SAD', 'RGB_VAI', 'RGB_VAD', 'RGB_SPI',
          'RGB_SPD', 'RGB_M_P', 'RGB_M_B', 'RGB_M_R', 'RGB_M_SW',
          'RGB_M_SN', 'RGB_M_K', 'RGB_M_X', 'RGB_M_G', 'RGB_MODE_RGBTEST',
        ].map((code) => [code, v12Keycodes[code as keyof typeof v12Keycodes]])),
      };

export const getProtocolProfile = ({protocol, keycodesVersion}: ProtocolFacts) => {
  const keycodesReady =
    protocol < ERA_WIRE_VIA_PROTOCOL_VERSION || keycodesVersion !== undefined;
  const basicKeyToByte = keycodesReady
    ? getBasicKeyDict(protocol, keycodesVersion)
    : undefined;
  return {
    protocolVersion: protocol,
    keycodesVersion,
    keycodesReady,
    basicKeyToByte,
    layoutImportKeycodes: basicKeyToByte
      ? getLayoutImportKeycodes(protocol, basicKeyToByte)
      : undefined,
    macroEncoding: protocol >= 11 ? 'v11' as const : 'legacy' as const,
  };
};

type ConnectionIdentity = Pick<
  KeyboardAPI,
  'kbAddr' | 'getConnectionGeneration' | 'isConnectionGenerationCurrent'
>;
type ConnectionProfile = {
  generation: number;
  protocol?: ReturnType<typeof getProtocolProfile>;
  stateSyncSelector?: number;
};
const connections = new Map<string, ConnectionProfile>();

export const getConnectionProfile = (
  api: ConnectionIdentity,
  facts?: ProtocolFacts,
): ConnectionProfile => {
  const generation = api.getConnectionGeneration();
  let profile = connections.get(api.kbAddr);
  if (!profile || profile.generation !== generation) {
    profile = {generation};
    connections.set(api.kbAddr, profile);
  }
  if (facts && (profile.protocol?.protocolVersion !== facts.protocol ||
      profile.protocol?.keycodesVersion !== facts.keycodesVersion)) {
    profile.protocol = getProtocolProfile(facts);
  }
  return profile;
};

export const requireConnectionProtocol = (
  api: ConnectionIdentity,
  facts: ProtocolFacts,
) => getConnectionProfile(api, facts).protocol!;

export const requireKeycodeDictionary = (
  profile: ReturnType<typeof getProtocolProfile>,
): KeycodeDictionary => {
  if (!profile.basicKeyToByte) {
    throw new Error(`VIA protocol ${profile.protocolVersion} requires a QMK keycodes version`);
  }
  return profile.basicKeyToByte;
};

export const isExactUnhandledEcho = (
  request: readonly number[],
  response: Uint8Array,
) =>
  response.length === request.length &&
  response[0] === VIA_COMMANDS.id_unhandled &&
  request.slice(1).every((value, index) => response[index + 1] === value);

export async function queryConnectionStateSync(
  api: ConnectionIdentity,
  query: (selector: number) => Promise<StateSyncQueryResult>,
  isCapable: (result: StateSyncQueryResult) => boolean,
): Promise<StateSyncQueryResult> {
  const profile = getConnectionProfile(api);
  if (profile.stateSyncSelector !== undefined) {
    return query(profile.stateSyncSelector);
  }
  let selector: number = ERA_WIRE.STATE_SYNC_SELECTORS.CURRENT;
  let result = await query(selector);
  if (!api.isConnectionGenerationCurrent(profile.generation)) {
    return {kind: 'malformed'};
  }
  // query classifies unhandled only after the entire request echo matches.
  // No timeout, malformed response or non-capable envelope permits fallback.
  if (result.kind === 'unhandled') {
    selector = ERA_WIRE.STATE_SYNC_SELECTORS.LEGACY;
    result = await query(selector);
  }
  if (api.isConnectionGenerationCurrent(profile.generation) && isCapable(result)) {
    profile.stateSyncSelector = selector;
  }
  return result;
}

export const resetConnectionProfilesForTesting = () => connections.clear();
