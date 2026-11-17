// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { App } from '../../src/renderer/App'
import { PRESETS } from '../../src/shared/brand'
import type { Settings } from '../../src/shared/types'

const settings: Settings = {
  knowledgeFolders: [], excludePatterns: [], mode: 'extractive',
  outOfContext: { action: 'reply', replyText: 'Maaf' }, threshold: 0.6, allowGroups: false, cooldownSec: 10,
  ai: { provider: 'claude', model: 'claude-haiku-5-5', maxTokens: 400 }, autoStart: false, theme: 'auto', notifyIncoming: true, memoryEnabled: true
}
const period = { replied: 0, refused: 0, handoff: 0, errors: 0, links: 0 }

function setApi() {
  const draft = structuredClone(PRESETS.toko_online)
  const api = {
    listChats: vi.fn().mockResolvedValue([]), getThread: vi.fn().mockResolvedValue([]),
    onMessage: vi.fn().mockReturnValue(() => undefined),
    onAuthLocked: vi.fn().mockReturnValue(() => undefined),
    authState: vi.fn().mockResolvedValue({ enabled: false, locked: false, username: null, autoLockMin: 0 }),
    getStatus: vi.fn().mockResolvedValue({ state: 'disconnected' }),
    onStatus: vi.fn().mockReturnValue(() => undefined),
    connect: vi.fn(), logout: vi.fn(),
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn().mockImplementation(async (p) => ({ ...settings, ...p })),
    pickFolder: vi.fn(), listFiles: vi.fn().mockResolvedValue([]), reindex: vi.fn(),
    onIndexStatus: vi.fn().mockReturnValue(() => undefined),
    testQuestion: vi.fn(), saveApiKey: vi.fn(), hasApiKey: vi.fn().mockResolvedValue(false),
    deleteApiKey: vi.fn(), openConsole: vi.fn(), getLog: vi.fn().mockResolvedValue([]),
    onEscalate: vi.fn().mockReturnValue(() => undefined), onHandoff: vi.fn().mockReturnValue(() => undefined),
    getDashboard: vi.fn().mockResolvedValue({ today: period, week: period, waitingAdmin: 0, recent: [], files: { indexed: 0, failed: 0 } }),
    getBrand: vi.fn().mockResolvedValue({ active: draft, draft, botNumber: null, productCount: 0 }),
    saveBrandDraft: vi.fn().mockResolvedValue({ ok: true, issues: [] }),
    applyBrand: vi.fn(), listBrandVersions: vi.fn().mockResolvedValue([]), restoreBrandVersion: vi.fn(),
    exportBrand: vi.fn(), importBrand: vi.fn(), previewChat: vi.fn(),
    listPresets: vi.fn().mockResolvedValue([{ id: 'kustom', label: 'Kustom' }]), loadPreset: vi.fn()
  }
  ;(window as any).api = api
  return api
}

beforeEach(() => {
  // jsdom has no matchMedia; App listens to it when the theme is "auto".
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined
  })) as unknown as typeof window.matchMedia
  setApi()
})
afterEach(cleanup)

const SUBMENU = ['Connector', 'Pengetahuan', 'Brand & Konversi', 'Keamanan & Umum']
const navButton = (name: string) => screen.queryByRole('button', { name: new RegExp(`^\\s*${name.replace(/[&]/g, '\\$&')}\\s*$`) })

describe('navigation', () => {
  it('starts on the dashboard and keeps the settings submenu collapsed', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeTruthy()
    expect(navButton('Uji Jawaban')).toBeTruthy()
    expect(navButton('Log')).toBeTruthy()
    expect(navButton('Pengaturan')).toBeTruthy()
    for (const s of SUBMENU) expect(navButton(s)).toBeNull()
  })

  it('opens the settings group with its four submenus, and drops the old Aturan/Koneksi/AI entries', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /pengaturan/i }))
    for (const s of SUBMENU) expect(navButton(s)).toBeTruthy()
    for (const gone of ['Aturan', 'Koneksi', 'AI']) expect(navButton(gone)).toBeNull()
  })

  it('Connector has WhatsApp and AI tabs', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /pengaturan/i }))
    fireEvent.click(navButton('Connector')!)
    expect(await screen.findByRole('tab', { name: 'WhatsApp' })).toBeTruthy()
    expect(await screen.findByText(/koneksi whatsapp/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'AI' }))
    expect(await screen.findByText(/connector ai/i)).toBeTruthy()
  })

  it('Brand & Konversi holds the reply behaviour tab (former Aturan), without the auto-start switch', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /pengaturan/i }))
    fireEvent.click(navButton('Brand & Konversi')!)
    fireEvent.click(await screen.findByRole('tab', { name: 'Perilaku balasan' }))
    expect(await screen.findByLabelText(/teks penolakan/i)).toBeTruthy()
    expect(screen.queryByLabelText(/jalankan saat login/i)).toBeNull()
  })

  it('keeps the settings group open while moving between submenus', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /pengaturan/i }))
    fireEvent.click(navButton('Pengetahuan')!)
    fireEvent.click(navButton('Keamanan & Umum')!)
    for (const s of SUBMENU) expect(navButton(s)).toBeTruthy()
  })

  it('Keamanan & Umum has the theme and auto-start settings', async () => {
    const api = setApi()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /pengaturan/i }))
    fireEvent.click(navButton('Keamanan & Umum')!)
    fireEvent.click(await screen.findByLabelText(/jalankan saat login/i))
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ autoStart: true }))
    fireEvent.change(screen.getByLabelText(/tema/i), { target: { value: 'dark' } })
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ theme: 'dark' }))
  })

  it('has Pesan, Kontak and Broadcast entries between Dashboard and Uji Jawaban; Pesan opens the live messages page', async () => {
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: 'Menu utama' })
    const names = within(nav).getAllByRole('button').map((b) => b.textContent?.trim())
    expect(names.slice(0, 6)).toEqual(['Dashboard', 'Pesan', 'Kontak', 'Broadcast', 'Uji Jawaban', 'Log'])
    fireEvent.click(within(nav).getByRole('button', { name: 'Pesan' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Pesan' })).toBeTruthy()
  })
})

