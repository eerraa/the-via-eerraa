import type {
  AuthorizedDevice,
  ConnectedDevice,
  WebVIADevice,
} from '../types/types';

const DEFAULT_RESPONSE_TIMEOUT_MS = 5000;
const MAX_DIAGNOSTIC_REPORTS = 32;

type ResponseMatcher = (message: Uint8Array) => boolean;
type HIDExchangeOptions = {
  timeoutBehavior?: 'poison-generation' | 'preserve-generation';
};
type UnsolicitedReportHandler = {
  generation: number;
  matches: ResponseMatcher;
  handle: (message: Uint8Array) => void;
};
type PendingResponse = {
  generation: number;
  matches: ResponseMatcher;
  resolve: (message: Uint8Array) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};
type DiagnosticReport = {
  generation: number;
  receivedAt: number;
  message: Uint8Array;
};
type CommandQueueEntry = {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};
type TransportState = {
  path: string;
  device: HIDDevice;
  generation: number;
  poisoned: boolean;
  disconnected: boolean;
  hasOpened: boolean;
  openPromise?: Promise<void>;
  listener?: (event: HIDInputReportEvent) => void;
  listenerGeneration?: number;
  handlers: UnsolicitedReportHandler[];
  pending?: PendingResponse;
  commandQueue: CommandQueueEntry[];
  isFlushing: boolean;
  activeCancel?: (error: Error) => void;
  lastWriteTimestamp: number;
  diagnostics: DiagnosticReport[];
};
export type HIDTransportGenerationChange = {
  path: string;
  generation: number;
  reason: string;
};

export class HIDTransportError extends Error {}
export class HIDTransportTimeoutError extends HIDTransportError {}
export class HIDTransportGenerationError extends HIDTransportError {}

const transportStates = new Map<string, TransportState>();
const generationChangeListeners = new Set<
  (change: HIDTransportGenerationChange) => void
>();
let responseTimeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS;
let now = () => Date.now();
let lifecycleNavigator: HID | undefined;

const filterHIDDevices = (devices: HIDDevice[]) =>
  devices.filter((device) =>
    device.collections?.some(
      (collection) =>
        collection.usage === 0x61 && collection.usagePage === 0xff60,
    ),
  );

export const QMK_CONSOLE_FILTER = {
  usagePage: 0xff31,
  usage: 0x74,
};

export const isQMKConsoleDevice = (device: HIDDevice) =>
  device.collections?.some(
    (collection) =>
      collection.usage === QMK_CONSOLE_FILTER.usage &&
      collection.usagePage === QMK_CONSOLE_FILTER.usagePage,
  ) ?? false;

const getVIAPathIdentifier = () =>
  globalThis.crypto?.randomUUID?.() || `via-path:${Math.random()}`;

const makeTransportError = (path: string, reason: string) =>
  new HIDTransportGenerationError(`HID transport ${path} ${reason}`);

const removeInputListener = (state: TransportState) => {
  if (state.listener) {
    state.device.removeEventListener('inputreport', state.listener);
    state.listener = undefined;
    state.listenerGeneration = undefined;
  }
};

const rejectTransportWork = (state: TransportState, error: Error) => {
  if (state.pending) {
    const pending = state.pending;
    state.pending = undefined;
    clearTimeout(pending.timeoutId);
    pending.reject(error);
  } else {
    state.activeCancel?.(error);
  }
  state.activeCancel = undefined;
  state.commandQueue.splice(0).forEach((entry) => entry.reject(error));
};

const replaceGeneration = (
  state: TransportState,
  reason: string,
  options: {poisoned: boolean; disconnected: boolean},
  error = makeTransportError(state.path, reason),
) => {
  removeInputListener(state);
  rejectTransportWork(state, error);
  state.handlers = [];
  state.generation += 1;
  state.poisoned = options.poisoned;
  state.disconnected = options.disconnected;
  state.openPromise = undefined;
  state.lastWriteTimestamp = 0;
  state.diagnostics = [];
  generationChangeListeners.forEach((listener) => {
    try {
      listener({path: state.path, generation: state.generation, reason});
    } catch (listenerError) {
      console.warn('HID generation listener failed', listenerError);
    }
  });
};

const recordDiagnostic = (state: TransportState, message: Uint8Array) => {
  state.diagnostics.push({
    generation: state.generation,
    receivedAt: now(),
    message: message.slice(),
  });
  if (state.diagnostics.length > MAX_DIAGNOSTIC_REPORTS) {
    state.diagnostics.splice(
      0,
      state.diagnostics.length - MAX_DIAGNOSTIC_REPORTS,
    );
  }
};

const safelyMatches = (matcher: ResponseMatcher, message: Uint8Array) => {
  try {
    return matcher(message);
  } catch (error) {
    console.warn('Input report matcher failed', error);
    return false;
  }
};

const routeInputReport = (
  state: TransportState,
  listenerGeneration: number,
  event: HIDInputReportEvent,
) => {
  if (
    state.generation !== listenerGeneration ||
    state.listenerGeneration !== listenerGeneration ||
    state.poisoned ||
    state.disconnected
  ) {
    return;
  }

  const message = new Uint8Array(
    event.data.buffer,
    event.data.byteOffset,
    event.data.byteLength,
  ).slice();

  const handler = state.handlers.find(
    (candidate) =>
      candidate.generation === listenerGeneration &&
      safelyMatches(candidate.matches, message),
  );
  if (handler) {
    try {
      handler.handle(message);
    } catch (error) {
      console.warn('Input report handler failed', error);
    }
    return;
  }

  const pending = state.pending;
  if (
    pending &&
    pending.generation === listenerGeneration &&
    safelyMatches(pending.matches, message)
  ) {
    state.pending = undefined;
    clearTimeout(pending.timeoutId);
    pending.resolve(message);
    return;
  }

  recordDiagnostic(state, message);
};

const installInputListener = (state: TransportState, generation: number) => {
  if (
    state.listener &&
    state.listenerGeneration === generation &&
    state.device.opened
  ) {
    return;
  }

  removeInputListener(state);
  const listener = (event: HIDInputReportEvent) =>
    routeInputReport(state, generation, event);
  state.listener = listener;
  state.listenerGeneration = generation;
  state.device.addEventListener('inputreport', listener);
};

const createTransportState = (
  path: string,
  device: HIDDevice,
): TransportState => ({
  path,
  device,
  generation: 1,
  poisoned: false,
  disconnected: false,
  hasOpened: device.opened,
  handlers: [],
  commandQueue: [],
  isFlushing: false,
  lastWriteTimestamp: 0,
  diagnostics: [],
});

const bindTransportDevice = (path: string, device: HIDDevice) => {
  const existing = transportStates.get(path);
  if (!existing) {
    const state = createTransportState(path, device);
    transportStates.set(path, state);
    if (device.opened) {
      installInputListener(state, state.generation);
    }
    return state;
  }

  if (existing.device !== device) {
    replaceGeneration(existing, 'was replaced', {
      poisoned: false,
      disconnected: false,
    });
    existing.device = device;
    existing.hasOpened = device.opened;
  } else if (existing.disconnected) {
    replaceGeneration(existing, 'reconnected', {
      poisoned: false,
      disconnected: false,
    });
  }

  if (device.opened && !existing.poisoned) {
    installInputListener(existing, existing.generation);
  }
  return existing;
};

const tagDevice = (device: HIDDevice): WebVIADevice => {
  // WebHID has no stable physical path, so retain VIA's per-object identifier.
  const path = (device as any).__path || getVIAPathIdentifier();
  (device as any).__path = path;
  const hidDevice = {
    _device: device,
    usage: 0x61,
    usagePage: 0xff60,
    interface: 0x0001,
    vendorId: device.vendorId ?? -1,
    productId: device.productId ?? -1,
    path,
    productName: device.productName,
  };
  ExtendedHID._cache[path] = hidDevice;
  bindTransportDevice(path, device);
  return hidDevice;
};

const handleConnect = ({device}: HIDConnectionEvent) => {
  if (filterHIDDevices([device]).length) {
    tagDevice(device);
  }
};

const handleDisconnect = ({device}: HIDConnectionEvent) => {
  const path = (device as any).__path as string | undefined;
  const state = path ? transportStates.get(path) : undefined;
  if (!state || state.device !== device) {
    return;
  }
  replaceGeneration(state, 'disconnected', {
    poisoned: false,
    disconnected: true,
  });
};

const ensureLifecycleListeners = () => {
  if (typeof navigator === 'undefined' || !navigator.hid) {
    return;
  }
  if (lifecycleNavigator === navigator.hid) {
    return;
  }
  lifecycleNavigator?.removeEventListener('connect', handleConnect);
  lifecycleNavigator?.removeEventListener('disconnect', handleDisconnect);
  lifecycleNavigator = navigator.hid;
  lifecycleNavigator.addEventListener('connect', handleConnect);
  lifecycleNavigator.addEventListener('disconnect', handleDisconnect);
};

const enqueueTransportTask = <T>(
  state: TransportState,
  run: () => Promise<T>,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    if (state.poisoned) {
      reject(makeTransportError(state.path, 'is poisoned'));
      return;
    }
    if (state.disconnected) {
      reject(makeTransportError(state.path, 'is disconnected'));
      return;
    }
    state.commandQueue.push({
      run,
      resolve: (value) => resolve(value as T),
      reject,
    });
    void flushTransportQueue(state);
  });

const flushTransportQueue = async (state: TransportState) => {
  if (state.isFlushing) {
    return;
  }
  state.isFlushing = true;
  try {
    while (state.commandQueue.length) {
      const entry = state.commandQueue.shift() as CommandQueueEntry;
      if (state.poisoned || state.disconnected) {
        entry.reject(makeTransportError(state.path, 'is unavailable'));
        continue;
      }
      try {
        entry.resolve(await entry.run());
      } catch (error) {
        entry.reject(
          error instanceof Error ? error : new HIDTransportError(String(error)),
        );
      }
    }
  } finally {
    state.isFlushing = false;
  }
};

const ExtendedHID = {
  _cache: {} as {[key: string]: WebVIADevice},
  requestDevice: async () => {
    ensureLifecycleListeners();
    const requestedDevice = await navigator.hid.requestDevice({
      filters: [
        {
          usagePage: 0xff60,
          usage: 0x61,
        },
        QMK_CONSOLE_FILTER,
      ],
    });
    const viaDevices = filterHIDDevices(requestedDevice);
    viaDevices.forEach(tagDevice);
    return viaDevices[0];
  },
  getFilteredDevices: async () => {
    ensureLifecycleListeners();
    try {
      return filterHIDDevices(await navigator.hid.getDevices());
    } catch (e) {
      return [];
    }
  },
  devices: async (requestAuthorize = false) => {
    let devices = await ExtendedHID.getFilteredDevices();
    // Avoid repeatedly opening the authorization popup.
    if (devices.length === 0 || requestAuthorize) {
      try {
        await ExtendedHID.requestDevice();
      } catch (e) {
        return [];
      }
      devices = await ExtendedHID.getFilteredDevices();
    }
    return devices.map(tagDevice);
  },
  HID: class HID {
    _hidDevice: WebVIADevice;
    interface: number;
    vendorId: number;
    productId: number;
    productName: string;
    path: string;
    openPromise: Promise<void>;

    constructor(path: string) {
      const hidDevice = ExtendedHID._cache[path];
      if (!hidDevice) {
        throw new Error('Missing hid device in cache');
      }
      this._hidDevice = hidDevice;
      this.vendorId = hidDevice.vendorId;
      this.productId = hidDevice.productId;
      this.path = hidDevice.path;
      this.interface = hidDevice.interface;
      this.productName = hidDevice.productName;
      bindTransportDevice(path, hidDevice._device);
      this.openPromise = this.open();
    }

    private get state() {
      const state = transportStates.get(this.path);
      if (!state) {
        throw new HIDTransportGenerationError(
          `HID transport ${this.path} does not exist`,
        );
      }
      return state;
    }

    async open() {
      let state = this.state;
      if (state.poisoned) {
        throw makeTransportError(state.path, 'is poisoned');
      }
      if (state.disconnected) {
        throw makeTransportError(state.path, 'is disconnected');
      }
      if (state.device.opened) {
        state.hasOpened = true;
        installInputListener(state, state.generation);
        return;
      }
      if (state.openPromise) {
        return state.openPromise;
      }
      if (state.hasOpened) {
        replaceGeneration(state, 'was reopened', {
          poisoned: false,
          disconnected: false,
        });
        state = this.state;
      }

      const generation = state.generation;
      const openPromise = (async () => {
        await state.device.open();
        if (
          state.generation !== generation ||
          state.poisoned ||
          state.disconnected
        ) {
          throw makeTransportError(state.path, 'changed while opening');
        }
        state.hasOpened = true;
        installInputListener(state, generation);
      })();
      state.openPromise = openPromise;
      try {
        await openPromise;
      } finally {
        if (state.openPromise === openPromise) {
          state.openPromise = undefined;
        }
      }
    }

    getConnectionGeneration() {
      return this.state.generation;
    }

    isConnectionGenerationCurrent(generation: number) {
      const state = this.state;
      return (
        state.generation === generation &&
        !state.poisoned &&
        !state.disconnected
      );
    }

    addInputReportHandler(
      matches: ResponseMatcher,
      handle: (message: Uint8Array) => void,
    ) {
      const state = this.state;
      const registration = {
        generation: state.generation,
        matches,
        handle,
      };
      state.handlers.push(registration);
      return () => {
        state.handlers = state.handlers.filter(
          (candidate) => candidate !== registration,
        );
      };
    }

    async exchange(
      report: number[],
      matches: ResponseMatcher,
      options?: HIDExchangeOptions,
    ): Promise<Uint8Array> {
      const state = this.state;
      return enqueueTransportTask(state, async () => {
        await this.open();
        const generation = state.generation;
        if (!this.isConnectionGenerationCurrent(generation)) {
          throw makeTransportError(state.path, 'changed before write');
        }

        const responsePromise = new Promise<Uint8Array>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            if (
              state.pending?.generation !== generation ||
              state.generation !== generation
            ) {
              return;
            }
            const error = new HIDTransportTimeoutError(
              `HID response timed out for ${state.path}`,
            );
            if (options?.timeoutBehavior === 'preserve-generation') {
              const pending = state.pending;
              state.pending = undefined;
              pending.reject(error);
              return;
            }
            replaceGeneration(
              state,
              'timed out',
              {
                poisoned: true,
                disconnected: false,
              },
              error,
            );
          }, responseTimeoutMs);
          state.pending = {generation, matches, resolve, reject, timeoutId};
        });
        void responsePromise.catch(() => undefined);

        try {
          const data = new Uint8Array(report.slice(1));
          state.lastWriteTimestamp = now();
          const sendFailure = state.device.sendReport(0, data).then(
            () => new Promise<never>(() => undefined),
            (error) => {
              if (state.generation === generation && !state.poisoned) {
                replaceGeneration(
                  state,
                  'failed during write',
                  {poisoned: true, disconnected: false},
                  error instanceof Error
                    ? error
                    : new HIDTransportError(String(error)),
                );
              }
              throw error;
            },
          );
          return await Promise.race([responsePromise, sendFailure]);
        } catch (error) {
          const preservesTimedOutGeneration =
            options?.timeoutBehavior === 'preserve-generation' &&
            error instanceof HIDTransportTimeoutError;
          if (
            !preservesTimedOutGeneration &&
            state.generation === generation &&
            !state.poisoned
          ) {
            replaceGeneration(state, 'failed during request', {
              poisoned: true,
              disconnected: false,
            });
          }
          throw error;
        }
      });
    }

    async enqueueDelay(time: number) {
      const state = this.state;
      return enqueueTransportTask(
        state,
        () =>
          new Promise<void>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              state.activeCancel = undefined;
              resolve();
            }, time);
            state.activeCancel = (error) => {
              clearTimeout(timeoutId);
              reject(error);
            };
          }),
      );
    }

    isCommandQueueIdle() {
      const state = this.state;
      return !state.isFlushing && state.commandQueue.length === 0;
    }

    async waitForCommandQueueIdle() {
      if (!this.isCommandQueueIdle()) {
        await this.enqueueDelay(0);
      }
    }
  },
};

export const tryForgetDevice = async (
  device: ConnectedDevice | AuthorizedDevice,
) => {
  const cachedDevice = ExtendedHID._cache[device.path];
  if (!cachedDevice) {
    return;
  }
  try {
    await cachedDevice._device.forget();
  } finally {
    const state = transportStates.get(device.path);
    if (state) {
      replaceGeneration(state, 'was forgotten', {
        poisoned: false,
        disconnected: true,
      });
    }
    delete ExtendedHID._cache[device.path];
  }
};

export const configureHIDTransport = (options: {
  responseTimeoutMs?: number;
  now?: () => number;
}) => {
  if (options.responseTimeoutMs !== undefined) {
    responseTimeoutMs = options.responseTimeoutMs;
  }
  if (options.now) {
    now = options.now;
  }
};

export const addHIDTransportGenerationListener = (
  listener: (change: HIDTransportGenerationChange) => void,
) => {
  generationChangeListeners.add(listener);
  return () => generationChangeListeners.delete(listener);
};

export const getHIDTransportDebugState = (path: string) => {
  const state = transportStates.get(path);
  return (
    state && {
      generation: state.generation,
      poisoned: state.poisoned,
      disconnected: state.disconnected,
      listenerInstalled: Boolean(state.listener),
      listenerGeneration: state.listenerGeneration,
      handlerCount: state.handlers.length,
      hasPendingResponse: Boolean(state.pending),
      commandQueueDepth: state.commandQueue.length,
      isFlushing: state.isFlushing,
      lastWriteTimestamp: state.lastWriteTimestamp,
      diagnosticCount: state.diagnostics.length,
      diagnostics: state.diagnostics.map((report) => ({
        ...report,
        message: report.message.slice(),
      })),
    }
  );
};

export const registerHIDDeviceForTesting = (
  path: string,
  device: HIDDevice,
) => {
  (device as any).__path = path;
  return tagDevice(device);
};

export const disconnectHIDDeviceForTesting = (path: string) => {
  const state = transportStates.get(path);
  if (state) {
    replaceGeneration(state, 'disconnected', {
      poisoned: false,
      disconnected: true,
    });
  }
};

export const resetHIDTransportForTesting = () => {
  transportStates.forEach((state) => {
    removeInputListener(state);
    rejectTransportWork(state, makeTransportError(state.path, 'was reset'));
  });
  transportStates.clear();
  generationChangeListeners.clear();
  Object.keys(ExtendedHID._cache).forEach(
    (path) => delete ExtendedHID._cache[path],
  );
  responseTimeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS;
  now = () => Date.now();
};

export const HID = ExtendedHID;
