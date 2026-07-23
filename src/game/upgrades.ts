/**
 * Data-driven upgrade tracks. Tier 0 is the free starting equipment; each
 * track's `value` feeds a different stat:
 *   drill → dig-speed multiplier · tank → max fuel · cargo → bay units · hull → max HP
 */

export type UpgradeTrack =
  | "drill"
  | "tank"
  | "cargo"
  | "hull"
  | "engine"
  | "scanner"
  | "shield"
  | "coolant";

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
  // value = speed/agility multiplier on thrust, steering, and top speed.
  engine: [
    { name: "Stock engine", cost: 0, value: 1 },
    { name: "Tuned engine", cost: 180, value: 1.25 },
    { name: "Turbo engine", cost: 650, value: 1.5 },
    { name: "Ion engine", cost: 2400, value: 1.9 },
  ],
  // value = reveal radius in tiles; ore within it shows through rock and dark.
  scanner: [
    { name: "No scanner", cost: 0, value: 0 },
    { name: "Short scanner", cost: 220, value: 5 },
    { name: "Long scanner", cost: 800, value: 9 },
    { name: "Deep scanner", cost: 2600, value: 14 },
  ],
  // value = fraction of hazard/impact damage absorbed.
  shield: [
    { name: "No shield", cost: 0, value: 0 },
    { name: "Ablative shield", cost: 300, value: 0.25 },
    { name: "Plated shield", cost: 1000, value: 0.45 },
    { name: "Aegis shield", cost: 3000, value: 0.65 },
  ],
  // value = cooling multiplier on the radiator; higher tiers let you linger deeper.
  coolant: [
    { name: "Stock radiator", cost: 0, value: 1 },
    { name: "Finned radiator", cost: 260, value: 1.6 },
    { name: "Coolant loop", cost: 950, value: 2.3 },
    { name: "Cryo radiator", cost: 2800, value: 3.2 },
  ],
};

/** Owned tier index per track. */
export type UpgradeState = Record<UpgradeTrack, number>;

export function createUpgradeState(): UpgradeState {
  return { drill: 0, tank: 0, cargo: 0, hull: 0, engine: 0, scanner: 0, shield: 0, coolant: 0 };
}

export function currentTier(track: UpgradeTrack, state: UpgradeState): UpgradeTier {
  return UPGRADES[track][state[track]]!;
}

/** The next purchasable tier, or null when the track is maxed. */
export function nextTier(track: UpgradeTrack, state: UpgradeState): UpgradeTier | null {
  return UPGRADES[track][state[track] + 1] ?? null;
}
