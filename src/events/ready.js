// ============================================
// ready.js - Bot Ready Event
// ============================================
import { ActivityType } from 'discord.js';

export function onReady(client) {
  console.log('═══════════════════════════════════════');
  console.log(`✅ ${client.user.tag} is online!`);
  console.log(`📡 Serving ${client.guilds.cache.size} server(s)`);
  console.log(`🎮 ${client.commands.size} commands loaded`);
  console.log('═══════════════════════════════════════');

  // Set bot activity/status
  client.user.setActivity('/help • RPG Adventure', {
    type: ActivityType.Playing,
  });

  // Rotate status setiap 30 detik
  const statuses = [
    { name: '/help • RPG Adventure', type: ActivityType.Playing },
    { name: `${client.guilds.cache.size} servers`, type: ActivityType.Watching },
    { name: '/adventure • Fight Bosses!', type: ActivityType.Playing },
    { name: '/chat • AI Assistant', type: ActivityType.Listening },
  ];

  let i = 0;
  setInterval(() => {
    i = (i + 1) % statuses.length;
    client.user.setActivity(statuses[i].name, { type: statuses[i].type });
  }, 30_000);
}
