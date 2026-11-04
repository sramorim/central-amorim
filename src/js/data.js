export const categories = [
  { id: 'projetos', label: 'Projetos', hint: 'Ecossistema Senhor Amorim' },
];

export const platformLabels = {
  instagram: 'Instagram',
  multiplas: 'Múltiplas plataformas',
};

const iconPresence = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="presence-g" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#feda75"/><stop offset=".4" stop-color="#fa7e1e"/><stop offset=".65" stop-color="#d62976"/><stop offset="1" stop-color="#962fbf"/></linearGradient></defs><rect x="6" y="6" width="38" height="38" rx="12" fill="none" stroke="url(#presence-g)" stroke-width="4"/><circle cx="25" cy="25" r="9" fill="none" stroke="url(#presence-g)" stroke-width="4"/><circle cx="39" cy="14" r="2.6" fill="#fff"/><circle cx="42" cy="42" r="9" fill="#0a0a0a" stroke="#fff" stroke-width="3"/><path d="m48.5 48.5 7 7" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/></svg>`;
const iconArgos = `<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="#fff" stroke-width="3.4"><circle cx="14" cy="32" r="6"/><circle cx="34" cy="14" r="6"/><circle cx="34" cy="50" r="6"/><path d="M19 28 29 19M19 36l10 9"/></g><g fill="none" stroke="#ef1d2d" stroke-width="3.4"><circle cx="50" cy="32" r="7"/><circle cx="50" cy="32" r="2.6" fill="#ef1d2d" stroke="none"/></g></svg>`;
const iconOsint = `<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="#e8e8e8" stroke-width="3.2"><circle cx="26" cy="26" r="18"/><circle cx="26" cy="26" r="11"/><circle cx="26" cy="26" r="4" fill="#ef1d2d" stroke="#ef1d2d"/></g><path d="m38 38 12 12" stroke="#f5c1c5" stroke-width="6" stroke-linecap="round"/><path d="m40 40 11 11" stroke="#ef9aa1" stroke-width="3" stroke-linecap="round"/></svg>`;
const iconShadow = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="shadow-g" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#8a8a8a"/><stop offset=".6" stop-color="#e8e8e8"/><stop offset="1" stop-color="#ef1d2d"/></linearGradient></defs><rect x="5" y="5" width="54" height="54" rx="14" fill="none" stroke="url(#shadow-g)" stroke-width="4"/><text x="32" y="42" text-anchor="middle" font-family="monospace" font-weight="bold" font-size="24"><tspan fill="#fff">&lt;/</tspan><tspan fill="#ef1d2d">&gt;</tspan></text></svg>`;

export const projects = [
  { id:'shandon-elite', name:'SHADOW ELITE', summary:'Cibersegurança, análise técnica e testes autorizados.', description:'Cibersegurança, testes e ferramentas para ambientes avançados.', category:'Segurança', group:'projetos', platforms:['multiplas'], status:'published', statusLabel:'Projeto', featured:false, icon:iconShadow, subdomain:'elite.senhoramorim.com.br', url:'https://elite.senhoramorim.com.br', urlLabel:'Acessar', buttonStyle:'primary' },
  { id:'amorim-osint', name:'AMORIM OSINT', summary:'Investigação digital, fontes abertas e inteligência.', description:'Fontes públicas, ferramentas e caminhos para investigação digital.', category:'OSINT', group:'projetos', platforms:['multiplas'], status:'published', statusLabel:'Projeto', icon:iconOsint, subdomain:'osint.senhoramorim.com.br', url:'https://osint.senhoramorim.com.br', urlLabel:'Acessar', buttonStyle:'primary' },
  { id:'argos', name:'ARGOS', summary:'Inteligência e análise de múltiplas redes sociais.', description:'Coleta, análise, conexões e investigação de fontes abertas.', category:'Inteligência', group:'projetos', platforms:['multiplas'], status:'published', statusLabel:'Projeto', icon:iconArgos, url:'https://argus.senhoramorim.com.br', urlLabel:'Conhecer', buttonStyle:'primary' },
  { id:'presence-insights', name:'PRESENÇA INSIGHTS', summary:'Análise e monitoramento de presença no Instagram.', description:'Presença, seguidores, interações e sinais de atividade em um só lugar.', category:'Instagram', group:'projetos', platforms:['instagram'], status:'published', statusLabel:'Projeto', featured:false, icon:iconPresence, url:'https://presence-observer-ai.lovable.app', urlLabel:'Conhecer', buttonStyle:'primary' },
];

export const socialLinks = [
  { name:'Instagram', url:'https://www.instagram.com/sr__amorim', icon:'instagram', label:'Instagram', color:'instagram' },
  { name:'Facebook', url:'https://www.facebook.com/Central.Amorim', icon:'facebook', label:'Facebook', color:'facebook' },
  { name:'X', url:'https://x.com/', icon:'x', label:'X', color:'x' },
  { name:'Telegram', url:'https://t.me/Sr_amorim', icon:'telegram', label:'Telegram', color:'telegram' },
  { name:'WhatsApp', url:'https://wa.me/5547991669122', icon:'whatsapp', label:'WhatsApp', color:'whatsapp' },
];

export const siteConfig = {
  brand: 'SENHOR AMORIM',
  platform: 'CENTRAL AMORIM',
  copyright: '© 2026 Senhor Amorim — Daniel A. Amorim',
};
