// /sell - Jual item dari inventory
import { SlashCommandBuilder } from 'discord.js';
import { getPlayer, removeItem, addGold } from '../../services/rpgService.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { formatNumber, rarityEmoji } from '../../utils/helpers.js';
import { getItemById } from '../../data/items.js';

export const data = new SlashCommandBuilder()
  .setName('sell')
  .setDescription('Jual item dari inventory')
  .addStringOption(opt => opt.setName('item').setDescription('ID item yang ingin dijual').setRequired(true))
  .addIntegerOption(opt => opt.setName('quantity').setDescription('Jumlah yang dijual').setMinValue(1).setMaxValue(99));

export async function execute(interaction, client) {
  const player = await getPlayer(client.prisma, interaction.user.id);
  if (!player) return interaction.reply({ embeds: [errorEmbed('❌', 'Belum terdaftar! `/start`')], flags: 64 });

  const itemId = interaction.options.getString('item');
  const quantity = interaction.options.getInteger('quantity') || 1;
  const item = getItemById(itemId);
  if (!item) return interaction.reply({ embeds: [errorEmbed('❌', 'Item tidak ditemukan.')], flags: 64 });

  // Cek apakah item sedang di-equip
  if (player.weaponId === itemId || player.armorId === itemId) {
    return interaction.reply({ embeds: [errorEmbed('❌', 'Item ini sedang dipakai! Unequip dulu dengan memasang item lain.')], flags: 64 });
  }

  const removed = await removeItem(client.prisma, player.id, itemId, quantity);
  if (!removed) return interaction.reply({ embeds: [errorEmbed('❌', 'Item tidak cukup di inventory.')], flags: 64 });

  const totalGold = item.sellPrice * quantity;
  await addGold(client.prisma, player.id, totalGold);

  await interaction.reply({
    embeds: [successEmbed('Item Terjual!', `${rarityEmoji(item.rarity)} **${item.name}** x${quantity} → 🪙 ${formatNumber(totalGold)} Gold`)],
  });
}
