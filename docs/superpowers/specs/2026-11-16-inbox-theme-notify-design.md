# Menu Pesan real-time, tombol tema, notifikasi chat, menu bar tersembunyi — Rancangan

Status: permintaan pengguna (5 poin) dalam percakapan, 2026-11-16; pilihan di bawah adalah keputusan saya atas hal yang tidak ditentukan permintaan. Visual mengikuti `docs/design-guide.md`.

## Permintaan
1. Pintasan mode gelap/terang di samping ikon notifikasi.
2. Uji mode; mode terang saat ini tidak berfungsi.
3. Satu menu untuk melihat daftar pesan secara real-time.
4. Sembunyikan menu bar jendela (File, Window, dst.).
5. Notifikasi di setiap chat masuk.

## Temuan akar masalah (poin 2)
Pemilih tema dipindah ke halaman Keamanan & Umum, tetapi halaman itu dan `Shell` masing-masing memuat salinan pengaturan sendiri lewat `useSettings`. Mengganti tema menyimpan nilainya, tetapi `Shell` (yang menerapkan `data-bs-theme`) tidak pernah tahu, jadi tampilan baru berubah setelah aplikasi dimulai ulang. Pada OS bermode gelap, memilih "Terang" tidak tampak berfungsi. `index.html` juga memakai `data-bs-theme="auto"` yang bukan nilai Bootstrap yang sah, dan layar kunci tidak memakai tema pilihan pengguna.

## Tujuan
- Satu sumber pengaturan bersama (context) untuk semua halaman; tema langsung diterapkan; tema terakhir disimpan di `localStorage` dan diterapkan sebelum render pertama (layar kunci ikut).
- Tombol tema di top bar, di sebelah lonceng, beralih terang/gelap.
- Halaman **Pesan**: daftar chat (pesan terakhir, waktu) dan percakapan terpilih, diperbarui real-time lewat event dari proses utama. Menampilkan pesan masuk, balasan bot, dan pesan yang diketik manusia dari HP. Hanya baca.
- Notifikasi desktop untuk setiap pesan masuk yang baru (≤ 2 menit), dengan saklar di Keamanan & Umum (bawaan: aktif). Saat aplikasi terkunci, isi pesan disamarkan.
- Menu bar jendela tidak tampil di semua platform.

## Bukan tujuan / anti-tujuan
- Tidak ada pengiriman pesan manual dari halaman Pesan (pengambilalihan manusia tetap lewat HP).
- Tidak menyimpan media; pesan non-teks tampil sebagai "(pesan non-teks)".
- Notifikasi tidak boleh membocorkan isi pesan ketika terkunci; riwayat sinkronisasi lama tidak boleh memicu banjir notifikasi.
- Tidak mengubah logika balasan bot.

## Pendekatan untuk Pesan
1. **Tabel `messages` baru + `MessageFeed` (dipilih):** pipeline mencatat setiap pesan masuk, balasan terkirim, dan pesan manusia; mengeluarkan event `message`; satu sumber untuk daftar awal, event real-time, dan notifikasi. Bekerja di mode ekstraktif maupun AI.
2. Memakai tabel `turns`: hanya terisi pada mode AI dan tanpa pesan masuk yang diabaikan. Ditolak.
3. Memakai `message_log`: tidak menyimpan teks balasan. Ditolak.

## Keputusan saya (bukan dari permintaan)
- Pesan grup dicatat dan ditampilkan dengan label "Grup"; hanya `status@broadcast` dan siaran yang dilewati.
- Saklar notifikasi ditambahkan karena notifikasi untuk setiap pesan bisa mengganggu; bawaan aktif sesuai permintaan.
- Menu bar disembunyikan permanen, termasuk saat pengembangan; DevTools saat pengembangan lewat F12 / Ctrl+Shift+I.
