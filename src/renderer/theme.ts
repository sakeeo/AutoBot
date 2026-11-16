import type { Settings } from '../shared/types'

const KEY = 'wa-theme'
const VALID: Settings['theme'][] = ['light', 'dark', 'auto']

/** The mode actually shown: 'auto' follows the OS preference. */
export function effectiveTheme(theme: Settings['theme']): 'light' | 'dark' {
  const prefersDark = !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
  return theme === 'dark' || (theme === 'auto' && prefersDark) ? 'dark' : 'light'
}

/** Applies Bootstrap's colour mode via data-bs-theme and remembers it for the next start. */
export function applyTheme(theme: Settings['theme']): void {
  document.documentElement.dataset.bsTheme = effectiveTheme(theme)
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* remembering the theme is a convenience only */
  }
}

/** Runs before the first render so the lock screen and the first paint already use the chosen theme. */
export function applyCachedTheme(): void {
  let theme: Settings['theme'] = 'auto'
  try {
    const saved = localStorage.getItem(KEY) as Settings['theme'] | null
    if (saved && VALID.includes(saved)) theme = saved
  } catch {
    /* fall back to auto */
  }
  document.documentElement.dataset.bsTheme = effectiveTheme(theme)
}
