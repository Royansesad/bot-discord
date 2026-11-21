// ============================================
// proxyManager.js - Auto Proxy untuk Engine Native (youtubei.js)
//
// Tujuan: production tidak perlu hardcode YOUTUBE_PROXY. Bot mengambil daftar
// proxy HTTP publik, menguji mana yang benar-benar bisa menjangkau YouTube,
// lalu memakai proxy sehat tersebut. Jika YOUTUBE_PROXY diisi, nilai itu tetap
// diprioritaskan (override manual).
//
// Sejak update ini SOCKS5 juga didukung lewat paket `socks` + connector undici
// kustom (ProxyAgent bawaan undici HANYA mendukung http/https).
// `socks` adalah paket CommonJS — di-import lewat default import agar aman di
// project ESM ("type": "module"), sama seperti pola @prisma/client di index.js.
// ============================================
import { connect as netConnect } from 'node:net';
import { Agent, ProxyAgent } from 'undici';
import socksPkg from 'socks';
import { logError } from '../utils/errorManager.js';

const { SocksClient } = socksPkg;

// Sumber proxy publik. Teks biasa maupun JSON didukung oleh extractProxyLines().
const PROXY_SOURCES = [
  'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt',
  'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/socks5/data.txt',
  'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
  'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt',
  'https://raw.githubusercontent.com/proxy4parsing/proxy-list/main/http.txt',
  // Daftar proxy yang mendukung HTTPS CONNECT (lebih relevan untuk YouTube).
  'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/https/data.txt',
  // API dengan filter "baru dicek" (JSON: data[].ip + port).
  'https://proxylist.geonode.com/api/proxy-list?limit=200&page=1&sort_by=lastChecked&sort_type=desc&protocols=http%2Chttps',
  // API yang mengembalikan proxy baru tiap request (JSON: data[].ipPort / ip+port).
  'http://pubproxy.com/api/proxy?limit=10',
];

// Target uji: endpoint ringan milik YouTube/Google. Proxy harus bisa CONNECT
// ke HTTPS dan mengembalikan 200/204 agar dianggap sehat.
const TEST_TARGETS = [
  'https://www.youtube.com/generate_204',
  'https://www.google.com/generate_204',
];

const SOURCE_TIMEOUT_MS = 9000;
// Proxy gratis butuh waktu handshake lebih longgar; sebelumnya 3.5s membuat
// proxy yang lambat (tapi hidup) ikut gagal.
const TEST_TIMEOUT_MS = 5000;
const TEST_CONCURRENCY = 60;
// Ambil lebih banyak kandidat lalu acak: 120 kandidat pertama selalu berasal
// dari kepala daftar yang sudah mati, sehingga tidak pernah ada yang lolos.
const MAX_CANDIDATES = 600;
const POOL_MAX = 8;
const REFRESH_TTL_MS = 10 * 60 * 1000;
// Jika tidak ada proxy yang lolos, jangan diam 10 menit: coba lagi lebih cepat.
const NO_PROXY_RETRY_MS = 2 * 60 * 1000;
const DIRECT_PROBE_TTL_MS = 60 * 1000;

let staticProxy = normalizeProxy(process.env.YOUTUBE_PROXY);
let activeUrl = null;
let activeDispatcher = null;
let pool = [];
let lastRefresh = 0;
let lastError = null;
let refreshPromise = null;

// Status koneksi langsung (tanpa proxy). Jika YouTube DAN host media
// (googlevideo) bisa dijangkau langsung, proxy tidak diperlukan sama sekali.
let directProbe = { checkedAt: 0, youtube: false, googleVideo: false };
let directProbePromise = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function autoEnabled() {
  return String(process.env.YOUTUBE_PROXY_AUTO || 'true').trim().toLowerCase() !== 'false';
}

/** Normalisasi input proxy menjadi http(s)://host:port. */
export function normalizeProxy(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;

  let candidate = value;
  if (!/^[a-z]+:\/\//i.test(candidate)) candidate = `http://${candidate}`;

  try {
    const url = new URL(candidate);
    const supported = ['http:', 'https:', 'socks5:', 'socks4:'];
    if (!supported.includes(url.protocol)) return null;
    if (!url.hostname || !url.port) return null;
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

    const credentials = url.username
      ? `${url.username}${url.password ? `:${url.password}` : ''}@`
      : '';

    return `${url.protocol}//${credentials}${url.hostname}:${url.port}`;
  } catch {
    return null;
  }
}

function isSocksProxy(url) {
  return /^socks[45]:/i.test(String(url || ''));
}

/** Ubah "socks5://host:port" menjadi opsi proxy yang dipakai SocksClient. */
function socksOptions(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port),
    type: parsed.protocol === 'socks4:' ? 4 : 5,
    userId: parsed.username || undefined,
    password: parsed.password || undefined,
  };
}

/**
 * Buat dispatcher undici untuk http/httpS (ProxyAgent) maupun SOCKS4/5 (Agent
 * dengan connector kustom). Satu fungsi ini dipakai baik untuk tes maupun
 * pemutaran supaya perilakunya identik.
 */
function createDispatcher(proxyUrl, { connectTimeout = 15000, headersTimeout = 30000, bodyTimeout = 0 } = {}) {
  if (!proxyUrl) return null;

  if (!isSocksProxy(proxyUrl)) {
    return new ProxyAgent({ uri: proxyUrl, connectTimeout, headersTimeout, bodyTimeout });
  }

  const proxy = socksOptions(proxyUrl);
  return new Agent({
    connect: (opts, callback) => {
      // undici mengirim port sebagai string kosong untuk URL HTTPS.
      const port = Number(opts.port) || (opts.protocol === 'https:' ? 443 : 80);
      SocksClient.createConnection({
        proxy,
        command: 'connect',
        destination: { host: opts.hostname, port },
        timeout: connectTimeout,
      })
        .then(({ socket }) => callback(null, socket))
        .catch(callback);
    },
    connectTimeout,
    headersTimeout,
    bodyTimeout,
  });
}

function maskProxy(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}:${parsed.port}`;
  } catch {
    return 'invalid';
  }
}

export function getStaticProxy() {
  return staticProxy;
}

export function isAutoProxyEnabled() {
  return autoEnabled();
}

export function isProxyActive() {
  return Boolean(activeUrl);
}

export function getActiveProxyUrl() {
  return activeUrl;
}

/**
 * Dispatcher proxy yang sedang aktif. Dibuat ulang saat proxy berganti.
 * bodyTimeout dimatikan agar unduhan media panjang tidak terpotong.
 */
export function getProxyDispatcher() {
  if (!activeUrl) return null;
  if (activeDispatcher) return activeDispatcher;

  try {
    activeDispatcher = createDispatcher(activeUrl);
    return activeDispatcher;
  } catch (err) {
    lastError = err?.message || String(err);
    activeUrl = null;
    activeDispatcher = null;
    return null;
  }
}

export function getProxyStatus() {
  const mode = staticProxy ? 'static' : (autoEnabled() ? 'auto' : 'disabled');
  return {
    mode,
    active: maskProxy(activeUrl),
    poolSize: pool.length,
    lastRefresh: lastRefresh ? new Date(lastRefresh).toISOString() : null,
    lastError,
    direct: {
      youtube: directProbe.youtube,
      googleVideo: directProbe.googleVideo,
      checkedAt: directProbe.checkedAt ? new Date(directProbe.checkedAt).toISOString() : null,
    },
  };
}

function tcpReachable(host, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const socket = netConnect({ host, port });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function probeDirectOnce() {
  let youtube = false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch('https://www.youtube.com/generate_204', {
      signal: controller.signal,
      headers: { 'User-Agent': 'DiscordBot-ProxyProbe/1.0' },
    });
    await response.body?.cancel().catch(() => {});
    youtube = response.status > 0 && response.status < 500;
  } catch {
    youtube = false;
  } finally {
    clearTimeout(timer);
  }

  // Host media YouTube. Jika ini bisa dijangkau langsung, proxy tidak perlu.
  const googleVideo = youtube ? await tcpReachable('googlevideo.com', 443, 4000) : false;

  directProbe = { checkedAt: Date.now(), youtube, googleVideo };
  return directProbe;
}

/**
 * Cek apakah koneksi langsung (tanpa proxy) bisa menjangkau YouTube dan host
 * media-nya. Hasil di-cache 60 detik agar tidak menambah delay setiap request.
 */
export async function probeDirect({ force = false } = {}) {
  if (!force && directProbe.checkedAt && Date.now() - directProbe.checkedAt < DIRECT_PROBE_TTL_MS) {
    return directProbe;
  }

  if (!directProbePromise) {
    directProbePromise = probeDirectOnce().finally(() => {
      directProbePromise = null;
    });
  }

  return directProbePromise;
}

function probeDirectWithin(ms) {
  return Promise.race([
    probeDirect(),
    new Promise((resolve) => setTimeout(() => resolve(directProbe), ms)),
  ]);
}

function setActive(url) {
  if (activeUrl === url) return;

  const previous = activeDispatcher;
  activeDispatcher = null;
  activeUrl = url || null;

  if (previous) {
    try { previous.destroy(); } catch { /* abaikan */ }
  }

  if (activeUrl) {
    console.log(`🌐 Proxy native aktif: ${maskProxy(activeUrl)}`);
  }
}

function extractProxyLines(payload) {
  const lines = [];

  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (typeof item === 'string') lines.push(item);
      else if (item && typeof item === 'object') {
        // Sebagian API memakai { ip, port }, sebagian { ipPort: "ip:port" },
        // sebagian { proxy: "ip:port" } (pubproxy).
        const hostPort = item.ipPort || item.proxy || item.ip_port;
        if (typeof hostPort === 'string' && hostPort.includes(':')) {
          lines.push(hostPort);
          continue;
        }
        const host = item.host || item.ip || item.address;
        const port = item.port;
        if (host && port) lines.push(`${host}:${port}`);
      }
    }
    return lines;
  }

  if (payload && typeof payload === 'object') {
    const list = payload.proxies || payload.data || payload.results;
    if (list) return extractProxyLines(list);
    return lines;
  }

  const text = String(payload || '');
  if (!text.trim()) return lines;

  // Sebagian sumber mengirim JSON walau content-type-nya text/plain.
  if (text.trim().startsWith('[') || text.trim().startsWith('{')) {
    try {
      return extractProxyLines(JSON.parse(text));
    } catch {
      // lanjut sebagai teks biasa
    }
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    // Format JSON per baris: {"proxy":"1.2.3.4:8080"}
    if (line.startsWith('{')) {
      try {
        const obj = JSON.parse(line);
        const value = obj.proxy || obj.ip || obj.host;
        const port = obj.port;
        if (value && port) lines.push(`${value}:${port}`);
        else if (typeof value === 'string') lines.push(value);
        continue;
      } catch {
        // abaikan baris rusak
      }
    }
    lines.push(line);
  }

  return lines;
}

async function fetchSource(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);

  try {
    const response = await fetch(source, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'DiscordBot-ProxyFetcher/1.0',
        'Accept': 'text/plain, application/json, */*',
      },
    });

    if (!response.ok) return [];

    const text = await response.text();
    return extractProxyLines(text)
      .map(normalizeProxy)
      .filter(Boolean);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function collectCandidates() {
  const results = await Promise.allSettled(PROXY_SOURCES.map(fetchSource));
  const unique = new Set();

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const proxy of result.value) unique.add(proxy);
  }

  const candidates = [...unique];

  // Acak sebelum dibatasi: kandidat dari kepala daftar publik hampir selalu
  // sudah mati, sehingga tanpa pengacakan tidak ada yang pernah lolos uji.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  return candidates.slice(0, MAX_CANDIDATES);
}

/**
 * Uji apakah proxy bisa menjangkau googlevideo.com:443 — host tempat file audio
 * YouTube diunduh. Di host dengan ISP/DNS yang memblokir googlevideo, tes
 * youtube.com/generate_204 saja tidak cukup (proxy bisa lolos itu tapi tetap
 * gagal saat streaming).
 */
function canReachGoogleVideo(proxyUrl) {
  const timeout = TEST_TIMEOUT_MS + 1500;

  if (isSocksProxy(proxyUrl)) {
    return SocksClient.createConnection({
      proxy: socksOptions(proxyUrl),
      command: 'connect',
      destination: { host: 'googlevideo.com', port: 443 },
      timeout,
    })
      .then(({ socket }) => { socket.destroy(); return true; })
      .catch(() => false);
  }

  return new Promise((resolve) => {
    const parsed = new URL(proxyUrl);
    const socket = netConnect({ host: parsed.hostname, port: Number(parsed.port) });
    let settled = false;
    let buffer = '';

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeout);

    socket.once('connect', () => {
      const auth = parsed.username
        ? `Proxy-Authorization: Basic ${Buffer.from(
            `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`
          ).toString('base64')}\r\n`
        : '';
      socket.write(
        `CONNECT googlevideo.com:443 HTTP/1.1\r\n` +
        `Host: googlevideo.com:443\r\n${auth}\r\n`
      );
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      if (/^HTTP\/1\.[01] 200\b/.test(buffer)) finish(true);
      else if (/^HTTP\/1\.[01] \d{3}\b/.test(buffer)) finish(false);
    });
    socket.once('error', () => finish(false));
    socket.once('close', () => finish(false));
  });
}

/** Uji satu proxy: apakah bisa mengambil HTTPS YouTube? */
async function fetchViaProxy(proxyUrl) {
  let dispatcher;

  try {
    dispatcher = createDispatcher(proxyUrl, {
      connectTimeout: TEST_TIMEOUT_MS,
      headersTimeout: TEST_TIMEOUT_MS,
      bodyTimeout: TEST_TIMEOUT_MS,
    });
  } catch {
    return false;
  }

  try {
    for (const target of TEST_TARGETS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

      try {
        const response = await fetch(target, {
          method: 'GET',
          dispatcher,
          signal: controller.signal,
          redirect: 'manual',
        });

        await response.body?.cancel().catch(() => {});

        if (response.status >= 200 && response.status < 400) return true;
      } catch {
        // coba target berikutnya
      } finally {
        clearTimeout(timer);
      }
    }

    return false;
  } finally {
    // destroy() menutup paksa; close() bisa menunggu koneksi proxy yang macet
    // dan membuat proses refresh menggantung.
    try { dispatcher.destroy(); } catch { /* abaikan */ }
  }
}

/**
 * Uji proxy. YouTube diuji lebih dulu (murah); kemampuan CONNECT ke
 * googlevideo hanya dipakai sebagai NILAI TAMBAHAN, bukan syarat mutlak.
 * Sebelumnya syarat CONNECT ini membuang 100% proxy publik yang sebenarnya
 * bisa dipakai untuk pencarian YouTube.
 */
async function testProxy(proxyUrl) {
  const youtubeOk = await fetchViaProxy(proxyUrl);
  if (!youtubeOk) return { ok: false, video: false };

  const video = await canReachGoogleVideo(proxyUrl);
  return { ok: true, video };
}

async function findWorkingProxies(candidates) {
  const working = [];
  let index = 0;

  const workers = Array.from(
    { length: Math.min(TEST_CONCURRENCY, candidates.length) },
    async () => {
      while (index < candidates.length) {
        // Ambil lebih dari POOL_MAX lalu urutkan: proxy yang bisa menjangkau
        // googlevideo dipakai lebih dulu untuk streaming media.
        if (working.length >= POOL_MAX * 2) break;
        const proxy = candidates[index++];
        const result = await testProxy(proxy);
        if (result.ok) {
          if (working.length >= POOL_MAX * 2) break;
          working.push({ url: proxy, video: result.video });
          console.log(
            `✅ Proxy lolos uji YouTube: ${maskProxy(proxy)}` +
            `${result.video ? ' (+googlevideo)' : ''} (${working.length})`
          );
        }
      }
    }
  );

  await Promise.all(workers);

  working.sort((a, b) => Number(b.video) - Number(a.video));
  return working.slice(0, POOL_MAX);
}

async function refreshPool() {
  lastRefresh = Date.now();

  try {
    // Probe koneksi langsung bisa selesai setelah race 3 detik. Jika ternyata
    // sehat, batalkan scraping ratusan proxy yang tidak diperlukan.
    if (directProbe.youtube && directProbe.googleVideo) return;

    const candidates = await collectCandidates();

    if (candidates.length === 0) {
      lastError = 'Tidak ada proxy yang bisa diambil dari sumber publik';
      console.warn('⚠️ Auto proxy: tidak ada kandidat proxy dari sumber publik.');
      return;
    }

    console.log(`🔎 Auto proxy: menguji ${candidates.length} kandidat proxy...`);
    const working = await findWorkingProxies(candidates);

    if (working.length === 0) {
      lastError = 'Semua kandidat proxy gagal diuji ke YouTube';
      console.warn('⚠️ Auto proxy: tidak ada proxy yang lolos uji. Engine native akan memakai koneksi langsung.');
      // Buang pool lama yang sudah kedaluwarsa supaya tidak dipakai terus.
      pool = [];
      setActive(null);
      return;
    }

    const urls = working.map((item) => item.url);
    pool = urls;
    lastError = null;

    const videoCapable = working.filter((item) => item.video).length;
    console.log(`✅ Auto proxy: ${urls.length} proxy lolos uji (${videoCapable} bisa menjangkau googlevideo).`);

    // Probe langsung bisa selesai saat scan berjalan. Jika koneksi langsung
    // ternyata sehat, JANGAN aktifkan proxy: proxy publik yang lambat akan
    // memperlambat pencarian/pemutaran tanpa manfaat.
    if (directProbe.youtube && directProbe.googleVideo) {
      console.log('🌐 Koneksi langsung sehat — proxy disimpan di pool tetapi tidak diaktifkan.');
      if (activeUrl) setActive(null);
      return;
    }

    if (!activeUrl || !urls.includes(activeUrl)) {
      setActive(urls[0]);
    }
  } catch (err) {
    lastError = err?.message || String(err);
    logError('Auto Proxy Refresh', err);
  }
}

/**
 * Pastikan proxy siap dipakai. Pada panggilan pertama proses refresh berjalan
 * di background; pemanggil menunggu maksimal `waitMs` agar /play tidak tertahan
 * terlalu lama. Jika belum ada proxy sehat, request tetap memakai koneksi langsung.
 */
export async function ensureProxyReady({ force = false, waitMs = 8000 } = {}) {
  if (staticProxy) {
    if (activeUrl !== staticProxy) setActive(staticProxy);
    return activeUrl;
  }

  if (!autoEnabled()) {
    if (activeUrl) setActive(null);
    return null;
  }

  // Proxy aktif masih dianggap segar.
  if (!force && activeUrl && (Date.now() - lastRefresh) < REFRESH_TTL_MS) {
    return activeUrl;
  }

  // Periksa koneksi langsung lebih dulu. Jika YouTube DAN host media bisa
  // dijangkau tanpa proxy, proxy tidak diperlukan sama sekali — ini mencegah
  // bot menunggu 35 detik men-scan ratusan proxy mati setiap kali start.
  const direct = await probeDirectWithin(Math.min(waitMs, 3000));
  if (direct.youtube && direct.googleVideo) {
    if (activeUrl) setActive(null);
    pool = [];
    lastError = null;
    lastRefresh = Date.now();
    return null;
  }

  // Refresh terakhir sudah selesai (termasuk gagal) dan belum kedaluwarsa:
  // jangan mengulang health-check di setiap request. Saat tidak ada proxy
  // yang lolos, coba lagi lebih cepat (2 menit), bukan 10 menit.
  const retryWindow = pool.length > 0 ? REFRESH_TTL_MS : NO_PROXY_RETRY_MS;
  if (!force && !refreshPromise && lastRefresh && (Date.now() - lastRefresh) < retryWindow) {
    return activeUrl;
  }

  if (!refreshPromise) {
    refreshPromise = refreshPool().finally(() => {
      refreshPromise = null;
    });
  }

  if (waitMs > 0) {
    // Jangan menahan command menunggu scan 600 proxy (bisa >1 menit). Scan
    // tetap berjalan di background; request memakai koneksi langsung sampai
    // proxy sehat tersedia.
    await Promise.race([refreshPromise, delay(Math.min(waitMs, 1500))]);
  }

  return activeUrl;
}

/**
 * Laporkan proxy aktif yang gagal. Proxy dibuang dari pool lalu diganti dengan
 * kandidat sehat berikutnya. Refresh baru dijadwalkan jika pool habis.
 */
/**
 * Aktifkan proxy dari pool saat koneksi langsung gagal mengambil media
 * (mis. googlevideo diblokir/DNS di-hijack). Mengembalikan true jika proxy
 * berhasil diaktifkan.
 */
export function activatePooledProxy() {
  if (staticProxy || activeUrl || pool.length === 0) return false;

  setActive(pool[0]);
  // Tandai segar supaya ensureProxyReady tidak langsung melepasnya kembali.
  lastRefresh = Date.now();
  console.log(`🌐 Proxy dari pool diaktifkan untuk media: ${maskProxy(pool[0])}`);
  return true;
}

export function reportProxyFailure(url = activeUrl) {
  if (!url || url !== activeUrl) return;
  if (staticProxy) {
    console.warn(`⚠️ Proxy statis gagal dipakai: ${maskProxy(url)}. Cek YOUTUBE_PROXY.`);
    return;
  }

  console.warn(`⚠️ Proxy ${maskProxy(url)} gagal, mencari pengganti...`);
  pool = pool.filter((proxy) => proxy !== url);

  if (pool.length > 0) {
    setActive(pool[0]);
    return;
  }

  setActive(null);
  lastRefresh = 0;
  // Jangan menahan request yang sedang berjalan; refresh berjalan di background.
  ensureProxyReady({ force: true, waitMs: 0 }).catch(() => {});
}

let autoRefreshTimer = null;

/** Pemanasan proxy saat startup (non-blocking). */
export function warmProxy() {
  if (staticProxy) {
    console.log(`🌐 Engine native memakai proxy statis: ${maskProxy(staticProxy)}`);
    return Promise.resolve(staticProxy);
  }

  if (!autoEnabled()) {
    console.log('🌐 Auto proxy native dimatikan (YOUTUBE_PROXY_AUTO=false).');
    return Promise.resolve(null);
  }

  // Auto-scraping berkala: proxy gratis cepat kedaluwarsa. Refresh paksa tiap
  // TTL supaya pool selalu berisi kandidat baru tanpa menunggu ada lagu gagal.
  if (!autoRefreshTimer) {
    autoRefreshTimer = setInterval(() => {
      console.log('🔄 Auto proxy: scrape ulang berkala (TTL)...');
      ensureProxyReady({ force: true, waitMs: 0 }).catch(() => {});
    }, REFRESH_TTL_MS);
    autoRefreshTimer.unref?.();
  }

  // Cek koneksi langsung dulu: jika sehat, engine native berjalan tanpa proxy
  // (lebih cepat dan lebih stabil daripada proxy publik gratis).
  return probeDirect()
    .then((probe) => {
      if (probe.youtube && probe.googleVideo) {
        console.log('🌐 Koneksi langsung YouTube + googlevideo sehat — auto proxy tidak diperlukan.');
        lastRefresh = Date.now();
        return null;
      }

      console.log('🌐 Koneksi langsung tidak lengkap — mencari proxy sehat di background...');
      return ensureProxyReady({ waitMs: 0 }).catch(() => null);
    })
    .catch(() => ensureProxyReady({ waitMs: 0 }).catch(() => null));
}
