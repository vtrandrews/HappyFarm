import { describe, expect, it } from 'vitest';
import {
  CHEST_SIZE, COFFEE_ENERGY, CROPS, DRY_RATE, ENERGY_REGEN_MS, INV_SIZE, MIN, WET_MS, levelFromXp, xpForLevel,
} from './data';
import { addItem, countItem, emptySlots, moveSlot, quickMove } from './inventory';
import { findPath } from './path';
import { apply, countRipe, cropStage, energyMax, findChest, growSoil, regenEnergy, resolveUse, tick } from './rules';
import { LOCAL_ID, migrate, newGame, qty, type GameState } from './state';
import { G, LAYOUT, isBlocked, objectAt, tileKey } from './world';

const T0 = 1_700_000_000_000;

/** Coloca o jogador em pé logo abaixo do tile (tx, ty). */
function standBelow(s: GameState, tx: number, ty: number) {
  const p = s.players[LOCAL_ID];
  p.x = tx + 0.5;
  p.y = ty + 1.5;
  return p;
}

function select(s: GameState, item: string) {
  const p = s.players[LOCAL_ID];
  const i = p.inv.findIndex((sl) => sl?.item === item);
  if (i < 0 || i >= 10) throw new Error(`${item} não está na barra`);
  apply(s, { type: 'select', playerId: LOCAL_ID, slot: i });
}

function freeGrass(s: GameState) {
  const w = s.maps.farm;
  for (let y = LAYOUT.farm.y0; y <= LAYOUT.farm.y1; y++) {
    for (let x = LAYOUT.farm.x0; x <= LAYOUT.farm.x1; x++) {
      const k = tileKey(w, x, y);
      if (w.ground[k] === G.grass && !objectAt(w, x, y) && !w.soil[k] && !isBlocked(w, x, y + 1)) return { x, y };
    }
  }
  throw new Error('sem grama livre');
}

describe('mundo', () => {
  it('é determinístico pela seed', () => {
    const a = newGame(42, T0).maps.farm;
    const b = newGame(42, T0).maps.farm;
    expect(a.objects.map((o) => [o.kind, o.x, o.y])).toEqual(b.objects.map((o) => [o.kind, o.x, o.y]));
  });

  it('o spawn é livre e alcança a loja e o lago', () => {
    const w = newGame(7, T0).maps.farm;
    const sx = Math.floor(LAYOUT.spawn.x);
    const sy = Math.floor(LAYOUT.spawn.y);
    expect(isBlocked(w, sx, sy)).toBe(false);
    expect(findPath(w, sx, sy, new Set([tileKey(w, 43, 7)]))).not.toBeNull();
    const pondEdge = new Set<number>();
    for (let k = 0; k < w.ground.length; k++) if (w.ground[k] === G.sand) pondEdge.add(k);
    expect(findPath(w, sx, sy, pondEdge)).not.toBeNull();
  });

  it('dentro de casa dá pra chegar no baú, na cama e no café', () => {
    const w = newGame(1, T0).maps.house;
    const { spawn } = LAYOUT.interior;
    for (const kind of ['chest', 'bed', 'coffeebar'] as const) {
      const o = w.objects.find((ob) => ob.kind === kind)!;
      const goals = new Set<number>();
      for (let y = o.y - 1; y <= o.y + o.h; y++) {
        for (let x = o.x - 1; x <= o.x + o.w; x++) if (!isBlocked(w, x, y)) goals.add(tileKey(w, x, y));
      }
      expect(findPath(w, Math.floor(spawn.x), Math.floor(spawn.y), goals), kind).not.toBeNull();
    }
  });
});

describe('plantio', () => {
  it('arar → plantar → regar → crescer → colher → vender', () => {
    const s = newGame(1, T0);
    const p = s.players[LOCAL_ID];
    const t = freeGrass(s);
    standBelow(s, t.x, t.y);
    const use = (now = T0) => apply(s, { type: 'use', playerId: LOCAL_ID, x: t.x, y: t.y, now });

    select(s, 'hoe');
    use();
    const soil = s.maps.farm.soil[tileKey(s.maps.farm, t.x, t.y)];
    expect(soil).toBeDefined();

    select(s, 'seed_lettuce');
    use();
    expect(soil.crop?.id).toBe('lettuce');
    expect(qty(p, 'seed_lettuce')).toBe(5);

    select(s, 'can');
    use();
    expect(soil.wetUntil).toBe(T0 + WET_MS);

    tick(s, T0 + CROPS.lettuce.growMs - 1000);
    expect(cropStage(soil.crop!)).toBe(2);
    tick(s, T0 + CROPS.lettuce.growMs);
    expect(countRipe(s)).toBe(1);

    const coins = p.coins;
    use(T0 + CROPS.lettuce.growMs);
    expect(soil.crop).toBeNull();
    expect(qty(p, 'lettuce')).toBe(1);

    apply(s, { type: 'sellAll', playerId: LOCAL_ID });
    expect(p.coins).toBe(coins + CROPS.lettuce.sellPrice);
    expect(qty(p, 'lettuce')).toBe(0);
  });

  it('seco cresce mais devagar', () => {
    const soil = { wetUntil: T0 + 10 * MIN, crop: { id: 'corn' as const, growth: 0, last: T0, harvests: 0 } };
    growSoil(soil, T0 + 20 * MIN);
    expect(soil.crop.growth).toBe(10 * MIN + 10 * MIN * DRY_RATE);
  });

  it('tomate rebrota depois da colheita', () => {
    const s = newGame(3, T0);
    const t = freeGrass(s);
    standBelow(s, t.x, t.y);
    const k = tileKey(s.maps.farm, t.x, t.y);
    s.maps.farm.soil[k] = { wetUntil: 0, crop: { id: 'tomato', growth: CROPS.tomato.growMs, last: T0, harvests: 0 } };
    apply(s, { type: 'use', playerId: LOCAL_ID, x: t.x, y: t.y, now: T0 });
    expect(s.maps.farm.soil[k].crop?.harvests).toBe(1);
    expect(qty(s.players[LOCAL_ID], 'tomato')).toBeGreaterThanOrEqual(1);
  });

  it('não age fora do alcance', () => {
    const s = newGame(1, T0);
    const t = freeGrass(s);
    const p = s.players[LOCAL_ID];
    p.x = t.x + 5.5;
    p.y = t.y + 5.5;
    apply(s, { type: 'use', playerId: LOCAL_ID, x: t.x, y: t.y, now: T0 });
    expect(s.maps.farm.soil[tileKey(s.maps.farm, t.x, t.y)]).toBeUndefined();
  });
});

describe('ferramenta inteligente', () => {
  it('escolhe machado pra árvore mesmo com semente na mão', () => {
    const s = newGame(5, T0);
    const w = s.maps.farm;
    const tree = w.objects.find((o) => o.kind === 'tree' && o.x > 5 && o.y > 5 && !isBlocked(w, o.x, o.y + 1))!;
    const p = standBelow(s, tree.x, tree.y);
    select(s, 'seed_lettuce');
    expect(resolveUse(s, p, tree.x, tree.y, false, T0)).toBeNull();
    expect(resolveUse(s, p, tree.x, tree.y, true, T0)?.kind).toBe('chop');
  });
});

describe('inventário', () => {
  it('empilha até 99 e usa slots vazios', () => {
    const inv = emptySlots(3);
    expect(addItem(inv, 'wood', 150)).toBe(0);
    expect(inv.map((s) => s?.qty)).toEqual([99, 51, undefined]);
    expect(addItem(inv, 'wood', 200)).toBe(200 - 48 - 99);
  });

  it('ferramentas não empilham', () => {
    const inv = emptySlots(3);
    addItem(inv, 'hoe', 2);
    expect(inv.filter(Boolean)).toHaveLength(2);
  });

  it('arrastar junta pilhas iguais e troca diferentes', () => {
    const inv = emptySlots(3);
    inv[0] = { item: 'wood', qty: 90 };
    inv[1] = { item: 'wood', qty: 20 };
    inv[2] = { item: 'stone', qty: 1 };
    moveSlot(inv, 1, inv, 0);
    expect(inv[0]?.qty).toBe(99);
    expect(inv[1]?.qty).toBe(11);
    moveSlot(inv, 2, inv, 1);
    expect(inv[1]?.item).toBe('stone');
    expect(inv[2]?.item).toBe('wood');
  });

  it('quickMove respeita a faixa de destino', () => {
    const inv = emptySlots(4);
    inv[0] = { item: 'wood', qty: 5 };
    quickMove(inv, 0, inv, 2);
    expect(inv[0]).toBeNull();
    expect(inv[2]).toEqual({ item: 'wood', qty: 5 });
  });

  it('comprar sem espaço não cobra', () => {
    const s = newGame(1, T0);
    const p = s.players[LOCAL_ID];
    p.coins = 1000;
    for (let i = 0; i < INV_SIZE; i++) if (!p.inv[i]) p.inv[i] = { item: 'stone', qty: 99 };
    apply(s, { type: 'buy', playerId: LOCAL_ID, item: 'seed_corn', qty: 1 });
    expect(p.coins).toBe(1000);
  });
});

describe('casa', () => {
  it('entra pela porta, guarda no baú e sai', () => {
    const s = newGame(1, T0);
    const p = s.players[LOCAL_ID];
    const d = LAYOUT.houseDoor;
    apply(s, { type: 'use', playerId: LOCAL_ID, x: d.x, y: d.y, now: T0 });
    expect(p.location).toBe('house');

    const chest = s.maps.house.objects.find((o) => o.kind === 'chest')!;
    expect(chest.slots).toHaveLength(CHEST_SIZE);
    const hoeSlot = p.inv.findIndex((sl) => sl?.item === 'hoe');
    // longe do baú: não mexe
    apply(s, { type: 'quickMove', playerId: LOCAL_ID, from: { c: 'inv', i: hoeSlot }, chestId: chest.id });
    expect(countItem(chest.slots!, 'hoe')).toBe(0);
    // perto do baú
    p.x = chest.x - 0.5;
    p.y = chest.y + 0.5;
    apply(s, { type: 'quickMove', playerId: LOCAL_ID, from: { c: 'inv', i: hoeSlot }, chestId: chest.id });
    expect(countItem(findChest(s.maps.house, chest.id)!.slots!, 'hoe')).toBe(1);
    expect(qty(p, 'hoe')).toBe(0);

    const door = LAYOUT.interior.door;
    p.x = door.x + 0.5;
    p.y = door.y - 0.5;
    apply(s, { type: 'use', playerId: LOCAL_ID, x: door.x, y: door.y, now: T0 });
    expect(p.location).toBe('farm');
  });

  it('café dá energia e cafeína; cama recupera tudo com cooldown', () => {
    const s = newGame(1, T0);
    const p = s.players[LOCAL_ID];
    const d = LAYOUT.houseDoor;
    apply(s, { type: 'use', playerId: LOCAL_ID, x: d.x, y: d.y, now: T0 });
    const bar = s.maps.house.objects.find((o) => o.kind === 'coffeebar')!;
    p.x = bar.x + 0.5;
    p.y = bar.y + 1.5;
    apply(s, { type: 'use', playerId: LOCAL_ID, x: bar.x, y: bar.y, now: T0 });
    expect(qty(p, 'coffee')).toBe(1);

    p.energy = 10;
    p.selected = p.inv.findIndex((sl) => sl?.item === 'coffee');
    apply(s, { type: 'consume', playerId: LOCAL_ID, now: T0 });
    expect(p.energy).toBe(10 + COFFEE_ENERGY);
    expect(p.caffeineUntil).toBeGreaterThan(T0);
    expect(qty(p, 'coffee')).toBe(0);

    const bed = s.maps.house.objects.find((o) => o.kind === 'bed')!;
    p.x = bed.x - 0.5;
    p.y = bed.y + 1.5;
    apply(s, { type: 'use', playerId: LOCAL_ID, x: bed.x, y: bed.y, now: T0 });
    expect(p.energy).toBe(energyMax(p));
    p.energy = 5;
    apply(s, { type: 'use', playerId: LOCAL_ID, x: bed.x, y: bed.y, now: T0 + MIN });
    expect(p.energy).toBe(5);
  });
});

describe('energia', () => {
  it('ferramenta gasta e sem energia não age', () => {
    const s = newGame(1, T0);
    const p = s.players[LOCAL_ID];
    const t = freeGrass(s);
    standBelow(s, t.x, t.y);
    select(s, 'hoe');
    p.energy = 1;
    p.energyAt = T0;
    apply(s, { type: 'use', playerId: LOCAL_ID, x: t.x, y: t.y, now: T0 });
    expect(s.maps.farm.soil[tileKey(s.maps.farm, t.x, t.y)]).toBeUndefined();
    p.energy = 5;
    apply(s, { type: 'use', playerId: LOCAL_ID, x: t.x, y: t.y, now: T0 });
    expect(p.energy).toBe(3);
  });

  it('regenera com o tempo real', () => {
    const s = newGame(1, T0);
    const p = s.players[LOCAL_ID];
    p.energy = 0;
    p.energyAt = T0;
    regenEnergy(p, T0 + 10 * ENERGY_REGEN_MS + 1);
    expect(p.energy).toBe(10);
    regenEnergy(p, T0 + 10_000 * ENERGY_REGEN_MS);
    expect(p.energy).toBe(energyMax(p));
  });
});

describe('loja e níveis', () => {
  it('bloqueia semente acima do nível e cobra o preço', () => {
    const s = newGame(1, T0);
    const p = s.players[LOCAL_ID];
    p.coins = 1000;
    apply(s, { type: 'buy', playerId: LOCAL_ID, item: 'seed_pumpkin', qty: 1 });
    expect(qty(p, 'seed_pumpkin')).toBe(0);
    apply(s, { type: 'buy', playerId: LOCAL_ID, item: 'seed_carrot', qty: 5 });
    expect(qty(p, 'seed_carrot')).toBe(3 + 5);
    expect(p.coins).toBe(1000 - 5 * CROPS.carrot.seedPrice);
  });

  it('curva de nível é consistente', () => {
    for (let l = 1; l < 20; l++) {
      expect(levelFromXp(xpForLevel(l))).toBe(l);
      expect(levelFromXp(xpForLevel(l + 1) - 1)).toBe(l);
    }
  });
});

describe('save', () => {
  it('migra save v1 pra v2 sem perder itens', () => {
    const v2 = newGame(9, T0);
    const v1 = {
      version: 1, seed: 9, rng: 1, createdAt: T0, world: v2.maps.farm,
      players: {
        local: {
          id: 'local', name: 'Você', color: '#d9503f', x: 20.5, y: 15.5, facing: 'down', coins: 225, xp: 60,
          bag: { hoe: 1, can: 1, axe: 1, pickaxe: 1, seed_tomato: 5, lettuce: 3, wood: 7 },
          selected: 'seed_tomato', water: 12,
        },
      },
      stats: { harvested: 4, earned: 90 },
    };
    const s = migrate(JSON.parse(JSON.stringify(v1)), T0)!;
    const p = s.players.local;
    expect(s.version).toBe(2);
    expect(s.maps.house.objects.some((o) => o.kind === 'bed')).toBe(true);
    expect([qty(p, 'seed_tomato'), qty(p, 'lettuce'), qty(p, 'wood'), qty(p, 'hoe')]).toEqual([5, 3, 7, 1]);
    expect(p.inv[p.selected]?.item).toBe('seed_tomato');
    expect([p.coins, p.xp, p.water, p.location]).toEqual([225, 60, 12, 'farm']);
  });
});
