// /resume - Lanjutkan pemutaran musik
import discordJsPkg from 'discord.js';
const { SlashCommandBuilder } = discordJsPkg;
import { resumeMusic } from '../../services/musicService.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';

export const category = 'music';

export const data = new SlashCommandBuilder()
  .setName('resume')
  .setDescription('Melanjutkan pemutaran musik yang dijeda');

export async function execute(interaction, client) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    return interaction.reply({ embeds: [errorEmbed('❌ Error', 'Kamu harus berada di Voice Channel.')], flags: 64 });
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply();
  }

  try {
    const song = await resumeMusic(interaction.guildId);
    await interaction.editReply({
      embeds: [successEmbed('▶️ Musik Dilanjutkan', `Pemutaran **${song.title}** dilanjutkan.`)],
    });
  } catch (error) {
    await interaction.editReply({ embeds: [errorEmbed('❌ Error', error.message)] }).catch(() => {});
  }
}
