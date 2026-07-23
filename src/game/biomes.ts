/**
 * Depth biomes — zones that make the descent read as a journey through distinct
 * places. Each layers a mood (fog/tint colour) and ambient character on top of
 * the material strata (tiles.ts), and its name is announced when first reached.
 * Data-driven and ordered shallow→deep; the deepest whose `minDepth` you've
 * passed wins. Depth is in metres (tiles below the surface).
 */
export interface Biome {
  name: string;
  minDepth: number;
  /** Base colour of the depth-darkness overlay — the dominant tint down deep. */
  fog: readonly [number, number, number];
  /** Subtle full-screen mood wash (matters most in the lit shallows). */
  tint: string;
  tintAlpha: number;
  /** Multiplier on the ambient rumble bed. */
  rumble: number;
  /** Lowpass cutoff (Hz) of the rumble bed — its tone/character per biome. */
  rumbleFreq: number;
  /** Ambient heat pushed into the pod, units/s (see HEAT in config). */
  heat: number;
}

export const BIOMES: readonly Biome[] = [
  { name: "Topsoil", minDepth: 0, fog: [8, 4, 2], tint: "#7a5a30", tintAlpha: 0, rumble: 0.5, rumbleFreq: 90, heat: 0 },
  { name: "The Caverns", minDepth: 60, fog: [5, 7, 10], tint: "#3a4a5a", tintAlpha: 0.05, rumble: 1.0, rumbleFreq: 110, heat: 2 },
  { name: "Magma Depths", minDepth: 250, fog: [20, 5, 3], tint: "#7a2412", tintAlpha: 0.08, rumble: 1.4, rumbleFreq: 150, heat: 13 },
  { name: "The Deep", minDepth: 700, fog: [4, 6, 18], tint: "#1e2a7a", tintAlpha: 0.09, rumble: 1.1, rumbleFreq: 55, heat: 8 },
];

export function biomeIndexAt(depth: number): number {
  let idx = 0;
  for (let i = 0; i < BIOMES.length; i++) if (depth >= BIOMES[i]!.minDepth) idx = i;
  return idx;
}

export function biomeAt(depth: number): Biome {
  return BIOMES[biomeIndexAt(depth)]!;
}
