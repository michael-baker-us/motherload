/**
 * Every game-feel and balance number lives here so tuning is a one-file job.
 * Units: world distances in pixels, time in seconds, speeds in px/s.
 */

export const TILE = 32;

export const VIEW = {
  zoom: 1.6, // world magnification; the HUD stays at native resolution
};

export const WORLD = {
  width: 60, // tiles
  height: 2000, // tiles
  surfaceRow: 6, // first solid row; everything above is sky
};

export const PHYSICS = {
  gravity: 1100,
  thrust: 2200, // upward accel while thrusting (must beat gravity)
  hAccel: 1600, // horizontal accel while steering
  hDrag: 8, // exponential decay rate on vx when not steering
  maxVx: 280,
  maxRise: 340,
  maxFall: 760,
};

export const POD = {
  width: 26, // < TILE so the pod fits down a one-tile shaft
  height: 24,
};

export const DRILL = {
  // Multiplier on dig speed; tile hardness is seconds-to-dig at power 1.
  basePower: 1,
  // Soil stiffens with depth so drill upgrades gate the descent:
  // hardness ×= 1 + depth / hardnessDepth, capped at hardnessMaxScale.
  hardnessDepth: 220, // tiles per extra 1× hardness
  hardnessMaxScale: 6,
};

export const FUEL = {
  tank: 100,
  thrustBurn: 6, // units/s while thrusting
  idleBurn: 0.4, // units/s while airborne — grounded pods burn nothing at rest
  digBurn: 2, // extra units/s while drilling
  pricePerUnit: 1, // $ per fuel unit at the depot
};

export const ECONOMY = {
  startingMoney: 25,
  cargoCapacity: 10, // cargo units the bay holds
  salvageFee: 100, // $ floor charged when the pod is lost
  salvageFeeFraction: 0.15, // fraction of cash the fee grows to — death must sting rich pilots too
};

export const HULL = {
  base: 30,
  repairPricePerHp: 2, // $ per HP at the upgrade shop
};

export const HAZARDS = {
  gasMinDepth: 25, // tiles below surface where gas pockets start
  gasMaxChance: 0.02,
  gasDamage: 12,
  lavaMinDepth: 120,
  lavaMaxChance: 0.02,
  lavaDamage: 8,
  fallThreshold: 480, // px/s of impact the hull absorbs for free
  fallFactor: 0.08, // HP per px/s beyond the threshold
};
