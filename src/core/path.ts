import { isBlocked, tileKey, type World } from './world';

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;

/**
 * BFS em 4 direções do tile inicial até qualquer tile de `goals`.
 * Retorna os tiles do caminho (sem o inicial), [] se já está num objetivo, ou null.
 */
export function findPath(
  world: World, sx: number, sy: number, goals: Set<number>, maxNodes = 5000,
): { x: number; y: number }[] | null {
  const start = tileKey(world, sx, sy);
  if (goals.has(start)) return [];
  const prev = new Map<number, number>([[start, -1]]);
  const queue = [start];
  for (let i = 0; i < queue.length && i < maxNodes; i++) {
    const cur = queue[i];
    const cx = cur % world.w;
    const cy = (cur - cx) / world.w;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (isBlocked(world, nx, ny)) continue;
      const nk = tileKey(world, nx, ny);
      if (prev.has(nk)) continue;
      prev.set(nk, cur);
      if (goals.has(nk)) {
        const out: { x: number; y: number }[] = [];
        for (let k = nk; k !== start; k = prev.get(k)!) out.push({ x: k % world.w, y: Math.floor(k / world.w) });
        return out.reverse();
      }
      queue.push(nk);
    }
  }
  return null;
}
