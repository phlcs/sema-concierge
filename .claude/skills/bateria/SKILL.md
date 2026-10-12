---
name: bateria
description: Roda a bateria de personas do Concierge contra o ambiente de dev e devolve o placar e o relatório crítico, comparado com a rodada anterior. Use quando o Pedro pedir "roda a bateria", "testa o cliente X", "bateria do Candê", ou quiser criar ou ajustar a ficha de um cliente.
---

# Bateria de personas (T6)

Toda a conversa com o Pedro é em português simples. Ele é PM, não dev.

## O que existe
- `bateria/rodar.ts`: o script. Comando: `npm run bateria -- <cliente> [opções]`.
- `bateria/pessoas.json`: quem fala. 8 pessoas fixas, iguais para todo negócio.
- `bateria/situacoes.json`: o que acontece. 13 situações fixas, iguais para todo negócio, cada uma com a pessoa padrão e o encaminhamento esperado. A 11 e a 12 são prompt injection, com mensagens fixas.
- `bateria/clientes/<cliente>.json`: a ficha do cliente, a única parte que muda por negócio.
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
2. Rode `npm run bateria -- <cliente>`. Use `--situacao 4,9` para rodar só algumas, `--repeticoes N` para repetir cada uma e `--pessoa ana` para trocar quem fala.
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

## Cliente novo: criar a ficha
Pessoas e situações não mudam: valem para qualquer negócio (restaurante, agência, médico, advogado, escola, estética, odontologia, a própria Sema). Para um cliente novo, só se cria a ficha.
1. Rode `npm run bateria -- cerebro <nome>`. O cérebro é salvo em `bateria/.cerebros/`, que fica fora do git e nunca entra num commit.
2. Crie `bateria/clientes/<cliente>.json` copiando uma ficha existente e preenchendo, só com o que está no cérebro:
   - `pedido`: o que é "fazer o pedido" ali, como frase com verbo ("agendar uma consulta", "pedir um orçamento");
   - `dadosDoPedido`: os dados que o pedido precisa;
   - `pedidoGeraEncaminhamento`: se o pedido vira card, e `regraDoEncaminhamento` em uma frase;
   - `pedidoQueEncaminha`: opcional, só quando parte dos pedidos vira card (no Candê, só grupo acima de 10). As situações 3 e 4 usam esse pedido;
   - `assuntos`: 3 a 5 temas do cérebro;
   - `perguntaSemResposta`: algo prático que o cérebro não traz;
   - `documento`: um documento do cliente e uma pergunta sobre ele;
   - `nuncaPodeDizer`: opcional, o que o atendente nunca pode dizer, como expressão regular.
3. Mostre a ficha ao Pedro em linguagem simples antes de rodar pela primeira vez.
