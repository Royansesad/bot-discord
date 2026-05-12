// /weekly-boss - Melawan boss mingguan (turn-based interactive)
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getPlayer, addXp, addGold, addItem, getEffectiveStats } from '../../services/rpgService.js';
import { runInteractiveBattle, generateLoot } from '../../services/battleService.js';
import { checkPlayerCooldown, setPlayerCooldown, formatCooldown } from '../../utils/cooldown.js';
import { errorEmbed } from '../../utils/embeds.js';
import { randomInt, formatNumber, formatGold, rarityEmoji, getWeekStart } from '../../utils/helpers.js';
import { WEEKLY_BOSSES } from '../../data/bosses.js';
import { ALL_ITEMS } from '../../data/items.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('weekly-boss')
  .setDescription('Lawan boss mingguan! (Max 3x per minggu)')
  .addStringOption(opt => {
    const o = opt.setName('boss').setDescription('Pilih boss').setRequired(true);
    WEEKLY_BOSSES.forEach(b => o.addChoices({ name: `${b.name} (Lv.${b.level})`, value: b.id }));
    return o;
  });

export async function execute(interaction, client) {
  const player = await getPlayer(client.prisma, interaction.user.id);
  if (!player) return interaction.reply({ embeds: [errorEmbed('❌', 'Belum terdaftar! `/start`')], flags: 64 });

  if (player.hp <= 0) return interaction.reply({ embeds: [errorEmbed('💀', 'HP habis! Gunakan potion.')], flags: 64 });

  const bossId = interaction.options.getString('boss');
  const boss = WEEKLY_BOSSES.find(b => b.id === bossId);
  if (!boss) return interaction.reply({ embeds: [errorEmbed('❌', 'Boss tidak ditemukan.')], flags: 64 });

  // Cek level requirement - harus dalam range ±15 level
  if (boss.level > player.level + 15) {
    return interaction.reply({
      embeds: [errorEmbed('🚫 Level Terlalu Rendah', `Kamu butuh minimal **Level ${boss.level - 15}** untuk melawan **${boss.name}** (Lv.${boss.level}).\nLevel kamu: **${player.level}**`)],
      flags: 64,
    });
  }

  // Cek cooldown per attempt
  const cd = await checkPlayerCooldown(client.prisma, player.id, 'weekly-boss', config.cooldowns.weeklyBoss);
  if (cd > 0) return interaction.reply({ embeds: [errorEmbed('⏳', `Tunggu **${formatCooldown(cd)}**`)], flags: 64 });

  // Cek weekly attempts
  const weekStart = getWeekStart();
  let entry = await client.prisma.weeklyBossEntry.findUnique({
    where: { playerId_bossId_weekStart: { playerId: player.id, bossId, weekStart } },
  });

  if (entry && entry.attempts >= config.rpg.weeklyBossMaxAttempts) {
    return interaction.reply({ embeds: [errorEmbed('🚫 Limit', `Kamu sudah melawan **${boss.name}** ${config.rpg.weeklyBossMaxAttempts}x minggu ini. Tunggu minggu depan!`)], flags: 64 });
  }

  await interaction.deferReply();
  await setPlayerCooldown(client.prisma, player.id, 'weekly-boss', config.cooldowns.weeklyBoss);

  // Update attempt count
  if (entry) {
    await client.prisma.weeklyBossEntry.update({ where: { id: entry.id }, data: { attempts: { increment: 1 }, lastAttempt: new Date() } });
  } else {
    await client.prisma.weeklyBossEntry.create({ data: { playerId: player.id, bossId, weekStart, attempts: 1 } });
  }

  const stats = await getEffectiveStats(client.prisma, player, ALL_ITEMS);
  const playerStats = { ...player, ...stats, username: interaction.user.displayName };

  // Jalankan interactive battle
  const result = await runInteractiveBattle(interaction, playerStats, boss, config.colors);

  // Update HP di database
  await client.prisma.player.update({ where: { id: player.id }, data: { hp: result.remainingHp } });

  const attemptsLeft = config.rpg.weeklyBossMaxAttempts - ((entry?.attempts || 0) + 1);

  // Jika kabur atau kalah
  if (result.fled || !result.won) {
    const infoEmbed = new EmbedBuilder()
      .setColor(config.colors.warning)
      .setDescription(`🎟️ Sisa attempt minggu ini: **${attemptsLeft}**`)
      .setTimestamp();
    await interaction.followUp({ embeds: [infoEmbed] });
    return;
  }

  // Victory rewards
  const xp = randomInt(boss.xpReward.min, boss.xpReward.max);
  const gold = randomInt(boss.goldReward.min, boss.goldReward.max);
  const loot = generateLoot(boss);

  const levelResult = await addXp(client.prisma, player.id, xp);
  await addGold(client.prisma, player.id, gold);
  for (const drop of loot) await addItem(client.prisma, player.id, drop.itemId, drop.quantity);

  const rewardEmbed = new EmbedBuilder()
    .setColor(config.colors.legendary)
    .setTitle(`👑 WEEKLY BOSS DEFEATED! ${boss.name}`)
    .setDescription(`**${boss.title}**\n\nPertarungan selesai dalam **${result.turns}** turn!`)
    .addFields(
      { name: '🎁 Rewards', value: `✨ ${formatNumber(xp)} XP\n${formatGold(gold)}`, inline: true },
      { name: '📊 Info', value: `❤️ HP: ${result.remainingHp}/${playerStats.totalMaxHp}\n🎟️ Sisa attempt: ${attemptsLeft}`, inline: true },
    )
    .setTimestamp();

  if (loot.length > 0) {
    rewardEmbed.addFields({
      name: '📦 Boss Loot!',
      value: loot.map(l => `${rarityEmoji(l.item?.rarity)} ${l.item?.name || l.itemId} x${l.quantity}`).join('\n'),
    });
  }
  if (levelResult?.leveled) {
    rewardEmbed.addFields({ name: '🎉 LEVEL UP!', value: `Level → **${levelResult.newLevel}**` });
  }

  await interaction.followUp({ embeds: [rewardEmbed] });
}
