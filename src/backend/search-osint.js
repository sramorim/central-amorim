/**
 * CENTRAL AMORIM — Buscador de pessoa ("Localizar Pessoa").
 *
 * Varre ~40 plataformas procurando o mesmo username (enumeração Sherlock-style),
 * confirma o perfil e enriquece com dados públicos onde a plataforma permite sem
 * chave: GitHub (api), Reddit (about.json), Telegram (preview), Steam (XML),
 * YouTube/Twitch/TikTok/Instagram (OG/meta da própria página). Para as redes que
 * bloqueiam robô (Facebook, X, LinkedIn, ...) marca como "possível" — abrir o
 * link e confirmar é sempre possível, direto no site original, sem entrar na conta.
 *
 * Modos: username (enumeração), name (links de busca por nome), email (gravatar +
 * buscas), phone (delega ao phone-osint). Tudo em paralelo e com timeout curto
 * para caber no limite do plano grátis do Workers.
 */

import { createHash } from 'node:crypto';
import { runPhoneOsint } from './shandon-osint.js';

const PROBE_TIMEOUT = 4000;
const ENRICH_TIMEOUT = 6000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function esc(s) {
  return encodeURIComponent(s);
}

async function get(url, timeout = PROBE_TIMEOUT, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, accept: '*/*', ...headers },
    });
  } finally {
    clearTimeout(timer);
  }
}

function skip(platform, errors) {
  if (errors.length >= 3) {
    return `pulando ${platform} (${errors} falhas)`;
  }
  return '';
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function og(body, prop) {
  const m = body?.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, 'i')) ||
    body?.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, 'i'));
  return m ? m[1] : '';
}

function jsonOf(body, keys) {
  for (const k of keys) {
    const m = body?.match(new RegExp(`["']?${k}["']?\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'i'));
    if (m) return m[1].replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  return '';
}

/* ------------------------------------------------------------------ */
/* Plataformas: padrão de URL + detecção                              */
/* ------------------------------------------------------------------ */
/* detect(res, body, u) -> 'found' | 'possible' | 'not_found'          */
const PLATFORMS = [
  { id: 'github', name: 'GitHub', icon: 'github', color: '#ffffff',
    url: (u) => `https://github.com/${esc(u)}`, detect: (res) => (res.status === 404 ? 'not_found' : 'found') },
  { id: 'gitlab', name: 'GitLab', icon: 'gitlab', color: '#FC6D26',
    url: (u) => `https://gitlab.com/${esc(u)}`, detect: (res) => (res.status === 404 ? 'not_found' : 'found') },
  { id: 'bitbucket', name: 'Bitbucket', icon: 'bitbucket', color: '#2684FF',
    url: (u) => `https://bitbucket.org/${esc(u)}`, detect: (res) => (res.status === 404 ? 'not_found' : 'found') },
  { id: 'reddit', name: 'Reddit', icon: 'reddit', color: '#FF4500',
    url: (u) => `https://www.reddit.com/user/${esc(u)}`,
    detect: async (res, body) => {
      if (res.status === 404) return 'not_found';
      try { return JSON.parse(body).kind === 't2' ? 'found' : 'not_found'; } catch { return 'possible'; }
    } },
  { id: 'telegram', name: 'Telegram', icon: 'telegram', color: '#2AABEE',
    url: (u) => `https://t.me/${esc(u)}`,
    detect: (res, body) => (body && body.includes('tgme_page_title')) ? 'found' : (res.status === 404 ? 'not_found' : 'possible') },
  { id: 'steam', name: 'Steam', icon: 'steam', color: '#66c0f4',
    url: (u) => `https://steamcommunity.com/id/${esc(u)}`,
    detect: (res, body) => {
      if (body && body.includes('<steamID64>')) return 'found';
      if (body && body.includes('could not be found')) return 'not_found';
      return res.status === 404 ? 'not_found' : 'possible';
    } },
  { id: 'youtube', name: 'YouTube', icon: 'youtube', color: '#FF0000',
    url: (u) => `https://www.youtube.com/@${u}`,
    detect: (res, body) => (body && body.includes('channelMetadataRenderer')) ? 'found' : (res.status === 404 ? 'not_found' : 'possible') },
  { id: 'twitch', name: 'Twitch', icon: 'twitch', color: '#9146FF',
    url: (u) => `https://www.twitch.tv/${u}`,
    detect: (res, body) => {
      if (body && body.includes('displayName')) {
        const d = jsonOf(body, ['displayName']).toLowerCase();
        return d === u.toLowerCase() ? 'found' : (res.status === 404 ? 'not_found' : 'possible');
      }
      return res.status === 404 ? 'not_found' : 'possible';
    } },
  { id: 'tiktok', name: 'TikTok', icon: 'tiktok', color: '#69C9D0',
    url: (u) => `https://www.tiktok.com/@${u}`,
    detect: (res, body) => {
      if (body && jsonOf(body, ['uniqueId']).toLowerCase() === u.toLowerCase()) return 'found';
      if (res.status === 404) return 'not_found';
      return body && res.status === 200 ? 'possible' : 'not_found';
    } },
  { id: 'instagram', name: 'Instagram', icon: 'instagram', color: '#E4405F',
    url: (u) => `https://www.instagram.com/${u}/`,
    detect: (res, body) => {
      const low = (body || '').toLowerCase();
      if (low.includes('instagram.com/' + u.toLowerCase() + '/') && low.includes('og:description')) return 'found';
      return res.status === 404 ? 'not_found' : 'possible';
    } },
  { id: 'pinterest', name: 'Pinterest', icon: 'pinterest', color: '#E60023',
    url: (u) => `https://pinterest.com/${esc(u)}/`, detect: (res) => (res.status === 404 ? 'not_found' : 'found') },
  { id: 'behance', name: 'Behance', icon: 'behance', color: '#1769FF',
    url: (u) => `https://www.behance.net/${esc(u)}`, detect: (res) => (res.status === 404 ? 'not_found' : 'found') },
  { id: 'dribbble', name: 'Dribbble', icon: 'dribbble', color: '#EA4C89',
    url: (u) => `https://dribbble.com/${esc(u)}`, detect: (res) => (res.status === 404 ? 'not_found' : 'found') },
  { id: 'deviantart', name: 'DeviantArt', icon: 'deviantart', color: '#05CC47',
    url: (u) => `https://www.deviantart.com/${esc(u)}`, detect: (res) => (res.status === 404 ? 'not_found' : 'found') },
  { id: 'medium', name: 'Medium', icon: 'medium', color: '#ffffff',
    url: (u) => `https://medium.com/@${u}`, detect: (res) => (res.status === 404 ? 'not_found' : 'found') },
  { id: 'tumblr', name: 'Tumblr', icon: 'tumblr', color: '#36465D',
    url: (u) => `https://${u}.tumblr.com/`,
    detect: (res, body) => (body && body.toLowerCase().includes('there&#39;s nothing here')) ? 'not_found' : (res.status === 404 ? 'not_found' : 'found') },
  { id: 'blogspot', name: 'Blogspot', icon: 'blogger', color: '#F57D00',
    url: (u) => `https://${u}.blogspot.com/`,
    detect: (res, body) => (body && body.toLowerCase().includes('blog not found')) ? 'not_found' : (res.status === 404 ? 'not_found' : 'found') },
  { id: 'wordpress', name: 'WordPress', icon: 'wordpress', color: '#21759B',
    url: (u) => `https://${u}.wordpress.com/`, detect: (res) => (res.status === 404 ? 'not_found' : 'found') },
  { id: 'soundcloud', name: 'SoundCloud', icon: 'soundcloud', color: '#FF5500',
    url: (u) => `https://soundcloud.com/${esc(u)}`, detect: (res) => (res.status === 404 ? 'not_found' : 'found') },
  { id: 'bandcamp', name: 'Bandcamp', icon: 'bandcamp', color: '#1DA0C3',
    url: (u) => `https://${u}.bandcamp.com/`, detect: (res) => (res.status === 404 ? 'not_found' : 'found') },
  { id: 'keybase', name: 'Keybase', icon: 'keybase', color: '#33a0ff',
    url: (u) => `https://keybase.io/${esc(u)}`, detect: (res) => (res.status === 404 ? 'not_found' : 'found') },
  { id: 'codepen', name: 'CodePen', icon: 'codepen', color: '#ffffff',
    url: (u) => `https://codepen.io/${esc(u)}`, detect: (res) => (res.status === 404 ? 'not_found' : 'found') },
  { id: 'devto', name: 'Dev.to', icon: 'devto', color: '#0A0A0A',
    url: (u) => `https://dev.to/${esc(u)}`, detect: (res) => (res.status === 404 ? 'not_found' : 'found') },
  { id: 'npm', name: 'npm', icon: 'npm', color: '#CB3837',
    url: (u) => `https://www.npmjs.com/~${esc(u)}`, detect: (res) => (res.status === 404 ? 'not_found' : 'found') },
  { id: 'pypi', name: 'PyPI', icon: 'pypi', color: '#3775A9',
    url: (u) => `https://pypi.org/user/${esc(u)}/`, detect: (res) => (res.status === 404 ? 'not_found' : 'found') },
  { id: 'docker', name: 'Docker Hub', icon: 'docker', color: '#2496ED',
    url: (u) => `https://hub.docker.com/u/${esc(u)}`, detect: (res) => (res.status === 404 ? 'not_found' : 'found') },
  { id: 'patreon', name: 'Patreon', icon: 'patreon', color: '#FF424D',
    url: (u) => `https://www.patreon.com/${esc(u)}`, detect: (res) => (res.status === 404 ? 'not_found' : 'found') },
  { id: 'replit', name: 'Replit', icon: 'replit', color: '#F26207',
    url: (u) => `https://replit.com/@${esc(u)}`, detect: (res) => (res.status === 404 ? 'not_found' : 'found') },
  { id: 'spotify', name: 'Spotify', icon: 'spotify', color: '#1DB954',
    url: (u) => `https://open.spotify.com/user/${esc(u)}`, detect: (res) => (res.status === 404 ? 'not_found' : 'found') },
  { id: 'lastfm', name: 'Last.fm', icon: 'lastfm', color: '#D51007',
    url: (u) => `https://www.last.fm/user/${esc(u)}`, detect: (res) => (res.status === 404 ? 'not_found' : 'found') },
  { id: 'hn', name: 'Hacker News', icon: 'hn', color: '#FF6600',
    url: (u) => `https://news.ycombinator.com/user?id=${esc(u)}`, detect: (res) => (res.status === 200 || res.status === 302 ? 'found' : 'not_found') },
];

/* Facebook, X/Twitter e LinkedIn bloqueiam robô — mostramos como link de busca direta no próprio site */
const MANUAL = [
  { id: 'facebook', name: 'Facebook', url: (u) => `https://www.facebook.com/public/${esc(u)}` },
  { id: 'x', name: 'X / Twitter', url: (u) => `https://x.com/search?q=${esc(u)}&f=user` },
  { id: 'linkedin', name: 'LinkedIn', url: (u) => `https://www.linkedin.com/pub/dir/${esc(u)}` },
];

function baseResult(platform, u, status, url) {
  return {
    id: `${platform.id}:${u}`,
    platform: platform.name,
    username: u,
    displayName: u,
    score: status === 'found' ? 100 : status === 'possible' ? 60 : 0,
    status,
    httpStatus: null,
    url,
    exists: status === 'found' || status === 'possible',
    avatar: '',
    source: 'username-enum',
    timestamp: Date.now(),
    extra: {},
  };
}

/* ------------------------------------------------------------------ */
/* Enriquecedores (dados públicos por plataforma)                     */
/* ------------------------------------------------------------------ */
async function enrichGithub(res, body, u, r) {
  try {
    const api = await get(`https://api.github.com/users/${esc(u)}`, ENRICH_TIMEOUT);
    if (api.ok) {
      const d = await api.json();
      r.displayName = d.name || d.login || u;
      r.bio = d.bio || '';
      r.avatar = d.avatar_url || '';
      r.followers = String(d.followers ?? '');
      r.following = String(d.following ?? '');
      r.posts = String(d.public_repos ?? '');
      r.location = d.location || '';
      r.extra.criadoEm = d.created_at ? String(d.created_at).slice(0, 10) : '';
    }
  } catch {
    /* api indisponível */
  }
  return r;
}

function enrichReddit(res, body, u, r) {
  try {
    const d = JSON.parse(body);
    const sd = d.data?.subreddit;
    if (sd) {
      const data = d.data;
      r.displayName = sd.display_name || u;
      r.bio = stripHtml(sd.public_description || sd.description || '');
      r.avatar = (sd.icon_img && sd.icon_img.startsWith('http')) ? sd.icon_img.split('?')[0] : '';
      r.followers = String(sd.subscribers ?? '');
      r.extra.criadoEm = new Date(data.created_utc * 1000).toISOString().slice(0, 10);
      r.extra.karma = String(data.link_karma + data.comment_karma);
    }
  } catch {
    /* parse falhou */
  }
  return r;
}

function enrichTelegram(res, body, u, r) {
  const title = body?.match(/tgme_page_title[^>]*>([\s\S]*?)<\/div>/);
  const desc = body?.match(/tgme_page_description[^>]*>([\s\S]*?)<\/div>/);
  if (title) r.displayName = stripHtml(title[1]);
  r.bio = desc ? stripHtml(desc[1]) : '';
  const photos = body ? [...(body.match(/<img[^>]+src="([^"]+)"[^>]*class="tgme_page_photo_image/g) || []).map((m) => m.replace(/.*src="([^"]+)".*/, '$1'))] : [];
  if (photos.length) r.avatar = photos[0];
  else {
    const ogImage = og(body, 'image');
    if (ogImage) r.avatar = ogImage;
  }
  const isChannel = body && body.includes('tgme_page_extra') && body.includes('subscriber');
  if (isChannel) r.extra.tipo = 'canal';
  return r;
}

function enrichSteam(res, body, u, r) {
  const get = (tag) => body?.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1]?.trim?.() || '';
  const id = get('steamID64');
  if (id) {
    r.displayName = get('steamID') || u;
    r.avatar = get('avatarFull') || '';
    const real = get('realname');
    if (real) r.extra.nomeReal = real;
    const loc = get('location');
    if (loc) r.location = loc;
    r.extra.perfilVazio = body?.includes('<isEmpty>0</isEmpty>') ? 'com conteúdo' : '';
  }
  return r;
}

function enrichYoutube(res, body, u, r) {
  const md = body?.match(/"channelMetadataRenderer":\s*({[^]*?"title":[^]*?"description":[^]*?"avatar":\s*{[^]*?}})/);
  if (md) {
    const title = md[1].match(/"title":\s*"((?:\\\\.|[^"\\\\])*)"/);
    const desc = md[1].match(/"description":\s*"((?:\\\\.|[^"\\\\])*)"/);
    const img = body?.match(/"avatar":\s*{"thumbnails":\s*\[[^\]]*?"url":\s*"([^"]+)"/);
    r.displayName = title ? stripHtml(title[1]) : u;
    r.bio = desc ? desc[1].replace(/\\n/g, ' ') : '';
    if (img) r.avatar = img[1];
    const subs = body?.match(/subscriberCountText[^]*?"simpleText":"([^"]+)"/);
    if (subs) r.followers = subs[1];
    const videoCount = body?.match(/videoCountText[^]*?"simpleText":"([^"]+)"/);
    if (videoCount) r.posts = videoCount[1];
  }
  return r;
}

/* ------------------------------------------------------------------ */
/* Motor de enumeração                                                */
/* ------------------------------------------------------------------ */
async function enumUsername(u) {
  const clean = String(u || '').trim().replace(/^@/, '');
  if (!clean || clean.length < 3) throw new Error('Username muito curto. Use pelo menos 3 caracteres.');
  if (/[^\w.\-]/.test(clean)) throw new Error('Username inválido (use letras, números, ponto e traço).');

  const seen = new Map();
  const results = [];
  const tasks = [];

  for (const p of PLATFORMS) {
    if (seen.has(p.url(clean))) continue;
    seen.set(p.url(clean), true);
    tasks.push(
      (async () => {
        const url = p.url(clean);
        let res;
        try {
          res = await get(url);
          const body = await res.text();
          const status = typeof p.detect === 'function' ? await p.detect(res, body) : 'possible';
          if (status === 'not_found') return;
          const r = baseResult(p, clean, status, url);
          r.httpStatus = res.status;
          try {
            let out = r;
            if (p.id === 'github') out = await enrichGithub(res, body, clean, r);
            else if (p.id === 'reddit') out = enrichReddit(res, body, clean, r);
            else if (p.id === 'telegram') out = enrichTelegram(res, body, clean, r);
            else if (p.id === 'steam') out = enrichSteam(res, body, clean, r);
            else if (p.id === 'youtube') out = enrichYoutube(res, body, clean, r);
            results.push(out);
          } catch {
            results.push(r);
          }
        } catch {
          /* plataforma fora do ar / timeout — ignora */
        }
      })()
    );
  }

  for (const m of MANUAL) {
    const r = baseResult({ ...m, id: m.id }, clean, 'possible', m.url(clean));
    r.extra.nota = 'A rede bloqueia robôs — abra o link para confirmar no site original.';
    results.push(r);
  }

  await Promise.all(tasks);
  return { results: results.filter(Boolean), username: clean };
}

/* ------------------------------------------------------------------ */
/* Modo nome: links de busca no próprio site original                 */
/* ------------------------------------------------------------------ */
const NAME_SEARCH = [
  { id: 'google', name: 'Google', url: (q) => `https://www.google.com/search?q=${esc(q)}` },
  { id: 'bing', name: 'Bing', url: (q) => `https://www.bing.com/search?q=${esc(q)}` },
  { id: 'facebook', name: 'Facebook', url: (q) => `https://www.facebook.com/public/${esc(q)}` },
  { id: 'instagram', name: 'Instagram', url: (q) => `https://www.instagram.com/web/search/topsearch/?query=${esc(q)}` },
  { id: 'tiktok', name: 'TikTok', url: (q) => `https://www.tiktok.com/search/user?q=${esc(q)}` },
  { id: 'x', name: 'X / Twitter', url: (q) => `https://x.com/search?q=${esc(q)}&f=user` },
  { id: 'youtube', name: 'YouTube', url: (q) => `https://www.youtube.com/results?search_query=${esc(q)}` },
  { id: 'linkedin', name: 'LinkedIn', url: (q) => `https://www.linkedin.com/pub/dir/${esc(q)}` },
  { id: 'telegram', name: 'Telegram', url: (q) => `https://t.me/${esc(q.split(' ')[0])}` },
  { id: 'github', name: 'GitHub', url: (q) => `https://github.com/search?q=${esc(q)}&type=users` },
  { id: 'reddit', name: 'Reddit', url: (q) => `https://www.reddit.com/search/?q=${esc(q)}` },
];

function baseSearchLink(id, name, url, q, extra) {
  return {
    id: `${id}:${q}`,
    platform: name,
    username: q,
    displayName: q,
    score: 50,
    status: 'manual',
    httpStatus: null,
    url,
    exists: true,
    avatar: '',
    source: 'manual',
    timestamp: Date.now(),
    extra: { tipo: 'busca', ...(extra || {}) },
  };
}

async function searchName(q) {
  const results = NAME_SEARCH.map((s) => baseSearchLink(s.id, s.name, s.url(q), q));
  return { results, query: q };
}

/* ------------------------------------------------------------------ */
/* Modo email: gravatar + buscas                                      */
/* ------------------------------------------------------------------ */
async function searchEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw new Error('E-mail inválido.');
  const md5 = createHash('md5').update(e.trim()).digest('hex');
  const avatar = `https://www.gravatar.com/avatar/${md5}?s=200&d=identicon`;
  const results = [];
  try {
    const res = await get(`https://www.gravatar.com/avatar/${md5}?d=404`, 6000);
    if (res.status === 200) {
      results.push({
        id: `gravatar:${e}`, platform: 'Gravatar', username: e, displayName: e,
        score: 90, status: 'found', httpStatus: 200, url: `https://gravatar.com/${md5}`,
        exists: true, avatar, source: 'manual', timestamp: Date.now(),
        extra: { tipo: 'foto de perfil vinculada ao e-mail' },
      });
    }
  } catch {
    /* gravatar fora do ar */
  }
  const sites = [
    { id: 'google', name: 'Google', url: `https://www.google.com/search?q=${esc(e)}` },
    { id: 'hunter', name: 'E-mail hunter', url: `https://hunter.io/search/${esc(e.split('@')[1])}` },
    { id: 'github', name: 'GitHub', url: `https://github.com/search?q=${esc(e)}&type=commits` },
  ];
  for (const s of sites) results.push(baseSearchLink(s.id, s.name, s.url, e, { dominio: e.split('@')[1] }));
  return { results, email: e };
}

/* ------------------------------------------------------------------ */
/* Instala as rotas                                                   */
/* ------------------------------------------------------------------ */
export function installSearchOsint(ctx) {
  const { router, json, readBody, rateLimit, cfg, corsFor } = ctx;

  router.set('GET /api/search', async (request) => {
    return json({
      success: true,
      data: {
        service: 'localizar-pessoa',
        description: 'Busca username em ~40 plataformas (com detalhes públicos) ou monta buscas por nome/e-mail/telefone. Links abrem sempre o site original.',
        modes: ['username', 'name', 'email', 'phone'],
      },
    }, 200, corsFor(request));
  });

  const handle = async (mode, value, request, context) => {
    const rl = await rateLimit(`search:${context.ip}`, 10);
    if (!rl.ok) return json({ success: false, error: 'Muitas buscas. Aguarde um instante.' }, 429, corsFor(request));
    try {
      if (mode === 'phone') {
        const d = await runPhoneOsint(value);
        const card = {
          id: `phone:${d.phone}`,
          platform: 'Telefone',
          username: d.phone,
          displayName: d.country || 'Telefone',
          score: d.valid ? 80 : 30,
          status: d.valid ? (d.whatsapp ? 'found' : 'possible') : 'not_found',
          httpStatus: null,
          url: '',
          exists: d.valid,
          avatar: '',
          source: 'phone-osint',
          timestamp: Date.now(),
          extra: { carrier: d.carrier, country: d.country, whatsapp: d.whatsapp, lineType: d.lineType },
        };
        return json({ success: true, data: { mode: 'phone', results: [card] } }, 200, corsFor(request));
      }
      if (mode === 'username') {
        const data = await enumUsername(value);
        return json({ success: true, data: { mode: 'username', ...data } }, 200, corsFor(request));
      }
      if (mode === 'name') {
        const data = await searchName(value);
        return json({ success: true, data: { mode: 'name', ...data } }, 200, corsFor(request));
      }
      const data = await searchEmail(value);
      return json({ success: true, data: { mode: 'email', ...data } }, 200, corsFor(request));
    } catch (err) {
      return json({ success: false, error: err.message }, 400, corsFor(request));
    }
  };

  router.set('POST /api/search', async (request, context) => {
    const body = await readBody(request);
    const mode = (body?.type || body?.mode || 'username').toLowerCase();
    const value = body?.query ?? body?.search ?? body?.target ?? body?.email ?? body?.phone ?? '';
    if (!String(value).trim()) return json({ success: false, error: 'Informe o que deseja buscar.' }, 400, corsFor(request));
    return handle(mode, String(value).trim(), request, context);
  });

  router.set('POST /api/search/username', async (request, context) => {
    const body = await readBody(request);
    const value = body?.target ?? body?.username ?? body?.query ?? '';
    if (!String(value).trim()) return json({ success: false, error: 'Informe o username.' }, 400, corsFor(request));
    return handle('username', String(value).trim(), request, context);
  });

  router.set('POST /api/search/name', async (request, context) => {
    const body = await readBody(request);
    const value = body?.query ?? body?.name ?? body?.target ?? '';
    if (!String(value).trim()) return json({ success: false, error: 'Informe o nome.' }, 400, corsFor(request));
    return handle('name', String(value).trim(), request, context);
  });

  router.set('POST /api/search/email', async (request, context) => {
    const body = await readBody(request);
    const value = body?.email ?? body?.target ?? body?.query ?? '';
    if (!String(value).trim()) return json({ success: false, error: 'Informe o e-mail.' }, 400, corsFor(request));
    return handle('email', String(value).trim(), request, context);
  });

  router.set('POST /api/search/phone', async (request, context) => {
    const body = await readBody(request);
    const value = body?.phone ?? body?.target ?? body?.query ?? '';
    if (!String(value).trim()) return json({ success: false, error: 'Informe o telefone.' }, 400, corsFor(request));
    return handle('phone', String(value).trim(), request, context);
  });
}

export const SEARCH_METADATA = { USERNAME_PLATFORMS: PLATFORMS.length, NAME_SEARCH: NAME_SEARCH.length };