import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etasFor, decide, rankOptions, adviceFor } from '../src/decision.js';

const arrival = (no, nextMs, subMs) => ({
  services: [{ no, next: nextMs == null ? null : { duration_ms: nextMs }, subsequent: subMs == null ? null : { duration_ms: subMs } }],
});

test('etasFor converts ms to minutes, floors negatives at 0, handles missing', () => {
  assert.deepEqual(etasFor(arrival('27', 180000, 600000), '27'), { eta1: 3, eta2: 10 });
  assert.deepEqual(etasFor(arrival('27', -5000, null), '27'), { eta1: 0, eta2: null });
  assert.equal(etasFor(arrival('27', 1000, 2000), '72'), null);
  assert.equal(etasFor(null, '27'), null);
});

test('decide: WALK when bus arrives after walking time', () => {
  assert.deepEqual(decide({ walk: 4, run: 1.6, eta1: 5, eta2: 15 }), { verdict: 'WALK', etaCaught: 5 });
});

test('decide: RUN when only running makes it', () => {
  assert.deepEqual(decide({ walk: 4, run: 1.6, eta1: 2, eta2: 15 }), { verdict: 'RUN', etaCaught: 2 });
});

test('decide: WAIT for the next bus when even running misses it', () => {
  assert.deepEqual(decide({ walk: 4, run: 1.6, eta1: 1, eta2: 12 }), { verdict: 'WAIT', etaCaught: 12 });
});

test('decide: null when no catchable bus is known', () => {
  assert.equal(decide({ walk: 4, run: 1.6, eta1: 1, eta2: null }), null);
  assert.equal(decide({ walk: 4, run: 1.6, eta1: null, eta2: null }), null);
});

test('rankOptions computes totals and sorts by total time home', () => {
  const near = { service: '27', boardStop: { code: 'S1', distM: 80 }, stopsCount: 10 }; // walk 1.3
  const far = { service: '72', boardStop: { code: 'S2', distM: 400 }, stopsCount: 3 };  // walk 6.5
  const missing = { service: '99', boardStop: { code: 'S3', distM: 50 }, stopsCount: 1 };
  const ranked = rankOptions([near, far, missing], {
    S1: arrival('27', 120000, 600000), // eta 2 → WALK, total 2 + 20 = 22
    S2: arrival('72', 420000, 900000), // eta 7 → WALK, total 7 + 6 = 13
  });
  assert.deepEqual(ranked.map((o) => o.service), ['72', '27']);
  assert.equal(ranked[0].totalMin, 13);
  assert.equal(ranked[0].verdict, 'WALK');
});

test('WAIT total uses max(walk, eta2) when the second bus is also before walk time', () => {
  const c = { service: '27', boardStop: { code: 'S1', distM: 400 }, stopsCount: 1 }; // walk 6.5, run 2.6
  const [o] = rankOptions([c], { S1: arrival('27', 60000, 180000) }); // eta1 1, eta2 3
  assert.equal(o.verdict, 'WAIT');
  assert.equal(o.totalMin, 6.5 + 2);
});

test('adviceFor reflects rain', () => {
  const run = { verdict: 'RUN', etaCaught: 2 };
  const walk = { verdict: 'WALK', etaCaught: 6 };
  const wait = { verdict: 'WAIT', etaCaught: 11.6 };
  const dry = { wetForecast: false, raining: false };
  assert.equal(adviceFor(run, { wetForecast: true, raining: false }), 'RUN — rain is coming, catch this one.');
  assert.equal(adviceFor(run, dry), 'Run — you can just make it.');
  assert.equal(adviceFor(walk, { wetForecast: true, raining: false }), 'Walk briskly — rain expected.');
  assert.equal(adviceFor(walk, dry), 'Walk — you have time.');
  assert.equal(adviceFor(wait, { wetForecast: true, raining: true }), 'Stay sheltered — next bus in 12 min.');
  assert.equal(adviceFor(wait, { wetForecast: true, raining: false }), 'Shelter at the stop — rain on the way.');
  assert.equal(adviceFor(wait, dry), 'Missed this one — next bus in 12 min.');
});
