// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MessagesPage } from '../../src/client/pages/MessagesPage'
import type { ChatSummary, FeedMessage } from '@autobot/contracts/ipc'

const A = '6281111@s.whatsapp.net'
const B = '6282222@s.whatsapp.net'
const G = '99@g.us'
let seq = 0
const fm = (o: Partial<FeedMessage> = {}): FeedMessage => ({
  id: ++seq, chatId: A, direction: 'in', text: 'halo', at: 1_700_000_000_000 + seq * 1000, isGroup: false, ...o
})
const chat = (last: FeedMessage, count = 1, handling: ChatSummary['handling'] = 'bot'): ChatSummary => ({ chatId: last.chatId, isGroup: last.isGroup, last, count, handling })

let push: ((m: FeedMessage) => void) | null = null
let unsub = vi.fn()

function setApi(chats: ChatSummary[] | Error, threads: Record<string, FeedMessage[]> = {}) {
  push = null
  unsub = vi.fn()
  const api = {
    listChats: vi.fn().mockImplementation(async () => { if (chats instanceof Error) throw chats; return chats }),
    getThread: vi.fn().mockImplementation(async (id: string) => threads[id] ?? []),
    onMessage: vi.fn().mockImplementation((cb: (m: FeedMessage) => void) => { push = cb; return unsub })
  }
  ;(window as any).api = api
  return api
}
const emit = (m: FeedMessage) => act(async () => { push?.(m) })

beforeEach(() => { seq = 0 })
afterEach(cleanup)

describe('MessagesPage', () => {
  it('has a single page title', async () => {
    setApi([])
    render(<MessagesPage />)
    await screen.findByText(/belum ada pesan/i)
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.trim())).toEqual(['Pesan'])
  })

  it('shows a loading state, an error state with retry, and an empty state', async () => {
    const first = setApi([])
    first.listChats.mockReturnValueOnce(new Promise(() => undefined))
    const { unmount } = render(<MessagesPage />)
    expect(screen.getByRole('status').textContent).toMatch(/memuat/i)
    unmount()

    const api = setApi(new Error('db'))
    render(<MessagesPage />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/gagal memuat pesan/i)
    api.listChats.mockResolvedValue([])
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    expect(await screen.findByText(/belum ada pesan/i)).toBeTruthy()
    expect(screen.getByText(/pesan yang masuk akan muncul di sini/i)).toBeTruthy()
  })

  it('lists chats with number, last message and a Grup label for groups', async () => {
    setApi([chat(fm({ chatId: A, text: 'berapa harga?' }), 3), chat(fm({ chatId: G, isGroup: true, text: 'ramai' }))])
    render(<MessagesPage />)
    const list = await screen.findByRole('list', { name: 'Daftar percakapan' })
    expect(within(list).getByText('6281111')).toBeTruthy()
    expect(within(list).getByText('berapa harga?')).toBeTruthy()
    expect(within(list).getByText('Grup')).toBeTruthy()
    expect(within(list).getByText('3 pesan')).toBeTruthy()
  })

  it('opens a chat and labels each bubble in words', async () => {
    const m1 = fm({ direction: 'in', text: 'harga kopi?' })
    const m2 = fm({ direction: 'out', text: 'Rp25.000' })
    const m3 = fm({ direction: 'human', text: 'saya admin' })
    const api = setApi([chat(m3, 3)], { [A]: [m1, m2, m3] })
    render(<MessagesPage />)
    fireEvent.click(await screen.findByRole('button', { name: /6281111/ }))
    await waitFor(() => expect(api.getThread).toHaveBeenCalledWith(A))
    const thread = await screen.findByRole('log', { name: 'Percakapan' })
    expect(within(thread).getByText('harga kopi?')).toBeTruthy()
    expect(within(thread).getByText('Pelanggan')).toBeTruthy()
    expect(within(thread).getByText('Bot')).toBeTruthy()
    expect(within(thread).getByText('Admin')).toBeTruthy()
  })

  it('asks for a chat to be chosen, and explains an empty thread', async () => {
    setApi([chat(fm())], { [A]: [] })
    render(<MessagesPage />)
    expect(await screen.findByText(/pilih percakapan/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /6281111/ }))
    expect(await screen.findByText(/belum ada pesan di percakapan ini/i)).toBeTruthy()
  })

  it('adds a live message to the open chat without reloading', async () => {
    const m1 = fm({ text: 'pertama' })
    const api = setApi([chat(m1)], { [A]: [m1] })
    render(<MessagesPage />)
    fireEvent.click(await screen.findByRole('button', { name: /6281111/ }))
    const thread = await screen.findByRole('log', { name: 'Percakapan' })
    await within(thread).findByText('pertama')
    await emit(fm({ direction: 'out', text: 'balasan baru' }))
    expect(within(thread).getByText('balasan baru')).toBeTruthy()
    expect(api.getThread).toHaveBeenCalledTimes(1)
  })

  it('a live message for another chat only updates its preview and moves it to the top', async () => {
    const a = fm({ chatId: A, text: 'lama a' })
    const b = fm({ chatId: B, text: 'lama b' })
    setApi([chat(b), chat(a)], { [A]: [a] })
    render(<MessagesPage />)
    const list = await screen.findByRole('list', { name: 'Daftar percakapan' })
    fireEvent.click(within(list).getByRole('button', { name: /6281111/ }))
    await screen.findByRole('log', { name: 'Percakapan' })
    await emit(fm({ chatId: B, text: 'baru dari b' }))
    const rows = within(list).getAllByRole('button')
    expect(rows[0].textContent).toMatch(/6282222/)
    expect(within(list).getByText('baru dari b')).toBeTruthy()
    expect(within(screen.getByRole('log', { name: 'Percakapan' })).queryByText('baru dari b')).toBeNull()
  })

  it('a message from a chat not yet listed creates it', async () => {
    setApi([])
    render(<MessagesPage />)
    await screen.findByText(/belum ada pesan/i)
    await emit(fm({ chatId: B, text: 'pelanggan baru' }))
    const list = await screen.findByRole('list', { name: 'Daftar percakapan' })
    expect(within(list).getByText('pelanggan baru')).toBeTruthy()
  })

  it('ignores the same live message delivered twice', async () => {
    const m1 = fm({ text: 'pertama' })
    setApi([chat(m1)], { [A]: [m1] })
    render(<MessagesPage />)
    fireEvent.click(await screen.findByRole('button', { name: /6281111/ }))
    const thread = await screen.findByRole('log', { name: 'Percakapan' })
    await within(thread).findByText('pertama')
    const next = fm({ text: 'sekali saja' })
    await emit(next)
    await emit(next)
    expect(within(thread).getAllByText('sekali saja')).toHaveLength(1)
    expect(screen.getByText('2 pesan')).toBeTruthy()
  })

  it('marks live updates and stops listening when the page closes', async () => {
    setApi([])
    const { unmount } = render(<MessagesPage />)
    expect((await screen.findByText('Langsung')).className).toMatch(/badge/)
    unmount()
    expect(unsub).toHaveBeenCalledTimes(1)
  })

  it('keeps very long text inside its bubble', async () => {
    const m = fm({ text: 'x'.repeat(1500) })
    setApi([chat(m)], { [A]: [m] })
    render(<MessagesPage />)
    fireEvent.click(await screen.findByRole('button', { name: /6281111/ }))
    const bubble = await screen.findByText('x'.repeat(1500), { selector: '[data-testid="bubble-text"]' })
    expect(bubble.className).toMatch(/text-break/)
  })

  it('keeps at most 500 bubbles in memory', async () => {
    const many = Array.from({ length: 500 }, (_, i) => fm({ text: `t${i}` }))
    setApi([chat(many[499], 500)], { [A]: many })
    render(<MessagesPage />)
    fireEvent.click(await screen.findByRole('button', { name: /6281111/ }))
    const thread = await screen.findByRole('log', { name: 'Percakapan' })
    await within(thread).findByText('t499')
    await emit(fm({ text: 'tambahan' }))
    expect(within(thread).getByText('tambahan')).toBeTruthy()
    expect(within(thread).queryByText('t0')).toBeNull()
  })
})

describe('MessagesPage: stepping in', () => {
  const withApi = (handling: ChatSummary['handling'], over: Record<string, unknown> = {}) => {
    const api = {
      ...setApi([chat(fm(), 1, handling), chat(fm({ chatId: G, isGroup: true }), 1)]),
      takeOverChat: vi.fn().mockResolvedValue(undefined),
      handBackChat: vi.fn().mockResolvedValue(undefined),
      sendAsAdmin: vi.fn().mockResolvedValue({ ok: true }),
      memGet: vi.fn().mockResolvedValue({ summary: '', facts: {} }), memUpdate: vi.fn(), memForget: vi.fn(),
      ...over
    }
    ;(window as any).api = { ...(window as any).api, ...api }
    return (window as any).api
  }
  const openA = async () => { fireEvent.click(await screen.findByText('6281111')) }

  it('shows who handles a chat in the list and takes over with one click', async () => {
    const api = withApi('menunggu_admin')
    render(<MessagesPage />)
    expect((await screen.findAllByText('Menunggu admin')).length).toBeGreaterThan(1)
    await openA()
    expect(screen.queryByLabelText('Balasan admin')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^ambil alih$/i }))
    await waitFor(() => expect(api.takeOverChat).toHaveBeenCalledWith(A))
    expect((await screen.findAllByText('Ditangani manusia')).length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Balasan admin')).toBeTruthy()
    expect(screen.getByRole('button', { name: /kembalikan ke bot/i })).toBeTruthy()
  })
  it('hands the chat back to the bot', async () => {
    const api = withApi('manusia')
    render(<MessagesPage />)
    await openA()
    fireEvent.click(await screen.findByRole('button', { name: /kembalikan ke bot/i }))
    await waitFor(() => expect(api.handBackChat).toHaveBeenCalledWith(A))
    await waitFor(() => expect(screen.queryByLabelText('Balasan admin')).toBeNull())
    expect(screen.getByRole('button', { name: /^ambil alih$/i })).toBeTruthy()
  })
  it('sends a reply typed in the app and clears the box; Shift+Enter does not send', async () => {
    const api = withApi('manusia')
    render(<MessagesPage />)
    await openA()
    const box = (await screen.findByLabelText('Balasan admin')) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Halo Kak' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(api.sendAsAdmin).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(api.sendAsAdmin).toHaveBeenCalledWith(A, 'Halo Kak'))
    await waitFor(() => expect(box.value).toBe(''))
  })
  it('shows the reason when sending fails and keeps the draft', async () => {
    withApi('manusia', { sendAsAdmin: vi.fn().mockResolvedValue({ ok: false, error: 'Pesan gagal terkirim. Pastikan WhatsApp terhubung.' }) })
    render(<MessagesPage />)
    await openA()
    const box = (await screen.findByLabelText('Balasan admin')) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Halo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kirim' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/gagal terkirim/i)
    expect(box.value).toBe('Halo')
  })
  it('offers no takeover for a group, and a message typed on the phone marks the chat as handled by a person', async () => {
    withApi('bot')
    render(<MessagesPage />)
    fireEvent.click(await screen.findByText('99'))
    expect(screen.queryByRole('button', { name: /^ambil alih$/i })).toBeNull()
    await emit(fm({ direction: 'human', text: 'saya admin' }))
    await waitFor(() => expect(screen.getAllByText('Ditangani manusia').length).toBeGreaterThan(0))
  })

  it('filters the list by who handles the chat, with counts; groups only show under Semua', async () => {
    const C2 = '6283333@s.whatsapp.net'
    const D = '6284444@s.whatsapp.net'
    setApi([
      chat(fm({ chatId: A }), 1, 'bot'), chat(fm({ chatId: C2 }), 1, 'manusia'),
      chat(fm({ chatId: D }), 1, 'menunggu_admin'), chat(fm({ chatId: G, isGroup: true }), 1)
    ])
    ;(window as any).api = { ...(window as any).api, memGet: vi.fn().mockResolvedValue({ summary: '', facts: {} }) }
    render(<MessagesPage />)
    const filter = await screen.findByRole('group', { name: 'Filter percakapan' })
    const btn = (name: string) => within(filter).getByRole('button', { name: new RegExp(`^${name}`) })
    expect(btn('Semua').textContent).toBe('Semua4')
    expect(btn('Ditangani AI').textContent).toBe('Ditangani AI1')
    expect(btn('Diambil alih').textContent).toBe('Diambil alih1')
    expect(btn('Menunggu admin').textContent).toBe('Menunggu admin1')

    fireEvent.click(btn('Diambil alih'))
    const list = screen.getByRole('list', { name: 'Daftar percakapan' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByText('6283333')).toBeTruthy()
    expect(btn('Diambil alih').getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(btn('Ditangani AI'))
    expect(within(screen.getByRole('list', { name: 'Daftar percakapan' })).getByText('6281111')).toBeTruthy()
    expect(screen.queryByText('99')).toBeNull()

    fireEvent.click(btn('Semua'))
    expect(within(screen.getByRole('list', { name: 'Daftar percakapan' })).getAllByRole('listitem')).toHaveLength(4)
  })
  it('says so when a filter has no chats, and a takeover moves the chat between filters', async () => {
    setApi([chat(fm(), 1, 'bot')])
    const api = (window as any).api
    ;(window as any).api = { ...api, takeOverChat: vi.fn().mockResolvedValue(undefined), memGet: vi.fn().mockResolvedValue({ summary: '', facts: {} }) }
    render(<MessagesPage />)
    const filter = await screen.findByRole('group', { name: 'Filter percakapan' })
    fireEvent.click(within(filter).getByRole('button', { name: /^Diambil alih/ }))
    expect(screen.getByText(/tidak ada percakapan di filter ini/i)).toBeTruthy()
    fireEvent.click(within(filter).getByRole('button', { name: /^Ditangani AI/ }))
    fireEvent.click(screen.getByText('6281111'))
    fireEvent.click(screen.getByRole('button', { name: /^ambil alih$/i }))
    await waitFor(() => expect(within(filter).getByRole('button', { name: /^Diambil alih/ }).textContent).toBe('Diambil alih1'))
    expect(within(filter).getByRole('button', { name: /^Ditangani AI/ }).textContent).toBe('Ditangani AI0')
  })

  describe('selecting many chats', () => {
    const C2 = '6283333@s.whatsapp.net'
    const load = (over: Record<string, unknown> = {}) => {
      const api = {
        ...setApi([chat(fm({ chatId: A }), 1, 'bot'), chat(fm({ chatId: C2 }), 1, 'bot'), chat(fm({ chatId: G, isGroup: true }), 1)]),
        setHandlingBulk: vi.fn().mockImplementation(async (ids: string[]) => ({ changed: ids.length })),
        memGet: vi.fn().mockResolvedValue({ summary: '', facts: {} }), ...over
      }
      ;(window as any).api = { ...(window as any).api, ...api }
      return (window as any).api
    }
    const start = async () => { fireEvent.click(await screen.findByRole('button', { name: /pilih beberapa/i })) }

    it('shows checkboxes only while selecting, none for groups, and the action buttons stay off until something is picked', async () => {
      load()
      render(<MessagesPage />)
      await screen.findByText('6281111')
      expect(screen.queryByLabelText('Pilih 6281111')).toBeNull()
      await start()
      expect(screen.getByLabelText('Pilih 6281111')).toBeTruthy()
      expect(screen.getByLabelText('Pilih 6283333')).toBeTruthy()
      expect(screen.queryByLabelText('Pilih 99')).toBeNull()
      expect((screen.getByRole('button', { name: 'Ambil alih terpilih' }) as HTMLButtonElement).disabled).toBe(true)
      expect(screen.getByText('0 dipilih')).toBeTruthy()
    })
    it('takes over the picked chats in one call and moves them to Diambil alih', async () => {
      const api = load()
      render(<MessagesPage />)
      await start()
      fireEvent.click(screen.getByLabelText('Pilih 6281111'))
      expect(screen.getByText('1 dipilih')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Ambil alih terpilih' }))
      await waitFor(() => expect(api.setHandlingBulk).toHaveBeenCalledWith([A], 'manusia'))
      expect((await screen.findByRole('status')).textContent).toMatch(/1 percakapan diambil alih/)
      const filter = screen.getByRole('group', { name: 'Filter percakapan' })
      expect(within(filter).getByRole('button', { name: /^Diambil alih/ }).textContent).toBe('Diambil alih1')
      expect(screen.queryByLabelText('Pilih 6281111')).toBeNull()
    })
    it('"Pilih semua" picks every chat shown (not groups) and hands them all back to the bot', async () => {
      const api = load()
      render(<MessagesPage />)
      await start()
      fireEvent.click(screen.getByLabelText('Pilih semua (2)'))
      expect(screen.getByText('2 dipilih')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Kembalikan terpilih ke bot' }))
      await waitFor(() => expect(api.setHandlingBulk).toHaveBeenCalledWith([A, C2], 'bot'))
      expect((await screen.findByRole('status')).textContent).toMatch(/2 percakapan dikembalikan ke bot/)
    })
    it('"Pilih semua" follows the active filter, and unticking clears it', async () => {
      load()
      render(<MessagesPage />)
      await start()
      const filter = screen.getByRole('group', { name: 'Filter percakapan' })
      fireEvent.click(within(filter).getByRole('button', { name: /^Diambil alih/ }))
      expect((screen.getByLabelText('Pilih semua (0)') as HTMLInputElement).disabled).toBe(true)
      fireEvent.click(within(filter).getByRole('button', { name: /^Ditangani AI/ }))
      fireEvent.click(screen.getByLabelText('Pilih semua (2)'))
      expect(screen.getByText('2 dipilih')).toBeTruthy()
      fireEvent.click(screen.getByLabelText('Pilih semua (2)'))
      expect(screen.getByText('0 dipilih')).toBeTruthy()
    })
    it('shows an error and keeps the selection when the change fails', async () => {
      load({ setHandlingBulk: vi.fn().mockRejectedValue(new Error('x')) })
      render(<MessagesPage />)
      await start()
      fireEvent.click(screen.getByLabelText('Pilih 6281111'))
      fireEvent.click(screen.getByRole('button', { name: 'Ambil alih terpilih' }))
      expect((await screen.findByRole('alert')).textContent).toMatch(/gagal mengubah status/i)
      expect(screen.getByText('1 dipilih')).toBeTruthy()
    })
  })
})
