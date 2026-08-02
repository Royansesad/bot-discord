-- ============================================================
-- DATABASE PERPUSTAKAAN
-- Aturan: anggota boleh meminjam lebih dari 1 buku,
--         tetapi TIDAK BOLEH meminjam buku yang sama
--         selama buku tersebut belum dikembalikan.
-- ============================================================

-- 1. BUAT DATABASE
CREATE DATABASE IF NOT EXISTS perpustakaan;
USE perpustakaan;

-- ============================================================
-- 2. TABEL MASTER
-- ============================================================

CREATE TABLE IF NOT EXISTS anggota (
    id_anggota INT PRIMARY KEY AUTO_INCREMENT,
    nama VARCHAR(100) NOT NULL,
    alamat VARCHAR(150),
    no_telp VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS buku (
    id_buku INT PRIMARY KEY AUTO_INCREMENT,
    judul VARCHAR(150) NOT NULL,
    pengarang VARCHAR(100),
    stok INT NOT NULL DEFAULT 1
);

-- ============================================================
-- 3. TABEL TRANSAKSI
-- ============================================================

CREATE TABLE IF NOT EXISTS peminjaman (
    id_peminjaman INT PRIMARY KEY AUTO_INCREMENT,
    id_anggota INT NOT NULL,
    id_buku INT NOT NULL,
    tanggal_pinjam DATE NOT NULL,
    tanggal_kembali DATE NULL,
    FOREIGN KEY (id_anggota) REFERENCES anggota(id_anggota),
    FOREIGN KEY (id_buku) REFERENCES buku(id_buku)
);

-- ============================================================
-- 4. DATA CONTOH
-- ============================================================

INSERT INTO anggota (nama, alamat, no_telp) VALUES
('Andi', 'Jl. Mawar 1', '0812xxxx'),
('Budi', 'Jl. Melati 2', '0813xxxx');

INSERT INTO buku (judul, pengarang, stok) VALUES
('Laskar Pelangi', 'Andrea Hirata', 5),
('Bumi Manusia', 'Pramoedya Ananta Toer', 3),
('Filosofi Teras', 'Henry Manampiring', 4);

-- ============================================================
-- 5. TRIGGER: cegah anggota meminjam buku yang sama
--    selama buku itu belum dikembalikan (tanggal_kembali IS NULL)
-- ============================================================

DROP TRIGGER IF EXISTS cek_aturan_pinjam;

DELIMITER $$

CREATE TRIGGER cek_aturan_pinjam
BEFORE INSERT ON peminjaman
FOR EACH ROW
BEGIN
    DECLARE sudah_pinjam_buku_sama INT;

    SELECT COUNT(*) INTO sudah_pinjam_buku_sama
    FROM peminjaman
    WHERE id_anggota = NEW.id_anggota
      AND id_buku = NEW.id_buku
      AND tanggal_kembali IS NULL;

    IF sudah_pinjam_buku_sama > 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Anggota sudah meminjam buku ini dan belum mengembalikannya';
    END IF;
END$$

DELIMITER ;

-- ============================================================
-- 6. CONTOH PENGUJIAN (boleh dijalankan manual satu per satu
--    untuk membuktikan trigger bekerja)
-- ============================================================

-- Andi pinjam buku 1 -> berhasil
-- INSERT INTO peminjaman (id_anggota, id_buku, tanggal_pinjam) VALUES (1, 1, '2026-07-28');

-- Andi pinjam buku 2 -> berhasil (buku berbeda)
-- INSERT INTO peminjaman (id_anggota, id_buku, tanggal_pinjam) VALUES (1, 2, '2026-07-28');

-- Andi pinjam buku 3 -> berhasil (boleh lebih dari 2 buku)
-- INSERT INTO peminjaman (id_anggota, id_buku, tanggal_pinjam) VALUES (1, 3, '2026-07-28');

-- Andi coba pinjam buku 1 lagi -> HARUS GAGAL (masih dipinjam)
-- INSERT INTO peminjaman (id_anggota, id_buku, tanggal_pinjam) VALUES (1, 1, '2026-07-28');

-- Simulasi pengembalian buku 1 oleh Andi
-- UPDATE peminjaman SET tanggal_kembali = '2026-08-01' WHERE id_peminjaman = 1;
