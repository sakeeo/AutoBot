# Menu Pengaturan, Dashboard, dan Login Aplikasi — Rancangan

Status: disetujui pengguna dalam percakapan (2026-11-16). Dasar: aplikasi WA Otomation di branch `feat/conversion-agent`.

## Maksud
Navigasi sekarang berupa 7 menu datar. Pengguna ingin pengaturan dikelompokkan, ada Dashboard untuk melihat kondisi bot sekilas, dan aplikasi bisa dikunci dengan username dan password.

## Tujuan
- Satu grup **Pengaturan** dengan submenu **Connector** (tab WhatsApp, tab AI), **Pengetahuan**, **Brand & Konversi**, **Keamanan & Umum**.
- Halaman **Aturan** lama pindah menjadi tab "Perilaku balasan" di Brand & Konversi (isinya: ambang kecocokan, aksi di luar konteks, teks penolakan, izin grup, cooldown).
- Menu **Dashboard** (halaman awal), lalu **Uji Jawaban** dan **Log** tetap di luar grup.
- Login opsional: username + password, kode pemulihan, kunci otomatis.

## Bukan tujuan / anti-tujuan
- Login bukan enkripsi data di disk; hanya mengunci tampilan. Dokumentasikan ini di halaman Keamanan.
- Tidak ada akun banyak pengguna, peran, atau login jarak jauh.
- Bot tidak boleh berhenti membalas hanya karena layar terkunci.
- Password dan kode pemulihan tidak pernah disimpan sebagai teks biasa dan tidak pernah dikirim ke renderer.

## Pendekatan yang dipertimbangkan
1. **Gerbang di proses utama (dipilih):** status kunci disimpan di proses utama; semua handler IPC selain autentikasi menolak saat terkunci; renderer hanya menampilkan layar kunci. Aman walau renderer dimanipulasi.
2. Gerbang hanya di renderer: sederhana, tetapi IPC tetap terbuka, jadi kunci hanya kosmetik. Ditolak.
3. Enkripsi seluruh data dengan kunci turunan password: lebih kuat, tetapi memutus bot yang berjalan di latar dan menyulitkan reset. Di luar cakupan.

## Rancangan

### Login (main)
- `AuthStore` menyimpan `auth.json` di userData: username, salt+hash password (scrypt), salt+hash kode pemulihan, `autoLockMin`.
- Kode pemulihan acak, ditampilkan sekali saat password dibuat atau direset.
- Percobaan gagal beruntun dibatasi: setelah 5 gagal, tolak 30 detik.
- Saat aplikasi dibuka dan login aktif, status awal = terkunci. Jendela yang disembunyikan ke tray juga mengunci.
- Operasi: setup, login, lock, ganti password (butuh password lama), reset dengan kode pemulihan (menghasilkan kode baru), nonaktifkan (butuh password), atur kunci otomatis (0 = mati).
- Gerbang: handler IPC non-autentikasi menolak dengan galat `LOCKED` saat terkunci.

### Dashboard
Satu panggilan IPC `getDashboard` mengembalikan: jumlah hari ini dan 7 hari terakhir (dibalas `replied:*`, ditolak `out_of_context:*`, diserahkan `handoff*`, galat `error*`, tautan terkirim dari event `checkout_sent` dan `link_sent`), jumlah chat berstatus `menunggu_admin` yang jedanya belum habis, 5 log terakhir, dan jumlah file terindeks/gagal. Status WhatsApp, status AI, dan peringatan (belum ada admin, belum ada API key, belum ada folder pengetahuan) dihitung di renderer dari API yang sudah ada.

### Navigasi
Konfigurasi navigasi di satu berkas (`nav.ts`); grup Pengaturan dapat dibuka-tutup dan terbuka otomatis bila halaman aktif ada di dalamnya. "Jalankan saat login OS" dan Tema pindah ke Keamanan & Umum; pemilih tema di sidebar dihapus.

## Diserahkan ke pembangun
Detail visual, teks galat, dan nama berkas selama konsisten dengan kode yang ada (Bootstrap 5, bahasa Indonesia).

## Risiko yang diketahui
Perilaku jendela-tersembunyi-mengunci dan pengatur waktu kunci otomatis hanya bisa diuji penuh di Electron; ditambahkan ke daftar uji manual.
