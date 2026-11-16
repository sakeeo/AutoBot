// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react'
import { DashboardPage } from '../../src/renderer/pages/DashboardPage'
import { PRESETS } from '../../src/shared/brand'
import type { DashboardData } from '../../src/shared/ipc'
import type { Settings } from '../../src/shared/types'

const base: Settings = {
  knowledgeFolders: ['/data/kb'], excludePatterns: [], mode: 'extractive',
  outOfContext: { action: 'reply', replyText: 'Maaf' }, threshold: 0.6, allowGroups: false, cooldownSec: 10,
  ai: { provider: 'claude', model: 'claude-haiku-5-5', maxTokens: 400 }, autoStart: false, theme: 'auto', notifyIncoming: true
}
const zero = { replied: 0, refused: 0, handoff: 0, errors: 0, links: 0 }
const empty: DashboardData = { today: zero, week: zero, waitingAdmin: 0, recent: [], files: { indexed: 0, failed: 0 } }
const withAdmin = () => {
  const p = structuredClone(PRESETS.jasa_agensi)
  p.admins = [{ id: 'a1', name: 'Budi', number: '6281234567890', notifyWhatsapp: true }]
  return p
}

function setApi(over: { data?: DashboardData; settings?: Partial<Settings>; key?: boolean; admins?: boolean; status?: unknown } = {}) {
  const profile = over.admins === false ? { ...withAdmin(), admins: [] } : withAdmin()
  const listeners: ((s: unknown) => void)[] = []
  const api = {
    getDashboard: vi.fn().mockResolvedValue(over.data ?? empty),
    getStatus: vi.fn().mockResolvedValue(over.status ?? { state: 'connected' }),
    onStatus: vi.fn().mockImplementation((cb) => { listeners.push(cb); return () => undefined }),
    getSettings: vi.fn().mockResolvedValue({ ...base, ...over.settings }),
    hasApiKey: vi.fn().mockResolvedValue(over.key ?? true),
    getBrand: vi.fn().mockResolvedValue({ active: profile, draft: profile, botNumber: null, productCount: 0 })
  }
  ;(window as any).api = api
  return { api, emit: (s: unknown) => listeners.forEach((l) => l(s)) }
}

beforeEach(() => setApi())
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('DashboardPage', () => {
  it('shows the WhatsApp badge and follows status events', async () => {
    const { emit } = setApi({ status: { state: 'disconnected' } })
    render(<DashboardPage />)
    expect(await screen.findByText('Terputus')).toBeTruthy()
    emit({ state: 'connected' })
    expect(await screen.findByText('Terhubung')).toBeTruthy()
  })

  it('shows AI as active only when AI mode has a key', async () => {
    setApi({ settings: { mode: 'ai' }, key: true })
    render(<DashboardPage />)
    expect(await screen.findByText(/ai: aktif/i)).toBeTruthy()
    cleanup()
    setApi({ settings: { mode: 'extractive' } })
    render(<DashboardPage />)
    expect(await screen.findByText(/ai: nonaktif/i)).toBeTruthy()
  })

  it('shows today and 7-day numbers and the number waiting for an admin', async () => {
    setApi({
      data: {
        ...empty,
        today: { replied: 12, refused: 3, handoff: 2, errors: 1, links: 4 },
        week: { replied: 80, refused: 9, handoff: 6, errors: 2, links: 11 },
        waitingAdmin: 5
      }
    })
    render(<DashboardPage />)
    const today = await screen.findByRole('region', { name: 'Hari ini' })
    expect(within(today).getByText('Dibalas').nextSibling?.textContent).toBe('12')
    expect(within(today).getByText('Tautan terkirim').nextSibling?.textContent).toBe('4')
    const week = screen.getByRole('region', { name: '7 hari terakhir' })
    expect(within(week).getByText('Diserahkan ke admin').nextSibling?.textContent).toBe('6')
    expect(within(screen.getByRole('region', { name: 'Menunggu admin' })).getByText('5')).toBeTruthy()
  })

  it('shows zeros and an empty-state line when there is no activity', async () => {
    render(<DashboardPage />)
    expect(await screen.findByText(/belum ada aktivitas/i)).toBeTruthy()
    const today = screen.getByRole('region', { name: 'Hari ini' })
    expect(within(today).getByText('Dibalas').nextSibling?.textContent).toBe('0')
  })

  it('lists the recent events with their decision and message', async () => {
    setApi({
      data: {
        ...empty,
        recent: [{ message_id: '1', chat_id: '62812@s.whatsapp.net', decision: 'handoff:komplain', top_score: null,
          sources: null, created_at: 1700000000000, text: 'barang rusak' }]
      }
    })
    render(<DashboardPage />)
    expect(await screen.findByText(/handoff:komplain/)).toBeTruthy()
    expect(screen.getByText(/barang rusak/)).toBeTruthy()
  })

  it('warns about a missing admin, an AI mode without key, and no knowledge folder', async () => {
    setApi({ admins: false, settings: { mode: 'ai', knowledgeFolders: [] }, key: false })
    render(<DashboardPage />)
    expect(await screen.findByText(/belum ada admin/i)).toBeTruthy()
    expect(screen.getByText(/api key belum diatur/i)).toBeTruthy()
    expect(screen.getByText(/belum ada folder pengetahuan/i)).toBeTruthy()
  })

  it('shows no warnings when everything is set up', async () => {
    const { api } = setApi({ settings: { mode: 'ai' }, key: true })
    render(<DashboardPage />)
    await waitFor(() => expect(api.getBrand).toHaveBeenCalled())
    await screen.findByText(/ai: aktif/i)
    expect(screen.queryByText(/belum ada admin/i)).toBeNull()
    expect(screen.queryByText(/api key belum diatur/i)).toBeNull()
    expect(screen.queryByText(/belum ada folder/i)).toBeNull()
  })

  it('refreshes every 15 seconds and stops on unmount', async () => {
    const si = vi.spyOn(window, 'setInterval')
    const ci = vi.spyOn(window, 'clearInterval')
    const { unmount } = render(<DashboardPage />)
    await screen.findByText(/belum ada aktivitas/i)
    const call = si.mock.calls.find((c) => c[1] === 15_000)
    expect(call).toBeTruthy()
    const handle = si.mock.results[si.mock.calls.indexOf(call!)].value
    unmount()
    expect(ci).toHaveBeenCalledWith(handle)
  })

  it('shows a loading state while the first data is on its way', async () => {
    const { api } = setApi()
    api.getDashboard.mockReturnValue(new Promise(() => undefined))
    render(<DashboardPage />)
    expect(screen.getByRole('status').textContent).toMatch(/memuat/i)
  })

  it('shows an error state with a working retry when the data cannot be loaded', async () => {
    const { api } = setApi()
    api.getDashboard.mockRejectedValueOnce(new Error('db'))
    render(<DashboardPage />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/gagal memuat/i)
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    expect(await screen.findByText(/belum ada aktivitas/i)).toBeTruthy()
    expect(api.getDashboard).toHaveBeenCalledTimes(2)
  })

  it('shows configuration warnings as banners that can be dismissed one by one', async () => {
    setApi({ admins: false, settings: { mode: 'ai', knowledgeFolders: [] }, key: false })
    render(<DashboardPage />)
    await screen.findByText(/belum ada admin/i)
    expect(screen.getAllByRole('button', { name: 'Tutup peringatan' })).toHaveLength(3)
    fireEvent.click(screen.getAllByRole('button', { name: 'Tutup peringatan' })[0])
    expect(screen.queryByText(/belum ada admin/i)).toBeNull()
    expect(screen.getByText(/api key belum diatur/i)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Tutup peringatan' })).toHaveLength(2)
  })

  it('makes the headline number a KPI and keeps the other numbers small', async () => {
    setApi({ data: { ...empty, today: { replied: 12, refused: 3, handoff: 2, errors: 1, links: 4 } } })
    render(<DashboardPage />)
    const today = await screen.findByRole('region', { name: 'Hari ini' })
    expect((within(today).getByText('Dibalas').nextSibling as HTMLElement).className).toMatch(/kpi-value/)
    expect((within(today).getByText('Ditolak').nextSibling as HTMLElement).className).not.toMatch(/kpi-value/)
  })

  it('lists recent activity as a table with a time, a text badge for the decision and the message', async () => {
    setApi({
      data: {
        ...empty,
        recent: [{ message_id: '1', chat_id: '62812@s.whatsapp.net', decision: 'replied:ai', top_score: null,
          sources: null, created_at: 1700000000000, text: 'berapa harga?' }]
      }
    })
    render(<DashboardPage />)
    await screen.findByText(/berapa harga/)
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Waktu', 'Keputusan', 'Pesan'])
    const badge = screen.getByText('replied:ai')
    expect(badge.className).toMatch(/badge/)
  })
})
