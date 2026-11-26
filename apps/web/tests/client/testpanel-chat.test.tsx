// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { TestPanel } from '../../src/client/pages/TestPanel'

afterEach(cleanup)

const aiResult = (parts: string[], intent = 'sapaan') => ({
  decision: { kind: 'answerable', hits: [] }, answer: { text: parts.join('\n\n'), sources: [] }, via: 'ai',
  agent: { intent, action: { kind: 'reply_only', ruleId: null, forced: false }, replyParts: parts, linkSent: null, handoff: null,
    sources: [], matchedRule: null, removed: { numbers: false, urls: [], numbersUnknown: [] }, fallback: false, hits: [] }
})

describe('Uji Jawaban as a chat', () => {
  it('shows the question as a bubble and each AI reply part as its own bubble, and nothing else', async () => {
    const testQuestion = vi.fn().mockResolvedValue(aiResult(['Halo Kak!', 'Ada yang bisa kami bantu?']))
    ;(window as any).api = { testQuestion }
    render(<TestPanel />)
    fireEvent.change(screen.getByLabelText(/pertanyaan/i), { target: { value: 'hslo ksk' } })
    fireEvent.keyDown(screen.getByLabelText(/pertanyaan/i), { key: 'Enter' })
    expect(await screen.findByText('Halo Kak!')).toBeTruthy()
    expect(screen.getByText('Ada yang bisa kami bantu?')).toBeTruthy()
    expect(screen.getByText('hslo ksk')).toBeTruthy()
    expect(screen.queryByText(/intent/i)).toBeNull()
    expect(screen.queryByText(/^AI$/)).toBeNull()
    expect(testQuestion).toHaveBeenCalledWith('hslo ksk', [])
    expect((screen.getByLabelText(/pertanyaan/i) as HTMLTextAreaElement).value).toBe('')
  })
  it('Shift+Enter does not send; a sample chip sends; the thread keeps growing and can be cleared', async () => {
    const testQuestion = vi.fn().mockResolvedValue(aiResult(['Hai!']))
    ;(window as any).api = { testQuestion }
    render(<TestPanel />)
    const box = screen.getByLabelText(/pertanyaan/i)
    fireEvent.change(box, { target: { value: 'tes' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(testQuestion).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Halo' }))
    await waitFor(() => expect(testQuestion).toHaveBeenCalledWith('Halo', []))
    await screen.findByText('Hai!')
    fireEvent.click(screen.getByRole('button', { name: /bersihkan chat/i }))
    expect(screen.queryByText('Hai!')).toBeNull()
  })

  it('sends the conversation so far with the next message, so the bot does not greet again', async () => {
    const testQuestion = vi.fn()
      .mockResolvedValueOnce(aiResult(['Halo Kak, saya asisten otomatis.', 'Ada yang bisa dibantu?']))
      .mockResolvedValueOnce(aiResult(['Boleh, website untuk usaha apa?'], 'tanya_produk'))
    ;(window as any).api = { testQuestion }
    render(<TestPanel />)
    const box = screen.getByLabelText(/pertanyaan/i)
    fireEvent.change(box, { target: { value: 'hi kak' } }); fireEvent.keyDown(box, { key: 'Enter' })
    await screen.findByText('Ada yang bisa dibantu?')
    fireEvent.change(box, { target: { value: 'mau konsultasi website' } }); fireEvent.keyDown(box, { key: 'Enter' })
    await screen.findByText('Boleh, website untuk usaha apa?')
    expect(testQuestion).toHaveBeenLastCalledWith('mau konsultasi website', [
      { role: 'user', text: 'hi kak' },
      { role: 'bot', text: 'Halo Kak, saya asisten otomatis.\nAda yang bisa dibantu?' }
    ])
    fireEvent.click(screen.getByRole('button', { name: /bersihkan chat/i }))
    fireEvent.change(box, { target: { value: 'halo lagi' } }); fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(testQuestion).toHaveBeenLastCalledWith('halo lagi', []))
  })
})
