import { Camera } from "../engine/camera";
import type { Input } from "../engine/input";
import { MenuOverlay } from "../ui/menu";
import { ShopOverlay } from "../ui/shop";
import { DRILL, ECONOMY, FUEL, HULL, SLICE, TILE, WORLD } from "./config";
import { updateDrilling } from "./drilling";
import { addToCargo, cargoUnits, cargoValue, refuelPlan, salvageFeeFor } from "./economy";
import { Onboarding, type OnboardPrompt } from "./onboarding";
import { digHazard, fallDamage } from "./hazards";
import {
  DYNAMITE,
  FUEL_CELL_UNITS,
  ITEM_ORDER,
  ITEMS,
  REPAIR_KIT_HP,
  type ItemId,
} from "./items";
import { createPlayer, spawnPoint, type Player } from "./player";
import { stepPlayer, type MoveInput } from "./physics";
import {
  applyPlayerSave,
  applyWorldSave,
  captureSave,
  loadSave,
  writeSave,
  type SaveData,
  type SaveStorage,
} from "./save";
import { stationInSpan, type Station } from "./stations";
import { TILE_DEFS, TileId } from "./tiles";
import {
  createUpgradeState,
  currentTier,
  nextTier,
  type UpgradeState,
  type UpgradeTrack,
} from "./upgrades";
import { World } from "./world";

export type GameState = "title" | "briefing" | "playing" | "shop" | "menu" | "dead" | "won";

/**
 * One-shot game events (world coordinates). The audio engine reads the queue
 * non-destructively each frame; the renderer then drains it, ignoring kinds
 * it has no visual for.
 */
export interface FxEvent {
  kind: "dug" | "impact" | "explosion" | "upgrade" | "pickup" | "sell" | "death";
  x: number;
  y: number;
  color?: string;
  power?: number;
  /** Cash amount for the floating "+$" reward pop (pickup value / sale total). */
  value?: number;
}

/** Interval between surface autosaves while the pod is parked topside. */
const AUTOSAVE_INTERVAL = 5;

/** Money floor while the unlimited-funds cheat is on. */
const DEV_MONEY = 999999;

/** Individually toggleable testing cheats. Saving is disabled while any is on. */
export interface DevCheats {
  unlimitedFuel: boolean;
  unlimitedFunds: boolean;
  noDamage: boolean;
  digAnything: boolean;
}

export class Game {
  world: World;
  readonly camera: Camera;
  player: Player;
  money = ECONOMY.startingMoney;
  state: GameState = "title";
  /** Owned upgrade tiers — survive pod loss, unlike the pod itself. */
  readonly upgrades: UpgradeState = createUpgradeState();
  /** Why the pod was lost — shown on the death screen. */
  deathCause = "";
  toast: { text: string; timeLeft: number; total: number } | null = null;
  /** First-run guided descent; null once done or for a continued save. */
  onboarding: Onboarding | null = null;
  /** Set the first time cargo is sold — the onboarding's final beat. */
  soldCargo = false;
  // Vertical-slice objective: reach the anomaly depth. Stats feed the payoff.
  goalReached = false;
  runTime = 0;
  deaths = 0;
  maxDepth = 0;
  /** Dev readout for balance tuning — a display toggle, not a cheat. */
  showTelemetry = false;
  /** Armed dynamite (tile coords) — the renderer draws it, update() detonates it. */
  fuse: { x: number; y: number; timeLeft: number } | null = null;
  /** Drained by the renderer each frame; capped so it can't grow headless. */
  readonly fxEvents: FxEvent[] = [];
  readonly cheats: DevCheats = {
    unlimitedFuel: false,
    unlimitedFunds: false,
    noDamage: false,
    digAnything: false,
  };

  private readonly shop = new ShopOverlay();
  private readonly menu = new MenuOverlay();
  private readonly storage: SaveStorage | null;
  private pendingSave: SaveData | null;
  private thrusting = false;
  private justClosedShop = false;
  private autosaveTimer = 0;

  constructor(viewWidth: number, viewHeight: number, storage: SaveStorage | null = null) {
    this.storage = storage;
    this.pendingSave = storage ? loadSave(storage) : null;
    // Each new game gets its own world; a save carries its seed with it.
    const seed = Math.floor(Math.random() * 0x7fffffff);
    this.world = new World(WORLD.width, WORLD.height, WORLD.surfaceRow, seed, TILE);
    this.player = createPlayer(this.world);
    this.camera = new Camera(viewWidth, viewHeight);
  }

  resize(viewWidth: number, viewHeight: number): void {
    this.camera.resize(viewWidth, viewHeight);
  }

  get hasSave(): boolean {
    return this.pendingSave !== null;
  }

  get isThrusting(): boolean {
    return this.thrusting;
  }

  /** Depth of the pod's feet below the surface, in tiles ("meters" on the HUD). */
  get depth(): number {
    const feetRow = Math.floor((this.player.y + this.player.height) / TILE);
    return Math.max(0, feetRow - this.world.surfaceRow);
  }

  get drillPower(): number {
    return DRILL.basePower * currentTier("drill", this.upgrades).value;
  }

  startNewGame(): void {
    this.state = "briefing"; // a mission-brief card precedes the first descent
    this.onboarding = new Onboarding();
    this.goalReached = false;
    this.runTime = 0;
    this.deaths = 0;
    this.maxDepth = 0;
    this.saveNow();
  }

  /** Rebuild world and pod from the pending save. Returns false if there is none. */
  continueGame(): boolean {
    const data = this.pendingSave;
    if (!data) return false;
    this.world = new World(WORLD.width, WORLD.height, WORLD.surfaceRow, data.seed, TILE);
    applyWorldSave(this.world, data);
    Object.assign(this.upgrades, data.upgrades);
    this.money = data.money;
    const pod = createPlayer(this.world);
    this.applyUpgrades(pod);
    applyPlayerSave(pod, data);
    this.player = pod;
    this.state = "playing";
    // Returning players skip the first-descent objective, like the tutorial.
    this.goalReached = true;
    return true;
  }

  /** True while any cheat is active — shows the HUD badge and blocks saving. */
  get devMode(): boolean {
    return Object.values(this.cheats).some(Boolean);
  }

  toggleCheat(cheat: keyof DevCheats): boolean {
    this.cheats[cheat] = !this.cheats[cheat];
    return this.cheats[cheat];
  }

  saveNow(): void {
    // Dev-mode sessions must never touch the real save.
    if (!this.storage || this.devMode) return;
    const data = captureSave(this.world, this.player, this.money, this.upgrades);
    writeSave(this.storage, data);
    this.pendingSave = data;
  }

  update(dt: number, input: Input): void {
    if (this.toast && (this.toast.timeLeft -= dt) <= 0) this.toast = null;

    if (this.state === "title") {
      if (input.wasPressed("Enter", "Space")) {
        if (!this.continueGame()) this.startNewGame();
      } else if (input.wasPressed("KeyN")) {
        this.startNewGame();
      }
      return;
    }
    if (this.state === "briefing") {
      if (input.wasPressed("Enter", "Space")) this.state = "playing";
      return;
    }
    if (this.state === "shop" || this.state === "menu") return; // sim paused; the overlay owns input
    if (this.state === "dead") {
      if (input.wasPressed("Enter", "Space")) this.respawn();
      return;
    }
    if (this.state === "won") {
      // The payoff isn't a dead end — carry on into the endless world.
      if (input.wasPressed("Enter", "Space")) this.state = "playing";
      return;
    }
    if (this.justClosedShop) {
      // Keys pressed inside the overlay must not leak into the sim.
      input.reset();
      this.justClosedShop = false;
      return;
    }

    if (input.wasPressed("Escape")) {
      this.state = "menu";
      this.menu.open(this, () => {
        this.state = "playing";
        this.justClosedShop = true;
      });
      return;
    }

    const p = this.player;
    this.runTime += dt;
    if (this.cheats.unlimitedFuel) p.fuel = p.maxFuel;
    if (this.cheats.unlimitedFunds && this.money < DEV_MONEY) this.money = DEV_MONEY;

    if (this.fuse && (this.fuse.timeLeft -= dt) <= 0) {
      this.detonate();
      if (this.state !== "playing") return;
    }
    ITEM_ORDER.forEach((id, i) => {
      if (input.wasPressed(`Digit${i + 1}`)) this.useItem(id);
    });

    const move: MoveInput = {
      thrustUp: input.isDown("ArrowUp", "KeyW", "Space") && p.fuel > 0,
      moveLeft: input.isDown("ArrowLeft", "KeyA"),
      moveRight: input.isDown("ArrowRight", "KeyD"),
    };
    this.thrusting = move.thrustUp;
    stepPlayer(p, this.world, move, dt);

    const crash = fallDamage(p.impactSpeed);
    if (crash > 0) {
      this.showToast(`HARD LANDING! −${Math.round(crash)} hull`, 2);
      this.pushFx({ kind: "impact", x: p.x + p.width / 2, y: p.y + p.height, power: crash });
      this.applyDamage(crash, "Hull shattered on impact");
      if (this.state !== "playing") return;
    }

    // Remember the dig target so effects know where the tile was after it pops.
    const digX = p.digTargetX;
    const digY = p.digTargetY;
    const dug = updateDrilling(
      p,
      this.world,
      {
        down: input.isDown("ArrowDown", "KeyS"),
        left: move.moveLeft,
        right: move.moveRight,
      },
      this.drillPower,
      dt,
      this.cheats.digAnything,
    );
    if (dug !== null) {
      const cx = digX * TILE + TILE / 2;
      const cy = digY * TILE + TILE / 2;
      const hazard = digHazard(dug);
      if (hazard) {
        this.showToast(hazard.toast, 2);
        this.pushFx({ kind: "explosion", x: cx, y: cy });
        this.applyDamage(hazard.damage, hazard.cause);
        if (this.state !== "playing") return;
      } else {
        this.pushFx({ kind: "dug", x: cx, y: cy, color: TILE_DEFS[dug].color });
        if (TILE_DEFS[dug].value > 0) {
          if (addToCargo(p.cargo, dug, p.cargoCapacity)) {
            this.showToast(`+ ${TILE_DEFS[dug].name}`, 1.2);
            this.pushFx({
              kind: "pickup",
              x: cx,
              y: cy,
              color: TILE_DEFS[dug].color,
              value: TILE_DEFS[dug].value,
            });
          } else {
            this.showToast("CARGO FULL — mineral lost", 2);
          }
        }
      }
    }

    let burn = p.grounded ? 0 : FUEL.idleBurn;
    if (this.thrusting) burn += FUEL.thrustBurn;
    if (p.hasDigTarget) burn += FUEL.digBurn;
    p.fuel = Math.max(0, p.fuel - burn * dt);
    if (p.fuel <= 0) {
      this.die("Out of fuel");
      return;
    }

    this.onboarding?.update({
      depth: this.depth,
      cargoUnits: cargoUnits(p.cargo),
      soldCargo: this.soldCargo,
    });

    this.maxDepth = Math.max(this.maxDepth, this.depth);
    if (!this.goalReached && this.depth >= SLICE.goalDepth) {
      this.reachAnomaly();
      return;
    }

    const station = this.currentStation();
    if (station && input.wasPressed("Enter", "KeyE")) {
      this.state = "shop";
      this.shop.open(station, this, () => {
        this.state = "playing";
        this.justClosedShop = true;
        this.saveNow(); // station visits are natural checkpoints
      });
      return;
    }

    // Autosave while parked at the surface.
    this.autosaveTimer += dt;
    if (p.grounded && this.depth === 0 && this.autosaveTimer >= AUTOSAVE_INTERVAL) {
      this.autosaveTimer = 0;
      this.saveNow();
    }
  }

  /** The station the pod is parked on, if grounded at the surface. */
  currentStation(): Station | null {
    const p = this.player;
    if (!p.grounded) return null;
    const feetRow = Math.floor((p.y + p.height + 0.5) / TILE);
    if (feetRow !== this.world.surfaceRow) return null;
    const left = Math.floor(p.x / TILE);
    const right = Math.floor((p.x + p.width) / TILE);
    return stationInSpan(left, right);
  }

  stationHint(): string | null {
    if (this.state !== "playing") return null;
    const station = this.currentStation();
    return station ? `[E] enter ${station.label}` : null;
  }

  applyDamage(amount: number, cause: string): void {
    if (this.state !== "playing" || this.cheats.noDamage) return;
    this.player.hull -= amount;
    if (this.player.hull <= 0) {
      this.player.hull = 0;
      this.die(cause);
    }
  }

  /** Buy the next tier of a track. Returns false if maxed or unaffordable. */
  buyUpgrade(track: UpgradeTrack): boolean {
    const next = nextTier(track, this.upgrades);
    if (!next || this.money < next.cost) return false;
    this.money -= next.cost;
    this.upgrades[track] += 1;
    this.applyUpgrades(this.player);
    if (track === "hull") this.player.hull = this.player.maxHull; // new hull ships repaired
    this.showToast(`${next.name} installed!`, 2);
    this.pushFx({
      kind: "upgrade",
      x: this.player.x + this.player.width / 2,
      y: this.player.y + this.player.height / 2,
    });
    return true;
  }

  /** Buy one of a consumable at the trader. False if broke or carrying the max. */
  buyItem(id: ItemId): boolean {
    const def = ITEMS[id];
    const items = this.player.items;
    if (this.money < def.cost || items[id] >= def.maxStack) return false;
    this.money -= def.cost;
    items[id] += 1;
    this.showToast(`${def.name} stowed`, 1.5);
    return true;
  }

  /** Use a consumable by id (hotkeys 1-4). False if out or the effect would be wasted. */
  useItem(id: ItemId): boolean {
    const p = this.player;
    if (p.items[id] <= 0) {
      this.showToast(`No ${ITEMS[id].name.toLowerCase()} left`, 1.2);
      return false;
    }
    switch (id) {
      case "dynamite": {
        if (this.fuse) return false; // one charge at a time
        const centerCol = Math.floor((p.x + p.width / 2) / TILE);
        const podRow = Math.floor((p.y + p.height / 2) / TILE);
        this.fuse = { x: centerCol, y: podRow, timeLeft: DYNAMITE.fuseSeconds };
        this.showToast("DYNAMITE ARMED — CLEAR OUT!", DYNAMITE.fuseSeconds);
        break;
      }
      case "fuelCell": {
        if (p.fuel >= p.maxFuel) {
          this.showToast("Tank already full", 1.2);
          return false;
        }
        p.fuel = Math.min(p.maxFuel, p.fuel + FUEL_CELL_UNITS);
        this.showToast(`+${FUEL_CELL_UNITS} fuel`, 1.5);
        break;
      }
      case "repairKit": {
        if (p.hull >= p.maxHull) {
          this.showToast("Hull already sound", 1.2);
          return false;
        }
        p.hull = Math.min(p.maxHull, p.hull + REPAIR_KIT_HP);
        this.showToast(`+${REPAIR_KIT_HP} hull`, 1.5);
        break;
      }
      case "teleporter": {
        if (p.grounded && this.depth === 0) {
          this.showToast("Already at the surface", 1.2);
          return false;
        }
        this.pushFx({ kind: "upgrade", x: p.x + p.width / 2, y: p.y + p.height / 2 });
        const home = spawnPoint(this.world);
        p.x = home.x;
        p.y = home.y;
        p.prevX = home.x; // no interpolation streak across the world
        p.prevY = home.y;
        p.vx = 0;
        p.vy = 0;
        p.hasDigTarget = false;
        p.digProgress = 0;
        this.pushFx({ kind: "upgrade", x: home.x + p.width / 2, y: home.y + p.height / 2 });
        this.showToast("Recalled to surface", 1.5);
        break;
      }
    }
    p.items[id] -= 1;
    return true;
  }

  /** The armed charge goes off: clear tiles, hurt the pod if it lingered. */
  private detonate(): void {
    const fuse = this.fuse!;
    this.fuse = null;
    const cx = fuse.x * TILE + TILE / 2;
    const cy = fuse.y * TILE + TILE / 2;
    this.world.blast(fuse.x, fuse.y, DYNAMITE.radius);
    this.pushFx({ kind: "explosion", x: cx, y: cy });
    const p = this.player;
    const dist =
      Math.hypot(p.x + p.width / 2 - cx, p.y + p.height / 2 - cy) / TILE;
    const falloff = 1 - dist / (DYNAMITE.radius + 1);
    if (falloff > 0) {
      const damage = Math.round(DYNAMITE.damage * falloff);
      this.showToast(`CAUGHT IN THE BLAST! −${damage} hull`, 2);
      this.applyDamage(damage, "Blown up by own dynamite");
    }
  }

  /** Sell the whole cargo bay at market value. Returns the amount earned. */
  sellCargo(): number {
    const p = this.player;
    const total = cargoValue(p.cargo);
    if (total <= 0) return 0;
    this.money += total;
    p.cargo.clear();
    this.soldCargo = true;
    this.pushFx({ kind: "sell", x: p.x + p.width / 2, y: p.y + p.height / 2, value: total });
    return total;
  }

  /** Current onboarding prompt while playing, or null when there's none. */
  onboardingHint(): OnboardPrompt | null {
    if (this.state !== "playing") return null;
    return this.onboarding?.prompt ?? null;
  }

  /** Live objective for the HUD while the goal is pending; null otherwise. */
  objective(): { current: number; target: number } | null {
    if (this.state !== "playing" || this.goalReached) return null;
    if (this.onboarding?.active) return null; // don't fight the tutorial banner
    return { current: this.depth, target: SLICE.goalDepth };
  }

  /** Final run stats for the payoff screen. */
  runStats(): { depth: number; money: number; time: number; deaths: number } {
    return { depth: this.maxDepth, money: this.money, time: this.runTime, deaths: this.deaths };
  }

  /** Goal reached: freeze into the payoff screen (Enter resumes exploring). */
  private reachAnomaly(): void {
    this.goalReached = true;
    this.state = "won";
    const p = this.player;
    this.pushFx({ kind: "upgrade", x: p.x + p.width / 2, y: p.y + p.height / 2 });
    this.saveNow();
  }

  /**
   * Dev/test: drop the pod at the objective depth so the payoff can be tried
   * without the full descent. Carves a landing pocket and re-arms the goal so
   * it can be triggered again. The next tick's depth check fires the payoff.
   */
  devWarpToGoal(): void {
    const anom = this.world.anomaly;
    // Drop into the crafted chamber beside the beacon. If there's no set-piece
    // (e.g. a shallow test world), carve a small landing pocket instead.
    const col = anom ? Math.max(2, anom.x - 3) : Math.floor(this.world.width / 2);
    const row = anom ? anom.y - 2 : this.world.surfaceRow + SLICE.goalDepth;
    if (!anom) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -1; dx <= 1; dx++) this.world.setTile(col + dx, row + dy, TileId.Empty);
      }
      this.world.setTile(col, row + 3, TileId.Dirt);
    }
    const p = this.player;
    p.x = col * TILE + (TILE - p.width) / 2;
    p.y = row * TILE;
    p.prevX = p.x;
    p.prevY = p.y;
    p.vx = 0;
    p.vy = 0;
    p.hasDigTarget = false;
    p.digProgress = 0;
    this.goalReached = false; // re-arm so the payoff triggers on arrival
  }

  /** Repair as much hull as money covers, at HULL.repairPricePerHp. */
  repairHull(): boolean {
    const p = this.player;
    // Same partial-purchase math as fuel: fill what's affordable.
    const plan = refuelPlan(p.hull, p.maxHull, this.money, HULL.repairPricePerHp);
    if (plan.units <= 0) return false;
    p.hull += plan.units;
    this.money -= plan.cost;
    return true;
  }

  /** Push owned upgrade values onto a pod (capacities, not current levels). */
  private applyUpgrades(p: Player): void {
    p.maxFuel = currentTier("tank", this.upgrades).value;
    p.cargoCapacity = currentTier("cargo", this.upgrades).value;
    p.maxHull = currentTier("hull", this.upgrades).value;
  }

  /** What losing the pod right now would cost — shown on the death screen. */
  get salvageFeeDue(): number {
    return salvageFeeFor(this.money);
  }

  die(cause: string): void {
    this.state = "dead";
    this.deathCause = cause;
    this.deaths += 1;
    this.fuse = null;
    this.pushFx({
      kind: "death",
      x: this.player.x + this.player.width / 2,
      y: this.player.y + this.player.height / 2,
    });
  }

  /** Fresh pod at the surface: full tank and hull, cargo and items gone, salvage fee charged. Upgrades persist. */
  respawn(): void {
    const fee = Math.min(this.money, this.salvageFeeDue);
    this.money -= fee;
    this.showToast(`Salvage fee −$${fee}`, 2.5);
    const fresh = createPlayer(this.world);
    this.applyUpgrades(fresh);
    fresh.fuel = fresh.maxFuel;
    fresh.hull = fresh.maxHull;
    this.player = fresh;
    this.state = "playing";
    this.saveNow(); // the fee and lost cargo are part of history now
  }

  private showToast(text: string, seconds: number): void {
    this.toast = { text, timeLeft: seconds, total: seconds };
  }

  pushFx(event: FxEvent): void {
    this.fxEvents.push(event);
    if (this.fxEvents.length > 64) this.fxEvents.shift();
  }
}
