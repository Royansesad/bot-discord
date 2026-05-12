// /daily - Klaim reward harian
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getPlayer, addXp, addGold } from '../../services/rpgService.js';
import { checkPlayerCooldown, setPlayerCooldown, formatCooldown } from '../../utils/cooldown.js';
import { errorEmbed } from '../../utils/embeds.js';
import { randomInt, formatNumber, formatGold } from '../../utils/helpers.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('daily')
  .setDescription('Klaim reward harian');

export async function execute(interaction, client) {
  const player = await getPlayer(client.prisma, interaction.user.id);
  if (!player) return interaction.reply({ embeds: [errorEmbed('❌', 'Belum terdaftar! `/start`')], flags: 64 });

  const cd = await checkPlayerCooldown(client.prisma, player.id, 'daily', config.cooldowns.daily);
  if (cd > 0) return interaction.reply({ embeds: [errorEmbed('⏳ Cooldown', `Daily reward bisa diklaim lagi dalam **${formatCooldown(cd)}**`)], flags: 64 });

  const gold = randomInt(config.rpg.dailyGold.min, config.rpg.dailyGold.max);
  const xp = randomInt(config.rpg.dailyXp.min, config.rpg.dailyXp.max);

  await addGold(client.prisma, player.id, gold);
  const levelResult = await addXp(client.prisma, player.id, xp);
  await setPlayerCooldown(client.prisma, player.id, 'daily', config.cooldowns.daily);

  const embed = new EmbedBuilder()
    .setColor(config.colors.success)
    .setTitle('🎁 Daily Reward!')
    .setDescription(`Selamat, **${interaction.user.displayName}**! Kamu mendapatkan:`)
    .addFields(
      { name: '🪙 Gold', value: `+${formatNumber(gold)}`, inline: true },
      { name: '✨ XP', value: `+${formatNumber(xp)}`, inline: true },
    )
    .setThumbnail(interaction.user.displayAvatarURL())
    .setTimestamp();

  if (levelResult?.leveled) {
    embed.addFields({ name: '🎉 LEVEL UP!', value: `Level → **${levelResult.newLevel}**` });
  }

  await interaction.reply({ embeds: [embed] });
}
