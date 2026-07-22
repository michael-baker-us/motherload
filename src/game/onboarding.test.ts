import { describe, expect, it } from "vitest";
import { Onboarding, type OnboardCtx } from "./onboarding";

const ctx = (over: Partial<OnboardCtx> = {}): OnboardCtx => ({
  depth: 0,
  cargoUnits: 0,
  soldCargo: false,
  ...over,
});

describe("onboarding", () => {
  it("starts on the descend step", () => {
    const o = new Onboarding();
    expect(o.active).toBe(true);
    expect(o.prompt?.step).toBe(1);
    expect(o.prompt?.total).toBe(3);
    expect(o.prompt?.text).toContain("drill down");
  });

  it("advances through the loop as the player does each action", () => {
    const o = new Onboarding();
    o.update(ctx({ depth: 1 })); // not deep enough yet
    expect(o.prompt?.step).toBe(1);

    o.update(ctx({ depth: 3 })); // drilled down
    expect(o.prompt?.step).toBe(2);
    expect(o.prompt?.text).toContain("cargo");

    o.update(ctx({ depth: 5, cargoUnits: 2 })); // mined ore
    expect(o.prompt?.step).toBe(3);
    expect(o.prompt?.text).toContain("Mineral Trader");

    o.update(ctx({ depth: 0, cargoUnits: 0, soldCargo: true })); // sold
    expect(o.active).toBe(false);
    expect(o.prompt).toBeNull();
  });

  it("does not skip ahead when later conditions are met out of order", () => {
    // Grabbing ore before reaching depth 3 must not jump past the descend step.
    const o = new Onboarding();
    o.update(ctx({ depth: 1, cargoUnits: 5 }));
    expect(o.prompt?.step).toBe(1);
  });

  it("collapses multiple satisfied steps in one update", () => {
    const o = new Onboarding();
    o.update(ctx({ depth: 4, cargoUnits: 3 }));
    expect(o.prompt?.step).toBe(3); // descend + mine both cleared
  });

  it("skip() dismisses the rest", () => {
    const o = new Onboarding();
    o.skip();
    expect(o.active).toBe(false);
    expect(o.prompt).toBeNull();
  });
});
