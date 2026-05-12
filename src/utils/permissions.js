// ============================================
// permissions.js - Permission Validation
// ============================================
import { PermissionFlagsBits } from 'discord.js';
import { errorEmbed } from './embeds.js';

/**
 * Cek apakah user punya permission tertentu
 * @returns {boolean} true jika punya permission
 */
export function hasPermission(member, permission) {
  return member.permissions.has(permission);
}

/**
 * Cek dan reply jika tidak punya permission
 * @returns {boolean} true jika TIDAK punya permission (command harus stop)
 */
export async function requirePermission(interaction, permission, permissionName) {
  if (!interaction.member.permissions.has(permission)) {
    await interaction.reply({
      embeds: [errorEmbed(
        '🚫 Akses Ditolak',
        `Kamu memerlukan permission **${permissionName}** untuk menggunakan command ini.`
      )],
      flags: 64,
    });
    return true; // blocked
  }
  return false; // allowed
}

/**
 * Cek apakah bot bisa melakukan aksi ke target member
 * (cek role hierarchy)
 */
export async function checkHierarchy(interaction, targetMember, action) {
  // Cek apakah target adalah bot sendiri
  if (targetMember.id === interaction.client.user.id) {
    await interaction.reply({
      embeds: [errorEmbed('❌ Error', 'Aku tidak bisa melakukan itu terhadap diriku sendiri!')],
      flags: 64,
    });
    return false;
  }

  // Cek apakah target adalah user yang menjalankan command
  if (targetMember.id === interaction.user.id) {
    await interaction.reply({
      embeds: [errorEmbed('❌ Error', `Kamu tidak bisa ${action} dirimu sendiri!`)],
      flags: 64,
    });
    return false;
  }

  // Cek role hierarchy - command user vs target
  if (interaction.member.roles.highest.position <= targetMember.roles.highest.position) {
    await interaction.reply({
      embeds: [errorEmbed(
        '❌ Error',
        `Kamu tidak bisa ${action} member ini karena role mereka lebih tinggi atau sama denganmu.`
      )],
      flags: 64,
    });
    return false;
  }

  // Cek role hierarchy - bot vs target
  const botMember = interaction.guild.members.me;
  if (botMember.roles.highest.position <= targetMember.roles.highest.position) {
    await interaction.reply({
      embeds: [errorEmbed(
        '❌ Error',
        `Aku tidak bisa ${action} member ini karena role mereka lebih tinggi atau sama denganku.`
      )],
      flags: 64,
    });
    return false;
  }

  return true; // OK, bisa lanjut
}

// Export permission flags yang sering dipakai
export const Perms = {
  KICK: PermissionFlagsBits.KickMembers,
  BAN: PermissionFlagsBits.BanMembers,
  MANAGE_MESSAGES: PermissionFlagsBits.ManageMessages,
  MANAGE_CHANNELS: PermissionFlagsBits.ManageChannels,
  MANAGE_ROLES: PermissionFlagsBits.ManageRoles,
  MODERATE: PermissionFlagsBits.ModerateMembers,
  ADMIN: PermissionFlagsBits.Administrator,
};
