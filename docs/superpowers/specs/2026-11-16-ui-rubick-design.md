# Penerapan Design Guide Rubick pada UI — Rancangan

Status: disetujui pengguna dalam percakapan (2026-11-16). Satu-satunya acuan visual: `docs/design-guide.md` (nomor § di bawah merujuk ke sana).

## Maksud
Seluruh UI WA Otomation mengikuti bahasa visual Rubick secara konsisten dan presisi: sidebar biru, area kerja abu-abu muda, kartu putih, Inter, token §11.

## Tujuan
- Token §11 (warna, radius, spasi) sebagai CSS variable, dipetakan ke variabel Bootstrap sehingga semua komponen Bootstrap ikut.
- App shell §4–5: sidebar biru 220 px, top bar (breadcrumb, badge status WhatsApp, notifikasi, menu profil), drawer di bawah 992 px.
- Komponen bersama §7, state §9, aksesibilitas §10: kartu, header halaman, badge status berteks, state loading/kosong/galat, konfirmasi hapus.
- Dashboard §6 sejauh data ada: banner, KPI, tabel aktivitas.
- Semua halaman (Connector, Pengetahuan, Brand & Konversi, Keamanan, Uji Jawaban, Log, layar kunci) memakai komponen yang sama.

## Bukan tujuan / anti-tujuan
- Tidak membuang Bootstrap 5, tidak memakai CDN, tidak menambah kerangka UI lain.
- Tidak menambah nilai visual di luar panduan kecuali yang tertulis di bagian "Turunan".
- Tidak ada pencarian di top bar, grafik, peta, atau kalender (tidak ada data/konten untuk itu).
- Tidak mengubah perilaku bisnis, IPC, atau data.

## Pendekatan
1. **Lapisan token di atas Bootstrap (dipilih):** satu berkas token + satu berkas gaya shell; komponen React kecil untuk pola berulang.
2. Menulis ulang komponen dengan CSS sendiri tanpa Bootstrap: melanggar keputusan Bootstrap 5 dan berisiko besar. Ditolak.

## Turunan (di luar panduan, wajib ditandai di kode dan ledger)
- **Palet gelap:** panduan hanya memuat palet terang; pilihan Terang/Gelap/Otomatis dipertahankan dengan palet gelap turunan dari token.
- **Teks sekunder:** `#7B8798` hanya ±3,6:1 di atas putih, di bawah 4,5:1 yang dituntut §10. Token tetap persis; ditambah token turunan `--color-text-muted` (hue sama, lebih gelap, ≥ 4,5:1 di atas surface dan background) yang dipakai untuk teks. Begitu juga teks badge status di atas latar lembut.
- **Konfirmasi hapus (§9):** pola dua langkah inline ("Hapus" → "Yakin hapus?" + "Batal"), bukan dialog modal.

## Diserahkan ke pembangun
Nilai pasti turunan (hex), nama kelas CSS, dan susunan berkas, selama token panduan dipakai persis dan semua turunan lulus uji kontras.
