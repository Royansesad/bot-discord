// /profile - Lihat profil player RPG
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getPlayer, getEffectiveStats, getInventory } from '../../services/rpgService.js';
import { errorEmbed, hpBar, progressBar } from '../../utils/embeds.js';
import { formatNumber, formatGold, rarityEmoji } from '../../utils/helpers.js';
import { ALL_ITEMS, getItemById } from '../../data/items.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('profile')
  .setDescription('Lihat profil RPG')
  .addUserOption(opt => opt.setName('user').setDescription('Lihat profil user lain'));

export async function execute(interaction, client) {
  const targetUser = interaction.options.getUser('user') || interaction.user;
  const player = await getPlayer(client.prisma, targetUser.id);

  if (!player) {
    const msg = targetUser.id === interaction.user.id
      ? 'Kamu belum terdaftar! Gunakan `/start` untuk memulai.'
      : 'User ini belum terdaftar di RPG.';
    return interaction.reply({ embeds: [errorEmbed('❌ Not Found', msg)], flags: 64 });
  }

  const stats = await getEffectiveStats(client.prisma, player, ALL_ITEMS);
  const inventory = await getInventory(client.prisma, player.id);

  // Equipment info
  const weaponItem = player.weaponId ? getItemById(player.weaponId) : null;
  const armorItem = player.armorId ? getItemById(player.armorId) : null;
  const weaponStr = weaponItem ? `${rarityEmoji(weaponItem.rarity)} ${weaponItem.name}` : '❌ Kosong';
  const armorStr = armorItem ? `${rarityEmoji(armorItem.rarity)} ${armorItem.name}` : '❌ Kosong';

  const embed = new EmbedBuilder()
    .setColor(config.colors.rpg)
    .setTitle(`⚔️ Profil ${targetUser.displayName}`)
    .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: '📊 Level', value: `**${player.level}**`, inline: true },
      { name: '✨ XP', value: `${formatNumber(player.xp)}/${formatNumber(player.xpToNext)}\n${progressBar(player.xp, player.xpToNext, 8)}`, inline: true },
      { name: '🪙 Gold', value: formatNumber(player.gold), inline: true },
      { name: '❤️ HP', value: hpBar(player.hp, stats.totalMaxHp), inline: false },
      { name: '⚔️ Attack', value: `${stats.totalAttack}${weaponItem ? ` (+${weaponItem.stats.attack})` : ''}`, inline: true },
      { name: '🛡️ Defense', value: `${stats.totalDefense}${armorItem?.stats?.defense ? ` (+${armorItem.stats.defense})` : ''}`, inline: true },
      { name: '💥 Crit', value: `${(stats.totalCritRate * 100).toFixed(1)}% / x${stats.totalCritDmg.toFixed(1)}`, inline: true },
      { name: '⚔️ Weapon', value: weaponStr, inline: true },
      { name: '🛡️ Armor', value: armorStr, inline: true },
      { name: '🎒 Items', value: `${inventory.length} jenis item`, inline: true },
    )
    .setFooter({ text: `Player sejak ${player.createdAt.toLocaleDateString('id-ID')}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
