// ============================================
// migrate-sqlite-to-neon.mjs
// Migrasi sekali jalan: SQLite (prisma/dev.db) -> PostgreSQL / NeonDB.
//
// Cara pakai:
//   1. DATABASE_URL di .env sudah diarahkan ke NeonDB
//   2. npx prisma generate
//   3. npx prisma db push
//   4. node scripts/migrate-sqlite-to-neon.mjs
//
// Semua import memakai gaya ESM yang aman untuk project "type": "module".
// `node:sqlite` adalah modul bawaan Node >= 22.5 (pada 22.x mungkin perlu flag
// --experimental-sqlite). Tidak menambah dependensi npm baru.
// ============================================
import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import prismaPkg from '@prisma/client';

const { PrismaClient } = prismaPkg;

const sqlitePath = process.env.SQLITE_DB_PATH || fileURLToPath(new URL('../prisma/dev.db', import.meta.url));

// Urutan penting: Player lebih dulu karena tabel lain punya foreign key ke sana.
const TABLES = [
  'Player',
  'AuditLog',
  'Warning',
  'ChatContext',
  'Cooldown',
  'InventoryItem',
  'WeeklyBossEntry',
  'BattleLog',
  'LavalinkNode',
];

// Kolom DateTime di SQLite disimpan sebagai integer millisecond.
const DATE_FIELDS = {
  Player: ['createdAt', 'updatedAt'],
  AuditLog: ['createdAt'],
  Warning: ['createdAt'],
  ChatContext: ['createdAt'],
  Cooldown: ['expiresAt'],
  InventoryItem: [],
  WeeklyBossEntry: ['weekStart', 'lastAttempt'],
  BattleLog: ['createdAt'],
  LavalinkNode: ['createdAt', 'updatedAt'],
};

// Boolean di SQLite disimpan sebagai 0/1.
const BOOL_FIELDS = {
  LavalinkNode: ['secure', 'isCustom'],
};

function normalizeRow(table, row) {
  const out = { ...row };
  for (const field of DATE_FIELDS[table] || []) {
    if (out[field] !== null && out[field] !== undefined) {
      out[field] = new Date(Number(out[field]));
    }
  }
  for (const field of BOOL_FIELDS[table] || []) {
    out[field] = Boolean(out[field]);
  }
  return out;
}

async function main() {
  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  const prisma = new PrismaClient();

  try {
    console.log(`📂 SQLite sumber : ${sqlitePath}`);
    console.log(`🌐 NeonDB tujuan : ${String(process.env.DATABASE_URL || '').replace(/:[^:@/]+@/, ':***@')}`);

    let total = 0;

    for (const table of TABLES) {
      const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all().map((row) => normalizeRow(table, row));
      const model = prisma[table.charAt(0).toLowerCase() + table.slice(1)];
      if (!model?.upsert) throw new Error(`Model Prisma untuk "${table}" tidak ditemukan. Jalankan: npx prisma generate`);

      for (const row of rows) {
        await model.upsert({
          where: { id: row.id },
          create: row,
          update: row,
        });
      }

      // Prisma tidak menggeser sequence saat insert dengan ID eksplisit.
      // Tanpa ini, record berikutnya akan gagal dengan "duplicate key id = 1".
      await prisma.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('"${table}"', 'id')::regclass, ` +
        `GREATEST(COALESCE((SELECT MAX("id") FROM "${table}"), 1), 1), ` +
        `(SELECT COUNT(*) FROM "${table}") > 0)`
      );

      total += rows.length;
      console.log(`   ✅ ${table.padEnd(16)} ${rows.length} baris`);
    }

    console.log(`\n🎉 Migrasi selesai. Total ${total} baris dipindahkan ke NeonDB.`);

    const diff = [];
    for (const table of TABLES) {
      const sourceCount = sqlite.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get().c;
      const targetCount = await prisma[table.charAt(0).toLowerCase() + table.slice(1)].count();
      if (sourceCount !== targetCount) diff.push(`${table}: sqlite=${sourceCount} neon=${targetCount}`);
    }

    if (diff.length) {
      console.error('❌ Verifikasi gagal:\n  ' + diff.join('\n  '));
      process.exitCode = 1;
    } else {
      console.log('🔍 Verifikasi lolos: jumlah baris di SQLite dan NeonDB identik.');
    }
  } finally {
    sqlite.close();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('❌ Migrasi gagal:', err);
  process.exit(1);
});
