import { useState } from 'react'
import type { ActionKind } from '../../shared/brand'
import type { AgentTurnView } from '../../shared/ipc'
import { ACTION_LABEL, INTENT_LABEL } from './labels'

export function PreviewPanel({ beforeSend }: { beforeSend: () => Promise<void> }) {
  const [sent, setSent] = useState<string[]>([])
  const [turns, setTurns] = useState<AgentTurnView[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    const msg = text.trim()
    if (!msg || busy) return
    const next = [...sent, msg]
    setBusy(true)
    setError(null)
    try {
      await beforeSend() // the simulator reads the saved draft
      const r = await window.api.previewChat({ draft: true, messages: next })
      if (r.ok) { setSent(next); setTurns(r.turns); setText('') } else setError(r.error)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card h-100" data-testid="preview-panel">
      <div className="card-header d-flex justify-content-between align-items-center">
        <span><i className="bi bi-phone me-2" />Pratinjau WhatsApp</span>
        <button type="button" className="btn btn-sm btn-outline-secondary" disabled={sent.length === 0}
          onClick={() => { setSent([]); setTurns([]); setError(null) }}>Mulai ulang</button>
      </div>
      <div className="card-body overflow-auto" style={{ maxHeight: 520 }}>
        <p className="small text-body-secondary">
          Simulasi memakai draf saat ini dan tidak mengirim apa pun ke pelanggan atau admin.
        </p>
        {turns.map((t, i) => (
          <div key={i} className="mb-3">
            <div className="d-flex justify-content-end mb-1">
              <span className="badge text-bg-primary text-wrap text-start fw-normal">{sent[i]}</span>
            </div>
            {t.replyParts.map((p, k) => (
              <div key={k} className="mb-1">
                <span className="badge text-bg-light border text-wrap text-start fw-normal">{p}</span>
              </div>
            ))}
            <div className="small text-body-secondary mt-1">
              Maksud: {INTENT_LABEL[t.intent as keyof typeof INTENT_LABEL] ?? t.intent} · Tindakan:{' '}
              {ACTION_LABEL[t.action.kind as ActionKind] ?? t.action.kind}
              {t.action.ruleId ? ` · Aturan: ${t.action.ruleId}` : t.action.forced ? ` · Dipaksa: ${t.action.reason}` : ''}
            </div>
            <div className="d-flex flex-wrap gap-1 mt-1">
              {t.handoff && <span className="badge text-bg-warning">diserahkan ke admin ({t.handoff.reason})</span>}
              {t.removed.numbers && <span className="badge text-bg-info">nomor disaring</span>}
              {t.removed.cta && <span className="badge text-bg-info">ajakan hubungi disaring</span>}
              {t.removed.urls.length > 0 && <span className="badge text-bg-info">{t.removed.urls.length} tautan disaring</span>}
              {t.removed.numbersUnknown.length > 0 && <span className="badge text-bg-info">harga tak dikenal diganti</span>}
              {t.fallback && <span className="badge text-bg-danger">AI gagal</span>}
              {t.sources.map((s) => <span key={s} className="badge text-bg-secondary">{s}</span>)}
            </div>
          </div>
        ))}
        {error && <div className="alert alert-danger py-2">{error}</div>}
      </div>
      <div className="card-footer">
        <form className="input-group" onSubmit={(e) => { e.preventDefault(); send() }}>
          <label htmlFor="sim-msg" className="visually-hidden">Pesan pelanggan</label>
          <input id="sim-msg" className="form-control" placeholder="Tulis pesan pelanggan…" value={text}
            onChange={(e) => setText(e.target.value)} disabled={sent.length >= 10} />
          <button className="btn btn-primary" type="submit" disabled={busy || !text.trim() || sent.length >= 10}>Kirim</button>
        </form>
        {sent.length >= 10 && <div className="form-text">Batas 10 pesan per simulasi. Tekan Mulai ulang.</div>}
      </div>
    </div>
  )
}
