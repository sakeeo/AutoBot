// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react'
import { BroadcastPage } from '../../src/renderer/pages/BroadcastPage'
import type { BroadcastEvent, CampaignView } from '../../src/shared/broadcast'

const progress = { antre: 4, terkirim: 3, gagal: 1, dilewati: 2 }
const camp = (o: Partial<CampaignView> = {}): CampaignView => ({
  id: 1, name: 'Promo November', kind: 'broadcast', template: 'Halo', status: 'berjalan', pauseReason: null, createdAt: 1, startedAt: 2,
  audience: 'semua', notBefore: null, progress, ...o
})
const safety = {
  configured: true, enabled: true, tier: 'mapan' as const, ageDays: 365, activeDay: 3, dailyCap: 15, sentToday: 2,
  window: { start: '09:00', end: '20:00', timezone: 'Asia/Makassar' }, minGapDays: 7
}

let push: ((e: BroadcastEvent) => void) | null = null
const unsub = vi.fn()

function setApi(over: Record<string, unknown> = {}) {
  push = null
  const api = {
    bcCampaigns: vi.fn().mockResolvedValue([camp()]),
    bcCreateCampaign: vi.fn().mockResolvedValue({ ok: true, campaign: camp({ id: 7, status: 'draf' }), warnings: ['Terlalu banyak huruf kapital; tulis dengan huruf biasa.'], samples: ['Halo Budi, ini Kopi Sudut.\n\nBalas BERHENTI untuk tidak menerima pesan ini lagi.'] }),
    bcPreviewCampaign: vi.fn().mockResolvedValue({ eligible: 12, skipped: { tolak: 2, terlalu_cepat: 1 }, estimatedDays: 2 }),
    bcStartCampaign: vi.fn().mockResolvedValue({ ok: true }),
    bcPauseCampaign: vi.fn().mockResolvedValue(undefined),
    bcResumeCampaign: vi.fn().mockResolvedValue({ ok: true }),
    bcStopCampaign: vi.fn().mockResolvedValue(undefined),
    bcStopAll: vi.fn().mockResolvedValue(undefined),
    bcDiscardDraft: vi.fn().mockResolvedValue({ ok: true }),
    bcReport: vi.fn().mockResolvedValue({ campaign: camp(), progress, skippedReasons: { tolak: 2 }, optOuts: 1 }),
    bcExportReport: vi.fn().mockResolvedValue('nomor,nama\n6281,Budi'),
    bcOverview: vi.fn(), bcGetSafety: vi.fn().mockResolvedValue(safety), bcContacts: vi.fn().mockResolvedValue([]), bcSuppressed: vi.fn().mockResolvedValue([]),
    onBroadcast: vi.fn().mockImplementation((cb: (e: BroadcastEvent) => void) => { push = cb; return unsub }),
    ...over
  }
  ;(window as any).api = api
  return api
}
afterEach(() => { cleanup(); unsub.mockClear() })

async function open() {
  render(<BroadcastPage />)
  await screen.findByText('Promo November')
}

describe('Campaigns tab', () => {
  it('lists campaigns with a text status and progress numbers', async () => {
    setApi()
    await open()
    expect(screen.getByText('Berjalan').className).toMatch(/badge/)
    expect(screen.getByText(/3 terkirim/)).toBeTruthy()
    expect(screen.getByText(/1 gagal/)).toBeTruthy()
  })
  it('shows empty and error states', async () => {
    setApi({ bcCampaigns: vi.fn().mockResolvedValue([]) })
    render(<BroadcastPage />)
    expect(await screen.findByText(/belum ada kampanye/i)).toBeTruthy()
    cleanup()
    setApi({ bcCampaigns: vi.fn().mockRejectedValue(new Error('x')) })
    render(<BroadcastPage />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/gagal memuat kampanye/i)
  })
  it('refreshes on live events and stops listening when the page closes', async () => {
    const api = setApi()
    const { unmount } = render(<BroadcastPage />)
    await screen.findByText('Promo November')
    const before = api.bcCampaigns.mock.calls.length
    await act(async () => { push?.({ type: 'progress', campaignId: 1, progress }) })
    await waitFor(() => expect(api.bcCampaigns.mock.calls.length).toBeGreaterThan(before))
    unmount()
    expect(unsub).toHaveBeenCalled()
  })
  it('pause and resume call the backend; stopping takes two steps', async () => {
    const api = setApi()
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Jeda' }))
    await waitFor(() => expect(api.bcPauseCampaign).toHaveBeenCalledWith(1))
    fireEvent.click(screen.getByRole('button', { name: 'Hentikan Promo November' }))
    expect(api.bcStopCampaign).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Ya, Hentikan Promo November' }))
    await waitFor(() => expect(api.bcStopCampaign).toHaveBeenCalledWith(1))
  })
  it('a campaign paused by a safety stop shows its reason and only a person can resume it', async () => {
    const api = setApi({ bcCampaigns: vi.fn().mockResolvedValue([camp({ status: 'dijeda', pauseReason: 'Tiga pengiriman gagal berturut-turut.' })]) })
    render(<BroadcastPage />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/tiga pengiriman gagal/i)
    expect(alert.textContent).toMatch(/tidak lanjut sendiri/i)
    expect(api.bcResumeCampaign).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' }))
    await waitFor(() => expect(api.bcResumeCampaign).toHaveBeenCalledWith(1))
  })
  it('says so when the app is locked instead of failing silently', async () => {
    setApi({ bcPauseCampaign: vi.fn().mockRejectedValue(new Error("Error invoking remote method 'bc:pause-campaign': Error: LOCKED")) })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Jeda' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/terkunci/i)
  })
})

describe('Campaign wizard', () => {
  async function toMessage() {
    fireEvent.click(await screen.findByRole('button', { name: 'Buat kampanye' }))
    expect(screen.getByText(/dihitung dari pesan yang tercatat aplikasi/i)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Kontak chat aktif'))
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' }))
  }
  const write = (text = 'Halo {nama}, ini {bisnis}: menu baru minggu ini.') => {
    fireEvent.change(screen.getByLabelText('Nama kampanye'), { target: { value: 'Promo Desember' } })
    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: text } })
  }

  it('step 2 shows the locked opt-out sentence and blocks on lint errors', async () => {
    const api = setApi({ bcCreateCampaign: vi.fn().mockResolvedValue({ ok: false, errors: ['Pesan harus menyebut nama bisnis agar penerima mengenali pengirim.'], warnings: [] }) })
    await open()
    await toMessage()
    expect(screen.getByLabelText('Kaki berhenti (otomatis)').textContent).toMatch(/Balas BERHENTI/)
    expect((screen.getByLabelText('Kaki berhenti (otomatis)') as HTMLElement).tagName).not.toBe('TEXTAREA')
    write('Halo, promo besar.')
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/nama bisnis/i)
    expect(api.bcPreviewCampaign).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Mulai kampanye' })).toBeNull()
  })

  it('step 3 shows the review: counts, skip reasons, estimate, samples, warnings and a checklist that must be ticked', async () => {
    const api = setApi()
    await open()
    await toMessage()
    write()
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' }))
    expect(await screen.findByText('12 penerima layak')).toBeTruthy()
    await waitFor(() => expect(api.bcPreviewCampaign).toHaveBeenCalledWith(7))
    expect(screen.getByText(/ada di daftar tolak: 2/i)).toBeTruthy()
    expect(screen.getByText(/baru saja dikirimi: 1/i)).toBeTruthy()
    expect(screen.getByText(/perkiraan selesai: 2 hari/i)).toBeTruthy()
    expect(screen.getByText(/Halo Budi, ini Kopi Sudut/)).toBeTruthy()
    expect(screen.getByText(/huruf kapital/i)).toBeTruthy()
    const next = screen.getByRole('button', { name: 'Lanjut' }) as HTMLButtonElement
    expect(next.disabled).toBe(true)
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box)
    expect(next.disabled).toBe(false)
  })

  it('starts a small campaign without extra typing and calls the backend with the new id', async () => {
    const api = setApi()
    await open()
    await toMessage()
    write()
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' }))
    await screen.findByText('12 penerima layak')
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' }))
    expect(screen.queryByLabelText('Ketik KIRIM untuk memulai')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Mulai kampanye' }))
    await waitFor(() => expect(api.bcStartCampaign).toHaveBeenCalledWith(7, undefined))
  })

  it('above 50 recipients the start button stays off until KIRIM is typed', async () => {
    const api = setApi({ bcPreviewCampaign: vi.fn().mockResolvedValue({ eligible: 80, skipped: {}, estimatedDays: 6 }) })
    await open()
    await toMessage()
    write()
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' }))
    await screen.findByText('80 penerima layak')
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' }))
    const start = screen.getByRole('button', { name: 'Mulai kampanye' }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Ketik KIRIM untuk memulai'), { target: { value: 'kirim' } })
    expect(start.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Ketik KIRIM untuk memulai'), { target: { value: 'KIRIM' } })
    expect(start.disabled).toBe(false)
    fireEvent.click(start)
    await waitFor(() => expect(api.bcStartCampaign).toHaveBeenCalledWith(7, 'KIRIM'))
  })

  it('shows the backend\'s refusal when starting is not allowed', async () => {
    setApi({ bcStartCampaign: vi.fn().mockResolvedValue({ ok: false, error: 'Lengkapi dan aktifkan pengaturan keamanan dulu (tab Keamanan).' }) })
    await open()
    await toMessage()
    write()
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' }))
    await screen.findByText('12 penerima layak')
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mulai kampanye' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/pengaturan keamanan/i)
  })
})

describe('Campaign wizard: no orphan drafts', () => {
  async function toReview() {
    fireEvent.click(await screen.findByRole('button', { name: 'Buat kampanye' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' }))
    fireEvent.change(screen.getByLabelText('Nama kampanye'), { target: { value: 'Promo' } })
    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: 'Halo {nama}, ini {bisnis}.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' }))
    await screen.findByText('12 penerima layak')
  }
  it('going back and continuing again replaces the first draft once the new one is created', async () => {
    const api = setApi()
    await open()
    await toReview()
    fireEvent.click(screen.getByRole('button', { name: 'Kembali' }))
    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: 'Halo {nama}, ini {bisnis}, versi baru.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' }))
    await waitFor(() => expect(api.bcCreateCampaign).toHaveBeenCalledTimes(2))
    expect(api.bcDiscardDraft).toHaveBeenCalledWith(7)
    expect(api.bcDiscardDraft.mock.invocationCallOrder[0]).toBeGreaterThan(api.bcCreateCampaign.mock.invocationCallOrder[1])
  })
  it('cancelling the wizard discards the draft it made', async () => {
    const api = setApi()
    await open()
    await toReview()
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
    await waitFor(() => expect(api.bcDiscardDraft).toHaveBeenCalledWith(7))
  })
})

describe('Editing a saved draft', () => {
  const draft = camp({ id: 5, name: 'Draf lama', template: 'Halo {nama}, ini {bisnis}.', status: 'draf', audience: 'impor', startedAt: null })
  it('opens the message step with the saved values and replaces the draft when continued', async () => {
    const api = setApi({ bcCampaigns: vi.fn().mockResolvedValue([draft]) })
    render(<BroadcastPage />)
    await screen.findByText('Draf lama')
    fireEvent.click(screen.getByRole('button', { name: 'Ubah' }))
    expect((screen.getByLabelText('Nama kampanye') as HTMLInputElement).value).toBe('Draf lama')
    expect((screen.getByLabelText('Isi pesan') as HTMLTextAreaElement).value).toBe('Halo {nama}, ini {bisnis}.')
    fireEvent.change(screen.getByLabelText('Nama kampanye'), { target: { value: 'Draf baru' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' }))
    await screen.findByText('12 penerima layak')
    expect(api.bcCreateCampaign).toHaveBeenCalledWith({ name: 'Draf baru', template: 'Halo {nama}, ini {bisnis}.', audience: 'impor' })
    expect(api.bcDiscardDraft).toHaveBeenCalledWith(5)
  })
  it('keeps the draft when the editor is closed with Batal', async () => {
    const api = setApi({ bcCampaigns: vi.fn().mockResolvedValue([draft]) })
    render(<BroadcastPage />)
    await screen.findByText('Draf lama')
    fireEvent.click(screen.getByRole('button', { name: 'Ubah' }))
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
    await waitFor(() => expect(screen.queryByLabelText('Nama kampanye')).toBeNull())
    expect(api.bcDiscardDraft).not.toHaveBeenCalled()
  })
  it('keeps the old draft when the new text fails the checks', async () => {
    const api = setApi({
      bcCampaigns: vi.fn().mockResolvedValue([draft]),
      bcCreateCampaign: vi.fn().mockResolvedValue({ ok: false, errors: ['Sebut nama bisnis.'], warnings: [] })
    })
    render(<BroadcastPage />)
    await screen.findByText('Draf lama')
    fireEvent.click(screen.getByRole('button', { name: 'Ubah' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' }))
    await screen.findByText('Sebut nama bisnis.')
    expect(api.bcDiscardDraft).not.toHaveBeenCalled()
  })
  it('deletes a draft after confirmation', async () => {
    const api = setApi({ bcCampaigns: vi.fn().mockResolvedValue([draft]) })
    render(<BroadcastPage />)
    await screen.findByText('Draf lama')
    fireEvent.click(screen.getByRole('button', { name: 'Hapus draf Draf lama' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ya, Hapus draf Draf lama' }))
    await waitFor(() => expect(api.bcDiscardDraft).toHaveBeenCalledWith(5))
  })
})

describe('Report tab', () => {
  it('summarises a campaign and exports it as CSV', async () => {
    const api = setApi()
    render(<BroadcastPage />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Laporan' }))
    expect(await screen.findByText('Terkirim')).toBeTruthy()
    const report = await screen.findByRole('region', { name: 'Ringkasan' })
    expect(within(report).getByText('Terkirim').nextSibling?.textContent).toBe('3')
    expect(within(report).getByText('Gagal').nextSibling?.textContent).toBe('1')
    expect(within(report).getByText('Berhenti berlangganan').nextSibling?.textContent).toBe('1')
    expect(within(report).getByText(/ada di daftar tolak/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ekspor CSV' }))
    await waitFor(() => expect(api.bcExportReport).toHaveBeenCalledWith(1))
  })
  it('explains when there is nothing to report', async () => {
    setApi({ bcCampaigns: vi.fn().mockResolvedValue([]) })
    render(<BroadcastPage />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Laporan' }))
    expect(await screen.findByText(/belum ada laporan/i)).toBeTruthy()
  })
})
