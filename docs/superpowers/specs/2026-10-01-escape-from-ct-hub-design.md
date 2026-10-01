# Escape from CT Hub — Design Spec

Date: 2026-10-01 · Status: approved design, pending spec review

## 1. Intent

A phone-friendly web page that, from the user's **current GPS location**, answers in one glance:

1. **Which bus stop** to walk to (stop code + name),
2. **Which bus service** goes directly home (to near postal code **542268** — 268B Compassvale Link, Sengkang),
3. **How long** until that bus arrives, and
4. **Run, walk, or wait** — factoring in whether heavy rain is approaching.

Plus a small weather strip (2-hour forecast, rain now, air temperature, UV, PM2.5).

**Success criteria**
- Opening the page on a phone anywhere in Singapore shows a verdict within ~5 s of granting location.
- The recommended bus really does serve a stop within 400 m of home, in the travel direction.
- No API keys, no backend: hosted as static files on GitHub Pages.
- If any single data source fails, the rest of the page still works.

**Out of scope (v1, YAGNI)**: transfers, MRT routing, taxis, traffic cameras, carparks, notifications, multiple saved homes (home is configurable in `config.js` only).

## 2. Data sources (all verified: HTTP 200, `Access-Control-Allow-Origin: *`, no key)

| Purpose | Endpoint | Notes |
|---|---|---|
| Bus arrivals | `https://arrivelah2.busrouter.sg/?id={stopCode}` | `services[].no`, `next/subsequent.duration_ms`, `load` |
| Bus stops | `https://data.busrouter.sg/v1/stops.min.json` | `{code: [lng, lat, name, road]}` |
| Bus routes | `https://data.busrouter.sg/v1/services.min.json` | `{svc: {name, routes: [[stopCodes dir1], [dir2]?]}}` |
| Postal geocode | `https://www.onemap.gov.sg/api/common/elastic/search?searchVal={postal}&returnGeom=Y&getAddrDetails=N&pageNum=1` | `results[0].LATITUDE/LONGITUDE` |
| 2-hr forecast | `https://api.data.gov.sg/v1/environment/2-hour-weather-forecast` | `area_metadata[].label_location`, `items[0].forecasts[]` |
| Rainfall (5-min) | `https://api.data.gov.sg/v1/environment/rainfall` | stations + `items[0].readings[]` (mm) |
| Air temp | `https://api.data.gov.sg/v1/environment/air-temperature` | stations + readings (°C) |
| UV index | `https://api.data.gov.sg/v1/environment/uv-index` | `items[0].index[0].value` |
| PM2.5 | `https://api.data.gov.sg/v1/environment/pm25` | regions + `readings.pm25_one_hourly` |

Home fallback coordinates (if OneMap fails): `1.384456, 103.896253`.

## 3. Architecture

Static site, vanilla ES modules, no build step, no runtime dependencies.

```
index.html          markup shell
styles.css          mobile-first styles, light/dark
src/config.js       constants (home postal, radii, speeds, refresh interval)
src/geo.js          pure: haversine, nearest-by, walk/run minutes
src/routing.js      pure: direct-service finder over stops/services data
src/weather.js      pure: forecast-for-location, rain-now, nearest reading, region for PM2.5
src/decision.js     pure: run/walk/wait verdict + option ranking
src/api.js          fetch wrappers + 24 h localStorage cache for static bus data
src/app.js          orchestration: geolocation, fetch, render, 30 s refresh
test/*.test.js      node --test unit tests for pure modules, with fixtures
```

Pure modules have no DOM or network access, so they are unit-testable with Node's built-in runner (`node --test`), zero dev dependencies.

## 4. Core logic

### 4.1 geo.js
- `distanceM(a, b)` — haversine metres; points are `{lat, lng}`.
- `walkMin(m)` = `m × 1.3 / 80`; `runMin(m)` = `m × 1.3 / 200` (1.3 = street detour factor; 80 / 200 m/min).
- `nearest(point, items, getPoint)` — item with min distance.

### 4.2 routing.js — `findDirectOptions(origin, home, stops, services, opts)`
1. `originStops` = stops within `ORIGIN_RADIUS_M` (500 m) of origin; `homeStops` = stops within `HOME_RADIUS_M` (400 m) of home.
2. For each service, for each direction `route` (array of stop codes): for each index `i` where `route[i]` ∈ originStops, find the smallest `j > i` with `route[j]` ∈ homeStops. If found → candidate `{service, boardStop: route[i], alightStop: route[j], stopsCount: j − i}`.
3. Loop routes (first stop == last stop) are handled naturally by index order.
4. Deduplicate per (service, boardStop) keeping the smallest `stopsCount`.
5. If origin is itself within `HOME_RADIUS_M` of home → return `{atHome: true}`.
Returns candidates sorted by board-stop walking distance.

### 4.3 weather.js
- `forecastFor(point, forecastJson)` → nearest area's forecast text (e.g. "Heavy Thundery Showers").
- `isWetForecast(text)` → true if text matches `/rain|shower|thunder/i`.
- `rainNow(point, rainfallJson)` → mm at nearest station (last 5 min); `raining` if > 0.
- `nearestReading(point, json)` for air temperature; `pm25Region(point, json)` → nearest region's value; `uv(json)` → latest value.

### 4.4 decision.js
For each candidate with live arrival data:
- `walk = walkMin(dist to boardStop)`, `run = runMin(...)`, `eta1/eta2` = next/subsequent minutes (from `duration_ms`, floored at 0).
- Choose the bus the user can catch:
  - `eta1 ≥ walk` → **WALK**, catch bus 1.
  - `run ≤ eta1 < walk` → **RUN**, catch bus 1.
  - else → **WAIT**, catch bus 2 if it is reachable (`eta2 ≥ run`); otherwise drop the option.
- `rideMin = stopsCount × 2`; `totalMin = etaCaught + rideMin` (the caught bus is always reachable, so you board when it arrives).
- Rank options by `totalMin`; best = first.

Rain modifier (applied to the best option's message), `wet = isWetForecast || raining`:
- RUN + wet → "RUN — rain is coming, catch this one."
- WALK + wet → "Walk briskly — rain expected." 
- WAIT + raining → "Stay sheltered — next bus in N min."
- WAIT + wet forecast (not raining yet) → "Shelter at the stop — rain on the way."
- dry → plain verdict.

## 5. UI

Single screen, mobile-first:
1. **Verdict card** — big word (RUN / WALK / WAIT), bus number, stop code + name, "bus in X min · Y min walk · ~Z min home", rain message.
2. **Other options** — up to 3 more ranked rows (service, stop, ETA, total).
3. **Weather strip** — forecast text, rain now (mm), °C, UV, PM2.5.
4. Footer — last updated time, data credits, link to `https://busrouter.sg/#/stops/{code}`.

Refresh: arrivals + weather every 30 s while the tab is visible; re-read GPS each refresh (`watchPosition` not required).

## 6. Error handling

| Situation | Behaviour |
|---|---|
| Geolocation denied/unavailable | Show input: "Enter a postal code or bus stop code" → geocode via OneMap / stop lookup |
| Already within 400 m of home | "You're home already 🏠" |
| No direct service within 500 m | "No direct bus from here" + 3 nearest stops with link to busrouter.sg |
| Arrival API fails for a stop | Skip that option; if all fail → "Arrival data unavailable" |
| A weather endpoint fails | That weather item shows "—"; decision treats as dry |
| OneMap fails | Use hard-coded home fallback coordinates |
| Static bus data fetch fails, cache present | Use stale cache |

## 7. Testing

- TDD for `geo`, `routing`, `weather`, `decision` with small hand-written fixtures (a few stops/services, sample API JSON).
- `npm test` → `node --test test/` (package.json has no dependencies).
- Manual browser check with live data via a local static server (`npx serve .` or `python -m http.server`), including GPS-denied path.

## 8. Docs & deployment

- `README.md` — what it does, screenshot-free usage, data sources & credits, local run, tests, deploy.
- `CLAUDE.md` — architecture map, conventions (pure modules, no deps, no build), test command, git rule (branch + PR, never commit to `main`).
- Public GitHub repo `escape-from-ct-hub` under the user's account; work on `feat/escape-from-ct-hub`, PR to `main`, GitHub Pages serves from `main` root.
