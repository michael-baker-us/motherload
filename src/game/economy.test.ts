import { describe, expect, it } from "vitest";
import { ECONOMY } from "./config";
import { addToCargo, cargoUnits, cargoValue, refuelPlan, salvageFeeFor, type Cargo } from "./economy";
import { TILE_DEFS, TileId } from "./tiles";

describe("cargo", () => {
  it("tallies units and value across mineral types", () => {
    const cargo: Cargo = new Map([
      [TileId.Ironium, 3],
      [TileId.Goldium, 2],
    ]);
    expect(cargoUnits(cargo)).toBe(5);
    expect(cargoValue(cargo)).toBe(
      3 * TILE_DEFS[TileId.Ironium].value + 2 * TILE_DEFS[TileId.Goldium].value,
    );
  });

  it("accepts minerals until the bay is full, then rejects", () => {
    const cargo: Cargo = new Map();
    for (let i = 0; i < 4; i++) {
      expect(addToCargo(cargo, TileId.Ironium, 4)).toBe(true);
    }
    expect(addToCargo(cargo, TileId.Diamond, 4)).toBe(false);
    expect(cargo.has(TileId.Diamond)).toBe(false);
    expect(cargoUnits(cargo)).toBe(4);
  });
});

describe("salvageFeeFor", () => {
  it("charges the flat floor to poor pilots", () => {
    expect(salvageFeeFor(0)).toBe(ECONOMY.salvageFee);
    expect(salvageFeeFor(500)).toBe(ECONOMY.salvageFee);
  });

  it("grows to a share of cash for rich pilots", () => {
    expect(salvageFeeFor(10000)).toBe(10000 * ECONOMY.salvageFeeFraction);
    expect(salvageFeeFor(10000)).toBeGreaterThan(ECONOMY.salvageFee);
  });
});

describe("refuelPlan", () => {
  it("fills the tank when affordable", () => {
    expect(refuelPlan(40, 100, 500, 1)).toEqual({ units: 60, cost: 60 });
  });

  it("buys only what money covers", () => {
    expect(refuelPlan(40, 100, 25, 1)).toEqual({ units: 25, cost: 25 });
  });

  it("buys nothing when broke or full", () => {
    expect(refuelPlan(40, 100, 0, 1)).toEqual({ units: 0, cost: 0 });
    expect(refuelPlan(100, 100, 500, 1)).toEqual({ units: 0, cost: 0 });
  });

  it("rounds fractional costs up to whole dollars", () => {
    expect(refuelPlan(99.5, 100, 500, 1)).toEqual({ units: 0.5, cost: 1 });
  });
});
