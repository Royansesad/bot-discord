// /weekly - Klaim reward mingguan
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getPlayer, addXp, addGold, addItem } from '../../services/rpgService.js';
import { checkPlayerCooldown, setPlayerCooldown, formatCooldown } from '../../utils/cooldown.js';
import { errorEmbed } from '../../utils/embeds.js';
import { randomInt, randomPick, formatNumber, formatGold, rarityEmoji } from '../../utils/helpers.js';
import { getItemById } from '../../data/items.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('weekly')
  .setDescription('Klaim reward mingguan');

export async function execute(interaction, client) {
  const player = await getPlayer(client.prisma, interaction.user.id);
  if (!player) return interaction.reply({ embeds: [errorEmbed('❌', 'Belum terdaftar! `/start`')], flags: 64 });

  const cd = await checkPlayerCooldown(client.prisma, player.id, 'weekly', config.cooldowns.weekly);
  if (cd > 0) return interaction.reply({ embeds: [errorEmbed('⏳ Cooldown', `Weekly reward bisa diklaim dalam **${formatCooldown(cd)}**`)], flags: 64 });

  const gold = randomInt(config.rpg.weeklyGold.min, config.rpg.weeklyGold.max);
  const xp = randomInt(config.rpg.weeklyXp.min, config.rpg.weeklyXp.max);

  // Bonus item random
  const bonusItems = ['health_potion', 'greater_health_potion', 'attack_potion', 'defense_potion'];
  const bonusItemId = randomPick(bonusItems);
  const bonusItem = getItemById(bonusItemId);

  await addGold(client.prisma, player.id, gold);
  const levelResult = await addXp(client.prisma, player.id, xp);
  await addItem(client.prisma, player.id, bonusItemId, 1);
  await setPlayerCooldown(client.prisma, player.id, 'weekly', config.cooldowns.weekly);

  const embed = new EmbedBuilder()
    .setColor(config.colors.legendary)
    .setTitle('🎁 Weekly Reward!')
    .setDescription(`Selamat, **${interaction.user.displayName}**!`)
    .addFields(
      { name: '🪙 Gold', value: `+${formatNumber(gold)}`, inline: true },
      { name: '✨ XP', value: `+${formatNumber(xp)}`, inline: true },
      { name: '🎁 Bonus Item', value: `${rarityEmoji(bonusItem?.rarity)} ${bonusItem?.name}`, inline: true },
    )
    .setThumbnail(interaction.user.displayAvatarURL())
    .setTimestamp();

  if (levelResult?.leveled) {
    embed.addFields({ name: '🎉 LEVEL UP!', value: `Level → **${levelResult.newLevel}**` });
  }

  await interaction.reply({ embeds: [embed] });
}
