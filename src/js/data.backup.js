/* Taxonomia do catálogo. Antes cada card trazia uma categoria solta e
   genérica ("Plataforma Principal", "Pesquisa & Análise"), o que gerava chips
   confusos e não separava Instagram de Facebook. Agora a ordem e o rótulo
   vivem num lugar só, e cada projeto declara em qual grupo aparece e em quais
   plataformas ele atua (usado na busca e nos filtros). */
export const categories = [
  { id: 'plataformas', label: 'Plataformas', hint: 'Os dois projetos completos' },
  { id: 'instagram', label: 'Instagram', hint: 'Quem segue, evolucao e posts' },
  { id: 'facebook', label: 'Facebook', hint: 'Amigos e reciprocidade' },
  { id: 'whatsapp', label: 'WhatsApp', hint: 'Grupos e mensagens' },
];

export const platformLabels = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
  multiplas: 'Multiplatas',
};

export const projects = [
  {
    id: 'shandon-elite',
    name: 'SHANDON ELITE',
    summary: 'Investigação completa por username, telefone, e-mail e redes sociais.',
    description:
      'A plataforma principal. OSINT profissional: buscas por username, e-mail, telefone, redes sociais, snapshots e radar de presença do Instagram — poderoso e direto no navegador.',
    category: 'Plataformas',
    group: 'plataformas',
    platforms: ['instagram', 'whatsapp', 'multiplas'],
    status: 'published',
    statusLabel: 'Publicado',
    featured: true,
    icon: '<svg width="38" height="38" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="sg-shandon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1424"/><stop offset="1" stop-color="#223554"/></linearGradient><linearGradient id="sg-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f5d67a"/><stop offset="1" stop-color="#a87b2b"/></linearGradient></defs><rect x="2" y="2" width="36" height="36" rx="10.5" fill="url(#sg-shandon)" stroke="url(#sg-gold)" stroke-width="1.6"/><g stroke="url(#sg-gold)" stroke-width="1.9" fill="none" stroke-linecap="round"><circle cx="20" cy="20" r="8.6"/><circle cx="20" cy="20" r="3.2"/><path d="M20 8.2v3.6M20 28.2v3.6M8.2 20h3.6M28.2 20h3.6"/></g><circle cx="20" cy="20" r="1.2" fill="url(#sg-gold)" stroke="none"/></svg>',
    subdomain: 'elite.senhoramorim.com.br',
    url: 'https://elite.senhoramorim.com.br',
    urlLabel: 'Abrir Plataforma',
    buttonStyle: 'primary',
  },
  {
    id: 'amorim-osint',
    name: 'AMORIM OSINT',
    summary: 'Árvore com mais de 1.100 ferramentas de investigação já organizadas.',
    description:
      'Árvore interativa com mais de 1.100 ferramentas de investigação e inteligência. Busque por nome, categoria ou descrição e descubra a ferramenta certa para cada necessidade.',
    category: 'Plataformas',
    group: 'plataformas',
    platforms: ['multiplas'],
    status: 'published',
    statusLabel: 'Publicado',
    icon: '<svg width="38" height="38" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="sg-osint" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0d9488"/><stop offset="1" stop-color="#0891b2"/></linearGradient></defs><rect x="2" y="2" width="36" height="36" rx="10.5" fill="url(#sg-osint)"/><g stroke="#fff" stroke-width="1.9" fill="none" stroke-linecap="round"><circle cx="16" cy="16" r="6.2"/><line x1="20.7" y1="20.7" x2="27" y2="27"/></g><circle cx="28" cy="12.5" r="2.4" fill="#fff" stroke="none"/><circle cx="10.5" cy="26.5" r="2.4" fill="#fff" stroke="none"/></svg>',
    subdomain: 'osint.senhoramorim.com.br',
    url: 'https://osint.senhoramorim.com.br',
    urlLabel: 'Acessar Projeto',
    buttonStyle: 'primary',
  },
  {
    id: 'amorim-follow',
    name: 'AMORIM FOLLOW',
    summary: 'Quem não te segue de volta no Instagram.',
    description:
      'Cruza a lista de seguidores que o próprio Instagram te dá e mostra quem não te segue de volta. Uma lista só, resultado na hora, tudo processado no seu aparelho — nada é enviado para servidores.',
    category: 'Instagram',
    group: 'instagram',
    platforms: ['instagram'],
    status: 'published',
    statusLabel: 'Publicado',
    icon: '<svg width="38" height="38" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="sg-follow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ec4899"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs><rect x="2" y="2" width="36" height="36" rx="10.5" fill="url(#sg-follow)"/><path d="M20 27.2s-7.4-4.4-7.4-9.5c0-2.2 1.7-3.9 3.8-3.9 1.5 0 2.8.8 3.6 2 .8-1.2 2.1-2 3.6-2 2.1 0 3.8 1.7 3.8 3.9 0 5.1-7.4 9.5-7.4 9.5z" fill="#fff"/></svg>',
    subdomain: 'senhoramorim.com.br/follow',
    url: '/follow',
    urlLabel: 'Abrir Ferramenta',
    buttonStyle: 'primary',
  },
  {
    id: 'ig-radar',
    name: 'IG RADAR',
    summary: 'Quem parou de seguir, quem chegou e quem nunca devolveu o follow.',
    description:
      'Compara duas listas suas de momentos diferentes e revela quem parou de te seguir, quem chegou agora e quem nunca te devolveu o follow. É a ferramenta para acompanhar a evolução da sua audiência ao longo das semanas.',
    category: 'Instagram',
    group: 'instagram',
    platforms: ['instagram'],
    status: 'published',
    statusLabel: 'Publicado',
    icon: '<svg width="38" height="38" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="sg-radar" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#06b6d4"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs><rect x="2" y="2" width="36" height="36" rx="10.5" fill="url(#sg-radar)"/><g stroke="#fff" stroke-width="1.9" fill="none" stroke-linecap="round"><circle cx="20" cy="20" r="8.8"/><circle cx="20" cy="20" r="4.2"/></g><path d="M20 20l7.8-6.4a8.8 8.8 0 0 0-7.8-4.4v10.8z" fill="#fff" stroke="none" opacity="0.9"/><circle cx="20" cy="20" r="1.2" fill="#fff" stroke="none"/></svg>',
    subdomain: 'senhoramorim.com.br/radar',
    url: '/radar',
    urlLabel: 'Abrir Ferramenta',
    buttonStyle: 'primary',
  },
  {
    id: 'sonda',
    name: 'SONDA',
    summary: 'Quem não te segue de volta + a sua lista de amigos do Facebook.',
    description:
      'Reúne em um só lugar quem não te segue de volta no Instagram e a sua lista de amigos do Facebook. Use quando quiser conferir as duas redes de uma vez, sempre com os arquivos que você mesmo exporta.',
    category: 'Facebook',
    group: 'facebook',
    platforms: ['facebook', 'instagram'],
    status: 'published',
    statusLabel: 'Publicado',
    icon: '<svg width="38" height="38" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="sg-sonda" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e8bff"/><stop offset="1" stop-color="#0b53c2"/></linearGradient></defs><rect x="2" y="2" width="36" height="36" rx="10.5" fill="url(#sg-sonda)"/><g stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"><line x1="20" y1="20" x2="20" y2="11.5"/><line x1="20" y1="20" x2="29" y2="22"/><line x1="20" y1="20" x2="12" y2="27"/><line x1="20" y1="20" x2="11" y2="16.5"/></g><circle cx="20" cy="20" r="2.6" fill="#fff" stroke="none"/><circle cx="20" cy="11.5" r="2" fill="#fff" stroke="none"/><circle cx="29" cy="22" r="2" fill="#fff" stroke="none"/><circle cx="12" cy="27" r="2" fill="#fff" stroke="none"/><circle cx="11" cy="16.5" r="2" fill="#fff" stroke="none"/></svg>',
    subdomain: 'senhoramorim.com.br/sonda',
    url: '/sonda',
    urlLabel: 'Abrir Ferramenta',
    buttonStyle: 'primary',
  },
  {
    id: 'panorama',
    name: 'PANORAMA',
    summary: 'Calendário e estatísticas de tudo que você publicou no Instagram.',
    description:
      'Seus posts do Instagram viram estatísticas: calendário de postagens, dias e horários mais ativos, fotos, vídeos e média mensal — com os seus próprios dados, 100% offline.',
    category: 'Instagram',
    group: 'instagram',
    platforms: ['instagram'],
    status: 'published',
    statusLabel: 'Publicado',
    icon: '<svg width="38" height="38" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="sg-panorama" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#833ab4"/><stop offset="0.55" stop-color="#e1306c"/><stop offset="1" stop-color="#f77737"/></linearGradient></defs><rect x="2" y="2" width="36" height="36" rx="10.5" fill="url(#sg-panorama)"/><g fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="13" width="22" height="14" rx="3.5"/><circle cx="14.6" cy="18" r="1.5"/><path d="M12.5 27l4.2-4.9 3.1 3.3 2-2.2 5.7 3.8"/></g></svg>',
    subdomain: 'senhoramorim.com.br/panorama',
    url: '/panorama',
    urlLabel: 'Abrir Ferramenta',
    buttonStyle: 'primary',
  },
  {
    id: 'sentinela',
    name: 'SENTINELA',
    summary: 'Participantes, palavras e calendário dos seus grupos do WhatsApp.',
    description:
      'Análise de grupos do WhatsApp: extrai os participantes (nome e telefone quando visíveis), quem mais fala, palavras e emojis mais usados e calendário de mensagens. Tudo offline.',
    category: 'WhatsApp',
    group: 'whatsapp',
    platforms: ['whatsapp'],
    status: 'published',
    statusLabel: 'Publicado',
    icon: '<svg width="38" height="38" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="sg-sentinela" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2bd467"/><stop offset="1" stop-color="#0f8f70"/></linearGradient></defs><rect x="2" y="2" width="36" height="36" rx="10.5" fill="url(#sg-sentinela)"/><g fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 9.5c-5.6 0-10.2 4-10.2 9 0 2.8 1.5 5.3 3.8 6.9l-.6 3.4 3.8-1.4c1 .3 2.1.5 3.2.5 5.6 0 10.2-4 10.2-9s-4.6-9.4-10.2-9.4z"/></g><g stroke="#fff" stroke-width="1.7" stroke-linecap="round"><line x1="16" y1="16" x2="16" y2="20.5"/><line x1="19.2" y1="14.5" x2="19.2" y2="22"/><line x1="22.4" y1="16.5" x2="22.4" y2="19.5"/></g></svg>',
    subdomain: 'senhoramorim.com.br/sentinela',
    url: '/sentinela',
    urlLabel: 'Abrir Ferramenta',
    buttonStyle: 'primary',
  },
];

export const socialLinks = [
  {
    name: 'Instagram',
    // Perfil oficial do Sr. Amorim.
    url: 'https://instagram.com/sr__amorim',
    icon: 'instagram',
    label: 'Siga no Instagram',
    color: 'instagram',
    updatedAt: '2026-09-27',
  },
  {
    name: 'WhatsApp',
    // Numero do WhatsApp Business que recebe os comprovantes (mesmo do WA_NUMBER
    // do Worker). Antes apontava para https://wa.me/ sem numero — link morto.
    url: 'https://wa.me/5547991669122',
    icon: 'whatsapp',
    label: 'Fale pelo WhatsApp',
    color: 'whatsapp',
    updatedAt: '2026-09-25',
  },
];

export const siteConfig = {
  brand: 'SR. AMORIM',
  platform: 'CENTRAL AMORIM',
  copyright: '© 2026 Sr. Amorim — Daniel Amorim',
};
