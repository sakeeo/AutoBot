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

const fromSheets = (name: string): boolean => name.startsWith('_gsheets/')
const baseName = (name: string): string => name.split('/').pop() || name

export function KnowledgePage() {
  const [tab, setTab] = useState<'files' | 'sheets'>('files')
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
      <PageHeader icon="bi-folder2-open" title="Pengetahuan"
        subtitle="Bot hanya menjawab dari dokumen di sini (.md .txt .pdf .docx .csv .xlsx .json, maksimal 20 MB per file). File .env, *.key, dan *.pem ditolak."
        actions={
          <button className="btn btn-outline-secondary" onClick={() => window.api.reindex().then(refresh)}>
            <i className="bi bi-arrow-repeat me-1" aria-hidden="true" />Index ulang
          </button>
        } />

      <ul className="nav nav-tabs mb-3" role="tablist">
        {([['files', 'Dokumen'], ['sheets', 'Google Sheets']] as const).map(([id, label]) => (
          <li className="nav-item" role="presentation" key={id}>
            <button type="button" role="tab" aria-selected={tab === id} className={`nav-link ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>
          </li>
        ))}
      </ul>
      {tab === 'sheets' ? <SheetsPanel /> : (<>
      {notice && <div className={`alert alert-${notice.kind}`} role="status">{notice.text}</div>}

      <Card title="Unggah dokumen" className="mb-3">
        <div className={`border border-2 rounded p-4 text-center ${dragging ? 'border-primary' : 'border-secondary-subtle'}`}
          style={{ borderStyle: 'dashed' }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); void upload([...e.dataTransfer.files]) }}>
          <i className="bi bi-cloud-arrow-up fs-2 text-body-secondary" aria-hidden="true" />
          <p className="mb-2">Tarik dokumen ke sini, atau</p>
          <input ref={input} id="kb-file" type="file" multiple hidden
            accept=".md,.txt,.pdf,.docx,.csv,.xlsx,.json" onChange={(e) => void upload([...(e.target.files ?? [])])} />
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>
            <i className="bi bi-upload me-1" aria-hidden="true" />{busy ? 'Mengunggah…' : 'Pilih berkas'}
          </button>
        </div>
      </Card>

      <Card title="File terindeks">
        <DataTable<FileInfo>
          caption="File terindeks"
          rows={files}
          rowKey={(f) => f.file}
          empty={<EmptyState title="Belum ada file terindeks." hint="Unggah dokumen di atas. Bot baru bisa menjawab setelah ada isinya." />}
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
      </>)}
    </div>
  )
}
