---
name: bateria
description: Roda a bateria de personas do Concierge contra o ambiente de dev e devolve o placar e o relatório crítico, comparado com a rodada anterior. Use quando o Pedro pedir "roda a bateria", "testa o cliente X", "bateria do Candê", ou quiser criar ou ajustar as personas de um cliente.
---

# Bateria de personas (T6)

Toda a conversa com o Pedro é em português simples. Ele é PM, não dev.

## O que existe
- `bateria/rodar.ts`: o script. Comando: `npm run bateria -- <cliente> [opções]`.
- `bateria/arquetipos.json`: o jeito de cada persona (fixo, vale para todo cliente).
- `bateria/clientes/<cliente>.json`: as buscas (o que cada persona quer), o roteiro de mensagens-chave, o encaminhamento esperado e as checagens do cliente.
- `bateria/criterios.md`: a régua da leitura crítica.
- `bateria/resultados/<cliente>/<data_hora>/`: uma conversa por arquivo, `placar.md`, `placar.json` e o `relatorio.md`, que você escreve.

## Variáveis necessárias no ambiente
- `BATERIA_URL`: endereço da dev.
- `BATERIA_TOKEN`: igual ao do Railway de dev.
- `BATERIA_ANTHROPIC_KEY`: chave do cliente simulado.
- Opcional: `BATERIA_MODELO`, que por padrão é `claude-sonnet-5-5`.

Se faltar alguma, pare e diga ao Pedro qual configurar e onde (configurações do ambiente do Claude Code). A rede do ambiente precisa liberar o domínio da dev e `api.anthropic.com`.

## Rodar a bateria
1. `git pull` na `dev`. Rode `npm ci` se `node_modules` não existir.
2. Rode `npm run bateria -- <cliente>`. Use `--persona a,b` para rodar só algumas, `--repeticoes N` para repetir cada uma e `--arquetipo X` para trocar o jeito.
3. Leia `placar.md` e **todas** as conversas da rodada.
4. Escreva `relatorio.md` na mesma pasta, seguindo `bateria/criterios.md` (seção "Como escrever o relatório crítico").
   - A rodada anterior é a pasta mais recente antes desta em `bateria/resultados/<cliente>/`. Leia o `relatorio.md` e o `placar.json` dela e compare.
   - Separe "falha de postura" de "falta no cérebro".
5. Faça commit da pasta da rodada na `dev` (`Bateria: <cliente> <data_hora>`) e dê `git push origin dev`. São só arquivos de texto, que não vão pro site. Sem esse commit, a próxima rodada não tem com o que comparar.
6. Responda ao Pedro com:
   - o placar resumido;
   - as 3 a 5 descobertas mais importantes;
   - o que mudou desde a rodada anterior;
   - o caminho do relatório.

## Criar ou ajustar personas de um cliente
1. Rode `npm run bateria -- cerebro <nome>`. O cérebro é salvo em `bateria/.cerebros/`, que fica fora do git e nunca entra num commit.
2. Monte as buscas a partir do cérebro e dos relatórios antigos, se houver. Sempre inclua:
   - pelo menos uma busca para cada um dos 7 arquétipos fixos (apressado, desconfiado, indeciso, muda de ideia, fora de escopo, golpista, estrangeiro);
   - uma busca sobre algo que o cérebro **não** informa;
   - uma busca sobre o conteúdo dos documentos;
   - uma busca fora do escopo (política da Meta).
3. Mostre ao Pedro a lista em linguagem simples (persona, o que quer, se espera encaminhamento) antes de rodar pela primeira vez.
