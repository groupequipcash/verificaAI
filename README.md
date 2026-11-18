# Verifica AI

Ferramenta interna da FortAds para encontrar empresas brasileiras com site próprio, WhatsApp publicado no site e CNPJ de matriz ativa.

## Execução local

Requer Node.js 20.9+, uma chave Serper e um Redis Upstash. Copie `.env.example` para `.env.local`, preencha `SERPER_API_KEY` e um par de variáveis Redis localmente e execute:

```bash
npm install
npm run dev
```

Em produção, a integração do projeto Vercel **existente** `verifica7` fornece `UPSTASH_REDIS_KV_REST_API_URL` e `UPSTASH_REDIS_KV_REST_API_TOKEN`; esse par tem prioridade. Os nomes anteriores `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` continuam aceitos como alternativa. Cada par deve estar completo; o código não mistura URL de um par com token do outro. Use token com permissão de escrita. As credenciais são usadas apenas no servidor e não devem ir ao GitHub ou ao navegador. Sem Redis configurado ou disponível, `POST /api/search` responde 503 antes de consumir Serper e nenhum novo resultado é entregue. `HEAD /api/search` verifica somente a conexão Redis, sem chamar Serper nem reservar empresas (204 = conectado, 503 = indisponível).

## Fluxo de verificação

1. Serper retorna resultados orgânicos do Google para consultas variadas por segmento e localidade.
2. O servidor abre o site público, no máximo a página inicial e duas páginas institucionais ou de contato.
3. O próprio site deve publicar um link de WhatsApp e um CNPJ válido. O CNPJ não vem da pesquisa do Google.
4. A BrasilAPI confirma `identificador_matriz_filial = 1`, `descricao_identificador_matriz_filial = MATRIZ` e `descricao_situacao_cadastral = ATIVA`.
5. O nome cadastral é confrontado com identidade, conteúdo e contexto do CNPJ publicados no site. O domínio não precisa conter a razão social.
6. Antes de transmitir cada empresa aprovada, um script Lua no Redis verifica e grava **atomicamente** o CNPJ e o domínio normalizados. Se qualquer chave já existir, a empresa é descartada e a busca continua. As chaves não recebem TTL.

Cada lote usa uma consulta Serper, até 15 domínios e concorrência de três análises. A interface faz até quatro lotes por clique, interrompendo ao alcançar cinco aprovadas. O servidor encerra um lote antes do limite de execução e permite retomar a partir do próximo candidato. Pode retornar menos de cinco. A análise tem limites de tempo, redirecionamento e tamanho de HTML e não executa scripts. Sites que renderizam WhatsApp ou CNPJ somente via JavaScript podem ser descartados. O painel mostra contadores por etapa e separa falhas técnicas de rejeições cadastrais.

O Redis é a fonte de verdade da deduplicação entre operadores e navegadores. O `localStorage` continua apenas como histórico individual, exportação CSV e filtro auxiliar para evitar trabalho desnecessário. Limpar o histórico local não libera uma empresa reservada globalmente. Não há login nem endpoint público para limpar ou importar o histórico global.

### Importar históricos anteriores

Peça aos quatro operadores que abram **Histórico deste navegador → Exportar CSV** e enviem os quatro arquivos ao responsável técnico por um canal seguro. Execute a prévia local, com um dos pares Redis acima definido apenas no ambiente do terminal:

```bash
node scripts/import-history.mjs operador1.csv operador2.csv operador3.csv operador4.csv
node scripts/import-history.mjs --apply operador1.csv operador2.csv operador3.csv operador4.csv
```

O script normaliza CNPJ e domínio, ignora linhas inválidas, remove duplicidades nos arquivos e usa a mesma reserva atômica do servidor. Não apaga os arquivos nem o histórico dos navegadores. **Empresas exibidas antes desta mudança só serão bloqueadas globalmente depois de importar seus registros.** O histórico antigo era limitado aos 500 registros mais recentes por navegador; registros já apagados ou fora desse limite não podem ser recuperados automaticamente. Guarde os CSVs fora do repositório.

### Política de entrega

A reserva é confirmada **antes** de enviar o cartão ao navegador. Uma resposta 0 do Redis indica duplicidade; erro ou resposta incerta interrompe a pesquisa sem enviar a empresa. Se a conexão cair depois da reserva e antes de o cartão chegar ao navegador, a empresa permanece reservada e poderá não ter sido vista por ninguém. Essa política prioriza a garantia de nunca entregar a mesma empresa duas vezes. Não existe confirmação de leitura nem liberação automática, pois isso abriria uma janela para duplicidade. Redis deve ter persistência habilitada e não sofrer limpeza manual das chaves `verifica-ai:{companies}:*`.

## Proteção de créditos

A rota pública limita o trabalho de cada execução, mas esses limites não impedem chamadas repetidas de terceiros. **Antes de abrir o serviço ao público, configurar uma regra de rate limit na Vercel WAF para `POST /api/search` por IP**, com limite alinhado à franquia Serper. Sem essa regra, o consumo de créditos pode crescer por abuso. Não há limite global confiável em memória de função serverless.

## Verificações

```bash
npm test
npm run lint
npm run typecheck
npm run build
```
