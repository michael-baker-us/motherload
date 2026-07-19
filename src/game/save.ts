import type { Cargo } from "./economy";
import type { Player } from "./player";
import type { TileId } from "./tiles";
import { UPGRADES, type UpgradeState, type UpgradeTrack } from "./upgrades";
import type { World } from "./world";

export const SAVE_KEY = "motherload-save";

/**
 * Minimal storage interface so the save system tests with a plain object and
 * later swaps localStorage for a file on the Tauri/Steam Deck build.
 */
export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SaveData {
  version: 1;
  seed: number;
  /** Tiles changed since worldgen: [flat index, tile id]. Worldgen is seeded, so this diff is the whole world state. */
  tiles: Array<[number, number]>;
  player: {
    x: number;
    y: number;
    fuel: number;
    hull: number;
    cargo: Array<[number, number]>;
  };
  money: number;
  upgrades: UpgradeState;
}

export function captureSave(
  world: World,
  player: Player,
  money: number,
  upgrades: UpgradeState,
): SaveData {
  return {
    version: 1,
    seed: world.seed,
    tiles: [...world.changes.entries()],
    player: {
      x: player.x,
      y: player.y,
      fuel: player.fuel,
      hull: player.hull,
      cargo: [...player.cargo.entries()],
    },
    money,
    upgrades: { ...upgrades },
  };
}

/** Parse and validate a save. Returns null for anything malformed — a bad save must never crash the game. */
export function parseSave(json: string): SaveData | null {
  try {
    const data = JSON.parse(json) as SaveData;
    if (data?.version !== 1) return null;
    if (typeof data.seed !== "number" || !Array.isArray(data.tiles)) return null;
    if (typeof data.money !== "number") return null;
    const p = data.player;
    if (
      typeof p?.x !== "number" ||
      typeof p.y !== "number" ||
      typeof p.fuel !== "number" ||
      typeof p.hull !== "number" ||
      !Array.isArray(p.cargo)
    ) {
      return null;
    }
    for (const track of Object.keys(UPGRADES) as UpgradeTrack[]) {
      const tier = data.upgrades?.[track];
      if (typeof tier !== "number") return null;
      data.upgrades[track] = Math.min(Math.max(0, Math.floor(tier)), UPGRADES[track].length - 1);
    }
    return data;
  } catch {
    return null;
  }
}

export function applyWorldSave(world: World, data: SaveData): void {
  for (const [index, tile] of data.tiles) {
    world.setTile(index % world.width, Math.floor(index / world.width), tile as TileId);
  }
}

/** Restore position/levels onto a freshly created pod (caps applied by upgrades first). */
export function applyPlayerSave(player: Player, data: SaveData): void {
  player.x = data.player.x;
  player.y = data.player.y;
  player.prevX = player.x;
  player.prevY = player.y;
  player.fuel = Math.min(data.player.fuel, player.maxFuel);
  player.hull = Math.min(data.player.hull, player.maxHull);
  player.cargo = new Map(data.player.cargo) as Cargo;
}

export function loadSave(storage: SaveStorage): SaveData | null {
  const raw = storage.getItem(SAVE_KEY);
  return raw ? parseSave(raw) : null;
}

export function writeSave(storage: SaveStorage, data: SaveData): void {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or unavailable — losing an autosave beats crashing the game.
  }
}
