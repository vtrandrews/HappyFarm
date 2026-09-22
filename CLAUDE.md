# HappyFarm: contexto do projeto

Jogo de fazenda 2D em pixel art, para jogar **no navegador**, em **tela cheia** ou numa **janelinha flutuante no
canto da tela**, durante o expediente, com os colegas de trabalho (ambiente de tribunal). Projeto irmão:
[HappyKingdom](../HappyKingdom) (RTS).

- **Referências:** Stardew Valley, Colheita Feliz / Fazenda Feliz (crescimento em tempo real, visitar vizinhos),
  Minecraft/Terraria (exploração e construção), Poker (saloon futuro).
- **Público:** colegas de trabalho. O jogo tem que ser discreto, não punitivo, sem som por padrão e sem travar o PC.
- **Visão longa:** multiplayer entre colegas → saloon com poker (fichas do jogo) → gamificação leve do ambiente de
  trabalho (sempre opcional e sem expor produtividade individual).

## Premissas (não quebrar)

1. **Sem instalação:** roda em Edge/Chrome e o build é estático (`dist/`), servível de qualquer pasta ou intranet.
2. **Arte 100% procedural:** nada de assets externos. Tudo é desenhado em `client/sprites.ts` com o `Painter` e cacheado.
3. **Janela flutuante:** Document Picture-in-Picture (`client/mini.ts`), com popup como alternativa. Toda UI precisa
   funcionar em ~420×320 (classes `.compact` / `.tiny`, ligadas por largura **e** altura em `game.ts#render`).
4. **Tempo real e não punitivo:** plantas crescem pelo relógio, mesmo com o jogo fechado, e nada morre. A energia
   regenera sozinha.
5. **Pronto pro multiplayer:** `src/core/` é puro (sem DOM), determinístico (PRNG com estado em `state.rng`) e só muda
   via `apply(state, action)`. O servidor futuro vai importar o mesmo `core/`.
6. **UI em pt-BR**, com comentários em pt-BR onde ajudam. Identificadores em inglês.

## Stack e comandos

TypeScript + Vite + Canvas 2D, sem framework nem engine. Vitest pro núcleo.

```bash
npm run dev    # http://localhost:5180
npm test       # testes do core
npm run build  # typecheck + dist/
```

## Mapa do código

- `core/data.ts`: itens, plantações, balanceamento (energia, inventário, café).
- `core/world.ts`: mapas (`farm`, `house`), objetos, geração por seed e ocupação do grid.
- `core/state.ts`: `GameState` v2 e `PlayerState` (inventário em slots, localização, energia), mais a **migração de
  saves** (v1 → v2).
- `core/inventory.ts`: slots fixos (30, sendo 10 da barra rápida), pilhas de 99, mover/juntar/quickMove.
- `core/rules.ts`: `resolveUse` (ferramenta inteligente) e `apply` (todas as ações). Eventos voltam pro cliente.
- `client/game.ts`: loop, câmera (com pan pelo botão direito), andar clicando ou segurando, portas, modo mini.
- `client/renderer.ts`, `sprites.ts`, `ui.ts` (HUD, inventário com ficha, loja, ajuda), `input.ts` e `save.ts`.

## Convenções e armadilhas

- Mudou o formato do save? Suba `version` e escreva a migração em `core/state.ts#migrate`, com teste.
- Teclado: use `keyCode(e)` de `input.ts`. Em VDI/automação o `e.code` pode vir vazio.
- Tooltips e textos devem caber na janelinha. Sempre testar em ~600×470 **e** ~420×320.
- Ao traçar caminhos, **não** voltar ao centro do tile atual (isso causava o "vai e volta"). Veja `walkTo`.
- **Testes no painel do navegador do Claude:** com o painel oculto, o `requestAnimationFrame` para. Avance chamando
  `game.update(dt)` pelo console (`window.game` existe em dev). Teclas enviadas pela automação chegam com
  `key` vazio; pra testar atalhos, dispare `KeyboardEvent` manualmente.

## Estado atual (pré-alpha v0.0.1)

Veja [ROADMAP.md](ROADMAP.md). **Revisão de arte em andamento:** [docs/ARTE.md](docs/ARTE.md), com plano e checkboxes. A
seção "Onde parei" diz o próximo passo; atualize-a ao terminar cada item. Ainda não há commits no git; o usuário decide quando.
