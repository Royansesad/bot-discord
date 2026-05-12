// ============================================
// errorManager.js - Centralized Error Manager
// Catches, logs, and formats errors for users
// ============================================
import { EmbedBuilder } from 'discord.js';
import config from '../config.js';

/**
 * Error types for categorization
 */
export const ErrorType = {
  DATABASE: 'database',
  PERMISSION: 'permission',
  VALIDATION: 'validation',
  COOLDOWN: 'cooldown',
  NOT_FOUND: 'not_found',
  BATTLE: 'battle',
  INVENTORY: 'inventory',
  NETWORK: 'network',
  UNKNOWN: 'unknown',
};

/**
 * Map error type ke emoji dan warna
 */
const ERROR_META = {
  [ErrorType.DATABASE]: { emoji: '🗄️', label: 'Database Error', color: config.colors.danger },
  [ErrorType.PERMISSION]: { emoji: '🔒', label: 'Permission Denied', color: config.colors.warning },
  [ErrorType.VALIDATION]: { emoji: '⚠️', label: 'Validasi Gagal', color: config.colors.warning },
  [ErrorType.COOLDOWN]: { emoji: '⏳', label: 'Cooldown', color: config.colors.warning },
  [ErrorType.NOT_FOUND]: { emoji: '🔍', label: 'Tidak Ditemukan', color: config.colors.info },
  [ErrorType.BATTLE]: { emoji: '⚔️', label: 'Battle Error', color: config.colors.danger },
  [ErrorType.INVENTORY]: { emoji: '🎒', label: 'Inventory Error', color: config.colors.warning },
  [ErrorType.NETWORK]: { emoji: '🌐', label: 'Network Error', color: config.colors.danger },
  [ErrorType.UNKNOWN]: { emoji: '❌', label: 'Error', color: config.colors.danger },
};

/**
 * Custom RPG Error class
 */
export class RPGError extends Error {
  constructor(type, message, details = null) {
    super(message);
    this.name = 'RPGError';
    this.type = type;
    this.details = details;
  }
}

/**
 * Buat embed error yang user-friendly
 */
export function createErrorEmbed(type, message, details = null) {
  const meta = ERROR_META[type] || ERROR_META[ErrorType.UNKNOWN];

  const embed = new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(`${meta.emoji} ${meta.label}`)
    .setDescription(message)
    .setTimestamp();

  if (details) {
    embed.setFooter({ text: typeof details === 'string' ? details : 'Jika masalah terus berlanjut, hubungi admin.' });
  }

  return embed;
}

/**
 * Handle error di command dan kirim pesan ke user
 * Logging ke console + mengirim embed error ke user
 */
export async function handleCommandError(interaction, error, commandName = null) {
  // Log error ke console
  const timestamp = new Date().toISOString();
  const userId = interaction.user?.id || 'unknown';
  const cmd = commandName || interaction.commandName || 'unknown';

  console.error(`[${timestamp}] ❌ Error in /${cmd} (user: ${userId}):`, error);

  // Tentukan tipe dan pesan error
  let type = ErrorType.UNKNOWN;
  let userMessage = 'Terjadi kesalahan yang tidak terduga. Silakan coba lagi.';

  if (error instanceof RPGError) {
    type = error.type;
    userMessage = error.message;
  } else if (error?.code === 'P2002') {
    type = ErrorType.DATABASE;
    userMessage = 'Data duplikat terdeteksi. Mungkin aksi sudah pernah dilakukan.';
  } else if (error?.code === 'P2025') {
    type = ErrorType.NOT_FOUND;
    userMessage = 'Data yang dicari tidak ditemukan di database.';
  } else if (error?.code?.startsWith?.('P')) {
    type = ErrorType.DATABASE;
    userMessage = 'Terjadi masalah pada database. Silakan coba lagi nanti.';
  } else if (error?.message?.includes?.('Missing Permissions') || error?.code === 50013) {
    type = ErrorType.PERMISSION;
    userMessage = 'Bot tidak memiliki izin yang diperlukan untuk melakukan aksi ini.';
  } else if (error?.message?.includes?.('fetch') || error?.message?.includes?.('ECONNREFUSED')) {
    type = ErrorType.NETWORK;
    userMessage = 'Gagal terhubung ke layanan. Silakan coba lagi nanti.';
  } else if (error?.message?.includes?.('Unknown interaction') || error?.code === 10062) {
    // Interaction expired, abaikan saja
    return;
  }

  const embed = createErrorEmbed(type, userMessage);

  try {
    const replyMethod = interaction.replied || interaction.deferred ? 'followUp' : 'reply';
    await interaction[replyMethod]({ embeds: [embed], flags: 64 }).catch(() => {});
  } catch {
    // Jika bahkan reply gagal, kita sudah log ke console
  }
}

/**
 * Wrapper untuk command execution dengan error handling
 * Bisa digunakan sebagai higher-order function
 */
export function withErrorHandler(commandName, executeFn) {
  return async (interaction, client) => {
    try {
      await executeFn(interaction, client);
    } catch (error) {
      await handleCommandError(interaction, error, commandName);
    }
  };
}

/**
 * Log error ke console dengan format yang konsisten
 */
export function logError(context, error) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ❌ [${context}]`, error?.message || error);
  if (error?.stack) {
    console.error(error.stack);
  }
}
