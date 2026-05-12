// ============================================
// helpers.js - General Utility Functions
// ============================================

/**
 * Random integer antara min dan max (inclusive)
 */
export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Random float antara 0 dan 1
 */
export function randomChance(chance) {
  return Math.random() < chance;
}

/**
 * Pilih random item dari array
 */
export function randomPick(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Weighted random selection
 * @param {Array<{item: any, weight: number}>} items
 */
export function weightedRandom(items) {
  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
  let random = Math.random() * totalWeight;

  for (const { item, weight } of items) {
    random -= weight;
    if (random <= 0) return item;
  }
  return items[items.length - 1].item;
}

/**
 * Format angka dengan separator (1000 → 1,000)
 */
export function formatNumber(num) {
  return num.toLocaleString('id-ID');
}

/**
 * Format gold dengan emoji
 */
export function formatGold(amount) {
  return `🪙 ${formatNumber(amount)} Gold`;
}

/**
 * Hitung XP yang dibutuhkan untuk level berikutnya
 */
export function xpForLevel(level) {
  return Math.floor(100 * Math.pow(1.5, level - 1));
}

/**
 * Cek dan proses level up
 * @returns {{ leveled: boolean, newLevel: number, stats: object }}
 */
export function checkLevelUp(player) {
  let leveled = false;
  let currentLevel = player.level;
  let currentXp = player.xp;
  let xpNeeded = player.xpToNext;

  const statGains = { maxHp: 0, attack: 0, defense: 0 };

  while (currentXp >= xpNeeded && currentLevel < 100) {
    currentXp -= xpNeeded;
    currentLevel++;
    leveled = true;

    // Stat gains per level
    const hpGain = randomInt(5, 15);
    const atkGain = randomInt(1, 4);
    const defGain = randomInt(1, 3);

    statGains.maxHp += hpGain;
    statGains.attack += atkGain;
    statGains.defense += defGain;

    xpNeeded = xpForLevel(currentLevel);
  }

  return {
    leveled,
    newLevel: currentLevel,
    newXp: currentXp,
    newXpToNext: xpNeeded,
    statGains,
  };
}

/**
 * Hitung damage dengan variasi
 */
export function calculateDamage(attack, defense, critRate = 0.05, critDmg = 1.5) {
  const isCrit = randomChance(critRate);
  const baseDamage = Math.max(1, attack - Math.floor(defense * 0.6));
  const variance = randomInt(-2, 2);
  let damage = baseDamage + variance;

  if (isCrit) {
    damage = Math.floor(damage * critDmg);
  }

  return { damage: Math.max(1, damage), isCrit };
}

/**
 * Dapatkan awal minggu (Senin) dari tanggal tertentu
 */
export function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Senin
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Emoji rarity
 */
export function rarityEmoji(rarity) {
  const map = {
    common: '⚪',
    uncommon: '🟢',
    rare: '🔵',
    epic: '🟣',
    legendary: '🟡',
  };
  return map[rarity] || '⚪';
}

/**
 * Capitalize first letter
 */
export function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Truncate string
 */
export function truncate(str, maxLength = 100) {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}
