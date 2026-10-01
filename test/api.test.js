import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cachedJson, geocodePostal } from '../src/api.js';

let store;
beforeEach(() => {
  store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
});

const okFetch = (data) => async () => ({ ok: true, json: async () => data });
const failFetch = async () => { throw new Error('offline'); };

test('cachedJson fetches and stores when cache empty', async () => {
  globalThis.fetch = okFetch({ a: 1 });
  assert.deepEqual(await cachedJson('k', 'http://x'), { a: 1 });
  assert.deepEqual(JSON.parse(store.get('k')).data, { a: 1 });
});

test('cachedJson uses fresh cache without fetching', async () => {
  store.set('k', JSON.stringify({ t: Date.now(), data: { cached: true } }));
  globalThis.fetch = failFetch;
  assert.deepEqual(await cachedJson('k', 'http://x'), { cached: true });
});

test('cachedJson falls back to stale cache when fetch fails', async () => {
  store.set('k', JSON.stringify({ t: 0, data: { stale: true } }));
  globalThis.fetch = failFetch;
  assert.deepEqual(await cachedJson('k', 'http://x'), { stale: true });
});

test('cachedJson ignores corrupt cache and throws when offline', async () => {
  store.set('k', '{not json');
  globalThis.fetch = failFetch;
  await assert.rejects(cachedJson('k', 'http://x'), /offline/);
});

test('geocodePostal returns lat/lng or null', async () => {
  globalThis.fetch = okFetch({ found: 1, results: [{ LATITUDE: '1.384', LONGITUDE: '103.896' }] });
  assert.deepEqual(await geocodePostal('542268'), { lat: 1.384, lng: 103.896 });
  globalThis.fetch = okFetch({ found: 0, results: [] });
  assert.equal(await geocodePostal('000000'), null);
  globalThis.fetch = failFetch;
  assert.equal(await geocodePostal('542268'), null);
});
