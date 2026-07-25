// /play - Memutar lagu di voice channel
import { SlashCommandBuilder } from 'discord.js';
import { playMusic } from '../../services/musicService.js';
import { errorEmbed } from '../../utils/embeds.js';

export const category = 'music';

export const data = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Memutar musik dari YouTube/URL di Voice Channel')
  .addStringOption(opt =>
    opt.setName('query')
      .setDescription('Judul lagu atau URL (YouTube/SoundCloud)')
      .setRequired(true)
  );

export async function execute(interaction, client) {
  const query = interaction.options.getString('query');

  try {
    await playMusic(interaction, query);
  } catch (error) {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ embeds: [errorEmbed('❌ Gagal Memutar Musik', error.message)], flags: 64 });
    } else {
      await interaction.reply({ embeds: [errorEmbed('❌ Gagal Memutar Musik', error.message)], flags: 64 });
    }
  }
}
