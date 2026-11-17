// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { TestPanel } from '../../src/renderer/pages/TestPanel'

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
})
