/**
 * Heat — a second resource axis alongside fuel. Depth (via the biome's ambient
 * heat) and drilling push heat up; the radiator sheds it, much faster near the
 * surface. When the incoming heat outpaces cooling the pod overheats and the
 * hull cooks. Pure and framework-free so it unit-tests without a canvas; the
 * lava-drill spike is a discrete event `game.ts` adds separately.
 */
import { HEAT } from "./config";

export interface HeatInput {
  /** Current heat, in the same units as `maxHeat`. */
  heat: number;
  maxHeat: number;
  /** Depth in tiles below the surface (0 at the surface). */
  depth: number;
  /** Ambient heat pushed in by the current biome, units/s. */
  ambient: number;
  /** Whether the pod is actively drilling this step. */
  drilling: boolean;
  /** Cooling multiplier from the Coolant upgrade (>= 1). */
  coolMult: number;
}

export interface HeatResult {
  heat: number;
  /** Hull damage to apply this step from overheating (0 unless pinned at max). */
  overheatDamage: number;
}

/** Units/s the radiator sheds — boosted in the shallow band, scaled by upgrades. */
export function coolingRate(depth: number, coolMult: number): number {
  const shallow = depth <= HEAT.surfaceCoolDepth ? HEAT.surfaceCoolBonus : 0;
  return (HEAT.baseCooling + shallow) * coolMult;
}

/**
 * Advance heat by `dt`. Heat is clamped to [0, maxHeat]; overheat damage is
 * charged only when heat *would* exceed the cap this step (genuinely gaining
 * heat at the ceiling), not merely while it sits pinned there and cools.
 */
export function stepHeat(dt: number, i: HeatInput): HeatResult {
  const gain = i.ambient + (i.drilling ? HEAT.drillHeat : 0);
  const cool = coolingRate(i.depth, i.coolMult);
  const raw = i.heat + (gain - cool) * dt;
  const heat = Math.max(0, Math.min(i.maxHeat, raw));
  const overheatDamage = raw > i.maxHeat ? HEAT.overheatDamage * dt : 0;
  return { heat, overheatDamage };
}
