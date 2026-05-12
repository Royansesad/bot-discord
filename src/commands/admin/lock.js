// /lock - Kunci channel (non-sendable)
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { requirePermission } from '../../utils/permissions.js';
import { successEmbed } from '../../utils/embeds.js';
import { logAction } from '../../services/auditService.js';

export const data = new SlashCommandBuilder()
  .setName('lock')
  .setDescription('Kunci channel agar member tidak bisa mengirim pesan')
  .addStringOption(opt => opt.setName('reason').setDescription('Alasan lock'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

export async function execute(interaction, client) {
  if (await requirePermission(interaction, PermissionFlagsBits.ManageChannels, 'Manage Channels')) return;

  const reason = interaction.options.getString('reason') || 'Channel dikunci oleh moderator';
  const everyoneRole = interaction.guild.roles.everyone;

  await interaction.channel.permissionOverwrites.edit(everyoneRole, { SendMessages: false });

  await interaction.reply({ embeds: [successEmbed('Lock', `🔒 Channel ini telah **dikunci**.\n📝 Alasan: ${reason}`)] });
  await logAction(client, { guildId: interaction.guildId, moderator: interaction.user, action: 'lock', targetId: interaction.channelId, reason, interaction });
}
