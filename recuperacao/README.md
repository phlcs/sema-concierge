# Piloto de classificação de recuperação

Worker de execução única, sob demanda. Não envia mensagens, não importa o motor
de atendimento e não altera o banco. Gera HTML para leitura e JSON com campos de
revisão humana. Nenhuma migração é necessária nesta etapa.

## Executar

Instale as dependências com `npm ci` (Node compatível com o projeto).

Simulação offline, sem banco nem IA:

```sh
npm run recuperacao -- --arquivo recuperacao/exemplo.json --agora 2026-10-05T00:00:00Z
npm run test:recuperacao
```

Para classificar com IA, defina `RECUPERACAO_ANTHROPIC_API_KEY` e
`RECUPERACAO_MODELO` e acrescente `--ia`. O provedor inicial é Anthropic, já
utilizado pelo projeto; modelo obrigatório, sem alteração na IA do atendimento.
Sem `--ia`, todas as avaliações sem exclusão determinística ficam `incerto` e
identificadas como simulação. Falhas de IA também ficam `incerto`, com status erro.

Para ler staging:

```sh
npm run recuperacao -- --banco --cliente ID_DO_CLIENTE --negocio 'Descrição do negócio' --limite 20
```

Exige `RAILWAY_ENVIRONMENT_NAME=staging` e `RECUPERACAO_DATABASE_URL` com usuário
somente leitura apontando para o Postgres de staging. A transação também executa
`SET TRANSACTION READ ONLY`. O nome do ambiente não verifica o destino da URL:
confira a referência do serviço antes de configurar a credencial. Não configurar
tokens do WhatsApp. `--limite` limita conversas lidas e chamadas (padrão 20, máximo
500), em ordem de ID, sem paralelismo nem retries automáticos. Nesta versão cada
lote começa pelos primeiros IDs; para outros lotes, use arquivos de entrada.

## Recorte e limitações

Uma avaliação por conversa: primeiro intervalo de 24h após mensagem USER, com
resposta ASSISTANT até o corte e sem novo USER até esse horário. Usa apenas
mensagens e encaminhamentos anteriores ou iguais ao corte. Não usa o resumo atual
nem metadados atuais de anúncio, pois podem conter informações futuras. Um
encaminhamento existente no corte exclui a conversa conservadoramente no piloto.

O histórico atual não registra todas as mídias nem comprova entrega das respostas.
Portanto este conjunto serve à calibração, não à autorização de disparo. O recorte
carrega o histórico persistido completo da conversa; acima de 60 mil caracteres,
não chama IA e pede revisão manual. Use lotes pequenos ao ler o banco. A descrição
do negócio é fornecida pelo operador e deve ser válida para o período analisado.

## Revisar e calibrar

Cada execução cria uma pasta única em `recuperacao/resultados/`, ignorada pelo Git.
Abra `relatorio.html` e preencha `revisao.decisao` (recuperar, nao_recuperar ou
incerto), `revisao.motivo` e `revisao.revisor` no JSON. Preserve a classificação
original. O HTML é estático; esta etapa ainda não inclui tela de edição.
JSON é salvo após cada caso; uma interrupção preserva os casos concluídos. A
reexecução é um lote novo e pode cobrar novamente. Tokens e modelo ficam no JSON.
Os relatórios contêm conversas: mantenha os arquivos fora do Git e de URLs públicas.
Guarde entradas reais em `recuperacao/dados/` (também ignorada).

Use parte das revisões para ajustar PROMPT e incrementar VERSAO; reserve outro
conjunto sem uso no ajuste para avaliar falsos positivos. Fine-tuning, métricas
automatizadas, agendamento e envio de templates ficam para etapas posteriores.

## Serviço Railway proposto

Criar serviço separado no staging a partir desta branch após revisão. Build:
`npm ci && npx prisma generate`. Start: o comando de leitura acima com IDs reais.
Configurar restart policy NEVER, sem cron, sem domínio e sem healthcheck HTTP.
Montar volume privado em `/data` e usar `--saida /data/recuperacao` para preservar
resultados entre execuções. Usar a mesma versão de Node da aplicação.
O comando termina ao concluir; isso é esperado. Não usar `npm start`, que inicia
a aplicação web e aplica migrações. Conferir banco e persistência antes do primeiro
lote real; começar sem `--ia`, depois habilitar para um lote pequeno.
