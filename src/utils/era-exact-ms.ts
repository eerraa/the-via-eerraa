import type {MillisecondAdapter} from './millisecond-field';
import {
  DEFAULT_TAPPING_TERM_BOUNDS,
  ERA_LEGACY_TAPPING_STEP_MS,
} from './millisecond-field';
import type {ExactMsFamily} from './era-advanced-metadata';
import type {KeyboardAPI} from './keyboard-api';
import {shiftFrom16Bit, shiftTo16Bit} from './keyboard-api';

export const ERA_EXACT_GLOBAL_CHANNEL = 15;
export const ERA_EXACT_GLOBAL_ID = 5;

export const isExactTermCommand = (name: string) =>
  name === 'id_qmk_tapping_global_term_exact' ||
  /^id_qmk_tapdance_[1-8]_term_exact$/.test(name);

export const isLegacyTermCommand = (name: string) =>
  name === 'id_qmk_tapping_global_term' ||
  /^id_qmk_tapdance_[1-8]_term$/.test(name);

export const exactTapDanceAddress = (family: ExactMsFamily, slot: number) => {
  if (family === 'h7s') {
    return {channel: 16, id: 41 + slot};
  }
  return {channel: 0, id: 72 + slot};
};

const customValueBytes = async (
  api: KeyboardAPI,
  channel: number,
  id: number,
) => {
  const raw = await api.getCustomMenuValue([channel, id]);
  return raw.slice(1);
};

export const createExactTermAdapter = (
  api: KeyboardAPI,
  channel: number,
  id: number,
): MillisecondAdapter => ({
  capability: 'exact',
  minMs: DEFAULT_TAPPING_TERM_BOUNDS.minMs,
  maxMs: DEFAULT_TAPPING_TERM_BOUNDS.maxMs,
  async read() {
    const bytes = await customValueBytes(api, channel, id);
    return shiftTo16Bit([bytes[0] ?? 0, bytes[1] ?? 0]);
  },
  async write(candidateMs: number) {
    await api.setCustomMenuValue(channel, id, ...shiftFrom16Bit(candidateMs));
    return this.read();
  },
});

export const createLegacyTermAdapter = (
  api: KeyboardAPI,
  channel: number,
  id: number,
): MillisecondAdapter => ({
  capability: 'legacy',
  minMs: DEFAULT_TAPPING_TERM_BOUNDS.minMs,
  maxMs: DEFAULT_TAPPING_TERM_BOUNDS.maxMs,
  legacyStepMs: ERA_LEGACY_TAPPING_STEP_MS,
  async read() {
    const bytes = await customValueBytes(api, channel, id);
    return (bytes[0] ?? 0) * 10;
  },
  async write(candidateMs: number) {
    await api.setCustomMenuValue(channel, id, Math.floor(candidateMs / 10));
    return this.read();
  },
});
