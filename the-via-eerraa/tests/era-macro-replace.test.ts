import {describe, expect, test} from 'bun:test';
import {macroPayloadCRC32, tryEraMacroReplace} from '../src/utils/macro-api/era-macro-replace';
import {ERA_WIRE as W} from '../src/utils/era-wire.generated';

const capability = () => [W.MACRO_REPLACE.CAPABILITIES, 1, 17, 0x3f, 0xff, 69, 77, 82, 49];
function transport(cap: number[] | null = capability()) {
  const writes: number[][] = [];
  let length = 0;
  let crc: number[] = [];
  let committed = false;
  return {
    writes,
    probe: async () => cap,
    set: async (bytes: number[]) => {
      writes.push(bytes);
      const reply = [7, ...bytes, ...Array(32).fill(0)].slice(0, 32);
      reply[31] = W.MACRO_REPLACE_RESULT.OK;
      if (bytes[1] === W.MACRO_REPLACE.BEGIN) {
        length = (bytes[10] << 8) | bytes[11];
        crc = bytes.slice(12, 16);
      }
      if (bytes[1] === W.MACRO_REPLACE.COMMIT) {
        committed = true;
        reply.splice(24, 4, ...crc);
        reply[28] = length >>> 8; reply[29] = length & 0xff; reply[30] = 2;
      }
      return reply;
    },
    get: async (bytes: number[]) => {
      const reply = [8, ...bytes, ...Array(32).fill(0)].slice(0, 32);
      reply[31] = W.MACRO_REPLACE_RESULT.OK;
      reply.splice(24, 4, ...crc);
      reply[28] = length >>> 8; reply[29] = length & 0xff;
      reply[30] = committed ? 2 : 1;
      return reply;
    },
  };
}
describe('ERA atomic macro replacement', () => {
  test('CRC uses the independent IEEE check vector', () => {
    expect(macroPayloadCRC32(Array.from(new TextEncoder().encode('123456789')))).toBe(0xcbf43926);
    expect(macroPayloadCRC32([])).toBe(0);
  });
  test('unsupported devices are untouched for the caller to use legacy VIA', async () => {
    for (const cap of [null, [1, 1, 17, 63, 255], [1, 2, 17, 63, 255, 69, 77, 82, 49]]) {
      const t = transport(cap);
      expect(await tryEraMacroReplace(t, [1, 2])).toBe(false);
      expect(t.writes).toEqual([]);
    }
  });
  test('BEGIN then contiguous bounded DATA then verified local COMMIT, without RESET', async () => {
    const t = transport();
    const data = Array.from({length: 40}, (_, i) => i);
    expect(await tryEraMacroReplace(t, data)).toBe(true);
    expect(t.writes.map(b => b[1])).toEqual([2, 3, 3, 3, 4]);
    const token = t.writes[0].slice(2, 10);
    expect(token).toHaveLength(8);
    for (const b of t.writes) expect(b.slice(2, 10)).toEqual(token);
    const chunks = t.writes.slice(1, -1);
    expect(chunks.map(b => (b[10] << 8) | b[11])).toEqual([0, 17, 34]);
    expect(chunks.map(b => b[12])).toEqual([17, 17, 6]);
    expect(chunks.flatMap(b => b.slice(13))).toEqual(data);
  });
  test('empty replacement commits once without DATA', async () => {
    const t = transport();
    expect(await tryEraMacroReplace(t, [])).toBe(true);
    expect(t.writes.map(b => b[1])).toEqual([2, 4]);
  });
  test('rejected DATA never sends COMMIT or falls back', async () => {
    const t = transport();
    const set = t.set;
    t.set = async bytes => {
      const reply = await set(bytes);
      if (bytes[1] === 3) reply[31] = W.MACRO_REPLACE_RESULT.INVALID;
      return reply;
    };
    await expect(tryEraMacroReplace(t, [1])).rejects.toThrow('rejected');
    expect(t.writes.map(b => b[1])).toEqual([2, 3, 5]);
  });
  test('wrong CRC receipt cannot be acknowledged as saved', async () => {
    const t = transport();
    const set = t.set;
    t.set = async bytes => {
      const reply = await set(bytes);
      if (bytes[1] === 4) reply[24] ^= 1;
      return reply;
    };
    const get = t.get;
    t.get = async bytes => {
      const reply = await get(bytes);
      reply[24] ^= 1;
      return reply;
    };
    await expect(tryEraMacroReplace(t, [1])).rejects.toThrow('matching durable receipt');
  });
  test('lost COMMIT answer recovers only from the same durable STATUS, without another write', async () => {
    const t = transport();
    const set = t.set;
    t.set = async bytes => {
      const reply = await set(bytes);
      if (bytes[1] === W.MACRO_REPLACE.COMMIT) throw new Error('USB answer lost');
      return reply;
    };
    expect(await tryEraMacroReplace(t, [1])).toBe(true);
    expect(t.writes.map(b => b[1])).toEqual([2, 3, 4]);
  });
  test('foreign receipt is never treated as this operation completing', async () => {
    const t = transport();
    const set = t.set, get = t.get;
    t.set = async bytes => {
      const reply = await set(bytes);
      if (bytes[1] === W.MACRO_REPLACE.COMMIT) reply[3] ^= 1;
      return reply;
    };
    t.get = async bytes => {
      const reply = await get(bytes); reply[3] ^= 1; return reply;
    };
    await expect(tryEraMacroReplace(t, [1])).rejects.toThrow('mismatched operation');
  });
  test('failed cleanup is reported, never hidden by legacy fallback', async () => {
    const t = transport();
    const set = t.set;
    t.set = async bytes => {
      if (bytes[1] === W.MACRO_REPLACE.DATA || bytes[1] === W.MACRO_REPLACE.ABORT) {
        throw new Error('USB disconnected');
      }
      return set(bytes);
    };
    await expect(tryEraMacroReplace(t, [1])).rejects.toThrow('ERA abort failed');
  });
});
