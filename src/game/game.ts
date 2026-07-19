import { Camera } from "../engine/camera";
import type { Input } from "../engine/input";
import { lerp } from "../engine/math";
import { drawHud } from "../ui/hud";
import { DRILL, TILE, WORLD } from "./config";
import { updateDrilling } from "./drilling";
import { createPlayer, type Player } from "./player";
import { stepPlayer, type MoveInput } from "./physics";
import { hash2d } from "./rng";
import { TILE_DEFS, TileId } from "./tiles";
import { World } from "./world";

export class Game {
  readonly world: World;
  readonly player: Player;
  readonly camera: Camera;
  /** Dug minerals, tallied until the real cargo/economy system lands. */
  readonly minerals = new Map<TileId, number>();
  private thrusting = false;

  constructor(viewWidth: number, viewHeight: number) {
    this.world = new World(WORLD.width, WORLD.height, WORLD.surfaceRow, WORLD.seed, TILE);
    this.player = createPlayer(this.world);
    this.camera = new Camera(viewWidth, viewHeight);
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
    const move: MoveInput = {
      thrustUp: input.isDown("ArrowUp", "KeyW", "Space"),
      moveLeft: input.isDown("ArrowLeft", "KeyA"),
      moveRight: input.isDown("ArrowRight", "KeyD"),
    };
    this.thrusting = move.thrustUp;
    stepPlayer(this.player, this.world, move, dt);

    const dug = updateDrilling(
      this.player,
      this.world,
      {
        down: input.isDown("ArrowDown", "KeyS"),
        left: move.moveLeft,
        right: move.moveRight,
      },
      DRILL.basePower,
      dt,
    );
    if (dug !== null && TILE_DEFS[dug].value > 0) {
      this.minerals.set(dug, (this.minerals.get(dug) ?? 0) + 1);
    }
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
    this.drawPlayer(ctx, px - this.camera.x, py - this.camera.y);
    drawHud(ctx, { depth: this.depth, minerals: this.minerals });
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

  private drawPlayer(ctx: CanvasRenderingContext2D, sx: number, sy: number): void {
    const p = this.player;

    if (this.thrusting) {
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
}
