// /leaderboard - Menampilkan ranking pemain
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { formatNumber, formatGold } from '../../utils/helpers.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Lihat ranking pemain!')
  .addStringOption(opt =>
    opt.setName('category')
      .setDescription('Kategori ranking')
      .setRequired(false)
      .addChoices(
        { name: '📊 Level', value: 'level' },
        { name: '🪙 Gold', value: 'gold' },
        { name: '⚔️ Attack', value: 'attack' },
        { name: '🛡️ Defense', value: 'defense' },
        { name: '🏆 Total Wins', value: 'wins' },
      )
  );

export async function execute(interaction, client) {
  await interaction.deferReply();

  const category = interaction.options.getString('category') || 'level';

  const categoryMeta = {
    level: { emoji: '📊', title: 'Level', orderBy: { level: 'desc' }, field: (p) => `Lv.**${p.level}** (${formatNumber(p.xp)} XP)` },
    gold: { emoji: '🪙', title: 'Gold', orderBy: { gold: 'desc' }, field: (p) => `${formatGold(p.gold)}` },
    attack: { emoji: '⚔️', title: 'Attack', orderBy: { attack: 'desc' }, field: (p) => `⚔️ ${p.attack} ATK` },
    defense: { emoji: '🛡️', title: 'Defense', orderBy: { defense: 'desc' }, field: (p) => `🛡️ ${p.defense} DEF` },
    wins: { emoji: '🏆', title: 'Total Wins', orderBy: null, field: null }, // special case
  };

  const meta = categoryMeta[category];

  if (category === 'wins') {
    // Query battle log for wins count
    const winCounts = await client.prisma.battleLog.groupBy({
      by: ['attackerId'],
      where: { result: 'win' },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    });

    if (winCounts.length === 0) {
      return interaction.editReply({ embeds: [errorEmbed('📋', 'Belum ada data pertarungan.')] });
    }

    // Fetch player details
    const playerIds = winCounts.map(w => w.attackerId);
    const players = await client.prisma.player.findMany({
      where: { id: { in: playerIds } },
    });

    const playerMap = new Map(players.map(p => [p.id, p]));
    const callerPlayer = await client.prisma.player.findUnique({ where: { userId: interaction.user.id } });

    const lines = winCounts.map((w, idx) => {
      const p = playerMap.get(w.attackerId);
      const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `**#${idx + 1}**`;
      const isYou = p?.userId === interaction.user.id ? ' ← Kamu!' : '';
      return `${medal} **${p?.username || 'Unknown'}** — 🏆 ${w._count.id} wins${isYou}`;
    });

    // Find caller's rank
    let callerRank = null;
    if (callerPlayer) {
      const callerWins = await client.prisma.battleLog.count({
        where: { attackerId: callerPlayer.id, result: 'win' },
      });
      const higherCount = await client.prisma.$queryRawUnsafe(
        `SELECT COUNT(DISTINCT "attackerId") as cnt FROM "BattleLog" WHERE "result" = 'win' GROUP BY "attackerId" HAVING COUNT("id") > ${callerWins}`
      ).catch(() => []);
      callerRank = { rank: (higherCount?.length || 0) + 1, wins: callerWins };
    }

    const embed = new EmbedBuilder()
      .setColor(config.colors.legendary)
      .setTitle(`🏆 Leaderboard — Total Wins`)
      .setDescription(lines.join('\n'))
      .setTimestamp()
      .setFooter({ text: callerRank ? `Peringkatmu: #${callerRank.rank} (${callerRank.wins} wins)` : 'Belum terdaftar RPG' });

    return interaction.editReply({ embeds: [embed] });
  }

  // Standard leaderboard
  const players = await client.prisma.player.findMany({
    orderBy: meta.orderBy,
    take: 10,
  });

  if (players.length === 0) {
    return interaction.editReply({ embeds: [errorEmbed('📋', 'Belum ada pemain terdaftar.')] });
  }

  // Find caller's rank
  const callerPlayer = await client.prisma.player.findUnique({ where: { userId: interaction.user.id } });
  let callerRank = null;

  if (callerPlayer) {
    const orderField = Object.keys(meta.orderBy)[0];
    const callerValue = callerPlayer[orderField];

    const higherCount = await client.prisma.player.count({
      where: { [orderField]: { gt: callerValue } },
    });
    callerRank = higherCount + 1;
  }

  const lines = players.map((p, idx) => {
    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `**#${idx + 1}**`;
    const isYou = p.userId === interaction.user.id ? ' ← Kamu!' : '';
    return `${medal} **${p.username}** — ${meta.field(p)}${isYou}`;
  });

  const embed = new EmbedBuilder()
    .setColor(config.colors.legendary)
    .setTitle(`${meta.emoji} Leaderboard — ${meta.title}`)
    .setDescription(lines.join('\n'))
    .setTimestamp()
    .setFooter({ text: callerRank ? `Peringkatmu: #${callerRank}` : 'Belum terdaftar RPG' });

  await interaction.editReply({ embeds: [embed] });
}
