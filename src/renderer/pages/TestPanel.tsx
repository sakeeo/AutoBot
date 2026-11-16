import { useState } from 'react'
import type { TestResult } from '../../shared/ipc'

export function TestPanel() {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<TestResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setErr(null)
    try {
      setRes(await window.api.testQuestion(q))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h2 className="h4 mb-3"><i className="bi bi-chat-dots me-2" />Uji Jawaban</h2>
      <p className="text-body-secondary">Coba pertanyaan di sini tanpa mengirim apa pun ke WhatsApp.</p>
      <form className="row g-2 mb-4" onSubmit={(e) => { e.preventDefault(); if (q.trim()) run() }}>
        <div className="col">
          <label htmlFor="q" className="visually-hidden">Pertanyaan</label>
          <input id="q" className="form-control" placeholder="Ketik pertanyaan pelanggan…" value={q}
            onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="col-auto">
          <button className="btn btn-primary" type="submit" disabled={busy || !q.trim()}>Uji</button>
        </div>
      </form>

      {err && <div className="alert alert-danger">{err}</div>}

      {res && res.decision.kind === 'out_of_context' && (
        <div className="alert alert-secondary">
          <strong>Di luar konteks</strong>{' '}
          <span className="text-body-secondary">({res.decision.reason})</span> — bot tidak akan menjawab dari
          pengetahuan umum.
        </div>
      )}

      {res && res.decision.kind === 'answerable' && (
        <>
          <div className="card mb-3">
            <div className="card-header d-flex justify-content-between">
              <span>Jawaban</span>
              <span className="badge text-bg-info">{res.via ?? 'tidak ada jawaban'}</span>
            </div>
            <div className="card-body">
              {res.answer
                ? <pre className="mb-0" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{res.answer.text}</pre>
                : <span className="text-body-secondary">AI menilai pertanyaan ini tidak terjawab oleh dokumen.</span>}
            </div>
          </div>
          <h3 className="h6">Potongan dokumen terambil</h3>
          <ul className="list-group">
            {res.decision.hits.map((h) => (
              <li key={h.chunkId} className="list-group-item">
                <div className="small text-body-secondary">
                  {h.file} · skor {h.coverage.toFixed(2)}
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{h.text}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
