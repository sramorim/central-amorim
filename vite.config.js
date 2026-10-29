import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: '.',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        creditos: resolve(__dirname, 'creditos.html'),
        sobre: resolve(__dirname, 'sobre.html'),
        contato: resolve(__dirname, 'contato.html'),
        legal: resolve(__dirname, 'legal.html'),
        entrar: resolve(__dirname, 'entrar.html'),
        'criar-conta': resolve(__dirname, 'criar-conta.html'),
        'recuperar-senha': resolve(__dirname, 'recuperar-senha.html'),
        'minha-conta': resolve(__dirname, 'minha-conta.html'),
        ferramentas: resolve(__dirname, 'ferramentas.html'),
        follow: resolve(__dirname, 'follow.html'),
        radar: resolve(__dirname, 'radar.html'),
        sonda: resolve(__dirname, 'sonda.html'),
        facebook: resolve(__dirname, 'sonda.html'),
        panorama: resolve(__dirname, 'panorama.html'),
        atividade: resolve(__dirname, 'panorama.html'),
        sentinela: resolve(__dirname, 'sentinela.html'),
        whatsapp: resolve(__dirname, 'sentinela.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
  server: {
    host: true,
    port: 3000,
  },
});
