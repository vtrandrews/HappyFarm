// Inventário em slots fixos (estilo Stardew/Minecraft). Um "Slots" é só um array
// serializável; o mesmo código serve pra mochila do jogador e pros baús.

import { stackMax, type ItemId } from './data';

export interface Slot {
  item: ItemId;
  qty: number;
}

export type Slots = (Slot | null)[];

export const emptySlots = (n: number): Slots => Array.from({ length: n }, () => null);

export function countItem(slots: Slots, item: ItemId): number {
  let n = 0;
  for (const s of slots) if (s?.item === item) n += s.qty;
  return n;
}

/** Quantas unidades de `item` ainda cabem em slots[start, end). */
export function spaceFor(slots: Slots, item: ItemId, start = 0, end = slots.length): number {
  const max = stackMax(item);
  let n = 0;
  for (let i = start; i < end; i++) {
    const s = slots[i];
    if (!s) n += max;
    else if (s.item === item) n += max - s.qty;
  }
  return n;
}

/** Adiciona completando pilhas existentes e depois slots vazios. Retorna o que sobrou. */
export function addItem(slots: Slots, item: ItemId, n: number, start = 0, end = slots.length): number {
  const max = stackMax(item);
  for (let i = start; i < end && n > 0; i++) {
    const s = slots[i];
    if (s?.item === item && s.qty < max) {
      const take = Math.min(n, max - s.qty);
      s.qty += take;
      n -= take;
    }
  }
  for (let i = start; i < end && n > 0; i++) {
    if (slots[i]) continue;
    const take = Math.min(n, max);
    slots[i] = { item, qty: take };
    n -= take;
  }
  return n;
}

/** Remove até `n` unidades. Retorna quantas saíram. */
export function removeItem(slots: Slots, item: ItemId, n: number): number {
  let removed = 0;
  for (let i = slots.length - 1; i >= 0 && removed < n; i--) {
    const s = slots[i];
    if (s?.item !== item) continue;
    const take = Math.min(n - removed, s.qty);
    s.qty -= take;
    removed += take;
    if (!s.qty) slots[i] = null;
  }
  return removed;
}

/** Arrastar um slot pra outro: junta pilhas do mesmo item, senão troca. */
export function moveSlot(a: Slots, ai: number, b: Slots, bi: number) {
  const sa = a[ai];
  if (!sa || (a === b && ai === bi)) return;
  const sb = b[bi];
  if (sb && sb.item === sa.item && stackMax(sa.item) > 1) {
    const take = Math.min(sa.qty, stackMax(sa.item) - sb.qty);
    sb.qty += take;
    sa.qty -= take;
    if (!sa.qty) a[ai] = null;
    return;
  }
  a[ai] = sb;
  b[bi] = sa;
}

/** Shift+clique: manda a pilha inteira pra outra área (baú ↔ mochila, barra ↔ mochila). */
export function quickMove(from: Slots, fi: number, to: Slots, start = 0, end = to.length) {
  const s = from[fi];
  if (!s) return;
  const left = addItem(to, s.item, s.qty, start, end);
  if (left === 0) from[fi] = null;
  else s.qty = left;
}
