# Desain Fitur: Conversion Agent (AI sebagai Mesin Konversi di WhatsApp)

Status: draft untuk ditinjau. Melengkapi `PRD.md` bagian 5.2b dan 5.2c. Belum ada kode.

## 1. Masalah yang diselesaikan

Contoh nyata dari uji coba:

> Bot: "Pilihan tergantung kebutuhan Anda. Kalau ingin estimasi yang pasti, bisa konsultasi gratis lewat WhatsApp 0851-1930-8345."

Nomor itu adalah nomor bot sendiri. Akar masalahnya ada empat:

1. **Data pengetahuan menyuruh "hubungi WhatsApp kami".** Teks itu berasal dari website, yang ditulis untuk pengunjung web. Di dalam WhatsApp, kalimat itu tidak masuk akal.
2. **AI tidak tahu perannya.** Prompt sekarang hanya berisi "jawab dari konteks, singkat". AI tidak tahu bahwa ia sedang berada di WhatsApp, bahwa ia adalah wajah bisnis, dan bahwa tugasnya membawa pelanggan ke langkah berikutnya.
3. **Tidak ada tujuan akhir percakapan.** Tidak ada konsep "tautan checkout" atau "serahkan ke admin manusia".
4. **Tidak ada memori.** Tiap pesan dijawab berdiri sendiri, jadi alur jual-beli tidak mungkin terjadi.

Tujuan fitur ini: bot berperan sebagai **penjual/CS yang mengarahkan pelanggan ke satu tindakan**, bukan sebagai kotak tanya-jawab.

## 2. Dua mode bisnis

Dipilih di pengaturan **Bisnis** (satu pilihan per instalasi di v1; per-produk di P2).

| | **Mode Produk** (jual langsung) | **Mode Jasa** (butuh manusia) |
|---|---|---|
| Contoh | toko online, template website, paket langganan | software house, konsultan, bengkel, agensi |
| Tujuan akhir | pelanggan menekan **tautan checkout** | pelanggan **diserahkan ke admin manusia** dengan ringkasan lead |
| Tindakan bot | rekomendasi produk, jawab pertanyaan, atasi keberatan, kirim tautan | gali kebutuhan, kumpulkan data lead, jelaskan proses, serahkan |
| Bot menyebut harga | ya, dari katalog | ya jika harga tetap ada di dokumen; "mulai dari" untuk custom; tidak mengarang |
| Jika tautan checkout tidak ada | turun ke penanganan Jasa (serahkan ke admin) | tidak berlaku |

Mode **Hybrid** (P2): tiap produk di katalog punya kolom `tindakan` = `checkout` atau `handoff`. Contoh: Website UMKM (checkout), aplikasi custom (handoff).

## 3. Alur percakapan (state machine per kontak)

```
SAPA → GALI KEBUTUHAN → REKOMENDASI → HARGA/DETAIL → KEBERATAN → CTA → (TUNGGU) → FOLLOW-UP
                                                      ↘ kapan saja → SERAH KE ADMIN
```

| Tahap | Tujuan | Perilaku bot |
|---|---|---|
| Sapa | hangat, tidak panjang | balas sapaan, sebut nama bot dan bisnis, tanya satu hal |
| Gali kebutuhan | tahu apa yang dicari | maksimal **satu pertanyaan per pesan**; pertanyaan diambil dari playbook (jenis usaha, kebutuhan, target waktu, kisaran anggaran) |
| Rekomendasi | satu pilihan yang paling cocok | sebut 1 (paling banyak 2) produk/paket dan alasannya, bukan daftar panjang |
| Harga/detail | jawab fakta | hanya dari katalog/dokumen; sebut apa yang termasuk |
| Keberatan | "mahal", "pikir-pikir dulu", "bandingkan dulu" | pakai snippet keberatan dari playbook (bandingkan total biaya, tekankan yang termasuk); tidak menekan lebih dari 1 kali |
| CTA | tindakan berikutnya | Mode Produk: kirim tautan checkout. Mode Jasa: tawarkan serah ke admin |
| Follow-up | pelanggan diam | opsional, lihat 8 |

Status disimpan per kontak: `stage`, produk yang diminati, data lead terkumpul, ringkasan percakapan.

## 4. Keputusan: model menyarankan, kode memutuskan

Setiap pesan masuk diproses dengan **satu panggilan model** yang mengembalikan JSON terstruktur:

```json
{
  "intent": "tanya_harga | tanya_produk | siap_beli | keberatan | minta_manusia | komplain | sapaan | terima_kasih | di_luar_konteks | spam",
  "stage": "gali | rekomendasi | harga | keberatan | cta",
  "reply_parts": ["bubble 1", "bubble 2"],
  "lead_updates": {"nama": "...", "kebutuhan": "...", "anggaran": "...", "waktu": "..."},
  "product_id": "website-umkm",
  "suggested_action": "none | send_checkout | handoff | ask_more",
  "confidence": 0.0,
  "sources": ["01-paket-website-umkm.md"]
}
```

Lalu **lapisan kebijakan di kode** (bukan model) menentukan tindakan akhir:

- `send_checkout` hanya jalan jika Mode Produk, `product_id` ada di katalog, dan produk itu punya `checkout_url`.
- Serah ke admin **dipaksa** oleh aturan, apa pun saran model:
  - intent `minta_manusia` atau `komplain`
  - kata kunci pembayaran/refund/sengketa
  - `confidence` rendah dua kali berturut-turut
  - 6 giliran tanpa kemajuan tahap
  - permintaan di luar katalog yang bernilai besar (mis. "tolong buatkan penawaran")
  - Mode Jasa dan pelanggan sudah memberi minimal data lead minimum, atau menyatakan siap lanjut
- Jawaban yang gagal validasi (JSON rusak, sumber tidak ada, tautan tidak dikenal) dibuang dan diganti jawaban aman (lihat 7).

## 5. Mode Produk: detail

**Katalog.** Satu file di folder pengetahuan, mis. `katalog.csv` (atau `.json`):

| id | nama | harga | deskripsi_singkat | checkout_url | cocok_untuk | stok |
|---|---|---|---|---|---|---|
| website-umkm | Paket Website UMKM | 1500000 | domain, hosting, desain, konten | https://toko.example/checkout/website-umkm | kuliner, toko, jasa | tersedia |

- Indexer mengenali file ini, mem-parse ke tabel `products` (selain tetap diindeks untuk pencarian).
- Aplikasi memvalidasi saat index: baris tanpa `id`/`harga` ditandai gagal; `checkout_url` harus `https://`.

**Tautan checkout.**
- Satu **allowlist** domain dibuat dari katalog + pengaturan. Setiap URL di jawaban model harus ada di allowlist; selain itu dihapus dan jawaban dikirim ulang tanpa tautan (atau diserahkan ke admin).
- Tautan diberi parameter pelacakan otomatis: `?utm_source=wa_bot&utm_medium=whatsapp&utm_campaign=<bot>&ref=<hash-kontak>`. Hash, bukan nomor telepon.
- Satu tautan per pesan CTA; tidak dikirim berulang dalam 24 jam kecuali diminta.
- Pesan CTA memakai template yang bisa diedit: ringkas manfaat → tautan → "kalau ada yang masih ragu, saya bantu 😊".

**Kalau pelanggan sudah siap beli tapi bingung di checkout:** intent `minta_manusia`/`komplain` → serah ke admin dengan konteks.

## 6. Mode Jasa: detail

**Playbook kualifikasi** (dapat diedit di UI): daftar pertanyaan berurutan, tiap pertanyaan punya `kunci` (nama, jenis_usaha, kebutuhan, anggaran, waktu), apakah wajib, dan kata pemicu "lewati".

**Lead minimum untuk serah:** default `kebutuhan` + `nama`. Sisanya opsional; bot tidak mengejar data yang pelanggan enggan beri.

**Serah ke admin (handoff).**
1. Bot berpamitan natural: "Baik Kak, saya teruskan ke tim kami ya. Biasanya dibalas hari kerja jam 09.00–17.00 WITA."
2. Percakapan ditandai `menunggu_admin`; **bot berhenti membalas** di chat itu.
3. Notifikasi ke manusia lewat saluran yang dipilih (bisa lebih dari satu):
   - notifikasi desktop aplikasi,
   - pesan WhatsApp ke **nomor admin** (berbeda dari nomor bot) berisi ringkasan lead: nama, kebutuhan, anggaran, alasan serah, 3 pesan terakhir, tautan ke chat,
   - (P2) webhook.
4. Admin membalas langsung dari HP/WhatsApp Web.

**Di luar jam kerja:** bot tetap menggali kebutuhan dan mencatat lead; pesan serah menyebut kapan admin akan membalas.

## 7. Pengambilalihan manusia dan jeda bot

- Status per chat: `bot` | `menunggu_admin` | `manusia`.
- **Deteksi otomatis:** pesan `fromMe` yang dikirim dari HP/WhatsApp Web admin ke sebuah chat (bukan balasan bot sendiri) → chat pindah ke `manusia` dan bot **jeda 6 jam** (dapat diatur). Bot membedakan pesan buatannya sendiri lewat daftar ID pesan yang ia kirim.
- Tombol **Lanjutkan bot** dan **Tandai selesai** di halaman Percakapan; perintah singkat dari admin di chat itu (mis. `/bot`) sebagai opsi P2.
- Bot tidak pernah membalas chat berstatus `manusia`/`menunggu_admin`, kecuali pelanggan diam > batas jeda lalu menulis lagi (bot menyambung dengan sapaan singkat).

## 8. Pagar pengaman (guardrails)

1. **Penjaga nomor sendiri.** Nomor WhatsApp bot, dan variasi formatnya (`0851…`, `+62851…`, `wa.me/…`), tidak boleh muncul di balasan. Dicegah dua lapis: aturan prompt, dan filter keluaran yang menghapus kalimat berisi nomor itu lalu meregenerasi atau memakai CTA yang benar. Frasa seperti "hubungi kami lewat WhatsApp" juga dilarang di prompt karena pelanggan sudah di WhatsApp.
2. **Hapus kalimat CTA bawaan website dari dokumen.** Sebelum dipakai prompt, potongan dokumen disaring: baris yang memuat nomor bot atau "klik tombol / formulir / kunjungi halaman" ditandai sebagai *instruksi website*, tidak diberikan ke model (atau diberi label "abaikan"). Selain itu, file pengetahuan Kerabat Koding yang saya buat perlu dibersihkan dari "lewat WhatsApp".
3. **Tidak mengarang harga, diskon, garansi, durasi, atau janji.** Angka dalam jawaban harus muncul di potongan konteks (pemeriksaan angka pasca-generasi); jika tidak, jawaban dibuang.
4. **Tautan hanya dari allowlist** (lihat 5).
5. **Gerbang di luar konteks tetap berlaku**, tetapi balasannya natural dan mengarah ke langkah berikutnya, bukan penolakan kaku: "Untuk hal itu saya kurang tahu, Kak. Kalau soal paket website saya bisa bantu 😊" atau serah ke admin (Mode Jasa).
6. **Prompt injection:** isi pesan, dokumen, dan riwayat adalah data. Bot tidak punya alat selain menghasilkan teks balasan. Perintah seperti "abaikan aturan" ditolak lewat gerbang di luar konteks.
7. **Batas:** maksimal N balasan per kontak per jam, deteksi **bot lawan** (balasan identik berulang atau sangat cepat → jeda dan tandai), anggaran token harian dengan peringatan dan fallback, opt-out ("stop", "berhenti") menyetop bot untuk kontak itu.
8. **Data pribadi:** nomor telepon di prompt diganti pengenal anonim; riwayat disimpan lokal dan bisa dihapus per kontak.

## 9. Membuat jawaban terasa natural

- **Persona** (pengaturan Bisnis): nama bot, nama bisnis, nada (formal / ramah / santai-sopan), tingkat emoji (0–2), sapaan ("Kak", "Bapak/Ibu").
- **Gaya WhatsApp:** pesan pendek, tanpa Markdown/daftar bernomor/judul; 1–3 gelembung per jawaban; satu pertanyaan per pesan; mencerminkan bahasa pelanggan (Indonesia/Inggris); tidak memakai frasa "berdasarkan dokumen".
- **Gelembung bertahap:** gelembung dikirim berurutan dengan indikator mengetik dan jeda sesuai panjang teks (±40–60 ms per karakter, batas 1–6 detik).
- **Memori:** 10 pesan terakhir + ringkasan berjalan (diperbarui tiap 10 giliran) + data lead. Cukup agar "yang paket itu berapa?" nyambung.
- **Contoh gaya (few-shot):** 4–6 contoh dialog bagus per mode di dalam prompt, dapat diedit.
- **Sapaan dan terima kasih** dibalas singkat dan hangat (menggantikan perilaku "diam" untuk pesan tanpa kata inti pada mode AI), tanpa menambah fakta.

## 10. Follow-up (opsional, bawaan nonaktif)

- Jika tautan checkout sudah dikirim atau lead berhenti merespons 24 jam: **maksimal 1** pesan lanjutan yang sopan.
- Hanya untuk kontak yang pernah berbicara dengan bot, bukan pesan dingin; berhenti total jika ada "stop".
- Risiko nomor diblokir naik jika pesan keluar tak diminta banyak; karena itu nonaktif secara default dan ada peringatan di UI.

## 11. Pelaporan dan data

**Tabel baru:** `contacts(chat_id, display, state, stage, lead_json, summary, updated_at)`, `turns(chat_id, role, text, created_at)`, `products(id, nama, harga, checkout_url, …)`, `handoffs(id, chat_id, reason, status, created_at, resolved_at)`, `events(chat_id, type, product_id, created_at)` untuk corong.

**Corong yang dihitung:** percakapan baru → terkualifikasi → tautan checkout terkirim → serah ke admin → selesai/hilang. Konversi sebenarnya (pembelian) tercatat di toko pelanggan lewat parameter UTM; di aplikasi hanya sampai "tautan terkirim".

**Halaman UI baru:**
- **Bisnis:** mode, persona, jam kerja, nomor/saluran admin, aturan serah, batas harian.
- **Katalog:** daftar produk hasil parse dengan status valid/tidak valid dan uji tautan.
- **Playbook:** pertanyaan kualifikasi, template CTA, snippet keberatan, contoh gaya.
- **Percakapan:** daftar chat dengan status (bot/menunggu admin/manusia), ringkasan lead, tombol Lanjutkan bot, Tandai selesai.
- **Leads:** tabel lead, filter, ekspor CSV.
- **Uji Jawaban** (sudah ada): ditambah simulator percakapan multi-giliran dan tampilan tindakan yang akan diambil (kirim tautan / serah / tanya lagi).

## 12. Arsitektur prompt

```
SYSTEM  = persona + aturan WhatsApp + aturan bisnis (mode) + larangan (nomor sendiri, mengarang, tautan di luar allowlist)
        + daftar tindakan yang boleh disarankan + format JSON + contoh gaya
KONTEKS = potongan dokumen terambil (sudah disaring dari CTA website) + produk cocok dari katalog
        + data lead + ringkasan + 10 pesan terakhir
USER    = pesan terbaru (dibungkus tag data)
```

Perubahan modul: `ai-answerer.ts` (prompt dan skema baru), modul baru `conversation/` (state, memori, ringkasan), `policy/` (aturan tindakan, penjaga nomor, filter URL dan angka), `handoff/` (notifikasi dan jeda), `catalog/` (parse dan allowlist). `reply-pipeline.ts` dipecah menjadi: filter → konteks → panggilan model → kebijakan → kirim bertahap → log.

## 13. Kriteria penerimaan (uji otomatis dengan penyedia palsu)

- Balasan tidak pernah memuat nomor bot dalam format apa pun (uji dengan model yang sengaja mengeluarkannya → difilter).
- Tautan di luar allowlist tidak pernah terkirim.
- Mode Produk: pesan "mau beli website UMKM" → tahap CTA, tautan produk benar terkirim sekali.
- Mode Jasa: setelah kebutuhan + nama terkumpul → pesan serah, status `menunggu_admin`, notifikasi dan pesan ringkasan ke nomor admin, bot berhenti membalas chat itu.
- Admin membalas dari HP → chat berstatus `manusia`, bot diam 6 jam; sesudahnya menyambung.
- Pertanyaan lanjutan ("yang tadi berapa?") dijawab dengan konteks riwayat.
- Pesan "halo" dan "terima kasih" dijawab singkat tanpa fakta baru.
- Pertanyaan di luar dokumen ("siapa presiden?") tidak dijawab dari pengetahuan umum, dan balasannya natural.
- Angka yang tidak ada di konteks tidak lolos ke pelanggan.
- Pesan beruntun cepat dari satu kontak tidak menimbulkan balasan ganda.

## 14. Titik rawan yang perlu diuji deliberate (Review Focus)

1. Dokumen berisi nomor/ajakan "klik di sini" → tidak boleh bocor ke pelanggan.
2. Pelanggan menulis bahasa campuran, singkatan, atau typo berat ("brp biaya bkin web?").
3. Admin membalas dari HP saat bot sedang menyusun jawaban → jawaban bot harus dibatalkan.
4. Dua pesan masuk saat satu panggilan model masih berjalan → diproses berurutan dengan konteks yang benar.
5. Pelanggan meminta hal yang di luar katalog tapi bernilai (diskon, kerja sama) → serah ke admin, tidak menjanjikan.
6. Model mengembalikan JSON rusak atau terpotong → jawaban aman, tidak error di depan pelanggan.

## 15. Tahapan pengerjaan

**P0 (memperbaiki masalah yang terlihat sekarang):** penjaga nomor sendiri; pembersihan CTA website dari konteks; peran dan gaya WhatsApp di prompt; persona dasar; memori 10 pesan; pengaturan Bisnis (mode, jam kerja); Mode Produk dengan katalog dan tautan allowlist; Mode Jasa dengan serah ke admin (notifikasi desktop + WhatsApp ke nomor admin); jeda saat manusia mengambil alih; sapaan dan terima kasih natural; keluaran JSON terstruktur dengan lapisan kebijakan.
**P1:** playbook kualifikasi, halaman Percakapan dan Leads, corong dan ekspor CSV, anggaran token, deteksi bot lawan, simulator multi-giliran.
**P2:** mode Hybrid per produk, follow-up, webhook, perintah `/bot`, tautan booking kalender.

## 16. Pertanyaan yang perlu diputuskan

1. Saluran serah ke manusia: nomor WhatsApp admin (berbeda dari bot), notifikasi desktop, atau keduanya?
2. Satu mode per instalasi (v1) cukup, atau perlu Hybrid per produk sejak awal?
3. Format katalog: CSV/JSON di folder pengetahuan, atau diisi lewat form di aplikasi?
4. Jam kerja admin dan zona waktu untuk pesan serah?
5. Berapa lama bot jeda setelah admin mengambil alih (usulan 6 jam)?
6. Apakah follow-up otomatis diinginkan, mengingat risiko nomor diblokir?

---

## 17. Halaman Pengaturan Brand dan Arah Konversi (dikonfigurasi pengguna)

Prinsip: **tidak ada yang di-hardcode untuk satu bisnis.** Semua yang menentukan "siapa bot ini" dan "ke mana pelanggan diarahkan" diisi pengguna di aplikasi. Bagian ini menggantikan gambaran halaman "Bisnis" dan "Playbook" di bagian 11 dengan satu pusat pengaturan bernama **Brand & Konversi**.

### 17.1 Penyiapan awal (wizard 5 langkah, bisa dilewati dan dilanjutkan)

1. **Pilih jenis bisnis** (menjadi preset awal, semua bisa diubah): Toko Online, Jasa/Agensi, Kuliner, Klinik/Salon, Pendidikan/Kursus, Properti, Kustom.
2. **Identitas brand:** nama bisnis, nama bot, deskripsi satu kalimat, bahasa utama.
3. **Gaya bicara:** pilih nada dan lihat contoh langsung.
4. **Tujuan konversi:** tujuan utama dan aturan arah (lihat 17.3).
5. **Uji:** simulator percakapan dengan profil yang baru diisi, lalu aktifkan.
Setiap langkah punya penjelasan singkat dan contoh isian. Wizard tidak mengubah apa pun di bot yang sedang berjalan sampai pengguna menekan **Terapkan**.

### 17.2 Tab Identitas dan Gaya

| Bidang | Keterangan |
|---|---|
| Nama bisnis, nama bot | dipakai di sapaan dan prompt |
| Tentang bisnis (maks 500 karakter) | konteks singkat; bukan pengganti dokumen pengetahuan |
| Nada | Formal / Ramah / Santai-sopan / Antusias (dengan contoh tiap pilihan) |
| Sapaan pelanggan | Kak / Bapak-Ibu / Anda / mengikuti pelanggan |
| Tingkat emoji | 0 / 1 / 2 |
| Panjang jawaban | Ringkas / Sedang / Rinci |
| Bahasa | Indonesia / Inggris / ikuti pelanggan |
| Kata wajib dan kata terlarang | daftar (mis. selalu sebut nama brand; jangan pakai kata "murah") |
| Perkenalan bot | apakah bot mengaku sebagai asisten otomatis di pesan pertama (disarankan aktif) dan teks pengenalnya |
| Contoh gaya | 4–6 contoh pertanyaan dan jawaban ideal; dipakai sebagai contoh di prompt |

### 17.3 Tab Arah Konversi (inti permintaan ini)

**Tujuan utama** (satu dipilih): `Checkout` · `Serah ke admin` · `Kumpulkan lead` · `Booking jadwal` · `Kirim ke formulir`. Tujuan utama menjadi arah bawaan percakapan.

**Aturan arah (rule builder).** Tabel aturan yang dievaluasi dari atas ke bawah; aturan pertama yang cocok menang. Pengguna bisa menambah, mengurutkan, mengaktifkan, dan menonaktifkan.

| Bidang aturan | Pilihan |
|---|---|
| **Jika** (kondisi) | maksud pelanggan: tanya harga, tanya produk, siap beli, keberatan, minta manusia, komplain, sapaan, di luar konteks · kata kunci tertentu · produk tertentu · sedang di dalam/di luar jam kerja · tahap percakapan · jumlah giliran ≥ N |
| **Maka** (tindakan) | **Kirim checkout** (pilih produk/tautan) · **Kirim tautan** (booking, katalog, formulir, situs) · **Serah ke admin** (pilih admin/saluran) · **Tanya data lead** (pilih pertanyaan) · **Balas saja** · **Diam** |
| **Pesan** | template pesan yang menyertai tindakan (dapat diedit, mendukung variabel) |
| **Batas** | maksimal berapa kali per kontak |

Contoh aturan awal (preset "Jasa/Agensi"):
1. Jika maksud = komplain → Serah ke admin.
2. Jika maksud = minta manusia → Serah ke admin.
3. Jika kata kunci mengandung "refund" atau "tagihan" → Serah ke admin.
4. Jika maksud = siap beli dan data lead lengkap → Serah ke admin.
5. Jika maksud = siap beli dan data lead belum lengkap → Tanya data lead.
6. Jika di luar jam kerja → Balas saja dengan pesan jam kerja, lalu lanjutkan menggali kebutuhan.

Contoh aturan awal (preset "Toko Online"):
1. Jika maksud = komplain → Serah ke admin.
2. Jika maksud = siap beli atau produk diminati diketahui → Kirim checkout (produk bersangkutan).
3. Jika maksud = tanya harga → Balas harga dari katalog lalu tawarkan checkout.
4. Jika tautan checkout produk tidak ada → Serah ke admin.

**Prinsip keamanan aturan:** model hanya menyarankan maksud; aturan di atas yang memutuskan tindakan (bagian 4). Aturan tidak bisa diubah lewat pesan pelanggan.

**Tautan dan tujuan (daftar yang dapat dikelola):** nama, jenis (checkout / booking / katalog / formulir / situs), URL (wajib `https://`), apakah memakai parameter pelacakan, dan produk terkait. Hanya URL di daftar ini (ditambah katalog) yang boleh dikirim bot. Tombol **Uji tautan** memeriksa apakah URL bisa dibuka.

**Serah ke admin:** daftar admin (nama, nomor WhatsApp admin yang **harus berbeda dari nomor bot**, jam kerja per admin), saluran notifikasi (desktop, WhatsApp admin), format ringkasan lead yang dikirim, lama bot jeda setelah manusia mengambil alih, dan pesan pamit yang bisa diedit.

**Data lead:** pertanyaan kualifikasi yang dapat diedit: kunci, teks pertanyaan, wajib/opsional, urutan, kata untuk melewati. Syarat minimum untuk serah. Mode "tanya paling banyak N pertanyaan, jangan memaksa".

**Penanganan keberatan:** daftar keberatan umum (mahal, pikir dulu, bandingkan dulu, belum butuh) dengan jawaban yang ditulis pengguna; bot memakainya sebagai acuan, bukan menyalin kata demi kata.

**Pesan CTA:** template per tindakan dengan variabel `{nama}`, `{produk}`, `{harga}`, `{tautan}`, `{jam_kerja}`.

### 17.4 Tab Jam Kerja dan Batas

Jam kerja per hari, zona waktu, pesan di luar jam kerja, hari libur, batas balasan per kontak per jam, anggaran token harian, jeda setelah manusia mengambil alih, daftar kontak yang diabaikan (mis. keluarga).

### 17.5 Tab Pagar Pengaman (hanya dapat dipersempit pengguna)

Pengguna dapat menambah larangan (topik terlarang, klaim yang tidak boleh dibuat), tetapi **tidak dapat mematikan** pagar inti: penjaga nomor sendiri, allowlist tautan, pemeriksaan angka, dan pembatasan di luar konteks. Pagar inti ditampilkan sebagai status "aktif, tidak dapat dimatikan" beserta alasannya.

### 17.6 Panel pratinjau langsung

Di sisi kanan setiap tab ada simulator WhatsApp. Pengguna menulis pesan pelanggan, lalu melihat: balasan bot (gelembung bertahap), **tindakan yang diambil** (mis. "Kirim checkout: Paket Website UMKM"), aturan yang cocok, maksud yang terdeteksi, potongan dokumen yang dipakai, dan peringatan jika ada pagar yang aktif. Mode **Uji skenario**: simpan percakapan contoh dan jalankan ulang setelah mengubah pengaturan untuk melihat perubahan perilaku.

### 17.7 Validasi dan keselamatan perubahan

- Peringatan yang menghalangi **Terapkan**: nomor admin sama dengan nomor bot, tujuan "Checkout" tanpa satu pun tautan, aturan yang tidak pernah bisa cocok, tautan bukan `https`, jam kerja kosong tetapi aturan memakai jam kerja.
- **Draf dan versi:** perubahan disimpan sebagai draf; **Terapkan** membuat versi baru yang bernomor. Riwayat 20 versi dengan tombol **Pulihkan**.
- **Ekspor/impor profil** sebagai JSON (tanpa API key) untuk cadangan atau memindahkan antar komputer. Impor divalidasi dengan skema sebelum diterapkan.
- Perubahan berlaku untuk pesan berikutnya tanpa memulai ulang aplikasi; percakapan yang sedang berjalan tetap konsisten sampai selesai giliran.

### 17.8 Cara pengaturan masuk ke bot

```
BrandProfile (JSON, versi, disimpan lokal)
  ├─ compileSystemPrompt(profile, mode)  → bagian SYSTEM prompt (persona, gaya, larangan, contoh)
  ├─ ruleEngine(profile.rules, intent, state) → tindakan akhir (di kode, bukan di model)
  ├─ linkAllowlist(profile.links + katalog)   → filter URL keluaran
  └─ handoffConfig(profile.admins, hours)     → notifikasi dan jeda
```

Skema `BrandProfile` divalidasi dengan `zod` (satu sumber kebenaran untuk UI, IPC, dan mesin). IPC baru: `getProfile`, `saveDraft`, `applyProfile`, `listVersions`, `restoreVersion`, `previewChat(profileDraft, messages)`, `exportProfile`, `importProfile`. Tidak ada channel yang mengembalikan kredensial.

### 17.9 Kriteria penerimaan tambahan

- Mengganti nama bisnis, nama bot, nada, dan tujuan utama di UI mengubah balasan simulator tanpa mengubah kode.
- Aturan "maksud = siap beli → Kirim checkout produk X" mengirim tautan produk X, dan tautan di luar daftar tidak pernah terkirim.
- Aturan "komplain → Serah ke admin" memicu notifikasi dan jeda bot, apa pun nada jawaban model.
- Mengubah urutan dua aturan yang bertabrakan mengubah tindakan sesuai urutan.
- **Terapkan** ditolak jika nomor admin sama dengan nomor bot atau tujuan "Checkout" tidak punya tautan.
- Pulihkan versi lama mengembalikan perilaku persis seperti sebelumnya.
- Profil hasil ekspor dapat diimpor kembali dan menghasilkan perilaku yang sama; profil rusak ditolak dengan pesan galat jelas.
- Pagar inti tidak dapat dimatikan lewat UI maupun impor profil.

### 17.10 Dampak ke pengerjaan

Menjadi bagian **P0** karena arah konversi harus bisa diatur sejak awal: skema `BrandProfile`, `compileSystemPrompt`, `ruleEngine`, tab Identitas/Gaya, tab Arah Konversi (rule builder, tautan, admin), pratinjau langsung, dan validasi. **P1:** tab Jam Kerja dan Batas lanjutan, versi dan pemulihan, ekspor/impor, uji skenario tersimpan. Preset bisnis dan wizard masuk P0 versi sederhana (pilih preset lalu isi identitas), versi lengkap P1.
