// ============================================
// seed-lavalink-nodes.mjs
// Seed node Lavalink bawaan ke database (NeonDB). Aman dijalankan berulang
// (upsert berdasarkan nama). Dibutuhkan sekali saat deployment pertama kali /
// setelah database kosong, karena node sekarang bersumber dari database agar
// /lavalink remove bersifat permanen (tidak muncul lagi saat bot restart).
//
// Jalankan: node scripts/seed-lavalink-nodes.mjs
// ============================================
import 'dotenv/config';
import prismaPkg from '@prisma/client';
import { normalizeDatabaseUrl } from '../src/utils/dbUrl.js';

const { PrismaClient } = prismaPkg;

const NODES = [
  { name: 'Sereneta (SSL)', url: 'lavalinkv4.serenetia.com:443', auth: 'https://seretia.link/discord', secure: true, priority: 'main' },
  { name: 'Sereneta (HTTP)', url: 'lavalinkv4.serenetia.com:80', auth: 'https://seretia.link/discord', secure: false, priority: 'fallback' },
  { name: 'MilloHost (SSL)', url: 'lava-v4.millohost.my.id:443', auth: 'https://discord.gg/mjS5J2K3ep', secure: true, priority: 'secondary' },
  { name: 'Kasawa (Public)', url: 'lava2.kasawa.pro:2334', auth: 'youshallnotpass', secure: false, priority: 'secondary' },
  { name: 'Jirayu (SSL)', url: 'lavalink.jirayu.net:443', auth: 'youshallnotpass', secure: true, priority: 'secondary' },
  { name: 'Jirayu (13592)', url: 'lavalink.jirayu.net:13592', auth: 'youshallnotpass', secure: false, priority: 'fallback' },
  { name: 'Nazha (SSL)', url: 'lavalink.nazha.online:443', auth: 'nazhafreelava', secure: true, priority: 'secondary' },
];

// connect_timeout dinaikkan agar Neon yang sedang idle/suspended sempat bangun
// (default Prisma 5 detik -> error "Can't reach database server").
const prisma = new PrismaClient({ datasourceUrl: normalizeDatabaseUrl() });

try {
  for (const node of NODES) {
    const existing = await prisma.lavalinkNode.findUnique({ where: { name: node.name } });
    if (existing) {
      await prisma.lavalinkNode.update({ where: { name: node.name }, data: node });
      console.log(`♻️  Update  ${node.name}`);
    } else {
      await prisma.lavalinkNode.create({ data: { ...node, isCustom: true } });
      console.log(`➕ Tambah  ${node.name}`);
    }
  }

  const total = await prisma.lavalinkNode.count();
  console.log(`\n✅ Selesai. Total ${total} node tersimpan di database.`);
} finally {
  await prisma.$disconnect();
}
