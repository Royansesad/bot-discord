// ============================================
// commandLoader.js - Dynamic Command Loader
// Memuat semua command dari folder commands/
// ============================================
import { Collection } from 'discord.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Memuat semua command files dari subdirectory commands/
 * Struktur: commands/<category>/<command>.js
 */
export async function loadCommands(client) {
  client.commands = new Collection();

  const commandsPath = join(__dirname, '..', 'commands');
  const categories = readdirSync(commandsPath, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  let totalCommands = 0;

  for (const category of categories) {
    const categoryPath = join(commandsPath, category);
    const commandFiles = readdirSync(categoryPath).filter(f => f.endsWith('.js'));

    for (const file of commandFiles) {
      const filePath = join(categoryPath, file);
      const fileUrl = pathToFileURL(filePath).href;
      const command = await import(fileUrl);

      if (command.data && command.execute) {
        // Tambahkan metadata kategori dengan membuat object baru
        const commandData = { ...command, category };
        client.commands.set(command.data.name, commandData);
        totalCommands++;
      } else {
        console.warn(`⚠️ Command ${file} tidak memiliki 'data' atau 'execute'`);
      }
    }
  }

  console.log(`📦 ${totalCommands} commands loaded dari ${categories.length} kategori`);
}
