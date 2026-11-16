import { useState } from 'react'
import type { ImportPreviewView } from '../../shared/broadcast'
import { Card } from '../ui/Card'

const readFile = (file: File): Promise<string | Uint8Array> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    if (file.name.toLowerCase().endsWith('.csv')) {
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(file)
    } else {
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
      reader.readAsArrayBuffer(file)
    }
  })

function explain(e: unknown): string {
  const m = (e as Error)?.message ?? ''
  if (m.includes('NO_NUMBER_COLUMN')) return 'Berkas harus memiliki kolom nomor.'
  if (m.includes('TOO_MANY_ROWS')) return 'Maksimal 20.000 baris per berkas.'
  return 'Berkas tidak bisa dibaca sebagai daftar kontak (CSV atau XLSX).'
}

export function ImportWizard({ onDone, onClose }: { onDone(): void; onClose(): void }) {
  const [preview, setPreview] = useState<ImportPreviewView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ added: number; notOnWhatsApp: number; blockedBySuppression: number; aborted: boolean } | null>(null)

  async function choose(file: File | undefined): Promise<void> {
    if (!file) return
    setError(null)
    setPreview(null)
    try {
      setPreview(await window.api.bcImportPreview({ name: file.name, data: await readFile(file) }))
    } catch (e) {
      setError(explain(e))
    }
  }

  async function commit(): Promise<void> {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      const r = await window.api.bcImportCommit(preview.previewId, { accepted: true, sourceNote: note.trim() })
      setResult(r)
      if (!r.aborted) onDone()
    } catch {
      setError('Impor gagal. Pilih berkas lagi dan ulangi.')
    } finally {
      setBusy(false)
    }
  }

  const ready = agreed && note.trim().length >= 10 && !busy
  return (
    <Card title="Impor daftar penerima" className="mb-3"
      actions={<button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>Tutup</button>}>
      <p className="text-body-secondary">
        CSV atau XLSX dengan kolom <code>nomor</code> (wajib) dan <code>nama</code>. Kontak impor baru menerima satu pesan
        konfirmasi dan baru bisa dikirimi broadcast setelah membalas.
      </p>
      <div className="mb-3">
        <label htmlFor="import-file" className="form-label">Berkas daftar kontak</label>
        <input id="import-file" type="file" accept=".csv,.xlsx" className="form-control" onChange={(e) => choose(e.target.files?.[0])} />
      </div>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}

      {preview && !result && (
        <>
          <ul className="mb-3">
            <li>{`${preview.validCount} nomor valid`}</li>
            <li>{`${preview.invalidCount} baris tidak valid`}</li>
            {preview.duplicates > 0 && <li>{`${preview.duplicates} duplikat dibuang`}</li>}
          </ul>
          {preview.invalid.length > 0 && (
            <ul className="small text-body-secondary">
              {preview.invalid.slice(0, 5).map((r) => <li key={r.row}>{`Baris ${r.row}: ${r.reason}`}</li>)}
            </ul>
          )}
          <div className="form-check mb-3">
            <input id="attest" className="form-check-input" type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <label htmlFor="attest" className="form-check-label">
              Saya memiliki persetujuan dari semua nomor dalam daftar ini untuk menerima pesan dari bisnis saya
            </label>
          </div>
          <div className="mb-3">
            <label htmlFor="source-note" className="form-label">Keterangan sumber data</label>
            <textarea id="source-note" className="form-control" rows={2} maxLength={300} value={note}
              placeholder="mis. Formulir pendaftaran website, Okt 2026" onChange={(e) => setNote(e.target.value)} />
            <div className="form-text">Minimal 10 karakter. Disimpan bersama lot impor.</div>
          </div>
          <button type="button" className="btn btn-primary" disabled={!ready} onClick={commit}>Impor</button>
        </>
      )}

      {result && (result.aborted ? (
        <div className="alert alert-warning" role="alert">
          {`Impor dihentikan: terlalu banyak nomor tidak terdaftar di WhatsApp (${result.notOnWhatsApp}). Periksa kualitas daftar Anda; tidak ada yang disimpan.`}
        </div>
      ) : (
        <div className="alert alert-success" role="status">
          <div>{`${result.added} kontak ditambahkan`}</div>
          {result.notOnWhatsApp > 0 && <div>{`${result.notOnWhatsApp} nomor tidak terdaftar dibuang`}</div>}
          {result.blockedBySuppression > 0 && <div>{`${result.blockedBySuppression} nomor di daftar tolak dilewati`}</div>}
          <div>Kirim konfirmasi agar mereka bisa menerima broadcast.</div>
        </div>
      ))}
    </Card>
  )
}
