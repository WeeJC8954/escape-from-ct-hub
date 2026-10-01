import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStops, stopsWithin, findDirectOptions } from '../src/routing.js';

// Origin cluster near (1.300, 103.800); home cluster near (1.400, 103.900).
const RAW_STOPS = {
  A1: [103.8000, 1.3005, 'Origin Stop 1', 'Road A'], // ~55 m from origin
  A2: [103.8030, 1.3000, 'Origin Stop 2', 'Road A'], // ~334 m
  M1: [103.8500, 1.3500, 'Middle', 'Road M'],
  H1: [103.9000, 1.4010, 'Home Stop', 'Road H'],     // ~111 m from home
  FAR: [103.7000, 1.2000, 'Far Away', 'Road F'],
};
const ORIGIN = { lat: 1.3, lng: 103.8 };
const HOME = { lat: 1.4, lng: 103.9 };

test('parseStops converts busrouter arrays to objects', () => {
  const stops = parseStops(RAW_STOPS);
  assert.deepEqual(stops.get('A1'), { code: 'A1', lat: 1.3005, lng: 103.8, name: 'Origin Stop 1', road: 'Road A' });
});

test('stopsWithin returns stops in radius sorted by distance', () => {
  const near = stopsWithin(ORIGIN, parseStops(RAW_STOPS), 500);
  assert.deepEqual(near.map((s) => s.code), ['A1', 'A2']);
  assert.ok(near[0].distM < near[1].distM);
});

test('finds a direct service only in the direction towards home', () => {
  const services = {
    10: { name: 'to home', routes: [['A1', 'M1', 'H1']] },
    20: { name: 'away from home', routes: [['H1', 'M1', 'A1']] },
    30: { name: 'never home', routes: [['A2', 'M1', 'FAR']] },
  };
  const res = findDirectOptions(ORIGIN, HOME, parseStops(RAW_STOPS), services);
  assert.equal(res.atHome, false);
  assert.equal(res.options.length, 1);
  assert.equal(res.options[0].service, '10');
  assert.equal(res.options[0].boardStop.code, 'A1');
  assert.equal(res.options[0].alightStop.code, 'H1');
  assert.equal(res.options[0].stopsCount, 2);
});

test('loop service visiting board stop twice keeps fewest stops, no duplicates', () => {
  const services = { 99: { name: 'loop', routes: [['A1', 'M1', 'FAR', 'M1', 'A1', 'H1', 'A1']] } };
  const res = findDirectOptions(ORIGIN, HOME, parseStops(RAW_STOPS), services);
  assert.equal(res.options.length, 1);
  assert.equal(res.options[0].stopsCount, 1);
});

test('both directions of a two-way service are checked', () => {
  const services = { 40: { name: 'two way', routes: [['H1', 'A2'], ['A2', 'H1']] } };
  const res = findDirectOptions(ORIGIN, HOME, parseStops(RAW_STOPS), services);
  assert.equal(res.options.length, 1);
  assert.equal(res.options[0].boardStop.code, 'A2');
});

test('options sorted by walking distance to board stop', () => {
  const services = { 50: { name: 'b', routes: [['A2', 'H1']] }, 60: { name: 'a', routes: [['A1', 'M1', 'H1']] } };
  const res = findDirectOptions(ORIGIN, HOME, parseStops(RAW_STOPS), services);
  assert.deepEqual(res.options.map((o) => o.service), ['60', '50']);
});

test('returns atHome when origin is within home radius', () => {
  const res = findDirectOptions({ lat: 1.4005, lng: 103.9 }, HOME, parseStops(RAW_STOPS), {});
  assert.equal(res.atHome, true);
  assert.deepEqual(res.options, []);
});

test('no direct service returns empty options but nearby stops', () => {
  const res = findDirectOptions(ORIGIN, HOME, parseStops(RAW_STOPS), {});
  assert.deepEqual(res.options, []);
  assert.deepEqual(res.nearbyStops.map((s) => s.code), ['A1', 'A2']);
});
