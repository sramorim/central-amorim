/**
 * SHANDON ELITE — Ferramentas leves no Cloudflare Workers.
 *
 * Porta fiel das rotas do Shandon que só fazem chamadas HTTP (WhatsApp Lookup,
 * Phone OSINT e Crypto Check). Rodam no plano grátis do Worker da Central:
 * acordadas 24h, sem dormir, sem cartão. A chave da RapidAPI vive no ambiente
 * (secret) e nunca chega ao cliente.
 */

const ABORT_MS = 20000;
const APIFY_ACTOR = 'eduair94~whatsapp-data-lookup';
const APIFY_INSTAGRAM_ACTOR = 'apify~instagram-scraper';
const METADATA = {
  'api/whatsapp-lookup': {
    service: 'whatsapp-lookup',
    description: 'WhatsApp OSINT: foto de perfil, status, negócio, Telegram, nome real (leak do Facebook) e vazamentos',
    body: { phone: 'string' },
  },
  'api/instagram': {
    service: 'instagram-lookup',
    description: 'Instagram Profundo: perfil completo (nome real, bio, seguidores, posts), verificado/privado/negócio, link externo e últimos posts',
    body: { username: 'string' },
  },
  'api/phone-osint': {
    service: 'phone-osint',
    description: 'Phone number OSINT and intelligence gathering',
    body: { phone: 'string' },
  },
  'api/crypto-check': {
    service: 'crypto-check',
    description: 'Crypto wallet intel: balance, transactions and risk flags',
    body: { address: 'string' },
  },
};

/* -------------------------- Phone OSINT (compartilhado) -------------------------- */
const COUNTRY_CODES = {
  '1': 'US/CA', '44': 'UK', '55': 'Brazil', '91': 'India', '86': 'China',
  '33': 'France', '49': 'Germany', '81': 'Japan', '82': 'South Korea',
  '34': 'Spain', '39': 'Italy', '61': 'Australia', '7': 'Russia',
  '27': 'South Africa', '52': 'Mexico', '46': 'Sweden', '47': 'Norway',
  '45': 'Denmark', '358': 'Finland', '48': 'Poland', '420': 'Czech Republic',
  '36': 'Hungary', '40': 'Romania', '90': 'Turkey', '20': 'Egypt',
  '966': 'Saudi Arabia', '971': 'UAE', '972': 'Israel', '65': 'Singapore',
  '60': 'Malaysia', '62': 'Indonesia', '63': 'Philippines', '66': 'Thailand',
  '84': 'Vietnam',
};

function parsePhoneNumber(input) {
  const digits = String(input).replace(/[^\d+]/g, '').replace(/^\+/, '');
  for (const [code, min] of [['1', 11], ['44', 12], ['55', 13], ['91', 12], ['86', 13], ['33', 11], ['49', 12], ['81', 12]]) {
    if (digits.startsWith(code) && digits.length >= min) {
      return { digits, countryCode: code, nationalNumber: digits.slice(code.length) };
    }
  }
  return { digits, countryCode: '', nationalNumber: digits };
}

async function fetchTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
  } finally {
    clearTimeout(timer);
  }
}

/* Contador diário em memória (por instância do Worker) que protege o crédito
   grátis do plano Apify Free (~US$5/mês, sem cartão). Zera a cada dia UTC. */
const dailyCounters = {};
function dailyBudget(name) {
  const today = new Date().toISOString().slice(0, 10);
  const entry = dailyCounters[name];
  if (!entry || entry.date !== today) {
    dailyCounters[name] = { date: today, count: 0 };
  }
  return dailyCounters[name];
}

async function checkNumverify(phone) {
  try {
    const response = await fetchTimeout(
      `https://apilayer.net/api/validate?access_key=demo&number=${encodeURIComponent(phone)}&country_code=&format=1`,
      6000
    );
    if (response.ok) {
      const data = await response.json();
      if (data.valid !== undefined) {
        return { carrier: data.carrier || '', lineType: data.line_type || '', country: data.country_name || '' };
      }
    }
  } catch {
    /* numverify indisponível */
  }
  return { carrier: '', lineType: '', country: '' };
}

async function checkWhatsApp(phone) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`https://wa.me/${phone}`, {
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    clearTimeout(timer);
    return response.status === 200 || response.status === 302;
  } catch {
    return false;
  }
}

async function checkSocialMedia(phone) {
  const profiles = [];
  try {
    const response = await fetchTimeout(`https://api.telegram.org/bot${phone}/getMe`, 3000);
    profiles.push({ platform: 'Telegram', url: `https://t.me/${phone}`, exists: response.ok });
  } catch {
    profiles.push({ platform: 'Telegram', url: `https://t.me/${phone}`, exists: false });
  }
  return profiles;
}

export async function runPhoneOsint(rawPhone) {
  const { digits, countryCode } = parsePhoneNumber(rawPhone);
  const country = COUNTRY_CODES[countryCode] || 'Unknown';
  const [numverify, whatsapp, socialMedia] = await Promise.all([
    checkNumverify(digits),
    checkWhatsApp(digits),
    checkSocialMedia(digits),
  ]);
  const valid = digits.length >= 7 && digits.length <= 15;
  return {
    phone: String(rawPhone).trim(),
    valid,
    country: numverify.country || country,
    carrier: numverify.carrier,
    lineType: numverify.lineType,
    whatsapp,
    socialMedia,
  };
}

export function installShandonOsint(ctx) {
  const { router, json, readBody, rateLimit, cfg, corsFor } = ctx;

  for (const path of Object.keys(METADATA)) {
    router.set(`GET /${path}`, async (request) => {
      return json({ success: true, data: METADATA[path] }, 200, corsFor(request));
    });
  }

  /* ------------------------- WhatsApp Lookup ------------------------- */
  function sanitizePhone(raw) {
    return String(raw || '').replace(/[^\d]/g, '');
  }

  async function rapid(path, method = 'GET', body, env) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ABORT_MS);
    try {
      const res = await fetch(`https://${env.RAPIDAPI_WHATSAPP_HOST || 'whatsapp-osint.p.rapidapi.com'}${path}`, {
        method,
        headers: {
          'x-rapidapi-key': env.RAPIDAPI_WHATSAPP_KEY || '',
          'x-rapidapi-host': env.RAPIDAPI_WHATSAPP_HOST || 'whatsapp-osint.p.rapidapi.com',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403) {
        throw new Error('Falha de autenticação na API (verifique RAPIDAPI_WHATSAPP_KEY)');
      }
      if (res.status === 404) return { __notFound: true };
      const text = (await res.text()).trim();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /* Tenta cada caminho listado; pule os que a API não tiver (404) — assim,
     se o provedor renomear endpoints, a consulta continua funcionando. */
  async function rapidCandidates(candidates, env) {
    for (const c of candidates) {
      const out = await rapid(c.path, c.method || 'GET', c.body || null, env);
      if (out && !out.__notFound) return out;
    }
    return null;
  }

  function parsePhoto(raw) {
    if (typeof raw === 'string') {
      const lo = raw.toLowerCase();
      if (lo.includes('no profile picture') || lo.includes('no profile photo') || lo.includes('hidden')) {
        return { hasPhoto: false, image: null };
      }
      const b64 = raw.replace(/^data:image\/[a-z]+;base64,/, '');
      if (b64.length > 100) return { hasPhoto: true, image: 'data:image/jpeg;base64,' + b64 };
      return { hasPhoto: false, image: null };
    }
    if (raw && typeof raw === 'object') {
      const obj = raw;
      const b64 = obj.data || obj.image || obj.base64;
      if (typeof b64 === 'string' && b64.replace(/^data:image\/[a-z]+;base64,/, '').length > 100) {
        return { hasPhoto: true, image: /^data:image\//i.test(b64) ? b64 : 'data:image/jpeg;base64,' + b64 };
      }
    }
    return { hasPhoto: false, image: null };
  }

  async function apifyLookup(phone, env) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ABORT_MS);
    try {
      const res = await fetch(
        `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(env.APIFY_API_TOKEN)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            numbers: [`+${phone}`],
            preferCache: true,
            onlyCache: false,
            includeProfilePic: true,
            includeAbout: true,
            includeTelegram: true,
            includeLeaks: true,
            fbProfilePic: true,
            includeLookup: true,
            includeCarrier: true,
            concurrency: 1,
            timeoutMs: 15000,
          }),
          signal: controller.signal,
        }
      );
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        throw new Error(`Apify respondeu ${res.status} (verifique APIFY_API_TOKEN)`);
      }
      if (!res.ok) throw new Error(`Apify respondeu ${res.status}`);
      const text = (await res.text()).trim();
      if (!text) return null;
      let rows = JSON.parse(text);
      if (!Array.isArray(rows) && rows && Array.isArray(rows.items)) rows = rows.items;
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const row = rows.find((r) => r && typeof r === 'object') || null;
      if (!row) return null;

      if (!row.exists) return { onWhatsApp: false, source: row.source || 'not-found' };
      if (row.error) throw new Error(String(row.error));

      const fb = row.fbLeak && row.fbLeak.data ? row.fbLeak.data : null;
      const name = fb ? [fb.firstName, fb.lastName].filter(Boolean).join(' ') : null;
      const photo = { hasPhoto: Boolean(row.urlImage), image: row.urlImage || null };
      if (row.facebookProfilePicUrl) photo.facebookPhoto = row.facebookProfilePicUrl;

      return {
        onWhatsApp: true,
        isBusiness: Boolean(row.isBusiness),
        photo,
        about: row.about || null,
        name,
        facebook:
          fb || row.fbLeak
            ? {
                profileUrl: row.facebookProfile || null,
                photoUrl: row.facebookProfilePicUrl || null,
                fbId: fb ? fb.fbId : null,
                gender: fb ? fb.gender : null,
                regionCode: fb ? fb.regionCode : null,
                details: fb && fb.other ? fb.other : null,
              }
            : null,
        telegram: row.telegram || null,
        hasTelegram: Boolean(row.telegram && row.telegram.username),
        leaks: row.leakedData || null,
        leakCheckPro: row.leakCheckPro || null,
        carrier: row.carrier || null,
        source: row.source || 'fresh',
        fetchedAt: row.fetchedAt || null,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function lookupWhatsApp(rawPhone, env) {
    const phone = sanitizePhone(rawPhone);
    const errors = [];

    if (!phone || phone.length < 8) {
      throw new Error('Número inválido. Use o código do país (ex.: 554797876098).');
    }
    if (!env.APIFY_API_TOKEN && !env.RAPIDAPI_WHATSAPP_KEY) {
      return { phone, configured: false, errors: ['Nenhuma chave configurada (APIFY_API_TOKEN ou RAPIDAPI_WHATSAPP_KEY).'] };
    }

    /* Provedor 1 — Apify WhatsApp Data Lookup (crédito grátis do plano Free):
       foto real, nome do leak do Facebook, Telegram, vazamentos de números. */
    if (env.APIFY_API_TOKEN) {
      const budget = dailyBudget('apify');
      const limit = Number(env.APIFY_DAILY_LIMIT) || 40;
      if (budget.count < limit) {
        budget.count++;
        try {
          const hit = await apifyLookup(phone, env);
          if (hit) {
            return { phone, configured: true, provider: 'apify', errors, ...hit };
          }
          errors.push('Apify não retornou dados para o número.');
        } catch (err) {
          errors.push(`Apify indisponível (${err.message}).`);
        }
      } else {
        errors.push('Limite diário de consultas Apify atingido (APIFY_DAILY_LIMIT).');
      }
    }

    /* Provedor 2 — RapidAPI WhatsApp OSINT (fallback). */
    if (!env.RAPIDAPI_WHATSAPP_KEY) {
      return { phone, configured: true, provider: 'apify', errors };
    }

    const result = { phone, configured: true, provider: 'rapidapi', errors };
    const q = `?phone=${encodeURIComponent(phone)}`;
    const q2 = `?phone=${encodeURIComponent(phone)}&number=${encodeURIComponent(phone)}`;

    const toCandidates = (list) => list.map((p) => (typeof p === 'string' ? { path: p } : p));

    const [photoRaw, aboutRaw, businessRaw, devicesRaw, fullRaw, privacyRaw] = await Promise.allSettled([
      rapidCandidates(toCandidates([`/wspic/b64${q}`, `/base64-encoded-profile${q}`, `/profile-picture${q2}`]), env),
      rapidCandidates(toCandidates([`/about${q}`, `/status${q}`]), env),
      rapidCandidates([{ path: '/bizos', method: 'POST', body: { phone } }, { path: '/business-insights', method: 'POST', body: { phone, number: phone } }], env),
      rapidCandidates(toCandidates([`/devices${q}`, `/devices${q2}`]), env),
      rapidCandidates(toCandidates([`/wspic/dck${q}`, `/fetch-osint-info${q}`, `/fetch-osint-info${q2}`]), env),
      rapidCandidates(toCandidates([`/privacy${q}`, `/privacy-settings${q}`, `/privacy-settings${q2}`]), env),
    ]);

    const label = (name, reason) => name + ': ' + reason.message;
    if (photoRaw.status === 'fulfilled') result.photo = parsePhoto(photoRaw.value);
    else errors.push(label('Foto de perfil', photoRaw.reason));

    const setJson = (key, raw) => {
      if (raw.status === 'fulfilled' && raw.value && typeof raw.value === 'object') {
        result[key] = raw.value;
      } else if (raw.status === 'rejected') {
        errors.push(label(key, raw.reason));
      }
    };
    setJson('about', aboutRaw);
    setJson('business', businessRaw);
    setJson('devices', devicesRaw);
    setJson('full', fullRaw);
    setJson('privacy', privacyRaw);

    return result;
  }

  router.set('POST /api/whatsapp-lookup', async (request, context) => {
    const rl = await rateLimit(`whatsapp:${context.ip}`, 10);
    if (!rl.ok) return json({ success: false, error: 'Muitas consultas. Aguarde um instante.' }, 429, corsFor(request));
    const body = await readBody(request);
    if (!body || typeof body.phone !== 'string') {
      return json({ success: false, error: 'phone is required' }, 400, corsFor(request));
    }
    try {
      const result = await lookupWhatsApp(body.phone, cfg);
      return json({ success: true, data: result }, 200, corsFor(request));
    } catch (err) {
      return json({ success: false, error: err.message }, 500, corsFor(request));
    }
  });

  /* ------------------------- Instagram Profundo ------------------------- */
  function usernameFromInput(raw) {
    let u = String(raw || '').trim().replace(/^@+/, '');
    const parts = u.replace(/^https?:\/\//i, '').split('/');
    const hostIdx = parts.findIndex((p) => p.toLowerCase().includes('instagram.com'));
    if (hostIdx >= 0) u = parts[hostIdx + 1] || '';
    return u.replace(/[^a-zA-Z0-9._]/g, '');
  }

  /* Perfil completo de um username via apify/instagram-scraper (modo "details").
     Cada execução ≈ US$0,003 no plano Free (1 resultado); posts vêm embutidos. */
  async function apifyInstagram(username, env) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(
        `https://api.apify.com/v2/acts/${APIFY_INSTAGRAM_ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(env.APIFY_API_TOKEN)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            directUrls: [`https://www.instagram.com/${username}/`],
            resultsType: 'details',
            resultsLimit: 1,
          }),
          signal: controller.signal,
        }
      );
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        throw new Error(`Apify respondeu ${res.status} (verifique APIFY_API_TOKEN)`);
      }
      if (!res.ok) throw new Error(`Apify respondeu ${res.status}`);
      const text = (await res.text()).trim();
      if (!text) return null;
      let items = JSON.parse(text);
      if (!Array.isArray(items)) items = items && Array.isArray(items.items) ? items.items : [];
      const prof = items.find((i) => i && typeof i === 'object') || null;
      if (!prof) return null;
      if (prof.error) throw new Error(String(prof.error));

      const posts = (Array.isArray(prof.latestPosts) ? prof.latestPosts : []).map((p) => ({
        url: p.url || null,
        type: p.type || null,
        caption: p.caption || null,
        likesCount: p.likesCount ?? null,
        commentsCount: p.commentsCount ?? null,
        videoViewCount: p.videoViewCount ?? null,
        timestamp: p.timestamp || null,
        image: p.displayUrl || null,
      }));

      return {
        username: prof.username || username,
        fullName: prof.fullName || null,
        biography: prof.biography || null,
        verified: Boolean(prof.verified),
        isPrivate: Boolean(prof.private),
        isBusiness: Boolean(prof.isBusinessAccount),
        businessCategory: prof.businessCategoryName || null,
        followersCount: prof.followersCount ?? null,
        followsCount: prof.followsCount ?? null,
        postsCount: prof.postsCount ?? null,
        highlightsCount: prof.highlightReelCount ?? null,
        externalUrl: prof.externalUrl || null,
        profilePicUrl: prof.profilePicUrl || prof.profilePicUrlHD || null,
        profilePicUrlHD: prof.profilePicUrlHD || null,
        fbid: prof.fbid || null,
        profileUrl: prof.url || `https://www.instagram.com/${username}`,
        latestPosts: posts,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  router.set('POST /api/instagram', async (request, context) => {
    const rl = await rateLimit(`instagram:${context.ip}`, 5);
    if (!rl.ok) return json({ success: false, error: 'Muitas consultas. Aguarde um instante.' }, 429, corsFor(request));
    const body = await readBody(request);
    if (!body || typeof body.username !== 'string' || !body.username.trim()) {
      return json({ success: false, error: 'username is required' }, 400, corsFor(request));
    }
    const username = usernameFromInput(body.username);
    if (!username) {
      return json({ success: false, error: 'username inválido' }, 400, corsFor(request));
    }
    if (!cfg.APIFY_API_TOKEN) {
      return json({ success: true, data: { username, configured: false, errors: ['Chave Apify não configurada (APIFY_API_TOKEN).'] } }, 200, corsFor(request));
    }
    const budget = dailyBudget('apify');
    const limit = Number(cfg.APIFY_DAILY_LIMIT) || 40;
    if (budget.count >= limit) {
      return json({ success: true, data: { username, configured: true, provider: 'apify-instagram', errors: ['Limite diário de consultas Apify atingido (APIFY_DAILY_LIMIT).'] } }, 200, corsFor(request));
    }
    budget.count++;
    try {
      const prof = await apifyInstagram(username, cfg);
      if (!prof) {
        return json({ success: true, data: { username, configured: true, provider: 'apify-instagram', errors: ['Perfil não encontrado ou privado.'] } }, 200, corsFor(request));
      }
      return json({ success: true, data: { username, configured: true, provider: 'apify-instagram', profile: prof } }, 200, corsFor(request));
    } catch (err) {
      return json({ success: false, error: err.message }, 500, corsFor(request));
    }
  });

  /* -------------------------- Phone OSINT -------------------------- */
  /* ------------------------- Phone OSINT ------------------------- */
  router.set('POST /api/phone-osint', async (request, context) => {
    const rl = await rateLimit(`phone:${context.ip}`, 10);
    if (!rl.ok) return json({ success: false, error: 'Muitas consultas. Aguarde um instante.' }, 429, corsFor(request));
    const body = await readBody(request);
    if (!body || typeof body.phone !== 'string') {
      return json({ success: false, error: 'phone is required' }, 400, corsFor(request));
    }
    try {
      const result = await runPhoneOsint(body.phone);
      return json({ success: true, data: result }, 200, corsFor(request));
    } catch (err) {
      return json({ success: false, error: err.message }, 500, corsFor(request));
    }
  });

  /* ------------------------- Crypto Check ------------------------- */
  function isBtcAddress(addr) {
    return /^(1|3|bc1)[a-zA-HJ-NP-Z0-9]{25,62}$/.test(addr);
  }
  function isEthAddress(addr) {
    return /^0x[a-fA-F0-9]{40}$/.test(addr);
  }

  async function checkBtc(address) {
    const fallback = { address, blockchain: 'Bitcoin', balance: '0', txCount: 0, firstSeen: '', lastSeen: '', riskFlags: [] };
    try {
      const response = await fetchTimeout(`https://blockchain.info/rawaddr/${encodeURIComponent(address)}?limit=10`);
      if (response.ok) {
        const data = await response.json();
        const balance = (data.final_balance || 0) / 1e8;
        let firstSeen = '', lastSeen = '';
        if (Array.isArray(data.txs) && data.txs.length > 0) {
          const sorted = [...data.txs].sort((a, b) => a.time - b.time);
          firstSeen = new Date(sorted[0].time * 1000).toISOString();
          lastSeen = new Date(sorted[sorted.length - 1].time * 1000).toISOString();
        }
        return { address, blockchain: 'Bitcoin', balance: balance.toFixed(8), txCount: data.n_tx || 0, firstSeen, lastSeen, riskFlags: [] };
      }
    } catch {
      /* blockchain.info falhou */
    }
    try {
      const response = await fetchTimeout(`https://blockchair.com/bitcoin/dashboards/address/${encodeURIComponent(address)}`);
      if (response.ok) {
        const data = await response.json();
        const addrData = data.data?.[address]?.address;
        if (addrData) {
          return {
            address, blockchain: 'Bitcoin',
            balance: ((addrData.balance || 0) / 1e8).toFixed(8),
            txCount: addrData.transaction_count || 0,
            firstSeen: addrData.first_seen_receiving || '',
            lastSeen: addrData.last_seen_receiving || '',
            riskFlags: [],
          };
        }
      }
    } catch {
      /* blockchair falhou */
    }
    return fallback;
  }

  async function checkEth(address) {
    const fallback = { address, blockchain: 'Ethereum', balance: '0', txCount: 0, firstSeen: '', lastSeen: '', riskFlags: [] };
    try {
      const response = await fetchTimeout(
        `https://api.etherscan.io/api?module=account&action=txlist&address=${encodeURIComponent(address)}&startblock=0&endblock=99999999&sort=asc&page=1&offset=10`
      );
      if (response.ok) {
        const data = await response.json();
        if (data.status === '1' && Array.isArray(data.result)) {
          const txs = data.result;
          const firstSeen = txs.length ? new Date(Number(txs[0].timeStamp) * 1000).toISOString() : '';
          const lastSeen = txs.length ? new Date(Number(txs[txs.length - 1].timeStamp) * 1000).toISOString() : '';
          let balance = '0';
          try {
            const bal = await fetchTimeout(`https://api.etherscan.io/api?module=account&action=balance&address=${encodeURIComponent(address)}&tag=latest`);
            if (bal.ok) {
              const balData = await bal.json();
              if (balData.status === '1' && balData.result) balance = (Number(balData.result) / 1e18).toFixed(8);
            }
          } catch {
            /* saldo indisponível */
          }
          return { address, blockchain: 'Ethereum', balance, txCount: txs.length, firstSeen, lastSeen, riskFlags: [] };
        }
      }
    } catch {
      /* etherscan falhou */
    }
    try {
      const response = await fetchTimeout(`https://blockchair.com/ethereum/dashboards/address/${encodeURIComponent(address)}`);
      if (response.ok) {
        const data = await response.json();
        const addrData = data.data?.[address]?.address;
        if (addrData) {
          return {
            address, blockchain: 'Ethereum',
            balance: ((addrData.balance || 0) / 1e18).toFixed(8),
            txCount: addrData.transaction_count || 0,
            firstSeen: addrData.first_seen_receiving || '',
            lastSeen: addrData.last_seen_receiving || '',
            riskFlags: [],
          };
        }
      }
    } catch {
      /* blockchair falhou */
    }
    return fallback;
  }

  async function checkCryptoWallet(address) {
    const cleaned = String(address || '').trim();
    if (!cleaned) throw new Error('Endereço inválido.');
    if (isBtcAddress(cleaned)) return checkBtc(cleaned);
    if (isEthAddress(cleaned)) return checkEth(cleaned);
    const btc = await checkBtc(cleaned);
    if (btc.txCount > 0) return btc;
    const eth = await checkEth(cleaned);
    if (eth.txCount > 0) return eth;
    return { address: cleaned, blockchain: 'Unknown', balance: '0', txCount: 0, firstSeen: '', lastSeen: '', riskFlags: [] };
  }

  router.set('POST /api/crypto-check', async (request, context) => {
    const rl = await rateLimit(`crypto:${context.ip}`, 8);
    if (!rl.ok) return json({ success: false, error: 'Muitas consultas. Aguarde um instante.' }, 429, corsFor(request));
    const body = await readBody(request);
    if (!body || typeof body.address !== 'string') {
      return json({ success: false, error: 'address is required' }, 400, corsFor(request));
    }
    try {
      const result = await checkCryptoWallet(body.address);
      return json({ success: true, data: result }, 200, corsFor(request));
    } catch (err) {
      return json({ success: false, error: err.message }, 500, corsFor(request));
    }
  });
}

export const SHANDON_OSINT_METADATA = METADATA;