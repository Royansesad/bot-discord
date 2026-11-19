// ============================================
// interactionCreate.js - Interaction Handler
// Handles Slash Commands, Autocomplete, & Music Remote Dashboard Buttons
// ============================================
import discordJsPkg from 'discord.js';
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = discordJsPkg;
import { checkCooldown, setCooldown } from '../utils/cooldown.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';
import { handleCommandError, logError } from '../utils/errorManager.js';
import {
  getQueue,
  togglePauseMusic,
  skipTrack,
  stopMusic,
  toggleLoopMode,
  shuffleQueue,
  adjustVolume,
  buildPlayerPayload,
  getShoukaku,
  playMusic,
} from '../services/musicService.js';
import { getNodeInfo, getStateLabel } from '../services/lavalinkNodes.js';
import { detectNativeTools } from '../services/nativeEngine.js';
import config from '../config.js';

// Map untuk menyimpan active message collectors pencarian musik per user
const activeSearchCollectors = new Map();

/**
 * Handler utama untuk semua interaction (slash commands, buttons, autocomplete)
 */
export async function handleInteraction(client, interaction) {
  // Handle autocomplete interactions
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (!command || !command.autocomplete) return;
    try {
      await command.autocomplete(interaction, client);
    } catch (error) {
      logError(`Autocomplete (${interaction.commandName})`, error);
    }
    return;
  }

  // Handle Button Interactions (Remote Control & Dashboard)
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('btn_music_')) {
      return handleMusicButton(client, interaction);
    }
    return;
  }

  // Hanya handle chat input commands
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    // Interaction hanya punya ~3 detik untuk di-acknowledge. Jika event masuk
    // terlambat (gateway/event loop sibuk), ack sekarang agar sisa proses masih
    // bisa membalas lewat editReply/followUp.
    const interactionAge = Date.now() - (interaction.createdTimestamp || Date.now());
    if (interactionAge > 2000 && !interaction.deferred && !interaction.replied) {
      const acknowledged = await interaction.deferReply().then(() => true).catch(() => false);
      if (!acknowledged) {
        console.warn(`[interaction] /${interaction.commandName} kedaluwarsa sebelum diproses (${interactionAge}ms).`);
        return;
      }
    }

    if (command.cooldown) {
      const remaining = await checkCooldown(
        client.prisma,
        interaction.user.id,
        interaction.commandName,
        command.cooldown
      );

      if (remaining > 0) {
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        const timeStr = minutes > 0
          ? `${minutes} menit ${seconds} detik`
          : `${seconds} detik`;

        const cooldownPayload = {
          embeds: [errorEmbed(
            '⏳ Cooldown',
            `Kamu harus menunggu **${timeStr}** sebelum menggunakan command ini lagi.`
          )],
          flags: 64,
        };

        // Interaction mungkin sudah di-acknowledge lebih awal (deferReply),
        // sehingga balasan harus lewat editReply.
        if (interaction.deferred || interaction.replied) {
          return interaction.editReply(cooldownPayload);
        }

        return interaction.reply(cooldownPayload);
      }
    }

    await command.execute(interaction, client);

    if (command.cooldown) {
      await setCooldown(
        client.prisma,
        interaction.user.id,
        interaction.commandName,
        command.cooldown
      );
    }
  } catch (error) {
    await handleCommandError(interaction, error, interaction.commandName);
  }
}

/**
 * Handler Khusus Tombol Remote Control & Dashboard Musik
 */
async function handleMusicButton(client, interaction) {
  const guildId = interaction.guildId;
  const queue = getQueue(guildId);

  // Handle Batal Search Prompt
  if (interaction.customId.startsWith('btn_music_cancel_search_')) {
    const targetUserId = interaction.customId.replace('btn_music_cancel_search_', '');
    if (interaction.user.id !== targetUserId) {
      return interaction.reply({
        embeds: [errorEmbed('🚫 Akses Ditolak', 'Hanya pengguna yang memulai pencarian yang dapat membatalkannya.')],
        flags: 64,
      });
    }

    const active = activeSearchCollectors.get(interaction.user.id);
    if (active) {
      active.collector.stop('cancelled');
      activeSearchCollectors.delete(interaction.user.id);
    }

    return interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(config.colors.warning)
          .setTitle('❌ Pencarian Dibatalkan')
          .setDescription('Pencarian musik telah dibatalkan.')
      ],
      components: [],
    });
  }

  // Handle Tombol Dashboard Search Musik (Pencarian Ephemeral + Message Collector)
  if (interaction.customId === 'btn_music_dashboard_search') {
    const memberVc = interaction.member?.voice?.channel;
    if (!memberVc) {
      return interaction.reply({
        embeds: [errorEmbed('🚫 Voice Channel Required', 'Kamu harus berada di Voice Channel untuk memutar musik!')],
        flags: 64,
      });
    }

    // Batalkan collector lama jika ada
    if (activeSearchCollectors.has(interaction.user.id)) {
      activeSearchCollectors.get(interaction.user.id).collector.stop('renew');
    }

    const promptEmbed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle('🔍 Pencarian Musik Interaktif')
      .setDescription(
        `Halo <@${interaction.user.id}>! Silakan **ketikkan judul lagu atau URL** yang ingin diputar di channel ini.\n\n` +
        `🔒 *Pesan prompt ini hanya bisa kamu lihat. Bot mendengarkan input pesanmu berikutnya.*`
      )
      .setFooter({ text: 'Waktu input 60 detik. Tekan Batal untuk menghentikan.' });

    const cancelRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`btn_music_cancel_search_${interaction.user.id}`)
        .setLabel('Batal')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({
      embeds: [promptEmbed],
      components: [cancelRow],
      flags: 64,
    });

    const filter = m => m.author.id === interaction.user.id && !m.author.bot;
    const collector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });

    activeSearchCollectors.set(interaction.user.id, { collector, promptInteraction: interaction });

    collector.on('collect', async (msg) => {
      activeSearchCollectors.delete(interaction.user.id);

      // Coba hapus pesan input user agar channel tetap bersih
      try {
        if (msg.deletable) await msg.delete();
      } catch (e) {
        // abaikan jika tidak ada izin delete
      }

      // Update prompt ephemeral bahwa lagu sedang dicari
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.colors.info)
            .setTitle('🔎 Memproses Lagu...')
            .setDescription(`Mencari dan memutar **"${msg.content}"**...`)
        ],
        components: [],
      }).catch(() => {});

      // Memutar lagu via playMusic
      const fakeInteraction = {
        guildId: interaction.guildId,
        channel: interaction.channel,
        user: interaction.user,
        member: interaction.member,
        client: interaction.client,
        deferred: true,
        replied: true,
        deferReply: async () => {},
        editReply: async (payload) => {
          return await interaction.channel.send(payload);
        },
        reply: async (payload) => {
          return await interaction.channel.send(payload);
        },
        followUp: async (payload) => {
          return await interaction.channel.send(payload);
        },
      };

      try {
        await playMusic(fakeInteraction, msg.content);
      } catch (err) {
        const payload = {
          embeds: [errorEmbed('❌ Gagal Memutar Musik', err.message)],
          components: [],
        };

        // Edit prompt ephemeral; kirim ke channel hanya jika prompt sudah tidak bisa diedit
        await interaction.editReply(payload).catch(() => {
          interaction.channel?.send({ embeds: payload.embeds }).catch(() => {});
        });
      }
    });

    collector.on('end', (collected, reason) => {
      activeSearchCollectors.delete(interaction.user.id);
      if (reason === 'time') {
        interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.colors.warning)
              .setTitle('⏱️ Waktu Pencarian Habis')
              .setDescription('Tidak ada judul lagu yang diketikkan dalam 60 detik.')
          ],
          components: [],
        }).catch(() => {});
      }
    });

    return;
  }

  // Validasi user di Voice Channel yang sama untuk tombol remote biasa
  const memberVc = interaction.member?.voice?.channel;
  if (!memberVc) {
    return interaction.reply({
      embeds: [errorEmbed('🚫 Voice Channel Required', 'Kamu harus berada di Voice Channel untuk menggunakan remot musik!')],
      flags: 64,
    });
  }

  if (queue?.voiceChannel && queue.voiceChannel.id !== memberVc.id) {
    return interaction.reply({
      embeds: [errorEmbed('🚫 Voice Channel Mismatch', `Kamu harus berada di channel <#${queue.voiceChannel.id}> untuk mengontrol musik!`)],
      flags: 64,
    });
  }

  if (!queue || (!queue.currentlyPlaying && interaction.customId !== 'btn_music_node')) {
    return interaction.reply({
      embeds: [errorEmbed('🎵 Music Remote', 'Tidak ada musik yang sedang diputar.')],
      flags: 64,
    });
  }

  try {
    const action = interaction.customId.replace('btn_music_', '');

    switch (action) {
      case 'toggle_pause': {
        await togglePauseMusic(guildId);
        const payload = buildPlayerPayload(guildId);
        await interaction.update(payload);
        break;
      }
      case 'skip': {
        const skipped = await skipTrack(guildId);
        await interaction.reply({
          embeds: [successEmbed('⏭️ Skip Lagu', `Lagu **${skipped.title}** di-skip oleh <@${interaction.user.id}>!`)],
          flags: 64,
        });
        break;
      }
      case 'stop': {
        stopMusic(guildId);
        await interaction.update({
          embeds: [
            new EmbedBuilder()
              .setColor(config.colors.danger)
              .setTitle('⏹️ Musik Dihentikan')
              .setDescription(`Musik dihentikan dan bot disconnect oleh <@${interaction.user.id}>.`)
              .setTimestamp()
          ],
          components: [],
        });
        break;
      }
      case 'loop': {
        const newMode = await toggleLoopMode(guildId);
        const payload = buildPlayerPayload(guildId);
        await interaction.update(payload);
        break;
      }
      case 'shuffle': {
        const count = await shuffleQueue(guildId);
        const payload = buildPlayerPayload(guildId);
        await interaction.update(payload);
        await interaction.followUp({
          embeds: [successEmbed('🔀 Shuffle Antrean', `Berhasil mengacak **${count}** lagu di antrean!`)],
          flags: 64,
        });
        break;
      }
      case 'voldown': {
        const newVol = await adjustVolume(guildId, -10);
        const payload = buildPlayerPayload(guildId);
        await interaction.update(payload);
        break;
      }
      case 'volup': {
        const newVol = await adjustVolume(guildId, 10);
        const payload = buildPlayerPayload(guildId);
        await interaction.update(payload);
        break;
      }
      case 'queue': {
        const songsList = queue.songs.length === 0
          ? '*(Antrean kosong)*'
          : queue.songs.slice(0, 10).map((s, i) => `${i + 1}. **[${s.title}](${s.url})** (${s.duration})`).join('\n');

        const embed = new EmbedBuilder()
          .setColor(config.colors.primary)
          .setTitle('📜 Antrean Pemutar Musik')
          .setDescription(`**Sedang Diputar:**\n▶️ **[${queue.currentlyPlaying.title}](${queue.currentlyPlaying.url})**\n\n**Berikutnya (${queue.songs.length}):**\n${songsList}`)
          .setFooter({ text: queue.songs.length > 10 ? `+${queue.songs.length - 10} lagu lainnya` : 'Remote Control Queue' });

        await interaction.reply({ embeds: [embed], flags: 64 });
        break;
      }
      case 'node': {
        // Engine native tidak memakai node Shoukaku
        if (queue?.backend === 'native') {
          const tools = detectNativeTools();

          const embed = new EmbedBuilder()
            .setColor(config.colors.info)
            .setTitle('🪶 Native Engine Status')
            .setDescription('Pemutaran berjalan langsung di proses bot (tanpa Lavalink/NodeLink).')
            .addFields(
              { name: 'youtubei.js', value: tools.youtubei ? '`aktif` (tanpa cookie)' : '`tidak tersedia`', inline: true },
              { name: 'FFmpeg', value: tools.ffmpeg ? '`tersedia`' : '`tidak ada` (Opus passthrough)', inline: true },
              { name: 'Proxy', value: tools.proxy ? '`aktif`' : '`tidak diatur`', inline: true },
              { name: 'Volume realtime', value: tools.ffmpeg ? '✅ Didukung' : '⚠️ Butuh FFmpeg', inline: true }
            )
            .setTimestamp();

          await interaction.reply({ embeds: [embed], flags: 64 });
          break;
        }

        const shoukaku = getShoukaku();
        const nodes = getNodeInfo(shoukaku);
        const currentNode = queue?.player?.node?.name || 'Unknown';

        const embed = new EmbedBuilder()
          .setColor(config.colors.info)
          .setTitle('🌐 Status Node Active & Failover')
          .setDescription(`Node aktif untuk server ini: **\`${currentNode}\`**\n\n**Total Nodes Active:** ${nodes.filter(n => n.state === 1).length}/${nodes.length}`)
          .setTimestamp();

        for (const n of nodes) {
          embed.addFields({
            name: `${n.state === 1 ? '🟢' : '🔴'} ${n.name}`,
            value: `Status: ${getStateLabel(n.state, n.isDisabled)}\nPlayers: ${n.players}\nPriority: **${(n.priority || 'secondary').toUpperCase()}**`,
            inline: true,
          });
        }

        await interaction.reply({ embeds: [embed], flags: 64 });
        break;
      }
      default:
        break;
    }
  } catch (err) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ embeds: [errorEmbed('❌ Error Remot', err.message)], flags: 64 });
    }
  }
}
