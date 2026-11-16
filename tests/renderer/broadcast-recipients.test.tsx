// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { BroadcastPage } from '../../src/renderer/pages/BroadcastPage'
import type { BContact, OverviewView } from '../../src/shared/broadcast'

const safety = {
  configured: true, enabled: true, tier: 'mapan' as const, ageDays: 365, activeDay: 3, dailyCap: 15, sentToday: 2,
  window: { start: '09:00', end: '20:00', timezone: 'Asia/Makassar' }, minGapDays: 7
}
const overview = (o: Partial<OverviewView> = {}): OverviewView => ({
  contacts: { aktif: 2, menunggu_persetujuan: 0, tidak_aktif: 0 }, suppressed: 0, pendingConfirm: 0, safety,
  health: { level: 'aman', reason: 'Tidak ada tanda bahaya.' }, runningCampaignId: null, ...o
})
const contact = (o: Partial<BContact> = {}): BContact => ({
  id: 1, number: '6281234567890', jid: '6281234567890@s.whatsapp.net', name: 'Budi', vars: {}, source: 'chat', status: 'aktif',
  lastInboundAt: null, lastSentAt: 1_700_000_000_000, sentCount: 1, importId: null, ...o
})

function setApi(over: Record<string, unknown> = {}) {
  const api = {
    bcOverview: vi.fn().mockResolvedValue(overview()),
    bcContacts: vi.fn().mockResolvedValue([contact(), contact({ id: 2, number: '6281298765432', name: 'Sari', source: 'impor', status: 'menunggu_persetujuan', lastSentAt: null })]),
    bcSuppressed: vi.fn().mockResolvedValue([{ number: '6281111111111', jid: null, reason: 'berhenti', at: 1_700_000_000_000 }]),
    bcSendConfirmations: vi.fn().mockResolvedValue({ ok: true, campaignId: 1 }),
    bcImportPreview: vi.fn().mockResolvedValue({
      previewId: 'p1', total: 3, validCount: 2, invalidCount: 1, duplicates: 0,
      invalid: [{ row: 4, value: '123', reason: 'Nomor tidak valid.' }], sample: [{ number: '6281234567890', name: 'Budi' }]
    }),
    bcImportCommit: vi.fn().mockResolvedValue({ importId: 1, added: 2, notOnWhatsApp: 0, blockedBySuppression: 0, aborted: false }),
    bcEraseContact: vi.fn().mockResolvedValue(undefined),
    bcCampaigns: vi.fn().mockResolvedValue([]), bcGetSafety: vi.fn().mockResolvedValue(safety),
    bcStopAll: vi.fn().mockResolvedValue(undefined), bcSetSafety: vi.fn().mockResolvedValue({ ok: true, safety }),
    onBroadcast: vi.fn().mockReturnValue(() => undefined),
    ...over
  }
  ;(window as any).api = api
  return api
}
afterEach(cleanup)

async function openRecipients() {
  render(<BroadcastPage />)
  fireEvent.click(await screen.findByRole('tab', { name: 'Penerima' }))
}

describe('BroadcastPage', () => {
  it('has a single title, the four tabs and a dismissible note about the official route', async () => {
    setApi()
    render(<BroadcastPage />)
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.trim())).toEqual(['Broadcast'])
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Kampanye', 'Penerima', 'Keamanan', 'Laporan'])
    expect(screen.getByText(/whatsapp business platform/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Tutup catatan' }))
    expect(screen.queryByText(/whatsapp business platform/i)).toBeNull()
  })
})

describe('Recipients tab', () => {
  it('lists contacts with a text status and shows empty and error states', async () => {
    setApi()
    await openRecipients()
    await screen.findByText('Budi')
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Nomor', 'Nama', 'Sumber', 'Status', 'Terakhir dikirim', 'Aksi'])
    expect(screen.getByText('Aktif').className).toMatch(/badge/)
    expect(screen.getByText('Menunggu persetujuan').className).toMatch(/badge/)
    cleanup()
    setApi({ bcContacts: vi.fn().mockResolvedValue([]) })
    await openRecipients()
    expect(await screen.findByText(/belum ada penerima/i)).toBeTruthy()
    cleanup()
    setApi({ bcContacts: vi.fn().mockRejectedValue(new Error('x')) })
    await openRecipients()
    expect((await screen.findByRole('alert')).textContent).toMatch(/gagal memuat penerima/i)
  })

  it('filters by status through the backend', async () => {
    const api = setApi()
    await openRecipients()
    await screen.findByText('Budi')
    fireEvent.change(screen.getByLabelText('Filter status'), { target: { value: 'menunggu_persetujuan' } })
    await waitFor(() => expect(api.bcContacts).toHaveBeenLastCalledWith({ status: 'menunggu_persetujuan' }))
  })

  it('offers to send confirmations when people are waiting, and reports a refusal', async () => {
    const api = setApi({ bcOverview: vi.fn().mockResolvedValue(overview({ pendingConfirm: 3 })) })
    await openRecipients()
    expect(await screen.findByText('3 kontak menunggu konfirmasi')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Kirim konfirmasi' }))
    await waitFor(() => expect(api.bcSendConfirmations).toHaveBeenCalledTimes(1))
    cleanup()
    setApi({
      bcOverview: vi.fn().mockResolvedValue(overview({ pendingConfirm: 3 })),
      bcSendConfirmations: vi.fn().mockResolvedValue({ ok: false, error: 'Lengkapi pengaturan keamanan.' })
    })
    await openRecipients()
    fireEvent.click(await screen.findByRole('button', { name: 'Kirim konfirmasi' }))
    expect(await screen.findByText('Lengkapi pengaturan keamanan.')).toBeTruthy()
  })

  it('shows the suppression list read-only: no way to remove anyone from it', async () => {
    setApi()
    await openRecipients()
    const list = await screen.findByRole('region', { name: 'Daftar tolak' })
    expect(await within(list).findByText('6281111111111')).toBeTruthy()
    expect(within(list).getByText('Berhenti berlangganan')).toBeTruthy()
    expect(within(list).queryAllByRole('button')).toHaveLength(0)
  })

  it('erasing a contact takes two steps', async () => {
    const api = setApi()
    await openRecipients()
    fireEvent.click(await screen.findByRole('button', { name: 'Hapus data kontak 6281234567890' }))
    expect(api.bcEraseContact).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Ya, Hapus data kontak 6281234567890' }))
    await waitFor(() => expect(api.bcEraseContact).toHaveBeenCalledWith(1))
  })
})

describe('Import wizard', () => {
  const pick = async (name = 'daftar.csv', text = 'nomor,nama\n081234567890,Budi') => {
    const input = await screen.findByLabelText('Berkas daftar kontak')
    fireEvent.change(input, { target: { files: [new File([text], name, { type: 'text/csv' })] } })
  }

  it('previews the file, then needs the consent statement and a source note before importing', async () => {
    const api = setApi()
    await openRecipients()
    fireEvent.click(await screen.findByRole('button', { name: 'Impor daftar' }))
    await pick()
    await waitFor(() => expect(api.bcImportPreview).toHaveBeenCalledTimes(1))
    expect(api.bcImportPreview.mock.calls[0][0]).toMatchObject({ name: 'daftar.csv', data: 'nomor,nama\n081234567890,Budi' })
    expect(await screen.findByText('2 nomor valid')).toBeTruthy()
    expect(screen.getByText('1 baris tidak valid')).toBeTruthy()
    expect(screen.getByText(/nomor tidak valid/i)).toBeTruthy()

    const go = screen.getByRole('button', { name: 'Impor' }) as HTMLButtonElement
    expect(go.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText(/saya memiliki persetujuan/i))
    expect(go.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Keterangan sumber data'), { target: { value: 'singkat' } })
    expect(go.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Keterangan sumber data'), { target: { value: 'Formulir pendaftaran website Okt 2026' } })
    expect(go.disabled).toBe(false)
    fireEvent.click(go)
    await waitFor(() => expect(api.bcImportCommit).toHaveBeenCalledWith('p1', { accepted: true, sourceNote: 'Formulir pendaftaran website Okt 2026' }))
    expect(await screen.findByText(/2 kontak ditambahkan/i)).toBeTruthy()
  })

  it('warns about list quality when the import was stopped', async () => {
    setApi({ bcImportCommit: vi.fn().mockResolvedValue({ importId: 0, added: 0, notOnWhatsApp: 4, blockedBySuppression: 0, aborted: true }) })
    await openRecipients()
    fireEvent.click(await screen.findByRole('button', { name: 'Impor daftar' }))
    await pick()
    await screen.findByText('2 nomor valid')
    fireEvent.click(screen.getByLabelText(/saya memiliki persetujuan/i))
    fireEvent.change(screen.getByLabelText('Keterangan sumber data'), { target: { value: 'Formulir pendaftaran website Okt 2026' } })
    fireEvent.click(screen.getByRole('button', { name: 'Impor' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/dihentikan.*tidak terdaftar/i)
  })

  it('shows a clear message when the file cannot be read as a list', async () => {
    setApi({ bcImportPreview: vi.fn().mockRejectedValue(new Error('NO_NUMBER_COLUMN')) })
    await openRecipients()
    fireEvent.click(await screen.findByRole('button', { name: 'Impor daftar' }))
    await pick('salah.csv', 'nama\nBudi')
    expect((await screen.findByRole('alert')).textContent).toMatch(/kolom nomor/i)
  })
})
