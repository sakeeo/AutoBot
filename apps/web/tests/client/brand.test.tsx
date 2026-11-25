// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { BrandPage } from '../../src/client/pages/BrandPage'
import { ApplyBar } from '../../src/client/brand/ApplyBar'
import { PRESETS, type BrandProfile, type Issue } from '@autobot/contracts/brand'

const BOT = '6285119308345'

const profile = (over: Partial<BrandProfile> = {}): BrandProfile => ({
  ...structuredClone(PRESETS.toko_online),
  identity: { businessName: '', botName: 'Sudi', about: '', language: 'id' },
  links: [{ id: 'l1', name: 'Checkout', kind: 'checkout', url: 'https://toko.example/c', tracking: true }],
  ...over
})

function makeApi(draft: BrandProfile, over: Record<string, unknown> = {}) {
  return {
    getBrand: vi.fn().mockResolvedValue({ active: draft, draft, botNumber: BOT, productCount: 0 }),
    saveBrandDraft: vi.fn().mockResolvedValue({ ok: true, issues: [] }),
    applyBrand: vi.fn().mockResolvedValue({ ok: true, issues: [], version: 1 }),
    listBrandVersions: vi.fn().mockResolvedValue([]),
    restoreBrandVersion: vi.fn().mockResolvedValue({ ok: true }),
    exportBrand: vi.fn().mockResolvedValue('{"version":1}'),
    importBrand: vi.fn().mockResolvedValue({ ok: true, issues: [] }),
    previewChat: vi.fn(),
    listPresets: vi.fn().mockResolvedValue([
      { id: 'toko_online', label: 'Toko Online' }, { id: 'jasa_agensi', label: 'Jasa / Agensi' }, { id: 'kustom', label: 'Kustom' }
    ]),
    loadPreset: vi.fn().mockResolvedValue({ ok: true, issues: [] }),
    onHandoff: vi.fn().mockReturnValue(() => undefined),
    ...over
  }
}
const setApi = (draft: BrandProfile, over?: Record<string, unknown>) => {
  const api = makeApi(draft, over)
  ;(window as any).api = api
  return api
}
const lastSaved = (api: ReturnType<typeof makeApi>): BrandProfile =>
  api.saveBrandDraft.mock.calls[api.saveBrandDraft.mock.calls.length - 1][0]

afterEach(cleanup)

describe('BrandPage: identity and presets', () => {
  it('saves the draft after the user edits the business name', async () => {
    const api = setApi(profile())
    render(<BrandPage />)
    fireEvent.change(await screen.findByLabelText('Nama bisnis'), { target: { value: 'Kopi Sudut' } })
    await waitFor(() => expect(lastSaved(api).identity.businessName).toBe('Kopi Sudut'))
  })
  it('does not lose an edit when the user leaves the page before the debounce fires', async () => {
    const api = setApi(profile())
    const { unmount } = render(<BrandPage />)
    fireEvent.change(await screen.findByLabelText('Nama bisnis'), { target: { value: 'Cepat Pindah' } })
    unmount()
    await waitFor(() => expect(lastSaved(api).identity.businessName).toBe('Cepat Pindah'))
  })
  it('counts the characters of the about text against the 500 limit', async () => {
    setApi(profile())
    render(<BrandPage />)
    fireEvent.change(await screen.findByLabelText('Tentang bisnis'), { target: { value: 'abcde' } })
    expect(await screen.findByText('5/500')).toBeTruthy()
  })
  it('loads a preset when the user picks one', async () => {
    const api = setApi(profile())
    render(<BrandPage />)
    await screen.findByRole('option', { name: 'Jasa / Agensi' })
    fireEvent.change(await screen.findByLabelText('Jenis bisnis (preset)'), { target: { value: 'jasa_agensi' } })
    expect(api.loadPreset).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Muat preset' }))
    await waitFor(() => expect(api.loadPreset).toHaveBeenCalledWith('jasa_agensi'))
  })
  it('does not load the preset when the user declines the confirmation', async () => {
    const api = setApi(profile())
    render(<BrandPage />)
    await screen.findByRole('option', { name: 'Jasa / Agensi' })
    fireEvent.change(await screen.findByLabelText('Jenis bisnis (preset)'), { target: { value: 'jasa_agensi' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Batal' }))
    await new Promise((r) => setTimeout(r, 30))
    expect(api.loadPreset).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Muat preset' })).toBeNull()
  })
  it('adds and removes style examples', async () => {
    const api = setApi(profile())
    render(<BrandPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Tambah contoh' }))
    await waitFor(() => expect(lastSaved(api).style.examples).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Hapus contoh 1' }))
    expect(lastSaved(api).style.examples).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Ya, Hapus contoh 1' }))
    await waitFor(() => expect(lastSaved(api).style.examples).toHaveLength(0))
  })
})

describe('BrandPage: conversion rules', () => {
  const twoRules = () =>
    profile({
      rules: [
        { id: 'r1', enabled: true, when: { intents: ['komplain'] }, then: { action: 'handoff' } },
        { id: 'r2', enabled: true, when: { intents: ['siap_beli'] }, then: { action: 'send_checkout' } }
      ]
    })
  const openRules = async () => fireEvent.click(await screen.findByRole('tab', { name: 'Arah Konversi' }))

  it('shows every rule as a readable sentence', async () => {
    setApi(twoRules())
    render(<BrandPage />)
    await openRules()
    const list = within(await screen.findByTestId('rule-list'))
    expect(list.getByText(/Komplain/)).toBeTruthy()
    expect(list.getByText(/Siap beli/)).toBeTruthy()
    expect(list.getByText(/Serah ke admin/)).toBeTruthy()
    expect(list.getByText(/Kirim checkout/)).toBeTruthy()
  })
  it('reorders rules with the move buttons', async () => {
    const api = setApi(twoRules())
    render(<BrandPage />)
    await openRules()
    fireEvent.click(await screen.findByRole('button', { name: 'Naikkan aturan 2' }))
    await waitFor(() => expect(lastSaved(api).rules.map((r) => r.id)).toEqual(['r2', 'r1']))
  })
  it('deletes and toggles a rule', async () => {
    const api = setApi(twoRules())
    render(<BrandPage />)
    await openRules()
    fireEvent.click(await screen.findByLabelText('Aktifkan aturan 1'))
    await waitFor(() => expect(lastSaved(api).rules[0].enabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Hapus aturan 1' }))
    expect(lastSaved(api).rules.map((r) => r.id)).toEqual(['r1', 'r2'])
    fireEvent.click(screen.getByRole('button', { name: 'Ya, Hapus aturan 1' }))
    await waitFor(() => expect(lastSaved(api).rules.map((r) => r.id)).toEqual(['r2']))
  })
  it('adds a rule from the builder form', async () => {
    const api = setApi(profile({ rules: [] }))
    render(<BrandPage />)
    await openRules()
    fireEvent.change(await screen.findByLabelText('Jika maksud pelanggan'), { target: { value: 'siap_beli' } })
    fireEvent.change(screen.getByLabelText('Maka lakukan'), { target: { value: 'send_checkout' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tambah aturan' }))
    await waitFor(() => expect(lastSaved(api).rules).toHaveLength(1))
    expect(lastSaved(api).rules[0]).toMatchObject({
      enabled: true, when: { intents: ['siap_beli'] }, then: { action: 'send_checkout' }
    })
  })
  it('changes the main goal', async () => {
    const api = setApi(profile())
    render(<BrandPage />)
    await openRules()
    fireEvent.click(await screen.findByLabelText('Serah ke admin'))
    await waitFor(() => expect(lastSaved(api).goal).toBe('handoff'))
  })
})

describe('BrandPage: links and admins', () => {
  const openLinks = async () => fireEvent.click(await screen.findByRole('tab', { name: 'Tautan & Admin' }))

  it('flags a non-https link inline', async () => {
    setApi(profile({ links: [{ id: 'l1', name: 'Toko', kind: 'checkout', url: 'http://toko.example/c', tracking: true }] }))
    render(<BrandPage />)
    await openLinks()
    expect((await screen.findAllByText(/diawali https:\/\//i)).length).toBeGreaterThan(0)
  })
  it('adds a link', async () => {
    const api = setApi(profile({ links: [] }))
    render(<BrandPage />)
    await openLinks()
    fireEvent.click(await screen.findByRole('button', { name: 'Tambah tautan' }))
    await waitFor(() => expect(lastSaved(api).links).toHaveLength(1))
  })
  it('warns when an admin number equals the bot number', async () => {
    setApi(profile({ admins: [{ id: 'a1', name: 'Bot', number: '0851-1930-8345', notifyWhatsapp: true }] }))
    render(<BrandPage />)
    await openLinks()
    expect((await screen.findAllByText(/sama dengan nomor bot/i)).length).toBeGreaterThan(0)
  })
  it('adds an admin', async () => {
    const api = setApi(profile())
    render(<BrandPage />)
    await openLinks()
    fireEvent.click(await screen.findByRole('button', { name: 'Tambah admin' }))
    await waitFor(() => expect(lastSaved(api).admins).toHaveLength(1))
  })
})

describe('BrandPage: apply bar', () => {
  it('shows validation errors and blocks Terapkan', async () => {
    setApi(profile({ goal: 'checkout', links: [] }))
    render(<BrandPage />)
    expect(await screen.findByText(/Tujuan Checkout butuh/i)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Terapkan' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('applies a valid profile and reports the new version', async () => {
    const api = setApi(profile())
    render(<BrandPage />)
    const btn = (await screen.findByRole('button', { name: 'Terapkan' })) as HTMLButtonElement
    await waitFor(() => expect(btn.disabled).toBe(false))
    fireEvent.click(btn)
    await waitFor(() => expect(api.applyBrand).toHaveBeenCalled())
    expect(await screen.findByText(/Versi 1 diterapkan/)).toBeTruthy()
  })
  it('shows server-side apply errors', async () => {
    const issue: Issue = { level: 'error', field: 'admins[0].number', message: 'Nomor admin tidak boleh sama dengan nomor bot.' }
    const api = setApi(profile(), { applyBrand: vi.fn().mockResolvedValue({ ok: false, issues: [issue] }) })
    render(<BrandPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Terapkan' }))
    await waitFor(() => expect(api.applyBrand).toHaveBeenCalled())
    expect((await screen.findAllByText(/tidak boleh sama dengan nomor bot/i)).length).toBeGreaterThan(0)
  })
  it('exports the profile', async () => {
    const api = setApi(profile())
    render(<BrandPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ekspor' }))
    await waitFor(() => expect(api.exportBrand).toHaveBeenCalled())
  })
  it('restores a chosen version', async () => {
    const api = setApi(profile(), { listBrandVersions: vi.fn().mockResolvedValue([{ version: 3, createdAt: 1700000000000 }, { version: 2, createdAt: 1690000000000 }]) })
    render(<BrandPage />)
    await screen.findByRole('option', { name: /v2 —/ })
    fireEvent.change(await screen.findByLabelText('Versi tersimpan'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pulihkan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ya, pulihkan' }))
    await waitFor(() => expect(api.restoreBrandVersion).toHaveBeenCalledWith(2))
  })
})

describe('ApplyBar', () => {
  it('lists errors and warnings with their messages and disables Terapkan only for errors', () => {
    const issues: Issue[] = [
      { level: 'warn', field: 'identity.businessName', message: 'Nama bisnis belum diisi.' }
    ]
    setApi(profile())
    render(<ApplyBar issues={issues} dirty={false} onApply={async () => undefined} onChanged={() => undefined} />)
    expect(screen.getByText('Nama bisnis belum diisi.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Terapkan' }) as HTMLButtonElement).disabled).toBe(false)
    cleanup()
    render(
      <ApplyBar issues={[...issues, { level: 'error', field: 'goal', message: 'Tujuan salah.' }]} dirty={false}
        onApply={async () => undefined} onChanged={() => undefined} />
    )
    expect((screen.getByRole('button', { name: 'Terapkan' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('BrandPage: live preview', () => {
  const turn = (over: Record<string, unknown> = {}) => ({
    intent: 'siap_beli', action: { kind: 'send_checkout', ruleId: 'r3', forced: false },
    replyParts: ['Siap Kak', 'Ini tautannya: https://toko.example/c'], linkSent: 'https://toko.example/c',
    handoff: null, sources: ['faq.md'], matchedRule: 'r3',
    removed: { numbers: false, urls: [], numbersUnknown: [] }, fallback: false,
    hits: [{ file: '/k/faq.md', text: 'isi', coverage: 1 }], ...over
  })

  it('sends the typed message to the simulator with the draft profile and shows the action taken', async () => {
    const api = setApi(profile(), { previewChat: vi.fn().mockResolvedValue({ ok: true, turns: [turn()] }) })
    render(<BrandPage />)
    fireEvent.change(await screen.findByLabelText('Pesan pelanggan'), { target: { value: 'mau beli' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kirim' }))
    await waitFor(() => expect(api.previewChat).toHaveBeenCalledWith({ draft: true, messages: ['mau beli'] }))
    const panel = await screen.findByTestId('preview-panel')
    expect(within(panel).getByText('Siap Kak')).toBeTruthy()
    expect(within(panel).getByText(/Kirim checkout/)).toBeTruthy()
    expect(within(panel).getByText(/r3/)).toBeTruthy()
  })
  it('replays all earlier messages so the simulation keeps its context', async () => {
    const api = setApi(profile(), {
      previewChat: vi.fn()
        .mockResolvedValueOnce({ ok: true, turns: [turn()] })
        .mockResolvedValueOnce({ ok: true, turns: [turn(), turn({ replyParts: ['Baik Kak'] })] })
    })
    render(<BrandPage />)
    const input = await screen.findByLabelText('Pesan pelanggan')
    fireEvent.change(input, { target: { value: 'halo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kirim' }))
    await waitFor(() => expect(api.previewChat).toHaveBeenCalledTimes(1))
    fireEvent.change(input, { target: { value: 'berapa harganya' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kirim' }))
    await waitFor(() => expect(api.previewChat).toHaveBeenLastCalledWith({ draft: true, messages: ['halo', 'berapa harganya'] }))
  })
  it('shows guard badges for removed numbers, urls and invented prices and the handoff', async () => {
    setApi(profile(), {
      previewChat: vi.fn().mockResolvedValue({
        ok: true,
        turns: [turn({
          removed: { numbers: true, urls: ['http://evil.test'], numbersUnknown: ['2000000'] },
          handoff: { reason: 'komplain' }, action: { kind: 'handoff', ruleId: null, forced: true, reason: 'komplain' }
        })]
      })
    })
    render(<BrandPage />)
    fireEvent.change(await screen.findByLabelText('Pesan pelanggan'), { target: { value: 'rusak' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kirim' }))
    const panel = await screen.findByTestId('preview-panel')
    expect(await within(panel).findByText(/nomor disaring/i)).toBeTruthy()
    expect(within(panel).getByText(/1 tautan disaring/i)).toBeTruthy()
    expect(within(panel).getByText(/harga tak dikenal diganti/i)).toBeTruthy()
    expect(within(panel).getByText(/diserahkan ke admin/i)).toBeTruthy()
  })
  it('shows the error when the simulator is not available', async () => {
    setApi(profile(), { previewChat: vi.fn().mockResolvedValue({ ok: false, error: 'Mode AI belum siap: simpan API key di menu AI dulu.' }) })
    render(<BrandPage />)
    fireEvent.change(await screen.findByLabelText('Pesan pelanggan'), { target: { value: 'halo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kirim' }))
    expect(await screen.findByText(/simpan API key di menu AI/i)).toBeTruthy()
  })
  it('can start a new simulation', async () => {
    const api = setApi(profile(), { previewChat: vi.fn().mockResolvedValue({ ok: true, turns: [turn()] }) })
    render(<BrandPage />)
    fireEvent.change(await screen.findByLabelText('Pesan pelanggan'), { target: { value: 'halo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kirim' }))
    await screen.findByText('Siap Kak')
    fireEvent.click(screen.getByRole('button', { name: 'Mulai ulang' }))
    fireEvent.change(screen.getByLabelText('Pesan pelanggan'), { target: { value: 'baru' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kirim' }))
    await waitFor(() => expect(api.previewChat).toHaveBeenLastCalledWith({ draft: true, messages: ['baru'] }))
  })
})

describe('BrandPage: theming', () => {
  it('uses Bootstrap classes only, no hard-coded colours that would break dark mode', async () => {
    setApi(profile())
    const { container } = render(<BrandPage />)
    await screen.findByLabelText('Nama bisnis')
    expect(container.querySelector('[style*="color"]')).toBeNull()
    expect(container.querySelector('[style*="background"]')).toBeNull()
    expect(container.querySelector('.card')).not.toBeNull()
  })
})

describe('BrandPage: layout and destructive actions', () => {
  it('shows a loading state, then a single page title and tabs inside cards', async () => {
    const api = setApi(profile())
    api.getBrand.mockReturnValueOnce(new Promise(() => undefined))
    const first = render(<BrandPage />)
    expect(screen.getByRole('status').textContent).toMatch(/memuat/i)
    first.unmount()
    setApi(profile())
    render(<BrandPage />)
    await screen.findByLabelText('Nama bisnis')
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.trim())).toEqual(['Brand & Konversi'])
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Identitas & Gaya', 'Arah Konversi', 'Tautan & Admin', 'Lead & Pesan', 'Jam & Batas', 'Perilaku balasan'
    ])
    expect(screen.getByRole('button', { name: 'Terapkan' }).className).toMatch(/btn-primary/)
  })

  it('removing a link takes two steps', async () => {
    const api = setApi(profile())
    render(<BrandPage />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Tautan & Admin' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Hapus tautan 1' }))
    expect(api.saveBrandDraft).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Ya, Hapus tautan 1' }))
    await waitFor(() => expect(lastSaved(api).links).toHaveLength(0))
  })

  it('removing an admin takes two steps', async () => {
    const api = setApi(profile({ admins: [{ id: 'a1', name: 'Budi', number: '6281234567890', notifyWhatsapp: true }] }))
    render(<BrandPage />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Tautan & Admin' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Hapus admin 1' }))
    expect(api.saveBrandDraft).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Ya, Hapus admin 1' }))
    await waitFor(() => expect(lastSaved(api).admins).toHaveLength(0))
  })

  it('removing a lead question or an objection takes two steps', async () => {
    const api = setApi(profile({ objections: [{ trigger: 'mahal', answer: 'ada cicilan' }] }))
    render(<BrandPage />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Lead & Pesan' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Hapus keberatan 1' }))
    expect(api.saveBrandDraft).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Ya, Hapus keberatan 1' }))
    await waitFor(() => expect(lastSaved(api).objections).toHaveLength(0))
    const before = lastSaved(api).leadQuestions.length
    fireEvent.click(screen.getByRole('button', { name: 'Hapus pertanyaan 1' }))
    expect(lastSaved(api).leadQuestions).toHaveLength(before)
    fireEvent.click(screen.getByRole('button', { name: 'Ya, Hapus pertanyaan 1' }))
    await waitFor(() => expect(lastSaved(api).leadQuestions).toHaveLength(before - 1))
  })

  it('restoring a saved version takes two steps', async () => {
    const api = setApi(profile(), { listBrandVersions: vi.fn().mockResolvedValue([{ version: 3, createdAt: 1700000000000 }]) })
    render(<BrandPage />)
    const select = await screen.findByLabelText('Versi tersimpan')
    await screen.findByRole('option', { name: /v3/ })
    fireEvent.change(select, { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pulihkan' }))
    expect(api.restoreBrandVersion).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Ya, pulihkan' }))
    await waitFor(() => expect(api.restoreBrandVersion).toHaveBeenCalledWith(3))
  })
})

