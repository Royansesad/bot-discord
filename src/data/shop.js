// ============================================
// shop.js - Item Shop Configuration
// ============================================
import { getBuyableItems } from './items.js';

export const SHOP_CATEGORIES = [
  { id: 'consumable', name: '🧪 Consumable', emoji: '🧪' },
  { id: 'weapon', name: '⚔️ Weapon', emoji: '⚔️' },
  { id: 'armor', name: '🛡️ Armor', emoji: '🛡️' },
];

/**
 * Dapatkan semua item yang bisa dibeli, grouped by category
 */
export function getShopItems() {
  const buyable = getBuyableItems();
  const grouped = {};

  for (const cat of SHOP_CATEGORIES) {
    grouped[cat.id] = buyable.filter(i => i.type === cat.id);
  }

  return grouped;
}

/**
 * Dapatkan item shop berdasarkan ID
 */
export function getShopItem(itemId) {
  return getBuyableItems().find(i => i.id === itemId);
}
