// /queue - Tampilkan antrean lagu
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getQueue, formatDuration } from '../../services/musicService.js';
import { errorEmbed } from '../../utils/embeds.js';
import config from '../../config.js';

export const category = 'music';

export const data = new SlashCommandBuilder()
  .setName('queue')
  .setDescription('Menampilkan antrean musik saat ini');

export async function execute(interaction, client) {
  const queue = getQueue(interaction.guildId);

  if (!queue || (!queue.currentlyPlaying && queue.songs.length === 0)) {
    return interaction.reply({ embeds: [errorEmbed('🎶 Antrean Musik', 'Tidak ada lagu yang sedang diputar atau dalam antrean.')], flags: 64 });
  }

  const current = queue.currentlyPlaying;
  const currentStr = current
    ? `▶️ **[${current.title}](${current.url})** | \`${current.duration}\` | <@${current.requester.id}>${queue.isPaused ? ' *(Paused)*' : ''}`
    : 'Tidak ada lagu sedang diputar';

  const songList = queue.songs.slice(0, 10).map((song, i) => {
    return `**${i + 1}.** [${song.title}](${song.url}) | \`${song.duration}\` | <@${song.requester.id}>`;
  });

  const remaining = queue.songs.length > 10 ? `\n*...dan ${queue.songs.length - 10} lagu lainnya.*` : '';

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle('📜 Antrean Musik Server')
    .addFields(
      { name: '🎵 Sedang Diputar', value: currentStr },
      { name: `📋 Berikutnya dalam Antrean (${queue.songs.length})`, value: songList.length > 0 ? songList.join('\n') + remaining : 'Tidak ada lagu berikutnya.' }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
