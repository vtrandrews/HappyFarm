# HappyFarm: roadmap

**Propósito:** uma fazenda aconchegante pra cuidar em poucos minutos entre uma tarefa e outra, na janelinha do canto,
que vira ponto de encontro dos colegas de trabalho.

**Referências:**

- **Colheita Feliz / Fazenda Feliz:** tempo real, visitar vizinhos, "pegar emprestado".
- **Stardew Valley:** ferramentas, casa, energia, estações, charme.
- **Minecraft e Terraria:** construir e minerar.
- **Poker:** o saloon.

**Princípios de design:**

1. **Discreto:** mudo por padrão e usável na janelinha.
2. **Não punitivo:** nada morre, e a energia volta sozinha.
3. **Sessões de 2–5 minutos** sempre recompensam.
4. **Social sem pressão.**

---

## ✅ v0.0.1: pré-alpha (atual)

- [x] Fazenda procedural com casa, loja, lago, floresta e caixa de venda
- [x] Arar, plantar, regar e colher 6 culturas em tempo real (algumas rebrotam); crescimento offline
- [x] Cortar árvores (rebrotam) e quebrar pedras; loja e economia; níveis que liberam sementes
- [x] Ferramenta inteligente e jogo só com mouse; segurar pra seguir o cursor; arrastar o mapa com o botão direito
- [x] Dia e noite pelo relógio real (desligável)
- [x] Interior da casa com lareira, cama, baú (30 slots) e cantinho do café ☕
- [x] Inventário com 30 slots fixos, barra rápida de 10, arrastar/soltar e Shift+clique
- [x] Status do personagem: energia, café (Cafeinado), cama, ficha com estatísticas
- [x] Personagem com contorno, macacão, caminhada em 4 quadros e piscada
- [x] Janela flutuante (PiP), menus responsivos (abas na janelinha) e save automático com migração

**Pra fechar a 0.0.1**

- [ ] Rodada de balanceamento com os colegas (preços, tempos, energia)
- [ ] Atalho/ícone de instalação como app (PWA) pra abrir direto em janela própria
- [ ] Tela de "enquanto você esteve fora" (o que ficou pronto, energia recuperada)

## v0.1: vida na fazenda (Stardew)

- [ ] **Crafting** com madeira e pedra: cerca, espantalho, aspersor (rega sozinho), caminhos, baú extra
- [ ] **Animais** (Colheita Feliz): galinheiro (ovos) e estábulo (leite), com carinho diário
- [ ] **Estações** reais (mês do ano → estação) com culturas sazonais e visual do mapa
- [ ] **Pesca** no lago (minigame de 1 clique), usando a energia
- [ ] Customização do personagem (pele, cabelo, camisa), já prevista em `Look`
- [ ] Mais status na ficha: humor/fome, com a cozinha na casa (café da manhã dá bônus)
- [ ] Sons e música **opcionais** (mudo por padrão)

## v0.2: explorar e construir (Minecraft / Terraria)

- [ ] **Mina** com andares procedurais, minérios (cobre, ferro, ouro) e melhoria de ferramentas
- [ ] **Construção livre** de decoração e cercas no terreno; expansão da casa
- [ ] Mapa maior com floresta profunda e segredos
- [ ] Coleção (museu/álbum) de itens raros

## v0.3: multiplayer com os colegas (Colheita Feliz)

- [ ] Servidor Node + WebSocket **autoritativo** reaproveitando `src/core` (as ações já são serializáveis)
- [ ] Entrada simples com nome e cor, sem senha, rede interna
- [ ] **Visitar a fazenda** dos colegas, regar a plantação do vizinho, "pegar emprestada" uma colheita (com limite
  diário e aviso)
- [ ] Emotes/balões, presentes entre jogadores
- [ ] **Mercado** entre jogadores e ranking semanal amigável

## v0.4: Saloon 🃏

- [ ] Saloon na vila com **poker Texas Hold'em** usando fichas do jogo (sem dinheiro real)
- [ ] Mesas de 2 a 6 colegas, tempo de jogada curto, dá pra jogar pela janelinha
- [ ] Outros minijogos rápidos (truco? dominó?)

## v0.5: gamificação do ambiente de trabalho (a validar com gestão e TI)

- [ ] Metas **coletivas** da equipe viram eventos na vila (festa da colheita, sementes raras)
- [ ] Conquistas e decorações cosméticas
- [ ] Regras: opcional, nada individual exposto, sem vínculo com avaliação de desempenho

## Técnico (contínuo)

- [ ] Testes de UI (smoke) com Playwright, em tamanho grande e na janelinha
- [ ] Integração com o [HappyKingdom](../HappyKingdom): colheita da fazenda vira comida pro reino?
