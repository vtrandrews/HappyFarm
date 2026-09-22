// Definições estáticas do jogo: itens, plantações e números de balanceamento.

export const MIN = 60_000;

export type Dir = 'up' | 'down' | 'left' | 'right';
export type ToolId = 'hoe' | 'can' | 'axe' | 'pickaxe';
export type CropId = 'lettuce' | 'carrot' | 'tomato' | 'corn' | 'strawberry' | 'pumpkin';
export type SeedId = `seed_${CropId}`;
export type ResourceId = 'wood' | 'stone';
export type ConsumableId = 'coffee';
export type ItemId = ToolId | SeedId | CropId | ResourceId | ConsumableId;
export type CropShape = 'leafy' | 'root' | 'vine' | 'tall' | 'berry' | 'big';

export interface CropDef {
  id: CropId;
  name: string;
  seedPrice: number;
  sellPrice: number;
  /** Tempo real até ficar pronta, com o canteiro sempre regado. */
  growMs: number;
  /** Se definido, a planta rebrota depois de colhida (tomate, morango). */
  regrowMs?: number;
  yield: [min: number, max: number];
  xp: number;
  unlockLevel: number;
  shape: CropShape;
  leaf: string;
  leafDark: string;
  fruit: string;
  fruitDark: string;
  fruitLight: string;
}

export const CROP_ORDER: CropId[] = ['lettuce', 'carrot', 'tomato', 'corn', 'strawberry', 'pumpkin'];

export const CROPS: Record<CropId, CropDef> = {
  lettuce: {
    id: 'lettuce', name: 'Alface', seedPrice: 10, sellPrice: 18, growMs: 2 * MIN, yield: [1, 1], xp: 2,
    unlockLevel: 1, shape: 'leafy',
    leaf: '#8fdc5a', leafDark: '#4f9e34', fruit: '#b8ec7a', fruitDark: '#6cbf45', fruitLight: '#e0fbb0',
  },
  carrot: {
    id: 'carrot', name: 'Cenoura', seedPrice: 20, sellPrice: 42, growMs: 6 * MIN, yield: [1, 1], xp: 4,
    unlockLevel: 1, shape: 'root',
    leaf: '#5cb83e', leafDark: '#3a8a28', fruit: '#f08a24', fruitDark: '#c4621a', fruitLight: '#ffb35c',
  },
  tomato: {
    id: 'tomato', name: 'Tomate', seedPrice: 35, sellPrice: 26, growMs: 15 * MIN, regrowMs: 6 * MIN,
    yield: [1, 2], xp: 6, unlockLevel: 2, shape: 'vine',
    leaf: '#5fb043', leafDark: '#3a7d2c', fruit: '#e8403a', fruitDark: '#b02a25', fruitLight: '#ff8a7a',
  },
  corn: {
    id: 'corn', name: 'Milho', seedPrice: 50, sellPrice: 125, growMs: 30 * MIN, yield: [1, 1], xp: 12,
    unlockLevel: 3, shape: 'tall',
    leaf: '#78c04a', leafDark: '#4a8a2c', fruit: '#f5d33b', fruitDark: '#c9a41f', fruitLight: '#fff08a',
  },
  strawberry: {
    id: 'strawberry', name: 'Morango', seedPrice: 80, sellPrice: 45, growMs: 45 * MIN, regrowMs: 20 * MIN,
    yield: [1, 3], xp: 10, unlockLevel: 4, shape: 'berry',
    leaf: '#5cb83e', leafDark: '#357a26', fruit: '#e5334b', fruitDark: '#a8192f', fruitLight: '#ff8f9f',
  },
  pumpkin: {
    id: 'pumpkin', name: 'Abóbora', seedPrice: 150, sellPrice: 520, growMs: 180 * MIN, yield: [1, 1], xp: 45,
    unlockLevel: 5, shape: 'big',
    leaf: '#5fa83e', leafDark: '#3a7a28', fruit: '#f28c28', fruitDark: '#c0621a', fruitLight: '#ffc27a',
  },
};

export const TOOLS: ToolId[] = ['hoe', 'can', 'axe', 'pickaxe'];

export type ItemKind = 'tool' | 'seed' | 'produce' | 'resource' | 'consumable';

export interface ItemDef {
  id: ItemId;
  name: string;
  kind: ItemKind;
  sellPrice?: number;
  crop?: CropId;
}

const TOOL_NAMES: Record<ToolId, string> = {
  hoe: 'Enxada',
  can: 'Regador',
  axe: 'Machado',
  pickaxe: 'Picareta',
};

export const seedOf = (c: CropId): SeedId => `seed_${c}`;
export const isSeed = (i: ItemId): i is SeedId => i.startsWith('seed_');

export const ITEMS: Record<ItemId, ItemDef> = (() => {
  const items = {} as Record<ItemId, ItemDef>;
  for (const t of TOOLS) items[t] = { id: t, name: TOOL_NAMES[t], kind: 'tool' };
  for (const c of CROP_ORDER) {
    const d = CROPS[c];
    items[c] = { id: c, name: d.name, kind: 'produce', sellPrice: d.sellPrice, crop: c };
    items[seedOf(c)] = { id: seedOf(c), name: `Semente de ${d.name}`, kind: 'seed', crop: c };
  }
  items.wood = { id: 'wood', name: 'Madeira', kind: 'resource', sellPrice: 3 };
  items.stone = { id: 'stone', name: 'Pedra', kind: 'resource', sellPrice: 4 };
  items.coffee = { id: 'coffee', name: 'Café', kind: 'consumable' };
  return items;
})();

export const SELLABLE: ItemId[] = [...CROP_ORDER, 'wood', 'stone'];

// ---- balanceamento ----
/** Quanto tempo um canteiro fica molhado depois de regado. */
export const WET_MS = 30 * MIN;
/** Velocidade de crescimento com o canteiro seco (1 = regado). */
export const DRY_RATE = 0.5;
export const CAN_CAPACITY = 20;
export const STUMP_REGROW_MS = 15 * MIN;
/** Alcance do jogador (em tiles) até a borda do alvo. */
export const REACH = 1.3;
export const START_COINS = 60;

// ---- inventário ----
export const INV_SIZE = 30;
export const HOTBAR_SIZE = 10;
export const CHEST_SIZE = 30;
export const STACK_MAX = 99;
export const stackMax = (item: ItemId) => (ITEMS[item].kind === 'tool' ? 1 : STACK_MAX);

// ---- status do personagem ----
export const maxEnergy = (level: number) => 100 + (level - 1) * 10;
/** Energia volta sozinha: +1 a cada 2 min de tempo real. */
export const ENERGY_REGEN_MS = 2 * MIN;
export const ENERGY_COST: Partial<Record<string, number>> = { till: 2, water: 1, chop: 2, break: 2, untill: 1 };
export const COFFEE_ENERGY = 35;
export const CAFFEINE_MS = 2 * MIN;
export const CAFFEINE_SPEED = 1.3;
export const REST_COOLDOWN_MS = 60 * MIN;

export const levelFromXp = (xp: number) => Math.floor(Math.sqrt(xp / 15)) + 1;
export const xpForLevel = (level: number) => 15 * (level - 1) ** 2;
