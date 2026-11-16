import type { ContactStatus, SuppressReason, Tier } from '../../shared/broadcast'
import type { Tone } from '../ui/StatusBadge'

export const STATUS_LABEL: Record<ContactStatus, string> = {
  aktif: 'Aktif', menunggu_persetujuan: 'Menunggu persetujuan', tidak_aktif: 'Tidak aktif'
}
export const STATUS_TONE: Record<ContactStatus, Tone> = { aktif: 'success', menunggu_persetujuan: 'warning', tidak_aktif: 'neutral' }
export const SOURCE_LABEL = { chat: 'Chat', impor: 'Impor' } as const
export const REASON_LABEL: Record<SuppressReason, string> = {
  berhenti: 'Berhenti berlangganan',
  laporan: 'Dilaporkan sebagai spam',
  tidak_terdaftar: 'Tidak terdaftar di WhatsApp',
  blokir_manual: 'Diblokir manual',
  admin: 'Admin / nomor bot',
  tolak_lunak: 'Menulis "stop" (tolak lunak)'
}
export const TIER_LABEL: Record<Tier, string> = {
  baru: 'Baru (<30 hari)', berkembang: 'Berkembang (30–90 hari)', mapan: 'Mapan (>90 hari)'
}
export const SKIP_LABEL: Record<string, string> = {
  tolak: 'Ada di daftar tolak', tidak_aktif: 'Tidak aktif', menunggu_persetujuan: 'Belum menyetujui',
  nomor_tidak_diketahui: 'Nomor tidak diketahui', terlalu_cepat: 'Baru saja dikirimi', batas_30_hari: 'Sudah 4 pesan dalam 30 hari',
  dihentikan: 'Kampanye dihentikan', sudah_dikonfirmasi: 'Sudah dikonfirmasi'
}
export const formatTime = (at: number | null): string => (at ? new Date(at).toLocaleString('id-ID') : '–')
