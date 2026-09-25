# Central Amorim — Sessão e SSO entre subdomínios

Análise da estratégia `Domain=.senhoramim.com.br` e como a identidade da conta
será validada pelos projetos **sem** implementar integração fictícia ainda.

## Estado atual (só Central)

- A sessão vive em `sessions` no D1 do Worker **central-amorim**.
- Token opaco (32 bytes) no cookie `sam_session`, `Path=/`, `HttpOnly`,
  `Secure`, `SameSite=Lax`, `Max-Age` 30 dias.
- `SameSite=Lax` **não bloqueia entre subdomínios**: subdomínios são o mesmo
  *site* (registrable domain). O navegador envia o cookie para
  `elite.senhoramim.com.br` e `osint.senhoramim.com.br` normalmente, desde que o
  cookie tenha `Domain=.senhoramim.com.br`.

## Como a Central valida a própria sessão

1. Request chega com `Cookie: sam_session=<token>`.
2. `GET /api/auth/me` → `getSession(db, token)` faz JOIN `sessions`+`users`,
   checa `expires_at >= now`, e devolve o usuário público (`publicMe`).
3. Nenhuma chave/assinatura está envolvida: a "veracidade" do token é um lookup
   em banco. Sessão inexistente/expirada → `401 authenticated:false`.
4. O logout apaga a linha em `sessions` (invalidação server-side imediata) e
   manda `Set-Cookie` de expiração.

## Como osint.senhoramim.com.br validará (futuro)

Arquitetura recomendada — **centralizada, sem chave compartilhada**:

1. `AMORIM OSINT` roda no mesmo site (`*.senhoramim.com.br`) → o navegador
   envia o mesmo `sam_session` junto, pois `Domain=.senhoramim.com.br`.
2. O Worker `amorim-osint` chama a Central para validar:
   `GET https://central.senhoramim.com.br/api/auth/me`
   com `credentials: 'include'` — para isso a Central precisa responder CORS
   para o origin `https://osint.senhoramim.com.br` com `Allow-Credentials`.
3. Para autorização (planos/limites), osint chama também
   `POST /api/access/check` com o projeto `amorim-osint`.

Componentes envolvidos: somente o D1 central + os dois Workers. **Não há
segredo compartilhado**: osint/elite nunca consultam `sessions` nem têm client
do banco — a Central é a única que lê o token.

Cursos seguros desta arquitetura:
- Token de sessão nunca sai do cookie para o JS (HttpOnly) → osint não pode
  roubá-lo via XSS e reutilizar.
- Mutações cross-origin devem passar pelo Origin check da Central (já existente
  em `createApp`); para o futuro, adicionar `osint.senhoramim.com.br` etc. à
  lista de origins permitidas quando houver mutação legítima saindo deles.
- Cookie `Secure` exige HTTPS em todos os subdomínios.

Ação futura necessária na Central (não feita agora): adicionar headers CORS
(`Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials: true`,
`Vary: Origin`) para os origins dos projetos parceiros. Sem isso, osint/elite
lerão `401` mesmo com cookie — falha segura.

## Como elite.senhoramim.com.br validará (futuro)

Idêntico ao osint: mesmo `Domain=.senhoramim.com.br`, `GET /api/auth/me`
cross-origin com `credentials: 'include'` + CORS configurado, e
`/api/access/check` retornando limites conforme o entitlement do usuário.

## Qual chave/secret precisaria ser compartilhada?

**Nenhuma**, na arquitetura escolhida: a autorização vive no D1 central e os
projetos consultam a Central via API. Isso é o motivo pelo qual NÃO usamos
JWT assinado com HS256 compartilhado entre os Workers (uma chave compartilhada
seria um segredo a proteger e um ponto de falha — dispensável aqui).

Únicas credenciais que existem permanecem fora do código: `CLOUDFLARE_API_TOKEN`
e `CLOUDFLARE_ACCOUNT_ID` (deploy, via GitHub Actions) e `ADMIN_EMAILS`/envs.

## Decisão

- Não implementar chamadas entre os projetos agora (fora de escopo, sem deploy).
- Guarda de exigência: CORS + `credentials: include` + cookies `Domain` serão
  validados **em produção** depois que o D1 estiver de pé e o domínio resolver.