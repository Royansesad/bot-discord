// /unlock - Buka kunci channel
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { requirePermission } from '../../utils/permissions.js';
import { successEmbed } from '../../utils/embeds.js';
import { logAction } from '../../services/auditService.js';

export const data = new SlashCommandBuilder()
  .setName('unlock')
  .setDescription('Buka kunci channel')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

export async function execute(interaction, client) {
  if (await requirePermission(interaction, PermissionFlagsBits.ManageChannels, 'Manage Channels')) return;

  const everyoneRole = interaction.guild.roles.everyone;
  await interaction.channel.permissionOverwrites.edit(everyoneRole, { SendMessages: null });

  await interaction.reply({ embeds: [successEmbed('Unlock', '🔓 Channel ini telah **dibuka kembali**.')] });
  await logAction(client, { guildId: interaction.guildId, moderator: interaction.user, action: 'unlock', targetId: interaction.channelId, interaction });
}
