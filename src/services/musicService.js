// ============================================
// musicService.js - Music Service menggunakan @discordjs/voice + yt-dlp
// Pakai tweetnacl (pure JS) dan opusscript (WebAssembly) - zero native C++ build
// Audio source: yt-dlp via child_process
// ============================================
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} from '@discordjs/voice';
import { execSync, spawn } from 'child_process';
import { EmbedBuilder } from 'discord.js';
import config from '../config.js';
import { logError } from '../utils/errorManager.js';

// Map untuk menyimpan queue per guild: guildId -> QueueObject
const queues = new Map();

// Cek yt-dlp tersedia
let ytdlpPath = 'yt-dlp';
try {
  execSync('yt-dlp --version', { stdio: 'pipe' });
  console.log('✅ yt-dlp ditemukan.');
} catch {
  try {
    execSync('python -m yt_dlp --version', { stdio: 'pipe' });
    ytdlpPath = 'python -m yt_dlp';
    console.log('✅ yt-dlp ditemukan (via python module).');
  } catch {
    try {
      execSync('python3 -m yt_dlp --version', { stdio: 'pipe' });
      ytdlpPath = 'python3 -m yt_dlp';
      console.log('✅ yt-dlp ditemukan (via python3 module).');
    } catch {
      console.log('⚠️ yt-dlp tidak ditemukan! Fitur musik tidak akan berfungsi.');
      console.log('   Install: pip install yt-dlp');
    }
  }
}

/**
 * Cari info lagu via yt-dlp
 */
async function searchTrack(query) {
  return new Promise((resolve, reject) => {
    let searchQuery = query;
    // Jika bukan URL, gunakan ytsearch
    if (!query.startsWith('http://') && !query.startsWith('https://')) {
      searchQuery = `ytsearch:${query}`;
    }

    const args = ytdlpPath === 'yt-dlp'
      ? ['yt-dlp', '--dump-json', '--no-playlist', '--default-search', 'ytsearch', searchQuery]
      : ytdlpPath.split(' ').concat(['--dump-json', '--no-playlist', '--default-search', 'ytsearch', searchQuery]);

    const cmd = args[0];
    const cmdArgs = args.slice(1);

    const proc = spawn(cmd, cmdArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        reject(new Error(`yt-dlp gagal: ${stderr || 'Tidak ada hasil'}`));
        return;
      }
      try {
        const info = JSON.parse(stdout);
        resolve({
          title: info.title || 'Unknown',
          url: info.webpage_url || info.url || query,
          duration: info.duration ? formatDuration(info.duration * 1000) : 'N/A',
          durationMs: (info.duration || 0) * 1000,
          thumbnail: info.thumbnail || null,
        });
      } catch (e) {
        reject(new Error('Gagal parse info lagu'));
      }
    });

    // Timeout 15 detik
    setTimeout(() => {
      proc.kill();
      reject(new Error('Pencarian timeout (15s).'));
    }, 15000);
  });
}

/**
 * Buat audio stream dari yt-dlp
 */
function createYtdlpStream(url) {
  const args = ytdlpPath === 'yt-dlp'
    ? ['-f', 'bestaudio[acodec=opus]/bestaudio', '-o', '-', '--quiet', url]
    : ['-f', 'bestaudio[acodec=opus]/bestaudio', '-o', '-', '--quiet', url];

  const cmdParts = ytdlpPath.split(' ');
  const cmd = cmdParts[0];
  const cmdArgs = cmdParts.slice(1).concat(args);

  const proc = spawn(cmd, cmdArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  proc.stderr.on('data', (data) => {
    // Log stderr tapi jangan crash
    const msg = data.toString().trim();
    if (msg && !msg.startsWith('WARNING')) {
      logError('yt-dlp stream stderr', new Error(msg));
    }
  });

  return { stream: proc.stdout, process: proc };
}

/**
 * Mendapatkan queue untuk guild
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

  const permissions = voiceChannel.permissionsFor(interaction.client.user);
  if (!permissions.has('Connect') || !permissions.has('Speak')) {
    throw new Error('Bot tidak memiliki izin Connect atau Speak di channel tersebut!');
  }

  await interaction.deferReply();

  // Cari info lagu
  let songInfo;
  try {
    songInfo = await searchTrack(query);
  } catch (err) {
    throw new Error(`Gagal mencari lagu: ${err.message}`);
  }

  songInfo.requester = interaction.user;

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
      currentProcess: null,
    };

    queues.set(interaction.guildId, queue);

    // Saat player idle, mainkan lagu berikutnya
    queue.player.on(AudioPlayerStatus.Idle, () => {
      if (queue.currentProcess) {
        queue.currentProcess.kill();
        queue.currentProcess = null;
      }
      queue.currentlyPlaying = null;
      processQueue(interaction.guildId);
    });

    queue.player.on('error', (error) => {
      logError('Audio Player Error', error);
      if (queue.currentProcess) {
        queue.currentProcess.kill();
        queue.currentProcess = null;
      }
      queue.currentlyPlaying = null;
      processQueue(interaction.guildId);
    });
  } else {
    queue.voiceChannel = voiceChannel;
    queue.textChannel = interaction.channel;
  }

  // Buat voice connection jika belum ada
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
      } catch {
        stopMusic(interaction.guildId);
      }
    });
  }

  // Clear disconnect timeout
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
      .setDescription(`[**${songInfo.title}**](${songInfo.url})`)
      .addFields(
        { name: '⏱️ Durasi', value: songInfo.duration, inline: true },
        { name: '👤 Peminta', value: `<@${songInfo.requester.id}>`, inline: true }
      )
      .setThumbnail(songInfo.thumbnail || null)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } else {
    const embed = new EmbedBuilder()
      .setColor(config.colors.secondary || config.colors.info)
      .setTitle('➕ Ditambahkan ke Antrean')
      .setDescription(`[**${songInfo.title}**](${songInfo.url})`)
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
 * Proses queue - putar lagu berikutnya
 */
async function processQueue(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return;

  if (queue.songs.length === 0) {
    // Auto disconnect setelah 3 menit idle
    queue.disconnectTimeout = setTimeout(() => {
      if (queue.textChannel) {
        queue.textChannel.send('⏹️ Antrean habis. Disconnect dari voice channel.').catch(() => {});
      }
      stopMusic(guildId);
    }, 180000);
    return;
  }

  const nextSong = queue.songs.shift();
  queue.currentlyPlaying = nextSong;

  try {
    const { stream, process: proc } = createYtdlpStream(nextSong.url);
    queue.currentProcess = proc;

    const resource = createAudioResource(stream, {
      inputType: StreamType.Arbitrary,
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
 * Skip lagu saat ini
 */
export function skipTrack(guildId) {
  const queue = queues.get(guildId);
  if (!queue || !queue.currentlyPlaying) {
    throw new Error('Tidak ada musik yang sedang diputar.');
  }

  const skipped = queue.currentlyPlaying;
  if (queue.currentProcess) {
    queue.currentProcess.kill();
    queue.currentProcess = null;
  }
  queue.player.stop(); // Triggers Idle -> processQueue
  return skipped;
}

/**
 * Pause musik
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
 * Resume musik
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
 * Stop dan disconnect
 */
export function stopMusic(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return false;

  if (queue.disconnectTimeout) {
    clearTimeout(queue.disconnectTimeout);
  }
  if (queue.currentProcess) {
    queue.currentProcess.kill();
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

/**
 * Format durasi ms -> MM:SS
 */
export function formatDuration(ms) {
  if (!ms || isNaN(ms)) return 'Live / N/A';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}
