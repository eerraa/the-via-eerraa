import {createAction} from '@reduxjs/toolkit';
import type {Layer} from '../types/types';
import type {RawKeycodeSequence} from '../utils/macro-api/types';

type StableCandidateContext = {
  devicePath: string;
  connectionGeneration: number;
  revision: number;
};

export type StateSyncEncoderMap = Record<number, [number, number][]>;

export type StateSyncKeymapCandidate = {
  layers: Layer[];
  encoders: StateSyncEncoderMap;
};

export type StateSyncMacroCandidate = {
  ast: RawKeycodeSequence[];
  macroBufferSize: number;
  macroCount: number;
  isFeatureSupported: boolean;
};

export type StateSyncCustomMenuData = Record<string, number[] | number[][]>;

export type StateSyncConfigCandidate = {
  layoutOptions?: number[];
  menuData?: StateSyncCustomMenuData;
};

export const commitStableKeymapCandidate = createAction<
  StableCandidateContext & {candidate: StateSyncKeymapCandidate}
>('stateSync/commitStableKeymapCandidate');

export const commitStableMacroCandidate = createAction<
  StableCandidateContext & {candidate: StateSyncMacroCandidate}
>('stateSync/commitStableMacroCandidate');

export const commitStableConfigCandidate = createAction<
  StableCandidateContext & {candidate: StateSyncConfigCandidate}
>('stateSync/commitStableConfigCandidate');

export const invalidateStateSyncDomain = createAction<{
  devicePath: string;
  connectionGeneration: number;
  domain: 'keymap' | 'macro' | 'config';
}>('stateSync/invalidateDomain');
