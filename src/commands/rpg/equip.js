// /equip - Pasang weapon atau armor
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getPlayer, getInventory, equipItem } from '../../services/rpgService.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { rarityEmoji } from '../../utils/helpers.js';
import { getItemById } from '../../data/items.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('equip')
  .setDescription('Pasang weapon atau armor dari inventory')
  .addStringOption(opt =>
    opt.setName('item')
      .setDescription('ID item yang ingin dipasang')
      .setRequired(false)
      .setAutocomplete(true)
  );

export async function execute(interaction, client) {
  const player = await getPlayer(client.prisma, interaction.user.id);
  if (!player) return interaction.reply({ embeds: [errorEmbed('❌', 'Belum terdaftar! `/start`')], flags: 64 });

  const itemId = interaction.options.getString('item');

  // Jika tidak ada itemId yang diberikan, tampilkan list item yang bisa dipasang
  if (!itemId) {
    const inventory = await getInventory(client.prisma, player.id);
    const equippables = inventory
      .map(inv => ({ ...inv, itemData: getItemById(inv.itemId) }))
      .filter(inv => inv.itemData && (inv.itemData.type === 'weapon' || inv.itemData.type === 'armor'));

    if (equippables.length === 0) {
      return interaction.reply({
        embeds: [errorEmbed('🎒 Inventory Kosong', 'Kamu tidak memiliki weapon atau armor di inventory.')],
        flags: 64,
      });
    }

    const lines = equippables.map(inv => {
      const item = inv.itemData;
      const statsStr = Object.entries(item.stats || {}).map(([k, v]) => `+${v} ${k}`).join(', ');
      const isEquipped = (item.type === 'weapon' && player.weaponId === item.id) || (item.type === 'armor' && player.armorId === item.id);
      const equippedTag = isEquipped ? ' **[DIPASANG]**' : '';
      return `${rarityEmoji(item.rarity)} **${item.name}** (\`${item.id}\`)${equippedTag}\n└ Tipe: *${item.type.toUpperCase()}* | Stats: *${statsStr || 'None'}* | Qty: *x${inv.quantity}*`;
    });

    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle('⚔️ Equipment Yang Bisa Dipasang')
      .setDescription(`Pilih item dengan \`/equip item:<id>\` atau pilih dari opsi autocomplete:\n\n${lines.join('\n\n')}`)
      .setFooter({ text: 'Tip: Ketik /equip lalu pilih item dari daftar autocomplete.' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

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

export async function autocomplete(interaction, client) {
  const focusedValue = interaction.options.getFocused().toLowerCase();
  const player = await getPlayer(client.prisma, interaction.user.id);
  if (!player) return interaction.respond([]);

  const inventory = await getInventory(client.prisma, player.id);
  const choices = inventory
    .map(inv => ({ ...inv, itemData: getItemById(inv.itemId) }))
    .filter(inv => inv.itemData && (inv.itemData.type === 'weapon' || inv.itemData.type === 'armor'))
    .filter(inv => inv.itemData.name.toLowerCase().includes(focusedValue) || inv.itemId.toLowerCase().includes(focusedValue))
    .map(inv => {
      const isEquipped = (inv.itemData.type === 'weapon' && player.weaponId === inv.itemId) || (inv.itemData.type === 'armor' && player.armorId === inv.itemId);
      const tag = isEquipped ? ' [DIPASANG]' : '';
      return {
        name: `${inv.itemData.name} (${inv.itemData.type.toUpperCase()})${tag}`,
        value: inv.itemId,
      };
    })
    .slice(0, 25);

  await interaction.respond(choices);
}
