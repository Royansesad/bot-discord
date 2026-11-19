// ============================================
// nativeEngine.js - Native Audio Engine (tanpa Lavalink/NodeLink)
// discord.js + @discordjs/voice + yt-dlp.
//
// Mode streaming:
//  1. Opus passthrough (WebM/Ogg) -> nol decode/encode, CPU paling kecil. Tidak butuh FFmpeg.
//  2. PCM via FFmpeg (opsional, hanya jika FFmpeg terpasang) -> volume realtime + sumber non-Opus.
//
// Pencarian & pengambilan metadata dilakukan oleh yt-dlp (binary eksternal, bukan server audio).
// ============================================
import { spawn, spawnSync } from 'node:child_process';
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from '@discordjs/voice';

export const DEFAULT_BANNER = 'https://i.postimg.cc/7Z52mQ0K/Amba-Music.png';

// Container Opus yang bisa dikirim langsung ke Discord tanpa FFmpeg
const OPUS_CONTAINERS = {
  webm: StreamType.WebmOpus,
  ogg: StreamType.OggOpus,
  opus: StreamType.OggOpus,
};

const tools = {
  checked: false,
  ytdlp: false,
  ffmpeg: false,
  ytdlpPath: 'yt-dlp',
  ffmpegPath: 'ffmpeg',
};

function probeBinary(bin) {
  try {
    const res = spawnSync(bin, ['--version'], {
      timeout: 10000,
      windowsHide: true,
      stdio: 'ignore',
    });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * Deteksi binary yt-dlp & ffmpeg (di-cache; panggil dengan force=true untuk re-check).
 */
export function detectNativeTools(force = false) {
  if (tools.checked && !force) return { ...tools };

  const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

  tools.ytdlpPath = ytdlpPath;
  tools.ffmpegPath = ffmpegPath;
  tools.ytdlp = probeBinary(ytdlpPath);

  // Fallback khusus Windows: sebagian instalasi mengekspos yt-dlp.exe saja
  if (!tools.ytdlp && process.platform === 'win32' && !process.env.YTDLP_PATH && probeBinary('yt-dlp.exe')) {
    tools.ytdlp = true;
    tools.ytdlpPath = 'yt-dlp.exe';
  }

  tools.ffmpeg = probeBinary(ffmpegPath);
  tools.checked = true;

  return { ...tools };
}

export function getNativeToolStatus() {
  return detectNativeTools();
}

export function isNativeAvailable() {
  return detectNativeTools().ytdlp === true;
}

/**
 * Format durasi ms -> mm:ss / h:mm:ss
 */
export function formatDuration(ms) {
  if (!ms || Number.isNaN(Number(ms))) return 'Live / N/A';
  const totalSeconds = Math.floor(Number(ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

/**
 * Jalankan yt-dlp dengan --dump-json dan ambil metadata entri pertama.
 */
/**
 * Argumen tambahan yt-dlp (cookies opsional untuk mengatasi 403 / age-gate)
 */
function extraYtDlpArgs() {
  const args = [];
  const cookies = process.env.YTDLP_COOKIES;
  if (cookies) args.push('--cookies', cookies);
  return args;
}

function runYtDlpJson(target, flat = false, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const { ytdlpPath } = detectNativeTools();

    const args = [
      '--dump-single-json',
      '--no-playlist',
      '--no-warnings',
      '--skip-download',
      '--socket-timeout', '15',
      '--retries', '1',
      // Selector yang sama dengan playback supaya info.ext/acodec akurat
      '-f', 'bestaudio[acodec=opus]/bestaudio',
      ...extraYtDlpArgs(),
      ...(flat ? ['--flat-playlist'] : []),
      target,
    ];

    let child;
    try {
      child = spawn(ytdlpPath, args, { windowsHide: true });
    } catch (err) {
      reject(new Error(`yt-dlp tidak dapat dijalankan: ${err.message}`));
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch { /* sudah selesai */ }
      fn(value);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error('Pencarian timeout: yt-dlp tidak merespon dalam 30 detik.'));
    }, timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 4_000_000) stdout = stdout.slice(0, 4_000_000);
    });
    child.stdout?.on('error', () => {});

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.stderr?.on('error', () => {});

    child.on('error', (err) => {
      finish(reject, new Error(`yt-dlp gagal dijalankan: ${err.message}`));
    });

    child.on('close', (code) => {
      if (settled) return;

      const line = stdout
        .split(/\r?\n/)
        .map(l => l.trim())
        .find(l => l.startsWith('{'));

      if (!line) {
        const lastErr = stderr.trim().split(/\r?\n/).filter(Boolean).pop();
        finish(reject, new Error(`yt-dlp tidak menemukan hasil (exit ${code})${lastErr ? `: ${lastErr}` : ''}`));
        return;
      }

      let info;
      try {
        // --dump-single-json untuk pencarian mengembalikan wrapper playlist { entries: [...] }
        info = JSON.parse(stdout.slice(stdout.indexOf('{')));
      } catch {
        finish(reject, new Error('Gagal membaca metadata lagu dari yt-dlp.'));
        return;
      }

      finish(resolve, info);
    });
  });
}

/**
 * Cari lagu via yt-dlp (mendukung URL maupun kata kunci).
 * Hasil kompatibel dengan struktur songInfo yang dipakai musicService.
 */
export async function searchNative(query) {
  const { ytdlp, ytdlpPath } = detectNativeTools();
  if (!ytdlp) {
    throw new Error('yt-dlp tidak ditemukan. Install yt-dlp atau set environment YTDLP_PATH.');
  }

  const clean = String(query || '').trim();
  if (!clean) throw new Error('Judul lagu tidak boleh kosong.');

  const isUrl = /^https?:\/\//i.test(clean);
  const target = isUrl ? clean : `ytsearch1:${clean}`;

  // Percobaan 1: metadata lengkap (ada ext/acodec/durasi/thumbnail)
  // Percobaan 2: flat playlist (jauh lebih cepat & tahan blokir format)
  let raw = null;
  let fullError = null;

  try {
    raw = await runYtDlpJson(target, false);
  } catch (err) {
    fullError = err;
  }

  if (!raw) {
    try {
      raw = await runYtDlpJson(target, true);
    } catch (flatErr) {
      throw new Error(fullError?.message || flatErr.message || `yt-dlp (${ytdlpPath}) gagal mencari lagu.`);
    }
  }

  // Wrapper playlist dari pencarian: ambil entri pertama
  const info = Array.isArray(raw?.entries) ? raw.entries[0] : raw;
  if (!info) throw new Error('Lagu tidak ditemukan.');

  let url = info.webpage_url || info.original_url || info.url || null;

  if (!url && info.id) {
    url = /^\d+$/.test(String(info.id))
      ? `https://soundcloud.com/tracks/${info.id}`
      : `https://www.youtube.com/watch?v=${info.id}`;
  }

  if (!url) throw new Error('Lagu tidak ditemukan.');

  const durationMs = Number.isFinite(info.duration) ? Math.round(info.duration * 1000) : 0;
  const isStream = Boolean(info.is_live) || info.live_status === 'is_live';

  const thumbnail =
    info.thumbnail ||
    (Array.isArray(info.thumbnails) && info.thumbnails.length > 0
      ? info.thumbnails[info.thumbnails.length - 1]?.url
      : null) ||
    DEFAULT_BANNER;

  // Flat search tidak memberi kontainer; tebak dari host (YouTube = webm/opus)
  const guessedExt = /youtu\.?be/i.test(url)
    ? 'webm'
    : /soundcloud\.com/i.test(url)
      ? 'm4a'
      : '';

  return {
    query: clean,
    native: true,
    track: {
      id: info.id || url,
      url,
      ext: String(info.ext || guessedExt || '').toLowerCase(),
      acodec: String(info.acodec || '').toLowerCase(),
    },
    title: info.title || 'Unknown',
    url,
    duration: durationMs > 0 ? formatDuration(durationMs) : (isStream ? 'Live' : 'N/A'),
    durationMs,
    thumbnail,
    author: info.uploader || info.channel || info.creator || 'Unknown',
    isStream,
  };
}

/**
 * Spawn proses yt-dlp untuk URL lagu dan siapkan stream audio.
 */
function createNativeStream(song) {
  const { ytdlpPath, ffmpegPath, ffmpeg } = detectNativeTools();

  const url = song?.track?.url || song?.url;
  if (!url) throw new Error('URL audio tidak valid.');

  const state = { stderr: '' };

  const spawnYtDlp = () => {
    const child = spawn(
      ytdlpPath,
      [
        '--no-playlist',
        '--no-warnings',
        '--quiet',
        '--no-mtime',
        ...extraYtDlpArgs(),
        '-f', 'bestaudio[acodec=opus]/bestaudio',
        '-o', '-',
        url,
      ],
      { windowsHide: true }
    );

    // Stream harus punya handler error agar EPIPE tidak mematikan proses bot
    child.stdout?.on('error', () => {});
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => {
      state.stderr = (state.stderr + chunk).slice(-800);
    });
    child.stderr?.on('error', () => {});
    child.on('error', (err) => {
      state.stderr = `${state.stderr}\n${err.message}`.slice(-800);
    });

    return child;
  };

  if (ffmpeg) {
    // Jalur PCM: volume realtime bisa diterapkan lewat inlineVolume
    const ytdlp = spawnYtDlp();
    const ff = spawn(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel', 'error',
        '-i', 'pipe:0',
        '-vn',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1',
      ],
      { windowsHide: true }
    );

    ff.stdout?.on('error', () => {});
    ff.stdin?.on('error', () => {});
    ff.stderr?.setEncoding('utf8');
    ff.stderr?.on('data', () => {});
    ff.stderr?.on('error', () => {});
    ff.on('error', () => {});

    ytdlp.stdout.pipe(ff.stdin);

    return {
      type: StreamType.Raw,
      stream: ff.stdout,
      children: [ytdlp, ff],
      inlineVolume: true,
      primary: ytdlp,
      state,
    };
  }

  // Jalur Opus passthrough (tanpa FFmpeg): tidak ada decode/encode sama sekali
  const ext = String(song?.track?.ext || '').toLowerCase();
  const inputType = OPUS_CONTAINERS[ext];

  if (!inputType) {
    throw new Error(
      `Sumber audio berformat "${ext || 'unknown'}" membutuhkan FFmpeg. ` +
      'Install FFmpeg, atau gunakan engine Lavalink/NodeLink untuk lagu ini.'
    );
  }

  const ytdlp = spawnYtDlp();
  return {
    type: inputType,
    stream: ytdlp.stdout,
    children: [ytdlp],
    inlineVolume: false,
    primary: ytdlp,
    state,
  };
}

function cleanupStream(session) {
  for (const child of session.children || []) {
    try { child.kill('SIGKILL'); } catch { /* sudah mati */ }
  }
  session.children = [];
  session.resource = null;
}

/**
 * Buat sesi voice native: koneksi + AudioPlayer + listener siklus hidup.
 */
export async function startNativeSession({ guild, voiceChannel, onFinish, onError, onDisconnect }) {
  if (!guild?.voiceAdapterCreator) {
    throw new Error('Voice adapter tidak tersedia (pastikan @discordjs/voice terpasang).');
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20000);
  } catch {
    try { connection.destroy(); } catch { /* abaikan */ }
    throw new Error('Gagal terhubung ke Voice Channel (timeout 20 detik).');
  }

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play },
  });

  const session = {
    connection,
    player,
    resource: null,
    children: [],
    inlineVolume: false,
    channelId: voiceChannel.id,
    suppressIdle: false,
    destroyed: false,
    onError,
  };

  player.on('stateChange', (oldState, newState) => {
    if (session.destroyed) return;
    if (oldState.status === newState.status) return;

    if (newState.status === AudioPlayerStatus.Idle) {
      if (session.suppressIdle) {
        session.suppressIdle = false;
        return;
      }
      cleanupStream(session);
      onFinish?.();
    }
  });

  player.on('error', (error) => {
    if (session.destroyed) return;
    session.suppressIdle = true;
    cleanupStream(session);
    onError?.(error);
  });

  connection.on('stateChange', (oldState, newState) => {
    if (session.destroyed) return;
    if (oldState.status === newState.status) return;

    if (newState.status === VoiceConnectionStatus.Disconnected) {
      session.destroyed = true;
      cleanupStream(session);
      onDisconnect?.();
    }
  });

  connection.subscribe(player);
  return session;
}

export function isNativeSessionAlive(session, channelId = null) {
  if (!session || session.destroyed) return false;

  const status = session.connection?.state?.status;
  if (!status || status === VoiceConnectionStatus.Destroyed) return false;

  const joinedChannel = session.connection?.joinConfig?.channelId;
  if (channelId && joinedChannel && joinedChannel !== channelId) return false;

  return (
    status === VoiceConnectionStatus.Ready ||
    status === VoiceConnectionStatus.Connecting ||
    status === VoiceConnectionStatus.Signalling
  );
}

/**
 * Putar satu lagu pada sesi native yang sudah aktif.
 */
export function playNativeTrack(queue, song) {
  const session = queue.native;
  if (!session) throw new Error('Sesi voice native belum siap.');

  const { type, stream, children, inlineVolume, primary, state } = createNativeStream(song);

  cleanupStream(session);

  const resource = createAudioResource(stream, {
    inputType: type,
    inlineVolume,
  });

  if (inlineVolume && resource.volume) {
    resource.volume.setVolume(Math.min(2, Math.max(0, queue.volume / 100)));
  }

  // @discordjs/voice hanya memasang handler 'error' pada resource lama, sehingga
  // error stream (data korup / koneksi putus) bisa mematikan proses bot.
  resource.playStream?.on?.('error', (err) => {
    session.suppressIdle = true;
    session.onError?.(err);
  });

  session.resource = resource;
  session.children = children;
  session.inlineVolume = inlineVolume;
  session.suppressIdle = false;
  session.player.play(resource);

  // Resolve saat byte pertama mengalir, atau reject dengan pesan yt-dlp
  // (403 / format tidak ada) supaya user melihat alasan gagalnya.
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.removeListener('data', onData);
      primary?.removeListener('close', onClose);
      if (err) reject(err);
      else resolve();
    };

    const onData = () => finish(null);

    const onClose = (code) => {
      if (code === 0 || code === null || code === undefined) {
        finish(null);
        return;
      }

      const reason = (state.stderr || '').trim().split(/\r?\n/).filter(Boolean).pop();
      finish(new Error(reason || `yt-dlp berhenti tanpa output (exit ${code})`));
    };

    // Timeout: proses masih hidup tapi lambat, biarkan pemutaran berjalan
    const timer = setTimeout(() => finish(null), 15000);

    stream.once('data', onData);
    primary?.once('close', onClose);
  });
}

/**
 * Ubah volume. Mengembalikan true jika benar-benar diterapkan ke stream aktif
 * (butuh FFmpeg; mode Opus passthrough tidak bisa diubah realtime).
 */
export function setNativeVolume(queue, volume) {
  const session = queue.native;
  if (!session) return false;

  const clamped = Math.max(0, Math.min(200, Math.round(volume)));

  if (session.inlineVolume && session.resource?.volume) {
    session.resource.volume.setVolume(Math.min(2, clamped / 100));
    return true;
  }

  return false;
}

export function pauseNative(queue, paused = true) {
  const session = queue.native;
  if (!session) return;
  try {
    if (paused) session.player.pause();
    else session.player.unpause();
  } catch { /* abaikan */ }
}

export function getNativePosition(queue) {
  return queue.native?.resource?.playbackDuration || 0;
}

/**
 * Hentikan track aktif tanpa memicu auto-advance (dipakai untuk skip/stop).
 */
export function stopNativePlayback(queue) {
  const session = queue.native;
  if (!session) return;
  session.suppressIdle = true;
  try { session.player.stop(true); } catch { /* abaikan */ }
  cleanupStream(session);
}

/**
 * Tutup total sesi native (disconnect dari voice channel).
 */
export function destroyNativeSession(queue) {
  const session = queue.native;
  if (!session) return;

  session.destroyed = true;
  session.suppressIdle = true;

  try { session.player.stop(true); } catch { /* abaikan */ }
  cleanupStream(session);

  try { session.connection.destroy(); } catch { /* abaikan */ }

  queue.native = null;
}
