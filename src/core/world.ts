import { CHEST_SIZE, type CropId } from './data';
import { emptySlots, type Slots } from './inventory';
import { makeRng } from './rng';

export const G = { grass: 0, dirt: 1, water: 2, sand: 3, path: 4, floor: 5, wall: 6 } as const;
export type Ground = (typeof G)[keyof typeof G];

export type ObjKind =
  | 'tree' | 'stump' | 'rock' | 'bush' | 'flower' | 'house' | 'shop' | 'bin'
  // interior
  | 'door' | 'bed' | 'chest' | 'table' | 'fireplace' | 'shelf' | 'window' | 'rug' | 'pot'
  | 'coffeebar' | 'cafetable' | 'chair';

export interface WorldObject {
  id: number;
  kind: ObjKind;
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  variant: number;
  regrowAt?: number;
  /** Conteúdo, se for um baú. */
  slots?: Slots;
}

export interface CropState {
  id: CropId;
  /** Crescimento efetivo acumulado (ms "regados"). */
  growth: number;
  /** Última vez que `growth` foi atualizado. */
  last: number;
  harvests: number;
}

export interface SoilTile {
  wetUntil: number;
  crop: CropState | null;
}

export interface World {
  w: number;
  h: number;
  ground: Ground[];
  objects: WorldObject[];
  /** Canteiros arados, indexados por `tileKey`. */
  soil: Record<number, SoilTile>;
  nextId: number;
  /** Incrementado sempre que objetos são adicionados/removidos (invalida o índice). */
  rev: number;
}

export const SOLID: Record<ObjKind, boolean> = {
  tree: true, stump: true, rock: true, bush: true, flower: false, house: true, shop: true, bin: true,
  door: true, bed: true, chest: true, table: true, fireplace: true, shelf: true, window: true, rug: false,
  pot: true, coffeebar: true, cafetable: true, chair: true,
};

/** Objetos desenhados rente ao chão (o jogador passa por cima). */
export const FLAT: Partial<Record<ObjKind, boolean>> = { rug: true, door: true };

export const inBounds = (w: World, x: number, y: number) => x >= 0 && y >= 0 && x < w.w && y < w.h;
export const tileKey = (w: World, x: number, y: number) => y * w.w + x;

const indexCache = new WeakMap<World, { rev: number; grid: (WorldObject | undefined)[] }>();

export function objectAt(world: World, x: number, y: number): WorldObject | undefined {
  if (!inBounds(world, x, y)) return undefined;
  let c = indexCache.get(world);
  if (!c || c.rev !== world.rev) {
    const grid: (WorldObject | undefined)[] = new Array(world.w * world.h);
    for (const o of world.objects) {
      for (let yy = o.y; yy < o.y + o.h; yy++) for (let xx = o.x; xx < o.x + o.w; xx++) grid[yy * world.w + xx] = o;
    }
    c = { rev: world.rev, grid };
    indexCache.set(world, c);
  }
  return c.grid[y * world.w + x];
}

export function touch(world: World) {
  world.rev++;
}

export function isBlocked(world: World, x: number, y: number): boolean {
  if (!inBounds(world, x, y)) return true;
  const g = world.ground[tileKey(world, x, y)];
  if (g === G.water || g === G.wall) return true;
  const o = objectAt(world, x, y);
  return !!o && SOLID[o.kind];
}

export function addObject(world: World, o: Omit<WorldObject, 'id'>): WorldObject {
  const obj = { ...o, id: world.nextId++ };
  world.objects.push(obj);
  touch(world);
  return obj;
}

export function removeObject(world: World, o: WorldObject) {
  const i = world.objects.indexOf(o);
  if (i >= 0) world.objects.splice(i, 1);
  touch(world);
}

export const LAYOUT = {
  size: { w: 56, h: 40 },
  house: { x: 6, y: 4, w: 5, h: 4 },
  houseDoor: { x: 8, y: 7 },
  shop: { x: 41, y: 4, w: 4, h: 3 },
  bin: { x: 11, y: 7, w: 1, h: 1 },
  spawn: { x: 8.5, y: 8.5 },
  pond: { cx: 44, cy: 28, rx: 6.5, ry: 4.5 },
  farm: { x0: 9, y0: 11, x1: 32, y1: 27 },
  starter: { x: 10, y: 12, w: 6, h: 3 },
  interior: { w: 14, h: 10, door: { x: 7, y: 9 }, spawn: { x: 7.5, y: 8.5 } },
};

/** Interior da casa: sala com lareira, cama, baú e o cantinho do café. */
export function generateInterior(): World {
  const { w: W, h: H, door } = LAYOUT.interior;
  const ground: Ground[] = new Array(W * H).fill(G.floor);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (y <= 1 || x === 0 || x === W - 1 || y === H - 1) ground[y * W + x] = G.wall;
    }
  }
  const world: World = { w: W, h: H, ground, objects: [], soil: {}, nextId: 1, rev: 0 };
  const put = (kind: ObjKind, x: number, y: number, w = 1, h = 1, variant = 0) =>
    addObject(world, { kind, x, y, w, h, hp: 0, variant });
  put('door', door.x, door.y);
  // parede do fundo
  put('window', 2, 1);
  put('fireplace', 5, 1, 2, 1);
  put('shelf', 8, 1, 2, 1);
  put('window', 11, 1);
  // cantinho do café
  put('coffeebar', 1, 2, 2, 1);
  put('chair', 1, 4, 1, 1, 0);
  put('cafetable', 2, 4);
  put('chair', 3, 4, 1, 1, 1);
  put('pot', 1, 8, 1, 1, 0);
  // sala
  put('rug', 5, 4, 4, 3);
  put('table', 6, 5, 2, 1);
  // quarto
  put('bed', 11, 2, 2, 2);
  put('chest', 12, 5).slots = emptySlots(CHEST_SIZE);
  put('pot', 12, 8, 1, 1, 1);
  return world;
}

export function generateWorld(seed: number): World {
  const { w: W, h: H } = LAYOUT.size;
  const rnd = makeRng(seed);
  const ground: Ground[] = new Array(W * H).fill(G.grass);
  const world: World = { w: W, h: H, ground, objects: [], soil: {}, nextId: 1, rev: 0 };
  const set = (x: number, y: number, g: Ground) => {
    if (inBounds(world, x, y)) ground[y * W + x] = g;
  };

  // lago com prainha
  const { cx, cy, rx, ry } = LAYOUT.pond;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
      if (d < 1) set(x, y, G.water);
      else if (d < 1.5) set(x, y, G.sand);
    }
  }

  // caminhos: casa -> loja, e loja -> lago
  for (let x = 6; x <= 47; x++) set(x, 9, G.path);
  set(8, 8, G.path);
  for (let y = 7; y <= 8; y++) set(43, y, G.path);
  for (let y = 10; y < H; y++) {
    if (ground[y * W + 44] !== G.grass) break;
    set(44, y, G.path);
  }

  const reserved = new Uint8Array(W * H);
  const reserve = (r: { x: number; y: number; w: number; h: number }, m = 1) => {
    for (let yy = r.y - m; yy < r.y + r.h + m; yy++) {
      for (let xx = r.x - m; xx < r.x + r.w + m; xx++) if (inBounds(world, xx, yy)) reserved[yy * W + xx] = 1;
    }
  };
  reserve(LAYOUT.house);
  reserve(LAYOUT.shop);
  reserve(LAYOUT.bin);
  reserve(LAYOUT.starter);

  const building = (kind: ObjKind, r: { x: number; y: number; w: number; h: number }) =>
    addObject(world, { kind, ...r, hp: 0, variant: 0 });
  building('house', LAYOUT.house);
  building('shop', LAYOUT.shop);
  building('bin', LAYOUT.bin);

  const st = LAYOUT.starter;
  for (let y = st.y; y < st.y + st.h; y++) {
    for (let x = st.x; x < st.x + st.w; x++) world.soil[tileKey(world, x, y)] = { wetUntil: 0, crop: null };
  }

  // natureza: floresta na borda, pedras na área de plantio, decoração no resto
  const f = LAYOUT.farm;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      if (reserved[k] || ground[k] !== G.grass) continue;
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      const inFarm = x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1;
      const r = rnd();
      let kind: ObjKind | null = null;
      if (edge <= 1) kind = 'tree';
      else if (edge === 2) kind = r < 0.6 ? 'tree' : null;
      else if (edge === 3) kind = r < 0.25 ? 'tree' : null;
      else if (inFarm) kind = r < 0.03 ? 'rock' : r < 0.04 ? 'flower' : null;
      else kind = r < 0.035 ? 'tree' : r < 0.05 ? 'rock' : r < 0.065 ? 'bush' : r < 0.11 ? 'flower' : null;
      const v = rnd();
      if (!kind) continue;
      addObject(world, {
        kind, x, y, w: 1, h: 1,
        hp: kind === 'tree' ? 3 : kind === 'rock' ? 2 : 1,
        variant: kind === 'tree' ? (v < 0.35 ? 1 : 0) : Math.floor(v * 4),
      });
    }
  }
  return world;
}
