import { clamp, lerp } from "../engine/math";
import { TILE, VIEW } from "../game/config";
import { cargoUnits } from "../game/economy";
import type { FxEvent, Game } from "../game/game";
import { DYNAMITE, ITEM_ORDER, ITEMS } from "../game/items";
import { hash2d, mulberry32 } from "../game/rng";
import { STATIONS } from "../game/stations";
import { TILE_DEFS, TileId } from "../game/tiles";
import { Hud } from "../ui/hud";
import { viewPrefs } from "./prefs";
import { Sky } from "./sky";
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
  /** Rendered with "lighter" compositing — for anything that emits light. */
  additive: boolean;
}

const MAX_PARTICLES = 400;
const ZOOM = VIEW.zoom;

// Darkness ramps in from this depth (tiles) and saturates over the next DARK_RAMP.
const DARK_START = 4;
const DARK_RAMP = 70;
const LIGHT_RADIUS = 165; // world px; multiplied by ZOOM on screen

// 2.5D view: how far the cavity back plane recedes toward the view centre.
const BACK_SCALE = 0.85;
// Flat-shaded lighting per face orientation (multiplies the tile's base color).
const FACE_LIGHT = { ceiling: 0.34, wall: 0.5, floor: 0.68, lip: 1.2 };

/**
 * All drawing lives here; Game stays logic-only (and node-testable). The
 * renderer owns purely cosmetic state: textures, particles, camera smoothing,
 * shake, flash, and the drill/HUD animations.
 */
export class Renderer {
  private readonly textures: TileTextures;
  /** Flat-shaded face colors, keyed by tile id + light factor. */
  private readonly faceColors = new Map<number, string>();
  private readonly sky = new Sky();
  private readonly hud = new Hud();
  private readonly lightCanvas = document.createElement("canvas");
  // Baked overlays: soft tunnel shadows per exposed side, sunlit crust, glows.
  private readonly shadeTop = bakeEdge(0, -1);
  private readonly shadeBottom = bakeEdge(0, 1);
  private readonly shadeLeft = bakeEdge(-1, 0);
  private readonly shadeRight = bakeEdge(1, 0);
  private readonly crust = bakeCrust();
  private readonly lavaGlow = bakeGlow(96, 255, 120, 30);
  private readonly warmGlow = bakeGlow(48, 255, 210, 130);
  private readonly anomalyGlow = bakeGlow(128, 120, 235, 255);
  private readonly motes: { ox: number; oy: number; phase: number }[] = [];

  private particles: Particle[] = [];
  private shake = 0;
  private flash = 0;
  private darkness = 0;
  private time = 0;
  private frameDt = 0;
  private lastNow = performance.now();
  // Smoothed camera with velocity look-ahead.
  private camReady = false;
  private camX = 0;
  private camY = 0;
  // Drill orientation is sticky: it holds its last dig direction briefly and
  // swings between orientations instead of snapping, so chained side-digs
  // (dig → roll to next wall → dig) don't flicker the drill down and back.
  private drillAngle = 0;
  private drillTargetAngle = 0;
  private drillHold = 0;
  // Drill "bite" feedback: a recoil impulse that pops on break, and the last
  // dig direction so the recoil kicks the pod back out of the hole it cleared.
  private drillRecoil = 0;
  private lastDigDX = 0;
  private lastDigDY = 1;
  // Screen transitions: a black fade that eases out on arrival in the world,
  // and a timer that paces the death screen's reveal instead of popping it.
  private prevState = "";
  private fade = 0;
  private deathT = 0;

  constructor() {
    this.textures = makeTileTextures();
    const rand = mulberry32(77);
    for (let i = 0; i < 22; i++) {
      this.motes.push({ ox: rand() * 2 - 1, oy: rand() * 2 - 1, phase: rand() * Math.PI * 2 });
    }
  }

  render(ctx: CanvasRenderingContext2D, game: Game, alpha: number): void {
    const now = performance.now();
    const dt = clamp((now - this.lastNow) / 1000, 0, 0.05);
    this.lastNow = now;
    this.time += dt;
    this.frameDt = dt;

    // Fade up from black when arriving in the world (new game or respawn) so
    // the cut into play isn't abrupt; time the death screen's reveal.
    if (this.prevState !== game.state) {
      if (game.state === "playing" && (this.prevState === "title" || this.prevState === "dead")) {
        this.fade = 1;
      }
      this.deathT = 0;
      this.prevState = game.state;
    }
    this.fade = Math.max(0, this.fade - dt * 3);
    if (game.state === "dead") this.deathT += dt;

    const cam = game.camera;
    const p = game.player;
    const px = lerp(p.prevX, p.x, alpha);
    const py = lerp(p.prevY, p.y, alpha);

    // The world renders magnified; the camera works in world units sized to
    // the zoomed viewport. HUD and post effects stay at native resolution.
    const screenW = ctx.canvas.clientWidth;
    const screenH = ctx.canvas.clientHeight;
    cam.resize(screenW / ZOOM, screenH / ZOOM);

    // Camera: aim ahead of the pod's velocity, then ease toward the target.
    let lookX = clamp(p.vx * 0.3, -80, 80);
    let lookY = clamp(p.vy * 0.22, -45, 70);
    // While drilling, lead the camera past the tile being cut so you see what
    // you're about to break into (ore or lava) instead of digging blind — the
    // pod is grounded and still, so velocity look-ahead alone reveals nothing.
    if (p.hasDigTarget && game.state === "playing") {
      const podCol = Math.floor((p.x + p.width / 2) / TILE);
      const podRow = Math.floor((p.y + p.height / 2) / TILE);
      if (p.digTargetY > podRow) lookY = Math.max(lookY, 58);
      else if (p.digTargetX < podCol) lookX = Math.min(lookX, -56);
      else if (p.digTargetX > podCol) lookX = Math.max(lookX, 56);
    }
    cam.follow(
      px + p.width / 2 + lookX,
      py + p.height / 2 + lookY,
      game.world.pixelWidth,
      game.world.pixelHeight,
    );
    if (!this.camReady) {
      this.camX = cam.x;
      this.camY = cam.y;
      this.camReady = true;
    }
    const camEase = 1 - Math.exp(-5.5 * dt);
    this.camX += (cam.x - this.camX) * camEase;
    this.camY += (cam.y - this.camY) * camEase;
    cam.x = this.camX;
    cam.y = this.camY;

    this.consumeFx(game.fxEvents);
    this.emitContinuousFx(game, px, py);
    this.updateParticles(dt);
    // Tremor while the drill bites, building as the tile is about to give so
    // the break has something to release. Decaying shake and recoil otherwise.
    if (p.hasDigTarget && game.state === "playing") {
      this.shake = Math.max(this.shake, 0.06 + clamp(p.digProgress, 0, 1) * 0.14);
    }
    this.shake = Math.max(0, this.shake - dt * 1.6);
    this.drillRecoil = Math.max(0, this.drillRecoil - dt * 7);
    this.flash = Math.max(0, this.flash - dt * 2.2);

    const shakeMag = this.shake * this.shake * 22;
    ctx.save();
    ctx.scale(ZOOM, ZOOM);
    ctx.translate((Math.random() - 0.5) * shakeMag, (Math.random() - 0.5) * shakeMag);
    this.sky.draw(ctx, cam, game.world.surfaceRow * TILE, this.time);
    this.drawTiles(ctx, game);
    this.drawStations(ctx, game);
    this.drawFuse(ctx, game, cam.x, cam.y);
    this.drawPod(ctx, game, px - cam.x, py - cam.y);
    this.drawParticles(ctx, game);
    this.drawMotes(ctx, px - cam.x + p.width / 2, py - cam.y + p.height / 2);
    ctx.restore();

    const podScreenX = (px - cam.x + p.width / 2) * ZOOM;
    const podScreenY = (py - cam.y + p.height / 2) * ZOOM;
    this.applyLighting(ctx, game, podScreenX, podScreenY, screenW, screenH);
    this.drawVignette(ctx, screenW, screenH);
    if (this.flash > 0) this.drawFlash(ctx, screenW, screenH);

    if (game.state === "title") {
      this.drawTitleScreen(ctx, game);
      return;
    }
    this.hud.draw(
      ctx,
      {
        depth: game.depth,
        fuel: p.fuel,
        maxFuel: p.maxFuel,
        hull: p.hull,
        maxHull: p.maxHull,
        money: game.money,
        cargoUnits: cargoUnits(p.cargo),
        cargoCapacity: p.cargoCapacity,
        hint: game.stationHint(),
        onboarding: game.onboardingHint(),
        objective: game.objective(),
        toast: game.toast,
        dev: game.devMode,
        items: ITEM_ORDER.map((id, i) => ({
          key: `${i + 1}`,
          tag: ITEMS[id].tag,
          count: p.items[id],
        })),
      },
      dt,
    );
    if (game.state === "dead") this.drawDeathScreen(ctx, game, this.deathT);
    if (game.state === "won") this.drawWinScreen(ctx, game);

    // Arrival fade, over everything including the HUD.
    if (this.fade > 0) {
      ctx.fillStyle = `rgba(6,4,10,${this.fade.toFixed(3)})`;
      ctx.fillRect(0, 0, screenW, screenH);
    }
  }

  // --- Effects -------------------------------------------------------------

  private consumeFx(events: FxEvent[]): void {
    for (const e of events) {
      if (e.kind === "dug") {
        // The tile gives way: debris burst plus a short pop of shake and a
        // recoil kick so breaking through feels like contact, not a timer.
        this.burst(e.x, e.y, 13, e.color ?? "#8a4a2a", 120, 700, false);
        this.burst(e.x, e.y, 4, "#ffd9a0", 70, 400, true); // grit sparks
        this.shake = Math.max(this.shake, 0.28);
        this.drillRecoil = 1;
      } else if (e.kind === "impact") {
        this.burst(e.x, e.y, 14, "#a4643c", 130, 300, false);
        this.shake = Math.max(this.shake, clamp((e.power ?? 0) / 60, 0.25, 0.6));
        this.flash = Math.max(this.flash, 0.45);
      } else if (e.kind === "explosion") {
        this.burst(e.x, e.y, 26, "#ff9d2e", 220, 200, true);
        this.burst(e.x, e.y, 12, "#ffe97a", 160, 100, true);
        this.shake = Math.max(this.shake, 0.6);
        this.flash = Math.max(this.flash, 0.8);
      } else if (e.kind === "upgrade") {
        this.burst(e.x, e.y, 20, "#ffe97a", 140, -40, true);
        this.burst(e.x, e.y, 8, "#ffffff", 90, -40, true);
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
        color: Math.random() > 0.45 ? "#8a8078" : "#ff9d2e",
        gravity: -60,
        additive: Math.random() > 0.6,
      });
    }
    // Grind debris from the contact point, thickening as the bite deepens.
    const bite = clamp(p.digProgress, 0, 1);
    if (p.hasDigTarget && Math.random() < 0.4 + bite * 0.45) {
      const sparky = Math.random() > 0.7 - bite * 0.25; // more sparks near break
      this.spawn({
        x: p.digTargetX * TILE + TILE / 2 + (Math.random() - 0.5) * 16,
        y: p.digTargetY * TILE + TILE / 2 + (Math.random() - 0.5) * 16,
        vx: (Math.random() - 0.5) * 90,
        vy: -40 - Math.random() * 60,
        life: 0.4,
        maxLife: 0.4,
        size: sparky ? 1.2 : 1.5 + Math.random() * 1.5,
        color: sparky ? "#ffd080" : "#a4643c",
        gravity: 500,
        additive: sparky,
      });
    }
  }

  private burst(
    x: number,
    y: number,
    count: number,
    color: string,
    speed: number,
    gravity: number,
    additive: boolean,
  ): void {
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
        additive,
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
    for (const pass of [false, true] as const) {
      if (pass) ctx.globalCompositeOperation = "lighter";
      for (const p of this.particles) {
        if (p.additive !== pass) continue;
        ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - cam.x - p.size / 2, p.y - cam.y - p.size / 2, p.size, p.size);
      }
      if (pass) ctx.globalCompositeOperation = "source-over";
    }
    ctx.globalAlpha = 1;
  }

  /** The objective beacon: a pulsing faceted crystal with an additive halo. */
  private drawAnomaly(ctx: CanvasRenderingContext2D, sx: number, sy: number): void {
    const cx = sx + TILE / 2;
    const cy = sy + TILE / 2;
    const pulse = 0.6 + 0.4 * Math.sin(this.time * 2.2);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.5 + pulse * 0.4;
    ctx.drawImage(this.anomalyGlow, cx - 64, cy - 64);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    const h = 13;
    const w = 9;
    ctx.fillStyle = "#bff6ff";
    ctx.beginPath();
    ctx.moveTo(cx, cy - h);
    ctx.lineTo(cx + w, cy);
    ctx.lineTo(cx, cy + h);
    ctx.lineTo(cx - w, cy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#5fd6ff";
    ctx.beginPath();
    ctx.moveTo(cx, cy - h);
    ctx.lineTo(cx + w, cy);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgba(255,255,255,${(0.4 + pulse * 0.5).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(cx, cy - 1, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }

  // --- World ---------------------------------------------------------------

  private drawTiles(ctx: CanvasRenderingContext2D, game: Game): void {
    const cam = game.camera;
    const world = game.world;
    const x0 = Math.max(0, Math.floor(cam.x / TILE));
    const y0 = Math.max(0, Math.floor(cam.y / TILE));
    const x1 = Math.min(world.width - 1, Math.floor((cam.x + cam.viewWidth) / TILE));
    const y1 = Math.min(world.height - 1, Math.floor((cam.y + cam.viewHeight) / TILE));

    if (viewPrefs.depth) this.drawDepthPass(ctx, game);

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const tile = world.getTile(tx, ty);
        if (tile === TileId.Sky) continue;
        if (tile === TileId.Empty && viewPrefs.depth) continue; // cavity drawn by the depth pass
        const sx = tx * TILE - cam.x;
        const sy = ty * TILE - cam.y;

        if (tile === TileId.Anomaly) {
          this.drawAnomaly(ctx, sx, sy);
          continue;
        }

        const variants = this.textures.get(tile);
        if (variants) {
          const v = Math.floor(hash2d(tx, ty, 7) * TILE_VARIANTS) % TILE_VARIANTS;
          // Half-pixel bleed hides antialiasing seams at fractional zoom offsets.
          ctx.drawImage(variants[v]!, sx, sy, TILE + 0.5, TILE + 0.5);
        }

        if (tile === TileId.Empty) {
          // Soft ambient occlusion: baked gradient shadow on each walled side.
          if (world.isSolid(tx, ty - 1)) ctx.drawImage(this.shadeTop, sx, sy);
          if (world.isSolid(tx, ty + 1)) ctx.drawImage(this.shadeBottom, sx, sy);
          if (world.isSolid(tx - 1, ty)) ctx.drawImage(this.shadeLeft, sx, sy);
          if (world.isSolid(tx + 1, ty)) ctx.drawImage(this.shadeRight, sx, sy);
          continue;
        }

        // Sunlit crust on any solid tile exposed from above.
        if (!world.isSolid(tx, ty - 1)) ctx.drawImage(this.crust, sx, sy);

        if (tile === TileId.Lava) {
          const pulse = 0.55 + 0.35 * Math.sin(this.time * 2.5 + hash2d(tx, ty, 3) * 6);
          ctx.globalCompositeOperation = "lighter";
          ctx.globalAlpha = pulse;
          ctx.drawImage(this.lavaGlow, sx + TILE / 2 - 48, sy + TILE / 2 - 48);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = "source-over";
        } else if (TILE_DEFS[tile].value > 0) {
          // Occasional glint so ore catches the eye.
          const cycle = (this.time * 0.5 + hash2d(tx, ty, 11) * 7) % 7;
          if (cycle < 0.5) {
            const a = Math.sin((cycle / 0.5) * Math.PI);
            const gx = sx + 8 + hash2d(tx, ty, 13) * 16;
            const gy = sy + 8 + hash2d(tx, ty, 17) * 16;
            ctx.globalCompositeOperation = "lighter";
            ctx.strokeStyle = `rgba(255,255,255,${(a * 0.85).toFixed(3)})`;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(gx - 4, gy);
            ctx.lineTo(gx + 4, gy);
            ctx.moveTo(gx, gy - 4);
            ctx.lineTo(gx, gy + 4);
            ctx.stroke();
            ctx.globalCompositeOperation = "source-over";
          }
        }
      }
    }

    // Active dig target: cracks spread, then the hole opens.
    const p = game.player;
    if (p.hasDigTarget) {
      const sx = p.digTargetX * TILE - cam.x;
      const sy = p.digTargetY * TILE - cam.y;
      const rand = mulberry32((p.digTargetX * 7919) ^ (p.digTargetY * 104729));
      const cracks = 1 + Math.floor(clamp(p.digProgress, 0, 1) * 3);
      ctx.strokeStyle = "rgba(12,5,0,0.6)";
      ctx.lineWidth = 1.4;
      for (let i = 0; i < cracks; i++) {
        let cx = sx + 10 + rand() * 12;
        let cy = sy + 10 + rand() * 12;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        for (let s = 0; s < 3; s++) {
          cx += (rand() - 0.5) * 16;
          cy += (rand() - 0.5) * 16;
          ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = clamp(p.digProgress * p.digProgress, 0, 1);
      ctx.drawImage(this.textures.get(TileId.Empty)![0]!, sx, sy, TILE, TILE);
      ctx.globalAlpha = 1;

      // Molten flare where the drill bites.
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.5 + Math.random() * 0.4;
      ctx.drawImage(this.warmGlow, sx + TILE / 2 - 14, sy + TILE / 2 - 14, 28, 28);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
  }

  /**
   * Pseudo-3D pass: cavity back walls and extruded wall faces, all projected
   * toward the view centre so the scene shares one vanishing point. Runs
   * before the front-face pass, whose opaque tile blits clip any perspective
   * spill from off-centre faces — no visibility tests needed.
   */
  private drawDepthPass(ctx: CanvasRenderingContext2D, game: Game): void {
    const cam = game.camera;
    const world = game.world;
    // Off-screen tiles can spill faces into view near the screen edges.
    const pad = 3;
    const x0 = Math.max(0, Math.floor(cam.x / TILE) - pad);
    const y0 = Math.max(0, Math.floor(cam.y / TILE) - pad);
    const x1 = Math.min(world.width - 1, Math.floor((cam.x + cam.viewWidth) / TILE) + pad);
    const y1 = Math.min(world.height - 1, Math.floor((cam.y + cam.viewHeight) / TILE) + pad);
    const vx = cam.viewWidth / 2;
    const vy = cam.viewHeight / 2;
    const px = (x: number): number => vx + (x - vx) * BACK_SCALE;
    const py = (y: number): number => vy + (y - vy) * BACK_SCALE;

    // Back walls first: they sit deepest. Projected rects of adjacent tiles
    // stay adjacent (the projection is a similarity), so textures still tile.
    const backVariants = this.textures.get(TileId.Empty)!;
    const backSize = TILE * BACK_SCALE + 0.5;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (world.getTile(tx, ty) !== TileId.Empty) continue;
        const v = Math.floor(hash2d(tx, ty, 7) * TILE_VARIANTS) % TILE_VARIANTS;
        ctx.drawImage(backVariants[v]!, px(tx * TILE - cam.x), py(ty * TILE - cam.y), backSize, backSize);
      }
    }

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const tile = world.getTile(tx, ty);
        const sx = tx * TILE - cam.x;
        const sy = ty * TILE - cam.y;
        if (tile === TileId.Empty) {
          const up = world.getTile(tx, ty - 1);
          const down = world.getTile(tx, ty + 1);
          const left = world.getTile(tx - 1, ty);
          const right = world.getTile(tx + 1, ty);
          if (TILE_DEFS[up].solid) this.face(ctx, sx, sy, sx + TILE, sy, up, FACE_LIGHT.ceiling, px, py);
          if (TILE_DEFS[down].solid) this.face(ctx, sx, sy + TILE, sx + TILE, sy + TILE, down, FACE_LIGHT.floor, px, py);
          if (TILE_DEFS[left].solid) this.face(ctx, sx, sy, sx, sy + TILE, left, FACE_LIGHT.wall, px, py);
          if (TILE_DEFS[right].solid) this.face(ctx, sx + TILE, sy, sx + TILE, sy + TILE, right, FACE_LIGHT.wall, px, py);
        } else if (TILE_DEFS[tile].solid && world.getTile(tx, ty - 1) === TileId.Sky) {
          // Sunlit lip along the surface — the terrain's visible top face.
          this.face(ctx, sx, sy, sx + TILE, sy, tile, FACE_LIGHT.lip, px, py);
        }
      }
    }
  }

  /** One extruded face: front edge (ax,ay)→(bx,by) swept to the back plane. */
  private face(
    ctx: CanvasRenderingContext2D,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    tile: TileId,
    light: number,
    px: (x: number) => number,
    py: (y: number) => number,
  ): void {
    const key = tile * 10 + light;
    let color = this.faceColors.get(key);
    if (!color) {
      color = shade(TILE_DEFS[tile].color, light);
      this.faceColors.set(key, color);
    }
    ctx.fillStyle = color;
    ctx.strokeStyle = color; // stroking the same path fills antialiasing seams
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(px(bx), py(by));
    ctx.lineTo(px(ax), py(ay));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private drawStations(ctx: CanvasRenderingContext2D, game: Game): void {
    const cam = game.camera;
    const groundY = game.world.surfaceRow * TILE;
    ctx.textBaseline = "top";
    for (const s of STATIONS) {
      const sx = s.x0 * TILE - cam.x;
      const w = (s.x1 - s.x0 + 1) * TILE;
      const h = TILE * 3;
      const sy = groundY - h - cam.y;
      if (sx + w < -80 || sx > cam.viewWidth + 80) continue;

      // Foundation slab.
      ctx.fillStyle = "#2b2723";
      ctx.beginPath();
      ctx.roundRect(sx - 6, groundY - cam.y - 4, w + 12, 5, 2);
      ctx.fill();

      // Body with vertical shading and an outline for pop.
      const body = ctx.createLinearGradient(0, sy, 0, sy + h);
      body.addColorStop(0, shade(s.color, 1.2));
      body.addColorStop(0.7, s.color);
      body.addColorStop(1, shade(s.color, 0.62));
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.roundRect(sx, sy + 10, w, h - 10, [6, 6, 0, 0]);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Panel seams.
      ctx.strokeStyle = "rgba(0,0,0,0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx + w / 3, sy + 12);
      ctx.lineTo(sx + w / 3, sy + h - 2);
      ctx.moveTo(sx + (2 * w) / 3, sy + 12);
      ctx.lineTo(sx + (2 * w) / 3, sy + h - 2);
      ctx.stroke();

      // Roof with overhang, plus an antenna with a blinking beacon.
      ctx.fillStyle = shade(s.color, 0.45);
      ctx.beginPath();
      ctx.moveTo(sx - 6, sy + 12);
      ctx.lineTo(sx + 7, sy);
      ctx.lineTo(sx + w - 7, sy);
      ctx.lineTo(sx + w + 6, sy + 12);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#55524e";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx + w - 14, sy);
      ctx.lineTo(sx + w - 14, sy - 12);
      ctx.stroke();
      const blink = (Math.sin(this.time * 2.4 + s.x0) + 1) / 2;
      ctx.fillStyle = `rgba(255,80,60,${0.35 + blink * 0.65})`;
      ctx.beginPath();
      ctx.arc(sx + w - 14, sy - 13, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = blink * 0.5;
      ctx.drawImage(this.warmGlow, sx + w - 14 - 10, sy - 13 - 10, 20, 20);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      // Door with a lit transom, and a glowing window.
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.beginPath();
      ctx.roundRect(sx + w / 2 - 9, sy + h - 26, 18, 26, [3, 3, 0, 0]);
      ctx.fill();
      ctx.fillStyle = "#ffe9a0";
      ctx.fillRect(sx + w / 2 - 7, sy + h - 24, 14, 3);
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.5 + 0.08 * Math.sin(this.time * 1.7 + sx);
      ctx.drawImage(this.warmGlow, sx + 16 - 20, sy + 27 - 20, 40, 40);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#ffe9a0";
      ctx.beginPath();
      ctx.roundRect(sx + 10, sy + 22, 12, 10, 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 10, sy + 22, 12, 10);

      // Illuminated sign board.
      ctx.fillStyle = "rgba(8,7,6,0.85)";
      ctx.beginPath();
      ctx.roundRect(sx + 3, sy + h - 48, w - 6, 16, 4);
      ctx.fill();
      ctx.font = "bold 9px monospace";
      const glowColor = shade(s.color, 1.9);
      ctx.save();
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 7;
      ctx.fillStyle = glowColor;
      const tw = ctx.measureText(s.label).width;
      ctx.fillText(s.label, sx + (w - tw) / 2, sy + h - 44);
      ctx.restore();

      // Per-shop props.
      if (s.id === "fuel") {
        // Pump bollard with a hose looping to the wall.
        ctx.fillStyle = "#8a2f22";
        ctx.beginPath();
        ctx.roundRect(sx - 16, groundY - cam.y - 18, 9, 15, 2);
        ctx.fill();
        ctx.fillStyle = "#ffe9a0";
        ctx.fillRect(sx - 14, groundY - cam.y - 15, 5, 4);
        ctx.strokeStyle = "#23211e";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx - 9, groundY - cam.y - 12);
        ctx.quadraticCurveTo(sx - 2, groundY - cam.y - 26, sx + 3, sy + h - 14);
        ctx.stroke();
      } else if (s.id === "trader") {
        // Ore bin with a visible haul.
        ctx.fillStyle = "#3d3a36";
        ctx.beginPath();
        ctx.moveTo(sx + w + 4, groundY - cam.y - 4);
        ctx.lineTo(sx + w + 7, groundY - cam.y - 18);
        ctx.lineTo(sx + w + 25, groundY - cam.y - 18);
        ctx.lineTo(sx + w + 28, groundY - cam.y - 4);
        ctx.closePath();
        ctx.fill();
        for (const [ox, oc] of [
          [10, "#f0c020"],
          [16, "#c9ccd4"],
          [21, "#b3703a"],
        ] as const) {
          ctx.fillStyle = oc;
          ctx.beginPath();
          ctx.arc(sx + w + ox, groundY - cam.y - 17, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Upgrade shop: gear emblem on the wall.
        const gx = sx + w - 15;
        const gy = sy + 26;
        ctx.fillStyle = shade(s.color, 0.45);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + this.time * 0.4;
          ctx.beginPath();
          ctx.arc(gx + Math.cos(a) * 7, gy + Math.sin(a) * 7, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(gx, gy, 6.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = shade(s.color, 1.5);
        ctx.beginPath();
        ctx.arc(gx, gy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.font = "14px monospace";
  }

  /** Armed dynamite: a stick on the tile plus a blast-radius ring, flashing faster as the fuse burns. */
  private drawFuse(ctx: CanvasRenderingContext2D, game: Game, camX: number, camY: number): void {
    const fuse = game.fuse;
    if (!fuse) return;
    const cx = fuse.x * TILE + TILE / 2 - camX;
    const cy = fuse.y * TILE + TILE / 2 - camY;
    const urgency = 1 - fuse.timeLeft / DYNAMITE.fuseSeconds;
    const blink = 0.5 + 0.5 * Math.sin(this.time * (10 + urgency * 30));

    ctx.save();
    ctx.globalAlpha = 0.25 + blink * 0.2;
    ctx.strokeStyle = "#ff5a1f";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, DYNAMITE.radius * TILE, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#b02318";
    ctx.fillRect(cx - 5, cy - 2, 10, 7);
    ctx.fillStyle = `rgba(255,233,122,${0.4 + blink * 0.6})`;
    ctx.beginPath();
    ctx.arc(cx + 4, cy - 4, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawPod(ctx: CanvasRenderingContext2D, game: Game, sx: number, sy: number): void {
    const p = game.player;
    const w = p.width;
    const h = p.height;

    // Drill "bite" nudge: lean the whole rig into the tile as pressure builds
    // and buzz with the grind; the recoil (set on break) then kicks it back out
    // of the hole, so drilling reads as contact rather than a silent timer.
    if (p.hasDigTarget) {
      const podCol = Math.floor((p.x + w / 2) / TILE);
      const podRow = Math.floor((p.y + h / 2) / TILE);
      this.lastDigDX = p.digTargetY > podRow ? 0 : p.digTargetX < podCol ? -1 : p.digTargetX > podCol ? 1 : 0;
      this.lastDigDY = p.digTargetY > podRow ? 1 : 0;
      const bite = clamp(p.digProgress, 0, 1);
      const lean = 1 + bite * 2;
      const buzz = (0.5 + bite) * 1.3;
      sx += this.lastDigDX * lean + (Math.random() - 0.5) * buzz;
      sy += this.lastDigDY * lean + (Math.random() - 0.5) * buzz;
    }
    if (this.drillRecoil > 0) {
      const kick = this.drillRecoil * 3;
      sx -= this.lastDigDX * kick;
      sy -= this.lastDigDY * kick;
    }

    // Thruster flame: layered, flickering, glowing.
    if (game.isThrusting && game.state === "playing") {
      const len = 11 + Math.random() * 6;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.8;
      ctx.drawImage(this.warmGlow, sx + w / 2 - 24, sy + h + 2 - 24);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
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
    if (hullTier !== 3) {
      // Dark outline for game-art readability (nanoweave gets a glow instead).
      ctx.strokeStyle = "rgba(15,5,2,0.45)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    // Panel seam + bolts.
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx + w * 0.5 - p.facing * 6, sy + 3);
    ctx.lineTo(sx + w * 0.5 - p.facing * 6, sy + h - 8);
    ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(sx + 4, sy + h * 0.32, 1.6, 1.6);
    ctx.fillRect(sx + w - 6, sy + h * 0.32, 1.6, 1.6);

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

    // Headlamp on the leading edge, glowing once it's dark enough to matter.
    const lampX = sx + (p.facing === 1 ? w - 2 : 2);
    const lampY = sy + h * 0.3;
    ctx.fillStyle = "#e8e4d8";
    ctx.beginPath();
    ctx.roundRect(lampX - 2, lampY - 2, 4, 4, 1.5);
    ctx.fill();
    if (this.darkness > 0.12) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.55 * this.darkness;
      ctx.drawImage(this.warmGlow, lampX - 16, lampY - 16, 32, 32);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
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

  private applyLighting(
    ctx: CanvasRenderingContext2D,
    game: Game,
    podX: number,
    podY: number,
    screenW: number,
    screenH: number,
  ): void {
    const cam = game.camera;
    const centerDepth = (cam.y + cam.viewHeight / 2) / TILE - game.world.surfaceRow;
    this.darkness = clamp((centerDepth - DARK_START) / DARK_RAMP, 0, 0.93);
    if (this.darkness <= 0.01) return;

    const radius = LIGHT_RADIUS * ZOOM;
    const lc = this.lightCanvas;
    if (lc.width !== screenW || lc.height !== screenH) {
      lc.width = screenW;
      lc.height = screenH;
    }
    const lctx = lc.getContext("2d")!;
    lctx.globalCompositeOperation = "source-over";
    lctx.clearRect(0, 0, screenW, screenH);
    lctx.fillStyle = `rgba(8,3,0,${this.darkness})`;
    lctx.fillRect(0, 0, screenW, screenH);

    // Punch the headlight halo out of the darkness.
    const grad = lctx.createRadialGradient(podX, podY, 24, podX, podY, radius);
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(0.6, "rgba(0,0,0,0.75)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    lctx.globalCompositeOperation = "destination-out";
    lctx.fillStyle = grad;
    lctx.fillRect(podX - radius, podY - radius, radius * 2, radius * 2);

    // The anomaly lights its own chamber — a second hole in the darkness.
    const anom = game.world.anomaly;
    let ax = 0;
    let ay = 0;
    let ar = 0;
    let anomLit = false;
    if (anom) {
      ax = (anom.x * TILE + TILE / 2 - cam.x) * ZOOM;
      ay = (anom.y * TILE + TILE / 2 - cam.y) * ZOOM;
      ar = radius * (0.85 + 0.15 * Math.sin(this.time * 2));
      if (ax > -ar && ax < screenW + ar && ay > -ar && ay < screenH + ar) {
        anomLit = true;
        const ag = lctx.createRadialGradient(ax, ay, 16, ax, ay, ar);
        ag.addColorStop(0, "rgba(0,0,0,0.92)");
        ag.addColorStop(0.6, "rgba(0,0,0,0.55)");
        ag.addColorStop(1, "rgba(0,0,0,0)");
        lctx.fillStyle = ag;
        lctx.fillRect(ax - ar, ay - ar, ar * 2, ar * 2);
      }
    }

    ctx.drawImage(lc, 0, 0);

    // Warm tint inside the halo so the light feels like a lamp, not a hole.
    const warm = ctx.createRadialGradient(podX, podY, 8, podX, podY, radius * 0.55);
    warm.addColorStop(0, `rgba(255,190,110,${0.1 * this.darkness})`);
    warm.addColorStop(1, "rgba(255,190,110,0)");
    ctx.fillStyle = warm;
    ctx.fillRect(podX - radius, podY - radius, radius * 2, radius * 2);

    // Cool cyan wash from the beacon.
    if (anomLit) {
      const cool = ctx.createRadialGradient(ax, ay, 8, ax, ay, ar * 0.6);
      cool.addColorStop(0, `rgba(120,230,255,${(0.16 * this.darkness).toFixed(3)})`);
      cool.addColorStop(1, "rgba(120,230,255,0)");
      ctx.fillStyle = cool;
      ctx.fillRect(ax - ar, ay - ar, ar * 2, ar * 2);
    }
  }

  /** Slow dust motes drifting through the headlight beam. */
  private drawMotes(ctx: CanvasRenderingContext2D, podX: number, podY: number): void {
    if (this.darkness < 0.15) return;
    const r = LIGHT_RADIUS * 0.8;
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "#ffd9a0";
    for (const m of this.motes) {
      const x = podX + m.ox * r + Math.sin(this.time * 0.25 + m.phase) * 14;
      const y = podY + m.oy * r + Math.cos(this.time * 0.2 + m.phase * 1.3) * 11;
      const d = Math.hypot(x - podX, y - podY) / r;
      if (d >= 1) continue;
      ctx.globalAlpha = (1 - d) * 0.3 * this.darkness;
      ctx.fillRect(x, y, 1.6, 1.6);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  private drawVignette(ctx: CanvasRenderingContext2D, vw: number, vh: number): void {
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

  /** Red edge flash on damage. */
  private drawFlash(ctx: CanvasRenderingContext2D, vw: number, vh: number): void {
    const grad = ctx.createRadialGradient(
      vw / 2,
      vh / 2,
      Math.min(vw, vh) * 0.3,
      vw / 2,
      vh / 2,
      Math.max(vw, vh) * 0.72,
    );
    grad.addColorStop(0, "rgba(200,30,10,0)");
    grad.addColorStop(1, `rgba(200,30,10,${(this.flash * 0.42).toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, vw, vh);
  }

  // --- Screens -------------------------------------------------------------

  private drawTitleScreen(ctx: CanvasRenderingContext2D, game: Game): void {
    const viewWidth = ctx.canvas.clientWidth;
    const viewHeight = ctx.canvas.clientHeight;
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

  private drawDeathScreen(ctx: CanvasRenderingContext2D, game: Game, t: number): void {
    const viewWidth = ctx.canvas.clientWidth;
    const viewHeight = ctx.canvas.clientHeight;
    // Reveal over a beat so the loss lands; the prompt waits a moment longer so
    // it isn't mashed past before the player registers what happened.
    const reveal = clamp(t / 0.5, 0, 1);
    const promptIn = clamp((t - 0.7) / 0.4, 0, 1);
    ctx.fillStyle = `rgba(10,2,0,${(0.72 * reveal).toFixed(3)})`;
    ctx.fillRect(0, 0, viewWidth, viewHeight);
    ctx.textBaseline = "top";
    ctx.globalAlpha = reveal;
    ctx.fillStyle = "#e04a3a";
    ctx.font = "bold 30px monospace";
    center(ctx, "POD LOST", viewWidth, viewHeight * 0.4 - (1 - reveal) * 12);
    ctx.fillStyle = "#ffffff";
    ctx.font = "15px monospace";
    center(ctx, game.deathCause, viewWidth, viewHeight * 0.4 + 46);
    center(ctx, `Salvage fee $${game.salvageFeeDue} · cargo and supplies lost`, viewWidth, viewHeight * 0.4 + 70);
    ctx.globalAlpha = promptIn;
    ctx.fillStyle = "#ffe97a";
    center(ctx, "[Enter] launch replacement pod", viewWidth, viewHeight * 0.4 + 106);
    ctx.globalAlpha = 1;
    ctx.font = "14px monospace";
  }

  private drawWinScreen(ctx: CanvasRenderingContext2D, game: Game): void {
    const vw = ctx.canvas.clientWidth;
    const vh = ctx.canvas.clientHeight;
    const s = game.runStats();
    const secs = Math.floor(s.time % 60)
      .toString()
      .padStart(2, "0");
    const time = `${Math.floor(s.time / 60)}:${secs}`;

    ctx.fillStyle = "rgba(4,8,16,0.8)";
    ctx.fillRect(0, 0, vw, vh);
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(142,200,255,0.8)";
    ctx.font = "bold 12px monospace";
    center(ctx, "◈ DEMO COMPLETE", vw, vh * 0.3);
    ctx.fillStyle = "#8ec8ff";
    ctx.font = "bold 32px monospace";
    center(ctx, "ANOMALY REACHED", vw, vh * 0.3 + 24);
    ctx.fillStyle = "#d8e6ff";
    ctx.font = "15px monospace";
    center(ctx, "You've reached the signal at the bottom of the world.", vw, vh * 0.3 + 70);

    ctx.fillStyle = "#ffffff";
    ctx.font = "15px monospace";
    const stats = [
      `Depth reached    ${s.depth} m`,
      `Minerals banked  $${s.money.toLocaleString()}`,
      `Time             ${time}`,
      `Pods lost        ${s.deaths}`,
    ];
    stats.forEach((line, i) => center(ctx, line, vw, vh * 0.3 + 108 + i * 26));

    ctx.fillStyle = "#ffe97a";
    ctx.font = "16px monospace";
    center(ctx, "[Enter] keep exploring", vw, vh * 0.3 + 108 + stats.length * 26 + 24);
    ctx.font = "14px monospace";
  }
}

function center(ctx: CanvasRenderingContext2D, text: string, viewWidth: number, y: number): void {
  ctx.fillText(text, (viewWidth - ctx.measureText(text).width) / 2, y);
}

/** Baked soft shadow along one edge of a tunnel tile. (dx,dy) points at the wall. */
function bakeEdge(dx: number, dy: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext("2d")!;
  const depth = 11;
  const grad =
    dy !== 0
      ? ctx.createLinearGradient(0, dy < 0 ? 0 : TILE, 0, dy < 0 ? depth : TILE - depth)
      : ctx.createLinearGradient(dx < 0 ? 0 : TILE, 0, dx < 0 ? depth : TILE - depth, 0);
  grad.addColorStop(0, "rgba(0,0,0,0.4)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, TILE, TILE);
  return canvas;
}

/** Sunlit crust highlight for solid tiles exposed from above. */
function bakeCrust(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, 7);
  grad.addColorStop(0, "rgba(255,225,185,0.28)");
  grad.addColorStop(1, "rgba(255,225,185,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, TILE, 7);
  return canvas;
}

/** Radial glow sprite for emissive effects. */
function bakeGlow(size: number, r: number, g: number, b: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.8)`);
  grad.addColorStop(0.4, `rgba(${r},${g},${b},0.28)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}
