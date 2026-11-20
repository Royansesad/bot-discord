// /engine - Pilih & Kelola Audio Engine (Lavalink / Native)
import discordJsPkg from 'discord.js';
const { SlashCommandBuilder, EmbedBuilder } = discordJsPkg;
import {
  getShoukaku,
  getActiveEngine,
  setActiveEngine,
} from '../../services/musicService.js';
import { getNodeInfo, getStateLabel } from '../../services/lavalinkNodes.js';
import { detectNativeTools } from '../../services/nativeEngine.js';
import { getProxyStatus } from '../../services/proxyManager.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import config from '../../config.js';

export const category = 'music';

export const data = new SlashCommandBuilder()
  .setName('engine')
  .setDescription('Pilih atau tampilkan status Engine Audio (Lavalink / Native)')
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
            { name: '🪶 Native (discord.js + youtubei.js, tanpa cookie)', value: 'native' }
          )
      )
  );

export async function execute(interaction, client) {
  const subcommand = interaction.options.getSubcommand();
  const currentEngine = getActiveEngine();
  const tools = detectNativeTools();
  const proxy = getProxyStatus();

  if (subcommand === 'status') {
    const shoukaku = getShoukaku();

    const proxyLabel = proxy.mode === 'disabled'
      ? '`nonaktif` (YOUTUBE_PROXY_AUTO=false)'
      : proxy.active
        ? `\`aktif\` (${proxy.mode}: ${proxy.active})`
        : proxy.mode === 'static'
          ? '`menunggu` (YOUTUBE_PROXY)'
          : '`auto` (mencari proxy sehat...)';

    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle('🎛️ Status Engine Audio Musik')
      .setDescription(
        `Engine aktif: **\`${currentEngine.toUpperCase()}\`**\n\n` +
        '• **Lavalink** — node publik, multi-node failover\n' +
        '• **Native** — youtubei.js + @discordjs/voice, tanpa cookie & server audio\n\n' +
        'Gunakan `/engine use` untuk berpindah engine kapan saja.'
      )
      .addFields({
        name: `${tools.youtubei ? '🟢' : '🔴'} Native Engine`,
        value:
          `youtubei.js: ${tools.youtubei ? '`aktif` (tanpa cookie)' : '`tidak tersedia`'}\n` +
          `FFmpeg: ${tools.ffmpeg ? '`tersedia` (volume realtime)' : '`tidak ada` (Opus passthrough)'}\n` +
          `Proxy: ${proxyLabel}`,
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
        value: 'Sistem Lavalink belum diinisialisasi.',
        inline: false,
      });
    }

    embed.setFooter({
      text: `Engine Active: ${currentEngine.toUpperCase()} • Lavalink • Native`,
    });

    return interaction.reply({ embeds: [embed] });
  }

  if (subcommand === 'use') {
    const selectedType = interaction.options.getString('type');

    try {
      const newEngine = setActiveEngine(selectedType);

      const engineNames = {
        lavalink: '🎵 Lavalink (Public Multi-Node)',
        native: '🪶 Native Engine (youtubei.js + @discordjs/voice)',
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
