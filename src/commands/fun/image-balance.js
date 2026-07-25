// /image-balance - Cek usage/balance dari image generation providers
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getPuterUsage, getRewindBalance } from '../../services/aiService.js';
import { errorEmbed } from '../../utils/embeds.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('image-balance')
  .setDescription('Cek usage/balance dari image generation providers (Puter.js & Rewind AI)');

export const cooldown = 10;

/**
 * Format angka cost menjadi readable
 */
function formatCost(cost) {
  if (typeof cost !== 'number') return String(cost);
  if (cost < 0.01) return cost.toExponential(2);
  return cost.toFixed(4);
}

/**
 * Format nama service key jadi readable
 * e.g. "openai:gpt-image-2:low:1024x1024:input" → "GPT-Image-2 (1024x1024 Input)"
 */
function formatServiceName(key) {
  // Handle common puter.js service keys
  if (key.includes('gpt-image')) {
    const parts = key.split(':');
    const model = parts.find(p => p.startsWith('gpt-image')) || 'gpt-image';
    const resolution = parts.find(p => /^\d+x\d+$/.test(p)) || '';
    const direction = parts.includes('input') ? 'Input' : parts.includes('output') ? 'Output' : '';
    return `🎨 ${model}${resolution ? ` (${resolution})` : ''}${direction ? ` ${direction}` : ''}`;
  }
  if (key.includes('filesystem')) {
    return '📁 Filesystem Egress';
  }
  // Fallback: capitalize dan clean up
  return key.replace(/:/g, ' › ').replace(/\b\w/g, c => c.toUpperCase());
}

export async function execute(interaction) {
  await interaction.deferReply();

  try {
    // Fetch dari kedua provider secara paralel
    const [puterResult, rewindResult] = await Promise.all([
      getPuterUsage(),
      getRewindBalance(),
    ]);

    const embed = new EmbedBuilder()
      .setColor(config.colors.info)
      .setTitle('📊 Image Generation — Usage & Balance')
      .setDescription('Status dari semua image generation provider yang tersedia.')
      .setTimestamp()
      .setFooter({ text: `Requested by ${interaction.user.displayName}` });

    // === Puter.js Section ===
    let puterFields = [];

    if (!puterResult.available) {
      puterFields.push({ name: '🟢 Puter.js (Free)', value: `❌ Tidak tersedia: ${puterResult.reason}`, inline: false });
    } else {
      // Format service usage
      let usageText = '';
      if (puterResult.usage && typeof puterResult.usage === 'object') {
        const entries = Object.entries(puterResult.usage);
        if (entries.length > 0) {
          usageText = entries.map(([key, val]) => {
            if (typeof val === 'object' && val !== null) {
              const cost = val.cost != null ? `💰 $${formatCost(val.cost)}` : '';
              const count = val.count != null ? `📦 ${val.count}x` : '';
              const units = val.units != null ? `📐 ${val.units} units` : '';
              const parts = [count, units, cost].filter(Boolean).join(' • ');
              return `${formatServiceName(key)}\n  ${parts}`;
            }
            return `${formatServiceName(key)}: ${val}`;
          }).join('\n');
        }
      }

      if (!usageText) {
        usageText = '📭 Tidak ada penggunaan bulan ini';
      }
      puterFields.push({ name: '🟢 Puter.js — Usage', value: usageText, inline: false });

      // Format allowance info
      if (puterResult.allowanceInfo && typeof puterResult.allowanceInfo === 'object') {
        const ai = puterResult.allowanceInfo;
        let allowanceText = '';

        if (ai.monthlyUsageAllowance != null) {
          const allowance = ai.monthlyUsageAllowance;
          const remaining = ai.remaining != null ? ai.remaining : null;
          const used = remaining != null ? (allowance - remaining) : null;
          const percentage = remaining != null ? ((remaining / allowance) * 100).toFixed(1) : null;

          allowanceText += `💳 **Kuota Bulanan**: $${allowance.toLocaleString('id-ID')}\n`;
          if (remaining != null) {
            allowanceText += `✅ **Sisa**: $${formatCost(remaining)} (${percentage}%)\n`;
          }
          if (used != null) {
            allowanceText += `📊 **Terpakai**: $${formatCost(used)}`;
          }
        } else {
          // Fallback: tampilkan semua key
          allowanceText = Object.entries(ai)
            .filter(([k]) => k !== 'addons')
            .map(([k, v]) => {
              const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
              return `• **${label}**: ${typeof v === 'number' ? `$${formatCost(v)}` : v}`;
            }).join('\n');
        }

        if (allowanceText) {
          puterFields.push({ name: '💰 Puter.js — Kuota', value: allowanceText, inline: false });
        }
      }

      // Format app totals  
      if (puterResult.appTotals && typeof puterResult.appTotals === 'object') {
        const at = puterResult.appTotals;
        let totalsText = '';
        for (const [app, data] of Object.entries(at)) {
          if (typeof data === 'object' && data !== null) {
            const count = data.count != null ? `${data.count} requests` : '';
            const total = data.total != null ? `$${formatCost(data.total)}` : '';
            const parts = [count, total].filter(Boolean).join(' • ');
            totalsText += `📱 **${app}**: ${parts}\n`;
          } else {
            totalsText += `📱 **${app}**: ${data}\n`;
          }
        }
        if (totalsText) {
          puterFields.push({ name: '📱 Puter.js — App Totals', value: totalsText.trim(), inline: false });
        }
      }
    }

    for (const field of puterFields) {
      embed.addFields(field);
    }

    // === Rewind AI Section ===
    let rewindText = '';
    if (!rewindResult.available) {
      rewindText = `❌ Tidak tersedia: ${rewindResult.reason}`;
    } else {
      const { plan, balance, totalSpendable } = rewindResult;
      rewindText = `• **Plan**: ${plan || 'Unknown'}\n`;
      if (balance) {
        rewindText += `• **Effective Balance**: ${balance.effective?.toLocaleString('id-ID') || 0} tokens\n` +
                      `• **Daily Allowance**: ${balance.daily?.toLocaleString('id-ID') || 0} tokens\n` +
                      `• **Used Today**: ${balance.used_today?.toLocaleString('id-ID') || 0} tokens\n` +
                      `• **Free Balance**: ${balance.free?.toLocaleString('id-ID') || 0} tokens`;
      } else {
        rewindText += `• **Total Spendable**: ${totalSpendable?.toLocaleString('id-ID') || 0} tokens`;
      }
    }
    embed.addFields({ name: '🔵 Rewind AI (Fallback)', value: rewindText, inline: false });

    // Status ringkasan
    const puterOk = puterResult.available;
    const rewindOk = rewindResult.available;
    let statusText = '';
    if (puterOk && rewindOk) {
      statusText = '✅ Semua provider aktif dan siap digunakan.';
    } else if (puterOk) {
      statusText = '⚠️ Hanya Puter.js yang aktif. Rewind AI tidak tersedia sebagai fallback.';
    } else if (rewindOk) {
      statusText = '⚠️ Puter.js tidak tersedia. Menggunakan Rewind AI sebagai provider utama.';
    } else {
      statusText = '❌ Tidak ada provider yang tersedia! Image generation tidak akan berfungsi.';
    }
    embed.addFields({ name: '📌 Status', value: statusText, inline: false });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Image balance check error:', error.message || error);
    await interaction.editReply({
      embeds: [errorEmbed('❌ Error', error.message || 'Gagal mengecek balance/usage. Coba lagi nanti.')],
    });
  }
}
