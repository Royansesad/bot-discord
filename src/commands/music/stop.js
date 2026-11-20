// /stop - Hentikan musik (atau lanjut ke antrean berikutnya jika masih ada)
import discordJsPkg from 'discord.js';
const { SlashCommandBuilder } = discordJsPkg;
import { stopOrPlayNext } from '../../services/musicService.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';

export const category = 'music';

export const data = new SlashCommandBuilder()
  .setName('stop')
  .setDescription('Menghentikan pemutaran musik dan keluar dari voice channel');

export async function execute(interaction, client) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    return interaction.reply({ embeds: [errorEmbed('❌ Error', 'Kamu harus berada di Voice Channel.')], flags: 64 });
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply();
  }

  try {
    const result = await stopOrPlayNext(interaction.guildId);

    if (result.playedNext) {
      return interaction.editReply({
        embeds: [successEmbed(
          '⏭️ Lagu Berikutnya',
          `**${result.skipped?.title || 'Lagu sebelumnya'}** dihentikan karena masih ada antrean — lagu berikutnya sedang diputar.`
        )],
      });
    }

    return interaction.editReply({
      embeds: [successEmbed('⏹️ Musik Dihentikan', 'Antrean dibersihkan dan bot keluar dari voice channel.')],
    });
  } catch (error) {
    return interaction.editReply({ embeds: [errorEmbed('❌ Error', error.message)] }).catch(() => {});
  }
}
