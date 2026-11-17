// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { BroadcastPage } from '../../src/renderer/pages/BroadcastPage'
import type { OverviewView, SafetyView } from '../../src/shared/broadcast'

const safety = (o: Partial<SafetyView> = {}): SafetyView => ({
  configured: true, enabled: true, tier: 'berkembang', ageDays: 45, activeDay: 2, dailyCap: 12, sentToday: 5,
  window: { start: '09:00', end: '20:00', timezone: 'Asia/Makassar' }, minGapDays: 7, ...o
})
const overview = (s: SafetyView, health: OverviewView['health'] = { level: 'aman', reason: 'Tidak ada tanda bahaya.' }): OverviewView => ({
  contacts: { aktif: 0, menunggu_persetujuan: 0, tidak_aktif: 0 }, suppressed: 0, pendingConfirm: 0, warmup: false, safety: s, health, runningCampaignId: null
})

function setApi(s: SafetyView = safety(), health?: OverviewView['health']) {
  const api = {
    bcOverview: vi.fn().mockResolvedValue(overview(s, health)),
    bcGetSafety: vi.fn().mockResolvedValue(s),
    bcSetSafety: vi.fn().mockResolvedValue({ ok: true, safety: s }),
    bcStopAll: vi.fn().mockResolvedValue(undefined),
    bcCampaigns: vi.fn().mockResolvedValue([]), bcContacts: vi.fn().mockResolvedValue([]), bcSuppressed: vi.fn().mockResolvedValue([]),
    onBroadcast: vi.fn().mockReturnValue(() => undefined)
  }
  ;(window as any).api = api
  return api
}
afterEach(cleanup)
async function openSafety() {
  render(<BroadcastPage />)
  fireEvent.click(await screen.findByRole('tab', { name: 'Keamanan' }))
}

describe('Safety tab', () => {
  it('shows the tier, today\'s cap with warm-up, the window, the gap and a text health status', async () => {
    setApi()
    await openSafety()
    expect(await screen.findByText('Berkembang (30–90 hari)')).toBeTruthy()
    expect(screen.getByText('5 dari 12 pesan hari ini')).toBeTruthy()
    expect(screen.getByText('09:00–20:00 (Asia/Makassar)')).toBeTruthy()
    expect(screen.getByText('Aman').className).toMatch(/badge/)
    expect((screen.getByLabelText('Jarak minimal per kontak (hari)') as HTMLSelectElement).value).toBe('7')
  })
  it('shows a paused status with its reason', async () => {
    setApi(safety(), { level: 'dijeda', reason: 'Tiga pengiriman gagal berturut-turut.' })
    await openSafety()
    expect(await screen.findByText('Dijeda')).toBeTruthy()
    expect(screen.getByText('Tiga pengiriman gagal berturut-turut.')).toBeTruthy()
  })
  it('offers no way to raise the tier once declared', async () => {
    setApi()
    await openSafety()
    await screen.findByText('Berkembang (30–90 hari)')
    expect(screen.queryByLabelText(/usia nomor/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /simpan dan aktifkan/i })).toBeNull()
  })
  it('asks for the number age once, when nothing is declared yet', async () => {
    const api = setApi(safety({ configured: false, enabled: false, tier: 'baru', ageDays: 0, dailyCap: 10 }))
    await openSafety()
    fireEvent.change(await screen.findByLabelText('Usia nomor WhatsApp'), { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan dan aktifkan' }))
    await waitFor(() => expect(api.bcSetSafety).toHaveBeenCalledWith({ ageDays: 60, enabled: true }))
  })
  it('switches broadcast on and off and changes the gap', async () => {
    const api = setApi()
    await openSafety()
    fireEvent.click(await screen.findByLabelText('Broadcast aktif'))
    await waitFor(() => expect(api.bcSetSafety).toHaveBeenCalledWith({ enabled: false }))
    fireEvent.change(screen.getByLabelText('Jarak minimal per kontak (hari)'), { target: { value: '4' } })
    await waitFor(() => expect(api.bcSetSafety).toHaveBeenCalledWith({ minGapDays: 4 }))
  })
  it('"I changed my number" takes two steps and sends the confirmation flag', async () => {
    const api = setApi()
    await openSafety()
    fireEvent.click(await screen.findByRole('button', { name: 'Saya mengganti nomor' }))
    expect(api.bcSetSafety).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Ya, ganti nomor' }))
    await waitFor(() => expect(api.bcSetSafety).toHaveBeenCalledWith({ changeNumber: true, confirm: true }))
  })
  it('has an emergency "Hentikan semua" that works with one click', async () => {
    const api = setApi()
    await openSafety()
    fireEvent.click(await screen.findByRole('button', { name: 'Hentikan semua' }))
    await waitFor(() => expect(api.bcStopAll).toHaveBeenCalledTimes(1))
  })
  it('shows the server\'s message when a setting is refused', async () => {
    const api = setApi()
    api.bcSetSafety.mockResolvedValue({ ok: false, error: 'Jam mulai harus sebelum jam selesai.' })
    await openSafety()
    fireEvent.click(await screen.findByLabelText('Broadcast aktif'))
    expect(await screen.findByText('Jam mulai harus sebelum jam selesai.')).toBeTruthy()
  })
})
