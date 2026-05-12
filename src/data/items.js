// ============================================
// items.js - All Item Definitions
// ============================================

export const ALL_ITEMS = [
  // === CONSUMABLES ===
  { id: 'healing_herb', name: '🌿 Healing Herb', type: 'consumable', rarity: 'common', description: 'Memulihkan 20 HP.', effect: { heal: 20 }, sellPrice: 5, buyPrice: 15 },
  { id: 'health_potion', name: '🧪 Health Potion', type: 'consumable', rarity: 'common', description: 'Memulihkan 50 HP.', effect: { heal: 50 }, sellPrice: 15, buyPrice: 40 },
  { id: 'greater_health_potion', name: '💊 Greater Health Potion', type: 'consumable', rarity: 'uncommon', description: 'Memulihkan 120 HP.', effect: { heal: 120 }, sellPrice: 40, buyPrice: 100 },
  { id: 'elixir_of_life', name: '✨ Elixir of Life', type: 'consumable', rarity: 'rare', description: 'Memulihkan HP penuh.', effect: { healFull: true }, sellPrice: 150, buyPrice: 400 },
  { id: 'attack_potion', name: '⚔️ Attack Potion', type: 'consumable', rarity: 'uncommon', description: '+5 ATK permanen.', effect: { permAttack: 5 }, sellPrice: 80, buyPrice: 200 },
  { id: 'defense_potion', name: '🛡️ Defense Potion', type: 'consumable', rarity: 'uncommon', description: '+3 DEF permanen.', effect: { permDefense: 3 }, sellPrice: 80, buyPrice: 200 },
  { id: 'elixir_of_power', name: '🔥 Elixir of Power', type: 'consumable', rarity: 'legendary', description: '+15 ATK, +10 DEF permanen.', effect: { permAttack: 15, permDefense: 10 }, sellPrice: 1000 },

  // === MATERIALS ===
  { id: 'slime_jelly', name: '💧 Slime Jelly', type: 'material', rarity: 'common', description: 'Lendir slime.', sellPrice: 3 },
  { id: 'goblin_ear', name: '👂 Goblin Ear', type: 'material', rarity: 'common', description: 'Telinga goblin.', sellPrice: 5 },
  { id: 'wolf_fang', name: '🦷 Wolf Fang', type: 'material', rarity: 'common', description: 'Taring serigala.', sellPrice: 8 },
  { id: 'wolf_pelt', name: '🐾 Wolf Pelt', type: 'material', rarity: 'common', description: 'Kulit serigala.', sellPrice: 10 },
  { id: 'bone_fragment', name: '🦴 Bone Fragment', type: 'material', rarity: 'common', description: 'Pecahan tulang.', sellPrice: 7 },
  { id: 'orc_tusk', name: '🐗 Orc Tusk', type: 'material', rarity: 'uncommon', description: 'Gading orc.', sellPrice: 20 },
  { id: 'dark_crystal', name: '🔮 Dark Crystal', type: 'material', rarity: 'uncommon', description: 'Kristal kegelapan.', sellPrice: 30 },
  { id: 'stone_core', name: '🪨 Stone Core', type: 'material', rarity: 'uncommon', description: 'Inti batu golem.', sellPrice: 35 },
  { id: 'blood_essence', name: '🩸 Blood Essence', type: 'material', rarity: 'rare', description: 'Esensi darah vampir.', sellPrice: 50 },
  { id: 'dragon_scale', name: '🐲 Dragon Scale', type: 'material', rarity: 'rare', description: 'Sisik naga.', sellPrice: 80 },
  { id: 'fire_essence', name: '🔥 Fire Essence', type: 'material', rarity: 'rare', description: 'Esensi api naga.', sellPrice: 60 },
  { id: 'soul_fragment', name: '👻 Soul Fragment', type: 'material', rarity: 'rare', description: 'Pecahan jiwa.', sellPrice: 70 },
  { id: 'frozen_heart', name: '💎 Frozen Heart', type: 'material', rarity: 'epic', description: 'Jantung es abadi.', sellPrice: 120 },
  { id: 'demon_horn', name: '😈 Demon Horn', type: 'material', rarity: 'epic', description: 'Tanduk iblis.', sellPrice: 150 },
  { id: 'venom_essence', name: '☠️ Venom Essence', type: 'material', rarity: 'epic', description: 'Esensi racun ular dunia.', sellPrice: 130 },
  { id: 'earth_core', name: '🌍 Earth Core', type: 'material', rarity: 'epic', description: 'Inti bumi dari titan.', sellPrice: 180 },
  { id: 'legendary_ore', name: '⭐ Legendary Ore', type: 'material', rarity: 'legendary', description: 'Biji besi legendaris.', sellPrice: 250 },
  { id: 'ancient_relic', name: '🏛️ Ancient Relic', type: 'material', rarity: 'legendary', description: 'Peninggalan purba.', sellPrice: 500 },
  { id: 'gold_nugget', name: '🪙 Gold Nugget', type: 'material', rarity: 'uncommon', description: 'Bongkah emas.', sellPrice: 25 },
  { id: 'stolen_gold_pouch', name: '💰 Stolen Gold Pouch', type: 'material', rarity: 'uncommon', description: 'Kantong emas curian.', sellPrice: 30 },
  { id: 'rare_gem', name: '💠 Rare Gem', type: 'material', rarity: 'rare', description: 'Permata langka.', sellPrice: 100 },
  { id: 'diamond', name: '💎 Diamond', type: 'material', rarity: 'epic', description: 'Berlian murni.', sellPrice: 200 },

  // === WEAPONS ===
  { id: 'rusty_dagger', name: '🗡️ Rusty Dagger', type: 'weapon', rarity: 'common', description: 'Belati berkarat.', stats: { attack: 3 }, sellPrice: 10, buyPrice: 30 },
  { id: 'iron_sword', name: '⚔️ Iron Sword', type: 'weapon', rarity: 'common', description: 'Pedang besi standar.', stats: { attack: 8 }, sellPrice: 25, buyPrice: 80 },
  { id: 'steel_sword', name: '⚔️ Steel Sword', type: 'weapon', rarity: 'uncommon', description: 'Pedang baja berkualitas.', stats: { attack: 15 }, sellPrice: 60, buyPrice: 180 },
  { id: 'war_axe', name: '🪓 War Axe', type: 'weapon', rarity: 'uncommon', description: 'Kapak perang orc.', stats: { attack: 18, critDmg: 0.1 }, sellPrice: 80, buyPrice: 220 },
  { id: 'spell_book', name: '📖 Spell Book', type: 'weapon', rarity: 'rare', description: 'Buku mantra gelap.', stats: { attack: 22, critRate: 0.05 }, sellPrice: 120 },
  { id: 'crimson_blade', name: '🔴 Crimson Blade', type: 'weapon', rarity: 'rare', description: 'Pedang merah darah vampir.', stats: { attack: 28, critRate: 0.03 }, sellPrice: 180 },
  { id: 'dragon_claw_dagger', name: '🐲 Dragon Claw Dagger', type: 'weapon', rarity: 'rare', description: 'Belati dari cakar naga.', stats: { attack: 25, critRate: 0.08, critDmg: 0.2 }, sellPrice: 200 },
  { id: 'kings_dagger', name: '👑 King\'s Dagger', type: 'weapon', rarity: 'epic', description: 'Belati milik raja goblin.', stats: { attack: 20, critRate: 0.1, critDmg: 0.3 }, sellPrice: 250 },
  { id: 'shadow_blade', name: '🖤 Shadow Blade', type: 'weapon', rarity: 'epic', description: 'Pedang bayangan.', stats: { attack: 40, critRate: 0.08 }, sellPrice: 400 },
  { id: 'frost_scepter', name: '❄️ Frost Scepter', type: 'weapon', rarity: 'epic', description: 'Tongkat es ratu.', stats: { attack: 45, critDmg: 0.3 }, sellPrice: 500 },
  { id: 'demon_blade', name: '😈 Demon Blade', type: 'weapon', rarity: 'legendary', description: 'Pedang iblis neraka.', stats: { attack: 65, critRate: 0.1, critDmg: 0.4 }, sellPrice: 1200 },
  { id: 'serpent_fang_blade', name: '🐍 Serpent Fang Blade', type: 'weapon', rarity: 'legendary', description: 'Pedang taring ular dunia.', stats: { attack: 70, critRate: 0.12 }, sellPrice: 1500 },
  { id: 'titans_hammer', name: '🔨 Titan\'s Hammer', type: 'weapon', rarity: 'legendary', description: 'Palu titan bumi.', stats: { attack: 85, critDmg: 0.5 }, sellPrice: 2000 },
  { id: 'dragonslayer', name: '🐉 Dragonslayer', type: 'weapon', rarity: 'legendary', description: 'Pedang pembunuh naga purba.', stats: { attack: 100, critRate: 0.15, critDmg: 0.5 }, sellPrice: 5000 },

  // === LEGENDARY WEAPONS WITH SPECIAL EFFECTS ===
  {
    id: 'scorpion_stinger', name: '🦂 Scorpion Stinger', type: 'weapon', rarity: 'epic',
    description: 'Belati dari sengatan kalajengking raksasa. Meracuni musuh (DOT).',
    stats: { attack: 35, critRate: 0.06 },
    specialEffect: { type: 'dot', damage: 8, duration: 3, name: '☠️ Poison' },
    sellPrice: 350,
  },
  {
    id: 'nightmare_claw', name: '🐻 Nightmare Claw', type: 'weapon', rarity: 'epic',
    description: 'Cakar dari beruang mimpi buruk. Merobek lawan dengan DOT.',
    stats: { attack: 42, critDmg: 0.2 },
    specialEffect: { type: 'dot', damage: 10, duration: 3, name: '🩸 Bleed' },
    sellPrice: 450,
  },
  {
    id: 'rabbit_foot_charm', name: '🐇 Rabbit Foot Charm', type: 'weapon', rarity: 'epic',
    description: 'Jimat keberuntungan dari kelinci pembunuh. Memberikan immunity sekali.',
    stats: { attack: 25, critRate: 0.15, critDmg: 0.3 },
    specialEffect: { type: 'immunity', charges: 1, name: '🛡️ Lucky Dodge' },
    sellPrice: 400,
  },
  {
    id: 'hellfire_blade', name: '🔥 Hellfire Blade', type: 'weapon', rarity: 'legendary',
    description: 'Pedang berbalut api neraka. Membakar musuh setiap turn (DOT).',
    stats: { attack: 90, critRate: 0.12, critDmg: 0.4 },
    specialEffect: { type: 'dot', damage: 15, duration: 4, name: '🔥 Hellfire' },
    sellPrice: 3000,
  },
  {
    id: 'void_reaper', name: '🌑 Void Reaper', type: 'weapon', rarity: 'legendary',
    description: 'Sabit dari kekosongan. Menyerap jiwa musuh (Lifesteal DOT).',
    stats: { attack: 110, critRate: 0.1, critDmg: 0.5 },
    specialEffect: { type: 'dot', damage: 20, duration: 3, name: '🌑 Void Drain', lifesteal: true },
    sellPrice: 6000,
  },
  {
    id: 'cthulhu_tentacle', name: '🦑 Cthulhu Tentacle', type: 'weapon', rarity: 'legendary',
    description: 'Tentakel Cthulhu. Mengeluarkan racun kosmis (DOT) dan memiliki crit insane.',
    stats: { attack: 130, critRate: 0.2, critDmg: 0.8 },
    specialEffect: { type: 'dot', damage: 25, duration: 5, name: '🦑 Cosmic Venom' },
    sellPrice: 10000,
  },

  // === ARMOR ===
  { id: 'bandana', name: '🎀 Bandana', type: 'armor', rarity: 'common', description: 'Bandana perampok.', stats: { defense: 2 }, sellPrice: 8, buyPrice: 25 },
  { id: 'leather_armor', name: '🦺 Leather Armor', type: 'armor', rarity: 'common', description: 'Armor kulit sederhana.', stats: { defense: 5, maxHp: 10 }, sellPrice: 20, buyPrice: 60 },
  { id: 'chain_armor', name: '⛓️ Chain Armor', type: 'armor', rarity: 'uncommon', description: 'Armor rantai.', stats: { defense: 12, maxHp: 25 }, sellPrice: 60, buyPrice: 180 },
  { id: 'mage_robe', name: '🧙 Mage Robe', type: 'armor', rarity: 'rare', description: 'Jubah penyihir.', stats: { defense: 8, maxHp: 40 }, sellPrice: 100 },
  { id: 'vampire_cloak', name: '🧛 Vampire Cloak', type: 'armor', rarity: 'rare', description: 'Jubah vampir.', stats: { defense: 15, maxHp: 30 }, sellPrice: 150 },
  { id: 'titanium_shield', name: '🛡️ Titanium Shield', type: 'armor', rarity: 'rare', description: 'Perisai titanium.', stats: { defense: 22, maxHp: 20 }, sellPrice: 180 },
  { id: 'goblin_crown', name: '👑 Goblin Crown', type: 'armor', rarity: 'epic', description: 'Mahkota raja goblin.', stats: { defense: 15, maxHp: 50 }, sellPrice: 300 },
  { id: 'dark_plate_armor', name: '🖤 Dark Plate Armor', type: 'armor', rarity: 'epic', description: 'Armor lempeng kegelapan.', stats: { defense: 30, maxHp: 60 }, sellPrice: 500 },
  { id: 'ice_crown', name: '❄️ Ice Crown', type: 'armor', rarity: 'epic', description: 'Mahkota es ratu.', stats: { defense: 20, maxHp: 80 }, sellPrice: 600 },
  { id: 'infernal_armor', name: '🔥 Infernal Armor', type: 'armor', rarity: 'legendary', description: 'Armor api neraka.', stats: { defense: 45, maxHp: 100 }, sellPrice: 1500 },
  { id: 'serpent_scale_armor', name: '🐍 Serpent Scale Armor', type: 'armor', rarity: 'legendary', description: 'Armor sisik ular dunia.', stats: { defense: 50, maxHp: 120 }, sellPrice: 1800 },
  { id: 'titans_plate', name: '🗻 Titan\'s Plate', type: 'armor', rarity: 'legendary', description: 'Armor titan bumi.', stats: { defense: 60, maxHp: 150 }, sellPrice: 2500 },
  { id: 'dragon_armor', name: '🐉 Dragon Armor', type: 'armor', rarity: 'legendary', description: 'Armor naga purba.', stats: { defense: 70, maxHp: 200 }, sellPrice: 5000 },

  // === LEGENDARY ARMOR WITH SPECIAL EFFECTS ===
  {
    id: 'abyssal_armor', name: '🌑 Abyssal Armor', type: 'armor', rarity: 'legendary',
    description: 'Armor dari kedalaman jurang. Menyembuhkan pemakainya setiap turn (HOT).',
    stats: { defense: 55, maxHp: 180 },
    specialEffect: { type: 'hot', heal: 12, duration: 5, name: '💚 Abyssal Regen' },
    sellPrice: 4000,
  },
  {
    id: 'cosmic_aegis', name: '🌌 Cosmic Aegis', type: 'armor', rarity: 'legendary',
    description: 'Perisai kosmis Cthulhu. Memberikan shield dan immunity dari 1 serangan.',
    stats: { defense: 80, maxHp: 250 },
    specialEffect: { type: 'shield', amount: 150, name: '🌌 Cosmic Shield', immunity: 1 },
    sellPrice: 12000,
  },
];

export function getItemById(id) {
  return ALL_ITEMS.find(i => i.id === id);
}

export function getItemsByType(type) {
  return ALL_ITEMS.filter(i => i.type === type);
}

export function getBuyableItems() {
  return ALL_ITEMS.filter(i => i.buyPrice);
}
