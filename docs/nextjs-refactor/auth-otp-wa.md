# Desain: Setup Akun setelah WhatsApp Terhubung, Login Password + TOTP, dan OTP WhatsApp untuk Setup dan Lupa Password

Penulis: System Analysis & Architecture · **Revisi 5** (2026-11-18) · Status: bagian dari Plan Rev 5 ([`architecture-plan.md`](./architecture-plan.md), ADR-005 dan ADR-012); belum ada kode, belum ada spike.
Menggantikan Rev 4 dokumen ini. **Perubahan Rev 5 (seq 138):** dua container (`web` dan `worker`); penerima OTP adalah nomor WA **berbeda dari nomor bot** yang **didaftarkan di awal setup**. Akibatnya jalur "pesan ke nomor sendiri" dan hipotesis pendaftaran ulang nomor bot dihapus; OTP selalu dikirim ke nomor lain.

---

## 1. Keputusan, tafsir, dan yang berubah dari Rev 3

| Dari pemilik | Rancangan |
|---|---|
| Setup username + password **setelah** WA terhubung | Wizard: token setup → **nomor pemilik didaftarkan di awal** → hubungkan WA → OTP ke nomor pemilik → username + password → daftar TOTP → 10 kode pemulihan. Bot tidak membalas pelanggan sebelum pemilik menyalakannya |
| OTP dikirim ke nomor WA terdaftar: nomor **berbeda** yang didaftarkan di awal setup (seq 138) | OTP dikirim bot lewat WhatsApp ke **nomor pemilik**: nomor yang diisi di awal setup, **wajib berbeda dari nomor bot**, dan diverifikasi dengan OTP begitu bot terhubung |
| Lupa password lewat OTP WA | Username → OTP WA → password baru; semua sesi dicabut; **login ulang** |
| **TOTP wajib** (seq 77) | Login harian = password + TOTP |

**Yang berubah dari Rev 3:** OTP WA tidak lagi dipakai di setiap login (TOTP menggantikannya), sehingga login tidak bergantung pada WA; TOTP wajib, bukan opsional; sesi idle 30 menit; tidak ada peran `agent`; tidak ada jalur impor data desktop.

**Default yang saya kunci** (ubah bila tidak setuju): 10 kode pemulihan wajib + perintah reset di server; setelah reset login ulang (dipaksa oleh TOTP wajib). Penerima OTP bukan lagi default: sudah diputuskan pemilik.

**Properti keamanan yang dijaga rancangan ini:** OTP WA **tidak pernah dapat melepas atau menggantikan TOTP**. Orang yang menguasai nomor WA pemilik (SIM swap, ponsel dicuri) bisa mereset password, tetapi tetap tidak bisa masuk tanpa TOTP atau kode pemulihan.

---

## 2. Ancaman utama dan jawabannya

| Ancaman | Jawaban |
|---|---|
| **Pengambilalihan sebelum akun ada.** Sebelum akun ada, siapa pun yang membuka URL bisa memindai QR dengan nomornya sendiri | **Token setup** sekali pakai (dicetak ke log server); sesi setup terbatas; finalisasi atomik. Deploy lokal sekarang hanya membuka `127.0.0.1` |
| **Bot menjawab sebelum dikonfigurasi** (kode saat ini langsung membalas begitu WA terhubung) | Saklar `bot_enabled`, **mati** secara bawaan |
| **Banjir OTP** ke ponsel pemilik; memancing blokir nomor bot | Batas per akun, per IP, dan global di `systemSend` (§4.1) |
| **Tebak password / TOTP / OTP** | Pembatasan berlapis (§4); TOTP dan OTP dibatasi percobaannya; tidak ada penguncian akun permanen |
| **WA terputus** | Login harian tidak terpengaruh; lupa password lewat kode pemulihan; cadangan terakhir perintah server |
| **TOTP hilang** | Kode pemulihan; cadangan terakhir perintah server |
| **Kebocoran OTP** ke riwayat, halaman Pesan, memori bot, log | Jalur `systemSend` yang tidak mencatat (§6.2) |
| **SIM swap / penguasaan nomor pemilik** | TOTP wajib; OTP WA tidak dapat melepas TOTP; reset tidak memberi sesi; pemberitahuan ke nomor pemilik |
| **TOTP gagal karena jam melenceng; kode dipakai ulang** | Jendela ±1 langkah, penolakan langkah waktu yang sudah dipakai, cek jam di `/healthz` |

---

## 3. Alur

### 3.1 Setup pertama

```mermaid
sequenceDiagram
  actor O as Pemilik (browser)
  participant W as web (Next.js)
  participant K as worker
  participant WA as WhatsApp
  Note over W: Boot pertama, belum ada akun: buat token setup,<br/>simpan HMAC-nya, cetak token ke log web (sekali per boot)
  O->>W: buka URL, masukkan token setup (kolom isian)
  W-->>O: sesi setup terbatas (cookie)
  O->>W: daftarkan nomor pemilik (nomor WA lain, bukan nomor bot)
  O->>W: mulai hubungkan WhatsApp
  W->>K: connect (X-Principal: setup)
  K-->>O: QR lewat SSE (worker → web → browser)
  O->>WA: pindai QR dengan nomor bot
  K-->>W: terhubung sebagai ••••1234
  Note over W: tolak bila nomor terhubung sama dengan nomor pemilik
  W->>K: onWhatsApp(nomor pemilik), lalu system-send(OTP setup)
  K->>WA: pesan OTP ke nomor pemilik
  O->>W: masukkan kode OTP
  O->>W: username + password (+ konfirmasi)
  W-->>O: kode QR TOTP + rahasia (tampil sekali)
  O->>W: kode TOTP pertama (aktivasi)
  W-->>O: 10 kode pemulihan (tampil sekali, wajib dicentang "sudah disimpan")
  Note over W: finalisasi atomik: akun dibuat, token setup mati,<br/>/api/setup/* menjadi 404; bot_enabled tetap mati
```

- **Nomor pemilik didaftarkan di awal**, sebelum QR. Aturan: format nomor valid, **tidak boleh sama dengan nomor bot** (diperiksa lagi begitu bot terhubung; bila sama, wizard meminta nomor lain atau memutus tautan dan memindai ulang), dan harus terdaftar di WhatsApp (`onWhatsApp`). OTP baru dikirim **setelah** bot terhubung, karena yang mengirim adalah bot.
- **Token setup:** 32 byte acak, hanya HMAC-nya disimpan (di `auth.db`, container web), dicetak ke log container web **tiap boot selama akun belum ada** (token lama mati). Dimasukkan lewat kolom isian (bukan parameter URL, supaya tidak masuk log akses atau riwayat browser). Pembatasan 5 percobaan/menit/IP dan 30/jam global; perbandingan konstan-waktu; mati permanen setelah akun jadi.
- **Sesi setup** adalah principal terbatas (`X-Principal: setup` ke worker): hanya `getStatus`, `connect`, `logout` (batalkan tautan bila salah nomor), aliran SSE status/QR, dan pengiriman OTP verifikasi nomor lewat `/api/setup/owner-otp/*`. Method lain `FORBIDDEN`, ditegakkan di web **dan** di worker. Kedaluwarsa 30 menit tanpa aktivitas. **Hanya satu sesi setup aktif pada satu waktu.**
- **Finalisasi atomik:** pembuatan akun memakai compare-and-set "belum ada akun", sehingga dua tab tidak dapat membuat dua akun.
- **Langkah dapat dilanjutkan:** progres diturunkan dari kondisi nyata (nomor pemilik terdaftar? WA terhubung? nomor terverifikasi? akun ada? TOTP aktif?). Menutup browser cukup dilanjutkan dengan memasukkan token lagi. Akun baru dianggap **belum aktif** sampai TOTP terdaftar dan kode pemulihan dikonfirmasi tersimpan.
- Urutan langkah username/password dan TOTP tidak memengaruhi arsitektur dan dapat diatur UI/UX.

### 3.2 Login harian
1. `POST /api/auth/login {username, password}`: pembanding konstan-waktu (hash tiruan bila username tidak ada). Salah → galat seragam + pembatasan.
2. Password benar → buat `pending_login` (5 menit) dan minta kode TOTP. **Belum ada sesi.**
3. `POST /api/auth/totp/verify {code}`: benar dan langkah waktunya lebih baru dari yang terakhir dipakai → buat sesi baru (dirotasi), catat audit. Salah → hitung percobaan.
4. Alternatif TOTP: `POST /api/auth/recovery {code}` (memakai satu kode pemulihan; peringatan bila ≤3 tersisa, dan wajib mendaftarkan ulang TOTP setelah masuk).

WA tidak dibutuhkan sama sekali.

### 3.3 Lupa password
1. `POST /api/auth/forgot {username}` → respons selalu seragam ("Jika data cocok dan WhatsApp terhubung, kode dikirim ke nomor ••••1234").
2. `POST /api/auth/forgot/verify {code | recoveryCode}` → token reset sekali pakai (cookie, 10 menit).
3. `POST /api/auth/forgot/reset {newPassword}` →
   - password diganti (Argon2id, ≥12 karakter),
   - **semua sesi dicabut**,
   - pemberitahuan ke nomor pemilik ("password diubah pada …, jika bukan Anda …"),
   - catatan audit.
4. **Tidak ada login otomatis** dan **TOTP tidak disentuh**: pemilik masuk lewat §3.2 dan tetap perlu TOTP (atau kode pemulihan).

Kode pemulihan tidak diganti saat reset: ia adalah cadangan faktor kedua dan tidak ikut berubah bersama password.

### 3.4 WA atau TOTP hilang

| Keadaan | Login harian | Lupa password | Jalan keluar |
|---|---|---|---|
| WA mati, TOTP ada | ✓ normal | OTP tidak bisa dikirim → pakai **kode pemulihan** | Hubungkan ulang WA setelah masuk |
| TOTP hilang, WA hidup | **kode pemulihan** menggantikan TOTP | OTP WA berfungsi, tetapi tidak melepas TOTP | Setelah masuk dengan kode pemulihan, daftarkan TOTP baru |
| TOTP hilang dan kode pemulihan habis | ✗ | OTP WA hanya mengganti password | **Perintah server** `reset-totp` (rancangan: OTP WA saja sengaja tidak cukup) |
| Semuanya hilang | ✗ | ✗ | Perintah server `reset-owner` |

**Catatan:** kode pemulihan adalah **kredensial cadangan utama**. Pemegangnya dapat mereset password dan masuk tanpa TOTP (masing-masing memakai satu kode). Simpan seperti password.

**Perintah di server** (akar kepercayaan: akses shell ke mesin Docker), terhadap `auth.db`, lewat `docker compose exec app …`; semuanya tercatat di audit dengan penanda `via=server`:
- `reset-password`: set password baru, cabut semua sesi.
- `reset-totp`: hapus pendaftaran TOTP; pemilik wajib mendaftarkan ulang saat login berikutnya (setelah password benar).
- `reset-owner`: hapus kredensial pemilik, TOTP, dan kode pemulihan; sesi WA dan data bot **tidak disentuh**; token setup baru dicetak dan wizard dibuka dari langkah nomor pemilik. `bot_enabled` tidak berubah, jadi bot tetap melayani pelanggan.

### 3.5 Perubahan sensitif (verifikasi ulang)
| Aksi | Syarat |
|---|---|
| Ganti password | Password lama + TOTP |
| Ganti nomor pemilik | Password + TOTP, lalu OTP WA ke **nomor baru** (wajib berbeda dari nomor bot dan nomor lama); pemberitahuan ke nomor lama |
| Buat ulang kode pemulihan / daftarkan ulang TOTP | Password + TOTP (kode lama mati) |
| Ganti API key, kelola kunci Google, hubungkan/putuskan WA, hapus data pelanggan, nyalakan/matikan bot | Password (berlaku 10 menit) |
| Hubungkan ulang WA dengan nomor lain | Ditolak bila nomor baru sama dengan nomor pemilik; password diminta |

Dengan TOTP sebagai faktor verifikasi ulang, aksi sensitif tidak bergantung pada WA.

---

## 4. Spesifikasi

### 4.1 OTP WhatsApp (hanya untuk: `setup`, `reset`, `change_phone`)

| Aspek | Nilai |
|---|---|
| Panjang dan sumber | 6 digit, `crypto.randomInt` (CSPRNG) |
| Penyimpanan | Hanya `HMAC-SHA256(kunci turunan, tujuan ‖ id-tantangan ‖ kode)`; kunci diturunkan dari rahasia aplikasi (HKDF). Hash polos tidak cukup: kode 6 digit mudah ditebak offline bila hash bocor |
| Tujuan terikat | Kode untuk satu tujuan tidak berlaku untuk tujuan lain |
| Masa berlaku | 5 menit; sekali pakai; kode baru menggugurkan kode lama untuk tujuan yang sama |
| Percobaan | 5 per kode; habis → kode mati |
| Kirim | Jeda 60 detik; 3 per 15 menit per akun; 10 per hari per tujuan; **10 per jam global**; tambahan batas per IP |
| Batas di `systemSend` (lapis kedua, tidak bergantung pada kode web) | Total pesan sistem ≤10 per jam dan ≤40 per hari |
| Penangguhan | 15 verifikasi OTP gagal dalam 24 jam → OTP ditangguhkan 1 jam; kode pemulihan dan perintah server tidak tunduk pada penangguhan |
| Perbandingan | Konstan-waktu |

**Peluang tebak** (angka usulan): paling banyak 5 percobaan × 10 kode per hari = 50 tebakan dari 1.000.000, sekitar 0,005% per hari. Dan OTP yang tertebak hanya memungkinkan mengganti password, bukan masuk (TOTP tetap diminta).

**Teks pesan** (menyebut tujuan agar pemilik mengenali permintaan yang bukan darinya; tanpa tautan):
- Setup: `AutoBot — kode verifikasi nomor pemilik: 482913. Berlaku 5 menit.`
- Reset: `AutoBot — kode RESET PASSWORD: 482913. Berlaku 5 menit. Jika bukan Anda yang meminta, abaikan dan periksa keamanan akun.`
- Ganti nomor: `AutoBot — kode verifikasi nomor baru: 482913. Berlaku 5 menit.`
- Pemberitahuan reset: `AutoBot — password akun "<username>" diubah pada <waktu>. Jika bukan Anda, jalankan reset-owner di server.`
- Pemberitahuan ganti nomor (ke nomor lama): `AutoBot — nomor pemilik diganti ke ••••<4 digit> pada <waktu>. Jika bukan Anda, jalankan reset-owner di server.`

### 4.2 TOTP
- RFC 6238: HMAC-SHA1, 6 digit, langkah 30 detik, menerima ±1 langkah. Rahasia 160 bit acak; `otpauth://` dan kode QR ditampilkan **sekali** saat pendaftaran; aktif hanya setelah satu kode valid dimasukkan.
- Rahasia **dienkripsi** dengan kunci aplikasi (harus dapat dipulihkan untuk verifikasi, jadi tidak di-hash).
- **Anti-pemakaian-ulang:** simpan langkah waktu terakhir yang berhasil dan tolak langkah yang sama atau lebih lama.
- **Pembatasan:** setelah 5 kegagalan berturut-turut, jeda naik berlipat (1 menit hingga 1 jam), per akun dan per IP; tanpa penguncian permanen.
- Cek jam: `/healthz` melaporkan selisih jam terhadap sumber waktu; NTP aktif pada mesin.

### 4.3 Kode pemulihan
- 10 kode, masing-masing 10 karakter acak (±50 bit), hanya HMAC-nya disimpan, sekali pakai, tampil **sekali** (wajib dicentang "sudah disimpan"). Dapat dibuat ulang (verifikasi ulang), kode lama mati. Menggantikan TOTP saat login dan menggantikan OTP WA saat lupa password. Penanda hitung sisa; peringatan di ≤3.

### 4.4 Password
- ≥12 karakter, tanpa aturan komposisi, tolak kata sandi umum (daftar lokal). Hash **Argon2id** (OWASP: minimal 19 MiB, t=2, p=1). Hash berjalan di container web (terpisah dari Baileys). Scrypt N=2^17 (≈128 MiB per hash, `scryptSync` memblokir event loop) lebih berat; scrypt hanya dipakai bila spike menunjukkan masalah dengan Argon2id. Batasi konkurensi hashing.

---

## 5. Sesi

| Parameter | Rancangan |
|---|---|
| Cookie | `__Host-` + `HttpOnly` + `Secure` + `SameSite=Lax`, nilai acak buram, disimpan sisi server |
| Idle | **30 menit** |
| Absolut | **12 jam** (dapat diatur pemilik sampai 7 hari) |
| Rotasi | Saat login dan saat ganti password |
| Pencabutan | Semua sesi saat reset/ganti password; halaman "perangkat aktif" untuk mencabut satu per satu |
| "Ingat perangkat" | Tidak ada di v1 (menambah token berumur panjang yang melewati faktor kedua) |
| Lainnya | Cek `Origin`/`Host` pada rute pengubah data; tanpa CORS; CSP nonce lewat `proxy.ts`; galat seragam; audit log |

Catatan: pada deploy lokal, browser menerima cookie `Secure` di `http://localhost` tetapi tidak lewat `http://IP-LAN`; flag `Secure` **tidak dimatikan** (diuji di spike, termasuk Safari).

---

## 6. Komponen dan kontrak

### 6.1 Principal dan peran
`setup` (sementara, §3.1) dan `owner`. Tabel method → peran ada di `contracts`; method tanpa entri **ditolak**. Satu akun, tidak ada `agent`.

### 6.2 `POST /internal/system-send` (jalur kirim sistem di worker)
```
POST {WORKER_URL}/internal/system-send        Authorization: Bearer <WORKER_TOKEN>
{ "to": "<digit E.164, tanpa plus>", "text": "...", "purpose": "otp" | "notice" }
  → { "ok": true }
  | { "ok": false, "code": "WA_DISCONNECTED" | "INVALID_NUMBER" | "NOT_ON_WHATSAPP" | "SAME_AS_BOT" | "RATE_LIMITED" }
```
- **Bukan bagian dari tabel `/rpc` dan tidak pernah diteruskan dari browser.** Dipanggil hanya oleh `OtpService` di container web (setelah sesi atau sesi setup diperiksa) lewat jaringan internal.
- **Menolak `to` yang sama dengan nomor bot** (`SAME_AS_BOT`): OTP tidak pernah dikirim ke nomor sendiri.
- **Tidak mencatat apa pun:** tidak ke `messages`/feed (halaman Pesan), `turns`, `message_log`, memori; tidak memicu notifikasi. Hanya `purpose`, nomor tersamar, dan hasil yang boleh masuk log. Penyamaran log diperluas ke bidang `otp`, `code`, `text`.
- **Gema pesan:** `ReplyPipeline.handleOwn` menganggap pesan dari akun sendiri yang tidak dikenal sebagai "manusia mengambil alih" (menjeda bot dan menulis teks ke riwayat). Jalur sistem memakai pelacak pesan-keluar-yang-sedang-dikirim (`inflight` + `rememberSentId`) yang sama **tanpa** langkah pencatatan, sehingga gema pesan OTP tidak dianggap manusia. (Pada rencana SE: `sendBroadcast` diubah nama menjadi `sendSystem`, bukan dihapus.)
- **Balasan dari nomor pemilik:** pesan masuk dari nomor pemilik diperlakukan sebagai pelanggan biasa di v1 (bot tetap mati sampai dinyalakan; setelah itu menjawab seperti pelanggan lain).
- **Batas total** (§4.1) ditegakkan di worker, tidak bergantung pada kode web.
- Memeriksa nomor dengan `onWhatsApp` (sudah ada di gateway) sebelum OTP verifikasi nomor.

### 6.3 Endpoint tanpa sesi (seluruhnya)
`/api/auth/*` (login, TOTP, pemulihan, lupa password) · `/api/setup/*` (hanya dengan token setup; 404 setelah akun ada) · `GET /api/public/auth-status` (hanya `setupComplete`, `waConnected`) · `GET /healthz`. Selain itu semua rute butuh sesi.

### 6.4 Saklar bot
`bot_enabled` di `autobot.db` (`instance_meta`), **mati** secara bawaan; hanya `owner` yang dapat mengubahnya (Dashboard, dengan daftar periksa "dokumen pengetahuan: 0"). Saat mati, pipeline mengabaikan pesan masuk **sebelum** mengklaimnya di `message_log` dan tanpa notifikasi. `reset-owner` tidak mengubahnya.

### 6.5 Model data (usulan)
```
-- auth.db
otp_challenge(id PK, purpose, phone, code_hmac, expires_at, attempts, max_attempts DEFAULT 5,
              consumed_at NULL, created_at, ip_hash)         -- pembatasan dihitung dari baris ini
pending_login(id PK, user_id, expires_at)                    -- password benar, menunggu TOTP
totp(user_id PK, secret_enc, enrolled_at, last_step)
recovery_code(id PK, user_id, code_hmac, used_at NULL, created_at)
owner_phone(user_id PK, phone UNIQUE, verified_at)       -- harus berbeda dari nomor bot
setup(k PK, v)                                               -- HMAC token setup, waktu mulai
audit_log(id PK, at, actor, action, detail_json, via)        -- via = 'web' | 'server'
-- + tabel pengguna/sesi dari library login (§8)
-- autobot.db
instance_meta(k PK, v)                                       -- bot_enabled
```

---

## 7. Risiko tersisa

| Risiko | Penilaian | Catatan |
|---|---|---|
| Pemegang nomor WA pemilik mereset password | Dapat terjadi, dampak terbatas: tidak bisa masuk tanpa TOTP/kode pemulihan | Pemberitahuan WA + pencabutan sesi |
| Pemegang kode pemulihan mengambil alih | Sama dengan pemegang password+TOTP | Simpan kode seperti password |
| OTP bisa dibujuk keluar secara real-time (phishing) | Sama dengan OTP SMS; dampak terbatas (hanya reset password) karena TOTP tetap diminta | Passkey sebagai penguat di fase berikutnya |
| **Pesan sistem dari nomor bot ke nomor pemilik yang belum pernah mengobrol dengannya** | Volume sangat kecil dan berbatas; risiko dianggap spam rendah, tidak nol; diuji di spike | Wizard menyarankan pemilik mengirim satu pesan ke nomor bot lebih dulu; cadangan: OTP dikirim sebagai balasan atas pesan pertama pemilik |
| Pemilik kehilangan TOTP dan semua kode pemulihan | Terkunci dari login | `reset-totp` di server (disengaja: OTP WA saja tidak cukup) |
| Rahasia TOTP dienkripsi dengan kunci yang satu mesin dengan data | Pencurian volume + kunci membuka TOTP | `APP_SECRET_KEY` di luar volume; diperkuat saat publik |
| Pemegang akses shell ke mesin melakukan apa saja | Diterima: itu akar kepercayaan | |
| Notifikasi "login dari perangkat baru" lewat WA | **Opsional (P1)**; belum dibuat | Deteksi pencurian kredensial; memakai jatah pesan sistem |

---

## 8. Implementasi: library atau buatan sendiri

Spesifikasi di §3–§6 adalah **kontrak**; library hanya boleh dipakai bila memenuhinya.

**Pembagian:** library login (bila lolos) untuk username + password, sesi, dan TOTP + kode cadangan; **`OtpService` buatan sendiri** (±200 baris, dites ketat) untuk OTP WA, karena batas kirim, pengikatan tujuan, penyimpanan HMAC, dan `systemSend` bersifat khusus aplikasi ini. Dengan TOTP sebagai faktor login, ketidakpastian soal plugin OTP library tidak lagi menghalangi.

**Terverifikasi di dokumentasi Better Auth:** adapter SQLite `better-sqlite3`; `disableSignUp`, `minPasswordLength`, hook hash password kustom; opsi sesi `expiresIn` (bawaan 7 hari) dan `updateAge` (bawaan 1 hari); rate limit dengan penyimpanan database; plugin `twoFactor` ada (`otpOptions.sendOTP` kustom terverifikasi).

**Belum diverifikasi (diuji di spike):** login dengan **username** (plugin atau pemetaan ke email sintetis `username@autobot.invalid`); plugin 2FA untuk **TOTP + kode cadangan** dan perilakunya (penyimpanan rahasia, anti-pemakaian-ulang langkah); **idle 30 menit + absolut 12 jam** (opsi `expiresIn`/`updateAge` bersifat geser; batas absolut kemungkinan butuh pemeriksaan tambahan); hook Argon2id; rate limit di database; kunci instans.

**Jalur cadangan:** lapisan sesi buatan sendiri (Argon2id + tabel sesi + TOTP RFC 6238 dengan pustaka kecil yang sudah teruji atau implementasi ±40 baris di atas `crypto`). Kerugian: lebih banyak kode keamanan milik sendiri; keuntungan: satu berkas DB dan satu sistem migrasi.

**Daftar uji spike khusus fitur ini**
1. Bot mengirim OTP ke **nomor lain** yang belum pernah mengobrol dengan nomor bot: terkirim, latensi, tidak ditolak, tidak berbunyi sebagai spam di ponsel penerima.
2. Bila butir 1 bermasalah: uji cadangan "pemilik mengirim pesan pertama ke nomor bot, OTP dikirim sebagai balasan".
3. `onWhatsApp` untuk nomor pemilik (salah ketik tertangkap) dan penolakan nomor yang sama dengan nomor bot.
4. Pesan sistem tidak muncul di Pesan, `turns`, memori, `message_log`, dan tidak menjeda bot (termasuk gema pesan keluar).
5. SSE QR/status dua hop (worker → web → browser) berjalan dan tanpa buffering.
6. Konfigurasi library login memenuhi §3–§5 (butir "belum diverifikasi" di atas); Argon2 berjalan di image web.
7. TOTP: jam melenceng, langkah waktu dipakai ulang, jendela ±1.

---

## 9. Kriteria penerimaan (kasus uji prioritas)

1. Sebelum akun ada, semua rute selain `/api/setup/*`, `/api/auth/*`, `auth-status`, dan `/healthz` menolak akses; `/api/setup/*` menolak tanpa token yang benar; token salah dibatasi lajunya.
2. Setelah akun dibuat: `/api/setup/*` mengembalikan 404 dan token lama tidak berlaku; setelah restart tidak ada token baru dicetak.
3. Dua tab setup bersamaan: hanya satu yang berhasil membuat akun.
4. Sesi setup hanya dapat memanggil method yang diizinkan §3.1.
5. Sebelum pemilik menyalakan `bot_enabled`: pesan pelanggan tidak dibalas, tidak diklaim di `message_log`, tidak memicu notifikasi.
6. Login: password salah dan username tidak ada memberi galat dan waktu respons yang sama; password benar tanpa TOTP tidak menghasilkan sesi; TOTP bekas/langkah lama ditolak.
7. OTP WA: kedaluwarsa 5 menit, sekali pakai, tidak berlaku lintas tujuan, 5 percobaan; kirim keempat dalam 15 menit ditolak dan **tidak ada pesan keempat** di WA; batas global dan batas di `systemSend` berlaku walau kode web melewatinya.
8. Teks OTP tidak ditemukan di tabel `messages`, `turns`, `message_log`, `contact_memory`, di log, maupun di respons API.
9. Pesan OTP ke nomor pemilik tidak menjeda bot dan gema pesan keluarnya tidak memicu "manusia mengambil alih"; tidak ada balasan otomatis terhadap pesan OTP.
10. WA terputus: login password + TOTP berhasil; lupa password mengarahkan ke kode pemulihan.
11. Lupa password: respons seragam; reset mencabut semua sesi, mengirim pemberitahuan, mencatat audit, **tidak** membuat sesi, dan **tidak** melepas TOTP (login berikutnya tetap meminta TOTP).
12. Kode pemulihan: tampil sekali; satu kode hanya berlaku sekali; peringatan saat ≤3 tersisa; kode lama mati setelah dibuat ulang.
13. `reset-password`, `reset-totp`, dan `reset-owner` berjalan di server, tercatat audit (`via=server`), dan `reset-owner` tidak memutus WA maupun mengubah `bot_enabled`.
14. Ganti nomor pemilik memerlukan password + TOTP dan OTP ke nomor baru; pemberitahuan terkirim ke nomor lama.
15. Method baru tanpa entri peran ditolak; route tanpa sesi ditolak kecuali yang dikecualikan.
16. Kunci Google, API key, rahasia TOTP tidak muncul di respons API, log, event, atau bundle klien.
17. Restart container web saat pemilik login: sesi WA tetap tersambung; sesi panel mengikuti aturan idle/absolut. Restart worker: WA tersambung kembali tanpa pindai ulang.
18. Nomor pemilik yang sama dengan nomor bot ditolak di setup, saat ganti nomor, dan saat hubungkan ulang WA; `system-send` mengembalikan `SAME_AS_BOT`.
19. Simulasi kompromi container web: web tidak dapat membaca `sessions/`, API key, atau kunci Google (tidak ada volume maupun kunci; tidak ada method RPC yang mengembalikannya); permintaan ke worker tanpa `WORKER_TOKEN` ditolak; container web tidak dapat membuka koneksi keluar ke internet.

## 10. Estimasi, terbuka, belum diverifikasi, sumber
- **Estimasi:** setup + login TOTP + OTP WA + kode pemulihan + CLI + audit ≈ 9 hari kerja di Fase 2 (rencana utama §11), perkiraan kasar yang dikunci setelah Fase 0.
- **Masih terbuka (tidak memblokir):** notifikasi "login perangkat baru" (P1); passkey (fase berikutnya); apakah pemilik ingin penerima OTP selalu nomor bot (lebih sederhana, lebih sulit dijangkau pemilik).
- **Belum diverifikasi:** semua butir "belum diverifikasi" di §8, perilaku pesan ke nomor yang belum pernah mengobrol (spike); angka peluang tebak adalah hitungan usulan, bukan hasil uji.
- **Sumber:** Better Auth: [adapter SQLite](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/adapters/sqlite.mdx), [opsi sesi, rate limit, email+password](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/reference/options.mdx), [plugin 2FA](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/2fa.mdx), [plugin nomor telepon](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/phone-number.mdx); [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html); [Next.js `proxy`](https://nextjs.org/docs/messages/middleware-to-proxy).
