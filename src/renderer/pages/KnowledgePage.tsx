import { useCallback, useEffect, useState } from 'react'
import type { FileInfo } from '../../shared/ipc'
import { useSettings } from '../useSettings'
import { Card } from '../ui/Card'
import { ConfirmButton } from '../ui/ConfirmButton'
import { DataTable } from '../ui/DataTable'
import { PageHeader } from '../ui/PageHeader'
import { EmptyState } from '../ui/States'
import { StatusBadge } from '../ui/StatusBadge'

export function KnowledgePage() {
  const [settings, patch] = useSettings()
  const [files, setFiles] = useState<FileInfo[]>([])
  const [exclude, setExclude] = useState<string | null>(null)

  const refresh = useCallback(() => {
    window.api.listFiles().then(setFiles)
  }, [])

  useEffect(() => {
    refresh()
    return window.api.onIndexStatus(refresh)
  }, [refresh])

  const folders = settings?.knowledgeFolders ?? []
  const excludeText = exclude ?? (settings?.excludePatterns ?? []).join('\n')

  async function pick() {
    const dir = await window.api.pickFolder()
    if (dir && !folders.includes(dir)) await patch({ knowledgeFolders: [...folders, dir] })
  }

  return (
    <div>
      <PageHeader icon="bi-folder2-open" title="Folder Pengetahuan"
        subtitle="Bot hanya menjawab dari isi folder ini (.md .txt .pdf .docx .csv .xlsx .json). File .env, *.key, dan *.pem tidak pernah dibaca."
        actions={
          <>
            <button className="btn btn-primary" onClick={pick}>
              <i className="bi bi-folder-plus me-1" aria-hidden="true" />Pilih Folder
            </button>
            <button className="btn btn-outline-secondary" onClick={() => window.api.reindex().then(refresh)}>
              <i className="bi bi-arrow-repeat me-1" aria-hidden="true" />Index ulang
            </button>
          </>
        } />

      <Card title="Folder" className="mb-3">
        {folders.length === 0 ? (
          <EmptyState title="Belum ada folder." hint="Klik Pilih Folder untuk menambahkan sumber pengetahuan bot." />
        ) : (
          <ul className="list-group list-group-flush">
            {folders.map((f) => (
              <li key={f} className="list-group-item px-0 d-flex justify-content-between align-items-center">
                <code>{f}</code>
                <ConfirmButton label="Hapus" ariaLabel={`Hapus ${f}`}
                  onConfirm={() => patch({ knowledgeFolders: folders.filter((x) => x !== f) })}>
                  <i className="bi bi-trash" aria-hidden="true" />
                </ConfirmButton>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Pengecualian" className="mb-3">
        <label htmlFor="exclude" className="form-label">Pola pengecualian (satu per baris, gaya .gitignore)</label>
        <textarea id="exclude" className="form-control font-monospace" rows={3} value={excludeText}
          onChange={(e) => setExclude(e.target.value)}
          onBlur={() => {
            if (exclude !== null)
              patch({ excludePatterns: exclude.split('\n').map((s) => s.trim()).filter(Boolean) })
          }} />
      </Card>

      <Card title="File terindeks">
        <DataTable<FileInfo>
          caption="File terindeks"
          rows={files}
          rowKey={(f) => f.file}
          empty={<EmptyState title="Belum ada file terindeks." hint="File muncul di sini setelah folder dipilih dan diindeks." />}
          columns={[
            { key: 'file', header: 'File', render: (f) => <span className="text-break">{f.file}</span> },
            {
              key: 'status', header: 'Status',
              render: (f) => f.status === 'indexed'
                ? <StatusBadge tone="success">Terindeks</StatusBadge>
                : <StatusBadge tone="danger">{`Gagal: ${f.reason ?? 'tidak diketahui'}`}</StatusBadge>
            },
            { key: 'chunks', header: 'Chunk', align: 'end', render: (f) => String(f.chunks) }
          ]}
        />
      </Card>
    </div>
  )
}
