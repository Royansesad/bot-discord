// /balance - Lihat gold
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getPlayer } from '../../services/rpgService.js';
import { errorEmbed } from '../../utils/embeds.js';
import { formatNumber } from '../../utils/helpers.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('balance')
  .setDescription('Lihat jumlah gold kamu');

export async function execute(interaction, client) {
  const player = await getPlayer(client.prisma, interaction.user.id);
  if (!player) return interaction.reply({ embeds: [errorEmbed('❌', 'Kamu belum terdaftar! `/start`')], flags: 64 });

  const embed = new EmbedBuilder()
    .setColor(config.colors.rpg)
    .setTitle('🪙 Balance')
    .setDescription(`**${interaction.user.displayName}** memiliki:\n\n# 🪙 ${formatNumber(player.gold)} Gold`)
    .setThumbnail(interaction.user.displayAvatarURL())
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
