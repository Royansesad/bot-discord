// /help - Menampilkan daftar semua command
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Menampilkan daftar semua command yang tersedia')
  .addStringOption(opt =>
    opt.setName('category')
      .setDescription('Lihat command berdasarkan kategori')
      .setRequired(false)
      .addChoices(
        { name: '⚔️ RPG', value: 'rpg' },
        { name: '🛡️ Admin', value: 'admin' },
        { name: '🎉 Fun', value: 'fun' },
        { name: '🎵 Music', value: 'music' },
      )
  );

export async function execute(interaction, client) {
  const category = interaction.options.getString('category');

  // Kelompokkan commands berdasarkan kategori
  const categories = {};
  for (const [name, cmd] of client.commands) {
    const cat = cmd.category || 'other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push({
      name: cmd.data.name,
      description: cmd.data.description,
    });
  }

  const categoryMeta = {
    rpg: { emoji: '⚔️', title: 'RPG', description: 'Command untuk bermain RPG adventure!' },
    admin: { emoji: '🛡️', title: 'Admin', description: 'Command moderasi server.' },
    fun: { emoji: '🎉', title: 'Fun', description: 'Command hiburan & AI.' },
    music: { emoji: '🎵', title: 'Music', description: 'Command untuk memutar musik di voice channel!' },
  };

  // Jika user memilih kategori tertentu
  if (category) {
    const cmds = categories[category] || [];
    const meta = categoryMeta[category] || { emoji: '📁', title: category, description: '' };

    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle(`${meta.emoji} ${meta.title} Commands`)
      .setDescription(meta.description)
      .setTimestamp();

    if (cmds.length > 0) {
      const cmdList = cmds.map(c => `> \`/${c.name}\` — ${c.description}`).join('\n');
      embed.addFields({ name: `📋 ${cmds.length} Commands`, value: cmdList });
    } else {
      embed.addFields({ name: '📋 Commands', value: 'Tidak ada command di kategori ini.' });
    }

    return interaction.reply({ embeds: [embed], flags: 64 });
  }

  // Tampilkan semua kategori
  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle('📖 Daftar Command')
    .setDescription('Gunakan `/help category:<kategori>` untuk detail tiap kategori.\n\u200b')
    .setTimestamp()
    .setFooter({ text: 'Tip: Ketik / untuk melihat autocomplete command.' });

  for (const [cat, cmds] of Object.entries(categories)) {
    const meta = categoryMeta[cat] || { emoji: '📁', title: cat };
    const cmdList = cmds.map(c => `\`/${c.name}\``).join(', ');
    embed.addFields({
      name: `${meta.emoji} ${meta.title} (${cmds.length})`,
      value: `${cmdList}\n\u200b`,
    });
  }

  await interaction.reply({ embeds: [embed], flags: 64 });
}
