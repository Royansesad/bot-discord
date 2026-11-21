// ============================================
// dbUrl.js - Normalisasi connection string database
//
// Dipakai bot (src/services/database.js) DAN script CLI (seed/migrasi) supaya
// keduanya memakai connect_timeout yang cukup untuk Neon yang bangun dari idle.
// Tidak mengimpor config.js agar aman dijalankan tanpa DISCORD_TOKEN.
// ============================================

const DEFAULT_CONNECT_TIMEOUT = 30; // detik
const DEFAULT_POOL_TIMEOUT = 30;    // detik
const DEFAULT_CONNECTION_LIMIT = 5;

/**
 * Lengkapi DATABASE_URL dengan parameter koneksi aman.
 * Nilai yang sudah diisi user tidak ditimpa.
 */
export function normalizeDatabaseUrl(raw = process.env.DATABASE_URL) {
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);

    if (!isLocal && !url.searchParams.has('sslmode')) {
      url.searchParams.set('sslmode', 'require');
    }
    if (!url.searchParams.has('connect_timeout')) {
      url.searchParams.set('connect_timeout', String(DEFAULT_CONNECT_TIMEOUT));
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', String(DEFAULT_POOL_TIMEOUT));
    }
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', String(DEFAULT_CONNECTION_LIMIT));
    }

    return url.toString();
  } catch {
    // URL tidak bisa di-parse: biarkan Prisma yang melaporkan errornya.
    return raw;
  }
}
