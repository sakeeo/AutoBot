// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryPanel } from '../../src/client/pages/MemoryPanel'
import { MessagesPage } from '../../src/client/pages/MessagesPage'

afterEach(cleanup)
const C = '6281111@s.whatsapp.net'

function setApi(mem: { summary: string; facts: Record<string, string> } = { summary: 'Tanya paket website UMKM.', facts: { budget: 'sekitar 5 juta', kota: 'Palu' } }, over: Record<string, unknown> = {}) {
  const api = {
    memGet: vi.fn().mockResolvedValue(mem),
    memUpdate: vi.fn().mockResolvedValue(undefined),
    memForget: vi.fn().mockResolvedValue(undefined),
    ...over
  }
  ;(window as any).api = api
  return api
}

describe('MemoryPanel', () => {
  it('shows the summary and each fact', async () => {
    setApi()
    render(<MemoryPanel chatId={C} />)
    expect(((await screen.findByLabelText('Ringkasan')) as HTMLTextAreaElement).value).toBe('Tanya paket website UMKM.')
    expect((screen.getByLabelText('Nilai budget') as HTMLInputElement).value).toBe('sekitar 5 juta')
    expect((screen.getByLabelText('Nilai kota') as HTMLInputElement).value).toBe('Palu')
  })
  it('says there is nothing yet when the memory is empty, with nothing to forget', async () => {
    setApi({ summary: '', facts: {} })
    render(<MemoryPanel chatId={C} />)
    expect(await screen.findByText(/belum ada memori/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /lupakan/i })).toBeNull()
  })
  it('deletes one fact and keeps the others', async () => {
    const api = setApi()
    render(<MemoryPanel chatId={C} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Hapus fakta kota' }))
    await waitFor(() => expect(api.memUpdate).toHaveBeenCalledWith(C, { facts: { budget: 'sekitar 5 juta' } }))
    await waitFor(() => expect(screen.queryByLabelText('Nilai kota')).toBeNull())
  })
  it('saves an edited fact value and an edited summary', async () => {
    const api = setApi()
    render(<MemoryPanel chatId={C} />)
    const v = await screen.findByLabelText('Nilai budget')
    fireEvent.change(v, { target: { value: 'sekitar 7 juta' } })
    fireEvent.blur(v)
    await waitFor(() => expect(api.memUpdate).toHaveBeenCalledWith(C, { facts: { budget: 'sekitar 7 juta', kota: 'Palu' } }))
    const save = screen.getByRole('button', { name: 'Simpan ringkasan' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Ringkasan'), { target: { value: 'Diedit.' } })
    fireEvent.click(save)
    await waitFor(() => expect(api.memUpdate).toHaveBeenCalledWith(C, { summary: 'Diedit.' }))
  })
  it('forgetting the customer takes two steps', async () => {
    const api = setApi()
    render(<MemoryPanel chatId={C} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Lupakan pelanggan ini' }))
    expect(api.memForget).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Ya, Lupakan pelanggan ini' }))
    await waitFor(() => expect(api.memForget).toHaveBeenCalledWith(C))
    expect(await screen.findByText(/belum ada memori/i)).toBeTruthy()
  })
  it('shows an error when saving fails', async () => {
    setApi(undefined, { memUpdate: vi.fn().mockRejectedValue(new Error('x')) })
    render(<MemoryPanel chatId={C} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Hapus fakta kota' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/gagal menyimpan/i)
  })
})

describe('MessagesPage memory panel', () => {
  const msg = (chatId: string, isGroup: boolean) => ({ id: 1, chatId, direction: 'in' as const, text: 'halo', at: 1_700_000_000_000, isGroup })
  it('appears for a customer chat but not for a group', async () => {
    const api = {
      listChats: vi.fn().mockResolvedValue([
        { chatId: C, isGroup: false, last: msg(C, false), count: 1 },
        { chatId: '99@g.us', isGroup: true, last: { ...msg('99@g.us', true), id: 2 }, count: 1 }
      ]),
      getThread: vi.fn().mockResolvedValue([]),
      onMessage: vi.fn().mockReturnValue(() => undefined),
      memGet: vi.fn().mockResolvedValue({ summary: 'Ringkasan A.', facts: {} }),
      memUpdate: vi.fn(), memForget: vi.fn()
    }
    ;(window as any).api = api
    render(<MessagesPage />)
    fireEvent.click(await screen.findByText('6281111'))
    expect(await screen.findByLabelText('Memori pelanggan')).toBeTruthy()
    fireEvent.click(screen.getByText('99'))
    await waitFor(() => expect(screen.queryByLabelText('Memori pelanggan')).toBeNull())
    expect(api.memGet).toHaveBeenCalledTimes(1)
  })
})
