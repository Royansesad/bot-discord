// /use - Gunakan item consumable
import { SlashCommandBuilder } from 'discord.js';
import { getPlayer, removeItem, healPlayer } from '../../services/rpgService.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { getItemById } from '../../data/items.js';

export const data = new SlashCommandBuilder()
  .setName('use')
  .setDescription('Gunakan item consumable')
  .addStringOption(opt => opt.setName('item').setDescription('ID item yang ingin dipakai').setRequired(true));

export async function execute(interaction, client) {
  const player = await getPlayer(client.prisma, interaction.user.id);
  if (!player) return interaction.reply({ embeds: [errorEmbed('❌', 'Belum terdaftar! `/start`')], flags: 64 });

  const itemId = interaction.options.getString('item');
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
