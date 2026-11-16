import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatSummary, FeedMessage } from '../../shared/ipc'
import { Card } from '../ui/Card'
import { PageHeader } from '../ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '../ui/States'
import { StatusBadge } from '../ui/StatusBadge'

const MAX_BUBBLES = 500
const WHO: Record<FeedMessage['direction'], string> = { in: 'Pelanggan', out: 'Bot', human: 'Admin' }

const numberOf = (chatId: string): string => chatId.split('@')[0]
const clock = (at: number): string => new Date(at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })

/** Puts the chat of a new message at the top with its new preview; an already-seen message changes nothing. */
function withMessage(chats: ChatSummary[], m: FeedMessage): ChatSummary[] {
  const old = chats.find((c) => c.chatId === m.chatId)
  if (old && m.id <= old.last.id) return chats
  const next: ChatSummary = { chatId: m.chatId, isGroup: m.isGroup, last: m, count: (old?.count ?? 0) + 1 }
  return [next, ...chats.filter((c) => c.chatId !== m.chatId)]
}

export function MessagesPage() {
  const [chats, setChats] = useState<ChatSummary[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [thread, setThread] = useState<FeedMessage[]>([])
  const selectedRef = useRef<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    setFailed(false)
    window.api.listChats().then(setChats).catch(() => setFailed(true))
  }, [])

  useEffect(() => {
    load()
    // Live updates: one subscription for the lifetime of the page.
    return window.api.onMessage((m) => {
      setChats((cs) => withMessage(cs ?? [], m))
      if (m.chatId === selectedRef.current)
        setThread((t) => (t.some((x) => x.id === m.id) ? t : [...t, m].slice(-MAX_BUBBLES)))
    })
  }, [load])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thread])

  function open(chatId: string): void {
    selectedRef.current = chatId
    setSelected(chatId)
    setThread([])
    window.api.getThread(chatId).then((t) => {
      if (selectedRef.current === chatId) setThread(t.slice(-MAX_BUBBLES))
    })
  }

  const header = (
    <PageHeader icon="bi-chat-left-text" title="Pesan" subtitle="Percakapan WhatsApp yang masuk, balasan bot, dan pesan admin."
      actions={<StatusBadge tone="success">Langsung</StatusBadge>} />
  )
  if (failed) return <div>{header}<ErrorState message="Gagal memuat pesan." onRetry={load} /></div>
  if (chats === null) return <div>{header}<LoadingState /></div>

  return (
    <div>
      {header}
      {chats.length === 0 ? (
        <Card>
          <EmptyState title="Belum ada pesan." hint="Pesan yang masuk akan muncul di sini." />
        </Card>
      ) : (
        <div className="row g-3">
          <div className="col-lg-4">
            <Card title="Percakapan" className="h-100">
              <ul className="chat-list" aria-label="Daftar percakapan">
                {chats.map((c) => (
                  <li key={c.chatId}>
                    <button type="button" className="chat-row" aria-current={c.chatId === selected ? 'true' : undefined}
                      onClick={() => open(c.chatId)}>
                      <span className="chat-top">
                        <span className="chat-name">{numberOf(c.chatId)}</span>
                        {c.isGroup && <StatusBadge tone="info">Grup</StatusBadge>}
                        <span className="chat-time">{clock(c.last.at)}</span>
                      </span>
                      <span className="chat-preview">{c.last.text}</span>
                      <span className="chat-count">{`${c.count} pesan`}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <div className="col-lg-8">
            <Card title={selected ? numberOf(selected) : 'Percakapan terbuka'} className="h-100">
              {selected === null ? (
                <EmptyState title="Pilih percakapan." hint="Pilih satu percakapan di sebelah kiri untuk melihat isinya." />
              ) : (
                <div className="thread-box" role="log" aria-label="Percakapan" aria-live="polite" ref={logRef}>
                  {thread.length === 0 && <p className="text-body-secondary mb-0">Belum ada pesan di percakapan ini.</p>}
                  {thread.map((m) => (
                    <div key={m.id} className={`bubble bubble-${m.direction}`}>
                      <div className="bubble-meta"><span>{WHO[m.direction]}</span><time>{clock(m.at)}</time></div>
                      <div className="text-break" data-testid="bubble-text" style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
