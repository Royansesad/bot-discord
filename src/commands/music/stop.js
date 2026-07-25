// /stop - Hentikan musik dan keluar dari Voice Channel
import { SlashCommandBuilder } from 'discord.js';
import { stopMusic } from '../../services/musicService.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';

export const category = 'music';

export const data = new SlashCommandBuilder()
  .setName('stop')
  .setDescription('Menghentikan pemutaran musik dan keluar dari voice channel');

export async function execute(interaction, client) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    return interaction.reply({ embeds: [errorEmbed('❌ Error', 'Kamu harus berada di Voice Channel untuk memakai command ini.')], flags: 64 });
  }

  const stopped = stopMusic(interaction.guildId);
  if (!stopped) {
    return interaction.reply({ embeds: [errorEmbed('❌ Error', 'Tidak ada musik yang sedang diputar di server ini.')], flags: 64 });
  }

  await interaction.reply({
    embeds: [successEmbed('⏹️ Musik Dihentikan', 'Antrean telah dibersihkan dan bot keluar dari voice channel.')],
  });
}
