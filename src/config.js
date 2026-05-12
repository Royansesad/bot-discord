// ============================================
// config.js - Centralized configuration
// ============================================
import 'dotenv/config';

const config = {
  // Discord
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID || null,

  // AI Services (Puter.js = free, no API key needed, just auth token)
  puterAuthToken: process.env.PUTER_AUTH_TOKEN || null,
  apimartApiKey: process.env.APIMART_API_KEY,
  apimartBaseUrl: process.env.APIMART_BASE_URL || 'https://api.apimart.dev/v1',

  // Audit
  auditLogChannelId: process.env.AUDIT_LOG_CHANNEL_ID || null,

  // Cooldowns (dalam detik)
  cooldowns: {
    default: parseInt(process.env.DEFAULT_COOLDOWN) || 3,
    adventure: parseInt(process.env.ADVENTURE_COOLDOWN) || 30,
    daily: parseInt(process.env.DAILY_COOLDOWN) || 86400,
    weekly: parseInt(process.env.WEEKLY_COOLDOWN) || 604800,
    fight: 60,
    chat: 5,
    generateImage: 15,
    weeklyBoss: 60,
    battle: 15,
  },

  // RPG Balance
  rpg: {
    baseXp: 100,
    xpMultiplier: 1.5,
    maxLevel: 100,
    dailyGold: { min: 50, max: 150 },
    dailyXp: { min: 20, max: 60 },
    weeklyGold: { min: 300, max: 800 },
    weeklyXp: { min: 100, max: 300 },
    weeklyBossMaxAttempts: 3,
    adventureEncounterRates: {
      enemy: 0.45,    // 45%
      boss: 0.01,     // 1%
      event: 0.24,    // 24%
      nothing: 0.30,  // 30%
    },
  },

  // Embed Colors
  colors: {
    primary: 0x5865F2,   // Discord Blurple
    success: 0x57F287,   // Green
    warning: 0xFEE75C,   // Yellow
    danger: 0xED4245,    // Red
    info: 0x5865F2,      // Blue
    rpg: 0xE67E22,       // Orange
    legendary: 0xF1C40F, // Gold
    epic: 0x9B59B6,      // Purple
    rare: 0x3498DB,      // Blue
    common: 0x95A5A6,    // Gray
  },
};

// Validasi config kritis
if (!config.token) {
  console.error('❌ DISCORD_TOKEN tidak ditemukan di .env!');
  process.exit(1);
}
if (!config.clientId) {
  console.error('❌ CLIENT_ID tidak ditemukan di .env!');
  process.exit(1);
}

export default config;
