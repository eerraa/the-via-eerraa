import defaultsDeep from 'lodash.defaultsdeep';
import type {StoreData} from '../types/types';

const STORE_KEY = 'via-app-store';

type StoreStorage = Pick<Storage, 'getItem' | 'setItem'>;

const isQuotaExceededError = (error: unknown) =>
  error instanceof DOMException && error.name === 'QuotaExceededError';

export class Store {
  store: StoreData;
  private storage: StoreStorage;
  private writeScheduled = false;
  constructor(defaults: StoreData, storage: StoreStorage = localStorage) {
    this.storage = storage;
    const store = storage.getItem(STORE_KEY);
    this.store = store ? defaultsDeep(JSON.parse(store), defaults) : defaults;
  }
  get<K extends keyof StoreData>(key: K): StoreData[K] {
    return this.store[key];
  }
  set<K extends keyof StoreData>(key: K, value: StoreData[K]) {
    const newStoreData = {
      ...this.store,
      [key]: {...value},
    };
    this.store = newStoreData;
    if (this.writeScheduled) {
      return;
    }
    this.writeScheduled = true;
    // This ends up triggering an error about .get proxy failing for JSON.stringify
    // because it's inside an async function, so we delay it out of that event loop
    setTimeout(() => {
      this.writeScheduled = false;
      this.write();
    }, 0);
  }
  private write() {
    try {
      this.storage.setItem(STORE_KEY, JSON.stringify(this.store));
    } catch (error) {
      if (!isQuotaExceededError(error)) {
        console.warn('via-app-store was not saved', error);
        return;
      }
      // Storage is full. The definition cache refills from /definitions on
      // demand, so it goes first; settings and other keys in storage stay.
      this.store = {...this.store, definitions: {}};
      try {
        this.storage.setItem(STORE_KEY, JSON.stringify(this.store));
      } catch (retryError) {
        console.warn('via-app-store was not saved', retryError);
      }
    }
  }
}
