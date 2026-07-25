import { describe, expect, it } from "vitest";
import { HAZARDS } from "./config";
import { digHazard, fallDamage, gasChanceAt, lavaChanceAt } from "./hazards";
import { TileId } from "./tiles";

describe("dig hazards", () => {
  it("gas pockets and lava damage the hull; ordinary tiles do not", () => {
    expect(digHazard(TileId.GasPocket)?.damage).toBe(HAZARDS.gasDamage);
    expect(digHazard(TileId.Lava)?.damage).toBe(HAZARDS.lavaDamage);
    expect(digHazard(TileId.Dirt)).toBeNull();
    expect(digHazard(TileId.Diamond)).toBeNull();
  });
});

describe("fall damage", () => {
  it("is free below the threshold", () => {
    expect(fallDamage(0)).toBe(0);
    expect(fallDamage(HAZARDS.fallThreshold)).toBe(0);
  });

  it("scales with speed beyond the threshold", () => {
    const gentle = fallDamage(HAZARDS.fallThreshold + 100);
    const hard = fallDamage(HAZARDS.fallThreshold + 250);
    expect(gentle).toBeCloseTo(100 * HAZARDS.fallFactor);
    expect(hard).toBeGreaterThan(gentle);
  });
});

describe("hazard spawn depth gates", () => {
  it("keeps hazards out of the shallow layers", () => {
    expect(gasChanceAt(HAZARDS.gasMinDepth - 1)).toBe(0);
    expect(lavaChanceAt(HAZARDS.lavaMinDepth - 1)).toBe(0);
    expect(gasChanceAt(HAZARDS.gasMinDepth)).toBeGreaterThan(0);
    expect(lavaChanceAt(HAZARDS.lavaMinDepth)).toBeGreaterThan(0);
  });

  it("caps hazard density at depth", () => {
    expect(gasChanceAt(100000)).toBe(HAZARDS.gasMaxChance);
    expect(lavaChanceAt(100000)).toBe(HAZARDS.lavaMaxChance);
  });
});

describe("seasonal lava multiplier", () => {
  const deep = HAZARDS.lavaMinDepth + 900; // well past the max-chance clamp

  it("defaults to unchanged", () => {
    expect(lavaChanceAt(deep, 1)).toBe(lavaChanceAt(deep));
  });

  it("scales linearly, applied after the clamp so a hot season really is hotter", () => {
    expect(lavaChanceAt(deep)).toBe(HAZARDS.lavaMaxChance); // clamped
    expect(lavaChanceAt(deep, 2)).toBeCloseTo(HAZARDS.lavaMaxChance * 2);
    expect(lavaChanceAt(deep, 0.5)).toBeCloseTo(HAZARDS.lavaMaxChance * 0.5);
  });

  it("stays at zero above the lava line whatever the multiplier", () => {
    expect(lavaChanceAt(HAZARDS.lavaMinDepth - 1, 5)).toBe(0);
  });
});
