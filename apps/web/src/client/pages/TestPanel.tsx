import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { TestResult } from '@autobot/contracts/ipc'
import { PageHeader } from '../ui/PageHeader'

type Item = { id: number; kind: 'user'; text: string; at: number } | { id: number; kind: 'bot'; res: TestResult; at: number }

const FALLBACK_WHY: Record<NonNullable<TestResult['agent']>['fallbackReason'] & string, string> = {
  timeout: 'AI tidak menjawab dalam batas waktu (60 detik). Coba lagi, atau pilih model yang lebih cepat di menu AI.',
  auth: 'API key ditolak oleh penyedia. Hubungkan ulang key di menu AI.',
  rate_limit: 'Penyedia AI membatasi permintaan. Tunggu sebentar lalu coba lagi.',
  network: 'Tidak bisa terhubung ke penyedia AI. Periksa koneksi internet.',
  unusable: 'AI membalas dengan format yang tidak bisa dipakai (sering karena "Maks token jawaban" terlalu kecil atau model kurang cocok). Naikkan batas token atau ganti model di menu AI.'
}
const SAMPLES = ['Halo', 'Berapa harganya?', 'Jam buka berapa?', 'Terima kasih']
const clock = (t: number): string => new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })

/** What the bot would send, as the separate chat bubbles a customer would see (empty: it sends nothing). */
export function botBubbles(res: TestResult): string[] {
  if (res.agent) return res.agent.fallback ? [] : res.agent.replyParts.filter((p) => p.trim() !== '')
  return res.answer?.text ? [res.answer.text] : []
}

/** The conversation so far, so the next test message is answered as part of the same chat (no second greeting). */
function historyOf(items: Item[]): { role: 'user' | 'bot'; text: string }[] {
  return items
    .map((it) => (it.kind === 'user' ? { role: 'user' as const, text: it.text } : { role: 'bot' as const, text: botBubbles(it.res).join('\n') }))
    .filter((t) => t.text.trim() !== '')
    .slice(-40)
    .map((t) => ({ ...t, text: t.text.slice(0, 4000) }))
}

/** Only what the customer would see on WhatsApp: the reply bubbles. No intent, source or score. */
function BotTurn({ item }: { item: Extract<Item, { kind: 'bot' }> }) {
  const { res } = item
  const bubbles = botBubbles(res)
  return (
    <div className="tchat-row tchat-row-bot">
      <div className="tchat-col">
        {res.agent?.fallback && (
          <div className="tchat-note tchat-note-warn" role="alert">
            {`${FALLBACK_WHY[res.agent.fallbackReason ?? 'unusable']} Pelanggan tidak menerima balasan; chat diserahkan ke admin.`}
          </div>
        )}
        {bubbles.length === 0 && !res.agent?.fallback && <div className="tchat-silent">Bot tidak membalas pesan ini.</div>}
        {bubbles.map((text, i) => (
          <div key={i} className="tchat-bubble tchat-bubble-bot">
            <div className="tchat-text">{text}</div>
            {i === bubbles.length - 1 && <time className="tchat-time">{clock(item.at)}</time>}
          </div>
        ))}
      </div>
    </div>
  )
}

export function TestPanel() {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [err, setErr] = useState<string | null>(null)
  const nextId = useRef(1)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [items, busy, err])

  async function send(text: string): Promise<void> {
    const t = text.trim()
    if (!t || busy) return
    setQ('')
    setErr(null)
    setBusy(true)
    const history = historyOf(items)
    setItems((l) => [...l, { id: nextId.current++, kind: 'user', text: t, at: Date.now() }])
    try {
      const res = await window.api.testQuestion(t, history)
      setItems((l) => [...l, { id: nextId.current++, kind: 'bot', res, at: Date.now() }])
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(q) }
  }

  return (
    <div>
      <PageHeader icon="bi-chat-dots" title="Uji Jawaban" subtitle="Coba pertanyaan di sini tanpa mengirim apa pun ke WhatsApp."
        actions={items.length > 0 && !busy
          ? <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { setItems([]); setErr(null) }}>
              <i className="bi bi-trash me-1" aria-hidden="true" />Bersihkan chat
            </button>
          : undefined} />
      <section className="tchat" aria-label="Simulasi chat">
        <div className="tchat-thread" aria-live="polite">
          {items.length === 0 && !busy && (
            <div className="tchat-empty">
              <i className="bi bi-whatsapp" aria-hidden="true" />
              <p>Ketik pesan seperti pelanggan, lalu lihat balasan bot.</p>
              <div className="tchat-samples">
                {SAMPLES.map((s) => <button key={s} type="button" className="tchat-sample" onClick={() => void send(s)}>{s}</button>)}
              </div>
            </div>
          )}
          {items.map((it) => it.kind === 'user' ? (
            <div key={it.id} className="tchat-row tchat-row-user">
              <div className="tchat-bubble tchat-bubble-user">
                <div className="tchat-text">{it.text}</div>
                <time className="tchat-time">{clock(it.at)}</time>
              </div>
            </div>
          ) : <BotTurn key={it.id} item={it} />)}
          {busy && (
            <div className="tchat-row tchat-row-bot">
              <div className="tchat-bubble tchat-bubble-bot" role="status">
                <span className="visually-hidden">Menguji…</span>
                <span className="tchat-typing" aria-hidden="true"><i /><i /><i /></span>
              </div>
            </div>
          )}
          {err && <div className="tchat-note tchat-note-error" role="alert">{err}</div>}
          <div ref={end} />
        </div>
        <form className="tchat-composer" onSubmit={(e) => { e.preventDefault(); void send(q) }}>
          <label htmlFor="q" className="visually-hidden">Pertanyaan</label>
          <textarea id="q" className="tchat-input" rows={1} placeholder="Ketik pesan…" value={q} maxLength={2000}
            onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
          <button className="tchat-send" type="submit" aria-label="Uji pesan" disabled={busy || !q.trim()}>
            <i className="bi bi-send-fill" aria-hidden="true" />
          </button>
        </form>
      </section>
      <p className="tchat-foot">Enter untuk mengirim, Shift+Enter untuk baris baru. Bot mengingat percakapan di layar ini sampai Anda menekan Bersihkan chat.</p>
    </div>
  )
}
