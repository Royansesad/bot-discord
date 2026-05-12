// ============================================
// events.js - Random Adventure Events
// ============================================

export const ADVENTURE_EVENTS = [
  {
    id: 'treasure_chest',
    name: '📦 Peti Harta Karun',
    description: 'Kamu menemukan peti harta karun tersembunyi!',
    type: 'reward',
    rewards: { gold: { min: 20, max: 80 }, xp: { min: 10, max: 30 } },
    itemChance: 0.3,
    possibleItems: ['healing_herb', 'health_potion', 'gold_nugget'],
  },
  {
    id: 'mysterious_merchant',
    name: '🧙 Pedagang Misterius',
    description: 'Seorang pedagang misterius muncul dan memberikanmu hadiah!',
    type: 'reward',
    rewards: { gold: { min: 10, max: 40 }, xp: { min: 5, max: 20 } },
    itemChance: 0.5,
    possibleItems: ['health_potion', 'greater_health_potion', 'attack_potion'],
  },
  {
    id: 'ancient_shrine',
    name: '🏛️ Kuil Kuno',
    description: 'Kamu menemukan kuil kuno dan mendapat berkah!',
    type: 'buff',
    rewards: { xp: { min: 30, max: 60 }, heal: 30 },
  },
  {
    id: 'fallen_adventurer',
    name: '💀 Petualang Jatuh',
    description: 'Kamu menemukan sisa-sisa petualang yang malang. Barang-barangnya kini milikmu.',
    type: 'reward',
    rewards: { gold: { min: 30, max: 100 }, xp: { min: 15, max: 40 } },
    itemChance: 0.4,
    possibleItems: ['iron_sword', 'leather_armor', 'health_potion', 'rare_gem'],
  },
  {
    id: 'gold_mine',
    name: '⛏️ Tambang Emas',
    description: 'Kamu menemukan tambang emas kecil!',
    type: 'reward',
    rewards: { gold: { min: 50, max: 150 }, xp: { min: 5, max: 15 } },
    itemChance: 0.2,
    possibleItems: ['gold_nugget', 'rare_gem'],
  },
  {
    id: 'training_ground',
    name: '⚔️ Lapangan Latihan',
    description: 'Kamu berlatih di lapangan latihan tua dan bertambah kuat!',
    type: 'buff',
    rewards: { xp: { min: 40, max: 80 } },
  },
  {
    id: 'fairy_spring',
    name: '🧚 Mata Air Peri',
    description: 'Peri hutan menyembuhkanmu sepenuhnya!',
    type: 'buff',
    rewards: { healFull: true, xp: { min: 10, max: 25 } },
  },
  {
    id: 'trap',
    name: '🪤 Jebakan!',
    description: 'Kamu terkena jebakan! Kehilangan sedikit HP...',
    type: 'penalty',
    penalty: { damage: { min: 5, max: 20 } },
    rewards: { xp: { min: 5, max: 10 } },
  },
  {
    id: 'pickpocket',
    name: '🤏 Pencopet!',
    description: 'Seorang pencopet mencuri sebagian goldmu!',
    type: 'penalty',
    penalty: { goldLoss: { min: 5, max: 30 } },
    rewards: { xp: { min: 3, max: 8 } },
  },
];

export function getRandomEvent() {
  return ADVENTURE_EVENTS[Math.floor(Math.random() * ADVENTURE_EVENTS.length)];
}
