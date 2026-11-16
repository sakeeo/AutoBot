import { useCallback, useEffect, useState } from 'react'
import type { FileInfo } from '../../shared/ipc'
import { useSettings } from '../useSettings'

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
      <h2 className="h4 mb-3"><i className="bi bi-folder2-open me-2" />Folder Pengetahuan</h2>
      <p className="text-body-secondary">
        Bot hanya menjawab dari isi folder ini (.md .txt .pdf .docx .csv .xlsx .json).
        File <code>.env</code>, <code>*.key</code>, dan <code>*.pem</code> tidak pernah dibaca.
      </p>

      <div className="mb-3">
        <button className="btn btn-primary me-2" onClick={pick}>
          <i className="bi bi-folder-plus me-1" />Pilih Folder
        </button>
        <button className="btn btn-outline-secondary" onClick={() => window.api.reindex().then(refresh)}>
          <i className="bi bi-arrow-repeat me-1" />Index ulang
        </button>
      </div>

      <ul className="list-group mb-4">
        {folders.map((f) => (
          <li key={f} className="list-group-item d-flex justify-content-between align-items-center">
            <code>{f}</code>
            <button className="btn btn-sm btn-outline-danger" aria-label={`Hapus ${f}`}
              onClick={() => patch({ knowledgeFolders: folders.filter((x) => x !== f) })}>
              <i className="bi bi-trash" />
            </button>
          </li>
        ))}
        {folders.length === 0 && <li className="list-group-item text-body-secondary">Belum ada folder.</li>}
      </ul>

      <div className="mb-4">
        <label htmlFor="exclude" className="form-label">Pola pengecualian (satu per baris, gaya .gitignore)</label>
        <textarea id="exclude" className="form-control font-monospace" rows={3} value={excludeText}
          onChange={(e) => setExclude(e.target.value)}
          onBlur={() => {
            if (exclude !== null)
              patch({ excludePatterns: exclude.split('\n').map((s) => s.trim()).filter(Boolean) })
          }} />
      </div>

      <table className="table table-sm align-middle">
        <thead><tr><th>File</th><th>Status</th><th className="text-end">Chunk</th></tr></thead>
        <tbody>
          {files.map((f) => (
            <tr key={f.file}>
              <td className="text-break">{f.file}</td>
              <td>
                {f.status === 'indexed'
                  ? <span className="badge text-bg-success">terindeks</span>
                  : <span className="badge text-bg-danger">gagal: {f.reason}</span>}
              </td>
              <td className="text-end">{f.chunks}</td>
            </tr>
          ))}
          {files.length === 0 && <tr><td colSpan={3} className="text-body-secondary">Belum ada file terindeks.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
