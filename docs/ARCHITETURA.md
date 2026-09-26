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
  compartilhada entre subdomínios do Sr. Amorim (AMORIM OSINT, Shandon Elite etc. no futuro).
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

**Obrigatórias em produção:**
- `PUBLIC_ORIGIN` (a origem da Central, ex.: `https://central.senhoramim.com.br`). Se
  ausente, o Origin check de todas as mutações bloqueia login/registro (fail-closed).
- `COOKIE_DOMAIN=.senhoramim.com.br` (sessão compartilhada entre subdomínios).
- `COOKIE_SECURE=true`.
- `ADMIN_EMAILS` (e-mails que recebem ADMIN ao se cadastrarem).

**Opcionais:** `GOOGLE_CLIENT_ID/SECRET`, `RESEND_API_KEY`/`MAIL_FROM`.

## Migrations (D1)

- Fonte única: as mesmas instruções em `migrations/0001_init.sql`, `schema.sql` e
  `SCHEMA_SQL` (`src/backend/app.js`). O Worker reaplica o schema idempotentemente
  (`CREATE TABLE IF NOT EXISTS`) no primeiro request — D1 novo "se auto-cura".
- Aplicação oficial no banco remoto:
  `wrangler d1 migrations apply central-amorim-db`

## Produção — runbook

### Pipeline canônico: GitHub Actions (`.github/workflows/deploy.yml`)
- Dispara em push para `main` e `workflow_dispatch`: `npm ci` → `npm run build` →
  `npx wrangler deploy`, com as credenciais vindas dos Secrets do repo
  `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` (nunca fixadas em arquivo).
- O `account_id` NÃO é fixado no `wrangler.toml`; vem exclusivamente do
  Secret/ambiente. NÃO colocar valor literal aqui (um valor com 31 hex — falta
  um caractere — faz a API retornar `7003`/`404` ("object identifier is invalid")).

### Para o dono da conta (única ação manual restrita ao dashboard Cloudflare)
1. Desativar o **Cloudflare Workers Builds** da Central (Workers → "central-amorim" →
   Builds → desativar). Sem isso, há DOIS pipelines publicando o mesmo Worker a cada
   push (GH Actions + Builds).
2. Garantir que o Secret `CLOUDFLARE_ACCOUNT_ID` do repo tenha o Account ID correto
   (32 hex). O caminho completo: `dash.cloudflare.com` → domínio/Conta → roda do
   Workers → id em "Account ID" (topo da página do Workers, ou na URL da conta).

### Passos manuais alternativos (máquina com wrangler)
- Autenticar: `wrangler login` (ou exportar `CLOUDFLARE_API_TOKEN` +
  `CLOUDFLARE_ACCOUNT_ID`).
- Aplicar migrations: `wrangler d1 migrations apply central-amorim-db`.
- Envs do Worker: `PUBLIC_ORIGIN`, `COOKIE_DOMAIN=;`, `ADMIN_EMAILS`, e os opcionais
  de Google/e-mail, via dashboard/wrangler (nunca no código).
- Deploy manual equivalente: `npm run build && npx wrangler deploy`.

## Testes

`npm test` roda o MESMO handler de produção (`createApp`) contra um shim de banco
`node:sqlite` (`scripts/local-db.js`), cobrindo o fluxo completo de conta,
planos e acesso. `wrangler dev` não roda no ambiente de desenvolvimento atual (Termux).

## Estado das integrações

- **Google OAuth**: implementado e ativado por env; sem credenciais fica desativado
  (`probe-google` → `enabled:false`, botão oculto) sem afetar e-mail/senha.
- **E-mail transacional (recuperação)**: implementado via Resend, ativado por env;
  sem `RESEND_API_KEY` o fluxo `forgot` responde o mesmo texto anti-enumeração e
  nenhum e-mail é enviado (pendência documentada).
- **SSO entre subdomínios**: ver `docs/SSO.md`. Requer CORS na Central para os origins
  dos projetos parceiros (não implementado) e DNS/HTTPS no domínio.