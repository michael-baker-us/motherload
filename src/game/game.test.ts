import { describe, expect, it } from "vitest";
import { Input } from "../engine/input";
import { ECONOMY, FUEL, SLICE, TILE } from "./config";
import { Game } from "./game";
import { FUEL_CELL_UNITS, ITEMS, REPAIR_KIT_HP } from "./items";
import { spawnPoint } from "./player";
import { TileId } from "./tiles";

const DT = 1 / 60;

import type { SaveStorage } from "./save";

// A Game instance is DOM-free until a shop overlay opens, so the core
// state machine is testable in node.
function makeGame(storage: SaveStorage | null = null): Game {
  const game = new Game(800, 600, storage);
  game.state = "playing"; // skip the title screen
  return game;
}
const idleInput = new Input(); // never attached — all keys up

/** Input stub with the given keys held down. */
function keysDown(...codes: string[]): Input {
  return {
    isDown: (...q: string[]) => q.some((c) => codes.includes(c)),
    wasPressed: () => false,
    endFrame: () => {},
    reset: () => {},
  } as unknown as Input;
}

/** Input stub reporting the given keys freshly pressed (use for one update). */
function keysPressed(...codes: string[]): Input {
  return {
    isDown: () => false,
    wasPressed: (...q: string[]) => q.some((c) => codes.includes(c)),
    endFrame: () => {},
    reset: () => {},
  } as unknown as Input;
}

/** Stand the pod grounded in a carved pocket at the given tile, floor set to dirt. */
function placeInPocket(game: Game, col: number, row: number): void {
  game.world.setTile(col, row, TileId.Empty);
  game.world.setTile(col, row + 1, TileId.Dirt);
  const p = game.player;
  p.x = col * TILE + 3;
  p.y = (row + 1) * TILE - p.height;
  p.prevX = p.x;
  p.prevY = p.y;
  p.vx = 0;
  p.vy = 0;
  game.update(DT, idleInput); // settle so grounded is set
}

function fakeStorage(): SaveStorage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("game state machine", () => {
  it("does not drain fuel while grounded and idle", () => {
    const game = makeGame();
    game.update(DT, idleInput); // settle onto the surface
    expect(game.player.grounded).toBe(true);
    const start = game.player.fuel;
    for (let i = 0; i < 60; i++) game.update(DT, idleInput);
    expect(game.player.fuel).toBe(start);
  });

  it("drains fuel over time while airborne and idle", () => {
    const game = makeGame();
    const col = Math.floor(game.world.width / 2);
    const startRow = game.world.surfaceRow + 5;
    for (let r = startRow; r < startRow + 10; r++) game.world.setTile(col, r, TileId.Empty);
    const p = game.player;
    p.x = col * TILE + 3;
    p.y = startRow * TILE;
    p.prevX = p.x;
    p.prevY = p.y;
    p.vx = 0;
    p.vy = 0;

    const start = p.fuel;
    for (let i = 0; i < 5; i++) game.update(DT, idleInput);
    expect(p.grounded).toBe(false);
    expect(p.fuel).toBeCloseTo(start - FUEL.idleBurn * DT * 5, 2);
  });

  it("kills the pod when fuel runs out", () => {
    const game = makeGame();
    game.player.fuel = 0.001;
    const thrustInput = keysDown("ArrowUp"); // burn must not depend on being grounded
    for (let i = 0; i < 10 && game.state === "playing"; i++) {
      game.update(DT, thrustInput);
    }
    expect(game.state).toBe("dead");
    expect(game.deathCause).toBe("Out of fuel");
  });

  it("respawn charges the salvage fee and resets the pod", () => {
    const game = makeGame();
    game.player.cargo.set(TileId.Goldium, 3);
    game.player.fuel = 0.001;
    game.update(DT, keysDown("ArrowUp")); // burn must not depend on being grounded
    expect(game.state).toBe("dead");

    const moneyBefore = game.money;
    game.respawn();
    expect(game.state).toBe("playing");
    expect(game.money).toBe(Math.max(0, moneyBefore - ECONOMY.salvageFee));
    expect(game.player.fuel).toBe(game.player.maxFuel);
    expect(game.player.cargo.size).toBe(0);
  });

  it("stops simulating while the shop is open", () => {
    const game = makeGame();
    game.state = "shop";
    const fuel = game.player.fuel;
    for (let i = 0; i < 60; i++) game.update(DT, idleInput);
    expect(game.player.fuel).toBe(fuel);
  });

  it("takes fall damage from a long drop but not a short hop", () => {
    const game = makeGame();
    game.player.y -= 64; // two tiles: lands well under the damage threshold
    for (let i = 0; i < 120; i++) game.update(DT, idleInput);
    expect(game.player.hull).toBe(game.player.maxHull);

    // Drop from the top of the sky (~168px): impact ≈ 608 px/s, over the threshold.
    game.player.y = 0;
    game.player.prevY = 0;
    game.player.vy = 0;
    for (let i = 0; i < 180; i++) game.update(DT, idleInput);
    expect(game.player.hull).toBeLessThan(game.player.maxHull);
    expect(game.state).toBe("playing"); // hurt, not dead
  });

  it("dies when damage exceeds hull, with the cause preserved", () => {
    const game = makeGame();
    game.applyDamage(game.player.maxHull + 1, "Gas pocket explosion");
    expect(game.state).toBe("dead");
    expect(game.player.hull).toBe(0);
    expect(game.deathCause).toBe("Gas pocket explosion");
  });

  it("buying upgrades raises pod stats and survives respawn", () => {
    const game = makeGame();
    game.money = 10000;
    expect(game.buyUpgrade("tank")).toBe(true);
    expect(game.buyUpgrade("drill")).toBe(true);
    expect(game.player.maxFuel).toBe(160);
    expect(game.drillPower).toBeCloseTo(1.6);
    expect(game.fxEvents.some((e) => e.kind === "upgrade")).toBe(true);

    game.die("test");
    game.respawn();
    expect(game.player.maxFuel).toBe(160); // upgrades outlive the pod
    expect(game.player.fuel).toBe(160);
  });

  it("refuses upgrades when broke or maxed", () => {
    const game = makeGame();
    game.money = 0;
    expect(game.buyUpgrade("tank")).toBe(false);

    game.money = 100000;
    expect(game.buyUpgrade("tank")).toBe(true);
    expect(game.buyUpgrade("tank")).toBe(true);
    expect(game.buyUpgrade("tank")).toBe(true);
    expect(game.buyUpgrade("tank")).toBe(false); // maxed
  });

  it("repairs hull for money", () => {
    const game = makeGame();
    game.money = 100;
    game.applyDamage(10, "test");
    expect(game.repairHull()).toBe(true);
    expect(game.player.hull).toBe(game.player.maxHull);
    expect(game.money).toBe(100 - 20); // 10 HP at $2/HP
  });

  it("starts at the title screen and does not simulate there", () => {
    const game = new Game(800, 600);
    expect(game.state).toBe("title");
    const fuel = game.player.fuel;
    for (let i = 0; i < 60; i++) game.update(DT, idleInput);
    expect(game.player.fuel).toBe(fuel);
  });

  it("continues a saved game in a second session: world, money, upgrades intact", () => {
    const storage = fakeStorage();
    const first = makeGame(storage);
    first.money = 5000;
    first.buyUpgrade("tank");
    // Outside the station district's bedrock strip; planted so a random
    // worldgen roll of Rock (undiggable) can't flake the test.
    first.world.setTile(10, 6, TileId.Dirt);
    first.world.dig(10, 6);
    first.saveNow();

    const second = new Game(800, 600, storage);
    expect(second.hasSave).toBe(true);
    expect(second.continueGame()).toBe(true);
    expect(second.state).toBe("playing");
    expect(second.money).toBe(first.money);
    expect(second.player.maxFuel).toBe(160);
    expect(second.world.getTile(10, 6)).toBe(TileId.Empty);
    expect(second.world.tiles).toEqual(first.world.tiles);
  });

  it("continueGame without a save reports failure", () => {
    const game = new Game(800, 600);
    expect(game.hasSave).toBe(false);
    expect(game.continueGame()).toBe(false);
    expect(game.state).toBe("title");
  });

  it("fuel and funds cheats pin their stat, and any cheat blocks the save", () => {
    const storage = fakeStorage();
    const game = makeGame(storage);
    game.saveNow();
    const savedBefore = storage.getItem("motherload-save");

    // Cheats are independent: fuel-only leaves money alone.
    game.toggleCheat("unlimitedFuel");
    game.player.fuel = 10;
    game.money = 5;
    for (let i = 0; i < 30; i++) game.update(DT, idleInput);
    expect(game.player.fuel).toBeGreaterThan(game.player.maxFuel * 0.99);
    expect(game.money).toBe(5);

    game.toggleCheat("unlimitedFunds");
    game.update(DT, idleInput);
    expect(game.money).toBeGreaterThanOrEqual(999999);

    expect(game.devMode).toBe(true);
    game.saveNow();
    expect(storage.getItem("motherload-save")).toBe(savedBefore);

    // Toggling off resumes normal fuel drain and re-enables saving.
    game.toggleCheat("unlimitedFuel");
    game.toggleCheat("unlimitedFunds");
    expect(game.devMode).toBe(false);
    const fuel = game.player.fuel;
    // Grounded idle burn is zero, so hold thrust to confirm burn actually resumed.
    for (let i = 0; i < 60; i++) game.update(DT, keysDown("ArrowUp"));
    expect(game.player.fuel).toBeLessThan(fuel);
  });

  it("noDamage cheat ignores hull damage until toggled off", () => {
    const game = makeGame();
    for (let i = 0; i < 5; i++) game.update(DT, idleInput);
    const hull = game.player.hull;

    game.toggleCheat("noDamage");
    game.applyDamage(9999, "lava");
    expect(game.player.hull).toBe(hull);
    expect(game.state).toBe("playing");

    game.toggleCheat("noDamage");
    game.applyDamage(5, "lava");
    expect(game.player.hull).toBe(hull - 5);
  });

  it("digging a mineral emits a pickup fx event", () => {
    const game = makeGame();
    for (let i = 0; i < 5; i++) game.update(DT, idleInput); // settle onto the surface
    const p = game.player;
    const col = Math.floor((p.x + p.width / 2) / TILE);
    const row = Math.floor((p.y + p.height + 0.5) / TILE);
    game.world.setTile(col, row, TileId.Ironium);

    const digging = keysDown("ArrowDown");
    for (let i = 0; i < 120 && !game.fxEvents.some((e) => e.kind === "pickup"); i++) {
      game.update(DT, digging);
    }
    expect(game.fxEvents.some((e) => e.kind === "pickup")).toBe(true);
    expect(p.cargo.get(TileId.Ironium)).toBe(1);
  });

  it("losing the pod emits a death fx event", () => {
    const game = makeGame();
    game.die("test");
    expect(game.fxEvents.some((e) => e.kind === "death")).toBe(true);
  });

  it("buying items costs money and respects stack caps", () => {
    const game = makeGame();
    game.money = 10000;
    for (let i = 0; i < ITEMS.dynamite.maxStack; i++) {
      expect(game.buyItem("dynamite")).toBe(true);
    }
    expect(game.buyItem("dynamite")).toBe(false); // carrying the max
    expect(game.money).toBe(10000 - ITEMS.dynamite.maxStack * ITEMS.dynamite.cost);

    game.money = 10;
    expect(game.buyItem("fuelCell")).toBe(false); // broke
  });

  it("fuel cells and repair kits top up their stat and refuse when full", () => {
    const game = makeGame();
    const p = game.player;
    p.items.fuelCell = 2;
    p.fuel = 20;
    expect(game.useItem("fuelCell")).toBe(true);
    expect(p.fuel).toBe(Math.min(p.maxFuel, 20 + FUEL_CELL_UNITS));
    expect(p.items.fuelCell).toBe(1);
    p.fuel = p.maxFuel;
    expect(game.useItem("fuelCell")).toBe(false); // don't waste it
    expect(p.items.fuelCell).toBe(1);

    p.items.repairKit = 1;
    p.hull = 1;
    expect(game.useItem("repairKit")).toBe(true);
    expect(p.hull).toBe(Math.min(p.maxHull, 1 + REPAIR_KIT_HP));
    expect(game.useItem("repairKit")).toBe(false); // none left
  });

  it("teleporter recalls the pod home from depth, but not from the surface", () => {
    const game = makeGame();
    const p = game.player;
    p.items.teleporter = 2;
    for (let i = 0; i < 5; i++) game.update(DT, idleInput); // settle at spawn
    expect(game.useItem("teleporter")).toBe(false); // already home
    expect(p.items.teleporter).toBe(2);

    placeInPocket(game, 10, 100);
    expect(game.useItem("teleporter")).toBe(true);
    const home = spawnPoint(game.world);
    expect(p.x).toBe(home.x);
    expect(p.y).toBe(home.y);
    expect(p.items.teleporter).toBe(1);
  });

  it("standing on your own dynamite blasts the terrain and the pod", () => {
    const game = makeGame();
    const p = game.player;
    p.items.dynamite = 1;
    placeInPocket(game, 10, 30);
    game.world.setTile(9, 30, TileId.Goldium); // bystander mineral

    // Arm via the hotkey, then idle until the fuse burns down.
    game.update(DT, keysPressed("Digit1"));
    expect(game.fuse).not.toBeNull();
    expect(p.items.dynamite).toBe(0);
    for (let i = 0; i < 100 && game.state === "playing"; i++) game.update(DT, idleInput);

    expect(game.world.getTile(10, 31)).toBe(TileId.Empty); // floor gone
    expect(game.world.getTile(9, 30)).toBe(TileId.Empty); // mineral destroyed…
    expect(p.cargo.size).toBe(0); // …not collected
    expect(game.fxEvents.some((e) => e.kind === "explosion")).toBe(true);
    expect(game.state).toBe("dead"); // 35 damage at the centre beats a tin hull
    expect(game.deathCause).toBe("Blown up by own dynamite");
  });

  it("flying clear of armed dynamite avoids the blast damage", () => {
    const game = makeGame();
    const p = game.player;
    p.items.dynamite = 1;
    placeInPocket(game, 10, 30);
    expect(game.useItem("dynamite")).toBe(true);

    // Whisk the pod back to the surface while the fuse burns.
    const home = spawnPoint(game.world);
    p.x = home.x;
    p.y = home.y;
    p.prevX = p.x;
    p.prevY = p.y;
    p.vy = 0;
    for (let i = 0; i < 100 && game.fuse; i++) game.update(DT, idleInput);

    expect(game.fuse).toBeNull();
    expect(game.world.getTile(10, 31)).toBe(TileId.Empty); // it still went off
    expect(p.hull).toBe(p.maxHull);
    expect(game.state).toBe("playing");
  });

  it("death costs a wealth-scaled fee and every carried item", () => {
    const game = makeGame();
    game.money = 10000;
    game.player.items.dynamite = 2;
    game.player.items.teleporter = 1;
    game.die("test");
    game.respawn();
    expect(game.money).toBe(10000 - 10000 * ECONOMY.salvageFeeFraction);
    expect(game.player.items.dynamite).toBe(0);
    expect(game.player.items.teleporter).toBe(0);
  });

  it("items survive save and continue", () => {
    const storage = fakeStorage();
    const first = makeGame(storage);
    first.player.items.dynamite = 2;
    first.player.items.repairKit = 1;
    first.saveNow();

    const second = new Game(800, 600, storage);
    expect(second.continueGame()).toBe(true);
    expect(second.player.items.dynamite).toBe(2);
    expect(second.player.items.repairKit).toBe(1);
    expect(second.player.items.fuelCell).toBe(0);
  });

  it("reports the station under a parked pod", () => {
    const game = makeGame();
    // Settle onto the surface first — the spawn column sits on the trader.
    for (let i = 0; i < 5; i++) game.update(DT, idleInput);
    expect(game.currentStation()?.id).toBe("trader");

    game.player.x = 27 * 32; // gap between fuel depot and trader
    game.player.prevX = game.player.x;
    game.update(DT, idleInput);
    expect(game.currentStation()).toBeNull();

    game.player.x = 24 * 32; // on the fuel depot
    game.player.prevX = game.player.x;
    game.update(DT, idleInput);
    expect(game.currentStation()?.id).toBe("fuel");
  });
});

describe("vertical-slice objective", () => {
  // A carved pocket just past the goal depth, deep enough to trip the payoff.
  const goalRow = (game: Game): number => game.world.surfaceRow + SLICE.goalDepth + 5;

  it("shows the objective while the goal is pending", () => {
    const game = makeGame();
    expect(game.objective()).not.toBeNull();
    expect(game.objective()?.target).toBe(SLICE.goalDepth);
  });

  it("triggers the payoff when the goal depth is reached", () => {
    const game = makeGame();
    placeInPocket(game, 20, goalRow(game)); // its settling update trips the win
    expect(game.state).toBe("won");
    expect(game.goalReached).toBe(true);
    expect(game.objective()).toBeNull();
    expect(game.runStats().depth).toBeGreaterThanOrEqual(SLICE.goalDepth);
  });

  it("resumes exploring on Enter and never re-triggers", () => {
    const game = makeGame();
    placeInPocket(game, 20, goalRow(game));
    expect(game.state).toBe("won");
    game.update(DT, keysPressed("Enter"));
    expect(game.state).toBe("playing");
    game.update(DT, idleInput); // still deep, but the goal is already claimed
    expect(game.state).toBe("playing");
  });

  it("counts pods lost for the payoff stats", () => {
    const game = makeGame();
    expect(game.runStats().deaths).toBe(0);
    game.die("test");
    expect(game.runStats().deaths).toBe(1);
  });

  it("dev warp drops the pod at the goal and triggers the payoff", () => {
    const game = makeGame();
    game.goalReached = true; // pretend it was already claimed
    game.devWarpToGoal();
    expect(game.goalReached).toBe(false); // re-armed for testing
    // The warp drops the pod into the chamber; let it fall to the goal depth.
    for (let i = 0; i < 120 && game.state === "playing"; i++) game.update(DT, idleInput);
    expect(game.state).toBe("won");
  });

  it("dev warp to depth jumps to a biome without firing the payoff", () => {
    const game = makeGame();
    game.devWarpToDepth(300); // past the 150m goal
    for (let i = 0; i < 120 && game.state === "playing"; i++) game.update(DT, idleInput);
    expect(game.state).toBe("playing"); // goal marked claimed — no payoff
    expect(game.maxDepth).toBeGreaterThanOrEqual(290);
    expect(game.runStats().depth).toBeGreaterThanOrEqual(SLICE.goalDepth);
  });
});
