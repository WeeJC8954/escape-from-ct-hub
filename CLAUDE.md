# Escape from CT Hub

Static web app: from the user's GPS location, pick the direct bus home (postal 542268), show live arrival times, and say WALK / RUN / WAIT with rain-aware advice. Hosted on GitHub Pages, with no backend and no API keys.

## Commands

- `npm test`: run unit tests (Node built-in `node:test`, finds `test/*.test.js`)
- `npx serve .` or `python -m http.server 5173`: serve locally (geolocation needs localhost/HTTPS)

## Architecture

- `src/geo.js`, `src/routing.js`, `src/weather.js`, `src/decision.js`: **pure** logic. Data in, data out.
- `src/api.js`: every network call lives here, plus the 24 h `localStorage` cache for static busrouter data.
- `src/app.js`: the only file that touches the DOM. Handles geolocation, orchestration, rendering and the 30 s refresh.
- `src/config.js`: every tunable constant (home, radii, speeds, refresh). Don't hard-code these elsewhere.

## Conventions

- Zero dependencies and no build step. Plain ES modules served as is. Don't add npm packages or bundlers.
- Pure modules must never touch `document`, `window`, `fetch` or `localStorage`.
- Render API-sourced text with `textContent` / `el()`, never `innerHTML`.
- New logic gets a test in `test/*.test.js` with small hand-written fixtures, written first (TDD). Tests never hit live APIs. Stub `globalThis.fetch` / `globalThis.localStorage` as `test/api.test.js` does.
- One data source failing must not break the page. Degrade that panel to "—" or a message.

## Data quirks

- busrouter `stops.min.json` is `{code: [lng, lat, name, road]}`. **Longitude comes first.**
- busrouter `services.min.json` `routes` is an array of directions, each an ordered list of stop codes. Loop services start and end at the same stop.
- arrivelah `duration_ms` can be negative (bus at the stop), and `next`/`subsequent` can be missing.
- data.gov.sg v1 station readings can leave out stations that are listed in `metadata`. Always choose the nearest station *that has a reading*.

## Git workflow

- Never commit or push to `main`. Branch from `origin/main` (`feat/...`, `fix/...`), push, open a PR, merge.
- GitHub Pages deploys from the `main` branch root, so merging a PR is a deploy.

## Docs

- Design spec: `docs/superpowers/specs/2026-10-01-escape-from-ct-hub-design.md`
- Implementation plan: `docs/superpowers/plans/2026-10-01-escape-from-ct-hub.md`
