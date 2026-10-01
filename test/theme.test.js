import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTheme, normalizeTheme, themeLabel } from '../src/theme.js';

test('nextTheme cycles auto → light → dark → auto', () => {
  assert.equal(nextTheme('auto'), 'light');
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(nextTheme('dark'), 'auto');
});

test('normalizeTheme falls back to auto for unknown or missing values', () => {
  assert.equal(normalizeTheme('dark'), 'dark');
  assert.equal(normalizeTheme('purple'), 'auto');
  assert.equal(normalizeTheme(null), 'auto');
});

test('nextTheme treats an invalid current value as auto', () => {
  assert.equal(nextTheme('bogus'), 'light');
});

test('themeLabel describes the current mode', () => {
  assert.equal(themeLabel('auto'), '🌓 Auto');
  assert.equal(themeLabel('light'), '☀️ Light');
  assert.equal(themeLabel('dark'), '🌙 Dark');
});
