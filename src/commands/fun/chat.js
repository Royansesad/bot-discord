// /chat - Chat dengan AI assistant
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { chatCompletion } from '../../services/aiService.js';
import { errorEmbed } from '../../utils/embeds.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('chat')
  .setDescription('Chat dengan AI assistant')
  .addStringOption(opt => opt.setName('pesan').setDescription('Pesan yang ingin kamu sampaikan').setRequired(true));

export const cooldown = config.cooldowns.chat;

export async function execute(interaction, client) {
  const message = interaction.options.getString('pesan');

  await interaction.deferReply();

  try {
    const reply = await chatCompletion(client.prisma, interaction.user.id, message);

    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setAuthor({ name: interaction.user.displayName, iconURL: interaction.user.displayAvatarURL() })
      .addFields(
        { name: '💬 Kamu', value: message.length > 1024 ? message.slice(0, 1021) + '...' : message },
        { name: '🤖 AI', value: reply.length > 1024 ? reply.slice(0, 1021) + '...' : reply }
      )
      .setFooter({ text: 'Powered by AI • Context disimpan per user' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Chat AI error:', error);
    await interaction.editReply({
      embeds: [errorEmbed('❌ AI Error', error.message || 'Gagal mendapatkan respons dari AI. Coba lagi nanti.')],
    });
  }
}
