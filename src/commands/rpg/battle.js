// /battle - Melawan enemy yang tersedia (turn-based interactive)
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getPlayer, addXp, addGold, addItem, getEffectiveStats } from '../../services/rpgService.js';
import { runInteractiveBattle, generateLoot } from '../../services/battleService.js';
import { checkPlayerCooldown, setPlayerCooldown, formatCooldown } from '../../utils/cooldown.js';
import { errorEmbed } from '../../utils/embeds.js';
import { randomInt, formatNumber, formatGold, rarityEmoji } from '../../utils/helpers.js';
import { ENEMIES, getEnemiesForLevel } from '../../data/enemies.js';
import { ALL_ITEMS } from '../../data/items.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('battle')
  .setDescription('Melawan enemy yang tersedia di levelmu')
  .addStringOption(opt => {
    const o = opt.setName('enemy').setDescription('Pilih enemy').setRequired(true);
    ENEMIES.forEach(e => o.addChoices({ name: `${e.name} (Lv.${e.level})`, value: e.id }));
    return o;
  });

export async function execute(interaction, client) {
  const player = await getPlayer(client.prisma, interaction.user.id);
  if (!player) return interaction.reply({ embeds: [errorEmbed('❌', 'Belum terdaftar! `/start`')], flags: 64 });
  if (player.hp <= 0) return interaction.reply({ embeds: [errorEmbed('💀', 'HP habis! Gunakan potion.')], flags: 64 });

  const enemyId = interaction.options.getString('enemy');
  const enemy = ENEMIES.find(e => e.id === enemyId);
  if (!enemy) return interaction.reply({ embeds: [errorEmbed('❌', 'Enemy tidak ditemukan.')], flags: 64 });

  // Cek apakah enemy sesuai level
  const available = getEnemiesForLevel(player.level);
  if (!available.find(e => e.id === enemyId)) {
    return interaction.reply({ embeds: [errorEmbed('🚫', `${enemy.name} tidak tersedia di levelmu. Level kamu: ${player.level}, enemy level: ${enemy.level}`)], flags: 64 });
  }

  const cd = await checkPlayerCooldown(client.prisma, player.id, 'battle', config.cooldowns.battle);
  if (cd > 0) return interaction.reply({ embeds: [errorEmbed('⏳', `Tunggu **${formatCooldown(cd)}**`)], flags: 64 });

  await interaction.deferReply();
  await setPlayerCooldown(client.prisma, player.id, 'battle', config.cooldowns.battle);

  const stats = await getEffectiveStats(client.prisma, player, ALL_ITEMS);
  const playerStats = { ...player, ...stats, username: interaction.user.displayName };

  // Jalankan interactive battle
  const result = await runInteractiveBattle(interaction, playerStats, enemy, config.colors);

  // Update HP di database
  await client.prisma.player.update({ where: { id: player.id }, data: { hp: result.remainingHp } });

  // Jika kabur atau kalah, tidak ada reward
  if (result.fled || !result.won) return;

  // Victory rewards
  const xp = randomInt(enemy.xpReward.min, enemy.xpReward.max);
  const gold = randomInt(enemy.goldReward.min, enemy.goldReward.max);
  const loot = generateLoot(enemy);

  const levelResult = await addXp(client.prisma, player.id, xp);
  await addGold(client.prisma, player.id, gold);
  for (const drop of loot) await addItem(client.prisma, player.id, drop.itemId, drop.quantity);

  // Build reward embed
  const rewardEmbed = new EmbedBuilder()
    .setColor(config.colors.success)
    .setTitle(`🎁 Rewards — vs ${enemy.name}`)
    .setDescription(`Pertarungan selesai dalam **${result.turns}** turn!`)
    .addFields(
      { name: '✨ XP & Gold', value: `✨ ${formatNumber(xp)} XP\n${formatGold(gold)}`, inline: true },
      { name: '❤️ HP Sisa', value: `${result.remainingHp}/${playerStats.totalMaxHp}`, inline: true },
    )
    .setTimestamp();

  if (loot.length > 0) {
    rewardEmbed.addFields({
      name: '📦 Loot',
      value: loot.map(l => `${rarityEmoji(l.item?.rarity)} ${l.item?.name} x${l.quantity}`).join('\n'),
    });
  }
  if (levelResult?.leveled) {
    rewardEmbed.addFields({ name: '🎉 LEVEL UP!', value: `Level → **${levelResult.newLevel}**` });
  }

  await interaction.followUp({ embeds: [rewardEmbed] });
}
