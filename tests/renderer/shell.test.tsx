// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react'
import { App } from '../../src/renderer/App'
import { PRESETS } from '../../src/shared/brand'
import type { AuthState } from '../../src/shared/ipc'
import type { Settings } from '../../src/shared/types'

const settings: Settings = {
  knowledgeFolders: ['/kb'], excludePatterns: [], mode: 'extractive',
  outOfContext: { action: 'reply', replyText: 'Maaf' }, threshold: 0.6, allowGroups: false, cooldownSec: 10,
  ai: { provider: 'claude', model: 'claude-haiku-5-5', maxTokens: 400 }, autoStart: false, theme: 'auto', notifyIncoming: true, memoryEnabled: true
}
const zero = { replied: 0, refused: 0, handoff: 0, errors: 0, links: 0 }
const off: AuthState = { enabled: false, locked: false, username: null, autoLockMin: 0 }
const on: AuthState = { enabled: true, locked: false, username: 'admin', autoLockMin: 0 }

let narrow = false
let statusCbs: ((s: unknown) => void)[] = []

function setApi(auth: AuthState = off, waiting = 0, status = 'connected') {
  statusCbs = []
  const draft = structuredClone(PRESETS.toko_online)
  const api = {
    authState: vi.fn().mockResolvedValue(auth),
    authLock: vi.fn().mockResolvedValue(undefined),
    onAuthLocked: vi.fn().mockReturnValue(() => undefined),
    getStatus: vi.fn().mockResolvedValue({ state: status }),
    onStatus: vi.fn().mockImplementation((cb) => { statusCbs.push(cb); return () => undefined }),
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn().mockImplementation(async (p) => ({ ...settings, ...p })),
    getDashboard: vi.fn().mockResolvedValue({ today: zero, week: zero, waitingAdmin: waiting, recent: [], files: { indexed: 1, failed: 0 } }),
    hasApiKey: vi.fn().mockResolvedValue(true),
    getBrand: vi.fn().mockResolvedValue({ active: draft, draft, botNumber: null, productCount: 0 }),
    saveBrandDraft: vi.fn().mockResolvedValue({ ok: true, issues: [] }),
    listBrandVersions: vi.fn().mockResolvedValue([]), listPresets: vi.fn().mockResolvedValue([]),
    listFiles: vi.fn().mockResolvedValue([]), onIndexStatus: vi.fn().mockReturnValue(() => undefined),
    getLog: vi.fn().mockResolvedValue([]), onEscalate: vi.fn().mockReturnValue(() => undefined),
    onHandoff: vi.fn().mockReturnValue(() => undefined)
  }
  ;(window as any).api = api
  return api
}

beforeEach(() => {
  narrow = false
  window.matchMedia = ((q: string) => ({
    matches: q.includes('max-width') ? narrow : false, media: q,
    addEventListener: () => undefined, removeEventListener: () => undefined
  })) as unknown as typeof window.matchMedia
})
afterEach(cleanup)

const crumbs = () =>
  within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getAllByRole('listitem')

describe('top bar and breadcrumb', () => {
  it('shows the current page in the breadcrumb, with the last item as the current page', async () => {
    setApi()
    render(<App />)
    await screen.findByRole('heading', { name: /dashboard/i })
    expect(crumbs().map((c) => c.textContent)).toEqual(['Dashboard'])
    expect(crumbs()[0].getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: /pengaturan/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Brand & Konversi' }))
    await waitFor(() => expect(crumbs().map((c) => c.textContent)).toEqual(['Pengaturan', 'Brand & Konversi']))
    expect(crumbs()[1].getAttribute('aria-current')).toBe('page')
    expect(crumbs()[0].getAttribute('aria-current')).toBeNull()
  })

  it('marks the active sidebar item with aria-current', async () => {
    setApi()
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: 'Menu utama' })
    expect(within(nav).getByRole('button', { name: 'Dashboard' }).getAttribute('aria-current')).toBe('page')
    expect(within(nav).getByRole('button', { name: 'Log' }).getAttribute('aria-current')).toBeNull()
  })

  it('shows the WhatsApp status as text in the top bar and follows status events', async () => {
    setApi(off, 0, 'disconnected')
    render(<App />)
    const bar = await screen.findByRole('banner')
    expect(await within(bar).findByText('Terputus')).toBeTruthy()
    act(() => statusCbs.forEach((cb) => cb({ state: 'connected' })))
    expect(await within(bar).findByText('Terhubung')).toBeTruthy()
  })

  it('bell announces how many chats wait for an admin and opens the dashboard', async () => {
    setApi(off, 3)
    render(<App />)
    const bell = await screen.findByRole('button', { name: 'Notifikasi: 3 chat menunggu admin' })
    fireEvent.click(screen.getByRole('button', { name: 'Log' }))
    expect(screen.queryByRole('heading', { name: /dashboard/i })).toBeNull()
    fireEvent.click(bell)
    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeTruthy()
  })

  it('bell says there are no notifications when nobody waits', async () => {
    setApi(off, 0)
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Tidak ada notifikasi' })).toBeTruthy()
  })

  it('profile menu without login only offers Keamanan & Umum', async () => {
    setApi(off)
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Menu profil' }))
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent?.trim())).toEqual(['Keamanan & Umum'])
  })

  it('profile menu with login shows the user and locks on "Kunci sekarang"', async () => {
    const api = setApi(on)
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Menu profil' }))
    expect(screen.getByText('admin')).toBeTruthy()
    api.authState.mockResolvedValue({ ...on, locked: true })
    fireEvent.click(screen.getByRole('menuitem', { name: /kunci sekarang/i }))
    await waitFor(() => expect(api.authLock).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: 'Masuk' })).toBeTruthy()
  })

  it('every icon-only button in the top bar has an accessible name', async () => {
    setApi()
    render(<App />)
    const bar = await screen.findByRole('banner')
    await within(bar).findByRole('button', { name: 'Menu profil' })
    for (const b of within(bar).getAllByRole('button'))
      expect((b.getAttribute('aria-label') ?? b.textContent ?? '').trim(), b.outerHTML).not.toBe('')
  })
})

describe('responsive drawer', () => {
  it('on wide screens the sidebar is always there and there is no menu button', async () => {
    setApi()
    render(<App />)
    expect(await screen.findByRole('navigation', { name: 'Menu utama' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Buka menu' })).toBeNull()
  })

  it('on narrow screens the sidebar is hidden until the menu button opens it as a drawer', async () => {
    narrow = true
    setApi()
    render(<App />)
    const open = await screen.findByRole('button', { name: 'Buka menu' })
    expect(screen.queryByRole('navigation', { name: 'Menu utama' })).toBeNull()
    fireEvent.click(open)
    expect(screen.getByRole('navigation', { name: 'Menu utama' })).toBeTruthy()
  })

  it('Escape closes the drawer and returns focus to the menu button', async () => {
    narrow = true
    setApi()
    render(<App />)
    const open = await screen.findByRole('button', { name: 'Buka menu' })
    fireEvent.click(open)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Menu utama' })).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Buka menu' }))
  })

  it('clicking the backdrop or choosing an item closes the drawer', async () => {
    narrow = true
    setApi()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Buka menu' }))
    fireEvent.click(screen.getByTestId('drawer-backdrop'))
    expect(screen.queryByRole('navigation', { name: 'Menu utama' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Buka menu' }))
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Menu utama' })).getByRole('button', { name: 'Log' }))
    expect(screen.queryByRole('navigation', { name: 'Menu utama' })).toBeNull()
    expect(await screen.findByRole('heading', { name: /log/i })).toBeTruthy()
  })

  it('the drawer is a modal dialog: labelled, aria-modal, focus moves in, the page behind is inert, Tab wraps', async () => {
    narrow = true
    setApi()
    const { container } = render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Buka menu' }))
    const dialog = screen.getByRole('dialog', { name: 'Menu utama' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const links = within(dialog).getAllByRole('button')
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    expect((document.activeElement as HTMLElement).textContent).toMatch(/dashboard/i)
    expect(container.querySelector('.app-main')!.hasAttribute('inert')).toBe(true)
    links[links.length - 1].focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(links[0])
    links[0].focus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(links[links.length - 1])
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(container.querySelector('.app-main')!.hasAttribute('inert')).toBe(false))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Buka menu' }))
  })
})

