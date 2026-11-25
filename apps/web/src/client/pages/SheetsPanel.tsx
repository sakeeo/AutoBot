'use client'
import { useCallback, useEffect, useState } from 'react'
import {
  CATALOG_FIELDS, GS_LIMITS, GS_MESSAGES,
  type CatalogField, type GsCredentialStatus, type GsInspectResult, type GsPreviewResult, type GsRole, type GsSource, type GsStatus
} from '@autobot/contracts/sheets'
import { Card } from '../ui/Card'
import { ConfirmButton } from '../ui/ConfirmButton'
import { DataTable } from '../ui/DataTable'
import { EmptyState } from '../ui/States'
import { StatusBadge, type Tone } from '../ui/StatusBadge'

const STATUS: Record<GsStatus, { label: string; tone: Tone }> = {
  never: { label: 'Belum disinkron', tone: 'neutral' },
  syncing: { label: 'Menyinkron…', tone: 'warning' },
  ok: { label: 'Tersinkron', tone: 'success' },
  error: { label: 'Galat', tone: 'danger' },
  needs_confirm: { label: 'Perlu konfirmasi', tone: 'warning' }
}
const FIELD_LABEL: Record<CatalogField, string> = {
  id: 'ID produk (wajib)', nama: 'Nama (wajib)', harga: 'Harga', deskripsi_singkat: 'Deskripsi singkat',
  checkout_url: 'Tautan checkout', cocok_untuk: 'Cocok untuk', stok: 'Stok'
}
const INTERVALS = [5, 15, 30, 60, 360, 1440]
const when = (t: number | null): string => (t ? new Date(t).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '–')
const fail = (e: unknown, fallback: string): string => (e instanceof Error && e.message ? e.message : fallback)

type Notice = { kind: 'success' | 'warning' | 'danger'; text: string } | null

export function SheetsPanel() {
  const [cred, setCred] = useState<GsCredentialStatus | null>(null)
  const [sources, setSources] = useState<GsSource[]>([])
  const [domains, setDomains] = useState<string[]>([])
  const [notice, setNotice] = useState<Notice>(null)
  const [adding, setAdding] = useState(false)

  const refresh = useCallback(() => {
    window.api.gsCredentialStatus().then(setCred).catch(() => undefined)
    window.api.gsListSources().then(setSources).catch(() => undefined)
    window.api.gsListApprovedDomains().then(setDomains).catch(() => undefined)
  }, [])
  useEffect(() => {
    refresh()
    return window.api.onKnowledgeSync(refresh)
  }, [refresh])

  async function run(fn: () => Promise<unknown>, ok: string, bad: string) {
    setNotice(null)
    try { await fn(); setNotice({ kind: 'success', text: ok }) } catch (e) { setNotice({ kind: 'danger', text: fail(e, bad) }) }
    refresh()
  }

  return (
    <div>
      {notice && <div className={`alert alert-${notice.kind}`} role="status">{notice.text}</div>}
      <CredentialCard cred={cred} onChanged={refresh} setNotice={setNotice} />
      {cred?.configured && (
        <Card title="Sumber Google Sheets" icon="bi-table" className="mb-3"
          actions={<button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding((a) => !a)}>
            <i className="bi bi-plus-lg me-1" aria-hidden="true" />{adding ? 'Tutup' : 'Tambah sumber'}
          </button>}>
          {adding && <AddSource onDone={() => { setAdding(false); refresh() }} setNotice={setNotice} />}
          <p className="text-body-secondary small">
            Bot hanya membaca sheet (tidak pernah menulis). Siapa pun yang boleh mengedit sheet ikut memengaruhi jawaban bot, jadi batasi editornya.
          </p>
          <DataTable<GsSource>
            caption="Sumber Google Sheets"
            rows={sources}
            rowKey={(s) => s.id}
            empty={<EmptyState title="Belum ada sumber." hint="Klik Tambah sumber, lalu tempel tautan Google Sheets." />}
            columns={[
              { key: 'name', header: 'Sumber', render: (s) => (<><strong>{s.name}</strong><div className="small text-body-secondary">{s.tabTitle}</div></>) },
              { key: 'role', header: 'Peran', render: (s) => <StatusBadge tone="info">{s.role === 'catalog' ? 'Katalog' : 'Pengetahuan'}</StatusBadge> },
              {
                key: 'status', header: 'Status',
                render: (s) => (
                  <>
                    <StatusBadge tone={STATUS[s.lastStatus].tone}>{STATUS[s.lastStatus].label}</StatusBadge>
                    {s.lastError && <div className="small text-danger mt-1">{GS_MESSAGES[s.lastError]}{s.lastError === 'NOT_SHARED' && cred.clientEmail ? ` Bagikan ke ${cred.clientEmail}.` : ''}</div>}
                    {s.consecutiveFailures >= 3 && <div className="small text-danger">Gagal {s.consecutiveFailures} kali berturut-turut. Pengetahuan lama tetap dipakai.</div>}
                  </>
                )
              },
              { key: 'last', header: 'Terakhir', render: (s) => (<>{when(s.lastOkAt)}<div className="small text-body-secondary">{s.rowCount} baris</div></>) },
              {
                key: 'act', header: 'Aksi', align: 'end',
                render: (s) => (
                  <span className="d-inline-flex gap-2 flex-wrap justify-content-end">
                    <button type="button" className="btn btn-sm btn-outline-secondary" aria-label={`Sinkron ${s.name}`}
                      onClick={() => run(() => window.api.gsSyncNow(s.id), 'Sinkron dimulai.', 'Tidak bisa memulai sinkron.')}>
                      <i className="bi bi-arrow-repeat" aria-hidden="true" />
                    </button>
                    <button type="button" className="btn btn-sm btn-outline-secondary"
                      onClick={() => run(() => window.api.gsUpdateSource(s.id, { enabled: !s.enabled }), s.enabled ? 'Sumber dijeda.' : 'Sumber diaktifkan.', 'Tidak bisa mengubah sumber.')}>
                      {s.enabled ? 'Jeda' : 'Aktifkan'}
                    </button>
                    <ConfirmButton label="Hapus" ariaLabel={`Hapus ${s.name}`}
                      onConfirm={() => run(() => window.api.gsRemoveSource(s.id), 'Sumber dihapus beserta isinya.', 'Sumber tidak bisa dihapus.')}>
                      <i className="bi bi-trash" aria-hidden="true" />
                    </ConfirmButton>
                  </span>
                )
              }
            ]}
          />
          {sources.filter((s) => s.pending || s.warnings.length > 0 || s.lastSummary).map((s) => (
            <div key={s.id} className="mt-3">
              <div className="fw-semibold">{s.name}</div>
              {s.pending && (
                <div className="alert alert-warning d-flex flex-wrap align-items-center gap-2 mb-2" role="alert">
                  <span className="flex-grow-1">{s.pending.summary}</span>
                  {s.pending.reason === 'shrink' && (
                    <>
                      <button type="button" className="btn btn-sm btn-warning" onClick={() => run(() => window.api.gsConfirmChange(s.id), 'Perubahan diterapkan.', 'Perubahan tidak bisa diterapkan.')}>Terapkan</button>
                      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => run(() => window.api.gsDismissChange(s.id), 'Perubahan diabaikan.', 'Gagal.')}>Abaikan</button>
                    </>
                  )}
                </div>
              )}
              {s.lastSummary && <div className="small text-body-secondary">Sinkron terakhir: {s.lastSummary}</div>}
              {s.warnings.length > 0 && <ul className="small text-warning-emphasis mb-0">{s.warnings.slice(0, 5).map((w) => <li key={w}>{w}</li>)}</ul>}
            </div>
          ))}
        </Card>
      )}
      {cred?.configured && <DomainsCard domains={domains} run={run} />}
    </div>
  )
}

function CredentialCard({ cred, onChanged, setNotice }: { cred: GsCredentialStatus | null; onChanged(): void; setNotice(n: Notice): void }) {
  const [busy, setBusy] = useState(false)
  async function upload(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setNotice(null)
    try {
      const r = await window.api.gsSaveCredential(await file.text())
      setNotice(r.ok ? { kind: 'success', text: `Kunci tersimpan untuk ${r.clientEmail}.` } : { kind: 'danger', text: r.message })
    } catch (e) { setNotice({ kind: 'danger', text: fail(e, 'Kunci tidak bisa disimpan.') }) } finally { setBusy(false); onChanged() }
  }
  if (!cred) return null
  return (
    <Card title="Akun layanan Google" icon="bi-key" className="mb-3">
      {cred.configured ? (
        <div className="d-flex flex-wrap align-items-center gap-3">
          <div className="flex-grow-1">
            <div>Bagikan sheet Anda ke email ini sebagai <strong>Viewer</strong>:</div>
            <code className="user-select-all text-break">{cred.clientEmail}</code>
            {cred.addedAt && <div className="small text-body-secondary mt-1">Kunci diunggah {when(cred.addedAt)}. Disarankan diganti tiap 90 hari.</div>}
          </div>
          <ConfirmButton label="Hapus kunci" onConfirm={async () => {
            try { await window.api.gsDeleteCredential(); setNotice({ kind: 'success', text: 'Kunci dihapus. Pengetahuan yang sudah ada tetap dipakai.' }) } catch (e) { setNotice({ kind: 'danger', text: fail(e, 'Gagal menghapus kunci.') }) }
            onChanged()
          }} />
        </div>
      ) : (
        <div>
          <p>Bot membaca Google Sheets lewat <em>akun layanan</em> (hanya baca). Cara menyiapkannya:</p>
          <ol className="small">
            <li>Buat proyek di Google Cloud Console, lalu aktifkan <strong>Google Sheets API</strong>.</li>
            <li>Buat <strong>Service Account</strong>, lalu buat kunci berformat <strong>JSON</strong>. (Di organisasi Google Cloud baru, pembuatan kunci bisa diblokir kebijakan organisasi; minta administrator mengecualikan proyek ini.)</li>
            <li>Unggah berkas JSON di bawah. Kunci disimpan terenkripsi di server dan tidak pernah dikirim ke browser.</li>
            <li>Bagikan sheet Anda ke email akun layanan sebagai <strong>Viewer</strong>.</li>
          </ol>
          <input id="gs-key" type="file" accept=".json,application/json" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} />
          <label htmlFor="gs-key" className={`btn btn-primary${busy ? ' disabled' : ''}`}>
            <i className="bi bi-upload me-1" aria-hidden="true" />{busy ? 'Menyimpan…' : 'Unggah kunci JSON'}
          </label>
        </div>
      )}
    </Card>
  )
}

function DomainsCard({ domains, run }: { domains: string[]; run(fn: () => Promise<unknown>, ok: string, bad: string): Promise<void> }) {
  const [value, setValue] = useState('')
  return (
    <Card title="Domain checkout yang disetujui" icon="bi-shield-check" className="mb-3">
      <p className="small text-body-secondary">
        Tautan checkout dari Google Sheets hanya dipakai bot bila domainnya ada di daftar ini. Ini mencegah tautan palsu yang disisipkan lewat sheet.
      </p>
      <div className="d-flex flex-wrap gap-2 mb-2">
        {domains.length === 0 && <span className="text-body-secondary">Belum ada domain.</span>}
        {domains.map((d) => <StatusBadge key={d} tone="success">{d}</StatusBadge>)}
      </div>
      <form className="d-flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = value.trim(); if (v) void run(() => window.api.gsApproveDomain(v), `${v} disetujui.`, 'Domain tidak valid.').then(() => setValue('')) }}>
        <label htmlFor="gs-domain" className="visually-hidden">Domain</label>
        <input id="gs-domain" className="form-control" placeholder="toko.contoh.id" value={value} onChange={(e) => setValue(e.target.value)} />
        <button type="submit" className="btn btn-outline-primary" disabled={!value.trim()}>Setujui</button>
      </form>
    </Card>
  )
}

function AddSource({ onDone, setNotice }: { onDone(): void; setNotice(n: Notice): void }) {
  const [ref, setRef] = useState('')
  const [info, setInfo] = useState<Extract<GsInspectResult, { ok: true }> | null>(null)
  const [gid, setGid] = useState<number | null>(null)
  const [role, setRole] = useState<GsRole>('knowledge')
  const [range, setRange] = useState('')
  const [mapping, setMapping] = useState<Partial<Record<CatalogField, string>>>({})
  const [columns, setColumns] = useState<string[]>([])
  const [preview, setPreview] = useState<Extract<GsPreviewResult, { ok: true }> | null>(null)
  const [name, setName] = useState('')
  const [interval, setIntervalMin] = useState<number>(GS_LIMITS.defaultIntervalMin)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const tab = info?.tabs.find((t) => t.gid === gid) ?? null
  const rangeValue = range.trim() === '' ? null : range.trim()

  async function inspect() {
    setError(null); setBusy(true); setPreview(null)
    try {
      const r = await window.api.gsInspect(ref)
      if (!r.ok) { setInfo(null); setError(r.message + (r.clientEmail ? ` Bagikan ke ${r.clientEmail}.` : '')); return }
      setInfo(r); setGid(r.tabs[0]?.gid ?? null); setName(`${r.title}${r.tabs[0] ? ` – ${r.tabs[0].title}` : ''}`.slice(0, 80))
    } catch (e) { setError(fail(e, 'Sheet tidak bisa diperiksa.')) } finally { setBusy(false) }
  }

  async function load(nextMapping = mapping, nextColumns = columns) {
    if (!info || gid === null) return
    setError(null); setBusy(true)
    try {
      const r = await window.api.gsPreview({ spreadsheetId: info.spreadsheetId, gid, range: rangeValue, role, mapping: nextMapping, columns: nextColumns })
      if (!r.ok) { setPreview(null); setError(r.message); return }
      setPreview(r)
      if (role === 'catalog' && Object.keys(nextMapping).length === 0) setMapping(r.suggestedMapping)
    } catch (e) { setError(fail(e, 'Pratinjau gagal.')) } finally { setBusy(false) }
  }

  async function save() {
    if (!info || !tab) return
    setError(null); setBusy(true)
    try {
      await window.api.gsAddSource({ name, spreadsheetId: info.spreadsheetId, gid: tab.gid, tabTitle: tab.title, range: rangeValue, role, mapping: role === 'catalog' ? mapping : {}, columns: role === 'knowledge' ? columns : [], intervalMin: interval })
      setNotice({ kind: 'success', text: 'Sumber ditambahkan. Sinkron pertama sedang berjalan.' })
      onDone()
    } catch (e) { setError(fail(e, 'Sumber tidak bisa disimpan.')) } finally { setBusy(false) }
  }

  const canSave = !!preview && name.trim() !== '' && (role === 'knowledge' || (!!mapping.id && !!mapping.nama))
  return (
    <div className="border rounded p-3 mb-3" aria-label="Tambah sumber Google Sheets">
      {error && <div className="alert alert-danger py-2" role="alert">{error}</div>}
      <div className="mb-3">
        <label htmlFor="gs-ref" className="form-label">1. Tautan Google Sheets</label>
        <div className="d-flex gap-2">
          <input id="gs-ref" className="form-control" placeholder="https://docs.google.com/spreadsheets/d/…" value={ref} onChange={(e) => setRef(e.target.value)} />
          <button type="button" className="btn btn-outline-primary" disabled={busy || !ref.trim()} onClick={() => void inspect()}>Periksa</button>
        </div>
      </div>
      {info && (
        <>
          <div className="row g-3 mb-3">
            <div className="col-md-4">
              <label htmlFor="gs-tab" className="form-label">2. Tab</label>
              <select id="gs-tab" className="form-select" value={gid ?? ''} onChange={(e) => { setGid(Number(e.target.value)); setPreview(null) }}>
                {info.tabs.map((t) => <option key={t.gid} value={t.gid}>{t.title}</option>)}
              </select>
            </div>
            <div className="col-md-4">
              <label htmlFor="gs-role" className="form-label">Peran</label>
              <select id="gs-role" className="form-select" value={role} onChange={(e) => { setRole(e.target.value as GsRole); setPreview(null) }}>
                <option value="knowledge">Pengetahuan umum (FAQ, info)</option>
                <option value="catalog">Katalog produk</option>
              </select>
            </div>
            <div className="col-md-4">
              <label htmlFor="gs-range" className="form-label">Rentang (opsional)</label>
              <input id="gs-range" className="form-control" placeholder="A1:F200" value={range} onChange={(e) => setRange(e.target.value)} />
            </div>
          </div>
          <p className="small text-body-secondary">Baris dan kolom yang disembunyikan di sheet tetap bisa terbaca. Pilih tab dan rentang yang memang boleh diketahui bot, dan taruh data internal di sheet terpisah.</p>
          <button type="button" className="btn btn-outline-secondary mb-3" disabled={busy} onClick={() => void load({}, [])}>Lihat pratinjau</button>
        </>
      )}
      {preview && (
        <>
          {role === 'catalog' ? (
            <div className="row g-2 mb-3">
              {CATALOG_FIELDS.map((f) => (
                <div className="col-md-4" key={f}>
                  <label htmlFor={`gs-map-${f}`} className="form-label small">{FIELD_LABEL[f]}</label>
                  <select id={`gs-map-${f}`} className="form-select form-select-sm" value={mapping[f] ?? ''}
                    onChange={(e) => { const m = { ...mapping }; if (e.target.value) m[f] = e.target.value; else delete m[f]; setMapping(m) }}>
                    <option value="">(tidak dipakai)</option>
                    {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
              <div className="col-12 small text-body-secondary">Kolom yang tidak dipilih dibuang dan tidak sampai ke bot (mis. harga modal).</div>
            </div>
          ) : (
            <fieldset className="mb-3">
              <legend className="form-label fs-6">Kolom yang dipakai (kosong = semua)</legend>
              {preview.headers.map((h) => (
                <div className="form-check form-check-inline" key={h}>
                  <input id={`gs-col-${h}`} className="form-check-input" type="checkbox" checked={columns.includes(h)}
                    onChange={(e) => setColumns(e.target.checked ? [...columns, h] : columns.filter((c) => c !== h))} />
                  <label htmlFor={`gs-col-${h}`} className="form-check-label">{h}</label>
                </div>
              ))}
            </fieldset>
          )}
          <button type="button" className="btn btn-sm btn-outline-secondary mb-3" disabled={busy} onClick={() => void load()}>Perbarui pratinjau</button>
          {preview.problems.length > 0 && <ul className="small text-warning-emphasis">{preview.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          <div className="table-responsive mb-1">
            <table className="table table-sm">
              <caption className="small">Pratinjau {preview.rows.length} dari {preview.totalRows} baris</caption>
              <thead><tr>{preview.headers.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
              <tbody>{preview.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="text-break">{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <div className="row g-3 mt-1 align-items-end">
            <div className="col-md-6">
              <label htmlFor="gs-name" className="form-label">Nama sumber</label>
              <input id="gs-name" className="form-control" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="col-md-3">
              <label htmlFor="gs-interval" className="form-label">Sinkron tiap</label>
              <select id="gs-interval" className="form-select" value={interval} onChange={(e) => setIntervalMin(Number(e.target.value))}>
                {INTERVALS.map((m) => <option key={m} value={m}>{m >= 60 ? `${m / 60} jam` : `${m} menit`}</option>)}
              </select>
            </div>
            <div className="col-md-3">
              <button type="button" className="btn btn-primary w-100" disabled={busy || !canSave} onClick={() => void save()}>Simpan dan sinkron</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
