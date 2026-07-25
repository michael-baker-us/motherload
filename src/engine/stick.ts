/**
 * Virtual thumbstick → directional intent. Pure math, no DOM: the on-screen
 * stick (`ui/touchControls.ts`) owns the pointer events and the drawing, this
 * owns the feel — dead zone, travel, and which directions a given tilt means.
 *
 * The pod's movement is discrete (left/right/thrust/drill), so the stick
 * resolves to a set of held directions rather than an analog vector. Both axes
 * can be active at once, which is the point: thrust + steer is how you fly.
 */
export interface StickTilt {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

export const NEUTRAL: StickTilt = { left: false, right: false, up: false, down: false };

/**
 * Fraction of travel a finger must cover before an axis engages. Generous
 * because a thumb resting on glass drifts, and a twitchy drill is expensive
 * (fuel, hull). The vertical gate is higher than the horizontal one: steering
 * is cheap and constant, while an accidental thrust burns fuel.
 */
const DEAD_X = 0.34;
const DEAD_Y = 0.42;

/**
 * `dx`/`dy` are the finger's offset from the stick's anchor in pixels, `radius`
 * the stick's travel. Offsets beyond the radius simply saturate.
 */
export function stickTilt(dx: number, dy: number, radius: number): StickTilt {
  if (radius <= 0) return { ...NEUTRAL };
  const nx = dx / radius;
  const ny = dy / radius;
  return {
    left: nx <= -DEAD_X,
    right: nx >= DEAD_X,
    up: ny <= -DEAD_Y,
    down: ny >= DEAD_Y,
  };
}

/** Knob offset for drawing: the finger, clamped to the stick's travel. */
export function knobOffset(dx: number, dy: number, radius: number): { x: number; y: number } {
  const dist = Math.hypot(dx, dy);
  if (dist <= radius || dist === 0) return { x: dx, y: dy };
  return { x: (dx / dist) * radius, y: (dy / dist) * radius };
}
