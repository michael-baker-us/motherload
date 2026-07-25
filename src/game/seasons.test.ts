import { describe, expect, it } from "vitest";
import { SEASON } from "./config";
import { STRATA, TILE_DEFS } from "./tiles";
import {
  DEFAULT_SEASON,
  SEASONS,
  SEASONS_BY_ID,
  isSeasonId,
  seasonById,
  seasonFog,
  seasonIndexById,
  windAccelAt,
} from "./seasons";

describe("season table", () => {
  it("has four seasons with unique ids", () => {
    expect(SEASONS).toHaveLength(4);
    expect(new Set(SEASONS.map((s) => s.id)).size).toBe(4);
  });

  it("agrees with the by-id lookup", () => {
    for (const season of SEASONS) expect(SEASONS_BY_ID[season.id]).toBe(season);
  });

  it("recognises every id and rejects junk", () => {
    for (const season of SEASONS) expect(isSeasonId(season.id)).toBe(true);
    expect(isSeasonId("autumnal")).toBe(false);
    expect(isSeasonId(undefined)).toBe(false);
    expect(isSeasonId(3)).toBe(false);
  });

  it("falls back to the default for anything unresolvable", () => {
    expect(seasonById("winter").id).toBe("winter");
    expect(seasonById("nope").id).toBe(DEFAULT_SEASON);
    expect(seasonById(undefined).id).toBe(DEFAULT_SEASON);
    expect(seasonIndexById("nope")).toBe(seasonIndexById(DEFAULT_SEASON));
  });

  it("has three ridge tones per season, matching Sky's baked geometry", () => {
    for (const season of SEASONS) expect(season.look.sky.ridges).toHaveLength(3);
  });
});

// These are the invariants that make a *fifth* season safe to add without
// reading the consuming code. If one fails, the new row is dangerous, not the test.
describe("season invariants", () => {
  it("keeps every gameplay multiplier positive", () => {
    for (const s of SEASONS) {
      expect(s.runtime.burnMult).toBeGreaterThan(0);
      expect(s.runtime.coolMult).toBeGreaterThan(0);
      expect(s.runtime.gust).toBeGreaterThanOrEqual(0);
      expect(s.world.lavaChanceMult).toBeGreaterThan(0);
      expect(s.world.oreAreaMult).toBeGreaterThan(0);
    }
  });

  it("only places pockets of diggable tiles, in a sane depth band", () => {
    for (const s of SEASONS) {
      const pocket = s.world.pocket;
      if (!pocket) continue;
      // An undiggable pocket tile could wall the shaft off completely.
      expect(TILE_DEFS[pocket.tile].hardness).not.toBeNull();
      expect(pocket.minDepth).toBeLessThan(pocket.maxDepth);
      expect(pocket.area).toBeGreaterThan(0);
      expect(pocket.area).toBeLessThanOrEqual(0.5);
    }
  });

  it("keeps seasonal topsoil to a sane band and strength", () => {
    for (const s of SEASONS) {
      const soil = s.look.topsoil;
      if (!soil) continue;
      expect(soil.depth).toBeGreaterThan(0);
      // Beyond the Dirt stratum the band would bleed into stone and read wrong.
      expect(soil.depth).toBeLessThanOrEqual(STRATA[0]!.maxDepth);
      expect(soil.strength).toBeGreaterThan(0);
      expect(soil.strength).toBeLessThanOrEqual(1);
      // shade()/mixHex parse the #rrggbb form only.
      for (const c of [soil.color, soil.vein, soil.fleck]) {
        expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("gives every season a weather depth and a wind bed", () => {
    for (const s of SEASONS) {
      expect(s.look.weather.depth).toBeGreaterThan(0);
      expect(s.sound.wind.gain).toBeGreaterThan(0);
      expect(s.sound.surfaceDepth).toBeGreaterThan(0);
    }
  });
});

describe("windAccelAt", () => {
  const autumn = SEASONS_BY_ID.autumn;
  const summer = SEASONS_BY_ID.summer;

  it("is calm for a season with no gust", () => {
    expect(summer.runtime.gust).toBe(0);
    expect(windAccelAt(summer, 0, 3)).toBe(0);
  });

  it("dies out at and below the wind depth", () => {
    expect(windAccelAt(autumn, SEASON.wind.depth, 3)).toBe(0);
    expect(windAccelAt(autumn, SEASON.wind.depth + 50, 3)).toBe(0);
  });

  it("never exceeds the configured peak", () => {
    const peak = SEASON.wind.accel * autumn.runtime.gust * SEASON.windStrength;
    for (let t = 0; t < 60; t += 0.25) {
      expect(Math.abs(windAccelAt(autumn, 0, t))).toBeLessThanOrEqual(peak + 1e-9);
    }
  });

  it("weakens with depth", () => {
    // Sampled at a time where the gust is clearly non-zero.
    const t = 2.5;
    const shallow = Math.abs(windAccelAt(autumn, 0, t));
    const deep = Math.abs(windAccelAt(autumn, SEASON.wind.depth * 0.75, t));
    expect(shallow).toBeGreaterThan(deep);
  });

  it("reverses direction over a gust cycle", () => {
    let sawPositive = false;
    let sawNegative = false;
    for (let t = 0; t < 40; t += 0.2) {
      const a = windAccelAt(autumn, 0, t);
      if (a > 1) sawPositive = true;
      if (a < -1) sawNegative = true;
    }
    expect(sawPositive).toBe(true);
    expect(sawNegative).toBe(true);
  });

  it("is deterministic in time", () => {
    expect(windAccelAt(autumn, 2, 7.5)).toBe(windAccelAt(autumn, 2, 7.5));
  });
});

describe("seasonFog", () => {
  it("blends the biome fog toward the season's by SEASON.fogMix", () => {
    const winter = SEASONS_BY_ID.winter;
    const biomeFog: readonly [number, number, number] = [0, 0, 0];
    const blended = seasonFog(biomeFog, winter);
    const target = winter.look.grade.fog;
    expect(blended[0]).toBeCloseTo(target[0] * SEASON.fogMix);
    expect(blended[1]).toBeCloseTo(target[1] * SEASON.fogMix);
    expect(blended[2]).toBeCloseTo(target[2] * SEASON.fogMix);
  });

  it("leaves the fog alone when the season matches it", () => {
    const spring = SEASONS_BY_ID.spring;
    expect(seasonFog(spring.look.grade.fog, spring)).toEqual([...spring.look.grade.fog]);
  });
});
