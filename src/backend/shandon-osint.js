/**
 * SHANDON ELITE — Ferramentas leves no Cloudflare Workers.
 *
 * Porta fiel das rotas do Shandon que só fazem chamadas HTTP (WhatsApp Lookup,
 * Phone OSINT e Crypto Check). Rodam no plano grátis do Worker da Central:
 * acordadas 24h, sem dormir, sem cartão. A chave da RapidAPI vive no ambiente
 * (secret) e nunca chega ao cliente.
 */

const ABORT_MS = 20000;
const METADATA = {
  'api/whatsapp-lookup': {
    service: 'whatsapp-lookup',
    description: 'WhatsApp OSINT: foto de perfil, status, negócio, dispositivos, privacidade e dados completos',
    body: { phone: 'string' },
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

  async function lookupWhatsApp(rawPhone, env) {
    const phone = sanitizePhone(rawPhone);
    const errors = [];

    if (!phone || phone.length < 8) {
      throw new Error('Número inválido. Use o código do país (ex.: 554797876098).');
    }
    if (!env.RAPIDAPI_WHATSAPP_KEY) {
      return { phone, configured: false, errors: ['Chave da API não configurada (RAPIDAPI_WHATSAPP_KEY).'] };
    }

    const result = { phone, configured: true, errors };
    const q = `?phone=${encodeURIComponent(phone)}`;

    const [photoRaw, aboutRaw, businessRaw, devicesRaw, fullRaw, privacyRaw] = await Promise.allSettled([
      rapid(`/wspic/b64${q}`, 'GET', null, env),
      rapid(`/about${q}`, 'GET', null, env),
      rapid('/bizos', 'POST', { phone }, env),
      rapid(`/devices${q}`, 'GET', null, env),
      rapid(`/wspic/dck${q}`, 'GET', null, env),
      rapid(`/privacy${q}`, 'GET', null, env),
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

  /* -------------------------- Phone OSINT -------------------------- */
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

  async function analyzePhone(rawPhone) {
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

  router.set('POST /api/phone-osint', async (request, context) => {
    const rl = await rateLimit(`phone:${context.ip}`, 10);
    if (!rl.ok) return json({ success: false, error: 'Muitas consultas. Aguarde um instante.' }, 429, corsFor(request));
    const body = await readBody(request);
    if (!body || typeof body.phone !== 'string') {
      return json({ success: false, error: 'phone is required' }, 400, corsFor(request));
    }
    try {
      const result = await analyzePhone(body.phone);
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