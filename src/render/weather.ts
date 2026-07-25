/**
 * Ambient seasonal weather near the surface — pollen, dust, leaves, snow, rain.
 *
 * Modelled on the magma-biome ember emitter it sits beside in the renderer:
 * spawn across the camera rect at a configured rate and let the existing
 * particle pool do the rest. It owns no renderer internals — it's handed the
 * same `spawn` callback every other effect uses — so the rate/lifecycle logic
 * stays readable and the sprite bakes stay cached in one place.
 *
 * A weather *spell* (spring's rain squalls) is a renderer-local on/off duty
 * cycle. It's purely cosmetic: the sim knows nothing about it, so it can't
 * desync a save or diverge between two clients watching the same run.
 */
import { SEASON } from "../game/config";
import type { ParticleSpec, Season, WeatherKind } from "../game/seasons";
import type { Camera } from "../engine/camera";
import { bakeFleck } from "./bake";

/** The subset of a particle this module fills in; the renderer owns the rest. */
export interface WeatherParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
  additive: boolean;
  drift?: number;
  driftHz?: number;
  driftPhase?: number;
  sprite?: HTMLCanvasElement;
  spin?: number;
  angle?: number;
  weather?: boolean;
}

/**
 * Which kinds are drawn as baked sprites rather than plain squares. A kind
 * absent here is a square — cheaper, and right for snow and dust.
 */
const SPRITE_KINDS: Partial<Record<WeatherKind, (color: string) => HTMLCanvasElement>> = {
  leaf: (c) => bakeFleck(c, 10),
  petal: (c) => bakeFleck(c, 8),
};

/** Kinds that fall from above the view; the rest are suspended in it. */
const FALLING: Record<WeatherKind, boolean> = {
  petal: false,
  mote: false,
  leaf: true,
  flake: true,
  rain: true,
};

export class Weather {
  private readonly sprites = new Map<string, HTMLCanvasElement>();
  /** Fractional particle carry-over, so low rates still emit smoothly. */
  private debt = 0;
  private spellDebt = 0;
  /** Seconds into the current spell phase, and whether it's raining. */
  private spellTime = 0;
  private spellOn = false;

  /** 0–1: how strongly the active spell is tinting the frame right now. */
  get spellStrength(): number {
    return this.spellOn ? 1 : 0;
  }

  /**
   * Emit one frame of weather. `depth` is the pod's depth in tiles; weather is
   * a surface phenomenon, so below the season's `depth` this costs nothing at
   * all — which is also what keeps it from starving the shared particle pool.
   */
  emit(
    season: Season,
    cam: Camera,
    depth: number,
    dt: number,
    reducedMotion: boolean,
    liveWeather: number,
    spawn: (p: WeatherParticle) => void,
  ): void {
    const w = season.look.weather;

    // Advance the spell clock even out of range, so surfacing mid-squall shows
    // rain already falling rather than a squall that starts on arrival.
    if (w.spell) {
      this.spellTime += dt;
      const phase = this.spellOn ? w.spell.onSeconds : w.spell.offSeconds;
      if (this.spellTime >= phase) {
        this.spellTime = 0;
        this.spellOn = !this.spellOn;
      }
    } else {
      this.spellOn = false;
    }

    if (depth >= w.depth) {
      this.debt = 0;
      this.spellDebt = 0;
      return;
    }
    if (liveWeather >= SEASON.weather.budget) return;

    // Fade weather out over the last stretch of its depth range rather than
    // popping off at the boundary.
    const fade = Math.min(1, Math.max(0, 1 - depth / w.depth) * 2.2);
    const motion = reducedMotion ? SEASON.weather.reducedMotionScale : 1;
    const scale = fade * motion;

    if (w.ambient) {
      this.debt = this.pour(w.ambient, this.debt, scale, cam, dt, spawn);
    }
    if (w.spell && this.spellOn) {
      this.spellDebt = this.pour(w.spell.particle, this.spellDebt, scale, cam, dt, spawn);
    }
  }

  /** Spawn `spec`'s share of this frame, carrying the fraction into `debt`. */
  private pour(
    spec: ParticleSpec,
    debt: number,
    scale: number,
    cam: Camera,
    dt: number,
    spawn: (p: WeatherParticle) => void,
  ): number {
    let budget = debt + SEASON.weather.ratePerSec * spec.rate * scale * dt;
    while (budget >= 1) {
      budget -= 1;
      spawn(this.make(spec, cam));
    }
    return budget;
  }

  private make(spec: ParticleSpec, cam: Camera): WeatherParticle {
    const falling = FALLING[spec.kind];
    const life = rand(spec.life[0], spec.life[1]);
    const color = spec.colors[Math.floor(Math.random() * spec.colors.length)]!;
    return {
      // Falling weather enters from above the view; suspended weather is
      // seeded throughout it, so it reads as already-there air rather than a
      // curtain descending from the top of the screen.
      x: cam.x - 40 + Math.random() * (cam.viewWidth + 80),
      y: falling ? cam.y - 12 : cam.y + Math.random() * cam.viewHeight,
      vx: rand(spec.vx[0], spec.vx[1]),
      vy: rand(spec.vy[0], spec.vy[1]),
      life,
      maxLife: life,
      size: rand(spec.size[0], spec.size[1]),
      color,
      gravity: spec.gravity,
      additive: spec.additive,
      drift: spec.drift || undefined,
      driftHz: spec.driftHz || undefined,
      driftPhase: Math.random() * Math.PI * 2,
      sprite: this.sprite(spec.kind, color),
      spin: spec.spin ? (Math.random() - 0.5) * 2 * spec.spin : undefined,
      angle: Math.random() * Math.PI * 2,
      weather: true,
    };
  }

  private sprite(kind: WeatherKind, color: string): HTMLCanvasElement | undefined {
    const bake = SPRITE_KINDS[kind];
    if (!bake) return undefined;
    const key = `${kind}:${color}`;
    let sprite = this.sprites.get(key);
    if (!sprite) {
      sprite = bake(color);
      this.sprites.set(key, sprite);
    }
    return sprite;
  }
}

function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

/** Exported for the "a new season is data only" coverage test. */
export const WEATHER_KINDS: readonly WeatherKind[] = ["petal", "leaf", "flake", "mote", "rain"];
