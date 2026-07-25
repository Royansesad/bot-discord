// /nowplaying - Tampilkan info lagu yang sedang diputar
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getQueue } from '../../services/musicService.js';
import { errorEmbed } from '../../utils/embeds.js';
import config from '../../config.js';

export const category = 'music';

export const data = new SlashCommandBuilder()
  .setName('nowplaying')
  .setDescription('Menampilkan detail lagu yang sedang diputar saat ini');

export async function execute(interaction, client) {
  const queue = getQueue(interaction.guildId);

  if (!queue || !queue.currentlyPlaying) {
    return interaction.reply({ embeds: [errorEmbed('🎵 Now Playing', 'Tidak ada musik yang sedang diputar.')], flags: 64 });
  }

  const song = queue.currentlyPlaying;

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`🎧 Now Playing${queue.isPaused ? ' (Paused)' : ''}`)
    .setDescription(`[**${song.title}**](${song.url})`)
    .addFields(
      { name: '⏱️ Durasi', value: song.duration, inline: true },
      { name: '👤 Peminta', value: `<@${song.requester.id}>`, inline: true },
      { name: '📜 Sisa Antrean', value: `${queue.songs.length} lagu`, inline: true }
    )
    .setThumbnail(song.thumbnail || null)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
