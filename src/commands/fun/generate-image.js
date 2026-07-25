// /generate-image - Generate gambar menggunakan AI
import { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { generateImage } from '../../services/aiService.js';
import { errorEmbed } from '../../utils/embeds.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('generate-image')
  .setDescription('Generate gambar menggunakan AI')
  .addStringOption(opt => opt.setName('prompt').setDescription('Deskripsi gambar yang ingin dibuat').setRequired(true));

export const cooldown = config.cooldowns.generateImage;

export async function execute(interaction, client) {
  const prompt = interaction.options.getString('prompt');

  await interaction.deferReply();

  try {
    const result = await generateImage(prompt);

    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle('🎨 AI Image Generation')
      .addFields({ name: '📝 Prompt', value: prompt })
      .setFooter({ text: `Requested by ${interaction.user.displayName}` })
      .setTimestamp();

    if (result.type === 'buffer') {
      // Puter.js SDK returns buffer
      const attachment = new AttachmentBuilder(result.data, { name: 'generated.png' });
      embed.setImage('attachment://generated.png');
      await interaction.editReply({ embeds: [embed], files: [attachment] });
    } else if (result.type === 'url') {
      // Rewind AI fallback returns URL
      embed.setImage(result.data);
      await interaction.editReply({ embeds: [embed] });
    } else {
      // Format tidak dikenali — tetap kirim response ke user
      console.error('Image generation returned unrecognized result type:', result);
      await interaction.editReply({
        embeds: [errorEmbed('❌ Image Generation Error', 'Hasil gambar tidak dapat ditampilkan (format tidak dikenali). Coba lagi nanti.')],
      });
    }
  } catch (error) {
    console.error('Image generation error:', error.message || error);
    await interaction.editReply({
      embeds: [errorEmbed('❌ Image Generation Error', error.message || 'Gagal membuat gambar. Coba lagi nanti.')],
    });
  }
}
