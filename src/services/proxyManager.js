// ============================================
// proxyManager.js - Auto Proxy untuk Engine Native (youtubei.js)
//
// Tujuan: production tidak perlu hardcode YOUTUBE_PROXY. Bot mengambil daftar
// proxy HTTP publik, menguji mana yang benar-benar bisa menjangkau YouTube,
// lalu memakai proxy sehat tersebut. Jika YOUTUBE_PROXY diisi, nilai itu tetap
// diprioritaskan (override manual).
//
// Catatan: undici ProxyAgent hanya mendukung proxy HTTP/HTTPS, bukan SOCKS.
// ============================================
import { ProxyAgent } from 'undici';
import { logError } from '../utils/errorManager.js';

// Sumber proxy HTTP publik (plain text / JSON).
const PROXY_SOURCES = [
  'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt',
  'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
  'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt',
  'https://raw.githubusercontent.com/proxy4parsing/proxy-list/main/http.txt',
];

// Target uji: endpoint ringan milik YouTube/Google. Proxy harus bisa CONNECT
// ke HTTPS dan mengembalikan 200/204 agar dianggap sehat.
const TEST_TARGETS = [
  'https://www.youtube.com/generate_204',
  'https://www.google.com/generate_204',
];

const SOURCE_TIMEOUT_MS = 9000;
const TEST_TIMEOUT_MS = 3500;
const TEST_CONCURRENCY = 24;
const MAX_CANDIDATES = 120;
const POOL_MAX = 8;
const REFRESH_TTL_MS = 10 * 60 * 1000;

let staticProxy = normalizeProxy(process.env.YOUTUBE_PROXY);
let activeUrl = null;
let activeDispatcher = null;
let pool = [];
let lastRefresh = 0;
let lastError = null;
let refreshPromise = null;

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
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
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
    activeDispatcher = new ProxyAgent({
      uri: activeUrl,
      connectTimeout: 15000,
      headersTimeout: 30000,
      bodyTimeout: 0,
    });
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
  };
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
    for (const proxy of result.value) {
      unique.add(proxy);
      if (unique.size >= MAX_CANDIDATES) break;
    }
    if (unique.size >= MAX_CANDIDATES) break;
  }

  return [...unique];
}

async function testProxy(proxyUrl) {
  let dispatcher;

  try {
    dispatcher = new ProxyAgent({
      uri: proxyUrl,
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

        if (response.status === 200 || response.status === 204) return true;
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

async function findWorkingProxies(candidates) {
  const working = [];
  let index = 0;

  const workers = Array.from(
    { length: Math.min(TEST_CONCURRENCY, candidates.length) },
    async () => {
      while (index < candidates.length && working.length < POOL_MAX) {
        const proxy = candidates[index++];
        if (await testProxy(proxy)) {
          // Beberapa worker bisa selesai bersamaan; cek lagi sebelum push agar
          // pool tidak melebihi batas.
          if (working.length >= POOL_MAX) break;
          working.push(proxy);
          console.log(`✅ Proxy lolos uji YouTube: ${maskProxy(proxy)} (${working.length}/${POOL_MAX})`);
        }
      }
    }
  );

  await Promise.all(workers);
  return working;
}

async function refreshPool() {
  lastRefresh = Date.now();

  try {
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
      return;
    }

    pool = working;
    lastError = null;

    if (!activeUrl || !working.includes(activeUrl)) {
      setActive(working[0]);
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

  // Refresh terakhir sudah selesai (termasuk gagal) dan belum kedaluwarsa:
  // jangan mengulang health-check di setiap request.
  if (!force && !refreshPromise && lastRefresh && (Date.now() - lastRefresh) < REFRESH_TTL_MS) {
    return activeUrl;
  }

  if (!refreshPromise) {
    refreshPromise = refreshPool().finally(() => {
      refreshPromise = null;
    });
  }

  if (waitMs > 0) {
    await Promise.race([refreshPromise, delay(waitMs)]);
  }

  return activeUrl;
}

/**
 * Laporkan proxy aktif yang gagal. Proxy dibuang dari pool lalu diganti dengan
 * kandidat sehat berikutnya. Refresh baru dijadwalkan jika pool habis.
 */
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

  console.log('🌐 Auto proxy native: mencari proxy sehat untuk YouTube di background...');
  return ensureProxyReady({ waitMs: 0 }).catch(() => null);
}
