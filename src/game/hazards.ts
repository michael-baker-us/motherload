import { HAZARDS } from "./config";
import { TileId } from "./tiles";

export interface DigHazard {
  damage: number;
  /** Death-screen cause if this kills the pod. */
  cause: string;
  /** Toast shown when it merely hurts. */
  toast: string;
}

/** Hull damage triggered by digging into a hazard tile, or null for safe tiles. */
export function digHazard(tile: TileId): DigHazard | null {
  switch (tile) {
    case TileId.GasPocket:
      return {
        damage: HAZARDS.gasDamage,
        cause: "Gas pocket explosion",
        toast: `GAS POCKET! −${HAZARDS.gasDamage} hull`,
      };
    case TileId.Lava:
      return {
        damage: HAZARDS.lavaDamage,
        cause: "Drilled into lava",
        toast: `LAVA! −${HAZARDS.lavaDamage} hull`,
      };
    default:
      return null;
  }
}

/** Hull damage for landing at `impactSpeed` px/s; 0 below the safe threshold. */
export function fallDamage(impactSpeed: number): number {
  if (impactSpeed <= HAZARDS.fallThreshold) return 0;
  return (impactSpeed - HAZARDS.fallThreshold) * HAZARDS.fallFactor;
}

/** Spawn chances during worldgen, by depth in tiles below the surface. */
export function gasChanceAt(depth: number): number {
  if (depth < HAZARDS.gasMinDepth) return 0;
  return Math.min(0.006 + (depth - HAZARDS.gasMinDepth) * 0.00002, HAZARDS.gasMaxChance);
}

export function lavaChanceAt(depth: number): number {
  if (depth < HAZARDS.lavaMinDepth) return 0;
  return Math.min(0.008 + (depth - HAZARDS.lavaMinDepth) * 0.00002, HAZARDS.lavaMaxChance);
}
