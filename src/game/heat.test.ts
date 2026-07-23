import { describe, expect, it } from "vitest";
import { HEAT } from "./config";
import { coolingRate, stepHeat } from "./heat";

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
