import {HIDTransportTimeoutError} from '../shims/node-hid';
import type {KeyboardAPI} from './keyboard-api';

export const ERA_USB_DIAGNOSTICS_PROTOCOL_VERSION = 0x01;
export const ERA_USB_DIAGNOSTICS_SELECTOR = 0x07;
export const ERA_USB_DIAGNOSTICS_PACKET_SIZE = 32;

export const ERA_USB_DIAGNOSTICS_COMMAND_GET = 0x02;
export const ERA_USB_DIAGNOSTICS_COMMAND_SET = 0x03;

export const ERA_USB_DIAGNOSTICS_OPERATION_CAPABILITIES = 0x00;
export const ERA_USB_DIAGNOSTICS_OPERATION_SNAPSHOT = 0x01;
export const ERA_USB_DIAGNOSTICS_OPERATION_START = 0x10;
export const ERA_USB_DIAGNOSTICS_OPERATION_STOP = 0x11;
export const ERA_USB_DIAGNOSTICS_OPERATION_CLEAR = 0x12;

export const ERA_USB_DIAGNOSTICS_STATUS_OK = 0x00;
export const ERA_USB_DIAGNOSTICS_STATUS_UNSUPPORTED_VERSION = 0x01;
export const ERA_USB_DIAGNOSTICS_STATUS_INVALID = 0x02;
export const ERA_USB_DIAGNOSTICS_STATUS_BUSY = 0x03;
export const ERA_USB_DIAGNOSTICS_STATUS_NO_SESSION = 0x04;
export const ERA_USB_DIAGNOSTICS_STATUS_STALE_SNAPSHOT = 0x05;

export const ERA_USB_DIAGNOSTICS_CAP_REPORT_TIMING = 0x01;
export const ERA_USB_DIAGNOSTICS_CAP_HISTOGRAM = 0x02;
export const ERA_USB_DIAGNOSTICS_CAP_FIRMWARE_TIMING = 0x04;
export const ERA_USB_DIAGNOSTICS_CAP_EVENT_TIMELINE = 0x08;
export const ERA_USB_DIAGNOSTICS_CAP_BOOT_COUNTERS = 0x10;
export const ERA_USB_DIAGNOSTICS_REQUIRED_CAPABILITIES = 0x1f;

export const ERA_USB_DIAGNOSTICS_HISTOGRAM_BUCKETS = 8;
export const ERA_USB_DIAGNOSTICS_TIMELINE_CAPACITY = 8;
export const ERA_USB_DIAGNOSTICS_BASE_CHUNKS = 8;
export const ERA_USB_DIAGNOSTICS_MAX_CHUNKS = 12;

export const ERA_USB_DIAGNOSTICS_DURATION_MASK = 0x07;
export const ERA_USB_DIAGNOSTICS_DURATIONS = [10, 30, 60] as const;

export type UsbDiagnosticsDuration =
  (typeof ERA_USB_DIAGNOSTICS_DURATIONS)[number];
export type UsbDiagnosticsSessionState = 0 | 1 | 2 | 3;
export type UsbDiagnosticsPollingMode = 0 | 1 | 2 | 3;
export type UsbDiagnosticsSpeed = 0 | 1 | 2;

export type UsbDiagnosticsHardCounters = {
  reportDrops: number;
  usbResets: number;
  configurations: number;
  suspends: number;
  speedChanges: number;
};

export type UsbDiagnosticsEvent = {
  type: number;
  relativeMs: number;
  value: number;
};

export type UsbDiagnosticsCapabilities = {
  protocolVersion: number;
  sessionState: UsbDiagnosticsSessionState;
  sessionId: number;
  flags: number;
  durations: UsbDiagnosticsDuration[];
  histogramBuckets: number;
  timelineCapacity: number;
  recommendedSnapshotMs: number;
  endianness: 'big';
  timeUnit: 'microseconds';
  firmwareVersion: string;
};

export type UsbDiagnosticsControlResponse = {
  state: UsbDiagnosticsSessionState;
  sessionId: number;
  durationSeconds?: UsbDiagnosticsDuration;
  pollingMode?: UsbDiagnosticsPollingMode;
  expectedIntervalUs?: number;
};

export type UsbDiagnosticsSnapshot = {
  protocolVersion: number;
  state: UsbDiagnosticsSessionState;
  sessionId: number;
  sequence: number;
  pollingMode: UsbDiagnosticsPollingMode;
  speed: UsbDiagnosticsSpeed;
  durationSeconds: UsbDiagnosticsDuration;
  elapsedMs: number;
  expectedIntervalUs: number;
  reportSamples: number;
  latencyMinUs: number;
  latencyAverageUs: number;
  latencyMaxUs: number;
  intervalLatencyMaxUs: number;
  queueDepthPeak: number;
  histogram: number[];
  loopSamples: number;
  loopGapMaxUs: number;
  intervalLoopGapMaxUs: number;
  loopStallCount: number;
  loopStallThresholdUs: number;
  bootCounters: UsbDiagnosticsHardCounters;
  sessionCounters: UsbDiagnosticsHardCounters;
  timelineOverwrites: number;
  events: UsbDiagnosticsEvent[];
};

export type UsbDiagnosticsFailureKind =
  'unhandled' | 'timeout' | 'disconnected' | 'malformed' | 'status' | 'stale';

export type UsbDiagnosticsResult<T> =
  | {kind: 'ok'; value: T}
  | {
      kind: UsbDiagnosticsFailureKind;
      status?: number;
    };

type DiagnosticsHeader = {
  command: number;
  operation: number;
  status: number;
  state: UsbDiagnosticsSessionState;
  sessionId: number;
  sequence: number;
  chunkIndex: number;
  chunkCount: number;
  bytes: Uint8Array;
};

const tags = new Map<string, number>();

const nextTag = (path: string) => {
  const next = ((tags.get(path) ?? 0) + 1) & 0xffff;
  const tag = next === 0 ? 1 : next;
  tags.set(path, tag);
  return tag;
};

export const resetUsbDiagnosticsTagsForTesting = () => tags.clear();

const be16 = (bytes: number[] | Uint8Array, offset: number) =>
  (bytes[offset] << 8) | bytes[offset + 1];

const be32 = (bytes: number[] | Uint8Array, offset: number) =>
  ((bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]) >>>
  0;

const bytesAreZero = (
  bytes: number[] | Uint8Array,
  first: number,
  end = bytes.length,
) => {
  for (let index = first; index < end; index++) {
    if (bytes[index] !== 0) {
      return false;
    }
  }
  return true;
};

const isState = (value: number): value is UsbDiagnosticsSessionState =>
  value >= 0 && value <= 3;

const isPollingMode = (value: number): value is UsbDiagnosticsPollingMode =>
  value >= 0 && value <= 3;

const isSpeed = (value: number): value is UsbDiagnosticsSpeed =>
  value >= 0 && value <= 2;

export const isUsbDiagnosticsDuration = (
  value: number,
): value is UsbDiagnosticsDuration =>
  ERA_USB_DIAGNOSTICS_DURATIONS.some((duration) => duration === value);

export const encodeUsbDiagnosticsRequest = ({
  command,
  operation,
  tag,
  argument = 0,
  sequence = 0,
}: {
  command: number;
  operation: number;
  tag: number;
  argument?: number;
  sequence?: number;
}) => {
  const bytes = new Array(ERA_USB_DIAGNOSTICS_PACKET_SIZE).fill(0);
  bytes[0] = command;
  bytes[1] = ERA_USB_DIAGNOSTICS_SELECTOR;
  bytes[2] = ERA_USB_DIAGNOSTICS_PROTOCOL_VERSION;
  bytes[3] = operation;
  bytes[4] = (tag >> 8) & 0xff;
  bytes[5] = tag & 0xff;
  bytes[6] = argument;
  bytes[7] = (sequence >> 8) & 0xff;
  bytes[8] = sequence & 0xff;
  return bytes;
};

const parseHeader = (
  bytes: Uint8Array,
  expectedCommand: number,
  expectedOperation: number,
  expectedTag: number,
): DiagnosticsHeader | null => {
  if (
    bytes.length !== ERA_USB_DIAGNOSTICS_PACKET_SIZE ||
    bytes[0] !== expectedCommand ||
    bytes[1] !== ERA_USB_DIAGNOSTICS_SELECTOR ||
    bytes[2] !== ERA_USB_DIAGNOSTICS_PROTOCOL_VERSION ||
    bytes[3] !== expectedOperation ||
    be16(bytes, 4) !== expectedTag ||
    !isState(bytes[7]) ||
    bytes[6] > ERA_USB_DIAGNOSTICS_STATUS_STALE_SNAPSHOT
  ) {
    return null;
  }
  return {
    command: bytes[0],
    operation: bytes[3],
    status: bytes[6],
    state: bytes[7],
    sessionId: be16(bytes, 8),
    sequence: be16(bytes, 10),
    chunkIndex: bytes[12],
    chunkCount: bytes[13],
    bytes,
  };
};

const statusResult = <T>(status: number): UsbDiagnosticsResult<T> =>
  status === ERA_USB_DIAGNOSTICS_STATUS_STALE_SNAPSHOT
    ? {kind: 'stale', status}
    : {kind: 'status', status};

const exchange = async (
  api: KeyboardAPI,
  command: number,
  operation: number,
  argument = 0,
  sequence = 0,
): Promise<UsbDiagnosticsResult<DiagnosticsHeader>> => {
  const generation = api.getConnectionGeneration();
  const tag = nextTag(api.kbAddr);
  const request = encodeUsbDiagnosticsRequest({
    command,
    operation,
    tag,
    argument,
    sequence,
  });
  const report = [0, ...request];

  try {
    const response = (await api
      .getHID()
      .exchange(
        report,
        (message: Uint8Array) =>
          message.length === ERA_USB_DIAGNOSTICS_PACKET_SIZE &&
          (message[0] === command || message[0] === 0xff) &&
          message[1] === ERA_USB_DIAGNOSTICS_SELECTOR &&
          be16(message, 4) === tag,
        {timeoutBehavior: 'preserve-generation'},
      )) as Uint8Array;

    if (!api.isConnectionGenerationCurrent(generation)) {
      return {kind: 'disconnected'};
    }
    if (response[0] === 0xff) {
      return {kind: 'unhandled'};
    }
    const header = parseHeader(response, command, operation, tag);
    if (!header) {
      return {kind: 'malformed'};
    }
    if (header.status !== ERA_USB_DIAGNOSTICS_STATUS_OK) {
      return statusResult(header.status);
    }
    return {kind: 'ok', value: header};
  } catch (error) {
    if (!api.isConnectionGenerationCurrent(generation)) {
      return {kind: 'disconnected'};
    }
    if (error instanceof HIDTransportTimeoutError) {
      return {kind: 'timeout'};
    }
    return {kind: 'malformed'};
  }
};

export const parseUsbDiagnosticsCapabilities = (
  header: DiagnosticsHeader,
): UsbDiagnosticsCapabilities | null => {
  const bytes = header.bytes;
  const flags = bytes[14];
  const durationMask = bytes[15];
  const firmwareVersionLength = bytes[22];

  if (
    header.operation !== ERA_USB_DIAGNOSTICS_OPERATION_CAPABILITIES ||
    header.sequence !== 0 ||
    header.chunkIndex !== 0 ||
    header.chunkCount !== 0 ||
    (flags & ERA_USB_DIAGNOSTICS_REQUIRED_CAPABILITIES) !==
      ERA_USB_DIAGNOSTICS_REQUIRED_CAPABILITIES ||
    (durationMask & ~ERA_USB_DIAGNOSTICS_DURATION_MASK) !== 0 ||
    bytes[16] !== ERA_USB_DIAGNOSTICS_HISTOGRAM_BUCKETS ||
    bytes[17] !== ERA_USB_DIAGNOSTICS_TIMELINE_CAPACITY ||
    be16(bytes, 18) === 0 ||
    bytes[20] !== 1 ||
    bytes[21] !== 1 ||
    firmwareVersionLength === 0 ||
    firmwareVersionLength > 9 ||
    !bytesAreZero(bytes, 23 + firmwareVersionLength)
  ) {
    return null;
  }

  const firmwareBytes = bytes.slice(23, 23 + firmwareVersionLength);
  if (Array.from(firmwareBytes).some((value) => value < 0x20 || value > 0x7e)) {
    return null;
  }

  return {
    protocolVersion: ERA_USB_DIAGNOSTICS_PROTOCOL_VERSION,
    sessionState: header.state,
    sessionId: header.sessionId,
    flags,
    durations: ERA_USB_DIAGNOSTICS_DURATIONS.filter(
      (_, index) => (durationMask & (1 << index)) !== 0,
    ),
    histogramBuckets: bytes[16],
    timelineCapacity: bytes[17],
    recommendedSnapshotMs: be16(bytes, 18),
    endianness: 'big',
    timeUnit: 'microseconds',
    firmwareVersion: String.fromCharCode(...firmwareBytes),
  };
};

export const getUsbDiagnosticsCapabilities = async (
  api: KeyboardAPI,
): Promise<UsbDiagnosticsResult<UsbDiagnosticsCapabilities>> => {
  const response = await exchange(
    api,
    ERA_USB_DIAGNOSTICS_COMMAND_GET,
    ERA_USB_DIAGNOSTICS_OPERATION_CAPABILITIES,
  );
  if (response.kind !== 'ok') {
    return response;
  }
  const capabilities = parseUsbDiagnosticsCapabilities(response.value);
  return capabilities ? {kind: 'ok', value: capabilities} : {kind: 'malformed'};
};

const parseControlResponse = (
  header: DiagnosticsHeader,
  operation: number,
): UsbDiagnosticsControlResponse | null => {
  if (
    header.operation !== operation ||
    header.sequence !== 0 ||
    header.chunkIndex !== 0 ||
    header.chunkCount !== 0
  ) {
    return null;
  }

  if (operation === ERA_USB_DIAGNOSTICS_OPERATION_START) {
    const durationSeconds = header.bytes[14];
    const pollingMode = header.bytes[15];
    if (
      !isUsbDiagnosticsDuration(durationSeconds) ||
      !isPollingMode(pollingMode) ||
      be32(header.bytes, 16) === 0 ||
      !bytesAreZero(header.bytes, 20)
    ) {
      return null;
    }
    return {
      state: header.state,
      sessionId: header.sessionId,
      durationSeconds,
      pollingMode,
      expectedIntervalUs: be32(header.bytes, 16),
    };
  }

  if (!bytesAreZero(header.bytes, 14)) {
    return null;
  }
  return {state: header.state, sessionId: header.sessionId};
};

const runControlOperation = async (
  api: KeyboardAPI,
  operation: number,
  argument = 0,
): Promise<UsbDiagnosticsResult<UsbDiagnosticsControlResponse>> => {
  const response = await exchange(
    api,
    ERA_USB_DIAGNOSTICS_COMMAND_SET,
    operation,
    argument,
  );
  if (response.kind !== 'ok') {
    return response;
  }
  const parsed = parseControlResponse(response.value, operation);
  return parsed ? {kind: 'ok', value: parsed} : {kind: 'malformed'};
};

export const startUsbDiagnostics = (
  api: KeyboardAPI,
  duration: UsbDiagnosticsDuration,
) => runControlOperation(api, ERA_USB_DIAGNOSTICS_OPERATION_START, duration);

export const stopUsbDiagnostics = (api: KeyboardAPI) =>
  runControlOperation(api, ERA_USB_DIAGNOSTICS_OPERATION_STOP);

export const clearUsbDiagnostics = (api: KeyboardAPI) =>
  runControlOperation(api, ERA_USB_DIAGNOSTICS_OPERATION_CLEAR);

const validSnapshotReservedBytes = (chunk: number, bytes: Uint8Array) => {
  switch (chunk) {
    case 0:
    case 1:
    case 4:
      return true;
    case 2:
    case 3:
    case 5:
    case 6:
      return bytesAreZero(bytes, 30);
    case 7:
      return bytesAreZero(bytes, 26);
    default:
      return true;
  }
};

const parseSnapshotChunks = (
  headers: DiagnosticsHeader[],
): UsbDiagnosticsSnapshot | null => {
  if (headers.length < ERA_USB_DIAGNOSTICS_BASE_CHUNKS) {
    return null;
  }
  const first = headers[0];
  const bytes0 = first.bytes;
  const pollingMode = bytes0[14];
  const speed = bytes0[15];
  const durationSeconds = bytes0[16];
  const eventCount = bytes0[17];
  const expectedChunkCount =
    ERA_USB_DIAGNOSTICS_BASE_CHUNKS + Math.ceil(eventCount / 2);

  if (
    first.state === 0 ||
    first.sessionId === 0 ||
    first.sequence === 0 ||
    !isPollingMode(pollingMode) ||
    !isSpeed(speed) ||
    !isUsbDiagnosticsDuration(durationSeconds) ||
    eventCount > ERA_USB_DIAGNOSTICS_TIMELINE_CAPACITY ||
    bytes0[30] !== ERA_USB_DIAGNOSTICS_HISTOGRAM_BUCKETS ||
    bytes0[31] !== ERA_USB_DIAGNOSTICS_TIMELINE_CAPACITY ||
    first.chunkCount !== expectedChunkCount ||
    headers.length !== expectedChunkCount
  ) {
    return null;
  }

  for (let chunk = 0; chunk < headers.length; chunk++) {
    const header = headers[chunk];
    if (
      header.operation !== ERA_USB_DIAGNOSTICS_OPERATION_SNAPSHOT ||
      header.state !== first.state ||
      header.sessionId !== first.sessionId ||
      header.sequence !== first.sequence ||
      header.chunkIndex !== chunk ||
      header.chunkCount !== expectedChunkCount ||
      !validSnapshotReservedBytes(chunk, header.bytes)
    ) {
      return null;
    }
  }

  const histogram = [2, 3].flatMap((chunk) =>
    [0, 1, 2, 3].map((index) => be32(headers[chunk].bytes, 14 + index * 4)),
  );
  const events: UsbDiagnosticsEvent[] = [];
  for (let index = 0; index < eventCount; index++) {
    const chunk = ERA_USB_DIAGNOSTICS_BASE_CHUNKS + Math.floor(index / 2);
    const offset = 14 + (index % 2) * 9;
    const bytes = headers[chunk].bytes;
    const type = bytes[offset];
    if (type < 1 || type > 6) {
      return null;
    }
    events.push({
      type,
      relativeMs: be32(bytes, offset + 1),
      value: be32(bytes, offset + 5),
    });
  }
  if (eventCount % 2 !== 0) {
    const last = headers[headers.length - 1].bytes;
    if (!bytesAreZero(last, 23)) {
      return null;
    }
  }

  const bytes1 = headers[1].bytes;
  const bytes4 = headers[4].bytes;
  const bytes5 = headers[5].bytes;
  const bytes6 = headers[6].bytes;
  const bytes7 = headers[7].bytes;

  return {
    protocolVersion: ERA_USB_DIAGNOSTICS_PROTOCOL_VERSION,
    state: first.state,
    sessionId: first.sessionId,
    sequence: first.sequence,
    pollingMode,
    speed,
    durationSeconds,
    elapsedMs: be32(bytes0, 18),
    expectedIntervalUs: be32(bytes0, 22),
    reportSamples: be32(bytes0, 26),
    latencyMinUs: be32(bytes1, 14),
    latencyAverageUs: be32(bytes1, 18),
    latencyMaxUs: be32(bytes1, 22),
    intervalLatencyMaxUs: be32(bytes1, 26),
    queueDepthPeak: be16(bytes1, 30),
    histogram,
    loopSamples: be32(bytes4, 14),
    loopGapMaxUs: be32(bytes4, 18),
    intervalLoopGapMaxUs: be32(bytes4, 22),
    loopStallCount: be32(bytes4, 26),
    loopStallThresholdUs: be16(bytes4, 30),
    bootCounters: {
      reportDrops: be32(bytes5, 14),
      usbResets: be32(bytes5, 18),
      configurations: be32(bytes5, 22),
      suspends: be32(bytes5, 26),
      speedChanges: be32(bytes6, 14),
    },
    sessionCounters: {
      reportDrops: be32(bytes6, 18),
      usbResets: be32(bytes6, 22),
      configurations: be32(bytes6, 26),
      suspends: be32(bytes7, 14),
      speedChanges: be32(bytes7, 18),
    },
    timelineOverwrites: be32(bytes7, 22),
    events,
  };
};

export const getUsbDiagnosticsSnapshot = async (
  api: KeyboardAPI,
): Promise<UsbDiagnosticsResult<UsbDiagnosticsSnapshot>> => {
  const first = await exchange(
    api,
    ERA_USB_DIAGNOSTICS_COMMAND_GET,
    ERA_USB_DIAGNOSTICS_OPERATION_SNAPSHOT,
  );
  if (first.kind !== 'ok') {
    return first;
  }
  if (
    first.value.chunkIndex !== 0 ||
    first.value.sequence === 0 ||
    first.value.chunkCount < ERA_USB_DIAGNOSTICS_BASE_CHUNKS ||
    first.value.chunkCount > ERA_USB_DIAGNOSTICS_MAX_CHUNKS
  ) {
    return {kind: 'malformed'};
  }

  const headers = [first.value];
  for (let chunk = 1; chunk < first.value.chunkCount; chunk++) {
    const response = await exchange(
      api,
      ERA_USB_DIAGNOSTICS_COMMAND_GET,
      ERA_USB_DIAGNOSTICS_OPERATION_SNAPSHOT,
      chunk,
      first.value.sequence,
    );
    if (response.kind !== 'ok') {
      return response;
    }
    headers.push(response.value);
  }

  const snapshot = parseSnapshotChunks(headers);
  return snapshot ? {kind: 'ok', value: snapshot} : {kind: 'malformed'};
};

export const usbDiagnosticsPollingModeLabel = (
  mode: UsbDiagnosticsPollingMode,
) => ['FS 1K', 'HS 2K', 'HS 4K', 'HS 8K'][mode];

export const usbDiagnosticsSpeedLabel = (speed: UsbDiagnosticsSpeed) =>
  ['Unknown', 'Full Speed', 'High Speed'][speed];

export const usbDiagnosticsStateLabel = (state: UsbDiagnosticsSessionState) =>
  ['Idle', 'Running', 'Complete', 'Stopped'][state];

// The firmware normalizes every latency bucket against the interval of the polling
// mode that was selected when the session started, not against the interval the link
// actually enumerated with. FS 1K always enumerates at Full Speed and HS 2K/4K/8K
// always enumerate at High Speed, so a differing negotiated speed means the reported
// multipliers do not describe the selected polling rate.
export const usbDiagnosticsExpectedSpeed = (
  mode: UsbDiagnosticsPollingMode,
): Exclude<UsbDiagnosticsSpeed, 0> => (mode === 0 ? 1 : 2);

export const isUsbDiagnosticsSpeedConsistent = (
  mode: UsbDiagnosticsPollingMode,
  speed: UsbDiagnosticsSpeed,
) => speed === 0 || speed === usbDiagnosticsExpectedSpeed(mode);
