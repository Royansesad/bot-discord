// /inventory - Lihat inventory pemain
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getPlayer, getInventory } from '../../services/rpgService.js';
import { errorEmbed } from '../../utils/embeds.js';
import { formatNumber, rarityEmoji, capitalize } from '../../utils/helpers.js';
import { getItemById } from '../../data/items.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('inventory')
  .setDescription('Lihat inventory kamu');

export async function execute(interaction, client) {
  const player = await getPlayer(client.prisma, interaction.user.id);
  if (!player) return interaction.reply({ embeds: [errorEmbed('❌', 'Belum terdaftar! `/start`')], flags: 64 });

  const inventory = await getInventory(client.prisma, player.id);

  if (inventory.length === 0) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(config.colors.common)
        .setTitle('🎒 Inventory')
        .setDescription('Inventory kosong. Pergi berpetualang untuk mendapatkan item!')
        .setTimestamp()],
    });
  }

  // Group by type
  const grouped = {};
  for (const inv of inventory) {
    const item = getItemById(inv.itemId);
    if (!item) continue;
    if (!grouped[item.type]) grouped[item.type] = [];
    grouped[item.type].push({ ...item, quantity: inv.quantity });
  }

  const typeEmojis = { consumable: '🧪', material: '📦', weapon: '⚔️', armor: '🛡️' };
  const embed = new EmbedBuilder()
    .setColor(config.colors.rpg)
    .setTitle(`🎒 Inventory — ${interaction.user.displayName}`)
    .setDescription(`Total: **${inventory.length}** jenis item`)
    .setTimestamp();

  for (const [type, items] of Object.entries(grouped)) {
    const list = items.map(i => {
      const equipped = (type === 'weapon' && player.weaponId === i.id) || (type === 'armor' && player.armorId === i.id);
      return `${rarityEmoji(i.rarity)} **${i.name}** x${i.quantity}${equipped ? ' 📌' : ''}\n  ↳ \`${i.id}\` • Sell: 🪙 ${i.sellPrice}`;
    }).join('\n');
    embed.addFields({ name: `${typeEmojis[type] || '📦'} ${capitalize(type)}`, value: list || 'Kosong' });
  }

  embed.setFooter({ text: '📌 = Equipped • Gunakan /use, /equip, atau /sell' });
  await interaction.reply({ embeds: [embed] });
}
