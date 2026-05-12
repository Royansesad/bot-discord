// ============================================
// auditService.js - Audit Log Service
// Mencatat semua aksi admin ke database dan channel
// ============================================
import { EmbedBuilder } from 'discord.js';
import config from '../config.js';

/**
 * Log aksi admin ke database dan (opsional) ke channel
 */
export async function logAction(client, { guildId, moderator, action, targetId, reason, details, interaction }) {
  // Simpan ke database
  try {
    await client.prisma.auditLog.create({
      data: {
        guildId,
        moderator: moderator.id || moderator,
        action,
        targetId,
        reason: reason || null,
        details: details ? JSON.stringify(details) : null,
      },
    });
  } catch (err) {
    console.error('Failed to save audit log:', err);
  }

  // Kirim ke audit log channel jika dikonfigurasi
  if (config.auditLogChannelId && interaction?.guild) {
    try {
      const channel = await interaction.guild.channels.fetch(config.auditLogChannelId);
      if (channel) {
        const embed = new EmbedBuilder()
          .setColor(config.colors.primary)
          .setTitle(`📋 Audit Log: ${action}`)
          .addFields(
            { name: '👮 Moderator', value: `<@${moderator.id || moderator}>`, inline: true },
            { name: '🎯 Target', value: `<@${targetId}>`, inline: true },
            { name: '📝 Alasan', value: reason || 'Tidak ada', inline: false }
          )
          .setTimestamp()
          .setFooter({ text: `Guild: ${guildId}` });

        if (details) {
          embed.addFields({ name: '📎 Detail', value: `\`\`\`json\n${JSON.stringify(details, null, 2).slice(0, 900)}\n\`\`\`` });
        }

        await channel.send({ embeds: [embed] });
      }
    } catch (err) {
      console.error('Failed to send audit log to channel:', err);
    }
  }
}

/**
 * Ambil warning count untuk user di guild
 */
export async function getWarningCount(prisma, guildId, userId) {
  return prisma.warning.count({
    where: { guildId, userId },
  });
}

/**
 * Ambil semua warnings untuk user di guild
 */
export async function getWarnings(prisma, guildId, userId) {
  return prisma.warning.findMany({
    where: { guildId, userId },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
}
