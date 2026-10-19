import {getByteToKey} from '../key';
import {getProtocolProfile, requireKeycodeDictionary} from '../connection-profile';
import type {KeyboardAPI} from '../keyboard-api';
import {MacroAPI} from './macro-api';
import {MacroAPIV11} from './macro-api.v11';

export const getMacroAPI = (
  protocol: number,
  keycodesVersion: number | undefined,
  keyboardApi: KeyboardAPI,
) => {
  // Byte conversion depends only on protocol facts, never on a live connection.
  const profile = getProtocolProfile({protocol, keycodesVersion});
  const basicKeyToByte = requireKeycodeDictionary(profile);
  const byteToKey = getByteToKey(basicKeyToByte);
  return profile.macroEncoding === 'v11'
    ? new MacroAPIV11(keyboardApi, basicKeyToByte, byteToKey)
    : new MacroAPI(keyboardApi, basicKeyToByte, byteToKey);
};

export const isDelaySupported = (protocol: number) => protocol >= 11;
