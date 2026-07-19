import { describe, expect, it } from "vitest";
import { STATIONS } from "./stations";
import { MINERAL_BANDS, TileId } from "./tiles";
import { World } from "./world";

const SURFACE = 6;
const makeWorld = (seed = 42) => new World(60, 2000, SURFACE, seed, 32);

describe("worldgen", () => {
  it("is deterministic for the same seed", () => {
    expect(makeWorld(7).tiles).toEqual(makeWorld(7).tiles);
  });

  it("differs across seeds", () => {
    const a = makeWorld(1).tiles;
    const b = makeWorld(2).tiles;
    let same = true;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        same = false;
        break;
      }
    }
    expect(same).toBe(false);
  });

  it("has only sky above the surface row", () => {
    const w = makeWorld();
    for (let y = 0; y < SURFACE; y++) {
      for (let x = 0; x < w.width; x++) {
        expect(w.getTile(x, y)).toBe(TileId.Sky);
      }
    }
  });

  it("has undiggable bedrock borders below the surface", () => {
    const w = makeWorld();
    for (let y = SURFACE; y < w.height; y++) {
      expect(w.getTile(0, y)).toBe(TileId.Rock);
      expect(w.getTile(w.width - 1, y)).toBe(TileId.Rock);
    }
    for (let x = 0; x < w.width; x++) {
      expect(w.getTile(x, w.height - 1)).toBe(TileId.Rock);
    }
  });

  it("puts an undiggable bedrock strip under the whole station district", () => {
    const w = makeWorld();
    const x0 = Math.min(...STATIONS.map((s) => s.x0));
    const x1 = Math.max(...STATIONS.map((s) => s.x1));
    for (let x = x0; x <= x1; x++) {
      expect(w.getTile(x, SURFACE)).toBe(TileId.Rock);
      expect(w.getTile(x, SURFACE + 1)).toBe(TileId.Rock);
      expect(w.isDiggable(x, SURFACE)).toBe(false);
    }
  });

  it("spaces the stations at equal gaps", () => {
    for (let i = 1; i < STATIONS.length; i++) {
      const gap = STATIONS[i]!.x0 - STATIONS[i - 1]!.x1 - 1;
      const firstGap = STATIONS[1]!.x0 - STATIONS[0]!.x1 - 1;
      expect(gap).toBe(firstGap);
    }
  });

  it("treats out-of-bounds as solid rock", () => {
    const w = makeWorld();
    expect(w.getTile(-1, 100)).toBe(TileId.Rock);
    expect(w.getTile(w.width, 100)).toBe(TileId.Rock);
    expect(w.isSolid(30, w.height)).toBe(true);
  });

  it("keeps every mineral inside its depth band", () => {
    const w = makeWorld();
    const bandFor = new Map(MINERAL_BANDS.map((b) => [b.tile, b]));
    for (let y = SURFACE; y < w.height; y++) {
      for (let x = 0; x < w.width; x++) {
        const band = bandFor.get(w.getTile(x, y));
        if (!band) continue;
        const depth = y - SURFACE;
        expect(depth).toBeGreaterThanOrEqual(band.minDepth);
        expect(depth).toBeLessThanOrEqual(band.maxDepth);
      }
    }
  });

  it("has minerals to find in the first 40m (early game is not barren)", () => {
    const w = makeWorld();
    let minerals = 0;
    for (let y = SURFACE; y < SURFACE + 40; y++) {
      for (let x = 0; x < w.width; x++) {
        if (w.getTile(x, y) === TileId.Ironium) minerals++;
      }
    }
    expect(minerals).toBeGreaterThan(20);
  });

  it("spawns each mineral somewhere in the world", () => {
    const w = makeWorld();
    const seen = new Set<number>();
    for (const id of w.tiles) seen.add(id);
    for (const band of MINERAL_BANDS) {
      expect(seen.has(band.tile), `expected some ${TileId[band.tile]}`).toBe(true);
    }
  });
});

describe("digging tiles", () => {
  it("removes a diggable tile and returns its type", () => {
    const w = makeWorld();
    w.setTile(10, SURFACE, TileId.Dirt);
    expect(w.dig(10, SURFACE)).toBe(TileId.Dirt);
    expect(w.getTile(10, SURFACE)).toBe(TileId.Empty);
    expect(w.isSolid(10, SURFACE)).toBe(false);
  });

  it("refuses to dig rock or air", () => {
    const w = makeWorld();
    expect(w.dig(0, SURFACE)).toBeNull(); // bedrock border
    expect(w.dig(10, 0)).toBeNull(); // sky
    expect(w.getTile(0, SURFACE)).toBe(TileId.Rock);
  });

  it("force-digs rock but still refuses air and out-of-bounds", () => {
    const w = makeWorld();
    expect(w.dig(0, SURFACE, true)).toBe(TileId.Rock); // bedrock border
    expect(w.getTile(0, SURFACE)).toBe(TileId.Empty);
    expect(w.dig(10, 0, true)).toBeNull(); // sky
    expect(w.dig(-1, SURFACE, true)).toBeNull();
  });
});
