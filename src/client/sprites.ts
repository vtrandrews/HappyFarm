// Pixel art 100% procedural: nada de assets externos pra baixar/licenciar.
// Tudo é desenhado uma vez em canvases pequenos e reaproveitado (cache).

import { CROPS, ITEMS, type CropDef, type CropId, type Dir, type ItemId } from '../core/data';
import { makeRng } from '../core/rng';
import { G, type ObjKind, type World } from '../core/world';

export const T = 16;

export class Painter {
  constructor(readonly ctx: CanvasRenderingContext2D) {}

  r(x: number, y: number, w: number, h: number, c: string) {
    this.ctx.fillStyle = c;
    this.ctx.fillRect(x, y, w, h);
  }

  p(x: number, y: number, c: string) {
    this.r(x, y, 1, 1, c);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: string) {
    this.ctx.fillStyle = c;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  circle(cx: number, cy: number, r: number, c: string) {
    this.ellipse(cx, cy, r, r, c);
  }

  /**
   * Linha de pixels (Bresenham). As pontas são **arredondadas de propósito**: o laço só termina na
   * igualdade exata, então coordenada fracionária (vinda de um cálculo de sprite, por exemplo)
   * travava o navegador pra sempre. Já aconteceu no HappyKingdom.
   */
  line(x0: number, y0: number, x1: number, y1: number, c: string) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    this.ctx.fillStyle = c;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.ctx.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
}

export function paint(w: number, h: number, fn: (g: Painter) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  fn(new Painter(c.getContext('2d')!));
  return c;
}

function flipH(src: HTMLCanvasElement) {
  return paint(src.width, src.height, (g) => {
    g.ctx.translate(src.width, 0);
    g.ctx.scale(-1, 1);
    g.ctx.drawImage(src, 0, 0);
  });
}

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  return '#' + ((1 << 24) | (f((n >> 16) & 255) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).slice(1);
}

function cached<K, V>(fn: (k: K) => V): (k: K) => V {
  const m = new Map<K, V>();
  return (k) => {
    let v = m.get(k);
    if (v === undefined) m.set(k, (v = fn(k)));
    return v;
  };
}

const C = {
  grass: '#6db04a', grassL: '#80c45c', grassD: '#5e9e3f', blade: '#4f8a34',
  path: '#cfae78', pathL: '#dcbf8e', pathD: '#b8955f',
  sand: '#ead8a0', sandL: '#f5e8bd', sandD: '#d8c285',
  water: '#3f93d6', waterD: '#3483c4', waterL: '#7cbdf0', foam: '#b9e2fa',
  wood: '#8a5a2b', woodD: '#6e4420', woodL: '#b07a45',
  stone: '#8d8f97', stoneD: '#6d6f77', stoneL: '#b3b5bc',
  ink: '#2b1d12',
};

// ---------------------------------------------------------------- chão

const hash = (x: number, y: number) => (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) | 0;

function drawGrass(g: Painter, rnd: () => number) {
  g.r(0, 0, 16, 16, C.grass);
  for (let i = 0; i < 12; i++) g.p((rnd() * 16) | 0, (rnd() * 16) | 0, rnd() < 0.5 ? C.grassL : C.grassD);
  for (let i = 0; i < 3; i++) {
    const x = 1 + ((rnd() * 14) | 0);
    const y = 2 + ((rnd() * 13) | 0);
    g.p(x, y, C.blade);
    g.p(x - 1, y - 1, C.blade);
    g.p(x + 1, y - 1, C.blade);
  }
  if (rnd() < 0.05) {
    const x = 2 + ((rnd() * 12) | 0);
    const y = 2 + ((rnd() * 12) | 0);
    g.p(x, y, '#f7f3d0');
    g.p(x + 1, y + 1, '#f7f3d0');
  }
}

function drawSpeckled(g: Painter, rnd: () => number, base: string, light: string, dark: string) {
  g.r(0, 0, 16, 16, base);
  for (let i = 0; i < 14; i++) g.p((rnd() * 16) | 0, (rnd() * 16) | 0, rnd() < 0.5 ? light : dark);
  if (rnd() < 0.3) {
    const x = 2 + ((rnd() * 12) | 0);
    const y = 2 + ((rnd() * 12) | 0);
    g.r(x, y, 2, 1, dark);
  }
}

function drawWater(g: Painter, rnd: () => number, frame: number) {
  // sorteia tudo antes, pra consumir o rng igual em todos os frames
  const a = [rnd(), rnd(), rnd(), rnd(), rnd(), rnd(), rnd()];
  g.r(0, 0, 16, 16, C.water);
  g.p((a[4] * 16) | 0, (a[5] * 16) | 0, C.waterD);
  const s = frame;
  g.r(((a[0] * 12) | 0) + s, 2 + ((a[1] * 5) | 0), 3, 1, C.waterL);
  g.r(((a[2] * 12) | 0) + 2 - s, 9 + ((a[3] * 5) | 0), 3, 1, C.waterL);
  if (a[6] < 0.15 && frame === 1) g.p((a[0] * 14) | 0, (a[3] * 14) | 0, '#e6f6ff');
}

function drawFloor(g: Painter, rnd: () => number, x: number, y: number) {
  g.r(0, 0, 16, 16, '#b5834f');
  for (let row = 0; row < 4; row++) {
    const yy = row * 4;
    g.r(0, yy, 16, 1, '#c4935d');
    g.r(0, yy + 3, 16, 1, '#8f6238');
    g.r((x * 7 + y * 3 + row * 5) % 16, yy, 1, 3, '#8f6238');
    if (rnd() < 0.4) g.p((rnd() * 16) | 0, yy + 1 + ((rnd() * 2) | 0), '#a6763f');
  }
}

/** Parede: "face" (virada pra sala, com papel de parede) ou topo escuro com borda. */
function drawWall(g: Painter, face: boolean, edges: boolean[]) {
  if (face) {
    g.r(0, 0, 16, 16, '#e9d5a9');
    for (let x = 0; x < 16; x += 4) g.r(x, 0, 1, 10, '#dcc293');
    g.r(0, 9, 16, 1, '#7a4a24');
    g.r(0, 10, 16, 6, '#9b6b3c');
    g.r(0, 10, 16, 1, '#b8844f');
    g.r(0, 15, 16, 1, '#5e3a18');
    return;
  }
  g.r(0, 0, 16, 16, '#4a2c14');
  g.p(5, 6, '#553318');
  g.p(11, 11, '#553318');
  const [up, right, down, left] = edges;
  if (up) g.r(0, 0, 16, 3, '#6e4420');
  if (right) g.r(13, 0, 3, 16, '#6e4420');
  if (down) g.r(0, 13, 16, 3, '#6e4420');
  if (left) g.r(0, 0, 3, 16, '#6e4420');
}

/** Faixa irregular colorida na borda `side` (0 cima, 1 dir, 2 baixo, 3 esq). */
function edgeStrip(g: Painter, side: number, color: string, rnd: () => number, base = 1) {
  for (let i = 0; i < 16; i++) {
    const d = base + (rnd() < 0.45 ? 1 : 0);
    if (side === 0) g.r(i, 0, 1, d, color);
    else if (side === 1) g.r(16 - d, i, d, 1, color);
    else if (side === 2) g.r(i, 16 - d, 1, d, color);
    else g.r(0, i, d, 1, color);
  }
}

const GROUND_COLOR: Record<number, string> = {
  [G.grass]: C.grass, [G.dirt]: C.path, [G.path]: C.path, [G.sand]: C.sand, [G.water]: C.water,
};

export function renderGround(world: World, frame: number): HTMLCanvasElement {
  const { w: W, h: H, ground } = world;
  const at = (x: number, y: number, fallback: number) =>
    x < 0 || y < 0 || x >= W || y >= H ? fallback : ground[y * W + x];
  const NB = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  return paint(W * T, H * T, (g) => {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const kind = ground[y * W + x];
        const rnd = makeRng(hash(x, y));
        g.ctx.save();
        g.ctx.translate(x * T, y * T);
        if (kind === G.grass) drawGrass(g, rnd);
        else if (kind === G.path || kind === G.dirt) drawSpeckled(g, rnd, C.path, C.pathL, C.pathD);
        else if (kind === G.sand) drawSpeckled(g, rnd, C.sand, C.sandL, C.sandD);
        else if (kind === G.floor) drawFloor(g, rnd, x, y);
        else if (kind === G.wall) {
          const face = at(x, y + 1, G.wall) === G.floor;
          const floorish = (nx: number, ny: number) =>
            at(nx, ny, G.wall) === G.floor || (at(nx, ny, G.wall) === G.wall && at(nx, ny + 1, G.wall) === G.floor);
          drawWall(g, face, NB.map(([dx, dy]) => floorish(x + dx, y + dy)));
        } else drawWater(g, rnd, frame);

        if (kind === G.path || kind === G.dirt || kind === G.sand || kind === G.water) {
          for (let s = 0; s < 4; s++) {
            const nk = at(x + NB[s][0], y + NB[s][1], kind);
            if (kind === G.water && nk !== G.water) {
              edgeStrip(g, s, C.foam, rnd, 2);
              edgeStrip(g, s, GROUND_COLOR[nk], rnd, 1);
            } else if (kind !== G.water && nk === G.grass) {
              edgeStrip(g, s, C.grass, rnd, 1);
            }
          }
        }
        g.ctx.restore();
      }
    }
  });
}

// ---------------------------------------------------------------- canteiro

/** mask: 1 cima, 2 direita, 4 baixo, 8 esquerda = vizinho também é canteiro. */
export const soilSprite = cached((key: number) => {
  const mask = key & 15;
  const wet = key >= 16;
  const base = wet ? '#5d3b1e' : '#8e5d31';
  const dark = wet ? '#46291a' : '#734823';
  const light = wet ? '#6d4827' : '#a36f3e';
  return paint(16, 16, (g) => {
    const x0 = mask & 8 ? 0 : 1;
    const y0 = mask & 1 ? 0 : 1;
    const x1 = mask & 2 ? 16 : 15;
    const y1 = mask & 4 ? 16 : 15;
    g.r(x0, y0, x1 - x0, y1 - y0, base);
    for (const fy of [4, 8, 12]) {
      for (let x = x0 + 1; x < x1 - 1; x++) {
        if ((x + fy) % 4 !== 0) g.p(x, fy, dark);
        if ((x + fy) % 4 === 1) g.p(x, fy + 1, light);
      }
    }
    if (!(mask & 1)) g.r(x0, y0, x1 - x0, 1, light);
    if (!(mask & 4)) g.r(x0, y1 - 1, x1 - x0, 1, dark);
    if (!(mask & 8)) g.r(x0, y0, 1, y1 - y0, dark);
    if (!(mask & 2)) g.r(x1 - 1, y0, 1, y1 - y0, dark);
  });
});

// ---------------------------------------------------------------- plantações

function drawCrop(g: Painter, d: CropDef, stage: number) {
  if (stage === 0) {
    g.ellipse(8, 20, 3.5, 1.6, '#5a3818');
    g.p(7, 19, '#e3cf98');
    g.p(9, 20, '#e3cf98');
    return;
  }
  if (stage === 1) {
    g.r(8, 17, 1, 4, d.leafDark);
    g.r(6, 16, 2, 1, d.leaf);
    g.r(5, 15, 2, 1, d.leaf);
    g.r(9, 16, 2, 1, d.leaf);
    g.r(10, 15, 2, 1, d.leaf);
    g.p(7, 17, d.leafDark);
    g.p(9, 17, d.leafDark);
    return;
  }
  const ripe = stage === 3;
  switch (d.shape) {
    case 'leafy':
      if (!ripe) {
        g.ellipse(8, 18.5, 4, 2.6, d.leafDark);
        g.ellipse(8, 17.6, 3, 2, d.leaf);
        g.p(7, 16, d.fruitLight);
      } else {
        g.ellipse(8, 17, 6.5, 4.6, d.leafDark);
        g.ellipse(8, 16, 5.5, 3.8, d.leaf);
        g.ellipse(8, 15.5, 3.5, 2.6, d.fruit);
        g.p(6, 14, d.fruitLight);
        g.p(7, 13, d.fruitLight);
        g.p(5, 17, d.fruitDark);
        g.p(11, 17, d.fruitDark);
        g.p(9, 16, d.fruitDark);
      }
      break;
    case 'root': {
      const fronds = ripe ? [[4, 9], [7, 7], [10, 8], [13, 11]] : [[5, 13], [8, 12], [11, 13]];
      for (const [fx, fy] of fronds) {
        g.line(8, 19, fx, fy, d.leafDark);
        g.p(fx, fy, d.leaf);
        g.p(fx - 1, fy + 1, d.leaf);
        g.p(fx + 1, fy + 1, d.leaf);
      }
      if (ripe) {
        g.ellipse(8, 20, 3.2, 1.9, d.fruit);
        g.p(7, 19, d.fruitLight);
        g.p(9, 21, d.fruitDark);
      }
      break;
    }
    case 'vine': {
      g.r(11, ripe ? 4 : 9, 1, ripe ? 17 : 12, '#9b6b3c');
      const clusters = ripe
        ? [[7, 18, 3.2], [9, 13, 3.2], [6, 10, 2.6], [9, 6, 2.4]]
        : [[7, 18, 2.8], [9, 14, 2.6], [7, 11, 2]];
      for (const [x, y, r] of clusters) {
        g.circle(x, y, r, d.leafDark);
        g.circle(x - 0.5, y - 0.5, r - 1, d.leaf);
      }
      if (ripe) {
        for (const [x, y] of [[5, 17], [10, 12], [6, 9], [10, 18]]) {
          g.circle(x, y, 1.9, d.fruit);
          g.p(x - 1, y - 1, d.fruitLight);
          g.p(x, y + 1, d.fruitDark);
        }
      } else {
        g.circle(6, 17, 1.2, '#9ed36a');
      }
      break;
    }
    case 'tall': {
      const top = ripe ? 2 : 9;
      g.r(8, top, 1, 21 - top, d.leafDark);
      g.r(7, top + 2, 1, 19 - top, d.leaf);
      const leaves = ripe ? [18, 14, 10, 6] : [18, 14];
      leaves.forEach((yy, i) => {
        if (i % 2) g.line(8, yy, 13, yy - 3, d.leafDark);
        else g.line(7, yy, 2, yy - 3, d.leaf);
      });
      if (ripe) {
        g.p(8, 1, '#e2c96b');
        g.p(7, 2, '#e2c96b');
        g.p(9, 2, '#e2c96b');
        g.ellipse(10.5, 11, 1.7, 3.6, d.fruit);
        g.p(10, 9, d.fruitLight);
        g.p(11, 12, d.fruitDark);
        g.line(9, 15, 10, 13, d.leaf);
        g.line(12, 15, 11, 13, d.leaf);
      }
      break;
    }
    case 'berry':
      g.ellipse(8, 18, 6, 3.6, d.leafDark);
      g.ellipse(8, 17.2, 5, 2.8, d.leaf);
      g.p(5, 16, d.leafDark);
      g.p(10, 16, d.leafDark);
      if (!ripe) {
        for (const [x, y] of [[6, 15], [10, 16]]) {
          g.p(x, y, '#ffffff');
          g.p(x + 1, y, '#ffffff');
          g.p(x, y + 1, '#ffffff');
          g.p(x + 1, y + 1, '#f2d24c');
        }
      } else {
        for (const [x, y] of [[3, 18], [7, 15], [11, 17], [7, 19]]) {
          g.r(x, y, 2, 2, d.fruit);
          g.p(x + 1, y + 1, d.fruitDark);
          g.p(x, y, d.fruitLight);
          g.p(x + 1, y - 1, d.leafDark);
        }
      }
      break;
    case 'big':
      g.line(2, 19, 14, 19, d.leafDark);
      g.circle(4, 18, 2.6, d.leafDark);
      g.circle(12, 18, 2.6, d.leafDark);
      g.circle(8, 14.5, 2.6, d.leaf);
      if (!ripe) {
        g.circle(8, 18.5, 2.3, '#9fcf5a');
        g.p(7, 17, '#c8e98a');
      } else {
        g.ellipse(8, 17.5, 6.2, 4.3, d.fruit);
        g.r(5, 15, 1, 5, d.fruitDark);
        g.r(11, 15, 1, 5, d.fruitDark);
        g.r(8, 14, 1, 7, shade(d.fruit, -0.1));
        g.p(6, 15, d.fruitLight);
        g.p(7, 14, d.fruitLight);
        g.r(8, 12, 1, 2, '#6b8e23');
        g.p(9, 12, '#6b8e23');
      }
      break;
  }
}

/** Planta num canvas 16x24: o tile ocupa as 16 linhas de baixo. */
export const cropSprite = cached((key: string) => {
  const [id, stage] = key.split(':');
  return paint(16, 24, (g) => drawCrop(g, CROPS[id as CropId], Number(stage)));
});

// ---------------------------------------------------------------- jogador

/** Aparência do personagem — parametrizada pra cada colega ter a sua no multiplayer. */
export interface Look {
  shirt: string;
  skin: string;
  hair: string;
}

export const DEFAULT_LOOK = { skin: '#f2c291', hair: '#6b4226' };

const OUTLINE = '#2a1a12';
const EYE = '#2b1d12';
const HAT = '#ecc766';
const HAT_D = '#c99a3c';
const HAT_L = '#fbe39a';
const BAND = '#c0452f';
const DENIM = '#3d6bb3';
const DENIM_D = '#2c4f8a';
const DENIM_L = '#5a88cf';
const BOOT = '#5a3a1c';
const BOOT_L = '#7a5230';
const BUTTON = '#f2c94c';

/**
 * Quadros: 0 parado · 1–4 caminhada (passo, passagem, passo, passagem) · 5 piscando.
 * Na "passagem" o corpo sobe 1px, o que dá o balanço da caminhada.
 */
export const PLAYER_FRAMES = 6;

/** Contorno escuro automático em volta de tudo que foi desenhado (estilo Stardew). */
function outline(c: HTMLCanvasElement) {
  const ctx = c.getContext('2d')!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const { data, width: W, height: H } = img;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && data[(y * W + x) * 4 + 3] > 0;
  const out: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) out.push(x, y);
    }
  }
  ctx.fillStyle = OUTLINE;
  for (let i = 0; i < out.length; i += 2) ctx.fillRect(out[i], out[i + 1], 1, 1);
  return c;
}

function drawHat(g: Painter, u: number, dx = 0) {
  // copa
  g.r(4 + dx, 1 + u, 8, 3, HAT);
  g.r(5 + dx, 1 + u, 3, 1, HAT_L);
  g.r(11 + dx, 1 + u, 1, 3, HAT_D);
  g.r(4 + dx, 3 + u, 8, 1, BAND);
  // aba
  g.r(2 + dx, 4 + u, 12, 2, HAT);
  g.r(2 + dx, 4 + u, 5, 1, HAT_L);
  g.r(2 + dx, 5 + u, 12, 1, HAT_D);
  for (let x = 3; x < 13; x += 3) g.p(x + dx, 4 + u, HAT_D);
}

/** Pernas e botas. `a`/`b`: x de cada perna; `la`/`lb`: comprimento (3 = pé levantado). */
function drawLegs(g: Painter, a: number, la: number, b: number, lb: number, backDark: boolean) {
  const leg = (x: number, len: number, color: string) => {
    g.r(x, 17, 2, len, color);
    g.r(x, 17 + len, 2, 2, BOOT);
    g.p(x, 17 + len, BOOT_L);
  };
  leg(b, lb, backDark ? DENIM_D : DENIM);
  leg(a, la, DENIM);
}

function drawPlayer(g: Painter, look: Look, dir: 'down' | 'up' | 'left', frame: number) {
  const skin = look.skin;
  const skinD = shade(skin, -0.16);
  const hair = look.hair;
  const hairD = shade(hair, -0.3);
  const shirt = look.shirt;
  const shirtD = shade(shirt, -0.25);
  const shirtL = shade(shirt, 0.25);
  const walking = frame >= 1 && frame <= 4;
  const step = frame === 1 ? 1 : frame === 3 ? -1 : 0; // 1: perna esquerda à frente
  const u = frame === 2 || frame === 4 ? -1 : 0; // balanço do corpo

  if (dir === 'left') {
    // perfil: a perna/braço de trás ficam mais escuros
    const ax = 6 - step * (walking ? 1 : 0);
    const bx = 8 + step * (walking ? 1 : 0);
    drawLegs(g, ax, 4, bx, 4, true);
    // tronco
    g.r(5, 12 + u, 6, 5, shirt);
    g.r(10, 12 + u, 1, 5, shirtD);
    g.r(5, 14 + u, 6, 3, DENIM);
    g.r(5, 16 + u, 6, 1, DENIM_D);
    g.r(7, 12 + u, 1, 2, DENIM);
    g.p(7, 14 + u, BUTTON);
    // braço (balança pra frente e pra trás)
    const arm = 7 - step;
    g.r(arm, 12 + u, 2, 3, shirtD);
    g.r(arm, 15 + u, 2, 1, skin);
    g.p(arm, 16 + u, skinD);
    // cabeça
    g.r(4, 6 + u, 7, 5, skin);
    g.r(5, 11 + u, 5, 1, skinD);
    g.p(3, 9 + u, skin);
    g.r(8, 6 + u, 4, 4, hair);
    g.r(9, 10 + u, 2, 1, hairD);
    g.p(11, 9 + u, hairD);
    g.p(8, 8 + u, skinD);
    g.r(4, 6 + u, 4, 1, hair);
    g.r(5, 8 + u, 1, 2, EYE);
    if (frame === 5) g.r(5, 8 + u, 1, 1, skin);
    g.p(6, 10 + u, '#f0a28a');
    g.p(4, 10 + u, '#d98a6a');
    drawHat(g, u, -1);
    return;
  }

  // de frente / de costas
  const lLen = step === -1 ? 3 : 4;
  const rLen = step === 1 ? 3 : 4;
  drawLegs(g, 5, lLen, 9, rLen, false);

  // tronco e macacão
  g.r(4, 12 + u, 8, 5, shirt);
  g.r(11, 12 + u, 1, 5, shirtD);
  if (dir === 'down') {
    g.r(5, 14 + u, 6, 3, DENIM);
    g.r(5, 12 + u, 1, 2, DENIM);
    g.r(10, 12 + u, 1, 2, DENIM);
    g.p(5, 13 + u, BUTTON);
    g.p(10, 13 + u, BUTTON);
    g.r(7, 15 + u, 2, 1, DENIM_D);
    g.r(6, 14 + u, 4, 1, DENIM_L);
    g.r(6, 12 + u, 4, 1, shirtL);
    g.r(7, 12 + u, 2, 1, skinD); // pescoço
  } else {
    g.r(4, 15 + u, 8, 2, DENIM);
    g.p(5, 12 + u, DENIM);
    g.p(6, 13 + u, DENIM);
    g.p(10, 12 + u, DENIM);
    g.p(9, 13 + u, DENIM);
    g.r(7, 14 + u, 2, 1, DENIM);
  }
  g.r(4, 16 + u, 8, 1, DENIM_D);

  // braços (sobem/descem com o passo)
  const la = walking ? step : 0;
  g.r(3, 12 + u + Math.max(0, la), 1, 3, shirtD);
  g.r(3, 15 + u + Math.max(0, la), 1, 1, skin);
  g.r(12, 12 + u + Math.max(0, -la), 1, 3, shirtD);
  g.r(12, 15 + u + Math.max(0, -la), 1, 1, skin);

  // cabeça
  g.r(4, 6 + u, 8, 5, skin);
  g.r(5, 11 + u, 6, 1, skinD);
  g.r(11, 7 + u, 1, 4, skinD);
  if (dir === 'down') {
    g.r(4, 6 + u, 8, 1, hair);
    g.p(4, 7 + u, hair);
    g.p(11, 7 + u, hairD);
    g.p(4, 8 + u, hairD);
    g.p(6, 7 + u, hair);
    g.p(9, 7 + u, hair);
    if (frame === 5) {
      g.r(6, 9 + u, 1, 1, EYE);
      g.r(9, 9 + u, 1, 1, EYE);
    } else {
      g.r(6, 8 + u, 1, 2, EYE);
      g.r(9, 8 + u, 1, 2, EYE);
    }
    g.p(5, 10 + u, '#f0a28a');
    g.p(10, 10 + u, '#f0a28a');
    g.r(7, 10 + u, 2, 1, '#e0927a');
  } else {
    const hairL = shade(hair, 0.18);
    g.r(4, 6 + u, 8, 5, hair);
    g.r(4, 10 + u, 8, 1, hairD);
    // mechas: faixas verticais claras/escuras pra ler como nuca, não como rosto
    for (let x = 5; x < 11; x += 2) g.r(x, 7 + u, 1, 3, hairL);
    for (let x = 6; x < 12; x += 2) g.p(x, 9 + u, hairD);
    g.p(4, 8 + u, hairD);
    g.p(11, 8 + u, hairD);
    g.r(5, 11 + u, 6, 1, skinD);
  }
  drawHat(g, u);
}

export type PlayerFrames = Record<Dir, HTMLCanvasElement[]>;

export const playerFrames = cached((key: string): PlayerFrames => {
  const [shirt, skin = DEFAULT_LOOK.skin, hair = DEFAULT_LOOK.hair] = key.split('|');
  const look: Look = { shirt, skin, hair };
  const mk = (dir: 'down' | 'up' | 'left') =>
    Array.from({ length: PLAYER_FRAMES }, (_, f) => outline(paint(16, 24, (g) => drawPlayer(g, look, dir, f))));
  const left = mk('left');
  return { down: mk('down'), up: mk('up'), left, right: left.map(flipH) };
});

// ---------------------------------------------------------------- objetos

function tree(pine: boolean) {
  return paint(32, 40, (g) => {
    g.r(13, 26, 6, 13, '#7a4a24');
    g.r(13, 26, 2, 13, '#5b3518');
    g.r(11, 37, 2, 2, '#5b3518');
    g.r(19, 37, 2, 2, '#7a4a24');
    if (pine) {
      const layers = [[28, 13], [20, 11], [12, 8], [5, 5]];
      for (const [y, half] of layers) {
        for (let i = 0; i < 10; i++) {
          const w = Math.round(half * (i / 9)) + 1;
          g.r(16 - w, y - 9 + i, w * 2, 1, i < 3 ? '#4a9a5a' : '#2d6e3e');
          g.p(16 - w, y - 9 + i, '#24583a');
        }
      }
      g.p(15, 6, '#6cc07a');
      g.p(13, 14, '#6cc07a');
    } else {
      g.circle(16, 15, 12, '#2f7a34');
      g.circle(11, 13, 7.5, '#3f9442');
      g.circle(21, 12, 7.5, '#3f9442');
      g.circle(15, 8, 6.5, '#58ad4f');
      g.circle(22, 18, 5, '#3f9442');
      for (const [x, y] of [[13, 5], [11, 8], [19, 7], [24, 11], [9, 12]]) g.p(x, y, '#7cc96a');
      for (const [x, y] of [[8, 20], [20, 23], [14, 24]]) g.p(x, y, '#24602a');
    }
  });
}

const OBJ_DRAW: Partial<Record<ObjKind, (v: number) => HTMLCanvasElement>> = {
  tree: (v) => tree(v === 1),
  stump: () =>
    paint(16, 16, (g) => {
      g.r(4, 8, 8, 6, '#7a4a24');
      g.r(4, 8, 2, 6, '#5b3518');
      g.r(3, 13, 2, 2, '#5b3518');
      g.r(11, 13, 2, 2, '#7a4a24');
      g.ellipse(8, 8, 4, 2, '#c49a6c');
      g.p(8, 8, '#a37a4e');
      g.p(7, 7, '#a37a4e');
    }),
  rock: (v) =>
    paint(16, 16, (g) => {
      const big = v % 2 === 0;
      const rx = big ? 6 : 4.5;
      g.ellipse(8, 11, rx, big ? 4.5 : 3.5, C.stoneD);
      g.ellipse(7.5, 10, rx - 1, big ? 3.6 : 2.7, C.stone);
      g.p(5, 8, C.stoneL);
      g.p(6, 8, C.stoneL);
      g.p(5, 9, C.stoneL);
      if (v >= 2) {
        g.p(9, 8, '#6fa05a');
        g.p(10, 8, '#6fa05a');
      }
    }),
  bush: (v) =>
    paint(16, 18, (g) => {
      g.ellipse(8, 11, 7.5, 6.5, '#2f7a34');
      g.ellipse(7, 9, 5.5, 4.5, '#45994a');
      g.p(5, 6, '#6cbf62');
      g.p(6, 5, '#6cbf62');
      if (v % 2 === 0) for (const [x, y] of [[4, 11], [10, 9], [11, 13], [7, 13]]) g.p(x, y, '#e0423a');
    }),
  flower: (v) =>
    paint(16, 16, (g) => {
      const petal = ['#f5f06a', '#f58ab8', '#ffffff', '#9ab8ff'][v % 4];
      for (const [x, y] of [[4, 8], [10, 6], [8, 11]]) {
        g.r(x, y + 2, 1, 3, '#3f8a2c');
        g.p(x - 1, y, petal);
        g.p(x + 1, y, petal);
        g.p(x, y - 1, petal);
        g.p(x, y + 1, petal);
        g.p(x, y, '#f2b134');
      }
    }),
  house: () =>
    paint(80, 80, (g) => {
      g.r(4, 38, 72, 40, '#d49a5e');
      for (let y = 42; y < 76; y += 5) g.r(4, y, 72, 1, '#b87d45');
      g.r(4, 38, 2, 40, '#b87d45');
      g.r(74, 38, 2, 40, '#b87d45');
      g.r(2, 76, 76, 4, C.stone);
      for (let x = 2; x < 78; x += 6) g.r(x, 76, 1, 4, C.stoneD);
      for (let y = 6; y < 44; y++) {
        const inset = Math.round((44 - y) * 0.45);
        g.r(inset, y, 80 - inset * 2, 1, (y - 6) % 5 === 4 ? '#9c2b20' : '#c0392b');
      }
      g.r(0, 43, 80, 2, '#7d2219');
      g.r(17, 6, 46, 2, '#e0584a');
      g.r(58, 0, 8, 12, C.stone);
      g.r(57, 0, 10, 3, C.stoneD);
      g.r(33, 56, 14, 22, '#4a2a12');
      g.r(34, 57, 12, 21, '#7b4a22');
      g.r(38, 57, 1, 21, '#6b3f1d');
      g.r(42, 57, 1, 21, '#6b3f1d');
      g.p(44, 67, HAT);
      for (const wx of [12, 55]) {
        g.r(wx, 50, 14, 12, '#f5f0e6');
        g.r(wx + 1, 51, 12, 10, '#8fd0f0');
        g.r(wx + 7, 51, 1, 10, '#f5f0e6');
        g.r(wx + 1, 55, 12, 1, '#f5f0e6');
        g.p(wx + 2, 52, '#d8f1ff');
        g.p(wx + 3, 52, '#d8f1ff');
        g.r(wx - 1, 62, 16, 3, C.wood);
        for (let i = 0; i < 5; i++) g.p(wx + 1 + i * 3, 61, i % 2 ? '#f5f06a' : '#e0423a');
      }
    }),
  shop: () =>
    paint(64, 64, (g) => {
      g.r(6, 18, 52, 20, '#5e3a18');
      g.r(3, 10, 3, 30, C.wood);
      g.r(58, 10, 3, 30, C.wood);
      g.r(2, 38, 60, 26, C.woodL);
      for (let y = 44; y < 64; y += 6) g.r(2, y, 60, 1, '#946338');
      g.r(0, 36, 64, 4, C.wood);
      const crate = (x: number, fruit: string, dark: string) => {
        g.r(x, 29, 14, 7, '#9b6b3c');
        g.r(x, 29, 14, 1, C.woodD);
        g.r(x, 32, 14, 1, C.woodD);
        for (let i = 0; i < 4; i++) g.circle(x + 2.5 + i * 3, 28, 1.8, i % 2 ? dark : fruit);
      };
      crate(7, '#f08a24', '#c4621a');
      crate(25, '#e8403a', '#b02a25');
      crate(43, '#8fdc5a', '#4f9e34');
      for (let i = 0; i < 8; i++) {
        const c = i % 2 ? '#f5f0e6' : '#e74c3c';
        g.r(i * 8, 7, 8, 11, c);
        g.ellipse(i * 8 + 4, 18, 4, 2.2, c);
      }
      g.r(0, 5, 64, 3, '#b83227');
      g.r(22, 0, 20, 7, C.wood);
      g.r(23, 1, 18, 5, C.woodL);
      g.circle(32, 3.5, 2.5, '#f2c94c');
      g.p(31, 2, '#fff3b0');
    }),
  bin: () =>
    paint(16, 20, (g) => {
      g.r(1, 7, 14, 12, '#9b6b3c');
      g.r(1, 11, 14, 1, C.woodD);
      g.r(1, 15, 14, 1, C.woodD);
      g.r(0, 4, 16, 4, C.woodD);
      g.r(0, 4, 16, 1, '#8a5a2b');
      g.r(1, 7, 1, 12, '#c9c9c9');
      g.r(14, 7, 1, 12, '#c9c9c9');
      g.circle(8, 13, 2, '#f2c94c');
      g.p(7, 12, '#fff3b0');
    }),
};

const WOOD_D = '#7a4a24';

Object.assign(OBJ_DRAW, {
  door: () =>
    paint(16, 16, (g) => {
      g.r(1, 0, 14, 16, WOOD_D);
      g.r(2, 0, 12, 16, '#2a180b');
      g.r(3, 8, 10, 7, '#b04a3a');
      g.r(3, 10, 10, 1, '#e8c468');
      g.r(3, 13, 10, 1, '#e8c468');
    }),
  window: () =>
    paint(16, 16, (g) => {
      g.r(3, 1, 10, 9, '#f5f0e6');
      g.r(4, 2, 8, 7, '#9fd3f0');
      g.r(7, 2, 1, 7, '#f5f0e6');
      g.r(4, 5, 8, 1, '#f5f0e6');
      g.p(5, 3, '#d8f1ff');
      g.r(1, 0, 3, 11, '#c0453a');
      g.r(12, 0, 3, 11, '#c0453a');
      g.r(1, 0, 14, 1, WOOD_D);
    }),
  /** variant = frame da animação do fogo */
  fireplace: (frame: number) =>
    paint(32, 32, (g) => {
      g.r(1, 6, 30, 26, C.stone);
      for (let y = 10; y < 32; y += 5) g.r(1, y, 30, 1, C.stoneD);
      for (let y = 6; y < 32; y += 5) for (let x = y % 10 ? 4 : 9; x < 31; x += 10) g.r(x, y, 1, 5, C.stoneD);
      g.r(0, 4, 32, 4, WOOD_D);
      g.r(0, 4, 32, 1, '#9b6b3c');
      g.r(7, 14, 18, 18, '#241509');
      g.r(9, 28, 14, 3, '#6e4420');
      const f = frame % 2;
      g.ellipse(16, 25 - f, 6, 5 + f, '#e8562a');
      g.ellipse(15 + f, 26, 4, 4, '#f59a2c');
      g.ellipse(16, 27, 2.5, 2.5, '#ffe07a');
      g.p(12 + f * 7, 19, '#f59a2c');
      g.r(5, 1, 3, 3, '#f5f0e6');
      g.r(22, 0, 4, 4, '#c9a227');
    }),
  shelf: () =>
    paint(32, 30, (g) => {
      g.r(0, 0, 32, 30, WOOD_D);
      g.r(2, 2, 28, 26, '#4a2c14');
      const books = ['#c0453a', '#3f6fb5', '#4f9e34', '#e8c468', '#8a4fb5', '#e07a3a'];
      for (const sy of [2, 11, 20]) {
        g.r(2, sy + 7, 28, 2, '#9b6b3c');
        let x = 3;
        let i = sy;
        while (x < 28) {
          const w = 2 + (i % 2);
          const h = 5 + (i % 3 === 0 ? 1 : 0);
          if (i % 7 !== 3) g.r(x, sy + 7 - h, Math.min(w, 29 - x), h, books[i % books.length]);
          x += w + (i % 5 === 0 ? 1 : 0);
          i += 3;
        }
      }
    }),
  bed: () =>
    paint(32, 34, (g) => {
      g.r(0, 0, 32, 8, WOOD_D);
      g.r(2, 1, 28, 2, '#9b6b3c');
      g.r(1, 6, 30, 26, '#f5f0e6');
      g.r(4, 8, 10, 6, '#ffffff');
      g.r(18, 8, 10, 6, '#ffffff');
      g.r(4, 13, 10, 1, '#d9d2c0');
      g.r(18, 13, 10, 1, '#d9d2c0');
      g.r(1, 16, 30, 16, '#3f6fb5');
      for (let y = 16; y < 32; y += 4) for (let x = 1 + ((y / 4) % 2) * 4; x < 31; x += 8) g.r(x, y, 4, 4, '#5a86c9');
      g.r(1, 16, 30, 2, '#f5f0e6');
      g.r(0, 31, 32, 3, WOOD_D);
    }),
  chest: () =>
    paint(16, 16, (g) => {
      g.r(1, 6, 14, 9, '#9b6b3c');
      g.r(1, 3, 14, 4, WOOD_D);
      g.r(1, 3, 14, 1, '#b8844f');
      g.r(1, 7, 14, 1, '#5e3a18');
      g.r(3, 3, 1, 12, '#c9a227');
      g.r(12, 3, 1, 12, '#c9a227');
      g.r(7, 6, 2, 3, '#f2c94c');
      g.p(7, 7, '#5e3a18');
      g.r(1, 15, 14, 1, '#5e3a18');
    }),
  table: () =>
    paint(32, 22, (g) => {
      g.r(2, 12, 3, 10, WOOD_D);
      g.r(27, 12, 3, 10, WOOD_D);
      g.r(0, 4, 32, 9, '#b07a45');
      g.r(0, 4, 32, 1, '#c99561');
      g.r(0, 12, 32, 2, '#8a5a2b');
      g.r(6, 1, 4, 6, '#5a86c9');
      g.p(7, 0, '#f58ab8');
      g.p(8, 0, '#f5f06a');
      g.ellipse(22, 8, 4, 2, '#f5f0e6');
      g.ellipse(22, 8, 2, 1, '#e8403a');
    }),
  rug: () =>
    paint(64, 48, (g) => {
      g.r(0, 0, 64, 48, '#a8382f');
      g.r(3, 3, 58, 42, '#8f2d26');
      g.r(5, 5, 54, 38, '#a8382f');
      for (let y = 10; y < 40; y += 10) {
        for (let x = 10; x < 56; x += 12) {
          g.p(x, y, '#e8c468');
          g.p(x - 1, y + 1, '#e8c468');
          g.p(x + 1, y + 1, '#e8c468');
          g.p(x, y + 2, '#e8c468');
        }
      }
      for (let x = 0; x < 64; x += 3) {
        g.p(x, 0, '#e8c468');
        g.p(x, 47, '#e8c468');
      }
    }),
  pot: (v: number) =>
    paint(16, 22, (g) => {
      g.r(4, 14, 8, 7, '#c0663a');
      g.r(3, 13, 10, 2, '#d9794a');
      g.r(4, 20, 8, 1, '#8f4a2a');
      if (v % 2 === 0) {
        g.ellipse(8, 8, 5, 6, '#3f9442');
        g.ellipse(7, 6, 3, 3.5, '#58ad4f');
        g.line(8, 13, 8, 10, '#2f7a34');
      } else {
        g.r(7, 3, 3, 10, '#4f9e34');
        g.r(4, 6, 2, 4, '#4f9e34');
        g.r(4, 9, 3, 1, '#4f9e34');
        g.r(11, 5, 2, 4, '#4f9e34');
        g.r(10, 8, 2, 1, '#4f9e34');
        g.p(8, 2, '#f58ab8');
      }
    }),
  coffeebar: () =>
    paint(32, 30, (g) => {
      // balcão
      g.r(0, 14, 32, 16, '#8a5a2b');
      g.r(1, 18, 14, 11, '#9b6b3c');
      g.r(17, 18, 14, 11, '#9b6b3c');
      g.p(13, 23, '#e8c468');
      g.p(18, 23, '#e8c468');
      g.r(0, 12, 32, 4, '#e9e2d0');
      g.r(0, 15, 32, 1, '#bdb5a2');
      // cafeteira
      g.r(3, 1, 11, 12, '#3a3f47');
      g.r(3, 1, 11, 2, '#525862');
      g.r(5, 5, 7, 4, '#23272d');
      g.p(12, 3, '#e8403a');
      g.r(7, 9, 3, 1, '#23272d');
      g.r(6, 10, 5, 3, '#f5f0e6');
      g.r(7, 10, 3, 1, '#6b3f1d');
      // canecas e pacote de café
      g.r(17, 8, 4, 4, '#f5f0e6');
      g.r(21, 9, 1, 2, '#f5f0e6');
      g.r(17, 8, 4, 1, '#6b3f1d');
      g.r(24, 3, 6, 9, '#6b3f1d');
      g.r(24, 3, 6, 2, '#8a5a2b');
      g.r(25, 7, 4, 2, '#e8c468');
    }),
  cafetable: () =>
    paint(16, 18, (g) => {
      g.r(7, 9, 2, 8, WOOD_D);
      g.r(5, 16, 6, 2, WOOD_D);
      g.ellipse(8, 7, 7.5, 4, '#8a5a2b');
      g.ellipse(8, 6, 7, 3.5, '#b07a45');
      g.r(6, 3, 4, 4, '#f5f0e6');
      g.r(10, 4, 1, 2, '#f5f0e6');
      g.r(6, 3, 4, 1, '#6b3f1d');
      g.p(7, 1, '#ffffff');
      g.p(8, 0, '#ffffff');
    }),
  chair: (v: number) => {
    const c = paint(16, 18, (g) => {
      g.r(3, 1, 3, 16, WOOD_D);
      g.r(3, 1, 3, 1, '#9b6b3c');
      g.r(3, 9, 10, 3, '#9b6b3c');
      g.r(3, 9, 10, 1, '#b8844f');
      g.r(11, 12, 2, 5, WOOD_D);
      g.r(4, 12, 2, 5, WOOD_D);
    });
    return v === 1 ? flipH(c) : c;
  },
} satisfies Partial<Record<ObjKind, (v: number) => HTMLCanvasElement>>);

export const objectSprite = cached((key: string) => {
  const [kind, v] = key.split(':');
  return OBJ_DRAW[kind as ObjKind]!(Number(v));
});

/** Posições (no sprite) de onde sai luz à noite. */
export const OBJ_LIGHTS: Partial<Record<ObjKind, [x: number, y: number, r: number][]>> = {
  house: [[19, 56, 2.2], [62, 56, 2.2]],
  shop: [[32, 30, 2.6]],
  fireplace: [[16, 24, 4.5]],
};

export const shadowSprite = cached((w: number) =>
  paint(w, 6, (g) => g.ellipse(w / 2, 3, w / 2, 2.5, 'rgba(0,0,0,0.22)')),
);

// ---------------------------------------------------------------- ícones

export type IconId = ItemId | 'coin';

function drawIcon(g: Painter, id: IconId) {
  const crop = id in CROPS ? CROPS[id as CropId] : null;
  switch (id) {
    case 'coin':
      g.circle(8, 8, 6.5, '#c9a227');
      g.circle(8, 8, 5.5, '#f2c94c');
      g.r(7, 5, 2, 6, '#c9a227');
      g.p(5, 5, '#fff3b0');
      g.p(6, 4, '#fff3b0');
      return;
    case 'hoe':
      g.line(3, 14, 11, 4, C.wood);
      g.line(4, 14, 12, 4, C.woodD);
      g.r(9, 2, 6, 3, '#a0a4ad');
      g.r(12, 5, 3, 2, '#7d818a');
      g.p(9, 2, '#d6d9e0');
      return;
    case 'can':
      g.r(3, 7, 9, 7, '#5aa0d8');
      g.r(3, 12, 9, 2, '#3f7fb3');
      g.r(4, 4, 7, 1, '#3f7fb3');
      g.r(4, 4, 1, 4, '#3f7fb3');
      g.r(10, 4, 1, 4, '#3f7fb3');
      g.line(11, 9, 14, 6, '#3f7fb3');
      g.r(13, 5, 2, 2, '#5aa0d8');
      g.p(4, 8, '#a9d6f5');
      return;
    case 'axe':
      g.line(4, 14, 11, 4, C.wood);
      g.line(5, 14, 12, 4, C.woodD);
      g.r(8, 2, 6, 5, '#a0a4ad');
      g.r(13, 2, 1, 5, '#e3e6ec');
      g.p(8, 6, '#7d818a');
      return;
    case 'pickaxe':
      g.line(4, 14, 10, 5, C.wood);
      g.line(5, 14, 11, 5, C.woodD);
      g.line(3, 5, 7, 3, '#a0a4ad');
      g.line(7, 3, 11, 3, '#a0a4ad');
      g.line(11, 3, 14, 6, '#a0a4ad');
      g.line(4, 6, 8, 4, '#7d818a');
      g.line(11, 4, 13, 7, '#7d818a');
      return;
    case 'wood':
      g.r(2, 6, 11, 6, C.wood);
      g.r(2, 8, 11, 1, C.woodD);
      g.r(2, 11, 11, 1, C.woodD);
      g.ellipse(13, 9, 2.5, 3.2, '#d9b07a');
      g.p(13, 9, '#a37a4e');
      return;
    case 'coffee':
      g.r(3, 6, 8, 8, '#f5f0e6');
      g.r(3, 13, 8, 1, '#d9d2c0');
      g.r(11, 8, 3, 1, '#f5f0e6');
      g.r(13, 8, 1, 4, '#f5f0e6');
      g.r(11, 11, 3, 1, '#f5f0e6');
      g.r(4, 6, 6, 2, '#6b3f1d');
      g.p(5, 3, '#ffffff');
      g.p(6, 2, '#ffffff');
      g.p(8, 3, '#ffffff');
      g.p(9, 1, '#ffffff');
      return;
    case 'stone':
      g.ellipse(8, 10, 6, 4.5, C.stoneD);
      g.ellipse(7.5, 9.5, 4.8, 3.5, C.stone);
      g.p(5, 7, C.stoneL);
      g.p(6, 7, C.stoneL);
      return;
  }
  if (id.startsWith('seed_')) {
    const d = CROPS[ITEMS[id as ItemId].crop!];
    g.ellipse(8, 10, 5.5, 5, '#d9b77a');
    g.ellipse(8, 11, 4.5, 3.5, '#e8c98f');
    g.r(6, 3, 4, 3, '#a8844f');
    g.r(5, 5, 6, 1, '#8a6a3a');
    g.circle(8, 10.5, 2.2, d.fruit);
    g.p(7, 9, d.fruitLight);
    return;
  }
  if (!crop) return;
  switch (crop.shape) {
    case 'leafy':
      g.ellipse(8, 9, 6.5, 5.5, crop.leafDark);
      g.ellipse(8, 8.5, 5.5, 4.5, crop.leaf);
      g.ellipse(8, 8, 3.2, 2.6, crop.fruit);
      g.p(6, 6, crop.fruitLight);
      g.p(7, 5, crop.fruitLight);
      break;
    case 'root':
      for (let t = 0; t < 8; t++) g.circle(6 + t * 0.9, 7 + t, Math.max(0.7, 2.8 - t * 0.3), crop.fruit);
      g.p(7, 9, crop.fruitDark);
      g.p(9, 11, crop.fruitDark);
      g.p(5, 7, crop.fruitLight);
      g.line(5, 5, 2, 2, crop.leaf);
      g.line(6, 5, 6, 1, crop.leafDark);
      g.line(7, 5, 10, 2, crop.leaf);
      break;
    case 'vine':
      g.circle(8, 9.5, 5.5, crop.fruit);
      g.ellipse(8, 12.5, 3.5, 1.2, crop.fruitDark);
      g.p(5, 7, crop.fruitLight);
      g.p(6, 6, crop.fruitLight);
      g.r(6, 4, 5, 1, crop.leaf);
      g.p(8, 3, crop.leafDark);
      g.p(5, 5, crop.leaf);
      g.p(11, 5, crop.leaf);
      break;
    case 'tall':
      g.ellipse(8, 9, 3.6, 6.5, '#9fcf5a');
      g.ellipse(8, 8, 2.4, 5.2, crop.fruit);
      for (let y = 4; y < 13; y += 2) g.p(7, y, crop.fruitLight);
      for (let y = 5; y < 13; y += 2) g.p(9, y, crop.fruitDark);
      g.line(4, 15, 6, 9, crop.leaf);
      g.line(12, 15, 10, 9, crop.leafDark);
      break;
    case 'berry':
      g.ellipse(8, 9, 5, 4.2, crop.fruit);
      g.ellipse(8, 11.5, 3.2, 3.2, crop.fruit);
      g.p(8, 14, crop.fruit);
      for (const [x, y] of [[6, 8], [9, 9], [7, 11], [10, 7], [8, 13]]) g.p(x, y, '#ffe38a');
      g.r(5, 4, 7, 2, crop.leaf);
      g.p(8, 3, crop.leafDark);
      break;
    case 'big':
      g.ellipse(8, 10, 7, 5, crop.fruit);
      g.r(5, 7, 1, 7, crop.fruitDark);
      g.r(11, 7, 1, 7, crop.fruitDark);
      g.p(4, 8, crop.fruitLight);
      g.p(5, 7, crop.fruitLight);
      g.r(8, 3, 2, 3, '#6b8e23');
      break;
  }
}

export const icon = cached((id: IconId) => paint(16, 16, (g) => drawIcon(g, id)));
export const iconURL = cached((id: IconId) => icon(id).toDataURL());
