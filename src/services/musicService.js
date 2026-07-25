// ============================================
// musicService.js - Music Player Manager using @discordjs/voice & play-dl
// ============================================
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import play from 'play-dl';
import { EmbedBuilder } from 'discord.js';
import config from '../config.js';
import { logError } from '../utils/errorManager.js';

// Map untuk menyimpan queue per guild: guildId -> QueueObject
const queues = new Map();

/**
 * Mendapatkan atau membuat queue untuk guild tertentu
 */
export function getQueue(guildId) {
  return queues.get(guildId);
}

/**
 * Memutar lagu atau menambahkan ke queue
 */
export async function playMusic(interaction, query) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    throw new Error('Kamu harus berada di Voice Channel terlebih dahulu!');
  }

  // Cek bot permissions di voice channel
  const permissions = voiceChannel.permissionsFor(interaction.client.user);
  if (!permissions.has('Connect') || !permissions.has('Speak')) {
    throw new Error('Bot tidak memiliki izin Connect atau Speak di channel tersebut!');
  }

  await interaction.deferReply();

  // Cari video/audio menggunakan play-dl
  let songInfo = null;

  try {
    if (play.yt_validate(query) === 'video') {
      const info = await play.video_info(query);
      const details = info.video_details;
      songInfo = {
        title: details.title,
        url: details.url,
        duration: details.durationRaw || 'Live',
        thumbnail: details.thumbnails[0]?.url,
        requester: interaction.user,
      };
    } else {
      const searchResults = await play.search(query, { limit: 1 });
      if (!searchResults || searchResults.length === 0) {
        throw new Error(`Lagu atau pencarian tidak ditemukan: **${query}**`);
      }
      const video = searchResults[0];
      songInfo = {
        title: video.title,
        url: video.url,
        duration: video.durationRaw || 'N/A',
        thumbnail: video.thumbnails[0]?.url,
        requester: interaction.user,
      };
    }
  } catch (err) {
    logError('Music Search Error', err);
    throw new Error(`Gagal mencari atau memuat musik: ${err.message}`);
  }

  let queue = queues.get(interaction.guildId);

  if (!queue) {
    queue = {
      guildId: interaction.guildId,
      voiceChannel: voiceChannel,
      textChannel: interaction.channel,
      connection: null,
      player: createAudioPlayer(),
      songs: [],
      currentlyPlaying: null,
      isPaused: false,
      disconnectTimeout: null,
    };

    queues.set(interaction.guildId, queue);

    // Setup listener player
    queue.player.on(AudioPlayerStatus.Idle, () => {
      queue.currentlyPlaying = null;
      processQueue(interaction.guildId);
    });

    queue.player.on('error', (error) => {
      logError('Audio Player Error', error);
      if (queue.textChannel) {
        queue.textChannel.send(`⚠️ Error saat memutar audio: ${error.message}`).catch(() => {});
      }
      queue.currentlyPlaying = null;
      processQueue(interaction.guildId);
    });
  } else {
    // Update voice channel & text channel jika berubah
    queue.voiceChannel = voiceChannel;
    queue.textChannel = interaction.channel;
  }

  // Connection voice
  if (!queue.connection || queue.connection.state.status === VoiceConnectionStatus.Destroyed) {
    queue.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guildId,
      adapterCreator: interaction.guild.voiceAdapterCreator,
    });

    queue.connection.subscribe(queue.player);

    queue.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(queue.connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(queue.connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch (e) {
        stopMusic(interaction.guildId);
      }
    });
  }

  // Bersihkan disconnect timeout jika ada
  if (queue.disconnectTimeout) {
    clearTimeout(queue.disconnectTimeout);
    queue.disconnectTimeout = null;
  }

  queue.songs.push(songInfo);

  if (!queue.currentlyPlaying) {
    processQueue(interaction.guildId);
    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle('🎵 Memutar Musik')
      .setDescription(`[${songInfo.title}](${songInfo.url})`)
      .addFields(
        { name: '⏱️ Durasi', value: songInfo.duration, inline: true },
        { name: '👤 Peminta', value: `<@${songInfo.requester.id}>`, inline: true }
      )
      .setThumbnail(songInfo.thumbnail || null)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } else {
    const embed = new EmbedBuilder()
      .setColor(config.colors.secondary)
      .setTitle('➕ Ditambahkan ke Antrean')
      .setDescription(`[${songInfo.title}](${songInfo.url})`)
      .addFields(
        { name: '📊 Posisi Antrean', value: `#${queue.songs.length}`, inline: true },
        { name: '⏱️ Durasi', value: songInfo.duration, inline: true },
        { name: '👤 Peminta', value: `<@${songInfo.requester.id}>`, inline: true }
      )
      .setThumbnail(songInfo.thumbnail || null)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
}

/**
 * Memproses dan memutar lagu selanjutnya dari antrean
 */
async function processQueue(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return;

  if (queue.songs.length === 0) {
    // Set timer disconnect jika antrean habis (3 menit)
    queue.disconnectTimeout = setTimeout(() => {
      stopMusic(guildId);
    }, 180000);
    return;
  }

  const nextSong = queue.songs.shift();
  queue.currentlyPlaying = nextSong;

  try {
    const stream = await play.stream(nextSong.url);
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
    });

    queue.player.play(resource);
  } catch (err) {
    logError('Stream Error', err);
    if (queue.textChannel) {
      queue.textChannel.send(`❌ Gagal memutar **${nextSong.title}**: ${err.message}`).catch(() => {});
    }
    queue.currentlyPlaying = null;
    processQueue(guildId);
  }
}

/**
 * Skip lagu yang sedang diputar
 */
export function skipTrack(guildId) {
  const queue = queues.get(guildId);
  if (!queue || !queue.currentlyPlaying) {
    throw new Error('Tidak ada musik yang sedang diputar.');
  }

  const skipped = queue.currentlyPlaying;
  queue.player.stop(); // Ini akan mentrigger AudioPlayerStatus.Idle -> processQueue
  return skipped;
}

/**
 * Pause musik yang sedang diputar
 */
export function pauseMusic(guildId) {
  const queue = queues.get(guildId);
  if (!queue || !queue.currentlyPlaying) {
    throw new Error('Tidak ada musik yang sedang diputar.');
  }
  if (queue.isPaused) {
    throw new Error('Musik sudah dalam kondisi pause.');
  }

  queue.player.pause();
  queue.isPaused = true;
  return queue.currentlyPlaying;
}

/**
 * Resume musik yang dipause
 */
export function resumeMusic(guildId) {
  const queue = queues.get(guildId);
  if (!queue || !queue.currentlyPlaying) {
    throw new Error('Tidak ada musik yang sedang diputar.');
  }
  if (!queue.isPaused) {
    throw new Error('Musik tidak dalam kondisi pause.');
  }

  queue.player.unpause();
  queue.isPaused = false;
  return queue.currentlyPlaying;
}

/**
 * Stop musik, bersihkan queue dan keluar dari voice channel
 */
export function stopMusic(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return false;

  if (queue.disconnectTimeout) {
    clearTimeout(queue.disconnectTimeout);
  }

  queue.songs = [];
  queue.currentlyPlaying = null;
  queue.player.stop();

  if (queue.connection && queue.connection.state.status !== VoiceConnectionStatus.Destroyed) {
    queue.connection.destroy();
  }

  queues.delete(guildId);
  return true;
}
