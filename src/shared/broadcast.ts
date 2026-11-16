export type Tier = 'baru' | 'berkembang' | 'mapan'
export type ContactStatus = 'aktif' | 'menunggu_persetujuan' | 'tidak_aktif'
export type SuppressReason = 'berhenti' | 'laporan' | 'tidak_terdaftar' | 'blokir_manual' | 'admin' | 'tolak_lunak'
export type CampaignKind = 'broadcast' | 'konfirmasi'
export type CampaignStatus = 'draf' | 'terjadwal' | 'berjalan' | 'dijeda' | 'dihentikan' | 'selesai'
export type SendStatus = 'antre' | 'terkirim' | 'gagal' | 'dilewati'
export type Audience = 'chat' | 'impor' | 'semua'

export interface BContact {
  id: number
  number: string | null
  jid: string | null
  name: string
  vars: Record<string, string>
  source: 'chat' | 'impor'
  status: ContactStatus
  lastInboundAt: number | null
  lastSentAt: number | null
  sentCount: number
  importId: number | null
}

export interface Campaign {
  id: number
  name: string
  kind: CampaignKind
  template: string
  status: CampaignStatus
  pauseReason: string | null
  createdAt: number
  startedAt: number | null
  audience: Audience
  notBefore: number | null
}
