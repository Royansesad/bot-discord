// /skip - Skip lagu yang sedang diputar
import discordJsPkg from 'discord.js';
const { SlashCommandBuilder } = discordJsPkg;
import { skipTrack } from '../../services/musicService.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';

export const category = 'music';

export const data = new SlashCommandBuilder()
  .setName('skip')
  .setDescription('Lewati (skip) lagu yang sedang diputar');

export async function execute(interaction, client) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    return interaction.reply({ embeds: [errorEmbed('❌ Error', 'Kamu harus berada di Voice Channel.')], flags: 64 });
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply();
  }

  try {
    const skipped = await skipTrack(interaction.guildId);
    await interaction.editReply({
      embeds: [successEmbed('⏭️ Lagu Dilewati', `**${skipped.title}** berhasil dilewati.`)],
    });
  } catch (error) {
    await interaction.editReply({ embeds: [errorEmbed('❌ Error', error.message)] }).catch(() => {});
  }
}
