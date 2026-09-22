import {
  CAN_CAPACITY, CROP_ORDER, INV_SIZE, START_COINS, TOOLS, levelFromXp, maxEnergy, seedOf, type Dir, type ItemId,
} from './data';
import { addItem, countItem, emptySlots, type Slots } from './inventory';
import { LAYOUT, generateInterior, generateWorld, type World } from './world';

export type LocationId = 'farm' | 'house';

export interface PlayerState {
  id: string;
  name: string;
  /** Cor da camisa — no multiplayer cada colega tem a sua. */
  color: string;
  location: LocationId;
  /** Posição dos pés, em tiles (float). */
  x: number;
  y: number;
  facing: Dir;
  coins: number;
  xp: number;
  /** Slots fixos: os primeiros HOTBAR_SIZE são a barra rápida. */
  inv: Slots;
  /** Índice do slot selecionado na barra rápida. */
  selected: number;
  water: number;
  energy: number;
  /** Referência pra regeneração de energia por tempo real. */
  energyAt: number;
  caffeineUntil: number;
  restReadyAt: number;
  stats: { harvested: number; earned: number; coffees: number };
}

export interface GameState {
  version: 2;
  seed: number;
  rng: number;
  createdAt: number;
  maps: Record<LocationId, World>;
  players: Record<string, PlayerState>;
}

export const LOCAL_ID = 'local';

function starterInventory(): Slots {
  const inv = emptySlots(INV_SIZE);
  for (const t of TOOLS) addItem(inv, t, 1);
  addItem(inv, 'seed_lettuce', 6);
  addItem(inv, 'seed_carrot', 3);
  return inv;
}

export function newPlayer(id: string, name: string, color: string, now: number): PlayerState {
  return {
    id, name, color,
    location: 'farm',
    x: LAYOUT.spawn.x,
    y: LAYOUT.spawn.y,
    facing: 'down',
    coins: START_COINS,
    xp: 0,
    inv: starterInventory(),
    selected: 0,
    water: CAN_CAPACITY,
    energy: maxEnergy(1),
    energyAt: now,
    caffeineUntil: 0,
    restReadyAt: 0,
    stats: { harvested: 0, earned: 0, coffees: 0 },
  };
}

export function newGame(seed: number, now: number): GameState {
  return {
    version: 2,
    seed,
    rng: seed ^ 0x5bd1e995,
    createdAt: now,
    maps: { farm: generateWorld(seed), house: generateInterior() },
    players: { [LOCAL_ID]: newPlayer(LOCAL_ID, 'Você', '#d9503f', now) },
  };
}

export const worldOf = (state: GameState, p: PlayerState) => state.maps[p.location];
export const qty = (p: PlayerState, item: ItemId) => countItem(p.inv, item);
export const selectedItem = (p: PlayerState): ItemId | null => p.inv[p.selected]?.item ?? null;

// ---------------------------------------------------------------- migração de saves

interface SaveV1 {
  version: 1;
  seed: number;
  rng: number;
  createdAt: number;
  world: World;
  players: Record<string, {
    id: string; name: string; color: string; x: number; y: number; facing: Dir;
    coins: number; xp: number; bag: Partial<Record<ItemId, number>>; selected: ItemId; water: number;
  }>;
  stats: { harvested: number; earned: number };
}

/** v1 (mochila como mapa item→qtd, um mapa só) → v2 (slots fixos, casa, energia). */
export function migrate(raw: unknown, now: number): GameState | null {
  const s = raw as { version?: number };
  if (s?.version === 2) return raw as GameState;
  if (s?.version !== 1) return null;
  const v1 = raw as SaveV1;
  const order: ItemId[] = [
    ...TOOLS, ...CROP_ORDER.map(seedOf), ...CROP_ORDER, 'wood', 'stone',
  ];
  const players: Record<string, PlayerState> = {};
  for (const [id, old] of Object.entries(v1.players)) {
    const p = newPlayer(id, old.name, old.color, now);
    p.inv = emptySlots(INV_SIZE);
    for (const item of order) {
      const n = old.bag[item] ?? 0;
      if (n > 0) addItem(p.inv, item, n);
    }
    Object.assign(p, { x: old.x, y: old.y, facing: old.facing, coins: old.coins, xp: old.xp, water: old.water });
    p.energy = maxEnergy(levelFromXp(old.xp));
    p.selected = Math.max(0, p.inv.findIndex((sl) => sl?.item === old.selected));
    if (p.selected >= 10) p.selected = 0;
    p.stats.harvested = v1.stats.harvested;
    p.stats.earned = v1.stats.earned;
    players[id] = p;
  }
  return {
    version: 2,
    seed: v1.seed,
    rng: v1.rng,
    createdAt: v1.createdAt,
    maps: { farm: v1.world, house: generateInterior() },
    players,
  };
}
