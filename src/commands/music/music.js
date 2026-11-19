// /music - Music Dashboard Interaktif dengan Banner Tetap & Search Prompt
import discordJsPkg from 'discord.js';
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = discordJsPkg;
import config from '../../config.js';

export const category = 'music';

const FIXED_BANNER = "https://i.postimg.cc/7Z52mQ0K/Amba-Music.png";

export const data = new SlashCommandBuilder()
  .setName('music')
  .setDescription('Tampilkan Dashboard Musik Utama dengan Kontrol Remote & Fitur Search');

export async function execute(interaction, client) {
  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setAuthor({
      name: '🎛️ DASHBOARD MUSIK UTAMA',
      iconURL: interaction.guild?.iconURL() || undefined,
    })
    .setTitle('🎵 Spotify-Style Anti-Lag Music Player')
    .setDescription(
      'Tekan tombol **`🔍 Search / Putar Musik`** di bawah untuk mencari dan memutar lagu favoritmu!\n\n' +
      '• **Pencarian Musik Interaktif:** Ketikkan judul lagu secara langsung.\n' +
      '• **Continuous Pre-Buffering:** Kualitas audio mulus tanpa stuttering.\n' +
      '• **Multi-Node Failover:** Zero-downtime playback cadangan otomatis.'
    )
    .setImage(FIXED_BANNER)
    .setFooter({ text: 'Klik tombol Search di bawah untuk memutar musik!' })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_music_dashboard_search')
      .setLabel('Search / Putar Musik')
      .setEmoji('🔍')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('btn_music_toggle_pause')
      .setLabel('Pause / Resume')
      .setEmoji('⏯️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('btn_music_skip')
      .setLabel('Skip')
      .setEmoji('⏭️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_music_stop')
      .setLabel('Stop')
      .setEmoji('⏹️')
      .setStyle(ButtonStyle.Danger)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_music_queue')
      .setLabel('Queue')
      .setEmoji('📜')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_music_loop')
      .setLabel('Loop Mode')
      .setEmoji('🔁')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_music_shuffle')
      .setLabel('Shuffle')
      .setEmoji('🔀')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_music_node')
      .setLabel('Node Status')
      .setEmoji('🌐')
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({ embeds: [embed], components: [row1, row2] });
}
