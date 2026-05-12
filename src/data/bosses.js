// ============================================
// bosses.js - Boss Definitions
// ============================================

export const BOSSES = [
  {
    id: 'goblin_king', name: '👑 Goblin King', title: 'Raja Para Goblin',
    level: 10, hp: 500, attack: 25, defense: 15, critRate: 0.1, critDmg: 1.5,
    xpReward: { min: 200, max: 400 }, goldReward: { min: 100, max: 300 },
    description: 'Raja goblin yang menguasai hutan gelap.',
    drops: [
      { itemId: 'goblin_crown', chance: 0.15 }, { itemId: 'kings_dagger', chance: 0.08 },
      { itemId: 'gold_nugget', chance: 0.3, quantity: 2 }, { itemId: 'rare_gem', chance: 0.05 },
    ],
  },
  {
    id: 'shadow_knight', name: '🖤 Shadow Knight', title: 'Ksatria Kegelapan',
    level: 25, hp: 1000, attack: 45, defense: 30, critRate: 0.12, critDmg: 1.6,
    xpReward: { min: 500, max: 800 }, goldReward: { min: 200, max: 500 },
    description: 'Ksatria yang dijiwai kegelapan abadi.',
    drops: [
      { itemId: 'shadow_blade', chance: 0.1 }, { itemId: 'dark_plate_armor', chance: 0.08 },
      { itemId: 'soul_fragment', chance: 0.2 }, { itemId: 'legendary_ore', chance: 0.03 },
    ],
  },
  {
    id: 'ice_queen', name: '❄️ Ice Queen', title: 'Ratu Es Abadi',
    level: 40, hp: 1500, attack: 60, defense: 25, critRate: 0.15, critDmg: 1.8,
    xpReward: { min: 700, max: 1200 }, goldReward: { min: 300, max: 700 },
    description: 'Ratu yang menguasai kerajaan es.',
    drops: [
      { itemId: 'frost_scepter', chance: 0.08 }, { itemId: 'ice_crown', chance: 0.05 },
      { itemId: 'frozen_heart', chance: 0.12 }, { itemId: 'diamond', chance: 0.06 },
    ],
  },
  {
    id: 'demon_lord', name: '😈 Demon Lord', title: 'Penguasa Iblis',
    level: 60, hp: 2500, attack: 85, defense: 45, critRate: 0.18, critDmg: 2.0,
    xpReward: { min: 1000, max: 2000 }, goldReward: { min: 500, max: 1200 },
    description: 'Iblis paling kuat dari neraka terdalam.',
    drops: [
      { itemId: 'demon_blade', chance: 0.06 }, { itemId: 'infernal_armor', chance: 0.05 },
      { itemId: 'demon_horn', chance: 0.15 }, { itemId: 'elixir_of_power', chance: 0.03 },
    ],
  },
  {
    id: 'ancient_dragon', name: '🐉 Ancient Dragon', title: 'Naga Purba',
    level: 80, hp: 4000, attack: 120, defense: 60, critRate: 0.2, critDmg: 2.2,
    xpReward: { min: 2000, max: 4000 }, goldReward: { min: 1000, max: 3000 },
    description: 'Naga tertua yang pernah ada. Hampir tak terkalahkan.',
    drops: [
      { itemId: 'dragonslayer', chance: 0.03 }, { itemId: 'dragon_armor', chance: 0.03 },
      { itemId: 'ancient_relic', chance: 0.1 }, { itemId: 'dragon_scale', chance: 0.25, quantity: 2 },
    ],
  },
];

export const WEEKLY_BOSSES = [
  // === Level 10-40 Weekly Bosses ===
  {
    id: 'killer_rabbit', name: '🐇 Killer Rabbit', title: 'Kelinci Pembunuh',
    level: 10, hp: 400, attack: 30, defense: 10, critRate: 0.2, critDmg: 1.8,
    xpReward: { min: 150, max: 350 }, goldReward: { min: 80, max: 200 },
    description: 'Jangan tertipu penampilannya! Kelinci ini sangat mematikan dan gesit.',
    drops: [
      { itemId: 'rabbit_foot_charm', chance: 0.15 }, { itemId: 'health_potion', chance: 0.3, quantity: 2 },
      { itemId: 'gold_nugget', chance: 0.25, quantity: 2 }, { itemId: 'rare_gem', chance: 0.08 },
    ],
  },
  {
    id: 'giant_scorpion', name: '🦂 Giant Scorpion', title: 'Kalajengking Raksasa',
    level: 20, hp: 800, attack: 40, defense: 25, critRate: 0.12, critDmg: 1.6,
    xpReward: { min: 350, max: 600 }, goldReward: { min: 150, max: 400 },
    description: 'Kalajengking gurun raksasa dengan racun yang melumpuhkan.',
    drops: [
      { itemId: 'scorpion_stinger', chance: 0.12 }, { itemId: 'venom_essence', chance: 0.15 },
      { itemId: 'dark_crystal', chance: 0.2 }, { itemId: 'greater_health_potion', chance: 0.25, quantity: 2 },
    ],
  },
  {
    id: 'nightmare_bear', name: '🐻 Nightmare Bear', title: 'Beruang Mimpi Buruk',
    level: 30, hp: 1200, attack: 55, defense: 35, critRate: 0.1, critDmg: 1.5,
    xpReward: { min: 500, max: 900 }, goldReward: { min: 250, max: 550 },
    description: 'Beruang raksasa dari alam mimpi buruk. Kekuatannya melampaui batas.',
    drops: [
      { itemId: 'nightmare_claw', chance: 0.1 }, { itemId: 'shadow_blade', chance: 0.05 },
      { itemId: 'soul_fragment', chance: 0.18 }, { itemId: 'diamond', chance: 0.04 },
    ],
  },
  {
    id: 'weekly_dragon', name: '🐲 Dragon', title: 'Naga Penjaga Harta',
    level: 40, hp: 1600, attack: 65, defense: 30, critRate: 0.14, critDmg: 1.7,
    xpReward: { min: 700, max: 1300 }, goldReward: { min: 400, max: 800 },
    description: 'Naga muda yang menjaga harta karun di sarangnya.',
    drops: [
      { itemId: 'dragon_claw_dagger', chance: 0.08 }, { itemId: 'dragon_scale', chance: 0.2, quantity: 2 },
      { itemId: 'fire_essence', chance: 0.15 }, { itemId: 'frost_scepter', chance: 0.04 },
    ],
  },

  // === Level 50-70 Weekly Bosses (existing) ===
  {
    id: 'world_serpent', name: '🐍 World Serpent', title: 'Ular Dunia',
    level: 50, hp: 3000, attack: 70, defense: 40, critRate: 0.15, critDmg: 1.8,
    xpReward: { min: 1500, max: 2500 }, goldReward: { min: 800, max: 1500 },
    description: 'Ular raksasa yang melingkari dunia.',
    drops: [
      { itemId: 'serpent_fang_blade', chance: 0.1 }, { itemId: 'serpent_scale_armor', chance: 0.08 },
      { itemId: 'venom_essence', chance: 0.2 }, { itemId: 'legendary_ore', chance: 0.1 },
    ],
  },
  {
    id: 'titan', name: '🗻 Titan of Earth', title: 'Titan Bumi',
    level: 70, hp: 5000, attack: 90, defense: 70, critRate: 0.08, critDmg: 1.5,
    xpReward: { min: 2500, max: 4000 }, goldReward: { min: 1200, max: 2500 },
    description: 'Titan purba dengan pertahanan nyaris tak tertembus.',
    drops: [
      { itemId: 'titans_hammer', chance: 0.06 }, { itemId: 'titans_plate', chance: 0.05 },
      { itemId: 'earth_core', chance: 0.15 }, { itemId: 'legendary_ore', chance: 0.15, quantity: 2 },
    ],
  },

  // === Level 80-100 Endgame Weekly Bosses ===
  {
    id: 'demon_general', name: '👿 Demon Lord\'s General', title: 'Jenderal Iblis',
    level: 80, hp: 7000, attack: 130, defense: 65, critRate: 0.18, critDmg: 2.0,
    xpReward: { min: 4000, max: 7000 }, goldReward: { min: 2000, max: 4000 },
    description: 'Jenderal tertinggi pasukan iblis. Tangan kanan sang Demon Lord.',
    drops: [
      { itemId: 'hellfire_blade', chance: 0.08 }, { itemId: 'abyssal_armor', chance: 0.06 },
      { itemId: 'demon_horn', chance: 0.2, quantity: 2 }, { itemId: 'elixir_of_power', chance: 0.08 },
      { itemId: 'soul_fragment', chance: 0.25, quantity: 3 },
    ],
  },
  {
    id: 'demon_lord_supreme', name: '😈 Demon Lord', title: 'Penguasa Iblis Tertinggi',
    level: 90, hp: 10000, attack: 160, defense: 80, critRate: 0.2, critDmg: 2.2,
    xpReward: { min: 6000, max: 10000 }, goldReward: { min: 3500, max: 6000 },
    description: 'Demon Lord yang sesungguhnya. Kekuatannya menghancurkan segalanya.',
    drops: [
      { itemId: 'void_reaper', chance: 0.05 }, { itemId: 'abyssal_armor', chance: 0.08 },
      { itemId: 'hellfire_blade', chance: 0.06 }, { itemId: 'elixir_of_power', chance: 0.12 },
      { itemId: 'ancient_relic', chance: 0.15, quantity: 2 },
    ],
  },
  {
    id: 'cthulhu', name: '🦑 Cthulhu', title: 'Conqueror of Worlds',
    level: 100, hp: 15000, attack: 200, defense: 100, critRate: 0.22, critDmg: 2.5,
    xpReward: { min: 10000, max: 20000 }, goldReward: { min: 5000, max: 10000 },
    description: 'Entitas kosmis penakluk dunia. Melihatnya saja bisa membuat gila. Musuh terakhir yang harus dikalahkan.',
    drops: [
      { itemId: 'cthulhu_tentacle', chance: 0.05 }, { itemId: 'cosmic_aegis', chance: 0.04 },
      { itemId: 'void_reaper', chance: 0.06 }, { itemId: 'elixir_of_power', chance: 0.15 },
      { itemId: 'ancient_relic', chance: 0.2, quantity: 3 }, { itemId: 'legendary_ore', chance: 0.3, quantity: 5 },
    ],
  },
];

export function getBossForLevel(playerLevel) {
  const eligible = BOSSES.filter(b => b.level <= playerLevel + 10);
  if (eligible.length === 0) return BOSSES[0];
  return eligible[Math.floor(Math.random() * eligible.length)];
}

export function getBossById(id) {
  return [...BOSSES, ...WEEKLY_BOSSES].find(b => b.id === id);
}
