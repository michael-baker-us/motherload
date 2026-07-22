import { DRILL } from "./config";

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
  GasPocket, // renders like the surrounding stratum — a hidden trap that explodes when dug
  Lava, // visible hazard; drilling through it burns the hull
  Anomaly, // the vertical-slice objective: a glowing beacon in a crafted cavern
  // Diggable strata (appended so existing tile ids / saves stay stable). The
  // filler material changes with depth: topsoil dirt → stone → granite.
  Stone,
  Granite,
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
  [TileId.Dirt]: { name: "dirt", color: "#95502b", solid: true, hardness: 0.25, value: 0, cargoUnits: 0 },
  [TileId.Rock]: { name: "rock", color: "#565259", solid: true, hardness: null, value: 0, cargoUnits: 0 },
  [TileId.Ironium]: { name: "ironium", color: "#b3703a", solid: true, hardness: 0.45, value: 30, cargoUnits: 1 },
  [TileId.Bronzium]: { name: "bronzium", color: "#d98e2b", solid: true, hardness: 0.5, value: 60, cargoUnits: 1 },
  [TileId.Silverium]: { name: "silverium", color: "#c9ccd4", solid: true, hardness: 0.55, value: 120, cargoUnits: 1 },
  [TileId.Goldium]: { name: "goldium", color: "#f0c020", solid: true, hardness: 0.65, value: 250, cargoUnits: 1 },
  [TileId.Einsteinium]: { name: "einsteinium", color: "#5fd75f", solid: true, hardness: 0.8, value: 800, cargoUnits: 1 },
  [TileId.Diamond]: { name: "diamond", color: "#8ef0e8", solid: true, hardness: 1.0, value: 2000, cargoUnits: 1 },
  [TileId.GasPocket]: { name: "gas pocket", color: "#95502b", solid: true, hardness: 0.25, value: 0, cargoUnits: 0 },
  [TileId.Lava]: { name: "lava", color: "#ff5a1f", solid: true, hardness: 0.3, value: 0, cargoUnits: 0 },
  // Undiggable landmark — a permanent beacon, drawn specially by the renderer.
  [TileId.Anomaly]: { name: "anomaly", color: "#9ff0ff", solid: true, hardness: null, value: 0, cargoUnits: 0 },
  // Diggable strata — deeper materials are tougher (hardness still ×depth-scale).
  [TileId.Stone]: { name: "stone", color: "#6b625a", solid: true, hardness: 0.34, value: 0, cargoUnits: 0 },
  [TileId.Granite]: { name: "granite", color: "#8f8894", solid: true, hardness: 0.6, value: 0, cargoUnits: 0 },
};

/**
 * The diggable filler material by depth. Ordered shallow→deep; the first stratum
 * whose `maxDepth` isn't exceeded wins. Worldgen wavers the boundary with noise
 * so the transitions read as natural bands, not hard lines. Kept shallow so the
 * ~150 m demo stays mostly dirt/stone — granite is the deep endless-game rock.
 */
export const STRATA: Array<{ tile: TileId; maxDepth: number }> = [
  { tile: TileId.Dirt, maxDepth: 60 },
  { tile: TileId.Stone, maxDepth: 250 },
  { tile: TileId.Granite, maxDepth: Infinity },
];

export function stratumAt(depth: number): TileId {
  for (const s of STRATA) if (depth <= s.maxDepth) return s.tile;
  return TileId.Granite;
}

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

/**
 * Soil stiffens with depth: the effective hardness of any tile is its base
 * hardness times this. This is what makes drill upgrades matter — a rusty
 * drill that chews the topsoil crawls at 500 m.
 */
export function hardnessScaleAt(depth: number): number {
  return Math.min(1 + Math.max(0, depth) / DRILL.hardnessDepth, DRILL.hardnessMaxScale);
}

export function bandChanceAt(band: MineralBand, depth: number): number {
  if (depth < band.minDepth || depth > band.maxDepth) return 0;
  const t = (depth - band.minDepth) / (band.maxDepth - band.minDepth);
  const rampIn = Math.min(1, t / 0.15);
  const rampOut = Math.min(1, (1 - t) / 0.3);
  return band.chance * Math.min(rampIn, rampOut);
}
