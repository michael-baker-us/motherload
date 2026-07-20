import { describe, expect, it } from "vitest";
import { DRILL, TILE } from "./config";
import { updateDrilling, type DigIntent } from "./drilling";
import { createPlayer, type Player } from "./player";
import { stepPlayer, type MoveInput } from "./physics";
import { hardnessScaleAt, TILE_DEFS, TileId } from "./tiles";
import { World } from "./world";

const SURFACE = 6;
const DT = 1 / 60;
const IDLE: MoveInput = { thrustUp: false, moveLeft: false, moveRight: false };
const NO_DIG: DigIntent = { down: false, left: false, right: false };

function setup(): { world: World; p: Player; col: number } {
  const world = new World(60, 2000, SURFACE, 42, TILE);
  const p = createPlayer(world);
  const col = Math.floor((p.x + p.width / 2) / TILE);
  world.setTile(col, SURFACE, TileId.Dirt);
  stepPlayer(p, world, IDLE, DT); // settle so grounded is set
  return { world, p, col };
}

/** Run physics + drilling for `steps` frames, returning any tile dug. */
function digFrames(
  p: Player,
  world: World,
  intent: DigIntent,
  steps: number,
): TileId | null {
  let dug: TileId | null = null;
  for (let i = 0; i < steps; i++) {
    stepPlayer(p, world, IDLE, DT);
    const result = updateDrilling(p, world, intent, 1, DT);
    if (result !== null) dug = result;
  }
  return dug;
}

describe("drilling", () => {
  it("digs through dirt in hardness seconds", () => {
    const { world, p, col } = setup();
    const frames = Math.ceil(TILE_DEFS[TileId.Dirt].hardness! / DT) + 1;
    const dug = digFrames(p, world, { ...NO_DIG, down: true }, frames);
    expect(dug).toBe(TileId.Dirt);
    expect(world.getTile(col, SURFACE)).toBe(TileId.Empty);
  });

  it("makes no progress while airborne", () => {
    const { world, p } = setup();
    p.grounded = false;
    p.y -= 10;
    updateDrilling(p, world, { ...NO_DIG, down: true }, 1, DT);
    expect(p.hasDigTarget).toBe(false);
    expect(p.digProgress).toBe(0);
  });

  it("resets progress when the key is released", () => {
    const { world, p } = setup();
    digFrames(p, world, { ...NO_DIG, down: true }, 5);
    expect(p.digProgress).toBeGreaterThan(0);
    digFrames(p, world, NO_DIG, 1);
    expect(p.digProgress).toBe(0);
    expect(p.hasDigTarget).toBe(false);
  });

  it("digs sideways only when pressed against the wall", () => {
    const { world, p, col } = setup();
    world.setTile(col + 1, SURFACE - 1, TileId.Dirt); // wall beside the pod
    // Not touching the wall yet: no target.
    updateDrilling(p, world, { ...NO_DIG, right: true }, 1, DT);
    expect(p.hasDigTarget).toBe(false);

    // Drive into the wall, then keep holding right to dig it.
    let dug: TileId | null = null;
    for (let i = 0; i < 120; i++) {
      stepPlayer(p, world, { ...IDLE, moveRight: true }, DT);
      const result = updateDrilling(p, world, { ...NO_DIG, right: true }, 1, DT);
      if (result !== null) {
        dug = result;
        break;
      }
    }
    expect(dug).toBe(TileId.Dirt);
    expect(world.getTile(col + 1, SURFACE - 1)).toBe(TileId.Empty);
  });

  it("cannot dig bedrock", () => {
    const { world, p } = setup();
    world.setTile(Math.floor((p.x + p.width / 2) / TILE), SURFACE, TileId.Rock);
    const dug = digFrames(p, world, { ...NO_DIG, down: true }, 120);
    expect(dug).toBeNull();
  });

  it("hardness scale is 1× at the surface, grows with depth, and caps", () => {
    expect(hardnessScaleAt(0)).toBe(1);
    expect(hardnessScaleAt(DRILL.hardnessDepth)).toBe(2);
    expect(hardnessScaleAt(1e9)).toBe(DRILL.hardnessMaxScale);
  });

  it("deep dirt takes proportionally longer to dig", () => {
    const { world, p } = setup();
    // Stand the pod in a carved pocket two hardness-bands down (3× soil).
    const depth = DRILL.hardnessDepth * 2;
    const row = SURFACE + depth;
    const col = 10;
    world.setTile(col, row - 1, TileId.Empty);
    world.setTile(col, row, TileId.Dirt);
    p.x = col * TILE + 3;
    p.y = row * TILE - p.height;
    p.prevX = p.x;
    p.prevY = p.y;
    p.vy = 0;
    stepPlayer(p, world, IDLE, DT); // settle grounded on the dirt floor

    const baseFrames = Math.ceil(TILE_DEFS[TileId.Dirt].hardness! / DT) + 1;
    // Surface-time digging is nowhere near enough down here…
    expect(digFrames(p, world, { ...NO_DIG, down: true }, baseFrames)).toBeNull();
    // …but 3× the time (scale at this depth) finishes the tile.
    const dug = digFrames(p, world, { ...NO_DIG, down: true }, baseFrames * 3);
    expect(dug).toBe(TileId.Dirt);
  });

  it("digs bedrock with the dev digAnything override", () => {
    const { world, p, col } = setup();
    world.setTile(col, SURFACE, TileId.Rock);
    let dug: TileId | null = null;
    for (let i = 0; i < 120; i++) {
      stepPlayer(p, world, IDLE, DT);
      const result = updateDrilling(p, world, { ...NO_DIG, down: true }, 1, DT, true);
      if (result !== null) {
        dug = result;
        break;
      }
    }
    expect(dug).toBe(TileId.Rock);
    expect(world.getTile(col, SURFACE)).toBe(TileId.Empty);
  });
});
