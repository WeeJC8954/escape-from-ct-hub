# Escape from CT Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static, phone-friendly web page that uses the user's GPS to tell them which nearby bus stop and direct bus service gets them home (postal 542268), how long until it arrives, and whether to walk, run, or wait given approaching rain.

**Architecture:** Vanilla ES modules served as static files (GitHub Pages). Pure logic modules (`geo`, `routing`, `weather`, `decision`) are DOM- and network-free and unit-tested with `node --test`; `api.js` wraps fetches with a localStorage cache; `app.js` orchestrates geolocation, data fetching, rendering and a 30 s refresh.

**Tech Stack:** HTML, CSS, JavaScript (ES2022 modules), Node 26 built-in test runner (`node:test`, `node:assert/strict`). Zero dependencies.

**Spec:** `docs/superpowers/specs/2026-10-01-escape-from-ct-hub-design.md`

## Global Constraints

- No API keys, no backend, no build step, no runtime or dev dependencies.
- Home postal code `542268`; home fallback coordinates `1.384456, 103.896253`.
- `ORIGIN_RADIUS_M = 500`, `HOME_RADIUS_M = 400`, detour factor `1.3`, walk `80` m/min, run `200` m/min, `2` min per stop, refresh `30 s`, static bus data cache `24 h`.
- Direct services only (no transfers, no MRT). Out of scope: taxis, cameras, carparks.
- Pure modules (`src/geo.js`, `src/routing.js`, `src/weather.js`, `src/decision.js`) must not touch `document`, `window`, `fetch`, or `localStorage`.
- Render API-sourced strings with `textContent` only (never `innerHTML`).
- Git: all work on branch `feat/escape-from-ct-hub`; never commit or push to `main`; merge via PR.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A service that loops (first stop == last stop) or visits the board stop twice → pick the occurrence with fewest stops to home, no duplicate rows. (Test in Task 2.)
2. Arrivals where `next` exists but `subsequent` is missing, or `duration_ms` is negative (bus at stop) → ETA floors at 0; WAIT with no second bus drops the option rather than crashing. (Test in Task 4.)
3. Weather JSON where a station has metadata but no reading (or the endpoint returns empty `items`) → nearest station *with a reading* is used; empty → `null`, decision treats as dry. (Test in Task 3.)
4. Static data fetch fails while a stale cache exists → stale cache is returned; corrupt cache JSON does not throw. (Test in Task 5.)
5. User is already within 400 m of home → "You're home already", no arrival calls. (Test in Task 2.)

---

### Task 1: Scaffold, config, and geo helpers

**Files:**
- Create: `package.json`, `.gitignore`, `src/config.js`, `src/geo.js`
- Test: `test/geo.test.js`

**Interfaces:**
- Produces: `config.js` named constants (see code); `distanceM(a, b) → number` (metres, points `{lat, lng}`); `walkMin(m) → number`; `runMin(m) → number`; `nearest(point, items, getPoint) → item | null`.

- [ ] **Step 1: Create scaffold**

`package.json`:
```json
{
  "name": "escape-from-ct-hub",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Run, walk or wait? Bus-home helper for Singapore using arrivelah, busrouter.sg and data.gov.sg.",
  "scripts": {
    "test": "node --test",
    "start": "npx --yes serve ."
  }
}
```

`.gitignore`:
```
node_modules/
.DS_Store
```

`src/config.js`:
```js
export const HOME_POSTAL = '542268';
export const HOME_FALLBACK = { lat: 1.384456, lng: 103.896253 };
export const ORIGIN_RADIUS_M = 500;
export const HOME_RADIUS_M = 400;
export const DETOUR = 1.3;
export const WALK_M_PER_MIN = 80;
export const RUN_M_PER_MIN = 200;
export const MIN_PER_STOP = 2;
export const REFRESH_MS = 30_000;
export const MAX_ARRIVAL_STOPS = 6;
export const STATIC_CACHE_MS = 24 * 60 * 60 * 1000;
```

- [ ] **Step 2: Write the failing test** — `test/geo.test.js`
```js
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module .../src/geo.js`

- [ ] **Step 4: Implement** — `src/geo.js`
```js
import { DETOUR, WALK_M_PER_MIN, RUN_M_PER_MIN } from './config.js';

const EARTH_R = 6371000;
const rad = (deg) => (deg * Math.PI) / 180;

export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

export const walkMin = (m) => (m * DETOUR) / WALK_M_PER_MIN;
export const runMin = (m) => (m * DETOUR) / RUN_M_PER_MIN;

export function nearest(point, items, getPoint) {
  let best = null;
  let bestD = Infinity;
  for (const item of items) {
    const d = distanceM(point, getPoint(item));
    if (d < bestD) {
      bestD = d;
      best = item;
    }
  }
  return best;
}
```

- [ ] **Step 5: Run tests** — `npm test` → all PASS

- [ ] **Step 6: Commit**
```bash
git add package.json .gitignore src/config.js src/geo.js test/geo.test.js
git commit -m "feat: scaffold project with config and geo helpers"
```

---

### Task 2: Direct-route finder

**Files:**
- Create: `src/routing.js`
- Test: `test/routing.test.js`

**Interfaces:**
- Consumes: `distanceM` from `geo.js`; `ORIGIN_RADIUS_M`, `HOME_RADIUS_M` from `config.js`.
- Produces:
  - `parseStops(raw) → Map<code, Stop>` where raw is busrouter `{code: [lng, lat, name, road]}` and `Stop = {code, lat, lng, name, road}`.
  - `stopsWithin(point, stops, radiusM) → Array<Stop & {distM}>` sorted by `distM`.
  - `findDirectOptions(origin, home, stops, services, opts?) → { atHome: boolean, options: Candidate[], nearbyStops: Array<Stop & {distM}> }` where `Candidate = { service: string, boardStop: Stop & {distM}, alightStop: Stop, stopsCount: number }`, options sorted by `boardStop.distM` then `stopsCount`. `services` is busrouter `{svc: {name, routes: string[][]}}`.

- [ ] **Step 1: Write the failing test** — `test/routing.test.js`
```js
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
```

- [ ] **Step 2: Run** `npm test` → FAIL (module not found)

- [ ] **Step 3: Implement** — `src/routing.js`
```js
import { distanceM } from './geo.js';
import { ORIGIN_RADIUS_M, HOME_RADIUS_M } from './config.js';

export function parseStops(raw) {
  const stops = new Map();
  for (const [code, [lng, lat, name, road]] of Object.entries(raw)) {
    stops.set(code, { code, lat, lng, name, road });
  }
  return stops;
}

export function stopsWithin(point, stops, radiusM) {
  const out = [];
  for (const stop of stops.values()) {
    const distM = distanceM(point, stop);
    if (distM <= radiusM) out.push({ ...stop, distM });
  }
  return out.sort((a, b) => a.distM - b.distM);
}

export function findDirectOptions(origin, home, stops, services, opts = {}) {
  const originRadiusM = opts.originRadiusM ?? ORIGIN_RADIUS_M;
  const homeRadiusM = opts.homeRadiusM ?? HOME_RADIUS_M;
  if (distanceM(origin, home) <= homeRadiusM) return { atHome: true, options: [], nearbyStops: [] };

  const nearbyStops = stopsWithin(origin, stops, originRadiusM);
  const boardable = new Map(nearbyStops.map((s) => [s.code, s]));
  const homeCodes = new Set(stopsWithin(home, stops, homeRadiusM).map((s) => s.code));
  const best = new Map();

  for (const [service, { routes }] of Object.entries(services)) {
    for (const route of routes) {
      for (let i = 0; i < route.length; i++) {
        const boardStop = boardable.get(route[i]);
        if (!boardStop) continue;
        let j = i + 1;
        while (j < route.length && !homeCodes.has(route[j])) j++;
        if (j >= route.length) continue;
        const key = `${service}|${boardStop.code}`;
        const stopsCount = j - i;
        const prev = best.get(key);
        if (!prev || stopsCount < prev.stopsCount) {
          best.set(key, { service, boardStop, alightStop: stops.get(route[j]), stopsCount });
        }
      }
    }
  }

  const options = [...best.values()].sort(
    (a, b) => a.boardStop.distM - b.boardStop.distM || a.stopsCount - b.stopsCount,
  );
  return { atHome: false, options, nearbyStops };
}
```

- [ ] **Step 4: Run** `npm test` → all PASS

- [ ] **Step 5: Commit**
```bash
git add src/routing.js test/routing.test.js
git commit -m "feat: add direct bus route finder"
```

---

### Task 3: Weather interpretation

**Files:**
- Create: `src/weather.js`
- Test: `test/weather.test.js`

**Interfaces:**
- Consumes: `nearest` from `geo.js`.
- Produces (all accept `null`/malformed JSON and return `null`):
  - `forecastFor(point, forecastJson) → {area, text} | null`
  - `isWetForecast(text) → boolean`
  - `stationReading(point, json) → {station, value} | null` (rainfall mm, air temperature °C)
  - `uvNow(json) → number | null`
  - `pm25For(point, json) → {region, value} | null`

- [ ] **Step 1: Write the failing test** — `test/weather.test.js`
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecastFor, isWetForecast, stationReading, uvNow, pm25For } from '../src/weather.js';

const P = { lat: 1.39, lng: 103.89 }; // Sengkang-ish

const FORECAST = {
  area_metadata: [
    { name: 'Sengkang', label_location: { latitude: 1.391, longitude: 103.895 } },
    { name: 'Jurong West', label_location: { latitude: 1.34, longitude: 103.7 } },
  ],
  items: [{ forecasts: [{ area: 'Sengkang', forecast: 'Heavy Thundery Showers' }, { area: 'Jurong West', forecast: 'Fair' }] }],
};

const STATIONS = {
  metadata: {
    stations: [
      { id: 'S1', name: 'Near but silent', location: { latitude: 1.3901, longitude: 103.8901 } },
      { id: 'S2', name: 'Sengkang East', location: { latitude: 1.395, longitude: 103.9 } },
      { id: 'S3', name: 'Far', location: { latitude: 1.3, longitude: 103.7 } },
    ],
  },
  items: [{ readings: [{ station_id: 'S2', value: 1.2 }, { station_id: 'S3', value: 0 }] }],
};

test('forecastFor picks nearest area forecast', () => {
  assert.deepEqual(forecastFor(P, FORECAST), { area: 'Sengkang', text: 'Heavy Thundery Showers' });
});

test('isWetForecast detects rain words', () => {
  assert.equal(isWetForecast('Heavy Thundery Showers'), true);
  assert.equal(isWetForecast('Light Rain'), true);
  assert.equal(isWetForecast('Partly Cloudy (Day)'), false);
  assert.equal(isWetForecast(undefined), false);
});

test('stationReading uses nearest station that has a reading', () => {
  assert.deepEqual(stationReading(P, STATIONS), { station: 'Sengkang East', value: 1.2 });
});

test('stationReading returns null on empty items or null json', () => {
  assert.equal(stationReading(P, { metadata: STATIONS.metadata, items: [] }), null);
  assert.equal(stationReading(P, null), null);
});

test('uvNow returns latest index or null', () => {
  assert.equal(uvNow({ items: [{ index: [{ value: 6 }, { value: 7 }] }] }), 6);
  assert.equal(uvNow({ items: [] }), null);
});

test('pm25For picks nearest region with a reading', () => {
  const json = {
    region_metadata: [
      { name: 'north', label_location: { latitude: 1.418, longitude: 103.82 } },
      { name: 'east', label_location: { latitude: 1.357, longitude: 103.94 } },
      { name: 'west', label_location: { latitude: 1.357, longitude: 103.7 } },
    ],
    items: [{ readings: { pm25_one_hourly: { north: 21, east: 34, west: 20 } } }],
  };
  assert.deepEqual(pm25For(P, json), { region: 'east', value: 34 });
  assert.equal(pm25For(P, null), null);
});
```

- [ ] **Step 2: Run** `npm test` → FAIL (module not found)

- [ ] **Step 3: Implement** — `src/weather.js`
```js
import { nearest } from './geo.js';

const at = (loc) => ({ lat: loc.latitude, lng: loc.longitude });

export function forecastFor(point, json) {
  const areas = json?.area_metadata ?? [];
  const forecasts = json?.items?.[0]?.forecasts ?? [];
  const withForecast = areas.filter((a) => forecasts.some((f) => f.area === a.name));
  const area = nearest(point, withForecast, (a) => at(a.label_location));
  if (!area) return null;
  return { area: area.name, text: forecasts.find((f) => f.area === area.name).forecast };
}

export const isWetForecast = (text) => /rain|shower|thunder/i.test(text ?? '');

export function stationReading(point, json) {
  const stations = json?.metadata?.stations ?? [];
  const readings = json?.items?.[0]?.readings ?? [];
  const valueById = new Map(readings.map((r) => [r.station_id, r.value]));
  const station = nearest(point, stations.filter((s) => valueById.has(s.id)), (s) => at(s.location));
  return station ? { station: station.name, value: valueById.get(station.id) } : null;
}

export function uvNow(json) {
  const value = json?.items?.[0]?.index?.[0]?.value;
  return typeof value === 'number' ? value : null;
}

export function pm25For(point, json) {
  const readings = json?.items?.[0]?.readings?.pm25_one_hourly ?? {};
  const regions = (json?.region_metadata ?? []).filter((r) => r.name in readings);
  const region = nearest(point, regions, (r) => at(r.label_location));
  return region ? { region: region.name, value: readings[region.name] } : null;
}
```

- [ ] **Step 4: Run** `npm test` → all PASS

- [ ] **Step 5: Commit**
```bash
git add src/weather.js test/weather.test.js
git commit -m "feat: add weather interpretation helpers"
```

---

### Task 4: Run / walk / wait decision

**Files:**
- Create: `src/decision.js`
- Test: `test/decision.test.js`

**Interfaces:**
- Consumes: `walkMin`, `runMin` from `geo.js`; `MIN_PER_STOP` from `config.js`; `Candidate` from Task 2.
- Produces:
  - `etasFor(arrivalJson, serviceNo) → {eta1: number|null, eta2: number|null} | null` (minutes, floored at 0; `null` if service absent).
  - `decide({walk, run, eta1, eta2}) → {verdict: 'WALK'|'RUN'|'WAIT', etaCaught: number} | null`
  - `rankOptions(candidates, arrivalsByStop) → RankedOption[]` where `arrivalsByStop` is `{[stopCode]: arrivelahJson}` and `RankedOption = Candidate & {eta1, eta2, walk, run, verdict, etaCaught, rideMin, totalMin}`, sorted by `totalMin`.
  - `adviceFor(option, {wetForecast, raining}) → string`

- [ ] **Step 1: Write the failing test** — `test/decision.test.js`
```js
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
```

- [ ] **Step 2: Run** `npm test` → FAIL (module not found)

- [ ] **Step 3: Implement** — `src/decision.js`
```js
import { walkMin, runMin } from './geo.js';
import { MIN_PER_STOP } from './config.js';

const toMin = (ms) => (typeof ms === 'number' ? Math.max(0, ms / 60000) : null);

export function etasFor(arrivalJson, serviceNo) {
  const svc = arrivalJson?.services?.find((s) => s.no === serviceNo);
  if (!svc) return null;
  return { eta1: toMin(svc.next?.duration_ms), eta2: toMin(svc.subsequent?.duration_ms) };
}

export function decide({ walk, run, eta1, eta2 }) {
  if (eta1 == null) return null;
  if (eta1 >= walk) return { verdict: 'WALK', etaCaught: eta1 };
  if (eta1 >= run) return { verdict: 'RUN', etaCaught: eta1 };
  if (eta2 == null) return null;
  return { verdict: 'WAIT', etaCaught: eta2 };
}

export function rankOptions(candidates, arrivalsByStop) {
  const ranked = [];
  for (const c of candidates) {
    const etas = etasFor(arrivalsByStop[c.boardStop.code], c.service);
    if (!etas) continue;
    const walk = walkMin(c.boardStop.distM);
    const run = runMin(c.boardStop.distM);
    const d = decide({ walk, run, ...etas });
    if (!d) continue;
    const rideMin = c.stopsCount * MIN_PER_STOP;
    ranked.push({ ...c, ...etas, walk, run, ...d, rideMin, totalMin: Math.max(walk, d.etaCaught) + rideMin });
  }
  return ranked.sort((a, b) => a.totalMin - b.totalMin);
}

export function adviceFor(option, { wetForecast, raining }) {
  const wet = wetForecast || raining;
  const eta = Math.round(option.etaCaught);
  if (option.verdict === 'RUN') return wet ? 'RUN — rain is coming, catch this one.' : 'Run — you can just make it.';
  if (option.verdict === 'WALK') return wet ? 'Walk briskly — rain expected.' : 'Walk — you have time.';
  if (raining) return `Stay sheltered — next bus in ${eta} min.`;
  if (wetForecast) return 'Shelter at the stop — rain on the way.';
  return `Missed this one — next bus in ${eta} min.`;
}
```

- [ ] **Step 4: Run** `npm test` → all PASS

- [ ] **Step 5: Commit**
```bash
git add src/decision.js test/decision.test.js
git commit -m "feat: add run/walk/wait decision and ranking"
```

---

### Task 5: API layer with cache

**Files:**
- Create: `src/api.js`
- Test: `test/api.test.js`

**Interfaces:**
- Consumes: `STATIC_CACHE_MS` from `config.js`. Uses globals `fetch`, `localStorage` (tests stub them).
- Produces:
  - `cachedJson(key, url, maxAgeMs?) → Promise<any>` (fresh cache → cache; else fetch & store; fetch fails → stale cache or throw)
  - `getStopsRaw()`, `getServices()` → busrouter JSON (cached)
  - `getArrivals(stopCode) → Promise<arrivelahJson>`
  - `geocodePostal(postal) → Promise<{lat, lng} | null>`
  - `getWeather() → Promise<{forecast, rainfall, temperature, uv, pm25}>` each JSON or `null` on failure.

- [ ] **Step 1: Write the failing test** — `test/api.test.js`
```js
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
```

- [ ] **Step 2: Run** `npm test` → FAIL (module not found)

- [ ] **Step 3: Implement** — `src/api.js`
```js
import { STATIC_CACHE_MS } from './config.js';

const BUSROUTER = 'https://data.busrouter.sg/v1';
const ARRIVELAH = 'https://arrivelah2.busrouter.sg/';
const ONEMAP = 'https://www.onemap.gov.sg/api/common/elastic/search';
const DATAGOV = 'https://api.data.gov.sg/v1/environment';

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function readCache(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ t: Date.now(), data }));
  } catch {
    // Quota exceeded or storage unavailable: run uncached.
  }
}

export async function cachedJson(key, url, maxAgeMs = STATIC_CACHE_MS) {
  const cached = readCache(key);
  if (cached && Date.now() - cached.t < maxAgeMs) return cached.data;
  try {
    const data = await getJson(url);
    writeCache(key, data);
    return data;
  } catch (err) {
    if (cached) return cached.data;
    throw err;
  }
}

export const getStopsRaw = () => cachedJson('busrouter:stops', `${BUSROUTER}/stops.min.json`);
export const getServices = () => cachedJson('busrouter:services', `${BUSROUTER}/services.min.json`);
export const getArrivals = (stopCode) => getJson(`${ARRIVELAH}?id=${encodeURIComponent(stopCode)}`);

export async function geocodePostal(postal) {
  try {
    const url = `${ONEMAP}?searchVal=${encodeURIComponent(postal)}&returnGeom=Y&getAddrDetails=N&pageNum=1`;
    const hit = (await getJson(url)).results?.[0];
    return hit ? { lat: Number(hit.LATITUDE), lng: Number(hit.LONGITUDE) } : null;
  } catch {
    return null;
  }
}

export async function getWeather() {
  const names = ['2-hour-weather-forecast', 'rainfall', 'air-temperature', 'uv-index', 'pm25'];
  const results = await Promise.allSettled(names.map((n) => getJson(`${DATAGOV}/${n}`)));
  const [forecast, rainfall, temperature, uv, pm25] = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
  return { forecast, rainfall, temperature, uv, pm25 };
}
```

- [ ] **Step 4: Run** `npm test` → all PASS

- [ ] **Step 5: Commit**
```bash
git add src/api.js test/api.test.js
git commit -m "feat: add API layer with localStorage cache"
```

---

### Task 6: UI — page, styles, orchestration

**Files:**
- Create: `index.html`, `styles.css`, `src/app.js`

**Interfaces:**
- Consumes: everything above — `HOME_POSTAL`, `HOME_FALLBACK`, `REFRESH_MS`, `MAX_ARRIVAL_STOPS` (config); `parseStops`, `findDirectOptions` (routing); `getStopsRaw`, `getServices`, `getArrivals`, `geocodePostal`, `getWeather` (api); `forecastFor`, `isWetForecast`, `stationReading`, `uvNow`, `pm25For` (weather); `rankOptions`, `adviceFor` (decision).

- [ ] **Step 1: Create `index.html`**
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Escape from CT Hub</title>
  <meta name="description" content="Run, walk or wait? Which bus gets you home, and is rain coming.">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🚌</text></svg>">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main>
    <header>
      <h1>Escape from CT Hub</h1>
      <p class="sub" id="where">Locating you…</p>
    </header>

    <section id="verdict" class="card verdict" aria-live="polite">
      <p class="muted">Finding your bus home…</p>
    </section>

    <section id="options" class="card" hidden>
      <h2>Other options</h2>
      <ol id="option-list"></ol>
    </section>

    <form id="manual" class="card" hidden>
      <label for="manual-input">Location unavailable — enter a postal code or bus stop code</label>
      <div class="row">
        <input id="manual-input" inputmode="numeric" pattern="\d{5,6}" maxlength="6" placeholder="e.g. 520201 or 75009" required>
        <button type="submit">Go</button>
      </div>
      <p id="manual-error" class="error" hidden></p>
    </form>

    <section id="weather" class="card">
      <h2>Weather</h2>
      <dl class="weather-grid">
        <div><dt>Next 2 h</dt><dd id="w-forecast">—</dd></div>
        <div><dt>Rain now</dt><dd id="w-rain">—</dd></div>
        <div><dt>Temp</dt><dd id="w-temp">—</dd></div>
        <div><dt>UV</dt><dd id="w-uv">—</dd></div>
        <div><dt>PM2.5</dt><dd id="w-pm25">—</dd></div>
      </dl>
    </section>

    <footer>
      <p>Updated <span id="updated">—</span> · <button id="refresh" type="button" class="link">Refresh</button></p>
      <p class="muted">Data: arrivelah &amp; busrouter.sg (LTA DataMall), OneMap, data.gov.sg (NEA). Direct buses only.</p>
    </footer>
  </main>
  <script type="module" src="src/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `styles.css`**
```css
:root {
  --bg: #f5f6f8; --card: #ffffff; --text: #16181d; --muted: #666c78; --border: #e1e4ea;
  --walk: #1f8a4c; --run: #d4462b; --wait: #b7791f; --accent: #2457d6;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111317; --card: #1b1e24; --text: #eef0f4; --muted: #9aa1ad; --border: #2c3038;
    --walk: #3cc47a; --run: #ff6b4f; --wait: #f0b443; --accent: #7aa2ff;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 560px; margin: 0 auto; padding: 16px; }
h1 { font-size: 1.4rem; margin: 0; }
h2 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 0 0 8px; }
.sub, .muted { color: var(--muted); margin: 4px 0 0; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 16px; margin-top: 14px; }
.verdict .word { font-size: 3rem; font-weight: 800; line-height: 1; margin: 0; letter-spacing: 0.02em; }
.verdict.walk .word { color: var(--walk); }
.verdict.run .word { color: var(--run); }
.verdict.wait .word { color: var(--wait); }
.verdict .bus { font-size: 1.25rem; font-weight: 700; margin: 10px 0 2px; }
.verdict .advice { font-weight: 600; margin: 10px 0 0; }
.facts { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 8px 0 0; color: var(--muted); }
ol { margin: 0; padding-left: 1.2rem; }
li { padding: 6px 0; border-bottom: 1px solid var(--border); }
li:last-child { border-bottom: 0; }
a { color: var(--accent); }
.weather-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 10px; margin: 0; }
.weather-grid dt { font-size: 0.75rem; color: var(--muted); }
.weather-grid dd { margin: 0; font-weight: 600; }
.row { display: flex; gap: 8px; margin-top: 8px; }
input { flex: 1; min-width: 0; font: inherit; padding: 10px; border-radius: 10px; border: 1px solid var(--border); background: var(--bg); color: var(--text); }
button { font: inherit; padding: 10px 16px; border-radius: 10px; border: 0; background: var(--accent); color: #fff; cursor: pointer; }
button.link { background: none; color: var(--accent); padding: 0; text-decoration: underline; }
.error { color: var(--run); margin: 8px 0 0; }
footer { margin: 18px 0 32px; font-size: 0.85rem; }
footer p { margin: 4px 0; }
```

- [ ] **Step 3: Create `src/app.js`**
```js
import { HOME_POSTAL, HOME_FALLBACK, REFRESH_MS, MAX_ARRIVAL_STOPS } from './config.js';
import { parseStops, findDirectOptions } from './routing.js';
import { getStopsRaw, getServices, getArrivals, geocodePostal, getWeather } from './api.js';
import { forecastFor, isWetForecast, stationReading, uvNow, pm25For } from './weather.js';
import { rankOptions, adviceFor } from './decision.js';

const $ = (id) => document.getElementById(id);
const state = { stops: null, services: null, home: null, manualOrigin: null, timer: null };

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) node.append(child);
  return node;
}

const mins = (m) => (m < 1 ? 'arriving' : `${Math.round(m)} min`);
const stopLink = (stop) =>
  el('a', { href: `https://busrouter.sg/#/stops/${stop.code}`, target: '_blank', rel: 'noopener' }, `${stop.code} ${stop.name}`);

function getGps() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      reject,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 },
    );
  });
}

async function loadStatic() {
  if (state.stops) return;
  const [stopsRaw, services, home] = await Promise.all([getStopsRaw(), getServices(), geocodePostal(HOME_POSTAL)]);
  state.stops = parseStops(stopsRaw);
  state.services = services;
  state.home = home ?? HOME_FALLBACK;
}

function renderWeather(origin, w) {
  const forecast = forecastFor(origin, w.forecast);
  const rain = stationReading(origin, w.rainfall);
  const temp = stationReading(origin, w.temperature);
  const uv = uvNow(w.uv);
  const pm = pm25For(origin, w.pm25);
  $('w-forecast').textContent = forecast ? `${forecast.text} (${forecast.area})` : '—';
  $('w-rain').textContent = rain ? (rain.value > 0 ? `Raining · ${rain.value} mm` : 'Dry') : '—';
  $('w-temp').textContent = temp ? `${temp.value} °C` : '—';
  $('w-uv').textContent = uv ?? '—';
  $('w-pm25').textContent = pm ? `${pm.value} (${pm.region})` : '—';
  return { wetForecast: isWetForecast(forecast?.text), raining: (rain?.value ?? 0) > 0 };
}

function renderMessage(text, extra) {
  const card = $('verdict');
  card.className = 'card verdict';
  card.replaceChildren(el('p', { className: 'bus' }, text), ...(extra ? [extra] : []));
  $('options').hidden = true;
}

function renderBest(best, rain) {
  const card = $('verdict');
  card.className = `card verdict ${best.verdict.toLowerCase()}`;
  card.replaceChildren(
    el('p', { className: 'word' }, best.verdict),
    el('p', { className: 'bus' }, `Bus ${best.service} from stop `, stopLink(best.boardStop)),
    el('div', { className: 'facts' },
      el('span', {}, `🚌 ${mins(best.etaCaught)}`),
      el('span', {}, `🚶 ${Math.round(best.walk)} min walk (${Math.round(best.boardStop.distM)} m)`),
      el('span', {}, `🏠 ~${Math.round(best.totalMin)} min home`),
    ),
    el('p', { className: 'advice' }, adviceFor(best, rain)),
    el('p', { className: 'muted' }, `Alight at ${best.alightStop.code} ${best.alightStop.name} · ${best.stopsCount} stops`),
  );
}

function renderOthers(others) {
  $('options').hidden = others.length === 0;
  $('option-list').replaceChildren(
    ...others.map((o) =>
      el('li', {},
        el('strong', {}, `${o.service} `),
        stopLink(o.boardStop),
        el('span', { className: 'muted' }, ` · ${o.verdict.toLowerCase()} · bus ${mins(o.etaCaught)} · ~${Math.round(o.totalMin)} min home`),
      ),
    ),
  );
}

async function refresh() {
  try {
    await loadStatic();
    let origin = state.manualOrigin;
    if (!origin) {
      try {
        origin = await getGps();
        $('where').textContent = `📍 ${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}`;
      } catch {
        $('manual').hidden = false;
        $('where').textContent = 'Location unavailable';
        renderMessage('Enter a postal code or bus stop code below.');
        return;
      }
    }

    const weatherPromise = getWeather();
    const route = findDirectOptions(origin, state.home, state.stops, state.services);
    const rain = renderWeather(origin, await weatherPromise);

    if (route.atHome) return renderMessage("You're home already 🏠");
    if (route.options.length === 0) {
      const list = el('ul', {}, ...route.nearbyStops.slice(0, 3).map((s) => el('li', {}, stopLink(s))));
      return renderMessage('No direct bus home from here.', route.nearbyStops.length ? list : el('p', { className: 'muted' }, 'No bus stops within 500 m.'));
    }

    const codes = [...new Set(route.options.map((o) => o.boardStop.code))].slice(0, MAX_ARRIVAL_STOPS);
    const settled = await Promise.allSettled(codes.map((c) => getArrivals(c)));
    const arrivalsByStop = Object.fromEntries(codes.map((c, i) => [c, settled[i].status === 'fulfilled' ? settled[i].value : null]));
    const ranked = rankOptions(route.options.filter((o) => codes.includes(o.boardStop.code)), arrivalsByStop);

    if (ranked.length === 0) return renderMessage('Arrival data unavailable right now. Try again shortly.');
    renderBest(ranked[0], rain);
    renderOthers(ranked.slice(1, 4));
  } catch (err) {
    console.error(err);
    renderMessage('Something went wrong loading bus data. Check your connection and refresh.');
  } finally {
    $('updated').textContent = new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}

$('manual').addEventListener('submit', async (e) => {
  e.preventDefault();
  const value = $('manual-input').value.trim();
  const err = $('manual-error');
  err.hidden = true;
  await loadStatic();
  let origin = null;
  if (/^\d{6}$/.test(value)) origin = await geocodePostal(value);
  else if (/^\d{5}$/.test(value) && state.stops.has(value)) origin = state.stops.get(value);
  if (!origin) {
    err.textContent = 'Not found — use a 6-digit postal code or a 5-digit bus stop code.';
    err.hidden = false;
    return;
  }
  state.manualOrigin = { lat: origin.lat, lng: origin.lng };
  $('where').textContent = `📍 ${value}`;
  refresh();
});

$('refresh').addEventListener('click', () => refresh());

refresh();
state.timer = setInterval(() => {
  if (!document.hidden) refresh();
}, REFRESH_MS);
```

- [ ] **Step 4: Run unit tests** — `npm test` → all PASS (pure modules unaffected)

- [ ] **Step 5: Manual browser check**

Run: `npx --yes serve . -l 5173` and open `http://localhost:5173`.
Check: (a) with location granted, verdict card shows RUN/WALK/WAIT, bus number, stop link, minutes; (b) weather strip fills in; (c) with location blocked (DevTools → Sensors → Location unavailable, or deny permission), the manual form appears; entering `520201` (Tampines) gives a verdict, `75009` (Tampines Int stop) gives a verdict, `12345` shows the error; (d) set DevTools location to home (1.3845, 103.8962) → "You're home already"; (e) no console errors.

- [ ] **Step 6: Commit**
```bash
git add index.html styles.css src/app.js
git commit -m "feat: add single-page UI with live refresh"
```

---

### Task 7: README and CLAUDE.md

**Files:**
- Create: `README.md`
- Modify: `CLAUDE.md` (currently empty)

- [ ] **Step 1: Write `README.md`** with sections: title + one-line pitch; Live site URL (`https://weejc8954.github.io/escape-from-ct-hub/`); What it does (bullet list: GPS → nearest stops within 500 m → direct services to a stop within 400 m of 542268 → live arrivals → WALK/RUN/WAIT with rain advice → weather strip); How the decision works (the thresholds from spec §4.4 and the rain messages); Data sources table (spec §2) with credits; Run locally (`npx serve .` — note geolocation needs `localhost` or HTTPS); Tests (`npm test`, Node 20+); Configuration (`src/config.js` constants, change `HOME_POSTAL` for another home); Project structure (file tree from spec §3); Limitations (direct buses only, ride-time estimate is 2 min/stop, straight-line walking estimate); Deploy (GitHub Pages from `main` root).

- [ ] **Step 2: Write `CLAUDE.md`** with: project summary (2 lines); commands (`npm test`, `npx serve .`); architecture map (pure modules vs `api.js` vs `app.js`, one line each); conventions (no dependencies, no build step, pure modules never touch DOM/network/storage, render API text via `textContent`, constants live in `config.js`, add tests in `test/*.test.js` with fixtures — never hit live APIs in tests); data-source quirks (busrouter stops are `[lng, lat, ...]` — longitude first; arrivelah `duration_ms` can be negative; data.gov.sg readings can omit stations); git workflow (branch + PR, never commit/push to `main`; Pages deploys from `main`); links to spec and plan.

- [ ] **Step 3: Commit**
```bash
git add README.md CLAUDE.md
git commit -m "docs: add README and CLAUDE.md"
```

---

### Task 8: Publish to GitHub Pages

- [ ] **Step 1: Create the public repo with GitHub-generated `main`** (so `main` exists as a PR base without us committing to it)
```bash
gh repo create escape-from-ct-hub --public --add-readme --description "Run, walk or wait? Bus-home helper for Singapore (arrivelah + data.gov.sg)"
git remote add origin https://github.com/WeeJC8954/escape-from-ct-hub.git
git fetch origin
```

- [ ] **Step 2: Rebase the feature branch onto `origin/main`**, resolving the README conflict in favour of our README:
```bash
git rebase origin/main
# on README.md conflict:
git checkout --theirs README.md && git add README.md && git rebase --continue
```
(During a rebase, `--theirs` is the commit being replayed, i.e. ours.) Then `npm test` → all PASS.

- [ ] **Step 3: Push branch and open PR**
```bash
git push -u origin feat/escape-from-ct-hub
gh pr create --base main --title "Escape from CT Hub v1" --body "<summary + test plan>"
```

- [ ] **Step 4: Merge the PR and enable Pages from `main` root**
```bash
gh pr merge --merge --delete-branch=false
gh api -X POST repos/WeeJC8954/escape-from-ct-hub/pages -f "source[branch]=main" -f "source[path]=/"
```

- [ ] **Step 5: Verify deployment**
```bash
gh api repos/WeeJC8954/escape-from-ct-hub/pages/builds/latest --jq .status   # expect "built"
curl -sI https://weejc8954.github.io/escape-from-ct-hub/ | head -1             # expect HTTP/2 200
curl -s https://weejc8954.github.io/escape-from-ct-hub/src/app.js | head -1    # expect the import line
```
Open the live URL on a phone and grant location.
