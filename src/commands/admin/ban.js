// /ban - Ban member dari server
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { requirePermission, checkHierarchy } from '../../utils/permissions.js';
import { adminEmbed } from '../../utils/embeds.js';
import { logAction } from '../../services/auditService.js';

export const data = new SlashCommandBuilder()
  .setName('ban')
  .setDescription('Ban member dari server')
  .addUserOption(opt => opt.setName('target').setDescription('User yang akan di-ban').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Alasan ban'))
  .addIntegerOption(opt => opt.setName('days').setDescription('Hapus pesan berapa hari terakhir (0-7)').setMinValue(0).setMaxValue(7))
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);

export async function execute(interaction, client) {
  if (await requirePermission(interaction, PermissionFlagsBits.BanMembers, 'Ban Members')) return;

  const target = interaction.options.getUser('target');
  const reason = interaction.options.getString('reason') || 'Tidak ada alasan';
  const days = interaction.options.getInteger('days') || 0;
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);

  if (member && !(await checkHierarchy(interaction, member, 'ban'))) return;

  await interaction.guild.members.ban(target.id, { reason, deleteMessageSeconds: days * 86400 });

  const embed = adminEmbed('Ban', interaction.user, target, reason, { duration: days > 0 ? `${days} hari pesan dihapus` : undefined });
  await interaction.reply({ embeds: [embed] });
  await logAction(client, { guildId: interaction.guildId, moderator: interaction.user, action: 'ban', targetId: target.id, reason, details: { days }, interaction });
}
