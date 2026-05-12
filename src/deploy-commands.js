// ============================================
// deploy-commands.js - Register slash commands ke Discord
// Jalankan: node src/deploy-commands.js
// ============================================
import { REST, Routes } from 'discord.js';
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

    if (config.guildId) {
      // Deploy ke guild tertentu (instant, untuk testing)
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.guildId),
        { body: commands }
      );
      console.log(`✅ ${commands.length} commands berhasil didaftarkan ke guild ${config.guildId}`);
    } else {
      // Deploy global (bisa butuh ~1 jam untuk update)
      await rest.put(
        Routes.applicationCommands(config.clientId),
        { body: commands }
      );
      console.log(`✅ ${commands.length} commands berhasil didaftarkan secara global`);
    }
  } catch (error) {
    console.error('❌ Gagal mendaftarkan commands:', error);
  }
}

deployCommands();
