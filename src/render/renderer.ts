import { clamp, lerp } from "../engine/math";
import { CAMERA, DEPTH, FX, LIGHT, PHYSICS, POD_ANIM, POST, SEASON, SLICE, TILE } from "../game/config";
import { cargoUnits } from "../game/economy";
import type { FxEvent, Game } from "../game/game";
import { DYNAMITE, ITEM_ORDER, ITEMS } from "../game/items";
import { hash2d, mulberry32 } from "../game/rng";
import { STATIONS } from "../game/stations";
import { biomeAt } from "../game/biomes";
import { SEASONS, seasonFog, type FloraPalette, type Season } from "../game/seasons";
import { digClass, hardnessScaleAt, stratumAt, TILE_DEFS, TileId } from "../game/tiles";
import { Hud } from "../ui/hud";
import { bakeCrust, bakeEdge, bakeGlow, bakePuff } from "./bake";
import { CameraFX } from "./camerafx";
import { FONT_DISPLAY, FONT_UI } from "./fonts";
import { iconCanvas, type IconId } from "./icons";
import { Lighting } from "./lighting";
import { darknessAt, flicker, type Emitter, type Light } from "./lights";
import { PostFX } from "./postfx";
import { viewPrefs } from "./prefs";
import { Sky } from "./sky";
import { makeTileTextures, makeTopsoilTextures, shade, TILE_VARIANTS, type TileTextures } from "./tileart";
import { Weather } from "./weather";

/** Blend steps for the seasonal topsoil in the depth pass's face-colour LUT. */
const SOIL_STEPS = 6;

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
  // --- Ambient weather only. All optional, so the hot dig/spark paths that
  // spawn hundreds of particles a second never touch them.
  /** Peak horizontal sway in px/s — leaves swing, snow wanders. */
  drift?: number;
  driftHz?: number;
  driftPhase?: number;
  /** Baked sprite drawn instead of a square (leaves, petals). */
  sprite?: HTMLCanvasElement;
  /** Spin rate rad/s and the angle it has accumulated. */
  spin?: number;
  angle?: number;
  /** Counted against SEASON.weather.budget so weather can't starve dig debris. */
  weather?: boolean;
}

/**
 * Linear blend between two #rrggbb colours. Returns hex, not rgb(), because the
 * result is fed straight into `shade()`, which parses the #rrggbb form.
 */
function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const mix = (sh: number): string =>
    Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${mix(16)}${mix(8)}${mix(0)}`;
}

/** A rising, fading reward number (e.g. "+$120") anchored to a world point. */
interface FloatText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

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
  /** The season resolved for the frame being drawn (previewed on the title). */
  private frameSeason: Season = SEASONS[0]!;
  private readonly weather = new Weather();
  /** Colour + strength of the active weather spell's full-screen wash. */
  private weatherTint = 0;
  private weatherTintColor = "#000000";
  /** Per-season sunlit crust (grass, leaf litter, snow), baked on first use. */
  private readonly crusts = new Map<string, HTMLCanvasElement>();
  /** Per-season near-surface earth textures, baked on first use. */
  private readonly topsoils = new Map<string, HTMLCanvasElement[]>();
  /** Season the face-colour LUT was built for; a change invalidates it. */
  private faceSeason = "";
  private readonly hud = new Hud();
  private readonly lighting = new Lighting();
  private readonly postfx = new PostFX();
  // Baked overlays: soft tunnel shadows per exposed side, sunlit crust, glows.
  private readonly shadeTop = bakeEdge(0, -1);
  private readonly shadeBottom = bakeEdge(0, 1);
  private readonly shadeLeft = bakeEdge(-1, 0);
  private readonly shadeRight = bakeEdge(1, 0);
  private readonly lavaGlow = bakeGlow(96, 255, 120, 30);
  private readonly warmGlow = bakeGlow(48, 255, 210, 130);
  private readonly anomalyGlow = bakeGlow(128, 120, 235, 255);
  private readonly puff = bakePuff(48);
  private readonly motes: { ox: number; oy: number; phase: number }[] = [];

  private particles: Particle[] = [];
  private floats: FloatText[] = [];
  // Emissive glows collected during the world pass, replayed additively after
  // the darkness so they pierce it; and the lights that carve that darkness.
  private readonly emitters: Emitter[] = [];
  private readonly lights: Light[] = [];
  // Cinematic camera: dynamic zoom, smoothing, look-ahead, shake. Its per-frame
  // `zoom`/`shakeX`/`shakeY` are shared by the world pass, the emissive replay,
  // the lights, and bloom so everything registers with the shaken, zoomed world.
  private readonly camfx = new CameraFX();
  private flash = 0;
  private darkness = 0;
  private time = 0;
  private frameDt = 0;
  private lastNow = performance.now();
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
  // Landing suspension: spikes on a hard touchdown, springs back — the pod's
  // shocks compressing under the impact.
  private suspension = 0;
  // Banking eases in only while airborne — a grounded pod sits level rather than
  // leaning left/right as it drives. 0 = grounded/level, 1 = full airborne bank.
  private bankLevel = 0;
  // Idle hover: seconds the pod has sat still, and the eased bob amount that
  // fades in once it's been at rest past POD_ANIM.idleDelay.
  private idleTime = 0;
  private idleBob = 0;
  // Directable headlamp: the eased aim angle (radians) the beam + lamp turret
  // point along — toward the dig, the pod's heading, or its facing at rest.
  private beamAngle = 0;
  // Hold the last dig aim briefly so the lamp doesn't flick back to horizontal
  // in the split-second gaps between drilled tiles.
  private beamDigHold = 0;
  private lastDigAim = Math.PI / 2;
  // Screen transitions: a black fade that eases out on arrival in the world,
  // and a timer that paces the death screen's reveal instead of popping it.
  private prevState = "";
  private fade = 0;
  private deathT = 0;
  private wonT = 0;
  private fpsAvg = 60;
  private vignetteGrad: CanvasGradient | null = null;
  private vignetteKey = "";

  constructor() {
    this.textures = makeTileTextures();
    const rand = mulberry32(77);
    for (let i = 0; i < FX.motes; i++) {
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
      if (game.state === "playing" && (this.prevState === "briefing" || this.prevState === "dead")) {
        this.fade = 1;
      }
      this.deathT = 0;
      this.wonT = 0;
      this.prevState = game.state;
    }
    this.fade = Math.max(0, this.fade - dt * 3);
    if (game.state === "dead") this.deathT += dt;
    if (game.state === "won") this.wonT += dt;

    const cam = game.camera;
    const p = game.player;
    const px = lerp(p.prevX, p.x, alpha);
    const py = lerp(p.prevY, p.y, alpha);

    const screenW = ctx.canvas.clientWidth;
    const screenH = ctx.canvas.clientHeight;

    // Effects first — they can request shake / zoom-punch that the camera reads.
    this.consumeFx(game.fxEvents);
    this.emitContinuousFx(game, px, py);
    this.updateParticles(dt);
    this.updateFloats(dt);

    // Cinematic camera: dynamic zoom, follow-smoothing, look-ahead, sway, shake.
    // Writes cam.x/cam.y and this frame's zoom / shake offset.
    this.camfx.update(cam, game, px, py, dt, screenW, screenH, viewPrefs.reducedMotion);
    const zoom = this.camfx.zoom;
    const shakeX = this.camfx.shakeX;
    const shakeY = this.camfx.shakeY;

    this.drillRecoil = Math.max(0, this.drillRecoil - dt * 7);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    // Suspension compresses on a hard landing (the sim reports the absorbed
    // downward speed for one step), then springs back.
    if (p.impactSpeed > 0) {
      this.suspension = Math.max(this.suspension, clamp(p.impactSpeed / POD_ANIM.squashImpact, 0, 1));
    }
    this.suspension = Math.max(0, this.suspension - dt * POD_ANIM.squashRecover);

    // Depth darkness, computed before the world pass so the pod headlamp glow
    // and dust motes use this frame's value rather than last frame's.
    const centerDepth = (cam.y + cam.viewHeight / 2) / TILE - game.world.surfaceRow;
    // On the title screen the whole backdrop previews the season in the picker,
    // so choosing one is a live before/after rather than a label. A continued
    // run still loads its own season — the picker is labelled "new game" for
    // exactly that reason.
    const season = game.state === "title" ? SEASONS[game.titleSeason]! : game.season;
    // Held for this frame the same way `darkness` is, so the sub-passes below
    // (ground crust, weather) all agree with the pass that resolved it.
    this.frameSeason = season;
    // The face LUT bakes the seasonal earth into its colours, so it has to go
    // when the season does (dev switcher, or the title screen's live preview).
    if (this.faceSeason !== season.id) {
      this.faceSeason = season.id;
      this.faceColors.clear();
    }
    const grade = season.look.grade;
    // The season sets a darkness floor at the surface — winter's short, dim days.
    this.darkness = darknessAt(centerDepth, grade.surfaceDark);
    const biome = biomeAt(centerDepth);
    // One fog colour, pulled toward the season's, feeding both the lighting
    // overlay and the depth haze — the two consumers that already take an [r,g,b].
    const fog = seasonFog(biome.fog, season);
    // How much of the frame is "surface" — the grade and weather live there and
    // must not fight the biome fog down deep.
    const surfaceMix = clamp(1 - this.darkness * SEASON.grade.depthFade, 0, 1);

    // Aim the directable headlamp for this frame (used by the pod turret and the
    // beam light alike).
    if (viewPrefs.headlampBeam) this.updateBeamAngle(game);

    // The world pass collects emissive glows into these instead of drawing them
    // inline; they're replayed after the darkness so they pierce it.
    this.emitters.length = 0;
    this.lights.length = 0;

    // --- World albedo pass (zoomed + shaken): opaque geometry only ---
    ctx.save();
    ctx.scale(zoom, zoom);
    ctx.translate(shakeX, shakeY);
    this.sky.draw(ctx, cam, game.world.surfaceRow * TILE, this.time, season.look);
    this.drawTiles(ctx, game);
    this.drawStations(ctx, game);
    this.drawFuse(ctx, game, cam.x, cam.y);
    this.drawPod(ctx, game, px - cam.x, py - cam.y);
    this.drawParticles(ctx, game, false);
    this.drawFloats(ctx, cam);
    ctx.restore();

    // Biome mood wash over the world (subtle; the fog colour carries the deep).
    if (biome.tintAlpha > 0) {
      ctx.globalAlpha = biome.tintAlpha;
      ctx.fillStyle = biome.tint;
      ctx.fillRect(0, 0, screenW, screenH);
      ctx.globalAlpha = 1;
    }

    // --- Lighting: darkness carved by the headlamp, beacon, and the world's
    // own emissive sources (lava/thruster/dig collected during the world pass).
    const podLX = (px - cam.x + p.width / 2 + shakeX) * zoom;
    const podLY = (py - cam.y + p.height / 2 + shakeY) * zoom;
    const anom = game.world.anomaly;
    // Budget the *dynamic* lights (keep the nearest to the pod), reserving slots
    // for the always-present headlamp and beacon so they can't be crowded out.
    const reserve = anom ? 2 : 1;
    if (this.lights.length > LIGHT.budget - reserve) {
      this.lights.sort(
        (a, b) => (a.x - podLX) ** 2 + (a.y - podLY) ** 2 - ((b.x - podLX) ** 2 + (b.y - podLY) ** 2),
      );
      this.lights.length = LIGHT.budget - reserve;
    }
    if (viewPrefs.headlampBeam) {
      // Directional lamp anchored at the roof fixture: a tight pool keeps the
      // pod fully lit while a cone throws light along the aim.
      const lampY = (py - cam.y + 3 + shakeY) * zoom;
      this.lights.push({
        x: podLX,
        y: lampY,
        radius: LIGHT.beam.ambientRadius * zoom,
        color: grade.lampTint,
        intensity: 1,
        wash: 0.12,
        beamAngle: this.beamAngle,
        beamLen: LIGHT.beam.length * zoom,
      });
    } else {
      this.lights.push({
        x: podLX,
        y: podLY,
        radius: LIGHT.radius * zoom,
        color: grade.lampTint,
        intensity: 1,
        wash: 0.1,
      });
    }
    if (anom) {
      const ar = LIGHT.radius * zoom * (0.85 + 0.15 * Math.sin(this.time * 2));
      const ax = (anom.x * TILE + TILE / 2 - cam.x + shakeX) * zoom;
      const ay = (anom.y * TILE + TILE / 2 - cam.y + shakeY) * zoom;
      if (ax > -ar && ax < screenW + ar && ay > -ar && ay < screenH + ar) {
        this.lights.push({ x: ax, y: ay, radius: ar, color: LIGHT.beaconTint, intensity: 0.9, wash: 0.16 });
      }
    }
    this.lighting.apply(ctx, this.lights, fog, this.darkness, screenW, screenH);

    // Aerial-perspective haze thickening with depth (fades out at the surface).
    this.postfx.depthHaze(ctx, fog, FX.depthHaze * this.darkness, screenW, screenH);

    // --- Emissive pass (zoomed + shaken, additive): glows over the darkness ---
    ctx.save();
    ctx.scale(zoom, zoom);
    ctx.translate(shakeX, shakeY);
    ctx.globalCompositeOperation = "lighter";
    for (const e of this.emitters) {
      ctx.globalAlpha = e.alpha;
      ctx.drawImage(e.sprite, e.x, e.y, e.w, e.h);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    this.drawParticles(ctx, game, true);
    this.drawMotes(ctx, px - cam.x + p.width / 2, py - cam.y + p.height / 2);
    ctx.restore();

    // --- Bloom: bright emissive sources bleed a soft halo ---
    this.postfx.bloom(ctx, this.emitters, screenW, screenH, zoom, shakeX, shakeY);

    // Heat shimmer: the magma biome always, plus whatever the season adds at
    // the surface (summer's air shimmers over hot ground).
    const shimmer =
      (biome.name === "Magma Depths" ? FX.heatHaze.strength : 0) + grade.heatHaze * surfaceMix;
    if (shimmer > 0 && !viewPrefs.reducedMotion) {
      this.postfx.heatHaze(ctx, shimmer, FX.heatHaze.hz, this.time, screenW, screenH);
    }

    // Season colour grade: a film-stock pass over the composited world. Kept
    // separate from the biome wash above on purpose — that one is albedo-space
    // mood applied pre-lighting, this one grades the finished frame. It fades
    // out with depth so the deep reads as the biome's, not the season's, and
    // sits before the vignette so it never touches the HUD or the title text.
    this.postfx.grade(ctx, grade, surfaceMix, screenW, screenH);
    // A weather spell (spring's rain squalls) cools the frame while it runs.
    if (this.weatherTint > 0) {
      this.postfx.wash(ctx, this.weatherTintColor, this.weatherTint, screenW, screenH);
    }

    this.drawVignette(ctx, screenW, screenH);
    // Reduced-motion suppresses the full-screen damage flash (photosensitivity).
    if (this.flash > 0 && !viewPrefs.reducedMotion) this.drawFlash(ctx, screenW, screenH);
    this.drawScanner(ctx, game, zoom); // reveals ore within scanner range, over the dark

    if (game.state === "title") {
      this.drawTitleScreen(ctx, game);
      return;
    }
    if (game.state === "briefing") {
      this.drawBriefingScreen(ctx, game, screenW, screenH);
      if (this.fade > 0) {
        ctx.fillStyle = `rgba(6,4,10,${this.fade.toFixed(3)})`;
        ctx.fillRect(0, 0, screenW, screenH);
      }
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
        heat: p.heat,
        maxHeat: p.maxHeat,
        money: game.money,
        cargoUnits: cargoUnits(p.cargo),
        cargoCapacity: p.cargoCapacity,
        hint: game.stationHint(),
        onboarding: game.onboardingHint(),
        objective: game.objective(),
        toast: game.toast,
        dev: game.devMode,
        season: {
          label: season.name,
          color: season.look.accent,
          icon: season.look.iconId as IconId,
        },
        items: ITEM_ORDER.map((id, i) => ({
          key: `${i + 1}`,
          tag: ITEMS[id].tag,
          icon: id as IconId, // item ids double as icon ids
          count: p.items[id],
        })),
      },
      dt,
    );
    if (game.showTelemetry) this.drawTelemetry(ctx, game, dt);
    if (game.state === "dead") this.drawDeathScreen(ctx, game, this.deathT);
    if (game.state === "won") this.drawWinScreen(ctx, game, this.wonT);

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
        // The tile gives way — debris tuned to the material: dirt puffs dust,
        // stone throws chips, granite cracks off fast bright shards.
        const color = e.color ?? "#8a4a2a";
        const cls = e.tile === undefined ? "soft" : digClass(e.tile);
        if (cls === "soft") {
          this.burst(e.x, e.y, 12, color, 90, 820, false); // slow, dusty, settles
          this.burst(e.x, e.y, 3, "#e8c090", 50, 500, true);
        } else if (cls === "mid") {
          this.burst(e.x, e.y, 13, color, 135, 700, false); // chunkier chips
          this.burst(e.x, e.y, 4, "#ffe0b0", 90, 420, true);
        } else {
          this.burst(e.x, e.y, 10, color, 175, 640, false); // fewer, faster shards
          this.burst(e.x, e.y, 8, "#ffffff", 150, 300, true); // bright sparks fly
        }
        this.camfx.addShake(cls === "hard" ? 0.34 : 0.28);
        this.drillRecoil = 1;
      } else if (e.kind === "impact") {
        this.burst(e.x, e.y, 14, "#a4643c", 130, 300, false);
        this.camfx.addShake(clamp((e.power ?? 0) / 60, 0.25, 0.6));
        this.camfx.punchZoom(CAMERA.impactZoom * clamp((e.power ?? 0) / 80, 0.4, 1));
        this.flash = Math.max(this.flash, 0.45);
      } else if (e.kind === "explosion") {
        this.burst(e.x, e.y, 26, "#ff9d2e", 220, 200, true);
        this.burst(e.x, e.y, 12, "#ffe97a", 160, 100, true);
        this.camfx.addShake(0.6);
        this.camfx.punchZoom(CAMERA.impactZoom);
        this.flash = Math.max(this.flash, 0.8);
      } else if (e.kind === "upgrade") {
        this.burst(e.x, e.y, 20, "#ffe97a", 140, -40, true);
        this.burst(e.x, e.y, 8, "#ffffff", 90, -40, true);
        this.spawnFloat(e.x, e.y - 6, "★ UPGRADED", "#ffe97a", 14);
      } else if (e.kind === "pickup" && e.value) {
        // A floating "+$" in the mineral's colour previews what it's worth.
        this.spawnFloat(e.x, e.y, `+$${e.value}`, e.color ?? "#ffe97a", 12);
      } else if (e.kind === "sell" && e.value) {
        // Cashing in: a fountain of gold coins and a bold total.
        this.burst(e.x, e.y, 16, "#ffd75e", 150, -70, true);
        this.spawnFloat(e.x, e.y - 8, `+$${e.value.toLocaleString()}`, "#ffe07a", 18);
      } else if (e.kind === "death") {
        // The pod is lost: a violent flash and a spray of burning debris + hull
        // shrapnel, with a big camera jolt.
        this.burst(e.x, e.y, 30, "#ffd0a0", 250, 120, true);
        this.burst(e.x, e.y, 22, "#ff6a3c", 210, 180, true);
        this.burst(e.x, e.y, 18, "#8a8078", 150, 420, false);
        this.camfx.addShake(0.95);
        this.camfx.punchZoom(CAMERA.impactZoom * 1.4);
        this.flash = Math.max(this.flash, 0.9);
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
    // A wounded pod throws electrical sparks from the hull, more often the
    // closer it is to being lost.
    if (p.hull / p.maxHull < POD_ANIM.damageHull) {
      const sev = 1 - p.hull / p.maxHull / POD_ANIM.damageHull;
      if (Math.random() < (0.15 + sev * 0.5) * this.frameDt * 60) {
        this.spawn({
          x: px + p.width / 2 + (Math.random() - 0.5) * p.width,
          y: py + p.height * (0.3 + Math.random() * 0.5),
          vx: (Math.random() - 0.5) * 70,
          vy: -20 - Math.random() * 40,
          life: 0.3,
          maxLife: 0.3,
          size: 1 + Math.random(),
          color: Math.random() > 0.4 ? "#ffe0a0" : "#ff7a4a",
          gravity: 300,
          additive: true,
        });
      }
    }

    // Ambient embers drifting up through the magma biome — spawned across the
    // view floor and rising, so the air itself reads as hot.
    if (biomeAt(game.depth).name === "Magma Depths" && Math.random() < FX.embers.ratePerSec * this.frameDt) {
      const cam = game.camera;
      const life = 2.4 + Math.random() * 1.8;
      this.spawn({
        x: cam.x + Math.random() * cam.viewWidth,
        y: cam.y + cam.viewHeight + 8,
        vx: (Math.random() - 0.5) * 14,
        vy: -22 - Math.random() * 26,
        life,
        maxLife: life,
        size: 1 + Math.random() * 1.4,
        color: Math.random() > 0.5 ? "#ff9d3c" : "#ffcf6a",
        gravity: -5, // embers accelerate gently upward
        additive: true,
      });
    }

    // Seasonal surface weather. Counts its own live particles so it can never
    // crowd dig debris out of the shared pool.
    let live = 0;
    for (const q of this.particles) if (q.weather) live++;
    this.weather.emit(
      game.season,
      game.camera,
      game.depth,
      this.frameDt,
      viewPrefs.reducedMotion,
      live,
      (wp) => this.spawn(wp as Particle),
    );
    const spell = game.season.look.weather.spell;
    const targetTint = spell ? this.weather.spellStrength * spell.tintAlpha : 0;
    // Ease the squall wash in and out rather than snapping it.
    this.weatherTint += (targetTint - this.weatherTint) * Math.min(1, this.frameDt * 1.2);
    if (spell) this.weatherTintColor = spell.tint;
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
    if (this.particles.length >= FX.maxParticles) this.particles.shift();
    this.particles.push(particle);
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Weather wanders sideways on a sine rather than falling dead straight.
      if (p.drift) {
        const age = p.maxLife - p.life;
        p.x += p.drift * Math.sin(p.driftPhase! + age * p.driftHz! * Math.PI * 2) * dt;
      }
      if (p.spin) p.angle = (p.angle ?? 0) + p.spin * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  /**
   * One particle pass. Non-additive dust draws in the world (albedo) pass;
   * additive sparks/exhaust draw in the emissive pass so they glow through the
   * darkness rather than being dimmed by it.
   */
  private drawParticles(ctx: CanvasRenderingContext2D, game: Game, additive: boolean): void {
    const cam = game.camera;
    if (additive) ctx.globalCompositeOperation = "lighter";
    for (const p of this.particles) {
      if (p.additive !== additive) continue;
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      const sx = p.x - cam.x;
      const sy = p.y - cam.y;
      if (p.sprite) {
        // Sprite kinds (leaves, petals) tumble as they fall.
        const s = p.size * 2;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(p.angle ?? 0);
        ctx.drawImage(p.sprite, -s / 2, -s / 2, s, s);
        ctx.restore();
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(sx - p.size / 2, sy - p.size / 2, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
    if (additive) ctx.globalCompositeOperation = "source-over";
  }

  private spawnFloat(x: number, y: number, text: string, color: string, size = 12): void {
    if (this.floats.length >= 32) this.floats.shift();
    const life = 1.1 + size * 0.02;
    this.floats.push({ x, y, vy: -32, text, color, size, life, maxLife: life });
  }

  private updateFloats(dt: number): void {
    for (const f of this.floats) {
      f.life -= dt;
      f.y += f.vy * dt;
      f.vy *= 1 - dt * 1.4; // ease the rise to a drift
    }
    this.floats = this.floats.filter((f) => f.life > 0);
  }

  /** Reward numbers, drawn in the (zoomed) world pass with a dark outline. */
  private drawFloats(ctx: CanvasRenderingContext2D, cam: { x: number; y: number }): void {
    if (this.floats.length === 0) return;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (const f of this.floats) {
      const t = clamp(f.life / f.maxLife, 0, 1);
      const sx = f.x - cam.x;
      const sy = f.y - cam.y;
      ctx.globalAlpha = Math.min(1, t * 1.6); // fade only near the end
      ctx.font = `bold ${f.size}px ${FONT_UI}`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.strokeText(f.text, sx, sy);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, sx, sy);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
  }

  /**
   * Ease the headlamp aim toward where the pod is working or heading: the dig
   * direction while drilling, the velocity heading while moving, else its
   * horizontal facing at rest. Angles wrap correctly so it swings the short way.
   */
  private updateBeamAngle(game: Game): void {
    const p = game.player;
    let aim: number;
    if (p.hasDigTarget) {
      const podCol = Math.floor((p.x + p.width / 2) / TILE);
      const podRow = Math.floor((p.y + p.height / 2) / TILE);
      this.lastDigAim =
        p.digTargetY > podRow ? Math.PI / 2 : p.digTargetX < podCol ? Math.PI : p.digTargetX > podCol ? 0 : Math.PI / 2;
      this.beamDigHold = 0.4; // bridge the gaps between drilled tiles
      aim = this.lastDigAim;
    } else if (this.beamDigHold > 0) {
      // Just between tiles while drilling — hold the dig aim so the lamp doesn't
      // flick back to horizontal and forth.
      this.beamDigHold -= this.frameDt;
      aim = this.lastDigAim;
    } else if (Math.hypot(p.vx, p.vy) > 45) {
      aim = Math.atan2(p.vy, p.vx);
    } else {
      aim = p.facing < 0 ? Math.PI : 0;
    }
    let d = aim - this.beamAngle;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.beamAngle += d * (1 - Math.exp(-9 * this.frameDt));
  }

  /**
   * Queue a light from a world-space (camera-relative, pre-zoom) centre point.
   * Bakes in the shared shake and zoom so the darkness holes register with the
   * shaken world, matching the emissive replay pass.
   */
  private pushLight(
    sx: number,
    sy: number,
    radiusWorld: number,
    color: readonly [number, number, number],
    intensity: number,
    wash: number,
  ): void {
    this.lights.push({
      x: (sx + this.camfx.shakeX) * this.camfx.zoom,
      y: (sy + this.camfx.shakeY) * this.camfx.zoom,
      radius: radiusWorld * this.camfx.zoom,
      color,
      intensity,
      wash,
    });
  }

  /** The objective beacon: a pulsing faceted crystal with an additive halo. */
  private drawAnomaly(ctx: CanvasRenderingContext2D, sx: number, sy: number): void {
    const cx = sx + TILE / 2;
    const cy = sy + TILE / 2;
    const pulse = 0.6 + 0.4 * Math.sin(this.time * 2.2);
    // Halo is emissive — replayed after the darkness so the beacon reads bright.
    this.emitters.push({ sprite: this.anomalyGlow, x: cx - 64, y: cy - 64, w: 128, h: 128, alpha: 0.5 + pulse * 0.4 });

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

  /** The season's ground-cover sprite, baked on first use and cached. */
  private crust(ground: FloraPalette["ground"]): HTMLCanvasElement {
    const key = `${ground.rgb}|${ground.depth}|${ground.alpha}`;
    let c = this.crusts.get(key);
    if (!c) {
      c = bakeCrust(ground.rgb, ground.depth, ground.alpha);
      this.crusts.set(key, c);
    }
    return c;
  }

  /** The season's topsoil variants, baked on first use; null if it has none. */
  private topsoil(): HTMLCanvasElement[] | null {
    const p = this.frameSeason.look.topsoil;
    if (!p) return null;
    let t = this.topsoils.get(this.frameSeason.id);
    if (!t) {
      t = makeTopsoilTextures(p);
      this.topsoils.set(this.frameSeason.id, t);
    }
    return t;
  }

  /**
   * How strongly the seasonal earth shows at `depth` tiles below the surface.
   * Full strength through the top quarter of the band, then eased to nothing —
   * so it reads as a *layer* with a soft underside rather than a wash that
   * starts fading the moment you break ground.
   */
  private topsoilBlend(depth: number): number {
    const p = this.frameSeason.look.topsoil;
    if (!p || depth < 0 || depth >= p.depth) return 0;
    const t = 1 - depth / p.depth; // 1 at the surface → 0 at the band's floor
    const HOLD = 0.75;
    return p.strength * (t >= HOLD ? 1 : (t / HOLD) ** 1.5);
  }

  private drawTiles(ctx: CanvasRenderingContext2D, game: Game): void {
    const cam = game.camera;
    const world = game.world;
    const x0 = Math.max(0, Math.floor(cam.x / TILE));
    const y0 = Math.max(0, Math.floor(cam.y / TILE));
    const x1 = Math.min(world.width - 1, Math.floor((cam.x + cam.viewWidth) / TILE));
    const y1 = Math.min(world.height - 1, Math.floor((cam.y + cam.viewHeight) / TILE));

    if (viewPrefs.depth) this.drawDepthPass(ctx, game);

    const crust = this.crust(this.frameSeason.look.flora.ground);
    const topsoil = this.topsoil();

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

        // A gas pocket disguises itself as the surrounding stratum, so it can't
        // be spotted by eye — the trap only springs when you drill it.
        const texTile =
          tile === TileId.GasPocket ? stratumAt(ty - game.world.surfaceRow) : tile;
        const variants = this.textures.get(texTile);
        const v = Math.floor(hash2d(tx, ty, 7) * TILE_VARIANTS) % TILE_VARIANTS;
        if (variants) {
          // Half-pixel bleed hides antialiasing seams at fractional zoom offsets.
          ctx.drawImage(variants[v]!, sx, sy, TILE + 0.5, TILE + 0.5);
        }

        // Seasonal topsoil: the near-surface earth itself is frozen / root-bound
        // / sun-baked, fading back to the plain stratum with depth. Keyed off
        // `texTile`, so a gas pocket disguised as topsoil gets the same
        // treatment and stays invisible.
        if (topsoil && texTile === TileId.Dirt) {
          const a = this.topsoilBlend(ty - world.surfaceRow);
          if (a > 0.01) {
            ctx.globalAlpha = a;
            ctx.drawImage(topsoil[v]!, sx, sy, TILE + 0.5, TILE + 0.5);
            ctx.globalAlpha = 1;
          }
        }

        if (tile === TileId.Empty) {
          // Soft ambient occlusion: baked gradient shadow on each walled side.
          if (world.isSolid(tx, ty - 1)) ctx.drawImage(this.shadeTop, sx, sy);
          if (world.isSolid(tx, ty + 1)) ctx.drawImage(this.shadeBottom, sx, sy);
          if (world.isSolid(tx - 1, ty)) ctx.drawImage(this.shadeLeft, sx, sy);
          if (world.isSolid(tx + 1, ty)) ctx.drawImage(this.shadeRight, sx, sy);
          continue;
        }

        // Sunlit crust on any solid tile exposed from above — the season's
        // ground cover rides on this existing blit, so no tile texture has to
        // be re-baked or invalidated when the season changes.
        if (!world.isSolid(tx, ty - 1)) ctx.drawImage(crust, sx, sy);

        if (tile === TileId.Lava) {
          // Emissive: replayed after the darkness so it glows through the dark.
          const pulse = 0.55 + 0.35 * Math.sin(this.time * 2.5 + hash2d(tx, ty, 3) * 6);
          this.emitters.push({ sprite: this.lavaGlow, x: sx + TILE / 2 - 48, y: sy + TILE / 2 - 48, w: 96, h: 96, alpha: pulse });
          // A light that carves its own pool out of the darkness. Edge-merge:
          // an interior cell (lava on both its left and top) defers to its
          // neighbours, bounding the light count across a pooled lava floor.
          const interior = world.getTile(tx - 1, ty) === TileId.Lava && world.getTile(tx, ty - 1) === TileId.Lava;
          if (!interior && this.darkness > 0.01) {
            const phase = hash2d(tx, ty, 5) * Math.PI * 2;
            const intensity = flicker(LIGHT.lava.intensity, LIGHT.lava.flicker, LIGHT.lava.hz, this.time, phase);
            this.pushLight(sx + TILE / 2, sy + TILE / 2, LIGHT.lava.radius, LIGHT.lava.color, intensity, LIGHT.lava.wash);
          }
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

      // Molten flare where the drill bites (emissive — replayed after dark).
      this.emitters.push({ sprite: this.warmGlow, x: sx + TILE / 2 - 14, y: sy + TILE / 2 - 14, w: 28, h: 28, alpha: 0.5 + Math.random() * 0.4 });
      // The work face lights up as the drill bites.
      if (this.darkness > 0.01) {
        this.pushLight(sx + TILE / 2, sy + TILE / 2, LIGHT.digFlare.radius, LIGHT.digFlare.color, LIGHT.digFlare.intensity * (0.6 + Math.random() * 0.4), LIGHT.digFlare.wash);
      }
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
    const px = (x: number): number => vx + (x - vx) * DEPTH.backScale;
    const py = (y: number): number => vy + (y - vy) * DEPTH.backScale;

    // Back walls first: they sit deepest. Projected rects of adjacent tiles
    // stay adjacent (the projection is a similarity), so textures still tile.
    const backVariants = this.textures.get(TileId.Empty)!;
    const backSize = TILE * DEPTH.backScale + 0.5;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (world.getTile(tx, ty) !== TileId.Empty) continue;
        const v = Math.floor(hash2d(tx, ty, 7) * TILE_VARIANTS) % TILE_VARIANTS;
        ctx.drawImage(backVariants[v]!, px(tx * TILE - cam.x), py(ty * TILE - cam.y), backSize, backSize);
      }
    }

    // Fake-normal sculpting: cavity faces respond to the pod headlamp (the
    // dominant light). Faces turned toward the lamp catch light; those turned
    // away fall into shadow. The effect scales with darkness, so the lit
    // surface keeps its flat ambient shading.
    const p = game.player;
    const podCol = (p.x + p.width / 2) / TILE;
    const podRow = (p.y + p.height / 2) / TILE;
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
          // A face is lit when the lamp is on the side its surface points toward.
          // Cavity walls take the same seasonal earth as the tiles around them,
          // or a dug shaft would show plain brown sides against frosted faces.
          const soil = this.soilStep(ty - world.surfaceRow);
          if (TILE_DEFS[up].solid) this.face(ctx, sx, sy, sx + TILE, sy, up, this.faceLight(DEPTH.face.ceiling, podRow > ty, tx, ty, podCol, podRow), px, py, up === TileId.Dirt ? soil : 0);
          if (TILE_DEFS[down].solid) this.face(ctx, sx, sy + TILE, sx + TILE, sy + TILE, down, this.faceLight(DEPTH.face.floor, podRow < ty, tx, ty, podCol, podRow), px, py, down === TileId.Dirt ? soil : 0);
          if (TILE_DEFS[left].solid) this.face(ctx, sx, sy, sx, sy + TILE, left, this.faceLight(DEPTH.face.wall, podCol > tx, tx, ty, podCol, podRow), px, py, left === TileId.Dirt ? soil : 0);
          if (TILE_DEFS[right].solid) this.face(ctx, sx + TILE, sy, sx + TILE, sy + TILE, right, this.faceLight(DEPTH.face.wall, podCol < tx, tx, ty, podCol, podRow), px, py, right === TileId.Dirt ? soil : 0);
        } else if (TILE_DEFS[tile].solid && world.getTile(tx, ty - 1) === TileId.Sky) {
          // Sunlit lip along the surface — the terrain's visible top face.
          const lipSoil = tile === TileId.Dirt ? this.soilStep(ty - world.surfaceRow) : 0;
          this.face(ctx, sx, sy, sx + TILE, sy, tile, DEPTH.face.lip, px, py, lipSoil);
        }
      }
    }
  }

  /**
   * Brightness for one cavity face: its `base` ambient, modulated toward the
   * pod headlamp. `litSide` is whether the lamp lies on the side the face
   * points toward; the directional term is strongest when the face is both
   * facing the lamp and near it, and fades out with darkness so the lit surface
   * stays on its flat ambient shading.
   */
  private faceLight(base: number, litSide: boolean, tx: number, ty: number, podCol: number, podRow: number): number {
    const t = this.darkness;
    if (t < 0.05) return base;
    const d = Math.hypot(podCol - (tx + 0.5), podRow - (ty + 0.5));
    const prox = clamp(1 - d / DEPTH.lightRange, 0, 1);
    const dir = litSide ? prox : 0;
    return base * (1 - 0.25 * t + 0.5 * dir * t);
  }

  /** Quantise a topsoil blend into a LUT step, so cavity walls match the tiles. */
  private soilStep(depth: number): number {
    const a = this.topsoilBlend(depth);
    return a <= 0.01 ? 0 : Math.max(1, Math.round(a * SOIL_STEPS));
  }

  /** The face colour for a tile `step`/SOIL_STEPS of the way to seasonal earth. */
  private soilTone(tile: TileId, step: number): string {
    const p = this.frameSeason.look.topsoil;
    if (!p) return TILE_DEFS[tile].color;
    return mixHex(TILE_DEFS[tile].color, p.color, step / SOIL_STEPS);
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
    /** Seasonal topsoil blend step, 0 = plain stratum. */
    soil = 0,
  ): void {
    // Quantise the (now continuous) light factor so the colour LUT stays small:
    // ~48 buckets per tile instead of a fresh shade() per face per frame. `soil`
    // adds a few more steps for the seasonal topsoil blend; the LUT is cleared
    // when the season changes, so the blend need not be part of the key's value.
    const bucket = Math.round(clamp(light, 0, 2) * 24);
    const key = (tile * 64 + bucket) * (SOIL_STEPS + 1) + soil;
    let color = this.faceColors.get(key);
    if (!color) {
      const base = soil > 0 ? this.soilTone(tile, soil) : TILE_DEFS[tile].color;
      color = shade(base, bucket / 24);
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

    // --- Outpost infrastructure across the whole district (behind the buildings):
    // a slung power cable, a ground pipeline on stanchions, and hissing steam vents.
    const first = STATIONS[0]!;
    const last = STATIONS[STATIONS.length - 1]!;
    const dx0 = first.x0 * TILE - cam.x - 26;
    const dx1 = (last.x1 + 1) * TILE - cam.x + 26;
    const gy = groundY - cam.y;
    const h = TILE * 3;
    if (dx1 > -40 && dx0 < cam.viewWidth + 40) {
      const poleTop = gy - h - 20;
      ctx.strokeStyle = "#332e27";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(dx0 + 4, gy);
      ctx.lineTo(dx0 + 4, poleTop);
      ctx.moveTo(dx1 - 4, gy);
      ctx.lineTo(dx1 - 4, poleTop);
      ctx.stroke();
      ctx.strokeStyle = "rgba(18,14,10,0.85)"; // drooping cable (catenary)
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(dx0 + 4, poleTop + 3);
      ctx.quadraticCurveTo((dx0 + dx1) / 2, poleTop + 36, dx1 - 4, poleTop + 3);
      ctx.stroke();
      // Ground pipeline with stanchions.
      ctx.fillStyle = "#463b33";
      ctx.fillRect(dx0, gy - 8, dx1 - dx0, 4);
      ctx.fillStyle = "#5a4d42";
      ctx.fillRect(dx0, gy - 8, dx1 - dx0, 1.3);
      ctx.fillStyle = "#332c26";
      for (let x = dx0 + 10; x < dx1; x += 28) ctx.fillRect(x, gy - 6, 3, 6);
      // Steam vents in the gaps between buildings (baked puff — no per-frame gradients).
      for (const vx of [(first.x1 + 1.5) * TILE - cam.x, (last.x0 - 0.5) * TILE - cam.x]) {
        ctx.fillStyle = "#3c342c";
        ctx.fillRect(vx - 3, gy - 13, 6, 13);
        ctx.fillStyle = "#4c4237";
        ctx.fillRect(vx - 5, gy - 15, 10, 3);
        for (let k = 0; k < 2; k++) {
          const rise = (this.time * 0.5 + vx * 0.01 + k * 0.5) % 1;
          const pyy = gy - 17 - rise * 34;
          const r = 6 + rise * 9;
          const drift = Math.sin(rise * 3 + vx) * 3;
          ctx.globalAlpha = 0.2 * (1 - rise);
          ctx.drawImage(this.puff, vx + drift - r, pyy - r, r * 2, r * 2);
        }
      }
      ctx.globalAlpha = 1;
    }

    for (const s of STATIONS) {
      const sx = s.x0 * TILE - cam.x;
      const w = (s.x1 - s.x0 + 1) * TILE;
      const bh = TILE * 3;
      const sy = groundY - bh - cam.y; // top of the building
      const baseY = groundY - cam.y; // ground line
      if (sx + w < -80 || sx > cam.viewWidth + 80) continue;
      const blink = (Math.sin(this.time * 2.4 + s.x0) + 1) / 2;

      // Concrete footing.
      ctx.fillStyle = "#26221e";
      ctx.fillRect(sx - 5, baseY - 4, w + 10, 6);
      ctx.fillStyle = "#3a352f";
      ctx.fillRect(sx - 5, baseY - 4, w + 10, 1.5);

      // Corrugated-metal wall block.
      const wallTop = sy + 8;
      const wallH = baseY - wallTop;
      const body = ctx.createLinearGradient(0, wallTop, 0, baseY);
      body.addColorStop(0, shade(s.color, 1.08));
      body.addColorStop(0.55, s.color);
      body.addColorStop(1, shade(s.color, 0.56));
      ctx.fillStyle = body;
      ctx.fillRect(sx, wallTop, w, wallH);
      for (let cxp = sx + 2; cxp < sx + w - 1; cxp += 4) {
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillRect(cxp, wallTop, 1, wallH);
        ctx.fillStyle = "rgba(0,0,0,0.09)";
        ctx.fillRect(cxp + 2, wallTop, 1, wallH);
      }
      ctx.fillStyle = "rgba(0,0,0,0.16)"; // horizontal panel seams
      ctx.fillRect(sx, wallTop + wallH * 0.34, w, 1);
      ctx.fillRect(sx, wallTop + wallH * 0.63, w, 1);
      ctx.fillStyle = "rgba(28,17,9,0.12)"; // weather streaks
      for (const wf of [0.24, 0.52, 0.8]) ctx.fillRect(sx + w * wf, wallTop + 3, 1.5, wallH * 0.45);
      // Structural corner posts.
      ctx.fillStyle = "#2a2621";
      ctx.fillRect(sx - 1.5, wallTop - 2, 4, wallH + 2);
      ctx.fillRect(sx + w - 2.5, wallTop - 2, 4, wallH + 2);
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(sx - 1.5, wallTop - 2, 1, wallH + 2);
      ctx.fillRect(sx + w - 2.5, wallTop - 2, 1, wallH + 2);

      // Flat roof: overhanging eave + parapet band.
      ctx.fillStyle = shade(s.color, 0.42);
      ctx.fillRect(sx - 6, sy + 2, w + 12, 6);
      ctx.fillStyle = shade(s.color, 0.62);
      ctx.fillRect(sx - 6, sy + 2, w + 12, 1.5);
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(sx - 6, sy + 7.5, w + 12, 1.5);

      // Rooftop equipment breaks the boxy roofline: HVAC unit + steaming vent stack.
      ctx.fillStyle = "#47433c";
      ctx.fillRect(sx + 7, sy - 6, 13, 8);
      ctx.fillStyle = "#5a554c";
      ctx.fillRect(sx + 7, sy - 6, 13, 1.5);
      ctx.fillStyle = "#2c2924";
      for (let vv = sx + 9; vv < sx + 19; vv += 2) ctx.fillRect(vv, sy - 3.5, 1, 4);
      const stackX = sx + w - 16;
      ctx.fillStyle = "#3a352f";
      ctx.fillRect(stackX, sy - 11, 5, 13);
      ctx.fillStyle = "#4c463d";
      ctx.fillRect(stackX - 1.5, sy - 12, 8, 2);
      for (let k = 0; k < 2; k++) {
        const rise = (this.time * 0.4 + s.x0 + k * 0.5) % 1;
        const r = 4 + rise * 8;
        const drift = Math.sin(rise * 3 + s.x0) * 3;
        ctx.globalAlpha = 0.18 * (1 - rise);
        ctx.drawImage(this.puff, stackX + 2.5 + drift - r, sy - 13 - rise * 26 - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
      // Antenna with a blinking beacon.
      ctx.strokeStyle = "#55524e";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx + w - 7, sy - 6);
      ctx.lineTo(sx + w - 7, sy - 19);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,80,60,${(0.35 + blink * 0.65).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(sx + w - 7, sy - 20, 2, 0, Math.PI * 2);
      ctx.fill();
      this.emitters.push({ sprite: this.warmGlow, x: sx + w - 7 - 10, y: sy - 20 - 10, w: 20, h: 20, alpha: blink * 0.5 });

      // --- Storefront (recessed lower level) with a canopy ---
      const storeY = baseY - 28;
      ctx.fillStyle = shade(s.color, 0.72); // canopy
      ctx.fillRect(sx + 1, storeY - 5, w - 2, 5);
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(sx + 1, storeY, w - 2, 1.5);
      ctx.strokeStyle = "#2a2621";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx + 6, storeY - 5);
      ctx.lineTo(sx + 6, storeY);
      ctx.moveTo(sx + w - 6, storeY - 5);
      ctx.lineTo(sx + w - 6, storeY);
      ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.4)"; // recessed storefront wall
      ctx.fillRect(sx + 3, storeY, w - 6, 28);
      const winW = w - 30; // big lit display window
      ctx.fillStyle = "#ffe6a2";
      ctx.fillRect(sx + 6, storeY + 4, winW, 18);
      ctx.strokeStyle = "rgba(70,45,22,0.55)";
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 6, storeY + 4, winW, 18);
      ctx.beginPath();
      ctx.moveTo(sx + 6 + winW / 2, storeY + 4);
      ctx.lineTo(sx + 6 + winW / 2, storeY + 22);
      ctx.moveTo(sx + 6, storeY + 13);
      ctx.lineTo(sx + 6 + winW, storeY + 13);
      ctx.stroke();
      this.emitters.push({ sprite: this.warmGlow, x: sx + 6 + winW / 2 - 26, y: storeY + 13 - 22, w: 52, h: 44, alpha: 0.5 + 0.06 * Math.sin(this.time * 1.7 + sx) });
      const doorX = sx + w - 21; // entrance
      ctx.fillStyle = "#17140f";
      ctx.fillRect(doorX, storeY + 2, 15, 26);
      ctx.fillStyle = "#ffe9a0";
      ctx.fillRect(doorX + 2, storeY + 3.5, 11, 2.5);
      ctx.fillStyle = "#c9a24a";
      ctx.fillRect(doorX + 11, storeY + 15, 1.6, 3.5);
      ctx.fillStyle = "#33302a"; // threshold step
      ctx.fillRect(doorX - 2, baseY - 3, 19, 3);

      // --- Illuminated sign fascia ---
      const signY = storeY - 16;
      ctx.fillStyle = "rgba(8,7,6,0.92)";
      ctx.fillRect(sx + 3, signY, w - 6, 12);
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.strokeRect(sx + 3, signY, w - 6, 12);
      ctx.font = `bold 8px ${FONT_UI}`;
      const glowColor = shade(s.color, 1.95);
      ctx.save();
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 7;
      ctx.fillStyle = glowColor;
      ctx.textBaseline = "middle";
      const tw = ctx.measureText(s.label).width;
      ctx.fillText(s.label, sx + (w - tw) / 2, signY + 6.5);
      ctx.restore();
      ctx.textBaseline = "top";

      // --- Ground-level identity props ---
      if (s.id === "fuel") {
        ctx.fillStyle = "#8a2f22"; // pump bollard
        ctx.fillRect(sx - 16, baseY - 18, 9, 15);
        ctx.fillStyle = "#ffe9a0";
        ctx.fillRect(sx - 14, baseY - 15, 5, 4);
        ctx.strokeStyle = "#23211e";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx - 9, baseY - 12);
        ctx.quadraticCurveTo(sx - 2, baseY - 24, sx + 4, storeY + 10);
        ctx.stroke();
        ctx.fillStyle = "#d9a11e"; // hazard stripes
        ctx.fillRect(sx - 18, baseY - 3, 13, 3);
        ctx.fillStyle = "#1a1712";
        for (let hs = sx - 18; hs < sx - 6; hs += 4) ctx.fillRect(hs, baseY - 3, 2, 3);
      } else if (s.id === "trader") {
        ctx.fillStyle = "#3d3a36"; // ore skip
        ctx.beginPath();
        ctx.moveTo(sx + w + 4, baseY - 4);
        ctx.lineTo(sx + w + 7, baseY - 18);
        ctx.lineTo(sx + w + 25, baseY - 18);
        ctx.lineTo(sx + w + 28, baseY - 4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#2a2824";
        ctx.fillRect(sx + w + 6, baseY - 4, 22, 2);
        for (const [ox, oc] of [
          [10, "#f0c020"],
          [16, "#c9ccd4"],
          [21, "#b3703a"],
        ] as const) {
          ctx.fillStyle = oc;
          ctx.beginPath();
          ctx.arc(sx + w + ox, baseY - 17, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = "#7a3f1f"; // tool cart
        ctx.fillRect(sx + w + 4, baseY - 12, 16, 9);
        ctx.fillStyle = "#5a2f17";
        ctx.fillRect(sx + w + 4, baseY - 12, 16, 2);
        ctx.fillStyle = "#c9ccd4";
        ctx.fillRect(sx + w + 6, baseY - 9, 5, 1.5);
        ctx.fillStyle = "#23211e";
        ctx.beginPath();
        ctx.arc(sx + w + 8, baseY - 3, 2, 0, Math.PI * 2);
        ctx.arc(sx + w + 16, baseY - 3, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.font = `14px ${FONT_UI}`;
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

    // The pod reads as a machine reacting to its own motion. Two anchors carry
    // the whole rig (body, drill, thruster): the tracks (base) for the landing
    // squash and idle breathe so nothing floats, and the body centre for the
    // airborne bank.
    const bodyCx = sx + w / 2;
    const bodyCy = sy + h / 2;
    const baseY = sy + h; // the tracks — kept planted

    // Banking eases in only while airborne, so a grounded pod drives level
    // instead of leaning left/right; it eases back in on lift-off (no snap).
    this.bankLevel += ((p.grounded ? 0 : 1) - this.bankLevel) * (1 - Math.exp(-10 * this.frameDt));
    const bank = clamp(p.vx / PHYSICS.maxVx, -1, 1) * POD_ANIM.bank * this.bankLevel;

    // Idle settle: once the pod has been still (not moving, thrusting, or
    // drilling) past a short delay, a slow vertical breathe fades in — anchored
    // at the tracks, so it idles in place rather than levitating.
    const still = !game.isThrusting && !p.hasDigTarget && Math.hypot(p.vx, p.vy) < POD_ANIM.idleSpeed;
    this.idleTime = still ? this.idleTime + this.frameDt : 0;
    this.idleBob += ((this.idleTime > POD_ANIM.idleDelay ? 1 : 0) - this.idleBob) * (1 - Math.exp(-5 * this.frameDt));
    const breathe = 1 + Math.sin(this.time * POD_ANIM.idleHz * Math.PI * 2) * POD_ANIM.idleAmp * this.idleBob;

    ctx.save();
    // Landing squash + idle breathe: vertical scale anchored at the tracks.
    ctx.translate(bodyCx, baseY);
    ctx.scale(1 + this.suspension * 0.16, (1 - this.suspension * 0.26) * breathe);
    ctx.translate(-bodyCx, -baseY);
    // Airborne bank: lean around the body centre.
    if (bank !== 0) {
      ctx.translate(bodyCx, bodyCy);
      ctx.rotate(bank);
      ctx.translate(-bodyCx, -bodyCy);
    }

    // Thruster flame: layered, flickering, glowing. The soft glow is emissive
    // (replayed after the darkness); the flame body stays here in the albedo
    // pass — it sits inside the pod's own headlamp halo, so it reads bright.
    if (game.isThrusting && game.state === "playing") {
      const len = 11 + Math.random() * 6;
      this.emitters.push({ sprite: this.warmGlow, x: sx + w / 2 - 24, y: sy + h + 2 - 24, w: 48, h: 48, alpha: 0.8 });
      // The engine casts a warm glow down the shaft below the pod.
      if (this.darkness > 0.01) {
        this.pushLight(sx + w / 2, sy + h + 8, LIGHT.thruster.radius, LIGHT.thruster.color, LIGHT.thruster.intensity, LIGHT.thruster.wash);
      }
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

    // Mechanical greebles: corner rivets, a louvred vent, and blinking status
    // LEDs — small details that make the pod read as a built machine.
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    for (const [rx, ry] of [[3.5, 3.5], [w - 5, 3.5], [4, h - 10], [w - 5.5, h - 10]] as const) {
      ctx.fillRect(sx + rx, sy + ry, 1.4, 1.4);
    }
    const ventX = p.facing === 1 ? sx + 3.5 : sx + w - 8.5;
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(ventX, sy + h * 0.42 + i * 2.2);
      ctx.lineTo(ventX + 5, sy + h * 0.42 + i * 2.2);
      ctx.stroke();
    }
    const ledX = sx + w / 2 - p.facing * 8.5;
    const led1 = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.time * 3.1));
    const led2 = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.time * 1.7 + 1.5));
    ctx.fillStyle = `rgba(90,240,130,${led1.toFixed(2)})`;
    ctx.fillRect(ledX, sy + h * 0.48, 1.5, 1.5);
    ctx.fillStyle = `rgba(255,180,70,${led2.toFixed(2)})`;
    ctx.fillRect(ledX, sy + h * 0.48 + 3, 1.5, 1.5);

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

    if (viewPrefs.headlampBeam) {
      // Headlamp fixture bolted to the pod's roof — a squat housing with a warm
      // lens. It stays put (the projected beam does the aiming), so it reads as
      // mounted rather than hand-held.
      const lampX = sx + w / 2;
      const lampY = sy - 1;
      ctx.fillStyle = "#31333a"; // housing shell
      ctx.beginPath();
      ctx.roundRect(lampX - 5.5, lampY - 3, 11, 7, [3, 3, 1, 1]);
      ctx.fill();
      ctx.fillStyle = "#43454e"; // top edge highlight
      ctx.beginPath();
      ctx.roundRect(lampX - 5.5, lampY - 3, 11, 2, [3, 3, 0, 0]);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(lampX - 5.5, lampY - 3, 11, 7, [3, 3, 1, 1]);
      ctx.stroke();
      ctx.fillStyle = "#ffe6a6"; // lens
      ctx.beginPath();
      ctx.ellipse(lampX, lampY + 1, 3.4, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff8e0"; // hot core
      ctx.beginPath();
      ctx.ellipse(lampX, lampY + 0.5, 1.7, 1.2, 0, 0, Math.PI * 2);
      ctx.fill();
      // Warm glow at the lens (emissive — replayed after the darkness).
      this.emitters.push({ sprite: this.warmGlow, x: lampX - 16, y: lampY - 15, w: 32, h: 32, alpha: 0.32 + 0.5 * this.darkness });
    } else {
      // Fixed lamp on the leading edge (all-round-glow mode).
      const lampX = sx + (p.facing === 1 ? w - 2 : 2);
      const lampY = sy + h * 0.3;
      ctx.fillStyle = "#e8e4d8";
      ctx.beginPath();
      ctx.roundRect(lampX - 2, lampY - 2, 4, 4, 1.5);
      ctx.fill();
      if (this.darkness > 0.12) {
        this.emitters.push({ sprite: this.warmGlow, x: lampX - 16, y: lampY - 16, w: 32, h: 32, alpha: 0.55 * this.darkness });
      }
    }

    // Damage warning beacon: a red light on the hull roof blinks once the pod
    // is badly hurt, urgency rising as the hull falls.
    if (p.hull / p.maxHull < POD_ANIM.damageHull && game.state === "playing") {
      const sev = 1 - p.hull / p.maxHull / POD_ANIM.damageHull; // 0 at threshold → 1 near death
      const warn = 0.5 + 0.5 * Math.sin(this.time * (7 + sev * 10));
      ctx.fillStyle = `rgba(255,60,40,${(0.35 + warn * 0.65).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(sx + w / 2, sy + 1, 1.8, 0, Math.PI * 2);
      ctx.fill();
      this.emitters.push({ sprite: this.warmGlow, x: sx + w / 2 - 9, y: sy + 1 - 9, w: 18, h: 18, alpha: warn * 0.4 });
    }

    ctx.restore();
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

  /** Slow dust motes drifting through the headlight beam. */
  private drawMotes(ctx: CanvasRenderingContext2D, podX: number, podY: number): void {
    if (this.darkness < 0.15) return;
    const r = LIGHT.radius * 0.8;
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

  /** Scanner upgrade: mark ore within range, pulsing through rock and darkness. */
  private drawScanner(ctx: CanvasRenderingContext2D, game: Game, zoom: number): void {
    const p = game.player;
    if (p.scanRange <= 0 || game.state !== "playing") return;
    const cam = game.camera;
    const podCol = Math.floor((p.x + p.width / 2) / TILE);
    const podRow = Math.floor((p.y + p.height / 2) / TILE);
    const R = Math.round(p.scanRange);
    const pulse = 0.55 + 0.45 * Math.sin(this.time * 3);
    ctx.save();
    ctx.scale(zoom, zoom);
    ctx.globalCompositeOperation = "lighter";
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue;
        const tx = podCol + dx;
        const ty = podRow + dy;
        const tile = game.world.getTile(tx, ty);
        if (TILE_DEFS[tile].value <= 0) continue;
        const sx = tx * TILE - cam.x + TILE / 2;
        const sy = ty * TILE - cam.y + TILE / 2;
        ctx.globalAlpha = 0.4 + pulse * 0.4;
        ctx.fillStyle = TILE_DEFS[tile].color;
        ctx.beginPath();
        ctx.arc(sx, sy, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
  }

  /** Dev pace readout for balance tuning (toggled in the menu). */
  private drawTelemetry(ctx: CanvasRenderingContext2D, game: Game, dt: number): void {
    this.fpsAvg += (1 / Math.max(dt, 1e-4) - this.fpsAvg) * 0.1;
    const p = game.player;
    const depth = game.depth;
    const digRate = (0.25 * hardnessScaleAt(depth)) / Math.max(0.01, game.drillPower);
    const secs = Math.floor(game.runTime % 60)
      .toString()
      .padStart(2, "0");
    const perMin = game.runTime > 2 ? Math.round((game.money / game.runTime) * 60) : 0;
    const lines = [
      `FPS    ${Math.round(this.fpsAvg)}`,
      `TIME   ${Math.floor(game.runTime / 60)}:${secs}`,
      `DEPTH  ${depth} / ${game.maxDepth}m  goal ${SLICE.goalDepth}`,
      `FUEL   ${Math.round(p.fuel)}/${p.maxFuel}`,
      `MONEY  $${game.money}  ${perMin}/min`,
      `BAY    ${cargoUnits(p.cargo)}/${p.cargoCapacity}`,
      `DIG    ${digRate.toFixed(2)} s/tile`,
      `DEATHS ${game.deaths}`,
    ];
    const vw = ctx.canvas.clientWidth;
    ctx.font = `11px ${FONT_UI}`;
    ctx.textBaseline = "top";
    const w = 176;
    const x = vw - w - 12;
    const y = 150;
    ctx.fillStyle = "rgba(6,10,16,0.8)";
    ctx.beginPath();
    ctx.roundRect(x, y, w, lines.length * 15 + 16, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(140,200,255,0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#bfe0ff";
    lines.forEach((l, i) => ctx.fillText(l, x + 10, y + 9 + i * 15));
    ctx.font = `14px ${FONT_UI}`;
  }

  private drawVignette(ctx: CanvasRenderingContext2D, vw: number, vh: number): void {
    // The vignette only changes on resize — cache it instead of rebuilding the
    // gradient every frame (avoids per-frame allocation / GC churn).
    const key = `${vw}x${vh}`;
    if (this.vignetteKey !== key || !this.vignetteGrad) {
      const grad = ctx.createRadialGradient(
        vw / 2,
        vh / 2,
        Math.min(vw, vh) * 0.45,
        vw / 2,
        vh / 2,
        Math.max(vw, vh) * 0.75,
      );
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, `rgba(0,0,0,${POST.vignette})`);
      this.vignetteGrad = grad;
      this.vignetteKey = key;
    }
    ctx.fillStyle = this.vignetteGrad;
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
    grad.addColorStop(1, `rgba(200,30,10,${(this.flash * POST.flash).toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, vw, vh);
  }

  // --- Screens -------------------------------------------------------------

  private drawTitleScreen(ctx: CanvasRenderingContext2D, game: Game): void {
    const vw = ctx.canvas.clientWidth;
    const vh = ctx.canvas.clientHeight;
    const t = this.time;
    const cx = vw / 2;
    const ly = vh * 0.33; // logo baseline

    // Cinematic wash over the living sky: darker top & bottom, warm centre glow.
    const wash = ctx.createLinearGradient(0, 0, 0, vh);
    wash.addColorStop(0, "rgba(6,4,10,0.74)");
    wash.addColorStop(0.5, "rgba(8,5,4,0.4)");
    wash.addColorStop(1, "rgba(5,3,2,0.82)");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, vw, vh);
    const glow = ctx.createRadialGradient(cx, ly, 10, cx, ly, vw * 0.42);
    glow.addColorStop(0, "rgba(255,178,60,0.15)");
    glow.addColorStop(1, "rgba(255,178,60,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, vw, vh);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Logo: bevelled, gold-gradient, softly glowing MOTHERLOAD.
    const size = Math.min(74, vw / 8.2);
    ctx.font = `900 ${size}px ${FONT_DISPLAY}`;
    ctx.letterSpacing = `${(size * 0.05).toFixed(1)}px`;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillText("MOTHERLOAD", cx + 3, ly + 4); // drop shadow
    const grad = ctx.createLinearGradient(0, ly - size * 0.55, 0, ly + size * 0.55);
    grad.addColorStop(0, "#fff0b4");
    grad.addColorStop(0.5, "#f0c020");
    grad.addColorStop(1, "#bd7a1a");
    ctx.save();
    ctx.shadowColor = `rgba(255,180,60,${(0.35 + 0.25 * Math.sin(t * 1.5)).toFixed(3)})`;
    ctx.shadowBlur = 26;
    ctx.fillStyle = grad;
    ctx.fillText("MOTHERLOAD", cx, ly);
    ctx.restore();
    ctx.letterSpacing = "0px";

    // Mood subtitle + a thin rule + a demo tag.
    ctx.font = `600 ${Math.min(15, vw / 62)}px ${FONT_UI}`;
    ctx.fillStyle = "rgba(232,214,184,0.85)";
    ctx.fillText("A  S U B T E R R A N E A N   D E S C E N T", cx, ly + size * 0.7);
    ctx.strokeStyle = "rgba(255,200,110,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 150, ly + size * 0.95);
    ctx.lineTo(cx + 150, ly + size * 0.95);
    ctx.stroke();
    ctx.font = `11px ${FONT_UI}`;
    ctx.fillStyle = "rgba(140,200,255,0.7)";
    ctx.fillText("◈  PRE-ALPHA DEMO", cx, ly + size * 1.18);

    // Menu prompts.
    const py = vh * 0.63;
    const prompt = 0.72 + 0.28 * Math.sin(t * 3);
    ctx.font = `bold 20px ${FONT_UI}`;
    ctx.fillStyle = `rgba(255,233,122,${prompt.toFixed(3)})`;
    ctx.fillText(game.hasSave ? "▸  CONTINUE" : "▸  START DIGGING", cx, py);
    ctx.font = `13px ${FONT_UI}`;
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText("press  [ Enter ]", cx, py + 26);
    if (game.hasSave) {
      ctx.fillStyle = "rgba(216,201,184,0.8)";
      ctx.fillText("[ N ]  new game  ·  overwrites save", cx, py + 50);
    }

    // Season picker. Only ever affects a *new* run — a continued save carries
    // the season its world was generated under — so it's labelled as such.
    const pick = SEASONS[game.titleSeason]!;
    const sy = py + (game.hasSave ? 88 : 62);
    ctx.font = `bold 9px ${FONT_UI}`;
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.letterSpacing = "3px";
    ctx.fillText("NEW GAME SEASON", cx, sy);
    ctx.letterSpacing = "0px";
    const sicon = iconCanvas(pick.look.iconId as IconId, 18);
    ctx.font = `bold 17px ${FONT_UI}`;
    const nameW = ctx.measureText(pick.name.toUpperCase()).width;
    ctx.drawImage(sicon, cx - nameW / 2 - 26, sy + 20, 18, 18);
    ctx.fillStyle = pick.look.accent;
    ctx.fillText(pick.name.toUpperCase(), cx, sy + 22);
    ctx.font = `12px ${FONT_UI}`;
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillText(`◂  ${pick.tagline}  ▸`, cx, sy + 46);
    ctx.font = `11px ${FONT_UI}`;
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fillText(pick.summary, cx, sy + 66);

    // Controls, along the bottom.
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = `12px ${FONT_UI}`;
    ctx.fillText("← →  move    ↑  thrust    ↓  drill    E  station", cx, vh - 28);

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = `14px ${FONT_UI}`;
  }

  private drawBriefingScreen(ctx: CanvasRenderingContext2D, game: Game, vw: number, vh: number): void {
    ctx.fillStyle = "rgba(6,9,16,0.82)";
    ctx.fillRect(0, 0, vw, vh);
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(142,200,255,0.85)";
    ctx.font = `bold 12px ${FONT_UI}`;
    center(ctx, "◈ INCOMING TRANSMISSION", vw, vh * 0.24);
    ctx.fillStyle = "#8ec8ff";
    ctx.font = `bold 34px ${FONT_DISPLAY}`;
    center(ctx, "THE SIGNAL", vw, vh * 0.24 + 22);
    ctx.fillStyle = "#d8e6ff";
    ctx.font = `15px ${FONT_UI}`;
    const lines = [
      `Deep-scan has flagged an anomaly ${SLICE.goalDepth} metres down.`,
      "Mine minerals to fund your rig, upgrade the drill and tank,",
      "and descend to reach it. There's no refuelling down there —",
      "watch your gauge, and don't get greedy.",
      // The season's own flavour line — data, so a new season needs no code here.
      game.season.briefing,
    ];
    lines.forEach((l, i) => center(ctx, l, vw, vh * 0.24 + 80 + i * 24));
    const pulse = 0.7 + 0.3 * Math.sin(this.time * 3);
    ctx.fillStyle = `rgba(255,233,122,${pulse})`;
    ctx.font = `17px ${FONT_UI}`;
    center(ctx, "[Enter] begin descent", vw, vh * 0.24 + 80 + lines.length * 24 + 24);
    ctx.font = `14px ${FONT_UI}`;
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
    ctx.font = `bold 30px ${FONT_DISPLAY}`;
    center(ctx, "POD LOST", viewWidth, viewHeight * 0.4 - (1 - reveal) * 12);
    ctx.fillStyle = "#ffffff";
    ctx.font = `15px ${FONT_UI}`;
    center(ctx, game.deathCause, viewWidth, viewHeight * 0.4 + 46);
    center(ctx, `Salvage fee $${game.salvageFeeDue} · cargo and supplies lost`, viewWidth, viewHeight * 0.4 + 70);
    ctx.globalAlpha = promptIn;
    ctx.fillStyle = "#ffe97a";
    center(ctx, "[Enter] launch replacement pod", viewWidth, viewHeight * 0.4 + 106);
    ctx.globalAlpha = 1;
    ctx.font = `14px ${FONT_UI}`;
  }

  private drawWinScreen(ctx: CanvasRenderingContext2D, game: Game, t: number): void {
    const vw = ctx.canvas.clientWidth;
    const vh = ctx.canvas.clientHeight;
    const s = game.runStats();
    const secs = Math.floor(s.time % 60)
      .toString()
      .padStart(2, "0");
    const time = `${Math.floor(s.time / 60)}:${secs}`;
    // Reveal the title first, then the stats one by one, then the prompt.
    const reveal = clamp(t / 0.5, 0, 1);

    ctx.fillStyle = `rgba(4,8,16,${(0.82 * reveal).toFixed(3)})`;
    ctx.fillRect(0, 0, vw, vh);
    ctx.textBaseline = "top";
    ctx.globalAlpha = reveal;
    ctx.fillStyle = "rgba(142,200,255,0.8)";
    ctx.font = `bold 12px ${FONT_UI}`;
    center(ctx, "◈ DEMO COMPLETE", vw, vh * 0.3 - (1 - reveal) * 10);
    ctx.fillStyle = "#8ec8ff";
    ctx.font = `bold 32px ${FONT_DISPLAY}`;
    center(ctx, "ANOMALY REACHED", vw, vh * 0.3 + 24 - (1 - reveal) * 10);
    ctx.fillStyle = "#d8e6ff";
    ctx.font = `15px ${FONT_UI}`;
    center(ctx, "You've reached the signal at the bottom of the world.", vw, vh * 0.3 + 70);

    ctx.font = `15px ${FONT_UI}`;
    ctx.fillStyle = "#ffffff";
    const stats = [
      `Depth reached    ${s.depth} m`,
      `Minerals banked  $${s.money.toLocaleString()}`,
      `Time             ${time}`,
      `Pods lost        ${s.deaths}`,
    ];
    stats.forEach((line, i) => {
      ctx.globalAlpha = clamp((t - (0.6 + i * 0.18)) / 0.35, 0, 1);
      center(ctx, line, vw, vh * 0.3 + 108 + i * 26);
    });

    ctx.globalAlpha = clamp((t - (0.6 + stats.length * 0.18 + 0.25)) / 0.35, 0, 1);
    ctx.fillStyle = "#ffe97a";
    ctx.font = `16px ${FONT_UI}`;
    center(ctx, "[Enter] keep exploring", vw, vh * 0.3 + 108 + stats.length * 26 + 24);
    ctx.globalAlpha = 1;
    ctx.font = `14px ${FONT_UI}`;
  }
}

function center(ctx: CanvasRenderingContext2D, text: string, viewWidth: number, y: number): void {
  ctx.fillText(text, (viewWidth - ctx.measureText(text).width) / 2, y);
}
