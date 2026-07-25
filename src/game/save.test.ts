import { describe, expect, it } from "vitest";
import { TILE } from "./config";
import { createPlayer } from "./player";
import {
  applyPlayerSave,
  applyWorldSave,
  captureSave,
  loadSave,
  parseSave,
  writeSave,
  CURRENT_SAVE_VERSION,
  type SaveStorage,
} from "./save";
import { seasonById } from "./seasons";
import { TileId } from "./tiles";
import { createUpgradeState } from "./upgrades";
import { World } from "./world";

const makeWorld = (seed = 42) => new World(60, 2000, 6, seed, TILE);

function fakeStorage(): SaveStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("save round-trip", () => {
  it("restores dug tiles, pod state, money, and upgrades through JSON", () => {
    const world = makeWorld(7);
    // Column 10 is outside the station district's bedrock strip.
    world.dig(10, 6);
    world.dig(10, 7);
    world.setTile(10, 20, TileId.Lava);

    const player = createPlayer(world);
    player.x = 123.5;
    player.y = 456;
    player.fuel = 61.2;
    player.hull = 12.5;
    player.cargo.set(TileId.Goldium, 2);

    const upgrades = createUpgradeState();
    upgrades.drill = 2;

    const storage = fakeStorage();
    writeSave(storage, captureSave(world, player, 777, upgrades));
    const loaded = loadSave(storage);
    expect(loaded).not.toBeNull();

    const world2 = makeWorld(loaded!.seed);
    applyWorldSave(world2, loaded!);
    expect(world2.tiles).toEqual(world.tiles);
    expect(world2.getTile(10, 6)).toBe(TileId.Empty);
    expect(world2.getTile(10, 20)).toBe(TileId.Lava);

    const player2 = createPlayer(world2);
    player2.maxFuel = 100;
    player2.maxHull = 30;
    applyPlayerSave(player2, loaded!);
    expect(player2.x).toBe(123.5);
    expect(player2.fuel).toBeCloseTo(61.2);
    expect(player2.cargo.get(TileId.Goldium)).toBe(2);
    expect(loaded!.money).toBe(777);
    expect(loaded!.upgrades.drill).toBe(2);
  });

  it("caps restored fuel and hull at the pod's maximums", () => {
    const world = makeWorld();
    const player = createPlayer(world);
    player.fuel = 9999;
    player.hull = 9999;
    const data = captureSave(world, player, 0, createUpgradeState());

    const pod = createPlayer(world);
    pod.maxFuel = 100;
    pod.maxHull = 30;
    applyPlayerSave(pod, data);
    expect(pod.fuel).toBe(100);
    expect(pod.hull).toBe(30);
  });
});

describe("parseSave validation", () => {
  it("rejects garbage without throwing", () => {
    expect(parseSave("not json at all {")).toBeNull();
    expect(parseSave("{}")).toBeNull();
    expect(parseSave(JSON.stringify({ version: 2 }))).toBeNull();
    expect(parseSave(JSON.stringify({ version: 1, seed: "nope" }))).toBeNull();
  });

  it("passes a current-version save through migration unchanged", () => {
    const world = makeWorld();
    const data = captureSave(world, createPlayer(world), 250, createUpgradeState());
    const parsed = parseSave(JSON.stringify(data));
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(1);
    expect(parsed!.money).toBe(250);
  });

  it("discards a save from a newer build instead of misreading it", () => {
    // version > current: can't safely downgrade, so it's left for that build.
    expect(parseSave(JSON.stringify({ version: 99, seed: 1 }))).toBeNull();
  });

  it("clamps out-of-range upgrade tiers instead of crashing", () => {
    const world = makeWorld();
    const data = captureSave(world, createPlayer(world), 0, createUpgradeState());
    data.upgrades.drill = 99;
    const parsed = parseSave(JSON.stringify(data));
    expect(parsed!.upgrades.drill).toBe(3); // last real tier
  });
});

describe("season persistence", () => {
  // The season is a worldgen input, on a par with the seed: without it the same
  // seed would reconstruct different terrain. These pin that contract.
  const world = (season?: Parameters<typeof seasonById>[0]) =>
    new World(60, 200, 6, 99, 32, season ? seasonById(season) : null);
  const capture = (w: World) =>
    captureSave(w, createPlayer(w), 0, createUpgradeState());

  it("round-trips the season through JSON", () => {
    const data = parseSave(JSON.stringify(capture(world("winter"))));
    expect(data?.season).toBe("winter");
  });

  it("omits the season for a pre-season world", () => {
    const data = parseSave(JSON.stringify(capture(world())));
    expect(data?.season).toBeUndefined();
  });

  it("drops an unrecognised season rather than guessing", () => {
    const raw = JSON.parse(JSON.stringify(capture(world("spring")))) as Record<string, unknown>;
    raw.season = "monsoon";
    expect(parseSave(JSON.stringify(raw))?.season).toBeUndefined();
  });

  it("needs no version bump — season is an optional field like modules", () => {
    expect(CURRENT_SAVE_VERSION).toBe(1);
  });

  it("reconstructs a legacy save's terrain bit-identically", () => {
    // A save with no season rebuilds with World's neutral season, which is the
    // only reconstruction that can't be wrong for a world generated before
    // seasons existed.
    const original = world();
    const data = parseSave(JSON.stringify(capture(original)))!;
    const rebuilt = new World(60, 200, 6, data.seed, 32, data.season ? seasonById(data.season) : null);
    expect(rebuilt.tiles).toEqual(original.tiles);
  });

  it("reconstructs a seasonal save's terrain bit-identically", () => {
    const original = world("winter");
    const data = parseSave(JSON.stringify(capture(original)))!;
    const rebuilt = new World(60, 200, 6, data.seed, 32, seasonById(data.season));
    expect(rebuilt.tiles).toEqual(original.tiles);
  });
});
