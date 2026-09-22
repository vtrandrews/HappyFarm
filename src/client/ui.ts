import {
  CAN_CAPACITY, CROPS, CROP_ORDER, HOTBAR_SIZE, INV_SIZE, ITEMS, SELLABLE, levelFromXp, seedOf, xpForLevel,
  type CropId, type ItemId,
} from '../core/data';
import type { Slot, Slots } from '../core/inventory';
import { energyMax, findChest, isCaffeinated, type Action, type SlotRef } from '../core/rules';
import { qty, worldOf, type GameState, type PlayerState } from '../core/state';
import { fmtDur, pad2 } from './format';
import type { Settings } from './save';
import { iconURL, playerFrames } from './sprites';

export interface HudHost {
  playerId: string;
  getState(): GameState;
  dispatch(a: Action): void;
  settings: Settings;
  saveSettings(): void;
  toggleMini(): void;
  toggleFull(): void;
  reset(): void;
  win(): Window;
}

type ModalKind = 'shop' | 'help' | 'inv' | 'chest';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

const coin = () => `<img class="px" src="${iconURL('coin')}" alt="">`;
const pct = (v: number, max: number) => `${Math.max(0, Math.min(100, (v / max) * 100)).toFixed(1)}%`;
const sameRef = (a: SlotRef, b: SlotRef) =>
  a.c === b.c && a.i === b.i && (a.c === 'inv' || (b.c === 'chest' && a.id === b.id));

function slotTitle(s: Slot | null) {
  if (!s) return '';
  const d = ITEMS[s.item];
  const extra = d.sellPrice ? ` · vende por ${d.sellPrice}` : d.kind === 'consumable' ? ' · Espaço pra beber' : '';
  return `${d.name}${s.qty > 1 ? ` ×${s.qty}` : ''}${extra}`;
}

export class Hud {
  private el: HTMLElement;
  private coins: HTMLElement;
  private level: HTMLElement;
  private xpFill: HTMLElement;
  private energyFill: HTMLElement;
  private energyText: HTMLElement;
  private caffeine: HTMLElement;
  private clock: HTMLElement;
  private bag: HTMLElement;
  private hotbar: HTMLElement;
  private toasts: HTMLElement;
  private modal: HTMLElement | null = null;
  private modalKind: ModalKind | null = null;
  private shopTab: 'buy' | 'sell' = 'buy';
  private invView: 'items' | 'char' = 'items';
  private hotbarSig = '';
  private gridSig = '';
  /** Baú aberto (id do objeto no mapa atual). */
  openChestId: number | null = null;

  // arrastar e soltar
  private held: SlotRef | null = null;
  private dragging = false;
  private ghost: HTMLImageElement | null = null;

  constructor(private root: HTMLElement, private host: HudHost) {
    this.el = h('div', 'hud');
    this.el.innerHTML = `
      <div class="topbar">
        <div class="panel pill" title="Moedas">${coin()}<span data-coins></span></div>
        <div class="panel pill" title="Nível e experiência"><span data-level></span><div class="xpbar"><i data-xp></i></div></div>
        <div class="panel pill" title="Energia — volta com o tempo, com café ou descansando na cama">
          <span>⚡</span><div class="xpbar energy"><i data-energy></i></div><span class="hide-compact" data-energy-text></span>
          <span data-caffeine title="Cafeinado: andando mais rápido">☕</span>
        </div>
        <div class="panel pill hide-compact" data-clock title="Hora real"></div>
        <div class="spacer"></div>
        <button class="panel pill btn-pill" data-act="inv" title="Inventário (I)">🎒<span class="hide-tiny" data-bag></span></button>
        <button class="panel icon-btn" data-act="shop" title="Loja (B)">🛒</button>
        <button class="panel pill btn-pill float-btn" data-act="mini" title="Janela flutuante, sempre por cima e redimensionável (M)">
          <span class="only-main">📌</span><span class="only-pip">↩</span>
          <span class="lbl only-main">Flutuar</span><span class="lbl only-pip">Voltar</span>
        </button>
        <button class="panel icon-btn only-main hide-compact" data-act="full" title="Tela cheia (F)">⛶</button>
        <button class="panel icon-btn" data-act="help" title="Ajuda (H)">?</button>
      </div>
      <div class="hotbar panel"></div>
      <div class="toasts"></div>`;
    root.append(this.el);
    const q = (sel: string) => this.el.querySelector<HTMLElement>(sel)!;
    this.coins = q('[data-coins]');
    this.level = q('[data-level]');
    this.xpFill = q('[data-xp]');
    this.energyFill = q('[data-energy]');
    this.energyText = q('[data-energy-text]');
    this.caffeine = q('[data-caffeine]');
    this.clock = q('[data-clock]');
    this.bag = q('[data-bag]');
    this.hotbar = q('.hotbar');
    this.toasts = q('.toasts');

    this.el.querySelector('.topbar')!.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'shop') this.toggleShop();
      else if (act === 'inv') this.toggleInventory();
      else if (act === 'mini') host.toggleMini();
      else if (act === 'full') host.toggleFull();
      else if (act === 'help') this.toggleHelp();
    });
    this.hotbar.addEventListener('click', (e) => {
      const slot = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]')?.dataset.slot;
      if (slot !== undefined) host.dispatch({ type: 'select', playerId: host.playerId, slot: Number(slot) });
    });
  }

  private get state() {
    return this.host.getState();
  }

  private get player(): PlayerState {
    return this.state.players[this.host.playerId];
  }

  refresh() {
    const p = this.player;
    const now = Date.now();
    const lvl = levelFromXp(p.xp);
    const base = xpForLevel(lvl);
    this.coins.textContent = String(p.coins);
    this.level.textContent = `Nv ${lvl}`;
    this.xpFill.style.width = pct(p.xp - base, xpForLevel(lvl + 1) - base);
    const max = energyMax(p);
    this.energyFill.style.width = pct(p.energy, max);
    this.energyFill.classList.toggle('low', p.energy < max * 0.2);
    this.energyText.textContent = `${p.energy}/${max}`;
    this.caffeine.hidden = !isCaffeinated(p, now);
    const d = new Date();
    const hr = d.getHours();
    this.clock.textContent = `${hr >= 6 && hr < 18 ? '☀️' : '🌙'} ${pad2(hr)}:${pad2(d.getMinutes())}`;
    this.bag.textContent = `${p.inv.filter(Boolean).length}/${INV_SIZE}`;
    this.renderHotbar(p);
    if (this.modalKind === 'shop') this.renderShop();
    else if (this.modalKind === 'inv' || this.modalKind === 'chest') this.renderInventory();
  }

  private renderHotbar(p: PlayerState) {
    const slots = p.inv.slice(0, HOTBAR_SIZE);
    const sig = `${JSON.stringify(slots)}|${p.selected}|${p.water}`;
    if (sig === this.hotbarSig) return;
    this.hotbarSig = sig;
    this.hotbar.innerHTML = slots
      .map((s, i) => {
        const inner = s
          ? `<img class="px" src="${iconURL(s.item)}" alt="">` +
            (s.qty > 1 ? `<span class="qty">${s.qty}</span>` : '') +
            (s.item === 'can' ? `<span class="water"><i style="width:${pct(p.water, CAN_CAPACITY)}"></i></span>` : '')
          : '';
        return `<button class="slot ${i === p.selected ? 'sel' : ''}" data-slot="${i}" title="${slotTitle(s)}">
          <span class="key">${(i + 1) % 10}</span>${inner}</button>`;
      })
      .join('');
  }

  toast(text: string, ms = 2800) {
    const t = h('div', 'toast panel');
    t.textContent = text;
    this.toasts.append(t);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild!.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 400);
    }, ms);
  }

  // ---------------------------------------------------------------- modais

  get modalOpen() {
    return !!this.modal;
  }

  closeModal() {
    this.modal?.remove();
    this.modal = null;
    this.modalKind = null;
    this.openChestId = null;
    this.held = null;
    this.endDrag();
  }

  private openModal(kind: ModalKind) {
    this.closeModal();
    const back = h('div', 'modal-back');
    const box = h('div', `modal panel modal-${kind}`);
    back.append(box);
    back.addEventListener('pointerdown', (e) => {
      if (e.target === back) this.closeModal();
      else this.onSlotDown(e);
    });
    back.addEventListener('pointermove', (e) => this.moveGhost(e));
    back.addEventListener('pointerup', (e) => this.onSlotUp(e));
    back.addEventListener('click', (e) => this.onModalClick(e));
    back.addEventListener('change', (e) => this.onModalChange(e));
    this.root.append(back);
    this.modal = back;
    this.modalKind = kind;
    this.gridSig = '';
    return box;
  }

  toggleShop() {
    if (this.modalKind === 'shop') this.closeModal();
    else this.openShop();
  }

  openShop(tab?: 'buy' | 'sell') {
    if (tab) this.shopTab = tab;
    if (this.modalKind !== 'shop') this.openModal('shop');
    this.renderShop();
  }

  toggleHelp() {
    if (this.modalKind === 'help') this.closeModal();
    else this.openHelp();
  }

  toggleInventory() {
    if (this.modalKind === 'inv' || this.modalKind === 'chest') this.closeModal();
    else {
      this.openModal('inv');
      this.renderInventory();
    }
  }

  openChest(id: number) {
    this.openModal('chest');
    this.openChestId = id;
    this.renderInventory();
  }

  private renderShop() {
    const box = this.modal?.querySelector<HTMLElement>('.modal');
    if (!box) return;
    const p = this.player;
    const lvl = levelFromXp(p.xp);
    const sellTotal = SELLABLE.reduce((n, i) => n + qty(p, i) * (ITEMS[i].sellPrice ?? 0), 0);
    const buy = this.shopTab === 'buy';

    const buyRows = CROP_ORDER.map((c: CropId) => {
      const d = CROPS[c];
      const locked = lvl < d.unlockLevel;
      const info = `${fmtDur(d.growMs)}${d.regrowMs ? ` · rebrota em ${fmtDur(d.regrowMs)}` : ''} · vende por ${d.sellPrice}`;
      const right = locked
        ? `<span class="lock">🔒 Nv ${d.unlockLevel}</span>`
        : `<span class="price">${coin()}${d.seedPrice}</span>
           <button class="btn small" data-buy="${c}" data-qty="1" ${p.coins < d.seedPrice ? 'disabled' : ''}>+1</button>
           <button class="btn small" data-buy="${c}" data-qty="5" ${p.coins < d.seedPrice * 5 ? 'disabled' : ''}>+5</button>`;
      return `<div class="row ${locked ? 'locked' : ''}">
        <img class="px" src="${iconURL(seedOf(c))}" alt="">
        <div class="grow"><b>${d.name}</b> <span class="have">(${qty(p, seedOf(c))})</span><small>⏱ ${info}</small></div>
        ${right}</div>`;
    }).join('');

    const sellable = SELLABLE.filter((i) => qty(p, i) > 0);
    const sellRows = sellable.length
      ? sellable.map((i) => {
          const n = qty(p, i);
          const price = ITEMS[i].sellPrice ?? 0;
          return `<div class="row">
            <img class="px" src="${iconURL(i)}" alt="">
            <div class="grow"><b>${ITEMS[i].name}</b><small>${n} × ${price}</small></div>
            <button class="btn small" data-sell="${i}">Vender ${coin()}${n * price}</button></div>`;
        }).join('') +
        `<div class="row-actions"><button class="btn" data-sellall>Vender tudo ${coin()}${sellTotal}</button></div>`
      : `<p class="empty">Nada pra vender ainda. Plante, regue e colha! 🌱</p>`;

    const scroll = box.querySelector('.rows')?.scrollTop ?? 0;
    box.innerHTML = `
      <div class="modal-head">
        <h2>🛒 Mercadinho</h2>
        <span class="panel pill">${coin()}${p.coins}</span>
        <button class="panel icon-btn" data-close title="Fechar (Esc)">✕</button>
      </div>
      <div class="tabs">
        <button class="tab ${buy ? 'on' : ''}" data-tab="buy">Sementes</button>
        <button class="tab ${buy ? '' : 'on'}" data-tab="sell">Vender${sellTotal ? ` (${sellTotal})` : ''}</button>
      </div>
      <div class="rows">${buy ? buyRows : sellRows}</div>`;
    box.querySelector('.rows')!.scrollTop = scroll;
  }

  // ---------------------------------------------------------------- inventário, baú e ficha

  private chestSlots(): Slots | null {
    if (this.openChestId === null) return null;
    return findChest(worldOf(this.state, this.player), this.openChestId)?.slots ?? null;
  }

  private slotAt(ref: SlotRef): Slot | null {
    const slots = ref.c === 'inv' ? this.player.inv : this.chestSlots();
    return slots?.[ref.i] ?? null;
  }

  private gridHTML(slots: Slots, from: number, to: number, ref: (i: number) => SlotRef, selected = -1) {
    let out = '';
    for (let i = from; i < to; i++) {
      const s = slots[i];
      const r = ref(i);
      const held = this.held && sameRef(this.held, r);
      const attrs = r.c === 'inv' ? `data-c="inv"` : `data-c="chest" data-id="${r.id}"`;
      out += `<div class="islot ${held ? 'held' : ''} ${i === selected ? 'sel' : ''}" ${attrs} data-i="${i}" title="${slotTitle(s)}">
        ${s ? `<img class="px" src="${iconURL(s.item)}" alt="">${s.qty > 1 ? `<span class="qty">${s.qty}</span>` : ''}` : ''}</div>`;
    }
    return out;
  }

  private renderInventory() {
    const box = this.modal?.querySelector<HTMLElement>('.modal');
    if (!box) return;
    const p = this.player;
    const chest = this.modalKind === 'chest' ? this.chestSlots() : null;
    const chestId = this.openChestId ?? 0;

    if (!box.querySelector('.inv-grids')) {
      box.innerHTML = `
        <div class="modal-head">
          <h2>${chest ? '📦 Baú' : '🎒 Inventário'}</h2>
          <span class="panel pill">${coin()}<span data-coins></span></span>
          <button class="panel icon-btn" data-close title="Fechar (Esc)">✕</button>
        </div>
        ${chest ? '' : `<div class="tabs inv-tabs">
          <button class="tab" data-view="items">🎒 Itens</button>
          <button class="tab" data-view="char">👤 Ficha</button>
        </div>`}
        <div class="inv-layout">
          ${chest ? '' : '<div class="char"></div>'}
          <div class="inv-grids"></div>
        </div>
        <small class="hint">Arraste (ou clique e clique) pra organizar · Shift+clique move rápido${chest ? ' entre baú e mochila' : ''}</small>`;
    }
    // em telas pequenas o inventário vira abas (itens | ficha); em telas grandes mostra os dois
    if (chest) delete box.dataset.view;
    else box.dataset.view = this.invView;
    box.querySelectorAll<HTMLElement>('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === this.invView));
    box.querySelector<HTMLElement>('[data-coins]')!.textContent = String(p.coins);
    const charEl = box.querySelector<HTMLElement>('.char');
    if (charEl) charEl.innerHTML = this.charSheet(p);

    // as grades só são refeitas quando algo muda (e nunca no meio de um arrasto)
    const sig = JSON.stringify([p.inv, chest, p.selected, this.held]);
    if (sig === this.gridSig || this.dragging) return;
    this.gridSig = sig;
    const inv = (i: number): SlotRef => ({ c: 'inv', i });
    box.querySelector('.inv-grids')!.innerHTML =
      (chest
        ? `<div class="grid-label">Baú</div><div class="grid">${this.gridHTML(chest, 0, chest.length, (i) => ({ c: 'chest', id: chestId, i }))}</div>`
        : '') +
      `<div class="grid-label">Barra rápida</div>
       <div class="grid">${this.gridHTML(p.inv, 0, HOTBAR_SIZE, inv, p.selected)}</div>
       <div class="grid-label">Mochila</div>
       <div class="grid">${this.gridHTML(p.inv, HOTBAR_SIZE, INV_SIZE, inv)}</div>`;
  }

  private avatar = new Map<string, string>();

  private charSheet(p: PlayerState) {
    const now = Date.now();
    const lvl = levelFromXp(p.xp);
    const base = xpForLevel(lvl);
    const next = xpForLevel(lvl + 1);
    const max = energyMax(p);
    let img = this.avatar.get(p.color);
    if (!img) this.avatar.set(p.color, (img = playerFrames(p.color).down[0].toDataURL()));
    const buffs = [
      isCaffeinated(p, now) ? `<li>☕ <b>Cafeinado</b> · anda mais rápido · ${fmtDur(p.caffeineUntil - now)}</li>` : '',
      p.restReadyAt > now ? `<li>💤 Cama disponível em ${fmtDur(p.restReadyAt - now)}</li>` : '',
    ].join('');
    return `
      <div class="char-top">
        <img class="px avatar" src="${img}" alt="">
        <div><b>${p.name}</b><small>Nível ${lvl} · Fazendeiro(a)</small></div>
      </div>
      <label>Experiência <span>${p.xp - base}/${next - base}</span></label>
      <div class="bar"><i style="width:${pct(p.xp - base, next - base)}"></i></div>
      <label>Energia <span>${p.energy}/${max}</span></label>
      <div class="bar energy"><i class="${p.energy < max * 0.2 ? 'low' : ''}" style="width:${pct(p.energy, max)}"></i></div>
      <label>Regador <span>${p.water}/${CAN_CAPACITY}</span></label>
      <div class="bar water"><i style="width:${pct(p.water, CAN_CAPACITY)}"></i></div>
      ${buffs ? `<ul class="buffs">${buffs}</ul>` : ''}
      <ul class="stats">
        <li>🌾 Colhidos <b>${p.stats.harvested}</b></li>
        <li>🪙 Ganhos <b>${p.stats.earned}</b></li>
        <li>☕ Cafés <b>${p.stats.coffees}</b></li>
      </ul>`;
  }

  private slotEl(e: PointerEvent) {
    const doc = this.root.ownerDocument;
    return (doc.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('.islot') ?? null;
  }

  private refOf(el: HTMLElement): SlotRef {
    const d = el.dataset;
    return d.c === 'chest' ? { c: 'chest', id: Number(d.id), i: Number(d.i) } : { c: 'inv', i: Number(d.i) };
  }

  private move(from: SlotRef, to: SlotRef) {
    if (!sameRef(from, to)) this.host.dispatch({ type: 'moveSlot', playerId: this.host.playerId, from, to });
  }

  private onSlotDown(e: PointerEvent) {
    const el = this.slotEl(e);
    if (!el || e.button !== 0) return;
    e.preventDefault();
    const ref = this.refOf(el);
    if (e.shiftKey) {
      this.held = null;
      this.host.dispatch({
        type: 'quickMove', playerId: this.host.playerId, from: ref, chestId: this.openChestId ?? undefined,
      });
      return;
    }
    if (this.held) {
      const from = this.held;
      this.held = null;
      this.move(from, ref);
      this.renderInventory();
      return;
    }
    const s = this.slotAt(ref);
    if (!s) return;
    this.held = ref;
    this.dragging = true;
    el.classList.add('held');
    this.ghost = h('img', 'ghost px');
    this.ghost.src = iconURL(s.item);
    this.root.append(this.ghost);
    this.moveGhost(e);
  }

  private moveGhost(e: PointerEvent) {
    if (!this.ghost) return;
    const r = this.root.getBoundingClientRect();
    this.ghost.style.transform = `translate(${e.clientX - r.left - 16}px, ${e.clientY - r.top - 16}px)`;
  }

  private endDrag() {
    this.dragging = false;
    this.ghost?.remove();
    this.ghost = null;
  }

  private onSlotUp(e: PointerEvent) {
    if (!this.dragging) return;
    this.endDrag();
    const el = this.slotEl(e);
    const from = this.held!;
    if (el && !sameRef(from, this.refOf(el))) {
      this.held = null;
      this.move(from, this.refOf(el));
    }
    // soltou no mesmo slot: fica "segurando" até o próximo clique
    this.gridSig = '';
    this.renderInventory();
  }

  // ---------------------------------------------------------------- ajuda

  openHelp() {
    const box = this.openModal('help');
    box.innerHTML = `
      <div class="modal-head"><h2>🌱 HappyFarm</h2><button class="panel icon-btn" data-close title="Fechar (Esc)">✕</button></div>
      <div class="rows help">
        <p><b>Só com o mouse:</b> clique em algo e o fazendeiro vai até lá e usa a ferramenta certa
          (árvore → machado, pedra → picareta, lago → enche o regador).</p>
        <p><b>Plantar:</b> selecione a <b>enxada</b> e clique na grama pra arar → escolha uma <b>semente</b>
          e clique no canteiro → <b>regue</b> 💧.</p>
        <p>As plantas crescem em <b>tempo real</b>, mesmo com o jogo fechado. Regadas crescem 2× mais rápido
          (a água dura 30 min). Quando brilharem ✨, clique pra colher e venda na <b>caixa</b> ao lado da casa.</p>
        <p><b>Energia ⚡:</b> ferramentas cansam. A energia volta sozinha com o tempo, mais rápido com um
          <b>café</b> ☕ (cafeteira dentro de casa) ou <b>descansando na cama</b>.</p>
        <p><b>📌 Flutuar (M):</b> abre uma janelinha sempre por cima, pra deixar no cantinho da tela.</p>
        <p class="keys"><kbd>WASD</kbd>/<kbd>setas</kbd> andar · <kbd>Espaço</kbd> usar/beber · <kbd>1</kbd>–<kbd>0</kbd> item ·
          <kbd>I</kbd> inventário · <kbd>B</kbd> loja · <kbd>F</kbd> tela cheia · <kbd>+</kbd>/<kbd>−</kbd> zoom</p>
        <label class="check"><input type="checkbox" data-setting="alwaysDay" ${this.host.settings.alwaysDay ? 'checked' : ''}>
          Sempre de dia (ignorar o relógio real)</label>
      </div>
      <div class="row-actions">
        <button class="btn danger small" data-reset>Recomeçar fazenda</button>
        <button class="btn" data-close>Bora plantar!</button>
      </div>`;
    this.host.settings.seenHelp = true;
    this.host.saveSettings();
  }

  private onModalClick(e: Event) {
    const t = (e.target as HTMLElement).closest<HTMLElement>(
      '[data-buy],[data-sell],[data-sellall],[data-tab],[data-close],[data-reset],[data-view]',
    );
    if (!t) return;
    const { host } = this;
    const d = t.dataset;
    if (d.close !== undefined) this.closeModal();
    else if (d.view) {
      this.invView = d.view as 'items' | 'char';
      this.renderInventory();
    }
    else if (d.tab) {
      this.shopTab = d.tab as 'buy' | 'sell';
      this.renderShop();
    } else if (d.buy) {
      host.dispatch({ type: 'buy', playerId: host.playerId, item: seedOf(d.buy as CropId), qty: Number(d.qty) });
    } else if (d.sell) {
      const item = d.sell as ItemId;
      host.dispatch({ type: 'sell', playerId: host.playerId, item, qty: qty(this.player, item) });
    } else if (d.sellall !== undefined) {
      host.dispatch({ type: 'sellAll', playerId: host.playerId });
    } else if (d.reset !== undefined) {
      if (host.win().confirm('Apagar a fazenda e começar do zero?')) host.reset();
    }
  }

  private onModalChange(e: Event) {
    const t = e.target as HTMLInputElement;
    if (t.dataset.setting === 'alwaysDay') {
      this.host.settings.alwaysDay = t.checked;
      this.host.saveSettings();
    }
  }
}
