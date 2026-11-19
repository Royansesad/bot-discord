// /lavalink - Kelola & Scrape Lavalink Nodes
import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getShoukaku } from '../../services/musicService.js';
import {
  getNodeInfo,
  getStateLabel,
  getAllNodes,
  testNodeHealth,
  addDatabaseNode,
  removeDatabaseNode,
  setNodePriorityInDb,
  disableNode,
  registerNodeConfig,
  setNodeConfigPriority,
} from '../../services/lavalinkNodes.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import config from '../../config.js';

export const category = 'music';

export const data = new SlashCommandBuilder()
  .setName('lavalink')
  .setDescription('Kelola & Scrape node Lavalink (Add, Remove, List, Scrape, Set Priority, Disable)')
  .addSubcommand(sub =>
    sub
      .setName('list')
      .setDescription('Tampilkan daftar dan status semua node Lavalink')
  )
  .addSubcommand(sub =>
    sub
      .setName('disable')
      .setDescription('Nonaktifkan node spesifik dari pool Lavalink (Admin)')
      .addStringOption(opt =>
        opt.setName('name')
          .setDescription('Pilih nama node yang ingin dinonaktifkan')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('scrape')
      .setDescription('Scrape provider free Lavalink, uji keaktifan node, dan simpan otomatis ke database')
  )
  .addSubcommand(sub =>
    sub
      .setName('add')
      .setDescription('Tambahkan node Lavalink baru (dengan uji keaktifan otomatis)')
      .addStringOption(opt =>
        opt.setName('name')
          .setDescription('Nama identifier node (misal: MyNode-1)')
          .setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('url')
          .setDescription('Host & Port (misal: hanyalava.c.jrnm.app:443 atau 127.0.0.1:2333)')
          .setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('auth')
          .setDescription('Password / Auth header Lavalink')
          .setRequired(true)
      )
      .addBooleanOption(opt =>
        opt.setName('secure')
          .setDescription('Apakah menggunakan SSL/WSS? (default: false)')
          .setRequired(false)
      )
      .addStringOption(opt =>
        opt.setName('priority')
          .setDescription('Prioritas node (main, secondary, fallback)')
          .setRequired(false)
          .addChoices(
            { name: '🥇 Main (Utama)', value: 'main' },
            { name: '🥈 Secondary (Cadangan 1)', value: 'secondary' },
            { name: '🥉 Fallback (Cadangan 2)', value: 'fallback' }
          )
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('remove')
      .setDescription('Hapus node Lavalink kustom dari database (Admin)')
      .addStringOption(opt =>
        opt.setName('name')
          .setDescription('Pilih nama node yang ingin dihapus')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('setpriority')
      .setDescription('Atur prioritas node Lavalink (Admin)')
      .addStringOption(opt =>
        opt.setName('name')
          .setDescription('Pilih nama node')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption(opt =>
        opt.setName('priority')
          .setDescription('Pilih prioritas baru')
          .setRequired(true)
          .addChoices(
            { name: '🥇 Main (Utama)', value: 'main' },
            { name: '🥈 Secondary (Cadangan 1)', value: 'secondary' },
            { name: '🥉 Fallback (Cadangan 2)', value: 'fallback' }
          )
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
  const subcommand = interaction.options.getSubcommand();
  const shoukaku = getShoukaku();

  if (subcommand === 'list') {
    if (!shoukaku) {
      return interaction.reply({
        embeds: [errorEmbed('❌ Error', 'Sistem musik (Lavalink) belum diinisialisasi.')],
        flags: 64,
      });
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
      .setTitle('🌐 Status & Daftar Lavalink Nodes')
      .setDescription('Multi-node failover aktif. Node dengan prioritas tertinggi dan status CONNECTED akan digunakan secara otomatis.')
      .setTimestamp();

    for (const node of nodes) {
      const status = getStateLabel(node.state);
      const players = node.players;
      const priorityBadge =
        node.priority === 'main' ? '🥇 Main' :
        node.priority === 'secondary' ? '🥈 Secondary' : '🥉 Fallback';

      let statsStr = `Status: ${status}\nPrioritas: **${priorityBadge}**\n🎵 Active Players: ${players}`;

      if (node.stats) {
        const memUsed = node.stats.memory
          ? `${Math.round(node.stats.memory.used / 1024 / 1024)}MB`
          : 'N/A';
        const cpu = node.stats.cpu
          ? `${(node.stats.cpu.lavalinkLoad * 100).toFixed(1)}%`
          : 'N/A';

        statsStr += `\n💾 RAM: ${memUsed} | 🖥️ CPU: ${cpu}`;
      }

      embed.addFields({
        name: `${node.state === 1 ? '🟢' : '🔴'} ${node.name}`,
        value: statsStr,
        inline: true,
      });
    }

    const connectedCount = nodes.filter(n => n.state === 1).length;
    embed.setFooter({
      text: `${connectedCount}/${nodes.length} nodes connected • Zero-Downtime Failover Enabled`,
    });

    return interaction.reply({ embeds: [embed] });
  }

  // Subcommand: /lavalink add (SEMUA USER BISA MENGGUNAKAN DENGAN UJI KEAKTIFAN)
  if (subcommand === 'add') {
    const name = interaction.options.getString('name');
    const url = interaction.options.getString('url');
    const auth = interaction.options.getString('auth');
    const secure = interaction.options.getBoolean('secure') || false;
    const priority = interaction.options.getString('priority') || 'secondary';

    await interaction.deferReply();

    // 1. Uji Keaktifan Node Terlebih Dahulu (Live Health Check)
    const health = await testNodeHealth(url, auth, secure, 5000);

    if (!health.alive) {
      return interaction.editReply({
        embeds: [errorEmbed(
          '❌ Node Tidak Aktif / Tidak Dapat Dijangkau',
          `Node **${name}** (\`${url}\`) gagal diuji keaktifannya.\n**Alasan:** ${health.reason || 'Koneksi ditolak / Timeout'}\n\n*Node tidak ditambahkan ke sistem.*`
        )],
      });
    }

    // 2. Simpan ke database jika node aktif
    try {
      await addDatabaseNode(client.prisma, { name, url, auth, secure, priority });

      // Simpan metadata ke registry (Shoukaku tidak menyimpan priority/engine)
      registerNodeConfig({ name, url, auth, secure, priority });

      if (shoukaku) {
        try {
          shoukaku.addNode({ name, url, auth, secure, priority });
        } catch (e) {
          // ignore duplicate
        }
      }

      const embed = successEmbed(
        '✅ Node Berhasil Ditambahkan & Aktif!',
        `Node **${name}** (\`${url}\`) berhasil diuji keaktifannya!\n` +
        `⏱️ **Latency:** \`${health.latencyMs}ms\`\n` +
        `⭐ **Prioritas:** \`${priority.toUpperCase()}\`\n` +
        `🔒 **SSL/WSS:** \`${secure ? 'Ya' : 'Tidak'}\`\n\n` +
        `Node telah tersimpan ke database & langsung terdaftar di Shoukaku!`
      );

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      return interaction.editReply({
        embeds: [errorEmbed('❌ Gagal Menyimpan Node', err.message)],
      });
    }
  }

  // Subcommand: /lavalink scrape (Scrape + Health Test + Auto-Save DB)
  if (subcommand === 'scrape') {
    await interaction.deferReply();

    const embedProcessing = new EmbedBuilder()
      .setColor(config.colors.warning)
      .setTitle('🔍 Scraping Provider Lavalink Publik...')
      .setDescription('Bot sedang mengumpulkan node dari berbagai provider dan melakukan **Live Health Test** ke masing-masing node. Mohon tunggu...');

    await interaction.editReply({ embeds: [embedProcessing] });

    try {
      const allScraped = await getAllNodes(client.prisma);

      // Uji keaktifan semua node secara paralel
      const testedResults = await Promise.all(
        allScraped.map(async (node) => {
          const health = await testNodeHealth(node.url, node.auth, node.secure, 4000);
          return { ...node, ...health };
        })
      );

      const workingNodes = testedResults.filter(n => n.alive);
      const savedCount = [];

      for (const node of workingNodes) {
        try {
          await addDatabaseNode(client.prisma, {
            name: node.name,
            url: node.url,
            auth: node.auth,
            secure: node.secure,
            priority: node.priority || 'fallback',
          });
          savedCount.push(node.name);
        } catch (e) {
          // node mungkin sudah ada di database, abaikan error duplikat
        }

        if (shoukaku && !shoukaku.nodes.has(node.name)) {
          registerNodeConfig(node);
          try {
            shoukaku.addNode({
              name: node.name,
              url: node.url,
              auth: node.auth,
              secure: node.secure,
              priority: node.priority || 'fallback',
            });
          } catch (e) {
            // ignore duplicate
          }
        }
      }

      const resultEmbed = new EmbedBuilder()
        .setColor(config.colors.success)
        .setTitle('✅ Scraping & Live Health Test Selesai')
        .setDescription(
          `Ditemukan **${workingNodes.length} / ${testedResults.length}** node yang **AKTIF & WORKING**!\n` +
          `Semua node yang lolos tes otomatis disimpan ke database SQLite.\n\n` +
          `**Node Aktif Ditemukan:**\n` +
          (workingNodes.length > 0
            ? workingNodes.slice(0, 15).map(n => `🟢 **${n.name}** (\`${n.url}\`) - \`${n.latencyMs}ms\``).join('\n')
            : '*(Tidak ada node publik gratis yang merespon)*')
        )
        .setFooter({ text: `${savedCount.length} node baru berhasil didaftarkan ke database!` })
        .setTimestamp();

      return interaction.editReply({ embeds: [resultEmbed] });
    } catch (err) {
      return interaction.editReply({
        embeds: [errorEmbed('❌ Gagal Scraping Node', err.message)],
      });
    }
  }

  // Admin permission required for remove, setpriority, and disable
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      embeds: [errorEmbed('🚫 Akses Ditolak', 'Hanya Administrator yang dapat mengelola atau menonaktifkan node!')],
      flags: 64,
    });
  }

  if (subcommand === 'disable') {
    const name = interaction.options.getString('name');
    try {
      const disabledName = disableNode(shoukaku, name);
      const embed = successEmbed(
        '🚫 Node Berhasil Dinonaktifkan',
        `Node **${disabledName}** telah dinonaktifkan dan dilepas dari Shoukaku.\n\nGunakan \`/nodes reconnect name:${disabledName}\` jika ingin mengaktifkannya kembali.`
      );
      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      return interaction.reply({
        embeds: [errorEmbed('❌ Gagal Menonaktifkan Node', err.message)],
        flags: 64,
      });
    }
  }

  if (subcommand === 'remove') {
    const name = interaction.options.getString('name');

    try {
      await removeDatabaseNode(client.prisma, name);

      if (shoukaku && shoukaku.nodes.has(name)) {
        try {
          shoukaku.removeNode(name, 'Removed by user command');
        } catch (e) {
          // ignore
        }
      }

      const embed = successEmbed(
        '🗑️ Node Berhasil Dihapus',
        `Node **${name}** telah dihapus dari database dan Shoukaku.`
      );
      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      return interaction.reply({
        embeds: [errorEmbed('❌ Gagal Menghapus Node', err.message)],
        flags: 64,
      });
    }
  }

  if (subcommand === 'setpriority') {
    const name = interaction.options.getString('name');
    const priority = interaction.options.getString('priority');

    try {
      await setNodePriorityInDb(client.prisma, name, priority);

      // Node.options tidak menyimpan priority; registry inilah sumber kebenaran router
      setNodeConfigPriority(name, priority);

      const embed = successEmbed(
        '⚙️ Prioritas Node Diperbarui',
        `Prioritas node **${name}** berhasil diubah menjadi **${priority.toUpperCase()}**!`
      );
      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      return interaction.reply({
        embeds: [errorEmbed('❌ Gagal Mengubah Prioritas', err.message)],
        flags: 64,
      });
    }
  }
}
