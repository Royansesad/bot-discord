// /engine - Pilih & Kelola Audio Engine (Lavalink / NodeLink / Native)
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import {
  getShoukaku,
  getActiveEngine,
  setActiveEngine,
} from '../../services/musicService.js';
import { getNodeInfo, getStateLabel } from '../../services/lavalinkNodes.js';
import { detectNativeTools } from '../../services/nativeEngine.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import config from '../../config.js';

export const category = 'music';

export const data = new SlashCommandBuilder()
  .setName('engine')
  .setDescription('Pilih atau tampilkan status Engine Audio (Lavalink / NodeLink / Native)')
  .addSubcommand(sub =>
    sub
      .setName('status')
      .setDescription('Tampilkan status engine audio aktif dan info server')
  )
  .addSubcommand(sub =>
    sub
      .setName('use')
      .setDescription('Ganti engine audio aktif')
      .addStringOption(opt =>
        opt
          .setName('type')
          .setDescription('Pilih engine audio yang ingin digunakan')
          .setRequired(true)
          .addChoices(
            { name: '🎵 Lavalink (Public Multi-Node)', value: 'lavalink' },
            { name: '⚡ NodeLink v3.0.0', value: 'nodelink' },
            { name: '🪶 Native (discord.js + yt-dlp, tanpa server audio)', value: 'native' }
          )
      )
  );

export async function execute(interaction, client) {
  const subcommand = interaction.options.getSubcommand();
  const currentEngine = getActiveEngine();
  const tools = detectNativeTools();

  if (subcommand === 'status') {
    const shoukaku = getShoukaku();

    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle('🎛️ Status Engine Audio Musik')
      .setDescription(
        `Engine aktif: **\`${currentEngine.toUpperCase()}\`**\n\n` +
        '• **Lavalink** — node publik, multi-node failover\n' +
        '• **NodeLink** — server audio ringan kompatibel Lavalink\n' +
        '• **Native** — yt-dlp + @discordjs/voice, berjalan di proses bot tanpa server audio\n\n' +
        'Gunakan `/engine use` untuk berpindah engine kapan saja.'
      )
      .addFields({
        name: `${tools.ytdlp ? '🟢' : '🔴'} Native Engine`,
        value:
          `yt-dlp: ${tools.ytdlp ? `\`tersedia\` (\`${tools.ytdlpPath}\`)` : '`tidak ditemukan`'}\n` +
          `FFmpeg: ${tools.ffmpeg ? '`tersedia` (volume realtime)' : '`tidak ada` (Opus passthrough)'}`,
        inline: false,
      })
      .setTimestamp();

    if (shoukaku) {
      const nodes = getNodeInfo(shoukaku);

      for (const node of nodes) {
        const statsStr =
          `Status: ${getStateLabel(node.state, node.isDisabled)}\n` +
          `Engine: \`${(node.engine || 'lavalink').toUpperCase()}\`\n` +
          `🎵 Players: ${node.players}`;

        embed.addFields({
          name: `${node.engine === currentEngine ? '⭐' : '⚪'} ${node.name}`,
          value: statsStr,
          inline: true,
        });
      }
    } else if (currentEngine !== 'native') {
      embed.addFields({
        name: '❌ Shoukaku',
        value: 'Sistem Lavalink/NodeLink belum diinisialisasi.',
        inline: false,
      });
    }

    embed.setFooter({
      text: `Engine Active: ${currentEngine.toUpperCase()} • Lavalink • NodeLink • Native`,
    });

    return interaction.reply({ embeds: [embed] });
  }

  if (subcommand === 'use') {
    const selectedType = interaction.options.getString('type');

    try {
      const newEngine = setActiveEngine(selectedType);

      const engineNames = {
        lavalink: '🎵 Lavalink (Public Multi-Node)',
        nodelink: '⚡ NodeLink v3.0.0',
        native: '🪶 Native Engine (yt-dlp + @discordjs/voice)',
      };

      const embed = successEmbed(
        '🔄 Engine Audio Berhasil Diubah!',
        `Engine audio musik aktif sekarang: **${engineNames[newEngine] || newEngine}**!\n\n` +
        'Pemutaran lagu berikutnya akan memakai engine tersebut. ' +
        'Antrean yang sedang berjalan dihentikan otomatis jika engine-nya berbeda.'
      );

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      return interaction.reply({
        embeds: [errorEmbed('❌ Gagal Mengubah Engine', err.message)],
        flags: 64,
      });
    }
  }
}
