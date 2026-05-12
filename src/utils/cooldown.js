// ============================================
// cooldown.js - Cooldown Manager (Database-backed)
// ============================================

/**
 * Cek cooldown untuk user + action
 * @returns {number} Sisa detik cooldown, 0 jika sudah bisa
 */
export async function checkCooldown(prisma, userId, action, cooldownSeconds) {
  const record = await prisma.cooldown.findFirst({
    where: {
      player: { userId },
      action,
    },
  });

  if (!record) return 0;

  const now = new Date();
  const remaining = Math.ceil((record.expiresAt.getTime() - now.getTime()) / 1000);
  return remaining > 0 ? remaining : 0;
}

/**
 * Set cooldown untuk user + action
 */
export async function setCooldown(prisma, userId, action, cooldownSeconds) {
  // Cari player record
  const player = await prisma.player.findUnique({ where: { userId } });
  if (!player) return; // Skip jika belum register RPG

  const expiresAt = new Date(Date.now() + cooldownSeconds * 1000);

  await prisma.cooldown.upsert({
    where: {
      playerId_action: {
        playerId: player.id,
        action,
      },
    },
    update: { expiresAt },
    create: {
      playerId: player.id,
      action,
      expiresAt,
    },
  });
}

/**
 * Cek cooldown langsung dari player ID (bukan user ID)
 * Dipakai internal untuk RPG commands
 */
export async function checkPlayerCooldown(prisma, playerId, action, cooldownSeconds) {
  const record = await prisma.cooldown.findUnique({
    where: {
      playerId_action: { playerId, action },
    },
  });

  if (!record) return 0;

  const now = new Date();
  const remaining = Math.ceil((record.expiresAt.getTime() - now.getTime()) / 1000);
  return remaining > 0 ? remaining : 0;
}

/**
 * Set cooldown dari player ID
 */
export async function setPlayerCooldown(prisma, playerId, action, cooldownSeconds) {
  const expiresAt = new Date(Date.now() + cooldownSeconds * 1000);

  await prisma.cooldown.upsert({
    where: {
      playerId_action: { playerId, action },
    },
    update: { expiresAt },
    create: {
      playerId,
      action,
      expiresAt,
    },
  });
}

/**
 * Hapus cooldown
 */
export async function clearCooldown(prisma, playerId, action) {
  await prisma.cooldown.deleteMany({
    where: { playerId, action },
  });
}

/**
 * Format detik ke string readable
 */
export function formatCooldown(seconds) {
  if (seconds >= 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h} jam ${m} menit`;
  }
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h} jam ${m} menit`;
  }
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m} menit ${s} detik`;
  }
  return `${seconds} detik`;
}
