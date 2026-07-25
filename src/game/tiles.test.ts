import { describe, expect, it } from "vitest";
import { MINERAL_BANDS, STRATA, TILE_DEFS, TileId, digClass, stratumAt } from "./tiles";

describe("tile definitions", () => {
  it("defines every tile in the enum", () => {
    const ids = Object.values(TileId).filter((v): v is TileId => typeof v === "number");
    for (const id of ids) {
      expect(TILE_DEFS[id], `TileId ${id} has no TILE_DEFS entry`).toBeDefined();
      expect(typeof TILE_DEFS[id].name).toBe("string");
    }
  });

  it("keeps tile ids append-only", () => {
    // SaveData.tiles stores raw numeric ids, so renumbering the enum would
    // silently rewrite every existing save's terrain. Pin the tail.
    expect(TileId.Stone).toBe(13);
    expect(TileId.Granite).toBe(14);
    expect(TileId.Water).toBe(15);
    expect(TileId.Ice).toBe(16);
  });

  it("makes the seasonal pockets solid but diggable", () => {
    // Undiggable pocket tiles could generate an impassable band; non-solid ones
    // would need collision and depth-pass special-casing they don't have.
    for (const tile of [TileId.Water, TileId.Ice]) {
      expect(TILE_DEFS[tile].solid).toBe(true);
      expect(TILE_DEFS[tile].hardness).not.toBeNull();
      expect(TILE_DEFS[tile].value).toBe(0);
    }
  });

  it("buckets the pockets into distinct dig-feedback classes", () => {
    expect(digClass(TileId.Water)).toBe("soft");
    expect(digClass(TileId.Ice)).toBe("mid");
  });
});

describe("strata and bands", () => {
  it("returns a stratum at every depth", () => {
    for (const depth of [0, 30, 100, 300, 1500, 5000]) {
      expect(STRATA.some((s) => s.tile === stratumAt(depth))).toBe(true);
    }
  });

  it("orders mineral bands by increasing depth and value", () => {
    for (let i = 1; i < MINERAL_BANDS.length; i++) {
      expect(MINERAL_BANDS[i]!.minDepth).toBeGreaterThan(MINERAL_BANDS[i - 1]!.minDepth);
      expect(TILE_DEFS[MINERAL_BANDS[i]!.tile].value).toBeGreaterThan(
        TILE_DEFS[MINERAL_BANDS[i - 1]!.tile].value,
      );
    }
  });
});
