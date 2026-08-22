import type {MillisecondAdapter} from '../../src/utils/millisecond-field';

export class FakeMillisecondDevice implements MillisecondAdapter {
  minMs: number;
  maxMs: number;
  storedMs: number;
  writes: number[] = [];
  writeDelayMs: number;

  constructor(
    storedMs = 200,
    options?: {minMs?: number; maxMs?: number; writeDelayMs?: number},
  ) {
    this.storedMs = storedMs;
    this.minMs = options?.minMs ?? 100;
    this.maxMs = options?.maxMs ?? 500;
    this.writeDelayMs = options?.writeDelayMs ?? 0;
  }

  async write(candidateMs: number) {
    this.writes.push(candidateMs);
    if (this.writeDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.writeDelayMs));
    }
    this.storedMs = candidateMs;
    return this.storedMs;
  }
}
