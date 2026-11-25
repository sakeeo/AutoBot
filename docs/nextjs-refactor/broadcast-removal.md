# Rencana Penghapusan Fitur Broadcast

Penulis: System Analysis & Architecture · 2026-11-18 · Status: draft untuk divalidasi (belum ada kode yang diubah)
Bagian dari: [`architecture-plan.md`](./architecture-plan.md) Revisi 5 (ADR-011). Dilakukan di Fase 1, **sebelum** `core` diekstrak, supaya kode mati tidak ikut dipindahkan. Angka di dokumen ini dihitung langsung dari kode (tes dijalankan); angka lain di channel (4 tabel, ±75 channel, 8–9 berkas UI, ±214 kasus tes) tidak cocok dengan kode.

---

## 1. Ringkasan

Fitur broadcast tertanam lebih dalam daripada satu menu. Dari pembacaan kode:

| Lapisan | Yang terdampak |
|---|---|
| Backend | 12 berkas di `src/main/broadcast/` (audience, breaker, engine, gate, identity, import, ipc, limits, lint, optout, optout-handler, store) + kabel di `main/index.ts` dan `main/ipc.ts` + `ReplyPipeline` (`optOut` dan `sendBroadcast`) |
| Kontrak | `shared/broadcast.ts`, tipe di `shared/ipc.ts`, **24 channel** (23 `bc*` + `evtBroadcast`) dari 82, metode di `preload` |
| UI | 8 berkas di `renderer/broadcast/`, `BroadcastPage`, **`ContactsPage` (menu "Kontak")**, entri `nav.tsx` dan `i18n` |
| Database | **7 tabel** `broadcast_*` dibuat di migrasi ke-7, ke-8, dan ke-10 |
| Tes | **15 berkas, 243 tes** (12 di `tests/broadcast/`, 3 di `tests/renderer/broadcast-*.test.tsx`) dari 910 tes |
| Tes yang diedit (bukan dihapus) | `reply-pipeline.test.ts`, `nav.test.tsx` (lihat §5) |
| Dokumen | PRD §5.3 dan turunannya; spec dan plan "broadcast aman" |

Dampak positif: risiko pemblokiran nomor turun besar (tidak ada lagi kiriman massal tak diminta), permukaan kepatuhan (persetujuan penerima, UU PDP untuk pesan massal) hilang, dan sekitar 3–4 hari porting UI di Fase 3 tidak perlu dikerjakan.

---

## 2. Dua temuan yang mengubah rencana

### 2.1 Halaman "Kontak" ikut hilang, dan satu fungsi penting tersembunyi di dalamnya
`ContactsPage` seluruhnya dibangun dari data broadcast (`bcContacts`, `bcOverview`, `bcSuppressed`, `bcSendConfirmations`, `bcSetWarmup`, `bcEraseContact`, plus `ImportWizard` dan `AddContactForm`). Jadi menu **Kontak dihapus bersama broadcast**; daftar pelanggan tetap ada di halaman **Pesan**.

Yang berbahaya: **satu-satunya cara menghapus seluruh data seorang pelanggan** ada di sini. `BroadcastStore.eraseContact` menghapus, untuk JID pelanggan (bentuk telepon dan bentuk lid), baris di tabel `messages`, `message_log`, `turns`, `handoffs`, `contacts`, `events`, `cooldowns`, dan `contact_memory`. Sementara `memForget` hanya menghapus memori, dan pesan tetap ada. PRD dan spec memori menjanjikan "hapus per kontak". Bila modul broadcast dihapus begitu saja, **kemampuan menghapus data pelanggan (permintaan penghapusan data pribadi) hilang tanpa disadari**.

**Keputusan:** sebelum menghapus, pindahkan logikanya menjadi `ConversationStore.eraseCustomer(chatId, altJid?)`: menghapus delapan tabel itu untuk semua bentuk JID pelanggan, tanpa bagian `broadcast_*`/hash penolakan. Tampil di halaman Pesan (hanya `owner`, verifikasi ulang password, dicatat di audit log). Tes per tabel wajib.

### 2.2 `@broadcast` di kode bukan (hanya) fitur broadcast
Sufiks `@broadcast` pada JID adalah **daftar siaran dan status WhatsApp**, bukan fitur ini. Filternya (`m.chatId.endsWith('@broadcast')` di `ReplyPipeline`, `skipsFeed` di `message-feed.ts`, saringan di `ConversationStore.setHandlingBulk`) mencegah bot menjawab status dan daftar siaran WhatsApp orang. **Wajib dipertahankan.** Penghapusan berbasis pencarian kata "broadcast" akan merusaknya: karena itu dari "51 berkas yang menyebut broadcast" hanya sebagian yang boleh dihapus, dan tes seperti `message-feed.test.ts` dan `conversation-store.test.ts` (yang menyebut `status@broadcast`) **tidak diubah**.

---

## 3. Inventaris dan tindakan

| Objek | Tindakan |
|---|---|
| `src/main/broadcast/*` (12 berkas) | Hapus |
| `src/shared/broadcast.ts`; tipe broadcast di `shared/ipc.ts`; 23 channel `bc*` + `evtBroadcast` di `channels.ts`; metode di `preload` | Hapus (preload sendiri dihapus bersama Electron) |
| `main/index.ts`: `BroadcastStore`, `BroadcastEngine`, `ImportService`, `OptOutHandler`, `protectNumbers`, `syncAudience` + timernya, `warmup` + timernya, event `progress/done/paused`, notifikasi "Broadcast dijeda" | Tidak dipindah ke `createEngine` (file ini diganti) |
| `main/ipc.ts`: tipe `BroadcastHandlers`, `ALWAYS_ALLOWED` (`bcStopAll`) | Hapus |
| `ReplyPipeline`: dependensi `optOut`, pemanggilan `optOut.handle` di `process()`, metode `sendBroadcast`, metode `reply()` (hanya dipakai opt-out) | Hapus. `inflight` dan pelacakan id pesan dipertahankan (dipakai `send`, `adminSend`, dan jalur kirim sistem OTP) |
| `renderer/broadcast/*` (8), `BroadcastPage`, `ContactsPage`; entri `broadcast` dan `contacts` di `nav.tsx` dan `i18n` | Hapus. Menu menjadi: Dashboard, Pesan, Uji Jawaban, Log, + grup Pengaturan |
| Migrasi `broadcast_*` | Jangan ubah migrasi lama; tambahkan migrasi ke-12 yang `DROP TABLE IF EXISTS` ketujuh tabel (§4) |
| `messages.alt_jid` (migrasi ke-9) | **Pertahankan** (dipakai untuk chat lid) |
| `gateway.onWhatsApp` | **Pertahankan**: dipakai memeriksa nomor pemilik di setup (OTP-WA) |
| `gateway.phoneJidForLid` | Hanya dipakai `resolveLidContacts` (broadcast): boleh dihapus dari interface |
| `normalizePhone`, `numberFromJid` di `broadcast/identity.ts` | Dipakai di `index.ts` (nomor admin). Pakai `normalizeNumber` di `shared/brand.ts` (sudah ada, dipakai gateway), atau pindahkan fungsi yang masih dipakai ke `shared/`, lalu hapus `identity.ts` |
| Tes `tests/broadcast/*` (12) dan `tests/renderer/broadcast-*.test.tsx` (3) | Hapus (243 tes) |
| `tests/reply-pipeline.test.ts` | Hapus hanya kasus `optOut`/`sendBroadcast`; kasus lain (termasuk yang memakai `status@broadcast`) tetap |
| `tests/renderer/nav.test.tsx` | Ubah ekspektasi urutan menu (tanpa Kontak dan Broadcast) |
| `tests/message-feed.test.ts`, `tests/conversation-store.test.ts` | **Tidak diubah** (§2.2) |
| PRD: §5.3, peta jalan M1.6, kriteria MVP "Broadcast ≥100 kontak" dan "Opt-out STOP", metrik tingkat pengiriman broadcast | Hapus atau tandai dibatalkan |
| `docs/superpowers/specs|plans/*broadcast*` | Tetap di repo sebagai arsip dengan spanduk "dibatalkan"; tidak dihapus |
| `docs/manual-acceptance.md` bagian broadcast dan opt-out | Hapus |

---

## 4. Database

- Migrasi lama (1–11) **tidak diubah**. Tambahkan **migrasi ke-12**: `DROP TABLE IF EXISTS` untuk `broadcast_state`, `broadcast_imports`, `broadcast_contacts`, `broadcast_suppress`, `broadcast_campaigns`, `broadcast_sends`, `broadcast_events` (dan indeksnya ikut hilang bersama tabel).
- **Alasan tidak memadatkan migrasi:** instalasi fresh membuat lalu menghapus tabel (tidak berbahaya), tetapi riwayat tetap jujur dan basis data lama (termasuk data desktop yang opsional diimpor) tetap bisa dinaikkan versinya. Memadatkan migrasi memutus kompatibilitas itu tanpa manfaat berarti.
- Migrasi konektor Google Sheets dan tabel lain mengikuti **setelah** migrasi ke-12 (sebelumnya disebut "migrasi ke-12" di dokumen Sheets; dibaca sebagai "migrasi berikutnya").
- Data broadcast lama tidak dimigrasikan atau diekspor; instalasi web dimulai bersih.

---

## 5. Pertanyaan yang diajukan QA: apa yang terjadi pada penanganan "STOP"?

Dari kode: `OptOutHandler` hanya bertindak penuh untuk orang yang **pernah menerima broadcast** (`wasBroadcastTo`). Untuk pelanggan yang tidak pernah dikirimi broadcast, "stop" hanya dicatat sebagai penolakan lunak dan **bot tetap membalas seperti biasa**; komplain pun diteruskan ke agent. Tanpa broadcast, `wasBroadcastTo` selalu salah, sehingga handler tidak berbuat apa-apa selain menyimpan jejak ke tabel yang ikut dihapus.

**Jadi:** penghapusan handler tidak mengubah perilaku apa pun terhadap pelanggan hari ini. "Berhenti" dari pelanggan akan lewat ke agent seperti pesan lain; komplain tetap ditangani aturan serah ke admin yang sudah ada (`komplain`, kata kunci sensitif).

**Fitur baru, bukan bagian dari penghapusan:** spec konversi (§8.7) menginginkan "stop/berhenti menyetop bot untuk kontak itu", dan itu **belum diimplementasi**. Bila diinginkan, usulan kecil (P1): pakai `classifyReply` yang ketat (hanya pesan pendek yang memang berisi permintaan) dan jeda bot untuk chat itu. Keputusan Anda; tidak dikerjakan kecuali diminta.

---

## 6. Urutan pengerjaan (satu rangkaian PR di Fase 1)

1. Tag `desktop-final` pada commit terakhir sebelum perubahan.
2. **PR-A, selamatkan fungsi hapus pelanggan:** `eraseCustomer` + tes per tabel (termasuk bentuk lid dan telepon) + tombol di Pesan. Lulus sebelum PR-B.
3. **PR-B, hapus broadcast:** backend, kontrak, UI, tes (§3), migrasi ke-12, penyesuaian `ReplyPipeline` dan `nav`. `tsc` dan `vitest` hijau.
4. **PR-C, dokumen:** PRD, manual-acceptance, spanduk arsip.
5. Barulah ekstraksi `core`/`createEngine` dan penghapusan Electron.

**Gerbang QA**
- Jumlah tes: 910 − 243 = **667** ditambah/dikurangi tes yang diedit di `reply-pipeline.test.ts` dan `nav.test.tsx` (selisih dicatat per berkas) ditambah tes baru `eraseCustomer`. Tidak ada tes non-broadcast yang hilang. Penghapusan tes Electron/auth lama dihitung terpisah di PR berikutnya.
- Tidak ada impor dari `broadcast/` atau `shared/broadcast` yang tersisa; tidak ada tabel `broadcast_*` setelah migrasi ke-12 pada basis data fresh.
- Filter `@broadcast` masih bekerja (tes `message-feed` dan `conversation-store` hijau, tidak diubah).
- Menu: Dashboard, Pesan, Uji Jawaban, Log, Pengaturan. Tidak ada rute atau channel `bc*`.
- `eraseCustomer` menghapus delapan tabel untuk kedua bentuk JID, dan tidak menyisakan teks percakapan pelanggan.

---

## 7. Dampak ke rencana dan risiko

- **Jadwal:** Fase 1 bertambah ±0,5 hari (PR-A/B/C), Fase 3 berkurang ±3–4 hari (Broadcast dan Kontak tidak diport). Efek bersih terhadap total kecil (lihat rencana utama §9).
- **Risiko berkurang:** pemblokiran nomor karena kiriman massal; persetujuan penerima dan pengelolaan daftar tolak; beban uji.
- **Risiko baru dari penghapusan:**
  1. Kehilangan fungsi hapus pelanggan (§2.1): ditutup PR-A.
  2. Merusak filter `@broadcast` WhatsApp (§2.2): ditutup gerbang QA.
  3. Fitur yang diharapkan pengguna lama hilang: tidak ada pengguna produksi, tetapi pemilik harus mengetahui bahwa pesan massal tidak lagi tersedia dan bahwa bot hanya membalas pesan yang masuk atau pesan serah ke admin.
- **Pesan keluar yang tersisa** setelah penghapusan: balasan atas pesan pelanggan, pesan serah ke nomor admin, dan pesan sistem OTP/pemberitahuan ke nomor pemilik.

## 8. Yang belum saya verifikasi
- Hitungan 243 tes berasal dari menjalankan 15 berkas tes tersebut; jumlah kasus yang harus diedit di `reply-pipeline.test.ts` (19 penyebutan "broadcast", sebagian untuk `status@broadcast`) belum dipilah.
- Isi `ContactsPage` dibaca sebagian (pemanggilan API); halaman tidak dijalankan.
- Apakah ada fitur lain yang membaca tabel `broadcast_contacts` (misalnya impor kontak ke dashboard) tidak saya temukan lewat pencarian impor, tetapi belum dibuktikan dengan menjalankan aplikasi.
