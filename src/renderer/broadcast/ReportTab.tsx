import { useCallback, useEffect, useState } from 'react'
import type { CampaignView, ReportView } from '../../shared/broadcast'
import { Card } from '../ui/Card'
import { EmptyState, ErrorState, LoadingState } from '../ui/States'
import { SKIP_LABEL } from './labels'

export function ReportTab() {
  const [campaigns, setCampaigns] = useState<CampaignView[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [chosen, setChosen] = useState<number | null>(null)
  const [report, setReport] = useState<ReportView | null>(null)

  const load = useCallback(() => {
    setFailed(false)
    window.api.bcCampaigns().then((c) => { setCampaigns(c); setChosen((cur) => cur ?? c[0]?.id ?? null) }).catch(() => setFailed(true))
  }, [])
  useEffect(load, [load])
  useEffect(() => {
    if (chosen === null) return
    window.api.bcReport(chosen).then(setReport).catch(() => setFailed(true))
  }, [chosen])

  async function exportCsv(): Promise<void> {
    if (chosen === null) return
    const csv = await window.api.bcExportReport(chosen)
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
    a.download = `laporan-broadcast-${chosen}.csv`
    try { a.click() } catch { /* download is best-effort */ }
  }

  if (failed) return <ErrorState message="Gagal memuat laporan." onRetry={load} />
  if (campaigns === null) return <LoadingState />
  if (campaigns.length === 0) return <Card><EmptyState title="Belum ada laporan." hint="Laporan muncul setelah kampanye dibuat." /></Card>

  return (
    <div>
      <div className="d-flex justify-content-between align-items-end mb-3">
        <div style={{ minWidth: 280 }}>
          <label htmlFor="report-campaign" className="form-label">Kampanye</label>
          <select id="report-campaign" className="form-select" value={chosen ?? ''} onChange={(e) => setChosen(Number(e.target.value))}>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <button type="button" className="btn btn-outline-secondary" onClick={exportCsv}>
          <i className="bi bi-download me-1" aria-hidden="true" />Ekspor CSV
        </button>
      </div>
      {report && (
        <Card title="Ringkasan">
          <dl className="metric-list mb-3">
            <dt>Terkirim</dt><dd>{report.progress.terkirim}</dd>
            <dt>Gagal</dt><dd>{report.progress.gagal}</dd>
            <dt>Dilewati</dt><dd>{report.progress.dilewati}</dd>
            <dt>Antre</dt><dd>{report.progress.antre}</dd>
            <dt>Berhenti berlangganan</dt><dd>{report.optOuts}</dd>
          </dl>
          {Object.keys(report.skippedReasons).length > 0 && (
            <>
              <h3 className="h6">Alasan dilewati</h3>
              <ul>{Object.entries(report.skippedReasons).map(([k, n]) => <li key={k}>{`${SKIP_LABEL[k] ?? k}: ${n}`}</li>)}</ul>
            </>
          )}
        </Card>
      )}
    </div>
  )
}
