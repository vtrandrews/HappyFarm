import { CAFFEINE_SPEED, CROPS, HOTBAR_SIZE, REACH, type Dir } from '../core/data';
import { findPath } from '../core/path';
import {
  apply, chestInReach, countRipe, distToRect, findChest, inReach, interactionRect, isCaffeinated, isRipe,
  remainingMs, resolveUse, tick, type Action, type GameEvent,
} from '../core/rules';
import { LOCAL_ID, selectedItem, worldOf, type GameState, type LocationId, type PlayerState } from '../core/state';
import { LAYOUT, inBounds, isBlocked, objectAt, tileKey, type World } from '../core/world';
import { fmtDur } from './format';
import { Input } from './input';
import { MiniMode } from './mini';
import { Renderer, daylight, type Float, type Hover, type Particle, type PlayerAnim, type View } from './renderer';
import { clearGame, loadSettings, saveGame, saveSettings, type Settings } from './save';
import { T } from './sprites';
import { Hud } from './ui';

const SPEED = 4.2; // tiles/s
const HB_W = 0.28; // meia-largura da hitbox dos pés
const HB_H = 0.16;
const SWING_S = 0.25;
const AUTOSAVE_S = 5;

const FX_COLORS: Record<string, string[]> = {
  till: ['#8e5d31', '#734823', '#a36f3e'],
  water: ['#7cbdf0', '#3f93d6', '#b9e2fa'],
  refill: ['#7cbdf0', '#3f93d6', '#b9e2fa'],
  plant: ['#5cb83e', '#8e5d31'],
  chop: ['#8a5a2b', '#c49a6c', '#3f9442'],
  fell: ['#3f9442', '#58ad4f', '#2f7a34', '#8a5a2b'],
  break: ['#8d8f97', '#b3b5bc', '#6d6f77'],
  coffee: ['#6b3f1d', '#f5f0e6', '#c49a6c'],
};

export class GameClient {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private renderer: Renderer;
  private input = new Input();
  private hud: Hud;
  private mini: MiniMode;
  private settings: Settings = loadSettings();

  private win: Window = window;
  private loopToken = 0;
  private timers: number[] = [];
  private suspended = false;
  private dirty = false;
  private time = 0;

  private path: { x: number; y: number }[] = [];
  private pending: { x: number; y: number } | null = null;
  private moving = false;
  private walkT = 0;
  private anim: Record<string, PlayerAnim> = { [LOCAL_ID]: { frame: 0, swing: null } };
  private floats: Float[] = [];
  private particles: Particle[] = [];
  private shakes = new Map<number, number>();
  private mouse: { x: number; y: number } | null = null;
  /** Botão esquerdo segurado no chão: o fazendeiro segue o cursor. */
  private follow: { pointerId: number; tile: number; repathIn: number } | null = null;
  /** Deslocamento da câmera arrastada com o botão direito (px do mundo). */
  private pan = { x: 0, y: 0 };
  private panDrag: { pointerId: number; x: number; y: number } | null = null;
  private hover: Hover | null = null;
  private view: View = { zoom: 2, ox: 0, oy: 0, w: 1, h: 1 };
  private lastRipe = -1;
  private lastLocation: LocationId;
  /** Escurecimento de transição ao entrar/sair de casa (1 → 0). */
  private fade = 0;

  constructor(home: HTMLElement, public state: GameState) {
    this.root = document.createElement('div');
    this.root.id = 'game-root';
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'game';
    this.root.append(this.canvas);
    home.append(this.root);
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.renderer = new Renderer();
    this.lastLocation = state.players[LOCAL_ID].location;

    this.hud = new Hud(this.root, {
      playerId: LOCAL_ID,
      getState: () => this.state,
      dispatch: (a) => this.dispatch(a),
      settings: this.settings,
      saveSettings: () => saveSettings(this.settings),
      toggleMini: () => this.toggleMini(),
      toggleFull: () => this.toggleFull(),
      reset: () => this.reset(),
      win: () => this.win,
    });
    this.mini = new MiniMode(this.root, home, (w) => this.setWindow(w));
    home.addEventListener('click', (e) => {
      if (e.target === home && this.mini.active) this.mini.close();
    });

    this.input.onPress = (code, e) => this.onKey(code, e);
    this.input.attach(window);
    this.bindPointer();

    // progresso offline: as plantas cresceram enquanto o jogo estava fechado
    const now = Date.now();
    tick(state, now);
    const ripe = countRipe(state);
    this.hud.refresh();
    if (!this.settings.seenHelp) this.hud.openHelp();
    else if (ripe > 0) this.hud.toast(`🌾 ${ripe} ${ripe === 1 ? 'planta pronta' : 'plantas prontas'} pra colher!`);

    this.timers.push(window.setInterval(() => this.slowTick(), 1000));
    const save = () => this.save();
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', () => document.hidden && save());
    this.startLoop();
  }

  private get player(): PlayerState {
    return this.state.players[LOCAL_ID];
  }

  private get world(): World {
    return worldOf(this.state, this.player);
  }

  // ---------------------------------------------------------------- ciclo

  private startLoop() {
    const token = ++this.loopToken;
    const w = this.win;
    let last = w.performance.now();
    const step = (t: number) => {
      if (token !== this.loopToken || this.suspended) return;
      const dt = Math.max(0, Math.min(0.1, (t - last) / 1000));
      last = t;
      this.update(dt);
      this.render();
      w.requestAnimationFrame(step);
    };
    w.requestAnimationFrame(step);
  }

  private setWindow(w: Window) {
    this.win = w;
    this.input.attach(w);
    this.mouse = null;
    this.startLoop();
    w.focus();
  }

  private autosaveIn = AUTOSAVE_S;

  private slowTick() {
    if (this.suspended) return;
    const now = Date.now();
    tick(this.state, now);
    const ripe = countRipe(this.state);
    if (ripe !== this.lastRipe) {
      if (ripe > this.lastRipe && this.lastRipe >= 0) this.hud.toast(`✨ ${ripe === 1 ? 'Uma planta ficou pronta' : `${ripe} plantas prontas`}!`);
      this.lastRipe = ripe;
      const title = ripe ? `(${ripe}) 🌾 HappyFarm` : 'HappyFarm';
      document.title = title;
      if (this.mini.pip) this.mini.pip.document.title = title;
    }
    this.hud.refresh();
    if (--this.autosaveIn <= 0) {
      this.autosaveIn = AUTOSAVE_S;
      if (this.dirty) this.save();
    }
  }

  save() {
    if (this.suspended) return;
    saveGame(this.state);
    this.dirty = false;
  }

  /** Outra aba/janela assumiu o jogo: salva e para tudo aqui. */
  suspend(message: string) {
    if (this.suspended) return;
    this.save();
    this.suspended = true;
    this.timers.forEach(clearInterval);
    this.input.detach();
    this.mini.close();
    const o = document.createElement('div');
    o.className = 'modal-back';
    o.innerHTML = `<div class="modal panel"><h2>🌱 HappyFarm</h2><p>${message}</p>
      <div class="row-actions"><button class="btn">Jogar aqui</button></div></div>`;
    o.querySelector('button')!.addEventListener('click', () => location.reload());
    this.root.append(o);
  }

  private reset() {
    this.suspended = true;
    clearGame();
    location.reload();
  }

  // ---------------------------------------------------------------- ações

  dispatch(action: Action): GameEvent[] {
    const events = apply(this.state, action);
    this.handleEvents(events);
    this.dirty = true;
    this.hud.refresh();
    return events;
  }

  private handleEvents(events: GameEvent[]) {
    for (const e of events) {
      switch (e.t) {
        case 'float':
          this.floats.push({ x: e.x, y: e.y, text: e.text, color: e.color ?? '#fff', t: 0, dur: 1.3 });
          break;
        case 'toast':
          this.hud.toast(e.text);
          break;
        case 'levelUp':
          this.floats.push({ x: this.player.x, y: this.player.y - 2, text: `⭐ Nível ${e.level}!`, color: '#ffe066', t: 0, dur: 2.2 });
          this.burst(this.player.x, this.player.y - 1, ['#ffe066', '#fff6c0', '#ffb84a'], 24);
          break;
        case 'fx':
          if (e.objId !== undefined) this.shakes.set(e.objId, this.time);
          this.burst(e.x, e.y, e.color ? [e.color, '#fff6c0'] : FX_COLORS[e.fx] ?? ['#fff'], e.fx === 'fell' ? 18 : 9);
          break;
        case 'openShop':
          this.hud.openShop('buy');
          break;
        case 'openChest':
          this.hud.openChest(e.id);
          break;
      }
    }
  }

  private burst(x: number, y: number, colors: string[], n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 20 + Math.random() * 40;
      const life = 0.35 + Math.random() * 0.35;
      this.particles.push({
        x: x * T, y: y * T - 4,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        life, max: life,
        color: colors[i % colors.length],
        size: Math.random() < 0.3 ? 2 : 1,
      });
    }
  }

  private useAt(tx: number, ty: number) {
    const plan = resolveUse(this.state, this.player, tx, ty, true, Date.now());
    if (!plan) return;
    this.dispatch({ type: 'use', playerId: LOCAL_ID, x: tx, y: ty, now: Date.now(), smart: true });
    if (plan.tool) this.anim[LOCAL_ID].swing = { item: plan.tool, t: 0 };
  }

  private consume() {
    this.dispatch({ type: 'consume', playerId: LOCAL_ID, now: Date.now() });
  }

  private useFacing() {
    if (selectedItem(this.player) === 'coffee') return this.consume();
    const p = this.player;
    const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[p.facing];
    this.useAt(Math.floor(p.x) + dx, Math.floor(p.y) + dy);
  }

  /** Clique no mapa: usa se estiver perto, senão caminha até lá e usa ao chegar. */
  private clickTile(tx: number, ty: number): 'use' | 'walk' | null {
    const w = this.world;
    const p = this.player;
    if (!inBounds(w, tx, ty)) return null;
    if (selectedItem(p) === 'coffee' && tx === Math.floor(p.x) && ty === Math.floor(p.y)) {
      this.consume();
      return 'use';
    }
    const plan = resolveUse(this.state, p, tx, ty, true, Date.now());
    if (plan) {
      if (inReach(p, w, tx, ty)) {
        this.path = [];
        this.pending = null;
        this.useAt(tx, ty);
        return 'use';
      }
      const r = interactionRect(w, tx, ty);
      const goals = new Set<number>();
      for (let y = r.y - 1; y <= r.y + r.h; y++) {
        for (let x = r.x - 1; x <= r.x + r.w; x++) {
          if (isBlocked(w, x, y)) continue;
          if (distToRect(x + 0.5, y + 0.5, r.x, r.y, r.w, r.h) <= REACH) goals.add(tileKey(w, x, y));
        }
      }
      this.walkTo(goals, { x: tx, y: ty });
      return 'use';
    }
    if (isBlocked(w, tx, ty)) return null;
    this.walkTo(new Set([tileKey(w, tx, ty)]), null);
    return 'walk';
  }

  private walkTo(goals: Set<number>, pending: { x: number; y: number } | null, quiet = false) {
    const p = this.player;
    const sx = Math.floor(p.x);
    const sy = Math.floor(p.y);
    const tiles = findPath(this.world, sx, sy, goals);
    if (!tiles) {
      if (!quiet) this.hud.toast('Não dá pra chegar lá 🤔', 1600);
      return;
    }
    const pts = tiles.map((t) => ({ x: t.x + 0.5, y: t.y + 0.5 }));
    // Só passa pelo centro do tile atual se a linha reta até o próximo ponto esbarrar em algo.
    // (Antes passava sempre: a cada clique/recálculo ele dava um passo pra trás — o "vai e volta".)
    const first = pts[0] ?? { x: sx + 0.5, y: sy + 0.5 };
    this.path = this.segmentClear(p.x, p.y, first.x, first.y) ? pts : [{ x: sx + 0.5, y: sy + 0.5 }, ...pts];
    if (!this.path.length) this.path = [first];
    this.pending = pending;
  }

  /** A hitbox do jogador consegue ir em linha reta de A até B? */
  private segmentClear(ax: number, ay: number, bx: number, by: number) {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.2);
    for (let i = 1; i <= n; i++) {
      if (this.collides(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n)) return false;
    }
    return true;
  }

  private selectIndex(i: number) {
    this.dispatch({ type: 'select', playerId: LOCAL_ID, slot: i });
  }

  private cycle(d: number) {
    this.selectIndex((this.player.selected + d + HOTBAR_SIZE) % HOTBAR_SIZE);
  }

  // ---------------------------------------------------------------- entrada

  private onKey(code: string, e: KeyboardEvent) {
    switch (code) {
      case 'Space':
      case 'KeyE':
      case 'Enter':
        this.useFacing();
        return;
      case 'KeyB':
        this.hud.toggleShop();
        return;
      case 'KeyI':
      case 'Tab':
        e.preventDefault();
        this.hud.toggleInventory();
        return;
      case 'KeyM':
        this.toggleMini();
        return;
      case 'KeyF':
        this.toggleFull();
        return;
      case 'KeyH':
      case 'F1':
        e.preventDefault();
        this.hud.toggleHelp();
        return;
      case 'Escape':
        this.hud.closeModal();
        return;
      case 'KeyQ':
        this.cycle(1);
        return;
      case 'KeyC':
        this.pan = { x: 0, y: 0 };
        return;
      case 'Equal':
      case 'NumpadAdd':
        this.zoom(1);
        return;
      case 'Minus':
      case 'NumpadSubtract':
        this.zoom(-1);
        return;
    }
    const m = /^(?:Digit|Numpad)(\d)$/.exec(code);
    if (m) this.selectIndex((Number(m[1]) + 9) % 10);
  }

  private zoom(d: number) {
    this.settings.zoom = Math.max(-4, Math.min(6, this.settings.zoom + d));
    saveSettings(this.settings);
  }

  private bindPointer() {
    const c = this.canvas;
    c.addEventListener('pointermove', (e) => {
      this.mouse = { x: e.offsetX, y: e.offsetY };
      if (this.panDrag?.pointerId === e.pointerId) {
        const k = (this.win.devicePixelRatio || 1) / this.view.zoom;
        this.pan.x -= (e.offsetX - this.panDrag.x) * k;
        this.pan.y -= (e.offsetY - this.panDrag.y) * k;
        this.panDrag.x = e.offsetX;
        this.panDrag.y = e.offsetY;
      }
    });
    c.addEventListener('pointerleave', () => {
      if (!this.follow && !this.panDrag) this.mouse = null;
    });
    c.addEventListener('pointerdown', (e) => {
      this.mouse = { x: e.offsetX, y: e.offsetY };
      if (e.button === 2) {
        // botão direito: arrastar o mapa
        this.panDrag = { pointerId: e.pointerId, x: e.offsetX, y: e.offsetY };
        c.setPointerCapture(e.pointerId);
        c.style.cursor = 'grabbing';
        return;
      }
      if (e.button !== 0) return;
      const t = this.screenToTile(e.offsetX, e.offsetY);
      if (this.clickTile(t.x, t.y) === 'walk') {
        // segurando no chão: continua seguindo o cursor enquanto o botão estiver pressionado
        this.follow = { pointerId: e.pointerId, tile: tileKey(this.world, t.x, t.y), repathIn: 0.12 };
        c.setPointerCapture(e.pointerId);
      }
    });
    const release = (e: PointerEvent) => {
      if (this.follow?.pointerId === e.pointerId) this.follow = null;
      if (this.panDrag?.pointerId === e.pointerId) this.panDrag = null;
    };
    c.addEventListener('pointerup', release);
    c.addEventListener('pointercancel', release);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cycle(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });
  }

  private screenToTile(sx: number, sy: number) {
    const dpr = this.win.devicePixelRatio || 1;
    const v = this.view;
    return {
      x: Math.floor((sx * dpr - v.ox) / v.zoom / T),
      y: Math.floor((sy * dpr - v.oy) / v.zoom / T),
    };
  }

  private async toggleMini() {
    if (this.mini.supported) {
      try {
        await this.mini.toggle();
        return;
      } catch {
        // alguns navegadores embutidos expõem a API mas não abrem a janela: cai pro popup
      }
    }
    // fallback: popup pequeno e redimensionável (não fica sempre por cima).
    // A nova instância assume o jogo via BroadcastChannel e esta pausa.
    this.save();
    const w = window.open(`${location.pathname}?mini=1`, 'happyfarm-mini', 'popup=yes,width=440,height=340');
    if (w) this.hud.toast('Abri numa janelinha. Pra ficar sempre por cima, use Edge ou Chrome atualizado.', 4000);
    else this.hud.toast('O navegador bloqueou a janela flutuante. Use Edge ou Chrome atualizado.', 4000);
  }

  private toggleFull() {
    if (this.mini.active) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void this.root.requestFullscreen?.();
  }

  // ---------------------------------------------------------------- simulação

  private collides(x: number, y: number) {
    const w = this.world;
    for (let ty = Math.floor(y - HB_H); ty <= Math.floor(y + HB_H); ty++) {
      for (let tx = Math.floor(x - HB_W); tx <= Math.floor(x + HB_W); tx++) if (isBlocked(w, tx, ty)) return true;
    }
    return false;
  }

  private update(dt: number) {
    this.time += dt;
    const p = this.player;
    this.checkLocation();
    this.updateFollow(dt);
    const { dx, dy } = this.input.axis();
    const speed = SPEED * (isCaffeinated(p, Date.now()) ? CAFFEINE_SPEED : 1);
    let moved = false;

    if (dx || dy) {
      this.path = [];
      this.pending = null;
      const len = Math.hypot(dx, dy);
      const sx = (dx / len) * speed * dt;
      const sy = (dy / len) * speed * dt;
      if (sx && !this.collides(p.x + sx, p.y)) { p.x += sx; moved = true; }
      if (sy && !this.collides(p.x, p.y + sy)) { p.y += sy; moved = true; }
      p.facing = pickFacing(p.facing, dx, dy);
      if (!moved && (!dx || !dy)) this.bumpDoor(dx, dy);
    } else if (this.path.length) {
      const wp = this.path[0];
      const vx = wp.x - p.x;
      const vy = wp.y - p.y;
      const d = Math.hypot(vx, vy);
      const step = speed * dt;
      if (d > 0.01) p.facing = pickFacing(p.facing, Math.abs(vx) > 0.01 ? Math.sign(vx) : 0, Math.abs(vy) > 0.01 ? Math.sign(vy) : 0);
      if (d <= step) {
        p.x = wp.x;
        p.y = wp.y;
        this.path.shift();
      } else {
        p.x += (vx / d) * step;
        p.y += (vy / d) * step;
      }
      moved = true;
      if (!this.path.length && this.pending) {
        const t = this.pending;
        this.pending = null;
        if (inReach(p, this.world, t.x, t.y)) this.useAt(t.x, t.y);
      }
    }

    this.moving = moved;
    if (moved) {
      this.walkT += dt;
      this.dirty = true;
    } else this.walkT = 0;

    // câmera arrastada volta suavemente pro personagem quando ele anda
    if (moved && !this.panDrag) {
      const k = Math.exp(-dt * 5);
      this.pan.x *= k;
      this.pan.y *= k;
    }

    const a = this.anim[LOCAL_ID];
    // 1–4: ciclo de caminhada · 5: piscada de vez em quando
    a.frame = this.moving ? 1 + (Math.floor(this.walkT * 9) % 4) : this.time % 3.7 < 0.13 ? 5 : 0;
    if (a.swing && (a.swing.t += dt) > SWING_S) a.swing = null;

    for (const f of this.floats) f.t += dt;
    this.floats = this.floats.filter((f) => f.t < f.dur);
    for (const pt of this.particles) {
      pt.life -= dt;
      pt.vy += 160 * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
    }
    this.particles = this.particles.filter((pt) => pt.life > 0);
    this.fade = Math.max(0, this.fade - dt * 3);

    const chestId = this.hud.openChestId;
    if (chestId !== null) {
      const chest = findChest(this.world, chestId);
      if (!chest || !chestInReach(p, chest)) this.hud.closeModal();
    }

    this.updateHover();
  }

  /** Segurando o botão: refaz o caminho até o tile sob o cursor sempre que ele muda. */
  private updateFollow(dt: number) {
    const f = this.follow;
    if (!f || !this.mouse || this.hud.modalOpen) return;
    f.repathIn -= dt;
    if (f.repathIn > 0) return;
    f.repathIn = 0.12;
    const w = this.world;
    const t = this.screenToTile(this.mouse.x, this.mouse.y);
    if (!inBounds(w, t.x, t.y) || isBlocked(w, t.x, t.y)) return;
    const k = tileKey(w, t.x, t.y);
    if (k === f.tile && this.path.length) return;
    f.tile = k;
    const p = this.player;
    if (Math.floor(p.x) === t.x && Math.floor(p.y) === t.y) return;
    this.walkTo(new Set([k]), null, true);
  }

  /** Andar contra a porta (de casa ou da rua) entra/sai, sem precisar clicar. */
  private bumpDoor(dx: number, dy: number) {
    const p = this.player;
    const tx = Math.floor(p.x) + dx;
    const ty = Math.floor(p.y) + dy;
    const o = objectAt(this.world, tx, ty);
    const d = LAYOUT.houseDoor;
    if (o?.kind === 'door' || (o?.kind === 'house' && tx === d.x && ty === d.y)) this.useAt(tx, ty);
  }

  private checkLocation() {
    const loc = this.player.location;
    if (loc === this.lastLocation) return;
    this.lastLocation = loc;
    this.path = [];
    this.pending = null;
    this.particles = [];
    this.floats = [];
    this.fade = 1;
    this.pan = { x: 0, y: 0 };
    this.follow = null;
    this.hud.closeModal();
  }

  private updateHover() {
    if (!this.mouse || this.hud.modalOpen) {
      this.hover = null;
      this.canvas.style.cursor = this.panDrag ? 'grabbing' : 'default';
      return;
    }
    const { x, y } = this.screenToTile(this.mouse.x, this.mouse.y);
    const w = this.world;
    if (!inBounds(w, x, y)) {
      this.hover = null;
      return;
    }
    const now = Date.now();
    const plan = resolveUse(this.state, this.player, x, y, true, now);
    let label = plan?.label ?? null;
    const soil = w.soil[tileKey(w, x, y)];
    if (soil?.crop && !isRipe(soil.crop)) {
      const name = CROPS[soil.crop.id].name;
      const info = `${name} · pronta em ${fmtDur(remainingMs(soil, now))}${soil.wetUntil > now ? ' 💧' : ''}`;
      label = plan ? `${plan.label} · ${info}` : info;
    }
    this.hover = { x, y, active: !!plan, reach: inReach(this.player, w, x, y), label };
    this.canvas.style.cursor = this.panDrag ? 'grabbing' : plan ? 'pointer' : 'default';
  }

  private render() {
    const c = this.canvas;
    const dpr = this.win.devicePixelRatio || 1;
    const cssW = c.clientWidth;
    const cssH = c.clientHeight;
    if (!cssW || !cssH) return;
    const W = Math.round(cssW * dpr);
    const H = Math.round(cssH * dpr);
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    this.root.classList.toggle('compact', cssW < 640 || cssH < 440);
    this.root.classList.toggle('tiny', cssW < 400 || cssH < 300);

    // zoom inteiro (pixel art nítida): ~13 tiles de largura no mini, ~20 em tela grande
    const across = cssW < 640 ? 13 : 20;
    const auto = Math.max(1, Math.round(W / (T * across)));
    const zoom = Math.max(1, Math.min(auto + this.settings.zoom, Math.floor(H / (T * 5)) || 1));
    const p = this.player;
    const world = this.world;
    const fx = p.x * T;
    const fy = p.y * T - 8;
    this.view = this.renderer.computeView(world, W, H, zoom, fx + this.pan.x, fy + this.pan.y);
    if (this.panDrag) {
      // não deixa o arraste acumular além da borda do mapa
      this.pan.x = (W / 2 - this.view.ox) / zoom - fx;
      this.pan.y = (H / 2 - this.view.oy) / zoom - fy;
    }
    this.renderer.draw(this.ctx, this.view, {
      state: this.state,
      world,
      indoor: p.location !== 'farm',
      now: Date.now(),
      time: this.time,
      dpr,
      localId: LOCAL_ID,
      anim: this.anim,
      hover: this.hover,
      floats: this.floats,
      particles: this.particles,
      shakes: this.shakes,
      light: this.settings.alwaysDay ? { dark: 0, tint: null } : daylight(new Date()),
    });
    if (this.fade > 0) {
      this.ctx.fillStyle = `rgba(10,6,2,${this.fade.toFixed(3)})`;
      this.ctx.fillRect(0, 0, W, H);
    }
  }
}

function pickFacing(current: Dir, dx: number, dy: number): Dir {
  if (dx && !dy) return dx < 0 ? 'left' : 'right';
  if (dy && !dx) return dy < 0 ? 'up' : 'down';
  // diagonal: mantém a direção atual se ela fizer parte do movimento
  if ((current === 'left' && dx < 0) || (current === 'right' && dx > 0)) return current;
  if ((current === 'up' && dy < 0) || (current === 'down' && dy > 0)) return current;
  return dy < 0 ? 'up' : 'down';
}
