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

import { initKazagumo } from './services/musicService.js';

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

// Inisialisasi Kazagumo Lavalink Service (Pure JS, zero native C++ deps)
initKazagumo(client);

// Load semua commands
await loadCommands(client);

// Event: Bot ready
client.on('ready', () => onReady(client));

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
  await prisma.$disconnect();
  client.destroy();
  process.exit(0);
});

// Login
client.login(config.token).catch(err => {
  logError('Login', err);
  console.error('💡 Cek kembali DISCORD_TOKEN di file .env. Kemungkinan token salah atau sudah di-reset.');
  process.exit(1);
});
