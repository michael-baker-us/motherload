import { Camera } from "../engine/camera";
import type { Input } from "../engine/input";
import { lerp } from "../engine/math";
import { drawHud } from "../ui/hud";
import { ShopOverlay } from "../ui/shop";
import { DRILL, ECONOMY, FUEL, HULL, TILE, WORLD } from "./config";
import { updateDrilling } from "./drilling";
import { addToCargo, cargoUnits, refuelPlan } from "./economy";
import { digHazard, fallDamage } from "./hazards";
import { createPlayer, type Player } from "./player";
import { stepPlayer, type MoveInput } from "./physics";
import { hash2d } from "./rng";
import {
  applyPlayerSave,
  applyWorldSave,
  captureSave,
  loadSave,
  writeSave,
  type SaveData,
  type SaveStorage,
} from "./save";
import { STATIONS, stationInSpan, type Station } from "./stations";
import { TILE_DEFS, TileId } from "./tiles";
import {
  createUpgradeState,
  currentTier,
  nextTier,
  type UpgradeState,
  type UpgradeTrack,
} from "./upgrades";
import { World } from "./world";

export type GameState = "title" | "playing" | "shop" | "dead";

/** Interval between surface autosaves while the pod is parked topside. */
const AUTOSAVE_INTERVAL = 5;

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

  private readonly shop = new ShopOverlay();
  private readonly storage: SaveStorage | null;
  private pendingSave: SaveData | null;
  private thrusting = false;
  private toast: { text: string; timeLeft: number } | null = null;
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

  get hasSave(): boolean {
    return this.pendingSave !== null;
  }

  startNewGame(): void {
    this.state = "playing";
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
    return true;
  }

  saveNow(): void {
    if (!this.storage) return;
    const data = captureSave(this.world, this.player, this.money, this.upgrades);
    writeSave(this.storage, data);
    this.pendingSave = data;
  }

  resize(viewWidth: number, viewHeight: number): void {
    this.camera.resize(viewWidth, viewHeight);
  }

  /** Depth of the pod's feet below the surface, in tiles ("meters" on the HUD). */
  get depth(): number {
    const feetRow = Math.floor((this.player.y + this.player.height) / TILE);
    return Math.max(0, feetRow - this.world.surfaceRow);
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
    if (this.state === "shop") return; // sim paused; the overlay owns input
    if (this.state === "dead") {
      if (input.wasPressed("Enter", "Space")) this.respawn();
      return;
    }
    if (this.justClosedShop) {
      // Keys pressed inside the overlay must not leak into the sim.
      input.reset();
      this.justClosedShop = false;
      return;
    }

    const p = this.player;
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
      this.applyDamage(crash, "Hull shattered on impact");
      if (this.state !== "playing") return;
    }

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
    );
    if (dug !== null) {
      const hazard = digHazard(dug);
      if (hazard) {
        this.showToast(hazard.toast, 2);
        this.applyDamage(hazard.damage, hazard.cause);
        if (this.state !== "playing") return;
      } else if (TILE_DEFS[dug].value > 0) {
        if (addToCargo(p.cargo, dug, p.cargoCapacity)) {
          this.showToast(`+ ${TILE_DEFS[dug].name}`, 1.2);
        } else {
          this.showToast("CARGO FULL — mineral lost", 2);
        }
      }
    }

    let burn = FUEL.idleBurn;
    if (this.thrusting) burn += FUEL.thrustBurn;
    if (p.hasDigTarget) burn += FUEL.digBurn;
    p.fuel = Math.max(0, p.fuel - burn * dt);
    if (p.fuel <= 0) {
      this.die("Out of fuel");
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

  get drillPower(): number {
    return DRILL.basePower * currentTier("drill", this.upgrades).value;
  }

  applyDamage(amount: number, cause: string): void {
    if (this.state !== "playing") return;
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
    return true;
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

  die(cause: string): void {
    this.state = "dead";
    this.deathCause = cause;
  }

  /** Fresh pod at the surface: full tank and hull, cargo gone, salvage fee charged. Upgrades persist. */
  respawn(): void {
    this.money = Math.max(0, this.money - ECONOMY.salvageFee);
    const fresh = createPlayer(this.world);
    this.applyUpgrades(fresh);
    fresh.fuel = fresh.maxFuel;
    fresh.hull = fresh.maxHull;
    this.player = fresh;
    this.state = "playing";
    this.saveNow(); // the fee and lost cargo are part of history now
  }

  private showToast(text: string, seconds: number): void {
    this.toast = { text, timeLeft: seconds };
  }

  render(ctx: CanvasRenderingContext2D, alpha: number): void {
    const p = this.player;
    const px = lerp(p.prevX, p.x, alpha);
    const py = lerp(p.prevY, p.y, alpha);
    // Camera tracks the interpolated position so scrolling stays smooth.
    this.camera.follow(
      px + p.width / 2,
      py + p.height / 2,
      this.world.pixelWidth,
      this.world.pixelHeight,
    );

    this.drawSky(ctx);
    this.drawTiles(ctx);
    this.drawStations(ctx);
    this.drawPlayer(ctx, px - this.camera.x, py - this.camera.y);
    if (this.state === "title") {
      this.drawTitleScreen(ctx);
      return;
    }
    drawHud(ctx, {
      depth: this.depth,
      fuel: p.fuel,
      maxFuel: p.maxFuel,
      hull: p.hull,
      maxHull: p.maxHull,
      money: this.money,
      cargoUnits: cargoUnits(p.cargo),
      cargoCapacity: p.cargoCapacity,
      hint: this.stationHint(),
      toast: this.toast,
    });
    if (this.state === "dead") this.drawDeathScreen(ctx);
  }

  private stationHint(): string | null {
    if (this.state !== "playing") return null;
    const station = this.currentStation();
    return station ? `[E] enter ${station.label}` : null;
  }

  private drawSky(ctx: CanvasRenderingContext2D): void {
    const grad = ctx.createLinearGradient(0, 0, 0, this.camera.viewHeight);
    grad.addColorStop(0, "#8ecdf0");
    grad.addColorStop(1, "#5f9fcf");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.camera.viewWidth, this.camera.viewHeight);
  }

  private drawTiles(ctx: CanvasRenderingContext2D): void {
    const cam = this.camera;
    const x0 = Math.max(0, Math.floor(cam.x / TILE));
    const y0 = Math.max(0, Math.floor(cam.y / TILE));
    const x1 = Math.min(this.world.width - 1, Math.floor((cam.x + cam.viewWidth) / TILE));
    const y1 = Math.min(this.world.height - 1, Math.floor((cam.y + cam.viewHeight) / TILE));

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const tile = this.world.getTile(tx, ty);
        if (tile === TileId.Sky) continue;
        const sx = tx * TILE - cam.x;
        const sy = ty * TILE - cam.y;
        const def = TILE_DEFS[tile];

        if (def.value > 0) {
          // Minerals render as a colored lode embedded in dirt.
          ctx.fillStyle = TILE_DEFS[TileId.Dirt].color;
          ctx.fillRect(sx, sy, TILE, TILE);
          ctx.fillStyle = def.color;
          ctx.beginPath();
          const wobble = hash2d(tx, ty, 7) * 6 - 3;
          ctx.ellipse(sx + TILE / 2 + wobble, sy + TILE / 2, 10, 8, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = def.color;
          ctx.fillRect(sx, sy, TILE, TILE);
        }

        // Deterministic per-tile shading breaks up the flat color grid.
        if (tile !== TileId.Empty) {
          ctx.fillStyle = `rgba(0,0,0,${(hash2d(tx, ty, this.world.seed) * 0.14).toFixed(3)})`;
          ctx.fillRect(sx, sy, TILE, TILE);
        }
      }
    }

    // Active dig target: reveal the hole in proportion to progress.
    const p = this.player;
    if (p.hasDigTarget) {
      ctx.fillStyle = TILE_DEFS[TileId.Empty].color;
      ctx.globalAlpha = Math.min(1, p.digProgress);
      ctx.fillRect(p.digTargetX * TILE - cam.x, p.digTargetY * TILE - cam.y, TILE, TILE);
      ctx.globalAlpha = 1;
    }
  }

  private drawStations(ctx: CanvasRenderingContext2D): void {
    const cam = this.camera;
    const groundY = this.world.surfaceRow * TILE;
    for (const s of STATIONS) {
      const sx = s.x0 * TILE - cam.x;
      const w = (s.x1 - s.x0 + 1) * TILE;
      const h = TILE * 2.2;
      const sy = groundY - h - cam.y;
      if (sx + w < 0 || sx > cam.viewWidth) continue;

      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.roundRect(sx, sy, w, h, [6, 6, 0, 0]);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(sx + 8, sy + 10, w - 16, 14);
      ctx.fillStyle = "#ffffff";
      ctx.font = "11px monospace";
      ctx.textBaseline = "top";
      const tw = ctx.measureText(s.label).width;
      ctx.fillText(s.label, sx + (w - tw) / 2, sy + h - 20);
      ctx.font = "14px monospace";
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, sx: number, sy: number): void {
    const p = this.player;

    if (this.thrusting && this.state === "playing") {
      ctx.fillStyle = "#ff9d2e";
      ctx.beginPath();
      ctx.moveTo(sx + p.width * 0.3, sy + p.height);
      ctx.lineTo(sx + p.width * 0.7, sy + p.height);
      ctx.lineTo(sx + p.width * 0.5, sy + p.height + 10 + Math.random() * 4);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = "#c23b22";
    ctx.beginPath();
    ctx.roundRect(sx, sy, p.width, p.height, 6);
    ctx.fill();

    ctx.fillStyle = "#bde3f5";
    ctx.beginPath();
    ctx.arc(sx + p.width / 2 + p.facing * 4, sy + p.height * 0.4, 5, 0, Math.PI * 2);
    ctx.fill();

    // Drill: points at the dig target while digging, otherwise hangs below.
    ctx.fillStyle = "#8a8f98";
    ctx.beginPath();
    if (p.hasDigTarget && p.digTargetX * TILE < p.x - 1) {
      ctx.moveTo(sx, sy + p.height * 0.55);
      ctx.lineTo(sx, sy + p.height * 0.85);
      ctx.lineTo(sx - 8, sy + p.height * 0.7);
    } else if (p.hasDigTarget && p.digTargetX * TILE > p.x + 1) {
      ctx.moveTo(sx + p.width, sy + p.height * 0.55);
      ctx.lineTo(sx + p.width, sy + p.height * 0.85);
      ctx.lineTo(sx + p.width + 8, sy + p.height * 0.7);
    } else {
      ctx.moveTo(sx + p.width * 0.35, sy + p.height);
      ctx.lineTo(sx + p.width * 0.65, sy + p.height);
      ctx.lineTo(sx + p.width * 0.5, sy + p.height + 7);
    }
    ctx.closePath();
    ctx.fill();
  }

  private drawTitleScreen(ctx: CanvasRenderingContext2D): void {
    const { viewWidth, viewHeight } = this.camera;
    ctx.fillStyle = "rgba(10, 8, 4, 0.65)";
    ctx.fillRect(0, 0, viewWidth, viewHeight);

    ctx.textBaseline = "top";
    ctx.fillStyle = "#f0c020";
    ctx.font = "bold 52px monospace";
    center(ctx, "MOTHERLOAD", viewWidth, viewHeight * 0.28);
    ctx.fillStyle = "#c9ccd4";
    ctx.font = "15px monospace";
    center(ctx, "dig deep · sell minerals · upgrade · don't run dry", viewWidth, viewHeight * 0.28 + 68);

    ctx.fillStyle = "#ffe97a";
    ctx.font = "17px monospace";
    center(
      ctx,
      this.hasSave ? "[Enter] continue" : "[Enter] start digging",
      viewWidth,
      viewHeight * 0.55,
    );
    if (this.hasSave) {
      ctx.fillStyle = "#c9ccd4";
      ctx.font = "14px monospace";
      center(ctx, "[N] new game (overwrites the save)", viewWidth, viewHeight * 0.55 + 30);
    }
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "13px monospace";
    center(ctx, "← → fly/dig · ↑ thrust · ↓ drill · E station", viewWidth, viewHeight * 0.55 + 64);
    ctx.font = "14px monospace";
  }

  private drawDeathScreen(ctx: CanvasRenderingContext2D): void {
    const { viewWidth, viewHeight } = this.camera;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, 0, viewWidth, viewHeight);
    ctx.fillStyle = "#e04a3a";
    ctx.font = "28px monospace";
    ctx.textBaseline = "top";
    center(ctx, "POD LOST", viewWidth, viewHeight * 0.4);
    ctx.fillStyle = "#ffffff";
    ctx.font = "15px monospace";
    center(ctx, this.deathCause, viewWidth, viewHeight * 0.4 + 44);
    center(
      ctx,
      `Salvage fee $${ECONOMY.salvageFee} · cargo lost`,
      viewWidth,
      viewHeight * 0.4 + 68,
    );
    ctx.fillStyle = "#ffe97a";
    center(ctx, "[Enter] launch replacement pod", viewWidth, viewHeight * 0.4 + 104);
    ctx.font = "14px monospace";
  }
}

function center(ctx: CanvasRenderingContext2D, text: string, viewWidth: number, y: number): void {
  ctx.fillText(text, (viewWidth - ctx.measureText(text).width) / 2, y);
}
