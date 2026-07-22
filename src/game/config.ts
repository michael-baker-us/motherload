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

/** Vertical-slice demo objective. Depth is in metres (= tiles below surface). */
export const SLICE = {
  // Tuned for a ~5-min arc: ~84s of pure digging, reachable with 1–2 upgrades.
  // Measured dig rate is ~0.5–0.65 s/m and one starting tank digs ~60m round-trip,
  // so 300m was a 15–25 min grind. 150m is the demo's tight descent.
  goalDepth: 150,
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

/**
 * Coherent worldgen. Ore and rock keep the average spawn density that the
 * chance curves in tiles.ts define, but placement is biased toward high values
 * of a smooth noise field so it clusters into veins and masses instead of
 * salt-and-pepper speckle. `sharp` controls contrast (higher = tighter, richer
 * veins with emptier gaps); `cap` limits how dense a single hotspot can get.
 */
export const WORLDGEN = {
  // Ore is masked to vein regions where a smooth field crosses a threshold, so
  // it forms bodies you mine out rather than pervasive speckle. The target vein
  // *area* per mineral is its spawn chance / mean-fill, so overall balance is
  // roughly preserved; within a vein the fill feathers from edge to dense core.
  veinFreq: 0.12, // vein-field frequency (~8-tile structures)
  veinFillMin: 0.3, // fill chance at a vein's feathered edge
  veinFillMax: 0.96, // fill chance at a vein's core
  veinAreaScale: 1, // global multiplier on vein area (density knob)
  // Rock is undiggable, so it's kept deliberately near-speckle — coherent rock
  // masses risk an impassable full-width band.
  rockFreq: 0.16,
  rockSharp: 3,
  rockCap: 3,
  // Carved air caverns, growing roomier with depth so the world opens up and
  // feels more mysterious the deeper you go. Air is always traversable, so
  // caves relieve the descent rather than blocking it.
  caveFreq: 0.11, // ~9-tile caverns
  caveMinDepth: 28, // no caves in the intro zone
  caveThresholdNear: 0.82, // sparse just below the intro zone
  caveThresholdDeep: 0.6, // roomy caverns deep down
  caveDepthFull: 800, // depth at which caves reach full density
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
