import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(__dirname, '../../src/renderer/styles')
const tokens = readFileSync(join(dir, 'tokens.css'), 'utf8')

/** Custom properties declared in the first rule whose selector contains `selector`. */
function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector + ' {')
  if (start < 0) throw new Error(`no block for ${selector}`)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}
const light = block(tokens, ':root')
const dark = block(tokens, '[data-bs-theme="dark"]')

function lum(hex: string): number {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('design tokens (design-guide §11)', () => {
  it('uses the guide values exactly', () => {
    const expected: Record<string, string> = {
      '--color-primary': '#2449A8', '--color-primary-dark': '#1D3F98', '--color-primary-light': '#EAF0FC',
      '--color-background': '#F3F5F9', '--color-surface': '#FFFFFF', '--color-border': '#E7EBF1',
      '--color-text-primary': '#263247', '--color-text-secondary': '#7B8798',
      '--color-success': '#9BCB42', '--color-warning': '#E9B34A', '--color-danger': '#D97979',
      '--radius-control': '6px', '--radius-card': '10px',
      '--space-1': '4px', '--space-2': '8px', '--space-3': '12px', '--space-4': '16px',
      '--space-5': '20px', '--space-6': '24px', '--space-8': '32px',
      '--shadow-card': '0 2px 8px rgba(20, 35, 60, 0.05)'
    }
    for (const [k, v] of Object.entries(expected)) expect(light[k]?.toUpperCase(), k).toBe(v.toUpperCase())
  })

  it('maps Bootstrap variables to the tokens', () => {
    expect(light['--bs-primary']).toBe('var(--color-primary)')
    expect(light['--bs-body-bg']).toBe('var(--color-background)')
    expect(light['--bs-body-color']).toBe('var(--color-text-primary)')
    expect(light['--bs-border-color']).toBe('var(--color-border)')
    expect(light['--bs-border-radius']).toBe('var(--radius-control)')
    expect(light['--bs-font-sans-serif']).toMatch(/^"?Inter"?,/)
  })

  it('keeps every text/background pair at WCAG AA (4.5:1) in the light palette', () => {
    const t = light
    const pairs: [string, string][] = [
      [t['--color-text-primary'], t['--color-surface']], [t['--color-text-primary'], t['--color-background']],
      [t['--color-text-muted'], t['--color-surface']], [t['--color-text-muted'], t['--color-background']],
      ['#FFFFFF', t['--color-primary']], ['#FFFFFF', t['--color-primary-dark']],
      [t['--color-primary-text'], t['--color-surface']],
      ...['success', 'warning', 'danger', 'info'].map((k): [string, string] => [t[`--color-${k}-text`], t[`--color-${k}-soft`]])
    ]
    for (const [fg, bg] of pairs) expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
  })

  it('documents why a muted text token exists: the guide secondary colour is below AA', () => {
    expect(contrast(light['--color-text-secondary'], light['--color-surface'])).toBeLessThan(4.5)
    expect(tokens).toMatch(/DERIVED[^\n]*muted/i)
  })

  it('has a dark palette (derived) whose pairs are also AA', () => {
    const t = { ...light, ...dark }
    expect(dark['--color-background']).toBeDefined()
    expect(tokens).toMatch(/DERIVED[^\n]*dark/i)
    const pairs: [string, string][] = [
      [t['--color-text-primary'], t['--color-surface']], [t['--color-text-primary'], t['--color-background']],
      [t['--color-text-muted'], t['--color-surface']], [t['--color-text-muted'], t['--color-background']],
      ['#FFFFFF', t['--color-primary']], [t['--color-primary-text'], t['--color-surface']],
      ...['success', 'warning', 'danger', 'info'].map((k): [string, string] => [t[`--color-${k}-text`], t[`--color-${k}-soft`]])
    ]
    for (const [fg, bg] of pairs) expect(contrast(fg, bg), `dark ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
  })

  it('shows a visible keyboard focus indicator', () => {
    expect(tokens).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid/)
  })

  it.each(['shell.css', 'ui.css'])('never uses literal colours in %s (only var(--…))', (name) => {
    const file = join(dir, name)
    if (!existsSync(file)) return
    expect(readFileSync(file, 'utf8')).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
  })
})
