import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { id } from '../../src/client/i18n/id'

const root = join(__dirname, '../..')
const read = (p: string): string => readFileSync(join(root, p), 'utf8')
const TAGLINE = 'Balas WA Otomatis pakai AI'

describe('app name and tagline', () => {
  it('uses the agreed brand in the interface text', () => {
    expect(id.appName).toBe('AutoBot')
    expect(id.tagline).toBe(TAGLINE)
  })
  it('titles the web page with the brand', () => {
    expect(read('src/app/layout.tsx')).toContain(`title: 'AutoBot — ${TAGLINE}'`)
  })
  it('shows the tagline in the sidebar from one source', () => {
    expect(read('src/client/shell/Sidebar.tsx')).toContain('id.tagline')
  })
  it('does not call the product "WA Otomation"', () => {
    for (const f of ['src/client/i18n/id.ts', 'src/app/layout.tsx', 'package.json']) expect(read(f), f).not.toMatch(/WA Otomation/)
  })
})

describe('form boxes', () => {
  const css = read('src/client/styles/forms.css').replace(/\/\*[\s\S]*?\*\//g, '')
  it('has no literal colours', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
  })
  it('is loaded after the tokens and ui styles', () => {
    const l = read('src/app/layout.tsx')
    expect(l.indexOf('forms.css')).toBeGreaterThan(l.indexOf('ui.css'))
    expect(l.indexOf('ui.css')).toBeGreaterThan(l.indexOf('tokens.css'))
  })
})

describe('login design', () => {
  it('has no animated backdrop or gradients', () => {
    const ui = read('src/client/styles/ui.css')
    expect(ui).not.toMatch(/ai-backdrop|ai-flow|login-hero|login-points/)
    expect(read('src/client/styles/tokens.css')).not.toMatch(/--login-/)
  })
})
