import {describe, expect, spyOn, test} from 'bun:test';
import {Store} from '../src/shims/via-app-store';
import type {StoreData} from '../src/types/types';

// Settings and the official definition cache share one localStorage entry.
// When storage is full, only the cache may be lost, never settings or the
// other keys the app keeps in the same storage.

const STORE_KEY = 'via-app-store';
const OTHER_KEYS = {
  designWarningSeen: '2',
  'era-firmware-maker:board': 'maker',
};

const quotaExceeded = () =>
  new DOMException('The quota has been exceeded.', 'QuotaExceededError');

const defaults = () =>
  ({
    definitionIndex: {
      generatedAt: -1,
      hash: '',
      version: '2.0.0',
      supportedVendorProductIdMap: {},
    },
    definitions: {},
    settings: {themeMode: 'dark', renderMode: '2D'},
  }) as unknown as StoreData;

const definition = (name: string, padding = 0) =>
  ({name, padding: 'x'.repeat(padding)}) as never;

/** Throws `failures` in order, then rejects writes over `limit` characters. */
const fakeStorage = (
  seed: Record<string, string>,
  {limit = Infinity, failures = [] as Error[]} = {},
) => {
  const values = new Map(Object.entries(seed));
  const size = () =>
    [...values].reduce(
      (sum, [key, value]) => sum + key.length + value.length,
      0,
    );
  const storage = {
    values,
    setItemCalls: 0,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.setItemCalls += 1;
      const failure = failures.shift();
      if (failure) {
        throw failure;
      }
      const replaced = values.has(key)
        ? key.length + values.get(key)!.length
        : 0;
      if (size() - replaced + key.length + value.length > limit) {
        throw quotaExceeded();
      }
      values.set(key, value);
    },
  };
  return storage;
};

const saved = (storage: ReturnType<typeof fakeStorage>): StoreData =>
  JSON.parse(storage.getItem(STORE_KEY) ?? 'null');

// Store writes on a zero-delay timer; one scheduled after it runs after it.
const afterWrite = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('via-app-store when storage is full', () => {
  test('a quota error drops only the definition cache and saves the rest', async () => {
    const seeded = {
      ...defaults(),
      definitions: {1: {v3: definition('cached')}},
      settings: {themeMode: 'light', renderMode: '3D'},
    } as unknown as StoreData;
    const storage = fakeStorage(
      {...OTHER_KEYS, [STORE_KEY]: JSON.stringify(seeded)},
      {failures: [quotaExceeded()]},
    );
    const store = new Store(defaults(), storage);

    store.set('definitions', {
      ...store.get('definitions'),
      2: {v3: definition('fetched')},
    });
    await afterWrite();

    expect(storage.setItemCalls).toBe(2);
    expect(saved(storage)).toEqual({...seeded, definitions: {}});
    expect(store.get('definitions')).toEqual({});
    expect(store.get('settings')).toEqual(seeded.settings);
    expect(Object.fromEntries(storage.values)).toMatchObject(OTHER_KEYS);
  });

  test('settings keep saving after the cache outgrew the quota', async () => {
    const storage = fakeStorage({...OTHER_KEYS}, {limit: 2000});
    const store = new Store(defaults(), storage);

    store.set('definitions', {1: {v3: definition('large', 4000)}});
    await afterWrite();
    expect(saved(storage).definitions).toEqual({});

    const callsBefore = storage.setItemCalls;
    store.set('settings', {...store.get('settings'), themeMode: 'light'});
    await afterWrite();

    expect(storage.setItemCalls).toBe(callsBefore + 1);
    expect(saved(storage).settings.themeMode).toBe('light');
    expect(Object.fromEntries(storage.values)).toMatchObject(OTHER_KEYS);
  });

  test('any other write error keeps the cache and is logged, not thrown', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const storage = fakeStorage(
      {},
      {failures: [new DOMException('Access is denied.', 'SecurityError')]},
    );
    const store = new Store(defaults(), storage);
    const cache = {1: {v3: definition('cached')}};

    try {
      store.set('definitions', cache);
      await afterWrite();

      expect(storage.setItemCalls).toBe(1);
      expect(store.get('definitions')).toEqual(cache);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
