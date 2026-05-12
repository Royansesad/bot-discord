// ============================================
// aiService.js - AI Service via Puter.js SDK
// Puter.js: Free AI, no API keys needed
// Primary: puter.js | Fallback: APIMart HTTP
// ============================================
import { init, getAuthToken } from '@heyputer/puter.js/src/init.cjs';
import WebSocket from 'ws';
import config from '../config.js';

// Fix bug WebSocket loop Node 22 + undici
global.WebSocket = WebSocket;

// Inisialisasi Puter.js SDK untuk Node.js
let puter = null;

async function initPuter() {
  if (puter) return puter;

  try {
    // Puter.js di Node.js membutuhkan auth token dari akun Puter
    // Token bisa didapat via:
    //   1. Environment variable PUTER_AUTH_TOKEN
    //   2. Browser-based login saat pertama kali (getAuthToken())
    const token = process.env.PUTER_AUTH_TOKEN;

    if (token) {
      puter = init(token);
      console.log('✅ Puter.js initialized dengan auth token');
    } else {
      // Jika tidak ada token, coba browser-based auth
      // Ini akan membuka browser sekali untuk login
      console.log('🔑 Puter auth token tidak ditemukan di env.');
      console.log('   Jalankan sekali dengan browser untuk mendapatkan token,');
      console.log('   atau set PUTER_AUTH_TOKEN di .env');
      console.log('   (Mendapatkan token via browser login...)');

      try {
        const authToken = await getAuthToken();
        puter = init(authToken);
        console.log('✅ Puter.js authenticated via browser');
        console.log(`   Simpan token berikut di .env sebagai PUTER_AUTH_TOKEN:`);
        console.log(`   ${authToken}`);
      } catch (authErr) {
        console.warn('⚠️ Browser auth gagal:', authErr.message);
        console.warn('   AI features akan menggunakan fallback (APIMart) jika tersedia.');
        return null;
      }
    }
  } catch (err) {
    console.error('❌ Gagal init Puter.js:', err.message);
    puter = null;
  }

  return puter;
}

// Init saat module load tidak dilakukan lagi untuk mencegah error saat deploy
// await initPuter();

const MAX_CONTEXT_MESSAGES = 10;

/**
 * Chat completion via puter.js SDK (GRATIS, tanpa API key)
 * Fallback ke APIMart jika puter gagal
 */
export async function chatCompletion(prisma, userId, userMessage) {
  // Pastikan puter diinisialisasi sebelum digunakan
  await initPuter();

  // Ambil context dari database
  const contextRecords = await prisma.chatContext.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    take: MAX_CONTEXT_MESSAGES,
  });

  const messages = [
    {
      role: 'system',
      content: 'Kamu adalah asisten AI yang ramah, cerdas, dan suka bercanda. Jawab dalam bahasa yang sama dengan user. Beri respons yang natural dan menyenangkan. Jangan terlalu panjang, maksimal 2-3 paragraf.',
    },
    ...contextRecords.map(r => ({ role: r.role, content: r.content })),
    { role: 'user', content: userMessage },
  ];

  let reply = null;

  // Coba puter.js SDK terlebih dahulu (GRATIS!)
  if (puter) {
    try {
      reply = await puterChatSDK(messages);
    } catch (err) {
      console.warn('⚠️ Puter.js chat gagal, mencoba fallback...', err.message);
    }
  }

  // Fallback ke APIMart jika puter gagal
  if (!reply && config.apimartApiKey) {
    try {
      reply = await apimartChat(messages);
    } catch (err) {
      console.error('❌ APIMart chat juga gagal:', err.message);
      throw new Error('Semua AI service sedang tidak tersedia. Coba lagi nanti.');
    }
  }

  if (!reply) {
    throw new Error('Tidak ada AI service yang tersedia. Pastikan Puter sudah ter-autentikasi (jalankan bot sekali dengan browser, atau set PUTER_AUTH_TOKEN di .env).');
  }

  // Simpan context ke database
  await prisma.chatContext.createMany({
    data: [
      { userId, role: 'user', content: userMessage },
      { userId, role: 'assistant', content: reply },
    ],
  });

  // Bersihkan context lama (keep last MAX messages)
  const totalContext = await prisma.chatContext.count({ where: { userId } });
  if (totalContext > MAX_CONTEXT_MESSAGES * 2) {
    const oldest = await prisma.chatContext.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      take: totalContext - MAX_CONTEXT_MESSAGES,
    });
    await prisma.chatContext.deleteMany({
      where: { id: { in: oldest.map(r => r.id) } },
    });
  }

  return reply;
}

/**
 * Generate image via puter.js SDK (txt2img) - GRATIS!
 * Fallback ke APIMart jika limit tercapai
 */
export async function generateImage(prompt) {
  await initPuter();
  let imageResult = null;

  // Coba puter.js SDK dulu (gratis)
  if (puter) {
    try {
      imageResult = await puterImageSDK(prompt);
    } catch (err) {
      console.warn('⚠️ Puter.js image generation gagal:', err.message);
    }
  }

  // Fallback ke APIMart
  if (!imageResult && config.apimartApiKey) {
    try {
      imageResult = await apimartImageGeneration(prompt);
    } catch (err) {
      console.error('❌ APIMart image generation juga gagal:', err.message);
      throw new Error('Semua service image generation sedang tidak tersedia.');
    }
  }

  if (!imageResult) {
    throw new Error('Tidak ada image generation service yang tersedia.');
  }

  return imageResult;
}

// ============================================
// Puter.js SDK Implementations (Free AI!)
// ============================================

/**
 * Chat via puter.js SDK - puter.ai.chat()
 * Model: gpt-5.4-nano (sesuai request)
 */
async function puterChatSDK(messages) {
  const response = await puter.ai.chat(messages, {
    model: 'gpt-5.4-nano',
  });

  // Response format: { message: { content: "..." } }
  if (response?.message?.content) {
    return response.message.content.toString();
  }
  if (typeof response === 'string') {
    return response;
  }

  throw new Error('Format response puter.ai.chat tidak dikenali');
}

/**
 * Image generation via puter.js SDK - puter.ai.txt2img()
 * Menggunakan model: gpt-image-2
 * Response format: { src: "data:image/png;base64,..." }
 */
async function puterImageSDK(prompt) {
  const image = await puter.ai.txt2img(prompt, { model: 'gpt-image-2' });

  // Format utama: object dengan property src berisi base64 data URI
  if (image?.src && typeof image.src === 'string' && image.src.startsWith('data:')) {
    const base64Data = image.src.split(',')[1];
    return { type: 'buffer', data: Buffer.from(base64Data, 'base64') };
  }

  // Fallback: jika src adalah URL biasa
  if (image?.src && typeof image.src === 'string' && image.src.startsWith('http')) {
    return { type: 'url', data: image.src };
  }

  // Fallback: Blob/File-like object
  if (image && typeof image.arrayBuffer === 'function') {
    const arrayBuffer = await image.arrayBuffer();
    return { type: 'buffer', data: Buffer.from(arrayBuffer) };
  }

  // Fallback: sudah berupa Buffer
  if (Buffer.isBuffer(image)) {
    return { type: 'buffer', data: image };
  }

  // Fallback: string URL langsung
  if (typeof image === 'string' && image.startsWith('http')) {
    return { type: 'url', data: image };
  }

  // Fallback: string base64 langsung
  if (typeof image === 'string' && image.startsWith('data:')) {
    const base64Data = image.split(',')[1];
    return { type: 'buffer', data: Buffer.from(base64Data, 'base64') };
  }

  throw new Error('Format response puter.ai.txt2img tidak dikenali');
}

// ============================================
// APIMart Fallback (opsional, butuh API key)
// ============================================

async function apimartChat(messages) {
  if (!config.apimartApiKey) throw new Error('APIMart API key tidak dikonfigurasi');

  const response = await fetch(`${config.apimartBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apimartApiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 500,
    }),
  });

  if (!response.ok) throw new Error(`APIMart chat error: ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || null;
}

async function apimartImageGeneration(prompt) {
  if (!config.apimartApiKey) throw new Error('APIMart API key tidak dikonfigurasi');

  const response = await fetch(`${config.apimartBaseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apimartApiKey}`,
    },
    body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1024x1024' }),
  });

  if (!response.ok) throw new Error(`APIMart image error: ${response.status}`);
  const data = await response.json();
  const url = data.data?.[0]?.url;
  if (url) return { type: 'url', data: url };
  return null;
}
