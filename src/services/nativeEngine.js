// ============================================
// nativeEngine.js - Native Audio Engine (tanpa server Lavalink)
// discord.js + @discordjs/voice + youtubei.js (Innertube).
//
// Tidak memakai cookie, yt-dlp, atau binary eksternal untuk YouTube.
// youtubei.js adalah paket ESM murni ("type": "module"), jadi import-nya
// aman di proyek yang juga ESM dan tidak butuh createRequire().
//
// Mode streaming:
//  1. Opus passthrough (WebM/Ogg) -> nol decode/encode, CPU paling kecil. Tidak butuh FFmpeg.
//  2. PCM via FFmpeg (opsional, hanya jika FFmpeg terpasang) -> volume realtime + sumber non-Opus.
// ============================================
import { spawn, spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { Innertube, Parser, Platform } from 'youtubei.js';
import {
  ensureProxyReady,
  getActiveProxyUrl,
  getProxyDispatcher,
  getStaticProxy,
  isProxyActive,
  reportProxyFailure,
} from './proxyManager.js';
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

// youtubei.js sengaja TIDAK menyertakan interpreter JavaScript karena alasan
// keamanan. Untuk men-decipher URL format tertentu, sediakan evaluator sendiri.
// (Referensi: https://ytjs.dev/guide/getting-started.html)
Platform.shim.eval = async (data) => new Function(data.output)();

// youtubei.js 18.3.0 belum mengenal node "DecoratedAvatarView" yang sekarang
// dikirim YouTube untuk AvatarStackView (avatar kanal di metadata pencarian).
// Parser hanya melewati item tersebut, tetapi mencetak warning yang sama
// berulang kali. Saring warning yang diketahui aman ini; masalah parser lain
// tetap dicatat agar tidak tersembunyi.
Parser.setParserErrorHandler((context) => {
  if (context?.error_type === 'typecheck' && context?.expected === 'AvatarView') return;
  const detail = context?.error?.message ||
    `${context?.classname || 'unknown'} (${context?.error_type || 'parse'})`;
  console.warn('[youtubei.js]', detail);
});

export const DEFAULT_BANNER = 'https://i.postimg.cc/7Z52mQ0K/Amba-Music.png';

// Container Opus yang bisa dikirim langsung ke Discord tanpa FFmpeg
const OPUS_CONTAINERS = {
  webm: StreamType.WebmOpus,
  ogg: StreamType.OggOpus,
  opus: StreamType.OggOpus,
};

const tools = {
  checked: false,
  youtubei: true,
  ffmpeg: false,
  ffmpegPath: 'ffmpeg',
  proxy: false,
};

// ============================================
// Proxy otomatis (proxyManager.js)
// ============================================
// YOUTUBE_PROXY tetap didukung sebagai override manual. Tanpa itu, proxy
// diambil & diuji otomatis dari sumber publik, lalu dipakai untuk request API
// YouTube maupun unduhan media (host googlevideo yang diblokir ISP).
function proxiedFetch(input, init) {
  const dispatcher = getProxyDispatcher();
  if (!dispatcher) return fetch(input, init);

  return fetch(input, { ...init, dispatcher }).catch((err) => {
    // Abort dari timeout internal bukan bukti proxy mati.
    if (err?.name !== 'AbortError' && isProxyActive()) {
      reportProxyFailure(getActiveProxyUrl());
    }
    throw err;
  });
}

// Regex URL YouTube (watch, youtu.be, shorts, live, embed, music.youtube.com)
const YOUTUBE_URL_RE =
  /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;

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
 * Deteksi tool engine native. youtubei.js selalu tersedia (dependency npm);
 * FFmpeg opsional dan di-cache (panggil force=true untuk re-check).
 */
export function detectNativeTools(force = false) {
  if (tools.checked && !force) return { ...tools };

  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

  tools.ffmpegPath = ffmpegPath;
  tools.ffmpeg = probeBinary(ffmpegPath);
  tools.youtubei = true;
  tools.proxy = Boolean(getStaticProxy() || getActiveProxyUrl());
  tools.checked = true;

  return { ...tools };
}

export function getNativeToolStatus() {
  return detectNativeTools();
}

export function isNativeAvailable() {
  return true;
}

// ============================================
// Innertube sessions
// ============================================
// Pencarian memakai klien WEB (hasil paling lengkap). Streaming memakai klien
// seluler/embedded yang masih memberi URL media langsung tanpa cookie maupun
// PO token.
//
// VISIONOS dipakai lebih dulu karena URL-nya masih melayani Range penuh
// (termasuk di tengah file), sehingga audio bisa diambil bertahap sampai akhir.
// Klien lain (mis. WEB_REMIX) kadang hanya mengizinkan ~448 KiB pertama,
// jadi hanya dipakai sebagai fallback.
const STREAM_CLIENTS = ['VISIONOS', 'ANDROID_VR', 'WEB_REMIX'];
let searchClientPromise = null;
const streamClientPromises = new Map();

function createInnertube(clientType, retrievePlayer = true) {
  return Innertube.create({
    lang: 'en',
    location: 'US',
    // Player script dipakai HANYA untuk decipher URL media. Sesi pencarian tidak
    // pernah memanggil decipher, jadi memuatnya hanya membuang memori (JsAnalyzer
    // mem-parsing ~2MB JavaScript menjadi AST — ini sumber lonjakan memori saat
    // engine native dipakai, hingga proses di-SIGKILL dengan exit code 137).
    retrieve_player: retrievePlayer,
    enable_session_cache: false,
    client_type: clientType,
    fetch: proxiedFetch,
  });
}

function getSearchClient() {
  if (!searchClientPromise) {
    searchClientPromise = createInnertube('WEB', false).catch((err) => {
      searchClientPromise = null;
      throw new Error(`Gagal membuat sesi YouTube (pencarian): ${shortError(err)}`);
    });
  }
  return searchClientPromise;
}

function getStreamClient(clientType = STREAM_CLIENTS[0]) {
  if (!streamClientPromises.has(clientType)) {
    const promise = createInnertube(clientType, true).catch((err) => {
      streamClientPromises.delete(clientType);
      throw new Error(`Gagal membuat sesi YouTube (${clientType}): ${shortError(err)}`);
    });
    streamClientPromises.set(clientType, promise);
  }
  return streamClientPromises.get(clientType);
}

/**
 * Lepaskan sesi Innertube yang di-cache setelah antrean native selesai.
 * Tanpa ini, AST player script dari tiap klien tetap tersimpan di memori.
 */
export function releaseNativeClients() {
  searchClientPromise = null;
  streamClientPromises.clear();
}

/** Ambil baris pertama pesan error agar embed Discord tidak kebanjiran stack trace. */
function shortError(err) {
  const cause = err?.cause?.code || err?.cause?.message;
  const message = String(err?.message || err || 'unknown error');
  const line = message.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || 'unknown error';
  const detail = cause ? `${line} (${cause})` : line;
  return detail.length > 200 ? `${detail.slice(0, 197)}...` : detail;
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

function parseYouTubeId(value) {
  const input = String(value || '').trim();
  const match = input.match(YOUTUBE_URL_RE);
  if (match) return match[1];
  // Terima video ID mentah (11 karakter)
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
  return null;
}

function watchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function pickThumbnail(thumbnails) {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null;
  const sorted = [...thumbnails].sort((a, b) => (b?.width || 0) - (a?.width || 0));
  return sorted[0]?.url || null;
}

function assertPlayable(info) {
  const status = info?.playability_status?.status;
  if (status && status !== 'OK') {
    const reason = info.playability_status?.reason || status;
    throw new Error(`Video tidak bisa diputar: ${shortError(reason)}`);
  }
}

/**
 * Cari lagu via youtubei.js (URL YouTube maupun kata kunci).
 * Hasil kompatibel dengan struktur songInfo yang dipakai musicService.
 */
export async function searchNative(query) {
  const clean = String(query || '').trim();
  if (!clean) throw new Error('Judul lagu tidak boleh kosong.');

  const videoId = parseYouTubeId(clean);

  // Siapkan proxy otomatis lebih dulu. Pencarian tetap bisa berjalan langsung
  // jika belum ada proxy sehat, jadi hasilnya tidak diblokir oleh refresh.
  await ensureProxyReady();

  const yt = await getSearchClient();

  // Sesi streaming sengaja TIDAK dihangatkan di sini: membuat klien VISIONOS
  // sekarang berarti dua sesi Innertube aktif bersamaan (pencarian + streaming)
  // dan dua AST player script di memori. Klien streaming dibuat lazily oleh
  // openAudioSource() tepat sebelum lagu diputar.

  let video;

  if (videoId) {
    let info;
    try {
      info = await yt.getBasicInfo(videoId);
    } catch (err) {
      throw new Error(`Gagal mengambil info video: ${shortError(err)}`);
    }
    assertPlayable(info);

    const basic = info.basic_info || {};
    video = {
      id: basic.id || videoId,
      title: basic.title || 'Unknown',
      author: basic.author || basic.channel?.name || 'Unknown',
      duration: Number(basic.duration) || 0,
      isLive: Boolean(basic.is_live),
      thumbnail: pickThumbnail(basic.thumbnail),
    };
  } else {
    let results;
    try {
      results = await yt.search(clean, { type: 'video' });
    } catch (err) {
      throw new Error(`Pencarian YouTube gagal: ${shortError(err)}`);
    }

    const first = results.videos?.[0] || results.results?.find((item) => item.video_id);
    if (!first) throw new Error('Lagu tidak ditemukan.');

    video = {
      id: first.video_id,
      title: first.title?.toString() || 'Unknown',
      author: first.author?.name || 'Unknown',
      duration: Number(first.duration?.seconds) || 0,
      isLive: Boolean(first.is_live),
      thumbnail: first.best_thumbnail?.url || pickThumbnail(first.thumbnails),
    };
  }

  if (!video.id) throw new Error('Lagu tidak ditemukan.');
  if (video.isLive) {
    throw new Error(
      'Live stream belum didukung engine native (audio live dipecah per segmen). ' +
      'Gunakan engine Lavalink untuk siaran langsung.'
    );
  }

  const durationMs = video.duration > 0 ? Math.round(video.duration * 1000) : 0;
  const url = watchUrl(video.id);

  return {
    query: clean,
    native: true,
    track: {
      id: video.id,
      url,
      // Nilai ini hanya petunjuk; container sebenarnya ditentukan saat playback
      ext: 'webm',
      acodec: 'opus',
    },
    title: video.title,
    url,
    duration: durationMs > 0 ? formatDuration(durationMs) : 'N/A',
    durationMs,
    thumbnail: video.thumbnail || DEFAULT_BANNER,
    author: video.author || 'Unknown',
    isStream: false,
  };
}

/**
 * Buka stream audio langsung dari YouTube tanpa cookie.
 *
 * Klien WEB sekarang hanya memberi SABR (tanpa URL media langsung), jadi
 * streaming memakai klien VISIONOS / ANDROID_VR / WEB_REMIX yang masih memberi
 * URL media langsung. Jika satu klien kena rate-limit, bot-check, atau URL-nya
 * menolak Range, klien berikutnya dicoba. Beberapa host googlevideo juga bisa
 * tidak terjangkau, sehingga tiap format audio dicoba.
 */
async function openAudioSource(videoId, preferredClient = null) {
  const { ffmpeg } = detectNativeTools();
  const failures = [];
  let sawAudioFormats = false;
  let sawOpusFormat = false;

  await ensureProxyReady();
  const usingProxy = isProxyActive();

  // Batasi total waktu percobaan agar command musik tidak menggantung lama.
  // Proxy (terutama WARP) bisa lebih lambat saat koneksi pertama.
  const deadline = Date.now() + (usingProxy ? 25000 : 15000);

  const clientOrder = preferredClient
    ? [preferredClient, ...STREAM_CLIENTS.filter((c) => c !== preferredClient)]
    : STREAM_CLIENTS;

  for (const clientType of clientOrder) {
    if (Date.now() > deadline) break;
    let yt;
    try {
      yt = await getStreamClient(clientType);
    } catch (err) {
      failures.push(shortError(err));
      continue;
    }

    let info;
    try {
      info = await yt.getBasicInfo(videoId);
    } catch (err) {
      failures.push(`${clientType}: ${shortError(err)}`);
      continue;
    }

    const status = info.playability_status?.status;
    if (status && status !== 'OK') {
      const reason = info.playability_status?.reason || status;
      failures.push(`${clientType}: ${shortError(reason)}`);
      continue;
    }

    if (info.basic_info?.is_live) {
      throw new Error(
        'Live stream belum didukung engine native (audio live dipecah per segmen). ' +
        'Gunakan engine Lavalink untuk siaran langsung.'
      );
    }

    const formats = Array.from(info.streaming_data?.adaptive_formats || [])
      .filter((format) => format.has_audio && !format.has_video)
      .filter((format) => format.url || format.cipher || format.signature_cipher);

    if (formats.length === 0) {
      failures.push(`${clientType}: tidak ada format audio`);
      continue;
    }

    sawAudioFormats = true;
    if (formats.some((format) => OPUS_CONTAINERS[audioContainerFromMime(format.mime_type).ext])) {
      sawOpusFormat = true;
    }

    // Prioritas: Opus/WebM (bisa passthrough tanpa FFmpeg), lalu bitrate tertinggi.
    const score = (format) => {
      const { ext } = audioContainerFromMime(format.mime_type);
      const opusBonus = OPUS_CONTAINERS[ext] ? 1_000_000 : 0;
      return opusBonus + (format.bitrate || 0);
    };

    const candidates = formats
      .sort((a, b) => score(b) - score(a))
      // Tanpa FFmpeg, format non-Opus tidak bisa dikirim ke Discord
      .filter((format) => ffmpeg || OPUS_CONTAINERS[audioContainerFromMime(format.mime_type).ext])
      .slice(0, 6);

    for (const format of candidates) {
      if (Date.now() > deadline) break;
      let url = format.url;

      if (!url) {
        try {
          url = await format.decipher(yt.session.player);
        } catch (err) {
          failures.push(shortError(err));
          continue;
        }
      }

      if (!url) continue;

      const headers = {
        accept: '*/*',
        'user-agent': yt.session.context.client.userAgent || '',
      };

      // Koneksi ke host googlevideo kadang gagal sesaat (timeout/ECONNRESET),
      // jadi tiap URL dicoba dua kali sebelum pindah ke format berikutnya.
      for (let attempt = 0; attempt < 2; attempt++) {
        // Batasi hanya saat menunggu response headers; body tidak boleh di-abort
        // karena streaming bisa berjalan lebih lama dari timeout.
        const controller = new AbortController();
        const connectTimer = setTimeout(() => controller.abort(), usingProxy ? 25000 : 12000);

        let response;
        try {
          // YouTube menolak GET penuh (403) untuk URL adaptive; pakai Range kecil.
          response = await proxiedFetch(url, {
            headers: { ...headers, range: 'bytes=0-1023' },
            signal: controller.signal,
          });
        } catch (err) {
          failures.push(`${clientType}: ${shortError(err)}`);
          continue;
        } finally {
          clearTimeout(connectTimer);
        }

        if (!response.ok || !response.body) {
          // Body dari response gagal harus dibatalkan, kalau tidak undici menyimpan
          // buffer responsya sampai GC — ini ikut menyumbang memori saat retry.
          await response.body?.cancel().catch(() => {});
          if ([407, 502, 503, 504].includes(response.status)) {
            reportProxyFailure(getActiveProxyUrl());
          }
          failures.push(`${clientType}: HTTP ${response.status}`);
          break;
        }

        await response.body.cancel().catch(() => {});

        return {
          url,
          headers,
          ext: audioContainerFromMime(format.mime_type).ext,
          totalLength: Number(format.content_length) || 0,
          clientType,
        };
      }
    }
  }

  if (!ffmpeg && sawAudioFormats && !sawOpusFormat) {
    throw new Error(
      'Format Opus tidak tersedia untuk lagu ini dan FFmpeg tidak terpasang. ' +
      'Install FFmpeg atau gunakan engine Lavalink.'
    );
  }

  const lastFailure = failures[failures.length - 1];
  throw new Error(
    `Gagal memutar audio YouTube${lastFailure ? ` (${lastFailure})` : ''}. ` +
    'Jika ini terus terjadi, host googlevideo mungkin diblokir/DNS di-hijack — ' +
    'bot sudah mencoba proxy otomatis; set YOUTUBE_PROXY (proxy HTTP) untuk override, ' +
    'gunakan engine Lavalink, atau coba lagu lain.'
  );
}

// ============================================
// Streaming media bertahap (bounded Range)
// ============================================
// Sebagian URL adaptive menolak GET penuh (Range terbuka) atau Range yang
// terlalu besar dengan 403. Jadi media diambil per potongan 512 KiB secara
// berurutan lalu dirangkai menjadi satu Readable. Ini juga memberi batas
// memori yang jelas dan aman terhadap proxy yang membatasi ukuran response.
//
// Jika di tengah lagu server membalas 403 (URL kedaluwarsa / host berganti),
// URL media diambil ulang lewat callback `refresh` lalu potongan yang sama
// dicoba lagi dari offset yang sama.
// 256 KiB sudah cukup untuk menjaga throughput sekaligus membatasi memori puncak
// per potongan (dulu 512 KiB, yang berlipat ganda saat ada beberapa retry).
const MEDIA_CHUNK_SIZE = 256 * 1024;
const MEDIA_CHUNK_RETRIES = 3;
const MEDIA_MAX_REFRESH = 2;

// ============================================
// Pre-buffer audio (Anti-stutter di awal lagu)
// ============================================
// @discordjs/voice membaca frame secara real-time sejak player.play() dipanggil.
// Jika stream belum punya data (Range request pertama masih terbang lewat proxy),
// frame awal kosong/terlambat dan terdengar "tersendat" walaupun jaringan sehat.
// Buffer 1 MiB (= 4 potongan) membuat generator mengundang lebih awal, sedangkan
// PREBUFFER_BYTES memastikan minimal satu potongan penuh sudah tersedia SEBELUM
// player mulai membaca.
const MEDIA_STREAM_HIGH_WATER_MARK = 1024 * 1024;
const PREBUFFER_BYTES = MEDIA_CHUNK_SIZE;
const PREBUFFER_TIMEOUT_MS = 8000;

/**
 * Tunggu sampai stream memiliki minimal `minBytes` sebelum dipakai player.
 * Memakai mode paused + read(0) (tanpa mengonsumsi data) dan ticker berkala
 * karena Readable.from(async generator) hanya menarik data saat diminta.
 * Selesai lebih awal bila stream error/end/close atau timeout (fallback aman).
 */
function prebufferStream(stream, minBytes = PREBUFFER_BYTES, timeoutMs = PREBUFFER_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    let ticker;
    let timer;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearInterval(ticker);
      clearTimeout(timer);
      stream.off('readable', check);
      stream.off('error', finish);
      stream.off('end', finish);
      stream.off('close', finish);
      resolve();
    };

    const check = () => {
      if (!settled && stream.readableLength >= minBytes) finish();
    };

    stream.on('readable', check);
    stream.once('error', finish);
    stream.once('end', finish);
    stream.once('close', finish);

    // read(0) memicu _read() tanpa membuang byte, jadi seluruh data tetap utuh
    // untuk demuxer/FFmpeg setelah pre-buffer selesai.
    ticker = setInterval(() => {
      stream.read(0);
      check();
    }, 25);
    timer = setTimeout(finish, timeoutMs);

    stream.read(0);
    check();
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ambil total ukuran file dari header Content-Range ("bytes 0-1/12345"). */
function totalFromContentRange(value) {
  const match = /\/(\d+)\s*$/.exec(String(value || ''));
  return match ? Number(match[1]) : 0;
}

/**
 * Generator potongan media. Berhenti saat total tercapai, potongan lebih pendek
 * dari yang diminta (akhir file), HTTP 416, atau stream di-destroy.
 */
async function* readMediaChunks({ url, headers, totalLength }, controller, refresh) {
  const usingProxy = isProxyActive();
  const headerTimeout = usingProxy ? 25000 : 12000;

  let source = {
    url,
    headers,
    totalLength: Number(totalLength) || 0,
  };
  let offset = 0;
  let emptyChunks = 0;
  let refreshCount = 0;

  try {
    while (!controller.signal.aborted) {
      const total = source.totalLength;
      if (total > 0 && offset >= total) return;

      const start = offset;
      const end = total > 0
        ? Math.min(start + MEDIA_CHUNK_SIZE, total) - 1
        : start + MEDIA_CHUNK_SIZE - 1;
      const expected = end - start + 1;

      let response = null;
      let lastError = null;

      for (let attempt = 1; attempt <= MEDIA_CHUNK_RETRIES; attempt++) {
        if (controller.signal.aborted) return;

        // Timeout hanya membatasi waktu tunggu response headers; body bisa
        // mengalir lebih lama tanpa diputus.
        const attemptController = new AbortController();
        const onAbort = () => attemptController.abort();
        controller.signal.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => attemptController.abort(), headerTimeout);

        try {
          response = await proxiedFetch(source.url, {
            headers: { ...source.headers, range: `bytes=${start}-${end}` },
            signal: attemptController.signal,
          });
          lastError = null;
        } catch (err) {
          response = null;
          lastError = err;
          if (controller.signal.aborted) return;
          if (attempt < MEDIA_CHUNK_RETRIES) await delay(300 * attempt);
        } finally {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', onAbort);
        }

        if (response) break;
      }

      if (!response) {
        throw new Error(`Gagal mengunduh audio (${shortError(lastError)})`);
      }

      // Range melewati akhir file -> selesai.
      if (response.status === 416) {
        await response.body?.cancel().catch(() => {});
        return;
      }

      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => {});

        // Status khas proxy bermasalah: cari proxy pengganti di background.
        if ([407, 502, 503, 504].includes(response.status)) {
          reportProxyFailure(getActiveProxyUrl());
        }

        // 403 biasanya berarti URL media sudah tidak berlaku. Ambil URL baru.
        if (response.status === 403 && typeof refresh === 'function' && refreshCount < MEDIA_MAX_REFRESH) {
          refreshCount += 1;
          const fresh = await Promise.resolve()
            .then(() => refresh())
            .catch(() => null);
          if (fresh?.url) {
            source = {
              url: fresh.url,
              headers: fresh.headers || source.headers,
              totalLength: Number(fresh.totalLength) || source.totalLength,
            };
            continue;
          }
        }

        throw new Error(`Gagal mengunduh audio (HTTP ${response.status})`);
      }

      if (!source.totalLength) {
        source.totalLength = totalFromContentRange(response.headers.get('content-range'));
      }
      const servedFromStart = response.status === 200 && start > 0;

      let reader = null;
      let produced = 0;
      try {
        reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (controller.signal.aborted) return;
          if (!value || !value.byteLength) continue;
          produced += value.byteLength;
          yield Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        }
      } finally {
        try { await reader?.cancel(); } catch { /* abaikan */ }
      }

      // Server mengabaikan Range dan mengirim ulang dari awal: jangan lanjut,
      // karena data akan terduplikasi.
      if (servedFromStart) return;

      if (produced === 0) {
        emptyChunks += 1;
        if (emptyChunks >= 2) return;
      } else {
        emptyChunks = 0;
        refreshCount = 0;
      }

      offset += produced;

      if (source.totalLength > 0 && offset >= source.totalLength) return;
      // Potongan lebih pendek dari yang diminta -> sudah akhir file.
      if (produced < expected) return;
    }
  } finally {
    // Pastikan request yang masih berjalan ikut dibatalkan saat stream ditutup.
    controller.abort();
  }
}

/**
 * Buat Readable audio dari URL googlevideo memakai potongan Range berurutan.
 * destroy() pada stream langsung membatalkan request yang sedang berjalan.
 */
function createMediaStream({ url, headers, totalLength, refresh }) {
  const controller = new AbortController();
  const stream = Readable.from(
    readMediaChunks({ url, headers, totalLength }, controller, refresh),
    { objectMode: false, highWaterMark: MEDIA_STREAM_HIGH_WATER_MARK }
  );

  const originalDestroy = stream.destroy.bind(stream);
  stream.destroy = (err) => {
    controller.abort();
    return originalDestroy(err);
  };
  stream.once('close', () => controller.abort());

  return stream;
}

function audioContainerFromMime(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('webm')) return { ext: 'webm', codec: mime.includes('opus') ? 'opus' : '' };
  if (mime.includes('ogg')) return { ext: 'ogg', codec: mime.includes('opus') ? 'opus' : '' };
  if (mime.includes('mp4') || mime.includes('m4a')) return { ext: 'm4a', codec: 'mp4a' };
  return { ext: '', codec: '' };
}

/**
 * Siapkan stream audio untuk satu lagu (unduh langsung dari URL YouTube).
 */
async function createNativeStream(song) {
  const { ffmpeg, ffmpegPath } = detectNativeTools();

  const videoId = song?.track?.id;
  if (!videoId) throw new Error('ID audio tidak valid.');

  const { url, headers, ext, totalLength, clientType } = await openAudioSource(videoId);
  const state = { stderr: '' };

  const input = createMediaStream({
    url,
    headers,
    totalLength,
    // URL media bisa kedaluwarsa saat lagu panjang; minta URL baru dari klien
    // yang sama supaya potongan berikutnya tetap bisa diunduh.
    refresh: () => openAudioSource(videoId, clientType),
  });
  input.on('error', (err) => {
    state.stderr = `${state.stderr}\n${err.message}`.slice(-800);
  });

  // Pastikan audio sudah terisi sebelum FFmpeg/demuxer mulai membaca. Ini yang
  // menghilangkan "tersendat" pada detik pertama lagu (bukan masalah jaringan).
  await prebufferStream(input);

  if (ffmpeg) {
    // Jalur PCM: volume realtime bisa diterapkan lewat inlineVolume
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
    ff.stderr?.on('data', (chunk) => {
      state.stderr = (state.stderr + chunk).slice(-800);
    });
    ff.stderr?.on('error', () => {});
    ff.on('error', (err) => {
      state.stderr = `${state.stderr}\n${err.message}`.slice(-800);
    });

    if (!ff.stdout || !ff.stdin) {
      input.destroy();
      throw new Error('FFmpeg gagal dijalankan (stdin/stdout tidak tersedia).');
    }

    input.pipe(ff.stdin);

    return {
      type: StreamType.Raw,
      stream: ff.stdout,
      children: [input, ff],
      inlineVolume: true,
      primary: ff,
      state,
    };
  }

  // Jalur Opus passthrough (tanpa FFmpeg): tidak ada decode/encode sama sekali
  const inputType = OPUS_CONTAINERS[ext];

  if (!inputType) {
    input.destroy();
    throw new Error(
      `Sumber audio berformat "${ext || 'unknown'}" membutuhkan FFmpeg. ` +
      'Install FFmpeg, atau gunakan engine Lavalink untuk lagu ini.'
    );
  }

  return {
    type: inputType,
    stream: input,
    children: [input],
    inlineVolume: false,
    primary: input,
    state,
  };
}

function closeHandle(handle) {
  try {
    if (typeof handle?.kill === 'function') handle.kill('SIGKILL');
    else if (typeof handle?.destroy === 'function') handle.destroy();
  } catch { /* sudah selesai */ }
}

function cleanupStream(session) {
  for (const handle of session.children || []) closeHandle(handle);
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
export async function playNativeTrack(queue, song) {
  const session = queue.native;
  if (!session) throw new Error('Sesi voice native belum siap.');

  const { type, stream, children, inlineVolume, primary, state } = await createNativeStream(song);

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

  // Resolve saat byte pertama mengalir, atau reject dengan alasan dari YouTube/FFmpeg.
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.removeListener('data', onData);
      stream.removeListener('error', onError);
      primary?.removeListener?.('close', onClose);
      if (err) reject(err);
      else resolve();
    };

    const onData = () => finish(null);

    const onError = (err) => finish(err);

    const onClose = (code) => {
      if (code === 0 || code === null || code === undefined) return;
      const reason = (state.stderr || '').trim().split(/\r?\n/).filter(Boolean).pop();
      finish(new Error(reason || `Proses audio berhenti tanpa output (exit ${code})`));
    };

    // Timeout: proses masih hidup tapi lambat, biarkan pemutaran berjalan.
    // Diperpendek dari 15s supaya user tidak menatap status "thinking" terlalu lama.
    const timer = setTimeout(() => finish(null), 8000);

    stream.once('data', onData);
    stream.once('error', onError);
    if (primary && primary !== stream && typeof primary.once === 'function') {
      primary.once('close', onClose);
    }
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
