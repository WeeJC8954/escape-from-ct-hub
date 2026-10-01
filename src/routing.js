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
