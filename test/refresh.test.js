import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSequencer, resolveOrigin } from '../src/refresh.js';

test('sequencer: only the latest run is current', () => {
  const seq = createSequencer();
  const a = seq.next();
  const b = seq.next();
  assert.equal(seq.isCurrent(a), false);
  assert.equal(seq.isCurrent(b), true);
});

test('resolveOrigin prefers a fresh GPS fix', () => {
  const fix = { lat: 1, lng: 2 };
  assert.deepEqual(resolveOrigin(fix, null, 0, 120000), { origin: fix, stale: false });
});

test('resolveOrigin falls back to a recent last fix when GPS fails', () => {
  const last = { origin: { lat: 1, lng: 2 }, t: 1000 };
  assert.deepEqual(resolveOrigin(null, last, 61000, 120000), { origin: last.origin, stale: true });
});

test('resolveOrigin returns null when last fix is too old or missing', () => {
  assert.equal(resolveOrigin(null, { origin: { lat: 1, lng: 2 }, t: 0 }, 200000, 120000), null);
  assert.equal(resolveOrigin(null, null, 0, 120000), null);
});
