export enum TileId {
  Sky = 0, // above the surface, never solid
  Empty, // dug-out tunnel
  Dirt,
  Rock, // undiggable — shapes the caves you must fly around
  Ironium,
  Bronzium,
  Silverium,
  Goldium,
  Einsteinium,
  Diamond,
  GasPocket, // renders exactly like dirt — a hidden trap that explodes when dug
  Lava, // visible hazard; drilling through it burns the hull
}

export interface TileDef {
  name: string;
  color: string;
  solid: boolean;
  /** Seconds to dig at drill power 1. null = undiggable. */
  hardness: number | null;
  /** Sale value in $ (used once the economy lands). */
  value: number;
  /** Cargo space consumed (used once the economy lands). */
  cargoUnits: number;
}

export const TILE_DEFS: Record<TileId, TileDef> = {
  [TileId.Sky]: { name: "sky", color: "#87c5e8", solid: false, hardness: null, value: 0, cargoUnits: 0 },
  [TileId.Empty]: { name: "empty", color: "#241408", solid: false, hardness: null, value: 0, cargoUnits: 0 },
  [TileId.Dirt]: { name: "dirt", color: "#7a4a21", solid: true, hardness: 0.25, value: 0, cargoUnits: 0 },
  [TileId.Rock]: { name: "rock", color: "#565259", solid: true, hardness: null, value: 0, cargoUnits: 0 },
  [TileId.Ironium]: { name: "ironium", color: "#b3703a", solid: true, hardness: 0.45, value: 30, cargoUnits: 1 },
  [TileId.Bronzium]: { name: "bronzium", color: "#d98e2b", solid: true, hardness: 0.5, value: 60, cargoUnits: 1 },
  [TileId.Silverium]: { name: "silverium", color: "#c9ccd4", solid: true, hardness: 0.55, value: 120, cargoUnits: 1 },
  [TileId.Goldium]: { name: "goldium", color: "#f0c020", solid: true, hardness: 0.65, value: 250, cargoUnits: 1 },
  [TileId.Einsteinium]: { name: "einsteinium", color: "#5fd75f", solid: true, hardness: 0.8, value: 800, cargoUnits: 1 },
  [TileId.Diamond]: { name: "diamond", color: "#8ef0e8", solid: true, hardness: 1.0, value: 2000, cargoUnits: 1 },
  [TileId.GasPocket]: { name: "gas pocket", color: "#7a4a21", solid: true, hardness: 0.25, value: 0, cargoUnits: 0 },
  [TileId.Lava]: { name: "lava", color: "#ff5a1f", solid: true, hardness: 0.3, value: 0, cargoUnits: 0 },
};

/**
 * Where each mineral spawns. Depth is in tiles below the surface row.
 * Spawn chance is trapezoidal: quick ramp-in over the first 15% of the band,
 * full `chance` through the middle, ramp-out over the last 30%. (A triangular
 * ramp left the top of each band nearly barren — playtesting found the first
 * 50m had almost nothing to mine.)
 */
export interface MineralBand {
  tile: TileId;
  minDepth: number;
  maxDepth: number;
  chance: number;
}

export const MINERAL_BANDS: MineralBand[] = [
  { tile: TileId.Ironium, minDepth: 1, maxDepth: 220, chance: 0.06 },
  { tile: TileId.Bronzium, minDepth: 40, maxDepth: 450, chance: 0.04 },
  { tile: TileId.Silverium, minDepth: 150, maxDepth: 800, chance: 0.035 },
  { tile: TileId.Goldium, minDepth: 350, maxDepth: 1200, chance: 0.03 },
  { tile: TileId.Einsteinium, minDepth: 700, maxDepth: 1650, chance: 0.022 },
  { tile: TileId.Diamond, minDepth: 1200, maxDepth: 1990, chance: 0.016 },
];

/** Rock density grows with depth so the deep game is more of a maze. */
export function rockChanceAt(depth: number): number {
  return Math.min(0.03 + depth * 0.00006, 0.15);
}

export function bandChanceAt(band: MineralBand, depth: number): number {
  if (depth < band.minDepth || depth > band.maxDepth) return 0;
  const t = (depth - band.minDepth) / (band.maxDepth - band.minDepth);
  const rampIn = Math.min(1, t / 0.15);
  const rampOut = Math.min(1, (1 - t) / 0.3);
  return band.chance * Math.min(rampIn, rampOut);
}
