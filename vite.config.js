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
        planos: resolve(__dirname, 'planos.html'),
        'minha-conta': resolve(__dirname, 'minha-conta.html'),
        follow: resolve(__dirname, 'follow.html'),
        radar: resolve(__dirname, 'radar.html'),
        facebook: resolve(__dirname, 'facebook.html'),
        atividade: resolve(__dirname, 'atividade.html'),
        whatsapp: resolve(__dirname, 'whatsapp.html'),
        pix: resolve(__dirname, 'pix.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
  server: {
    host: true,
    port: 3000,
  },
});
