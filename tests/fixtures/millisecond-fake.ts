import type {
  MillisecondAdapter,
  MillisecondCapability,
} from '../../src/utils/millisecond-field';
import {
  ERA_LEGACY_TAPPING_STEP_MS,
  projectLegacyMs,
} from '../../src/utils/millisecond-field';

export class FakeMillisecondDevice implements MillisecondAdapter {
  capability: MillisecondCapability;
  minMs: number;
  maxMs: number;
  legacyStepMs?: number;
  storedMs: number;
  writes: number[] = [];
  writeDelayMs: number;

  constructor(
    capability: MillisecondCapability,
    storedMs = 200,
    options?: {minMs?: number; maxMs?: number; writeDelayMs?: number},
  ) {
    this.capability = capability;
    this.storedMs = storedMs;
    this.minMs = options?.minMs ?? 100;
    this.maxMs = options?.maxMs ?? 500;
    this.writeDelayMs = options?.writeDelayMs ?? 0;
    if (capability === 'legacy') {
      this.legacyStepMs = ERA_LEGACY_TAPPING_STEP_MS;
    }
  }

  async read() {
    return this.storedMs;
  }

  async write(candidateMs: number) {
    this.writes.push(candidateMs);
    if (this.writeDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.writeDelayMs));
    }
    if (this.capability === 'legacy') {
      this.storedMs = projectLegacyMs(
        candidateMs,
        this.minMs,
        this.maxMs,
        this.legacyStepMs ?? ERA_LEGACY_TAPPING_STEP_MS,
      );
    } else {
      this.storedMs = candidateMs;
    }
    return this.storedMs;
  }
}
