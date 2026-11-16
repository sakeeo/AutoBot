# Pesan Real-time, Tema, Notifikasi, Menu Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Perbaiki mode terang dan tambah tombol tema, halaman Pesan real-time, notifikasi chat masuk, dan sembunyikan menu bar.

**Architecture:** `SettingsProvider` (context) menggantikan salinan pengaturan per halaman. `MessageFeed` (main) mencatat dan menyiarkan pesan; pipeline memanggilnya; `notify.ts` memutuskan notifikasi; halaman Pesan berlangganan event.

**Tech Stack:** Electron, React 19, better-sqlite3, zod, vitest (+ testing-library/jsdom).

**Spec:** `docs/superpowers/specs/2026-11-16-inbox-theme-notify-design.md`

## Global Constraints

- Branch `feat/inbox-theme-notify` (dari `feat/ui-rubick-design`). Jangan merge.
- Visual hanya dari `docs/design-guide.md` (token, komponen `ui/*`); tanpa warna literal di luar `tokens.css`.
- Tes berjalan di Node biasa; modul main yang diuji tidak mengimpor `electron`.
- Data pesan tidak boleh keluar saat terkunci: handler IPC baru lewat `handle()` berpagar, event lewat `lockAwareSend`.
- Semua tes lama hijau; `npm run typecheck` bersih. Penutup commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Pesan duplikat (id WhatsApp sama dikirim dua kali) tidak tercatat dua kali dan tidak memicu dua notifikasi.
- Riwayat lama (timestamp > 2 menit) tercatat tetapi tidak memicu notifikasi.
- Pesan non-teks, teks sangat panjang, dan chat grup tidak merusak daftar atau notifikasi.
- Terkunci: tidak ada event pesan atau isi notifikasi yang bocor.
- Daftar Pesan dengan 0 chat, 1 chat, dan ratusan pesan di satu chat tetap responsif (batas jumlah).
- Mengganti tema dari halaman mana pun langsung berlaku di seluruh aplikasi, juga pada pilihan "Otomatis" saat preferensi OS berubah.

## File Structure

- Create `src/main/messages/message-feed.ts`, `src/main/notify.ts`, `src/renderer/pages/MessagesPage.tsx`, `src/renderer/settings-context.tsx`.
- Modify `src/main/db.ts` (migrasi), `src/main/pipeline/reply-pipeline.ts`, `src/main/index.ts`, `src/main/ipc.ts`, `src/main/settings.ts`, `src/shared/{types,ipc,channels}.ts`, `src/preload/index.ts`, `src/renderer/{App,theme,main,useSettings,nav}.ts(x)`, `shell/TopBar.tsx`, `pages/SecurityPage.tsx`, `index.html`, `styles/shell.css`.
- Tests: `tests/{message-feed,notify,reply-pipeline}.test.ts`, `tests/renderer/{theme,messages,shell,nav}.test.tsx`.

---

### Task 1: Tema — sumber pengaturan bersama, tombol tema, tema tersimpan

**Files:** Create `src/renderer/settings-context.tsx`; Modify `useSettings.ts`, `theme.ts`, `main.tsx`, `App.tsx`, `shell/TopBar.tsx`, `styles/shell.css`, `index.html`; Test `tests/renderer/theme.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // theme.ts
  export function applyTheme(theme: Settings['theme']): void     // juga menyimpan ke localStorage 'wa-theme' (try/catch)
  export function applyCachedTheme(): void                       // dipanggil sebelum render pertama; bawaan 'auto'
  export function effectiveTheme(theme: Settings['theme']): 'light' | 'dark'
  // settings-context.tsx
  export function SettingsProvider({ children }): JSX.Element    // satu salinan pengaturan untuk seluruh subtree
  // useSettings.ts: memakai context bila ada, selain itu salinan lokal (tes halaman lama tetap jalan)
  ```
  Tombol di `TopBar`: `aria-label` "Beralih ke mode gelap" saat tampilan terang dan "Beralih ke mode terang" saat gelap; kelas ikon `bi-moon` / `bi-sun`.

- [ ] **Step 1: Tes gagal** (`theme.test.tsx`, render `<App />` dengan stub `window.api` seperti `shell.test.tsx`): memilih "Terang" di Keamanan & Umum langsung membuat `document.documentElement.dataset.bsTheme === 'light'` (dan "Gelap" → `'dark'`) tanpa memuat ulang — pada kondisi awal `theme: 'dark'`; tombol "Beralih ke mode terang" di top bar memanggil `updateSettings({ theme: 'light' })` dan menerapkannya, lalu tombolnya berganti menjadi "Beralih ke mode gelap"; tema "Otomatis" mengikuti `matchMedia` (matches true → dark) dan berubah ketika event `change` dipanggil; `applyTheme('dark')` menyimpan `'dark'` di `localStorage` dan `applyCachedTheme()` menerapkannya; `localStorage` yang melempar tidak merusak; nilai tersimpan yang tidak sah diabaikan; tombol tema berada tepat setelah tombol lonceng dalam urutan DOM top bar; `index.html` tidak lagi berisi `data-bs-theme="auto"`.
- [ ] **Step 2:** `npx vitest run tests/renderer/theme.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implementasikan** context, perbarui `Shell`/`SecurityPage` memakainya, tombol tema, cache tema, `applyCachedTheme()` di `main.tsx` sebelum `createRoot`, ganti atribut `index.html` menjadi `data-bs-theme="light"`.
- [ ] **Step 4:** `npx vitest run tests/renderer && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(ui): shared settings so the theme applies at once; theme toggle in the top bar`.

---

### Task 2: MessageFeed dan IPC pesan

**Files:** Create `src/main/messages/message-feed.ts`; Modify `src/main/db.ts`, `reply-pipeline.ts`, `index.ts`, `ipc.ts`, `src/shared/{ipc,channels}.ts`, `src/preload/index.ts`; Test `tests/message-feed.test.ts`, `tests/reply-pipeline.test.ts`, `tests/ipc-schema.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FeedMessage { id: number; chatId: string; direction: 'in' | 'out' | 'human'; text: string; at: number; isGroup: boolean }
  export interface ChatSummary { chatId: string; isGroup: boolean; last: FeedMessage; count: number }
  export class MessageFeed extends EventEmitter {   // emit('message', FeedMessage)
    constructor(db: Db, clock: { now(): number })
    recordIncoming(m: IncomingMessage): FeedMessage | null   // null untuk duplikat id, status/siaran, atau fromMe
    recordOutgoing(chatId: string, text: string, waId: string | null): FeedMessage
    recordHuman(m: IncomingMessage): FeedMessage | null
    chats(limit?: number): ChatSummary[]                      // terbaru dulu, bawaan 100
    thread(chatId: string, limit?: number): FeedMessage[]     // terlama dulu, bawaan 200
  }
  // shared/ipc.ts Api tambahan:
  listChats(): Promise<ChatSummary[]>; getThread(chatId: string): Promise<FeedMessage[]>; onMessage(cb: (m: FeedMessage) => void): () => void
  // channels: listChats 'messages:chats', getThread 'messages:thread', evtMessage 'evt:message'
  ```
  `PipelineDeps` mendapat `feed?: MessageFeed` (opsional agar tes lama tetap jalan).
  Migrasi: tabel `messages(id INTEGER PRIMARY KEY AUTOINCREMENT, wa_id TEXT UNIQUE, chat_id TEXT NOT NULL, direction TEXT NOT NULL, text TEXT NOT NULL, is_group INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)` + indeks `(chat_id, id)`.

- [ ] **Step 1: Tes gagal** — `message-feed.test.ts` (DB `:memory:`): pesan masuk tercatat dan memancarkan `message`; id WhatsApp yang sama dua kali → kedua kali `null` setelah yang pertama dan satu baris; `fromMe`, `status@broadcast`, dan chat `@broadcast` → `null`; teks `null` → "(pesan non-teks)"; teks 5000 karakter dipotong menjadi 2000; `recordOutgoing` dengan `waId` yang sama dengan masuk tidak bentrok (namespace `out:`/`in:` di kolom `wa_id`); `recordHuman` mencatat `direction: 'human'`; `chats()` mengurutkan terbaru dulu dengan `last` dan `count` benar dan menghormati `limit`; `thread()` terlama dulu dan menghormati `limit` (mengambil yang terbaru); `at` pesan masuk memakai timestamp pesan. `reply-pipeline.test.ts`: dengan `feed` terpasang, pesan masuk dicatat sekali (juga bila diproses dua kali), balasan terkirim dicatat `out` dengan teks yang sama dengan yang dikirim gateway, pesan manusia dari HP (takeover) dicatat `human`, echo pesan bot sendiri tidak dicatat sebagai `human`, pesan yang diabaikan (cooldown, grup bila dilarang) tetap tercatat sebagai `in`. `ipc-schema.test.ts`: skema `ChatIdSchema` menolak string kosong dan >200 karakter.
- [ ] **Step 2:** `npx vitest run tests/message-feed.test.ts tests/reply-pipeline.test.ts tests/ipc-schema.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementasikan** migrasi, `MessageFeed`, panggilan di pipeline (`handle` untuk masuk, `send` untuk keluar dengan id kirim, `takeover` untuk manusia), channel/Api/preload, handler IPC berpagar `listChats`/`getThread` (validasi `ChatIdSchema`), dan di `index.ts` buat `MessageFeed`, teruskan ke pipeline, dan sambungkan `feed.on('message')` ke `send(C.evtMessage, …)` (sudah melewati `lockAwareSend`).
- [ ] **Step 4:** jalankan tes di atas + `npm test && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(messages): record and broadcast every incoming, outgoing and human message`.

---

### Task 3: Notifikasi chat masuk

**Files:** Create `src/main/notify.ts`; Modify `src/main/settings.ts`, `src/shared/{types,ipc}.ts`, `src/main/index.ts`, `src/renderer/pages/SecurityPage.tsx`; Test `tests/notify.test.ts`, `tests/settings.test.ts`, `tests/renderer/settings-pages.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // notify.ts
  export const FRESH_MS = 120_000
  export function incomingNotification(
    m: FeedMessage,
    ctx: { enabled: boolean; locked: boolean; now: number }
  ): { title: string; body: string } | null
  // Settings: notifyIncoming: boolean (bawaan true); SettingsPatchSchema menerimanya
  ```
  Aturan: `null` bila `!enabled`, arah bukan `in`, atau `now - m.at > FRESH_MS`. Judul: "Pesan dari <nomor>" (nomor = bagian sebelum `@` pada `chatId`) atau "Pesan di grup" untuk grup; isi: teks dipotong 120 karakter. Saat `locked`: judul "WA Otomation", isi "Ada pesan baru".

- [ ] **Step 1: Tes gagal** — `notify.test.ts`: semua aturan di atas, termasuk pesan 119 detik (ya) dan 121 detik (tidak), pesan `out`/`human` (tidak), teks 300 karakter dipotong, grup, terkunci menyamarkan judul dan isi tanpa nomor atau teks. `settings.test.ts`: `notifyIncoming` bawaan `true` dan file lama tanpa kolom itu tetap `true`. `settings-pages.test.tsx`: Keamanan & Umum punya saklar "Notifikasi pesan masuk" yang memanggil `updateSettings({ notifyIncoming: false })`.
- [ ] **Step 2:** `npx vitest run tests/notify.test.ts tests/settings.test.ts tests/renderer/settings-pages.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implementasikan** `incomingNotification`, pengaturan, saklar, dan di `index.ts`: pada `feed.on('message')` panggil `incomingNotification(m, { enabled: settings.get().notifyIncoming, locked: isLocked(), now: Date.now() })` dan tampilkan `Notification` bila hasilnya tidak `null` (klik → `showWindow()`).
- [ ] **Step 4:** `npx vitest run && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(notify): desktop notification for every new incoming chat message`.

---

### Task 4: Halaman Pesan

**Files:** Create `src/renderer/pages/MessagesPage.tsx`; Modify `src/renderer/nav.tsx`, `src/renderer/i18n/id.ts`, `styles/ui.css`; Test `tests/renderer/messages.test.tsx`, sesuaikan `nav.test.tsx`/`shell.test.tsx`

**Interfaces:** Consumes `Api.listChats/getThread/onMessage`, komponen `ui/*`. `NavKey` bertambah `'messages'`, item top-level "Pesan" (ikon `bi-chat-left-text`) di antara Dashboard dan Uji Jawaban.

- [ ] **Step 1: Tes gagal** (`messages.test.tsx`): satu `h2` "Pesan"; memuat → `LoadingState`; gagal → `ErrorState` + "Coba lagi"; tanpa chat → `EmptyState` dengan petunjuk; daftar chat menampilkan nomor, cuplikan pesan terakhir, waktu, dan label "Grup" untuk grup; memilih chat memuat `getThread` dan menampilkan balon dengan label arah berteks ("Pelanggan", "Bot", "Admin") dan waktu; event `onMessage` untuk chat yang terbuka menambahkan balon baru tanpa memuat ulang; untuk chat lain hanya memperbarui cuplikan dan memindahkan chat ke atas; chat baru muncul di daftar; event pesan yang sama dua kali (id sama) tidak menggandakan balon; badge "Langsung" menandai pembaruan real-time aktif dan berlangganan dilepas saat halaman ditutup; pesan sangat panjang tetap dalam satu balon (`text-break`); thread kosong menampilkan petunjuk. Tes nav: item "Pesan" ada dan membuka halaman.
- [ ] **Step 2:** `npx vitest run tests/renderer/messages.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implementasikan** halaman dua panel (daftar chat + percakapan) memakai `Card`/`PageHeader`/`StatusBadge`; urutkan dan gulir ke pesan terbaru; batasi thread di memori ke 500 balon.
- [ ] **Step 4:** `npx vitest run tests/renderer && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): live messages page`.

---

### Task 5: Menu bar tersembunyi, dokumen, regresi, tinjauan

**Files:** Modify `src/main/index.ts`, `docs/manual-acceptance.md`, `PRD.md`

- [ ] **Step 1: Implementasikan** (konfigurasi Electron, tanpa tes unit — dicatat di uji manual): `Menu.setApplicationMenu(null)` pada semua mode, `autoHideMenuBar: true` dan `w.removeMenu()` pada jendela; pada mode pengembangan F12 dan Ctrl+Shift+I membuka DevTools lewat `before-input-event`.
- [ ] **Step 2:** Tambah bagian "Pesan, tema, notifikasi" (P1–P10) di `docs/manual-acceptance.md`: tombol tema di samping lonceng dan berfungsi terang/gelap pada OS gelap maupun terang; tema bertahan setelah restart dan dipakai layar kunci; halaman Pesan memperbarui pesan masuk, balasan bot, dan ketikan manual dari HP tanpa memuat ulang; notifikasi muncul untuk tiap pesan masuk baru dan tidak muncul untuk riwayat lama; saklar notifikasi mematikannya; saat terkunci notifikasi tidak memuat isi pesan; menu bar tidak tampak di Windows/Linux/macOS (Alt tidak memunculkannya); F12 membuka DevTools hanya saat pengembangan. Tambah satu baris di PRD.
- [ ] **Step 3:** `npm test && npm run typecheck` — Expected: suite hijau; sebutkan tes yang gagal bila ada. Pindai `grep -rnE "#[0-9a-fA-F]{3,8}\b" src/renderer` di luar `tokens.css` — Expected: kosong.
- [ ] **Step 4:** Tinjauan seluruh branch oleh pengulas segar; perbaiki Critical/Important dengan TDD.
- [ ] **Step 5: Commit** `feat: hide the window menu bar; docs for messages, theme and notifications`.
