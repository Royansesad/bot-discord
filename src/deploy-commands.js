// ============================================
// deploy-commands.js - Register slash commands ke Discord
// Jalankan: node src/deploy-commands.js
// ============================================
import discordJsPkg from 'discord.js';
const { REST, Routes } = discordJsPkg;
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import config from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function deployCommands() {
  const commands = [];
  const commandsPath = join(__dirname, 'commands');
  const categories = readdirSync(commandsPath, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const category of categories) {
    const categoryPath = join(commandsPath, category);
    const commandFiles = readdirSync(categoryPath).filter(f => f.endsWith('.js'));

    for (const file of commandFiles) {
      const filePath = join(categoryPath, file);
      const fileUrl = pathToFileURL(filePath).href;
      const command = await import(fileUrl);

      if (command.data) {
        commands.push(command.data.toJSON());
        console.log(`✅ Loaded: /${command.data.name} (${category})`);
      }
    }
  }

  const rest = new REST({ version: '10' }).setToken(config.token);

  try {
    console.log(`\n🔄 Mendaftarkan ${commands.length} slash commands...`);

    const isGlobalOnly = process.argv.includes('--global-only');
    const isGuildOnly = process.argv.includes('--guild-only');

    if (isGuildOnly && config.guildId) {
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.guildId),
        { body: commands }
      );
      console.log(`✅ ${commands.length} commands berhasil didaftarkan ke guild ${config.guildId}`);
    } else {
      // Deploy Global (agar muncul di SEMUA server & akun pengguna)
      await rest.put(
        Routes.applicationCommands(config.clientId),
        { body: commands }
      );
      console.log(`🌐 ${commands.length} commands berhasil didaftarkan secara GLOBAL (semua server/user)!`);

      // Juga deploy ke guild tertentu jika GUILD_ID diset (untuk update instan di dev server)
      if (config.guildId && !isGlobalOnly) {
        await rest.put(
          Routes.applicationGuildCommands(config.clientId, config.guildId),
          { body: commands }
        );
        console.log(`⚡ ${commands.length} commands juga berhasil di-sync instan ke guild ${config.guildId}`);
      }
    }
  } catch (error) {
    console.error('❌ Gagal mendaftarkan commands:', error);
  }
}

deployCommands();
