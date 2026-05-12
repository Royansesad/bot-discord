// /store - Lihat dan beli item dari shop
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { getPlayer, spendGold, addItem } from '../../services/rpgService.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { formatNumber, rarityEmoji } from '../../utils/helpers.js';
import { getShopItems, SHOP_CATEGORIES } from '../../data/shop.js';
import { getItemById } from '../../data/items.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('store')
  .setDescription('Lihat item shop')
  .addStringOption(opt => opt.setName('buy').setDescription('ID item yang ingin dibeli'))
  .addIntegerOption(opt => opt.setName('quantity').setDescription('Jumlah yang dibeli').setMinValue(1).setMaxValue(10));

export async function execute(interaction, client) {
  const player = await getPlayer(client.prisma, interaction.user.id);
  if (!player) return interaction.reply({ embeds: [errorEmbed('❌', 'Belum terdaftar! `/start`')], flags: 64 });

  const buyItemId = interaction.options.getString('buy');
  const quantity = interaction.options.getInteger('quantity') || 1;

  // Mode beli
  if (buyItemId) {
    const item = getItemById(buyItemId);
    if (!item || !item.buyPrice) return interaction.reply({ embeds: [errorEmbed('❌', 'Item tidak tersedia di shop.')], flags: 64 });

    const totalCost = item.buyPrice * quantity;
    if (player.gold < totalCost) return interaction.reply({ embeds: [errorEmbed('❌', `Gold tidak cukup! Butuh 🪙 ${formatNumber(totalCost)}, kamu punya 🪙 ${formatNumber(player.gold)}`)], flags: 64 });

    await spendGold(client.prisma, player.id, totalCost);
    await addItem(client.prisma, player.id, buyItemId, quantity);

    return interaction.reply({
      embeds: [successEmbed('Pembelian Berhasil', `Kamu membeli ${rarityEmoji(item.rarity)} **${item.name}** x${quantity}\n💰 Total: 🪙 ${formatNumber(totalCost)}\n💳 Sisa: 🪙 ${formatNumber(player.gold - totalCost)}`)],
    });
  }

  // Mode lihat shop
  const shopItems = getShopItems();

  const embed = new EmbedBuilder()
    .setColor(config.colors.rpg)
    .setTitle('🏪 Item Shop')
    .setDescription(`🪙 Gold kamu: **${formatNumber(player.gold)}**\n\nGunakan \`/store buy:<item_id>\` untuk membeli.`)
    .setTimestamp();

  for (const cat of SHOP_CATEGORIES) {
    const items = shopItems[cat.id];
    if (items && items.length > 0) {
      const itemList = items.map(i => {
        return `${rarityEmoji(i.rarity)} **${i.name}** — 🪙 ${formatNumber(i.buyPrice)}\n  ↳ \`${i.id}\` • ${i.description}`;
      }).join('\n');
      embed.addFields({ name: `${cat.emoji} ${cat.name}`, value: itemList });
    }
  }

  await interaction.reply({ embeds: [embed] });
}
