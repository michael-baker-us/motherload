import { describe, expect, it } from "vitest";
import { Input } from "../engine/input";
import { ECONOMY, FUEL } from "./config";
import { Game } from "./game";
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

function fakeStorage(): SaveStorage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("game state machine", () => {
  it("drains fuel over time while idle", () => {
    const game = makeGame();
    const start = game.player.fuel;
    for (let i = 0; i < 60; i++) game.update(DT, idleInput);
    expect(game.player.fuel).toBeLessThan(start);
    expect(game.player.fuel).toBeCloseTo(start - FUEL.idleBurn, 1);
  });

  it("kills the pod when fuel runs out", () => {
    const game = makeGame();
    game.player.fuel = 0.001;
    for (let i = 0; i < 10 && game.state === "playing"; i++) {
      game.update(DT, idleInput);
    }
    expect(game.state).toBe("dead");
    expect(game.deathCause).toBe("Out of fuel");
  });

  it("respawn charges the salvage fee and resets the pod", () => {
    const game = makeGame();
    game.player.cargo.set(TileId.Goldium, 3);
    game.player.fuel = 0.001;
    game.update(DT, idleInput);
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
    first.world.dig(30, 6);
    first.saveNow();

    const second = new Game(800, 600, storage);
    expect(second.hasSave).toBe(true);
    expect(second.continueGame()).toBe(true);
    expect(second.state).toBe("playing");
    expect(second.money).toBe(first.money);
    expect(second.player.maxFuel).toBe(160);
    expect(second.world.getTile(30, 6)).toBe(TileId.Empty);
    expect(second.world.tiles).toEqual(first.world.tiles);
  });

  it("continueGame without a save reports failure", () => {
    const game = new Game(800, 600);
    expect(game.hasSave).toBe(false);
    expect(game.continueGame()).toBe(false);
    expect(game.state).toBe("title");
  });

  it("reports the station under a parked pod", () => {
    const game = makeGame();
    // Settle onto the surface first.
    for (let i = 0; i < 5; i++) game.update(DT, idleInput);
    expect(game.currentStation()).toBeNull(); // spawn point is between stations

    game.player.x = 26 * 32; // on the fuel depot
    game.player.prevX = game.player.x;
    game.update(DT, idleInput);
    expect(game.currentStation()?.id).toBe("fuel");
  });
});
