import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatInfo, ChatSummary, FeedMessage, Handling } from '@autobot/contracts/ipc'
import { Card } from '../ui/Card'
import { PageHeader } from '../ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '../ui/States'
import { StatusBadge } from '../ui/StatusBadge'
import { ConfirmButton } from '../ui/ConfirmButton'
import { MemoryPanel } from './MemoryPanel'

const MAX_BUBBLES = 500

// Figma: status per chat in words a shop owner uses.
const HANDLING_LABEL: Record<Handling, string> = { bot: 'Bot menjawab', menunggu_admin: 'Butuh admin', manusia: 'Diambil alih' }
const HANDLING_TONE = { bot: 'success', menunggu_admin: 'danger', manusia: 'neutral' } as const
const STAGE_LABEL: Record<string, string> = { sapa: 'sapaan', tanya: 'bertanya', harga: 'harga', penawaran: 'penawaran', closing: 'closing', selesai: 'selesai' }

type Filter = 'semua' | Handling
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'semua', label: 'Semua' },
  { id: 'menunggu_admin', label: 'Butuh admin' },
  { id: 'bot', label: 'Bot' },
  { id: 'manusia', label: 'Diambil alih' }
]

const numberOf = (chatId: string): string => chatId.split('@')[0]
const nameOf = (chatId: string, info?: ChatInfo | null): string => info?.lead?.nama || info?.lead?.name || numberOf(chatId)

/** Figma: the handover card above a chat, so the admin knows the need, product and stage before replying. */
function HandoffCard({ info }: { info: ChatInfo }) {
  const need = info.lead.kebutuhan || info.lead.need
  const facts = [need && `Kebutuhan: ${need}`, info.product && `Produk: ${info.product}`, `Tahap: ${STAGE_LABEL[info.stage] ?? info.stage}`].filter(Boolean)
  return (
    <div className="handoff-card" role="status">
      <strong>Diserahkan ke admin{info.handoffReason ? `: ${info.handoffReason}` : ''}</strong>
      <div>{facts.join(' · ')}</div>
      <small>Ringkasan AI — periksa sebelum membalas</small>
    </div>
  )
}
const clock = (at: number): string => new Date(at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })

/** Puts the chat of a new message at the top with its new preview; an already-seen message changes nothing. */
function withMessage(chats: ChatSummary[], m: FeedMessage): ChatSummary[] {
  const old = chats.find((c) => c.chatId === m.chatId)
  if (old && m.id <= old.last.id) return chats
  // A person typing from the phone puts the chat in their hands.
  const handling = m.direction === 'human' ? 'manusia' : old?.handling ?? 'bot'
  const next: ChatSummary = { chatId: m.chatId, isGroup: m.isGroup, last: m, count: (old?.count ?? 0) + 1, handling }
  return [next, ...chats.filter((c) => c.chatId !== m.chatId)]
}

export function MessagesPage() {
  const [chats, setChats] = useState<ChatSummary[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [thread, setThread] = useState<FeedMessage[]>([])
  const [filter, setFilter] = useState<Filter>('semua')
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [bulkNote, setBulkNote] = useState<string | null>(null)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [info, setInfo] = useState<ChatInfo | null>(null)
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

  // /pesan?chat=<id> opens that chat (links from the dashboard and notifications).
  const deepLinked = useRef(false)
  useEffect(() => {
    if (deepLinked.current || !chats) return
    deepLinked.current = true
    const want = new URLSearchParams(window.location.search).get('chat')
    if (want && chats.some((c) => c.chatId === want)) open(want)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thread])

  const setHandling = (chatId: string, handling: Handling): void => {
    setChats((cs) => (cs ?? []).map((c) => (c.chatId === chatId ? { ...c, handling } : c)))
    setInfo((i) => (i && selectedRef.current === chatId ? { ...i, handling, handoffReason: handling === 'menunggu_admin' ? i.handoffReason : null } : i))
  }

  const togglePick = (chatId: string): void =>
    setPicked((p) => { const n = new Set(p); if (n.has(chatId)) n.delete(chatId); else n.add(chatId); return n })
  const stopSelecting = (): void => { setSelecting(false); setPicked(new Set()) }

  async function applyBulk(to: 'manusia' | 'bot'): Promise<void> {
    const ids = [...picked]
    setBulkError(null)
    setBulkNote(null)
    try {
      const r = await window.api.setHandlingBulk(ids, to)
      setChats((cs) => (cs ?? []).map((c) => (picked.has(c.chatId) && !c.isGroup ? { ...c, handling: to } : c)))
      setBulkNote(`${r.changed} percakapan ${to === 'manusia' ? 'diambil alih' : 'dikembalikan ke bot'}.`)
      stopSelecting()
    } catch {
      setBulkError('Gagal mengubah status percakapan.')
    }
  }

  async function takeOver(chatId: string): Promise<void> {
    setActionError(null)
    try { await window.api.takeOverChat(chatId); setHandling(chatId, 'manusia') } catch { setActionError('Gagal mengambil alih chat.') }
  }
  async function handBack(chatId: string): Promise<void> {
    setActionError(null)
    try { await window.api.handBackChat(chatId); setHandling(chatId, 'bot') } catch { setActionError('Gagal mengembalikan chat ke bot.') }
  }
  async function erase(chatId: string): Promise<void> {
    setActionError(null)
    try {
      await window.api.eraseCustomer(chatId)
      setChats((cs) => (cs ?? []).filter((c) => c.chatId !== chatId))
      selectedRef.current = null
      setSelected(null)
      setThread([])
    } catch {
      setActionError('Gagal menghapus data pelanggan.')
    }
  }
  async function sendDraft(chatId: string): Promise<void> {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setActionError(null)
    try {
      const r = await window.api.sendAsAdmin(chatId, text)
      if (r.ok) { setDraft(''); setHandling(chatId, 'manusia') } else setActionError(r.error)
    } catch {
      setActionError('Pesan gagal terkirim.')
    } finally {
      setSending(false)
    }
  }

  function open(chatId: string): void {
    setDraft('')
    setActionError(null)
    selectedRef.current = chatId
    setSelected(chatId)
    setThread([])
    setInfo(null)
    window.api.getThread(chatId).then((t) => {
      if (selectedRef.current === chatId) setThread(t.slice(-MAX_BUBBLES))
    })
    window.api.getChatInfo?.(chatId).then((i) => { if (selectedRef.current === chatId) setInfo(i) }).catch(() => undefined)
  }
  function close(): void {
    selectedRef.current = null
    setSelected(null)
    setThread([])
    setInfo(null)
  }

  const selectedChat = chats?.find((c) => c.chatId === selected) ?? null
  // Groups are never answered one by one, so they only show under "Semua".
  const matches = (c: ChatSummary, f: Filter): boolean => f === 'semua' || (!c.isGroup && c.handling === f)
  const q = query.trim().toLowerCase()
  const visibleChats = (chats ?? []).filter((c) => matches(c, filter) && (!q || c.chatId.includes(q) || (c.last.text ?? '').toLowerCase().includes(q)))
  const pickable = visibleChats.filter((c) => !c.isGroup)
  const allPicked = pickable.length > 0 && pickable.every((c) => picked.has(c.chatId))
  const countOf = (f: Filter): number => (chats ?? []).filter((c) => matches(c, f)).length

  const header = <PageHeader title="Pesan" />
  if (failed) return <div>{header}<ErrorState message="Gagal memuat pesan." onRetry={load} /></div>
  if (chats === null) return <div>{header}<LoadingState /></div>

  const list = (
    <section className="inbox-list card" aria-label="Percakapan">
      <div className="inbox-tools">
        <label htmlFor="chat-search" className="visually-hidden">Cari percakapan</label>
        <input id="chat-search" className="form-control" type="search" placeholder="Cari nama atau nomor…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="chat-filter" role="group" aria-label="Filter percakapan">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={`chat-filter-btn${filter === f.id ? ' is-active' : ''}`}
              aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}<span className="chat-filter-count">{countOf(f.id)}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-sm btn-link inbox-pick" aria-pressed={selecting}
          onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
          {selecting ? 'Selesai memilih' : 'Pilih beberapa'}
        </button>
        {bulkNote && <div className="alert alert-success py-2 small mb-0" role="status">{bulkNote}</div>}
        {bulkError && <div className="alert alert-danger py-2 small mb-0" role="alert">{bulkError}</div>}
        {selecting && (
          <div className="bulk-bar" role="group" aria-label="Aksi massal">
            <div className="form-check mb-0">
              <input id="pick-all" type="checkbox" className="form-check-input" checked={allPicked} disabled={pickable.length === 0}
                onChange={(e) => setPicked(e.target.checked ? new Set(pickable.map((c) => c.chatId)) : new Set())} />
              <label htmlFor="pick-all" className="form-check-label">{`Pilih semua (${pickable.length})`}</label>
            </div>
            <span className="small text-body-secondary" aria-live="polite">{`${picked.size} dipilih`}</span>
            <button type="button" className="btn btn-sm btn-primary" disabled={picked.size === 0} onClick={() => void applyBulk('manusia')}>
              Ambil alih terpilih
            </button>
            <button type="button" className="btn btn-sm btn-outline-primary" disabled={picked.size === 0} onClick={() => void applyBulk('bot')}>
              Kembalikan terpilih ke bot
            </button>
          </div>
        )}
      </div>
      {visibleChats.length === 0 && <p className="text-body-secondary small px-3">Tidak ada percakapan di filter ini.</p>}
      <ul className="chat-list" aria-label="Daftar percakapan">
        {visibleChats.map((c) => (
          <li key={c.chatId} className={selecting ? 'chat-pick' : undefined}>
            {selecting && !c.isGroup && (
              <input type="checkbox" className="form-check-input chat-pick-box" aria-label={`Pilih ${numberOf(c.chatId)}`}
                checked={picked.has(c.chatId)} onChange={() => togglePick(c.chatId)} />
            )}
            <button type="button" className="chat-row" aria-current={c.chatId === selected ? 'true' : undefined}
              onClick={() => open(c.chatId)}>
              <span className="chat-avatar" aria-hidden="true" />
              <span className="chat-main">
                <span className="chat-top">
                  <span className="chat-name">{numberOf(c.chatId)}</span>
                  {c.isGroup
                    ? <StatusBadge tone="info">Grup</StatusBadge>
                    : <StatusBadge tone={HANDLING_TONE[c.handling]}>{HANDLING_LABEL[c.handling]}</StatusBadge>}
                </span>
                <span className="chat-preview">{c.last.text}</span>
                <span className="chat-count">{`${clock(c.last.at)} · ${c.count} pesan`}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )

  const handling = info?.handling ?? selectedChat?.handling ?? 'bot'
  const conversation = selected === null ? (
    <section className="inbox-thread card" aria-label="Percakapan terbuka">
      <EmptyState title="Pilih percakapan." hint="Pilih satu percakapan di sebelah kiri untuk melihat isinya." />
    </section>
  ) : (
    <section className="inbox-thread card" aria-label={`Percakapan ${numberOf(selected)}`}>
      <header className="thread-head">
        <button type="button" className="topbar-btn thread-back" aria-label="Kembali ke daftar" onClick={close}>
          <i className="bi bi-chevron-left" aria-hidden="true" />
        </button>
        <div className="thread-who">
          <strong>{nameOf(selected, info)}</strong>
          <small>+{numberOf(selected)}</small>
        </div>
        {!selectedChat?.isGroup && (
          <div className="thread-actions">
            {handling === 'bot'
              ? <button type="button" className="btn btn-outline-secondary" onClick={() => void takeOver(selected)}>Ambil alih</button>
              : <button type="button" className="btn btn-outline-secondary" onClick={() => void handBack(selected)}>Kembalikan ke bot</button>}
            <ConfirmButton label="Hapus data pelanggan" confirmLabel="Hapus semua" className="btn btn-sm btn-link text-danger"
              ariaLabel="hapus semua data pelanggan ini" onConfirm={() => void erase(selected)}>
              <i className="bi bi-trash" aria-hidden="true" />
            </ConfirmButton>
          </div>
        )}
      </header>
      {info && handling === 'menunggu_admin' && <HandoffCard info={info} />}
      <div className="thread-box" role="log" aria-label="Percakapan" aria-live="polite" ref={logRef}>
        {thread.length === 0 && <p className="text-body-secondary mb-0">Belum ada pesan di percakapan ini.</p>}
        {thread.map((m) => (
          <div key={m.id} className={`bubble bubble-${m.direction}`}>
            {m.direction === 'human' && <div className="bubble-meta">Admin</div>}
            <div className="text-break" data-testid="bubble-text" style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
            <time className="bubble-time">{clock(m.at)}</time>
          </div>
        ))}
      </div>
      {actionError && <div className="text-danger small px-4" role="alert">{actionError}</div>}
      {!selectedChat?.isGroup && (
        <form className="admin-composer" onSubmit={(e) => { e.preventDefault(); void sendDraft(selected) }}>
          <label htmlFor="admin-reply" className="visually-hidden">Balasan admin</label>
          <textarea id="admin-reply" className="form-control" rows={1} maxLength={2000} placeholder="Tulis balasan sebagai admin…"
            value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void sendDraft(selected) } }} />
          <button type="submit" className="btn btn-primary" disabled={sending || !draft.trim()}>Kirim</button>
        </form>
      )}
      {!selectedChat?.isGroup && (
        <details className="thread-memory">
          <summary>Memori pelanggan</summary>
          <MemoryPanel chatId={selected} />
        </details>
      )}
    </section>
  )

  return (
    <div>
      {header}
      {chats.length === 0 ? (
        <Card>
          <EmptyState title="Belum ada pesan." hint="Pesan yang masuk akan muncul di sini." />
        </Card>
      ) : (
        <div className={`inbox${selected ? ' has-open' : ''}`}>
          {list}
          {conversation}
        </div>
      )}
    </div>
  )
}
