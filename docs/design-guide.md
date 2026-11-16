# Design Guide --- Rubick Admin Dashboard

## 1. Overview

Panduan ini mendokumentasikan bahasa visual dashboard **Rubick**
berdasarkan referensi desain yang diberikan. Antarmuka menggunakan pola
**admin dashboard** dengan sidebar navigasi berwarna biru, area kerja
berwarna abu-abu sangat muda, dan konten yang disusun dalam kartu-kartu
putih.

**Karakter desain** - Profesional, informatif, dan berorientasi pada
data. - Padat fitur, tetapi tetap dipisahkan ke dalam modul yang
jelas. - Mengutamakan keterbacaan, pemindaian cepat, dan akses ke
navigasi utama. - Menggunakan warna biru sebagai identitas visual dan
warna netral sebagai latar konten.

> Catatan: nilai warna, ukuran, dan tipografi di bawah merupakan
> estimasi visual dari screenshot, bukan token desain asli.

## 2. Design Principles

1.  **Clear hierarchy** --- bedakan navigasi, judul halaman, ringkasan
    metrik, dan detail data.
2.  **Card-based layout** --- kelompokkan informasi terkait dalam kartu
    dengan latar putih.
3.  **Information density** --- tampilkan banyak informasi dalam satu
    halaman tanpa membuat setiap bagian terlihat menyatu.
4.  **Consistent spacing** --- gunakan jarak dan padding yang konsisten
    antarkomponen.
5.  **Action visibility** --- tombol, filter, ekspor, dan aksi tabel
    ditempatkan dekat dengan konteks penggunaannya.
6.  **Data-first presentation** --- angka utama, status, grafik, dan
    perubahan metrik harus mudah ditemukan.

## 3. Visual Identity

### 3.1 Color Palette

  -----------------------------------------------------------------------
  Token                   Estimasi warna          Penggunaan
  ----------------------- ----------------------- -----------------------
  Primary                 `#2449A8`               Sidebar, tombol utama,
                                                  elemen aktif

  Primary Dark            `#1D3F98`               Area sidebar dan aksen
                                                  biru yang lebih pekat

  Primary Light           `#EAF0FC`               Highlight lembut,
                                                  selected state

  Page Background         `#F3F5F9`               Latar utama halaman

  Surface                 `#FFFFFF`               Kartu, panel, tabel

  Text Primary            `#263247`               Judul dan teks utama

  Text Secondary          `#7B8798`               Label, metadata,
                                                  deskripsi

  Border                  `#E7EBF1`               Garis pemisah dan batas
                                                  komponen

  Success                 `#9BCB42`               Status aktif, kenaikan,
                                                  indikator positif

  Warning                 `#E9B34A`               Peringatan dan kategori
                                                  usia

  Danger                  `#D97979`               Status tidak aktif,
                                                  pembatalan, aksi hapus
  -----------------------------------------------------------------------

**Aturan penggunaan warna** - Biru adalah warna dominan untuk navigasi
dan aksi utama. - Gunakan latar putih untuk memisahkan modul dari latar
halaman. - Warna status hanya digunakan sebagai indikator, bukan
dekorasi. - Pastikan teks di atas warna berkontras cukup untuk dibaca.

### 3.2 Typography

Screenshot menunjukkan tipografi sans-serif modern dengan ukuran relatif
ringkas.

  Elemen               Rekomendasi ukuran Weight
  ------------------ -------------------- ----------
  Page title                    20--24 px 600--700
  Section title                 15--18 px 600
  Card title                    13--15 px 600
  KPI value                     24--32 px 600--700
  Body text                     12--14 px 400
  Label / metadata              10--12 px 400--500
  Button                        12--13 px 500--600

**Rekomendasi font:** Inter, DM Sans, atau font sans-serif modern
sejenis. Gunakan satu keluarga font secara konsisten.

## 4. Layout & Grid

### 4.1 App Shell

Struktur dasar halaman terdiri dari: - **Sidebar kiri** sebagai navigasi
utama. - **Top bar** untuk breadcrumb, pencarian, notifikasi, dan
profil. - **Main content** untuk dashboard dan modul informasi.

Pada referensi, sidebar memiliki lebar sekitar 140 px pada screenshot
735 px. Untuk implementasi responsif, gunakan lebar tetap yang
proporsional pada desktop dan mode drawer pada layar kecil.

### 4.2 Main Content

-   Latar area kerja: abu-abu sangat muda.
-   Konten menggunakan grid multi-kolom.
-   Jarak antarbagian relatif rapat, tetapi setiap kelompok informasi
    tetap memiliki batas visual.
-   Kartu menggunakan padding konsisten.
-   Bagian tabel dan panel lebar dapat menggunakan seluruh lebar konten.

**Rekomendasi spacing scale**

  Token         Nilai
  ----------- -------
  `space-1`      4 px
  `space-2`      8 px
  `space-3`     12 px
  `space-4`     16 px
  `space-5`     20 px
  `space-6`     24 px
  `space-8`     32 px

### 4.3 Responsive Behavior

-   **Desktop:** sidebar selalu terlihat; dashboard menggunakan grid
    multi-kolom.
-   **Tablet:** sidebar dapat diperkecil atau diubah menjadi drawer;
    jumlah kolom dikurangi.
-   **Mobile:** sidebar menjadi menu drawer; kartu disusun satu kolom;
    tabel menggunakan horizontal scrolling atau tampilan list
    alternatif.
-   Hindari mengecilkan teks secara berlebihan hanya untuk
    mempertahankan jumlah kolom.

## 5. Navigation

### Sidebar

Karakteristik: - Latar biru solid. - Logo dan nama produk berada di
bagian atas. - Item navigasi menggunakan ikon outline dan label. - Item
aktif memiliki latar atau highlight yang lebih terang. - Menu yang
memiliki submenu menampilkan chevron. - Jarak vertikal antaritem cukup
untuk memudahkan klik.

**Struktur navigasi yang terlihat pada referensi** - Dashboard -
Overview 1, Overview 2, Overview 3 - Menu Layout - Inbox - File
Manager - Point of Sale - Chat - Post - Calendar - CRUD - Users -
Profile - Pages - Components - Forms - Widgets

Nama di atas mengikuti label yang tampak pada screenshot dan dapat
disesuaikan dengan kebutuhan produk.

### Top Bar

Komponen: - Breadcrumb di sisi kiri. - Search field di sisi kanan. -
Notification icon. - Avatar/profile menu.

Gunakan tinggi top bar yang ringkas dan alignment vertikal yang
konsisten.

## 6. Dashboard Information Architecture

Halaman dashboard pada referensi disusun dalam beberapa kelompok
berikut.

### 6.1 Announcement Banner

-   Banner horizontal di bagian atas konten.
-   Warna biru sebagai penekanan.
-   Teks pengumuman singkat.
-   Tombol dismiss di sisi kanan.

### 6.2 General Report

Kartu ringkasan performa dengan: - Filter periode, misalnya Daily. -
Nilai pendapatan utama. - Persentase perubahan. - Ringkasan transaksi,
cancellation, gross rental value, gross rental profit, dan new users. -
Tombol untuk mengunduh laporan.

Gunakan angka utama dengan ukuran lebih besar daripada label dan
keterangan.

### 6.3 Realtime Active Users

-   Menampilkan jumlah pengguna aktif.
-   Grafik aktivitas per waktu.
-   Daftar top active pages.
-   Jumlah pengguna aktif per halaman.

Grafik harus memiliki label dan konteks periode yang jelas. Hindari
mengandalkan warna saja untuk membedakan data.

### 6.4 Users by Age

-   Donut chart untuk distribusi kelompok usia.
-   Angka total pengguna aktif di tengah chart.
-   Legend dengan label kategori.
-   Tab Active dan Inactive.

Pastikan warna chart konsisten dengan legend.

### 6.5 Official Store Map

-   Kartu peta dengan marker lokasi.
-   Filter lokasi/kota.
-   Kontrol Map/Satellite dan zoom mengikuti kebutuhan peta.
-   Tampilkan jumlah atau identitas lokasi secara ringkas.

### 6.6 Weekly Best Sellers

-   Daftar item dengan thumbnail/avatar.
-   Nama item dan tanggal atau metadata.
-   Badge angka penjualan.
-   Tombol View More.

Gunakan pola list vertikal agar banyak item dapat dipindai dengan cepat.

### 6.7 Promotional Banners

Dua kartu promosi berdampingan: - Ilustrasi atau visual pendukung. -
Headline singkat. - Deskripsi pendek. - Satu CTA yang jelas.

Jangan menempatkan terlalu banyak pesan atau tombol dalam satu banner.

### 6.8 Weekly Top Products

Tabel produk berisi: - Thumbnail. - Product name dan kategori. -
Stock. - Status. - Actions.

Ketentuan: - Header tabel memiliki kontras yang cukup. - Setiap baris
memiliki tinggi yang konsisten. - Status menggunakan badge. - Aksi Edit
dan Delete ditampilkan sebagai aksi sekunder. - Pagination dan jumlah
baris ditempatkan di bawah tabel. - Sediakan export action di area kanan
atas tabel.

### 6.9 Important Notes

-   Panel notifikasi atau pengumuman.
-   Judul dan waktu publikasi.
-   Isi ringkas.
-   Aksi View Notes dan Dismiss.
-   Kontrol navigasi antar-notes bila diperlukan.

### 6.10 Schedules, Recent Activities & Transactions

Tiga panel informasi: - **Schedules:** kalender bulanan dan daftar
agenda. - **Recent Activities:** timeline aktivitas pengguna atau tim. -
**Transactions:** daftar transaksi terbaru dengan nilai dan indikator
positif/negatif.

Gunakan pola visual yang konsisten, tetapi bedakan jenis informasinya
melalui struktur konten.

## 7. Component Guidelines

### Cards

-   Background putih.
-   Border tipis atau shadow sangat lembut.
-   Radius rekomendasi 8--12 px.
-   Padding rekomendasi 16--20 px.
-   Hindari shadow gelap atau berlapis.

### Buttons

-   Primary: biru solid dengan teks putih.
-   Secondary: putih atau transparan dengan border netral.
-   Destructive: merah untuk aksi yang menghapus atau membatalkan.
-   Gunakan label aksi yang spesifik, misalnya `Download Report`, bukan
    label yang ambigu.

### Inputs & Filters

-   Tinggi kontrol konsisten, sekitar 32--40 px.
-   Border netral dan radius kecil hingga sedang.
-   Placeholder menggunakan warna sekunder.
-   Filter periode dan lokasi diletakkan dekat dengan data yang
    dikontrol.

### Badges & Status

-   Gunakan badge untuk status seperti Active dan Inactive.
-   Pilih latar warna lembut dengan teks yang tetap terbaca.
-   Status harus ditulis sebagai teks; jangan hanya mengandalkan warna.

### Tables

-   Gunakan alignment kolom yang konsisten.
-   Angka dapat diratakan ke kanan.
-   Nama dan deskripsi berada dalam satu kelompok.
-   Sediakan hover state yang halus.
-   Pada layar kecil, pertahankan akses ke semua kolom melalui scrolling
    atau layout alternatif.

### Charts

-   Hindari gridline yang terlalu dominan.
-   Tampilkan nilai dan periode dengan jelas.
-   Gunakan legend jika terdapat lebih dari satu kategori.
-   Sediakan tooltip pada data point jika interaksi chart didukung.

### Icons

-   Gunakan satu gaya ikon, idealnya outline.
-   Ukuran umum 16--20 px untuk navigasi dan aksi.
-   Hindari mencampur ikon filled dan outline tanpa aturan.

## 8. Radius, Border & Elevation

  Elemen          Rekomendasi
  --------------- ------------------------------------------------------------
  Small control   Radius 4--6 px
  Card            Radius 8--12 px
  Large banner    Radius 8--12 px
  Input           Border 1 px
  Card border     `#E7EBF1`
  Shadow          Sangat lembut, misalnya `0 2px 8px rgba(20, 35, 60, 0.05)`

Gunakan border sebagai pemisah utama. Shadow hanya untuk memberi sedikit
kedalaman.

## 9. Interaction & States

Setiap komponen interaktif perlu memiliki state yang jelas: - Default -
Hover - Focus - Active / Selected - Disabled - Loading - Empty - Error -
Success

Panduan: - Berikan feedback visual ketika menu atau tab dipilih. -
Gunakan focus indicator yang terlihat untuk keyboard navigation. -
Tombol disabled harus tetap terbaca. - Tampilkan loading state saat data
sedang diambil. - Sediakan empty state yang menjelaskan langkah
berikutnya. - Konfirmasi sebelum aksi destruktif seperti Delete.

## 10. Accessibility

-   Jaga kontras teks dan latar.
-   Jangan menggunakan warna sebagai satu-satunya pembeda status.
-   Gunakan ukuran target klik yang memadai.
-   Pastikan navigasi dapat digunakan dengan keyboard.
-   Berikan label yang jelas pada ikon-only button melalui accessible
    name atau tooltip.
-   Gunakan heading secara hierarkis.
-   Pastikan tabel dan chart memiliki informasi tekstual pendamping.

## 11. Suggested Design Tokens

``` css
:root {
  --color-primary: #2449A8;
  --color-primary-dark: #1D3F98;
  --color-primary-light: #EAF0FC;

  --color-background: #F3F5F9;
  --color-surface: #FFFFFF;
  --color-border: #E7EBF1;

  --color-text-primary: #263247;
  --color-text-secondary: #7B8798;

  --color-success: #9BCB42;
  --color-warning: #E9B34A;
  --color-danger: #D97979;

  --radius-control: 6px;
  --radius-card: 10px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
}
```

## 12. Implementation Checklist

### Foundation

-   [ ] Tetapkan font family dan type scale.
-   [ ] Implementasikan color tokens.
-   [ ] Tetapkan spacing, radius, border, dan shadow tokens.
-   [ ] Pastikan kontras warna memenuhi kebutuhan aksesibilitas.

### Layout

-   [ ] Buat app shell: sidebar, top bar, dan main content.
-   [ ] Implementasikan grid responsif.
-   [ ] Pastikan sidebar memiliki active, hover, dan collapsed/drawer
    state.
-   [ ] Uji layout pada desktop, tablet, dan mobile.

### Components

-   [ ] Card dan section header.
-   [ ] Button dan icon button.
-   [ ] Search, select, dan filter.
-   [ ] Badge dan status indicator.
-   [ ] Data table dan pagination.
-   [ ] Chart container dan legend.
-   [ ] Banner, activity list, dan calendar.

### Dashboard

-   [ ] General report.
-   [ ] Realtime active users.
-   [ ] Users by age.
-   [ ] Store map.
-   [ ] Best sellers.
-   [ ] Promotional banners.
-   [ ] Product table.
-   [ ] Important notes.
-   [ ] Schedules, recent activities, dan transactions.

### Quality

-   [ ] Semua kontrol memiliki state interaksi.
-   [ ] Tabel tetap dapat digunakan pada layar kecil.
-   [ ] Loading, empty, dan error state tersedia.
-   [ ] Aksi Delete memiliki konfirmasi.
-   [ ] Ikon memiliki label aksesibel.

## 13. Design Summary

Arah desain Rubick dapat dirangkum sebagai **blue sidebar + light
workspace + white modular cards + compact data visualization**.
Pertahankan struktur dashboard yang padat dan modular, tetapi
prioritaskan keterbacaan, konsistensi komponen, responsivitas, dan
aksesibilitas saat diimplementasikan.
