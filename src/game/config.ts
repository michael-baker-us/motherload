/**
 * Every game-feel and balance number lives here so tuning is a one-file job.
 * Units: world distances in pixels, time in seconds, speeds in px/s.
 */

export const TILE = 32;

export const VIEW = {
  zoom: 1.6, // world magnification; the HUD stays at native resolution
};

// --- Rendering / visuals -------------------------------------------------
// Cosmetic tuning that used to be hard-coded in the renderer. Keeping it here
// means the game's look is tunable in one place, same as its feel.

/** Depth darkness + the light sources that carve it back open. */
export const LIGHT = {
  darkStart: 4, // depth (tiles) where darkness begins ramping in
  darkRamp: 70, // tiles over which darkness saturates
  maxDarkness: 0.93, // never fully black — silhouettes stay readable
  radius: 165, // headlamp / beacon light radius in world px (× zoom on screen)
  headlampTint: [255, 190, 110] as const, // warm wash inside the lamp halo
  beaconTint: [120, 230, 255] as const, // cool wash around the objective beacon
  // Directional headlamp (optional, toggled in the Display menu): a tight pool
  // keeps the pod fully lit while a cone projects light the way it's facing.
  beam: {
    ambientRadius: 60, // world px pool around the pod so it stays fully visible
    length: 320, // world px cone reach in the facing direction
    spread: 0.36, // cone half-angle (radians)
    wash: 0.12, // warm colour-wash strength along the beam
  },
  budget: 24, // max dynamic lights composited per frame (nearest-to-pod kept)
  // Emissive world sources that carve their own light out of the darkness.
  lava: { radius: 52, color: [255, 120, 30] as const, intensity: 0.8, wash: 0.16, flicker: 0.3, hz: 2.6 },
  thruster: { radius: 72, color: [255, 170, 90] as const, intensity: 0.5, wash: 0.12 }, // engine glow lights the shaft below
  digFlare: { radius: 40, color: [255, 200, 120] as const, intensity: 0.5, wash: 0.1 }, // the drill face lights up as it bites
};

/** 2.5D depth pass: cavity projection + per-face shading. */
export const DEPTH = {
  backScale: 0.85, // how far the cavity back plane recedes toward the view centre
  face: { ceiling: 0.34, wall: 0.5, floor: 0.68, lip: 1.2 }, // ambient brightness per face orientation
  lightRange: 8, // tiles over which cavity faces respond to the headlamp (fake-normal sculpting)
};

/** Particle / ambient-effect budgets and atmosphere. */
export const FX = {
  maxParticles: 400, // pool cap; the oldest particle is evicted on overflow
  motes: 22, // dust motes drifting in the headlamp beam
  depthHaze: 0.32, // peak aerial-perspective veil (scaled by the depth darkness)
  embers: { ratePerSec: 8 }, // ambient embers rising through the magma biome
  heatHaze: { strength: 0.05, hz: 0.6 }, // subtle warm shimmer rising in the magma biome
};

/** Camera feel — magnification, follow smoothing, look-ahead, shake, jolt zoom. */
export const CAMERA = {
  zoom: 1.6, // base world magnification (the HUD stays native)
  ease: 5.5, // exponential follow-smoothing rate
  lookX: 0.3, // horizontal velocity look-ahead factor
  lookY: 0.22, // vertical velocity look-ahead factor
  shakeDecay: 1.6, // per-second decay of the shake magnitude
  shakeMag: 22, // px of shake at full magnitude
  impactZoom: 0.035, // peak extra zoom punched in on a jolt
  impactZoomDecay: 3.6, // per-second recovery of the zoom punch
  sway: 0.02, // organic camera-drift amplitude, scaled by speed
};

/** Pod animation — the machine reacting to motion, landings, and damage. */
export const POD_ANIM = {
  bank: 0.16, // max banking tilt (radians) at full horizontal speed — airborne only
  squashImpact: 480, // downward impact speed (px/s) that yields full landing squash
  squashRecover: 6, // how fast the suspension springs back (per second)
  // Idle "breathing": a slow vertical settle anchored at the tracks, so a resting
  // pod idles in place rather than floating. Fades in after a beat at a standstill.
  idleDelay: 1.3, // seconds at rest before the idle settle fades in
  idleSpeed: 12, // px/s below which the pod counts as at rest
  idleAmp: 0.05, // idle vertical breathe (scale fraction; base stays planted)
  idleHz: 0.7, // idle breathe rate
  damageHull: 0.35, // hull fraction below which the warning light + sparks kick in
};

/** Post-processing: bloom bleed + full-screen washes. */
export const POST = {
  bloom: {
    enabled: true,
    downscale: 0.5, // bloom buffer resolution vs the screen (0.25 = cheaper/softer)
    blurPx: 8, // gaussian blur radius in screen px
    strength: 0.6, // how strongly the bloom is added back
  },
  vignette: 0.3, // darkness at the frame corners
  flash: 0.42, // peak alpha of the red damage flash
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
  // Seasonal filler pockets (meltwater, ice) — coherent bodies, not speckle, so
  // they read as pockets you break into rather than grit in the rock.
  pocketFreq: 0.13,
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

/**
 * Seasons: base magnitudes and global intensity dials. The season *table*
 * (game/seasons.ts) holds identity, palette, and dimensionless multipliers;
 * these are what those multipliers scale — the same split as `biome.rumble`
 * against the rumble base gain in audio/engine.ts. Turning a dial here retunes
 * every season at once; retuning one season is a table edit.
 */
export const SEASON = {
  weather: {
    ratePerSec: 14, // base ambient particle spawn rate at the surface
    budget: 120, // max concurrent weather particles (of FX.maxParticles)
    reducedMotionScale: 0.4, // photosensitivity: thin weather out, don't kill it
  },
  grade: {
    tintAlpha: 0.14, // peak multiply-wash alpha at the surface
    liftAlpha: 0.06, // peak additive highlight lift
    strength: 1, // global multiplier on the whole colour grade
    depthFade: 1, // how strongly the grade fades with depth (0 = never)
  },
  fogMix: 0.3, // how far a season pulls the biome fog colour toward its own
  wind: {
    accel: 260, // px/s² peak gust at depth 0, × season.runtime.gust
    depth: 14, // tiles below surface where gusts die out
    gustHz: 0.11, // base gust period
  },
  windStrength: 1, // global multiplier on surface gusts
  quench: { water: 18, ice: 30 }, // heat shed when a seasonal pocket tile is drilled
  audio: { minGap: 4, maxGap: 11, volume: 1 }, // seconds between surface ambience one-shots
  flora: { treeline: 26, props: 34, density: 1, seed: 1717 }, // backdrop trees + surface props
};

// Heat: a second resource axis. Depth and the magma biome push heat up; the
// radiator (and surfacing) pull it down. When gain outpaces cooling the pod
// overheats and the hull cooks — you can reach the deep, but not linger there.
export const HEAT = {
  capacity: 100, // max heat before overheating
  drillHeat: 5, // units/s added while actively drilling
  lavaSpike: 22, // one-shot heat added when a lava tile is drilled through
  baseCooling: 5, // units/s the radiator sheds anywhere
  surfaceCoolDepth: 10, // within this many tiles of the surface, cooling is boosted
  surfaceCoolBonus: 22, // extra units/s of cooling in that shallow band
  overheatDamage: 7, // hull HP/s while heat is pinned at capacity
  warnFraction: 0.7, // HUD gauge turns to a warning above this fraction
};
