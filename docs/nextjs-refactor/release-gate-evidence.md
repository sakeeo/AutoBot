# Bukti gerbang "siap publik" (10 butir) — M8

Tanggal: 2026-11-20. Penguji: Software Engineering. Mesin: pengembangan lokal (Linux, Docker 29.1.3, Compose 2.40.3). Daftar butir: `release-gate-checklist.md` (QA).
Status: **LULUS**, **SEBAGIAN**, **GAGAL**, atau **BELUM TERUJI**. Tanpa bukti = belum lulus. Belum ada butir yang diuji di VPS atau dengan domain.

| # | Butir | Status | Bukti |
|---|---|---|---|
| 1a | Hanya Caddy publik, HTTPS, HSTS | **BELUM TERUJI** | Lokal hanya HTTP di 127.0.0.1. `deploy/Caddyfile` (publik: HSTS, header, SSE) belum dijalankan; butuh domain dan VPS. Aplikasi menambah HSTS sendiri saat `APP_URL` https (kode di `apps/web/src/proxy.ts`, tidak diuji lewat HTTPS). |
| 1b | Worker tanpa port terbit | **LULUS** | `docker compose ps`: web dan worker hanya `3000/tcp`, `4000/tcp` (EXPOSE, tanpa pengikatan ke host). Hanya Caddy: `127.0.0.1:3100->80`. |
| 1c | Web tanpa internet | **LULUS** | Dari container web, `fetch('https://example.com')` gagal `EAI_AGAIN`. Dari container worker: 200. Caddy tidak bisa menjangkau worker (`wget http://worker:4000` gagal). |
| 2 | Volume dan kunci terpisah | **LULUS** | Web: secret `auth_secret_key`, `worker_token`; env tanpa `ENGINE_SECRET`; volume hanya `authdata`. Worker: secret `engine_secret_key`, `worker_token`; env tanpa `AUTH_SECRET`; volume hanya `data`. |
| 3 | `WORKER_TOKEN` ≥ 32 byte; tanpa token ditolak | **LULUS** | Token 64 karakter heksadesimal (32 byte). Dari web ke worker: tanpa token 401, token salah 401, token benar 200. Token tidak ditemukan di `.next` (bundle), log semua container, atau respons `/login`, `/setup`, `/api/health`, `/api/public/auth-status`. |
| 4 | Setup selesai, token mati, TOTP aktif, kode pemulihan | **LULUS** (dengan worker tiruan) | `deploy/test/run.sh`, 37/37: setelah wizard, `/api/setup/state`, `/token`, `/owner-phone` menjawab 404; login butuh TOTP (RPC sebelum TOTP: 401); 10 kode pemulihan diberikan; selesai ditolak bila kode pemulihan belum dikonfirmasi disimpan. Wizard dengan WhatsApp sungguhan dijalankan pemilik di instance `npm run dev` (OTP terkirim dan terverifikasi), bukan di Docker. |
| 5 | Cookie `__Host-`, CSP nonce, header | **SEBAGIAN** | Lulus: CSP dengan nonce, tanpa `unsafe-inline`/`unsafe-eval` untuk skrip dan `<style>`; 14 `<script>` semuanya bernonce, 0 `<style>` inline; `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`; cookie sesi `HttpOnly; SameSite=Lax`. **Belum teruji:** awalan `__Host-` dan `Secure` (hanya aktif di HTTPS); Safari. Catatan: `style-src-attr 'unsafe-inline'` sengaja dibuka untuk atribut `style=""` React. |
| 6 | Rate limit login/OTP/token setup | **SEBAGIAN** | Login: 12 percobaan salah → 429 (e2e Docker). OTP dan tebakan token setup: tes unit (`apps/web/tests`, "limits guesses to 5 a minute per address and 30 an hour overall", "enforces the send limits on the wizard too: 60-second pause", "limits how often a code can be requested from one address"). Belum dijalankan lewat Docker. |
| 7 | Backup terenkripsi + latihan pulih | **LULUS** (di Docker lokal) | 2026-11-25: `backup.sh` dengan `AGE_RECIPIENT` menghasilkan `.tar.age` (age 1.x dipasang lewat `go install`); isinya hanya `web/auth.db`, `worker/autobot.db`, `worker/knowledge/`. Berkas uji dihapus dari volume lalu `restore.sh` dengan kunci yang benar memulihkannya; kunci yang salah ditolak sebelum data diganti. **Belum diuji:** restore di mesin bersih lain dan data berisi sesi WhatsApp sungguhan. |
| 8 | NTP sinkron, jam hijau | **LULUS** | `timedatectl`: `NTPSynchronized=yes`. `/api/health` kini memuat `worker.clock` (`status` ok/warn/bad/unknown, `skewMs`), diukur worker dari header `Date` HTTPS (`apps/worker/src/clock-monitor.ts`, tiap 6 jam, peringatan di log bila ≥10 dtk). Diuji di stack Docker: `status: ok, skewMs: 106`. Tes unit: `clock-monitor.test.ts`. |
| 9 | Tes keamanan | **SEBAGIAN** | `xlsx` (kerentanan high, tanpa perbaikan) sudah **dihapus**: `.xlsx` dibaca dengan `read-excel-file`, `.csv` dengan parser sendiri (`apps/worker/src/knowledge/tabular.ts`). `npm audit --omit=dev`: **0 kerentanan**. Lulus juga: pemindaian rahasia (butir 3); otorisasi RPC per peran, CSRF/Origin, sesi, OTP tidak ada di pesan keluar. **Belum diuji:** Trivy, skenario T-ROUTE dari QA. |
| 10 | Reputasi IP/nomor WA | **BELUM TERUJI** | Butuh pilot dari IP VPS dan nomor ketiga (OTP ke nomor yang belum pernah mengobrol). Tidak ada tanda pemblokiran pada pengujian lokal. |

## Ringkasan

- Lulus: 1b, 1c, 2, 3, 4, 7, 8. Sebagian: 5, 6, 9. Belum teruji: 1a, 10.
- **Belum boleh dibuka ke publik.** Sisa hambatan butuh VPS, domain, dan HTTPS (1a, 5, 10), ditambah Trivy dan skenario T-ROUTE (9).

## Perintah yang dipakai (ulangi untuk memverifikasi)

```bash
cd deploy && CADDY_HTTP_PORT=3100 APP_URL=http://localhost:3100 docker compose up -d
docker compose ps --format '{{.Service}}: {{.Ports}}'                                   # 1b
docker compose exec -T web node -e "fetch('https://example.com').catch(e=>console.log('blocked'))"   # 1c
docker compose exec -T web ls /run/secrets; docker inspect <web> --format '{{range .Mounts}}{{.Name}} {{end}}'  # 2
docker compose exec -T web sh -c "grep -rl $(cat secrets/worker_token) /app/apps/web/.next | wc -l"     # 3 (0)
bash test/run.sh                                                                         # 4, 5, 6 (login)
npm audit --omit=dev                                                                     # 9
timedatectl show -p NTPSynchronized                                                      # 8
```
