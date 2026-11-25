import { useEffect, useState } from 'react'
import { ConfirmButton } from '../ui/ConfirmButton'

interface Memory { summary: string; facts: Record<string, string> }

/** What the bot remembers about this customer: a summary and short facts, all editable, and a way to forget them. */
export function MemoryPanel({ chatId }: { chatId: string }) {
  const [mem, setMem] = useState<Memory | null>(null)
  const [summary, setSummary] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    setMem(null)
    setFailed(false)
    Promise.resolve()
      .then(() => window.api.memGet(chatId))
      .then((m) => { if (live) { setMem(m); setSummary(m.summary) } })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [chatId])

  const save = async (patch: { summary?: string; facts?: Record<string, string> }): Promise<void> => {
    try {
      await window.api.memUpdate(chatId, patch)
      setMem((m) => (m ? { summary: patch.summary ?? m.summary, facts: patch.facts ?? m.facts } : m))
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }
  const forget = async (): Promise<void> => {
    try {
      await window.api.memForget(chatId)
      setMem({ summary: '', facts: {} })
      setSummary('')
    } catch {
      setFailed(true)
    }
  }

  if (failed && mem === null) return null
  if (mem === null) return null
  const facts = Object.entries(mem.facts)
  const empty = !mem.summary && facts.length === 0

  return (
    <section className="memory-panel" aria-label="Memori pelanggan">
      <div className="d-flex align-items-center gap-2 mb-2">
        <h3 className="h6 mb-0"><i className="bi bi-journal-text me-1" aria-hidden="true" />Memori bot</h3>
        <span className="flex-fill" />
        {!empty && (
          <ConfirmButton label="Lupakan pelanggan ini" ariaLabel="Lupakan pelanggan ini" confirmLabel="Lupakan"
            className="btn btn-sm btn-outline-danger" onConfirm={() => void forget()} />
        )}
      </div>
      {empty ? (
        <p className="text-body-secondary small mb-0">Belum ada memori. Bot mulai mengingat setelah beberapa percakapan.</p>
      ) : (
        <>
          <label htmlFor="mem-summary" className="form-label small mb-1">Ringkasan</label>
          <textarea id="mem-summary" className="form-control form-control-sm mb-1" rows={3} maxLength={700}
            value={summary} onChange={(e) => setSummary(e.target.value)} />
          <button type="button" className="btn btn-sm btn-outline-primary mb-3" disabled={summary.trim() === mem.summary}
            onClick={() => void save({ summary })}>Simpan ringkasan</button>
          {facts.length > 0 && <div className="form-label small mb-1">Fakta pelanggan</div>}
          <ul className="list-unstyled mb-0">
            {facts.map(([k, v]) => (
              <li key={k} className="d-flex align-items-center gap-2 mb-1">
                <span className="small text-body-secondary" style={{ minWidth: 96 }}>{k}</span>
                <input className="form-control form-control-sm" aria-label={`Nilai ${k}`} maxLength={80} defaultValue={v}
                  onBlur={(e) => {
                    const next = e.target.value.trim()
                    if (next && next !== v) void save({ facts: { ...mem.facts, [k]: next } })
                  }} />
                <button type="button" className="btn btn-sm btn-outline-secondary" aria-label={`Hapus fakta ${k}`}
                  onClick={() => { const { [k]: _gone, ...rest } = mem.facts; void save({ facts: rest }) }}>
                  <i className="bi bi-x-lg" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {failed && <div className="text-danger small mt-2" role="alert">Gagal menyimpan perubahan memori.</div>}
    </section>
  )
}
