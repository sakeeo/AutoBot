// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { ConnectionPage } from '../../src/renderer/pages/ConnectionPage'
import { KnowledgePage } from '../../src/renderer/pages/KnowledgePage'
import { TestPanel } from '../../src/renderer/pages/TestPanel'
import { AiSettings } from '../../src/renderer/pages/AiSettings'
import { ReplyBehaviorTab as RulesPage } from '../../src/renderer/brand/ReplyBehaviorTab'
import { LogPage } from '../../src/renderer/pages/LogPage'
import { applyTheme } from '../../src/renderer/theme'
import type { Settings } from '../../src/shared/types'

const settings: Settings = {
  knowledgeFolders: [],
  excludePatterns: [],
  mode: 'extractive',
  outOfContext: { action: 'reply', replyText: 'Maaf' },
  threshold: 0.6,
  allowGroups: false,
  cooldownSec: 10,
  ai: { provider: 'claude', model: 'claude-haiku-5-5', maxTokens: 400 },
  autoStart: false,
  theme: 'auto',
  notifyIncoming: true
}

function makeApi(over: Record<string, unknown> = {}) {
  return {
    getStatus: vi.fn().mockResolvedValue({ state: 'disconnected' }),
    connect: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    onStatus: vi.fn().mockReturnValue(() => undefined),
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn().mockImplementation(async (p) => ({ ...settings, ...p })),
    pickFolder: vi.fn().mockResolvedValue(null),
    listFiles: vi.fn().mockResolvedValue([]),
    reindex: vi.fn().mockResolvedValue(undefined),
    onIndexStatus: vi.fn().mockReturnValue(() => undefined),
    testQuestion: vi.fn(),
    saveApiKey: vi.fn().mockResolvedValue({ ok: true }),
    hasApiKey: vi.fn().mockResolvedValue(false),
    deleteApiKey: vi.fn().mockResolvedValue(undefined),
    openConsole: vi.fn().mockResolvedValue(undefined),
    getLog: vi.fn().mockResolvedValue([]),
    onEscalate: vi.fn().mockReturnValue(() => undefined),
    ...over
  }
}
const setApi = (over?: Record<string, unknown>) => {
  const api = makeApi(over)
  ;(window as any).api = api
  return api
}

beforeEach(() => setApi())
afterEach(cleanup)

describe('ConnectionPage', () => {
  it('keeps Hubungkan disabled until the risk checkbox is ticked', async () => {
    const api = setApi()
    render(<ConnectionPage />)
    const btn = (await screen.findByRole('button', { name: /hubungkan/i })) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText(/saya mengerti/i))
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)
    expect(api.connect).toHaveBeenCalled()
  })
  it('renders the QR code while waiting for a scan', async () => {
    setApi({ getStatus: vi.fn().mockResolvedValue({ state: 'waiting_qr', qr: '2@abc,def,ghi' }) })
    render(<ConnectionPage />)
    expect(await screen.findByAltText(/qr whatsapp/i)).toBeTruthy()
  })
  it('shows the connected state with a logout button', async () => {
    const api = setApi({ getStatus: vi.fn().mockResolvedValue({ state: 'connected' }) })
    render(<ConnectionPage />)
    fireEvent.click(await screen.findByRole('button', { name: /keluar dari whatsapp/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Ya, keluar' }))
    expect(api.logout).toHaveBeenCalled()
  })
})

describe('KnowledgePage', () => {
  it('adds a picked folder to settings', async () => {
    const api = setApi({ pickFolder: vi.fn().mockResolvedValue('/home/u/docs') })
    render(<KnowledgePage />)
    fireEvent.click(await screen.findByRole('button', { name: /pilih folder/i }))
    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith({ knowledgeFolders: ['/home/u/docs'] })
    )
  })
  it('lists files with their status and failure reason', async () => {
    setApi({
      listFiles: vi.fn().mockResolvedValue([
        { file: '/d/faq.md', status: 'indexed', chunks: 3 },
        { file: '/d/kosong.txt', status: 'failed', chunks: 0, reason: 'EMPTY' }
      ])
    })
    render(<KnowledgePage />)
    expect(await screen.findByText(/faq\.md/)).toBeTruthy()
    expect(await screen.findByText(/EMPTY/)).toBeTruthy()
  })
})

describe('TestPanel', () => {
  it('shows "Di luar konteks" for an out-of-context decision', async () => {
    setApi({
      testQuestion: vi.fn().mockResolvedValue({
        decision: { kind: 'out_of_context', reason: 'no_hits' },
        answer: null,
        via: null
      })
    })
    render(<TestPanel />)
    fireEvent.change(screen.getByLabelText(/pertanyaan/i), { target: { value: 'siapa presiden?' } })
    fireEvent.click(screen.getByRole('button', { name: /uji/i }))
    expect(await screen.findByText(/di luar konteks/i)).toBeTruthy()
  })
  it('shows the answer, source and coverage score when answerable', async () => {
    setApi({
      testQuestion: vi.fn().mockResolvedValue({
        decision: {
          kind: 'answerable',
          hits: [{ chunkId: 1, file: '/d/faq.md', text: 'Harga kopi Rp25.000', coverage: 1, rank: -1 }]
        },
        answer: { text: 'Harga kopi Rp25.000\n\nSumber: faq.md', sources: ['faq.md'] },
        via: 'extractive'
      })
    })
    render(<TestPanel />)
    fireEvent.change(screen.getByLabelText(/pertanyaan/i), { target: { value: 'harga kopi' } })
    fireEvent.click(screen.getByRole('button', { name: /uji/i }))
    expect((await screen.findAllByText(/Rp25\.000/)).length).toBeGreaterThan(0)
    expect(screen.getByText(/skor 1\.00/i)).toBeTruthy()
  })
})

describe('AiSettings', () => {
  it('disables the AI mode toggle until an API key exists', async () => {
    setApi({ hasApiKey: vi.fn().mockResolvedValue(false) })
    render(<AiSettings />)
    const toggle = (await screen.findByLabelText(/gunakan ai/i)) as HTMLInputElement
    expect(toggle.disabled).toBe(true)
  })
  it('enables the toggle when a key is stored and never renders it', async () => {
    setApi({ hasApiKey: vi.fn().mockResolvedValue(true) })
    render(<AiSettings />)
    const toggle = (await screen.findByLabelText(/gunakan ai/i)) as HTMLInputElement
    await waitFor(() => expect(toggle.disabled).toBe(false))
    expect((screen.getByLabelText(/api key/i) as HTMLInputElement).value).toBe('')
  })
  it('clears the key field after saving and then enables the toggle', async () => {
    const key = 'sk-ant-' + 'z'.repeat(24)
    let has = false
    const api = setApi({
      hasApiKey: vi.fn().mockImplementation(async () => has),
      saveApiKey: vi.fn().mockImplementation(async () => { has = true; return { ok: true } })
    })
    render(<AiSettings />)
    const input = (await screen.findByLabelText(/api key/i)) as HTMLInputElement
    fireEvent.change(input, { target: { value: key } })
    fireEvent.click(screen.getByRole('button', { name: /uji & simpan/i }))
    await waitFor(() => expect(api.saveApiKey).toHaveBeenCalledWith(key))
    await waitFor(() => expect(input.value).toBe(''))
    await waitFor(() => expect((screen.getByLabelText(/gunakan ai/i) as HTMLInputElement).disabled).toBe(false))
    expect(document.body.textContent).not.toContain(key)
  })
  it('shows the provider error and does not enable AI when saving fails', async () => {
    setApi({ saveApiKey: vi.fn().mockResolvedValue({ ok: false, error: 'API key ditolak oleh penyedia.' }) })
    render(<AiSettings />)
    fireEvent.change(await screen.findByLabelText(/api key/i), { target: { value: 'sk-ant-' + 'q'.repeat(20) } })
    fireEvent.click(screen.getByRole('button', { name: /uji & simpan/i }))
    expect(await screen.findByText(/ditolak oleh penyedia/i)).toBeTruthy()
    expect((screen.getByLabelText(/gunakan ai/i) as HTMLInputElement).disabled).toBe(true)
  })
  it('opens the provider console from the Hubungkan ke Claude button', async () => {
    const api = setApi()
    render(<AiSettings />)
    fireEvent.click(await screen.findByRole('button', { name: /hubungkan ke claude/i }))
    expect(api.openConsole).toHaveBeenCalled()
  })
  it('switches provider and applies its default model', async () => {
    const api = setApi()
    render(<AiSettings />)
    fireEvent.change(await screen.findByLabelText(/penyedia ai/i), { target: { value: 'deepseek' } })
    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith({
        ai: { provider: 'deepseek', model: 'deepseek-chat', maxTokens: 400, baseUrl: undefined }
      })
    )
  })
  it('discloses that document snippets are sent to the provider', async () => {
    render(<AiSettings />)
    expect(await screen.findByText(/mengirim potongan dokumen/i)).toBeTruthy()
  })
})

describe('ReplyBehaviorTab', () => {
  it('saves a changed threshold', async () => {
    const api = setApi()
    render(<RulesPage />)
    fireEvent.change(await screen.findByLabelText(/ambang/i), { target: { value: '0.8' } })
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ threshold: 0.8 }))
  })
  it('saves the out-of-context action', async () => {
    const api = setApi()
    render(<RulesPage />)
    fireEvent.change(await screen.findByLabelText(/aksi di luar konteks/i), { target: { value: 'silent' } })
    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith({ outOfContext: { action: 'silent', replyText: 'Maaf' } })
    )
  })
})

describe('LogPage', () => {
  it('renders decisions with the question', async () => {
    setApi({
      getLog: vi.fn().mockResolvedValue([
        { message_id: '1', chat_id: 'a@s.whatsapp.net', decision: 'replied:extractive', top_score: 1,
          sources: '["faq.md"]', created_at: 1700000000000, text: 'berapa harga kopi?' }
      ])
    })
    render(<LogPage />)
    expect(await screen.findByText(/berapa harga kopi/)).toBeTruthy()
    expect(screen.getByText(/replied:extractive/)).toBeTruthy()
  })
})

describe('applyTheme', () => {
  it('sets data-bs-theme for dark and light', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset.bsTheme).toBe('dark')
    applyTheme('light')
    expect(document.documentElement.dataset.bsTheme).toBe('light')
  })
  it('follows prefers-color-scheme for auto', () => {
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as any
    applyTheme('auto')
    expect(document.documentElement.dataset.bsTheme).toBe('dark')
  })
})

describe('LogPage layout', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      message_id: `m${i}`, chat_id: 'a@s.whatsapp.net', decision: i % 2 ? 'replied:ai' : 'out_of_context:reply',
      top_score: i % 2 ? 0.5 : null, sources: i % 2 ? '["faq.md"]' : null, created_at: 1700000000000 + i, text: `pesan ${i}`
    }))
  it('shows a table with a single title, text badges and a right-aligned score', async () => {
    setApi({ getLog: vi.fn().mockResolvedValue(rows(2)) })
    render(<LogPage />)
    await screen.findByText('pesan 0')
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1)
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Waktu', 'Keputusan', 'Skor', 'Sumber', 'Pesan'])
    expect(screen.getByText('replied:ai').className).toMatch(/badge/)
    expect(screen.getByText('0.50').closest('td')!.className).toMatch(/text-end/)
  })
  it('pages through the log ten rows at a time', async () => {
    setApi({ getLog: vi.fn().mockResolvedValue(rows(25)) })
    render(<LogPage />)
    await screen.findByText('1–10 dari 25')
    fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }))
    expect(screen.getByText('11–20 dari 25')).toBeTruthy()
  })
  it('shows an empty state, and an error state with retry', async () => {
    const api = setApi({ getLog: vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue([]) })
    render(<LogPage />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/gagal memuat log/i)
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    expect(await screen.findByText(/belum ada pesan/i)).toBeTruthy()
    expect(api.getLog).toHaveBeenCalledTimes(2)
  })
  it('reloads from the Muat ulang button', async () => {
    const api = setApi({ getLog: vi.fn().mockResolvedValue([]) })
    render(<LogPage />)
    await screen.findByText(/belum ada pesan/i)
    fireEvent.click(screen.getByRole('button', { name: /muat ulang/i }))
    await waitFor(() => expect(api.getLog).toHaveBeenCalledTimes(2))
  })
})

describe('TestPanel layout', () => {
  it('has a single title, shows a busy state and an error state', async () => {
    let reject!: (e: Error) => void
    setApi({ testQuestion: vi.fn().mockReturnValue(new Promise((_, r) => { reject = r })) })
    render(<TestPanel />)
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1)
    fireEvent.change(screen.getByLabelText(/pertanyaan/i), { target: { value: 'halo' } })
    fireEvent.click(screen.getByRole('button', { name: /uji/i }))
    expect((await screen.findByRole('status')).textContent).toMatch(/menguji/i)
    reject(new Error('gateway putus'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/gateway putus/)
  })
})

