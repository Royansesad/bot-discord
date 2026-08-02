// /play - Memutar lagu di voice channel
import { SlashCommandBuilder } from 'discord.js';
import { playMusic } from '../../services/musicService.js';
import { errorEmbed } from '../../utils/embeds.js';

export const category = 'music';

export const data = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Memutar musik dari YouTube di Voice Channel')
  .addStringOption(opt =>
    opt.setName('query')
      .setDescription('Judul lagu atau URL YouTube')
      .setRequired(true)
  );

export async function execute(interaction, client) {
  const query = interaction.options.getString('query');

  try {
    await playMusic(interaction, query);
  } catch (error) {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [errorEmbed('❌ Gagal Memutar Musik', error.message)] });
    } else {
      await interaction.reply({ embeds: [errorEmbed('❌ Gagal Memutar Musik', error.message)], flags: 64 });
    }
  }
}
