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
