import type { Settings } from '../shared/types'

/** Applies Bootstrap's colour mode via data-bs-theme; 'auto' follows the OS preference. */
export function applyTheme(theme: Settings['theme']): void {
  const prefersDark = !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
  const dark = theme === 'dark' || (theme === 'auto' && prefersDark)
  document.documentElement.dataset.bsTheme = dark ? 'dark' : 'light'
}
