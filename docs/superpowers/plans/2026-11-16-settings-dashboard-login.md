# Pengaturan, Dashboard, dan Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kelompokkan pengaturan di menu Pengaturan, tambah Dashboard, dan tambah login opsional dengan username/password.

**Architecture:** Logika baru berupa modul main yang murni dan dapat diuji di Node (`auth-store`, `auth-ipc`, `stats`), dibungkus handler Electron tipis di `ipc.ts`. Renderer mendapat konfigurasi navigasi tunggal, halaman Dashboard, layar kunci, dan halaman Keamanan. Gerbang kunci ada di proses utama.

**Tech Stack:** Electron, React 18, Bootstrap 5, TypeScript, zod, vitest (+ testing-library/jsdom), `node:crypto` scrypt.

**Spec:** `docs/superpowers/specs/2026-11-16-settings-dashboard-login-design.md`

## Global Constraints

- Branch kerja baru dari `feat/conversion-agent`: `feat/settings-nav-auth`. Jangan merge ke branch lain.
- Teks UI bahasa Indonesia; komponen Bootstrap 5 yang sudah dibundel (bukan CDN).
- Tes berjalan di Node biasa; modul yang diuji tidak boleh mengimpor `electron`. Jalankan `npm run rebuild:node` bila tes DB gagal karena ABI.
- Tidak ada channel IPC yang mengembalikan hash, salt, atau kode pemulihan tersimpan. Kode pemulihan hanya dikembalikan sekali oleh `setup` dan `reset`.
- Semua tes lama (337) harus tetap hijau; `npm run typecheck` bersih.
- Commit memakai penutup: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Password kosong, terlalu pendek (<8), atau berisi spasi/unicode: ditolak/diterima konsisten, tidak crash.
- Brute force: 5 gagal beruntun mengunci percobaan 30 detik, juga untuk `reset` dengan kode salah.
- File `auth.json` rusak atau terpotong: dianggap login nonaktif agar pengguna tidak terkunci permanen dari aplikasinya sendiri (kode pemulihan tidak bisa dipakai tanpa berkas). Biaya bila salah: login hilang diam-diam. Catat sebagai ruling di ledger dan tulis peringatan di log.
- Saat terkunci, panggilan IPC data (log, brand, settings, kunci API) ditolak, sedangkan bot tetap membalas.
- Dashboard pada basis data kosong, dan batas hari (tengah malam waktu lokal) tidak menghitung ganda.
- Navigasi: halaman aktif di dalam grup Pengaturan tetap terbuka setelah render ulang.

## File Structure

- Create `src/main/auth/auth-store.ts` — kredensial, scrypt, throttle, kunci otomatis.
- Create `src/main/auth/auth-ipc.ts` — `createAuthHandlers`, `guardHandler`.
- Create `src/main/stats.ts` — `buildDashboard`.
- Modify `src/shared/channels.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/index.ts`.
- Create `src/renderer/nav.tsx`, `pages/DashboardPage.tsx`, `pages/ConnectorPage.tsx`, `pages/SecurityPage.tsx`, `LockScreen.tsx`.
- Move `pages/RulesPage.tsx` → `brand/ReplyBehaviorTab.tsx` (tanpa autostart); modify `pages/BrandPage.tsx`, `App.tsx`, `i18n/id.ts`.
- Tests: `tests/auth-store.test.ts`, `tests/auth-ipc.test.ts`, `tests/stats.test.ts`, `tests/renderer/nav.test.tsx`, `tests/renderer/auth-ui.test.tsx`, `tests/renderer/dashboard.test.tsx`; ubah `tests/renderer/pages.test.tsx` untuk Rules yang pindah.

---

### Task 1: AuthStore

**Files:** Create `src/main/auth/auth-store.ts`; Test `tests/auth-store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MIN_PASSWORD = 8
  export class AuthStore {
    constructor(file: string, clock: { now(): number })
    isEnabled(): boolean
    username(): string | null
    autoLockMin(): number
    setup(username: string, password: string): { recoveryCode: string }   // throws Error('INVALID_INPUT') jika username kosong/ >40 atau password < MIN_PASSWORD; throws 'ALREADY_ENABLED'
    verify(username: string, password: string): 'ok' | 'bad' | 'throttled'
    changePassword(oldPassword: string, newPassword: string): 'ok' | 'bad' | 'throttled'
    reset(recoveryCode: string, newPassword: string): { recoveryCode: string } | 'bad' | 'throttled'
    disable(password: string): 'ok' | 'bad' | 'throttled'
    setAutoLockMin(min: number): void   // 0..240, bulat
  }
  ```

- [ ] **Step 1: Tulis tes gagal** (`tests/auth-store.test.ts`, file sementara di `mkdtempSync`): `setup` lalu `isEnabled()` true dan `verify` benar → `'ok'`, salah → `'bad'`; berkas `auth.json` tidak memuat password maupun kode pemulihan sebagai teks (`readFileSync(...)` tidak mengandung keduanya); username dibandingkan tanpa beda huruf besar-kecil, password sensitif; password 7 karakter → `INVALID_INPUT`; password dengan spasi dan "é" diterima; `setup` kedua → `ALREADY_ENABLED`; 5 `bad` beruntun → panggilan ke-6 (bahkan dengan password benar) `'throttled'`, dan `'ok'` lagi setelah `clock` maju 30 001 ms; `reset` dengan kode benar mengganti password dan mengembalikan kode baru, kode lama lalu `'bad'`; `reset` salah 5× → `'throttled'`; `changePassword` salah → `'bad'` dan password lama tetap berlaku; `disable` dengan password benar → `isEnabled()` false dan berkas dihapus; instance baru pada berkas yang sama mempertahankan status; berkas berisi `{not json` → `isEnabled()` false tanpa melempar.
- [ ] **Step 2:** `npx vitest run tests/auth-store.test.ts` — Expected: FAIL (modul belum ada).
- [ ] **Step 3: Implementasikan `AuthStore`** dengan `scrypt` (`N=16384`), salt 16 byte per rahasia, pembanding `timingSafeEqual`, kode pemulihan 16 byte acak ditampilkan dalam kelompok `XXXX-XXXX-XXXX-XXXX` (hex; normalisasi hapus tanda hubung dan huruf besar saat verifikasi). Throttle in-memory dihitung bersama untuk verify/changePassword/reset/disable: penghitung gagal beruntun, `blockedUntil = now+30000` pada gagal ke-5, penghitung direset saat sukses. Tulis berkas dengan mode `0o600`.
- [ ] **Step 4:** jalankan lagi — Expected: PASS.
- [ ] **Step 5: Commit** `feat(auth): credential store with scrypt, throttle and recovery code`.

---

### Task 2: Gerbang kunci dan IPC autentikasi

**Files:** Create `src/main/auth/auth-ipc.ts`; Modify `src/shared/channels.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/index.ts`; Test `tests/auth-ipc.test.ts`, `tests/ipc-schema.test.ts`

**Interfaces:**
- Consumes: `AuthStore` (Task 1).
- Produces:
  ```ts
  // shared/ipc.ts
  export const AuthSetupSchema = z.object({ username: z.string().trim().min(1).max(40), password: z.string().min(8).max(200) }).strict()
  export interface AuthState { enabled: boolean; locked: boolean; username: string | null; autoLockMin: number }
  export type AuthResult = { ok: true } | { ok: false; error: 'bad' | 'throttled' | 'invalid' }
  // Api tambahan:
  authState(): Promise<AuthState>
  authLogin(username: string, password: string): Promise<AuthResult>
  authLock(): Promise<void>
  authSetup(username: string, password: string): Promise<{ ok: true; recoveryCode: string } | { ok: false; error: 'invalid' }>
  authChangePassword(oldPassword: string, newPassword: string): Promise<AuthResult>
  authReset(recoveryCode: string, newPassword: string): Promise<AuthResult & { recoveryCode?: string }>
  authDisable(password: string): Promise<AuthResult>
  authSetAutoLock(min: number): Promise<void>
  // main/auth/auth-ipc.ts
  export function createAuthHandlers(auth: AuthStore): AuthHandlers & { isLocked(): boolean; lock(): void }
  export const AUTH_CHANNELS: ReadonlySet<string>
  export function guardHandler<A extends unknown[], R>(isLocked: () => boolean, allowed: boolean, fn: (...a: A) => R): (...a: A) => R   // melempar Error('LOCKED') bila terkunci dan !allowed
  ```
  Channel baru di `CHANNELS`: `authState, authLogin, authLock, authSetup, authChangePassword, authReset, authDisable, authSetAutoLock` (`auth:*`).

- [ ] **Step 1: Tes gagal** (`tests/auth-ipc.test.ts`): awalnya (login nonaktif) `isLocked()` false dan `authState().locked` false; setelah `authSetup` valid, `authState()` = enabled true, `locked` false (pengguna baru saja membuatnya), kode pemulihan dikembalikan sekali; instance `createAuthHandlers` baru pada berkas yang sama dimulai `locked: true`; `authLogin` salah → `{ok:false,error:'bad'}` dan tetap terkunci, benar → membuka; `authLock` mengunci; `authSetup` dengan password pendek → `{ok:false,error:'invalid'}`; `authDisable` benar → tidak terkunci lagi dan `enabled` false; `guardHandler(() => true, false, fn)` melempar `LOCKED` dan tidak memanggil `fn`, sedangkan `allowed=true` memanggilnya; `AUTH_CHANNELS` memuat setiap nilai channel `auth:*`. Di `tests/ipc-schema.test.ts` tambah: `AuthSetupSchema` menolak password 7 karakter dan properti tak dikenal.
- [ ] **Step 2:** jalankan — Expected: FAIL.
- [ ] **Step 3: Implementasikan** `createAuthHandlers` (status `locked` di dalam closure, awalnya `auth.isEnabled()`), skema zod, tipe `Api`, channel, preload. Di `ipc.ts` bungkus semua `ipcMain.handle` non-auth lewat fungsi lokal `handle(channel, fn)` yang memakai `guardHandler(auth.isLocked, AUTH_CHANNELS.has(channel), fn)`; daftarkan channel auth ke handler. Tambah `auth` ke `IpcDeps`. Di `index.ts`: buat `AuthStore(join(data,'auth.json'), clock)` dan `createAuthHandlers`, teruskan ke `registerIpc`; panggil `authHandlers.lock()` pada event `hide` jendela (bukan saat `close` ketika benar-benar keluar) bila login aktif. Bot (pipeline, gateway) tidak bergantung pada status kunci.
- [ ] **Step 4:** `npx vitest run tests/auth-ipc.test.ts tests/ipc-schema.test.ts && npm run typecheck` — Expected: PASS, tipe bersih.
- [ ] **Step 5: Commit** `feat(auth): main-process lock gate and auth IPC`.

---

### Task 3: Statistik Dashboard

**Files:** Create `src/main/stats.ts`; Modify `src/shared/ipc.ts`, `src/shared/channels.ts` (`getDashboard: 'dashboard:get'`), `src/preload/index.ts`, `src/main/ipc.ts`; Test `tests/stats.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DashboardPeriod { replied: number; refused: number; handoff: number; errors: number; links: number }
  export interface DashboardData {
    today: DashboardPeriod; week: DashboardPeriod; waitingAdmin: number
    recent: LogRow[]; files: { indexed: number; failed: number }
  }
  export function buildDashboard(db: Db, now: number): DashboardData   // main/stats.ts
  // Api: getDashboard(): Promise<DashboardData>
  ```
  "Hari ini" = sejak 00:00 waktu lokal mesin; "week" = 7×24 jam terakhir. Klasifikasi dari `message_log.decision` berdasarkan prefiks (`replied`, `out_of_context`, `handoff`, `error`; `ignored:*` dan `pending` tidak dihitung), `links` dari tabel `events` bertipe `checkout_sent`/`link_sent`, `waitingAdmin` dari `contacts` berstatus `menunggu_admin` dengan `paused_until > now`, `recent` = 5 baris `message_log` terbaru.

- [ ] **Step 1: Tes gagal** memakai `openDb(':memory:')` dan data sisipan: basis data kosong → semua nol, `recent` kosong; campuran keputusan (`replied:ai`, `replied:extractive`, `out_of_context:reply`, `handoff:x`, `error:y`, `ignored:cooldown`, `pending`) dihitung benar; pesan pukul 23:59 kemarin masuk `week` tetapi bukan `today` (gunakan `now` tetap dan TZ proses); event `checkout_sent` dan `link_sent` dijumlah ke `links`; kontak menunggu_admin dengan jeda kedaluwarsa tidak dihitung; `recent` berurutan terbaru-dulu dan maksimal 5.
- [ ] **Step 2:** `npx vitest run tests/stats.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementasikan `buildDashboard`** dengan kueri SQL teragregasi; sebelum menulis klasifikasi, baca nilai `decision` aktual di `src/main/pipeline/reply-pipeline.ts` (fungsi pelabel dekat baris 248) dan cocokkan prefiks dengannya. Hubungkan handler `getDashboard` (dengan gerbang) memakai `Date.now()`.
- [ ] **Step 4:** jalankan tes dan `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(dashboard): aggregate stats for the dashboard`.

---

### Task 4: Navigasi baru dan perpindahan halaman

**Files:** Create `src/renderer/nav.tsx`, `pages/ConnectorPage.tsx`, `brand/ReplyBehaviorTab.tsx`; Modify `src/renderer/App.tsx`, `pages/BrandPage.tsx`, `i18n/id.ts`; Delete `pages/RulesPage.tsx`; Test `tests/renderer/nav.test.tsx`, ubah `tests/renderer/pages.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // nav.tsx
  export type NavKey = 'dashboard'|'test'|'log'|'connector'|'knowledge'|'brand'|'security'
  export interface NavItem { key: NavKey; icon: string; label: string; view: JSX.Element }
  export const TOP_ITEMS_BEFORE: NavItem[]   // dashboard, test, log urutan: Dashboard, Uji Jawaban, Log
  export const SETTINGS_ITEMS: NavItem[]     // connector, knowledge, brand, security
  export function groupOf(key: NavKey): 'settings' | 'top'
  ```
  `ConnectorPage` = tab Bootstrap "WhatsApp" (`ConnectionPage`) dan "AI" (`AiSettings`). `ReplyBehaviorTab` = isi `RulesPage` tanpa saklar "Jalankan saat login" (pindah ke Task 5). Halaman awal: `dashboard`. `BrandPage` mendapat satu tab tambahan berlabel "Perilaku balasan" yang merender `ReplyBehaviorTab`; baca `BrandPage.tsx` dahulu dan ikuti pola tab yang ada.

- [ ] **Step 1: Tes gagal** (`tests/renderer/nav.test.tsx`, stub `window.api` seperti `pages.test.tsx`): `render(<App/>)` menampilkan Dashboard sebagai halaman awal; item "Pengaturan" ada dan submenunya (Connector, Pengetahuan, Brand & Konversi, Keamanan & Umum) tersembunyi sampai diklik; klik "Pengaturan" menampilkan keempat submenu; klik "Brand & Konversi" menampilkan tab "Perilaku balasan" dan di dalamnya "Teks penolakan"; klik "Connector" menampilkan tab WhatsApp dan AI, dan tab AI memuat pengaturan penyedia; tidak ada item menu bernama "Aturan" atau "Koneksi"; grup Pengaturan tetap terbuka setelah berpindah antar submenu. Di `pages.test.tsx` pindahkan tes `RulesPage` agar merender `ReplyBehaviorTab`, dan hapus asersi saklar autostart darinya.
- [ ] **Step 2:** `npx vitest run tests/renderer` — Expected: FAIL.
- [ ] **Step 3: Implementasikan** nav, ConnectorPage, ReplyBehaviorTab, ubah App (sidebar dengan grup collapsible Bootstrap; grup terbuka bila `groupOf(page) === 'settings'`; hapus pemilih tema dari sidebar — Task 5 menambahkannya ke Keamanan; sementara tempatkan `SecurityPage` placeholder yang memuat tema dan autostart), update `i18n/id.ts`.
- [ ] **Step 4:** `npx vitest run tests/renderer && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): grouped settings menu, connector tabs, reply behaviour under Brand`.

---

### Task 5: Layar kunci dan halaman Keamanan & Umum

**Files:** Create `src/renderer/LockScreen.tsx`, `src/renderer/pages/SecurityPage.tsx`; Modify `src/renderer/App.tsx`; Test `tests/renderer/auth-ui.test.tsx`

**Interfaces:** Consumes `Api.auth*` (Task 2).

- [ ] **Step 1: Tes gagal** (stub `window.api` dengan `authState`, `authLogin`, dst. berupa `vi.fn`): bila `authState` → `{enabled:true,locked:true}`, `App` hanya menampilkan layar kunci (tidak ada sidebar, `getSettings` tidak dipanggil); salah login menampilkan "Username atau password salah" dan tetap terkunci; `throttled` menampilkan "Terlalu banyak percobaan"; login benar menampilkan aplikasi; tautan "Lupa password?" membuka isian kode pemulihan + password baru yang memanggil `authReset` dan menampilkan kode baru. Pada `SecurityPage` (login nonaktif): isian username/password/ulang password; password tak sama atau <8 karakter menampilkan galat dan tidak memanggil `authSetup`; sukses menampilkan kode pemulihan dalam kotak peringatan dengan tombol "Saya sudah menyimpannya". Login aktif: ganti password, kunci otomatis (menit; 0 = mati) memanggil `authSetAutoLock`, tombol "Kunci sekarang" memanggil `authLock`, "Nonaktifkan login" meminta password. Teks catatan "Login hanya mengunci tampilan aplikasi, bukan mengenkripsi data" tampil. Pengatur waktu: dengan `vi.useFakeTimers` dan `autoLockMin: 1`, tanpa aktivitas selama 60 detik memanggil `authLock`; `mousemove` menunda; `autoLockMin: 0` tidak memanggil. Tema dan "Jalankan saat login" ada di halaman ini dan memanggil `updateSettings`.
- [ ] **Step 2:** `npx vitest run tests/renderer/auth-ui.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implementasikan**; `App` memuat `authState` lebih dulu dan tidak memanggil API data selama terkunci. Rujuk galat `LOCKED` dari API mana pun dengan kembali ke layar kunci.
- [ ] **Step 4:** `npx vitest run tests/renderer && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(auth): lock screen, security page and idle auto-lock`.

---

### Task 6: Halaman Dashboard

**Files:** Create `src/renderer/pages/DashboardPage.tsx`; Modify `src/renderer/nav.tsx`; Test `tests/renderer/dashboard.test.tsx`

**Interfaces:** Consumes `Api.getDashboard`, `getStatus`, `onStatus`, `getSettings`, `hasApiKey`, `getBrand`.

- [ ] **Step 1: Tes gagal:** menampilkan badge status WhatsApp ("Terhubung") dan mengikuti event `onStatus`; menampilkan status AI "Aktif"/"Nonaktif" dari `settings.mode` dan `hasApiKey`; kartu "Hari ini" dan "7 hari" menampilkan angka dari `getDashboard`; "Menunggu admin" menampilkan jumlah; lima kejadian terakhir tampil dengan keputusan; basis data kosong menampilkan nol dan teks "Belum ada aktivitas"; peringatan muncul untuk: belum ada admin (`getBrand().active.admins` kosong), mode AI tanpa API key, tidak ada folder pengetahuan; tidak ada peringatan bila semuanya beres.
- [ ] **Step 2:** jalankan — Expected: FAIL.
- [ ] **Step 3: Implementasikan** `DashboardPage` dengan kartu Bootstrap dan muat ulang data tiap 15 detik (bersihkan interval saat unmount); sambungkan ke `nav.tsx` sebagai item pertama.
- [ ] **Step 4:** `npx vitest run tests/renderer && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): dashboard page`.

---

### Task 7: Dokumen, regresi penuh, dan tinjauan

**Files:** Modify `docs/manual-acceptance.md`, `PRD.md` (bagian navigasi/keamanan singkat)

- [ ] **Step 1:** Tambahkan bagian "Menu, Dashboard, dan Login" di `docs/manual-acceptance.md` (langkah N1–N10): menu Pengaturan dan submenunya; Aturan kini di Brand & Konversi; dashboard memperbarui angka setelah balasan; buat login dan simpan kode pemulihan; tutup-buka aplikasi minta login; sembunyikan ke tray lalu buka → terkunci; bot tetap membalas saat terkunci; salah password 5× → tertahan 30 detik; reset dengan kode pemulihan; kunci otomatis 1 menit; nonaktifkan login. Perbarui rujukan "Aturan → Jalankan saat login" (langkah 18) ke Keamanan & Umum.
- [ ] **Step 2:** Jalankan `npm test && npm run typecheck` — Expected: seluruh suite hijau (337 + tes baru), tipe bersih. Laporkan nama tes yang gagal bila ada.
- [ ] **Step 3:** Tinjauan seluruh branch oleh pengulas segar sesuai skill executing-plans; perbaiki temuan Critical/Important dengan TDD.
- [ ] **Step 4: Commit** `docs: acceptance steps for menu, dashboard and login`.
