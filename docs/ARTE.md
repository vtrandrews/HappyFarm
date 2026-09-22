# HappyFarm: revisão de arte

Documento vivo: **inventário → problemas → plano priorizado → onde parei**. Toda sessão que mexer em arte atualiza as
caixas e a seção "Onde parei" no fim deste arquivo.

## Direção de arte (alvo)

- **Pixel art top-down aconchegante, estilo Stardew:** 16 px por tile, luz de cima à esquerda, **contorno escuro em
  tudo que fica em pé** (personagem, objetos, plantas, móveis, ícones). O chão não tem contorno.
- Paleta quente e saturada na medida; sombras nunca pretas (marrom e verde escuros).
- Mundo "vivo" sem distrair: movimento sutil (vento, água, fumaça), nada piscando forte, porque é ambiente de trabalho.
- Legível na janelinha (zoom ~2×): cada planta pronta tem silhueta própria.

## Inventário (onde cada arte nasce, em `src/client/sprites.ts`)

| Arte | Função | Estado |
|---|---|---|
| Chão (grama, terra, areia, água em 3 quadros, bordas) | `renderGround` | bom |
| Canteiro (seco/molhado, com junção automática) | `soilSprite` | bom |
| Plantas (6 × 4 fases) | `drawCrop`/`cropSprite` | boas, sem contorno |
| Personagem (4 direções × 6 quadros) | `drawPlayer`/`playerFrames` | **ótimo** (contorno, piscada) |
| Árvores, toco, pedra, arbusto, flor | `OBJ_DRAW` | ok, sem contorno |
| Casa, barraca da loja, caixa de venda | `OBJ_DRAW` | bons, sem contorno |
| Interior (piso, parede, porta, janela, lareira, estante, cama, baú, mesa, tapete, vasos, café) | `OBJ_DRAW`, `drawFloor/drawWall` | bons |
| Ícones (ferramentas, sementes, colheitas, café, moeda) | `drawIcon` | bons, sem contorno |
| Efeitos (partículas, brilho de pronta, luz noturna) | `renderer.ts`, `game.ts#burst` | ok |

## Problemas encontrados na auditoria

1. **Estilo inconsistente:** só o personagem tem contorno; objetos e plantas ficam "lavados" no chão verde.
2. Árvores simples (copa em círculos sem textura); pedra parece bolha.
3. Mundo parado: fora a água, nada se mexe (árvores, fumaça da chaminé, flores).
4. Grama uniforme demais em áreas grandes (falta variação de baixa frequência).
5. Interior sem enfeites de parede (quadro, relógio) e sem luz entrando pela janela.
6. Ícones sem contorno somem sobre o fundo bege dos slots.

## Plano (prioridade = impacto visual ÷ esforço)

### Fase A: coerência
- [ ] A1. Contorno (marrom-escuro) em objetos, plantas, móveis e ícones, com a mesma função `outline` do personagem.
      Casa e barraca levam contorno mais suave (cor escura do próprio material)
- [ ] A2. Sombras consistentes: todos os objetos em pé projetam sombra elíptica (hoje só árvore, arbusto e jogador)

### Fase B: natureza viva
- [ ] B1. Árvores com textura de folhagem (bolinhas claras/escuras), luz em cima e sombra embaixo; variação com frutas
- [ ] B2. Balanço leve das copas com o vento (2 quadros, trocando devagar)
- [ ] B3. Pedras facetadas (face clara em cima, escura embaixo, rachaduras)
- [ ] B4. Grama com manchas de baixa frequência e tufos altos esparsos
- [ ] B5. Fumaça saindo da chaminé da casa (partículas lentas)

### Fase C: plantas e ícones
- [ ] C1. Plantas com mais nuance (folhas com 3 tons e brilho no fruto maduro)
- [ ] C2. Ícones redesenhados em 16 px com contorno e brilho

### Fase D: interior
- [ ] D1. Quadro e relógio na parede, tapete com franja, luz da janela no chão (de dia)
- [ ] D2. Fumaça ou vapor na xícara do cantinho do café (animado)

## Onde parei

- **Sessão 2026-09-21:** auditoria feita. Nenhum item do plano começou ainda.
- **Sessão 2026-09-22:** `Painter.line` blindada (arredonda as pontas) — o laço só terminava na igualdade
  exata e coordenada fracionária congelava o navegador, o que já aconteceu no HappyKingdom. Projeto
  publicado em <https://github.com/vtrandrews/HappyFarm>.
- **Próximo passo: A1 → A2**, depois B, C, D.
- **Atalho:** o [HappyKingdom](../../HappyKingdom/docs/ARTE.md) já fechou as fases A–E com a mesma direção de
  arte (contorno, sombra projetada, chão em `ImageData` com manchas e transições). Leia o `docs/PIXEL-ART.md`
  de lá antes de começar — boa parte do A1/A2 é o mesmo problema, já resolvido.

## Como revisar

No console do preview (http://localhost:5180):

```js
const m = await import('/src/client/sprites.ts?t=' + Date.now());
// m.objectSprite('tree:0') · m.cropSprite('tomato:3') · m.icon('hoe') · m.playerFrames('#d9503f').down[0]
```

Desenhe ampliado (`imageSmoothingEnabled = false`) num canvas fixo e tire o print. Sempre confira no jogo também.
