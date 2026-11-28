'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileInfo } from '@autobot/contracts/ipc'
import { Card } from '../ui/Card'
import { ConfirmButton } from '../ui/ConfirmButton'
import { DataTable } from '../ui/DataTable'
import { PageHeader } from '../ui/PageHeader'
import { EmptyState } from '../ui/States'
import { StatusBadge } from '../ui/StatusBadge'
import { SheetsPanel } from './SheetsPanel'
import { DEMO_DOCS } from '../demo/demo-knowledge'

const fromSheets = (name: string): boolean => name.startsWith('_gsheets/')
const baseName = (name: string): string => name.split('/').pop() || name

export function KnowledgePage() {
  const [tab, setTab] = useState<'files' | 'sheets'>('files')
  const [addSheet, setAddSheet] = useState(false)
  const [files, setFiles] = useState<FileInfo[]>([])
  const [notice, setNotice] = useState<{ kind: 'success' | 'warning' | 'danger'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => {
    window.api.listFiles().then(setFiles).catch(() => undefined)
  }, [])

  useEffect(() => {
    refresh()
    return window.api.onIndexStatus(refresh)
  }, [refresh])

  async function upload(picked: File[]) {
    if (picked.length === 0) return
    setNotice(null)
    setBusy(true)
    try {
      const r = await window.api.uploadKnowledge(picked)
      const parts: string[] = []
      if (r.added.length) parts.push(`${r.added.length} file ditambahkan dan sedang diindeks.`)
      for (const x of r.rejected) parts.push(`${x.name}: ${x.reason}`)
      setNotice({ kind: r.added.length ? (r.rejected.length ? 'warning' : 'success') : 'danger', text: parts.join(' ') })
      refresh()
    } catch (e) {
      setNotice({ kind: 'danger', text: (e as Error).message || 'File tidak bisa diunggah.' })
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  async function loadDemo() {
    await upload(DEMO_DOCS.map((d) => new File([d.content], d.name, { type: 'text/markdown' })))
  }

  async function remove(file: string) {
    setNotice(null)
    try {
      await window.api.kbDelete(file)
      setNotice({ kind: 'success', text: `${baseName(file)} dihapus.` })
    } catch {
      setNotice({ kind: 'danger', text: 'File tidak bisa dihapus.' })
    }
    refresh()
  }

  return (
    <div>
      <PageHeader title="Pengetahuan"
        subtitle="Bot hanya menjawab dari dokumen dan Google Sheet yang Anda tambahkan."
        actions={
          <>
            <button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={() => { setTab('files'); input.current?.click() }}>Unggah berkas</button>
            <button type="button" className="btn btn-cta" onClick={() => { setAddSheet(true); setTab('sheets') }}>+ Tambah Google Sheet</button>
          </>
        } />

      <ul className="nav nav-tabs mb-3" role="tablist">
        {([['files', 'Dokumen'], ['sheets', 'Google Sheets']] as const).map(([id, label]) => (
          <li className="nav-item" role="presentation" key={id}>
            <button type="button" role="tab" aria-selected={tab === id} className={`nav-link ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>
          </li>
        ))}
      </ul>
      <input ref={input} id="kb-file" type="file" multiple hidden
        accept=".md,.txt,.pdf,.docx,.csv,.xlsx,.json" onChange={(e) => void upload([...(e.target.files ?? [])])} />
      {tab === 'sheets' ? <SheetsPanel startAdding={addSheet} /> : (<>
      {notice && <div className={`alert alert-${notice.kind}`} role="status">{notice.text}</div>}
      <Card title="Dokumen" className="mb-3 kb-files" actions={<button type="button" className="btn btn-sm btn-link" onClick={() => window.api.reindex().then(refresh)}>Index ulang</button>}>
        <DataTable<FileInfo>
          caption="File terindeks"
          rows={files}
          rowKey={(f) => f.file}
          empty={<EmptyState title="Belum ada dokumen." hint="Bot baru bisa menjawab setelah ada isinya." />}
          columns={[
            { key: 'file', header: 'File', render: (f) => <span className="text-break" title={f.file}>{f.file}</span> },
            {
              key: 'status', header: 'Status',
              render: (f) => f.status === 'indexed'
                ? <StatusBadge tone="success">Terindeks</StatusBadge>
                : <StatusBadge tone="danger">{`Gagal: ${f.reason ?? 'tidak diketahui'}`}</StatusBadge>
            },
            { key: 'chunks', header: 'Chunk', align: 'end', render: (f) => String(f.chunks) },
            {
              key: 'act', header: 'Aksi', align: 'end',
              render: (f) => fromSheets(f.file) ? <StatusBadge tone="info">Google Sheets</StatusBadge> : (
                <span className="d-inline-flex gap-2">
                  <a className="btn btn-sm btn-outline-secondary" aria-label={`Unduh ${baseName(f.file)}`}
                    href={window.api.knowledgeDownloadUrl(f.file)} download>
                    <i className="bi bi-download" aria-hidden="true" />
                  </a>
                  <ConfirmButton label="Hapus" ariaLabel={`Hapus ${baseName(f.file)}`} onConfirm={() => remove(f.file)}>
                    <i className="bi bi-trash" aria-hidden="true" />
                  </ConfirmButton>
                </span>
              )
            }
          ]}
        />
      </Card>

      {files.length === 0 && (
        <section className="card demo-card mb-3" aria-label="Data contoh">
          <div className="card-body text-center">
            <strong>Belum punya dokumen?</strong>
            <p className="text-body-secondary small mb-3">Coba dulu dengan data contoh (profil, harga, proses kerja, dan kebijakan fiktif). Hapus kapan saja.</p>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void loadDemo()}>Pakai data contoh</button>
          </div>
        </section>
      )}

      <div className={`kb-drop${dragging ? ' is-dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void upload([...e.dataTransfer.files]) }}>
        <i className="bi bi-cloud-arrow-up" aria-hidden="true" />
        <span>Tarik berkas ke sini, atau <button type="button" className="btn btn-link p-0 align-baseline" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'mengunggah…' : 'pilih berkas'}</button></span>
        <small>.md .txt .pdf .docx .csv .xlsx .json · maks. 20 MB · berkas .env, *.key, *.pem ditolak</small>
      </div>
      <div className="alert alert-warning mt-3 mb-0 small" role="note">Isi dokumen dan sheet menjadi bahan jawaban bot. Jangan simpan data internal (harga modal, data pelanggan) di sini.</div>
      </>)}
    </div>
  )
}
