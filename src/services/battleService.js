// ============================================
// battleService.js - Battle System
// Handles PvE and PvP combat
// Turn-based interactive system with buttons
// Supports special effects: DOT, HOT, Shield, Immunity
// ============================================
import { calculateDamage, randomInt, randomChance, randomPick } from '../utils/helpers.js';
import { getEffectiveStats } from './rpgService.js';
import { ALL_ITEMS, getItemById } from '../data/items.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

// ============================================
// Special Effects System
// ============================================

/**
 * Resolve special effects dari equipment pemain
 * @returns {{ dot: object|null, hot: object|null, shield: object|null, immunity: number }}
 */
function resolveSpecialEffects(player) {
  const effects = { dot: null, hot: null, shield: null, immunity: 0 };

  // Cek weapon special effect
  if (player.weaponId) {
    const weapon = ALL_ITEMS.find(i => i.id === player.weaponId);
    if (weapon?.specialEffect) {
      const fx = weapon.specialEffect;
      if (fx.type === 'dot') {
        effects.dot = { damage: fx.damage, duration: fx.duration, name: fx.name, lifesteal: fx.lifesteal || false };
      }
      if (fx.type === 'immunity') {
        effects.immunity += fx.charges || 1;
      }
    }
  }

  // Cek armor special effect
  if (player.armorId) {
    const armor = ALL_ITEMS.find(i => i.id === player.armorId);
    if (armor?.specialEffect) {
      const fx = armor.specialEffect;
      if (fx.type === 'hot') {
        effects.hot = { heal: fx.heal, duration: fx.duration, name: fx.name };
      }
      if (fx.type === 'shield') {
        effects.shield = { amount: fx.amount, name: fx.name };
        if (fx.immunity) {
          effects.immunity += fx.immunity;
        }
      }
    }
  }

  return effects;
}

// ============================================
// Turn-based Interactive Battle (PvE)
// ============================================

/**
 * State satu turn battle dengan special effects
 */
function executeTurn(playerStats, enemy, playerHp, enemyHp, turn, action = 'attack', fxState) {
  const log = [];
  let defenseBonus = 0;

  // === Apply HOT (Heal over Time) ===
  if (fxState.hot && fxState.hotDuration > 0) {
    const hotHeal = fxState.hot.heal;
    const oldHp = playerHp;
    playerHp = Math.min(playerStats.totalMaxHp, playerHp + hotHeal);
    const healed = playerHp - oldHp;
    if (healed > 0) {
      log.push(`${fxState.hot.name} → +${healed} HP regen`);
    }
    fxState.hotDuration--;
  }

  if (action === 'defend') {
    defenseBonus = Math.floor(playerStats.totalDefense * 0.5);
    log.push(`🛡️ Kamu bertahan! DEF +${defenseBonus} turn ini.`);
  }

  // Player attacks (reduced damage if defending)
  const playerAtkPower = action === 'defend'
    ? Math.floor(playerStats.totalAttack * 0.5)
    : playerStats.totalAttack;

  const playerDmg = calculateDamage(
    playerAtkPower,
    enemy.defense,
    playerStats.totalCritRate,
    playerStats.totalCritDmg
  );
  enemyHp -= playerDmg.damage;
  const critStr = playerDmg.isCrit ? ' 💥 **CRITICAL!**' : '';
  log.push(`⚔️ Kamu menyerang → **${playerDmg.damage}** damage${critStr}`);

  // === Apply DOT (Damage over Time) pada musuh ===
  if (fxState.dot && fxState.dotDuration > 0) {
    const dotDmg = fxState.dot.damage;
    enemyHp -= dotDmg;
    log.push(`${fxState.dot.name} → **${dotDmg}** damage (DOT)`);

    // Lifesteal dari DOT
    if (fxState.dot.lifesteal) {
      const stolen = Math.floor(dotDmg * 0.5);
      playerHp = Math.min(playerStats.totalMaxHp, playerHp + stolen);
      log.push(`🩸 Lifesteal → +${stolen} HP`);
    }
    fxState.dotDuration--;
  }

  if (enemyHp <= 0) {
    log.push(`\n🎉 **${enemy.name}** dikalahkan!`);
    return { playerHp, enemyHp: 0, log, finished: true, won: true, playerDmg: playerDmg.damage, enemyDmg: 0 };
  }

  // Enemy attacks
  const totalDef = playerStats.totalDefense + defenseBonus;
  const enemyDmg = calculateDamage(
    enemy.attack,
    totalDef,
    enemy.critRate || 0.03,
    enemy.critDmg || 1.3
  );

  let actualDmg = enemyDmg.damage;

  // === Shield absorb ===
  if (fxState.shield && fxState.shieldAmount > 0) {
    const absorbed = Math.min(fxState.shieldAmount, actualDmg);
    fxState.shieldAmount -= absorbed;
    actualDmg -= absorbed;
    log.push(`${fxState.shield.name} menyerap **${absorbed}** damage!${fxState.shieldAmount <= 0 ? ' (Shield habis!)' : ''}`);
  }

  // === Immunity dodge ===
  if (fxState.immunityCharges > 0 && actualDmg > 0) {
    fxState.immunityCharges--;
    log.push(`✨ **IMMUNITY!** Serangan musuh dihindari sepenuhnya! (Sisa: ${fxState.immunityCharges})`);
    actualDmg = 0;
  }

  playerHp -= actualDmg;
  const eCritStr = enemyDmg.isCrit ? ' 💥 **CRIT!**' : '';
  if (actualDmg > 0) {
    log.push(`👹 ${enemy.name} menyerang → **${actualDmg}** damage${eCritStr}`);
  }

  if (playerHp <= 0) {
    log.push(`\n💀 Kamu dikalahkan oleh **${enemy.name}**...`);
    return { playerHp: 0, enemyHp: Math.max(0, enemyHp), log, finished: true, won: false, playerDmg: playerDmg.damage, enemyDmg: actualDmg };
  }

  return { playerHp, enemyHp: Math.max(0, enemyHp), log, finished: false, won: false, playerDmg: playerDmg.damage, enemyDmg: actualDmg };
}

/**
 * Buat embed untuk state battle saat ini
 */
function buildBattleEmbed(playerStats, enemy, playerHp, enemyHp, turn, turnLog, totalLog, colors, fxState) {
  const playerHpPct = Math.max(0, Math.floor((playerHp / playerStats.totalMaxHp) * 100));
  const enemyHpPct = Math.max(0, Math.floor((Math.max(0, enemyHp) / enemy.hp) * 100));

  const playerBar = buildHpBar(playerHp, playerStats.totalMaxHp);
  const enemyBar = buildHpBar(Math.max(0, enemyHp), enemy.hp);

  // Build status effects indicator
  const statusEffects = [];
  if (fxState?.dotDuration > 0) statusEffects.push(`${fxState.dot.name} (${fxState.dotDuration}t)`);
  if (fxState?.hotDuration > 0) statusEffects.push(`${fxState.hot.name} (${fxState.hotDuration}t)`);
  if (fxState?.shieldAmount > 0) statusEffects.push(`${fxState.shield.name} (${fxState.shieldAmount} HP)`);
  if (fxState?.immunityCharges > 0) statusEffects.push(`✨ Immunity (${fxState.immunityCharges}x)`);
  const statusStr = statusEffects.length > 0 ? `\n📌 ${statusEffects.join(' | ')}` : '';

  const embed = new EmbedBuilder()
    .setColor(colors.rpg)
    .setTitle(`⚔️ Turn ${turn} — ${playerStats.username} vs ${enemy.name}`)
    .setDescription(
      `**${playerStats.username}** ❤️ ${playerHp}/${playerStats.totalMaxHp} (${playerHpPct}%)\n${playerBar}\n\n` +
      `**${enemy.name}** 👹 ${Math.max(0, enemyHp)}/${enemy.hp} (${enemyHpPct}%)\n${enemyBar}` +
      `${statusStr}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n${turnLog.join('\n')}`
    )
    .setFooter({ text: `ATK: ${playerStats.totalAttack} | DEF: ${playerStats.totalDefense} | CRIT: ${Math.floor(playerStats.totalCritRate * 100)}%` })
    .setTimestamp();

  return embed;
}

function buildHpBar(current, max) {
  const length = 15;
  const filled = Math.max(0, Math.round((current / max) * length));
  const empty = length - filled;
  const pct = (current / max) * 100;

  let filledChar = '🟩';
  if (pct <= 25) filledChar = '🟥';
  else if (pct <= 50) filledChar = '🟧';
  else if (pct <= 75) filledChar = '🟨';

  return filledChar.repeat(filled) + '⬛'.repeat(empty);
}

/**
 * Buat action row buttons untuk battle
 */
function buildBattleButtons(uniqueId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`battle_attack_${uniqueId}`)
      .setLabel('⚔️ Serang')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`battle_defend_${uniqueId}`)
      .setLabel('🛡️ Bertahan')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`battle_flee_${uniqueId}`)
      .setLabel('🏃 Kabur')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

/**
 * Jalankan interactive turn-based battle (PvE)
 * @returns {{ won: boolean, remainingHp: number, log: string[], turns: number }}
 */
export async function runInteractiveBattle(interaction, playerStats, enemy, colors, maxTurns = 30) {
  let playerHp = playerStats.hp;
  let enemyHp = enemy.hp;
  let turn = 0;
  const fullLog = [];
  const uniqueId = `${interaction.user.id}_${Date.now()}`;

  // Resolve special effects
  const effects = resolveSpecialEffects(playerStats);
  const fxState = {
    dot: effects.dot,
    dotDuration: effects.dot ? effects.dot.duration : 0,
    hot: effects.hot,
    hotDuration: effects.hot ? effects.hot.duration : 0,
    shield: effects.shield,
    shieldAmount: effects.shield ? effects.shield.amount : 0,
    immunityCharges: effects.immunity,
  };

  // Build special effects intro
  const fxIntro = [];
  if (effects.dot) fxIntro.push(`${effects.dot.name} aktif (${effects.dot.damage} dmg/${effects.dot.duration} turn)`);
  if (effects.hot) fxIntro.push(`${effects.hot.name} aktif (+${effects.hot.heal} HP/${effects.hot.duration} turn)`);
  if (effects.shield) fxIntro.push(`${effects.shield.name} aktif (${effects.shield.amount} shield HP)`);
  if (effects.immunity > 0) fxIntro.push(`✨ Immunity aktif (${effects.immunity}x dodge)`);

  // Initial embed
  const initLog = [
    `⚔️ **${playerStats.username}** menantang **${enemy.name}**!`,
    `Pilih aksi untuk setiap turn.`,
  ];
  if (fxIntro.length > 0) {
    initLog.push(`\n📌 **Special Effects:**`);
    initLog.push(...fxIntro.map(f => `  • ${f}`));
  }

  const initEmbed = buildBattleEmbed(playerStats, enemy, playerHp, enemyHp, 0, initLog, [], colors, fxState);
  const buttons = buildBattleButtons(uniqueId);

  const msg = await interaction.editReply({ embeds: [initEmbed], components: [buttons] });

  // Battle loop via collector
  return new Promise((resolve) => {
    const collector = msg.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id && i.customId.endsWith(uniqueId),
      time: 120_000, // 2 menit timeout
    });

    collector.on('collect', async (btnInteraction) => {
      const action = btnInteraction.customId.startsWith('battle_attack') ? 'attack'
        : btnInteraction.customId.startsWith('battle_defend') ? 'defend'
        : 'flee';

      // Handle flee
      if (action === 'flee') {
        const fleeChance = 0.5 + (playerStats.level - (enemy.level || 1)) * 0.03;
        const fled = randomChance(Math.min(0.9, Math.max(0.15, fleeChance)));

        if (fled) {
          const fleeEmbed = new EmbedBuilder()
            .setColor(colors.warning)
            .setTitle(`🏃 Berhasil Kabur!`)
            .setDescription(`Kamu berhasil melarikan diri dari **${enemy.name}**!\n\nHP tersisa: ❤️ ${playerHp}/${playerStats.totalMaxHp}`)
            .setTimestamp();
          await btnInteraction.update({ embeds: [fleeEmbed], components: [] });
          collector.stop('fled');
          return resolve({ won: false, fled: true, remainingHp: playerHp, log: fullLog, turns: turn });
        } else {
          // Gagal kabur, enemy menyerang
          turn++;
          const enemyDmgResult = calculateDamage(enemy.attack, playerStats.totalDefense, enemy.critRate || 0.03, enemy.critDmg || 1.3);
          let actualDmg = enemyDmgResult.damage;

          const turnLog = [`🏃 Gagal kabur!`];

          // Shield absorb saat gagal kabur
          if (fxState.shieldAmount > 0) {
            const absorbed = Math.min(fxState.shieldAmount, actualDmg);
            fxState.shieldAmount -= absorbed;
            actualDmg -= absorbed;
            turnLog.push(`${fxState.shield.name} menyerap **${absorbed}** damage!`);
          }

          // Immunity saat gagal kabur
          if (fxState.immunityCharges > 0 && actualDmg > 0) {
            fxState.immunityCharges--;
            turnLog.push(`✨ **IMMUNITY!** Serangan dihindari! (Sisa: ${fxState.immunityCharges})`);
            actualDmg = 0;
          }

          playerHp -= actualDmg;
          if (actualDmg > 0) {
            turnLog.push(`👹 ${enemy.name} menyerang → **${actualDmg}** damage${enemyDmgResult.isCrit ? ' 💥 **CRIT!**' : ''}`);
          }

          if (playerHp <= 0) {
            playerHp = 0;
            turnLog.push(`\n💀 Kamu dikalahkan...`);
            const defeatEmbed = buildBattleEmbed(playerStats, enemy, playerHp, enemyHp, turn, turnLog, fullLog, colors, fxState);
            defeatEmbed.setColor(colors.danger).setTitle(`💀 Turn ${turn} — Kalah!`);
            await btnInteraction.update({ embeds: [defeatEmbed], components: [] });
            collector.stop('defeat');
            return resolve({ won: false, fled: false, remainingHp: 0, log: fullLog, turns: turn });
          }

          const embed = buildBattleEmbed(playerStats, enemy, playerHp, enemyHp, turn, turnLog, fullLog, colors, fxState);
          await btnInteraction.update({ embeds: [embed], components: [buildBattleButtons(uniqueId)] });
          return;
        }
      }

      // Execute normal turn
      turn++;
      const result = executeTurn(playerStats, enemy, playerHp, enemyHp, turn, action, fxState);
      playerHp = result.playerHp;
      enemyHp = result.enemyHp;
      fullLog.push(...result.log);

      if (result.finished || turn >= maxTurns) {
        const finalLog = result.log;
        if (turn >= maxTurns && !result.finished) {
          finalLog.push('\n⏰ Pertarungan terlalu lama! Keduanya mundur...');
        }
        const finalEmbed = buildBattleEmbed(playerStats, enemy, playerHp, enemyHp, turn, finalLog, fullLog, colors, fxState);
        finalEmbed.setColor(result.won ? colors.success : colors.danger);
        finalEmbed.setTitle(result.won ? `🎉 Turn ${turn} — Victory!` : `💀 Turn ${turn} — Kalah!`);
        await btnInteraction.update({ embeds: [finalEmbed], components: [] });
        collector.stop('finished');
        return resolve({
          won: result.won,
          fled: false,
          remainingHp: Math.max(0, playerHp),
          log: fullLog,
          turns: turn,
        });
      }

      // Show current state
      const embed = buildBattleEmbed(playerStats, enemy, playerHp, enemyHp, turn, result.log, fullLog, colors, fxState);
      await btnInteraction.update({ embeds: [embed], components: [buildBattleButtons(uniqueId)] });
    });

    collector.on('end', (_, reason) => {
      if (reason === 'time') {
        // Timeout - player loses
        const timeoutEmbed = new EmbedBuilder()
          .setColor(colors.danger)
          .setTitle('⏰ Waktu Habis!')
          .setDescription(`Kamu terlalu lama tidak bertindak. **${enemy.name}** pergi meninggalkanmu.`)
          .setTimestamp();
        interaction.editReply({ embeds: [timeoutEmbed], components: [] }).catch(() => {});
        resolve({ won: false, fled: true, remainingHp: playerHp, log: fullLog, turns: turn });
      }
    });
  });
}

// ============================================
// Legacy auto-resolve (for adventure encounters)
// ============================================

/**
 * Simulasi battle PvE (player vs enemy) - auto resolve
 * @returns {{ won: boolean, log: string[], damageDealt: number, damageTaken: number, turns: number }}
 */
export function simulatePvE(playerStats, enemy) {
  const log = [];
  let playerHp = playerStats.hp;
  let enemyHp = enemy.hp;
  let turn = 0;
  const maxTurns = 30;

  log.push(`⚔️ **${playerStats.username}** vs **${enemy.name}**`);
  log.push(`❤️ Player: ${playerHp} HP | 👹 Enemy: ${enemyHp} HP`);
  log.push('');

  while (playerHp > 0 && enemyHp > 0 && turn < maxTurns) {
    turn++;

    // Player attacks
    const playerDmg = calculateDamage(
      playerStats.totalAttack,
      enemy.defense,
      playerStats.totalCritRate,
      playerStats.totalCritDmg
    );
    enemyHp -= playerDmg.damage;
    const critStr = playerDmg.isCrit ? ' 💥 **CRITICAL!**' : '';
    log.push(`Turn ${turn}: ⚔️ Kamu menyerang → **${playerDmg.damage}** damage${critStr}`);

    if (enemyHp <= 0) {
      log.push(`\n🎉 **${enemy.name}** dikalahkan!`);
      break;
    }

    // Enemy attacks
    const enemyDmg = calculateDamage(
      enemy.attack,
      playerStats.totalDefense,
      enemy.critRate || 0.03,
      enemy.critDmg || 1.3
    );
    playerHp -= enemyDmg.damage;
    const eCritStr = enemyDmg.isCrit ? ' 💥 **CRIT!**' : '';
    log.push(`Turn ${turn}: 👹 ${enemy.name} menyerang → **${enemyDmg.damage}** damage${eCritStr}`);

    if (playerHp <= 0) {
      log.push(`\n💀 Kamu dikalahkan oleh **${enemy.name}**...`);
      break;
    }

    log.push(`   ❤️ ${playerHp} HP | 👹 ${Math.max(0, enemyHp)} HP`);
  }

  if (turn >= maxTurns) {
    log.push('\n⏰ Pertarungan terlalu lama! Keduanya mundur...');
  }

  const won = enemyHp <= 0;
  const totalDamageDealt = won ? enemy.hp : enemy.hp - Math.max(0, enemyHp);
  const totalDamageTaken = playerStats.hp - Math.max(0, playerHp);

  return {
    won,
    log,
    damageDealt: totalDamageDealt,
    damageTaken: totalDamageTaken,
    remainingHp: Math.max(0, playerHp),
    turns: turn,
  };
}

/**
 * Simulasi battle PvP (player vs player)
 * Turn-based combat simulation
 */
export function simulatePvP(player1Stats, player2Stats) {
  const log = [];
  let p1Hp = player1Stats.hp;
  let p2Hp = player2Stats.hp;
  let turn = 0;
  const maxTurns = 30;

  log.push(`⚔️ **${player1Stats.username}** vs **${player2Stats.username}**`);
  log.push(`❤️ P1: ${p1Hp} HP (ATK: ${player1Stats.totalAttack}) | P2: ${p2Hp} HP (ATK: ${player2Stats.totalAttack})`);
  log.push('');

  // Tentukan siapa yang menyerang duluan (speed berdasarkan level & random)
  let p1First = randomChance(0.5 + (player1Stats.level - player2Stats.level) * 0.02);

  while (p1Hp > 0 && p2Hp > 0 && turn < maxTurns) {
    turn++;

    if (p1First) {
      // P1 attacks P2
      const dmg = calculateDamage(player1Stats.totalAttack, player2Stats.totalDefense, player1Stats.totalCritRate, player1Stats.totalCritDmg);
      p2Hp -= dmg.damage;
      const crit = dmg.isCrit ? ' 💥 **CRIT!**' : '';
      log.push(`Turn ${turn}: ⚔️ ${player1Stats.username} → **${dmg.damage}** dmg${crit}`);

      if (p2Hp <= 0) {
        log.push(`\n🏆 **${player1Stats.username}** menang!`);
        break;
      }

      // P2 attacks P1
      const dmg2 = calculateDamage(player2Stats.totalAttack, player1Stats.totalDefense, player2Stats.totalCritRate, player2Stats.totalCritDmg);
      p1Hp -= dmg2.damage;
      const crit2 = dmg2.isCrit ? ' 💥 **CRIT!**' : '';
      log.push(`Turn ${turn}: 🗡️ ${player2Stats.username} → **${dmg2.damage}** dmg${crit2}`);

      if (p1Hp <= 0) {
        log.push(`\n🏆 **${player2Stats.username}** menang!`);
        break;
      }
    } else {
      // P2 first
      const dmg2 = calculateDamage(player2Stats.totalAttack, player1Stats.totalDefense, player2Stats.totalCritRate, player2Stats.totalCritDmg);
      p1Hp -= dmg2.damage;
      const crit2 = dmg2.isCrit ? ' 💥 **CRIT!**' : '';
      log.push(`Turn ${turn}: 🗡️ ${player2Stats.username} → **${dmg2.damage}** dmg${crit2}`);

      if (p1Hp <= 0) {
        log.push(`\n🏆 **${player2Stats.username}** menang!`);
        break;
      }

      const dmg = calculateDamage(player1Stats.totalAttack, player2Stats.totalDefense, player1Stats.totalCritRate, player1Stats.totalCritDmg);
      p2Hp -= dmg.damage;
      const crit = dmg.isCrit ? ' 💥 **CRIT!**' : '';
      log.push(`Turn ${turn}: ⚔️ ${player1Stats.username} → **${dmg.damage}** dmg${crit}`);

      if (p2Hp <= 0) {
        log.push(`\n🏆 **${player1Stats.username}** menang!`);
        break;
      }
    }

    log.push(`   ❤️ ${Math.max(0, p1Hp)} | ${Math.max(0, p2Hp)} ❤️`);
  }

  if (turn >= maxTurns) {
    log.push('\n⏰ Waktu habis! Pertandingan berakhir seri.');
  }

  const p1Won = p2Hp <= 0 && p1Hp > 0;
  const p2Won = p1Hp <= 0 && p2Hp > 0;

  return {
    winner: p1Won ? 1 : p2Won ? 2 : 0,
    log,
    p1RemainingHp: Math.max(0, p1Hp),
    p2RemainingHp: Math.max(0, p2Hp),
    turns: turn,
  };
}

/**
 * Tentukan drop loot dari enemy
 */
export function generateLoot(enemy) {
  const drops = [];

  if (!enemy.drops || enemy.drops.length === 0) return drops;

  for (const drop of enemy.drops) {
    if (randomChance(drop.chance)) {
      const quantity = drop.quantity || 1;
      drops.push({
        itemId: drop.itemId,
        quantity,
        item: ALL_ITEMS.find(i => i.id === drop.itemId),
      });
    }
  }

  return drops;
}
