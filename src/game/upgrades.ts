/**
 * Data-driven upgrade tracks. Tier 0 is the free starting equipment; each
 * track's `value` feeds a different stat:
 *   drill → dig-speed multiplier · tank → max fuel · cargo → bay units · hull → max HP
 */

export type UpgradeTrack = "drill" | "tank" | "cargo" | "hull";

export interface UpgradeTier {
  name: string;
  cost: number;
  value: number;
}

export const UPGRADES: Record<UpgradeTrack, UpgradeTier[]> = {
  drill: [
    { name: "Rusty drill", cost: 0, value: 1 },
    { name: "Bronze drill", cost: 150, value: 1.6 },
    { name: "Carbide drill", cost: 600, value: 2.4 },
    { name: "Diamond drill", cost: 2500, value: 3.6 },
  ],
  tank: [
    { name: "Standard tank", cost: 0, value: 100 },
    { name: "Large tank", cost: 120, value: 160 },
    { name: "Huge tank", cost: 500, value: 240 },
    { name: "Colossal tank", cost: 2000, value: 360 },
  ],
  cargo: [
    { name: "Small bay", cost: 0, value: 10 },
    { name: "Medium bay", cost: 100, value: 18 },
    { name: "Large bay", cost: 450, value: 30 },
    { name: "Freighter bay", cost: 1800, value: 50 },
  ],
  hull: [
    { name: "Tin hull", cost: 0, value: 30 },
    { name: "Steel hull", cost: 150, value: 55 },
    { name: "Titanium hull", cost: 700, value: 90 },
    { name: "Nanoweave hull", cost: 2800, value: 150 },
  ],
};

/** Owned tier index per track. */
export interface UpgradeState {
  drill: number;
  tank: number;
  cargo: number;
  hull: number;
}

export function createUpgradeState(): UpgradeState {
  return { drill: 0, tank: 0, cargo: 0, hull: 0 };
}

export function currentTier(track: UpgradeTrack, state: UpgradeState): UpgradeTier {
  return UPGRADES[track][state[track]]!;
}

/** The next purchasable tier, or null when the track is maxed. */
export function nextTier(track: UpgradeTrack, state: UpgradeState): UpgradeTier | null {
  return UPGRADES[track][state[track] + 1] ?? null;
}
