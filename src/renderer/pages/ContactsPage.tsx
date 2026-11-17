import { useCallback, useEffect, useState } from 'react'
import type { BContact, ContactStatus, OverviewView, SuppressReason } from '../../shared/broadcast'
import { Card } from '../ui/Card'
import { ConfirmButton } from '../ui/ConfirmButton'
import { DataTable } from '../ui/DataTable'
import { EmptyState, ErrorState, LoadingState } from '../ui/States'
import { StatusBadge } from '../ui/StatusBadge'
import { AddContactForm } from './AddContactForm'
import { ImportWizard } from './ImportWizard'
import { REASON_LABEL, SOURCE_LABEL, STATUS_LABEL, STATUS_TONE, formatTime } from './labels'

type Suppressed = { number: string | null; jid: string | null; reason: SuppressReason; at: number }

export function RecipientsTab() {
  const [filter, setFilter] = useState<ContactStatus | ''>('')
  const [contacts, setContacts] = useState<BContact[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [overview, setOverview] = useState<OverviewView | null>(null)
  const [suppressed, setSuppressed] = useState<Suppressed[]>([])
  const [importing, setImporting] = useState(false)
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null)

  const load = useCallback(() => {
    setFailed(false)
    window.api.bcContacts(filter ? { status: filter } : undefined).then(setContacts).catch(() => setFailed(true))
    window.api.bcOverview().then(setOverview).catch(() => undefined)
    window.api.bcSuppressed().then(setSuppressed).catch(() => undefined)
  }, [filter])
  useEffect(load, [load])

  async function sendConfirmations(): Promise<void> {
    const r = await window.api.bcSendConfirmations()
    setMessage(r.ok ? { kind: 'success', text: 'Kampanye konfirmasi dimulai.' } : { kind: 'danger', text: r.error })
    load()
  }

  const pending = overview?.pendingConfirm ?? 0
  return (
    <div>
      {message && <div className={`alert alert-${message.kind}`} role="status">{message.text}</div>}

      <div className="d-flex flex-wrap gap-2 mb-3">
        <button type="button" className="btn btn-primary" onClick={() => setAdding((v) => !v)}>
          <i className="bi bi-person-plus me-1" aria-hidden="true" />Tambah kontak
        </button>
        <button type="button" className="btn btn-outline-secondary" onClick={() => setImporting((v) => !v)}>
          <i className="bi bi-upload me-1" aria-hidden="true" />Impor daftar
        </button>
        {overview && (
          <>
            <StatusBadge tone="success">{`${overview.contacts.aktif} aktif`}</StatusBadge>
            <StatusBadge tone="warning">{`${overview.contacts.menunggu_persetujuan} menunggu`}</StatusBadge>
            <StatusBadge tone="neutral">{`${overview.suppressed} di daftar tolak`}</StatusBadge>
          </>
        )}
      </div>

      {adding && <AddContactForm onDone={load} onClose={() => setAdding(false)} />}
      {importing && <ImportWizard onDone={load} onClose={() => setImporting(false)} />}

      {pending > 0 && (
        <div className="announcement-banner" role="status">
          <i className="bi bi-info-circle" aria-hidden="true" />
          <span className="text">{`${pending} kontak menunggu konfirmasi`}</span>
          <button type="button" className="btn btn-sm btn-light" onClick={sendConfirmations}>Kirim konfirmasi</button>
        </div>
      )}

      <Card title="Penerima" className="mb-3"
        actions={
          <div>
            <label htmlFor="status-filter" className="visually-hidden">Filter status</label>
            <select id="status-filter" className="form-select form-select-sm" value={filter}
              onChange={(e) => setFilter(e.target.value as ContactStatus | '')}>
              <option value="">Semua status</option>
              <option value="aktif">Hanya aktif</option>
              <option value="menunggu_persetujuan">Hanya menunggu persetujuan</option>
              <option value="tidak_aktif">Hanya tidak aktif</option>
            </select>
          </div>
        }>
        {failed ? (
          <ErrorState message="Gagal memuat penerima." onRetry={load} />
        ) : contacts === null ? (
          <LoadingState />
        ) : (
          <DataTable<BContact>
            caption="Penerima broadcast"
            rows={contacts}
            rowKey={(c) => String(c.id)}
            pageSize={10}
            empty={<EmptyState title="Belum ada penerima." hint="Kontak yang pernah menghubungi bot muncul otomatis; atau tambah kontak dan impor daftar Anda." />}
            columns={[
              { key: 'number', header: 'Nomor', render: (c) => c.number ?? '(id chat)' },
              { key: 'name', header: 'Nama', render: (c) => c.name || '–' },
              { key: 'source', header: 'Sumber', render: (c) => SOURCE_LABEL[c.source] },
              { key: 'status', header: 'Status', render: (c) => <StatusBadge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</StatusBadge> },
              { key: 'last', header: 'Terakhir dikirim', render: (c) => formatTime(c.lastSentAt) },
              {
                key: 'act', header: 'Aksi',
                render: (c) => (
                  <ConfirmButton label="Hapus" ariaLabel={`Hapus data kontak ${c.number ?? c.jid ?? c.id}`}
                    onConfirm={() => window.api.bcEraseContact(c.id).then(load)}>
                    <i className="bi bi-trash" aria-hidden="true" />
                  </ConfirmButton>
                )
              }
            ]}
          />
        )}
      </Card>

      <Card title="Daftar tolak" aria-label="Daftar tolak">
        <p className="small text-body-secondary">
          Nomor di sini tidak pernah dikirimi broadcast. Hanya orang itu sendiri yang bisa keluar dari daftar ini, dengan membalas MULAI.
        </p>
        {suppressed.length === 0 ? (
          <EmptyState title="Daftar tolak kosong." />
        ) : (
          <ul className="list-group list-group-flush">
            {suppressed.map((s, i) => (
              <li key={i} className="list-group-item px-0 d-flex justify-content-between">
                <span>{s.number ?? s.jid ?? '(dihapus, tersimpan berhash)'}</span>
                <span className="text-body-secondary">{REASON_LABEL[s.reason]}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
