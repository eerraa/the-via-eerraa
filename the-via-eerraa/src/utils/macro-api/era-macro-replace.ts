import {ERA_WIRE} from '../era-wire.generated';

export const macroPayloadCRC32 = (data: readonly number[]): number => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

type Transport = {
  probe: () => Promise<number[] | null>;
  set: (bytes: number[]) => Promise<number[]>;
  get: (bytes: number[]) => Promise<number[]>;
};
const u16 = (n: number) => [n >>> 8, n & 0xff];
const u32 = (n: number) => [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

/** True means locally durable, not that a split peer has acknowledged it.
 * False is allowed only before any mutation, on an unsupported capability. */
export async function tryEraMacroReplace(
  transport: Transport,
  data: readonly number[],
): Promise<boolean> {
  const cap = await transport.probe();
  // getOptionalCustomMenuValue retains the value-id at index zero.
  if (!cap || cap[0] !== ERA_WIRE.MACRO_REPLACE.CAPABILITIES ||
      cap[1] !== ERA_WIRE.MACRO_REPLACE_VERSION.CURRENT ||
      cap.slice(5, 9).join(',') !== '69,77,82,49') return false;
  const chunkSize = cap[2];
  const capacity = (cap[3] << 8) | cap[4];
  if (chunkSize !== 17 || data.length > capacity) {
    throw new Error('Invalid ERA macro replacement capacity');
  }
  const token = Array.from(crypto.getRandomValues(new Uint8Array(8)));
  const crc = macroPayloadCRC32(data);
  const send = async (op: number, body: number[] = [], read = false) => {
    const request = [
      ERA_WIRE.CHANNELS_EERRAA.MACRO_REPLACE, op, ...token, ...body,
    ];
    const reply = await (read ? transport.get(request) : transport.set(request));
    if (reply.length !== 32 || request.some((byte, i) => reply[i + 1] !== byte)) {
      throw new Error('ERA macro replacement returned a mismatched operation');
    }
    if (reply[31] !== ERA_WIRE.MACRO_REPLACE_RESULT.OK) {
      throw new Error(`ERA macro replacement rejected: ${reply[31]}`);
    }
    return reply;
  };
  const verifyReceipt = (receipt: number[]) => {
    const committedCRC = ((receipt[24] << 24) | (receipt[25] << 16) |
      (receipt[26] << 8) | receipt[27]) >>> 0;
    const received = (receipt[28] << 8) | (receipt[29]);
    if (receipt[30] !== 2 || received !== data.length || committedCRC !== crc) {
      throw new Error('ERA macro replacement did not return a matching durable receipt');
    }
  };
  let commitAttempted = false;
  try {
    await send(ERA_WIRE.MACRO_REPLACE.BEGIN, [...u16(data.length), ...u32(crc)]);
    // Do not fall back to RESET after BEGIN: that is a different mutation.
    for (let offset = 0; offset < data.length; offset += chunkSize) {
      const chunk = data.slice(offset, offset + chunkSize);
      await send(ERA_WIRE.MACRO_REPLACE.DATA, [...u16(offset), chunk.length, ...chunk]);
    }
    commitAttempted = true;
    const receipt = await send(ERA_WIRE.MACRO_REPLACE.COMMIT);
    verifyReceipt(receipt);
  } catch (error) {
    if (commitAttempted) {
      // A lost COMMIT answer is ambiguous, never permission to RESET. Query
      // this nonce rather than repeating writes or trusting a different job.
      const receipt = await send(ERA_WIRE.MACRO_REPLACE.STATUS, [], true);
      if (receipt[30] === 2) {
        verifyReceipt(receipt);
        return true;
      }
    }
    try {
      await send(ERA_WIRE.MACRO_REPLACE.ABORT);
    } catch (abortError) {
      throw new Error(`${String(error)}; ERA abort failed: ${String(abortError)}`);
    }
    throw error;
  }
  return true;
}
