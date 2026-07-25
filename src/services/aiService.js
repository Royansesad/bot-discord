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
        console.warn('   AI features akan menggunakan fallback (Rewind AI) jika tersedia.');
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

  // Fallback ke Rewind AI jika puter gagal
  if (!reply && config.rewindApiKey) {
    try {
      reply = await rewindChat(messages);
    } catch (err) {
      console.error('❌ Rewind AI chat juga gagal:', err.message);
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
 * Fallback ke Rewind AI jika limit tercapai
 */
export async function generateImage(prompt) {
  await initPuter();
  let imageResult = null;
  let puterError = null;

  // Coba puter.js SDK dulu (gratis)
  if (puter) {
    try {
      imageResult = await puterImageSDK(prompt);
    } catch (err) {
      puterError = err;
      // Deteksi limit/quota error secara eksplisit
      const errMsg = (err?.message || err?.toString() || '').toLowerCase();
      const isLimitError = errMsg.includes('limit') || errMsg.includes('quota') 
        || errMsg.includes('rate') || errMsg.includes('exceeded') 
        || errMsg.includes('too many') || errMsg.includes('usage');

      if (isLimitError) {
        console.warn('⚠️ Puter.js image generation limit tercapai, mencoba fallback ke Rewind AI...', err.message || err);
      } else {
        console.warn('⚠️ Puter.js image generation gagal, mencoba fallback ke Rewind AI...', err.message || err);
      }
    }
  }

  // Fallback ke Rewind AI — selalu dijalankan jika puter gagal
  if (!imageResult && config.rewindApiKey) {
    try {
      imageResult = await rewindImageGeneration(prompt);
      if (imageResult) {
        console.log('✅ Fallback ke Rewind AI berhasil untuk image generation.');
      }
    } catch (err) {
      console.error('❌ Rewind AI image generation juga gagal:', err.message);
      // Gabungkan error dari kedua provider agar user mendapat info lengkap
      const puterMsg = puterError ? `Puter.js: ${puterError.message || puterError}` : 'Puter.js: tidak tersedia';
      const rewindMsg = `Rewind AI: ${err.message}`;
      throw new Error(`Semua service image generation gagal.\n• ${puterMsg}\n• ${rewindMsg}`);
    }
  }

  if (!imageResult) {
    const reason = puterError 
      ? `Puter.js gagal (${puterError.message || puterError}) dan Rewind AI tidak dikonfigurasi.`
      : 'Tidak ada image generation service yang tersedia. Pastikan Puter sudah ter-autentikasi atau Rewind AI API key sudah di-set.';
    throw new Error(reason);
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
 * Wrapper untuk puter.ai.txt2img() yang menangkap error internal SDK.
 * 
 * Puter.js SDK terkadang throw error secara internal (di callback/WebSocket handler)
 * yang TIDAK melalui promise reject — misalnya "Unexpected image response format"
 * saat konten eksplisit terdeteksi. Ini menyebabkan promise hang selamanya dan
 * error muncul sebagai uncaughtException.
 * 
 * Wrapper ini menangkap error tersebut dengan:
 * 1. Intercept uncaughtException & unhandledRejection sementara
 * 2. Timeout 30 detik sebagai safety net
 */
function safePuterTxt2Img(prompt) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (fn, val) => {
      if (settled) return;
      settled = true;
      process.removeListener('uncaughtException', onException);
      process.removeListener('unhandledRejection', onRejection);
      clearTimeout(timer);
      fn(val);
    };

    // Intercept SDK-internal throws yang jadi uncaughtException
    const onException = (err) => {
      const msg = (err?.message || err?.toString() || '').toLowerCase();
      // Hanya intercept error yang terkait image/response dari SDK
      if (msg.includes('image') || msg.includes('format') || msg.includes('response')
        || msg.includes('unexpected') || msg.includes('content') || msg.includes('safety')
        || msg.includes('moderation') || msg.includes('policy')) {
        console.error('🔧 Intercepted SDK uncaughtException:', err?.message || err);
        try { err._handled = true; } catch {}
        settle(reject, err);
      }
      // Error lain dibiarkan lewat ke global handler
    };

    // Intercept unhandled promise rejection dari SDK internal
    const onRejection = (err) => {
      const msg = (err?.message || err?.toString() || '').toLowerCase();
      if (msg.includes('image') || msg.includes('format') || msg.includes('response')
        || msg.includes('unexpected') || msg.includes('content') || msg.includes('safety')
        || msg.includes('moderation') || msg.includes('policy')) {
        console.error('🔧 Intercepted SDK unhandledRejection:', err?.message || err);
        try { err._handled = true; } catch {}
        settle(reject, err);
      }
    };

    // Prepend agar listener kita berjalan sebelum global handler
    process.prependListener('uncaughtException', onException);
    process.prependListener('unhandledRejection', onRejection);

    // Timeout safety net — 30 detik
    const timer = setTimeout(() => {
      settle(reject, new Error('Image generation timeout (30s). Kemungkinan prompt ditolak oleh content filter.'));
    }, 30000);

    // Panggil SDK
    puter.ai.txt2img(prompt, { model: 'gpt-image-2' })
      .then(result => settle(resolve, result))
      .catch(err => settle(reject, err));
  });
}

/**
 * Image generation via puter.js SDK - puter.ai.txt2img()
 * Menggunakan model: gpt-image-2
 * Response format: { src: "data:image/png;base64,..." }
 */
async function puterImageSDK(prompt) {
  let image;
  try {
    // Gunakan wrapper yang aman untuk menangkap error internal SDK
    image = await safePuterTxt2Img(prompt);
  } catch (sdkErr) {
    // Tangkap semua jenis error dari SDK termasuk limit, quota, network, content policy, dll.
    const errMsg = sdkErr?.message || sdkErr?.error?.message || sdkErr?.toString() || 'Unknown SDK error';
    const errLower = errMsg.toLowerCase();
    console.error('❌ puter.ai.txt2img() error:', errMsg);

    // Deteksi content policy / explicit content / "Unexpected image response format" error
    if (errLower.includes('content policy') || errLower.includes('safety') 
      || errLower.includes('explicit') || errLower.includes('moderation')
      || errLower.includes('inappropriate') || errLower.includes('violat')
      || errLower.includes('nsfw') || errLower.includes('prohibited')
      || errLower.includes('content_policy') || errLower.includes('filtered')
      || errLower.includes('unexpected image') || errLower.includes('unexpected') && errLower.includes('format')) {
      throw new Error('⚠️ Prompt ditolak karena melanggar content policy. Gambar yang mengandung konten eksplisit/NSFW tidak dapat di-generate. Coba gunakan prompt yang berbeda.');
    }

    throw new Error(`Puter.js txt2img error: ${errMsg}`);
  }

  // Cek jika response null/undefined
  if (image == null) {
    console.error('❌ puter.ai.txt2img() returned null/undefined');
    throw new Error('Puter.js tidak mengembalikan hasil gambar (response kosong). Kemungkinan prompt ditolak oleh content filter.');
  }

  // Cek jika response mengandung error (beberapa API return error sebagai response, bukan throw)
  if (image?.error) {
    const errMsg = typeof image.error === 'string' ? image.error 
      : image.error?.message || JSON.stringify(image.error);
    const errLower = errMsg.toLowerCase();
    console.error('❌ puter.ai.txt2img() returned error response:', errMsg);

    // Deteksi content policy error dari response
    if (errLower.includes('content policy') || errLower.includes('safety') 
      || errLower.includes('explicit') || errLower.includes('moderation')
      || errLower.includes('inappropriate') || errLower.includes('violat')
      || errLower.includes('nsfw') || errLower.includes('prohibited')
      || errLower.includes('content_policy') || errLower.includes('filtered')) {
      throw new Error('⚠️ Prompt ditolak karena melanggar content policy. Gambar yang mengandung konten eksplisit/NSFW tidak dapat di-generate. Coba gunakan prompt yang berbeda.');
    }

    throw new Error(`Puter.js txt2img error: ${errMsg}`);
  }

  // Cek jika response mengandung status/message yang mengindikasikan penolakan
  if (image?.status && image?.message) {
    const msg = image.message;
    console.error('❌ puter.ai.txt2img() returned status response:', image.status, msg);
    throw new Error(`Puter.js txt2img: ${msg}`);
  }

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

  // Log detail tentang format yang tidak dikenali sebelum throw
  const imageType = typeof image;
  const imageKeys = image && typeof image === 'object' ? Object.keys(image).join(', ') : 'N/A';
  const imagePreview = typeof image === 'string' ? image.substring(0, 200) : JSON.stringify(image)?.substring(0, 500);
  console.error(`❌ Format response puter.ai.txt2img tidak dikenali:`);
  console.error(`   Type: ${imageType}, Keys: [${imageKeys}]`);
  console.error(`   Preview: ${imagePreview}`);

  throw new Error(`Format response gambar dari Puter.js tidak dikenali (type: ${imageType}, keys: [${imageKeys}]). Kemungkinan prompt ditolak oleh content filter atau API mengembalikan format baru.`);
}

// ============================================
// APIMart Fallback (opsional, butuh API key)
// ============================================

// ============================================
// Rewind AI Fallback (opsional, butuh API key)
// ============================================

async function rewindChat(messages) {
  if (!config.rewindApiKey) throw new Error('Rewind AI API key tidak dikonfigurasi');

  const response = await fetch(`${config.rewindBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.rewindApiKey}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-5.4-nano",
      messages,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    let errMsg = `Rewind AI chat error: ${response.status}`;
    try {
      const errData = await response.json();
      if (errData?.error?.message) {
        errMsg = errData.error.message;
      }
    } catch (_) {}
    throw new Error(errMsg);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || null;
}

async function rewindImageGeneration(prompt) {
  if (!config.rewindApiKey) throw new Error('Rewind AI API key tidak dikonfigurasi');

  const response = await fetch(`${config.rewindBaseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.rewindApiKey}`,
    },
    body: JSON.stringify({ model: 'openai/gpt-5.4-image-2', prompt }),
  });

  if (!response.ok) {
    let errMsg = `Rewind AI image error: ${response.status}`;
    try {
      const errData = await response.json();
      if (errData?.error?.message) {
        errMsg = errData.error.message;
      }
    } catch (_) {}
    throw new Error(errMsg);
  }
  const data = await response.json();
  const url = data.data?.[0]?.url;
  if (url) return { type: 'url', data: url };
  return null;
}

// ============================================
// Usage & Balance Check Functions (Task 14)
// ============================================

/**
 * Cek monthly usage dari Puter.js
 * Menggunakan puter.auth.getMonthlyUsage()
 */
export async function getPuterUsage() {
  await initPuter();
  if (!puter) {
    return { available: false, reason: 'Puter.js belum ter-autentikasi' };
  }

  try {
    let monthlyUsage = null;

    try {
      monthlyUsage = await puter.auth.getMonthlyUsage();
    } catch (e) {
      console.warn('⚠️ puter.auth.getMonthlyUsage() tidak tersedia:', e.message);
    }

    // Parse monthly usage jadi format yang lebih terstruktur
    let usage = null;
    let appTotals = null;
    let allowanceInfo = null;

    if (monthlyUsage && typeof monthlyUsage === 'object') {
      // Pisahkan usage services, appTotals, dan allowanceInfo
      const { appTotals: at, allowanceInfo: ai, ...serviceUsage } = monthlyUsage;
      appTotals = at || null;
      allowanceInfo = ai || null;

      // Format service usage — hanya ambil yang relevant (image related)
      if (Object.keys(serviceUsage).length > 0) {
        usage = serviceUsage;
      }
    }

    return {
      available: true,
      usage,
      appTotals,
      allowanceInfo,
      raw: monthlyUsage,
    };
  } catch (err) {
    console.error('❌ Gagal mengambil Puter.js usage:', err.message);
    return { available: false, reason: err.message };
  }
}

/**
 * Cek balance dari Rewind AI
 * Menggunakan GET /v1/users/me
 */
export async function getRewindBalance() {
  if (!config.rewindApiKey) {
    return { available: false, reason: 'Rewind AI API key tidak dikonfigurasi' };
  }

  try {
    const response = await fetch(`${config.rewindBaseUrl}/users/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.rewindApiKey}`,
      },
    });

    if (!response.ok) {
      let errMsg = `HTTP ${response.status}`;
      try {
        const errData = await response.json();
        if (errData?.error?.message) {
          errMsg = errData.error.message;
        }
      } catch (_) {
        const errText = await response.text().catch(() => 'Unknown error');
        errMsg = `${errMsg}: ${errText}`;
      }
      throw new Error(errMsg);
    }

    const data = await response.json();
    return {
      available: true,
      plan: data.plan,
      balance: data.balance,
      totalSpendable: data.totalSpendableNow,
    };
  } catch (err) {
    console.error('❌ Gagal mengambil Rewind AI balance:', err.message);
    return { available: false, reason: err.message };
  }
}
