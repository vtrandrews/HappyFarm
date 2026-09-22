import type { ItemId } from '../core/data';
import { cropStage, isRipe, targetRect } from '../core/rules';
import type { GameState, PlayerState } from '../core/state';
import { FLAT, tileKey, type World, type WorldObject } from '../core/world';
import {
  OBJ_LIGHTS, T, cropSprite, icon, objectSprite, playerFrames, renderGround, shadowSprite, soilSprite,
} from './sprites';

export interface View {
  zoom: number;
  ox: number;
  oy: number;
  w: number;
  h: number;
}

export interface Float {
  x: number;
  y: number;
  text: string;
  color: string;
  t: number;
  dur: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

export interface Hover {
  x: number;
  y: number;
  active: boolean;
  reach: boolean;
  label: string | null;
}

export interface PlayerAnim {
  frame: number;
  swing: { item: ItemId; t: number } | null;
}

export interface DrawInput {
  state: GameState;
  world: World;
  /** Mapa interno (casa): iluminação aconchegante, sem céu. */
  indoor: boolean;
  now: number;
  time: number;
  dpr: number;
  localId: string;
  anim: Record<string, PlayerAnim>;
  hover: Hover | null;
  floats: Float[];
  particles: Particle[];
  shakes: Map<number, number>;
  light: Daylight;
}

export interface Daylight {
  dark: number;
  tint: string | null;
}

/** Luz do dia baseada no relógio real do PC. */
export function daylight(date: Date): Daylight {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 7 && h < 17) return { dark: 0, tint: null };
  if (h >= 17 && h < 19) {
    const t = (h - 17) / 2;
    return { dark: t * 0.25, tint: `rgba(255,120,40,${(0.05 + t * 0.1).toFixed(3)})` };
  }
  if (h >= 19 && h < 20.5) return { dark: 0.25 + ((h - 19) / 1.5) * 0.3, tint: 'rgba(255,110,60,0.05)' };
  if (h >= 5 && h < 7) {
    const t = (h - 5) / 2;
    return { dark: 0.55 * (1 - t), tint: `rgba(255,170,130,${(0.08 * (1 - t)).toFixed(3)})` };
  }
  return { dark: 0.55, tint: null };
}

const SWING_S = 0.25;

/** Chave do sprite; a lareira anima trocando de frame. */
const spriteKey = (o: WorldObject, time: number) =>
  `${o.kind}:${o.kind === 'fireplace' ? Math.floor(time * 5) % 2 : o.variant}`;

export class Renderer {
  private grounds = new WeakMap<World, HTMLCanvasElement[]>();
  private lightCanvas = document.createElement('canvas');

  private groundOf(world: World) {
    let g = this.grounds.get(world);
    if (!g) this.grounds.set(world, (g = [0, 1, 2].map((f) => renderGround(world, f))));
    return g;
  }

  computeView(world: World, W: number, H: number, zoom: number, fx: number, fy: number): View {
    const ww = world.w * T;
    const wh = world.h * T;
    const vw = W / zoom;
    const vh = H / zoom;
    const cx = vw >= ww ? (ww - vw) / 2 : Math.min(Math.max(fx - vw / 2, 0), ww - vw);
    const cy = vh >= wh ? (wh - vh) / 2 : Math.min(Math.max(fy - vh / 2, 0), wh - vh);
    return { zoom, ox: Math.round(-cx * zoom), oy: Math.round(-cy * zoom), w: W, h: H };
  }

  draw(ctx: CanvasRenderingContext2D, v: View, s: DrawInput) {
    const w = s.world;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = s.indoor ? '#140d07' : '#24461f';
    ctx.fillRect(0, 0, v.w, v.h);
    ctx.setTransform(v.zoom, 0, 0, v.zoom, v.ox, v.oy);

    ctx.drawImage(this.groundOf(w)[Math.floor(s.time / 0.7) % 3], 0, 0);

    const x0 = Math.floor(-v.ox / v.zoom / T) - 1;
    const y0 = Math.floor(-v.oy / v.zoom / T) - 1;
    const x1 = Math.ceil((v.w - v.ox) / v.zoom / T) + 1;
    const y1 = Math.ceil((v.h - v.oy) / v.zoom / T) + 3;
    const visible = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

    // canteiros
    const drawables: { y: number; draw: () => void }[] = [];
    for (const ks in w.soil) {
      const k = Number(ks);
      const x = k % w.w;
      const y = (k - x) / w.w;
      if (!visible(x, y)) continue;
      const soil = w.soil[k];
      const has = (dx: number, dy: number) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx >= 0 && ny >= 0 && nx < w.w && ny < w.h && tileKey(w, nx, ny) in w.soil;
      };
      const mask = (has(0, -1) ? 1 : 0) | (has(1, 0) ? 2 : 0) | (has(0, 1) ? 4 : 0) | (has(-1, 0) ? 8 : 0);
      ctx.drawImage(soilSprite(mask + (soil.wetUntil > s.now ? 16 : 0)), x * T, y * T);
      const crop = soil.crop;
      if (crop) {
        drawables.push({
          y: (y + 1) * T - 4,
          draw: () => {
            const stage = cropStage(crop);
            ctx.drawImage(cropSprite(`${crop.id}:${stage}`), x * T, y * T - 8);
            if (isRipe(crop)) this.sparkle(ctx, x * T + 12, y * T - 4, s.time + k);
          },
        });
      }
    }

    // objetos
    const local = s.state.players[s.localId];
    for (const o of w.objects) {
      if (o.x + o.w < x0 || o.x > x1 || o.y > y1 || o.y + o.h + 2 < y0) continue;
      const spr = objectSprite(spriteKey(o, s.time));
      const footY = (o.y + o.h) * T;
      if (FLAT[o.kind]) {
        ctx.drawImage(spr, o.x * T, o.y * T);
        continue;
      }
      drawables.push({
        y: footY,
        draw: () => {
          let sx = o.x * T + (o.w * T - spr.width) / 2;
          const sy = footY - spr.height;
          const shake = s.shakes.get(o.id);
          if (shake !== undefined && s.time - shake < 0.25) sx += Math.round(Math.sin((s.time - shake) * 60));
          if (o.kind === 'tree' || o.kind === 'bush') ctx.drawImage(shadowSprite(o.kind === 'tree' ? 18 : 14), o.x * T + (o.kind === 'tree' ? -1 : 1), footY - 4);
          // árvore na frente do jogador fica translúcida
          const behind =
            o.kind === 'tree' && local && local.y * T < footY && Math.abs(local.x * T - (sx + spr.width / 2)) < 14 &&
            local.y * T > sy + 4;
          if (behind) ctx.globalAlpha = 0.55;
          ctx.drawImage(spr, sx, sy);
          ctx.globalAlpha = 1;
        },
      });
    }

    // jogadores
    const here = Object.values(s.state.players).filter((p) => p.location === local?.location);
    for (const p of here) {
      drawables.push({ y: p.y * T, draw: () => this.drawPlayer(ctx, p, s.anim[p.id]) });
    }

    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.draw();

    for (const pt of s.particles) {
      ctx.globalAlpha = Math.min(1, pt.life / pt.max + 0.3);
      ctx.fillStyle = pt.color;
      ctx.fillRect(Math.round(pt.x), Math.round(pt.y), pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    if (s.hover) {
      const r = targetRect(w, s.hover.x, s.hover.y);
      ctx.lineWidth = 1;
      ctx.strokeStyle = s.hover.active
        ? s.hover.reach ? '#fff27a' : 'rgba(255,255,255,0.85)'
        : 'rgba(255,255,255,0.3)';
      ctx.strokeRect(r.x * T + 0.5, r.y * T + 0.5, r.w * T - 1, r.h * T - 1);
    }

    // ---- espaço de tela ----
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawLighting(ctx, v, s);
    this.drawFloats(ctx, v, s);
    if (s.hover?.label) this.drawLabel(ctx, v, s);
  }

  private sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
    const phase = (t * 1.3) % 1.6;
    if (phase > 0.9) return;
    const bob = Math.round(Math.sin(t * 3) * 1.5);
    ctx.fillStyle = '#fffbe0';
    ctx.fillRect(x, y + bob - 1, 1, 3);
    ctx.fillRect(x - 1, y + bob, 3, 1);
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, p: PlayerState, anim?: PlayerAnim) {
    const frames = playerFrames(p.color)[p.facing];
    const px = Math.round(p.x * T);
    const py = Math.round(p.y * T);
    ctx.drawImage(shadowSprite(12), px - 6, py - 3);
    const swing = anim?.swing;
    const toolBehind = swing && p.facing === 'up';
    if (toolBehind) this.drawSwing(ctx, p, px, py, swing);
    ctx.drawImage(frames[anim?.frame ?? 0], px - 8, py - 23);
    if (swing && !toolBehind) this.drawSwing(ctx, p, px, py, swing);
  }

  private drawSwing(ctx: CanvasRenderingContext2D, p: PlayerState, px: number, py: number, swing: { item: ItemId; t: number }) {
    const k = Math.min(1, swing.t / SWING_S);
    const dir = p.facing === 'left' ? -1 : 1;
    const ang = (-1.1 + k * 1.9) * dir;
    const off = { down: [4, -8], up: [-3, -14], left: [-6, -10], right: [6, -10] }[p.facing];
    ctx.save();
    ctx.translate(px + off[0], py + off[1]);
    ctx.rotate(ang);
    if (dir < 0) ctx.scale(-1, 1);
    ctx.drawImage(icon(swing.item), -3, -13);
    ctx.restore();
  }

  private drawLighting(ctx: CanvasRenderingContext2D, v: View, s: DrawInput) {
    // dentro de casa: nunca fica breu, e a lareira ilumina
    const dark = s.indoor ? Math.max(0.06, s.light.dark * 0.7) : s.light.dark;
    const tint = s.indoor ? null : s.light.tint;
    if (tint) {
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, v.w, v.h);
    }
    if (dark <= 0.01) return;
    const L = this.lightCanvas;
    if (L.width !== v.w || L.height !== v.h) {
      L.width = v.w;
      L.height = v.h;
    }
    const lc = L.getContext('2d')!;
    lc.globalCompositeOperation = 'source-over';
    lc.clearRect(0, 0, v.w, v.h);
    lc.fillStyle = `rgba(14,18,52,${dark})`;
    lc.fillRect(0, 0, v.w, v.h);

    const lights: [x: number, y: number, r: number, warm: boolean][] = [];
    const local = s.state.players[s.localId];
    for (const p of Object.values(s.state.players)) {
      if (p.location === local?.location) lights.push([p.x * T, p.y * T - 8, (s.indoor ? 2.5 : 3.5) * T, false]);
    }
    const flicker = 1 + Math.sin(s.time * 9) * 0.04 + Math.sin(s.time * 23) * 0.02;
    for (const o of s.world.objects) {
      const defs = OBJ_LIGHTS[o.kind];
      if (!defs) continue;
      const spr = objectSprite(spriteKey(o, s.time));
      const sx = o.x * T + (o.w * T - spr.width) / 2;
      const sy = (o.y + o.h) * T - spr.height;
      const f = o.kind === 'fireplace' ? flicker : 1;
      for (const [lx, ly, r] of defs) lights.push([sx + lx, sy + ly, r * T * f, true]);
    }

    lc.globalCompositeOperation = 'destination-out';
    for (const [x, y, r] of lights) {
      const sx = x * v.zoom + v.ox;
      const sy = y * v.zoom + v.oy;
      const rr = r * v.zoom;
      if (sx < -rr || sy < -rr || sx > v.w + rr || sy > v.h + rr) continue;
      const g = lc.createRadialGradient(sx, sy, 0, sx, sy, rr);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.6)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lc.fillStyle = g;
      lc.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
    }
    ctx.drawImage(L, 0, 0);

    ctx.globalCompositeOperation = 'lighter';
    for (const [x, y, r, warm] of lights) {
      if (!warm) continue;
      const sx = x * v.zoom + v.ox;
      const sy = y * v.zoom + v.oy;
      const rr = r * v.zoom * 0.8;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rr);
      g.addColorStop(0, `rgba(255,190,90,${(0.35 * dark).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,190,90,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawFloats(ctx: CanvasRenderingContext2D, v: View, s: DrawInput) {
    const size = Math.round(12 * s.dpr);
    ctx.font = `800 ${size}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const f of s.floats) {
      const k = f.t / f.dur;
      const x = f.x * T * v.zoom + v.ox;
      const y = (f.y * T - k * 14) * v.zoom + v.oy;
      ctx.globalAlpha = 1 - k * k;
      ctx.lineWidth = 3 * s.dpr;
      ctx.strokeStyle = 'rgba(30,18,6,0.9)';
      ctx.strokeText(f.text, x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  private drawLabel(ctx: CanvasRenderingContext2D, v: View, s: DrawInput) {
    const h = s.hover!;
    const r = targetRect(s.world, h.x, h.y);
    const size = Math.round(11 * s.dpr);
    ctx.font = `700 ${size}px "Segoe UI", system-ui, sans-serif`;
    const text = h.label!;
    const tw = ctx.measureText(text).width;
    const pad = 5 * s.dpr;
    const bw = tw + pad * 2;
    const bh = size + pad * 1.2;
    let x = (r.x + r.w / 2) * T * v.zoom + v.ox - bw / 2;
    let y = r.y * T * v.zoom + v.oy - bh - 4 * s.dpr;
    x = Math.max(4, Math.min(v.w - bw - 4, x));
    if (y < 4) y = (r.y + r.h) * T * v.zoom + v.oy + 4 * s.dpr;
    ctx.fillStyle = 'rgba(43,26,10,0.88)';
    ctx.beginPath();
    ctx.roundRect(x, y, bw, bh, 4 * s.dpr);
    ctx.fill();
    ctx.fillStyle = h.active ? '#fff6d8' : '#d9cdb0';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + pad, y + bh / 2 + s.dpr * 0.5);
  }
}

