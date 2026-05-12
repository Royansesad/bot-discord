// ============================================
// embeds.js - Reusable Embed Builders
// ============================================
import { EmbedBuilder } from 'discord.js';
import config from '../config.js';

/**
 * Embed sukses (hijau)
 */
export function successEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(config.colors.success)
    .setTitle(`✅ ${title}`)
    .setDescription(description)
    .setTimestamp();
}

/**
 * Embed error (merah)
 */
export function errorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(config.colors.danger)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

/**
 * Embed warning (kuning)
 */
export function warningEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(config.colors.warning)
    .setTitle(`⚠️ ${title}`)
    .setDescription(description)
    .setTimestamp();
}

/**
 * Embed info (biru)
 */
export function infoEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(config.colors.info)
    .setTitle(`ℹ️ ${title}`)
    .setDescription(description)
    .setTimestamp();
}

/**
 * Embed admin action
 */
export function adminEmbed(action, moderator, target, reason, extra = {}) {
  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`🔨 ${action}`)
    .addFields(
      { name: '👮 Moderator', value: `${moderator}`, inline: true },
      { name: '🎯 Target', value: `${target}`, inline: true },
      { name: '📝 Alasan', value: reason || 'Tidak ada alasan', inline: false }
    )
    .setTimestamp();

  if (extra.duration) {
    embed.addFields({ name: '⏱️ Durasi', value: extra.duration, inline: true });
  }
  if (extra.count) {
    embed.addFields({ name: '🔢 Jumlah', value: extra.count, inline: true });
  }

  return embed;
}

/**
 * Embed RPG - untuk profil, battle, dll
 */
export function rpgEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(config.colors.rpg)
    .setTitle(title)
    .setDescription(description || '')
    .setTimestamp();
}

/**
 * Embed berdasarkan rarity item
 */
export function rarityEmbed(rarity, title, description) {
  const colorMap = {
    common: config.colors.common,
    uncommon: config.colors.success,
    rare: config.colors.rare,
    epic: config.colors.epic,
    legendary: config.colors.legendary,
  };
  return new EmbedBuilder()
    .setColor(colorMap[rarity] || config.colors.common)
    .setTitle(title)
    .setDescription(description || '')
    .setTimestamp();
}

/**
 * Progress bar visual
 */
export function progressBar(current, max, length = 10) {
  const filled = Math.round((current / max) * length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * HP bar dengan emoji
 */
export function hpBar(current, max) {
  const percentage = (current / max) * 100;
  const bar = progressBar(current, max, 10);
  let emoji = '💚';
  if (percentage <= 25) emoji = '❤️';
  else if (percentage <= 50) emoji = '🧡';
  else if (percentage <= 75) emoji = '💛';
  return `${emoji} ${bar} ${current}/${max}`;
}
