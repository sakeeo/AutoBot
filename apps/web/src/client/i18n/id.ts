export const id = {
  appName: 'AutoBot',
  tagline: 'Balas WA Otomatis pakai AI',
  nav: {
    dashboard: 'Dashboard',
    messages: 'Pesan',
    test: 'Uji Jawaban',
    log: 'Log',
    settings: 'Pengaturan',
    connector: 'Connector',
    knowledge: 'Pengetahuan',
    brand: 'Brand & Konversi',
    security: 'Keamanan',
    ai: 'AI',
    more: 'Lainnya'
  },
  state: {
    disconnected: 'Terputus',
    connecting: 'Menghubungkan…',
    waiting_qr: 'Menunggu scan QR',
    connected: 'Terhubung'
  } as Record<string, string>,
  risk:
    'WhatsApp tidak menyediakan izin resmi untuk bot di nomor pribadi. Memakai aplikasi ini berisiko nomor Anda dibatasi atau diblokir. Gunakan nomor sekunder dan jangan mengirim ke orang yang tidak menghendaki.'
} as const
