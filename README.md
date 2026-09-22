# 🌱 HappyFarm

Jogo de fazenda 2D em pixel art, no estilo Stardew Valley e Colheita Feliz, feito pra jogar **em tela cheia** ou numa
**janelinha flutuante no canto da tela** sem atrapalhar o trabalho.

Roda no navegador (Edge/Chrome). Não precisa instalar nada no PC e não usa nenhum asset externo: toda a arte é gerada
em código.

## Rodando

```bash
npm install
npm run dev        # http://localhost:5180 (também acessível na rede local)
npm test           # testes das regras do jogo
npm run build      # gera dist/, uma pasta estática que roda em qualquer servidor (IIS, nginx, compartilhamento)
```

## Como jogar

| Ação | Mouse | Teclado |
|---|---|---|
| Andar | clique no chão (segure pra ir seguindo o cursor) | `WASD` / setas |
| Olhar o mapa | arraste com o botão direito | `C` recentraliza |
| Usar ferramenta | clique no alvo (o fazendeiro vai até lá) | `Espaço` / `E` |
| Trocar item | clique na barra / roda do mouse | `1`–`0`, `Q` |
| Inventário e ficha do personagem | 🎒 | `I` |
| Entrar/sair de casa | clique na casa / na porta | andar contra a porta |
| Beber café | clique no fazendeiro com o café na mão | `Espaço` |
| Loja | 🛒 ou clique na barraca | `B` |
| Janela flutuante | 📌 Flutuar | `M` |
| Tela cheia | ⛶ | `F` |
| Zoom | — | `+` / `−` |

- **Ferramenta inteligente:** clicou numa árvore, o jogo usa o machado; numa pedra, a picareta; no lago, enche o
  regador. Dá pra jogar só com o mouse, o que ajuda muito no modo mini.
- **Tempo real:** as plantas crescem pelo relógio, mesmo com o jogo fechado. Canteiro regado cresce 2× mais rápido
  (a água dura 30 min). Nenhuma planta morre, porque o jogo foi pensado pra quem só dá uma olhadinha entre uma tarefa e outra.
- **Inventário:** 30 slots fixos (os 10 primeiros são a barra rápida), pilhas de até 99. Dá pra arrastar, clicar e clicar,
  ou usar Shift+clique pra mover rápido. O baú dentro de casa guarda mais 30 slots.
- **Casa:** lareira, estante, cama (recupera a energia toda, com espera de 1h entre usos), baú e o **cantinho do café** ☕.
- **Energia ⚡:** ferramentas gastam energia, que volta sozinha (+1 a cada 2 min, mesmo com o jogo fechado). O café dá
  +35 de energia e deixa você **Cafeinado**, andando mais rápido por 2 min.
- **Dia e noite** seguem a hora do PC. Dá pra desligar na ajuda (`H`).
- A aba mostra `(3) 🌾 HappyFarm` quando tem planta pronta pra colher.
- O jogo salva sozinho no navegador (`localStorage`). Se abrir em duas abas, a mais antiga pausa sozinha.

### Modo mini

Usa a API [Document Picture-in-Picture](https://developer.chrome.com/docs/web-platform/document-picture-in-picture)
(Edge/Chrome 116+). O botão **📌 Flutuar** leva o jogo inteiro pra uma janela pequena que **fica sempre por cima** das
outras e pode ser redimensionada; o tamanho fica salvo. A interface se
adapta sozinha a telas pequenas. Em navegadores sem suporte, abre um popup pequeno como alternativa.

## Arquitetura

```
src/
  core/            lógica pura: sem DOM, determinística, serializável
    data.ts        itens, plantações e números de balanceamento
    world.ts       mapas (fazenda e casa), objetos e geração procedural por seed
    inventory.ts   slots fixos, pilhas, mover/juntar (mochila e baús)
    state.ts       GameState / PlayerState + migração de saves antigos
    rules.ts       apply(state, action) → eventos  ← toda mudança de estado passa aqui
    path.ts        pathfinding (BFS)
    rng.ts         PRNG com estado serializável
  client/          tudo que é de navegador
    game.ts        loop, movimento, clique pra andar, efeitos
    renderer.ts    câmera, ordenação por profundidade, iluminação
    sprites.ts     pixel art procedural (com cache)
    ui.ts          HUD, barra rápida, loja, ajuda
    mini.ts        modo mini (Picture-in-Picture)
    input.ts / save.ts / format.ts
```

**Pensado pro multiplayer desde o início:**

- O `core/` não conhece o navegador. O servidor vai importar os mesmos arquivos.
- O estado só muda via `Action` (`use`, `buy`, `sell`, `move`...). No multiplayer, o cliente envia a action, o
  servidor valida com o mesmo `apply()` (inclusive alcance e preço) e repassa os eventos.
- A aleatoriedade usa `state.rng` (serializável), então servidor e cliente sorteiam igual.
- `players` já é um mapa, e cada jogador tem `location` (fazenda, casa...). Cada colega tem posição, cor, moedas,
  inventário e status próprios.

## Roadmap

Veja o [ROADMAP.md](ROADMAP.md). O contexto pra desenvolvimento está no [CLAUDE.md](CLAUDE.md).
