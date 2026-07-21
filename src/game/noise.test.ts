import { describe, expect, it } from "vitest";
import { fbm2d, fieldMeanPow, valueNoise2d } from "./noise";

describe("value noise", () => {
  it("is deterministic for the same coordinates and seed", () => {
    expect(valueNoise2d(3.5, 9.25, 42)).toBe(valueNoise2d(3.5, 9.25, 42));
    expect(fbm2d(3.5, 9.25, 42)).toBe(fbm2d(3.5, 9.25, 42));
  });

  it("stays within [0, 1)", () => {
    for (let i = 0; i < 500; i++) {
      const x = i * 0.37;
      const y = i * 1.13;
      const v = fbm2d(x, y, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is smooth — adjacent samples change gradually, unlike a per-tile hash", () => {
    // Worldgen samples at freq < 1 (e.g. x * 0.22), so neighbouring tiles fall
    // within a lattice cell and interpolate smoothly. A per-tile hash would
    // routinely jump ~1.0 between neighbours; smooth noise won't.
    const step = 0.22;
    let maxJump = 0;
    for (let x = 0; x < 400; x++) {
      const a = valueNoise2d(x * step, 3.7, 5);
      const b = valueNoise2d((x + 1) * step, 3.7, 5);
      maxJump = Math.max(maxJump, Math.abs(b - a));
    }
    expect(maxJump).toBeLessThan(0.5);
  });

  it("fieldMeanPow returns a stable positive normaliser", () => {
    const field = (x: number, y: number) => fbm2d(x * 0.2, y * 0.2, 99);
    expect(fieldMeanPow(field, 3)).toBeGreaterThan(0);
    expect(fieldMeanPow(field, 3)).toBe(fieldMeanPow(field, 3));
  });
});
