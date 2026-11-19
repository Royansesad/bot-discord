// /play - Memutar lagu di voice channel via Lavalink / NodeLink / Native
import discordJsPkg from 'discord.js';
const { SlashCommandBuilder } = discordJsPkg;
import { playMusic } from '../../services/musicService.js';
import { errorEmbed } from '../../utils/embeds.js';
import { isInteractionExpired, logError } from '../../utils/errorManager.js';

export const category = 'music';

export const data = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Memutar musik dari SoundCloud, Spotify, YouTube, Deezer, dll')
  .addStringOption(opt =>
    opt.setName('query')
      .setDescription('Judul lagu atau URL (SoundCloud, Spotify, YouTube, Deezer, dll)')
      .setRequired(true)
  );

export async function execute(interaction, client) {
  const query = interaction.options.getString('query');

  try {
    await playMusic(interaction, query);
  } catch (error) {
    // Token interaction hanya berlaku ~3 detik. Jika bot/gateway terlambat,
    // jangan mencoba reply (pasti gagal) dan jangan menutupi error aslinya.
    if (isInteractionExpired(error)) {
      logError('Play (interaction kedaluwarsa)', error);
      return;
    }

    const payload = { embeds: [errorEmbed('❌ Gagal Memutar Musik', error.message)] };

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload);
      } else {
        await interaction.reply({ ...payload, flags: 64 });
      }
    } catch (replyError) {
      if (!isInteractionExpired(replyError)) throw replyError;
      logError('Play (gagal membalas interaction kedaluwarsa)', error);
    }
  }
}
