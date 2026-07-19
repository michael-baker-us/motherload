import { describe, expect, it } from "vitest";
import { UPGRADES, createUpgradeState, currentTier, nextTier } from "./upgrades";

describe("upgrade tracks", () => {
  it("starts every track at a free tier 0", () => {
    const state = createUpgradeState();
    for (const track of ["drill", "tank", "cargo", "hull"] as const) {
      expect(currentTier(track, state).cost).toBe(0);
      expect(nextTier(track, state)).toBe(UPGRADES[track][1]);
    }
  });

  it("returns null past the last tier", () => {
    const state = createUpgradeState();
    state.drill = UPGRADES.drill.length - 1;
    expect(nextTier("drill", state)).toBeNull();
  });

  it("every track's values and costs increase monotonically", () => {
    for (const tiers of Object.values(UPGRADES)) {
      for (let i = 1; i < tiers.length; i++) {
        expect(tiers[i]!.value).toBeGreaterThan(tiers[i - 1]!.value);
        expect(tiers[i]!.cost).toBeGreaterThan(tiers[i - 1]!.cost);
      }
    }
  });
});
