// /slowmode - Atur slowmode di channel
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { requirePermission } from '../../utils/permissions.js';
import { successEmbed } from '../../utils/embeds.js';
import { logAction } from '../../services/auditService.js';

export const data = new SlashCommandBuilder()
  .setName('slowmode')
  .setDescription('Atur slowmode di channel')
  .addIntegerOption(opt => opt.setName('seconds').setDescription('Durasi slowmode (0 = off, max 21600)').setRequired(true).setMinValue(0).setMaxValue(21600))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

export async function execute(interaction, client) {
  if (await requirePermission(interaction, PermissionFlagsBits.ManageChannels, 'Manage Channels')) return;

  const seconds = interaction.options.getInteger('seconds');
  await interaction.channel.setRateLimitPerUser(seconds);

  const msg = seconds === 0
    ? '🔓 Slowmode telah **dimatikan**.'
    : `🐌 Slowmode diatur ke **${seconds} detik**.`;

  await interaction.reply({ embeds: [successEmbed('Slowmode', msg)] });
  await logAction(client, { guildId: interaction.guildId, moderator: interaction.user, action: 'slowmode', targetId: interaction.channelId, details: { seconds }, interaction });
}
