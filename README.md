# AutoBot — Balas WA Otomatis pakai AI

Panel web (Next.js) dan worker bot WhatsApp (Baileys), dijalankan terpisah. Satu pemilik, login password + authenticator (TOTP).
Panduan operasi lengkap: [`docs/nextjs-refactor/operations.md`](docs/nextjs-refactor/operations.md). Rancangan: [`docs/nextjs-refactor/architecture-plan.md`](docs/nextjs-refactor/architecture-plan.md).

```
apps/web        panel: login, wizard setup, UI (tidak memegang sesi WhatsApp, API key, atau kunci Google)
apps/worker     bot: WhatsApp, pipeline, pengetahuan, sinkron Google Sheets, semua rahasia bot
packages/contracts   kontrak bersama (nama RPC, skema, tipe)
deploy/         Dockerfile, docker-compose, Caddy, skrip init/backup/restore/reset, uji end-to-end
```

## Jalankan lokal (tanpa Docker, untuk pengembangan)

Butuh Node 22.

```bash
npm install
npm run dev
```

Buka http://localhost:3000. **Token setup** tercetak di terminal (kotak "Token setup"); salin ke langkah pertama wizard.
Data dan rahasia lokal ada di `.local-data/` (tidak masuk git). Hapus folder itu untuk mengulang dari nol.

## Jalankan dengan Docker (tiga layanan: web, worker, Caddy)

```bash
npm run docker:init     # sekali: membuat tiga rahasia di deploy/secrets/ (jangan dihapus, jangan di-commit)
npm run docker:up       # membangun image dan menjalankan
npm run docker:logs     # token setup ada di log web
```

Buka http://localhost:3000 (hanya terjangkau dari komputer ini). Port lain: `CADDY_HTTP_PORT=3100 npm run docker:up`.
Berhenti: `npm run docker:down` (data tetap di volume).

Wizard setup: token setup → nomor pemilik (harus **berbeda** dari nomor bot) → pindai QR nomor bot → kode OTP WhatsApp ke nomor pemilik → username dan password → authenticator (TOTP) dan 10 kode pemulihan.
Nomor WhatsApp dimasukkan sendiri di formulir; jangan ditulis di berkas, commit, atau chat.

## Lupa username atau authenticator

Lupa password cukup lewat "Lupa password?" di halaman login. Untuk lupa username, atau authenticator dan kode pemulihan hilang:
`npm run reset-account` (lokal, hentikan `npm run dev` dulu) atau `npm run docker:reset-account` (Docker).
Hanya akun yang dihapus; sesi WhatsApp, pengetahuan, dan pengaturan tetap. Lalu jalankan wizard setup lagi dengan token baru.

## Tes

```bash
npm run typecheck
npm test                    # vitest: web + worker
bash deploy/test/run.sh     # end-to-end Docker: wizard, login, sesi, SSE lewat Caddy (worker tiruan, tanpa WhatsApp)
```

## Untuk publik (saat deploy)

Lihat bagian "Deploy publik" di operations.md. Panel publik hanya boleh dibuka setelah semua butir gerbang di
[`docs/nextjs-refactor/release-gate-evidence.md`](docs/nextjs-refactor/release-gate-evidence.md) lulus.
