export type PixelCell = {
  colorIndex: number;
  phase: number;
  brightness: number;
  sparklePhase: number;
};

export type Hsl = readonly [number, number, number];

export function hashSeed(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash << 5) - hash + (seed.charCodeAt(index) ?? 0);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function createRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let next = Math.imul(state ^ (state >>> 15), 1 | state);
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function generatePalette(hash: number, hueSpread: number): [Hsl, Hsl, Hsl] {
  const rng = createRng(hash);
  const baseHue = rng() * 360;
  const sat = 75 + rng() * 20;
  return [
    [baseHue, sat, 55 + rng() * 10],
    [
      (baseHue - hueSpread + rng() * hueSpread * 2) % 360,
      sat - 5 + rng() * 10,
      40 + rng() * 15,
    ],
    [
      (baseHue - hueSpread + rng() * hueSpread * 2) % 360,
      sat - 10 + rng() * 15,
      60 + rng() * 15,
    ],
  ];
}

export function generateGrid(hash: number, gridSize: number): PixelCell[][] {
  if (!Number.isInteger(gridSize) || gridSize <= 0) {
    throw new Error("pixel avatar grid size must be a positive integer");
  }
  const rng = createRng(hash + 1);
  const grid: PixelCell[][] = [];
  for (let y = 0; y < gridSize; y += 1) {
    const row: PixelCell[] = [];
    for (let x = 0; x < gridSize; x += 1) {
      row.push({
        brightness: 0.3 + rng() * 0.7,
        colorIndex: Math.floor(rng() * 3),
        phase: rng() * Math.PI * 2,
        sparklePhase: rng() * Math.PI * 2,
      });
    }
    grid.push(row);
  }
  return grid;
}