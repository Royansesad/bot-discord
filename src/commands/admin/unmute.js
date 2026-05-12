// /unmute - Remove timeout dari member
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { requirePermission } from '../../utils/permissions.js';
import { successEmbed } from '../../utils/embeds.js';
import { logAction } from '../../services/auditService.js';

export const data = new SlashCommandBuilder()
  .setName('unmute')
  .setDescription('Unmute member')
  .addUserOption(opt => opt.setName('target').setDescription('User yang akan di-unmute').setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export async function execute(interaction, client) {
  if (await requirePermission(interaction, PermissionFlagsBits.ModerateMembers, 'Moderate Members')) return;

  const target = interaction.options.getUser('target');
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);

  if (!member) return interaction.reply({ content: '❌ User tidak ditemukan.', flags: 64 });

  await member.timeout(null);

  await interaction.reply({ embeds: [successEmbed('Unmute', `${target} telah di-unmute.`)] });
  await logAction(client, { guildId: interaction.guildId, moderator: interaction.user, action: 'unmute', targetId: target.id, interaction });
}
