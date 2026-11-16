import { useEffect, useState, type ReactNode } from 'react'

export interface Column<T> {
  key: string
  header: string
  align?: 'end'
  render(row: T): ReactNode
}

interface Props<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey(row: T): string
  caption: string
  empty: ReactNode
  pageSize?: number
}

export function DataTable<T>({ columns, rows, rowKey, caption, empty, pageSize = 10 }: Props<T>) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  useEffect(() => { if (page > pages - 1) setPage(pages - 1) }, [page, pages])
  if (rows.length === 0) return <>{empty}</>

  const current = Math.min(page, pages - 1)
  const from = current * pageSize
  const shown = rows.slice(from, from + pageSize)
  return (
    <div>
      <div className="table-responsive">
        <table className="table table-hover mb-0">
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={c.align === 'end' ? 'text-end' : undefined}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={rowKey(r)}>
                {columns.map((c) => (
                  <td key={c.key} className={c.align === 'end' ? 'text-end' : undefined}>{c.render(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="table-footer">
          <span className="text-body-secondary" aria-live="polite">
            {from + 1}–{from + shown.length} dari {rows.length}
          </span>
          <div className="d-flex gap-2">
            <button type="button" className="btn btn-sm btn-outline-secondary" disabled={current === 0}
              onClick={() => setPage(current - 1)}>Sebelumnya</button>
            <button type="button" className="btn btn-sm btn-outline-secondary" disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}>Berikutnya</button>
          </div>
        </div>
      )}
    </div>
  )
}
