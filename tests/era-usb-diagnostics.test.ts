import {describe, expect, test} from 'bun:test';
import {HIDTransportTimeoutError} from '../src/shims/node-hid';
import type {KeyboardAPI} from '../src/utils/keyboard-api';
import {
  clearUsbDiagnostics,
  encodeUsbDiagnosticsRequest,
  ERA_USB_DIAGNOSTICS_COMMAND_GET,
  ERA_USB_DIAGNOSTICS_COMMAND_SET,
  ERA_USB_DIAGNOSTICS_OPERATION_CAPABILITIES,
  ERA_USB_DIAGNOSTICS_OPERATION_SNAPSHOT,
  ERA_USB_DIAGNOSTICS_OPERATION_START,
  ERA_USB_DIAGNOSTICS_PROTOCOL_VERSION,
  ERA_USB_DIAGNOSTICS_SELECTOR,
  ERA_USB_DIAGNOSTICS_STATUS_STALE_SNAPSHOT,
  ERA_USB_DIAGNOSTICS_STATUS_UNSUPPORTED_VERSION,
  getUsbDiagnosticsCapabilities,
  getUsbDiagnosticsSnapshot,
  isUsbDiagnosticsSpeedConsistent,
  resetUsbDiagnosticsTagsForTesting,
  startUsbDiagnostics,
  usbDiagnosticsExpectedSpeed,
} from '../src/utils/era-usb-diagnostics';
import {
  setEraAdvancedMetadataForTesting,
  shouldProbeUsbDiagnostics,
} from '../src/utils/era-advanced-metadata';

const putBe16 = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = (value >> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
};

const putBe32 = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
};

const responseHeader = (
  request: Uint8Array,
  {
    status = 0,
    state = 0,
    sessionId = 0,
  }: {status?: number; state?: number; sessionId?: number} = {},
) => {
  const response = new Uint8Array(32);
  response[0] = request[0];
  response[1] = ERA_USB_DIAGNOSTICS_SELECTOR;
  response[2] = ERA_USB_DIAGNOSTICS_PROTOCOL_VERSION;
  response[3] = request[3];
  response[4] = request[4];
  response[5] = request[5];
  response[6] = status;
  response[7] = state;
  putBe16(response, 8, sessionId);
  return response;
};

const capabilityResponse = (request: Uint8Array) => {
  const response = responseHeader(request);
  response[14] = 0x1f;
  response[15] = 0x07;
  response[16] = 8;
  response[17] = 8;
  putBe16(response, 18, 1000);
  response[20] = 1;
  response[21] = 1;
  response[22] = 9;
  'V260823R2'
    .split('')
    .forEach(
      (character, index) => (response[23 + index] = character.charCodeAt(0)),
    );
  return response;
};

const snapshotResponse = (request: Uint8Array) => {
  const chunk = request[6];
  const response = responseHeader(request, {state: 1, sessionId: 0x77});
  putBe16(response, 10, 0x1234);
  response[12] = chunk;
  response[13] = 9;
  const offset = 14;

  switch (chunk) {
    case 0:
      response[offset] = 3;
      response[offset + 1] = 2;
      response[offset + 2] = 30;
      response[offset + 3] = 2;
      putBe32(response, offset + 4, 5000);
      putBe32(response, offset + 8, 125);
      putBe32(response, offset + 12, 100);
      response[offset + 16] = 8;
      response[offset + 17] = 8;
      break;
    case 1:
      putBe32(response, offset, 40);
      putBe32(response, offset + 4, 100);
      putBe32(response, offset + 8, 900);
      putBe32(response, offset + 12, 600);
      putBe16(response, offset + 16, 3);
      break;
    case 2:
    case 3:
      [1, 2, 3, chunk === 2 ? 4 : 72].forEach((value, index) =>
        putBe32(response, offset + index * 4, value),
      );
      break;
    case 4:
      putBe32(response, offset, 4000);
      putBe32(response, offset + 4, 2800);
      putBe32(response, offset + 8, 1400);
      putBe32(response, offset + 12, 2);
      putBe16(response, offset + 16, 1000);
      break;
    case 5:
      [9, 8, 7, 6].forEach((value, index) =>
        putBe32(response, offset + index * 4, value),
      );
      break;
    case 6:
      [5, 1, 2, 3].forEach((value, index) =>
        putBe32(response, offset + index * 4, value),
      );
      break;
    case 7:
      putBe32(response, offset, 4);
      putBe32(response, offset + 4, 5);
      putBe32(response, offset + 8, 6);
      break;
    case 8:
      response[offset] = 1;
      putBe32(response, offset + 1, 2000);
      putBe32(response, offset + 5, 1);
      response[offset + 9] = 6;
      putBe32(response, offset + 10, 3000);
      putBe32(response, offset + 14, 2800);
      break;
  }
  return response;
};

type FakeTransport = {
  exchange: (
    report: number[],
    matcher: (response: Uint8Array) => boolean,
  ) => Promise<Uint8Array>;
};

const fakeApi = (
  handler: (request: Uint8Array, call: number) => Uint8Array | Error,
) => {
  let call = 0;
  let generation = 1;
  let inFlight = 0;
  let maximumInFlight = 0;
  const transport: FakeTransport = {
    exchange: async (report, matcher) => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await Promise.resolve();
      const result = handler(new Uint8Array(report.slice(1)), call++);
      inFlight -= 1;
      if (result instanceof Error) {
        throw result;
      }
      if (!matcher(result)) {
        throw new Error('Fixture did not match the request tag.');
      }
      return result;
    },
  };
  const api = {
    kbAddr: 'diagnostics-fixture',
    getHID: () => transport,
    getConnectionGeneration: () => generation,
    isConnectionGenerationCurrent: (expected: number) =>
      generation === expected,
  } as unknown as KeyboardAPI;
  return {
    api,
    disconnect: () => {
      generation += 1;
    },
    maximumInFlight: () => maximumInFlight,
  };
};

describe('ERA USB diagnostics v1 transport', () => {
  test('encodes the exact tagged big-endian request with clean reserved bytes', () => {
    const request = encodeUsbDiagnosticsRequest({
      command: ERA_USB_DIAGNOSTICS_COMMAND_GET,
      operation: ERA_USB_DIAGNOSTICS_OPERATION_SNAPSHOT,
      tag: 0xabcd,
      argument: 3,
      sequence: 0x1234,
    });
    expect(request).toHaveLength(32);
    expect(request.slice(0, 9)).toEqual([
      0x02, 0x07, 0x01, 0x01, 0xab, 0xcd, 0x03, 0x12, 0x34,
    ]);
    expect(request.slice(9)).toEqual(new Array(23).fill(0));
  });

  test('negotiates capabilities, duration bits, units and firmware identity', async () => {
    resetUsbDiagnosticsTagsForTesting();
    const fixture = fakeApi((request) => capabilityResponse(request));
    const result = await getUsbDiagnosticsCapabilities(fixture.api);
    expect(result).toEqual({
      kind: 'ok',
      value: {
        protocolVersion: 1,
        sessionState: 0,
        sessionId: 0,
        flags: 0x1f,
        durations: [10, 30, 60],
        histogramBuckets: 8,
        timelineCapacity: 8,
        recommendedSnapshotMs: 1000,
        endianness: 'big',
        timeUnit: 'microseconds',
        firmwareVersion: 'V260823R2',
      },
    });
  });

  test('reads every frozen snapshot chunk sequentially and decodes all fields', async () => {
    const requests: Uint8Array[] = [];
    const fixture = fakeApi((request) => {
      requests.push(request);
      return snapshotResponse(request);
    });
    const result = await getUsbDiagnosticsSnapshot(fixture.api);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(requests).toHaveLength(9);
    expect(requests.map((request) => request[6])).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(requests.slice(1).every((request) => request[7] === 0x12)).toBe(
      true,
    );
    expect(requests.slice(1).every((request) => request[8] === 0x34)).toBe(
      true,
    );
    expect(fixture.maximumInFlight()).toBe(1);
    expect(result.value).toMatchObject({
      state: 1,
      sessionId: 0x77,
      sequence: 0x1234,
      pollingMode: 3,
      speed: 2,
      durationSeconds: 30,
      elapsedMs: 5000,
      expectedIntervalUs: 125,
      reportSamples: 100,
      latencyMinUs: 40,
      latencyAverageUs: 100,
      latencyMaxUs: 900,
      queueDepthPeak: 3,
      loopGapMaxUs: 2800,
      loopStallCount: 2,
      timelineOverwrites: 6,
    });
    expect(result.value.histogram).toEqual([1, 2, 3, 4, 1, 2, 3, 72]);
    expect(result.value.bootCounters).toEqual({
      reportDrops: 9,
      usbResets: 8,
      configurations: 7,
      suspends: 6,
      speedChanges: 5,
    });
    expect(result.value.sessionCounters).toEqual({
      reportDrops: 1,
      usbResets: 2,
      configurations: 3,
      suspends: 4,
      speedChanges: 5,
    });
    expect(result.value.events).toEqual([
      {type: 1, relativeMs: 2000, value: 1},
      {type: 6, relativeMs: 3000, value: 2800},
    ]);
  });

  test('rejects dirty reserved bytes, changed snapshot identity and stale chunks', async () => {
    const dirty = fakeApi((request) => {
      const response = capabilityResponse(request);
      response[31] = 1;
      return response;
    });
    expect(await getUsbDiagnosticsCapabilities(dirty.api)).toEqual({
      kind: 'malformed',
    });

    const changedSession = fakeApi((request) => {
      const response = snapshotResponse(request);
      if (request[6] === 4) putBe16(response, 8, 0x78);
      return response;
    });
    expect(await getUsbDiagnosticsSnapshot(changedSession.api)).toEqual({
      kind: 'malformed',
    });

    const stale = fakeApi((request) => {
      if (request[6] === 2) {
        return responseHeader(request, {
          status: ERA_USB_DIAGNOSTICS_STATUS_STALE_SNAPSHOT,
          state: 1,
          sessionId: 0x77,
        });
      }
      return snapshotResponse(request);
    });
    expect(await getUsbDiagnosticsSnapshot(stale.api)).toEqual({
      kind: 'stale',
      status: ERA_USB_DIAGNOSTICS_STATUS_STALE_SNAPSHOT,
    });
  });

  test('handles unhandled, unsupported, timeout, and disconnect without poisoning ordinary flow', async () => {
    const unhandled = fakeApi((request) => {
      const response = responseHeader(request);
      response[0] = 0xff;
      return response;
    });
    expect(await getUsbDiagnosticsCapabilities(unhandled.api)).toEqual({
      kind: 'unhandled',
    });

    const unsupported = fakeApi((request) =>
      responseHeader(request, {
        status: ERA_USB_DIAGNOSTICS_STATUS_UNSUPPORTED_VERSION,
      }),
    );
    expect(await getUsbDiagnosticsCapabilities(unsupported.api)).toEqual({
      kind: 'status',
      status: ERA_USB_DIAGNOSTICS_STATUS_UNSUPPORTED_VERSION,
    });

    const timeout = fakeApi(() => new HIDTransportTimeoutError('timeout'));
    expect(await getUsbDiagnosticsCapabilities(timeout.api)).toEqual({
      kind: 'timeout',
    });

    const disconnected = fakeApi(() => {
      disconnected.disconnect();
      return new Error('disconnected');
    });
    expect(await getUsbDiagnosticsCapabilities(disconnected.api)).toEqual({
      kind: 'disconnected',
    });
  });

  test('uses SET only for session controls and validates the echoed start payload', async () => {
    const commands: number[] = [];
    const fixture = fakeApi((request) => {
      commands.push(request[0]);
      const response = responseHeader(request, {state: 1, sessionId: 12});
      response[14] = request[6];
      response[15] = 0;
      putBe32(response, 16, 1000);
      return response;
    });
    const result = await startUsbDiagnostics(fixture.api, 30);
    expect(result).toEqual({
      kind: 'ok',
      value: {
        state: 1,
        sessionId: 12,
        durationSeconds: 30,
        pollingMode: 0,
        expectedIntervalUs: 1000,
      },
    });
    expect(commands).toEqual([ERA_USB_DIAGNOSTICS_COMMAND_SET]);

    const clearFixture = fakeApi((request) => responseHeader(request));
    expect(await clearUsbDiagnostics(clearFixture.api)).toEqual({
      kind: 'ok',
      value: {state: 0, sessionId: 0},
    });
  });
});

describe('USB diagnostics definition gate', () => {
  test('probes only an explicitly opted-in ERA definition', () => {
    setEraAdvancedMetadataForTesting({
      schemaVersion: 2,
      definitions: [
        {
          id: 'may65-h7s',
          vendorProductId: 0x45520030,
          stateSync: true,
          usbDiagnostics: true,
          exactMsFamily: 'h7s',
        },
      ],
    });
    expect(shouldProbeUsbDiagnostics('era', 0x45520030)).toBe(true);
    expect(shouldProbeUsbDiagnostics('official', 0x45520030)).toBe(false);
    expect(shouldProbeUsbDiagnostics('upload', 0x45520030)).toBe(false);
    expect(shouldProbeUsbDiagnostics('era', 0x45520031)).toBe(false);
    expect(shouldProbeUsbDiagnostics(null, 0x45520030)).toBe(false);
    setEraAdvancedMetadataForTesting(null);
  });
});

describe('USB diagnostics normalization basis', () => {
  test('FS 1K is only consistent with Full Speed and HS modes only with High Speed', () => {
    expect(usbDiagnosticsExpectedSpeed(0)).toBe(1);
    expect(usbDiagnosticsExpectedSpeed(1)).toBe(2);
    expect(usbDiagnosticsExpectedSpeed(2)).toBe(2);
    expect(usbDiagnosticsExpectedSpeed(3)).toBe(2);

    expect(isUsbDiagnosticsSpeedConsistent(0, 1)).toBe(true);
    expect(isUsbDiagnosticsSpeedConsistent(3, 2)).toBe(true);
    expect(isUsbDiagnosticsSpeedConsistent(3, 1)).toBe(false);
    expect(isUsbDiagnosticsSpeedConsistent(0, 2)).toBe(false);
  });

  test('an unknown negotiated speed is not reported as a mismatch', () => {
    expect(isUsbDiagnosticsSpeedConsistent(0, 0)).toBe(true);
    expect(isUsbDiagnosticsSpeedConsistent(3, 0)).toBe(true);
  });
});
