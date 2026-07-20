import { describe, expect, it } from "vitest";
import { createInventory, ITEM_ORDER, ITEMS, sanitizeInventory } from "./items";

describe("sanitizeInventory", () => {
  it("fills a fresh inventory from garbage input", () => {
    expect(sanitizeInventory(undefined)).toEqual(createInventory());
    expect(sanitizeInventory("nope")).toEqual(createInventory());
    expect(sanitizeInventory(null)).toEqual(createInventory());
  });

  it("clamps counts to whole numbers within each item's stack limit", () => {
    const raw = { dynamite: 99, fuelCell: -3, repairKit: 1.7, teleporter: NaN };
    const inv = sanitizeInventory(raw);
    expect(inv.dynamite).toBe(ITEMS.dynamite.maxStack);
    expect(inv.fuelCell).toBe(0);
    expect(inv.repairKit).toBe(1);
    expect(inv.teleporter).toBe(0);
  });

  it("keeps valid counts as-is for every item", () => {
    const raw = Object.fromEntries(ITEM_ORDER.map((id) => [id, 1]));
    expect(sanitizeInventory(raw)).toEqual(raw);
  });
});
