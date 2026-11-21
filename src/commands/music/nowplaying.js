// /nowplaying - Tampilkan info lagu yang sedang diputar
import discordJsPkg from 'discord.js';
const { SlashCommandBuilder, EmbedBuilder } = discordJsPkg;
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
    .setTitle(`🎧 Now Playing${queue.isPaused ? ' ⏸️ (Paused)' : ''}`)
    .setDescription(`[**${song.title}**](${song.url})`)
    .addFields(
      { name: '🎤 Artis', value: song.author || 'Unknown', inline: true },
      { name: '⏱️ Durasi', value: song.isStream ? '🔴 LIVE' : song.duration, inline: true },
      { name: '👤 Peminta', value: `<@${song.requester?.id || '0'}>`, inline: true },
      { name: '🔊 Volume', value: `${queue.volume}%`, inline: true },
      { name: '📜 Sisa Antrean', value: `${queue.songs.length} lagu`, inline: true }
    )
    .setThumbnail(song.thumbnail || null)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
