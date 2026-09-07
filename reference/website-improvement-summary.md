# Rangkuman Perbaikan Website

Sumber: transkrip otomatis `AUDIO-2026-08-20-12-16-08.transcript.txt`.

Catatan: Ini rangkuman masukan rapat, bukan hasil pengecekan kondisi website saat ini. Transkrip memiliki kesalahan pengenalan istilah dan bagian berulang. Bagian yang tidak jelas diabaikan; keputusan yang belum pasti ditandai untuk dikonfirmasi. Timestamp adalah perkiraan lokasi pembahasan.

## Import dan Update Data

1. **Perbaiki pembacaan struktur pekerjaan dari Excel.** Bagian, subbagian, dan item harus sesuai hierarki sumber. Contohnya, kolom merupakan subbagian pekerjaan struktur, bukan bagian terpisah. (02:26-07:06)
2. **Dukung berbagai format Excel dan banyak sheet.** Uji dengan file proyek berbeda, termasuk rekap, rumus, dan referensi antarsheet, bukan hanya satu contoh file. (26:09-29:01, 01:11:08-01:11:30)
3. **Atasi kendala ukuran file upload.** File laporan besar gagal diproses; dalam diskusi disebut batas sekitar 4 MB. Cek batas teknis sebenarnya, bukan langsung mengasumsikan upgrade paket hosting akan menyelesaikannya. (30:06-33:10)
4. **Pastikan progres aktual dalam Excel ikut terimport.** Saat demo, data yang sudah ada di Excel terlihat belum masuk ke tabel progres sehingga tabel masih kosong. (01:05:25-01:05:42)
5. **Tambahkan update progres melalui upload Excel terbaru pada proyek yang sama.** Pengguna lebih memilih upload laporan mingguan daripada mengetik ulang setiap angka. Tidak perlu membuat proyek baru setiap minggu. (01:05:42-01:07:14)
6. **Sediakan preview dan konfirmasi sebelum update hasil import.** Pengguna perlu mengetahui sheet, kolom, periode, dan angka mana yang akan diambil atau diperbarui. (01:07:14-01:08:15)

## Jadwal dan S-Curve

7. **Perjelas perbedaan tanggal kontrak, awal jadwal, dan pelaporan pertama.** Ketiganya tidak selalu sama. Acuan minggu pelaporan dan pengaruh perubahan tanggal terhadap jadwal juga perlu jelas. (00:00-01:22, 18:08-19:37)
8. **Perjelas satuan pada tabel jadwal.** Angka mulai, selesai, dan durasi sempat dikira tanggal atau jumlah hari, padahal sedang membahas minggu. Gunakan label seperti "Mulai minggu ke-" dan "Durasi (minggu)". (12:40-13:48)
9. **Bedakan bobot pekerjaan dengan persentase penyelesaian.** Jelaskan apakah angka menunjukkan bobot terhadap total proyek atau persentase penyelesaian suatu item. Tambahkan label, tanda persen, dan penjelasan singkat. (15:23-16:54)
10. **Perjelas input progres mingguan versus kumulatif.** Tentukan apakah pengguna mengisi tambahan progres minggu ini atau total progres sampai minggu ini agar tidak terjadi salah hitung. Pilihan akhirnya perlu dikonfirmasi. (22:48-23:18)
11. **Buat perbandingan rencana, aktual, dan deviasi lebih mudah ditemukan.** Informasinya sempat ditemukan saat demo, tetapi pengguna baru menyadari cara melihatnya. Fokus pada keterlihatan informasi, bukan otomatis menambah grafik baru. (01:13:38-01:15:07)

## Isu dan Dashboard

12. **Perjelas "Penanggung jawab", "Ditugaskan ke", dan "Pelapor".** Penanggung jawab bisa pihak eksternal tanpa akun, sedangkan pelapor dapat tercatat otomatis dari akun pembuat. Ada usulan menghapus kolom yang tumpang tindih, tetapi keputusan akhirnya perlu dikonfirmasi. (37:22-42:11)
13. **Buat kategori isu fleksibel.** Pengguna ingin mengetik atau menambah jenis isu sendiri jika pilihan yang tersedia tidak cocok. (54:35-57:24)
14. **Tampilkan kategori dan ringkasan isu di tampilan depan.** Pengguna ingin langsung mengetahui masalah proyek, termasuk yang berkaitan dengan jadwal, biaya, atau mutu, tanpa membuka detail satu per satu. (55:05-55:37, 58:39-59:30)
15. **Utamakan proyek yang membutuhkan perhatian di dashboard.** Sorot proyek dengan deviasi negatif, banyak isu, dan tindakan yang belum selesai agar pimpinan cepat mengetahui proyek bermasalah. (58:51-59:30, 01:01:18-01:01:54)
16. **Perjelas indikator keterlambatan pelaporan.** Label "Masalah pelaporan", angka di dekat ikon kalender, dan "Menunggu peninjauan" belum mudah dipahami. Tampilkan arti angka, periode yang belum dilaporkan, dan tanggal update terakhir. (59:34-01:04:44)

## Hak Akses dan Penggunaan

17. **Bedakan pengguna yang boleh mengedit dan hanya melihat.** Document control diarahkan untuk input/update data, sementara sebagian anggota tim cukup melihat. Pembagian akses admin, koordinator, pengawas, dan document control perlu dipastikan. (46:49-50:13)
18. **Tentukan siapa yang boleh mengubah status isu.** Ada masukan bahwa penerbit isu perlu memiliki kewenangan memperbarui status. Aturan final perlu diselaraskan dengan peran penanggung jawab dan admin. (45:33-45:47)
19. **Sederhanakan pekerjaan rutin pengguna.** Arah yang diinginkan: setup awal sekali, lalu upload progres mingguan dan update isu. Hindari pekerjaan ganda karena laporan Excel/hard copy tetap dibuat. (53:10-54:29, 01:05:42-01:06:49)
20. **Uji coba pada satu proyek terlebih dahulu.** Gunakan file dan alur kerja nyata sebagai pilot sebelum diterapkan ke seluruh proyek. (01:17:10-01:17:27)

## Rekomendasi Prioritas

Urutan berikut adalah rekomendasi berdasarkan pembahasan, bukan urutan prioritas yang dinyatakan secara eksplisit dalam rapat.

1. Akurasi import Excel, termasuk hierarki, banyak sheet, progres aktual, dan kendala upload.
2. Update Excel pada proyek existing dengan preview dan konfirmasi perubahan.
3. Kejelasan jadwal, satuan, bobot, dan perhitungan progres.
4. Dashboard isu dan indikator proyek yang membutuhkan perhatian.
5. Hak akses serta kejelasan peran dan kewenangan pada isu.
6. Pilot project menggunakan data dan pengguna nyata.

## Perlu Konfirmasi

- Apakah input progres menggunakan tambahan mingguan atau nilai kumulatif?
- Apakah kolom "Ditugaskan ke" dipertahankan, diperjelas, atau dihapus?
- Bagaimana pembagian hak akses admin, koordinator, pengawas, document control, dan pengguna hanya-lihat?
- Siapa yang boleh mengubah status atau menyelesaikan isu?
- Apa acuan tanggal, periode, dan batas keterlambatan pelaporan?
