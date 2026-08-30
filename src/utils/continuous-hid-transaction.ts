import {KeyboardAPI} from './keyboard-api';

export type ContinuousHIDResult =
  {status: 'saved'} | {status: 'failed'; error: Error};

type ContinuousHIDConfig = {
  key: string;
  path: string;
  generation: number;
  onStarted?: () => void;
  save: (api: KeyboardAPI, saveKey: string) => Promise<void>;
  onInterrupted?: (error: Error) => void;
  onSettled?: (result: ContinuousHIDResult) => void | Promise<void>;
};

type ContinuousHIDUpdate = {
  dedupeKey: string;
  execute: (api: KeyboardAPI) => Promise<Iterable<string>>;
};

type PendingUpdate = ContinuousHIDUpdate & {
  resolve: () => void;
  reject: (error: Error) => void;
};

type ContinuousHIDEntry = {
  config: ContinuousHIDConfig;
  api: KeyboardAPI;
  owner: symbol;
  pending: PendingUpdate[];
  saveKeys: Set<string>;
  lastAcceptedDedupeKey: string | null;
  completing: boolean;
  forcedError?: Error;
  wake?: () => void;
  done: Promise<void>;
};

const entries = new Map<string, ContinuousHIDEntry>();

const entryId = ({
  key,
  path,
  generation,
}: Pick<ContinuousHIDConfig, 'key' | 'path' | 'generation'>) =>
  `${path}\u0000${generation}\u0000${key}`;

const toError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

const wakeEntry = (entry: ContinuousHIDEntry) => {
  const wake = entry.wake;
  entry.wake = undefined;
  wake?.();
};

const waitForEntryWork = (entry: ContinuousHIDEntry) =>
  new Promise<void>((resolve) => {
    entry.wake = resolve;
  });

const runEntry = async (entry: ContinuousHIDEntry) => {
  let result: ContinuousHIDResult = {status: 'saved'};
  try {
    await entry.api.withPathReservation(
      entry.config.generation,
      entry.owner,
      async (reservedApi) => {
        while (true) {
          if (entry.forcedError) {
            throw entry.forcedError;
          }
          const update = entry.pending.shift();
          if (update) {
            try {
              const saveKeys = await update.execute(reservedApi);
              for (const saveKey of saveKeys) {
                entry.saveKeys.add(saveKey);
              }
              update.resolve();
            } catch (error) {
              const failure = toError(error);
              update.reject(failure);
              throw failure;
            }
            continue;
          }
          if (entry.completing) {
            for (const saveKey of entry.saveKeys) {
              await entry.config.save(reservedApi, saveKey);
            }
            return;
          }
          await waitForEntryWork(entry);
        }
      },
    );
  } catch (error) {
    const failure = toError(error);
    result = {status: 'failed', error: failure};
    entry.pending.splice(0).forEach((update) => update.reject(failure));
  } finally {
    try {
      await entry.config.onSettled?.(result);
    } catch (error) {
      console.warn('Continuous HID reconciliation failed', error);
    }
    const id = entryId(entry.config);
    if (entries.get(id) === entry) {
      entries.delete(id);
    }
  }
  if (result.status === 'failed') {
    throw result.error;
  }
};

const createEntry = (config: ContinuousHIDConfig) => {
  const entry: ContinuousHIDEntry = {
    config,
    api: new KeyboardAPI(config.path),
    owner: Symbol(`continuous:${config.key}`),
    pending: [],
    saveKeys: new Set(),
    lastAcceptedDedupeKey: null,
    completing: false,
    done: Promise.resolve(),
  };
  const id = entryId(config);
  // Register before advancing the mutation epoch so a synchronous Redux render
  // can keep the control mounted while the first reserved packet is queued.
  entries.set(id, entry);
  try {
    config.onStarted?.();
  } catch (error) {
    entries.delete(id);
    throw error;
  }
  entry.done = runEntry(entry);
  void entry.done.catch(() => undefined);
  return entry;
};

export const hasContinuousHIDTransaction = (
  key: string,
  path: string,
  generation: number,
) => {
  const entry = entries.get(entryId({key, path, generation}));
  return (
    entry?.config.path === path &&
    entry.config.generation === generation &&
    !entry.completing &&
    !entry.forcedError
  );
};

export const hasContinuousHIDTransactionsForPath = (
  path: string,
  generation: number,
) =>
  Array.from(entries.values()).some(
    (entry) =>
      entry.config.path === path && entry.config.generation === generation,
  );

export const enqueueContinuousHIDUpdate = (
  config: ContinuousHIDConfig,
  update: ContinuousHIDUpdate,
) => {
  const id = entryId(config);
  const entry = entries.get(id) ?? createEntry(config);
  if (
    entry.config.path !== config.path ||
    entry.config.generation !== config.generation ||
    entry.completing ||
    entry.forcedError
  ) {
    return Promise.reject(
      new Error('Continuous HID transaction context is no longer active'),
    );
  }
  if (entry.lastAcceptedDedupeKey === update.dedupeKey) {
    return Promise.resolve();
  }
  entry.lastAcceptedDedupeKey = update.dedupeKey;
  const completion = new Promise<void>((resolve, reject) => {
    entry.pending.push({...update, resolve, reject});
  });
  wakeEntry(entry);
  return completion;
};

export const completeContinuousHIDTransaction = async (key: string) => {
  const matching = Array.from(entries.values()).filter(
    (entry) => entry.config.key === key,
  );
  if (!matching.length) {
    return;
  }
  matching.forEach((entry) => {
    entry.completing = true;
    wakeEntry(entry);
  });
  const results = await Promise.allSettled(matching.map((entry) => entry.done));
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failure) {
    throw failure.reason;
  }
};

export const completeContinuousHIDTransactionsForPath = async (
  path: string,
  generation?: number,
) => {
  const matching = Array.from(entries.values()).filter(
    (entry) =>
      entry.config.path === path &&
      (generation === undefined || entry.config.generation === generation),
  );
  matching.forEach((entry) => {
    entry.completing = true;
    wakeEntry(entry);
  });
  await Promise.allSettled(matching.map((entry) => entry.done));
};

export const failContinuousHIDTransactionsForPath = (
  path: string,
  currentGeneration: number,
  reason: string,
) => {
  Array.from(entries.values())
    .filter(
      (entry) =>
        entry.config.path === path &&
        entry.config.generation !== currentGeneration,
    )
    .forEach((entry) => {
      const failure = new Error(reason);
      entry.forcedError = failure;
      try {
        entry.config.onInterrupted?.(failure);
      } catch (error) {
        console.warn('Continuous HID interruption callback failed', error);
      }
      wakeEntry(entry);
    });
};

export const resetContinuousHIDTransactionsForTesting = () => {
  entries.forEach((entry) => {
    entry.forcedError = new Error('Continuous HID test reset');
    wakeEntry(entry);
  });
  entries.clear();
};
