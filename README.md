# Verifica AI

Ferramenta interna da FortAds para encontrar empresas brasileiras com site próprio, WhatsApp publicado no site e CNPJ de matriz ativa.

## Execução local

Requer Node.js 20.9+ e uma chave Serper. Copie `.env.example` para `.env.local`, preencha `SERPER_API_KEY` localmente e execute:

```bash
npm install
npm run dev
```

`SERPER_API_KEY` deve existir também nas variáveis de ambiente do projeto Vercel `verifica7` para produção. A chave é usada apenas na rota de servidor.

## Fluxo de verificação

1. Serper retorna resultados orgânicos do Google para consultas variadas por segmento e localidade.
2. O servidor abre o site público, no máximo a página inicial e duas páginas institucionais ou de contato.
3. O próprio site deve publicar um link de WhatsApp e um CNPJ válido. O CNPJ não vem da pesquisa do Google.
4. A BrasilAPI confirma `identificador_matriz_filial = 1`, `descricao_identificador_matriz_filial = MATRIZ` e `descricao_situacao_cadastral = ATIVA`.
5. O nome cadastral é confrontado com identidade, conteúdo e contexto do CNPJ publicados no site. O domínio não precisa conter a razão social. Apenas aprovados aparecem.

Cada lote usa uma consulta Serper, até 15 domínios e concorrência de três análises. A interface faz até quatro lotes por clique, interrompendo ao alcançar cinco aprovadas. O servidor encerra um lote antes do limite de execução e permite retomar a partir do próximo candidato. Pode retornar menos de cinco. A análise tem limites de tempo, redirecionamento e tamanho de HTML e não executa scripts. Sites que renderizam WhatsApp ou CNPJ somente via JavaScript podem ser descartados. O painel mostra contadores por etapa e separa falhas técnicas de rejeições cadastrais.

O histórico e a deduplicação entre buscas ficam no `localStorage` de cada navegador, sem sincronização entre colaboradores. O histórico pode ser exportado em CSV. Não há banco de dados nem autenticação.

## Proteção de créditos

A rota pública limita o trabalho de cada execução, mas esses limites não impedem chamadas repetidas de terceiros. **Antes de abrir o serviço ao público, configurar uma regra de rate limit na Vercel WAF para `POST /api/search` por IP**, com limite alinhado à franquia Serper. Sem essa regra, o consumo de créditos pode crescer por abuso. Não há limite global confiável em memória de função serverless.

## Verificações

```bash
npm test
npm run lint
npm run typecheck
npm run build
```
