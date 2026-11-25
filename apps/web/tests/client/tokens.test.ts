import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(__dirname, '../../src/client/styles')
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
      '--color-primary': '#1F4D38', '--color-primary-dark': '#163A29', '--color-primary-light': '#E1E5CF',
      '--color-background': '#EDE6D6', '--color-surface': '#F7F3EA', '--color-border': '#D9CFB8',
      '--color-text-primary': '#1C2A22', '--color-text-secondary': '#8A8570',
      '--color-success': '#7FA33A', '--color-warning': '#D9A22E', '--color-danger': '#F24A2B',
      '--radius-control': '6px', '--radius-card': '10px',
      '--space-1': '4px', '--space-2': '8px', '--space-3': '12px', '--space-4': '16px',
      '--space-5': '20px', '--space-6': '24px', '--space-8': '32px',
      '--shadow-card': '0 2px 8px rgba(60, 50, 20, 0.08)'
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

  it('solid status fills (danger/success buttons, bell count) keep readable text in both palettes', () => {
    const shell = readFileSync(join(dir, 'shell.css'), 'utf8')
    const rule = (css: string, sel: string): string => {
      const at = css.indexOf('\n' + sel + ' {')
      return css.slice(at, css.indexOf('}', at))
    }
    // The text colour on a solid status fill must be the soft status colour, never a fixed white.
    expect(rule(tokens, '.btn-danger')).toMatch(/--bs-btn-color:\s*var\(--color-danger-soft\)/)
    expect(rule(tokens, '.btn-success')).toMatch(/--bs-btn-color:\s*var\(--color-success-soft\)/)
    expect(rule(shell, '.topbar-count')).toMatch(/color:\s*var\(--color-danger-soft\)/)
    for (const t of [light, { ...light, ...dark }])
      for (const k of ['danger', 'success'])
        expect(contrast(t[`--color-${k}-soft`], t[`--color-${k}-text`]), `${k} soft on text`).toBeGreaterThanOrEqual(4.5)
  })

  it('has a derived control-border token that reaches 3:1 (WCAG 1.4.11) and is used by checkboxes and switches', () => {
    expect(tokens).toMatch(/DERIVED[^\n]*control border/i)
    for (const t of [light, { ...light, ...dark }])
      for (const bg of [t['--color-surface'], t['--color-background']])
        expect(contrast(t['--color-control-border'], bg), `control border on ${bg}`).toBeGreaterThanOrEqual(3)
    const rule = tokens.slice(tokens.indexOf('\n.form-check-input {'), tokens.indexOf('}', tokens.indexOf('\n.form-check-input {')))
    expect(rule).toMatch(/border-color:\s*var\(--color-control-border\)/)
  })

  it('overrides every Bootstrap focus style with the token outline and keeps inputs on the surface colour', () => {
    const rules = [...tokens.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1], body: m[2] }))
    for (const sel of ['.btn:focus-visible', '.nav-link:focus-visible', '.form-check-input:focus', '.form-control:focus', '.form-select:focus']) {
      const hit = rules.find((r) => r.sel.split(',').map((s) => s.trim()).includes(sel))
      expect(hit, sel).toBeDefined()
      expect(hit!.body, sel).toMatch(/outline:\s*2px solid var\(--color-primary-text\)/)
      expect(hit!.body, sel).toMatch(/box-shadow:\s*none/)
    }
    const input = rules.find((r) => r.sel.split(',').map((s) => s.trim()).includes('.form-control:focus'))!
    expect(input.body).toMatch(/background-color:\s*var\(--color-surface\)/)
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
