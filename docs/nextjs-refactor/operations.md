# Operasi AutoBot: environment, rahasia, backup, restore, reset, pemecahan masalah

Diverifikasi di mesin pengembangan (Linux, Docker 29, Compose 2.40) pada 2026-11-20 kecuali ditandai **belum diuji**.

## 1. Layanan dan jaringan

| Layanan | Tugas | Jaringan | Port ke luar |
|---|---|---|---|
| `caddy` | satu-satunya pintu masuk | `public`, `edge` | `127.0.0.1:3000` (lokal) atau 80/443 (publik) |
| `web` | panel, login, sesi, TOTP, OTP; `auth.db` | `edge`, `internal` (keduanya tanpa internet) | tidak ada |
| `worker` | WhatsApp, bot, Sheets, `autobot.db`, sesi WA | `internal`, `egress` | tidak ada |

Web dan worker berbicara lewat jaringan internal dengan header `X-Worker-Token`. Caddy tidak sejaringan dengan worker.

## 2. Rahasia (`deploy/secrets/`, dibuat `npm run docker:init`)

| Berkas | Dipegang oleh | Fungsi | Jika hilang |
|---|---|---|---|
| `worker_token` | web dan worker | autentikasi web → worker (64 karakter heksadesimal) | buat baru, mulai ulang keduanya |
| `auth_secret_key` | web saja | rahasia TOTP, HMAC OTP dan kode pemulihan, tanda tangan sesi | semua akun tidak bisa masuk; reset dan setup ulang |
| `engine_secret_key` | worker saja | mengenkripsi API key AI dan kunci akun layanan Google | key tersimpan tidak terbaca; masukkan ulang |

`init.sh` tidak pernah menimpa berkas yang ada. Simpan salinan `secrets/` **terpisah** dari cadangan data.

## 3. Variabel lingkungan

Web: `APP_URL` (wajib `https://`, kecuali `http://localhost`), `WORKER_URL`, `WORKER_TOKEN` atau `WORKER_TOKEN_FILE`, `AUTH_SECRET_KEY` atau `_FILE`, `AUTH_DATA_DIR`, `TRUSTED_PROXY_HOPS` (1 di belakang Caddy), `SESSION_IDLE_MINUTES` (5–1440, bawaan 30), `SESSION_ABSOLUTE_HOURS` (1–168, bawaan 12).
Worker: `DATA_DIR`, `HOST`, `PORT` (4000), `ENGINE_SECRET_KEY` atau `_FILE`, `WORKER_TOKEN` atau `_FILE`, `LOG_LEVEL`.
Compose (`deploy/.env` atau shell): `TAG`, `APP_URL`, `CADDY_BIND`, `CADDY_HTTP_PORT`, `CADDY_HTTPS_PORT`, `CADDYFILE`, `DOMAIN`, `SESSION_IDLE_MINUTES`, `SESSION_ABSOLUTE_HOURS`.

Keduanya menolak mulai bila `WORKER_TOKEN` kurang dari 32 karakter atau kunci bukan 32 byte.

## 4. Deploy publik (**belum diuji** di VPS)

Isi `deploy/.env`:
```
DOMAIN=panel.contoh.id
APP_URL=https://panel.contoh.id
CADDYFILE=Caddyfile
CADDY_BIND=0.0.0.0
CADDY_HTTP_PORT=80
CADDY_HTTPS_PORT=443
```
Syaratnya: DNS domain mengarah ke VPS, port 80 dan 443 terbuka, jam server sinkron (NTP). Caddy mengurus sertifikat HTTPS sendiri.
Cookie berawalan `__Host-`, HSTS, dan `upgrade-insecure-requests` hanya aktif saat `APP_URL` berawalan `https://`.
Jalankan gerbang di `release-gate-evidence.md` sebelum membuka ke publik.

## 5. Backup, restore, reset (`deploy/scripts/`)

**Backup** (bot tetap berjalan; kedua database disalin dengan SQLite online backup, ditambah sesi WA, berkas pengetahuan, pengaturan, `secrets.json` terenkripsi):
```bash
OUT_DIR=/jalur/di/luar/volume AGE_RECIPIENT=age1... bash deploy/scripts/backup.sh     # terenkripsi (age)
OUT_DIR=/jalur/uji ALLOW_PLAINTEXT_BACKUP=1 bash deploy/scripts/backup.sh             # tanpa enkripsi, hanya uji lokal
```
Arsip berisi sesi WhatsApp dan data pelanggan: perlakukan seperti kredensial. Berkas lebih dari 14 hari dihapus otomatis. Kunci di `secrets/` tidak ada di arsip.
Diuji: jalur tanpa enkripsi. **Belum diuji:** jalur `age` (age belum terpasang di mesin ini).

**Restore** (menghentikan stack, mengganti isi volume, menyalakan lagi; meminta ketik `ganti`):
```bash
bash deploy/scripts/restore.sh /jalur/autobot-<cap-waktu>.tar          # atau .tar.age dengan AGE_IDENTITY=<berkas kunci privat>
```
Diuji pada data kosong. **Belum diuji** pada data berisi dan di mesin bersih. Tidak ada migrasi mundur: cadangan dipulihkan ke versi yang sama atau lebih baru.

**Reset** (menghapus SEMUA data; rahasia tetap; meminta ketik `hapus semua`):
```bash
bash deploy/scripts/reset.sh
```

**Sebelum deploy versi baru:** jalankan backup, beri tag image (`TAG=<sha>`), lalu `docker compose up -d --build`. Kembali ke versi lama = pakai tag sebelumnya; migrasi dibuat maju-kompatibel.

## 6. Pemecahan masalah

| Gejala | Penyebab dan tindakan |
|---|---|
| `port is already allocated` / `address already in use` di 3000 | Ada proses lain (mis. `npm run dev`). Hentikan, atau `CADDY_HTTP_PORT=3100 npm run docker:up`. |
| Token setup tidak terlihat | Tergulung di log: `npm run docker:logs`, atau mulai ulang `web`. Token baru dibuat tiap mulai. Bila setup sudah selesai, token tidak ada lagi. |
| Ulang setup dari nol | `bash deploy/scripts/reset.sh` (Docker) atau hapus `.local-data/` (lokal). Semua data hilang. |
| Web gagal mulai: `WORKER_TOKEN minimal 32 karakter` atau `AUTH_SECRET_KEY harus 32 byte` | Berkas rahasia rusak atau terlalu pendek. Periksa `deploy/secrets/`. Jangan buat ulang `engine_secret_key` bila API key sudah tersimpan. |
| Web gagal mulai: `APP_URL harus https://` | `http://` hanya untuk `localhost`. Pakai domain dengan HTTPS. |
| Halaman menampilkan "Bot menyambung ulang" | Worker belum siap atau mati. `docker compose ps`, `docker compose logs worker`. Web tetap berjalan. |
| QR tidak muncul | WhatsApp belum di status `waiting_qr`: tekan Hubungkan lagi. Pastikan worker punya internet (jaringan `egress`). |
| OTP tidak sampai | Lihat pesan di wizard: `NOT_ON_WHATSAPP` (nomor tidak terdaftar), `WA_DISCONNECTED` (bot belum terhubung), `SAME_AS_BOT` (nomor pemilik sama dengan nomor bot, harus beda). OTP juga dibatasi: tunggu 60 detik antar permintaan. |
| Kode authenticator ditolak terus | Jam perangkat atau server melenceng (cek `timedatectl`). Kode yang sama tidak bisa dipakai dua kali: tunggu langkah 30 detik berikutnya. |
| Authenticator hilang | Masuk dengan kode pemulihan (sekali pakai; sesinya hanya boleh mendaftarkan authenticator baru). |
| Terlalu banyak percobaan (429) | Batas login/OTP. Tunggu sesuai pesan. Di belakang proxy, pastikan `TRUSTED_PROXY_HOPS=1`. |
| API key AI hilang setelah ganti server | `engine_secret_key` berbeda dari yang dipakai saat menyimpan. Pulihkan berkas aslinya atau masukkan key lagi. |
| Dua worker pada data yang sama | Kunci instans menolak. Hentikan salah satunya. |
| Sinkron Google Sheets: `NOT_SHARED` | Bagikan sheet ke email akun layanan sebagai Viewer. `API_DISABLED`: aktifkan Google Sheets API di proyek Google Cloud. `CREDENTIAL_INVALID`: unggah kunci baru. Pengetahuan lama tetap dipakai selama galat. |
| Sinkron Sheets `needs_confirm` | Jumlah baris turun lebih dari 50%. Periksa sheet, lalu Terapkan atau Abaikan di Pengaturan → Pengetahuan → Google Sheets. |
| Link checkout dari Sheets tidak dipakai bot | Domainnya belum disetujui. Tambahkan di kartu "Domain checkout yang disetujui". |

## 7. Uji end-to-end Docker

`bash deploy/test/run.sh` membangun image asli web, menjalankannya di belakang Caddy dengan **worker tiruan** (hanya untuk tes; tidak mengirim apa pun ke WhatsApp), lalu menjalankan wizard, login, sesi, SSE, dan batas percobaan (37 pemeriksaan). Nomor pemilik di tes adalah nomor palsu (`E2E_OWNER_PHONE` bila ingin mengganti). Semua dihapus setelah selesai.
