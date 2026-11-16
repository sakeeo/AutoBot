// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MessagesPage } from '../../src/renderer/pages/MessagesPage'
import type { ChatSummary, FeedMessage } from '../../src/shared/ipc'

const A = '6281111@s.whatsapp.net'
const B = '6282222@s.whatsapp.net'
const G = '99@g.us'
let seq = 0
const fm = (o: Partial<FeedMessage> = {}): FeedMessage => ({
  id: ++seq, chatId: A, direction: 'in', text: 'halo', at: 1_700_000_000_000 + seq * 1000, isGroup: false, ...o
})
const chat = (last: FeedMessage, count = 1): ChatSummary => ({ chatId: last.chatId, isGroup: last.isGroup, last, count })

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
