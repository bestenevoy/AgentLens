import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'agentlens.theme';
let currentTheme: Theme = (localStorage.getItem(STORAGE_KEY) as Theme) || 'auto';
const listeners = new Set<() => void>();

function getEffectiveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'auto') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return theme;
}

function applyTheme(theme: Theme) {
  const effective = getEffectiveTheme(theme);
  document.documentElement.setAttribute('data-theme', effective);
}

function notify() { listeners.forEach(l => l()); }

export function setTheme(theme: Theme) {
  currentTheme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
  notify();
}

export function getTheme(): Theme { return currentTheme; }

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

// Initialize on load
applyTheme(currentTheme);

// Listen for system theme changes (affects auto mode)
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (currentTheme === 'auto') {
    applyTheme('auto');
  }
});

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, getTheme, getTheme);
  return [theme, setTheme];
}
