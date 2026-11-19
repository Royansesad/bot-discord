// ============================================
// index.js - Bot Entry Point
// ============================================
import { Client, GatewayIntentBits, Collection, Partials } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import config from './config.js';
import { loadCommands } from './handlers/commandLoader.js';
import { handleInteraction } from './events/interactionCreate.js';
import { onReady } from './events/ready.js';
import { logError } from './utils/errorManager.js';
import { initializeShoukaku, cleanupAll, getActiveEngine } from './services/musicService.js';
import { detectNativeTools } from './services/nativeEngine.js';

// Inisialisasi Prisma client
const prisma = new PrismaClient();

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

// Cek ketersediaan tool engine native (yt-dlp / FFmpeg opsional)
{
  const tools = detectNativeTools();
  if (tools.ytdlp) {
    console.log(`🪶 Native engine siap (yt-dlp: ${tools.ytdlpPath})${tools.ffmpeg ? ' + FFmpeg' : ' • Opus passthrough, tanpa FFmpeg'}`);
  } else {
    console.warn('⚠️ yt-dlp tidak ditemukan — engine native tidak tersedia (set YTDLP_PATH).');
  }
  console.log(`🎛️ Engine audio aktif: ${getActiveEngine().toUpperCase()}`);
}

// Event: Bot ready
client.once('ready', () => {
  onReady(client);
});

// Event: Interaction (slash commands, buttons, etc.)
client.on('interactionCreate', (interaction) => handleInteraction(client, interaction));

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

process.on('SIGINT', async () => {
  console.log('🔄 Shutting down...');
  cleanupAll(); // Cleanup Lavalink connections
  await prisma.$disconnect();
  client.destroy();
  process.exit(0);
});

// Login — setelah Shoukaku terdaftar, baru login
// Ketika client ready, Shoukaku connector otomatis catch 'clientReady' dan connect ke nodes
client.login(config.token).catch(err => {
  logError('Login', err);
  console.error('💡 Cek kembali DISCORD_TOKEN di file .env. Kemungkinan token salah atau sudah di-reset.');
  process.exit(1);
});
