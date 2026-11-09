# Configuração da PJ

## Google

As credenciais fornecidas ficam somente no `.env` local, fora do repositório. O cliente OAuth foi preparado para Calendar/Drive e Google Ads.

URIs locais exatas para cadastrar no Google Cloud:

- `http://localhost:3311/api/google/callback` — Calendar e Drive.
- `http://localhost:3311/api/integrations/google-ads/callback` — Google Ads.
- Origem JavaScript, se utilizada: `http://localhost:3311`.

Após definir o domínio HTTPS, substitua a origem dessas URLs pelo domínio real e ajuste `APP_ORIGIN` e `GOOGLE_REDIRECT_URI`.

Ative as APIs necessárias, autorize o usuário na tela de consentimento quando o aplicativo estiver em testes e conecte a conta em Configurações. ID e segredo configurados não significam que a conta está conectada. Google Ads também pode exigir developer token e IDs da conta/MCC.

## Hostinger

- Node.js 24, instalação `npm ci --omit=dev`, inicialização `npm start`.
- `NODE_ENV=production` e `APP_ORIGIN=https://DOMINIO-DO-APP-PJ`.
- `GOOGLE_REDIRECT_URI=https://DOMINIO-DO-APP-PJ/api/google/callback`.
- `GOOGLE_CALENDAR_ID=primary` ou a agenda escolhida.
- `DATA_DIR`: diretório privado persistente, exclusivo da PJ e fora das pastas de versões.
- `GOOGLE_TOKEN_ENCRYPTION_KEY`: chave própria de 32 bytes em base64, preservada entre publicações.
- Defina `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET` e `HEIGIT_API_KEY` somente nas variáveis do servidor.
- `HEIGIT_API_BASE_URL=https://api.heigit.org`; limites locais diários de 100 para direções/geocodificação e cache de 24 horas.

O primeiro acesso pelo domínio HTTPS permite cadastrar a senha. Não existe senha padrão. Asaas e Meta mantêm as funcionalidades do produto, sem contas ou credenciais herdadas.

## Base e validação

Base: Multilimp `fe227b92077ba03a2ac98bd2b70678539a20ab01`, incluindo os campos corporativos. Novo repositório sem histórico das empresas anteriores.

Testes da instalação PJ, acesso, orçamentos, PDFs, financeiro, agenda e integrações aprovados. Consulta real à HeiGIT reconheceu Rua Manaus em Osasco/SP e retornou 8.748 metros até Rua Amazonas em Osasco. Precisão da origem: rua, não número do imóvel.

Não enviar `.env`, `data/`, `.tools/`, backups ou documentos de clientes ao GitHub.
