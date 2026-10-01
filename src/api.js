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
