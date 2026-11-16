import { useCallback, useEffect, useState } from 'react'
import type { CampaignStatus, CampaignView } from '../../shared/broadcast'
import { Card } from '../ui/Card'
import { ConfirmButton } from '../ui/ConfirmButton'
import { DataTable } from '../ui/DataTable'
import { EmptyState, ErrorState, LoadingState } from '../ui/States'
import { StatusBadge, type Tone } from '../ui/StatusBadge'
import { CampaignWizard } from './CampaignWizard'

const STATUS: Record<CampaignStatus, { label: string; tone: Tone }> = {
  draf: { label: 'Draf', tone: 'neutral' }, terjadwal: { label: 'Terjadwal', tone: 'info' }, berjalan: { label: 'Berjalan', tone: 'success' },
  dijeda: { label: 'Dijeda', tone: 'warning' }, dihentikan: { label: 'Dihentikan', tone: 'neutral' }, selesai: { label: 'Selesai', tone: 'info' }
}

export function CampaignsTab() {
  const [campaigns, setCampaigns] = useState<CampaignView[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [wizard, setWizard] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(() => {
    setFailed(false)
    window.api.bcCampaigns().then(setCampaigns).catch(() => setFailed(true))
  }, [])
  useEffect(() => {
    load()
    return window.api.onBroadcast(() => load())
  }, [load])

  async function run(fn: () => Promise<unknown>): Promise<void> {
    setProblem(null)
    try {
      const r = (await fn()) as { ok?: boolean; error?: string } | undefined
      if (r && r.ok === false && r.error) setProblem(r.error)
    } catch (e) {
      setProblem(String((e as Error).message).includes('LOCKED') ? 'Aplikasi terkunci. Buka kunci untuk mengubah kampanye.' : 'Perintah gagal dijalankan.')
    }
    load()
  }

  const paused = (campaigns ?? []).filter((c) => c.status === 'dijeda' && c.pauseReason)
  return (
    <div>
      {problem && <div className="alert alert-danger" role="alert">{problem}</div>}
      {paused.map((c) => (
        <div key={c.id} className="alert alert-warning" role="alert">
          <strong>{c.name}</strong>: {c.pauseReason} Kampanye tidak lanjut sendiri; tinjau penyebabnya lalu tekan Lanjutkan.
        </div>
      ))}
      {wizard && <CampaignWizard onClose={() => setWizard(false)} onDone={() => { setWizard(false); load() }} />}
      <Card title="Kampanye"
        actions={<button type="button" className="btn btn-primary btn-sm" onClick={() => setWizard(true)}>Buat kampanye</button>}>
        {failed ? (
          <ErrorState message="Gagal memuat kampanye." onRetry={load} />
        ) : campaigns === null ? (
          <LoadingState />
        ) : (
          <DataTable<CampaignView>
            caption="Daftar kampanye"
            rows={campaigns}
            rowKey={(c) => String(c.id)}
            pageSize={10}
            empty={<EmptyState title="Belum ada kampanye." hint="Klik Buat kampanye untuk memulai." />}
            columns={[
              { key: 'name', header: 'Nama', render: (c) => c.name },
              { key: 'kind', header: 'Jenis', render: (c) => (c.kind === 'konfirmasi' ? 'Konfirmasi' : 'Broadcast') },
              { key: 'status', header: 'Status', render: (c) => <StatusBadge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</StatusBadge> },
              {
                key: 'progress', header: 'Progres',
                render: (c) => <span>{`${c.progress.terkirim} terkirim · ${c.progress.gagal} gagal · ${c.progress.dilewati} dilewati · ${c.progress.antre} antre`}</span>
              },
              {
                key: 'act', header: 'Aksi',
                render: (c) => (
                  <span className="d-inline-flex gap-2">
                    {c.status === 'berjalan' && <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => run(() => window.api.bcPauseCampaign(c.id))}>Jeda</button>}
                    {c.status === 'dijeda' && <button type="button" className="btn btn-sm btn-primary" onClick={() => run(() => window.api.bcResumeCampaign(c.id))}>Lanjutkan</button>}
                    {['berjalan', 'dijeda', 'terjadwal'].includes(c.status) && (
                      <ConfirmButton label="Hentikan" ariaLabel={`Hentikan ${c.name}`} onConfirm={() => run(() => window.api.bcStopCampaign(c.id))} />
                    )}
                  </span>
                )
              }
            ]}
          />
        )}
      </Card>
    </div>
  )
}
