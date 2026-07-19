import { describe, expect, it } from "vitest";
import { PHYSICS, POD, TILE } from "./config";
import { createPlayer, type Player } from "./player";
import { stepPlayer, type MoveInput } from "./physics";
import { TileId } from "./tiles";
import { World } from "./world";

const SURFACE = 6;
const DT = 1 / 60;
const IDLE: MoveInput = { thrustUp: false, moveLeft: false, moveRight: false };

const makeWorld = () => new World(60, 2000, SURFACE, 42, TILE);

function stepUntil(
  p: Player,
  world: World,
  input: MoveInput,
  done: (p: Player) => boolean,
  maxSteps = 600,
): number {
  for (let i = 0; i < maxSteps; i++) {
    stepPlayer(p, world, input, DT);
    if (done(p)) return i;
  }
  return maxSteps;
}

describe("pod physics", () => {
  it("falls under gravity and lands flush on the surface", () => {
    const world = makeWorld();
    const p = createPlayer(world);
    p.y -= 120; // hoist into the sky
    const steps = stepUntil(p, world, IDLE, (pl) => pl.grounded);
    expect(steps).toBeLessThan(600);
    expect(p.y + p.height).toBe(SURFACE * TILE);
    expect(p.vy).toBe(0);
  });

  it("records impact speed on the landing step", () => {
    const world = makeWorld();
    const p = createPlayer(world);
    p.y -= 120;
    let impact = 0;
    stepUntil(p, world, IDLE, (pl) => {
      if (pl.impactSpeed > 0) impact = pl.impactSpeed;
      return pl.grounded;
    });
    expect(impact).toBeGreaterThan(100);
  });

  it("never exceeds max fall speed", () => {
    const world = makeWorld();
    // Carve a deep open shaft so there's room to reach terminal velocity.
    for (let y = SURFACE; y < SURFACE + 60; y++) world.setTile(30, y, TileId.Empty);
    const p = createPlayer(world);
    p.x = 30 * TILE + (TILE - POD.width) / 2;
    let maxVy = 0;
    stepUntil(p, world, IDLE, (pl) => {
      maxVy = Math.max(maxVy, pl.vy);
      return pl.grounded;
    });
    expect(maxVy).toBe(PHYSICS.maxFall);
  });

  it("stops flush against a wall tile and reports the contact", () => {
    const world = makeWorld();
    const p = createPlayer(world);
    p.x = 4 * TILE;
    world.setTile(1, SURFACE - 1, TileId.Dirt); // wall at the pod's row
    stepPlayer(p, world, IDLE, DT); // settle onto the ground
    stepUntil(p, world, { ...IDLE, moveLeft: true }, (pl) => pl.touchingLeft);
    expect(p.touchingLeft).toBe(true);
    expect(p.x).toBe(2 * TILE); // flush against the wall
    expect(p.vx).toBe(0);
  });

  it("stops at the world edge (out-of-bounds reads as rock)", () => {
    const world = makeWorld();
    const p = createPlayer(world);
    p.x = 3 * TILE;
    stepPlayer(p, world, IDLE, DT);
    stepUntil(p, world, { ...IDLE, moveLeft: true }, (pl) => pl.touchingLeft);
    expect(p.x).toBe(0);
  });

  it("thrust overcomes gravity and lifts the pod", () => {
    const world = makeWorld();
    const p = createPlayer(world);
    const startY = p.y;
    for (let i = 0; i < 30; i++) {
      stepPlayer(p, world, { ...IDLE, thrustUp: true }, DT);
    }
    expect(p.y).toBeLessThan(startY);
    expect(p.grounded).toBe(false);
  });
});
