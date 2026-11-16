// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { App } from '../../src/renderer/App'
import { applyCachedTheme, applyTheme, effectiveTheme } from '../../src/renderer/theme'
import type { Settings } from '../../src/shared/types'

const zero = { replied: 0, refused: 0, handoff: 0, errors: 0, links: 0 }
let current: Settings
let osDark = false
let mqListeners: (() => void)[] = []

function setApi(theme: Settings['theme']) {
  current = {
    knowledgeFolders: ['/kb'], excludePatterns: [], mode: 'extractive',
    outOfContext: { action: 'reply', replyText: 'Maaf' }, threshold: 0.6, allowGroups: false, cooldownSec: 10,
    ai: { provider: 'claude', model: 'claude-haiku-5-5', maxTokens: 400 }, autoStart: false, theme, notifyIncoming: true
  } as Settings
  const api = {
    authState: vi.fn().mockResolvedValue({ enabled: false, locked: false, username: null, autoLockMin: 0 }),
    onAuthLocked: vi.fn().mockReturnValue(() => undefined), authLock: vi.fn(),
    getStatus: vi.fn().mockResolvedValue({ state: 'connected' }), onStatus: vi.fn().mockReturnValue(() => undefined),
    getSettings: vi.fn().mockImplementation(async () => ({ ...current })),
    updateSettings: vi.fn().mockImplementation(async (p) => { current = { ...current, ...p }; return { ...current } }),
    getDashboard: vi.fn().mockResolvedValue({ today: zero, week: zero, waitingAdmin: 0, recent: [], files: { indexed: 1, failed: 0 } }),
    hasApiKey: vi.fn().mockResolvedValue(true), getBrand: vi.fn().mockRejectedValue(new Error('x')),
    listChats: vi.fn().mockResolvedValue([]), getThread: vi.fn().mockResolvedValue([]),
    onMessage: vi.fn().mockReturnValue(() => undefined)
  }
  ;(window as any).api = api
  return api
}

beforeEach(() => {
  osDark = false
  mqListeners = []
  localStorage.clear()
  delete document.documentElement.dataset.bsTheme
  window.matchMedia = ((q: string) => ({
    matches: q.includes('prefers-color-scheme') ? osDark : false,
    media: q,
    addEventListener: (_: string, cb: () => void) => { if (q.includes('prefers-color-scheme')) mqListeners.push(cb) },
    removeEventListener: () => undefined
  })) as unknown as typeof window.matchMedia
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const dataTheme = () => document.documentElement.dataset.bsTheme

async function openSecurity() {
  fireEvent.click(await screen.findByRole('button', { name: /pengaturan/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Keamanan & Umum' }))
  return screen.findByLabelText('Tema')
}

describe('theme setting', () => {
  it('applies the chosen theme at once from the settings page, without a restart', async () => {
    setApi('dark')
    render(<App />)
    await waitFor(() => expect(dataTheme()).toBe('dark'))
    const select = await openSecurity()
    fireEvent.change(select, { target: { value: 'light' } })
    await waitFor(() => expect(dataTheme()).toBe('light'))
    fireEvent.change(select, { target: { value: 'dark' } })
    await waitFor(() => expect(dataTheme()).toBe('dark'))
  })

  it('light mode works on an OS that prefers dark', async () => {
    osDark = true
    setApi('auto')
    render(<App />)
    await waitFor(() => expect(dataTheme()).toBe('dark'))
    fireEvent.change(await openSecurity(), { target: { value: 'light' } })
    await waitFor(() => expect(dataTheme()).toBe('light'))
  })

  it('follows the OS in auto mode, including when the OS preference changes', async () => {
    osDark = true
    setApi('auto')
    render(<App />)
    await waitFor(() => expect(dataTheme()).toBe('dark'))
    expect(await screen.findByRole('button', { name: 'Beralih ke mode terang' })).toBeTruthy()
    osDark = false
    act(() => mqListeners.forEach((l) => l()))
    await waitFor(() => expect(dataTheme()).toBe('light'))
    // The toggle must follow the OS too, or it would offer the mode that is already showing.
    expect(await screen.findByRole('button', { name: 'Beralih ke mode gelap' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Beralih ke mode terang' })).toBeNull()
  })
})

describe('theme toggle in the top bar', () => {
  it('flips between light and dark, saves the choice and relabels itself', async () => {
    const api = setApi('dark')
    render(<App />)
    const toggle = await screen.findByRole('button', { name: 'Beralih ke mode terang' })
    fireEvent.click(toggle)
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ theme: 'light' }))
    await waitFor(() => expect(dataTheme()).toBe('light'))
    const back = await screen.findByRole('button', { name: 'Beralih ke mode gelap' })
    fireEvent.click(back)
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ theme: 'dark' }))
    await waitFor(() => expect(dataTheme()).toBe('dark'))
  })

  it('uses the effective theme in auto mode (OS dark → offers light)', async () => {
    osDark = true
    setApi('auto')
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Beralih ke mode terang' })).toBeTruthy()
  })

  it('sits right after the notification bell, and the settings page shows the same theme', async () => {
    setApi('light')
    render(<App />)
    const bar = await screen.findByRole('banner')
    await within(bar).findByRole('button', { name: 'Beralih ke mode gelap' })
    const names = within(bar).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '')
    const bell = names.findIndex((n) => /notifikasi/i.test(n))
    expect(bell).toBeGreaterThan(-1)
    expect(names[bell + 1]).toBe('Beralih ke mode gelap')
    fireEvent.click(within(bar).getByRole('button', { name: 'Beralih ke mode gelap' }))
    const select = (await openSecurity()) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('dark'))
  })
})

describe('theme helpers', () => {
  it('effectiveTheme resolves auto from the OS', () => {
    osDark = true
    expect(effectiveTheme('auto')).toBe('dark')
    expect(effectiveTheme('light')).toBe('light')
    expect(effectiveTheme('dark')).toBe('dark')
  })

  it('applyTheme remembers the choice and applyCachedTheme restores it before the first render', () => {
    applyTheme('dark')
    expect(localStorage.getItem('wa-theme')).toBe('dark')
    delete document.documentElement.dataset.bsTheme
    applyCachedTheme()
    expect(dataTheme()).toBe('dark')
  })

  it('applyCachedTheme falls back to auto for a missing or invalid value', () => {
    osDark = false
    applyCachedTheme()
    expect(dataTheme()).toBe('light')
    localStorage.setItem('wa-theme', 'neon')
    osDark = true
    applyCachedTheme()
    expect(dataTheme()).toBe('dark')
  })

  it('survives a storage that throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => applyTheme('light')).not.toThrow()
    expect(dataTheme()).toBe('light')
    expect(() => applyCachedTheme()).not.toThrow()
  })

  it('index.html no longer declares the invalid data-bs-theme="auto"', () => {
    const html = readFileSync(join(__dirname, '../../src/renderer/index.html'), 'utf8')
    expect(html).not.toMatch(/data-bs-theme="auto"/)
  })
})
