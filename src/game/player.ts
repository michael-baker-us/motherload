import { ECONOMY, FUEL, HULL, POD, TILE } from "./config";
import type { Cargo } from "./economy";
import { createInventory, type Inventory } from "./items";
import type { World } from "./world";

export interface Player {
  /** Top-left corner in world pixels. */
  x: number;
  y: number;
  /** Position at the previous update, for render interpolation. */
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  facing: -1 | 1;
  grounded: boolean;
  touchingLeft: boolean;
  touchingRight: boolean;
  /** Downward speed absorbed on landing this step (fuels fall damage later). */
  impactSpeed: number;
  /** Current dig target in tile coords; progress in [0, 1). */
  digTargetX: number;
  digTargetY: number;
  hasDigTarget: boolean;
  digProgress: number;
  fuel: number;
  maxFuel: number; // per-player; upgrades raise it
  cargo: Cargo;
  cargoCapacity: number;
  hull: number;
  maxHull: number;
  /** Consumables ride in the pod — lost with it, unlike money and upgrades. */
  items: Inventory;
}

/** Where a fresh pod stands: on the surface, centered horizontally. */
export function spawnPoint(world: World): { x: number; y: number } {
  const tileX = Math.floor(world.width / 2);
  return {
    x: tileX * TILE + (TILE - POD.width) / 2,
    y: world.surfaceRow * TILE - POD.height,
  };
}

export function createPlayer(world: World): Player {
  const { x, y } = spawnPoint(world);
  return {
    x,
    y,
    prevX: x,
    prevY: y,
    vx: 0,
    vy: 0,
    width: POD.width,
    height: POD.height,
    facing: 1,
    grounded: false,
    touchingLeft: false,
    touchingRight: false,
    impactSpeed: 0,
    digTargetX: 0,
    digTargetY: 0,
    hasDigTarget: false,
    digProgress: 0,
    fuel: FUEL.tank,
    maxFuel: FUEL.tank,
    cargo: new Map(),
    cargoCapacity: ECONOMY.cargoCapacity,
    hull: HULL.base,
    maxHull: HULL.base,
    items: createInventory(),
  };
}
