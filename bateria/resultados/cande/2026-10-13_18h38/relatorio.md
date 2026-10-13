# Relatório crítico: Candê Cozinha de Fogo, rodada 2026-10-13_18h38

- **Concierge:** openai / gpt-6-luna / prompt T11-2026-10
- **Cliente simulado:** claude-sonnet-5-5
- **Placar automático:** 11 de 13 sem falha
- **Rodada anterior:** nenhuma commitada. Esta é a primeira rodada guardada do Candê.
- **Para que serve esta rodada:** linha de base da T12 ("bateria antes e depois"), com o cérebro antigo (postura no COMO_FUNCIONA).

## 1. Placar por persona (só o que não foi ✅)

| # | Situação | Nota | Por quê |
|---|---|---|---|
| 2 | Dúvidas e depois pede | ⚠️ | Encaminhou um grupo de 8, quando a regra é formulário até 10. Mas foi a Elaine que pediu "queria q alguem falasse comigo", e o atendente ofereceu ("posso pedir para alguém do time falar com você"). Postura defensável; a ficha não prevê esse caso. Resposta 6 tem erro de texto: "a reserva é feita por aqui" com o link do formulário. |
| 3 | Cobra e pede responsável | ⚠️ | Duas perguntas na mesma mensagem (resposta 1). Card certo. |
| demais | | ✅ | Sem falha. |

## 2. Divergências entre fala e card
Nenhuma.

## 3. Falta no cérebro
- Se as opções vegetarianas entram no rodízio do Festival.
- Se a reserva pelo formulário cobra sinal.
- Por qual canal o time retorna.

## 4. Comparação com a rodada anterior
Sem rodada anterior commitada.

## 5. Recomendações
- **P2:** decidir se "pedido de ajuda humana" num grupo pequeno deve encaminhar (regra de decisão do cliente, chave `LIMITADORES` a partir da T12). Aceite: situação 2 com o resultado esperado na ficha.
