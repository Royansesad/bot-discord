// ============================================
// interactionCreate.js - Interaction Handler
// With centralized error manager
// ============================================
import { checkCooldown, setCooldown } from '../utils/cooldown.js';
import { errorEmbed } from '../utils/embeds.js';
import { handleCommandError, logError } from '../utils/errorManager.js';

/**
 * Handler utama untuk semua interaction (slash commands, buttons, modals)
 */
export async function handleInteraction(client, interaction) {
  // Hanya handle chat input commands - button interactions ditangani oleh collectors
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    // Cek cooldown jika command punya setting cooldown
    if (command.cooldown) {
      const remaining = await checkCooldown(
        client.prisma,
        interaction.user.id,
        interaction.commandName,
        command.cooldown
      );

      if (remaining > 0) {
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        const timeStr = minutes > 0
          ? `${minutes} menit ${seconds} detik`
          : `${seconds} detik`;

        return interaction.reply({
          embeds: [errorEmbed(
            '⏳ Cooldown',
            `Kamu harus menunggu **${timeStr}** sebelum menggunakan command ini lagi.`
          )],
          flags: 64,
        });
      }
    }

    // Execute command
    await command.execute(interaction, client);

    // Set cooldown setelah command berhasil
    if (command.cooldown) {
      await setCooldown(
        client.prisma,
        interaction.user.id,
        interaction.commandName,
        command.cooldown
      );
    }
  } catch (error) {
    // Gunakan error manager untuk handle dan kirim error ke user
    await handleCommandError(interaction, error, interaction.commandName);
  }
}
