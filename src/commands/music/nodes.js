import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getShoukaku } from '../../services/musicService.js';
import { getNodeInfo, getStateLabel, reconnectNodes, disableNode } from '../../services/lavalinkNodes.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import config from '../../config.js';

export const category = 'music';

export const data = new SlashCommandBuilder()
  .setName('nodes')
  .setDescription('Menampilkan status dan mengelola koneksi Lavalink nodes')
  .addSubcommand(sub =>
    sub
      .setName('status')
      .setDescription('Menampilkan status semua Lavalink nodes yang terhubung')
  )
  .addSubcommand(sub =>
    sub
      .setName('reconnect')
      .setDescription('Menghubungkan kembali (re-connect) host node yang terputus')
      .addStringOption(opt =>
        opt
          .setName('name')
          .setDescription('Nama node spesifik yang ingin di-reconnect (Opsional)')
          .setRequired(false)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('disable')
      .setDescription('Menonaktifkan node Lavalink/NodeLink tertentu secara manual')
      .addStringOption(opt =>
        opt
          .setName('name')
          .setDescription('Pilih nama node yang ingin dinonaktifkan')
          .setRequired(true)
          .setAutocomplete(true)
      )
  );

export async function autocomplete(interaction, client) {
  const focusedValue = interaction.options.getFocused().toLowerCase();
  const shoukaku = getShoukaku();
  const nodes = getNodeInfo(shoukaku);

  const choices = nodes
    .filter(n => n.name.toLowerCase().includes(focusedValue))
    .slice(0, 25)
    .map(n => ({
      name: `${n.isDisabled ? '🚫 Disabled' : (n.state === 1 ? '🟢 Connected' : '🔴 Offline')} - ${n.name}`,
      value: n.name,
    }));

  await interaction.respond(choices).catch(() => {});
}

export async function execute(interaction, client) {
  const shoukaku = getShoukaku();

  if (!shoukaku) {
    return interaction.reply({
      embeds: [errorEmbed('❌ Error', 'Sistem musik (Lavalink) belum diinisialisasi.')],
      flags: 64,
    });
  }

  const subcommand = interaction.options.getSubcommand(false) || 'status';

  if (subcommand === 'disable') {
    const targetName = interaction.options.getString('name');
    try {
      const disabledName = disableNode(shoukaku, targetName);
      return interaction.reply({
        embeds: [successEmbed(
          '🚫 Node Dinonaktifkan',
          `Node **\`${disabledName}\`** telah dinonaktifkan dari pool pemutar Lavalink.\n\nGunakan \`/nodes reconnect name:${disabledName}\` jika ingin mengaktifkannya kembali.`
        )],
      });
    } catch (err) {
      return interaction.reply({
        embeds: [errorEmbed('❌ Gagal Menonaktifkan Node', err.message)],
        flags: 64,
      });
    }
  }

  if (subcommand === 'reconnect') {
    await interaction.deferReply();

    const targetName = interaction.options.getString('name');
    try {
      const summary = await reconnectNodes(shoukaku, client.prisma, targetName);

      const embed = new EmbedBuilder()
        .setColor(config.colors.primary)
        .setTitle('🔄 Re-connect Lavalink Nodes')
        .setDescription(
          targetName
            ? `Memproses re-connect untuk node **\`${targetName}\`**...`
            : 'Memproses re-connect untuk semua host node yang terputus...'
        )
        .setTimestamp();

      if (summary.reconnected.length > 0) {
        embed.addFields({
          name: '🟢 Berhasil Re-connect / Didaftarkan Ulang',
          value: summary.reconnected.map(n => `• **${n}**`).join('\n'),
        });
      }

      if (summary.connected.length > 0) {
        embed.addFields({
          name: '✅ Sudah Terhubung (Active)',
          value: summary.connected.map(n => `• **${n}**`).join('\n'),
        });
      }

      if (summary.failed.length > 0) {
        embed.addFields({
          name: '🔴 Gagal Re-connect',
          value: summary.failed.map(f => `• **${f.name}**: ${f.reason}`).join('\n'),
        });
      }

      const connectedTotal = summary.connected.length + summary.reconnected.length;
      embed.setFooter({ text: `${connectedTotal} node aktif terhubung` });

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      return interaction.editReply({
        embeds: [errorEmbed('❌ Re-connect Gagal', err.message)],
      });
    }
  }

  const nodes = getNodeInfo(shoukaku);

  if (nodes.length === 0) {
    return interaction.reply({
      embeds: [errorEmbed('❌ Error', 'Tidak ada Lavalink node yang terdaftar.')],
      flags: 64,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle('🌐 Status Lavalink Nodes')
    .setDescription('Daftar semua Lavalink nodes dan statusnya:')
    .setTimestamp();

  for (const node of nodes) {
    const status = getStateLabel(node.state, node.isDisabled);
    const players = node.players;

    let statsStr = `${status}\n🎵 Players: ${players}`;

    // Tambah info stats jika tersedia
    if (node.stats && !node.isDisabled) {
      const uptime = formatUptime(node.stats.uptime);
      const memUsed = node.stats.memory
        ? `${Math.round(node.stats.memory.used / 1024 / 1024)}MB`
        : 'N/A';
      const cpu = node.stats.cpu
        ? `${(node.stats.cpu.lavalinkLoad * 100).toFixed(1)}%`
        : 'N/A';

      statsStr += `\n⏱️ Uptime: ${uptime}`;
      statsStr += `\n💾 RAM: ${memUsed}`;
      statsStr += `\n🖥️ CPU: ${cpu}`;
    }

    embed.addFields({
      name: `${node.isDisabled ? '🚫' : (node.state === 1 ? '🟢' : '🔴')} ${node.name}`,
      value: statsStr,
      inline: true,
    });
  }

  const connectedCount = nodes.filter(n => n.state === 1 && !n.isDisabled).length;
  embed.setFooter({
    text: `${connectedCount}/${nodes.length} nodes connected`,
  });

  await interaction.reply({ embeds: [embed] });
}

/**
 * Format uptime ms -> human readable
 */
function formatUptime(ms) {
  if (!ms) return 'N/A';
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);

  return parts.length > 0 ? parts.join(' ') : '< 1m';
}
