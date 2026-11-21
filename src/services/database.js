// ============================================
// database.js - Resilient Prisma layer (Neon/PostgreSQL)
//
// Masalah yang diselesaikan:
//  1. Neon (dan PostgreSQL serverless lain) memakai compute yang di-suspend
//     saat idle. Query pertama setelah idle harus menunggu compute bangun
//     (~5-7 detik). Prisma default connect_timeout hanya 5 detik, sehingga
//     query pertama gagal dengan:
//       "Can't reach database server at ..."
//     Solusi: connect_timeout dinaikkan (bisa dioverride lewat env) + retry.
//  2. Connection pool bisa memegang socket yang sudah ditutup server
//     (P1017 "Server has closed the connection"). Query seperti itu dicoba
//     ulang otomatis setelah koneksi dibangun kembali.
//
// Semua model Prisma dibungkus Proxy sehingga setiap operasi
// (prisma.player.findUnique, prisma.lavalinkNode.findMany, dst.) otomatis
// mendapat retry tanpa perlu mengubah seluruh command.
// ============================================
import prismaPkg from '@prisma/client';
const { PrismaClient } = prismaPkg;
import { logError } from '../utils/errorManager.js';
import { normalizeDatabaseUrl } from '../utils/dbUrl.js';

export { normalizeDatabaseUrl };

// Kode error Prisma yang menandakan masalah koneksi/pool (bukan bug query)
const CONNECTION_ERROR_CODES = new Set([
  'P1000', // auth gagal (bisa terjadi saat compute belum siap)
  'P1001', // Can't reach database server
  'P1002', // database server timeout
  'P1008', // operasi timeout
  'P1010', // user ditolak
  'P1017', // server menutup koneksi
  'P2024', // connection pool timeout
]);

const CONNECTION_ERROR_HINTS = [
  "can't reach database server",
  'cannot reach database server',
  'server has closed the connection',
  'connection terminated',
  'connection timed out',
  'connection timeout',
  'connection refused',
  'connection reset',
  'econnrefused',
  'econnreset',
  'etimedout',
  'socket hang up',
  'connection pool timed out',
  'too many clients',
  'database is starting up',
];

/** Apakah error ini masalah koneksi yang layak dicoba ulang? */
export function isConnectionError(error) {
  if (!error) return false;
  if (CONNECTION_ERROR_CODES.has(error.code)) return true;
  const message = String(error.message || error).toLowerCase();
  return CONNECTION_ERROR_HINTS.some((hint) => message.includes(hint));
}

// Deadlock/serialization failure: aman dicoba ulang (transaksi dibatalkan server)
const RETRYABLE_CODES = new Set(['P2034', '40001', '40P01']);

export function isRetryableError(error) {
  return isConnectionError(error) || RETRYABLE_CODES.has(error?.code);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPrismaClient() {
  return new PrismaClient({
    datasourceUrl: normalizeDatabaseUrl(),
  });
}

/**
 * Jalankan operasi database dengan retry untuk error koneksi sementara.
 */
export async function withDbRetry(operation, { retries = 3, baseDelayMs = 500, client = null } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempt === retries) throw error;

      console.warn(
        `⚠️ Database sementara tidak tersedia (${error.code || error.name || 'connection error'}), ` +
        `mencoba ulang ${attempt}/${retries - 1}...`
      );

      // Bangun ulang koneksi bila pool memegang socket yang sudah mati.
      if (client && isConnectionError(error)) {
        try { await client.$connect(); } catch { /* dicoba lagi di bawah */ }
      }

      await delay(baseDelayMs * attempt);
    }
  }
  throw lastError;
}

/**
 * Bungkus PrismaClient: semua method delegate model otomatis retry.
 * Method `$transaction`/`$queryRaw` sengaja TIDAK di-retry agar transaksi
 * tidak dieksekusi dua kali; command tetap bisa memanggilnya langsung.
 */
export function createResilientPrisma() {
  const client = createPrismaClient();
  const wrappedDelegates = new Map();

  const wrapDelegate = (delegate) => new Proxy(delegate, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args) => withDbRetry(() => value.apply(target, args), { client });
    },
  });

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'then') return undefined;

      // Method internal Prisma ($connect, $disconnect, $transaction, $queryRaw,
      // $on, ...) diteruskan apa adanya.
      if (typeof prop === 'string' && prop.startsWith('$')) {
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      }

      const value = Reflect.get(target, prop, receiver);
      if (value && typeof value === 'object') {
        if (!wrappedDelegates.has(value)) wrappedDelegates.set(value, wrapDelegate(value));
        return wrappedDelegates.get(value);
      }
      return value;
    },
  });
}

/**
 * Coba hubungkan ke database saat startup dengan beberapa percobaan.
 * TIDAK pernah membuat proses berhenti: bot tetap online dan query akan
 * dicoba ulang otomatis lewat withDbRetry saat dibutuhkan.
 */
export async function connectDatabase(client, { attempts = 4, delayMs = 1500 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const startedAt = Date.now();
    try {
      await client.$connect();
      await client.$queryRawUnsafe('SELECT 1');
      console.log(`🗄️ Database terhubung (${Date.now() - startedAt}ms).`);
      return true;
    } catch (error) {
      logError(`Database Connect (percobaan ${attempt}/${attempts})`, error);
      if (attempt === attempts) {
        console.warn(
          '⚠️ Database belum bisa dijangkau. Bot tetap berjalan; ' +
          'setiap query akan dicoba ulang otomatis ketika database sudah bangun.'
        );
        return false;
      }
      await delay(delayMs * attempt);
    }
  }
  return false;
}
