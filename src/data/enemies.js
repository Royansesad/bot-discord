// ============================================
// enemies.js - Enemy Definitions
// ============================================

export const ENEMIES = [
  // === Tier 1: Level 1-10 ===
  {
    id: 'slime',
    name: '🟢 Slime',
    level: 1,
    hp: 30,
    attack: 5,
    defense: 2,
    critRate: 0.02,
    critDmg: 1.2,
    xpReward: { min: 10, max: 20 },
    goldReward: { min: 5, max: 15 },
    description: 'Makhluk berlendir yang jinak.',
    drops: [
      { itemId: 'slime_jelly', chance: 0.4, quantity: 1 },
      { itemId: 'healing_herb', chance: 0.2, quantity: 1 },
    ],
  },
  {
    id: 'goblin',
    name: '👺 Goblin',
    level: 3,
    hp: 50,
    attack: 8,
    defense: 3,
    critRate: 0.05,
    critDmg: 1.3,
    xpReward: { min: 15, max: 30 },
    goldReward: { min: 10, max: 25 },
    description: 'Goblin kecil yang licik.',
    drops: [
      { itemId: 'goblin_ear', chance: 0.35, quantity: 1 },
      { itemId: 'rusty_dagger', chance: 0.08, quantity: 1 },
      { itemId: 'healing_herb', chance: 0.15, quantity: 1 },
    ],
  },
  {
    id: 'wolf',
    name: '🐺 Wild Wolf',
    level: 5,
    hp: 70,
    attack: 12,
    defense: 4,
    critRate: 0.08,
    critDmg: 1.4,
    xpReward: { min: 20, max: 40 },
    goldReward: { min: 12, max: 30 },
    description: 'Serigala liar yang agresif.',
    drops: [
      { itemId: 'wolf_fang', chance: 0.3, quantity: 1 },
      { itemId: 'wolf_pelt', chance: 0.25, quantity: 1 },
    ],
  },
  {
    id: 'skeleton',
    name: '💀 Skeleton',
    level: 7,
    hp: 80,
    attack: 14,
    defense: 6,
    critRate: 0.05,
    critDmg: 1.3,
    xpReward: { min: 25, max: 50 },
    goldReward: { min: 15, max: 35 },
    description: 'Tulang-belulang yang hidup kembali.',
    drops: [
      { itemId: 'bone_fragment', chance: 0.35, quantity: 1 },
      { itemId: 'iron_sword', chance: 0.05, quantity: 1 },
    ],
  },

  // === Tier 2: Level 10-25 ===
  {
    id: 'bandit',
    name: '🗡️ Bandit',
    level: 10,
    hp: 120,
    attack: 20,
    defense: 10,
    critRate: 0.1,
    critDmg: 1.5,
    xpReward: { min: 35, max: 70 },
    goldReward: { min: 25, max: 60 },
    description: 'Perampok berpengalaman.',
    drops: [
      { itemId: 'stolen_gold_pouch', chance: 0.3, quantity: 1 },
      { itemId: 'bandana', chance: 0.1, quantity: 1 },
      { itemId: 'steel_sword', chance: 0.04, quantity: 1 },
    ],
  },
  {
    id: 'orc',
    name: '👹 Orc Warrior',
    level: 15,
    hp: 180,
    attack: 28,
    defense: 15,
    critRate: 0.06,
    critDmg: 1.4,
    xpReward: { min: 50, max: 100 },
    goldReward: { min: 35, max: 80 },
    description: 'Pejuang orc yang tangguh.',
    drops: [
      { itemId: 'orc_tusk', chance: 0.3, quantity: 1 },
      { itemId: 'war_axe', chance: 0.06, quantity: 1 },
      { itemId: 'chain_armor', chance: 0.03, quantity: 1 },
    ],
  },
  {
    id: 'dark_mage',
    name: '🧙 Dark Mage',
    level: 20,
    hp: 150,
    attack: 35,
    defense: 8,
    critRate: 0.15,
    critDmg: 1.8,
    xpReward: { min: 60, max: 120 },
    goldReward: { min: 40, max: 100 },
    description: 'Penyihir kegelapan dengan serangan mematikan.',
    drops: [
      { itemId: 'dark_crystal', chance: 0.25, quantity: 1 },
      { itemId: 'mage_robe', chance: 0.05, quantity: 1 },
      { itemId: 'spell_book', chance: 0.03, quantity: 1 },
    ],
  },

  // === Tier 3: Level 25-50 ===
  {
    id: 'golem',
    name: '🗿 Stone Golem',
    level: 25,
    hp: 300,
    attack: 30,
    defense: 30,
    critRate: 0.03,
    critDmg: 1.2,
    xpReward: { min: 80, max: 160 },
    goldReward: { min: 50, max: 120 },
    description: 'Golem batu raksasa dengan pertahanan luar biasa.',
    drops: [
      { itemId: 'stone_core', chance: 0.2, quantity: 1 },
      { itemId: 'titanium_shield', chance: 0.04, quantity: 1 },
    ],
  },
  {
    id: 'vampire',
    name: '🧛 Vampire Lord',
    level: 35,
    hp: 250,
    attack: 45,
    defense: 20,
    critRate: 0.12,
    critDmg: 1.6,
    xpReward: { min: 100, max: 200 },
    goldReward: { min: 70, max: 150 },
    description: 'Vampir bangsawan yang haus darah.',
    drops: [
      { itemId: 'blood_essence', chance: 0.2, quantity: 1 },
      { itemId: 'vampire_cloak', chance: 0.05, quantity: 1 },
      { itemId: 'crimson_blade', chance: 0.02, quantity: 1 },
    ],
  },
  {
    id: 'dragon_whelp',
    name: '🐲 Dragon Whelp',
    level: 45,
    hp: 400,
    attack: 55,
    defense: 35,
    critRate: 0.1,
    critDmg: 1.5,
    xpReward: { min: 150, max: 300 },
    goldReward: { min: 100, max: 250 },
    description: 'Anak naga yang mulai berbahaya.',
    drops: [
      { itemId: 'dragon_scale', chance: 0.15, quantity: 1 },
      { itemId: 'dragon_claw_dagger', chance: 0.03, quantity: 1 },
      { itemId: 'fire_essence', chance: 0.1, quantity: 1 },
    ],
  },
];

/**
 * Dapatkan enemies yang sesuai dengan level player
 * Enemy yang bisa ditemui: levelPlayer - 3 sampai levelPlayer + 5
 */
export function getEnemiesForLevel(playerLevel) {
  return ENEMIES.filter(e => e.level >= playerLevel - 3 && e.level <= playerLevel + 5);
}

/**
 * Dapatkan enemy berdasarkan ID
 */
export function getEnemyById(id) {
  return ENEMIES.find(e => e.id === id);
}
