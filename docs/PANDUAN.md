# Panduan Pasang & Pakai — tl;dv Transcript Exporter

Panduan ini untuk pemasangan manual. Ikuti urutannya; tidak perlu keahlian
teknis.

---

## Ringkasan

| | |
| --- | --- |
| Fungsi | Mengambil **seluruh** transkrip dari halaman meeting tl;dv |
| Keluaran | Berkas `.md`, `.txt`, atau `.json` |
| Pemasangan | Sekali, lewat `chrome://extensions` (±2 menit) |
| Browser | Chrome, Edge, Brave, Opera (semua berbasis Chromium) |

---

## Bagian 1 — Memasang

### Langkah 1. Unduh dan ekstrak

1. Unduh `tldv-transcript-exporter-v1.0.0.zip`
2. Ekstrak ke folder **permanen** — misalnya `D:\ekstensi\tldv-exporter`

> **Penting:** jangan ekstrak ke folder Unduhan lalu menghapusnya. Chrome memuat
> ekstensi langsung dari folder itu, jadi folder harus tetap ada. Kalau folder
> dipindah atau dihapus, ekstensi berhenti bekerja.

Setelah diekstrak, folder harus terlihat seperti ini — `manifest.json` harus
**langsung di dalam** folder, bukan di dalam subfolder lagi:

```
tldv-exporter\
  manifest.json      <- harus di sini
  README.md
  LICENSE
  icons\
  src\
```

Kalau setelah ekstrak Anda mendapati `tldv-exporter\tldv-transcript-exporter\manifest.json`,
naikkan isi foldernya satu tingkat.

### Langkah 2. Buka halaman ekstensi Chrome

Di address bar ketik:

```
chrome://extensions
```

lalu Enter.

### Langkah 3. Nyalakan Developer mode

Sakelar **Developer mode** ada di **pojok kanan atas** halaman. Nyalakan.

Setelah menyala, tiga tombol baru muncul: **Load unpacked**, **Pack extension**,
**Update**.

### Langkah 4. Muat ekstensinya

1. Klik **Load unpacked**
2. Pilih folder hasil ekstrak tadi (`tldv-exporter`)
3. Klik **Select Folder**

Ekstensi muncul di daftar sebagai **tl;dv Transcript Exporter**.

> Kalau muncul pesan error saat memilih folder, hampir selalu karena
> `manifest.json` tidak berada di root folder yang dipilih. Lihat kembali
> Langkah 1.

### Langkah 5. Sematkan ke toolbar (opsional tapi disarankan)

1. Klik ikon **puzzle** di kanan address bar
2. Cari **tl;dv Transcript Exporter**
3. Klik ikon **pin**

Ikonnya sekarang menetap di toolbar.

---

## Bagian 2 — Memakai

### Langkah 1. Buka meeting di tl;dv

```
https://tldv.io/app/meetings/<ID_MEETING>/
```

### Langkah 2. Pastikan tab Transcript terbuka

Ekstensi membaca daftar transkrip yang sedang ditampilkan. Kalau yang terbuka
tab lain (Notes, Summary), pindah dulu ke **Transcript**.

### Langkah 3. Klik ikon ekstensi

Popup terbuka dan menampilkan:

- **Format** — pilih `.md`, `.txt`, atau `.json`
- **Export transcript** — tombol mulai
- Bilah kemajuan

### Langkah 4. Klik Export transcript

Ekstraksi berjalan. Bilah kemajuan menunjukkan posisi, misalnya `218 / 390`.

**Durasi:** kira-kira 3–5 menit untuk meeting 1 jam 40 menit. Ini normal —
kecepatannya dibatasi oleh seberapa cepat halaman tl;dv me-render ulang
transkripnya.

**Halaman akan menggulir sendiri.** Jangan sentuh scroll, jangan pindah tab, dan
jangan tutup tab tl;dv selama proses berjalan.

### Langkah 5. Berkas tersimpan

Berkas terunduh otomatis saat selesai:

```
tldv-transcript-6ac740deabce3900133486c2-20261009-2045.md
```

Nama berkas berisi ID meeting dan tanggal ekspor.

---

## Bagian 3 — Kalau ada masalah

### "Buka halaman tl;dv dulu"

Popup tidak mendeteksi halaman yang benar. Buka halaman meeting tl;dv di tab
aktif, lalu klik ikon ekstensi lagi.

### "No transcript blocks found"

Tab **Transcript** belum terbuka di tl;dv. Buka dulu, lalu ulangi.

### Proses berhenti di tengah jalan

Halaman kehilangan fokus, atau Anda menggulir sendiri saat proses berjalan.
Klik **Export transcript** lagi — hasil sebelumnya dipakai ulang, jadi tidak
mengulang dari nol.

### Berkas berisi peringatan blok hilang

Ini **normal** dan memang disengaja. Contoh:

```markdown
- **Warning:** 6 block(s) could not be rendered and are absent (indices: 270, 271, …)
```

Kadang halaman tl;dv tidak mau me-render beberapa blok, sekeras apa pun
didorong. Daripada menggagalkan seluruh ekspor, ekstensi menyimpan apa yang
didapat dan **memberi tahu Anda apa yang hilang**. Transkrip yang jujur soal
kekurangannya lebih berguna daripada yang terlihat lengkap padahal tidak.

Kalau peringatannya banyak (>15% blok hilang), ekstensi justru **menolak**
berekspor dan menampilkan error — supaya Anda tidak mengira sudah dapat
transkrip lengkap padahal tidak.

### Berkas keluarnya kosong atau isinya cuma angka

Ini tanda struktur DOM tl;dv berubah. Laporkan ke
[GitHub Issues](https://github.com/EgiStr/tldv-transcript-extension/issues) —
ekstensi memang dirancang gagal dengan berisik, bukan diam-diam salah.

### Setelah saya mengubah kode

Tekan tombol **reload** (ikon panah melingkar) pada kartu ekstensi di
`chrome://extensions`.

Kalau hasilnya tetap aneh, Chrome mungkin menyajikan modul lama dari cache:

1. Tutup semua jendela Chrome
2. Buka folder profil: `%LOCALAPPDATA%\Google\Chrome\User Data\Default`
3. Hapus folder bernama `Service Worker` dan `Code Cache`
4. Jalankan Chrome lagi

---

## Bagian 4 — Yang perlu Anda tahu soal isinya

**Transkrip ini adalah teks auto-caption mentah dari tl;dv.**

- Nama orang dan istilah teknis banyak yang **salah dengar** oleh sistem tl;dv.
  Contoh nyata dari berkas hasil: `teklokannya`, `capan`, `meng, KPI`.
- Label pembicara **tidak konsisten** — satu orang bisa muncul dengan ejaan
  berbeda di blok berbeda.
- Tidak ada tanda baca yang bisa dipercaya; kapitalisasi tidak seragam.

Artinya: berkas ini **bukan transkrip siap terbit**. Anggap sebagai bahan
mentah yang masih perlu disunting. Kalau butuh akurasi tinggi, verifikasi
kutipan penting langsung ke rekaman video.

**Ekstensi ini tidak mengubah teks apa pun.** Ia menyalin persis apa yang
ditampilkan tl;dv. Kalau teksnya keliru di layar, ia keliru juga di berkas.

---

## Bagian 5 — Privasi dan izin

Ekstensi ini **tidak mengirim data ke mana pun.**

- Tidak ada server, tidak ada API pihak ketiga, tidak ada telemetri.
- Tidak ada analytics, tidak ada pelacakan.
- Seluruh proses berjalan lokal di browser Anda.
- Berkas hasil dibuat di komputer Anda dan tidak pernah diunggah.

### Izin yang diminta dan alasannya

| Izin | Untuk apa |
| --- | --- |
| `downloads` | Menyimpan berkas transkrip ke folder Unduhan Anda |
| `storage` | Mengingat pilihan format dan hasil ekspor terakhir |
| `scripting` | Menanamkan pembaca transkrip bila pemuatan otomatis belum siap |
| `https://tldv.io/*` | Membaca halaman meeting tl;dv — **hanya** origin ini |

Hanya `tldv.io` yang diakses. Ekstensi tidak bisa membaca situs lain.

---

## Bagian 6 — Mencopot pemasangan

1. Buka `chrome://extensions`
2. Cari **tl;dv Transcript Exporter**
3. Klik **Remove**

Setelah dihapus, Anda boleh menghapus folder ekstrakannya. Berkas transkrip yang
sudah terunduh tetap ada di folder Unduhan Anda — itu milik Anda, bukan milik
ekstensi.
