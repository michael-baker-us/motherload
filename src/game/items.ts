/**
 * Consumable items: bought at the Mineral Trader, carried in the pod, used
 * with the number keys. They ride in the pod, so they're lost with it —
 * money and upgrades survive a wreck, supplies don't.
 */

export type ItemId = "dynamite" | "fuelCell" | "repairKit" | "teleporter";

export interface ItemDef {
  name: string;
  cost: number;
  /** Most you can carry — keeps items an insurance decision, not a stockpile. */
  maxStack: number;
  /** Short shop-line description of the effect. */
  blurb: string;
  /** Three-letter HUD tag. */
  tag: string;
}

/** Hotkey order: item i is used with Digit(i+1). */
export const ITEM_ORDER: ItemId[] = ["dynamite", "fuelCell", "repairKit", "teleporter"];

export const ITEMS: Record<ItemId, ItemDef> = {
  dynamite: { name: "Dynamite", cost: 150, maxStack: 3, blurb: "blasts through rock", tag: "DYN" },
  fuelCell: { name: "Fuel cell", cost: 75, maxStack: 3, blurb: "+60 fuel anywhere", tag: "FUE" },
  repairKit: { name: "Repair kit", cost: 125, maxStack: 3, blurb: "+40 hull anywhere", tag: "REP" },
  teleporter: { name: "Teleporter", cost: 350, maxStack: 2, blurb: "instant ride home", tag: "TEL" },
};

export const DYNAMITE = {
  fuseSeconds: 1.25, // planted under the pod — fly clear or eat the blast
  radius: 2.5, // tiles (euclidean) — a 21-tile rounded blob
  damage: 35, // hull damage at the blast centre, falling off with distance
};

export const FUEL_CELL_UNITS = 60;
export const REPAIR_KIT_HP = 40;

/** Counts per item, always fully populated. */
export type Inventory = Record<ItemId, number>;

export function createInventory(): Inventory {
  return { dynamite: 0, fuelCell: 0, repairKit: 0, teleporter: 0 };
}

/** Coerce untrusted (saved) data into a valid inventory. */
export function sanitizeInventory(raw: unknown): Inventory {
  const inv = createInventory();
  if (typeof raw !== "object" || raw === null) return inv;
  for (const id of ITEM_ORDER) {
    const count = (raw as Record<string, unknown>)[id];
    if (typeof count === "number" && Number.isFinite(count)) {
      inv[id] = Math.min(Math.max(0, Math.floor(count)), ITEMS[id].maxStack);
    }
  }
  return inv;
}
