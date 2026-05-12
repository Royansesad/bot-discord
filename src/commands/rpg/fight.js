// /fight - Duel PvP antar player
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getPlayer, addXp, addGold, getEffectiveStats, logBattle } from '../../services/rpgService.js';
import { simulatePvP } from '../../services/battleService.js';
import { checkPlayerCooldown, setPlayerCooldown, formatCooldown } from '../../utils/cooldown.js';
import { errorEmbed } from '../../utils/embeds.js';
import { randomInt, formatNumber, formatGold } from '../../utils/helpers.js';
import { ALL_ITEMS } from '../../data/items.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('fight')
  .setDescription('Duel PvP melawan player lain!')
  .addUserOption(opt => opt.setName('opponent').setDescription('Player yang ingin kamu lawan').setRequired(true));

export async function execute(interaction, client) {
  const opponent = interaction.options.getUser('opponent');
  if (opponent.id === interaction.user.id) return interaction.reply({ embeds: [errorEmbed('❌', 'Tidak bisa melawan diri sendiri!')], flags: 64 });
  if (opponent.bot) return interaction.reply({ embeds: [errorEmbed('❌', 'Tidak bisa melawan bot!')], flags: 64 });

  const player1 = await getPlayer(client.prisma, interaction.user.id);
  const player2 = await getPlayer(client.prisma, opponent.id);
  if (!player1) return interaction.reply({ embeds: [errorEmbed('❌', 'Kamu belum terdaftar! `/start`')], flags: 64 });
  if (!player2) return interaction.reply({ embeds: [errorEmbed('❌', `${opponent.displayName} belum terdaftar di RPG.`)], flags: 64 });
  if (player1.hp <= 0) return interaction.reply({ embeds: [errorEmbed('💀', 'HP-mu habis!')], flags: 64 });
  if (player2.hp <= 0) return interaction.reply({ embeds: [errorEmbed('💀', `${opponent.displayName} sedang KO.`)], flags: 64 });

  const cd = await checkPlayerCooldown(client.prisma, player1.id, 'fight', config.cooldowns.fight);
  if (cd > 0) return interaction.reply({ embeds: [errorEmbed('⏳', `Tunggu **${formatCooldown(cd)}**`)], flags: 64 });

  await interaction.deferReply();
  await setPlayerCooldown(client.prisma, player1.id, 'fight', config.cooldowns.fight);

  const stats1 = await getEffectiveStats(client.prisma, player1, ALL_ITEMS);
  const stats2 = await getEffectiveStats(client.prisma, player2, ALL_ITEMS);
  const p1Stats = { ...player1, ...stats1, username: interaction.user.displayName };
  const p2Stats = { ...player2, ...stats2, username: opponent.displayName };

  const result = simulatePvP(p1Stats, p2Stats);
  const battleLog = result.log.slice(0, 18).join('\n');

  const embed = new EmbedBuilder().setTimestamp();
  const xpReward = randomInt(20, 50 + Math.abs(player1.level - player2.level) * 5);
  const goldReward = randomInt(10, 30 + Math.abs(player1.level - player2.level) * 3);

  if (result.winner === 1) {
    await addXp(client.prisma, player1.id, xpReward);
    await addGold(client.prisma, player1.id, goldReward);
    embed.setColor(config.colors.success).setTitle(`🏆 ${interaction.user.displayName} Menang!`);
  } else if (result.winner === 2) {
    await addXp(client.prisma, player2.id, xpReward);
    await addGold(client.prisma, player2.id, goldReward);
    embed.setColor(config.colors.danger).setTitle(`🏆 ${opponent.displayName} Menang!`);
  } else {
    embed.setColor(config.colors.warning).setTitle('🤝 Seri!');
  }

  embed.setDescription(battleLog);
  if (result.winner !== 0) {
    const winnerName = result.winner === 1 ? interaction.user.displayName : opponent.displayName;
    embed.addFields({ name: '🎁 Reward', value: `${winnerName} mendapat ✨ ${xpReward} XP, ${formatGold(goldReward)}` });
  }

  await logBattle(client.prisma, {
    attackerId: player1.id, defenderId: player2.id,
    result: result.winner === 1 ? 'win' : result.winner === 2 ? 'lose' : 'draw',
    xpGained: result.winner === 1 ? xpReward : 0, goldGained: result.winner === 1 ? goldReward : 0,
    details: { turns: result.turns },
  });

  await interaction.editReply({ embeds: [embed] });
}
