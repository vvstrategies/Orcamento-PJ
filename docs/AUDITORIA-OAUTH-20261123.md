# Auditoria OAuth da PJ — antes da alteração

Base examinada: commit 94963d6. Escopo exclusivo da PJ. Produção informada: https://app.pjhigienizacao.com.br.

## Evidências do código original

1. Calendar, Drive e Contacts criam state em `GoogleIntegration.connect`, `backend/google.js`. Ads em `IntegrationService.connect`, `backend/integration-service.js`.
2. Ambos usam `crypto.randomBytes(32).toString('base64url')` (256 bits), e PKCE S256 com verifier aleatório de 48 bytes.
3. O SHA-256 do state é salvo no SQLite `DATA_DIR/pj.sqlite`. Calendar/Drive/Contacts usam `oauth_states`; Ads/Meta usam `integration_oauth_states`.
4. TTL de ambos: 600000 ms (10 minutos).
5. O vínculo é `session_id`, comparado ao ID da sessão autenticada. O app tem um administrador com senha compartilhada, não contas individuais. Não há identidade de usuário individual a recuperar.
6. Não há Map, cookie nem storage do navegador como fonte de verdade do state. O navegador carrega apenas o state na navegação OAuth e o cookie da sessão do app.
7. O callback faz SELECT pelo hash do state recebido; Ads também filtra provider.
8. Valida existência, igualdade do ID da sessão e expiração. A autenticação das rotas /api ocorre antes do callback.
9. Ambos apagam o registro ANTES da troca do code, da validação das permissões e da persistência dos tokens. Falha intermediária deixa o retorno sem registro e impossibilita distingui-lo de state desconhecido.
10. Calendar e Drive compartilham autorização e tokens; Contacts acrescenta escopo. Ads compartilha helpers de renovação, mas usa outro armazenamento de state e tokens.
11. Ads executa DELETE por provider OU expiração ao iniciar: uma segunda autorização apaga a primeira, inclusive de outra sessão. Calendar/Drive/Contacts não fazem isso. Não há exclusão cruzada entre tabelas.
12. Node/Express com SQLite WAL, busy_timeout e transações BEGIN IMMEDIATE. Outro processo só funciona se abrir o MESMO arquivo persistente e usar a MESMA chave de criptografia. A arquitetura documentada exige volume persistente; não é Worker/serverless. A topologia real da Hostinger ainda não foi inspecionada. Um SQLite independente por réplica NÃO seria suficiente.
13. Produção usa cookie `__Host-pj`: HttpOnly=true, Secure=true, SameSite=Lax, Path=/, sem Domain (host-only), TTL 12h. Local usa pj_session sem Secure. Trocar domínio ou efetuar novo login muda a sessão e invalida autorizações em andamento. Não se deve ampliar Domain nem desativar essa verificação. Retorno GET de navegação principal é compatível com Lax; o envio real do cookie ainda não foi observado.

## Diagnóstico e limites

A mensagem exata enviada pelo usuário é produzida pelo callback `/api/integrations/:provider/callback`, em `backend/integration-routes.js`. O callback esperado para Calendar/Drive/Contacts é `/api/google/callback`. Direcionar uma autorização desses recursos para o callback de Ads causa consulta à tabela errada e reproduz o 403. Isso é hipótese forte para o incidente, ainda não confirmação da configuração remota.

A cópia local privada de configuração Hostinger ainda cita o domínio temporário; ela não comprova quais variáveis estão ativas em produção. O domínio novo responde 200 em /api/health. Nenhuma credencial, sessão ou configuração remota foi modificada durante a auditoria.

## Correção planejada

Armazenamento SQL comum de tentativas, hash do state, vínculo à sessão e ao administrador da instalação, integração/purpose, callback e cliente OAuth, PKCE protegido pelo cofre, TTL 20 minutos. Tentativas independentes; reserva atômica antes da troca; persistência de tokens e consumo em uma transação. Falhas ficam terminais e exigem nova autorização (não repetir code possivelmente utilizado). Registros antigos não serão apagados pela migração; autorizações iniciadas na versão antiga devem ser reiniciadas após a publicação.

Diagnóstico opcional e temporário somente com integration, stateCreated, stateFound, stateExpired, stateMatched, callbackHost e timestamp. Sem URLs completas, state, code, tokens ou segredos. Manter cookies atuais. Validar callback configurado antes do consentimento. Testar cada integração, dois consentimentos, concorrência, expiração, sessão errada, replay, erro de token, persistência e restart.

Referência: https://developers.google.com/identity/protocols/oauth2/web-server

## Causa confirmada após a auditoria

O usuário forneceu o retorno com pathname `/api/integrations/google-ads/callback` e escopos Calendar/Drive/openid/email (sem adwords). Isso confirma que o consentimento de Agenda/Drive estava chegando ao handler de anúncios, que consultava a tabela errada. Não reproduzimos state nem authorization code neste documento. O código anterior aceitava `GOOGLE_REDIRECT_URI` sem conferir o handler de destino.

## Implementação

- `backend/google.js` deriva `/api/google/callback` de `appOrigin`, fornecida por `createApp`. `server.js` também usa o caminho fixo. Um `GOOGLE_REDIRECT_URI` antigo apontando para Ads não volta a direcionar Agenda/Drive para aquele handler.
- `backend/oauth-state-store.js` centraliza os fluxos em `oauth_authorizations`, dentro de `DATA_DIR/pj.sqlite`. Não há fonte de verdade em memória. Tabelas antigas ficam preservadas, sem reutilizar autorizações antigas.
- State de 256 bits, hash SHA-256 no banco, PKCE S256; verifier criptografado AES-256-GCM pelo cofre existente. Vinculado ao administrador da instalação, sessão, integração, client ID e callback exato.
- TTL fixo de 20 minutos. Tentativas distintas permanecem válidas independentemente. A sessão continua tendo TTL de 12 horas.
- Transação BEGIN IMMEDIATE reserva pending → processing, com identificador da reserva. Não há reaproveitamento automático após crash durante troca, pois o code pode ter sido utilizado. Nesse caso é necessário iniciar outra autorização.
- Tokens e status consumed/consumed_at são salvos na mesma transação. Erros de troca/validação/gravação encerram a tentativa como failed, preservando a conexão anterior. Verifier é apagado após sucesso/falha. Limpeza remove registros expirados há mais de 24h ao iniciar outro consentimento.
- Cookies mantidos sem mudanças. Sessão ausente, trocada ou de outro domínio não autoriza o callback. Usuário deve iniciar no domínio canônico.
- Callback válido retorna para Configurações > Integrações. Ads mantém a escolha explícita da conta acessível antes de indicar Conectada; autorizar OAuth não seleciona uma conta de anúncios arbitrária.
- `OAUTH_DIAGNOSTICS=1` habilita somente os sete campos solicitados; padrão 0. Remover/desativar após diagnóstico. Nenhuma query ou credencial é registrada pelo novo diagnóstico.

## Configuração de produção

```
APP_ORIGIN=https://app.pjhigienizacao.com.br
GOOGLE_REDIRECT_URI=https://app.pjhigienizacao.com.br/api/google/callback
DATA_DIR=/home/u564490911/pj-orcamentos-data
NODE_ENV=production
OAUTH_DIAGNOSTICS=0
```

GOOGLE_REDIRECT_URI é mantida aqui para orientar operadores e evitar confusão; o fluxo agora deriva o caminho do APP_ORIGIN. No Google Cloud, cadastrar separadamente:

- Calendar/Drive/Contacts: https://app.pjhigienizacao.com.br/api/google/callback
- Ads: https://app.pjhigienizacao.com.br/api/integrations/google-ads/callback

Manter a chave GOOGLE_TOKEN_ENCRYPTION_KEY atual. O caminho DATA_DIR acima é o da configuração local de implantação; deve ser conferido na Hostinger antes de qualquer mudança do volume. Nunca criar um banco novo para contornar o erro. Processos concorrentes devem compartilhar o mesmo SQLite em disco local persistente. Workers/serverless e réplicas com discos separados precisam de um banco central com as mesmas garantias transacionais; esta correção não faz SQLite virar um banco distribuído.

## Testes e validação real

`scripts/check-oauth-state.mjs` usa endpoints HTTP reais do Express e respostas simuladas do Google. Testa Calendar, Drive, Contacts e Ads separadamente; callback canônico apesar da configuração incorreta; callback de outra integração rejeitado sem consumir state; sessão ausente/errada; expiração; duas autorizações válidas; PKCE; replay; reserva concorrente entre conexões SQLite; conclusão por outro processo Node; restart com state pendente; tokens/conexões persistentes após restart; rollback atômico em falha de persistência; preservação de tokens em erro; atributos de cookie e allowlist exata dos logs.

Testes reais de consentimento no Google e inspeção da topologia/cookies na Hostinger são uma etapa separada. Não inferir sucesso desses testes a partir dos mocks. Após deploy, iniciar novo consentimento no domínio canônico, confirmar as permissões, verificar Conectada, recarregar e reiniciar backend com o mesmo DATA_DIR. Para Ads, escolher a conta acessível. Não abrir nem reaproveitar URLs de callback antigas.
