// /mute - Timeout member (mute)
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { requirePermission, checkHierarchy } from '../../utils/permissions.js';
import { adminEmbed } from '../../utils/embeds.js';
import { logAction } from '../../services/auditService.js';

export const data = new SlashCommandBuilder()
  .setName('mute')
  .setDescription('Mute (timeout) member')
  .addUserOption(opt => opt.setName('target').setDescription('User yang akan di-mute').setRequired(true))
  .addIntegerOption(opt => opt.setName('duration').setDescription('Durasi mute dalam menit').setRequired(true).setMinValue(1).setMaxValue(40320))
  .addStringOption(opt => opt.setName('reason').setDescription('Alasan mute'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export async function execute(interaction, client) {
  if (await requirePermission(interaction, PermissionFlagsBits.ModerateMembers, 'Moderate Members')) return;

  const target = interaction.options.getUser('target');
  const duration = interaction.options.getInteger('duration');
  const reason = interaction.options.getString('reason') || 'Tidak ada alasan';
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);

  if (!member) return interaction.reply({ content: '❌ User tidak ditemukan.', flags: 64 });
  if (!(await checkHierarchy(interaction, member, 'mute'))) return;

  const ms = duration * 60 * 1000;
  await member.timeout(ms, reason);

  const durationStr = duration >= 60 ? `${Math.floor(duration / 60)} jam ${duration % 60} menit` : `${duration} menit`;
  const embed = adminEmbed('Mute', interaction.user, target, reason, { duration: durationStr });
  await interaction.reply({ embeds: [embed] });
  await logAction(client, { guildId: interaction.guildId, moderator: interaction.user, action: 'mute', targetId: target.id, reason, details: { duration }, interaction });
}
