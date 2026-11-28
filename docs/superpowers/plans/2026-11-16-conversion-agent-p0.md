# Conversion Agent P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengubah mode AI dari "tanya-jawab dokumen" menjadi agen percakapan yang mengarahkan pelanggan WhatsApp ke checkout atau ke admin manusia, dengan semua brand dan arah konversi diatur pengguna lewat halaman Brand & Konversi.

**Architecture:** Satu `BrandProfile` (JSON ber-versi, divalidasi zod) menjadi sumber kebenaran untuk prompt, aturan arah, daftar tautan, dan admin. Model hanya menyarankan (JSON terstruktur: maksud, balasan, saran tindakan); kode memutuskan tindakan lewat mesin aturan dan menyaring keluaran (nomor bot, URL, angka). Memori percakapan, serah ke admin, dan pengambilalihan manusia disimpan di SQLite. Mode "tanpa AI" tidak berubah.

**Tech Stack:** TypeScript, Electron, better-sqlite3, zod, vitest, React + Bootstrap 5 (sudah ada di repo).

**Spec:** [`docs/superpowers/specs/2026-11-16-conversion-agent-design.md`](../specs/2026-11-16-conversion-agent-design.md) bagian 2–9, 15 (P0), 17. Di luar rencana ini: halaman Percakapan dan Leads, corong dan ekspor CSV, anggaran token berjalan, deteksi bot lawan, ringkasan berjalan, mode Hybrid per produk, follow-up otomatis, webhook, wizard lengkap (P1/P2).

## Global Constraints

- Kode yang sudah ada tetap berlaku: Baileys hanya di `src/main/wa/baileys-gateway.ts`; renderer sandbox; preload hanya mengimpor `src/shared/channels.ts`; tidak ada channel IPC yang mengembalikan API key; UI memakai Bootstrap 5 yang di-bundle; bahasa UI Indonesia.
- Mode `extractive` berperilaku persis seperti sekarang (semua tes lama untuk mode itu tetap hijau).
- Pagar inti **tidak bisa dimatikan** lewat UI maupun impor profil: penjaga nomor sendiri, allowlist URL, pemeriksaan angka, pembatasan di luar konteks.
- Nomor admin harus berbeda dari nomor bot; tujuan `checkout` wajib punya minimal satu tautan checkout atau produk berpautan.
- URL yang boleh dikirim: hanya dari `profile.links` + `checkout_url` katalog, wajib `https://`.
- Default (dapat diubah pengguna): jeda bot setelah manusia mengambil alih **6 jam**; memori **10 pesan terakhir**; maksimal **3 gelembung** per jawaban; jeda mengetik **40–60 ms per karakter**, dijepit **1000–6000 ms**; serah paksa setelah **6 giliran** tanpa kemajuan atau **2 kali** keyakinan rendah (`confidence < 0.5`) berturut-turut; jam kerja default 09:00–17:00 Asia/Makassar Senin–Jumat; riwayat versi profil **20**.
- Saluran serah default: notifikasi desktop **dan** pesan WhatsApp ke nomor admin. Satu mode bisnis per instalasi (`produk` atau `jasa`).
- Tidak ada perintah dari pesan pelanggan, isi dokumen, atau riwayat yang mengubah aturan; model tidak punya alat selain menghasilkan teks.
- Pekerjaan multi-provider AI di working tree (`src/shared/providers.ts`, `make-provider.ts`, `openai-provider.ts`, perubahan `ipc.ts`, `AiSettings.tsx`, dll.) bukan bagian rencana ini: **jangan di-commit oleh task mana pun** (`git add` hanya path milik task).

## Review Focus

1. Model mengeluarkan nomor bot, URL di luar allowlist, atau harga yang tidak ada di konteks → harus disaring, dan pelanggan tidak pernah menerimanya. *(Task 2, 10)*
2. Admin membalas dari HP saat bot sedang menyusun jawaban → jawaban bot dibatalkan dan chat berstatus manusia; pesan `fromMe` bisa tiba bertipe `append`, bukan hanya `notify`. *(Task 7, 9, 10)*
3. JSON model rusak/terpotong, provider error, atau timeout → pelanggan menerima balasan aman (bukan galat, bukan JSON mentah). *(Task 5, 10)*
4. Pesan campur bahasa, singkatan, dan typo berat ("brp biaya bkin web?"), serta pesan beruntun cepat dari satu kontak. *(Task 4, 10)*
5. Profil tidak lengkap: tujuan checkout tanpa tautan, katalog kosong, jam kerja kosong, impor profil rusak → ditolak atau turun ke serah ke admin, tidak crash. *(Task 1, 3, 10, 12)*

---

## File Structure

```
src/shared/brand.ts               BrandProfile zod schema, tipe, presets, validateProfile
src/main/brand-store.ts           BrandStore (versi, draf, terapkan, ekspor/impor)
src/main/policy/guards.ts         penjaga nomor, filter URL, pemeriksa angka, sanitasi chunk
src/main/policy/rules.ts          evaluateRules, forcedHandoffReason
src/main/catalog/catalog-store.ts parseCatalog, CatalogStore, buildLinkAllowlist
src/main/conversation/store.ts    ConversationStore (turn, state, lead, takeover, event)
src/main/conversation/handoff.ts  HandoffService, isWithinHours
src/main/conversation/bubbles.ts  splitBubbles, typingMsFor
src/main/answer/agent.ts          AgentOutput schema, buildSystemPrompt, buildUserPrompt, runAgent
src/main/pipeline/conversation-agent.ts  orkestrasi satu giliran agen
src/main/db.ts                    migrasi 3–5
src/renderer/pages/BrandPage.tsx  + src/renderer/brand/*.tsx  UI Brand & Konversi
tests/                            cermin src/main, src/shared
```

---

### Task 1: BrandProfile, validasi, presets, BrandStore

**Files:**
- Create: `src/shared/brand.ts`, `src/main/brand-store.ts`; Modify: `src/main/db.ts` (migrasi 3: tabel `brand_versions(version INTEGER PRIMARY KEY, json TEXT, created_at INTEGER)` dan `brand_draft(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT)`)
- Test: `tests/brand.test.ts`, `tests/brand-store.test.ts`

**Interfaces:**
- Produces:
  - Tipe: `Intent`, `ActionKind = 'send_checkout'|'send_link'|'handoff'|'ask_lead'|'reply_only'|'silent'`, `Rule { id; enabled; when: { intents?; keywords?; productId?; withinHours?; minTurns?; leadComplete? }; then: { action; linkId?; productId?; adminId?; message? }; maxPerContact? }`, `LinkEntry { id; name; kind: 'checkout'|'booking'|'catalog'|'form'|'site'; url; tracking; productId? }`, `AdminEntry { id; name; number; notifyWhatsapp }`, `LeadQuestion { key; text; required; order; skipWords }`.
  - `BrandProfileSchema` (zod `strictObject`) dan `type BrandProfile` dengan: `version`, `businessType: 'produk'|'jasa'`, `preset`, `identity { businessName; botName; about(≤500); language }`, `style { tone; greeting; emoji: 0|1|2; length; mustWords; bannedWords; introduceAsBot; introText; examples[] }`, `goal: 'checkout'|'handoff'|'lead'|'booking'|'form'`, `rules[]`, `links[]`, `admins[]`, `leadQuestions[]`, `leadMinimum: string[]`, `objections[]`, `templates { handoffFarewell; checkout; outsideHours; unknown }`, `hours { timezone; days: Record<'0'|…|'6', {open;close}|null> }`, `limits { pauseHours; maxRepliesPerHour; dailyTokenBudget }`, `bannedTopics: string[]`.
  - `PRESETS: Record<'toko_online'|'jasa_agensi'|'kuliner'|'klinik_salon'|'pendidikan'|'properti'|'kustom', BrandProfile>` — `toko_online` memuat aturan awal dari spec 17.3 (komplain→handoff; siap_beli→send_checkout; tanya_harga→reply_only; tautan checkout kosong→handoff); `jasa_agensi` memuat enam aturan awal spec 17.3.
  - `type Issue = { level: 'error'|'warn'; field: string; message: string }`; `validateProfile(p: BrandProfile, ctx: { botNumber: string | null; productCount: number }): Issue[]`.
  - `class BrandStore { constructor(db: Db, clock: { now(): number }); getActive(): BrandProfile; getDraft(): BrandProfile; saveDraft(p: unknown): { ok: boolean; issues: Issue[] }; apply(ctx): { ok: boolean; issues: Issue[]; version?: number }; listVersions(): { version: number; createdAt: number }[]; restore(version: number): BrandProfile; exportJson(): string; importJson(json: string): { ok: boolean; issues: Issue[] } }`. Profil awal = `PRESETS.kustom` versi 0. `apply` menolak bila ada issue `error`; menyimpan maksimal 20 versi terbaru; `restore` menjadikan versi lama sebagai draf lalu menerapkannya sebagai versi baru. `exportJson` tidak memuat rahasia apa pun; `importJson` memvalidasi skema sebelum menyentuh draf.

- [ ] **Step 1: Tes gagal.** `validateProfile` mengembalikan `error` untuk: admin dengan `number` sama dengan `botNumber` (bandingkan digit, abaikan `+`, spasi, `0` vs `62` di depan); `goal: 'checkout'` tanpa link `kind:'checkout'` dan `productCount === 0`; URL non-`https`; aturan memakai `withinHours` saat semua hari `null` (warn); `rules` merujuk `linkId` yang tidak ada. `toko_online` valid bila ada satu link checkout. `BrandStore`: profil awal berversi 0; `apply` menaikkan versi; `apply` ditolak saat ada error dan versi aktif tidak berubah; 22 kali apply menyisakan 20 versi; `restore(v)` mengembalikan isi persis; `importJson('{bad')` dan JSON dengan properti asing ditolak tanpa mengubah draf; `exportJson()` lalu `importJson()` menghasilkan profil yang sama.
- [ ] **Step 2: Run** `npx vitest run tests/brand.test.ts tests/brand-store.test.ts` → FAIL.
- [ ] **Step 3: Implement** sesuai signature; normalisasi nomor `normalizeNumber(n: string): string` (digit saja, awalan `0` → `62`) diekspor dari `brand.ts`.
- [ ] **Step 4: Run** → PASS. `npx tsc --noEmit` bersih.
- [ ] **Step 5: Commit** `feat: brand profile schema, presets and versioned store`.

---

### Task 2: Pagar keluaran dan sanitasi dokumen

**Files:** Create `src/main/policy/guards.ts`; Test `tests/guards.test.ts`

**Interfaces:**
- Consumes: `normalizeNumber` (Task 1).
- Produces:
  - `containsNumber(text: string, number: string): boolean` — cocok untuk `0812-0000-9999`, `+62 812 0000 9999`, `6281200009999`, `wa.me/6281200009999`.
  - `removeSelfNumber(text: string, botNumber: string): { text: string; removed: boolean }` — menghapus **kalimat** yang memuat nomor, bukan hanya angkanya.
  - `extractUrls(text: string): string[]`; `stripDisallowedUrls(text: string, allowed: string[]): { text: string; removed: string[] }` — cocok berdasarkan origin+path-prefix dari allowlist; tanpa tautan yang lolos, kalimat pembawa tautan dibuang.
  - `unknownNumbers(reply: string, context: string): string[]` — angka bernilai uang/jumlah (≥ 3 digit atau berawalan `Rp`) di `reply` yang tidak muncul (setelah normalisasi `25.000`/`25000`/`Rp25rb`) di `context`.
  - `sanitizeChunk(text: string, botNumber: string | null): string` — membuang baris yang memuat nomor bot atau frasa ajakan website (`hubungi kami lewat whatsapp`, `klik tombol`, `isi formulir`, `kunjungi halaman`, `tanya lewat whatsapp`, `minta .* lewat whatsapp`).

- [ ] **Step 1: Tes gagal.** `containsNumber('hubungi 0812-0000-9999', '6281200009999')` true untuk keempat format; false untuk nomor lain. `removeSelfNumber('Boleh. Hubungi WhatsApp 0812-0000-9999 ya. Terima kasih', n)` → `'Boleh. Terima kasih'`, `removed: true`. `stripDisallowedUrls` menghapus `http://evil.test/x` dan mempertahankan `https://toko.example/checkout/a?utm=1` bila `https://toko.example/checkout/a` ada di allowlist; URL dengan host mirip (`toko.example.evil.test`) ditolak. `unknownNumbers('Harganya Rp2.000.000', 'Harga Rp1.500.000')` → `['2000000']`; `'Rp1,5 juta'` vs konteks `Rp1,5 juta` → `[]`. `sanitizeChunk` menghapus baris "Tanya lewat WhatsApp 0851…" dan baris "Klik tombol Pesan", mempertahankan baris harga.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: output guards and chunk sanitizer`.

---

### Task 3: Katalog dan allowlist tautan

**Files:** Create `src/main/catalog/catalog-store.ts`; Modify `src/main/db.ts` (migrasi 4: tabel `products`), `src/main/knowledge/indexer.ts` (opsi `onDocument`, `onRemove`); Test `tests/catalog.test.ts`, `tests/indexer.test.ts` (kasus baru)

**Interfaces:**
- Produces:
  - `interface Product { id: string; name: string; price: number | null; description: string; checkoutUrl: string | null; suitableFor: string; stock: string }`
  - `parseCatalog(text: string, ext: '.csv' | '.json'): { products: Product[]; errors: string[] }` — kolom CSV: `id,nama,harga,deskripsi_singkat,checkout_url,cocok_untuk,stok`; baris tanpa `id` atau `nama` masuk `errors`; `checkout_url` non-`https` ditolak (produk tetap masuk dengan `checkoutUrl: null` + error); harga `Rp1.500.000`/`1500000` → `1500000`.
  - `class CatalogStore { constructor(db: Db); replaceFromFile(file: string, products: Product[]): void; removeFile(file: string): void; list(): Product[]; byId(id: string): Product | null; find(query: string, k: number): Product[] }` — `find` memakai `tokenize` yang sama dengan pencarian dokumen.
  - `buildLinkAllowlist(profile: BrandProfile, products: Product[]): string[]`.
  - `Indexer` opsi baru `{ onDocument?(file: string, text: string, ext: string): void; onRemove?(file: string): void }`; hanya file bernama `katalog.csv|katalog.json` yang diberi `onDocument` oleh main (filter di `index.ts`, bukan di Indexer).

- [ ] **Step 1: Tes gagal.** Parsing CSV 3 baris (satu tanpa `id`) → 2 produk + 1 error; `harga` berformat `Rp1.500.000` → `1500000`; URL `http://` → `checkoutUrl: null` + error; JSON array valid; `CatalogStore.replaceFromFile` dua kali tidak menduplikasi; `find('harga web umkm', 2)` mengembalikan produk "Paket Website UMKM" lebih dulu; `buildLinkAllowlist` memuat link profil dan `checkoutUrl` produk, tanpa duplikat. Indexer: menulis `katalog.csv` ke folder memanggil `onDocument` sekali dengan teks file; menghapusnya memanggil `onRemove`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS (termasuk `tests/indexer.test.ts` lama).
- [ ] **Step 5: Commit** `feat: product catalog store and link allowlist`.

---

### Task 4: Memori percakapan dan status kontak

**Files:** Create `src/main/conversation/store.ts`; Modify `src/main/db.ts` (migrasi 5: `contacts`, `turns`, `handoffs`, `events`, `sent_messages`); Test `tests/conversation-store.test.ts`

**Interfaces:**
- Produces:
  - `type ContactStatus = 'bot' | 'menunggu_admin' | 'manusia'`; `interface ContactState { chatId: string; status: ContactStatus; stage: 'sapa'|'gali'|'rekomendasi'|'harga'|'keberatan'|'cta'; pausedUntil: number | null; lead: Record<string, string>; productId: string | null; lowConfidenceStreak: number; turnsWithoutProgress: number; ruleCounts: Record<string, number> }`
  - `class ConversationStore { constructor(db: Db, clock: { now(): number }); appendTurn(chatId: string, role: 'user'|'bot'|'admin', text: string): void; recentTurns(chatId: string, n: number): { role: 'user'|'bot'|'admin'; text: string }[]; getState(chatId: string): ContactState; patchState(chatId: string, p: Partial<Omit<ContactState, 'chatId'>>): ContactState; mergeLead(chatId: string, updates: Record<string, string>): ContactState; pauseFor(chatId: string, status: ContactStatus, hours: number): void; resume(chatId: string): void; isPaused(chatId: string): boolean; recordEvent(chatId: string, type: 'checkout_sent'|'link_sent'|'handoff'|'lead_updated', productId?: string): void; rememberSentId(id: string): void; isSentId(id: string): boolean; countRepliesSince(chatId: string, sinceMs: number): number }`
  - `isPaused` benar bila status ≠ `bot` dan `pausedUntil > now`; saat `pausedUntil` lewat, `getState` otomatis mengembalikan status `bot`.
  - `recentTurns` mengembalikan urutan kronologis; teks dipotong 1.000 karakter per turn.

- [ ] **Step 1: Tes gagal.** `recentTurns(c, 10)` setelah 15 turn mengembalikan 10 terakhir berurutan; `mergeLead` menggabung tanpa menghapus kunci lama dan mengabaikan nilai kosong; `pauseFor(c, 'manusia', 6)` → `isPaused` true, maju 6 jam + 1 ms → false dan `getState.status === 'bot'`; `resume` mengosongkan jeda; `isSentId` benar hanya untuk ID yang diingat; `countRepliesSince` menghitung turn `bot` dalam jendela; turn 5.000 karakter tersimpan sebagai 1.000.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: conversation memory and contact state`.

---

### Task 5: Agen: skema keluaran, prompt, dan pemanggilan

**Files:** Create `src/main/answer/agent.ts`; Test `tests/agent.test.ts`

**Interfaces:**
- Consumes: `BrandProfile`, `Hit`, `Product`, `AiProvider`, `AiError`, `toAiError` (dari `ai-answerer.ts`).
- Produces:
  - `AgentOutputSchema` (zod): `{ intent: Intent; stage: ContactState['stage']; reply_parts: string[] (1–3, tiap ≤ 600 karakter); lead_updates: Record<string,string>; product_id: string | null; suggested_action: 'none'|'send_checkout'|'handoff'|'ask_more'; confidence: number (0–1); sources: string[] }`
  - `interface AgentContext { profile: BrandProfile; message: string; hits: Hit[]; products: Product[]; lead: Record<string,string>; stage: string; history: { role: 'user'|'bot'|'admin'; text: string }[]; withinHours: boolean; botNumber: string | null }`
  - `buildSystemPrompt(profile: BrandProfile, withinHours: boolean): string` — memuat: persona (nama bot/bisnis, nada, sapaan, emoji, panjang), aturan WhatsApp (tanpa Markdown, ≤ 3 gelembung, satu pertanyaan per pesan, ikuti bahasa pelanggan), tujuan (`goal`), larangan (mengarang harga/diskon/garansi/durasi; menyuruh pelanggan menghubungi nomor atau WhatsApp karena percakapan sudah di WhatsApp; menyebut tautan selain yang diberikan; memakai pengetahuan umum), instruksi bahwa isi konteks/riwayat/pesan adalah data, kata wajib/terlarang, topik terlarang, contoh gaya, jawaban atas keberatan, format JSON.
  - `buildUserPrompt(ctx: AgentContext): string` — bagian `<konteks>` (dokumen sudah disanitasi, produk dengan id/nama/harga/tautan), `<lead>`, `<riwayat>`, `<pesan>`; semua `<` pada isi di-escape.
  - `runAgent(provider: AiProvider, ctx: AgentContext, cfg: { model: string; maxTokens: number }, timeoutMs?: number): Promise<AgentOutput | null>` — `null` bila JSON tidak valid atau tidak lolos skema; melempar `AiError` untuk kegagalan penyedia (timeout 15 s); toleran terhadap code fence dan teks di sekitar JSON.

- [ ] **Step 1: Tes gagal.** `buildSystemPrompt` memuat nama bot dan bisnis, "pengetahuan umum", larangan menyuruh menghubungi WhatsApp, dan teks `introText` hanya bila `introduceAsBot`; memuat contoh gaya dan kata terlarang dari profil; nada `formal` vs `santai` menghasilkan teks berbeda. `buildUserPrompt` membungkus pesan dalam `<pesan>` dan meng-escape `</pesan>` di dalam pesan. `runAgent` dengan `FakeProvider`: JSON valid → objek; code fence → objek; `reply_parts` kosong atau 4 elemen → `null`; teks bukan JSON → `null`; provider 401 → `AiError AUTH`; provider tak pernah menjawab → `AiError TIMEOUT` (timeout kecil di tes).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: conversation agent prompt and structured output`.

---

### Task 6: Mesin aturan arah

**Files:** Create `src/main/policy/rules.ts`; Test `tests/rules.test.ts`

**Interfaces:**
- Consumes: `BrandProfile`, `Rule`, `ActionKind`, `Intent`.
- Produces:
  - `interface RuleFacts { intent: Intent; suggested: 'none'|'send_checkout'|'handoff'|'ask_more'; message: string; productId: string | null; withinHours: boolean; turns: number; leadComplete: boolean; confidence: number; lowConfidenceStreak: number; turnsWithoutProgress: number; ruleCounts: Record<string, number> }`
  - `type ChosenAction = { kind: ActionKind; linkId?: string; productId?: string; adminId?: string; message?: string; ruleId: string | null; forced: boolean; reason?: string }`
  - `forcedHandoffReason(f: RuleFacts): string | null` — `'minta_manusia'`, `'komplain'`, `'kata_kunci_sensitif'` (`refund`, `tagihan`, `chargeback`, `ganti rugi`, `komplain`, `penipuan`), `'keyakinan_rendah'` (streak ≥ 2 termasuk giliran ini), `'tanpa_kemajuan'` (≥ 6), `'luar_katalog_bernilai'` (kata `penawaran`, `proposal`, `kerja sama`, `diskon khusus`).
  - `evaluateRules(profile: BrandProfile, f: RuleFacts): ChosenAction` — urutan: (1) `forcedHandoffReason` → `handoff` dengan `forced: true`; (2) aturan aktif dari atas, kondisi digabung AND, `maxPerContact` dihormati lewat `ruleCounts[ruleId]`; (3) jika tidak ada yang cocok: `suggested === 'send_checkout'` hanya dipakai bila `profile.goal === 'checkout'` dan ada produk/tautan; `'handoff'` bila `goal === 'handoff'`; selain itu `reply_only`.

- [ ] **Step 1: Tes gagal.** Komplain → `handoff` forced walau aturan lain mengatakan `reply_only`; "mau refund" → forced `kata_kunci_sensitif`; streak 2 → forced; turn tanpa kemajuan 6 → forced; dua aturan bertabrakan memilih yang di atas, menukar urutan mengubah hasil; aturan nonaktif dilewati; `maxPerContact: 1` tidak cocok untuk kedua kalinya; kondisi `withinHours: false` hanya cocok di luar jam kerja; saran model `send_checkout` diabaikan saat `goal !== 'checkout'`; tanpa aturan cocok dan tanpa saran → `reply_only`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: conversion rule engine with forced handoff`.

---

### Task 7: Gelembung, jeda mengetik, dan kontrak gateway

**Files:** Create `src/main/conversation/bubbles.ts`; Modify `src/main/wa/gateway.ts`, `src/main/wa/baileys-gateway.ts`, `tests/reply-pipeline.test.ts` (FakeGateway), `tests/baileys-normalize.test.ts`; Test `tests/bubbles.test.ts`

**Interfaces:**
- Produces:
  - `splitBubbles(parts: string[], maxBubbles?: number): string[]` (default 3; buang kosong; bila lebih dari maks, gabungkan sisanya ke gelembung terakhir; Markdown `**`, `__`, `#`, bullet `- ` di awal baris dibersihkan).
  - `typingMsFor(text: string, rand?: () => number): number` — `length * (40 + rand()*20)` dijepit 1000–6000.
  - `WaGateway.sendText(chatId: string, text: string, opts?: { typingMs?: number }): Promise<string | null>` (mengembalikan ID pesan terkirim); `WaGateway.selfNumber(): string | null` (digit nomor akun yang tertaut); `WaGateway.jidFor(number: string): string` (`<digit>@s.whatsapp.net`).
  - `shouldHandleUpsert(type, fromMe?)` menjadi: `notify` selalu; `append` hanya bila `fromMe === true` (sinyal pengambilalihan manusia, bukan untuk dijawab).
  - `IncomingMessage` tetap; pesan `fromMe` sekarang diteruskan ke callback (pipeline yang memutuskan).

- [ ] **Step 1: Tes gagal.** `splitBubbles(['a','b','c','d'])` → 3 gelembung, gelembung ke-3 `'c d'`; `'**Halo** Kak\n- satu\n# Judul'` dibersihkan tanpa karakter Markdown; `typingMsFor('x'.repeat(10), () => 0)` = 1000 (dijepit), 200 karakter → 6000, 50 karakter dengan `rand = 0.5` = 2500; `shouldHandleUpsert('append', true)` true, `('append', false)` false, `('history', true)` false. `normalizeMessage` untuk `fromMe: true` tetap mengembalikan pesan. `FakeGateway.sendText` di tes pipeline mengembalikan `m-<n>` dan `selfNumber()` `'6281200009999'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; `BaileysGateway.sendText` mengembalikan `sent?.key?.id ?? null`; `selfNumber()` dari `sock.user.id` (potong `:device@…`). **Step 4: Run** `npx vitest run` → semua hijau.
- [ ] **Step 5: Commit** `feat: bubbles, typing delay and gateway returns message ids`.

---

### Task 8: Serah ke admin

**Files:** Create `src/main/conversation/handoff.ts`; Test `tests/handoff.test.ts`

**Interfaces:**
- Consumes: `ConversationStore`, `BrandProfile`, `WaGateway`, `normalizeNumber`.
- Produces:
  - `isWithinHours(profile: BrandProfile, nowMs: number): boolean` (zona waktu dari `hours.timezone` lewat `Intl.DateTimeFormat`; hari `null` = tutup; `open ≤ t < close`).
  - `formatLeadSummary(input: { profile: BrandProfile; chatId: string; reason: string; lead: Record<string,string>; productName: string | null; lastTurns: { role: string; text: string }[] }): string` — ringkasan teks WhatsApp: nama bisnis, alasan, data lead, 3 pesan terakhir, nomor pelanggan (digit).
  - `class HandoffService extends EventEmitter { constructor(d: { gateway: WaGateway; conv: ConversationStore; db: Db; clock: { now(): number } }); trigger(input: { profile: BrandProfile; chatId: string; reason: string; adminId?: string; productName: string | null }): Promise<{ farewell: string; notified: string[] }> }` — mengisi `status='menunggu_admin'` dengan `pauseFor(…, profile.limits.pauseHours)`, mencatat baris `handoffs` + event, emit `'handoff'` (untuk notifikasi desktop), dan mengirim ringkasan ke admin terpilih (atau semua admin dengan `notifyWhatsapp`) lewat `gateway.sendText(gateway.jidFor(number), …)`. Admin yang nomornya sama dengan `gateway.selfNumber()` dilewati. `farewell` = `templates.handoffFarewell` dengan variabel `{jam_kerja}` terisi; di luar jam kerja memakai `templates.outsideHours` ditambahkan.

- [ ] **Step 1: Tes gagal.** `isWithinHours` pada Senin 10:00 WITA true, Senin 20:00 false, Minggu (null) false, dengan zona `Asia/Makassar` meski jam sistem UTC. `trigger` mengubah status ke `menunggu_admin`, `isPaused` true, mengirim satu pesan ke tiap admin (FakeGateway) berisi nama bisnis dan alasan, tidak mengirim ke admin ber-nomor sama dengan bot, memancarkan `'handoff'`, mengembalikan `farewell` tanpa placeholder tersisa; kegagalan kirim ke admin tidak melempar (masuk `notified` kosong, event tetap tercatat).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: human handoff service with lead summary`.

---

### Task 9: Pengambilalihan manusia

**Files:** Modify `src/main/pipeline/reply-pipeline.ts`; Test `tests/reply-pipeline.test.ts`

**Interfaces:**
- Consumes: `ConversationStore` (`isSentId`, `rememberSentId`, `pauseFor`, `isPaused`), `BrandProfile.limits.pauseHours`.
- Produces: `PipelineDeps` ditambah `conv: ConversationStore` dan `brand: () => BrandProfile`; `PipelineResult.ignored.why` ditambah `'human'`. Aturan: pesan `fromMe` yang ID-nya **bukan** milik bot (`!conv.isSentId(id)`) di chat non-grup → `conv.pauseFor(chatId, 'manusia', pauseHours)` + `appendTurn(chatId,'admin',text)` + hasil `ignored/from_me`; pesan masuk dari chat yang `isPaused` → `ignored/human`; setiap `send` memanggil `rememberSentId(id)` dari hasil `gateway.sendText`.

- [ ] **Step 1: Tes gagal.** Pesan `fromMe` dengan ID asing menjeda chat enam jam; pesan pelanggan berikutnya → `ignored/human` dan tidak ada `sendText`; setelah 6 jam + 1 menit pesan pelanggan dibalas normal; `fromMe` dengan ID yang dikirim bot sendiri **tidak** menjeda; `fromMe` di grup tidak menjeda; admin membalas saat bot menyusun jawaban (pesan `fromMe` tiba di antrean setelah pesan pelanggan, sebelum `sendText`) → jawaban bot **tidak terkirim** (cek status jeda tepat sebelum kirim).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; pemeriksaan jeda diulang tepat sebelum `gateway.sendText`. Pesan `fromMe` diproses di luar antrean per-chat agar tidak menunggu panggilan model. **Step 4: Run** `npx vitest run` → semua hijau.
- [ ] **Step 5: Commit** `feat: pause bot when a human takes over the chat`.

---

### Task 10: Orkestrasi giliran agen dan integrasi pipeline

**Files:** Create `src/main/pipeline/conversation-agent.ts`; Modify `src/main/pipeline/reply-pipeline.ts`, `src/main/index.ts`, `tests/reply-pipeline.test.ts` (kasus mode `ai` diperbarui); Test `tests/conversation-agent.test.ts`

**Interfaces:**
- Consumes: Task 1–9.
- Produces:
  - `interface AgentTurnInput { chatId: string; text: string; profile: BrandProfile; provider: AiProvider; cfg: { model: string; maxTokens: number }; dryRun: boolean }`
  - `interface AgentTurnResult { intent: Intent; action: ChosenAction; replyParts: string[]; linkSent: string | null; handoff: { reason: string } | null; sources: string[]; matchedRule: string | null; removed: { numbers: boolean; urls: string[]; numbersUnknown: string[] }; fallback: boolean }`
  - `class ConversationAgent { constructor(d: { store: IndexStore; catalog: CatalogStore; conv: ConversationStore; handoff: HandoffService; gateway: WaGateway; clock: { now(): number } }); handleTurn(i: AgentTurnInput): Promise<AgentTurnResult> }`
  - Urutan `handleTurn`: ambil 5 chunk (`IndexStore.search`, **tanpa** gerbang coverage) → `sanitizeChunk` tiap chunk → produk dari `catalog.find` → `runAgent` → saring balasan: `removeSelfNumber`, `stripDisallowedUrls` (allowlist), `unknownNumbers` terhadap teks konteks+katalog (balasan dengan angka tak dikenal diganti `templates.unknown` dan `suggested` dipaksa `handoff` pada mode jasa) → `evaluateRules` → eksekusi aksi: `send_checkout` menambah pesan `templates.checkout` dengan tautan (+ parameter `utm_source=wa_bot&utm_medium=whatsapp&ref=<hash 8 hex dari chatId>` bila `tracking`), `send_link`, `handoff` (via `HandoffService`, tidak pada `dryRun`), `ask_lead` (pertanyaan kualifikasi berikutnya yang kuncinya belum ada di lead), `reply_only`, `silent` → perbarui memori (`appendTurn`, `mergeLead`, `patchState` untuk `stage`, `lowConfidenceStreak`, `turnsWithoutProgress`, `ruleCounts`), catat event. Bila `runAgent` melempar `AiError` atau mengembalikan `null` → `fallback: true`: mode jasa serah ke admin dengan alasan `'ai_gagal'`, mode produk membalas `templates.unknown`; pelanggan tidak pernah menerima galat atau JSON mentah.
  - `ReplyPipeline`: pada `settings.mode === 'ai'` dan provider tersedia, `process()` memakai `ConversationAgent.handleTurn` (gerbang `decide` dan jawaban ekstraktif tidak dipakai); mode lain tidak berubah. Pesan tanpa kata inti (`no_tokens`) pada mode AI dikirim ke agen (sapaan dan terima kasih dijawab natural). Pengiriman memakai `splitBubbles` + `typingMsFor` per gelembung. `preview(text)` pada mode AI memanggil `handleTurn(dryRun: true)` dan mengembalikan `AgentTurnResult`. `PipelineResult` ditambah `{ kind: 'handoff'; reason: string }` dan `{ kind: 'replied', via: 'ai' }` mengandung `linkSent`.

- [ ] **Step 1: Tes gagal** (penyedia palsu yang menghasilkan JSON agen; `FakeGateway`; profil `toko_online` dan `jasa_agensi`):
  - mode produk: "mau beli website umkm" → saran `send_checkout`, balasan memuat tautan produk dari katalog (dengan `utm_source=wa_bot`), `linkSent` terisi, event `checkout_sent` tercatat sekali; pesan kedua dalam 24 jam tidak mengirim tautan yang sama lagi.
  - mode jasa: setelah `kebutuhan` dan `nama` terkumpul dan intent `siap_beli` → `handoff`, `sendText` ke admin berisi ringkasan, status `menunggu_admin`, pesan pelanggan berikutnya `ignored/human`; farewell memuat jam kerja.
  - **Nomor bot:** model mengeluarkan "hubungi 0812-0000-9999" → keluaran tidak memuat nomor itu dalam format apa pun.
  - **URL:** model mengeluarkan `http://evil.test/pay` → terhapus; `https://` di allowlist → lolos.
  - **Angka:** model mengeluarkan "Rp2.000.000" saat katalog Rp1.500.000 → diganti `templates.unknown`.
  - komplain ("barang saya rusak") → `handoff` forced walau model menyarankan `none`.
  - JSON rusak, `AiError AUTH`, dan timeout → mode jasa: handoff `ai_gagal`; mode produk: balasan `templates.unknown`; tidak ada galat ke pelanggan.
  - pertanyaan lanjutan: giliran 2 "yang paket itu berapa?" menerima riwayat giliran 1 di `<riwayat>` (periksa prompt yang diterima penyedia palsu).
  - "halo" dan "makasih kak" pada mode AI dijawab (bukan diam); "siapa presiden?" dengan model mengembalikan `di_luar_konteks` → balasan `templates.unknown` tanpa fakta dari luar konteks.
  - 3 pesan beruntun cepat satu kontak → satu per satu, urutan riwayat benar, tidak ada balasan ganda.
  - `preview` tidak mengirim apa pun, tidak mengubah memori, tidak memicu handoff.
  - **Mode `extractive` tidak berubah**: seluruh tes lama mode itu hijau tanpa modifikasi.
- [ ] **Step 2: Run** `npx vitest run tests/conversation-agent.test.ts tests/reply-pipeline.test.ts` → FAIL.
- [ ] **Step 3: Implement** `handleTurn` dan sambungkan di `index.ts` (buat `CatalogStore`, `ConversationStore`, `HandoffService`, `BrandStore`; `Indexer` dengan `onDocument` untuk `katalog.csv|json`; `HandoffService.on('handoff')` → notifikasi desktop + event renderer). Perbarui tes mode `ai` lama ke skema agen (ledger: ruling).
- [ ] **Step 4: Run** `npx vitest run` → semua hijau; `npx tsc --noEmit` bersih; `npx electron-vite build` sukses.
- [ ] **Step 5: Commit** `feat: conversation agent turn with policy layer and handoff`.

---

### Task 11: IPC dan preload untuk Brand & Konversi

**Files:** Modify `src/shared/channels.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts`; Test `tests/ipc-schema.test.ts`

**Interfaces:**
- Produces channel dan `Api`: `getBrand(): Promise<{ active: BrandProfile; draft: BrandProfile; botNumber: string | null; productCount: number }>`, `saveBrandDraft(p: unknown): Promise<{ ok: boolean; issues: Issue[] }>`, `applyBrand(): Promise<{ ok: boolean; issues: Issue[]; version?: number }>`, `listBrandVersions()`, `restoreBrandVersion(v: number)`, `exportBrand(): Promise<string>`, `importBrand(json: string): Promise<{ ok: boolean; issues: Issue[] }>`, `previewChat(input: { draft: boolean; messages: string[] }): Promise<AgentPreview[]>` (jalankan `handleTurn(dryRun)` berurutan dengan memori sementara, memakai profil draf bila `draft`), `listPresets(): Promise<{ id: string; label: string }[]>`, `loadPreset(id: string)` (mengisi draf), `onHandoff(cb)`.
- `BrandProfileSchema` dipakai ulang untuk validasi IPC; payload > 200 KB ditolak; tidak ada channel yang mengembalikan API key atau kredensial sesi.

- [ ] **Step 1: Tes gagal.** `CHANNELS` memuat semua nama baru dan tetap tanpa `getApiKey`/`creds`/`session`; handler `saveBrandDraft` menolak properti asing dan payload 300 KB; `applyBrand` mengembalikan issue `error` untuk nomor admin sama dengan `botNumber`; `previewChat` memakai draf bukan profil aktif saat `draft: true` dan tidak menulis ke `message_log`/`turns` permanen.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run` → hijau; build sukses.
- [ ] **Step 5: Commit** `feat: brand profile ipc`.

---

### Task 12: UI Brand & Konversi (Identitas, Gaya, Arah Konversi, pratinjau)

**Files:** Create `src/renderer/pages/BrandPage.tsx`, `src/renderer/brand/{IdentityTab,RulesTab,LinksAdminsTab,LeadTab,PreviewPanel,ApplyBar,PresetPicker}.tsx`, `src/renderer/brand/useBrand.ts`; Modify `src/renderer/App.tsx` (menu **Brand & Konversi**), `src/renderer/i18n/id.ts`; Test `tests/renderer/brand.test.tsx`

**Interfaces:**
- Consumes: `window.api` (Task 11).
- Produces (Bootstrap 5, tab `nav-tabs`):
  - `useBrand()`: memuat draf, `update(patch)` menyimpan draf (debounce 400 ms), mengekspos `issues`, `dirty`.
  - `PresetPicker`: pilih preset (jenis bisnis) → `loadPreset`; konfirmasi bila draf sudah diubah.
  - `IdentityTab`: nama bisnis/bot, tentang (penghitung 500 karakter), nada, sapaan, emoji, panjang, bahasa, kata wajib/terlarang (input tag), perkenalan bot, contoh gaya (tambah/hapus).
  - `RulesTab`: tujuan utama (radio), rule builder (tambah/hapus/urut naik-turun/toggle; pilih intent, kata kunci, jam kerja, tindakan, tautan/produk/admin, pesan, batas) + daftar link + daftar admin + pertanyaan kualifikasi + keberatan + template pesan.
  - `PreviewPanel`: kotak chat simulasi; tiap giliran menampilkan balasan (gelembung), **tindakan yang diambil**, aturan yang cocok, maksud, sumber, dan badge peringatan pagar (nomor/URL/angka disaring).
  - `ApplyBar`: daftar issue (error merah menghalangi, warn kuning), tombol **Terapkan** nonaktif bila ada error, **Pulihkan** versi, **Ekspor**/**Impor**.

- [ ] **Step 1: Tes gagal** (Testing Library + `window.api` palsu): memilih preset memanggil `loadPreset` dengan id itu; mengetik nama bisnis menyimpan draf (setelah debounce) dengan nilai baru; **Terapkan** `disabled` saat ada issue `error` dan menampilkan teksnya; menambah aturan "siap_beli → send_checkout" lalu menyimpan mengirim draf berisi aturan itu; tombol naik/turun mengubah urutan aturan; tab Arah Konversi menolak (menandai) URL `http://`; `PreviewPanel` menampilkan tindakan "Kirim checkout" dan nama aturan dari hasil `previewChat`; badge "nomor disaring" muncul bila `removed.numbers`; tombol Ekspor memanggil `exportBrand`; tema gelap tetap berlaku (komponen memakai kelas Bootstrap, bukan warna tetap).
- [ ] **Step 2: Run** `npx vitest run tests/renderer/brand.test.tsx` → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run` → hijau; `npx electron-vite build` sukses.
- [ ] **Step 5: Commit** `feat: brand and conversion settings page`.

---

### Task 13: Bersihkan pengetahuan, skenario ujung ke ujung, dokumen penerimaan

**Files:** Modify `knowledge/kerabat-koding/*.md`, `docs/manual-acceptance.md`; Create `knowledge/kerabat-koding/katalog.csv`; Test `tests/e2e-scenarios.test.ts`

**Interfaces:** Consumes semua task. Tidak menambah API.

- [ ] **Step 1: Tes gagal** (pipeline lengkap dengan `FakeGateway`, penyedia palsu berskrip, `IndexStore` berisi file pengetahuan nyata dari `knowledge/kerabat-koding`, katalog nyata, profil `toko_online`/`jasa_agensi`): (a) pelanggan "berapa harga website umkm?" lalu "oke saya mau" → dua balasan, tautan checkout dikirim sekali; (b) pelanggan jasa "mau bikin aplikasi kasir" → pertanyaan kualifikasi → data lengkap → serah, admin menerima ringkasan; (c) admin membalas dari HP → bot diam sampai 6 jam; (d) **tidak satu pun** `sendText` ke pelanggan, dalam semua skenario, memuat `6281200009999`, `0812-0000-9999`, atau frasa "lewat WhatsApp" yang menyuruh menghubungi; (e) potongan dokumen yang diberikan ke penyedia palsu tidak memuat baris ajakan website.
- [ ] **Step 2: Run** → FAIL (dokumen masih memuat ajakan).
- [ ] **Step 3: Implement.** Edit file pengetahuan: ganti kalimat "lewat WhatsApp"/"tanya/konsultasi via WhatsApp" dengan rumusan netral ("minta estimasi ke tim", "diskusikan kebutuhan"), pertahankan nomor hanya di `00-profil-dan-kontak.md` dalam bagian bertanda `<!-- hanya untuk manusia -->` yang disaring `sanitizeChunk`; buat `katalog.csv` untuk Website UMKM, Website Custom, tiga paket Audit SEO, tiga paket SEO bulanan (harga persis dari file pengetahuan; `checkout_url` kosong untuk produk jasa); perbarui `docs/manual-acceptance.md` dengan langkah: atur brand di halaman baru, uji simulator, skenario produk dan jasa, ambil alih dari HP, dan pastikan bot tidak menyebut nomornya sendiri.
- [ ] **Step 4: Run** `npx vitest run` → hijau; `npx tsc --noEmit`; `npx electron-vite build`.
- [ ] **Step 5: Commit** `feat: cleaned knowledge, catalog and end-to-end scenarios`.

---

## Self-Review

- **Cakupan spec:** 2 (mode) → T1 (`businessType`), T6, T10; 3–4 (alur, keputusan) → T5, T6, T10; 5 (produk, katalog, tautan) → T2, T3, T10; 6 (jasa, serah) → T8, T10; 7 (pengambilalihan) → T7, T9; 8 (pagar) → T2, T10, T13; 9 (natural) → T5, T7, T10; 17 (halaman brand) → T1, T11, T12. Ditunda ke rencana lanjutan: bagian 10 (follow-up), 11 (corong, leads, ekspor CSV), halaman Percakapan, ringkasan berjalan.
- **Konsistensi tipe:** `BrandProfile`, `Rule`, `ChosenAction`, `RuleFacts`, `AgentOutput`, `AgentContext`, `ContactState`, `Product`, `Issue`, `WaGateway.sendText → string | null` didefinisikan sekali dan dipakai ulang dengan nama yang sama.
- **Risiko tak teruji di sini:** perilaku `fromMe` Baileys (`notify` vs `append`, nomor `sock.user.id`), kualitas bahasa jawaban model, dan tampilan UI hanya bisa dipastikan lewat uji manual dengan HP dan penyedia AI sungguhan (Task 13, langkah dokumen penerimaan).
