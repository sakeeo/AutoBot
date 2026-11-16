# Broadcast Aman — Rancangan

Status: **draf untuk disetujui**. Dasar: permintaan pengguna (2026-11-16) — "rancang fitur broadcast, wajib memprioritaskan keamanan agar akun tidak mudah diblokir" — dan pilihan pengguna atas penerima: **kontak yang pernah menghubungi bot, ditambah daftar impor**. Visual mengikuti `docs/design-guide.md`. Melengkapi PRD §5.3.

## 1. Maksud
Mengirim pesan massal dari nomor yang tertaut ke aplikasi dengan risiko pemblokiran serendah mungkin. Risiko itu terutama datang dari penerima yang tidak menghendaki pesan, volume yang melonjak, dan pengirim yang tidak berhenti ketika ada tanda bahaya. Karena itu keamanan di sini berarti **persetujuan penerima, volume rendah dan bertahap, dan berhenti sendiri saat ada tanda bahaya**.

## 2. Batasan jujur
- Aplikasi memakai Baileys (jalur tidak resmi). Tidak ada rancangan yang bisa menjamin akun tidak diblokir; rancangan ini hanya menekan risikonya.
- Untuk daftar besar, penerima dingin, atau kebutuhan pemasaran skala besar, jalur resmi (WhatsApp Business Platform) lebih tepat. Halaman Broadcast menampilkan catatan ini.

## 3. Tujuan
- Penerima hanya orang yang sudah berhubungan dengan bisnis atau sudah menyatakan setuju.
- Pembatasan volume per hari/jam/batch, jam kirim, dan jeda antarkontak, ditegakkan **pada saat setiap pesan akan dikirim**, bukan hanya saat kampanye dibuat.
- Penghentian otomatis (pemutus sirkuit) pada koneksi bermasalah, banyak gagal, banyak berhenti berlangganan, atau tanpa respons.
- Berhenti berlangganan yang tidak bisa dilewati, di setiap pesan dan tertangani otomatis.
- Semua pengiriman tercatat (jejak audit) dan dapat dilaporkan serta diekspor.

## 4. Bukan tujuan dan anti-tujuan
- **Tidak ada** penyamaran agar lolos deteksi spam: tanpa variasi teks acak (spintax), tanpa rotasi nomor/akun, tanpa proxy, tanpa memalsukan perilaku manusia selain jeda dan indikator mengetik yang sudah ada.
- **Tidak ada** cara melewati daftar tolak atau batas harian, termasuk lewat pengaturan.
- Tidak mengirim ke grup, ke nomor yang tidak terdaftar di WhatsApp, atau ke nomor tanpa dasar persetujuan.
- Versi pertama hanya teks (tanpa gambar/video/dokumen, yang lebih berisiko); tanda terima baca/terkirim ditunda.
- Tidak mengubah perilaku balasan bot kecuali penanganan "berhenti/mulai" (bagian 7).

## 5. Pendekatan yang dipertimbangkan
1. **Mesin dalam proses dengan antrean tahan lama dan gerbang di setiap pengiriman (dipilih).** Antrean di SQLite; satu pemroses mengambil pengiriman berikutnya dan menjalankan seluruh gerbang pada saat itu. Bisa bereaksi terhadap koneksi, kesehatan, jam kirim, dan perubahan daftar tolak; bertahan saat aplikasi dimulai ulang.
2. Jadwal dihitung di muka saat kampanye dibuat (timestamp tetap per penerima): sederhana, tetapi tidak bisa bereaksi (penerima yang berhenti berlangganan setelah penjadwalan tetap menerima). Ditolak.
3. Proses pekerja terpisah: kompleksitas tanpa manfaat pada aplikasi desktop lokal. Ditolak.

## 6. Penerima dan persetujuan
Tiga status dasar persetujuan, disimpan per kontak dengan alasan dan waktu:

| Sumber | Dasar | Aturan |
|---|---|---|
| Chat | Kontak mengirim pesan lebih dulu ke bot (pesan masuk terakhir ≤ 365 hari, bukan grup) | Langsung layak |
| Impor | Pengguna mengakui punya persetujuan (pernyataan wajib + keterangan sumber) | **Konfirmasi dua langkah**: kontak lebih dulu menerima satu pesan konfirmasi dan baru layak setelah membalas |
| Tolak | Kontak berhenti berlangganan, dilaporkan, atau tidak terdaftar | Tidak pernah dikirimi broadcast |

### 6.1 Impor
- CSV/XLSX dengan kolom `nomor` (wajib), `nama` (opsional), dan variabel lain (opsional). Nomor dinormalisasi (`0…` → `62…`), digandakan dibuang, format tak valid ditolak dengan laporan.
- **Pernyataan wajib** sebelum impor: "Saya memiliki persetujuan dari semua nomor dalam daftar ini untuk menerima pesan dari bisnis saya", ditambah kolom **keterangan sumber** (min. 10 karakter, mis. "Formulir pendaftaran website, Okt 2026"). Disimpan bersama lot impor (waktu, jumlah, sumber).
- Validasi `onWhatsApp` dalam kelompok kecil dengan jeda; nomor yang tidak terdaftar dibuang. Bila >30% nomor tidak terdaftar, impor dihentikan dengan peringatan kualitas daftar.
- Kontak impor berstatus `menunggu_persetujuan`. Pesan konfirmasi (templat wajib memuat nama bisnis, asal data, dan kalimat berhenti) dikirim memakai kuota "kontak baru" harian. Setelah membalas selain kata berhenti → `aktif`. Tanpa balasan dalam 7 hari → `tidak_aktif` (tidak dikirimi apa pun lagi).

### 6.2 Daftar tolak
- Dasar semua pengecekan, diperiksa saat kirim. Isi: nomor, alasan (`berhenti`, `laporan`, `tidak_terdaftar`, `blokir_manual`, `admin`), waktu.
- Nomor admin dan nomor bot otomatis masuk.
- Keluar dari daftar tolak hanya bila **kontak sendiri** membalas "MULAI"; pengguna tidak bisa menghapusnya dari UI. Penghapusan data kontak (hak hapus) tersedia dan membuang kontak dari semua daftar.

## 7. Berhenti berlangganan
- Setiap pesan broadcast **otomatis** diberi kaki: "Balas BERHENTI untuk tidak menerima pesan ini lagi." Tidak dapat dihapus atau diubah menjadi tersembunyi.
- Sebelum agen memproses pesan masuk, penangan khusus memeriksa kata kunci pesan pendek (≤ 40 karakter, seluruh pesan): `berhenti`, `stop`, `unsubscribe`, `batal langganan`, `jangan kirim lagi`, dll. → masuk daftar tolak, balasan konfirmasi sekali ("Baik, Anda tidak akan menerima pesan promosi lagi. Balas MULAI untuk berlangganan kembali."), pesan **tidak** diteruskan ke agen. `mulai`/`start` mengeluarkan dari daftar tolak.
- Kata berisiko tinggi (`spam`, `laporkan`, `penipu`) → daftar tolak + notifikasi admin + dihitung sebagai sinyal bahaya.
- Kalimat panjang yang kebetulan memuat "stop" ("jangan stop dulu ya") tidak memicu apa pun; tes khusus untuk kasus ini.

## 8. Batas dan jam kirim
Semua angka adalah **keputusan saya** (alasan: pola umum untuk nomor baru; bisa disetel turun, tidak bisa disetel melewati batas tingkat).

| Tingkat (usia nomor, dinyatakan pengguna) | Maks pesan/hari | Maks kontak baru/hari |
|---|---|---|
| Baru (< 30 hari) | 20 | 5 |
| Berkembang (30–90 hari) | 80 | 15 |
| Mapan (> 90 hari) | 200 | 30 |

- **Pemanasan**: hari aktif pertama maksimal 10 pesan, naik 25% per hari aktif sampai batas tingkat. Hari tanpa broadcast tidak mengulang pemanasan; jeda >14 hari mengulang dari awal.
- Maks 15 pesan/jam; setelah tiap 10 pesan jeda 3–8 menit.
- **Jeda antarpesan acak 20–60 detik** (lebih konservatif daripada 5–15 detik di PRD; ini tentang laju, bukan penyamaran) plus indikator mengetik 2–5 detik yang sudah ada.
- **Jam kirim**: bawaan 09:00–20:00 zona waktu profil; di luar jam itu antrean menunggu.
- **Per kontak**: minimal 7 hari antarbroadcast (dapat dikecilkan sampai 3), maksimal 4 per 30 hari.
- Broadcast **mengalah** pada balasan bot: tidak mengirim sementara ada balasan untuk pelanggan yang sedang diproses.
- Kampanye lebih besar dari kuota hari itu otomatis berlanjut di hari berikutnya dalam jam kirim.

## 9. Pemutus sirkuit (berhenti sendiri)
Kampanye berjalan → `dijeda` (tidak pernah lanjut otomatis; lanjut perlu tindakan pengguna) dengan alasan jelas dan notifikasi bila:
- koneksi WhatsApp terputus atau akun keluar (logout);
- ≥ 3 pengiriman gagal beruntun atau ≥ 20% gagal dari 20 terakhir;
- ≥ 3 berhenti berlangganan dalam 30 pengiriman terakhir, atau 1 kata risiko tinggi;
- ≥ 30 terkirim ke kontak non-chat dengan 0 balasan;
- jam kirim berakhir bukan jeda melainkan menunggu (bukan pemutus).
Setelah aplikasi dimulai ulang, kampanye yang berjalan kembali ke `dijeda`. Tombol **Hentikan semua** selalu terlihat saat berjalan; saklar global "Broadcast aktif" mematikan seluruh pengiriman.

## 10. Isi pesan
- Templat dengan variabel `{nama}` dan `{bisnis}`. Pesan wajib memuat nama bisnis (agar penerima mengenali pengirim); kaki berhenti ditambahkan otomatis.
- **Pemeriksa isi** sebelum mulai: maks 600 karakter; maks 1 tautan; tautan pemendek (bit.ly dll.) ditolak; huruf kapital >40% diperingatkan; kemiripan 100% dengan kampanye terakhir ke audiens yang sama diperingatkan.
- Pratinjau menampilkan hasil render untuk 3 penerima contoh.

## 11. Alur pengguna
Menu **Broadcast** (di bawah Pesan), empat tab:
1. **Kampanye**: daftar dan status; tombol Buat kampanye (wizard 4 langkah): audiens (Kontak chat aktif / Hasil impor aktif / gabungan) → pesan + pemeriksa → tinjau (jumlah per kategori, jumlah yang akan dilewati beserta alasan, **perkiraan selesai** dalam hari, daftar periksa keamanan) → jadwal dan konfirmasi (di atas 50 penerima wajib mengetik KIRIM).
2. **Penerima**: daftar dengan status, filter, impor (dengan pernyataan wajib), daftar tolak (hanya baca).
3. **Keamanan**: tingkat nomor, batas, jam kirim, jeda; indikator kesehatan (aman / hati-hati / dijeda) beserta alasannya.
4. **Laporan**: terkirim, gagal, dilewati (+alasan), berhenti, membalas; ekspor CSV.

Saat berjalan: kartu progres, **Jeda**, **Hentikan**, dan **Hentikan semua**. Memulai/mengubah kampanye butuh aplikasi tidak terkunci; kampanye yang sudah berjalan tetap berjalan saat terkunci.

## 12. Rancangan teknis
- Tabel baru: `broadcast_contacts` (jid, nomor, nama, sumber, dasar, status, last_inbound_at, last_sent_at, jumlah terkirim), `broadcast_imports` (lot, sumber, pernyataan, waktu), `broadcast_suppress`, `broadcast_campaigns`, `broadcast_sends` (kampanye, kontak, status, alasan, jadwal, waktu kirim, id WA), `broadcast_state` (tingkat, awal pemanasan, penghitung harian).
- `BroadcastGate.check(contact, ctx): allow | wait(until) | skip(reason) | halt(reason)` — fungsi murni dengan jam yang disuntik; semua aturan bagian 6–9 ada di sini dan diuji tanpa Electron.
- `BroadcastEngine`: pemroses tunggal; tiap tik mengambil pengiriman jatuh tempo berikutnya, menjalankan gerbang, mengirim lewat `WaGateway.sendText`, mencatat hasil; memutus sirkuit.
- `WaGateway` bertambah `onWhatsApp(numbers): Promise<{number, jid, exists}[]>` (Baileys `onWhatsApp`), dengan Fake untuk tes.
- Pengiriman dicatat ke `MessageFeed` sebagai `out` (berlabel broadcast) dan id kirim diingat (`rememberSentId`) agar gema pesan tidak dianggap manusia yang mengambil alih chat.
- Penangan berhenti/mulai berjalan di pipeline sebelum agen.
- IPC baru lewat `handle()` berpagar; event progres lewat `lockAwareSend`.
- Catatan pembangun: id chat `@lid` dari Baileys tidak sama dengan nomor telepon; kontak chat harus dipetakan ke JID hasil `onWhatsApp` sebelum dikirimi.

## 13. Kriteria penerimaan (ringkas)
- Tidak ada pengiriman ke nomor di daftar tolak, ke kontak `menunggu_persetujuan`/`tidak_aktif`, atau di luar jam kirim, dalam skenario uji apa pun (termasuk penerima yang berhenti **setelah** kampanye dibuat).
- Batas harian/jam/kontak baru tidak pernah terlampaui, termasuk setelah restart di tengah hari.
- Setiap pemutus sirkuit menjeda dalam satu siklus dan tidak pernah lanjut sendiri.
- "BERHENTI" menghentikan pengiriman berikutnya dalam < 5 detik dan tidak pernah diteruskan ke agen.
- Semua pengiriman tampak di laporan; ekspor CSV lengkap.

## 14. Risiko yang diketahui
- Nilai ambang (batas tingkat, rasio pemutus) adalah tebakan terinformasi, bukan data WhatsApp; ditandai dapat disetel di bawah batas keras dan perlu dikalibrasi setelah pemakaian nyata.
- Perilaku Baileys (`onWhatsApp`, kode galat kirim, jid `@lid`) hanya bisa diuji sebenarnya di Electron dengan nomor sekunder; masuk daftar uji manual.
- Pengakuan persetujuan impor bergantung pada kejujuran pengguna; aplikasi hanya bisa membuatnya eksplisit, tercatat, dan dibatasi.
