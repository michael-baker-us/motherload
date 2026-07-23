import type { Cargo } from "./economy";
import { sanitizeInventory, type Inventory } from "./items";
import type { Player } from "./player";
import type { TileId } from "./tiles";
import { UPGRADES, type UpgradeState, type UpgradeTrack } from "./upgrades";
import type { World } from "./world";

export const SAVE_KEY = "motherload-save";
export const CURRENT_SAVE_VERSION = 1;

/**
 * Forward migrations keyed by the version they upgrade FROM. When the save
 * format changes, bump CURRENT_SAVE_VERSION and add a step here — old saves are
 * upgraded on load instead of being silently wiped. Example for a future v2:
 *   1: (d) => ({ ...d, version: 2, newField: defaultValue }),
 */
const MIGRATIONS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {};

/** Bring a parsed save of any known older version up to current, or null. */
function migrate(data: Record<string, unknown>): Record<string, unknown> | null {
  let version = typeof data.version === "number" ? data.version : 0;
  // A save written by a newer build than this one can't be understood — leave
  // it untouched (return null) rather than corrupt it by guessing.
  if (version > CURRENT_SAVE_VERSION) return null;
  while (version < CURRENT_SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) return null; // no upgrade path — discard beats loading garbage
    data = step(data);
    version = typeof data.version === "number" ? data.version : version + 1;
  }
  return data;
}

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
    /** Absent in pre-M9 saves — sanitized to an empty inventory on load. */
    items?: Inventory;
  };
  money: number;
  upgrades: UpgradeState;
  /** Owned/equipped module ids. Absent in pre-module saves → treated as empty. */
  modules?: { owned: string[]; equipped: string[] };
}

export function captureSave(
  world: World,
  player: Player,
  money: number,
  upgrades: UpgradeState,
  modules: { owned: string[]; equipped: string[] } = { owned: [], equipped: [] },
): SaveData {
  return {
    version: CURRENT_SAVE_VERSION,
    seed: world.seed,
    tiles: [...world.changes.entries()],
    player: {
      x: player.x,
      y: player.y,
      fuel: player.fuel,
      hull: player.hull,
      cargo: [...player.cargo.entries()],
      items: { ...player.items },
    },
    money,
    upgrades: { ...upgrades },
    modules: { owned: [...modules.owned], equipped: [...modules.equipped] },
  };
}

/** Parse, migrate, and validate a save. Returns null for anything malformed or unmigratable — a bad save must never crash the game. */
export function parseSave(json: string): SaveData | null {
  try {
    const raw = JSON.parse(json) as unknown;
    if (typeof raw !== "object" || raw === null) return null;
    const migrated = migrate(raw as Record<string, unknown>);
    if (!migrated) return null;
    const data = migrated as unknown as SaveData;
    if (data.version !== CURRENT_SAVE_VERSION) return null;
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
    if (typeof data.upgrades !== "object" || data.upgrades === null) return null;
    for (const track of Object.keys(UPGRADES) as UpgradeTrack[]) {
      const tier = (data.upgrades as Record<string, unknown>)[track];
      // A track added after this save was written defaults to tier 0, so older
      // saves keep loading as new upgrade categories are introduced.
      data.upgrades[track] =
        typeof tier === "number"
          ? Math.min(Math.max(0, Math.floor(tier)), UPGRADES[track].length - 1)
          : 0;
    }
    // Modules are optional (absent in older saves) and validated leniently.
    const m = data.modules;
    data.modules =
      m && Array.isArray(m.owned) && Array.isArray(m.equipped)
        ? {
            owned: m.owned.filter((x) => typeof x === "string"),
            equipped: m.equipped.filter((x) => typeof x === "string"),
          }
        : { owned: [], equipped: [] };
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
  player.items = sanitizeInventory(data.player.items);
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
