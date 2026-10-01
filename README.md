# 🚌 Escape from CT Hub

**Run, walk, or wait?** A phone-friendly web page that uses your GPS location to tell you which bus stop to head to, which bus goes straight home, how long until it comes, and whether to dash for it before the rain hits.

**Live site:** https://weejc8954.github.io/escape-from-ct-hub/

## What it does

1. Gets your current location from the browser (or you type a postal code or bus stop code).
2. Finds bus stops within **500 m** of you.
3. Uses busrouter.sg route data to find **direct services** that, in their direction of travel, reach a stop within **400 m of home** (postal code `542268`, 268B Compassvale Link).
4. Fetches live arrival times from arrivelah for those stops.
5. Gives a verdict, **WALK**, **RUN** or **WAIT**, ranked by estimated time to get home.
6. Checks the NEA 2-hour forecast and live rainfall nearest to you, and adjusts the advice ("RUN — rain is coming, catch this one").
7. Shows a weather strip: forecast, rain now, air temperature, UV index, PM2.5.

The page refreshes every 30 seconds while it is open.

## How the decision works

For each candidate (service + boarding stop):

| | Formula |
|---|---|
| Walk time | straight-line distance × 1.3 detour ÷ 80 m/min |
| Run time | straight-line distance × 1.3 detour ÷ 200 m/min |
| Ride time | stops to home × 2 min |

- **WALK** if the next bus arrives at or after your walking time.
- **RUN** if only running gets you there in time.
- **WAIT** for the following bus if even running misses it (only if you can reach that one).

Options are ranked by `bus arrival + ride`. Rain changes the message: wet forecast or rain falling turns "Walk" into "Walk briskly", and "Run" into "RUN — rain is coming". If you'll have to wait while it's raining, it tells you to stay sheltered.

## Data sources

All free, no API key, browser-friendly (CORS `*`):

| Data | Source |
|---|---|
| Bus arrivals | [arrivelah](https://arrivelah2.busrouter.sg/) (LTA DataMall proxy) |
| Bus stops & routes | [busrouter.sg](https://busrouter.sg) static data (`data.busrouter.sg/v1`) |
| Postal code → coordinates | [OneMap](https://www.onemap.gov.sg/) search API |
| 2-hour forecast, rainfall, air temperature, UV, PM2.5 | [data.gov.sg](https://data.gov.sg) real-time APIs (NEA) |

Thanks to [Lim Chee Aun](https://github.com/cheeaun) for busrouter.sg and arrivelah.

## Run locally

```bash
npx serve .          # or: python -m http.server 5173
```

Open `http://localhost:3000` (or `:5173`). Browsers only allow geolocation on `localhost` or HTTPS.

## Tests

```bash
npm test             # Node 20+; uses the built-in node:test runner, no dependencies
```

The pure logic modules (geo, routing, weather, decision) and the API cache are unit-tested with fixtures. Tests never call live APIs.

## Configuration

Edit `src/config.js`. For example, set `HOME_POSTAL` (and `HOME_FALLBACK`) to use a different home, or change the search radii and walking speeds.

## Project structure

```
index.html          page shell
styles.css          mobile-first styles, light/dark
src/config.js       constants (home, radii, speeds, refresh)
src/geo.js          distance, walk/run minutes, nearest point
src/routing.js      direct-service finder
src/weather.js      forecast / rainfall / temperature / UV / PM2.5 helpers
src/decision.js     WALK / RUN / WAIT verdict and ranking
src/refresh.js      refresh sequencing + last-known GPS fallback
src/api.js          fetch wrappers + 24 h localStorage cache
src/app.js          geolocation, orchestration, rendering
test/               node:test unit tests
docs/superpowers/   design spec and implementation plan
```

## Limitations

- **Direct buses only.** No transfers or MRT. If no direct bus serves a stop within 500 m, it says so and lists the nearest stops.
- Ride time is a rough 2 min/stop estimate, and walking uses straight-line distance × 1.3.
- Arrival times are the operators' estimates. Buses not tracked by GPS can be less accurate.

## Deploy

GitHub Pages serves the `main` branch root as is, with no build step. Changes go in through pull requests.
