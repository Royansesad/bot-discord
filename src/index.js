// ============================================
// index.js - Bot Entry Point
// ============================================
import discordJsPkg from 'discord.js';
const { Client, GatewayIntentBits, Collection, Partials } = discordJsPkg;
import config from './config.js';
import { loadCommands } from './handlers/commandLoader.js';
import { handleInteraction } from './events/interactionCreate.js';
import { onReady } from './events/ready.js';
import { logError } from './utils/errorManager.js';
import { initializeShoukaku, cleanupAll, getActiveEngine } from './services/musicService.js';
import { detectNativeTools } from './services/nativeEngine.js';
import { warmProxy } from './services/proxyManager.js';
import { createResilientPrisma, connectDatabase } from './services/database.js';

// Inisialisasi Prisma client dengan retry otomatis untuk koneksi Neon yang
// sempat idle/suspended (penyebab error "Can't reach database server").
const prisma = createResilientPrisma();

// Inisialisasi Discord client dengan intents yang diperlukan
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel, Partials.GuildMember],
});

// Attach prisma ke client agar bisa diakses dari command
client.prisma = prisma;

// Pastikan database siap sebelum node Lavalink dibaca dari database.
// Neon butuh ~5-7 detik untuk bangun dari idle; connectDatabase memberi waktu
// itu (dan tidak menghentikan bot bila tetap gagal).
await connectDatabase(prisma);

// Collection untuk menyimpan commands
client.commands = new Collection();

// Load semua commands
await loadCommands(client);

// ============================================
// Inisialisasi Shoukaku (Lavalink) SEBELUM login
// Shoukaku connector mendengarkan event 'clientReady' dari Discord.js
// Jika Shoukaku dibuat SETELAH ready, event sudah lewat dan nodes tidak akan connect!
// ============================================
try {
  const lavalink = await initializeShoukaku(client);
  if (lavalink) {
    console.log('🎵 Shoukaku (Lavalink) terdaftar — menunggu client ready untuk connect ke nodes...');
  } else {
    console.warn('⚠️ Shoukaku gagal diinisialisasi — fitur musik tidak tersedia.');
  }
} catch (err) {
  logError('Shoukaku Init', err);
  console.warn('⚠️ Gagal menginisialisasi Lavalink. Musik tidak akan berfungsi.');
}

// Cek ketersediaan tool engine native (youtubei.js / FFmpeg opsional)
{
  const tools = detectNativeTools();
  if (tools.youtubei) {
    console.log(`🪶 Native engine siap (youtubei.js, tanpa cookie${tools.proxy ? ', via proxy' : ''})${tools.ffmpeg ? ' + FFmpeg' : ' • Opus passthrough, tanpa FFmpeg'}`);
  } else {
    console.warn('⚠️ youtubei.js tidak tersedia — engine native tidak bisa dipakai (jalankan npm install).');
  }
  console.log(`🎛️ Engine audio aktif: ${getActiveEngine().toUpperCase()}`);
}

// Hangatkan proxy native di background agar /play pertama tidak menunggu
// proses fetch + health-check proxy publik.
warmProxy().catch(() => {});

// Event: Bot ready
client.once('ready', () => {
  onReady(client);
});

// Event: Interaction (slash commands, buttons, etc.)
client.on('interactionCreate', (interaction) => {
  handleInteraction(client, interaction).catch((error) => {
    logError('Interaction Handler', error);
  });
});

// Global error handling via Error Manager
client.on('error', (error) => {
  logError('Discord Client', error);
});

process.on('unhandledRejection', (error) => {
  // Skip jika error sudah di-intercept oleh safePuterTxt2Img wrapper
  if (error?._handled) return;
  logError('Unhandled Rejection', error);
});

process.on('uncaughtException', (error) => {
  // Skip jika error sudah di-intercept oleh safePuterTxt2Img wrapper
  if (error?._handled) return;
  logError('Uncaught Exception', error);
});

let shuttingDown = false;
async function shutdown(signal = 'SIGINT') {
  // Cegah shutdown ganda (SIGINT lalu SIGTERM) yang bisa membuat proses macet.
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`🔄 Shutting down (${signal})...`);
  try { cleanupAll(); } catch (error) { logError('Cleanup', error); } // Cleanup Lavalink connections
  try { await prisma.$disconnect(); } catch (error) { logError('Database Disconnect', error); }
  try { client.destroy(); } catch { /* sudah tertutup */ }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Login — setelah Shoukaku terdaftar, baru login
// Ketika client ready, Shoukaku connector otomatis catch 'clientReady' dan connect ke nodes
client.login(config.token).catch(err => {
  logError('Login', err);
  console.error('💡 Cek kembali DISCORD_TOKEN di file .env. Kemungkinan token salah atau sudah di-reset.');
  process.exit(1);
});
