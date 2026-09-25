# Central Amorim — Arquitetura

Estrutura real de plataforma (autenticação, conta gratuita, planos e controle de acesso)
sobre o site estático existente, preservando o layout atual.

## Visão geral

- **Frontend**: site estático (Vite 8, multi-page vanilla HTML/CSS/JS), servido por
  [assets] do Worker **central-amorim**.
- **Backend**: o MESMO Worker `central-amorim` ganha um `main` (`src/worker.js`) com
  rotas `http` para autenticação e controle de acesso.
- **Banco**: Cloudflare D1 (`schema.sql`) — usuários, sessões, tokens de recuperação,
  direitos de acesso (entitlements) e rate limits.

```
Navegador ── static ──> /, /planos, /minha-conta …
   │
   └── /api/... ──> Worker central-amorim ──> D1
```

## Decisões

- **Senha**: PBKDF2-SHA256 (Web Crypto), formato
  `pbkdf2_sha256$iteracoes$salt_hex$hash_hex`, comparação com timing-safe.
- **Sessão**: token opaco (32 bytes hex) em tabela `sessions`; cookie `sam_session`
  HttpOnly/Secure/SameSite=Lax com `Domain=.senhoramim.com.br` — identidade de conta
  compartilhada entre subdomínios do Senhor Amorim (AMORIM OSINT, Shandon Elite etc. no futuro).
- **Planos**: `FREE` (padrão ao criar conta), `PRO` (estrutura de expansão, sem cobrança
  nesta etapa), `ADMIN` (via `ADMIN_EMAILS`). Visitante = `GUEST_LIMITS` (demo).
- **Controle de acesso**: `POST /api/access/check` decide no servidor se um usuário
  (logado ou visitante) atinge determinados limites (ex.: categorias/ferramentas do
  AMORIM OSINT). A UI nunca decide sozinha.
- **Google OAuth** e **e-mail de recuperação** são opcionais e ativados por variáveis;
  se desativados, a interface continua funcional (senha e hash próprios), apenas oculta
  o botão "Continuar com Google" e informa opções de recuperação sem enumerar contas.
- **Segurança**: rate-limit (IP, 6/min) em login/registro, checagem de `Origin` em
  mutações, respostas uniformes no forgot-password (anti-enumeração), tokens únicos
  com expiração.

## Rotas da API

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/health` | Healthcheck + criação de schema sob demanda |
| POST | `/api/auth/register` | Cria conta (FREE; ADMIN se e-mail em `ADMIN_EMAILS`) |
| POST | `/api/auth/login` | Login e-mail/senha; grava `sam_session` |
| POST | `/api/auth/logout` | Invalida a sessão atual e apaga o cookie |
| GET | `/api/auth/me` | Usuário autenticado (ou `authenticated:false`) |
| POST | `/api/auth/forgot-password` | Dispara token de recuperação (envio se `RESEND_API_KEY`) |
| POST | `/api/auth/reset-password` | Define nova senha com token válido |
| POST | `/api/auth/probe-google` | Diz se o login Google está habilitado (sem expor segredos) |
| GET | `/api/auth/google/start` | Redireciona para o Google (401/501 se não configurado) |
| GET | `/api/auth/google/callback` | Troca código → token → sessão |
| GET | `/api/plans` | Catálogo público de planos |
| POST | `/api/access/check` | Verificação server-side de acesso/limites |
| GET | `/api/admin/users` | Lista usuários (somente ADMIN) |

## Páginas

`index`, `sobre`, `contato`, `creditos`, `legal`, `entrar`, `criar-conta`,
`recuperar-senha` (com modo `?token=`), `planos`, `minha-conta`.

## Variáveis de ambiente

Veja `.env.example`. Em produção via `wrangler secret put`/secrets do painel e variáveis
de ambiente do Worker. Deixar Google/e-mail vazios mantém o funcionamento básico.

## Testes

`npm test` roda o MESMO handler de produção (`createApp`) contra um shim de banco
`node:sqlite` (`scripts/local-db.js`), cobrindo o fluxo completo de conta,
planos e acesso. `wrangler dev` não roda no ambiente de desenvolvimento atual (Termux).