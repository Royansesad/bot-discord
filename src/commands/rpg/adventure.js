// /adventure - Pergi berpetualang
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getPlayer, addXp, addGold, addItem, healPlayer } from '../../services/rpgService.js';
import { getEffectiveStats } from '../../services/rpgService.js';
import { runInteractiveBattle, generateLoot } from '../../services/battleService.js';
import { checkPlayerCooldown, setPlayerCooldown, formatCooldown } from '../../utils/cooldown.js';
import { errorEmbed, rpgEmbed, rarityEmbed } from '../../utils/embeds.js';
import { randomInt, randomPick, formatNumber, formatGold, rarityEmoji } from '../../utils/helpers.js';
import { getEnemiesForLevel } from '../../data/enemies.js';
import { getBossForLevel } from '../../data/bosses.js';
import { getRandomEvent, ADVENTURE_EVENTS } from '../../data/events.js';
import { ALL_ITEMS, getItemById } from '../../data/items.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('adventure')
  .setDescription('Pergi berpetualang! Temukan musuh, boss, atau event.');

export async function execute(interaction, client) {
  const player = await getPlayer(client.prisma, interaction.user.id);
  if (!player) return interaction.reply({ embeds: [errorEmbed('❌', 'Belum terdaftar! Gunakan `/start`')], flags: 64 });

  // Cek cooldown
  const remaining = await checkPlayerCooldown(client.prisma, player.id, 'adventure', config.cooldowns.adventure);
  if (remaining > 0) {
    return interaction.reply({
      embeds: [errorEmbed('⏳ Cooldown', `Tunggu **${formatCooldown(remaining)}** sebelum berpetualang lagi.`)],
      flags: 64,
    });
  }

  // Cek HP
  if (player.hp <= 0) {
    await client.prisma.player.update({ where: { id: player.id }, data: { hp: Math.floor(player.maxHp * 0.3) } });
    return interaction.reply({
      embeds: [errorEmbed('💀 KO', 'HP-mu habis! Kamu telah dipulihkan 30% HP. Gunakan potion untuk heal sepenuhnya.')],
      flags: 64,
    });
  }

  await interaction.deferReply();
  await setPlayerCooldown(client.prisma, player.id, 'adventure', config.cooldowns.adventure);

  // Tentukan encounter
  const rates = config.rpg.adventureEncounterRates;
  const roll = Math.random();
  let encounterType;
  if (roll < rates.enemy) encounterType = 'enemy';
  else if (roll < rates.enemy + rates.boss) encounterType = 'boss';
  else if (roll < rates.enemy + rates.boss + rates.event) encounterType = 'event';
  else encounterType = 'nothing';

  const stats = await getEffectiveStats(client.prisma, player, ALL_ITEMS);
  const playerStats = { ...player, ...stats, username: interaction.user.displayName };

  if (encounterType === 'enemy') {
    await handleEnemyEncounter(interaction, client, player, playerStats);
  } else if (encounterType === 'boss') {
    await handleBossEncounter(interaction, client, player, playerStats);
  } else if (encounterType === 'event') {
    await handleEventEncounter(interaction, client, player);
  } else {
    await handleNothing(interaction);
  }
}

async function handleEnemyEncounter(interaction, client, player, playerStats) {
  const enemies = getEnemiesForLevel(player.level);
  const enemy = randomPick(enemies.length > 0 ? enemies : [{ id: 'slime', name: '🟢 Slime', level: 1, hp: 30, attack: 5, defense: 2, critRate: 0.02, critDmg: 1.2, xpReward: { min: 10, max: 20 }, goldReward: { min: 5, max: 15 }, drops: [] }]);

  // Tampilkan encounter intro lalu jalankan interactive battle
  const introEmbed = new EmbedBuilder()
    .setColor(config.colors.rpg)
    .setTitle(`🗺️ Petualangan — Encounter!`)
    .setDescription(`Kamu menemukan **${enemy.name}** (Lv.${enemy.level}) di perjalananmu!`)
    .setTimestamp();
  await interaction.editReply({ embeds: [introEmbed] });

  // Jalankan interactive battle
  const result = await runInteractiveBattle(interaction, playerStats, enemy, config.colors);

  // Update player HP
  await client.prisma.player.update({ where: { id: player.id }, data: { hp: result.remainingHp } });

  // Jika kabur atau kalah, tidak ada reward
  if (result.fled || !result.won) return;

  // Victory rewards
  const xp = randomInt(enemy.xpReward.min, enemy.xpReward.max);
  const gold = randomInt(enemy.goldReward.min, enemy.goldReward.max);
  const loot = generateLoot(enemy);

  const levelResult = await addXp(client.prisma, player.id, xp);
  await addGold(client.prisma, player.id, gold);

  for (const drop of loot) {
    await addItem(client.prisma, player.id, drop.itemId, drop.quantity);
  }

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
    rewardEmbed.addFields({ name: '📦 Loot', value: loot.map(l => `${rarityEmoji(l.item?.rarity)} ${l.item?.name || l.itemId} x${l.quantity}`).join('\n') });
  }

  if (levelResult?.leveled) {
    rewardEmbed.addFields({ name: '🎉 LEVEL UP!', value: `Level ${player.level} → **${levelResult.newLevel}**\n+${levelResult.statGains.maxHp} HP, +${levelResult.statGains.attack} ATK, +${levelResult.statGains.defense} DEF` });
  }

  await interaction.followUp({ embeds: [rewardEmbed] });
}

async function handleBossEncounter(interaction, client, player, playerStats) {
  const boss = getBossForLevel(player.level);

  // Tampilkan encounter intro
  const introEmbed = new EmbedBuilder()
    .setColor(config.colors.legendary)
    .setTitle(`🗺️ Petualangan — BOSS Encounter!`)
    .setDescription(`⚠️ Kamu menemukan **${boss.name}** — *${boss.title}*!\nBoss Lv.${boss.level} menghadangmu!`)
    .setTimestamp();
  await interaction.editReply({ embeds: [introEmbed] });

  // Jalankan interactive battle
  const result = await runInteractiveBattle(interaction, playerStats, boss, config.colors);

  await client.prisma.player.update({ where: { id: player.id }, data: { hp: result.remainingHp } });

  if (result.fled || !result.won) return;

  // Victory rewards
  const xp = randomInt(boss.xpReward.min, boss.xpReward.max);
  const gold = randomInt(boss.goldReward.min, boss.goldReward.max);
  const loot = generateLoot(boss);

  const levelResult = await addXp(client.prisma, player.id, xp);
  await addGold(client.prisma, player.id, gold);
  for (const drop of loot) await addItem(client.prisma, player.id, drop.itemId, drop.quantity);

  const rewardEmbed = new EmbedBuilder()
    .setColor(config.colors.legendary)
    .setTitle(`👑 BOSS DEFEATED! ${boss.name}`)
    .setDescription(`**${boss.title}**\n\nPertarungan selesai dalam **${result.turns}** turn!`)
    .addFields(
      { name: '🎁 Rewards', value: `✨ ${formatNumber(xp)} XP\n${formatGold(gold)}`, inline: true },
      { name: '❤️ HP Sisa', value: `${result.remainingHp}/${playerStats.totalMaxHp}`, inline: true },
    )
    .setTimestamp();

  if (loot.length > 0) {
    rewardEmbed.addFields({ name: '📦 Boss Loot!', value: loot.map(l => `${rarityEmoji(l.item?.rarity)} ${l.item?.name || l.itemId} x${l.quantity}`).join('\n') });
  }
  if (levelResult?.leveled) {
    rewardEmbed.addFields({ name: '🎉 LEVEL UP!', value: `Level → **${levelResult.newLevel}**` });
  }

  await interaction.followUp({ embeds: [rewardEmbed] });
}

async function handleEventEncounter(interaction, client, player) {
  const event = getRandomEvent();
  const embed = new EmbedBuilder()
    .setColor(event.type === 'penalty' ? config.colors.danger : config.colors.success)
    .setTitle(event.name)
    .setDescription(event.description)
    .setTimestamp();

  let rewards = [];

  // Gold reward
  if (event.rewards?.gold) {
    const gold = randomInt(event.rewards.gold.min, event.rewards.gold.max);
    await addGold(client.prisma, player.id, gold);
    rewards.push(formatGold(gold));
  }

  // XP reward
  if (event.rewards?.xp) {
    const xp = randomInt(event.rewards.xp.min, event.rewards.xp.max);
    await addXp(client.prisma, player.id, xp);
    rewards.push(`✨ ${xp} XP`);
  }

  // Heal
  if (event.rewards?.heal) {
    await healPlayer(client.prisma, player.id, event.rewards.heal);
    rewards.push(`❤️ +${event.rewards.heal} HP`);
  }
  if (event.rewards?.healFull) {
    await client.prisma.player.update({ where: { id: player.id }, data: { hp: player.maxHp } });
    rewards.push('❤️ HP penuh!');
  }

  // Item drop
  if (event.itemChance && Math.random() < event.itemChance && event.possibleItems) {
    const itemId = randomPick(event.possibleItems);
    const item = getItemById(itemId);
    await addItem(client.prisma, player.id, itemId, 1);
    rewards.push(`📦 ${item?.name || itemId}`);
  }

  // Penalties
  if (event.penalty?.damage) {
    const dmg = randomInt(event.penalty.damage.min, event.penalty.damage.max);
    const newHp = Math.max(1, player.hp - dmg);
    await client.prisma.player.update({ where: { id: player.id }, data: { hp: newHp } });
    rewards.push(`💔 -${dmg} HP`);
  }
  if (event.penalty?.goldLoss) {
    const loss = Math.min(player.gold, randomInt(event.penalty.goldLoss.min, event.penalty.goldLoss.max));
    await addGold(client.prisma, player.id, -loss);
    rewards.push(`💸 -${loss} Gold`);
  }

  if (rewards.length > 0) {
    embed.addFields({ name: '📋 Hasil', value: rewards.join('\n') });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleNothing(interaction) {
  const messages = [
    '🌿 Kamu menjelajah hutan tapi tidak menemukan apa-apa...',
    '🏜️ Padang pasir kosong membentang. Tidak ada yang menarik.',
    '🌧️ Hujan turun deras, membuatmu kembali ke camp.',
    '🦗 Hanya suara jangkrik yang menemanimu. Coba lagi nanti!',
    '🌫️ Kabut tebal menghalangi jalan. Kamu kembali tanpa hasil.',
  ];

  const embed = new EmbedBuilder()
    .setColor(config.colors.common)
    .setTitle('🚶 Petualangan Kosong')
    .setDescription(randomPick(messages))
    .setFooter({ text: 'Coba lagi nanti! Siapa tahu kali berikutnya lebih beruntung.' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
