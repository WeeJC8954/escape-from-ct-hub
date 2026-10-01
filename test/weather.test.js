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
