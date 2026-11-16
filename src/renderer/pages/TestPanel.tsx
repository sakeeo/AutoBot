import { useState } from 'react'
import type { TestResult } from '../../shared/ipc'
import { Card } from '../ui/Card'
import { PageHeader } from '../ui/PageHeader'
import { ErrorState, LoadingState } from '../ui/States'
import { StatusBadge } from '../ui/StatusBadge'

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
      <PageHeader icon="bi-chat-dots" title="Uji Jawaban" subtitle="Coba pertanyaan di sini tanpa mengirim apa pun ke WhatsApp." />
      <Card className="mb-3" aria-label="Formulir uji">
      <form className="row g-2" onSubmit={(e) => { e.preventDefault(); if (q.trim()) run() }}>
        <div className="col">
          <label htmlFor="q" className="visually-hidden">Pertanyaan</label>
          <input id="q" className="form-control" placeholder="Ketik pertanyaan pelanggan…" value={q}
            onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="col-auto">
          <button className="btn btn-primary" type="submit" disabled={busy || !q.trim()}>Uji</button>
        </div>
      </form>
      </Card>

      {busy && <LoadingState label="Menguji…" />}
      {err && <ErrorState message={err} />}

      {res && res.decision.kind === 'out_of_context' && (
        <div className="alert alert-secondary">
          <strong>Di luar konteks</strong>{' '}
          <span className="text-body-secondary">({res.decision.reason})</span> — bot tidak akan menjawab dari
          pengetahuan umum.
        </div>
      )}

      {res && res.decision.kind === 'answerable' && (
        <>
          <Card title="Jawaban" className="mb-3" actions={<StatusBadge tone="info">{res.via ?? 'tidak ada jawaban'}</StatusBadge>}>
            {res.answer
              ? <pre className="mb-0" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{res.answer.text}</pre>
              : <span className="text-body-secondary">AI menilai pertanyaan ini tidak terjawab oleh dokumen.</span>}
          </Card>
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
