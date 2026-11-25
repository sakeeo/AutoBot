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
  it('shows the question as a bubble and each AI reply part as its own bubble, with the intent', async () => {
    const testQuestion = vi.fn().mockResolvedValue(aiResult(['Halo Kak!', 'Ada yang bisa kami bantu?']))
    ;(window as any).api = { testQuestion }
    render(<TestPanel />)
    fireEvent.change(screen.getByLabelText(/pertanyaan/i), { target: { value: 'hslo ksk' } })
    fireEvent.keyDown(screen.getByLabelText(/pertanyaan/i), { key: 'Enter' })
    expect(await screen.findByText('Halo Kak!')).toBeTruthy()
    expect(screen.getByText('Ada yang bisa kami bantu?')).toBeTruthy()
    expect(screen.getByText('hslo ksk')).toBeTruthy()
    expect(screen.getByText('intent: sapaan')).toBeTruthy()
    expect(testQuestion).toHaveBeenCalledWith('hslo ksk')
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
    await waitFor(() => expect(testQuestion).toHaveBeenCalledWith('Halo'))
    await screen.findByText('Hai!')
    fireEvent.click(screen.getByRole('button', { name: /bersihkan chat/i }))
    expect(screen.queryByText('Hai!')).toBeNull()
  })

  it('shows only the file name of a retrieved document, for Windows and Linux paths alike', async () => {
    const hit = (file: string) => ({ chunkId: 1, file, text: 'Harga kopi Rp25.000', coverage: 1, rank: -1 })
    for (const file of ['C:\\Users\\x\\docs\\faq.md', '/home/x/docs/faq.md']) {
      cleanup()
      ;(window as any).api = { testQuestion: vi.fn().mockResolvedValue({
        decision: { kind: 'answerable', hits: [hit(file)] }, answer: { text: 'Rp25.000', sources: [] }, via: 'extractive' }) }
      render(<TestPanel />)
      fireEvent.change(screen.getByLabelText(/pertanyaan/i), { target: { value: 'harga' } })
      fireEvent.keyDown(screen.getByLabelText(/pertanyaan/i), { key: 'Enter' })
      expect(await screen.findByText(/^faq\.md · skor 1\.00/)).toBeTruthy()
    }
  })
})
