import { TILE_DEFS, type TileId } from "./tiles";

/** Cargo manifest: mineral tile -> count. */
export type Cargo = Map<TileId, number>;

export function cargoUnits(cargo: Cargo): number {
  let units = 0;
  for (const [tile, count] of cargo) {
    units += TILE_DEFS[tile].cargoUnits * count;
  }
  return units;
}

export function cargoValue(cargo: Cargo): number {
  let value = 0;
  for (const [tile, count] of cargo) {
    value += TILE_DEFS[tile].value * count;
  }
  return value;
}

/** Add a mineral if it fits. Returns false (mineral lost) when the bay is full. */
export function addToCargo(cargo: Cargo, tile: TileId, capacity: number): boolean {
  if (cargoUnits(cargo) + TILE_DEFS[tile].cargoUnits > capacity) return false;
  cargo.set(tile, (cargo.get(tile) ?? 0) + 1);
  return true;
}

/**
 * How much fuel a purchase buys: fills the tank if affordable, otherwise
 * as many whole units as money covers. Cost is in whole dollars.
 */
export function refuelPlan(
  fuel: number,
  maxFuel: number,
  money: number,
  pricePerUnit: number,
): { units: number; cost: number } {
  const missing = maxFuel - fuel;
  const fullCost = Math.ceil(missing * pricePerUnit);
  if (fullCost <= money) return { units: missing, cost: fullCost };
  const units = Math.floor(money / pricePerUnit);
  return { units, cost: units * pricePerUnit };
}
