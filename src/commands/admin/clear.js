// /clear - Hapus pesan di channel
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { requirePermission } from '../../utils/permissions.js';
import { successEmbed } from '../../utils/embeds.js';
import { logAction } from '../../services/auditService.js';

export const data = new SlashCommandBuilder()
  .setName('clear')
  .setDescription('Hapus pesan di channel')
  .addIntegerOption(opt => opt.setName('amount').setDescription('Jumlah pesan (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
  .addUserOption(opt => opt.setName('target').setDescription('Hanya hapus pesan dari user tertentu'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

export async function execute(interaction, client) {
  if (await requirePermission(interaction, PermissionFlagsBits.ManageMessages, 'Manage Messages')) return;

  const amount = interaction.options.getInteger('amount');
  const target = interaction.options.getUser('target');

  await interaction.deferReply({ flags: 64 });

  let messages = await interaction.channel.messages.fetch({ limit: amount });

  if (target) {
    messages = messages.filter(m => m.author.id === target.id);
  }

  // Filter pesan yang lebih dari 14 hari (Discord limit)
  const twoWeeks = Date.now() - 14 * 24 * 60 * 60 * 1000;
  messages = messages.filter(m => m.createdTimestamp > twoWeeks);

  const deleted = await interaction.channel.bulkDelete(messages, true);

  await interaction.editReply({
    embeds: [successEmbed('Clear', `🗑️ Berhasil menghapus **${deleted.size}** pesan.${target ? ` (dari ${target})` : ''}`)],
  });

  await logAction(client, { guildId: interaction.guildId, moderator: interaction.user, action: 'clear', targetId: target?.id || 'channel', details: { amount: deleted.size }, interaction });
}
