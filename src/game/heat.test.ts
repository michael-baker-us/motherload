import { describe, expect, it } from "vitest";
import { HEAT, SEASON } from "./config";
import { coolingRate, digHeatDelta, stepHeat } from "./heat";
import { TileId } from "./tiles";

describe("cooling rate", () => {
  it("sheds more heat in the shallow band than deep down", () => {
    const shallow = coolingRate(0, 1);
    const deep = coolingRate(HEAT.surfaceCoolDepth + 100, 1);
    expect(shallow).toBe(HEAT.baseCooling + HEAT.surfaceCoolBonus);
    expect(deep).toBe(HEAT.baseCooling);
    expect(shallow).toBeGreaterThan(deep);
  });

  it("scales with the coolant multiplier", () => {
    expect(coolingRate(500, 2)).toBe(HEAT.baseCooling * 2);
  });
});

describe("stepHeat", () => {
  const base = { heat: 0, maxHeat: 100, depth: 500, ambient: 0, drilling: false, coolMult: 1 };

  it("cools toward zero when ambient heat is below cooling", () => {
    const r = stepHeat(1, { ...base, heat: 40, ambient: 0 });
    expect(r.heat).toBe(40 - HEAT.baseCooling);
    expect(r.overheatDamage).toBe(0);
  });

  it("never cools below zero", () => {
    const r = stepHeat(10, { ...base, heat: 1, ambient: 0 });
    expect(r.heat).toBe(0);
  });

  it("climbs deep in a hot biome where gain outpaces cooling", () => {
    const r = stepHeat(1, { ...base, heat: 50, ambient: HEAT.baseCooling + 10 });
    expect(r.heat).toBe(60);
  });

  it("drilling adds heat on top of the ambient bed", () => {
    const still = stepHeat(1, { ...base, heat: 50, ambient: HEAT.baseCooling, drilling: false });
    const dig = stepHeat(1, { ...base, heat: 50, ambient: HEAT.baseCooling, drilling: true });
    expect(still.heat).toBe(50); // ambient exactly cancels cooling
    expect(dig.heat).toBeCloseTo(50 + HEAT.drillHeat);
  });

  it("clamps at capacity and charges overheat damage while genuinely overheating", () => {
    const r = stepHeat(1, { ...base, heat: 99, ambient: 100 });
    expect(r.heat).toBe(100);
    expect(r.overheatDamage).toBeCloseTo(HEAT.overheatDamage);
  });

  it("does not charge damage while pinned at max but cooling off", () => {
    const r = stepHeat(1, { ...base, heat: 100, ambient: 0 });
    expect(r.heat).toBeLessThan(100); // surfacing-equivalent cooling pulls it down
    expect(r.overheatDamage).toBe(0);
  });
});

describe("digHeatDelta", () => {
  it("spikes on lava and quenches on seasonal pockets", () => {
    expect(digHeatDelta(TileId.Lava)).toBe(HEAT.lavaSpike);
    expect(digHeatDelta(TileId.Water)).toBe(-SEASON.quench.water);
    expect(digHeatDelta(TileId.Ice)).toBe(-SEASON.quench.ice);
  });

  it("is neutral for ordinary material", () => {
    for (const tile of [TileId.Dirt, TileId.Stone, TileId.Granite, TileId.Goldium]) {
      expect(digHeatDelta(tile)).toBe(0);
    }
  });

  it("quenches harder through ice than meltwater", () => {
    expect(digHeatDelta(TileId.Ice)).toBeLessThan(digHeatDelta(TileId.Water));
  });
});

describe("seasonal cooling", () => {
  it("composes the season's coolMult with the Coolant upgrade's", () => {
    const upgrade = 2;
    const season = 1.35;
    expect(coolingRate(500, upgrade * season)).toBeCloseTo(coolingRate(500, upgrade) * season);
  });

  it("heats up markedly slower in a cold season than a hot one", () => {
    // Deep in the magma biome every season still gains heat — the biome's
    // ambient outruns the radiator. What the season changes is how fast.
    const base = { heat: 50, maxHeat: 100, depth: 500, drilling: false };
    const hot = stepHeat(1, { ...base, ambient: 13 + 4, coolMult: 1 });
    const cold = stepHeat(1, { ...base, ambient: 13 - 2, coolMult: 1.35 });
    expect(hot.heat).toBeGreaterThan(50);
    expect(cold.heat).toBeLessThan(hot.heat);
  });

  it("still cools in the shallow band, faster in a cold season", () => {
    const base = { heat: 50, maxHeat: 100, depth: 2, ambient: 0, drilling: false };
    const temperate = stepHeat(1, { ...base, coolMult: 1 });
    const cold = stepHeat(1, { ...base, coolMult: 1.35 });
    expect(temperate.heat).toBeLessThan(50);
    expect(cold.heat).toBeLessThan(temperate.heat);
  });
});
