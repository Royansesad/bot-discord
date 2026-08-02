// /pause - Jedakan musik
import { SlashCommandBuilder } from 'discord.js';
import { pauseMusic } from '../../services/musicService.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';

export const category = 'music';

export const data = new SlashCommandBuilder()
  .setName('pause')
  .setDescription('Menjedakan (pause) lagu yang sedang diputar');

export async function execute(interaction, client) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    return interaction.reply({ embeds: [errorEmbed('❌ Error', 'Kamu harus berada di Voice Channel.')], flags: 64 });
  }

  try {
    const song = pauseMusic(interaction.guildId);
    await interaction.reply({
      embeds: [successEmbed('⏸️ Musik Dijeda', `Pemutaran **${song.title}** telah dijeda. Ketik \`/resume\` untuk melanjutkan.`)],
    });
  } catch (error) {
    await interaction.reply({ embeds: [errorEmbed('❌ Error', error.message)], flags: 64 });
  }
}
