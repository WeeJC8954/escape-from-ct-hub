import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceM, walkMin, runMin, nearest } from '../src/geo.js';

test('distanceM is 0 for the same point', () => {
  assert.equal(distanceM({ lat: 1.3, lng: 103.8 }, { lat: 1.3, lng: 103.8 }), 0);
});

test('distanceM: 0.01 deg latitude is ~1112 m', () => {
  const d = distanceM({ lat: 1.30, lng: 103.8 }, { lat: 1.31, lng: 103.8 });
  assert.ok(Math.abs(d - 1112) < 2, `got ${d}`);
});

test('walkMin and runMin apply detour factor and speed', () => {
  assert.equal(walkMin(80), 1.3);
  assert.equal(runMin(200), 1.3);
});

test('nearest picks the closest item, null for empty list', () => {
  const items = [{ id: 'far', p: { lat: 1.4, lng: 103.9 } }, { id: 'near', p: { lat: 1.301, lng: 103.8 } }];
  assert.equal(nearest({ lat: 1.3, lng: 103.8 }, items, (i) => i.p).id, 'near');
  assert.equal(nearest({ lat: 1.3, lng: 103.8 }, [], (i) => i.p), null);
});
