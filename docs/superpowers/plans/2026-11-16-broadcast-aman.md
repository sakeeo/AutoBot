# Broadcast Aman Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Broadcast WhatsApp dengan keamanan akun sebagai prioritas: penerima berizin, batas bertahap, berhenti otomatis, dan berhenti berlangganan yang tidak bisa dilewati.

**Architecture:** Aturan keamanan hidup di modul murni (`limits`, `lint`, `optout`, `gate`, `breaker`) yang diuji tanpa Electron. `BroadcastStore` (SQLite) menyimpan kontak, daftar tolak, kampanye, dan setiap pengiriman; semua penghitung batas dihitung dari tabel pengiriman (bukan memori) agar benar setelah restart. `BroadcastEngine` mengambil satu pengiriman jatuh tempo per tik dan menjalankan gerbang penuh saat itu. Penangan berhenti/mulai masuk ke pipeline sebelum agen. UI satu halaman Broadcast dengan empat tab.

**Tech Stack:** Electron, React 19, better-sqlite3, zod, `xlsx` (sudah ada), vitest (+ testing-library/jsdom).

**Spec:** `docs/superpowers/specs/2026-11-16-broadcast-aman-design.md` (nomor § di bawah merujuk ke sana). Visual: `docs/design-guide.md`.

## Global Constraints

- Branch `feat/broadcast`. Jangan merge.
- **Tidak boleh** ada: variasi teks acak (spintax), rotasi nomor/akun, proxy, jalan pintas yang melewati daftar tolak atau batas harian (spec §4). Tidak ada pengaturan yang menaikkan batas melewati batas tingkat (§8).
- Nilai persis dari spec §8: tingkat `baru` 20/hari & 5 kontak baru; `berkembang` 80 & 15; `mapan` 200 & 30; pemanasan hari pertama 10 lalu +25%/hari aktif, jeda >14 hari mengulang; maks 15/jam; jeda 3–8 menit tiap 10 pesan; jeda antarpesan acak 20–60 detik; jam kirim bawaan 09:00–20:00; per kontak ≥ 7 hari (dapat diturunkan sampai 3) dan maks 4 per 30 hari.
- Semua penghitung batas diturunkan dari tabel `broadcast_sends` dan `broadcast_state` (tahan restart); jam disuntik (`clock`) agar bisa diuji.
- Tes berjalan di Node biasa; modul main yang diuji tidak mengimpor `electron`. Data broadcast tidak boleh keluar saat terkunci: IPC lewat `handle()` berpagar, event lewat `lockAwareSend`; memulai/mengubah kampanye menolak (`LOCKED`) saat terkunci, kampanye berjalan tetap berjalan.
- Teks UI bahasa Indonesia; komponen `ui/*` dan token; tanpa warna literal di luar `tokens.css`.
- Semua tes lama hijau; `npm run typecheck` bersih. Penutup commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Penerima yang berhenti **setelah** kampanye dibuat tidak pernah dikirimi (gerbang memeriksa saat kirim), termasuk tolak lunak dan tolak lewat JID/LID.
- Kalimat panjang yang memuat "stop" tidak memicu berhenti; pesan "berhenti" dari orang yang belum pernah dikirimi broadcast tetap sampai ke agen.
- Restart di tengah hari tidak mengosongkan penghitung harian/jam/kontak baru dan tidak melanjutkan kampanye otomatis.
- Nomor sama dalam format berbeda (`0812…`, `+62 812…`, `62812…`) menjadi satu kontak; `@lid` tanpa nomor dikecualikan.
- Gema pesan broadcast yang terkirim tidak dianggap manusia mengambil alih chat dan tidak menjeda bot.
- Ekspor CSV tidak bisa dipakai untuk injeksi rumus (sel berawalan `=`, `+`, `-`, `@` diberi tanda kutip).
- Impor besar (≥ 20.000 baris) tidak membekukan UI atau memuat semuanya sekaligus tanpa batas; impor ditolak melewati batas baris (mis. 20.000).
- Pemutus sirkuit menjeda dalam satu siklus dan **tidak pernah** lanjut sendiri; konfirmasi memakai ambang sendiri.
- Hapus data kontak meninggalkan catatan tolak berhash bila pernah berhenti; impor ulang nomor itu tetap tertolak.
- Satu kampanye aktif sekaligus; kampanye kedua mengantre; kampanye lebih besar dari kuota berlanjut ke hari berikutnya hanya dalam jam kirim.

## File Structure

- Create `src/shared/broadcast.ts` — tipe dan zod.
- Create `src/main/broadcast/{limits,lint,optout,gate,breaker,identity,store,import,audience,engine,optout-handler}.ts`.
- Modify `src/main/db.ts` (migrasi), `src/main/wa/{gateway,baileys-gateway}.ts` (`onWhatsApp`), `src/main/pipeline/reply-pipeline.ts`, `src/main/index.ts`, `src/main/ipc.ts`, `src/shared/{ipc,channels}.ts`, `src/preload/index.ts`, `src/renderer/{nav.tsx,i18n/id.ts}`.
- Create `src/renderer/pages/BroadcastPage.tsx`, `src/renderer/broadcast/{RecipientsTab,ImportWizard,CampaignsTab,CampaignWizard,SafetyTab,ReportTab}.tsx`.
- Tests: `tests/broadcast/*.test.ts`, `tests/renderer/broadcast-*.test.tsx`; ubah `tests/reply-pipeline.test.ts`, FakeGateway di tes lain bila antarmuka bertambah.

---

### Task 1: Tipe, identitas, migrasi, dan BroadcastStore

**Files:** Create `src/shared/broadcast.ts`, `src/main/broadcast/identity.ts`, `src/main/broadcast/store.ts`; Modify `src/main/db.ts`; Test `tests/broadcast/identity.test.ts`, `tests/broadcast/store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // shared/broadcast.ts
  export type Tier = 'baru' | 'berkembang' | 'mapan'
  export type ContactStatus = 'aktif' | 'menunggu_persetujuan' | 'tidak_aktif'
  export type SuppressReason = 'berhenti' | 'laporan' | 'tidak_terdaftar' | 'blokir_manual' | 'admin' | 'tolak_lunak'
  export type CampaignKind = 'broadcast' | 'konfirmasi'
  export type CampaignStatus = 'draf' | 'terjadwal' | 'berjalan' | 'dijeda' | 'dihentikan' | 'selesai'
  export type SendStatus = 'antre' | 'terkirim' | 'gagal' | 'dilewati'
  export interface BContact { id: number; number: string | null; jid: string | null; name: string; vars: Record<string, string>; source: 'chat' | 'impor'; status: ContactStatus; lastInboundAt: number | null; lastSentAt: number | null; sentCount: number; importId: number | null }
  export interface Campaign { id: number; name: string; kind: CampaignKind; template: string; status: CampaignStatus; pauseReason: string | null; createdAt: number; startedAt: number | null; audience: 'chat' | 'impor' | 'semua'; notBefore: number | null }
  // identity.ts
  export function normalizePhone(raw: string): string | null            // digit saja; 0… → 62…; panjang 8–15 digit; selain itu null
  export function isLidJid(jid: string): boolean                        // berakhiran @lid
  export function numberFromJid(jid: string): string | null             // @s.whatsapp.net → nomor; @lid → null
  export function hashNumber(number: string, salt: string): string      // sha256 hex
  // store.ts
  export class BroadcastStore {
    constructor(db: Db, clock: { now(): number })
    salt(): string                                                         // dibuat acak sekali, disimpan di broadcast_state
    upsertContact(c: { number: string | null; jid: string | null; name?: string; vars?: Record<string,string>; source: 'chat'|'impor'; status: ContactStatus; importId?: number }): BContact
    findContact(key: { number?: string | null; jid?: string | null }): BContact | null
    setContactStatus(id: number, status: ContactStatus): void
    recordInbound(key: { number?: string | null; jid?: string | null }, at: number): BContact | null   // set last_inbound_at; menunggu_persetujuan → aktif
    suppress(e: { number?: string | null; jid?: string | null; reason: SuppressReason }): void
    isSuppressed(key: { number?: string | null; jid?: string | null }): { reason: SuppressReason } | null  // cek nomor, jid, dan hash
    unsuppress(key: { number?: string | null; jid?: string | null }): void
    listSuppressed(): { number: string | null; jid: string | null; reason: SuppressReason; at: number }[]
    eraseContact(id: number): void        // buang kontak + sends; bila ada tolak simpan tombstone hash saja
  }
  ```
  Migrasi: `broadcast_state(k TEXT PRIMARY KEY, v TEXT)`, `broadcast_contacts`, `broadcast_imports(id, source_note, attested_at, total, valid, created_at)`, `broadcast_suppress(id, number, jid, hash, reason, created_at)` (indeks pada `number`, `jid`, `hash`), `broadcast_campaigns`, `broadcast_sends(id, campaign_id, contact_id, status, reason, scheduled_for, sent_at, wa_id, created_at)` (indeks `(campaign_id,status)`, `(sent_at)`, `(contact_id)`).

- [ ] **Step 1: Tes gagal.** `identity.test.ts`: `normalizePhone` — `'0812-3456-7890'`, `'+62 812 3456 7890'`, `'6281234567890'` → `'6281234567890'`; `'123'`, `''`, `'abc'`, 16 digit → `null`; `numberFromJid('6281@s.whatsapp.net')` → `'6281'`, `@lid` → `null`; `hashNumber` deterministik, garam berbeda → hash berbeda. `store.test.ts` (DB `:memory:`): `upsertContact` untuk tiga format nomor sama menghasilkan **satu** baris; kontak chat `@lid` tanpa nomor tersimpan dengan `number: null`; `recordInbound` mengubah `menunggu_persetujuan` → `aktif` dan mengisi `last_inbound_at`, tetapi tidak mengubah `tidak_aktif`; `suppress` lalu `isSuppressed` cocok lewat nomor, lewat jid, dan lewat nomor yang sama dalam format lain; `unsuppress` mencabutnya; `eraseContact` pada kontak yang pernah `berhenti` menyisakan tombstone sehingga `isSuppressed({number})` tetap benar sementara baris kontak, sends, dan nama hilang; `eraseContact` pada kontak biasa tidak meninggalkan apa pun; garam stabil antar instance pada DB yang sama dan tidak muncul di kolom lain.
- [ ] **Step 2:** `npx vitest run tests/broadcast` — Expected: FAIL.
- [ ] **Step 3: Implementasikan** tipe, `identity.ts`, migrasi (append ke `MIGRATIONS`), dan `BroadcastStore`. Tombstone = baris `broadcast_suppress` tanpa nomor/jid asli, hanya `hash`.
- [ ] **Step 4:** `npx vitest run tests/broadcast && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(broadcast): identity, schema and store`.

---

### Task 2: Aturan batas, jam kirim, dan pemeriksa isi (murni)

**Files:** Create `src/main/broadcast/limits.ts`, `src/main/broadcast/lint.ts`; Test `tests/broadcast/limits.test.ts`, `tests/broadcast/lint.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // limits.ts
  export const TIER_LIMITS: Record<Tier, { daily: number; newContacts: number }>
  export const HOURLY_MAX = 15, BATCH_SIZE = 10
  export function effectiveTier(declared: { ageDays: number; declaredAt: number }, now: number): Tier   // ageDays + hari berlalu
  export function warmupCap(activeDay: number): number        // hari ke-1 → 10, ×1.25 per hari, dibulatkan ke bawah
  export function dailyCap(tier: Tier, activeDay: number): number   // min(TIER_LIMITS[tier].daily, warmupCap(activeDay))
  export function activeDayIndex(sendDays: string[], today: string): number   // jumlah hari aktif berurutan (reset bila jeda >14 hari)
  export function nextDelayMs(rand: () => number): number     // 20_000–60_000
  export function batchPauseMs(rand: () => number): number    // 180_000–480_000
  export function inSendWindow(now: number, w: { start: string; end: string; timezone: string }): boolean
  export function nextWindowStart(now: number, w: { start: string; end: string; timezone: string }): number
  // lint.ts
  export function renderTemplate(tpl: string, vars: { nama?: string; bisnis: string } & Record<string, string | undefined>): string
  export const OPTOUT_FOOTER = 'Balas BERHENTI untuk tidak menerima pesan ini lagi.'
  export function withFooter(text: string): string          // menambahkan kaki tepat sekali (tidak dobel)
  export function lintMessage(text: string, ctx: { businessName: string; lastCampaignText?: string }): { errors: string[]; warnings: string[] }
  ```
- [ ] **Step 1: Tes gagal.** `limits.test.ts`: tabel §8 persis; `effectiveTier` naik sendiri (deklarasi 25 hari → `baru`; setelah 6 hari berlalu → `berkembang`), tidak pernah turun; `warmupCap(1)=10`, `(2)=12`, `(3)=15`, tumbuh hingga `dailyCap` tidak melewati batas tingkat (`dailyCap('baru', 30) = 20`, `('mapan', 1) = 10`, `('mapan', 30) = 200`); `activeDayIndex` menghitung hari berbeda berurutan dan kembali ke 1 setelah jeda >14 hari; `nextDelayMs` dengan `rand` 0 → 20 000, 0.999… → <60 000, tidak pernah di luar rentang; `batchPauseMs` 180 000–480 000; `inSendWindow` benar pada 09:00 (ya), 08:59 (tidak), 19:59 (ya), 20:00 (tidak) di zona `Asia/Makassar` terlepas dari zona mesin; `nextWindowStart` setelah 20:30 menunjuk 09:00 besok. `lint.test.ts`: `withFooter` menambah kaki sekali dan idempoten, kaki tidak bisa disembunyikan (teks yang sudah memuat kaki tidak ditambah ulang; teks tanpa tetap ditambah); `renderTemplate` mengisi `{nama}`/`{bisnis}` dan mengosongkan variabel tak dikenal tanpa meninggalkan kurung; kesalahan bila > 600 karakter, > 1 tautan, tautan pemendek (`bit.ly`, `tinyurl.com`, `t.co`, `s.id`), atau tidak memuat nama bisnis; peringatan bila huruf kapital > 40% atau teks sama persis dengan `lastCampaignText`; teks sehat tanpa error maupun peringatan.
- [ ] **Step 2:** `npx vitest run tests/broadcast/limits.test.ts tests/broadcast/lint.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementasikan** dua modul murni. `inSendWindow` memakai `Intl.DateTimeFormat` dengan zona yang diberikan (pola `isWithinHours` di `conversation/handoff.ts`).
- [ ] **Step 4:** jalankan tes + `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(broadcast): limits, send window and message lint`.

---

### Task 3: Gerbang pengiriman dan pemutus sirkuit (murni)

**Files:** Create `src/main/broadcast/gate.ts`, `src/main/broadcast/breaker.ts`; Test `tests/broadcast/gate.test.ts`, `tests/broadcast/breaker.test.ts`

**Interfaces:**
- Consumes: `limits.ts`, `BContact`, `Tier`.
- Produces:
  ```ts
  export type GateDecision =
    | { kind: 'allow' }
    | { kind: 'wait'; until: number; why: string }
    | { kind: 'skip'; reason: string }
    | { kind: 'halt'; reason: string }
  export interface GateContext {
    now: number; connected: boolean; globalEnabled: boolean; busy: boolean
    tier: Tier; window: { start: string; end: string; timezone: string }
    activeDay: number
    counters: { sentToday: number; sentThisHour: number; newToday: number; sinceBatchPause: number; lastSentAt: number | null; batchPausedUntil: number | null }
    kind: CampaignKind
    minGapDays: number                                  // 3–7
    isSuppressed(c: BContact): boolean
    contactHistory: { lastSentAt: number | null; sentLast30d: number; neverSent: boolean }
  }
  export function checkSend(contact: BContact, ctx: GateContext): GateDecision
  // breaker.ts
  export interface Outcome { at: number; ok: boolean; kind: CampaignKind; toNonChat: boolean }
  export interface Signals { optOuts: number; complaints: number; replies: number }
  export function evaluateBreaker(recent: Outcome[], sig: { lastOptOuts: number; lastComplaints: number; repliesAmongNonChat: number }, kind: CampaignKind): { trip: false } | { trip: true; reason: string }
  ```
  Urutan keputusan `checkSend` (yang pertama cocok menang): `halt` bila `!connected` atau `!globalEnabled`; `skip('tolak')` bila `isSuppressed`; `skip('tidak_aktif')` bila status `tidak_aktif`; `skip('menunggu_persetujuan')` bila status itu dan `kind` bukan `konfirmasi`; `skip('nomor_tidak_diketahui')` bila `number` null; `wait` sampai jam kirim berikutnya di luar jendela; `wait` bila `busy`; `wait` sampai `batchPausedUntil`; `wait` sampai jam berikutnya bila `sentThisHour ≥ 15`; `wait` sampai awal jendela hari berikut bila `sentToday ≥ dailyCap`; `wait` serupa bila kontak baru dan `newToday ≥ newContacts`; `skip('terlalu_cepat')` bila `lastSentAt` < `minGapDays`; `skip('batas_30_hari')` bila `sentLast30d ≥ 4`; selain itu `allow`.

- [ ] **Step 1: Tes gagal.** `gate.test.ts` — satu tes per aturan di atas dengan konteks dasar yang memperbolehkan; plus: urutan (kontak tertolak di luar jam kirim → `skip`, bukan `wait`); konfirmasi untuk `menunggu_persetujuan` diizinkan sedangkan broadcast biasa tidak; batas harian memakai `dailyCap(tier, activeDay)` (pemanasan: `baru`, hari 1, `sentToday=10` → `wait`); kontak baru dihitung hanya bila `neverSent`; batas persis (14 vs 15 per jam, 29 hari vs 30) diuji di kedua sisi; `wait.until` selalu > `now`. `breaker.test.ts`: 3 gagal beruntun → trip; 4 dari 20 gagal (20%) → trip, 3 dari 20 → tidak; `lastOptOuts ≥ 3` dalam 30 terakhir → trip; `lastComplaints ≥ 1` → trip; ≥ 30 terkirim ke non-chat dengan 0 balasan → trip untuk `broadcast` tetapi untuk `konfirmasi` ambang 20; 29 terkirim 0 balasan → tidak; riwayat kosong → tidak trip; alasan berupa teks Indonesia yang tidak kosong.
- [ ] **Step 2:** `npx vitest run tests/broadcast/gate.test.ts tests/broadcast/breaker.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementasikan** dua fungsi murni.
- [ ] **Step 4:** jalankan tes + `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(broadcast): send gate and circuit breaker`.

---

### Task 4: Penangan berhenti/mulai di pipeline

**Files:** Create `src/main/broadcast/optout.ts`, `src/main/broadcast/optout-handler.ts`; Modify `src/main/pipeline/reply-pipeline.ts`; Test `tests/broadcast/optout.test.ts`, `tests/broadcast/optout-handler.test.ts`, `tests/reply-pipeline.test.ts`

**Interfaces:**
- Consumes: `BroadcastStore`, `MessageFeed`/`WaGateway`, `ConversationStore.isPaused`.
- Produces:
  ```ts
  // optout.ts
  export function classifyReply(text: string): 'stop' | 'start' | 'complaint' | null
  export const STOP_CONFIRMATION: string, START_CONFIRMATION: string
  // optout-handler.ts
  export class OptOutHandler {
    constructor(d: { store: BroadcastStore; clock: { now(): number }; wasBroadcastTo(key: { number: string | null; jid: string }): boolean; reply(chatId: string, text: string): Promise<void>; isHumanHandling(chatId: string): boolean; onSignal(kind: 'optout' | 'complaint' | 'reply'): void })
    /** true bila pesan sudah ditangani dan TIDAK boleh diteruskan ke agen. */
    handle(m: IncomingMessage): Promise<boolean>
  }
  // PipelineDeps tambahan (opsional): optOut?: OptOutHandler ; PipelineResult.ignored.why tambah 'opt_out'
  ```
  Aturan `classifyReply`: seluruh pesan ternormalisasi (huruf kecil, tanpa tanda baca, spasi dirapikan) ≤ 40 karakter dan sama dengan atau diawali kata kunci: stop `berhenti`, `stop`, `unsubscribe`, `batal langganan`, `jangan kirim lagi`, `hapus nomor saya`; start `mulai`, `start`, `langganan`; complaint `spam`, `laporkan`, `penipu`. Pesan lebih panjang atau kata di tengah kalimat → `null`.
  `handle`: bukan grup dan tidak stale. `start` dari kontak tertolak (`berhenti`) → `unsuppress` + balasan `START_CONFIRMATION` → `true`. `stop`: bila `wasBroadcastTo` → `suppress('berhenti')`, balasan `STOP_CONFIRMATION` sekali (kecuali `isHumanHandling`), `onSignal('optout')`, `true`; bila **belum pernah** dikirimi → `suppress('tolak_lunak')` tanpa balasan dan **`false`** (tetap ke agen). `complaint`: `suppress('laporan')`, `onSignal('complaint')`, notifikasi admin lewat event, `false` jika belum pernah dikirimi broadcast. Pesan lain dari kontak broadcast → `store.recordInbound` + `onSignal('reply')` → `false`.

- [ ] **Step 1: Tes gagal.** `optout.test.ts`: tabel kasus (`BERHENTI`, `stop.`, `Stop!!`, `  berhenti  ` → stop; `mulai`, `MULAI` → start; `spam` → complaint; `jangan stop dulu ya`, `berhenti di jalan?`, `aku mau stop kontrak minggu depan`, `start up saya`, teks > 40 karakter yang diawali "stop" → `null`; `''` → `null`). `optout-handler.test.ts` (store `:memory:`, balasan ditangkap): stop dari kontak yang pernah dikirimi → tertolak, satu balasan konfirmasi, `true`; stop kedua dari kontak yang sudah tertolak → tidak ada balasan kedua; stop dari orang yang belum pernah dikirimi → `tolak_lunak` tercatat, tanpa balasan, `false`; saat `isHumanHandling` → tercatat tanpa balasan; `mulai` mencabut tolak `berhenti` tetapi **tidak** mencabut `tolak_lunak`/`laporan`/`admin`; grup dan pesan stale → `false` tanpa efek; balasan biasa dari kontak `menunggu_persetujuan` → `aktif` dan sinyal `reply`; `complaint` dari kontak yang pernah dikirimi → tertolak + sinyal. `reply-pipeline.test.ts`: dengan `optOut` terpasang, "BERHENTI" dari kontak yang pernah dikirimi tidak memanggil agen/AI (provider tidak dipanggil) dan hasilnya `ignored: opt_out` dan decision log `ignored:opt_out`; "stop" dari orang baru tetap dijawab agen seperti biasa; perilaku tanpa `optOut` tidak berubah (tes lama hijau).
- [ ] **Step 2:** `npx vitest run tests/broadcast/optout.test.ts tests/broadcast/optout-handler.test.ts tests/reply-pipeline.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementasikan** `classifyReply`, `OptOutHandler`, dan pemanggilan di `ReplyPipeline.process` **setelah** pengecekan status/teks/grup/stale dan **sebelum** pengecekan `isPaused` (supaya tercatat walau chat diambil alih manusia). Balasan konfirmasi dikirim lewat `send()` pipeline (tercatat di feed, id diingat).
- [ ] **Step 4:** jalankan tes + `npm test && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(broadcast): opt-out handler before the agent`.

---

### Task 5: `onWhatsApp` dan layanan impor

**Files:** Create `src/main/broadcast/import.ts`; Modify `src/main/wa/gateway.ts`, `src/main/wa/baileys-gateway.ts`, semua `FakeGateway` di `tests/*`; Test `tests/broadcast/import.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // WaGateway tambahan
  onWhatsApp(numbers: string[]): Promise<{ number: string; jid: string | null; exists: boolean }[]>
  // import.ts
  export const MAX_IMPORT_ROWS = 20_000
  export interface ImportPreview { total: number; valid: { number: string; name: string; vars: Record<string,string> }[]; invalid: { row: number; value: string; reason: string }[]; duplicates: number }
  export function parseImport(file: { name: string; data: Uint8Array | string }): ImportPreview   // CSV/XLSX; kolom 'nomor' wajib, 'nama' opsional, sisanya vars
  export class ImportService {
    constructor(d: { store: BroadcastStore; gateway: WaGateway; clock: { now(): number }; sleep(ms: number): Promise<void> })
    commit(preview: ImportPreview, attest: { accepted: boolean; sourceNote: string }): Promise<{ importId: number; added: number; notOnWhatsApp: number; blockedBySuppression: number; aborted: boolean }>
  }
  ```
  Aturan `commit`: `accepted` harus `true` dan `sourceNote.trim().length ≥ 10` (kalau tidak melempar `Error('ATTEST_REQUIRED')`); nomor tertolak (daftar tolak/tombstone) dibuang dan dihitung; validasi `onWhatsApp` per kelompok 25 nomor dengan `sleep` 1–2 detik antar kelompok; nomor tidak terdaftar masuk daftar tolak `tidak_terdaftar` dan dibuang; bila > 30% tidak terdaftar → `aborted: true` dan **tidak ada** kontak yang disimpan; kontak yang lolos disimpan `source: 'impor'`, `status: 'menunggu_persetujuan'`, dengan JID dari hasil `onWhatsApp`; kontak yang sudah ada sebagai kontak chat tidak diturunkan statusnya.

- [ ] **Step 1: Tes gagal.** `import.test.ts` (FakeGateway dengan `onWhatsApp` skrip): `parseImport` CSV dengan kolom `nomor,nama,paket` memisahkan `valid` (nomor dinormalisasi, `vars.paket`), `invalid` (nomor pendek, kosong, dengan nomor baris dan alasan), `duplicates` (nomor sama dalam format berbeda); tanpa kolom `nomor` → melempar galat yang jelas; XLSX sama; file dengan > 20.000 baris ditolak; header berhuruf besar/spasi (` Nomor `) dikenali. `commit`: tanpa pernyataan atau keterangan < 10 karakter → `ATTEST_REQUIRED` dan tidak ada tulisan ke DB; nomor di daftar tolak dibuang dan dihitung `blockedBySuppression`; nomor tidak terdaftar masuk daftar tolak dan tidak jadi kontak; 40% tidak terdaftar → `aborted: true` dan DB tetap kosong; sukses menyimpan `menunggu_persetujuan` dengan JID dari gateway; `sleep` dipanggil di antara kelompok (bukan sebelum yang pertama); kontak chat yang sudah `aktif` tetap `aktif`; lot impor tercatat dengan keterangan sumber dan waktu.
- [ ] **Step 2:** `npx vitest run tests/broadcast/import.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementasikan.** `BaileysGateway.onWhatsApp` memakai `sock.onWhatsApp(...numbers.map(jidFor))` dan memetakan hasil; tambahkan `onWhatsApp` ke setiap `FakeGateway` di tes (mengembalikan `exists: true` secara bawaan). Parsing memakai `xlsx` (CSV juga).
- [ ] **Step 4:** `npx vitest run && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(broadcast): onWhatsApp and the consent-gated import`.

---

### Task 6: Audiens dan BroadcastEngine

**Files:** Create `src/main/broadcast/audience.ts`, `src/main/broadcast/engine.ts`; Modify `src/main/broadcast/store.ts` (kampanye, antrean, penghitung); Test `tests/broadcast/audience.test.ts`, `tests/broadcast/engine.test.ts`

**Interfaces:**
- Consumes: Task 1–5.
- Produces:
  ```ts
  // audience.ts
  export function syncChatContacts(db: Db, store: BroadcastStore, now: number): number   // kontak chat dari message_log ∪ messages (masuk, bukan grup/broadcast, ≤ 365 hari); mengembalikan jumlah baru
  // store tambahan
  createCampaign(c: { name: string; kind: CampaignKind; template: string; audience: 'chat'|'impor'|'semua'; notBefore?: number | null }): Campaign
  preview(campaignId: number, now: number): { eligible: number; skipped: Record<string, number>; estimatedDays: number }
  enqueue(campaignId: number): number                 // satu baris 'antre' per penerima layak
  setCampaignStatus(id: number, status: CampaignStatus, pauseReason?: string): void
  nextQueued(campaignId: number): { send: SendRow; contact: BContact } | null
  recordSend(sendId: number, r: { status: 'terkirim'|'gagal'|'dilewati'; reason?: string; waId?: string | null; at: number }): void
  counters(now: number, tz: string): { sentToday: number; sentThisHour: number; newToday: number; sendDays: string[]; lastSentAt: number | null }
  // engine.ts
  export class BroadcastEngine extends EventEmitter {   // 'progress' | 'paused' | 'done' | 'confirmations'
    constructor(d: { store: BroadcastStore; gateway: WaGateway; feed?: MessageFeed; conv: ConversationStore; clock; rand: () => number; sleep?: (ms:number)=>Promise<void>; isBusy(): boolean; settings(): SafetySettings; businessName(): string })
    start(campaignId: number): void        // 'terjadwal'/'dijeda'/'draf' → 'berjalan' bila tidak ada kampanye berjalan lain, selain itu 'terjadwal'
    pause(id: number, reason?: string): void; stop(id: number): void; stopAll(): void
    tick(): Promise<void>                  // satu langkah; aman dipanggil berulang
    startTimer(ms?: number): void; stopTimer(): void
    onSignal(kind: 'optout' | 'complaint' | 'reply'): void
    resetAfterRestart(): void              // 'berjalan' → 'dijeda'('aplikasi dimulai ulang')
  }
  export interface SafetySettings { enabled: boolean; ageDays: number; declaredAt: number; window: { start: string; end: string; timezone: string }; minGapDays: number }
  ```
  `tick`: bila ada kampanye `berjalan` ambil `nextQueued`; bangun `GateContext` dari `counters` dan `SafetySettings`; `checkSend`: `halt` → `pause(reason)` + event `paused`; `wait` → tunda (jangan kirim, jangan ubah status); `skip` → `recordSend('dilewati', reason)`; `allow` → render pesan (`renderTemplate` + `withFooter`), `gateway.sendText(jid, text, { typingMs: 2000–5000 })`, `recordSend('terkirim')`, `feed.recordOutgoing`, `conv.rememberSentId(waId)`, perbarui `last_sent_at` dan `sent_count`, jadwalkan jeda berikutnya (`nextDelayMs`, atau `batchPauseMs` tiap 10), lalu `evaluateBreaker` dan `pause` bila trip. Galat kirim → `recordSend('gagal', galat)` lalu evaluasi pemutus. Antrean kosong → `selesai` + event `done`; kampanye `terjadwal` berikutnya dimulai.

- [ ] **Step 1: Tes gagal.** `audience.test.ts`: kontak chat dibuat dari `message_log` dan `messages` (digabung, tanpa dobel), grup/`@broadcast`/pesan > 365 hari dikecualikan, chat `@lid` masuk dengan `number: null`, dijalankan dua kali tidak menggandakan. `engine.test.ts` (FakeGateway, `clock` yang bisa maju, `sleep`/`rand` terkendali, DB `:memory:`): kampanye 3 penerima terkirim berurutan dengan jeda 20–60 dtk (tik sebelum jeda habis tidak mengirim); **penerima yang berhenti setelah kampanye dibuat tidak dikirimi** (`dilewati: tolak`); `menunggu_persetujuan` dilewati di kampanye `broadcast` tetapi dikirimi di `konfirmasi`; batas harian pemanasan (tier `baru`, hari 1 → hanya 10 terkirim hari itu, sisanya `antre` dan berlanjut pada hari berikutnya dalam jam kirim); di luar jam kirim tidak ada pengiriman; restart (instance engine/store baru pada DB yang sama) mempertahankan penghitung dan `resetAfterRestart` menjeda kampanye `berjalan` tanpa melanjutkannya; kegagalan beruntun menjeda dengan alasan dan tidak lanjut pada tik berikutnya; koneksi terputus → jeda `halt`; saklar global mati → tidak ada pengiriman; `stopAll` menghentikan semua dan tik berikutnya tidak mengirim; hanya satu kampanye `berjalan` (yang kedua `terjadwal`, otomatis mulai setelah yang pertama `selesai`); `isBusy` true → menunggu; setiap pesan terkirim memuat kaki berhenti dan nama bisnis dan dicatat ke feed sebagai `out` dan id-nya diingat (`conv.isSentId`); gema pesan yang sama lewat pipeline tidak menjeda chat; pratinjau menghitung `eligible`, alasan `skipped`, dan `estimatedDays` sesuai batas; `onSignal('optout')` x3 dalam 30 pengiriman menjeda.
- [ ] **Step 2:** `npx vitest run tests/broadcast/audience.test.ts tests/broadcast/engine.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementasikan** audiens, tambahan store, dan engine; penghitung harian/jam dari `broadcast_sends` dalam zona waktu pengaturan; satu `tick` memproses paling banyak satu pengiriman; satu tik dijalankan pada satu waktu (kunci reentrancy).
- [ ] **Step 4:** `npx vitest run && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(broadcast): audience sync and the sending engine`.

---

### Task 7: Pengaturan keamanan, IPC, dan penyambungan main

**Files:** Modify `src/shared/{broadcast,ipc,channels}.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/main/broadcast/store.ts`; Create `src/main/broadcast/ipc.ts`; Test `tests/broadcast/ipc.test.ts`, `tests/ipc-schema.test.ts`

**Interfaces:**
- Produces `createBroadcastHandlers(d)` (pola `createBrandHandlers`) dengan metode berikut dan padanannya di `Api`/`CHANNELS` (`bc:*`): `bcOverview()`, `bcContacts(filter)`, `bcSuppressed()`, `bcImportPreview(file)`, `bcImportCommit(previewId, attest)`, `bcSendConfirmations(importId)`, `bcCampaigns()`, `bcCreateCampaign(input)`, `bcPreviewCampaign(id)`, `bcStartCampaign(id, confirmText?)`, `bcPauseCampaign(id)`, `bcResumeCampaign(id)`, `bcStopCampaign(id)`, `bcStopAll()`, `bcGetSafety()`, `bcSetSafety(patch)`, `bcReport(id)`, `bcExportReport(id)`, `bcEraseContact(id)`; event `evtBroadcast` (`progress`/`paused`/`done`). `SafetySettings` disimpan di `broadcast_state`.
- Aturan: semua penulis (`create/start/pause/resume/stop/stopAll/setSafety/import/erase`) menolak bila terkunci; `bcStartCampaign` untuk > 50 penerima mensyaratkan `confirmText === 'KIRIM'`; `bcSetSafety` menolak `minGapDays` di luar 3–7, jam kirim tidak sah, dan **tidak menerima** perubahan tingkat naik (usia hanya bisa dideklarasikan sekali; `reset` lewat `bcSetSafety({ changeNumber: true })` yang mengulang pemanasan dan memerlukan `confirm: true`); `bcExportReport` mengembalikan CSV dengan sel berawalan `=`, `+`, `-`, `@` diberi tanda kutip tunggal di depan; `bcStopAll` dapat dipanggil kapan pun (juga saat terkunci).
- [ ] **Step 1: Tes gagal.** `broadcast/ipc.test.ts` (tanpa Electron, handler murni): tulis ditolak saat `locked`; `bcStopAll` tetap jalan saat terkunci; mulai > 50 penerima tanpa `KIRIM` ditolak, dengan `KIRIM` berhasil, ≤ 50 tanpa teks berhasil; `bcSetSafety` menolak `minGapDays: 2` dan `8`, jam `25:00`, dan upaya menaikkan usia; `changeNumber` tanpa `confirm` ditolak, dengan `confirm` mengulang pemanasan; ekspor CSV menetralkan sel rumus (`=1+1`, `+62`, `-x`, `@cmd` → diawali `'`) dan mengutip koma/baris baru; validasi zod menolak id/isi tak sah (string terlalu panjang, bukan angka). `ipc-schema.test.ts`: skema impor/atestasi menolak keterangan < 10 karakter; kanal `bc:*` tidak diawali `auth:` (tetap berpagar).
- [ ] **Step 2:** `npx vitest run tests/broadcast/ipc.test.ts tests/ipc-schema.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementasikan** handler, skema, channel, preload, `registerIpc`, dan di `index.ts`: buat `BroadcastStore`, `OptOutHandler` (tersambung ke pipeline dengan `wasBroadcastTo` dari store dan `onSignal` ke engine), `BroadcastEngine` (`isBusy` dari pipeline: ada pengiriman balasan dalam 5 detik terakhir), panggil `resetAfterRestart()` lalu `startTimer()`, `syncChatContacts` saat boot dan tiap 10 menit, teruskan event engine lewat `send(C.evtBroadcast, …)`, dan notifikasi desktop saat kampanye dijeda otomatis (isi disamarkan saat terkunci).
- [ ] **Step 4:** `npx vitest run && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(broadcast): safety settings, IPC and main wiring`.

---

### Task 8: UI — halaman Broadcast, Penerima, Keamanan

**Files:** Create `src/renderer/pages/BroadcastPage.tsx`, `src/renderer/broadcast/{RecipientsTab,ImportWizard,SafetyTab}.tsx`; Modify `src/renderer/nav.tsx`, `src/renderer/i18n/id.ts`; Test `tests/renderer/broadcast-recipients.test.tsx`, `tests/renderer/broadcast-safety.test.tsx`, sesuaikan `nav.test.tsx`

**Interfaces:** Consumes `Api.bc*` (Task 7), komponen `ui/*`. `NavKey` bertambah `'broadcast'` (ikon `bi-megaphone`) tepat setelah "Pesan". Halaman punya satu `h2` "Broadcast", catatan jalur resmi (Business Platform) sebagai banner dapat ditutup, dan tab: Kampanye, Penerima, Keamanan, Laporan.
- [ ] **Step 1: Tes gagal.** Nav: "Broadcast" ada setelah "Pesan". Penerima: tabel (nomor, nama, sumber, status berteks, terakhir dikirim) dengan memuat/kosong/galat; penyaring status; kartu "N kontak menunggu konfirmasi" dengan tombol "Kirim konfirmasi" yang memanggil `bcSendConfirmations`; daftar tolak hanya-baca **tanpa** tombol hapus/cabut; hapus data kontak memakai `ConfirmButton` dua langkah; **Impor**: langkah 1 memilih berkas → pratinjau (jumlah valid/tidak valid/duplikat, contoh baris galat), langkah 2 pernyataan: tombol "Impor" nonaktif sampai kotak persetujuan dicentang **dan** keterangan sumber ≥ 10 karakter; `bcImportCommit` dipanggil dengan nilai itu; hasil menampilkan dibuang/tidak terdaftar/`aborted` dengan peringatan kualitas daftar. Keamanan: menampilkan tingkat efektif, batas harian hari ini (dengan pemanasan), jam kirim, jarak minimal per kontak (3–7), indikator kesehatan berteks (Aman / Hati-hati / Dijeda + alasan); tidak ada kontrol untuk menaikkan tingkat; "Saya mengganti nomor" butuh konfirmasi; saklar "Broadcast aktif"; tombol "Hentikan semua" selalu ada.
- [ ] **Step 2:** `npx vitest run tests/renderer/broadcast-recipients.test.tsx tests/renderer/broadcast-safety.test.tsx tests/renderer/nav.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implementasikan** halaman dan tab (tab Kampanye dan Laporan diisi di Task 9; sementara placeholder `EmptyState`).
- [ ] **Step 4:** `npx vitest run tests/renderer && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): broadcast page with recipients, import and safety tabs`.

---

### Task 9: UI — kampanye, wizard, progres, laporan

**Files:** Create `src/renderer/broadcast/{CampaignsTab,CampaignWizard,ReportTab}.tsx`; Modify `src/renderer/pages/BroadcastPage.tsx`; Test `tests/renderer/broadcast-campaigns.test.tsx`

- [ ] **Step 1: Tes gagal.** Daftar kampanye dengan status berteks; wizard 4 langkah: (1) audiens (Chat aktif / Impor aktif / Gabungan) dengan catatan "dihitung dari pesan yang tercatat aplikasi", (2) pesan: penyunting dengan variabel, pratinjau hasil render untuk 3 penerima contoh, kaki berhenti tampil terkunci/tidak dapat diedit, pemeriksa isi menampilkan error (menghalangi lanjut) dan peringatan, (3) tinjau: jumlah layak, jumlah dilewati beserta alasan, perkiraan selesai dalam hari, daftar periksa keamanan wajib dicentang, (4) jadwal dan konfirmasi: di atas 50 penerima tombol Mulai nonaktif sampai mengetik `KIRIM`; memulai memanggil `bcStartCampaign`; saat berjalan kartu progres (terkirim/gagal/dilewati/antre) diperbarui dari event `onBroadcast`, tombol Jeda/Lanjutkan/Hentikan (`ConfirmButton` untuk Hentikan) dan "Hentikan semua"; kampanye yang dijeda otomatis menampilkan alasan dalam banner dan tidak ada tombol yang melanjutkan otomatis; Laporan: ringkasan terkirim/gagal/dilewati(+alasan)/berhenti/membalas dan tombol "Ekspor CSV" yang memanggil `bcExportReport`; langganan event dilepas saat halaman ditutup; terkunci → tombol tulis tidak terlihat bila `LOCKED`.
- [ ] **Step 2:** `npx vitest run tests/renderer/broadcast-campaigns.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implementasikan** komponen memakai `Card`, `PageHeader`, `StatusBadge`, `DataTable`, `ConfirmButton`, `States`.
- [ ] **Step 4:** `npx vitest run tests/renderer && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): campaign wizard, live progress and reports`.

---

### Task 10: Dokumen, regresi, dan tinjauan

**Files:** Modify `docs/manual-acceptance.md`, `PRD.md`

- [ ] **Step 1:** Tambah bagian "Broadcast aman" (B-1…B-14) di `docs/manual-acceptance.md` untuk nomor sekunder: impor tanpa pernyataan tidak bisa; nomor tidak terdaftar dibuang; konfirmasi hanya jalan setelah ditekan dan terkirim dengan kaki berhenti; kontak impor baru menerima broadcast setelah membalas; "BERHENTI" menghentikan kiriman berikutnya < 5 dtk dan bot tidak menjawab pesan itu; "BERHENTI" dari orang baru tetap dijawab bot; penerima yang berhenti setelah kampanye dibuat dilewati; batas harian pemanasan; jam kirim; jeda 20–60 dtk terlihat; putuskan jaringan → kampanye dijeda dan tidak lanjut sendiri setelah tersambung; mulai ulang aplikasi → kampanye `dijeda`; "Hentikan semua"; saat terkunci kampanye berjalan tetapi tidak bisa dimulai/diubah; ekspor CSV tanpa injeksi rumus; gema pesan broadcast tidak menjeda bot di chat itu. Perbarui PRD §5.3 dengan rujukan ke spec.
- [ ] **Step 2:** `npm test && npm run typecheck` — Expected: suite hijau; sebutkan tes yang gagal bila ada. Pindai literal warna di `src/renderer` di luar `tokens.css` — Expected: kosong.
- [ ] **Step 3:** Tinjauan seluruh branch oleh pengulas segar sesuai executing-plans (fokus: Review Focus di atas); perbaiki Critical/Important dengan TDD.
- [ ] **Step 4: Commit** `docs: acceptance steps for safe broadcast`.
