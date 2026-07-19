import { ECONOMY, FUEL, HULL, POD, TILE } from "./config";
import type { Cargo } from "./economy";
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
}

export function createPlayer(world: World): Player {
  // Spawn standing on the surface, centered horizontally.
  const tileX = Math.floor(world.width / 2);
  const x = tileX * TILE + (TILE - POD.width) / 2;
  const y = world.surfaceRow * TILE - POD.height;
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
  };
}
