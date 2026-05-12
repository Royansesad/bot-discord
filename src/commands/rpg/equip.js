// /equip - Pasang weapon atau armor
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getPlayer, getInventory, equipItem } from '../../services/rpgService.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { rarityEmoji } from '../../utils/helpers.js';
import { getItemById } from '../../data/items.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('equip')
  .setDescription('Pasang weapon atau armor')
  .addStringOption(opt => opt.setName('item').setDescription('ID item yang ingin dipasang').setRequired(true));

export async function execute(interaction, client) {
  const player = await getPlayer(client.prisma, interaction.user.id);
  if (!player) return interaction.reply({ embeds: [errorEmbed('❌', 'Belum terdaftar! `/start`')], flags: 64 });

  const itemId = interaction.options.getString('item');
  const item = getItemById(itemId);
  if (!item) return interaction.reply({ embeds: [errorEmbed('❌', 'Item tidak ditemukan.')], flags: 64 });
  if (item.type !== 'weapon' && item.type !== 'armor') {
    return interaction.reply({ embeds: [errorEmbed('❌', 'Item ini bukan weapon atau armor.')], flags: 64 });
  }

  // Cek apakah player punya item ini
  const inv = await client.prisma.inventoryItem.findUnique({
    where: { playerId_itemId: { playerId: player.id, itemId } },
  });
  if (!inv) return interaction.reply({ embeds: [errorEmbed('❌', 'Kamu tidak memiliki item ini.')], flags: 64 });

  const slot = item.type === 'weapon' ? 'weapon' : 'armor';
  await equipItem(client.prisma, player.id, itemId, slot);

  const statsStr = Object.entries(item.stats || {}).map(([k, v]) => `+${v} ${k}`).join(', ');

  const embed = new EmbedBuilder()
    .setColor(config.colors.success)
    .setTitle(`✅ ${item.type === 'weapon' ? '⚔️' : '🛡️'} Equipped!`)
    .setDescription(`${rarityEmoji(item.rarity)} **${item.name}** telah dipasang.\n📊 Stats: ${statsStr}`)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
