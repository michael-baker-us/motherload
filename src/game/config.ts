/**
 * Every game-feel and balance number lives here so tuning is a one-file job.
 * Units: world distances in pixels, time in seconds, speeds in px/s.
 */

export const TILE = 32;

export const WORLD = {
  width: 60, // tiles
  height: 2000, // tiles
  surfaceRow: 6, // first solid row; everything above is sky
  seed: 1337,
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
};
