/**
 * Lighting vocabulary and its pure math. The renderer collects a fresh list of
 * these each frame during the world pass; `Lighting` consumes them. The maths
 * here is framework-free so it can be unit-tested in node like the sim modules.
 */
import { LIGHT } from "../game/config";

/**
 * A light source that carves a soft hole in the depth darkness and washes its
 * colour back into that hole. Positions are in *screen* pixels (post-zoom).
 */
export interface Light {
  x: number;
  y: number;
  /** Halo radius in screen px. */
  radius: number;
  /** Wash tint, RGB 0–255. */
  color: readonly [number, number, number];
  /** How deeply the hole cuts the darkness, 0–1. */
  intensity: number;
  /** Colour-wash strength inside the halo, 0–1. Defaults handled by the consumer. */
  wash?: number;
}

/**
 * A one-frame additive glow decal, replayed over the darkness so emissive art
 * pierces the dark instead of being dimmed by it. Coordinates are in the world
 * pass's space (camera-relative, pre-zoom); the emissive pass re-applies the
 * same zoom+shake transform so decals register with the shaken world.
 */
export interface Emitter {
  sprite: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
  alpha: number;
}

/**
 * Depth-driven ambient darkness in [0, LIGHT.maxDarkness]. Ramps in from
 * `darkStart` and saturates over the next `darkRamp` tiles. `centerDepthTiles`
 * is the depth (in tiles below the surface) at the centre of the view.
 */
export function darknessAt(centerDepthTiles: number): number {
  const t = (centerDepthTiles - LIGHT.darkStart) / LIGHT.darkRamp;
  return Math.max(0, Math.min(LIGHT.maxDarkness, t));
}

/**
 * Steady flicker/pulse multiplier for a light's intensity. Returns `base` when
 * `amount` is 0; otherwise oscillates within `[base*(1-amount), base]` at `hz`.
 * `phase` decorrelates sources (e.g. seeded per lava tile) so they don't blink
 * in unison.
 */
export function flicker(base: number, amount: number, hz: number, time: number, phase: number): number {
  if (amount <= 0) return base;
  const wave = 0.5 + 0.5 * Math.sin(time * hz + phase);
  return base * (1 - amount + amount * wave);
}
