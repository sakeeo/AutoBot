// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { GsSource } from '@autobot/contracts/sheets'
import { SheetsPanel } from '../../src/client/pages/SheetsPanel'

const source = (over: Partial<GsSource> = {}): GsSource => ({
  id: 's1', name: 'Daftar FAQ', spreadsheetId: 'sheet-id-0123456789', gid: 0, tabTitle: 'FAQ', range: null, role: 'knowledge', mapping: {}, columns: [],
  intervalMin: 15, enabled: true, file: '_gsheets/daftar-faq.txt', lastSyncAt: 1, lastOkAt: 1, lastStatus: 'ok', lastError: null, lastSummary: '12 baris',
  rowCount: 12, consecutiveFailures: 0, pending: null, warnings: [], ...over
})

function setApi(over: Record<string, unknown> = {}) {
  const api = {
    gsCredentialStatus: vi.fn().mockResolvedValue({ configured: true, clientEmail: 'bot@proj.iam.gserviceaccount.com' }),
    gsListSources: vi.fn().mockResolvedValue([]),
    gsListApprovedDomains: vi.fn().mockResolvedValue([]),
    onKnowledgeSync: vi.fn().mockReturnValue(() => undefined),
    gsSaveCredential: vi.fn().mockResolvedValue({ ok: true, clientEmail: 'x@y.iam.gserviceaccount.com' }),
    gsDeleteCredential: vi.fn().mockResolvedValue({ ok: true }),
    gsInspect: vi.fn(), gsPreview: vi.fn(), gsAddSource: vi.fn().mockResolvedValue({ id: 'n' }),
    gsSyncNow: vi.fn().mockResolvedValue({ started: true }), gsUpdateSource: vi.fn(), gsRemoveSource: vi.fn(),
    gsConfirmChange: vi.fn().mockResolvedValue({ ok: true }), gsDismissChange: vi.fn().mockResolvedValue({ ok: true }),
    gsApproveDomain: vi.fn().mockResolvedValue({ ok: true }),
    ...over
  }
  ;(window as any).api = api
  return api
}
beforeEach(() => setApi())
afterEach(cleanup)

describe('SheetsPanel', () => {
  it('walks the owner through the key first, and shows no sources before there is one', async () => {
    setApi({ gsCredentialStatus: vi.fn().mockResolvedValue({ configured: false }) })
    render(<SheetsPanel />)
    expect(await screen.findByText(/Unggah kunci JSON/)).toBeTruthy()
    expect(screen.queryByText('Sumber Google Sheets')).toBeNull()
  })

  it('uploads the key file and shows only the email back', async () => {
    const api = setApi({ gsCredentialStatus: vi.fn().mockResolvedValue({ configured: false }) })
    const { container } = render(<SheetsPanel />)
    await screen.findByText(/Unggah kunci JSON/)
    const file = new File(['{"type":"service_account"}'], 'key.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: async () => '{"type":"service_account"}' })
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file] } })
    await waitFor(() => expect(api.gsSaveCredential).toHaveBeenCalledWith('{"type":"service_account"}'))
    expect(await screen.findByText(/Kunci tersimpan untuk x@y/)).toBeTruthy()
  })

  it('lists sources with status, the reason of an error, and the email to share with', async () => {
    setApi({ gsListSources: vi.fn().mockResolvedValue([source({ lastStatus: 'error', lastError: 'NOT_SHARED', consecutiveFailures: 3 })]) })
    render(<SheetsPanel />)
    expect((await screen.findAllByText('Daftar FAQ')).length).toBeGreaterThan(0)
    expect(screen.getByText(/Sheet belum dibagikan ke akun layanan/).textContent).toContain('bot@proj.iam.gserviceaccount.com')
    expect(screen.getByText(/Gagal 3 kali berturut-turut/)).toBeTruthy()
  })

  it('holds a big shrink until the owner applies it', async () => {
    const api = setApi({ gsListSources: vi.fn().mockResolvedValue([source({ lastStatus: 'needs_confirm', pending: { reason: 'shrink', summary: 'Jumlah baris turun dari 12 menjadi 3.' } })]) })
    render(<SheetsPanel />)
    expect(await screen.findByText(/turun dari 12 menjadi 3/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Terapkan' }))
    await waitFor(() => expect(api.gsConfirmChange).toHaveBeenCalledWith('s1'))
  })

  it('adds a catalog source: inspect, preview with a suggested mapping, save', async () => {
    const api = setApi({
      gsInspect: vi.fn().mockResolvedValue({ ok: true, spreadsheetId: 'sheet-id-0123456789', title: 'Toko', tabs: [{ gid: 0, title: 'Katalog', rows: 10, cols: 4 }] }),
      gsPreview: vi.fn().mockResolvedValue({
        ok: true, headers: ['Kode', 'Nama', 'Harga'], rows: [['007', 'Paket A', '150000']], totalRows: 1,
        suggestedMapping: { id: 'Kode', nama: 'Nama', harga: 'Harga' }, problems: []
      })
    })
    render(<SheetsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /Tambah sumber/ }))
    fireEvent.change(screen.getByLabelText(/Tautan Google Sheets/), { target: { value: 'https://docs.google.com/spreadsheets/d/sheet-id-0123456789/edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Periksa' }))
    await screen.findByLabelText('2. Tab')
    fireEvent.change(screen.getByLabelText('Peran'), { target: { value: 'catalog' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lihat pratinjau' }))
    expect(await screen.findByText('007')).toBeTruthy()
    expect((screen.getByLabelText(/ID produk/) as HTMLSelectElement).value).toBe('Kode')
    fireEvent.click(screen.getByRole('button', { name: 'Simpan dan sinkron' }))
    await waitFor(() => expect(api.gsAddSource).toHaveBeenCalledWith(expect.objectContaining({
      role: 'catalog', tabTitle: 'Katalog', mapping: { id: 'Kode', nama: 'Nama', harga: 'Harga' }, spreadsheetId: 'sheet-id-0123456789'
    })))
  })

  it('shows why a sheet could not be inspected', async () => {
    setApi({ gsInspect: vi.fn().mockResolvedValue({ ok: false, error: 'NOT_SHARED', message: 'Sheet belum dibagikan.', clientEmail: 'bot@proj.iam.gserviceaccount.com' }) })
    render(<SheetsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /Tambah sumber/ }))
    fireEvent.change(screen.getByLabelText(/Tautan Google Sheets/), { target: { value: 'sheet-id-0123456789' } })
    fireEvent.click(screen.getByRole('button', { name: 'Periksa' }))
    expect((await screen.findByRole('alert')).textContent).toContain('bot@proj.iam.gserviceaccount.com')
  })

  it('approves a checkout domain', async () => {
    const api = setApi()
    render(<SheetsPanel />)
    fireEvent.change(await screen.findByLabelText('Domain'), { target: { value: 'toko.contoh.id' } })
    fireEvent.click(screen.getByRole('button', { name: 'Setujui' }))
    await waitFor(() => expect(api.gsApproveDomain).toHaveBeenCalledWith('toko.contoh.id'))
  })
})
