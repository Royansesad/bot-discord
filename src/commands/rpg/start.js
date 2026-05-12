// /start - Registrasi pemain RPG
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getPlayer, registerPlayer } from '../../services/rpgService.js';
import { errorEmbed } from '../../utils/embeds.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('start')
  .setDescription('Mulai petualangan RPG! Registrasi karakter baru.');

export async function execute(interaction, client) {
  const existing = await getPlayer(client.prisma, interaction.user.id);
  if (existing) {
    return interaction.reply({ embeds: [errorEmbed('⚠️ Sudah Terdaftar', 'Kamu sudah memiliki karakter! Gunakan `/profile` untuk melihat profilmu.')], flags: 64 });
  }

  const player = await registerPlayer(client.prisma, interaction.user.id, interaction.user.displayName);

  const embed = new EmbedBuilder()
    .setColor(config.colors.rpg)
    .setTitle('⚔️ Petualangan Dimulai!')
    .setDescription(`Selamat datang, **${interaction.user.displayName}**!\nKarakter RPG-mu telah dibuat. Siap bertarung?`)
    .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: '📊 Level', value: '1', inline: true },
      { name: '❤️ HP', value: '100/100', inline: true },
      { name: '🪙 Gold', value: '100', inline: true },
      { name: '⚔️ Attack', value: '10', inline: true },
      { name: '🛡️ Defense', value: '5', inline: true },
      { name: '💥 Crit Rate', value: '5%', inline: true },
    )
    .addFields(
      { name: '📌 Commands Penting', value: [
        '`/adventure` - Pergi berpetualang',
        '`/profile` - Lihat profil',
        '`/store` - Beli item',
        '`/inventory` - Lihat inventory',
        '`/daily` - Klaim reward harian',
      ].join('\n') }
    )
    .setFooter({ text: 'Gunakan /adventure untuk memulai petualangan!' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
