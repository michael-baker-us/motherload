import { PHYSICS, TILE } from "./config";
import { clamp } from "../engine/math";
import type { Player } from "./player";
import type { World } from "./world";

export interface MoveInput {
  thrustUp: boolean;
  moveLeft: boolean;
  moveRight: boolean;
}

/**
 * One fixed step of pod movement: integrate accelerations, then move and
 * collide one axis at a time against the tile grid. Axis separation keeps
 * corner cases simple; max speed (~13 px/step) can never tunnel a 32px tile.
 */
export function stepPlayer(p: Player, world: World, input: MoveInput, dt: number): void {
  p.prevX = p.x;
  p.prevY = p.y;
  p.impactSpeed = 0;

  if (input.moveLeft && !input.moveRight) {
    p.vx -= PHYSICS.hAccel * dt;
    p.facing = -1;
  } else if (input.moveRight && !input.moveLeft) {
    p.vx += PHYSICS.hAccel * dt;
    p.facing = 1;
  } else {
    p.vx *= Math.exp(-PHYSICS.hDrag * dt);
    if (Math.abs(p.vx) < 1) p.vx = 0;
  }
  if (input.thrustUp) p.vy -= PHYSICS.thrust * dt;
  p.vy += PHYSICS.gravity * dt;

  p.vx = clamp(p.vx, -PHYSICS.maxVx, PHYSICS.maxVx);
  p.vy = clamp(p.vy, -PHYSICS.maxRise, PHYSICS.maxFall);

  p.touchingLeft = false;
  p.touchingRight = false;
  p.grounded = false;

  moveX(p, world, p.vx * dt);
  moveY(p, world, p.vy * dt);
}

function moveX(p: Player, world: World, dx: number): void {
  p.x += dx;
  const top = Math.floor(p.y / TILE);
  const bottom = Math.floor((p.y + p.height - 0.01) / TILE);

  if (dx > 0) {
    const col = Math.floor((p.x + p.width - 0.01) / TILE);
    if (anySolidInColumn(world, col, top, bottom)) {
      p.x = col * TILE - p.width;
      p.vx = 0;
      p.touchingRight = true;
    }
  } else if (dx < 0) {
    const col = Math.floor(p.x / TILE);
    if (anySolidInColumn(world, col, top, bottom)) {
      p.x = (col + 1) * TILE;
      p.vx = 0;
      p.touchingLeft = true;
    }
  }
}

function moveY(p: Player, world: World, dy: number): void {
  p.y += dy;
  const left = Math.floor(p.x / TILE);
  const right = Math.floor((p.x + p.width - 0.01) / TILE);

  if (dy > 0) {
    const row = Math.floor((p.y + p.height - 0.01) / TILE);
    if (anySolidInRow(world, row, left, right)) {
      p.y = row * TILE - p.height;
      p.impactSpeed = p.vy;
      p.vy = 0;
      p.grounded = true;
    }
  } else if (dy < 0) {
    const row = Math.floor(p.y / TILE);
    if (anySolidInRow(world, row, left, right)) {
      p.y = (row + 1) * TILE;
      p.vy = 0;
    }
  }
}

function anySolidInColumn(world: World, col: number, top: number, bottom: number): boolean {
  for (let y = top; y <= bottom; y++) {
    if (world.isSolid(col, y)) return true;
  }
  return false;
}

function anySolidInRow(world: World, row: number, left: number, right: number): boolean {
  for (let x = left; x <= right; x++) {
    if (world.isSolid(x, row)) return true;
  }
  return false;
}
