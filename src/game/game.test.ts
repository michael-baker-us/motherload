import { describe, expect, it } from "vitest";
import { Input } from "../engine/input";
import { ECONOMY, FUEL } from "./config";
import { Game } from "./game";
import { TileId } from "./tiles";

const DT = 1 / 60;

// A Game instance is DOM-free until a shop overlay opens, so the core
// state machine is testable in node.
const makeGame = () => new Game(800, 600);
const idleInput = new Input(); // never attached — all keys up

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
