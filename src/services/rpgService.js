// ============================================
// rpgService.js - Core RPG Game Logic
// ============================================
import { xpForLevel, checkLevelUp, randomInt, randomPick, randomChance, weightedRandom, formatGold } from '../utils/helpers.js';
import config from '../config.js';

/**
 * Dapatkan atau buat player baru
 */
export async function getPlayer(prisma, userId) {
  return prisma.player.findUnique({ where: { userId } });
}

/**
 * Registrasi player baru
 */
export async function registerPlayer(prisma, userId, username) {
  return prisma.player.create({
    data: {
      userId,
      username,
      level: 1,
      xp: 0,
      xpToNext: 100,
      gold: 100,
      hp: 100,
      maxHp: 100,
      attack: 10,
      defense: 5,
      critRate: 0.05,
      critDmg: 1.5,
    },
  });
}

/**
 * Tambah XP dan handle level up
 * @returns {{ leveled: boolean, newLevel: number, statGains: object }}
 */
export async function addXp(prisma, playerId, amount) {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) return null;

  const updatedXp = player.xp + amount;
  const tempPlayer = { ...player, xp: updatedXp };
  const levelResult = checkLevelUp(tempPlayer);

  const updateData = {
    xp: levelResult.leveled ? levelResult.newXp : updatedXp,
    xpToNext: levelResult.leveled ? levelResult.newXpToNext : player.xpToNext,
  };

  if (levelResult.leveled) {
    updateData.level = levelResult.newLevel;
    updateData.maxHp = player.maxHp + levelResult.statGains.maxHp;
    updateData.hp = player.maxHp + levelResult.statGains.maxHp; // Full heal on level up
    updateData.attack = player.attack + levelResult.statGains.attack;
    updateData.defense = player.defense + levelResult.statGains.defense;

    // Boost crit rate slightly every 10 levels
    if (levelResult.newLevel % 10 === 0) {
      updateData.critRate = Math.min(0.5, player.critRate + 0.02);
    }
  }

  await prisma.player.update({
    where: { id: playerId },
    data: updateData,
  });

  return levelResult;
}

/**
 * Tambah gold
 */
export async function addGold(prisma, playerId, amount) {
  return prisma.player.update({
    where: { id: playerId },
    data: { gold: { increment: amount } },
  });
}

/**
 * Kurangi gold (dengan validasi)
 * @returns {boolean} true jika berhasil
 */
export async function spendGold(prisma, playerId, amount) {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.gold < amount) return false;

  await prisma.player.update({
    where: { id: playerId },
    data: { gold: { decrement: amount } },
  });
  return true;
}

/**
 * Tambah item ke inventory
 */
export async function addItem(prisma, playerId, itemId, quantity = 1) {
  return prisma.inventoryItem.upsert({
    where: {
      playerId_itemId: { playerId, itemId },
    },
    update: { quantity: { increment: quantity } },
    create: { playerId, itemId, quantity },
  });
}

/**
 * Kurangi item dari inventory
 * @returns {boolean} true jika berhasil
 */
export async function removeItem(prisma, playerId, itemId, quantity = 1) {
  const item = await prisma.inventoryItem.findUnique({
    where: { playerId_itemId: { playerId, itemId } },
  });

  if (!item || item.quantity < quantity) return false;

  if (item.quantity === quantity) {
    await prisma.inventoryItem.delete({
      where: { playerId_itemId: { playerId, itemId } },
    });
  } else {
    await prisma.inventoryItem.update({
      where: { playerId_itemId: { playerId, itemId } },
      data: { quantity: { decrement: quantity } },
    });
  }
  return true;
}

/**
 * Ambil inventory player
 */
export async function getInventory(prisma, playerId) {
  return prisma.inventoryItem.findMany({
    where: { playerId },
    orderBy: { itemId: 'asc' },
  });
}

/**
 * Heal player
 */
export async function healPlayer(prisma, playerId, amount) {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) return null;

  const newHp = Math.min(player.maxHp, player.hp + amount);
  return prisma.player.update({
    where: { id: playerId },
    data: { hp: newHp },
  });
}

/**
 * Set equipment (weapon atau armor)
 */
export async function equipItem(prisma, playerId, itemId, slot) {
  const data = {};
  if (slot === 'weapon') data.weaponId = itemId;
  if (slot === 'armor') data.armorId = itemId;

  return prisma.player.update({
    where: { id: playerId },
    data,
  });
}

/**
 * Unequip item
 */
export async function unequipItem(prisma, playerId, slot) {
  const data = {};
  if (slot === 'weapon') data.weaponId = null;
  if (slot === 'armor') data.armorId = null;

  return prisma.player.update({
    where: { id: playerId },
    data,
  });
}

/**
 * Hitung total stats player (base + equipment)
 * Selalu re-fetch player dari DB untuk memastikan weaponId/armorId terbaru
 */
export async function getEffectiveStats(prisma, player, allItems) {
  // Re-fetch player dari DB untuk mendapatkan weaponId/armorId terbaru
  const freshPlayer = await prisma.player.findUnique({ where: { id: player.id } });
  const p = freshPlayer || player;

  let totalAttack = p.attack;
  let totalDefense = p.defense;
  let totalCritRate = p.critRate;
  let totalCritDmg = p.critDmg;
  let totalMaxHp = p.maxHp;

  // Weapon bonus
  if (p.weaponId) {
    const weapon = allItems.find(i => i.id === p.weaponId);
    if (weapon?.stats) {
      totalAttack += weapon.stats.attack || 0;
      totalCritRate += weapon.stats.critRate || 0;
      totalCritDmg += weapon.stats.critDmg || 0;
    }
  }

  // Armor bonus
  if (p.armorId) {
    const armor = allItems.find(i => i.id === p.armorId);
    if (armor?.stats) {
      totalDefense += armor.stats.defense || 0;
      totalMaxHp += armor.stats.maxHp || 0;
    }
  }

  return { totalAttack, totalDefense, totalCritRate, totalCritDmg, totalMaxHp };
}

/**
 * Log battle result
 */
export async function logBattle(prisma, { attackerId, defenderId, enemyName, result, xpGained, goldGained, loot, details }) {
  return prisma.battleLog.create({
    data: {
      attackerId,
      defenderId: defenderId || null,
      enemyName: enemyName || null,
      result,
      xpGained,
      goldGained,
      loot: loot ? JSON.stringify(loot) : null,
      details: details ? JSON.stringify(details) : null,
    },
  });
}
