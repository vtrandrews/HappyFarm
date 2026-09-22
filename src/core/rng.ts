// PRNG determinístico (mulberry32). O estado cabe num número, então é serializável
// e o servidor multiplayer consegue reproduzir exatamente os mesmos sorteios.

export function stepRng(seed: number): [value: number, next: number] {
  const a = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

export function makeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    const [v, n] = stepRng(s);
    s = n;
    return v;
  };
}

/** Sorteio usando (e avançando) o estado guardado em `holder.rng`. */
export function rand(holder: { rng: number }): number {
  const [v, n] = stepRng(holder.rng);
  holder.rng = n;
  return v;
}

export function randInt(holder: { rng: number }, min: number, max: number): number {
  return min + Math.floor(rand(holder) * (max - min + 1));
}
