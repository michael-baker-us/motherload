import { describe, expect, it } from "vitest";
import { LIGHT } from "../game/config";
import { darknessAt, flicker } from "./lights";

describe("darknessAt", () => {
  it("stays fully lit above the darkness onset", () => {
    expect(darknessAt(0)).toBe(0);
    expect(darknessAt(LIGHT.darkStart)).toBe(0);
    expect(darknessAt(LIGHT.darkStart - 5)).toBe(0);
  });

  it("ramps linearly from the onset", () => {
    const mid = LIGHT.darkStart + LIGHT.darkRamp / 2;
    expect(darknessAt(mid)).toBeCloseTo(0.5, 5);
  });

  it("saturates at maxDarkness and never exceeds it", () => {
    expect(darknessAt(LIGHT.darkStart + LIGHT.darkRamp)).toBe(LIGHT.maxDarkness);
    expect(darknessAt(9999)).toBe(LIGHT.maxDarkness);
  });
});

describe("flicker", () => {
  it("returns the base unchanged when amount is zero", () => {
    for (const t of [0, 0.3, 1, 7.2]) expect(flicker(1, 0, 3, t, 0)).toBe(1);
  });

  it("stays within [base*(1-amount), base]", () => {
    const base = 0.8;
    const amount = 0.35;
    for (let t = 0; t < 10; t += 0.13) {
      const v = flicker(base, amount, 2.5, t, 1.7);
      expect(v).toBeLessThanOrEqual(base + 1e-9);
      expect(v).toBeGreaterThanOrEqual(base * (1 - amount) - 1e-9);
    }
  });

  it("decorrelates sources via phase", () => {
    // Two lights with different phases generally differ at the same instant.
    const a = flicker(1, 0.5, 2, 1.0, 0);
    const b = flicker(1, 0.5, 2, 1.0, Math.PI);
    expect(Math.abs(a - b)).toBeGreaterThan(0.1);
  });
});

describe("seasonal darkness floor", () => {
  it("keeps a dim season from ever fully brightening at the surface", () => {
    expect(darknessAt(0)).toBe(0);
    expect(darknessAt(0, 0.12)).toBe(0.12);
  });

  it("never lets the floor override a deeper, darker value", () => {
    const deep = darknessAt(1000);
    expect(darknessAt(1000, 0.12)).toBe(deep);
  });

  it("still caps at maxDarkness, so no season can black the screen out", () => {
    expect(darknessAt(0, 1)).toBe(LIGHT.maxDarkness);
  });
});
