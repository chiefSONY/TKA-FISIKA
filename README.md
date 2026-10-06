# TKA Fisika Online — 30 Menit

## Alur siswa
1. Masukkan Nama, Kelas, No. Absen, dan Asal Sekolah.
2. Sistem membentuk username: `Nama-Kelas-NoAbsen-AsalSekolah`.
3. Mulai ujian 30 menit.
4. Countdown dihitung berdasarkan waktu server.
5. Jawaban tersimpan otomatis.
6. Submit manual atau timer habis.
7. Nilai muncul.
8. Masukkan nilai tersebut sebagai password untuk membuka pembahasan.

## Jalankan lokal
Node.js 22+
`npm install`
`npm start`
Buka http://localhost:3000

## Online
Deploy sebagai Node.js web service di Render/Railway/Fly.io/VPS/server sekolah.
SQLite membutuhkan persistent disk/volume agar database tidak hilang ketika service restart/redeploy.

## Catatan
Password pembahasan = nilai (0–10) sesuai permintaan. Ini berfungsi sebagai gate pembahasan, bukan password keamanan kuat.
