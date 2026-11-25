// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { ConnectionPage } from '../../src/client/pages/ConnectionPage'
import { KnowledgePage } from '../../src/client/pages/KnowledgePage'
import { AiSettings } from '../../src/client/pages/AiSettings'
import { SecurityPage } from '../../src/client/pages/SecurityPage'
import type { Settings } from '@autobot/contracts/types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/'
}))

const settings: Settings = {
  mode: 'extractive',
  outOfContext: { action: 'reply', replyText: 'Maaf' }, threshold: 0.6, allowGroups: false, cooldownSec: 10,
  ai: { provider: 'claude', model: 'claude-haiku-5-5', maxTokens: 400 }, theme: 'auto',
  notifyIncoming: true, memoryEnabled: true
}

function setApi(over: Record<string, unknown> = {}) {
  const api = {
    getStatus: vi.fn().mockResolvedValue({ state: 'connected' }),
    onStatus: vi.fn().mockReturnValue(() => undefined),
    connect: vi.fn().mockResolvedValue(undefined), logout: vi.fn().mockResolvedValue(undefined),
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn().mockImplementation(async (p) => ({ ...settings, ...p })),
    reindex: vi.fn().mockResolvedValue(undefined),
    uploadKnowledge: vi.fn(), knowledgeDownloadUrl: (n: string) => `/api/knowledge/download?name=${encodeURIComponent(n)}`, kbDelete: vi.fn(),
    listFiles: vi.fn().mockResolvedValue([]), onIndexStatus: vi.fn().mockReturnValue(() => undefined),
    hasApiKey: vi.fn().mockResolvedValue(true), deleteApiKey: vi.fn().mockResolvedValue(undefined),
    saveApiKey: vi.fn(),
    ...over
  }
  ;(window as any).api = api
  return api
}

beforeEach(() => setApi())
afterEach(cleanup)

const h2s = () => screen.getAllByRole('heading', { level: 2 })

describe('ConnectionPage', () => {
  it('has a single page title with the status as a text badge', async () => {
    render(<ConnectionPage />)
    await screen.findByText('Terhubung')
    expect(h2s().map((h) => h.textContent?.trim())).toEqual(['Koneksi WhatsApp'])
  })
  it('logging out takes two steps and the first never calls the API', async () => {
    const api = setApi()
    render(<ConnectionPage />)
    fireEvent.click(await screen.findByRole('button', { name: /keluar dari whatsapp/i }))
    expect(api.logout).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Ya, keluar' }))
    expect(api.logout).toHaveBeenCalledTimes(1)
  })
  it('shows an error state with retry when the status cannot be read', async () => {
    const api = setApi({ getStatus: vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue({ state: 'disconnected' }) })
    render(<ConnectionPage />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/gagal memuat status/i)
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    expect(await screen.findByText('Terputus')).toBeTruthy()
    expect(api.getStatus).toHaveBeenCalledTimes(2)
  })
})

describe('KnowledgePage', () => {
  it('has a single page title and explains the empty state', async () => {
    render(<KnowledgePage />)
    expect(await screen.findByText(/belum ada file terindeks/i)).toBeTruthy()
    expect(h2s().map((h) => h.textContent?.trim())).toEqual(['Pengetahuan'])
  })
  it('has no folder picker and no exclude patterns: the server owns the one knowledge folder', async () => {
    render(<KnowledgePage />)
    await screen.findByText(/belum ada file terindeks/i)
    expect(screen.queryByRole('button', { name: /pilih folder/i })).toBeNull()
    expect(screen.queryByLabelText(/pola pengecualian/i)).toBeNull()
  })
  it('lists files in a table with text status badges', async () => {
    setApi({
      listFiles: vi.fn().mockResolvedValue([
        { file: 'faq.md', status: 'indexed', chunks: 3 },
        { file: 'kosong.txt', status: 'failed', chunks: 0, reason: 'EMPTY' }
      ])
    })
    render(<KnowledgePage />)
    await screen.findByText('faq.md')
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['File', 'Status', 'Chunk', 'Aksi'])
    expect(screen.getByText('Terindeks').className).toMatch(/badge/)
    expect(screen.getByText('Gagal: EMPTY').className).toMatch(/badge/)
  })
  it('downloads through a plain link the browser follows', async () => {
    setApi({ listFiles: vi.fn().mockResolvedValue([{ file: '_sheets/1/harga.txt', status: 'indexed', chunks: 3 }]) })
    render(<KnowledgePage />)
    const link = (await screen.findByRole('link', { name: 'Unduh harga.txt' })) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/api/knowledge/download?name=_sheets%2F1%2Fharga.txt')
    expect(link.hasAttribute('download')).toBe(true)
  })
  it('deletes a file only after confirmation', async () => {
    const api = setApi({ listFiles: vi.fn().mockResolvedValue([{ file: 'faq.md', status: 'indexed', chunks: 3 }]), kbDelete: vi.fn().mockResolvedValue({ ok: true }) })
    render(<KnowledgePage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Hapus faq.md' }))
    expect(api.kbDelete).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Ya, Hapus faq.md' }))
    await waitFor(() => expect(api.kbDelete).toHaveBeenCalledWith('faq.md'))
  })
  it('uploads the chosen files and reports what was rejected', async () => {
    const api = setApi({ uploadKnowledge: vi.fn().mockResolvedValue({ added: ['a.md'], rejected: [{ name: 'x.exe', reason: 'Format tidak didukung.' }] }) })
    const { container } = render(<KnowledgePage />)
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['isi'], 'a.md'), new File(['x'], 'x.exe')] } })
    await waitFor(() => expect(api.uploadKnowledge).toHaveBeenCalledTimes(1))
    expect((api.uploadKnowledge as any).mock.calls[0][0].map((f: File) => f.name)).toEqual(['a.md', 'x.exe'])
    expect((await screen.findByRole('status')).textContent).toMatch(/1 file ditambahkan.*x\.exe: Format tidak didukung/)
  })
  it('uploads files dropped onto the drop area', async () => {
    const api = setApi({ uploadKnowledge: vi.fn().mockResolvedValue({ added: ['b.txt'], rejected: [] }) })
    render(<KnowledgePage />)
    const zone = (await screen.findByText(/tarik dokumen ke sini/i)).parentElement as HTMLElement
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['isi'], 'b.txt')] } })
    await waitFor(() => expect(api.uploadKnowledge).toHaveBeenCalledTimes(1))
  })
  it('shows a failed upload as an error, not as success', async () => {
    setApi({ uploadKnowledge: vi.fn().mockRejectedValue(new Error('Unggahan lebih dari 20 MB.')) })
    const { container } = render(<KnowledgePage />)
    fireEvent.change(container.querySelector('input[type=file]') as HTMLInputElement, { target: { files: [new File(['x'], 'besar.pdf')] } })
    expect((await screen.findByRole('status')).textContent).toMatch(/20 MB/)
    expect(screen.getByRole('status').className).toMatch(/alert-danger/)
  })
})

describe('AiSettings', () => {
  it('has a single page title', async () => {
    render(<AiSettings />)
    await screen.findByLabelText(/api key/i)
    expect(h2s()).toHaveLength(1)
  })
  it('deleting the key takes two steps', async () => {
    const api = setApi()
    render(<AiSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Hapus key' }))
    expect(api.deleteApiKey).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Ya, Hapus key' }))
    await waitFor(() => expect(api.deleteApiKey).toHaveBeenCalledTimes(1))
  })
  it('has a switch to remember returning customers, on by default', async () => {
    const api = setApi()
    render(<AiSettings />)
    const sw = (await screen.findByLabelText('Ingat pelanggan lama')) as HTMLInputElement
    expect(sw.checked).toBe(true)
    fireEvent.click(sw)
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ memoryEnabled: false }))
  })
  it('shows the saved-key status as text', async () => {
    render(<AiSettings />)
    expect((await screen.findByText('Key tersimpan')).className).toMatch(/badge/)
  })
})

describe('SecurityPage', () => {
  const posts: { path: string; body: any }[] = []
  beforeEach(() => {
    posts.length = 0
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') { posts.push({ path, body: JSON.parse(String(init.body)) }); return new Response(JSON.stringify({ ok: true, recoveryCodes: ['AAAAA-BBBBB', 'CCCCC-DDDDD'] }), { status: 200 }) }
      if (path === '/api/auth/devices') return new Response(JSON.stringify({ ok: true, devices: [
        { id: 'abc123abc123', createdAt: 1, lastSeenAt: 2, userAgent: 'Firefox', current: true },
        { id: 'def456def456', createdAt: 1, lastSeenAt: 2, userAgent: 'Chrome HP', current: false }] }), { status: 200 })
      return new Response(JSON.stringify({ ok: true, username: 'budi', ownerPhone: '62••••890', recoveryWarning: false }), { status: 200 })
    }))
  })
  afterEach(() => vi.unstubAllGlobals())
  const type = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } })

  it('has a single page title and one card per kind of change', async () => {
    render(<SecurityPage />)
    for (const name of ['Perangkat yang sedang masuk', 'Ganti password', 'Kode pemulihan', 'Authenticator', 'Nomor pemilik', 'Tampilan', 'Notifikasi di browser'])
      expect(await screen.findByRole('region', { name })).toBeTruthy()
    expect(h2s().map((h) => h.textContent?.trim())).toEqual(['Keamanan & Umum'])
    expect(screen.getByText(/masuk sebagai budi/i)).toBeTruthy()
  })
  it('has no desktop-era controls: no login on/off, no auto-start, no lock timer', async () => {
    render(<SecurityPage />)
    await screen.findByRole('region', { name: 'Ganti password' })
    for (const gone of [/nonaktifkan login/i, /jalankan saat komputer/i, /kunci otomatis/i]) expect(screen.queryByText(gone)).toBeNull()
  })
  it('lists the devices, marks the current one, and signs another one out only after confirmation', async () => {
    render(<SecurityPage />)
    expect(await screen.findByText('Perangkat ini')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'keluarkan perangkat ini' }))
    expect(posts).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Ya, keluarkan perangkat ini' }))
    await waitFor(() => expect(posts).toEqual([{ path: '/api/auth/devices/revoke', body: { id: 'def456def456' } }]))
  })
  it('changing the password sends the old password, the authenticator code and the new password', async () => {
    render(<SecurityPage />)
    const card = within(await screen.findByRole('region', { name: 'Ganti password' }))
    type(card.getByLabelText('Password saat ini'), 'sandi lama panjang sekali')
    type(card.getByLabelText('Kode authenticator'), '123456')
    type(card.getByLabelText('Password baru'), 'sandi baru panjang sekali ya')
    type(card.getByLabelText('Ulangi password baru'), 'sandi baru panjang sekali ya')
    fireEvent.click(card.getByRole('button', { name: 'Ganti password' }))
    await waitFor(() => expect(posts).toEqual([{ path: '/api/auth/password', body: { oldPassword: 'sandi lama panjang sekali', totp: '123456', newPassword: 'sandi baru panjang sekali ya' } }]))
    expect((await screen.findAllByRole('status')).some((n) => /password diganti/i.test(n.textContent ?? ''))).toBe(true)
  })
  it('does not send anything when the two new passwords differ', async () => {
    render(<SecurityPage />)
    const card = within(await screen.findByRole('region', { name: 'Ganti password' }))
    type(card.getByLabelText('Password saat ini'), 'sandi lama panjang sekali')
    type(card.getByLabelText('Kode authenticator'), '123456')
    type(card.getByLabelText('Password baru'), 'sandi baru panjang sekali ya')
    type(card.getByLabelText('Ulangi password baru'), 'beda sekali dengan yang atas')
    fireEvent.click(card.getByRole('button', { name: 'Ganti password' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/tidak sama/i)
    expect(posts).toEqual([])
  })
  it('shows new recovery codes once and forgets them when told they are saved', async () => {
    render(<SecurityPage />)
    const card = within(await screen.findByRole('region', { name: 'Kode pemulihan' }))
    type(card.getByLabelText('Password'), 'sandi lama panjang sekali')
    type(card.getByLabelText('Kode authenticator'), '123456')
    fireEvent.click(card.getByRole('button', { name: 'Buat ulang kode pemulihan' }))
    expect(await card.findByText('AAAAA-BBBBB')).toBeTruthy()
    expect(posts[0]).toEqual({ path: '/api/auth/recovery-codes', body: { password: 'sandi lama panjang sekali', totp: '123456' } })
    fireEvent.click(card.getByRole('button', { name: 'Sudah saya simpan' }))
    expect(card.queryByText('AAAAA-BBBBB')).toBeNull()
  })
  it('warns when few recovery codes are left', async () => {
    ;(globalThis.fetch as any).mockImplementation(async (path: string) =>
      new Response(JSON.stringify(path === '/api/auth/devices' ? { ok: true, devices: [] } : { ok: true, username: 'budi', ownerPhone: null, recoveryWarning: true }), { status: 200 }))
    render(<SecurityPage />)
    expect((await screen.findByText(/tinggal sedikit/i)).textContent).toMatch(/buat yang baru/i)
  })
  it('changing the theme is saved through the settings', async () => {
    const api = setApi()
    render(<SecurityPage />)
    fireEvent.change(await screen.findByLabelText('Tema'), { target: { value: 'dark' } })
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ theme: 'dark' }))
  })
  it('has a switch for browser notifications of incoming messages', async () => {
    const api = setApi()
    render(<SecurityPage />)
    fireEvent.click(await screen.findByLabelText(/beri tahu setiap pesan pelanggan/i))
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ notifyIncoming: false }))
  })
  it('signing out of every device takes two steps', async () => {
    render(<SecurityPage />)
    fireEvent.click(await screen.findByRole('button', { name: /keluar dari semua perangkat/i }))
    expect(posts).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Ya, keluar semua' }))
    await waitFor(() => expect(posts).toEqual([{ path: '/api/auth/logout-all', body: {} }]))
  })
})
