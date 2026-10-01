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
