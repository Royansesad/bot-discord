// /volume - Atur volume musik
import discordJsPkg from 'discord.js';
const { SlashCommandBuilder } = discordJsPkg;
import { setVolume, getQueue } from '../../services/musicService.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';

export const category = 'music';

export const data = new SlashCommandBuilder()
  .setName('volume')
  .setDescription('Mengatur volume musik (0-200)')
  .addIntegerOption(opt =>
    opt.setName('level')
      .setDescription('Level volume (0-200, default: 80)')
      .setMinValue(0)
      .setMaxValue(200)
  );

export async function execute(interaction, client) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    return interaction.reply({ embeds: [errorEmbed('❌ Error', 'Kamu harus berada di Voice Channel.')], flags: 64 });
  }

  // Acknowledge lebih dulu. Pemulihan sesi/player bisa memakan lebih dari 3
  // detik; tanpa defer, Discord menampilkan "The application did not respond".
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: 64 });
  }

  const level = interaction.options.getInteger('level');

  // Jika tidak ada argumen, tampilkan volume saat ini
  if (level === null) {
    const queue = getQueue(interaction.guildId);
    if (!queue) {
      return interaction.editReply({ embeds: [errorEmbed('❌ Error', 'Tidak ada musik yang sedang diputar.')] });
    }

    const volumeBar = createVolumeBar(queue.volume);
    return interaction.editReply({
      embeds: [successEmbed('🔊 Volume Saat Ini', `${volumeBar}\n**${queue.volume}%**`)],
    });
  }

  try {
    const newVolume = await setVolume(interaction.guildId, level);
    const volumeBar = createVolumeBar(newVolume);
    const emoji = newVolume === 0 ? '🔇' : newVolume < 50 ? '🔉' : '🔊';

    await interaction.editReply({
      embeds: [successEmbed(`${emoji} Volume Diubah`, `${volumeBar}\n**${newVolume}%**`)],
    });
  } catch (error) {
    await interaction.editReply({ embeds: [errorEmbed('❌ Error', error.message)] }).catch(() => {});
  }
}

/**
 * Buat visual volume bar
 */
function createVolumeBar(volume, maxBlocks = 20) {
  const filled = Math.round((volume / 200) * maxBlocks);
  const empty = maxBlocks - filled;
  return `${'▰'.repeat(filled)}${'▱'.repeat(empty)}`;
}
