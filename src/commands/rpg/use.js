// /use - Gunakan item consumable
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getPlayer, getInventory, removeItem, healPlayer } from '../../services/rpgService.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { rarityEmoji } from '../../utils/helpers.js';
import { getItemById } from '../../data/items.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('use')
  .setDescription('Gunakan item consumable dari inventory')
  .addStringOption(opt =>
    opt.setName('item')
      .setDescription('ID item yang ingin dipakai')
      .setRequired(false)
      .setAutocomplete(true)
  );

export async function execute(interaction, client) {
  const player = await getPlayer(client.prisma, interaction.user.id);
  if (!player) return interaction.reply({ embeds: [errorEmbed('❌', 'Belum terdaftar! `/start`')], flags: 64 });

  const itemId = interaction.options.getString('item');

  // Jika tidak ada itemId yang diberikan, tampilkan list consumable item di inventory
  if (!itemId) {
    const inventory = await getInventory(client.prisma, player.id);
    const consumables = inventory
      .map(inv => ({ ...inv, itemData: getItemById(inv.itemId) }))
      .filter(inv => inv.itemData && inv.itemData.type === 'consumable');

    if (consumables.length === 0) {
      return interaction.reply({
        embeds: [errorEmbed('🧪 Inventory Kosong', 'Kamu tidak memiliki item consumable di inventory.')],
        flags: 64,
      });
    }

    const lines = consumables.map(inv => {
      const item = inv.itemData;
      return `${rarityEmoji(item.rarity)} **${item.name}** (\`${item.id}\`)\n└ Deskripsi: *${item.description || 'Tidak ada deskripsi'}* | Qty: *x${inv.quantity}*`;
    });

    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle('🧪 Item Consumable Yang Bisa Dipakai')
      .setDescription(`Pilih item dengan \`/use item:<id>\` atau pilih dari opsi autocomplete:\n\n${lines.join('\n\n')}`)
      .setFooter({ text: 'Tip: Ketik /use lalu pilih item dari daftar autocomplete.' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  const item = getItemById(itemId);
  if (!item) return interaction.reply({ embeds: [errorEmbed('❌', 'Item tidak ditemukan.')], flags: 64 });
  if (item.type !== 'consumable') return interaction.reply({ embeds: [errorEmbed('❌', 'Item ini bukan consumable. Gunakan `/equip` untuk weapon/armor.')], flags: 64 });

  const removed = await removeItem(client.prisma, player.id, itemId, 1);
  if (!removed) return interaction.reply({ embeds: [errorEmbed('❌', 'Kamu tidak memiliki item ini.')], flags: 64 });

  const effects = [];

  if (item.effect.heal) {
    await healPlayer(client.prisma, player.id, item.effect.heal);
    effects.push(`❤️ +${item.effect.heal} HP`);
  }
  if (item.effect.healFull) {
    await client.prisma.player.update({ where: { id: player.id }, data: { hp: player.maxHp } });
    effects.push('❤️ HP penuh!');
  }
  if (item.effect.permAttack) {
    await client.prisma.player.update({ where: { id: player.id }, data: { attack: { increment: item.effect.permAttack } } });
    effects.push(`⚔️ +${item.effect.permAttack} ATK (permanen)`);
  }
  if (item.effect.permDefense) {
    await client.prisma.player.update({ where: { id: player.id }, data: { defense: { increment: item.effect.permDefense } } });
    effects.push(`🛡️ +${item.effect.permDefense} DEF (permanen)`);
  }

  await interaction.reply({
    embeds: [successEmbed(`Menggunakan ${item.name}`, effects.join('\n') || 'Item digunakan.')],
  });
}

export async function autocomplete(interaction, client) {
  const focusedValue = interaction.options.getFocused().toLowerCase();
  const player = await getPlayer(client.prisma, interaction.user.id);
  if (!player) return interaction.respond([]);

  const inventory = await getInventory(client.prisma, player.id);
  const choices = inventory
    .map(inv => ({ ...inv, itemData: getItemById(inv.itemId) }))
    .filter(inv => inv.itemData && inv.itemData.type === 'consumable')
    .filter(inv => inv.itemData.name.toLowerCase().includes(focusedValue) || inv.itemId.toLowerCase().includes(focusedValue))
    .map(inv => ({
      name: `${inv.itemData.name} (x${inv.quantity})`,
      value: inv.itemId,
    }))
    .slice(0, 25);

  await interaction.respond(choices);
}
