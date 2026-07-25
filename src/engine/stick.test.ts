import { describe, expect, it } from "vitest";
import { knobOffset, stickTilt } from "./stick";

const R = 50;

describe("stickTilt", () => {
  it("is neutral inside the dead zone", () => {
    expect(stickTilt(8, 8, R)).toEqual({ left: false, right: false, up: false, down: false });
  });

  it("engages one axis at a time near the cardinals", () => {
    expect(stickTilt(-R, 0, R)).toMatchObject({ left: true, right: false, up: false, down: false });
    expect(stickTilt(0, R, R)).toMatchObject({ down: true, up: false, left: false, right: false });
  });

  it("engages both axes on a diagonal — thrust while steering", () => {
    expect(stickTilt(R, -R, R)).toMatchObject({ right: true, up: true, left: false, down: false });
  });

  it("needs more travel to thrust than to steer", () => {
    // A tilt that steers but is not yet enough to fire the engine.
    const t = stickTilt(R * 0.38, -R * 0.38, R);
    expect(t.right).toBe(true);
    expect(t.up).toBe(false);
  });

  it("saturates past the radius instead of running away", () => {
    expect(stickTilt(R * 9, 0, R)).toMatchObject({ right: true });
    expect(knobOffset(R * 9, 0, R)).toEqual({ x: R, y: 0 });
  });

  it("survives a degenerate radius", () => {
    expect(stickTilt(10, 10, 0)).toEqual({ left: false, right: false, up: false, down: false });
  });
});

describe("knobOffset", () => {
  it("follows the finger inside the travel", () => {
    expect(knobOffset(10, -20, R)).toEqual({ x: 10, y: -20 });
  });

  it("clamps to the rim, keeping the direction", () => {
    const o = knobOffset(300, 400, R); // 3-4-5 triangle → dist 500
    expect(o.x).toBeCloseTo(R * 0.6);
    expect(o.y).toBeCloseTo(R * 0.8);
  });
});
