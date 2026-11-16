export const id = {
  appName: 'WA Otomation',
  nav: {
    connection: 'Koneksi',
    knowledge: 'Pengetahuan',
    test: 'Uji Jawaban',
    rules: 'Aturan',
    ai: 'AI',
    log: 'Log'
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
