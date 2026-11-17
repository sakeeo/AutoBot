import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { id } from '../src/renderer/i18n/id'
import { incomingNotification } from '../src/main/notify'

const root = join(__dirname, '..')
const read = (p: string): string => readFileSync(join(root, p), 'utf8')
const TAGLINE = 'Balas WA Otomatis pakai AI'

describe('app name and tagline', () => {
  it('uses the agreed brand in the interface text', () => {
    expect(id.appName).toBe('AutoBot')
    expect(id.tagline).toBe(TAGLINE)
  })
  it('names the app in package.json (display name and description)', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.name).toBe('autobot')
    expect(pkg.productName).toBe('AutoBot')
    expect(pkg.description).toContain(TAGLINE)
  })
  it('keeps the lock file in step with the package name', () => {
    const lock = JSON.parse(read('package-lock.json'))
    expect(lock.name).toBe('autobot')
    expect(lock.packages[''].name).toBe('autobot')
  })
  it('names the installer, shortcut and bundle id', () => {
    const y = read('electron-builder.yml')
    expect(y).toMatch(/^productName: AutoBot$/m)
    expect(y).toMatch(/^appId: id\.kerabatkoding\.autobot$/m)
    expect(y).toMatch(/shortcutName: AutoBot/)
    expect(y).toMatch(/executableName: autobot/)
  })
  it('titles the web page and the window with the brand', () => {
    expect(read('src/renderer/index.html')).toMatch(/<title>AutoBot — Balas WA Otomatis pakai AI<\/title>/)
    expect(read('src/main/index.ts')).toMatch(/title: 'AutoBot'/)
    expect(read('src/main/index.ts')).toMatch(/setAppUserModelId\('id\.kerabatkoding\.autobot'\)/)
  })
  it('names the tray tooltip and menu', () => {
    const t = read('src/main/tray.ts')
    expect(t).toContain(`setToolTip('AutoBot — ${TAGLINE}')`)
    expect(t).toContain("label: 'Buka AutoBot'")
  })
  it('uses the brand on a locked-screen notification', () => {
    const n = incomingNotification(
      { id: 1, chatId: '6281@s.whatsapp.net', direction: 'in', text: 'halo', at: 1000, isGroup: false },
      { enabled: true, locked: true, now: 1000 }
    )
    expect(n?.title).toBe('AutoBot')
  })
  it('shows the tagline in the sidebar and on the lock screen from one source', () => {
    expect(read('src/renderer/shell/Sidebar.tsx')).toContain('id.tagline')
    expect(read('src/renderer/LockScreen.tsx')).toContain('id.tagline')
  })
  it('no longer calls the product "WA Otomation" in code, configuration or the PRD', () => {
    for (const f of ['src/main/index.ts', 'src/main/tray.ts', 'src/main/notify.ts', 'src/renderer/i18n/id.ts', 'src/renderer/index.html',
      'package.json', 'electron-builder.yml', 'PRD.md'])
      expect(read(f), f).not.toMatch(/WA Otomation/)
  })
  it('keeps the existing data folder, so renaming the app does not hide the user\'s sessions and database', () => {
    const main = read('src/main/index.ts')
    expect(main).toMatch(/app\.setPath\('userData', join\(app\.getPath\('appData'\), 'wa-otomation'\)\)/)
    expect(main.indexOf("app.setPath('userData'")).toBeLessThan(main.indexOf('requestSingleInstanceLock'))
  })
})

describe('larger form boxes', () => {
  const css = (): string => (existsSync(join(root, 'src/renderer/styles/forms.css')) ? read('src/renderer/styles/forms.css') : '')
  const rule = (sel: string): string => {
    const text = css().replace(/\/\*[\s\S]*?\*\//g, '')
    const at = text.indexOf(sel + ' {')
    return at < 0 ? '' : text.slice(at, text.indexOf('}', at))
  }
  const px = (r: string, prop: string): number => Number(new RegExp(`${prop}:\\s*(\\d+)px`).exec(r)?.[1] ?? NaN)

  it('makes inputs and selects 40 px tall, the top of the design guide range (32–40 px), with 14 px text', () => {
    const r = rule('.form-control, .form-select')
    expect(px(r, 'min-height')).toBe(40)
    expect(r).toMatch(/font-size:\s*0\.875rem/)
  })
  it('gives text areas more room', () => {
    expect(px(rule('textarea.form-control'), 'min-height')).toBeGreaterThanOrEqual(96)
  })
  it('keeps small controls inside the guide range', () => {
    expect(px(rule('.form-control-sm, .form-select-sm'), 'min-height')).toBeGreaterThanOrEqual(32)
  })
  it('enlarges checkboxes and switches', () => {
    expect(rule('.form-check-input')).toMatch(/width:\s*1\.25em/)
  })
  it('has no literal colours and is loaded after the tokens', () => {
    expect(css()).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
    const main = read('src/renderer/main.tsx')
    expect(main.indexOf("./styles/forms.css")).toBeGreaterThan(main.indexOf("./styles/ui.css"))
  })
})

describe('clean login design', () => {
  it('has no animated backdrop, gradients or login-only colour set', () => {
    const lock = read('src/renderer/LockScreen.tsx')
    expect(lock).not.toMatch(/AiBackdrop/)
    expect(lock).not.toMatch(/login-points|login-hero/)
    const ui = read('src/renderer/styles/ui.css')
    expect(ui).not.toMatch(/ai-backdrop|ai-flow|ai-twinkle|login-hero|login-points/)
    const login = ui.slice(ui.indexOf('.login-screen'))
    expect(login).not.toMatch(/gradient|animation|keyframes/)
    expect(read('src/renderer/styles/tokens.css')).not.toMatch(/--login-/)
  })
  it('centres one card on the normal page background', () => {
    const ui = read('src/renderer/styles/ui.css').replace(/\/\*[\s\S]*?\*\//g, '')
    const at = ui.indexOf('.login-screen {')
    const rule = ui.slice(at, ui.indexOf('}', at))
    expect(rule).toMatch(/align-items:\s*center/)
    expect(rule).toMatch(/justify-content:\s*center/)
    expect(rule).toMatch(/background:\s*var\(--color-background\)/)
  })
})

