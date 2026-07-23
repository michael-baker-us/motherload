import { describe, expect, it } from "vitest";
import { panFor } from "./engine";

describe("stereo pan", () => {
  it("centers on the listener and pans with world offset", () => {
    expect(panFor(100, 100, 400)).toBe(0); // at the listener → centered
    expect(panFor(300, 100, 400)).toBeCloseTo(0.5); // half-width to the right
    expect(panFor(100, 300, 400)).toBeCloseTo(-0.5); // to the left
  });

  it("clamps to [-1, 1] beyond the half-width", () => {
    expect(panFor(9999, 0, 400)).toBe(1);
    expect(panFor(-9999, 0, 400)).toBe(-1);
  });
});
