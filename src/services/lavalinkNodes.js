// ============================================
// lavalinkNodes.js - Lavalink Node Manager
// Supports Lavalink Multi-Nodes + Health Check + Priority Router
// ============================================
import { logError } from '../utils/errorManager.js';

/**
 * Node Lavalink publik bawaan.
 *
 * Daftar ini diambil dari freelavalink.serenetia.com/list (semua node yang
 * aktif saat daftar diperbarui) ditambah node bonus Trinium. Node publik bisa
 * on/off kapan saja, jadi multi-node failover tetap menjadi pengaman utama.
 */
const HARDCODED_LAVALINK_NODES = [
  {
    name: 'Sereneta (SSL)',
    url: 'lavalinkv4.serenetia.com:443',
    auth: 'https://seretia.link/discord',
    secure: true,
    priority: 'main',
    engine: 'lavalink',
  },
  {
    name: 'Sereneta (HTTP)',
    url: 'lavalinkv4.serenetia.com:80',
    auth: 'https://seretia.link/discord',
    secure: false,
    priority: 'fallback',
    engine: 'lavalink',
  },
  {
    name: 'MilloHost (SSL)',
    url: 'lava-v4.millohost.my.id:443',
    auth: 'https://discord.gg/mjS5J2K3ep',
    secure: true,
    priority: 'secondary',
    engine: 'lavalink',
  },
  {
    name: 'Kasawa (Public)',
    url: 'lava2.kasawa.pro:2334',
    auth: 'youshallnotpass',
    secure: false,
    priority: 'secondary',
    engine: 'lavalink',
  },
  {
    name: 'Jirayu (SSL)',
    url: 'lavalink.jirayu.net:443',
    auth: 'youshallnotpass',
    secure: true,
    priority: 'secondary',
    engine: 'lavalink',
  },
  {
    name: 'Jirayu (13592)',
    url: 'lavalink.jirayu.net:13592',
    auth: 'youshallnotpass',
    secure: false,
    priority: 'fallback',
    engine: 'lavalink',
  },
  {
    name: 'Nazha (SSL)',
    url: 'lavalink.nazha.online:443',
    auth: 'nazhafreelava',
    secure: true,
    priority: 'secondary',
    engine: 'lavalink',
  },
  {
    name: 'Trinium (2333)',
    url: 'lavalink.triniumhost.com:2333',
    auth: 'kirito',
    secure: false,
    priority: 'fallback',
    engine: 'lavalink',
  },
  {
    name: 'Trinium (4333)',
    url: 'lavalink.triniumhost.com:4333',
    auth: 'free',
    secure: false,
    priority: 'fallback',
    engine: 'lavalink',
  },
  {
    name: 'Trinium v4 (SSL)',
    url: 'lavalink-v4.triniumhost.com:443',
    auth: 'free',
    secure: true,
    priority: 'secondary',
    engine: 'lavalink',
  },
  {
    // Identifier dari provider tetap dipertahankan, tetapi node ini kompatibel
    // Lavalink sehingga tidak butuh engine NodeLink terpisah.
    name: 'trinium-nodelink',
    url: 'nodelink.triniumhost.com:443',
    auth: 'free',
    secure: true,
    priority: 'secondary',
    engine: 'lavalink',
  },
];

/**
 * URL sumber daftar node gratis dari GitHub / JSON API provider
 */
const DISCOVERY_SOURCES = [
  'https://raw.githubusercontent.com/AjieDev/lavalink-list/main/nodes.json',
  'https://raw.githubusercontent.com/DarrenOfficial/lavalink-list/master/docs/NoSSL/lavalink-without-ssl',
];

// ============================================
// Registry metadata node (priority & engine)
// Shoukaku TIDAK menyimpan NodeOption yang kita berikan (hanya name/url/auth),
// sehingga priority & engine harus dilacak sendiri di sini.
// ============================================
const nodeConfigs = new Map();

function normEngineName() {
  // Semua node sekarang memakai protokol Lavalink. NodeLink tidak lagi menjadi
  // engine terpisah.
  return 'lavalink';
}

/**
 * Simpan metadata node (priority/engine/url) agar bisa dipakai router & tampilan status
 */
export function registerNodeConfig(node) {
  if (!node?.name) return null;

  const config = {
    name: node.name,
    url: node.url || null,
    auth: node.auth || null,
    secure: Boolean(node.secure),
    priority: String(node.priority || 'secondary').toLowerCase(),
    engine: String(node.engine || normEngineName(node)).toLowerCase(),
  };

  nodeConfigs.set(config.name.toLowerCase(), config);
  return config;
}

/**
 * Ambil metadata node yang tersimpan (case-insensitive)
 */
export function getNodeConfig(name) {
  if (!name) return null;
  return nodeConfigs.get(String(name).toLowerCase()) || null;
}

/**
 * Ubah prioritas node di registry (dipakai /lavalink setpriority)
 */
export function setNodeConfigPriority(name, priority) {
  const config = getNodeConfig(name);
  if (!config) return null;
  config.priority = String(priority || 'secondary').toLowerCase();
  return config;
}

/**
 * Prioritas numerik untuk sorting router (main paling kecil)
 */
export function getNodePriorityRank(name) {
  const config = getNodeConfig(name);
  const priority = config?.priority || 'secondary';
  if (priority === 'main') return 1;
  if (priority === 'fallback') return 3;
  return 2;
}

/**
 * Engine dari node (registry dulu, lalu fallback dari nama)
 */
export function getNodeEngine(name) {
  const config = getNodeConfig(name);
  if (config?.engine) return config.engine;
  return normEngineName({ name });
}

/**
 * Test keaktifan & kesehatan node Lavalink via HTTP REST ping
 * Memverifikasi https dan http untuk mencegah ECONNREFUSED karena kesalahan port/SSL
 */
export async function testNodeHealth(url, auth, secure = false, timeoutMs = 5000) {
  const start = Date.now();
  const cleanUrl = url.replace(/^https?:\/\//, '');

  const targets = [];
  if (secure) {
    targets.push(`https://${cleanUrl}`);
    targets.push(`http://${cleanUrl}`);
  } else {
    targets.push(`http://${cleanUrl}`);
    targets.push(`https://${cleanUrl}`);
  }

  const endpoints = ['/version', '/v4/info', '/info', '/'];

  for (const targetUrl of targets) {
    for (const ep of endpoints) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(`${targetUrl}${ep}`, {
          method: 'GET',
          headers: {
            'Authorization': auth,
            'User-Agent': 'DiscordBot-AudioEngineChecker/1.0',
          },
          signal: controller.signal,
        });

        clearTimeout(timer);
        const latency = Date.now() - start;

        if (response.ok || response.status === 200 || response.status === 204 || response.status === 401) {
          return {
            alive: true,
            latencyMs: latency,
            status: response.status,
            workingUrl: targetUrl,
          };
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          return { alive: false, latencyMs: timeoutMs, reason: 'Timeout ( > 5 detik)' };
        }
      }
    }
  }

  return { alive: false, latencyMs: 0, reason: 'ECONNREFUSED / Server HTTP tidak merespon' };
}

/**
 * Fetch nodes dari GitHub AjieDev/lavalink-list
 */
async function fetchAjieDevNodes() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(DISCOVERY_SOURCES[0], { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return [];

    const data = await res.json();
    const nodes = Array.isArray(data) ? data : (data.nodes || []);

    return nodes
      .filter(n => n.host && n.port && n.password)
      .map((n, i) => ({
        name: n.identifier || n.name || `Scraped-AjieDev-${i + 1}`,
        url: `${n.host}:${n.port}`,
        auth: n.password,
        secure: n.secure || false,
        priority: 'fallback',
        engine: 'lavalink',
      }));
  } catch (err) {
    if (err.name !== 'AbortError') {
      logError('Lavalink Discovery (AjieDev)', err);
    }
    return [];
  }
}

/**
 * Fetch nodes dari DarrenOfficial/lavalink-list
 */
async function fetchDarrenNodes() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(DISCOVERY_SOURCES[1], { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return [];

    const text = await res.text();
    const nodes = [];
    const blocks = text.split(/\n\s*\n/);

    for (const block of blocks) {
      const hostMatch = block.match(/Host\s*:\s*(.+)/i);
      const portMatch = block.match(/Port\s*:\s*(\d+)/i);
      const passMatch = block.match(/Password\s*:\s*(.+)/i);

      if (hostMatch && portMatch && passMatch) {
        const host = hostMatch[1].trim();
        const port = portMatch[1].trim();
        const password = passMatch[1].trim();

        nodes.push({
          name: `Scraped-Darren-${host}`,
          url: `${host}:${port}`,
          auth: password,
          secure: false,
          priority: 'fallback',
          engine: 'lavalink',
        });
      }
    }

    return nodes;
  } catch (err) {
    if (err.name !== 'AbortError') {
      logError('Lavalink Discovery (Darren)', err);
    }
    return [];
  }
}

/**
 * Fetch nodes yang tersimpan di Prisma DB
 */
export async function getDatabaseNodes(prisma) {
  if (!prisma?.lavalinkNode) return [];
  try {
    const dbNodes = await prisma.lavalinkNode.findMany();
    return dbNodes.map(n => ({
      name: n.name,
      url: n.url,
      auth: n.auth,
      secure: n.secure,
      priority: n.priority || 'secondary',
      isCustom: true,
      engine: 'lavalink',
    }));
  } catch (err) {
    logError('Lavalink DB Fetch', err);
    return [];
  }
}

/**
 * Tambah node baru ke Prisma DB
 */
export async function addDatabaseNode(prisma, nodeData) {
  if (!prisma?.lavalinkNode) {
    throw new Error('Database client tidak tersedia.');
  }

  const existing = await prisma.lavalinkNode.findUnique({
    where: { name: nodeData.name },
  });

  if (existing) {
    throw new Error(`Node dengan nama "${nodeData.name}" sudah ada.`);
  }

  return await prisma.lavalinkNode.create({
    data: {
      name: nodeData.name,
      url: nodeData.url,
      auth: nodeData.auth,
      secure: nodeData.secure || false,
      priority: nodeData.priority || 'secondary',
      isCustom: true,
    },
  });
}

/**
 * Hapus node dari Prisma DB
 */
export async function removeDatabaseNode(prisma, name) {
  if (!prisma?.lavalinkNode) {
    throw new Error('Database client tidak tersedia.');
  }

  const existing = await prisma.lavalinkNode.findUnique({
    where: { name },
  });

  if (!existing) {
    throw new Error(`Node "${name}" tidak ditemukan di database.`);
  }

  return await prisma.lavalinkNode.delete({
    where: { name },
  });
}

/**
 * Set priority node di Prisma DB
 */
export async function setNodePriorityInDb(prisma, name, priority) {
  if (!prisma?.lavalinkNode) {
    throw new Error('Database client tidak tersedia.');
  }

  const valid = ['main', 'secondary', 'fallback'];
  const nextPriority = String(priority || '').toLowerCase();
  if (!valid.includes(nextPriority)) {
    throw new Error(`Priority tidak valid. Pilih dari: ${valid.join(', ')}`);
  }

  // Node hardcoded tidak ada di database: cukup perbarui registry in-memory
  const registered = setNodeConfigPriority(name, nextPriority);

  try {
    const updated = await prisma.lavalinkNode.update({
      where: { name },
      data: { priority: nextPriority },
    });
    return updated;
  } catch (err) {
    if (registered) return registered;
    throw err;
  }
}

function deduplicateNodes(nodes) {
  const seen = new Set();
  return nodes.filter(node => {
    const key = `${node.url.toLowerCase()}_${node.secure}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Track node yang dinonaktifkan secara manual oleh admin/user command
const disabledNodes = new Set();

export function getDisabledNodes() {
  return [...disabledNodes];
}

export function isNodeDisabled(name) {
  if (!name) return false;
  return disabledNodes.has(name.toLowerCase());
}

/**
 * Menonaktifkan node spesifik dan memutuskan koneksinya dari Shoukaku secara permanen
 */
export function disableNode(shoukaku, name) {
  if (!name) throw new Error('Nama node harus diisi.');
  const lowerName = name.toLowerCase();

  let targetNodeName = name;
  let foundNode = null;

  if (shoukaku?.nodes) {
    for (const [nodeName, node] of shoukaku.nodes) {
      if (nodeName.toLowerCase() === lowerName) {
        targetNodeName = nodeName;
        foundNode = node;
        break;
      }
    }
  }

  disabledNodes.add(targetNodeName.toLowerCase());

  if (foundNode) {
    try {
      foundNode.removeAllListeners();
      if (typeof foundNode.reconnectTries === 'number') {
        foundNode.reconnectTries = 0;
      }
      foundNode.disconnect();
    } catch (e) {}

    try {
      shoukaku.removeNode(targetNodeName, 'Disabled by command');
    } catch (e) {}

    try {
      shoukaku.nodes.delete(targetNodeName);
    } catch (e) {}
  }

  return targetNodeName;
}

/**
 * Mengaktifkan kembali node yang dinonaktifkan
 */
export function enableNode(name) {
  if (!name) throw new Error('Nama node harus diisi.');
  const lowerName = name.toLowerCase();
  for (const item of disabledNodes) {
    if (item.toLowerCase() === lowerName) {
      disabledNodes.delete(item);
      return true;
    }
  }
  return false;
}

/**
 * Ambil semua node Lavalink
 * mode: 'startup' = hanya hardcoded + DB (cepat, tanpa scraping)
 *        'full' = termasuk scraped nodes (untuk auto-updater)
 */
export async function getAllNodes(prisma = null, mode = 'startup') {
  console.log(`🔍 Mengumpulkan nodes (mode: ${mode})...`);

  const dbNodes = await getDatabaseNodes(prisma);

  let allNodes;
  // Saat startup, HANYA gunakan hardcoded + DB nodes (tanpa scraping)
  if (mode === 'startup') {
    allNodes = deduplicateNodes([
      ...HARDCODED_LAVALINK_NODES,
      ...dbNodes,
    ]);
  } else {
    // Mode 'full': termasuk scraped nodes (hanya dipanggil oleh auto-updater)
    const [ajieNodes, darrenNodes] = await Promise.allSettled([
      fetchAjieDevNodes(),
      fetchDarrenNodes(),
    ]);

    const discoveredAjie = ajieNodes.status === 'fulfilled' ? ajieNodes.value : [];
    const discoveredDarren = darrenNodes.status === 'fulfilled' ? darrenNodes.value : [];

    const limitedAjie = discoveredAjie.slice(0, 3);
    const limitedDarren = discoveredDarren.slice(0, 3);

    allNodes = deduplicateNodes([
      ...HARDCODED_LAVALINK_NODES,
      ...dbNodes,
      ...limitedAjie,
      ...limitedDarren,
    ]);
  }

  // Saring node yang sedang dinonaktifkan
  return allNodes.filter(n => !isNodeDisabled(n.name));
}

/**
 * Format nodes ke Shoukaku-compatible format
 */
export function formatForShoukaku(nodes) {
  return nodes.map(node => {
    const formatted = {
      name: node.name,
      url: node.url,
      auth: node.auth,
      secure: node.secure || false,
      priority: node.priority || 'fallback',
      engine: 'lavalink',
    };

    // Shoukaku tidak menyimpan NodeOption kita, jadi metadata disimpan di registry sendiri
    registerNodeConfig(formatted);
    return formatted;
  });
}

/**
 * Info status nodes
 */
export function getNodeInfo(shoukaku) {
  if (!shoukaku) return [];
  const nodes = [];

  for (const [name, node] of shoukaku.nodes) {
    const config = getNodeConfig(name);

    nodes.push({
      name,
      url: config?.url || node.url || 'N/A',
      state: isNodeDisabled(name) ? 3 : node.state,
      // Node Shoukaku tidak punya properti `players`; jumlah pemutar ada di stats
      players: node.stats?.players ?? 0,
      playingPlayers: node.stats?.playingPlayers ?? 0,
      stats: node.stats || null,
      priority: config?.priority || 'secondary',
      engine: config?.engine || normEngineName({ name }),
      isDisabled: isNodeDisabled(name),
    });
  }

  return nodes;
}

/**
 * Mapping state number ke label
 */
export function getStateLabel(state, isDisabled = false) {
  if (isDisabled) return '🚫 Disabled';
  const labels = {
    0: '🔄 Connecting',
    1: '🟢 Connected',
    2: '🔌 Disconnecting',
    3: '🔴 Disconnected',
  };
  return labels[state] ?? '❓ Unknown';
}

/**
 * Hubungkan kembali (reconnect) semua node terputus atau daftarkan ulang node dari DB & Config
 */
export async function reconnectNodes(shoukaku, prisma = null, targetName = null) {
  if (!shoukaku) {
    throw new Error('Sistem Shoukaku (Lavalink) belum diinisialisasi.');
  }

  if (targetName) {
    // Jika targetName pernah disabled, re-enable node tersebut
    enableNode(targetName);
  }

  const rawNodes = await getAllNodes(prisma, 'startup');
  let formattedNodes = formatForShoukaku(rawNodes);

  if (targetName) {
    formattedNodes = formattedNodes.filter(n => n.name.toLowerCase() === targetName.toLowerCase());
    if (formattedNodes.length === 0) {
      const existing = shoukaku.nodes.get(targetName);
      if (existing) {
        formattedNodes = [{ name: existing.name, url: existing.url, auth: existing.auth, secure: existing.secure }];
      } else {
        throw new Error(`Node "${targetName}" tidak ditemukan di database maupun Shoukaku.`);
      }
    }
  }

  const summary = {
    reconnected: [],
    connected: [],
    failed: [],
  };

  for (const nodeConfig of formattedNodes) {
    if (isNodeDisabled(nodeConfig.name)) continue;

    const existingNode = shoukaku.nodes.get(nodeConfig.name);

    if (existingNode) {
      if (existingNode.state === 1) {
        summary.connected.push(existingNode.name);
      } else {
        try {
          try { existingNode.disconnect(); } catch (e) {}
          await new Promise(r => setTimeout(r, 500));
          existingNode.connect();
          summary.reconnected.push(existingNode.name);
        } catch (err) {
          summary.failed.push({ name: existingNode.name, reason: err.message });
        }
      }
    } else {
      try {
        shoukaku.addNode(nodeConfig);
        summary.reconnected.push(nodeConfig.name);
      } catch (err) {
        summary.failed.push({ name: nodeConfig.name, reason: err.message });
      }
    }
  }

  return summary;
}

// Track node yang sudah gagal koneksi agar tidak ditambahkan ulang
const failedNodeCooldowns = new Map(); // name → timestamp kapan terakhir gagal
const FAILED_NODE_COOLDOWN_MS = 30 * 60 * 1000; // 30 menit cooldown sebelum retry

/**
 * Auto Updater Background Loop
 * - Interval dinaikkan ke 30 menit untuk mengurangi tekanan koneksi
 * - Hanya menambahkan node baru jika health check lolos
 * - Node yang gagal dimasukkan cooldown 30 menit
 */
export function startNodeAutoUpdater(shoukaku, prisma, intervalMs = 1800000) {
  setInterval(async () => {
    try {
      const freshNodes = await getAllNodes(prisma, 'full');
      const formatted = formatForShoukaku(freshNodes);

      for (const nodeConfig of formatted) {
        if (isNodeDisabled(nodeConfig.name)) continue;

        const existing = shoukaku.nodes.get(nodeConfig.name);
        if (existing) {
          // Node hardcoded/DB yang sudah terdaftar tetapi terputus dicoba
          // dihubungkan lagi pada siklus updater (bukan hanya node baru).
          if (existing.state === 3) {
            const lastFail = failedNodeCooldowns.get(nodeConfig.name);
            if (lastFail && (Date.now() - lastFail) < FAILED_NODE_COOLDOWN_MS) continue;
            console.log(`🔄 Mencoba reconnect node: ${nodeConfig.name}`);
            // connect() mengembalikan promise; tangani rejection agar tidak
            // menjadi unhandled rejection saat node benar-benar mati.
            existing.connect().catch((e) => {
              failedNodeCooldowns.set(nodeConfig.name, Date.now());
              console.warn(`⚠️ Reconnect node ${nodeConfig.name} gagal: ${e?.message || e}`);
            });
          }
          continue;
        }

        // Skip jika node masih dalam cooldown karena gagal sebelumnya
        const lastFail = failedNodeCooldowns.get(nodeConfig.name);
        if (lastFail && (Date.now() - lastFail) < FAILED_NODE_COOLDOWN_MS) {
          continue;
        }

        // Health check dulu sebelum menambahkan node scraped/discovered
        const isScraped = nodeConfig.name.startsWith('Scraped-');
        if (isScraped) {
          try {
            const health = await testNodeHealth(nodeConfig.url, nodeConfig.auth, nodeConfig.secure, 4000);
            if (!health.alive) {
              failedNodeCooldowns.set(nodeConfig.name, Date.now());
              continue;
            }
          } catch (e) {
            failedNodeCooldowns.set(nodeConfig.name, Date.now());
            continue;
          }
        }

        try {
          shoukaku.addNode(nodeConfig);
          console.log(`🔄 Auto-added node: ${nodeConfig.name}`);
        } catch (e) {
          failedNodeCooldowns.set(nodeConfig.name, Date.now());
        }
      }
    } catch (err) {
      logError('Node Auto-Updater Error', err);
    }
  }, intervalMs);
}
