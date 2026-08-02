// ============================================
// musicService.js - Pure JS Music Player Service via Lavalink (Kazagumo & Shoukaku)
// No native C++ dependencies, no ffmpeg needed on host machine.
// Compatible with older Node.js versions and shared hosting.
// ============================================
import { Kazagumo } from 'kazagumo';
import { Connectors } from 'shoukaku';
import { EmbedBuilder } from 'discord.js';
import config from '../config.js';
import { logError } from '../utils/errorManager.js';

let kazagumo = null;

/**
 * Inisialisasi Kazagumo Lavalink Client
 */
export function initKazagumo(client) {
  if (kazagumo) return kazagumo;

  try {
    kazagumo = new Kazagumo(
      {
        defaultSearchEngine: 'youtube',
        send: (guildId, payload) => {
          const guild = client.guilds.cache.get(guildId);
          if (guild) guild.shard.send(payload);
        },
      },
      new Connectors.DiscordJS(client),
      config.lavalink
    );

    // Note: Raw WebSocket packet forwarding is handled automatically by Connectors.DiscordJS

    kazagumo.shoukaku.on('ready', (name) => {
      console.log(`🎵 Lavalink Node "${name}" berhasil terhubung!`);
    });

    kazagumo.shoukaku.on('error', (name, error) => {
      logError(`Lavalink Node "${name}" Error`, error);
    });

    kazagumo.shoukaku.on('close', (name, code, reason) => {
      console.log(`⚠️ Lavalink Node "${name}" terputus (Code: ${code}, Reason: ${reason || 'N/A'})`);
    });

    kazagumo.shoukaku.on('disconnect', (name, count) => {
      console.log(`⚠️ Lavalink Node "${name}" disconnected (reconnect count: ${count})`);
    });

    kazagumo.on('playerStart', (player, track) => {
      if (!player.textId) return;
      const channel = client.channels.cache.get(player.textId);
      if (!channel) return;

      const embed = new EmbedBuilder()
        .setColor(config.colors.primary)
        .setTitle('🎵 Memutar Musik')
        .setDescription(`[**${track.title}**](${track.uri})`)
        .addFields(
          { name: '⏱️ Durasi', value: formatDuration(track.length), inline: true },
          { name: '👤 Peminta', value: track.requester ? `<@${track.requester.id}>` : 'N/A', inline: true }
        )
        .setThumbnail(track.thumbnail || null)
        .setTimestamp();

      channel.send({ embeds: [embed] }).catch(() => {});
    });

    kazagumo.on('playerEmpty', (player) => {
      if (player.textId) {
        const channel = client.channels.cache.get(player.textId);
        if (channel) {
          channel.send('⏹️ Antrean musik telah habis. Disconnect dari voice channel.').catch(() => {});
        }
      }
      player.destroy();
    });

    kazagumo.on('playerError', (player, error) => {
      logError('Kazagumo Player Error', error);
    });

    client.kazagumo = kazagumo;
    return kazagumo;
  } catch (error) {
    logError('Kazagumo Init Failed', error);
    return null;
  }
}

/**
 * Mendapatkan instance Kazagumo
 */
export function getKazagumo() {
  return kazagumo;
}

/**
 * Mendapatkan player aktif di guild tertentu
 */
export function getPlayer(guildId) {
  return kazagumo?.players.get(guildId) || null;
}

/**
 * Memutar lagu atau menambahkan ke antrean
 */
export async function playMusic(interaction, query) {
  if (!kazagumo) {
    throw new Error('Music service (Lavalink) belum siap. Coba beberapa saat lagi.');
  }

  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    throw new Error('Kamu harus berada di Voice Channel terlebih dahulu!');
  }

  const permissions = voiceChannel.permissionsFor(interaction.client.user);
  if (!permissions.has('Connect') || !permissions.has('Speak')) {
    throw new Error('Bot tidak memiliki izin Connect atau Speak di voice channel tersebut!');
  }

  await interaction.deferReply();

  let player = kazagumo.players.get(interaction.guildId);

  if (!player) {
    player = await kazagumo.createPlayer({
      guildId: interaction.guildId,
      voiceId: voiceChannel.id,
      textId: interaction.channel.id,
      deafen: true,
    });
  } else {
    player.setTextId(interaction.channel.id);
  }

  const result = await kazagumo.search(query, { requester: interaction.user });

  if (result.type === 'EMPTY' || !result.tracks.length) {
    throw new Error(`Lagu atau pencarian tidak ditemukan untuk: **${query}**`);
  }

  if (result.type === 'PLAYLIST') {
    for (const track of result.tracks) {
      player.queue.add(track);
    }

    if (!player.playing && !player.paused) {
      await player.play();
    }

    const embed = new EmbedBuilder()
      .setColor(config.colors.secondary)
      .setTitle('📑 Playlist Ditambahkan')
      .setDescription(`Memuat **${result.tracks.length} lagu** dari playlist: **${result.playlistName || 'Playlist'}**`)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const track = result.tracks[0];
  player.queue.add(track);

  if (!player.playing && !player.paused) {
    await player.play();

    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle('🎵 Memutar Musik')
      .setDescription(`[**${track.title}**](${track.uri})`)
      .addFields(
        { name: '⏱️ Durasi', value: formatDuration(track.length), inline: true },
        { name: '👤 Peminta', value: `<@${interaction.user.id}>`, inline: true }
      )
      .setThumbnail(track.thumbnail || null)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } else {
    const embed = new EmbedBuilder()
      .setColor(config.colors.secondary)
      .setTitle('➕ Ditambahkan ke Antrean')
      .setDescription(`[**${track.title}**](${track.uri})`)
      .addFields(
        { name: '📊 Posisi Antrean', value: `#${player.queue.length}`, inline: true },
        { name: '⏱️ Durasi', value: formatDuration(track.length), inline: true },
        { name: '👤 Peminta', value: `<@${interaction.user.id}>`, inline: true }
      )
      .setThumbnail(track.thumbnail || null)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
}

/**
 * Skip lagu yang sedang diputar
 */
export function skipTrack(guildId) {
  const player = getPlayer(guildId);
  if (!player || !player.queue.current) {
    throw new Error('Tidak ada musik yang sedang diputar.');
  }

  const skipped = player.queue.current;
  player.skip();
  return skipped;
}

/**
 * Pause musik
 */
export function pauseMusic(guildId) {
  const player = getPlayer(guildId);
  if (!player || !player.queue.current) {
    throw new Error('Tidak ada musik yang sedang diputar.');
  }
  if (player.paused) {
    throw new Error('Musik sudah dalam kondisi pause.');
  }

  player.pause(true);
  return player.queue.current;
}

/**
 * Resume musik
 */
export function resumeMusic(guildId) {
  const player = getPlayer(guildId);
  if (!player || !player.queue.current) {
    throw new Error('Tidak ada musik yang sedang diputar.');
  }
  if (!player.paused) {
    throw new Error('Musik tidak dalam kondisi pause.');
  }

  player.pause(false);
  return player.queue.current;
}

/**
 * Stop musik dan disconnect
 */
export function stopMusic(guildId) {
  const player = getPlayer(guildId);
  if (!player) return false;

  player.destroy();
  return true;
}

/**
 * Format durasi dari ms ke string MM:SS
 */
export function formatDuration(ms) {
  if (!ms || isNaN(ms)) return 'Live / N/A';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}
