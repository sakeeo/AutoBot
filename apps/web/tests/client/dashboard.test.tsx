// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react'
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a> }))
import { DashboardPage } from '../../src/client/pages/DashboardPage'
import { PRESETS } from '@autobot/contracts/brand'
import type { DashboardData } from '@autobot/contracts/ipc'
import type { Settings } from '@autobot/contracts/types'

const base: Settings = {
  mode: 'extractive',
  outOfContext: { action: 'reply', replyText: 'Maaf' }, threshold: 0.6, allowGroups: false, cooldownSec: 10,
  ai: { provider: 'claude', model: 'claude-haiku-5-5', maxTokens: 400 }, theme: 'auto', notifyIncoming: true, memoryEnabled: true
}
const zero = { replied: 0, refused: 0, handoff: 0, errors: 0, links: 0 }
const empty: DashboardData = { today: zero, week: zero, trend: [], waitingAdmin: 0, recent: [], files: { indexed: 0, failed: 0 } }
const withAdmin = () => {
  const p = structuredClone(PRESETS.jasa_agensi)
  p.admins = [{ id: 'a1', name: 'Budi', number: '6281234567890', notifyWhatsapp: true }]
  return p
}

function setApi(over: { data?: DashboardData; settings?: Partial<Settings>; key?: boolean; admins?: boolean; status?: unknown; bot?: boolean } = {}) {
  let bot = over.bot ?? true
  const profile = over.admins === false ? { ...withAdmin(), admins: [] } : withAdmin()
  const listeners: ((s: unknown) => void)[] = []
  const api = {
    getDashboard: vi.fn().mockResolvedValue(over.data ?? empty),
    getStatus: vi.fn().mockResolvedValue(over.status ?? { state: 'connected' }),
    onStatus: vi.fn().mockImplementation((cb) => { listeners.push(cb); return () => undefined }),
    getSettings: vi.fn().mockResolvedValue({ ...base, ...over.settings }),
    hasApiKey: vi.fn().mockResolvedValue(over.key ?? true),
    getBotEnabled: vi.fn().mockImplementation(async () => bot),
    setBotEnabled: vi.fn().mockImplementation(async (on: boolean) => (bot = on)),
    getBrand: vi.fn().mockResolvedValue({ active: profile, draft: profile, botNumber: null, productCount: 0 })
  }
  ;(window as any).api = api
  return { api, emit: (s: unknown) => listeners.forEach((l) => l(s)) }
}

beforeEach(() => setApi())
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('DashboardPage', () => {
  const quick = () => screen.findByRole('region', { name: 'Mulai cepat' })

  it('says the bot is off and switches it on from the Mulai cepat card', async () => {
    const { api } = setApi({ bot: false })
    render(<DashboardPage />)
    const card = await quick()
    expect(within(card).getByText(/bot nonaktif/i)).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Aktifkan bot' }))
    await waitFor(() => expect(api.setBotEnabled).toHaveBeenCalledWith(true))
    expect(await within(card).findByText(/bot aktif/i)).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Matikan bot' })).toBeTruthy()
  })

  it('lists what is missing, each with a button to the page that fixes it, and follows the WhatsApp status', async () => {
    const { emit } = setApi({ admins: false, status: { state: 'disconnected' } })
    localStorage.clear()
    render(<DashboardPage />)
    const card = await quick()
    await within(card).findByText('Admin dikabari saat chat diserahkan')
    expect(within(card).getByRole('link', { name: 'Hubungkan' }).getAttribute('href')).toBe('/pengaturan/connector')
    expect(within(card).getByRole('link', { name: 'Tambah' }).getAttribute('href')).toBe('/pengaturan/pengetahuan')
    expect(within(card).getByRole('link', { name: 'Atur' }).getAttribute('href')).toBe('/pengaturan/brand')
    expect(within(card).getByRole('link', { name: 'Buka Uji' }).getAttribute('href')).toBe('/uji')
    emit({ state: 'connected' })
    await waitFor(() => expect(within(card).queryByRole('link', { name: 'Hubungkan' })).toBeNull())
  })

  it('hides the checklist once everything is done', async () => {
    setApi({ data: { ...empty, files: { indexed: 3, failed: 0 } } })
    localStorage.setItem('autobot-tested', '1')
    render(<DashboardPage />)
    const card = await quick()
    await waitFor(() => expect(within(card).queryByText(/selesaikan langkah ini/i)).toBeNull())
    localStorage.clear()
  })

  it('warns when AI mode has no key', async () => {
    setApi({ settings: { mode: 'ai' }, key: false })
    render(<DashboardPage />)
    expect(await screen.findByText(/api key belum diatur/i)).toBeTruthy()
    cleanup()
    setApi({ settings: { mode: 'ai' }, key: true })
    render(<DashboardPage />)
    await quick()
    expect(screen.queryByText(/api key belum diatur/i)).toBeNull()
  })

  it('shows the four numbers of the day', async () => {
    setApi({ data: { ...empty, today: { replied: 12, refused: 3, handoff: 2, errors: 3, links: 4 }, waitingAdmin: 1, incomingToday: 25, leads: 7 } })
    render(<DashboardPage />)
    await screen.findByText('Pesan masuk hari ini')
    const metric = (label: string) => screen.getByText(label).parentElement as HTMLElement
    await waitFor(() => expect(within(metric('Pesan masuk hari ini')).getByText('25')).toBeTruthy())
    await waitFor(() => expect(metric('Dibalas bot').textContent).toMatch(/60%/))
    expect(metric('Diserahkan ke admin').textContent).toMatch(/1 masih menunggu admin/)
    await waitFor(() => expect(within(metric('Lead terkumpul')).getByText('7')).toBeTruthy())
  })

  it('shows an empty-state line when there is no activity', async () => {
    render(<DashboardPage />)
    expect(await screen.findByText(/belum ada aktivitas/i)).toBeTruthy()
  })

  it('lists recent activity with time, customer, message and a plain-language decision that opens the chat', async () => {
    setApi({
      data: {
        ...empty,
        recent: [{ message_id: '1', chat_id: '62812@s.whatsapp.net', decision: 'handoff:komplain', top_score: null,
          sources: null, created_at: 1700000000000, text: 'barang rusak' }]
      }
    })
    render(<DashboardPage />)
    expect(await screen.findByText(/barang rusak/)).toBeTruthy()
    expect(screen.getByText('Diserahkan: komplain').className).toMatch(/badge/)
    expect(screen.getByRole('link', { name: 'Buka chat 62812' }).getAttribute('href')).toBe('/pesan?chat=62812%40s.whatsapp.net')
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
})
