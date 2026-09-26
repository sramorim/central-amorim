export const projects = [
  {
    id: 'amorim-follow',
    name: 'AMORIM FOLLOW',
    description:
      'Descubra quem não te segue de volta no Instagram. Importe seus próprios dados oficiais e compare no navegador — sem enviar nada a servidores.',
    category: 'Instagram & Redes',
    status: 'published',
    statusLabel: 'Publicado',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6 11 4.6a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    subdomain: 'senhoramorim.com.br/follow',
    url: '/follow',
    urlLabel: 'Abrir Ferramenta',
    buttonStyle: 'primary',
  },
  {
    id: 'ig-radar',
    name: 'IG RADAR',
    description:
      'Veja quem parou de te seguir, quem chegou novo e quem não te segue de volta no Instagram. Seus dados, processados no seu dispositivo.',
    category: 'Instagram & Redes',
    status: 'published',
    statusLabel: 'Publicado',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    subdomain: 'senhoramorim.com.br/radar',
    url: '/radar',
    urlLabel: 'Abrir Ferramenta',
    buttonStyle: 'primary',
  },
  {
    id: 'amorim-osint',
    name: 'AMORIM OSINT',
    description:
      'Pesquisa e análise de informações públicas na internet. Recursos e ferramentas para investigação em fontes abertas.',
    category: 'Pesquisa & Análise',
    status: 'published',
    statusLabel: 'Publicado',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none"/></svg>',
    subdomain: 'osint.senhoramorim.com.br',
    url: 'https://osint.senhoramorim.com.br',
    urlLabel: 'Acessar Projeto',
    buttonStyle: 'primary',
  },
  {
    id: 'shandon-elite',
    name: 'SHANDON ELITE',
    description:
      'Projeto em evolução. Em breve mais informações sobre funcionalidades e recursos.',
    category: 'Projeto',
    status: 'coming-soon',
    statusLabel: 'Em breve',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H13L13 2z"/></svg>',
    subdomain: 'elite.senhoramorim.com.br',
    url: 'https://elite.senhoramorim.com.br',
    urlLabel: 'Conhecer Projeto',
    buttonStyle: 'secondary',
  },
];

export const socialLinks = [
  {
    name: 'Instagram',
    // TODO(substituir apenas quando houver): URL oficial/pessoal do Instagram do Senhor Amorim
    url: 'https://instagram.com/',
    icon: 'instagram',
    label: 'Siga no Instagram',
    color: 'instagram',
    updatedAt: '2026-09-25',
  },
  {
    name: 'WhatsApp',
    // Canal reservado para o número exclusivo do WhatsApp Business da Central (a definir).
    url: 'https://wa.me/',
    icon: 'whatsapp',
    label: 'Fale pelo WhatsApp',
    color: 'whatsapp',
    updatedAt: '2026-09-25',
  },
];

export const siteConfig = {
  brand: 'SENHOR AMORIM',
  platform: 'CENTRAL AMORIM',
  copyright: '© 2026 Senhor Amorim — Daniel Amorim',
};
