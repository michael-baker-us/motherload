import { clamp, lerp } from "../engine/math";
import { ECONOMY, TILE } from "../game/config";
import { cargoUnits } from "../game/economy";
import type { FxEvent, Game } from "../game/game";
import { hash2d, mulberry32 } from "../game/rng";
import { STATIONS } from "../game/stations";
import { TileId } from "../game/tiles";
import { drawHud } from "../ui/hud";
import { makeTileTextures, shade, TILE_VARIANTS, type TileTextures } from "./tileart";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
}

const MAX_PARTICLES = 400;

// Darkness ramps in from this depth (tiles) and saturates over the next DARK_RAMP.
const DARK_START = 4;
const DARK_RAMP = 70;
const LIGHT_RADIUS = 230;

/**
 * All drawing lives here; Game stays logic-only (and node-testable). The
 * renderer owns purely cosmetic state: textures, particles, camera shake.
 */
export class Renderer {
  private readonly textures: TileTextures;
  private readonly lightCanvas = document.createElement("canvas");
  private readonly hills: { points: number[]; parallax: number; color: string; base: number }[];
  private particles: Particle[] = [];
  private shake = 0;
  private time = 0;
  private frameDt = 0;
  private lastNow = performance.now();
  // Drill orientation is sticky: it holds its last dig direction briefly and
  // swings between orientations instead of snapping, so chained side-digs
  // (dig → roll to next wall → dig) don't flicker the drill down and back.
  private drillAngle = 0;
  private drillTargetAngle = 0;
  private drillHold = 0;

  constructor() {
    this.textures = makeTileTextures();
    // Two silhouette ridge lines for the horizon, generated once.
    const rand = mulberry32(4242);
    const ridge = (parallax: number, color: string, base: number) => {
      const points: number[] = [];
      let h = 30 + rand() * 20;
      for (let i = 0; i <= 80; i++) {
        h = clamp(h + (rand() - 0.5) * 22, 8, 78);
        points.push(h);
      }
      return { points, parallax, color, base };
    };
    this.hills = [ridge(0.15, "#6e3a28", 46), ridge(0.35, "#54291c", 20)];
  }

  render(ctx: CanvasRenderingContext2D, game: Game, alpha: number): void {
    const now = performance.now();
    const dt = clamp((now - this.lastNow) / 1000, 0, 0.05);
    this.lastNow = now;
    this.time += dt;
    this.frameDt = dt;

    const cam = game.camera;
    const p = game.player;
    const px = lerp(p.prevX, p.x, alpha);
    const py = lerp(p.prevY, p.y, alpha);
    cam.follow(px + p.width / 2, py + p.height / 2, game.world.pixelWidth, game.world.pixelHeight);

    this.consumeFx(game.fxEvents);
    this.emitContinuousFx(game, px, py);
    this.updateParticles(dt);
    this.shake = Math.max(0, this.shake - dt * 1.6);

    this.drawSky(ctx, game);

    const shakeMag = this.shake * this.shake * 22;
    const shakeX = (Math.random() - 0.5) * shakeMag;
    const shakeY = (Math.random() - 0.5) * shakeMag;
    ctx.save();
    ctx.translate(shakeX, shakeY);
    this.drawTiles(ctx, game);
    this.drawStations(ctx, game);
    this.drawPod(ctx, game, px - cam.x, py - cam.y);
    this.drawParticles(ctx, game);
    ctx.restore();

    this.applyLighting(ctx, game, px - cam.x + p.width / 2, py - cam.y + p.height / 2);
    this.drawVignette(ctx, game);

    if (game.state === "title") {
      this.drawTitleScreen(ctx, game);
      return;
    }
    drawHud(ctx, {
      depth: game.depth,
      fuel: p.fuel,
      maxFuel: p.maxFuel,
      hull: p.hull,
      maxHull: p.maxHull,
      money: game.money,
      cargoUnits: cargoUnits(p.cargo),
      cargoCapacity: p.cargoCapacity,
      hint: game.stationHint(),
      toast: game.toast,
      dev: game.devMode,
    });
    if (game.state === "dead") this.drawDeathScreen(ctx, game);
  }

  // --- Effects -------------------------------------------------------------

  private consumeFx(events: FxEvent[]): void {
    for (const e of events) {
      if (e.kind === "dug") {
        this.burst(e.x, e.y, 10, e.color ?? "#8a4a2a", 90, 700);
      } else if (e.kind === "impact") {
        this.burst(e.x, e.y, 14, "#a4643c", 130, 300);
        this.shake = Math.max(this.shake, clamp((e.power ?? 0) / 60, 0.25, 0.6));
      } else if (e.kind === "explosion") {
        this.burst(e.x, e.y, 26, "#ff9d2e", 220, 200);
        this.burst(e.x, e.y, 12, "#ffe97a", 160, 100);
        this.shake = Math.max(this.shake, 0.6);
      } else if (e.kind === "upgrade") {
        this.burst(e.x, e.y, 20, "#ffe97a", 140, -40);
        this.burst(e.x, e.y, 8, "#ffffff", 90, -40);
      }
    }
    events.length = 0;
  }

  private emitContinuousFx(game: Game, px: number, py: number): void {
    if (game.state !== "playing") return;
    const p = game.player;
    if (game.isThrusting) {
      this.spawn({
        x: px + p.width / 2 + (Math.random() - 0.5) * 8,
        y: py + p.height + 4,
        vx: (Math.random() - 0.5) * 30,
        vy: 60 + Math.random() * 60,
        life: 0.5,
        maxLife: 0.5,
        size: 2 + Math.random() * 2,
        color: Math.random() > 0.4 ? "#8a8078" : "#ff9d2e",
        gravity: -60,
      });
    }
    if (p.hasDigTarget && Math.random() > 0.35) {
      this.spawn({
        x: p.digTargetX * TILE + TILE / 2 + (Math.random() - 0.5) * 16,
        y: p.digTargetY * TILE + TILE / 2 + (Math.random() - 0.5) * 16,
        vx: (Math.random() - 0.5) * 90,
        vy: -40 - Math.random() * 60,
        life: 0.4,
        maxLife: 0.4,
        size: 1.5 + Math.random() * 1.5,
        color: "#a4643c",
        gravity: 500,
      });
    }
  }

  private burst(x: number, y: number, count: number, color: string, speed: number, gravity: number): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      const life = 0.4 + Math.random() * 0.4;
      this.spawn({
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v - speed * 0.3,
        life,
        maxLife: life,
        size: 1.5 + Math.random() * 2.5,
        color,
        gravity,
      });
    }
  }

  private spawn(particle: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(particle);
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private drawParticles(ctx: CanvasRenderingContext2D, game: Game): void {
    const cam = game.camera;
    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - cam.x - p.size / 2, p.y - cam.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  // --- World ---------------------------------------------------------------

  private drawSky(ctx: CanvasRenderingContext2D, game: Game): void {
    const cam = game.camera;
    const grad = ctx.createLinearGradient(0, 0, 0, cam.viewHeight);
    grad.addColorStop(0, "#1d2b4a");
    grad.addColorStop(0.55, "#5d7ba0");
    grad.addColorStop(1, "#d98e5f");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cam.viewWidth, cam.viewHeight);

    // Sun, drifting slightly with the camera for depth.
    const sunX = cam.viewWidth * 0.72 - cam.x * 0.08;
    const sunY = 90 - cam.y * 0.08;
    const glow = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 70);
    glow.addColorStop(0, "rgba(255,242,208,0.95)");
    glow.addColorStop(0.25, "rgba(255,220,170,0.45)");
    glow.addColorStop(1, "rgba(255,220,170,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - 70, sunY - 70, 140, 140);

    // Parallax ridge silhouettes along the horizon.
    const horizonY = game.world.surfaceRow * TILE - cam.y;
    if (horizonY > -20) {
      for (const hill of this.hills) {
        ctx.fillStyle = hill.color;
        ctx.beginPath();
        const step = 26;
        const offset = cam.x * hill.parallax;
        ctx.moveTo(0, horizonY);
        for (let sx = 0; sx <= cam.viewWidth + step; sx += step) {
          const i = Math.floor((sx + offset) / step);
          const h = hill.points[((i % hill.points.length) + hill.points.length) % hill.points.length]!;
          ctx.lineTo(sx, horizonY - hill.base - h);
        }
        ctx.lineTo(cam.viewWidth, horizonY);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  private drawTiles(ctx: CanvasRenderingContext2D, game: Game): void {
    const cam = game.camera;
    const world = game.world;
    const x0 = Math.max(0, Math.floor(cam.x / TILE));
    const y0 = Math.max(0, Math.floor(cam.y / TILE));
    const x1 = Math.min(world.width - 1, Math.floor((cam.x + cam.viewWidth) / TILE));
    const y1 = Math.min(world.height - 1, Math.floor((cam.y + cam.viewHeight) / TILE));

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const tile = world.getTile(tx, ty);
        if (tile === TileId.Sky) continue;
        const sx = tx * TILE - cam.x;
        const sy = ty * TILE - cam.y;

        const variants = this.textures.get(tile);
        if (variants) {
          const v = Math.floor(hash2d(tx, ty, 7) * TILE_VARIANTS) % TILE_VARIANTS;
          ctx.drawImage(variants[v]!, sx, sy);
        }

        if (tile === TileId.Lava) {
          // Slow pulse so lava reads as alive.
          ctx.globalAlpha = 0.18 + 0.14 * Math.sin(this.time * 2.5 + hash2d(tx, ty, 3) * 6);
          ctx.fillStyle = "#ffb040";
          ctx.fillRect(sx, sy, TILE, TILE);
          ctx.globalAlpha = 1;
        }

        // Exposed-edge shading gives tunnels and cliffs definition.
        if (tile !== TileId.Empty) {
          if (!world.isSolid(tx, ty - 1)) {
            ctx.fillStyle = "rgba(255,230,200,0.16)";
            ctx.fillRect(sx, sy, TILE, 3);
          }
          if (!world.isSolid(tx, ty + 1)) {
            ctx.fillStyle = "rgba(0,0,0,0.3)";
            ctx.fillRect(sx, sy + TILE - 3, TILE, 3);
          }
          if (!world.isSolid(tx - 1, ty)) {
            ctx.fillStyle = "rgba(0,0,0,0.18)";
            ctx.fillRect(sx, sy, 2, TILE);
          }
          if (!world.isSolid(tx + 1, ty)) {
            ctx.fillStyle = "rgba(0,0,0,0.18)";
            ctx.fillRect(sx + TILE - 2, sy, 2, TILE);
          }
        }
      }
    }

    // Active dig target: the hole opens with progress.
    const p = game.player;
    if (p.hasDigTarget) {
      ctx.globalAlpha = clamp(p.digProgress, 0, 1);
      const tunnel = this.textures.get(TileId.Empty)!;
      ctx.drawImage(tunnel[0]!, p.digTargetX * TILE - cam.x, p.digTargetY * TILE - cam.y);
      ctx.globalAlpha = 1;
    }
  }

  private drawStations(ctx: CanvasRenderingContext2D, game: Game): void {
    const cam = game.camera;
    const groundY = game.world.surfaceRow * TILE;
    ctx.textBaseline = "top";
    for (const s of STATIONS) {
      const sx = s.x0 * TILE - cam.x;
      const w = (s.x1 - s.x0 + 1) * TILE;
      const h = TILE * 2.4;
      const sy = groundY - h - cam.y;
      if (sx + w < -20 || sx > cam.viewWidth + 20) continue;

      // Body with vertical shading.
      const body = ctx.createLinearGradient(0, sy, 0, sy + h);
      body.addColorStop(0, shade(s.color, 1.15));
      body.addColorStop(1, shade(s.color, 0.7));
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.roundRect(sx, sy + 8, w, h - 8, [5, 5, 0, 0]);
      ctx.fill();

      // Roof.
      ctx.fillStyle = shade(s.color, 0.5);
      ctx.beginPath();
      ctx.moveTo(sx - 5, sy + 10);
      ctx.lineTo(sx + 6, sy);
      ctx.lineTo(sx + w - 6, sy);
      ctx.lineTo(sx + w + 5, sy + 10);
      ctx.closePath();
      ctx.fill();

      // Door and lit window.
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(sx + w / 2 - 8, sy + h - 22, 16, 22);
      ctx.fillStyle = "#ffe9a0";
      ctx.fillRect(sx + 10, sy + 20, 12, 10);
      ctx.fillStyle = "rgba(255,233,160,0.25)";
      ctx.fillRect(sx + 8, sy + 18, 16, 14);

      // Sign.
      ctx.fillStyle = "rgba(10,8,6,0.75)";
      ctx.beginPath();
      ctx.roundRect(sx + 4, sy + h - 44, w - 8, 15, 3);
      ctx.fill();
      ctx.font = "bold 9px monospace";
      ctx.fillStyle = shade(s.color, 1.8);
      const tw = ctx.measureText(s.label).width;
      ctx.fillText(s.label, sx + (w - tw) / 2, sy + h - 40);
    }
    ctx.font = "14px monospace";
  }

  private drawPod(ctx: CanvasRenderingContext2D, game: Game, sx: number, sy: number): void {
    const p = game.player;
    const w = p.width;
    const h = p.height;

    // Thruster flame: layered, flickering.
    if (game.isThrusting && game.state === "playing") {
      const len = 11 + Math.random() * 6;
      ctx.fillStyle = "rgba(255,157,46,0.85)";
      ctx.beginPath();
      ctx.moveTo(sx + w * 0.28, sy + h - 2);
      ctx.lineTo(sx + w * 0.72, sy + h - 2);
      ctx.lineTo(sx + w * 0.5, sy + h + len);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffe97a";
      ctx.beginPath();
      ctx.moveTo(sx + w * 0.38, sy + h - 2);
      ctx.lineTo(sx + w * 0.62, sy + h - 2);
      ctx.lineTo(sx + w * 0.5, sy + h + len * 0.55);
      ctx.closePath();
      ctx.fill();
    }

    // Drill (before body so the housing tucks underneath). Direction comes
    // from tile coordinates — pixel comparisons misread a down-dig as a side
    // dig whenever the pod isn't flush with the tile's left edge.
    const digging = p.hasDigTarget;
    if (digging) {
      const podCol = Math.floor((p.x + w / 2) / TILE);
      const podRow = Math.floor((p.y + h / 2) / TILE);
      if (p.digTargetY > podRow) this.drillTargetAngle = 0;
      else if (p.digTargetX < podCol) this.drillTargetAngle = Math.PI / 2;
      else if (p.digTargetX > podCol) this.drillTargetAngle = -Math.PI / 2;
      this.drillHold = 0.45;
    } else {
      this.drillHold -= this.frameDt;
      // At rest the drill tucks toward the pod's facing side, not down.
      if (this.drillHold <= 0) this.drillTargetAngle = -p.facing * (Math.PI / 2);
    }
    this.drillAngle +=
      (this.drillTargetAngle - this.drillAngle) * (1 - Math.exp(-14 * this.frameDt));

    // Mount point sweeps from bottom-center around to the side with the angle.
    const swing = this.drillAngle / (Math.PI / 2); // -1 right … 0 down … 1 left
    const mx = swing >= 0 ? lerp(w / 2, 3, swing) : lerp(w / 2, w - 3, -swing);
    const my = lerp(h - 6, h * 0.66, Math.abs(swing));
    const spinning = digging || this.drillHold > 0;
    this.drawDrill(ctx, sx + mx, sy + my, this.drillAngle, spinning, game.upgrades.drill);

    // Back-mounted attachments (drawn behind the body): the tank and cargo
    // upgrades are visible gear that grows with tier.
    const u = game.upgrades;
    const backRight = p.facing === -1; // attachments ride on the trailing side
    if (u.tank > 0) {
      const tw = 4 + u.tank * 2;
      const th = 6 + u.tank * 2;
      const tx = backRight ? sx + w - tw + 2 : sx - 2;
      ctx.fillStyle = "#c9a227";
      ctx.beginPath();
      ctx.roundRect(tx, sy - th + 4, tw, th, 2);
      ctx.fill();
      ctx.fillStyle = "#8a6f1a";
      ctx.fillRect(tx, sy - th + 7, tw, 2);
      ctx.fillStyle = "#3a3a44";
      ctx.fillRect(tx + tw / 2 - 1.5, sy - th + 2, 3, 3);
    }
    if (u.cargo > 0) {
      const cw = 3 + u.cargo * 2;
      const ch = 10 + u.cargo * 2;
      const cx0 = backRight ? sx + w - 2 : sx + 2 - cw;
      const cy0 = sy + h - 8 - ch;
      ctx.fillStyle = "#6b5a3a";
      ctx.beginPath();
      ctx.roundRect(cx0, cy0, cw, ch, 2);
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(cx0, cy0 + 3, cw, 1.5);
      ctx.fillRect(cx0, cy0 + ch - 5, cw, 1.5);
    }

    // Tracks: dark base with wheels.
    ctx.fillStyle = "#23232a";
    ctx.beginPath();
    ctx.roundRect(sx, sy + h - 7, w, 7, 3);
    ctx.fill();
    ctx.fillStyle = "#4a4a55";
    for (const wx of [0.2, 0.5, 0.8]) {
      ctx.beginPath();
      ctx.arc(sx + w * wx, sy + h - 3.5, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Body shell: the hull tier reskins the pod.
    // tin (red) → steel (armor band) → titanium (silver plate) → nanoweave (dark, glowing seams)
    const hullTier = u.hull;
    const shellTop = ["#e05838", "#e05838", "#c9ccd4", "#3a4050"][hullTier]!;
    const shellBottom = ["#93291a", "#93291a", "#7c828e", "#181b24"][hullTier]!;
    const body = ctx.createLinearGradient(0, sy, 0, sy + h - 6);
    body.addColorStop(0, shellTop);
    body.addColorStop(1, shellBottom);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.roundRect(sx + 1, sy, w - 2, h - 6, [8, 8, 3, 3]);
    ctx.fill();

    if (hullTier === 3) {
      // Nanoweave: glowing edge and seam.
      ctx.strokeStyle = "#5ff0d8";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(sx + 1.5, sy + 0.5, w - 3, h - 7, [8, 8, 3, 3]);
      ctx.stroke();
      ctx.strokeStyle = "rgba(95,240,216,0.45)";
      ctx.beginPath();
      ctx.moveTo(sx + 4, sy + h * 0.55);
      ctx.lineTo(sx + w - 4, sy + h * 0.55);
      ctx.stroke();
    } else if (hullTier >= 1) {
      // Steel / titanium: riveted armor band across the lower shell.
      ctx.fillStyle = hullTier === 2 ? "#5a606c" : "#8a8f98";
      ctx.beginPath();
      ctx.roundRect(sx + 2, sy + h * 0.56, w - 4, 5, 2);
      ctx.fill();
      ctx.fillStyle = hullTier === 2 ? "#2b2f38" : "#3a3f47";
      for (const rx of [0.25, 0.5, 0.75]) {
        ctx.fillRect(sx + w * rx - 1, sy + h * 0.56 + 1.6, 2, 2);
      }
      if (hullTier === 2) {
        // Titanium: red nose accent keeps the pod's identity.
        ctx.fillStyle = "#c23b22";
        ctx.beginPath();
        ctx.roundRect(sx + (p.facing === 1 ? w - 9 : 3), sy + 2, 6, 5, 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.roundRect(sx + 3, sy + 2, w - 6, 4, 3);
    ctx.fill();

    // Cockpit glass, offset toward facing.
    const cx = sx + w / 2 + p.facing * 4;
    const cy = sy + h * 0.38;
    ctx.fillStyle = "#0e2434";
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#9fd8f0";
    ctx.beginPath();
    ctx.arc(cx, cy, 4.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(cx - 1.5, cy - 1.5, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * A proper drill bit: dark housing, metallic cone with thread bands that
   * scroll while digging. Drawn pointing +y (down) at the origin, rotated
   * into place for side digs.
   */
  private drawDrill(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
    digging: boolean,
    tier: number,
  ): void {
    // Per-tier material: rusty → bronze → carbide → diamond.
    const style = [
      { light: "#c89878", mid: "#8a6a50", dark: "#5a4030", extra: 0 },
      { light: "#f0c080", mid: "#c9762e", dark: "#7c4515", extra: 2 },
      { light: "#e6eaf0", mid: "#878d99", dark: "#3d414b", extra: 3 },
      { light: "#ffffff", mid: "#a8f0ea", dark: "#4faca4", extra: 5 },
    ][tier]!;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    if (digging) ctx.translate((Math.random() - 0.5) * 1.6, Math.random() * 1.4);

    // Housing collar.
    ctx.fillStyle = "#33333c";
    ctx.beginPath();
    ctx.roundRect(-7, 0, 14, 5, 2);
    ctx.fill();

    // Cone: longer and shinier at higher tiers.
    const len = (digging ? 15 : 11) + style.extra;
    const cone = ctx.createLinearGradient(-6, 0, 6, 0);
    cone.addColorStop(0, style.light);
    cone.addColorStop(0.45, style.mid);
    cone.addColorStop(1, style.dark);
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(-6, 4);
    ctx.lineTo(6, 4);
    ctx.lineTo(0, 4 + len);
    ctx.closePath();
    ctx.fill();

    // Thread bands, scrolling when the drill spins.
    ctx.save();
    ctx.clip(); // clip to the cone path above
    ctx.strokeStyle = "rgba(20,20,28,0.55)";
    ctx.lineWidth = 1.4;
    const scroll = digging ? (this.time * 26) % 4 : 0;
    for (let band = -1; band < 5; band++) {
      const by = 4 + band * 4 + scroll;
      const t = clamp((by - 4) / len, 0, 1);
      const half = 6 * (1 - t);
      ctx.beginPath();
      ctx.moveTo(-half, by);
      ctx.lineTo(half, by + 1.5);
      ctx.stroke();
    }
    ctx.restore();

    // Glinting tip while digging; a diamond drill glints all the time.
    if (digging || tier === 3) {
      ctx.fillStyle = tier === 3 ? "rgba(220,255,250,0.95)" : "rgba(255,240,200,0.9)";
      ctx.beginPath();
      ctx.arc(0, 4 + len - 1, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // --- Post ----------------------------------------------------------------

  private applyLighting(ctx: CanvasRenderingContext2D, game: Game, podX: number, podY: number): void {
    const cam = game.camera;
    const centerDepth = (cam.y + cam.viewHeight / 2) / TILE - game.world.surfaceRow;
    const darkness = clamp((centerDepth - DARK_START) / DARK_RAMP, 0, 0.93);
    if (darkness <= 0.01) return;

    const lc = this.lightCanvas;
    if (lc.width !== cam.viewWidth || lc.height !== cam.viewHeight) {
      lc.width = cam.viewWidth;
      lc.height = cam.viewHeight;
    }
    const lctx = lc.getContext("2d")!;
    lctx.globalCompositeOperation = "source-over";
    lctx.clearRect(0, 0, lc.width, lc.height);
    lctx.fillStyle = `rgba(8,3,0,${darkness})`;
    lctx.fillRect(0, 0, lc.width, lc.height);

    // Punch the headlight halo out of the darkness.
    const grad = lctx.createRadialGradient(podX, podY, 24, podX, podY, LIGHT_RADIUS);
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(0.6, "rgba(0,0,0,0.75)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    lctx.globalCompositeOperation = "destination-out";
    lctx.fillStyle = grad;
    lctx.fillRect(podX - LIGHT_RADIUS, podY - LIGHT_RADIUS, LIGHT_RADIUS * 2, LIGHT_RADIUS * 2);

    ctx.drawImage(lc, 0, 0);

    // Warm tint inside the halo so the light feels like a lamp, not a hole.
    const warm = ctx.createRadialGradient(podX, podY, 8, podX, podY, LIGHT_RADIUS * 0.55);
    warm.addColorStop(0, `rgba(255,190,110,${0.1 * darkness})`);
    warm.addColorStop(1, "rgba(255,190,110,0)");
    ctx.fillStyle = warm;
    ctx.fillRect(podX - LIGHT_RADIUS, podY - LIGHT_RADIUS, LIGHT_RADIUS * 2, LIGHT_RADIUS * 2);
  }

  private drawVignette(ctx: CanvasRenderingContext2D, game: Game): void {
    const { viewWidth: vw, viewHeight: vh } = game.camera;
    const grad = ctx.createRadialGradient(
      vw / 2,
      vh / 2,
      Math.min(vw, vh) * 0.45,
      vw / 2,
      vh / 2,
      Math.max(vw, vh) * 0.75,
    );
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.3)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, vw, vh);
  }

  // --- Screens -------------------------------------------------------------

  private drawTitleScreen(ctx: CanvasRenderingContext2D, game: Game): void {
    const { viewWidth, viewHeight } = game.camera;
    ctx.fillStyle = "rgba(10, 6, 3, 0.6)";
    ctx.fillRect(0, 0, viewWidth, viewHeight);

    ctx.textBaseline = "top";
    ctx.font = "bold 56px monospace";
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    center(ctx, "MOTHERLOAD", viewWidth, viewHeight * 0.26 + 4);
    ctx.fillStyle = "#f0c020";
    center(ctx, "MOTHERLOAD", viewWidth, viewHeight * 0.26);
    ctx.fillStyle = "#d8c9b8";
    ctx.font = "15px monospace";
    center(ctx, "dig deep · sell minerals · upgrade · don't run dry", viewWidth, viewHeight * 0.26 + 72);

    const pulse = 0.7 + 0.3 * Math.sin(this.time * 3);
    ctx.fillStyle = `rgba(255,233,122,${pulse})`;
    ctx.font = "17px monospace";
    center(ctx, game.hasSave ? "[Enter] continue" : "[Enter] start digging", viewWidth, viewHeight * 0.55);
    if (game.hasSave) {
      ctx.fillStyle = "#d8c9b8";
      ctx.font = "14px monospace";
      center(ctx, "[N] new game (overwrites the save)", viewWidth, viewHeight * 0.55 + 30);
    }
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "13px monospace";
    center(ctx, "← → fly/dig · ↑ thrust · ↓ drill · E station", viewWidth, viewHeight * 0.55 + 64);
    ctx.font = "14px monospace";
  }

  private drawDeathScreen(ctx: CanvasRenderingContext2D, game: Game): void {
    const { viewWidth, viewHeight } = game.camera;
    ctx.fillStyle = "rgba(10,2,0,0.72)";
    ctx.fillRect(0, 0, viewWidth, viewHeight);
    ctx.textBaseline = "top";
    ctx.fillStyle = "#e04a3a";
    ctx.font = "bold 30px monospace";
    center(ctx, "POD LOST", viewWidth, viewHeight * 0.4);
    ctx.fillStyle = "#ffffff";
    ctx.font = "15px monospace";
    center(ctx, game.deathCause, viewWidth, viewHeight * 0.4 + 46);
    center(ctx, `Salvage fee $${ECONOMY.salvageFee} · cargo lost`, viewWidth, viewHeight * 0.4 + 70);
    ctx.fillStyle = "#ffe97a";
    center(ctx, "[Enter] launch replacement pod", viewWidth, viewHeight * 0.4 + 106);
    ctx.font = "14px monospace";
  }
}

function center(ctx: CanvasRenderingContext2D, text: string, viewWidth: number, y: number): void {
  ctx.fillText(text, (viewWidth - ctx.measureText(text).width) / 2, y);
}
