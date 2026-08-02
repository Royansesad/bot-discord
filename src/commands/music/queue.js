// /queue - Tampilkan antrean lagu
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getPlayer, formatDuration } from '../../services/musicService.js';
import { errorEmbed } from '../../utils/embeds.js';
import config from '../../config.js';

export const category = 'music';

export const data = new SlashCommandBuilder()
  .setName('queue')
  .setDescription('Menampilkan antrean musik saat ini');

export async function execute(interaction, client) {
  const player = getPlayer(interaction.guildId);

  if (!player || (!player.queue.current && player.queue.length === 0)) {
    return interaction.reply({ embeds: [errorEmbed('🎶 Antrean Musik', 'Tidak ada lagu yang sedang diputar atau dalam antrean.')], flags: 64 });
  }

  const current = player.queue.current;
  const currentStr = current
    ? `▶️ **[${current.title}](${current.uri})** | \`${formatDuration(current.length)}\` | Diminta oleh: ${current.requester ? `<@${current.requester.id}>` : 'N/A'}${player.paused ? ' *(Paused)*' : ''}`
    : 'Tidak ada lagu sedang diputar';

  const songList = player.queue.slice(0, 10).map((song, i) => {
    return `**${i + 1}.** [${song.title}](${song.uri}) | \`${formatDuration(song.length)}\` | ${song.requester ? `<@${song.requester.id}>` : 'N/A'}`;
  });

  const remaining = player.queue.length > 10 ? `\n*...dan ${player.queue.length - 10} lagu lainnya.*` : '';

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle('📜 Antrean Musik Server')
    .addFields(
      { name: '🎵 Sedang Diputar', value: currentStr },
      { name: `📋 Berikutnya dalam Antrean (${player.queue.length})`, value: songList.length > 0 ? songList.join('\n') + remaining : 'Tidak ada lagu berikutnya.' }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
