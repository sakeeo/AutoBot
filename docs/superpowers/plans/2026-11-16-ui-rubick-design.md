# Penerapan Design Guide Rubick Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Terapkan `docs/design-guide.md` secara konsisten dan presisi pada seluruh UI renderer.

**Architecture:** Berkas token CSS memetakan token panduan ke variabel Bootstrap; berkas gaya shell menata sidebar/top bar/drawer; komponen React kecil di `src/renderer/ui/` menyatukan pola berulang (header halaman, kartu, badge status, state, konfirmasi). Halaman lama dipindah ke komponen itu tanpa mengubah perilaku.

**Tech Stack:** React 19, Bootstrap 5 (dibundel), bootstrap-icons (outline), `@fontsource/inter` (baru, dibundel), vitest + testing-library/jsdom.

**Spec:** `docs/superpowers/specs/2026-11-16-ui-rubick-design.md` (acuan visual tunggal: `docs/design-guide.md`)

## Global Constraints

- Branch `feat/ui-rubick-design` (dari `feat/settings-nav-auth`). Jangan merge.
- Nilai token persis §11: `#2449A8 #1D3F98 #EAF0FC #F3F5F9 #FFFFFF #E7EBF1 #263247 #7B8798 #9BCB42 #E9B34A #D97979`, radius control `6px` dan card `10px`, spasi `4 8 12 16 20 24 32 px`, bayangan kartu `0 2px 8px rgba(20, 35, 60, 0.05)`.
- Tipografi §3.2: Inter saja; page title 20–24 px/600–700, section 15–18/600, card title 13–15/600, KPI 24–32/600–700, body 12–14/400, label 10–12/400–500, button 12–13/500–600. Ikon: bootstrap-icons varian outline saja, 16–20 px. Kontrol tinggi 32–40 px. Sidebar 220 px.
- Tanpa CDN (CSP `style-src 'self'`); font lewat npm. Tanpa kerangka UI baru.
- Teks UI bahasa Indonesia. Status selalu tertulis sebagai teks, bukan hanya warna.
- Turunan (palet gelap, `--color-text-muted`, warna teks badge) diberi komentar `/* DERIVED: ... */` di CSS dan dicatat sebagai ruling.
- Semua tes lama tetap hijau (disesuaikan hanya bila UI-nya memang berubah); `npm run typecheck` bersih.
- Commit memakai penutup: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Kontras: setiap pasangan teks/latar (termasuk badge dan mode gelap) ≥ 4,5:1; tombol disabled tetap terbaca.
- Drawer: Escape dan klik latar menutup; fokus kembali ke tombol menu; tidak ada sidebar ganda di desktop.
- Konfirmasi hapus: klik pertama tidak pernah menghapus; Batal dan Escape membatalkan; semua aksi hapus/destruktif memakainya.
- Tidak ada warna/ukuran literal di luar token pada berkas gaya baru (uji pemindaian CSS).
- Tema Terang/Gelap/Otomatis tetap bekerja di semua halaman termasuk layar kunci.
- Layout 860 px (lebar minimum jendela) tanpa scroll horizontal pada halaman utama.

## File Structure

- Create `src/renderer/styles/tokens.css`, `src/renderer/styles/shell.css`.
- Create `src/renderer/ui/{PageHeader,Card,StatusBadge,States,ConfirmButton,DataTable}.tsx`.
- Create `src/renderer/shell/{Sidebar,TopBar,Breadcrumb}.tsx`; modify `src/renderer/{main.tsx,App.tsx,nav.tsx,theme.ts}`, `index.html`.
- Modify semua halaman di `src/renderer/pages/*`, `src/renderer/brand/*`, `LockScreen.tsx`.
- Tests: `tests/renderer/{tokens,shell,ui,dashboard}.test.ts(x)`; sesuaikan `pages.test.tsx`, `brand.test.tsx`, `nav.test.tsx`, `auth-ui.test.tsx`.

---

### Task 1: Token, font, dan lapisan Bootstrap

**Files:** Create `src/renderer/styles/tokens.css`; Modify `src/renderer/main.tsx`, `src/renderer/theme.ts`; Test `tests/renderer/tokens.test.ts`

**Interfaces:**
- Produces: CSS variable `--color-*`, `--radius-*`, `--space-*`, `--shadow-card`, turunan `--color-text-muted`, `--color-*-soft`, `--color-*-text`; kelas `.card`, `.btn`, `.form-control`, `.badge`, `.table` bergaya panduan lewat pemetaan `--bs-*`. `contrast(fg, bg): number` hanya di tes.
- Mode gelap lewat `[data-bs-theme="dark"]` (turunan).

- [ ] **Step 1: Tes gagal** (`tests/renderer/tokens.test.ts`, membaca CSS dari disk, tanpa DOM): setiap token §11 ada dengan nilai persis (daftar pada Global Constraints, tanpa beda huruf besar-kecil); `--bs-primary` = `var(--color-primary)`, `--bs-body-bg` = `var(--color-background)`, `--bs-border-color` = `var(--color-border)`; kontras ≥ 4,5 untuk: text-primary/surface, text-primary/background, text-muted/surface, text-muted/background, putih/primary, putih/primary-dark, serta tiap `--color-{success,warning,danger}-text` di atas `-soft`; blok `[data-bs-theme="dark"]` ada dan pasangan teks/latar gelapnya juga ≥ 4,5; ada aturan `:focus-visible` dengan outline terlihat; tidak ada nilai warna heksa di `shell.css` selain di dalam `var(...)` (diaktifkan di Task 2, tes membaca berkas bila ada).
- [ ] **Step 2:** `npx vitest run tests/renderer/tokens.test.ts` — Expected: FAIL (berkas belum ada).
- [ ] **Step 3: Implementasikan** `tokens.css`: token §11, `font-family: Inter`, skala tipografi §3.2 pada elemen dasar, pemetaan `--bs-*` (primary, body-bg, body-color, border-color, secondary-color, success/warning/danger, border-radius, card), kartu (border `--color-border`, radius 10, bayangan lembut, padding 16–20), tombol (primer biru, sekunder putih berborder, destruktif `--color-danger`, tinggi 32–40, disabled terbaca), input (tinggi 36, border 1 px, radius 6, placeholder `--color-text-muted`), badge lunak, tabel (header berkontras, baris tinggi konsisten, hover halus), `:focus-visible`. Turunan diberi komentar `DERIVED`. Instal `@fontsource/inter` (`npm i @fontsource/inter`) dan impor bobot 400/500/600/700 + `tokens.css` setelah CSS Bootstrap di `main.tsx`. `theme.ts` tetap memakai `data-bs-theme`.
- [ ] **Step 4:** jalankan tes + `npm run typecheck && npx vitest run` — Expected: PASS, suite lama hijau.
- [ ] **Step 5: Commit** `feat(ui): design tokens, Inter and Bootstrap mapping`.

---

### Task 2: App shell — sidebar, top bar, breadcrumb, drawer

**Files:** Create `src/renderer/styles/shell.css`, `src/renderer/shell/{Sidebar,TopBar,Breadcrumb}.tsx`; Modify `src/renderer/App.tsx`, `src/renderer/nav.tsx`, `src/renderer/i18n/id.ts`; Test `tests/renderer/shell.test.tsx`, sesuaikan `nav.test.tsx`

**Interfaces:**
- Consumes: `AuthContext` (`useAuth`), `Api.getStatus/onStatus/getDashboard/authLock`.
- Produces:
  ```ts
  // nav.tsx (tambahan)
  export function crumbsOf(key: NavKey): string[]   // ['Dashboard'] atau ['Pengaturan','Brand & Konversi']
  // shell/*
  <Sidebar page: NavKey onSelect(k: NavKey): void settingsOpen: boolean onToggleSettings(): void onNavigate?(): void />
  <TopBar crumbs: string[] onMenu(): void onGoDashboard(): void onGoSecurity(): void />
  ```
  Drawer aktif bila `matchMedia('(max-width: 991.98px)').matches`; state `drawerOpen` dimiliki `Shell`.

- [ ] **Step 1: Tes gagal** (stub `window.api` seperti `nav.test.tsx`; `matchMedia` bisa diatur per tes): top bar menampilkan breadcrumb "Dashboard" di halaman awal dan "Pengaturan / Brand & Konversi" setelah memilih submenu itu (`nav` ber-`aria-label="Breadcrumb"`, item terakhir `aria-current="page"`); item sidebar aktif ber-`aria-current="page"`; badge status WhatsApp di top bar berteks ("Terhubung") dan mengikuti `onStatus`; tombol ikon notifikasi ber-label "Notifikasi: 3 chat menunggu admin" sesuai `getDashboard().waitingAdmin` (0 → "Tidak ada notifikasi") dan mengklik membuka Dashboard; menu profil (`aria-label="Menu profil"`) membuka daftar: tanpa login aktif hanya "Keamanan & Umum"; dengan login aktif ada nama pengguna dan "Kunci sekarang" yang memanggil `authLock`; di layar lebar tidak ada tombol "Buka menu" dan sidebar terlihat; di layar sempit sidebar tersembunyi, "Buka menu" membukanya sebagai drawer, Escape dan klik latar menutupnya, memilih item menutupnya, dan fokus kembali ke "Buka menu"; semua tombol ikon punya nama aksesibel.
- [ ] **Step 2:** `npx vitest run tests/renderer/shell.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implementasikan** shell sesuai §4.1/§5: sidebar `--color-primary` lebar 220 px, logo + nama produk, ikon outline, item aktif berlatar lebih terang (`rgba` putih atas primary, ditulis sebagai turunan token), chevron pada Pengaturan, jarak vertikal nyaman; top bar tinggi ringkas dengan breadcrumb kiri dan badge/lonceng/profil kanan; konten dalam `main` berlatar `--color-background` dengan padding `--space-6`. `shell.css` hanya memakai `var(--…)` (tanpa heksa literal). Susun ulang `App.tsx` memakai komponen ini; pertahankan gerbang auth, idle lock, dan state `settingsOpen`. Polling notifikasi 15 detik dengan `clearInterval` saat unmount; galat `getDashboard` tidak boleh merusak top bar.
- [ ] **Step 4:** `npx vitest run tests/renderer && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): Rubick app shell with top bar and drawer`.

---

### Task 3: Komponen bersama dan Dashboard

**Files:** Create `src/renderer/ui/{PageHeader,Card,StatusBadge,States,ConfirmButton,DataTable}.tsx`; Modify `src/renderer/pages/DashboardPage.tsx`; Test `tests/renderer/ui.test.tsx`, ubah `tests/renderer/dashboard.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  PageHeader({ icon?: string; title: string; subtitle?: string; actions?: ReactNode })   // h2 tunggal per halaman
  Card({ title?: string; actions?: ReactNode; children; 'aria-label'?: string })           // section ber-region bila bernama
  StatusBadge({ tone: 'success'|'warning'|'danger'|'neutral'|'info'; children: string })  // selalu berteks
  LoadingState({ label?: string })        // role="status", default "Memuat…"
  EmptyState({ title: string; hint?: string; action?: ReactNode })
  ErrorState({ message: string; onRetry?: () => void })   // role="alert", tombol "Coba lagi"
  ConfirmButton({ label: string; confirmLabel?: string; onConfirm(): void; ariaLabel?: string; className?: string; disabled?: boolean; children?: ReactNode })
  DataTable<T>({ columns: { key: string; header: string; align?: 'end'; render(row: T): ReactNode }[]; rows: T[]; rowKey(row: T): string; pageSize?: number; caption: string; empty: ReactNode })
  ```
  `ConfirmButton`: klik pertama mengganti isi dengan "Yakin?" + tombol konfirmasi merah (`confirmLabel`, default "Hapus") dan "Batal"; hanya konfirmasi yang memanggil `onConfirm`; Escape atau Batal kembali; fokus berpindah ke konfirmasi.

- [ ] **Step 1: Tes gagal** (`ui.test.tsx`): `StatusBadge` merender teksnya dan kelas nada; `LoadingState` ber-`role="status"`; `ErrorState` ber-`role="alert"` dan "Coba lagi" memanggil `onRetry`; `EmptyState` menampilkan judul dan petunjuk; `ConfirmButton` — klik pertama tidak memanggil `onConfirm`, konfirmasi memanggilnya sekali, Batal dan Escape tidak memanggilnya, dan setelah dibatalkan tombol awal kembali; `DataTable` — header `scope="col"`, kolom `align: 'end'` rata kanan, `pageSize` 2 dengan 5 baris menampilkan 2 baris + kontrol halaman ("Berikutnya" maju, "Sebelumnya" mundur, teks "1–2 dari 5"), `rows` kosong menampilkan `empty`. `dashboard.test.tsx`: `getDashboard` yang menolak menampilkan `ErrorState` dengan "Coba lagi" yang memanggil ulang; saat memuat tampil `LoadingState`; peringatan konfigurasi tampil sebagai banner biru yang bisa ditutup (tombol "Tutup peringatan" menyembunyikan hanya banner itu); angka KPI memakai kelas ukuran KPI; aktivitas terakhir berupa tabel dengan kolom Waktu, Keputusan (badge berteks), Pesan; sisa tes lama tetap lulus.
- [ ] **Step 2:** `npx vitest run tests/renderer/ui.test.tsx tests/renderer/dashboard.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implementasikan** komponen (kelas Bootstrap + token, tanpa warna literal) dan susun ulang `DashboardPage` mengikuti §6.1/6.2/6.8: banner, kartu KPI (periode hari ini dan 7 hari, angka besar), kartu "Menunggu admin", tabel aktivitas dengan `DataTable`, badge keputusan (`replied*` sukses, `out_of_context*` netral, `handoff*` info, `error*` danger).
- [ ] **Step 4:** `npx vitest run tests/renderer && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): shared UI components and dashboard redesign`.

---

### Task 4: Halaman Pengaturan (Connector, Pengetahuan, Keamanan, layar kunci)

**Files:** Modify `pages/{ConnectionPage,AiSettings,KnowledgePage,SecurityPage,ConnectorPage}.tsx`, `LockScreen.tsx`; Test: sesuaikan `pages.test.tsx`, `auth-ui.test.tsx`, `nav.test.tsx`

**Interfaces:** Consumes komponen Task 3.

- [ ] **Step 1: Tes gagal / disesuaikan:** setiap halaman punya tepat satu `h2` melalui `PageHeader` dan konten di dalam `Card`; Connector memakai tab bergaya panduan (aksen biru pada tab aktif, `aria-selected`); aksi destruktif memakai `ConfirmButton`: Logout WhatsApp, Hapus key AI, Hapus folder pengetahuan, Nonaktifkan login — klik pertama tidak memanggil API (`logout`, `deleteApiKey`, `updateSettings`, `authDisable`), konfirmasi memanggilnya; daftar file pengetahuan menjadi `DataTable` dengan badge status berteks ("Terindeks"/"Gagal: …"); `ConnectionPage` menampilkan `LoadingState`/`ErrorState` saat status gagal; layar kunci memakai `Card` dan token yang sama dan tetap lulus tes `auth-ui`.
- [ ] **Step 2:** jalankan `npx vitest run tests/renderer` — Expected: FAIL pada ekspektasi baru.
- [ ] **Step 3: Implementasikan** perpindahan ke komponen bersama tanpa mengubah perilaku. Teks tombol spesifik (mis. "Hapus key", "Keluar dari WhatsApp"). Perbarui tes lama yang mengklik hapus agar mengklik konfirmasi.
- [ ] **Step 4:** `npx vitest run tests/renderer && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): settings pages on shared components with delete confirmation`.

---

### Task 5: Brand & Konversi, Uji Jawaban, Log

**Files:** Modify `pages/{BrandPage,TestPanel,LogPage}.tsx`, `brand/*.tsx`; Test: sesuaikan `brand.test.tsx`, `pages.test.tsx`

- [ ] **Step 1: Tes gagal / disesuaikan:** `BrandPage` memakai `PageHeader`, tab bergaya panduan, panel di `Card`, dan `ApplyBar` melekat di bawah dengan tombol primer "Terapkan" (state disabled tetap terbaca) — perilaku Terapkan/pratinjau yang ada tidak berubah; semua aksi hapus (tautan, admin, aturan, contoh, pertanyaan lead, keberatan) memakai `ConfirmButton` dan klik pertama tidak mengubah draf; `PresetPicker` tetap meminta konfirmasi (ganti `window.confirm` dengan `ConfirmButton`/dialog inline yang sama, tes memastikan preset tidak dimuat sebelum konfirmasi); `LogPage` memakai `DataTable` (Waktu, Keputusan [badge], Skor rata kanan, Sumber, Pesan; 10 baris per halaman, tombol "Muat ulang" dan keadaan kosong/galat); `TestPanel` memakai `Card`, `LoadingState` saat menunggu, dan `ErrorState` bila galat.
- [ ] **Step 2:** `npx vitest run tests/renderer` — Expected: FAIL.
- [ ] **Step 3: Implementasikan.** Ikon aksi-saja punya `aria-label`; pertahankan semua label yang dipakai tes lain.
- [ ] **Step 4:** `npx vitest run && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): brand, test and log pages on the Rubick components`.

---

### Task 6: Dokumen, regresi, dan tinjauan

**Files:** Modify `docs/manual-acceptance.md`, `PRD.md` (satu baris rujukan)

- [ ] **Step 1:** Tambah bagian "Tampilan (Design Guide)" di `docs/manual-acceptance.md` (U1–U10): sidebar biru 220 px, top bar dan breadcrumb di setiap halaman, drawer di jendela sempit, bell menunjukkan chat menunggu admin, profil → Kunci sekarang, hapus selalu meminta konfirmasi, tema Terang/Gelap/Otomatis terbaca di semua halaman termasuk layar kunci, tab fokus keyboard terlihat, jendela 860 px tanpa scroll horizontal, font Inter termuat tanpa jaringan.
- [ ] **Step 2:** Jalankan `npm test && npm run typecheck` — Expected: seluruh suite hijau; laporkan nama tes gagal bila ada.
- [ ] **Step 3:** Pindai kepatuhan: tidak ada warna heksa literal di `src/renderer/**/*.{tsx,css}` di luar `tokens.css` (`grep -rnE "#[0-9a-fA-F]{3,8}\b" src/renderer`); setiap temuan diperbaiki atau diberi ruling.
- [ ] **Step 4:** Tinjauan seluruh branch oleh pengulas segar sesuai executing-plans; perbaiki Critical/Important dengan TDD.
- [ ] **Step 5: Commit** `docs: acceptance steps for the Rubick UI`.
