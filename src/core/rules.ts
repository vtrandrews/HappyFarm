// Regras do jogo. Toda mudança de estado passa por `apply(state, action)`.
// Nada aqui toca em DOM/canvas: o mesmo código poderá rodar num servidor
// autoritativo quando o multiplayer chegar.

import {
  CAFFEINE_MS, CAN_CAPACITY, COFFEE_ENERGY, CROPS, CROP_ORDER, DRY_RATE, ENERGY_COST, ENERGY_REGEN_MS,
  HOTBAR_SIZE, ITEMS, REACH, REST_COOLDOWN_MS, SELLABLE, STUMP_REGROW_MS, WET_MS,
  isSeed, levelFromXp, maxEnergy, type CropId, type Dir, type ItemId, type SeedId,
} from './data';
import { addItem, moveSlot, quickMove, removeItem, spaceFor, type Slots } from './inventory';
import { randInt } from './rng';
import { qty, selectedItem, worldOf, type GameState, type PlayerState } from './state';
import {
  G, LAYOUT, inBounds, objectAt, removeObject, tileKey, touch,
  type CropState, type SoilTile, type World, type WorldObject,
} from './world';

export type FxKind = 'till' | 'water' | 'plant' | 'harvest' | 'chop' | 'fell' | 'break' | 'refill' | 'coffee';

export type GameEvent =
  | { t: 'float'; x: number; y: number; text: string; color?: string }
  | { t: 'toast'; text: string }
  | { t: 'levelUp'; level: number }
  | { t: 'fx'; fx: FxKind; x: number; y: number; color?: string; objId?: number }
  | { t: 'openShop' }
  | { t: 'openChest'; id: number };

/** Referência a um slot: mochila do jogador ou baú (pelo id do objeto no mapa atual). */
export type SlotRef = { c: 'inv'; i: number } | { c: 'chest'; id: number; i: number };

export type Action =
  | { type: 'use'; playerId: string; x: number; y: number; now: number; smart?: boolean }
  | { type: 'consume'; playerId: string; now: number }
  | { type: 'select'; playerId: string; slot: number }
  | { type: 'moveSlot'; playerId: string; from: SlotRef; to: SlotRef }
  | { type: 'quickMove'; playerId: string; from: SlotRef; chestId?: number }
  | { type: 'buy'; playerId: string; item: SeedId; qty: number }
  | { type: 'sell'; playerId: string; item: ItemId; qty: number }
  | { type: 'sellAll'; playerId: string }
  | { type: 'move'; playerId: string; x: number; y: number; facing: Dir };

export type UseKind =
  | 'harvest' | 'till' | 'water' | 'refill' | 'emptyCan' | 'plant' | 'chop' | 'break' | 'untill'
  | 'shop' | 'sell' | 'enter' | 'exit' | 'chest' | 'coffee' | 'rest';

export interface UsePlan {
  kind: UseKind;
  label: string;
  tool?: ItemId;
}

// ---------- plantações ----------

export function cropTarget(c: CropState): number {
  const d = CROPS[c.id];
  return c.harvests > 0 && d.regrowMs ? d.regrowMs : d.growMs;
}

export const cropProgress = (c: CropState) => Math.min(1, c.growth / cropTarget(c));
export const isRipe = (c: CropState) => c.growth >= cropTarget(c);

export function cropStage(c: CropState): 0 | 1 | 2 | 3 {
  const p = cropProgress(c);
  if (p >= 1) return 3;
  if (c.harvests > 0) return 2;
  if (p < 0.15) return 0;
  if (p < 0.5) return 1;
  return 2;
}

/** Atualiza o crescimento até `now`. Regado cresce 100%, seco cresce `DRY_RATE`. */
export function growSoil(soil: SoilTile, now: number) {
  const c = soil.crop;
  if (!c || now <= c.last) return;
  const wet = Math.max(0, Math.min(now, soil.wetUntil) - c.last);
  const dry = now - c.last - wet;
  c.growth = Math.min(cropTarget(c), c.growth + wet + dry * DRY_RATE);
  c.last = now;
}

/** Tempo real estimado até ficar pronta, considerando a água que ainda resta. */
export function remainingMs(soil: SoilTile, now: number): number {
  const c = soil.crop;
  if (!c) return 0;
  const left = cropTarget(c) - c.growth;
  if (left <= 0) return 0;
  const wetLeft = Math.max(0, soil.wetUntil - now);
  return left <= wetLeft ? left : wetLeft + (left - wetLeft) / DRY_RATE;
}

// ---------- status do personagem ----------

export const energyMax = (p: PlayerState) => maxEnergy(levelFromXp(p.xp));
export const isCaffeinated = (p: PlayerState, now: number) => p.caffeineUntil > now;

/** Regeneração passiva de energia pelo tempo real (inclusive com o jogo fechado). */
export function regenEnergy(p: PlayerState, now: number) {
  const max = energyMax(p);
  if (p.energy >= max) {
    p.energy = max;
    p.energyAt = now;
    return;
  }
  const gain = Math.floor((now - p.energyAt) / ENERGY_REGEN_MS);
  if (gain <= 0) return;
  p.energy = Math.min(max, p.energy + gain);
  p.energyAt = p.energy >= max ? now : p.energyAt + gain * ENERGY_REGEN_MS;
}

export function tick(state: GameState, now: number) {
  for (const w of Object.values(state.maps)) {
    for (const k in w.soil) growSoil(w.soil[k], now);
    for (const o of w.objects) {
      if (o.kind === 'stump' && o.regrowAt && now >= o.regrowAt) {
        o.kind = 'tree';
        o.hp = 3;
        delete o.regrowAt;
        touch(w);
      }
    }
  }
  for (const p of Object.values(state.players)) regenEnergy(p, now);
}

export function countRipe(state: GameState): number {
  let n = 0;
  for (const w of Object.values(state.maps)) {
    for (const k in w.soil) {
      const c = w.soil[k].crop;
      if (c && isRipe(c)) n++;
    }
  }
  return n;
}

// ---------- alcance ----------

export function distToRect(px: number, py: number, x: number, y: number, w: number, h: number) {
  const dx = Math.max(x - px, 0, px - (x + w));
  const dy = Math.max(y - py, 0, py - (y + h));
  return Math.hypot(dx, dy);
}

/** Área destacada ao passar o mouse (a construção inteira, se houver uma ali). */
export function targetRect(world: World, tx: number, ty: number) {
  const o = objectAt(world, tx, ty);
  return o && o.kind !== 'flower' && o.kind !== 'rug' ? { x: o.x, y: o.y, w: o.w, h: o.h } : { x: tx, y: ty, w: 1, h: 1 };
}

/** Área de onde dá pra interagir: na casa, só pela porta. */
export function interactionRect(world: World, tx: number, ty: number) {
  const o = objectAt(world, tx, ty);
  if (o?.kind === 'house') return { ...LAYOUT.houseDoor, w: 1, h: 1 };
  return targetRect(world, tx, ty);
}

export function inReach(p: PlayerState, world: World, tx: number, ty: number) {
  const r = interactionRect(world, tx, ty);
  return distToRect(p.x, p.y, r.x, r.y, r.w, r.h) <= REACH;
}

export function findChest(world: World, id: number): WorldObject | undefined {
  return world.objects.find((o) => o.id === id && o.kind === 'chest');
}

export function chestInReach(p: PlayerState, chest: WorldObject) {
  return distToRect(p.x, p.y, chest.x, chest.y, chest.w, chest.h) <= REACH + 0.5;
}

// ---------- o que acontece ao usar algo num tile ----------

/**
 * Decide o que o jogador faria ao interagir com o tile.
 * `smart`: se o item selecionado não serve ali, escolhe a ferramenta óbvia
 * (árvore → machado, pedra → picareta...). Essencial pra jogar só com o mouse no modo mini.
 */
export function resolveUse(
  state: GameState, p: PlayerState, tx: number, ty: number, smart: boolean, now: number,
): UsePlan | null {
  const w = worldOf(state, p);
  if (!inBounds(w, tx, ty)) return null;
  const k = tileKey(w, tx, ty);
  const obj = objectAt(w, tx, ty);
  const soil = w.soil[k];
  const ground = w.ground[k];

  switch (obj?.kind) {
    case 'shop': return { kind: 'shop', label: 'Abrir loja' };
    case 'bin': return { kind: 'sell', label: 'Vender colheita' };
    case 'house': return { kind: 'enter', label: 'Entrar em casa' };
    case 'door': return { kind: 'exit', label: 'Sair' };
    case 'chest': return { kind: 'chest', label: 'Abrir baú' };
    case 'coffeebar': return { kind: 'coffee', label: 'Passar um café ☕' };
    case 'bed': return { kind: 'rest', label: 'Descansar' };
  }
  if (soil?.crop && isRipe(soil.crop)) return { kind: 'harvest', label: `Colher ${CROPS[soil.crop.id].name}` };

  const planFor = (item: ItemId | null): UsePlan | null => {
    switch (item) {
      case null:
        return null;
      case 'hoe':
        if (soil || (obj && obj.kind !== 'flower')) return null;
        return ground === G.grass || ground === G.dirt ? { kind: 'till', tool: 'hoe', label: 'Arar' } : null;
      case 'can':
        if (ground === G.water) return { kind: 'refill', tool: 'can', label: 'Encher regador' };
        if (!soil) return null;
        return p.water > 0
          ? { kind: 'water', tool: 'can', label: 'Regar' }
          : { kind: 'emptyCan', tool: 'can', label: 'Regador vazio' };
      case 'axe':
        if (obj?.kind === 'tree') return { kind: 'chop', tool: 'axe', label: 'Cortar árvore' };
        if (obj?.kind === 'stump' || obj?.kind === 'bush') return { kind: 'chop', tool: 'axe', label: 'Cortar' };
        return null;
      case 'pickaxe':
        if (obj?.kind === 'rock') return { kind: 'break', tool: 'pickaxe', label: 'Quebrar pedra' };
        if (soil && !soil.crop) return { kind: 'untill', tool: 'pickaxe', label: 'Desfazer canteiro' };
        return null;
      default:
        if (isSeed(item) && soil && !soil.crop && !obj && qty(p, item) > 0) {
          return { kind: 'plant', tool: item, label: `Plantar ${CROPS[ITEMS[item].crop!].name}` };
        }
        return null;
    }
  };

  const direct = planFor(selectedItem(p));
  if (direct || !smart) return direct;

  if (obj?.kind === 'tree' || obj?.kind === 'stump' || obj?.kind === 'bush') return planFor('axe');
  if (obj?.kind === 'rock') return planFor('pickaxe');
  if (ground === G.water) return planFor('can');
  if (soil?.crop && soil.wetUntil <= now && p.water > 0) return planFor('can');
  return null;
}

// ---------- ações ----------

function give(p: PlayerState, item: ItemId, n: number, events: GameEvent[]): number {
  const left = addItem(p.inv, item, n);
  if (left > 0) events.push({ t: 'toast', text: `🎒 Inventário cheio! ${left}× ${ITEMS[item].name} ficou pra trás` });
  return n - left;
}

function addXp(p: PlayerState, amount: number, events: GameEvent[]) {
  const before = levelFromXp(p.xp);
  p.xp += amount;
  const after = levelFromXp(p.xp);
  if (after > before) {
    p.energy = energyMax(p);
    events.push({ t: 'levelUp', level: after });
    const unlocked = CROP_ORDER.filter((c) => CROPS[c].unlockLevel === after).map((c) => CROPS[c].name);
    events.push({
      t: 'toast',
      text: `⭐ Nível ${after}! Energia máxima aumentou` + (unlocked.length ? ` · Nova semente: ${unlocked.join(', ')}` : ''),
    });
  }
}

function faceToward(p: PlayerState, x: number, y: number) {
  const dx = x - p.x;
  const dy = y - p.y;
  if (Math.abs(dx) > Math.abs(dy)) p.facing = dx < 0 ? 'left' : 'right';
  else p.facing = dy < 0 ? 'up' : 'down';
}

function sellAll(p: PlayerState, events: GameEvent[]) {
  let total = 0;
  let count = 0;
  p.inv.forEach((s, i) => {
    if (!s || !SELLABLE.includes(s.item)) return;
    total += s.qty * (ITEMS[s.item].sellPrice ?? 0);
    count += s.qty;
    p.inv[i] = null;
  });
  if (!count) {
    events.push({ t: 'toast', text: 'Nada pra vender ainda — plante e colha! 🌱' });
    return;
  }
  p.coins += total;
  p.stats.earned += total;
  events.push({ t: 'toast', text: `Vendeu ${count} ${count === 1 ? 'item' : 'itens'} por ${total} moedas 🪙` });
  events.push({ t: 'float', x: p.x, y: p.y - 1.4, text: `+${total} 🪙`, color: '#ffd84a' });
}

/** Resolve um SlotRef pro array de slots, validando o acesso ao baú. */
function slotsOf(state: GameState, p: PlayerState, ref: SlotRef): Slots | null {
  if (ref.c === 'inv') return p.inv;
  const chest = findChest(worldOf(state, p), ref.id);
  return chest?.slots && chestInReach(p, chest) ? chest.slots : null;
}

function drinkCoffee(p: PlayerState, now: number, events: GameEvent[]) {
  if (removeItem(p.inv, 'coffee', 1) === 0) return;
  regenEnergy(p, now);
  const gained = Math.min(COFFEE_ENERGY, energyMax(p) - p.energy);
  p.energy += gained;
  p.caffeineUntil = Math.max(now, p.caffeineUntil) + CAFFEINE_MS;
  p.stats.coffees++;
  events.push({ t: 'fx', fx: 'coffee', x: p.x, y: p.y - 1 });
  events.push({ t: 'float', x: p.x, y: p.y - 1.6, text: `☕ +${gained} energia · Cafeinado!`, color: '#ffe2b0' });
}

export function apply(state: GameState, action: Action): GameEvent[] {
  const p = state.players[action.playerId];
  if (!p) return [];
  const events: GameEvent[] = [];

  switch (action.type) {
    case 'move':
      p.x = action.x;
      p.y = action.y;
      p.facing = action.facing;
      break;

    case 'select':
      if (action.slot >= 0 && action.slot < HOTBAR_SIZE) p.selected = action.slot;
      break;

    case 'moveSlot': {
      const a = slotsOf(state, p, action.from);
      const b = slotsOf(state, p, action.to);
      if (a && b && a[action.from.i] !== undefined && b[action.to.i] !== undefined) {
        moveSlot(a, action.from.i, b, action.to.i);
      }
      break;
    }

    case 'quickMove': {
      const from = slotsOf(state, p, action.from);
      if (!from || !from[action.from.i]) break;
      if (action.from.c === 'chest') {
        quickMove(from, action.from.i, p.inv);
      } else if (action.chestId !== undefined) {
        const chest = slotsOf(state, p, { c: 'chest', id: action.chestId, i: 0 });
        if (chest) quickMove(from, action.from.i, chest);
      } else if (action.from.i < HOTBAR_SIZE) {
        quickMove(from, action.from.i, p.inv, HOTBAR_SIZE);
      } else {
        quickMove(from, action.from.i, p.inv, 0, HOTBAR_SIZE);
      }
      break;
    }

    case 'consume':
      if (selectedItem(p) === 'coffee') drinkCoffee(p, action.now, events);
      break;

    case 'buy': {
      const def = ITEMS[action.item];
      if (!def || def.kind !== 'seed' || action.qty <= 0) break;
      const crop = CROPS[def.crop!];
      if (levelFromXp(p.xp) < crop.unlockLevel) {
        events.push({ t: 'toast', text: `🔒 ${crop.name} libera no nível ${crop.unlockLevel}` });
        break;
      }
      const cost = crop.seedPrice * action.qty;
      if (p.coins < cost) {
        events.push({ t: 'toast', text: 'Moedas insuficientes 😅' });
        break;
      }
      if (spaceFor(p.inv, action.item) < action.qty) {
        events.push({ t: 'toast', text: '🎒 Sem espaço no inventário' });
        break;
      }
      p.coins -= cost;
      addItem(p.inv, action.item, action.qty);
      events.push({ t: 'toast', text: `Comprou ${action.qty}× semente de ${crop.name}` });
      break;
    }

    case 'sell': {
      const def = ITEMS[action.item];
      if (!def?.sellPrice || !SELLABLE.includes(action.item)) break;
      const n = removeItem(p.inv, action.item, action.qty);
      if (n <= 0) break;
      const total = n * def.sellPrice;
      p.coins += total;
      p.stats.earned += total;
      events.push({ t: 'toast', text: `Vendeu ${n}× ${def.name} por ${total} moedas 🪙` });
      break;
    }

    case 'sellAll':
      sellAll(p, events);
      break;

    case 'use':
      useTile(state, p, action.x, action.y, action.now, !!action.smart, events);
      break;
  }
  return events;
}

function useTile(
  state: GameState, p: PlayerState, tx: number, ty: number, now: number, smart: boolean, events: GameEvent[],
) {
  const w = worldOf(state, p);
  if (!inReach(p, w, tx, ty)) return;
  const k = tileKey(w, tx, ty);
  const soil = w.soil[k];
  if (soil) growSoil(soil, now);
  const plan = resolveUse(state, p, tx, ty, smart, now);
  if (!plan) return;

  const cost = ENERGY_COST[plan.kind] ?? 0;
  if (cost) {
    regenEnergy(p, now);
    if (p.energy < cost) {
      events.push({ t: 'toast', text: '😮‍💨 Sem energia! Tome um café ☕ ou descanse na cama' });
      return;
    }
    p.energy -= cost;
  }

  const obj = objectAt(w, tx, ty);
  const cx = tx + 0.5;
  const cy = ty + 0.5;
  if (plan.kind !== 'enter' && plan.kind !== 'exit') faceToward(p, cx, cy);

  switch (plan.kind) {
    case 'harvest': {
      const c = soil!.crop!;
      const def = CROPS[c.id];
      if (spaceFor(p.inv, c.id) <= 0) {
        events.push({ t: 'toast', text: '🎒 Inventário cheio! Venda ou guarde no baú' });
        return;
      }
      const n = give(p, c.id, randInt(state, def.yield[0], def.yield[1]), events);
      p.stats.harvested += n;
      events.push({ t: 'fx', fx: 'harvest', x: cx, y: cy, color: def.fruit });
      events.push({ t: 'float', x: cx, y: ty - 0.2, text: `+${n} ${def.name}`, color: '#ffffff' });
      if (def.regrowMs) {
        c.harvests++;
        c.growth = 0;
        c.last = now;
      } else {
        soil!.crop = null;
      }
      addXp(p, def.xp, events);
      break;
    }
    case 'till':
      if (obj?.kind === 'flower') removeObject(w, obj);
      w.soil[k] = { wetUntil: 0, crop: null };
      events.push({ t: 'fx', fx: 'till', x: cx, y: cy });
      break;
    case 'water':
      soil!.wetUntil = now + WET_MS;
      p.water--;
      events.push({ t: 'fx', fx: 'water', x: cx, y: cy });
      break;
    case 'refill':
      p.water = CAN_CAPACITY;
      events.push({ t: 'fx', fx: 'refill', x: cx, y: cy });
      events.push({ t: 'float', x: p.x, y: p.y - 1.4, text: 'Regador cheio 💧', color: '#bfe6ff' });
      break;
    case 'emptyCan':
      events.push({ t: 'toast', text: 'Regador vazio! Clique na água do lago pra encher 💧' });
      break;
    case 'plant': {
      const seed = plan.tool as SeedId;
      removeItem(p.inv, seed, 1);
      soil!.crop = { id: ITEMS[seed].crop as CropId, growth: 0, last: now, harvests: 0 };
      addXp(p, 1, events);
      events.push({ t: 'fx', fx: 'plant', x: cx, y: cy });
      break;
    }
    case 'chop': {
      const o = obj!;
      o.hp--;
      events.push({ t: 'fx', fx: 'chop', x: cx, y: cy, objId: o.id });
      if (o.hp > 0) break;
      if (o.kind === 'tree') {
        o.kind = 'stump';
        o.hp = 2;
        o.regrowAt = now + STUMP_REGROW_MS;
        touch(w);
        const n = give(p, 'wood', randInt(state, 2, 4), events);
        events.push({ t: 'fx', fx: 'fell', x: cx, y: cy });
        if (n) events.push({ t: 'float', x: cx, y: ty - 0.2, text: `+${n} Madeira`, color: '#ffe2b0' });
        addXp(p, 2, events);
      } else {
        removeObject(w, o);
        if (give(p, 'wood', 1, events)) events.push({ t: 'float', x: cx, y: ty - 0.2, text: '+1 Madeira', color: '#ffe2b0' });
      }
      break;
    }
    case 'break': {
      const o = obj!;
      o.hp--;
      events.push({ t: 'fx', fx: 'break', x: cx, y: cy, objId: o.id });
      if (o.hp > 0) break;
      removeObject(w, o);
      const n = give(p, 'stone', randInt(state, 1, 2), events);
      if (n) events.push({ t: 'float', x: cx, y: ty - 0.2, text: `+${n} Pedra`, color: '#e0e0e8' });
      addXp(p, 1, events);
      break;
    }
    case 'untill':
      delete w.soil[k];
      events.push({ t: 'fx', fx: 'till', x: cx, y: cy });
      break;
    case 'shop':
      events.push({ t: 'openShop' });
      break;
    case 'sell':
      sellAll(p, events);
      break;
    case 'enter': {
      const s = LAYOUT.interior.spawn;
      Object.assign(p, { location: 'house', x: s.x, y: s.y, facing: 'up' });
      break;
    }
    case 'exit':
      Object.assign(p, { location: 'farm', x: LAYOUT.spawn.x, y: LAYOUT.spawn.y, facing: 'down' });
      break;
    case 'chest':
      events.push({ t: 'openChest', id: obj!.id });
      break;
    case 'coffee':
      if (spaceFor(p.inv, 'coffee') <= 0) {
        events.push({ t: 'toast', text: '🎒 Sem espaço pro café' });
        return;
      }
      addItem(p.inv, 'coffee', 1);
      events.push({ t: 'fx', fx: 'coffee', x: cx, y: cy });
      events.push({ t: 'float', x: cx, y: ty - 0.4, text: '+1 Café ☕', color: '#ffe2b0' });
      if (p.stats.coffees === 0 && qty(p, 'coffee') === 1) {
        events.push({ t: 'toast', text: 'Selecione o café na barra e aperte Espaço (ou clique no fazendeiro) pra beber' });
      }
      break;
    case 'rest': {
      if (now < p.restReadyAt) {
        events.push({ t: 'toast', text: `😴 Ainda sem sono... (${Math.ceil((p.restReadyAt - now) / 60_000)} min)` });
        return;
      }
      regenEnergy(p, now);
      const gained = energyMax(p) - p.energy;
      p.energy = energyMax(p);
      p.energyAt = now;
      p.restReadyAt = now + REST_COOLDOWN_MS;
      events.push({ t: 'float', x: p.x, y: p.y - 1.6, text: `💤 +${gained} energia`, color: '#cfe0ff' });
      break;
    }
  }
}
