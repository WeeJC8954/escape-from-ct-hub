export const THEMES = ['auto', 'light', 'dark'];
export const THEME_KEY = 'theme';

const LABELS = { auto: '🌓 Auto', light: '☀️ Light', dark: '🌙 Dark' };

export const normalizeTheme = (value) => (THEMES.includes(value) ? value : 'auto');

export function nextTheme(current) {
  const i = THEMES.indexOf(normalizeTheme(current));
  return THEMES[(i + 1) % THEMES.length];
}

export const themeLabel = (theme) => LABELS[normalizeTheme(theme)];
