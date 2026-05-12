// /kick - Kick member dari server
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { requirePermission, checkHierarchy } from '../../utils/permissions.js';
import { adminEmbed } from '../../utils/embeds.js';
import { logAction } from '../../services/auditService.js';

export const data = new SlashCommandBuilder()
  .setName('kick')
  .setDescription('Kick member dari server')
  .addUserOption(opt => opt.setName('target').setDescription('User yang akan di-kick').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Alasan kick'))
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers);

export async function execute(interaction, client) {
  if (await requirePermission(interaction, PermissionFlagsBits.KickMembers, 'Kick Members')) return;

  const target = interaction.options.getUser('target');
  const reason = interaction.options.getString('reason') || 'Tidak ada alasan';
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);

  if (!member) return interaction.reply({ content: '❌ User tidak ditemukan di server ini.', flags: 64 });
  if (!(await checkHierarchy(interaction, member, 'kick'))) return;

  await member.kick(reason);

  const embed = adminEmbed('Kick', interaction.user, target, reason);
  await interaction.reply({ embeds: [embed] });
  await logAction(client, { guildId: interaction.guildId, moderator: interaction.user, action: 'kick', targetId: target.id, reason, interaction });
}
