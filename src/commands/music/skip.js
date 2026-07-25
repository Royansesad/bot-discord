// /skip - Skip lagu yang sedang diputar
import { SlashCommandBuilder } from 'discord.js';
import { skipTrack } from '../../services/musicService.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';

export const category = 'music';

export const data = new SlashCommandBuilder()
  .setName('skip')
  .setDescription('Lewati (skip) lagu yang sedang diputar');

export async function execute(interaction, client) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    return interaction.reply({ embeds: [errorEmbed('❌ Error', 'Kamu harus berada di Voice Channel untuk memakai command ini.')], flags: 64 });
  }

  try {
    const skipped = skipTrack(interaction.guildId);
    await interaction.reply({
      embeds: [successEmbed('⏭️ Lagu Dilewati', `**${skipped.title}** berhasil melewati lagu saat ini.`)],
    });
  } catch (error) {
    await interaction.reply({ embeds: [errorEmbed('❌ Error', error.message)], flags: 64 });
  }
}
