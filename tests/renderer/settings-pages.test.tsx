// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { ConnectionPage } from '../../src/renderer/pages/ConnectionPage'
import { KnowledgePage } from '../../src/renderer/pages/KnowledgePage'
import { AiSettings } from '../../src/renderer/pages/AiSettings'
import { SecurityPage } from '../../src/renderer/pages/SecurityPage'
import { LockScreen } from '../../src/renderer/LockScreen'
import { AuthContext } from '../../src/renderer/auth-context'
import type { Settings } from '../../src/shared/types'

const settings: Settings = {
  knowledgeFolders: ['/home/u/docs'], excludePatterns: [], mode: 'extractive',
  outOfContext: { action: 'reply', replyText: 'Maaf' }, threshold: 0.6, allowGroups: false, cooldownSec: 10,
  ai: { provider: 'claude', model: 'claude-haiku-5-5', maxTokens: 400 }, autoStart: false, theme: 'auto',
  notifyIncoming: true
}

function setApi(over: Record<string, unknown> = {}) {
  const api = {
    getStatus: vi.fn().mockResolvedValue({ state: 'connected' }),
    onStatus: vi.fn().mockReturnValue(() => undefined),
    connect: vi.fn().mockResolvedValue(undefined), logout: vi.fn().mockResolvedValue(undefined),
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn().mockImplementation(async (p) => ({ ...settings, ...p })),
    pickFolder: vi.fn().mockResolvedValue(null), reindex: vi.fn().mockResolvedValue(undefined),
    kbUpload: vi.fn(), kbDownload: vi.fn(), kbDelete: vi.fn(),
    listFiles: vi.fn().mockResolvedValue([]), onIndexStatus: vi.fn().mockReturnValue(() => undefined),
    hasApiKey: vi.fn().mockResolvedValue(true), deleteApiKey: vi.fn().mockResolvedValue(undefined),
    saveApiKey: vi.fn(), openConsole: vi.fn(),
    authDisable: vi.fn().mockResolvedValue({ ok: true }), authLogin: vi.fn(), authReset: vi.fn(),
    authChangePassword: vi.fn(), authLock: vi.fn(), authSetup: vi.fn(), authSetAutoLock: vi.fn(),
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
  it('has a single page title and explains the empty states', async () => {
    setApi({ getSettings: vi.fn().mockResolvedValue({ ...settings, knowledgeFolders: [] }) })
    render(<KnowledgePage />)
    expect(await screen.findByText(/belum ada folder/i)).toBeTruthy()
    expect(await screen.findByText(/belum ada file terindeks/i)).toBeTruthy()
    expect(h2s()).toHaveLength(1)
  })
  it('removing a folder takes two steps', async () => {
    const api = setApi()
    render(<KnowledgePage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Hapus /home/u/docs' }))
    expect(api.updateSettings).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Ya, Hapus /home/u/docs' }))
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ knowledgeFolders: [] }))
  })
  it('lists files in a table with text status badges', async () => {
    setApi({
      listFiles: vi.fn().mockResolvedValue([
        { file: '/d/faq.md', status: 'indexed', chunks: 3 },
        { file: '/d/kosong.txt', status: 'failed', chunks: 0, reason: 'EMPTY' }
      ])
    })
    render(<KnowledgePage />)
    await screen.findByText(/faq\.md/)
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['File', 'Status', 'Chunk', 'Aksi'])
    expect(screen.getByText('Terindeks').className).toMatch(/badge/)
    expect(screen.getByText('Gagal: EMPTY').className).toMatch(/badge/)
  })
  it('shows only the file name, never the folder path', async () => {
    setApi({ listFiles: vi.fn().mockResolvedValue([{ file: '/home/u/docs/sub/faq.md', status: 'indexed', chunks: 3 }]) })
    render(<KnowledgePage />)
    await screen.findByText('faq.md')
    expect(screen.queryByText(/\/sub\//)).toBeNull()
  })
  it('downloads a file', async () => {
    const api = setApi({ listFiles: vi.fn().mockResolvedValue([{ file: '/d/faq.md', status: 'indexed', chunks: 3 }]), kbDownload: vi.fn().mockResolvedValue({ ok: true }) })
    render(<KnowledgePage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Unduh faq.md' }))
    await waitFor(() => expect(api.kbDownload).toHaveBeenCalledWith('/d/faq.md'))
  })
  it('deletes a file only after confirmation', async () => {
    const api = setApi({ listFiles: vi.fn().mockResolvedValue([{ file: '/d/faq.md', status: 'indexed', chunks: 3 }]), kbDelete: vi.fn().mockResolvedValue({ ok: true }) })
    render(<KnowledgePage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Hapus faq.md' }))
    expect(api.kbDelete).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Ya, Hapus faq.md' }))
    await waitFor(() => expect(api.kbDelete).toHaveBeenCalledWith('/d/faq.md'))
  })
  it('uploads files into the first knowledge folder and reports rejections', async () => {
    const api = setApi({
      kbUpload: vi.fn().mockResolvedValue({ canceled: false, folder: '/home/u/docs', added: ['a.md'], rejected: [{ name: 'x.exe', reason: 'Format tidak didukung.' }] })
    })
    render(<KnowledgePage />)
    fireEvent.click(await screen.findByRole('button', { name: /unggah file/i }))
    await waitFor(() => expect(api.kbUpload).toHaveBeenCalledWith('/home/u/docs'))
    expect((await screen.findByRole('status')).textContent).toMatch(/1 file ditambahkan.*x\.exe: Format tidak didukung/)
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
  it('shows the saved-key status as text', async () => {
    render(<AiSettings />)
    expect((await screen.findByText('Key tersimpan')).className).toMatch(/badge/)
  })
})

describe('SecurityPage', () => {
  const ctx = { state: { enabled: true, locked: false, username: 'admin', autoLockMin: 0 }, refresh: async () => undefined }
  const page = () => render(<AuthContext.Provider value={ctx}><SecurityPage /></AuthContext.Provider>)

  it('has a single page title and groups its sections into cards', async () => {
    page()
    await screen.findByRole('region', { name: 'Login aplikasi' })
    expect(screen.getByRole('region', { name: 'Umum' })).toBeTruthy()
    expect(h2s().map((h) => h.textContent?.trim())).toEqual(['Keamanan & Umum'])
  })
  it('has a switch for desktop notifications of incoming messages', async () => {
    const api = setApi()
    page()
    fireEvent.click(await screen.findByLabelText('Notifikasi pesan masuk'))
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ notifyIncoming: false }))
  })
  it('disabling login takes two steps and the first never calls the API', async () => {
    const api = setApi()
    page()
    fireEvent.change(await screen.findByLabelText(/password untuk menonaktifkan/i), { target: { value: 'rahasia-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Nonaktifkan login' }))
    expect(api.authDisable).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Ya, nonaktifkan' }))
    await waitFor(() => expect(api.authDisable).toHaveBeenCalledWith('rahasia-123'))
  })
})

describe('LockScreen', () => {
  it('is a card region named after the login and keeps the app name', () => {
    render(<LockScreen onUnlocked={() => undefined} />)
    const region = screen.getByRole('region', { name: 'Login aplikasi' })
    expect(within(region).getByText('WA Otomation')).toBeTruthy()
    expect(within(region).getByRole('button', { name: 'Masuk' })).toBeTruthy()
  })
})
