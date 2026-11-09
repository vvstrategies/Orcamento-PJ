# PJ Higienização — Orçamentos e agendamentos

Aplicação independente da PJ Higienização — Limpeza e Impermeabilização de Estofados, com clientes, propostas, PDFs A4/celular, agenda, financeiro e integrações.

## Iniciar

Requer Node.js 24 ou superior.

```sh
npm ci
# Copie .env.example para .env e configure as credenciais no servidor.
npm run local
```

Abra http://localhost:3311. Crie uma senha própria (12 a 200 caracteres), revise os dados da empresa e complete o telefone ou e-mail comercial. O projeto não distribui senha, conta conectada, orçamento ou cliente de outra empresa.

## Configuração inicial

- Nome: PJ Higienização.
- Especialidade: Limpeza e Impermeabilização de Estofados.
- Origem: Rua Manaus, 139, Rochdalle, Osasco - SP, 06226-030, Brasil.
- Logo original fornecida, azul-marinho `#161c49` e turquesa `#32b9b5`.
- Prefixo das propostas: `PJ`.
- Palio 2011: gasolina, 12 km/l, R$ 5,00/l.
- Custo padrão de materiais/insumos: 10% do valor de cada serviço.
- Deslocamento: ida e volta, calculado separadamente dos materiais. Custo operacional adicional por km começa em zero, editável.

Exemplo: serviço de R$ 200 e distância de 12 km de ida gera R$ 20 de materiais + R$ 10 de combustível para 24 km totais.

A configuração inicial só é aplicada a uma instalação vazia. Alterações em Configurações são preservadas nos reinícios.

## Integrações e hospedagem

Veja [Configuração da PJ](docs/CONFIGURACAO-PJ.md). O `.env`, as chaves, o banco SQLite, PDFs e tokens ficam fora do Git. Cada empresa deve usar um `DATA_DIR` exclusivo e persistente. A autorização OAuth da conta Google precisa ser concluída pelo administrador.

## Validação

```sh
npm run check
npm test
npm run test:pj
```

A rota confere município, UF e CEP (quando informado pelo provedor) antes de aceitar coordenadas. Resultados de outro estado/cidade são rejeitados. A localização pode ter precisão de rua, sem identificar o número; as distâncias são estimativas e podem ser corrigidas manualmente.
