// /warn - Beri peringatan ke member
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { requirePermission } from '../../utils/permissions.js';
import { adminEmbed, warningEmbed } from '../../utils/embeds.js';
import { logAction, getWarningCount } from '../../services/auditService.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('warn')
  .setDescription('Beri peringatan ke member')
  .addUserOption(opt => opt.setName('target').setDescription('User yang akan di-warn').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Alasan warning').setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export async function execute(interaction, client) {
  if (await requirePermission(interaction, PermissionFlagsBits.ModerateMembers, 'Moderate Members')) return;

  const target = interaction.options.getUser('target');
  const reason = interaction.options.getString('reason');

  // Simpan warning ke database
  await client.prisma.warning.create({
    data: {
      guildId: interaction.guildId,
      userId: target.id,
      moderator: interaction.user.id,
      reason,
    },
  });

  const warnCount = await getWarningCount(client.prisma, interaction.guildId, target.id);

  const embed = new EmbedBuilder()
    .setColor(config.colors.warning)
    .setTitle('⚠️ Warning')
    .addFields(
      { name: '🎯 User', value: `${target}`, inline: true },
      { name: '👮 Moderator', value: `${interaction.user}`, inline: true },
      { name: '📝 Alasan', value: reason, inline: false },
      { name: '📊 Total Warnings', value: `${warnCount}`, inline: true }
    )
    .setTimestamp();

  // Auto-action berdasarkan jumlah warning
  let autoAction = '';
  if (warnCount >= 5) {
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (member) {
      await member.ban({ reason: `Auto-ban: ${warnCount} warnings` });
      autoAction = `\n🔨 **Auto-banned** karena mencapai ${warnCount} warnings!`;
    }
  } else if (warnCount >= 3) {
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (member) {
      await member.timeout(60 * 60 * 1000, `Auto-mute: ${warnCount} warnings`);
      autoAction = `\n🔇 **Auto-muted 1 jam** karena ${warnCount} warnings.`;
    }
  }

  if (autoAction) embed.addFields({ name: '🤖 Auto Action', value: autoAction });

  await interaction.reply({ embeds: [embed] });
  await logAction(client, { guildId: interaction.guildId, moderator: interaction.user, action: 'warn', targetId: target.id, reason, details: { warnCount }, interaction });
}
