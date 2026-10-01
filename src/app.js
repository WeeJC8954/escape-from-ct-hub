import { HOME_POSTAL, HOME_FALLBACK, REFRESH_MS, MAX_ARRIVAL_STOPS, GPS_FALLBACK_MS } from './config.js';
import { createSequencer, resolveOrigin } from './refresh.js';
import { THEME_KEY, nextTheme, normalizeTheme, themeLabel } from './theme.js';
import { parseStops, findDirectOptions } from './routing.js';
import { getStopsRaw, getServices, getArrivals, geocodePostal, getWeather } from './api.js';
import { forecastFor, isWetForecast, stationReading, uvNow, pm25For } from './weather.js';
import { rankOptions, adviceFor } from './decision.js';

const $ = (id) => document.getElementById(id);
const state = { stops: null, services: null, home: null, manualOrigin: null, lastGps: null, running: false, seq: createSequencer(), timer: null };

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
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
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

async function locate(token) {
  if (state.manualOrigin) return state.manualOrigin;
  let fix = null;
  try {
    fix = await getGps();
    state.lastGps = { origin: fix, t: Date.now() };
  } catch {
    // Fall through to the last known fix.
  }
  if (!state.seq.isCurrent(token)) return null;
  const resolved = resolveOrigin(fix, state.lastGps, Date.now(), GPS_FALLBACK_MS);
  if (!resolved) {
    $('manual').hidden = false;
    $('where').textContent = 'Location unavailable';
    renderMessage('Enter a postal code or bus stop code below.');
    return null;
  }
  const { lat, lng } = resolved.origin;
  $('where').textContent = `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}${resolved.stale ? ' (last known)' : ''}`;
  return resolved.origin;
}

async function refresh() {
  const token = state.seq.next();
  const isCurrent = () => state.seq.isCurrent(token);
  state.running = true;
  try {
    await loadStatic();
    if (!isCurrent()) return;
    const origin = await locate(token);
    if (!origin || !isCurrent()) return;

    const weatherPromise = getWeather();
    const route = findDirectOptions(origin, state.home, state.stops, state.services);
    const codes = [...new Set(route.options.map((o) => o.boardStop.code))].slice(0, MAX_ARRIVAL_STOPS);
    const arrivalsPromise = Promise.allSettled(codes.map((c) => getArrivals(c)));
    const weather = await weatherPromise;
    if (!isCurrent()) return;
    const rain = renderWeather(origin, weather);

    if (route.atHome) return renderMessage("You're home already 🏠");
    if (route.options.length === 0) {
      const list = el('ul', {}, ...route.nearbyStops.slice(0, 3).map((s) => el('li', {}, stopLink(s))));
      return renderMessage('No direct bus home from here.', route.nearbyStops.length ? list : el('p', { className: 'muted' }, 'No bus stops within 500 m.'));
    }

    const settled = await arrivalsPromise;
    if (!isCurrent()) return;
    const arrivalsByStop = Object.fromEntries(codes.map((c, i) => [c, settled[i].status === 'fulfilled' ? settled[i].value : null]));
    const ranked = rankOptions(route.options.filter((o) => codes.includes(o.boardStop.code)), arrivalsByStop);

    if (ranked.length === 0) return renderMessage('Arrival data unavailable right now. Try again shortly.');
    renderBest(ranked[0], rain);
    renderOthers(ranked.slice(1, 4));
  } catch (err) {
    console.error(err);
    if (isCurrent()) renderMessage('Something went wrong loading bus data. Check your connection and refresh.');
  } finally {
    if (isCurrent()) {
      state.running = false;
      $('updated').textContent = new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
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

function readTheme() {
  try {
    return normalizeTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return 'auto';
  }
}

function applyTheme(theme) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  $('theme').textContent = themeLabel(theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage blocked: the choice lasts for this page view only.
  }
}

let theme = readTheme();
applyTheme(theme);
$('theme').addEventListener('click', () => {
  theme = nextTheme(theme);
  applyTheme(theme);
});
$('refresh').addEventListener('click', () => refresh());

refresh();
state.timer = setInterval(() => {
  if (!document.hidden && !state.running) refresh();
}, REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh();
});
