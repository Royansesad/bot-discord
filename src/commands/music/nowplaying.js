// /nowplaying - Tampilkan info lagu yang sedang diputar
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getPlayer, formatDuration } from '../../services/musicService.js';
import { errorEmbed } from '../../utils/embeds.js';
import config from '../../config.js';

export const category = 'music';

export const data = new SlashCommandBuilder()
  .setName('nowplaying')
  .setDescription('Menampilkan detail lagu yang sedang diputar saat ini');

export async function execute(interaction, client) {
  const player = getPlayer(interaction.guildId);

  if (!player || !player.queue.current) {
    return interaction.reply({ embeds: [errorEmbed('🎵 Now Playing', 'Tidak ada musik yang sedang diputar.')], flags: 64 });
  }

  const song = player.queue.current;

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`🎧 Now Playing${player.paused ? ' (Paused)' : ''}`)
    .setDescription(`[**${song.title}**](${song.uri})`)
    .addFields(
      { name: '⏱️ Durasi', value: formatDuration(song.length), inline: true },
      { name: '👤 Peminta', value: song.requester ? `<@${song.requester.id}>` : 'N/A', inline: true },
      { name: '📜 Sisa Antrean', value: `${player.queue.length} lagu`, inline: true }
    )
    .setThumbnail(song.thumbnail || null)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
