export const categories = [
  { id: 'projetos', label: 'Projetos', hint: 'Ecossistema Senhor Amorim' },
];

const iconPresence = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="presence-g" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#ff7a18"/><stop offset=".45" stop-color="#e94057"/><stop offset="1" stop-color="#8a2be2"/></linearGradient></defs><rect x="5" y="5" width="54" height="54" rx="15" fill="url(#presence-g)"/><rect x="17" y="17" width="25" height="25" rx="8" fill="none" stroke="#fff" stroke-width="3"/><circle cx="29.5" cy="29.5" r="6" fill="none" stroke="#fff" stroke-width="3"/><circle cx="38.5" cy="21.5" r="2.2" fill="#fff"/><circle cx="44" cy="44" r="8" fill="#101114" stroke="#fff" stroke-width="2.4"/><path d="m50 50 6 6" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/></svg>`;
const iconArgos = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="argos-g" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#ff1e2d"/><stop offset="1" stop-color="#ff5b65"/></linearGradient></defs><path d="M32 5 55 51H9L32 5Z" fill="#08090c" stroke="url(#argos-g)" stroke-width="4"/><path d="M20 43 32 17l12 26" fill="none" stroke="url(#argos-g)" stroke-width="3"/><ellipse cx="32" cy="33" rx="10" ry="6" fill="#08090c" stroke="#fff" stroke-width="2"/><circle cx="32" cy="33" r="2.5" fill="#ff2635"/></svg>`;
const iconOsint = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="28" cy="28" r="21" fill="#071018" stroke="#69d5ff" stroke-width="3"/><path d="M8 28h40M28 7c6 6 9 13 9 21s-3 15-9 21M28 7c-6 6-9 13-9 21s3 15 9 21" fill="none" stroke="#69d5ff" stroke-width="2"/><path d="M43 43 57 57" stroke="#fff" stroke-width="5" stroke-linecap="round"/><circle cx="43" cy="43" r="8" fill="#071018" stroke="#fff" stroke-width="3"/></svg>`;
const iconShadow = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="shadow-g" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#8d24ff"/><stop offset="1" stop-color="#d36cff"/></linearGradient></defs><path d="M8 52c2-14 9-24 24-29 15 5 22 15 24 29H8Z" fill="#09060f" stroke="url(#shadow-g)" stroke-width="2.5"/><path d="M16 28c2-12 8-19 16-22 8 3 14 10 16 22l-8-5-8 7-8-7-8 5Z" fill="url(#shadow-g)" opacity=".92"/><path d="M23 31c2-4 5-6 9-6s7 2 9 6c-3 4-15 4-18 0Z" fill="#07050b"/><path d="M26 31h4m4 0h4" stroke="#b95cff" stroke-width="2.5" stroke-linecap="round"/></svg>`;

export const projects = [
  { id:'presence-insights', name:'PRESENCE INSIGHTS', summary:'Instagram em foco.', description:'Presença, seguidores, interações e sinais de atividade em um só lugar.', category:'Instagram', group:'projetos', platforms:['instagram'], status:'published', statusLabel:'Projeto', featured:false, icon:iconPresence, url:'https://presence-observer-ai.lovable.app', urlLabel:'Conhecer', buttonStyle:'primary' },
  { id:'argos', name:'ARGOS', summary:'Inteligência social.', description:'Coleta, análise, conexões e investigação de fontes abertas.', category:'Inteligência', group:'projetos', platforms:['multiplas'], status:'published', statusLabel:'Projeto', icon:iconArgos, url:'https://argus.senhoramorim.com.br', urlLabel:'Conhecer', buttonStyle:'primary' },
  { id:'amorim-osint', name:'AMORIM OSINT', summary:'Pesquisa e investigação.', description:'Fontes públicas, ferramentas e caminhos para investigação digital.', category:'OSINT', group:'projetos', platforms:['multiplas'], status:'published', statusLabel:'Projeto', icon:iconOsint, subdomain:'osint.senhoramorim.com.br', url:'https://osint.senhoramorim.com.br', urlLabel:'Acessar', buttonStyle:'primary' },
  { id:'shandon-elite', name:'SHADOW ELITE', summary:'Segurança e análise avançada.', description:'Cibersegurança, testes e ferramentas para ambientes avançados.', category:'Segurança', group:'projetos', platforms:['multiplas'], status:'published', statusLabel:'Projeto', featured:true, icon:iconShadow, subdomain:'elite.senhoramorim.com.br', url:'https://elite.senhoramorim.com.br', urlLabel:'Acessar', buttonStyle:'primary' },
];

export const socialLinks = [
  { name:'Instagram', url:'https://instagram.com/sr__amorim', icon:'instagram', label:'Instagram', color:'instagram' },
  { name:'Facebook', url:'https://www.facebook.com/', icon:'facebook', label:'Facebook', color:'facebook' },
  { name:'X', url:'https://x.com/', icon:'x', label:'X', color:'x' },
  { name:'Telegram', url:'https://t.me/', icon:'telegram', label:'Telegram', color:'telegram' },
  { name:'WhatsApp', url:'https://wa.me/554797876098', icon:'whatsapp', label:'WhatsApp', color:'whatsapp' },
];

export const siteConfig = {
  brand: 'SENHOR AMORIM',
  platform: 'CENTRAL AMORIM',
  copyright: '© 2026 Senhor Amorim — Daniel A. Amorim',
};
