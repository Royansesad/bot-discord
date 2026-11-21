// ============================================
// musicService.js - Advanced Music Engine (Shoukaku / Lavalink)
// Features: Realtime Progress Bar, Fixed Player Message, Spotify Pre-buffer,
// Track Pre-fetching, Multi-Node Failover, & Interactive Remote Control UI.
// ============================================
import discordJsPkg from 'discord.js';
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = discordJsPkg;
import { Shoukaku, Connectors } from 'shoukaku';
import config from '../config.js';
import { logError } from '../utils/errorManager.js';
import {
  getAllNodes,
  formatForShoukaku,
  startNodeAutoUpdater,
  isNodeDisabled,
  getNodePriorityRank,
  getNodeEngine,
} from './lavalinkNodes.js';
import * as native from './nativeEngine.js';

// Batas waktu pencarian. Sebelumnya node.rest.resolve() memakai restTimeout 20 detik
// dan mencoba 5 prefix x semua node secara berurutan — itulah sebabnya status
// "Bot is thinking..." bertahan lama walaupun bot sudah masuk voice channel.
const SEARCH_REQUEST_TIMEOUT = 7000;
const SEARCH_TOTAL_TIMEOUT = 14000;

// Shoukaku menganggap voice "CONNECTED" begitu Discord mengirim SESSION_READY,
// tetapi handshake UDP/DAVE (enkripsi voice) belum selesai. Frame pertama yang
// dikirim terlalu cepat bisa hilang/terpotong → tersendat di awal lagu.
// Jeda singkat ini memberi waktu koneksi stabil sebelum playTrack dipanggil.
const VOICE_SETTLE_MS = 400;

// Lavalink (khususnya node publik) mulai mengirim frame ke Discord segera setelah
// playTrack, padahal buffer audio di server node belum terisi → detik pertama
// tersendat dan indikator speaking berkedip. Triknya: start dalam keadaan paused,
// beri waktu node mengisi buffer, lalu unpause. Bisa diubah lewat env.
const LAVALINK_WARMUP_MS = Math.max(0, Number(process.env.LAVALINK_WARMUP_MS) || 1500);

// Watchdog pemutaran. Lavalink v4 berhenti mengirim playerUpdate saat track
// selesai, sehingga posisi terakhir membeku rata-rata di (durasi - interval
// update). Watchdog durasi memakai anchor monotonik yang tidak direcalibrate,
// dan watchdog posisi membeku menangani lagu yang berhenti sebelum durasi.
const WATCHDOG_GRACE_MS = 5000;
const WATCHDOG_STALL_MS = 45000;
// Failover yang menggantung tidak boleh memblokir antrean selamanya.
const FAILOVER_TIMEOUT_MS = 45000;

/**
 * Putar track encoded dengan warm-up buffer: playTrack(paused) → tunggu → unpause.
 * Dipakai oleh jalur play normal maupun reconnect/failover supaya perilakunya sama.
 */
async function playEncodedTrack(player, encoded, position = 0, stayPaused = false) {
  await player.playTrack({ track: { encoded }, position, paused: true });

  if (LAVALINK_WARMUP_MS > 0) {
    await new Promise((resolve) => setTimeout(resolve, LAVALINK_WARMUP_MS));
  }

  if (!stayPaused) {
    try {
      await player.setPaused(false);
    } catch (err) {
      // Node bisa restart saat warm-up. Coba sekali lewat update; kalau tetap
      // gagal, handler exception/failover yang akan menangani.
      try { await player.update({ paused: false }); } catch { /* abaikan */ }
    }
  }
}

function withTimeout(promise, ms, label) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/** Beri feedback instan setelah deferReply supaya indikator "thinking" langsung hilang. */
async function sendPreparingReply(interaction) {
  // Dashboard search memakai fake interaction yang editReply()-nya mengirim
  // pesan baru ke channel — jangan tambahkan pesan "preparing" duplikat.
  if (interaction.isDashboardSearch) return;
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(config.colors.info)
        .setTitle('⏳ Menyiapkan Musik...')
        .setDescription('Mencari lagu dan menghubungkan ke voice channel. Mohon tunggu sebentar...')],
      components: [],
    }).catch(() => {});
  }
}

let shoukaku = null;
const queues = new Map();
let activeEngine = 'lavalink'; // 'lavalink' | 'native'

// PENTING: Shoukaku.joinVoiceChannel() TIDAK membaca opsi `nodeName`. Ia selalu
// memanggil nodeResolver default (node dengan penalties terendah), sehingga
// failover/rollover terus kembali ke node yang SAMA. Kita pasang resolver kustom
// dan menentukan node tujuan lewat override per-guild sebelum join.
const nodeSelectionOverride = new Map(); // guildId -> nodeName

function resolveShoukakuNode(nodes, connection) {
  const guildId = connection?.guildId;
  const forced = guildId ? nodeSelectionOverride.get(guildId) : null;
  if (forced) {
    const target = nodes.get(forced);
    if (target?.state === 1) return target;
  }

  // Fallback seperti resolver bawaan Shoukaku.
  const connected = [...nodes.values()].filter((n) => n.state === 1);
  return connected.sort((a, b) => (a.penalties || 0) - (b.penalties || 0))[0] || null;
}

// Engine yang memakai server audio eksternal (Shoukaku)
export const SHOUKAKU_ENGINES = ['lavalink'];
export const VALID_ENGINES = ['lavalink', 'native'];

export function getActiveEngine() {
  return activeEngine;
}

export function isNativeEngine() {
  return activeEngine === 'native';
}

export function setActiveEngine(engine) {
  const next = String(engine || '').toLowerCase();

  if (!VALID_ENGINES.includes(next)) {
    throw new Error(`Engine tidak valid. Pilih antara: ${VALID_ENGINES.join(', ')}`);
  }

  if (next === 'native' && !native.isNativeAvailable()) {
    throw new Error(
      'Engine native tidak bisa dipakai: paket youtubei.js gagal dimuat. ' +
      'Jalankan "npm install" lalu restart bot.'
    );
  }

  activeEngine = next;
  return activeEngine;
}

// Default music banner image
const DEFAULT_BANNER = "https://i.postimg.cc/7Z52mQ0K/Amba-Music.png";

/**
 * Inisialisasi Shoukaku
 */
export async function initializeShoukaku(client) {
  // Database (Neon) bisa sedang bangun dari idle saat bot start sehingga query
  // pertama gagal. Coba beberapa kali sebelum menyimpulkan node tidak tersedia,
  // agar fitur musik tidak mati permanen hanya karena cold start.
  let rawNodes = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      rawNodes = await getAllNodes(client.prisma);
    } catch (err) {
      rawNodes = [];
      logError(`Lavalink Node Load (percobaan ${attempt}/3)`, err);
    }

    if (rawNodes.length > 0) break;
    if (attempt < 3) {
      console.warn(`⚠️ Belum ada node Lavalink yang terbaca (percobaan ${attempt}/3), mencoba lagi...`);
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
  }

  const nodes = formatForShoukaku(rawNodes);

  if (nodes.length === 0) {
    console.error('❌ Tidak ada Lavalink node yang tersedia! Fitur musik tidak akan berfungsi.');
    return null;
  }

  console.log('🎵 Menginisialisasi Shoukaku dengan nodes & multi-node failover:');
  for (const n of nodes) {
    console.log(`   → [${(n.priority || 'secondary').toUpperCase()}] ${n.name} (${n.url})`);
  }

  shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
    moveOnDisconnect: true,
    resume: true,
    resumeTimeout: 60,
    reconnectTries: 3,        // Dikurangi dari 10 → 3 agar tidak spam reconnect
    reconnectInterval: 15,    // Dikurangi dari 3 → 15 detik antar retry
    restTimeout: 8000,
    // CATATAN: `frameBufferDurationMs` BUKAN opsi Shoukaku v4 (diabaikan),
    // jadi tidak ada pre-buffer nyata dari sisi bot. Anti-stutter ditangani
    // lewat VOICE_SETTLE_MS di joinVoiceChannelWithFallback() dan pre-buffer
    // stream pada engine native. Buffer Lavalink sendiri diatur di node server.
    voiceConnectionTimeout: 15,
    // Resolver kustom agar node yang dipilih saat join benar-benar mengikuti
    // hasil getIdealNodes() (termasuk excludeNodeName saat failover).
    nodeResolver: resolveShoukakuNode,
  });

  shoukaku.on('ready', (name, reconnected) => {
    if (isNodeDisabled(name)) {
      try { shoukaku.nodes.delete(name); } catch (e) {}
      return;
    }
    console.log(`🟢 Lavalink Node "${name}" ${reconnected ? 'reconnected' : 'connected'}!`);
  });

  shoukaku.on('error', (name, error) => {
    if (isNodeDisabled(name)) return;
    logError(`Lavalink Node "${name}"`, error);
  });

  shoukaku.on('close', (name, code, reason) => {
    if (isNodeDisabled(name)) {
      try { shoukaku.nodes.delete(name); } catch (e) {}
      return;
    }
    console.log(`🔴 Lavalink Node "${name}" closed (code: ${code}, reason: ${reason || 'none'})`);

    // Jika node ditolak karena rate-limit (code 4000 = 'Too many websocket connections'),
    // hapus node dari Shoukaku agar tidak reconnect otomatis terus-menerus
    if (code === 4000 || (reason && reason.includes('Too many'))) {
      console.warn(`🚫 Node "${name}" rate-limited, menghapus dari pool untuk mencegah spam reconnect.`);
      try {
        shoukaku.removeNode(name);
      } catch (e) {
        try { shoukaku.nodes.delete(name); } catch (e2) {}
      }
    }
  });

  shoukaku.on('disconnect', (name, players, moved) => {
    if (isNodeDisabled(name)) {
      try { shoukaku.nodes.delete(name); } catch (e) {}
      return;
    }
    console.warn(`⚠️ Lavalink Node "${name}" disconnected (${players.length} player(s) terdampak, moved: ${moved})`);
    if (!moved) {
      for (const player of players) {
        handleNodeFailover(player.guildId, `Node ${name} terputus`).catch(err => {
          logError('Failover Trigger Error', err);
        });
      }
    }
  });

  client.shoukaku = shoukaku;
  startNodeAutoUpdater(shoukaku, client.prisma);
  return shoukaku;
}

export function getShoukaku() {
  return shoukaku;
}

/**
 * Mendapatkan node terhubung berprioritas tertinggi sesuai Active Engine (Lavalink)
 * Jika excludeNodeName diberikan, menyaring node yang sedang error dan switch ke node cadangan aktif lain
 */
// Map penalti internal bot per node untuk menaikkan/menurunkan skor prioritas tanpa mengubah read-only property Shoukaku
const customNodePenalties = new Map();

function getNodePenalty(node) {
  if (!node) return 0;
  const base = typeof node.penalties === 'number' ? node.penalties : 0;
  const extra = customNodePenalties.get(node.name) || 0;
  return base + extra;
}

function addNodePenalty(node, score = 5) {
  if (!node || !node.name) return;
  const current = customNodePenalties.get(node.name) || 0;
  customNodePenalties.set(node.name, current + score);
}

function reduceNodePenalty(node) {
  if (!node || !node.name) return;
  const current = customNodePenalties.get(node.name) || 0;
  if (current > 0) {
    customNodePenalties.set(node.name, Math.max(0, current - 1));
  }
}

/**
 * Mendapatkan daftar semua node terhubung yang diurutkan berdasarkan kualitas (priority & penalties).
 */
function getIdealNodes(excludeNodeName = null) {
  if (!shoukaku) return [];

  const connected = [...shoukaku.nodes.values()].filter(n => n.state === 1);
  if (connected.length === 0) return [];

  // Saring berdasarkan active engine (metadata dari registry: Shoukaku tidak menyimpan options)
  let candidateNodes = connected.filter(n => getNodeEngine(n.name) === activeEngine);

  if (excludeNodeName) {
    candidateNodes = candidateNodes.filter(n => n.name !== excludeNodeName);
  }

  // Fallback ke semua node terhubung jika engine yang dipilih tidak ada kandidat
  if (candidateNodes.length === 0) {
    candidateNodes = excludeNodeName
      ? connected.filter(n => n.name !== excludeNodeName)
      : connected;
  }

  return candidateNodes.sort((a, b) => {
    const pA = getNodePriorityRank(a.name);
    const pB = getNodePriorityRank(b.name);

    if (pA !== pB) return pA - pB;

    const penaltyDiff = getNodePenalty(a) - getNodePenalty(b);
    if (penaltyDiff !== 0) return penaltyDiff;

    // Terakhir, gunakan beban node dari statistik Lavalink
    return (a.penalties || 0) - (b.penalties || 0);
  });
}

/**
 * Mendapatkan node terhubung berprioritas tertinggi sesuai Active Engine (Lavalink)
 * Jika excludeNodeName diberikan, menyaring node yang sedang error dan switch ke node cadangan aktif lain
 */
function getIdealNode(excludeNodeName = null) {
  const candidateNodes = getIdealNodes(excludeNodeName);
  return candidateNodes.length > 0 ? candidateNodes[0] : null;
}

/**
 * Join Voice Channel dengan Multi-Node Failover otomatis.
 * Mencoba semua node terhubung secara berurutan sampai berhasil.
 */
async function joinVoiceChannelWithFallback({ guildId, channelId, shardId = 0, deaf = true }, excludeNodeName = null) {
  const candidateNodes = getIdealNodes(excludeNodeName);
  if (candidateNodes.length === 0) {
    throw new Error('Tidak ada node Lavalink yang terhubung!');
  }

  let lastError = null;

  for (const node of candidateNodes) {
    // Shoukaku mengabaikan `nodeName`, jadi arahkan resolver sebelum join ke node
    // yang sedang dicoba. Tanpa ini semua percobaan jatuh ke node yang sama.
    nodeSelectionOverride.set(guildId, node.name);

    try {
      const player = await shoukaku.joinVoiceChannel({
        guildId,
        channelId,
        shardId,
        deaf,
      });

      // Pastikan player benar-benar berada di node yang diminta.
      if (player.node?.name !== node.name) {
        throw new Error(`Node resolver memilih ${player.node?.name}, bukan ${node.name}`);
      }

      // Tunggu voice connection benar-benar stabil sebelum frame pertama dikirim.
      // Tanpa ini, beberapa frame awal sering hilang dan terdengar tersendat.
      if (shoukaku.connections.get(guildId)?.state !== 1) {
        for (let i = 0; i < 20; i++) {
          if (shoukaku.connections.get(guildId)?.state === 1) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      await new Promise((resolve) => setTimeout(resolve, VOICE_SETTLE_MS));

      return player;
    } catch (err) {
      console.warn(`⚠️ Gagal join Voice Channel via node "${node.name}": ${err.message}. Mencoba node cadangan lain...`);
      addNodePenalty(node, 10);
      lastError = err;

      // Bersihkan koneksi/player yang setengah jadi sebelum coba node berikutnya.
      try { await shoukaku.leaveVoiceChannel(guildId); } catch { /* abaikan */ }
      shoukaku.connections.delete(guildId);
      shoukaku.players.delete(guildId);
    } finally {
      nodeSelectionOverride.delete(guildId);
    }
  }

  throw new Error(`Gagal join Voice Channel di semua node: ${lastError?.message || 'Connection Refused'}`);
}

/**
 * Deteksi error sesi Lavalink yang sudah tidak valid (node restart / session
 * expired). Error seperti "Session not found" membuat semua update player
 * (volume/pause/skip) gagal sampai player dibuat ulang.
 */
function isSessionError(error) {
  const message = String(error?.message || error?.error || error || '').toLowerCase();
  return (
    message.includes('session not found') ||
    message.includes('session does not exist') ||
    message.includes('session is not valid') ||
    message.includes('unknown session') ||
    message.includes('invalid session') ||
    message.includes('player not found') ||
    message.includes('the player was not found')
  );
}

/**
 * Buat ulang koneksi Shoukaku untuk guild (player + voice connection).
 * Dipakai saat sesi node mati / "Session not found". Bila resume=true, lagu
 * yang sedang diputar dipulihkan pada posisi terakhir di node baru.
 */
async function reconnectShoukakuPlayer(guildId, { resume = false, excludeNodeName = null } = {}) {
  const queue = queues.get(guildId);
  if (!queue || !shoukaku) return null;
  if (!queue.voiceChannel?.id) throw new Error('Voice channel antrean tidak diketahui.');

  const song = queue.currentlyPlaying;
  const position = Math.max(0, Math.floor(queue.player?.position || 0));
  const wasPaused = Boolean(queue.isPaused);

  // Bersihkan koneksi lama dengan aman sebelum join ulang.
  try { queue.player?.removeAllListeners(); } catch { /* abaikan */ }
  try { await shoukaku.leaveVoiceChannel(guildId); } catch { /* belum ada koneksi */ }
  shoukaku.connections?.delete(guildId);
  shoukaku.players?.delete(guildId);

  // Beri waktu Discord meng-update voice state.
  await new Promise((resolve) => setTimeout(resolve, 500));

  const player = await joinVoiceChannelWithFallback({
    guildId,
    channelId: queue.voiceChannel.id,
    shardId: 0,
    deaf: true,
  }, excludeNodeName);

  queue.player = player;
  queue.backend = 'shoukaku';
  queue._failoverInProgress = false;
  queue._skipRequested = false;
  attachPlayerEvents(player, guildId);
  await player.setGlobalVolume(queue.volume).catch(() => {});

  if (resume && song) {
    const originalQuery = song.query || song.url || song.title;
    let encoded = null;

    if (originalQuery) {
      try {
        const fresh = await searchTrack(originalQuery, player.node);
        if (fresh?.track) {
          encoded = extractEncodedTrack(fresh.track);
          song.track = fresh.track;
        }
      } catch (err) {
        console.warn(`⚠️ Re-resolve saat reconnect gagal: ${err.message}`);
      }
    }

    if (!encoded) encoded = extractEncodedTrack(song.track);
    if (encoded) {
      await playEncodedTrack(player, encoded, position, wasPaused);

      // Lagu dilanjutkan dari `position`, jadi anchor watchdog harus
      // mengakui posisi tersebut — kalau tidak, watchdog akan menembak
      // lagu ini sebagai "sudah selesai" tepat setelah failover.
      const resumeAnchor = Date.now() - position - (song.pausedDuration || 0);
      song.startedAt = resumeAnchor;
      song.watchdogAnchor = resumeAnchor;
      song._lastReportedPos = null;
      song._lastReportedAt = 0;
    }
  }

  return player;
}

/**
 * Failover handler yang robust - menangani 3 kasus error utama:
 * 1. Track error (YouTube extraction gagal) → re-resolve di node lain
 * 2. Node disconnect / session mati → pindah ke node cadangan
 * 3. Voice connection timeout → reuse existing connection
 * 
 * Proteksi: failover flag mencegah infinite loop
 */
async function handleNodeFailover(guildId, reason = 'Node Error') {
  const queue = queues.get(guildId);
  if (!queue || !queue.currentlyPlaying) return;

  // === PROTEKSI INFINITE FAILOVER LOOP ===
  if (queue._failoverInProgress) {
    console.warn(`⚠️ Failover sudah berjalan untuk guild ${guildId}, skip.`);
    return;
  }
  queue._failoverRetries = (queue._failoverRetries || 0) + 1;
  if (queue._failoverRetries > 3) {
    console.error(`❌ Failover sudah 3x gagal untuk guild ${guildId}, berhenti.`);
    if (queue.textChannel) {
      queue.textChannel.send('❌ Pemutaran gagal setelah 3x percobaan failover. Silakan coba lagu lain.').catch(() => {});
    }
    queue._failoverRetries = 0;
    stopMusic(guildId);
    return;
  }
  queue._failoverInProgress = true;
  queue._failoverStartedAt = Date.now();

  const currentPos = queue.player?.position || 0;
  const currentNodeName = queue.player?.node?.name;

  const displayReason = (reason && typeof reason === 'string' && reason.trim())
    ? reason
    : 'Playback Stream Exception';

  if (queue.textChannel) {
    queue.textChannel.send(
      `⚠️ **Node Failover** (percobaan ${queue._failoverRetries}/3): ${displayReason}`
    ).catch(() => {});
  }

  // Cari node cadangan (exclude node yang error)
  const newNode = getIdealNode(currentNodeName);
  if (!newNode) {
    if (queue.textChannel) {
      queue.textChannel.send('❌ Tidak ada node cadangan yang tersedia. Pemutaran dihentikan.').catch(() => {});
    }
    queue._failoverInProgress = false;
    queue._failoverRetries = 0;
    stopMusic(guildId);
    return;
  }

  try {
    // Pindahkan koneksi + putar ulang lagu yang sama di node cadangan.
    // Helper ini juga menangani encoded track yang tidak kompatibel antar node
    // dengan me-resolve ulang query asli.
    const newPlayer = await reconnectShoukakuPlayer(guildId, {
      resume: true,
      excludeNodeName: currentNodeName,
    });

    if (!newPlayer) {
      throw new Error('Tidak dapat membuat player pengganti.');
    }

    // === SUCCESS: reset failover counters ===
    queue._failoverRetries = 0;
    queue._failoverInProgress = false;

    if (queue.textChannel) {
      queue.textChannel.send(
        `✅ **Failover Berhasil**: Dilanjutkan di Node **${newPlayer.node?.name || newNode.name}** pada **${formatDuration(currentPos)}**!`
      ).catch(() => {});
    }

    await updatePlayerMessage(guildId);
  } catch (err) {
    logError('Failover Rejoin Error', err);
    queue._failoverInProgress = false;

    // Jika masih ada retry tersisa, coba lagi
    if (queue._failoverRetries < 3) {
      console.log(`🔄 Retry failover (${queue._failoverRetries}/3)...`);
      setTimeout(() => handleNodeFailover(guildId, `Retry: ${err.message}`), 2000);
    } else {
      if (queue.textChannel) {
        queue.textChannel.send('❌ Failover gagal total. Pemutaran dihentikan.').catch(() => {});
      }
      queue._failoverRetries = 0;
      stopMusic(guildId);
    }
  }
}

/**
 * Memastikan player Shoukaku aktif dan terhubung untuk guild.
 * Jika player hilang/dead (misal karena node restart/disconnect/"Session not
 * found"), buat ulang player secara otomatis ke voice channel queue.
 *
 * `resume` dipakai command kontrol (volume/pause/resume) agar lagu yang sedang
 * berjalan dipulihkan pada posisi terakhir setelah player dibuat ulang.
 */
export async function ensureActivePlayer(guildId, { resume = false } = {}) {
  const queue = queues.get(guildId);
  if (!queue || !shoukaku) return null;

  // Engine native tidak memakai player Shoukaku
  if (queue.backend === 'native') return null;

  const activePlayer = shoukaku.players.get(guildId);
  const connection = shoukaku.connections.get(guildId);

  // CATATAN: Player Shoukaku tidak punya properti `connection`. Status voice ada di
  // shoukaku.connections (state 1 = CONNECTED). Sebelumnya pengecekan ini selalu gagal
  // sehingga setiap perintah (pause/volume/skip) memaksa re-join dan memutus playback.
  const connectedToSameChannel =
    !queue.voiceChannel?.id ||
    !connection?.channelId ||
    connection.channelId === queue.voiceChannel.id;

  if (
    activePlayer &&
    queue.player === activePlayer &&
    activePlayer.node?.state === 1 &&
    connection?.state === 1 &&
    connectedToSameChannel
  ) {
    return activePlayer;
  }

  console.warn(`⚠️ Player untuk guild ${guildId} tidak ditemukan/mati di Shoukaku, menghubungkan ulang...`);

  try {
    return await reconnectShoukakuPlayer(guildId, { resume: resume && Boolean(queue.currentlyPlaying) });
  } catch (err) {
    console.error(`❌ Gagal menghubungkan ulang player untuk guild ${guildId}:`, err.message);
    throw new Error(`Player tidak ditemukan & gagal terhubung kembali ke Voice Channel: ${err.message}`);
  }
}

// ============================================
// Queue helpers (dipakai engine Shoukaku & native)
// ============================================
function createQueue(guildId, voiceChannel, textChannel, backend = 'shoukaku') {
  return {
    guildId,
    voiceChannel,
    textChannel,
    backend,
    player: null,
    native: null,
    songs: [],
    currentlyPlaying: null,
    isPaused: false,
    loopMode: 'off',
    volume: 80,
    lastPlayerMessage: null,
    disconnectTimeout: null,
    progressInterval: null,
    _failoverRetries: 0,
    _failoverInProgress: false,
    _failoverStartedAt: 0,
    _skipRequested: false,
  };
}

function prepareSong(queue, song) {
  song.startedAt = Date.now();
  song.pausedDuration = 0;
  song.pausedAt = null;
  // Reset posisi render supaya progress bar tidak "nyangkut" di akhir saat loop
  song.lastRenderedPos = 0;
  // Anchor monotonik untuk watchdog. TIDAK pernah di-recalibrate oleh
  // buildPlayerPayload: posisi node v4 membeku saat lagu selesai (node
  // membatalkan playerUpdate), jadi recalibration berbasis posisi akan
  // menarik anchor ini mundur dan membuat watchdog tidak pernah terpenuhi.
  song.watchdogAnchor = Date.now();
  song._lastReportedPos = null;
  song._lastReportedAt = 0;
  // Catatan: `prefetchedTrack` JANGAN dihapus di sini — prefetch sudah dilakukan
  // saat lagu masuk antrean dan dipakai langsung oleh playShoukakuSong.
}

function clearDisconnectTimeout(queue) {
  if (queue.disconnectTimeout) {
    clearTimeout(queue.disconnectTimeout);
    queue.disconnectTimeout = null;
  }
}

function safeHttpUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return value;
    return null;
  } catch {
    return null;
  }
}

function getReportedPosition(queue) {
  if (queue.backend === 'native') return native.getNativePosition(queue);
  return queue.player?.position || 0;
}

/**
 * Majukan antrean: terapkan loop, lalu muat lagu berikutnya.
 */
function advanceQueue(guildId, { allowLoop = true } = {}) {
  const queue = queues.get(guildId);
  if (!queue) return;

  const current = queue.currentlyPlaying;
  if (allowLoop && current) {
    if (queue.loopMode === 'track') queue.songs.unshift(current);
    else if (queue.loopMode === 'queue') queue.songs.push(current);
  }

  queue.currentlyPlaying = null;
  queue.isPaused = false;
  queue._failoverRetries = 0;
  queue._failoverInProgress = false;

  processQueue(guildId);
}

/**
 * Antrean kosong: bersihkan timer progres & jadwalkan auto-disconnect.
 */
function handleEmptyQueue(queue) {
  queue.currentlyPlaying = null;
  queue.isPaused = false;

  if (queue.progressInterval) {
    clearInterval(queue.progressInterval);
    queue.progressInterval = null;
  }

  // Bug fix: skip lagu terakhir dulu membuat lagu mati tetapi control panel
  // tetap tampil dengan tombol aktif. Tutup panelnya di sini (semua jalur:
  // skip tombol, /skip, lagu selesai, maupun error).
  hidePlayerPanel(queue, 'Antrean habis. Tidak ada lagu yang sedang diputar.');

  // Kembalikan memori player script youtubei.js setelah native selesai dipakai.
  if (queue.backend === 'native') {
    native.releaseNativeClients();
  }

  const guildId = queue.guildId;
  clearDisconnectTimeout(queue);

  queue.disconnectTimeout = setTimeout(() => {
    const current = queues.get(guildId);
    if (!current || current.currentlyPlaying || current.songs.length > 0) return;
    current.textChannel?.send('⏹️ Antrean habis. Disconnect dari voice channel.').catch(() => {});
    stopMusic(guildId);
  }, 180000);
}

/**
 * Player events handler - membedakan antara:
 * - Track content error (YouTube gagal) → skip lagu, BUKAN failover node
 * - Node/connection error → failover ke node lain
 */
function attachPlayerEvents(player, guildId) {
  player.removeAllListeners();

  player.on('end', (data) => {
    const queue = queues.get(guildId);
    if (!queue) return;

    // Lavalink v4 memakai reason huruf kecil (finished / stopped / replaced /
    // loadFailed / cleanup), v3 memakai LOAD_FAILED. Normalisasi keduanya ke
    // bentuk huruf besar agar perbandingan di bawah tidak meleset.
    const rawReason = String(data?.reason || '');
    const reason = rawReason.toUpperCase().replace(/^LOADFAILED$/, 'LOAD_FAILED');
    if (reason === 'REPLACED') return;

    // Flag failover yang menggantung jangan sampai memblokir antrean selamanya.
    // Dipindah ke sini (sebelum filter event usang) agar event 'end' yang
    // tiba saat failover masih jalan bisa membersihkan flag dan memajukan antrean.
    if (queue._failoverInProgress) {
      queue._failoverInProgress = false;
      queue._failoverStartedAt = 0;
    }

    // Abaikan event 'end' dari track yang bukan lagi lagu aktif (event usang
    // bisa datang setelah failover / playTrack berikutnya). Bandingkan juga
    // dengan player.track milik Shoukaku, karena itu track yang benar-benar
    // terakhir diputar di node.
    const endedTrack = data?.track?.encoded || data?.track;
    const currentTracks = [
      extractEncodedTrack(queue.currentlyPlaying?.track),
      extractEncodedTrack(queue.currentlyPlaying?.prefetchedTrack),
      player.track,
    ].filter(Boolean);
    if (endedTrack && currentTracks.length > 0 && !currentTracks.includes(endedTrack)) {
      console.warn(`[end] event usang diabaikan (${reason}).`);
      return;
    }

    // Anti double-advance: dua event 'end' dalam waktu singkat hanya diproses sekali.
    const now = Date.now();
    if (queue._lastAdvanceAt && now - queue._lastAdvanceAt < 1000) return;
    queue._lastAdvanceAt = now;

    if (queue._skipRequested) {
      queue._skipRequested = false;
      advanceQueue(guildId, { allowLoop: false });
      return;
    }

    // 'STOPPED' (skip/stop) tetap memajukan antrean; 'LOAD_FAILED' jangan di-loop.
    advanceQueue(guildId, { allowLoop: reason !== 'LOAD_FAILED' });
  });

  player.on('exception', (data) => {
    const errorMsg =
      data?.exception?.message ||
      data?.message ||
      data?.error ||
      data?.reason ||
      'Audio stream failed on node';

    logError('Player Exception', new Error(errorMsg));

    const queue = queues.get(guildId);
    if (!queue) return;

    // "Session not found" / player hilang = sesi node sudah tidak valid.
    // Bangun ulang player di node lain, jangan hanya skip lagu.
    if (isSessionError(errorMsg)) {
      handleNodeFailover(guildId, 'Session node tidak valid (Session not found)');
      return;
    }

    // Deteksi apakah ini TRACK-LEVEL error (YouTube extraction/source gagal)
    // atau NODE-LEVEL error (server crash/timeout)
    const isTrackError =
      errorMsg.includes('Failed to get a working track URL') ||
      errorMsg.includes('No streaming data found') ||
      errorMsg.includes('player data for stream') ||
      errorMsg.includes('signature timestamp') ||
      errorMsg.includes('Source youtube not found') ||
      errorMsg.includes('does not support search') ||
      errorMsg.includes('not found or does not support');

    if (isTrackError) {
      const failedSong = queue.currentlyPlaying;

      if (queue.textChannel) {
        queue.textChannel.send(
          `⏭️ **Lagu dilewati**: **${failedSong?.title || 'Unknown'}** — Audio provider gagal pada node ini (\`${errorMsg}\`). Mencoba lagu berikutnya...`
        ).catch(() => {});
      }

      // Lavalink mengirim 'exception' lalu 'end' (loadFailed) yang memajukan antrean.
      // Fallback ini menjaga antrean tetap jalan jika event 'end' tidak datang.
      setTimeout(() => {
        const current = queues.get(guildId);
        if (current && failedSong && current.currentlyPlaying === failedSong && !current._failoverInProgress) {
          advanceQueue(guildId, { allowLoop: false });
        }
      }, 3000);
    } else {
      // Node error → failover ke node lain
      handleNodeFailover(guildId, `Track Error: ${errorMsg}`);
    }
  });

  player.on('stuck', (data) => {
    logError('Player Stuck', new Error(`Track stuck > ${data.thresholdMs}ms`));
    handleNodeFailover(guildId, 'Track Audio Stuck');
  });

  player.on('closed', (data) => {
    // `queue` tidak ada di scope ini pada versi sebelumnya → ReferenceError saat code 4017
    const queue = queues.get(guildId);

    console.warn(`⚠️ Voice connection closed (code: ${data?.code}, reason: ${data?.reason || 'N/A'})`);

    if (data?.code === 4014 || data?.code === 4006 || data?.code === 4017) {
      if (data.code === 4017) {
        queue?.textChannel?.send(
          '⚠️ **Voice Connection Terminated (Code 4017)**: Discord memerlukan enkripsi E2EE/DAVE. Pemutaran dihentikan.'
        ).catch(() => {});
      }
      stopMusic(guildId);
    }
  });
}

export function getQueue(guildId) {
  return queues.get(guildId);
}

/**
 * Visual Progress Bar Generator
 */
export function createProgressBar(currentMs = 0, totalMs = 0, size = 12) {
  if (!totalMs || totalMs === 0) return '🔴 LIVE';
  const progress = Math.min(1, Math.max(0, currentMs / totalMs));
  const sliderPosition = Math.round(size * progress);
  const bar = '▬'.repeat(sliderPosition) + '🔘' + '▬'.repeat(size - sliderPosition);
  return `${bar} ${formatDuration(currentMs)} / ${formatDuration(totalMs)}`;
}

/**
 * Menghasilkan Payload Embed & Remote Control Buttons
 */
export function buildPlayerPayload(guildId) {
  const queue = queues.get(guildId);
  if (!queue || !queue.currentlyPlaying) {
    return { embeds: [], components: [] };
  }

  const song = queue.currentlyPlaying;
  let currentPos = 0;

  if (song) {
    if (queue.isPaused && song.pausedAt) {
      currentPos = Math.max(0, song.pausedAt - song.startedAt - (song.pausedDuration || 0));
    } else if (song.startedAt) {
      const elapsed = Date.now() - song.startedAt - (song.pausedDuration || 0);
      const reported = getReportedPosition(queue);

      // Deteksi apakah posisi node benar-benar bergerak. Lavalink v4 membatalkan
      // playerUpdate saat track selesai, sehingga posisi terakhir membeku. Kalau
      // posisi membeku, jangan dipakai untuk recalibrate — selain membuat
      // progress bar "nyangkut", ini juga bisa menyeret anchor watchdog mundur.
      const positionMoved = reported !== song._lastReportedPos;
      if (positionMoved) {
        song._lastReportedPos = reported;
        song._lastReportedAt = Date.now();
      }

      // Hanya recalibrate jika ada drift sangat besar (> 5 detik, misal dari
      // seek / reconnect) DAN posisi node bergerak (data masih segar).
      if (reported > 0 && positionMoved && Math.abs(elapsed - reported) > 5000) {
        song.startedAt = Date.now() - reported - (song.pausedDuration || 0);
        currentPos = reported;
      } else {
        currentPos = Math.max(0, Math.min(song.durationMs || Infinity, elapsed));
      }
    } else {
      currentPos = getReportedPosition(queue);
      if (currentPos > 0) {
        song.startedAt = Date.now() - currentPos;
      }
    }

    // Proteksi Monotonik: Waktu tidak boleh mundur/stutter di layar saat musik diputar
    if (song.lastRenderedPos && currentPos < song.lastRenderedPos && !queue.isPaused) {
      currentPos = song.lastRenderedPos;
    }
    song.lastRenderedPos = currentPos;
  }

  const progressBar = createProgressBar(currentPos, song.durationMs);

  const nativeTools = queue.backend === 'native' ? native.detectNativeTools() : null;
  const engineLabel = queue.backend === 'native'
    ? `Native Engine (youtubei.js${nativeTools.ffmpeg ? ' + FFmpeg' : ' • Opus'})`
    : (queue.player?.node?.name || 'Auto Node');

  const loopLabel =
    queue.loopMode === 'track' ? '🔂 Lagu' :
    queue.loopMode === 'queue' ? '🔁 Antrean' : '➡️ Off';

  const songUrl = safeHttpUrl(song.url);

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setAuthor({ name: '🎵 PEMUTAR MUSIK (REMOTE CONTROL)', iconURL: queue.voiceChannel?.guild?.iconURL() || undefined })
    .setTitle(song.title || 'Unknown')
    .setDescription(
      `**Progress:**\n\`${progressBar}\`${queue.isPaused ? ' (⏸️ Paused)' : ''}\n\n` +
      `🎤 **Artis:** ${song.author || 'Unknown'}\n` +
      `👤 **Peminta:** <@${song.requester?.id || '0'}>\n` +
      `🌐 **Node Active:** \`${engineLabel}\``
    )
    .addFields(
      { name: '🔊 Volume', value: `\`${queue.volume}%\``, inline: true },
      { name: '🔁 Loop Mode', value: `\`${loopLabel}\``, inline: true },
      { name: '📜 Sisa Antrean', value: `\`${queue.songs.length} Lagu\``, inline: true }
    )
    .setImage(safeHttpUrl(song.thumbnail) || DEFAULT_BANNER)
    .setFooter({
      text: queue.backend === 'native'
        ? `Native Engine • Direct Opus Streaming${nativeTools.ffmpeg ? '' : ' • Volume realtime butuh FFmpeg'}`
        : 'Anti-Lag Spotify Buffer Engine • Dynamic Failover Active',
    })
    .setTimestamp();

  // setURL() melempar error bila URL tidak valid (dulu membuat payload gagal dibuat total)
  if (songUrl) embed.setURL(songUrl);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_music_toggle_pause')
      .setLabel(queue.isPaused ? 'Resume' : 'Pause')
      .setEmoji(queue.isPaused ? '▶️' : '⏸️')
      .setStyle(queue.isPaused ? ButtonStyle.Success : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('btn_music_skip')
      .setLabel('Skip')
      .setEmoji('⏭️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_music_stop')
      .setLabel('Stop')
      .setEmoji('⏹️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('btn_music_loop')
      .setLabel(`Loop (${loopLabel})`)
      .setEmoji('🔁')
      .setStyle(queue.loopMode !== 'off' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_music_shuffle')
      .setLabel('Shuffle')
      .setEmoji('🔀')
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_music_voldown')
      .setLabel('Vol -10%')
      .setEmoji('🔉')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_music_volup')
      .setLabel('Vol +10%')
      .setEmoji('🔊')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_music_queue')
      .setLabel('Queue')
      .setEmoji('📜')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_music_node')
      .setLabel('Node Status')
      .setEmoji('🌐')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row1, row2] };
}

/**
 * Payload saat pemutaran berhenti: tombolControl panel dihapus (components: [])
 * supaya tidak ada tombol yang masih bisa ditekan setelah lagu selesai / di-skip.
 */
export function buildStoppedPlayerPayload(guildId, description = 'Tidak ada lagu yang sedang diputar.') {
  return {
    embeds: [new EmbedBuilder()
      .setColor(config.colors.warning)
      .setTitle('⏹️ Pemutar Musik Dihentikan')
      .setDescription(description)
      .setTimestamp()],
    components: [],
  };
}

/** Sembunyikan control panel lama (hapus embed + tombol) lalu lepas referensinya. */
function hidePlayerPanel(queue, description) {
  if (!queue?.lastPlayerMessage) return;
  const payload = buildStoppedPlayerPayload(queue.guildId, description);
  queue.lastPlayerMessage.edit(payload).catch(() => {});
  queue.lastPlayerMessage = null;
}

/**
 * Update pesan player aktif di text channel jika ada
 */
export async function updatePlayerMessage(guildId) {
  const queue = queues.get(guildId);
  if (!queue || !queue.lastPlayerMessage || !queue.textChannel || !queue.currentlyPlaying) return;

  try {
    const payload = buildPlayerPayload(guildId);
    await queue.lastPlayerMessage.edit(payload);
  } catch (err) {
    // pesan terhapus, abaikan
  }
}

/**
 * Cari track via Lavalink REST API dengan Multi-Node & Multi-Provider Fallback.
 * Kompatibel penuh dengan SoundCloud, Spotify, YouTube, Deezer, dll.
 */
async function searchTrack(query, preferredNode = null) {
  let candidateNodes = getIdealNodes();
  if (preferredNode && preferredNode.state === 1) {
    candidateNodes = candidateNodes.filter(n => n.name !== preferredNode.name);
    candidateNodes.unshift(preferredNode);
  }

  if (candidateNodes.length === 0) {
    throw new Error('Tidak ada node Lavalink yang terhubung! Coba lagi nanti.');
  }

  const cleanQuery = (query || '').trim();
  if (!cleanQuery) {
    throw new Error('Judul lagu tidak boleh kosong.');
  }

  const isUrl = cleanQuery.startsWith('http://') || cleanQuery.startsWith('https://');
  const cleanText = cleanQuery.replace(/^(ytsearch|scsearch|spsearch|dzsearch|ytmsearch|amsearch):/i, '').trim();

  // Daftar prefix pencarian yang dicoba secara berurutan.
  // YouTube diutamakan untuk query teks karena paling cepat & paling sering
  // berhasil; SoundCloud/Spotify tetap jadi fallback. Prefix eksplisit dari user
  // tetap dihormati. Dulu ada 5 prefix per node (40+ request) — sekarang 3.
  let searchPrefixes;
  if (isUrl) {
    searchPrefixes = [cleanQuery];
  } else if (/^(ytsearch|scsearch|spsearch|dzsearch|ytmsearch|amsearch):/i.test(cleanQuery)) {
    searchPrefixes = [
      cleanQuery,
      `ytsearch:${cleanText}`,
      `scsearch:${cleanText}`,
      `spsearch:${cleanText}`,
    ];
  } else {
    searchPrefixes = [
      `ytsearch:${cleanText}`,
      `scsearch:${cleanText}`,
      `spsearch:${cleanText}`,
    ];
  }

  let lastError = null;
  const deadline = Date.now() + SEARCH_TOTAL_TIMEOUT;

  for (const node of candidateNodes) {
    if (Date.now() > deadline) break;
    for (const searchQuery of searchPrefixes) {
      if (Date.now() > deadline) break;
      try {
        const result = await withTimeout(
          node.rest.resolve(searchQuery),
          SEARCH_REQUEST_TIMEOUT,
          `Pencarian di node ${node.name}`
        );

        if (!result || result.loadType === 'empty' || result.loadType === 'error') {
          continue;
        }

        let track;
        if (result.loadType === 'playlist') {
          track = result.data?.tracks?.[0] || (Array.isArray(result.data) ? result.data[0] : null);
        } else if (result.loadType === 'search') {
          track = Array.isArray(result.data) ? result.data[0] : result.data;
        } else if (result.loadType === 'track') {
          track = result.data;
        }

        if (!track) continue;

        reduceNodePenalty(node);

        return {
          query: query,
          track: track,
          title: track.info.title || 'Unknown',
          url: track.info.uri || query,
          duration: track.info.length ? formatDuration(track.info.length) : 'Live',
          durationMs: track.info.length || 0,
          thumbnail: track.info.artworkUrl || DEFAULT_BANNER,
          author: track.info.author || 'Unknown',
          isStream: track.info.isStream || false,
        };
      } catch (err) {
        lastError = err;
      }
    }

    // Jika semua provider di node ini gagal, tambahkan penalti ringan dan coba node berikutnya
    addNodePenalty(node, 3);
  }

  throw new Error(`Semua provider pencarian (YouTube, SoundCloud, Spotify) gagal menemukan lagu: ${lastError?.message || 'Tidak ada hasil'}`);
}

async function prefetchNextTrack(queue) {
  // Pre-fetch encoded track hanya relevan untuk engine Shoukaku
  if (!queue || queue.backend === 'native' || queue.songs.length === 0) return;
  const nextSong = queue.songs[0];
  if (nextSong.prefetchedTrack) return;

  try {
    const activeNode = queue.player?.node;
    const resolved = await searchTrack(nextSong.query || nextSong.url, activeNode);
    if (resolved?.track) {
      nextSong.prefetchedTrack = resolved.track;
    }
  } catch (err) {
    // non-critical
  }
}

/**
 * Ekstraksi string base64 encoded track secara aman dari berbagai versi Lavalink
 */
function extractEncodedTrack(trackObj) {
  if (!trackObj) return null;
  if (typeof trackObj === 'string') return trackObj;
  if (trackObj.encoded) return trackObj.encoded;
  if (trackObj.track) {
    if (typeof trackObj.track === 'string') return trackObj.track;
    if (trackObj.track.encoded) return trackObj.track.encoded;
  }
  if (trackObj.encodedTrack) return trackObj.encodedTrack;
  return null;
}



/**
 * Main Play Music Function (FIX DUPLICATE MESSAGE)
 */
export async function playMusic(interaction, query) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    throw new Error('Kamu harus berada di Voice Channel terlebih dahulu!');
  }

  const permissions = voiceChannel.permissionsFor(interaction.client.user);
  if (!permissions || !permissions.has('Connect') || !permissions.has('Speak')) {
    throw new Error('Bot tidak memiliki izin Connect atau Speak di channel tersebut!');
  }

  // Engine native: discord.js + @discordjs/voice + youtubei.js (tanpa Lavalink)
  if (activeEngine === 'native') {
    return playNativeMusic(interaction, query);
  }

  if (!shoukaku) {
    throw new Error('Sistem musik belum siap. Lavalink belum terhubung!');
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply();
  }
  await sendPreparingReply(interaction);

  // Jangan mencampur engine dalam satu guild
  const existingQueue = queues.get(interaction.guildId);
  if (existingQueue?.backend === 'native') {
    stopMusic(interaction.guildId);
  } else if (
    existingQueue?.currentlyPlaying &&
    existingQueue.voiceChannel?.id &&
    existingQueue.voiceChannel.id !== voiceChannel.id
  ) {
    throw new Error(
      `Bot sedang memutar musik di <#${existingQueue.voiceChannel.id}>. ` +
      'Masuk ke voice channel tersebut untuk menambah lagu.'
    );
  }

  const activeNode = queues.get(interaction.guildId)?.player?.node;

  // Mulai pencarian SEBELUM join voice supaya dua operasi paling berat berjalan
  // bersamaan. Total waktu /play turun drastis dibanding menjalankannya berurutan.
  const searchPromise = searchTrack(query, activeNode);
  // Hindari unhandledRejection jika search selesai gagal saat join masih berjalan.
  searchPromise.catch(() => {});

  let songInfo;
  try {
    songInfo = await searchPromise;
  } catch (err) {
    throw new Error(`Gagal mencari lagu: ${err.message}`);
  }

  songInfo.requester = interaction.user;

  let queue = queues.get(interaction.guildId);
  const activePlayer = shoukaku.players.get(interaction.guildId);

  const needsRejoin =
    !queue ||
    !queue.player ||
    !activePlayer ||
    queue.player !== activePlayer ||
    (queue.voiceChannel?.id && queue.voiceChannel.id !== voiceChannel.id);

  if (needsRejoin) {
    let player;
    try {
      // leaveVoiceChannel bersifat async; tunggu agar map connection benar-benar
      // bersih sebelum join ulang (mencegah "This guild already have an existing connection").
      try { await shoukaku.leaveVoiceChannel(interaction.guildId); } catch (e) { /* belum connect */ }
      shoukaku.connections.delete(interaction.guildId);
      shoukaku.players.delete(interaction.guildId);
      await new Promise((resolve) => setTimeout(resolve, 300));

      player = await joinVoiceChannelWithFallback({
        guildId: interaction.guildId,
        channelId: voiceChannel.id,
        shardId: 0,
        deaf: true,
      });
    } catch (err) {
      throw new Error(`Gagal join voice channel: ${err.message}`);
    }

    if (!queue) {
      queue = createQueue(interaction.guildId, voiceChannel, interaction.channel, 'shoukaku');
      queues.set(interaction.guildId, queue);
    }

    queue.backend = 'shoukaku';
    queue.player = player;
    queue.voiceChannel = voiceChannel;
    queue.textChannel = interaction.channel;

    attachPlayerEvents(player, interaction.guildId);
    // Tunggu volume terset SEBELUM playTrack supaya tidak ada dua PATCH player
    // yang balapan (volume vs track) ketika lagu pertama mulai diputar.
    await player.setGlobalVolume(queue.volume).catch(() => {});
  } else {
    queue.voiceChannel = voiceChannel;
    queue.textChannel = interaction.channel;
  }

  clearDisconnectTimeout(queue);
  queue.songs.push(songInfo);

  if (!queue.currentlyPlaying) {
    // Memutar lagu pertama
    await processQueue(interaction.guildId, interaction);
  } else {
    // Lagu ditambahkan ke antrean
    prefetchNextTrack(queue);
    await sendQueuedEmbed(interaction, songInfo, queue);
    await updatePlayerMessage(interaction.guildId);
  }
}

/**
 * Kirim embed "ditambahkan ke antrean" (aman walau interaction sudah kedaluwarsa)
 */
async function sendQueuedEmbed(interaction, songInfo, queue) {
  const embed = new EmbedBuilder()
    .setColor(config.colors.info)
    .setTitle('➕ Ditambahkan ke Antrean')
    .setDescription(`[**${songInfo.title}**](${songInfo.url})`)
    .addFields(
      { name: '📊 Posisi Antrean', value: `#${queue.songs.length}`, inline: true },
      { name: '⏱️ Durasi', value: songInfo.isStream ? '🔴 LIVE' : songInfo.duration, inline: true },
      { name: '👤 Peminta', value: `<@${songInfo.requester.id}>`, inline: true }
    )
    .setThumbnail(songInfo.thumbnail || DEFAULT_BANNER)
    .setTimestamp();

  const payload = { embeds: [embed] };

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
      return;
    }
    await interaction.reply(payload);
  } catch {
    queue.textChannel?.send(payload).catch(() => {});
  }
}

/**
 * Kirim / perbarui pesan pemutar. Dipisah dari playback supaya error edit pesan
 * (interaction kedaluwarsa / pesan terhapus) tidak memicu failover palsu.
 */
async function publishPlayerPayload(queue, initialInteraction = null) {
  const payload = buildPlayerPayload(queue.guildId);
  if (!payload.embeds || payload.embeds.length === 0) return;

  if (initialInteraction) {
    try {
      queue.lastPlayerMessage = await initialInteraction.editReply(payload);
      return;
    } catch {
      // interaction kedaluwarsa → lanjut kirim pesan baru
    }
  }

  if (queue.lastPlayerMessage) {
    try {
      await queue.lastPlayerMessage.edit(payload);
      return;
    } catch {
      queue.lastPlayerMessage = null;
    }
  }

  if (queue.textChannel) {
    try {
      queue.lastPlayerMessage = await queue.textChannel.send(payload);
    } catch { /* tidak punya izin kirim */ }
  }
}

function startProgressInterval(queue) {
  const guildId = queue.guildId;

  if (queue.progressInterval) clearInterval(queue.progressInterval);
  queue.progressInterval = setInterval(() => {
    const current = queues.get(guildId);
    if (!current) return;

    // Pemulihan: advanceQueue mengosongkan currentlyPlaying lalu processQueue
    // mengisinya lagi secara sinkron. Kalau antrean punya lagu tapi tidak ada
    // lagu aktif, prosesi antrean belum jalan — picu lagi supaya tidak stuck.
    if (!current.currentlyPlaying && current.songs.length > 0) {
      if (!current._stuckRecoverAt || Date.now() - current._stuckRecoverAt > 5000) {
        current._stuckRecoverAt = Date.now();
        console.warn(`[watchdog] antrean ${guildId} tanpa lagu aktif, memicu processQueue.`);
        processQueue(guildId);
      }
      return;
    }

    if (!current.currentlyPlaying || current.isPaused) return;

    updatePlayerMessage(guildId);

    const song = current.currentlyPlaying;

    // Failover yang menggantung tidak boleh memblokir antrean selamanya.
    if (current._failoverInProgress && current._failoverStartedAt) {
      if (Date.now() - current._failoverStartedAt > FAILOVER_TIMEOUT_MS) {
        console.warn(`[watchdog] failover ${guildId} timeout, memaksa lanjut.`);
        current._failoverInProgress = false;
        current._failoverRetries = 0;
        current._lastAdvanceAt = Date.now();
        advanceQueue(guildId);
        return;
      }
    }

    // Watchdog durasi: pakai anchor monotonik (tidak direcalibrate oleh
    // buildPlayerPayload). Jika event 'end' tidak pernah datang (node lambat /
    // packet loss) lagu bisa "mentok" selamanya dan panel tetap menampilkan
    // lagu sebelumnya. Saat waktu putar melewati durasi + grace, majukan antrean.
    const duration = Number(song.durationMs) || 0;
    const anchor = song.watchdogAnchor || song.startedAt;
    if (duration > 0 && anchor && !current._failoverInProgress) {
      const elapsed = Date.now() - anchor - (song.pausedDuration || 0);
      if (elapsed > duration + WATCHDOG_GRACE_MS) {
        console.warn(`[watchdog] "${song.title}" dianggap selesai, memajukan antrean.`);
        current._lastAdvanceAt = Date.now();
        advanceQueue(guildId, { allowLoop: true });
        return;
      }
    }

    // Watchdog posisi membeku: posisi node berhenti berubah untuk waktu lama
    // sementara lagu tidak dijeda. Ini menandakan stream mentok di tengah lagu
    // (durasi tidak diketahui / node berhenti mengirim update). Lewati live
    // stream yang posisinya bisa legit berhenti sejenak.
    if (!current._failoverInProgress && !song.isStream && song._lastReportedAt && song._lastReportedPos > 0) {
      if (Date.now() - song._lastReportedAt > WATCHDOG_STALL_MS) {
        console.warn(`[watchdog] posisi "${song.title}" membeku, memajukan antrean.`);
        current._lastAdvanceAt = Date.now();
        advanceQueue(guildId, { allowLoop: true });
      }
    }
  }, 2000);
}

/**
 * Putar satu lagu pada player Shoukaku, dengan re-resolve bila encoded tidak valid.
 */
async function playShoukakuSong(queue, player, song, retriedSession = false) {
  const originalQuery = song.query || song.url || song.title;

  let encoded = extractEncodedTrack(song.prefetchedTrack || song.track);

  if (!encoded && originalQuery) {
    const reResolved = await searchTrack(originalQuery, player.node);
    if (reResolved?.track) {
      encoded = extractEncodedTrack(reResolved.track);
      song.track = reResolved.track;
    }
  }

  if (!encoded) {
    throw new Error('Data encoding lagu dari server tidak valid.');
  }

  try {
    await playEncodedTrack(player, encoded);
  } catch (playErr) {
    // Sesi node mati: buat player baru lalu coba sekali lagi. Re-resolve di
    // player lama hanya akan gagal dengan error yang sama.
    if (isSessionError(playErr) && !retriedSession) {
      console.warn('⚠️ Session node tidak valid saat playTrack, membuat ulang player...');
      const freshPlayer = await reconnectShoukakuPlayer(queue.guildId, { resume: false });
      if (!freshPlayer) throw playErr;
      return playShoukakuSong(queue, freshPlayer, song, true);
    }

    if (!originalQuery) throw playErr;

    console.warn(`⚠️ PlayTrack error di node ${player.node?.name}, mencoba re-resolve di node aktif...`);
    const fresh = await searchTrack(originalQuery, player.node);
    const freshEncoded = extractEncodedTrack(fresh?.track);

    if (!freshEncoded) throw playErr;

    song.track = fresh.track;
    await playEncodedTrack(player, freshEncoded);
  }
}

/**
 * Process Queue & Auto-Update Progress Bar Timer
 */
async function processQueue(guildId, initialInteraction = null) {
  const queue = queues.get(guildId);
  if (!queue) return;

  // Engine native punya alur playback sendiri
  if (queue.backend === 'native') {
    return processNativeQueue(guildId, initialInteraction);
  }

  if (queue.songs.length === 0) {
    handleEmptyQueue(queue);
    return;
  }

  const nextSong = queue.songs.shift();
  prepareSong(queue, nextSong);

  queue.currentlyPlaying = nextSong;
  queue.isPaused = false;

  prefetchNextTrack(queue);

  try {
    const player = await ensureActivePlayer(guildId);
    if (!player) throw new Error('Tidak ada player Lavalink yang aktif.');
    await playShoukakuSong(queue, player, nextSong);

    // Warm-up membuat node menahan audio ~LAVALINK_WARMUP_MS sebelum benar-benar
    // diputar. Reset patokan waktu supaya progress bar tidak langsung melompat.
    nextSong.startedAt = Date.now();
    nextSong.pausedDuration = 0;
    nextSong.lastRenderedPos = 0;
    nextSong.watchdogAnchor = Date.now();
    nextSong._lastReportedPos = null;
    nextSong._lastReportedAt = 0;
  } catch (err) {
    logError('Lavalink Play Error', err);

    const errorTitle = nextSong?.title || 'Lagu';
    const errorDetail = err?.message || 'Stream playback failure';
    queue.textChannel?.send(`❌ Gagal memutar **${errorTitle}**: ${errorDetail}`).catch(() => {});

    // Coba node lain dulu; bila tidak ada node pengganti, lewati lagu (jangan stuck)
    const alternatives = getIdealNodes(queue.player?.node?.name);
    if (alternatives.length > 0) {
      handleNodeFailover(guildId, errorDetail);
    } else {
      queue.currentlyPlaying = null;
      advanceQueue(guildId, { allowLoop: false });
    }
    return;
  }

  await publishPlayerPayload(queue, initialInteraction);
  startProgressInterval(queue);
}

// ============================================
// Native engine flow (tanpa Lavalink)
// ============================================

async function playNativeMusic(interaction, query) {
  if (!native.isNativeAvailable()) {
    throw new Error('Engine native tidak tersedia: paket youtubei.js gagal dimuat. Jalankan "npm install" lalu restart bot.');
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply();
  }
  await sendPreparingReply(interaction);

  const voiceChannel = interaction.member?.voice?.channel;

  // Pencarian Youtube dimulai lebih awal supaya berjalan bersamaan dengan
  // pengecekan queue / inisialisasi (search client sekarang jauh lebih ringan).
  const searchPromise = native.searchNative(query);
  searchPromise.catch(() => {});

  const existingQueue = queues.get(interaction.guildId);
  if (existingQueue?.backend === 'shoukaku') {
    stopMusic(interaction.guildId);
  } else if (
    existingQueue?.currentlyPlaying &&
    existingQueue.voiceChannel?.id &&
    existingQueue.voiceChannel.id !== voiceChannel.id
  ) {
    throw new Error(
      `Bot sedang memutar musik di <#${existingQueue.voiceChannel.id}>. ` +
      'Masuk ke voice channel tersebut untuk menambah lagu.'
    );
  }

  let songInfo;
  try {
    songInfo = await searchPromise;
  } catch (err) {
    throw new Error(`Gagal mencari lagu: ${err.message}`);
  }

  songInfo.requester = interaction.user;

  let queue = queues.get(interaction.guildId);
  if (!queue) {
    queue = createQueue(interaction.guildId, voiceChannel, interaction.channel, 'native');
    queues.set(interaction.guildId, queue);
  }

  queue.backend = 'native';
  queue.voiceChannel = voiceChannel;
  queue.textChannel = interaction.channel;

  clearDisconnectTimeout(queue);
  queue.songs.push(songInfo);

  if (!queue.currentlyPlaying) {
    await processNativeQueue(interaction.guildId, interaction);
  } else {
    await sendQueuedEmbed(interaction, songInfo, queue);
    await updatePlayerMessage(interaction.guildId);
  }
}

async function processNativeQueue(guildId, initialInteraction = null) {
  const queue = queues.get(guildId);
  if (!queue || queue.backend !== 'native') return;

  if (queue.songs.length === 0) {
    handleEmptyQueue(queue);
    return;
  }

  const nextSong = queue.songs.shift();
  prepareSong(queue, nextSong);

  queue.currentlyPlaying = nextSong;
  queue.isPaused = false;

  try {
    await ensureNativeSession(queue);
    await native.playNativeTrack(queue, nextSong);

    nextSong.startedAt = Date.now();
    nextSong.pausedDuration = 0;
    nextSong.lastRenderedPos = 0;
    nextSong.watchdogAnchor = Date.now();
    nextSong._lastReportedPos = null;
    nextSong._lastReportedAt = 0;
  } catch (err) {
    logError('Native Play Error', err);
    queue.textChannel?.send(`❌ Gagal memutar **${nextSong.title}**: ${err.message}`).catch(() => {});
    queue.currentlyPlaying = null;

    // Setiap kegagalan menghabiskan satu lagu, jadi loop ini selalu berakhir
    if (queue.songs.length > 0) {
      await processNativeQueue(guildId);
      return;
    }

    handleEmptyQueue(queue);
    return;
  }

  await publishPlayerPayload(queue, initialInteraction);
  startProgressInterval(queue);
}

async function ensureNativeSession(queue) {
  if (native.isNativeSessionAlive(queue.native, queue.voiceChannel?.id)) {
    return queue.native;
  }

  if (queue.native) native.destroyNativeSession(queue);

  const guild = queue.voiceChannel?.guild;
  if (!guild) throw new Error('Guild tidak ditemukan untuk engine native.');

  queue.native = await native.startNativeSession({
    guild,
    voiceChannel: queue.voiceChannel,
    onFinish: () => handleNativeFinish(queue.guildId),
    onError: (err) => handleNativeError(queue.guildId, err),
    onDisconnect: () => handleNativeDisconnect(queue.guildId),
  });

  return queue.native;
}

function handleNativeFinish(guildId) {
  const queue = queues.get(guildId);
  if (!queue || queue.backend !== 'native') return;
  advanceQueue(guildId);
}

function handleNativeError(guildId, err) {
  const queue = queues.get(guildId);
  if (!queue || queue.backend !== 'native') return;

  logError('Native Player Error', err);
  queue.textChannel?.send(`⚠️ Error pemutar native: ${err.message}`).catch(() => {});

  const failedSong = queue.currentlyPlaying;
  setTimeout(() => {
    const current = queues.get(guildId);
    if (current && current.backend === 'native' && current.currentlyPlaying === failedSong) {
      advanceQueue(guildId, { allowLoop: false });
    }
  }, 500);
}

function handleNativeDisconnect(guildId) {
  const queue = queues.get(guildId);
  if (!queue || queue.backend !== 'native') return;

  queue.textChannel?.send('🔌 Koneksi voice terputus. Antrean dihentikan.').catch(() => {});
  stopMusic(guildId);
}

export async function togglePauseMusic(guildId) {
  const queue = queues.get(guildId);
  if (!queue || !queue.currentlyPlaying) {
    throw new Error('Tidak ada musik yang sedang diputar.');
  }

  if (queue.isPaused) await resumeMusic(guildId);
  else await pauseMusic(guildId);

  return queues.get(guildId)?.isPaused ?? false;
}

export async function skipTrack(guildId) {
  const queue = queues.get(guildId);
  if (!queue || !queue.currentlyPlaying) {
    throw new Error('Tidak ada musik yang sedang diputar.');
  }

  const skipped = queue.currentlyPlaying;

  // Engine native: hentikan track lalu majukan antrean secara eksplisit
  if (queue.backend === 'native') {
    native.stopNativePlayback(queue);
    advanceQueue(guildId, { allowLoop: false });
    return skipped;
  }

  // Jika player/sesi sudah mati, tidak perlu join ulang hanya untuk skip:
  // langsung majukan antrean (processQueue akan membuat player baru).
  const player = getLivePlayer(queue);

  if (!player) {
    advanceQueue(guildId, { allowLoop: false });
    return skipped;
  }

  // stopTrack() memicu event 'end' (reason: stopped). Flag ini membuat handler
  // memajukan antrean tanpa menerapkan loop pada lagu yang di-skip.
  queue._skipRequested = true;
  try {
    await player.stopTrack();
  } catch (err) {
    if (isSessionError(err)) {
      // Sesi node sudah mati; tidak ada event 'end' yang akan datang.
      queue._skipRequested = false;
      advanceQueue(guildId, { allowLoop: false });
      return skipped;
    }
    console.warn(`⚠️ stopTrack error: ${err.message}`);
  }

  // Fallback bila event 'end' tidak pernah datang (node lambat/mati)
  setTimeout(() => {
    const current = queues.get(guildId);
    if (current && current._skipRequested && current.currentlyPlaying === skipped) {
      current._skipRequested = false;
      advanceQueue(guildId, { allowLoop: false });
    }
  }, 2500);

  return skipped;
}

/**
 * Stop "normal": kalau masih ada antrean, putar lagu berikutnya; kalau tidak,
 * benar-benar hentikan musik & disconnect. Dipakai oleh /stop dan tombol Stop.
 */
export async function stopOrPlayNext(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return { stopped: true, playedNext: false, skipped: null };

  if (queue.currentlyPlaying && queue.songs.length > 0) {
    const skipped = await skipTrack(guildId);
    return { stopped: false, playedNext: true, skipped };
  }

  stopMusic(guildId);
  return { stopped: true, playedNext: false, skipped: null };
}

/**
 * Sinkronkan timestamp pause agar progress bar tetap akurat
 */
function setPauseTimestamps(queue, paused) {
  const song = queue.currentlyPlaying;
  if (!song) return;

  if (paused) {
    if (!song.pausedAt) song.pausedAt = Date.now();
    return;
  }

  if (song.pausedAt) {
    song.pausedDuration = (song.pausedDuration || 0) + (Date.now() - song.pausedAt);
    song.pausedAt = null;

    // Watchdog posisi membeku tidak boleh langsung menembak lagu yang baru
    // di-resume setelah paused lama: posisi node memang tidak bergerak saat
    // jeda, sehingga timestamp terakhir masih usang.
    song._lastReportedPos = getReportedPosition(queue);
    song._lastReportedAt = Date.now();
  }
}

/** Player Shoukaku yang masih benar-benar hidup untuk queue ini. */
function getLivePlayer(queue) {
  if (!shoukaku || !queue) return null;
  const player = shoukaku.players.get(queue.guildId);
  if (player && queue.player === player && player.node?.state === 1) return player;
  return null;
}

/**
 * Pause/unpause dengan pemulihan sesi. Error "Session not found" tidak lagi
 * membuat command menggantung atau gagal total: player dibuat ulang lalu
 * status pause diterapkan lagi.
 */
async function setPlayerPausedSafely(guildId, paused) {
  const queue = queues.get(guildId);
  if (!queue) return;

  let player = getLivePlayer(queue);

  if (!player) {
    try {
      player = await ensureActivePlayer(guildId, { resume: true });
    } catch (err) {
      console.warn(`⚠️ Gagal memulihkan player untuk pause/resume: ${err.message}`);
      return;
    }
  }

  if (!player) return;

  try {
    await player.setPaused(paused);
  } catch (err) {
    if (isSessionError(err)) {
      try {
        const fresh = await reconnectShoukakuPlayer(guildId, { resume: true });
        await fresh?.setPaused(paused);
        return;
      } catch (retryErr) {
        console.warn(`⚠️ Gagal memulihkan sesi pause/resume: ${retryErr.message}`);
        return;
      }
    }
    console.warn(`⚠️ setPaused error: ${err.message}`);
  }
}

export async function pauseMusic(guildId) {
  const queue = queues.get(guildId);
  if (!queue || !queue.currentlyPlaying) {
    throw new Error('Tidak ada musik yang sedang diputar.');
  }

  if (!queue.isPaused) {
    queue.isPaused = true;
    setPauseTimestamps(queue, true);
  }

  if (queue.backend === 'native') {
    native.pauseNative(queue, true);
  } else {
    await setPlayerPausedSafely(guildId, true);
  }

  updatePlayerMessage(guildId);
  return queue.currentlyPlaying;
}

export async function resumeMusic(guildId) {
  const queue = queues.get(guildId);
  if (!queue || !queue.currentlyPlaying) {
    throw new Error('Tidak ada musik yang sedang diputar.');
  }

  if (queue.isPaused) {
    queue.isPaused = false;
    setPauseTimestamps(queue, false);
  }

  if (queue.backend === 'native') {
    native.pauseNative(queue, false);
  } else {
    await setPlayerPausedSafely(guildId, false);
  }

  updatePlayerMessage(guildId);
  return queue.currentlyPlaying;
}

export async function toggleLoopMode(guildId) {
  const queue = queues.get(guildId);
  if (!queue || !queue.currentlyPlaying) {
    throw new Error('Tidak ada musik yang sedang diputar.');
  }

  const modes = ['off', 'track', 'queue'];
  const nextIdx = (modes.indexOf(queue.loopMode || 'off') + 1) % modes.length;
  queue.loopMode = modes[nextIdx];
  updatePlayerMessage(guildId);
  return queue.loopMode;
}

export async function shuffleQueue(guildId) {
  const queue = queues.get(guildId);
  if (!queue || queue.songs.length === 0) {
    throw new Error('Antrean kosong atau tidak cukup lagu untuk di-shuffle.');
  }

  for (let i = queue.songs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue.songs[i], queue.songs[j]] = [queue.songs[j], queue.songs[i]];
  }

  updatePlayerMessage(guildId);
  return queue.songs.length;
}

async function applyVolume(queue, volume) {
  const clamped = Math.max(0, Math.min(200, Math.round(volume)));
  queue.volume = clamped;

  if (queue.backend === 'native') {
    native.setNativeVolume(queue, clamped);
  } else if (shoukaku) {
    let player = getLivePlayer(queue);

    // Jangan paksa rejoin kalau player masih hidup. Rejoin hanya dilakukan
    // ketika sesi memang hilang, sehingga command volume tidak lagi membuat
    // bot "not responding" karena menunggu koneksi voice baru.
    if (!player) {
      try {
        player = await ensureActivePlayer(queue.guildId, { resume: true });
      } catch (err) {
        console.warn(`⚠️ Volume tersimpan, tetapi player gagal dipulihkan: ${err.message}`);
        player = null;
      }
    }

    if (player) {
      try {
        await player.setGlobalVolume(clamped);
      } catch (err) {
        if (isSessionError(err)) {
          try {
            const fresh = await reconnectShoukakuPlayer(queue.guildId, { resume: true });
            await fresh?.setGlobalVolume(clamped);
          } catch (retryErr) {
            console.warn(`⚠️ Volume tersimpan, sesi gagal dipulihkan: ${retryErr.message}`);
          }
        } else {
          console.warn(`⚠️ setGlobalVolume error: ${err.message}`);
        }
      }
    }
  }

  // Update panel di background agar balasan command tidak menunggu edit pesan.
  updatePlayerMessage(queue.guildId);
  return clamped;
}

export async function adjustVolume(guildId, delta) {
  const queue = queues.get(guildId);
  if (!queue || !queue.currentlyPlaying) {
    throw new Error('Tidak ada musik yang sedang diputar.');
  }

  return applyVolume(queue, queue.volume + delta);
}

export async function setVolume(guildId, volume) {
  const queue = queues.get(guildId);
  if (!queue || !queue.currentlyPlaying) {
    throw new Error('Tidak ada musik yang sedang diputar.');
  }

  return applyVolume(queue, volume);
}

export function stopMusic(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return false;

  if (queue.progressInterval) {
    clearInterval(queue.progressInterval);
    queue.progressInterval = null;
  }

  clearDisconnectTimeout(queue);

  hidePlayerPanel(queue, 'Musik dihentikan. Control panel ditutup.');

  queue.songs = [];
  queue.currentlyPlaying = null;
  queue.isPaused = false;

  if (queue.backend === 'native') {
    try {
      native.destroyNativeSession(queue);
    } catch (err) {
      logError('Native Destroy Error', err);
    }
    native.releaseNativeClients();
  } else {
    // Cegah event 'end' dari player lama memajukan antrean yang sudah dihapus
    queue._skipRequested = false;
    try { queue.player?.removeAllListeners(); } catch { /* abaikan */ }

    try {
      if (shoukaku) shoukaku.leaveVoiceChannel(guildId);
    } catch (err) {
      logError('Shoukaku Leave Error', err);
    }
  }

  queues.delete(guildId);
  return true;
}

export function cleanupAll() {
  for (const [guildId] of queues) {
    stopMusic(guildId);
  }
  if (shoukaku) {
    for (const [, node] of shoukaku.nodes) {
      node.disconnect();
    }
  }
}

export function formatDuration(ms) {
  if (!ms || isNaN(ms)) return 'Live / N/A';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}
