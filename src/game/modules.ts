/**
 * Pod modules — the non-linear layer over the linear upgrade tracks. You can
 * OWN any number but only EQUIP a few at once (MAX_MODULE_SLOTS), so loadout is
 * a real decision: a mining build (turbo + compactor), a deep-dive survival
 * build (recycler + plating), an explorer (probe + recycler), etc.
 *
 * Effects are plain stat modifiers that hook into systems already in place, so
 * no module needs a bespoke mechanic. Data-driven like upgrades/items.
 */
export type ModuleId = "turbo" | "compactor" | "recycler" | "plating" | "probe";

export interface ModuleDef {
  name: string;
  cost: number;
  blurb: string;
  cargoBonus: number; // + cargo units
  shieldBonus: number; // + damage-resist fraction
  scanBonus: number; // + scanner range (tiles)
  drillMult: number; // × drill speed
  burnMult: number; // × fuel burn
}

export const MAX_MODULE_SLOTS = 2;

const NONE = { cargoBonus: 0, shieldBonus: 0, scanBonus: 0, drillMult: 1, burnMult: 1 };

export const MODULES: Record<ModuleId, ModuleDef> = {
  turbo: { ...NONE, name: "Turbocharger", cost: 550, blurb: "+25% drill speed", drillMult: 1.25 },
  compactor: { ...NONE, name: "Cargo Compactor", cost: 450, blurb: "+6 cargo units", cargoBonus: 6 },
  recycler: { ...NONE, name: "Fuel Recycler", cost: 450, blurb: "−20% fuel burn", burnMult: 0.8 },
  plating: { ...NONE, name: "Ablative Plating", cost: 500, blurb: "−20% hazard damage", shieldBonus: 0.2 },
  probe: { ...NONE, name: "Ore Probe", cost: 500, blurb: "+6 scanner range", scanBonus: 6 },
};

export const MODULE_ORDER: ModuleId[] = ["turbo", "compactor", "recycler", "plating", "probe"];

export function isModuleId(id: unknown): id is ModuleId {
  return typeof id === "string" && id in MODULES;
}
