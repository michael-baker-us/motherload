import { clamp } from "../engine/math";
import { SEASON } from "../game/config";
import { mulberry32 } from "../game/rng";
import type { Camera } from "../engine/camera";
import type { FloraPalette, SeasonLook } from "../game/seasons";
import { bakeCloud, bakePuff } from "./bake";

interface Star {
  u: number;
  v: number;
  size: number;
  phase: number;
  speed: number;
}

interface Cloud {
  u: number;
  v: number;
  scale: number;
  alpha: number;
  speed: number;
}

interface Ridge {
  points: number[];
  parallax: number;
  base: number;
}

interface Structure {
  u: number;
  type: number; // 0 derrick · 1 smokestack · 2 tank · 3 crane
  scale: number;
  lit: number; // 0..1 seed for window lights
  blink: number; // phase offset for the aviation beacon
}

interface Tree {
  u: number;
  scale: number;
  /** Index into the season's canopy tones. */
  tone: number;
  /** Trunk lean, radians. */
  lean: number;
  /** Per-tree jitter so canopies and branches don't repeat. */
  seed: number;
}

/**
 * The skybox: gradient, stars, sun + moon, drifting clouds, horizon haze,
 * parallax ridges, an industrial skyline, and two bands of trees.
 *
 * Every *colour* here comes from the active season's palette (game/seasons.ts);
 * every *shape* is baked once in the constructor from a fixed seed. That split
 * is what makes seasons cheap: the geometry is season-independent, so switching
 * season re-reads a palette rather than regenerating the world's backdrop.
 * Gradients and sprites that would otherwise be rebuilt per frame are cached
 * per palette, the same way PostFX caches its haze.
 */
export class Sky {
  private readonly stars: Star[] = [];
  private readonly clouds: Cloud[] = [];
  private readonly ridges: Ridge[];
  private readonly structures: Structure[] = [];
  private readonly farTrees: Tree[] = [];
  private readonly nearTrees: Tree[] = [];
  private readonly puff = bakePuff(40);

  // Per-palette caches. A run touches one entry; the dev season switcher adds
  // at most one per season.
  private readonly cloudSprites = new Map<string, HTMLCanvasElement>();
  private gradKey = "";
  private grad: CanvasGradient | null = null;

  constructor() {
    const rand = mulberry32(4242);
    for (let i = 0; i < 110; i++) {
      this.stars.push({
        u: rand(),
        v: rand(),
        size: rand() > 0.85 ? 1.6 : 1,
        phase: rand() * Math.PI * 2,
        speed: 0.6 + rand() * 2.4,
      });
    }
    for (let i = 0; i < 8; i++) {
      this.clouds.push({
        u: rand(),
        v: rand(),
        scale: 0.7 + rand() * 1.1,
        alpha: 0.5 + rand() * 0.5, // scaled by the palette's cloud alpha
        speed: 4 + rand() * 7,
      });
    }

    const ridge = (parallax: number, base: number): Ridge => {
      const points: number[] = [];
      let h = 30 + rand() * 20;
      for (let i = 0; i <= 80; i++) {
        h = clamp(h + (rand() - 0.5) * 22, 8, 78);
        points.push(h);
      }
      return { points, parallax, base };
    };
    // Far → near. Colours come from the palette at draw time.
    this.ridges = [ridge(0.1, 66), ridge(0.22, 42), ridge(0.4, 18)];

    // A distant mining-outpost skyline standing on the horizon.
    for (let i = 0; i < 12; i++) {
      this.structures.push({
        u: rand(),
        type: Math.floor(rand() * 4),
        scale: 0.75 + rand() * 0.7,
        lit: rand(),
        blink: rand() * Math.PI * 2,
      });
    }

    // Treelines, generated last so every value above keeps its original stream
    // position — the backdrop's geometry is unchanged by adding seasons.
    const tree = (minScale: number, range: number): Tree => ({
      u: rand(),
      scale: minScale + rand() * range,
      tone: Math.floor(rand() * 3),
      lean: (rand() - 0.5) * 0.22,
      seed: rand() * 1000,
    });
    for (let i = 0; i < SEASON.flora.treeline; i++) this.farTrees.push(tree(0.5, 0.35));
    for (let i = 0; i < SEASON.flora.props; i++) this.nearTrees.push(tree(0.85, 0.6));
  }

  draw(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    surfaceY: number,
    time: number,
    look: SeasonLook,
  ): void {
    const vw = cam.viewWidth;
    const vh = cam.viewHeight;
    const horizon = surfaceY - cam.y; // screen y of the surface line
    const sky = look.sky;

    // The gradient is identical every frame for a given season + view height.
    const key = `${vh}|${sky.gradient.join()}`;
    if (key !== this.gradKey || !this.grad) {
      const g = ctx.createLinearGradient(0, 0, 0, vh);
      g.addColorStop(0, sky.gradient[0]);
      g.addColorStop(0.45, sky.gradient[1]);
      g.addColorStop(0.78, sky.gradient[2]);
      g.addColorStop(1, sky.gradient[3]);
      this.grad = g;
      this.gradKey = key;
    }
    ctx.fillStyle = this.grad;
    ctx.fillRect(0, 0, vw, vh);

    // Everything else only matters while the surface is anywhere near view.
    if (horizon < -40) return;

    // Stars, twinkling, fading toward the horizon glow. A bright season dims
    // them to nothing rather than special-casing them away.
    if (sky.stars > 0) {
      ctx.save();
      for (const s of this.stars) {
        const sx =
          (((s.u * vw * 1.4 - cam.x * 0.05) % (vw * 1.4)) + vw * 1.4) % (vw * 1.4) - vw * 0.2;
        const sy = s.v * vh * 0.55 - cam.y * 0.05;
        if (sy < -5 || (horizon > 0 && sy > horizon - 30)) continue;
        const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * s.speed + s.phase));
        const horizonFade = clamp(1 - sy / (vh * 0.55), 0.15, 1);
        ctx.globalAlpha = twinkle * horizonFade * 0.9 * sky.stars;
        ctx.fillStyle = "#e8ecff";
        ctx.fillRect(sx, sy, s.size, s.size);
      }
      ctx.restore();
    }

    // The sun, with a warm bloom. `rise` puts it low in autumn/winter for long
    // raking light and high overhead in summer.
    const sunX = vw * 0.72 - cam.x * 0.08;
    const sunY = horizon - sky.sun.rise - cam.y * 0.02;
    const r = sky.sun.radius;
    const bloom = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, r);
    bloom.addColorStop(0, sky.sun.core);
    bloom.addColorStop(0.2, sky.sun.mid);
    bloom.addColorStop(1, withAlpha(sky.sun.mid, 0));
    ctx.fillStyle = bloom;
    ctx.fillRect(sunX - r, sunY - r, r * 2, r * 2);

    if (sky.moon > 0) {
      const moonX = vw * 0.2 - cam.x * 0.04;
      const moonY = vh * 0.16 - cam.y * 0.04;
      ctx.globalAlpha = sky.moon;
      ctx.fillStyle = "rgba(220,225,240,0.75)";
      ctx.beginPath();
      ctx.arc(moonX, moonY, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = withAlpha(sky.gradient[0], 0.55);
      ctx.beginPath();
      ctx.arc(moonX - 3, moonY - 2, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Drifting cloud wisps — the palette sets how many, how bright, what tint.
    const cloudSprite = this.cloud(sky.cloud.color);
    for (let i = 0; i < Math.min(sky.cloud.count, this.clouds.length); i++) {
      const c = this.clouds[i]!;
      const cw = 160 * c.scale;
      const range = vw + cw * 2;
      const cx = ((((c.u * range + time * c.speed - cam.x * 0.12) % range) + range) % range) - cw;
      const cy = horizon - 90 - c.v * 150 - cam.y * 0.08;
      if (cy < -60) continue;
      ctx.globalAlpha = c.alpha * sky.cloud.alpha;
      ctx.drawImage(cloudSprite, cx, cy, cw, 56 * c.scale);
    }
    ctx.globalAlpha = 1;

    // Haze hugging the horizon.
    if (horizon > 0 && sky.haze.alpha > 0) {
      const hazeH = 130;
      const haze = ctx.createLinearGradient(0, horizon - hazeH, 0, horizon);
      haze.addColorStop(0, withAlpha(sky.haze.color, 0));
      haze.addColorStop(1, withAlpha(sky.haze.color, sky.haze.alpha));
      ctx.fillStyle = haze;
      ctx.fillRect(0, horizon - hazeH, vw, hazeH);
    }

    // Far → near: two hazy ridges, the outpost skyline, a distant treeline
    // tucked behind the nearest hill, then the near hill and its treeline.
    this.drawRidge(ctx, this.ridges[0]!, sky.ridges[0]!, cam, horizon, vw);
    this.drawRidge(ctx, this.ridges[1]!, sky.ridges[1]!, cam, horizon, vw);
    this.drawStructures(ctx, cam, horizon, time, vw, sky.structure);
    this.drawTreeline(ctx, cam, horizon, vw, look.flora);
    this.drawRidge(ctx, this.ridges[2]!, sky.ridges[2]!, cam, horizon, vw);
    this.drawTrees(ctx, cam, horizon, vw, look.flora);
  }

  private cloud(rgb: string): HTMLCanvasElement {
    let sprite = this.cloudSprites.get(rgb);
    if (!sprite) {
      sprite = bakeCloud(rgb);
      this.cloudSprites.set(rgb, sprite);
    }
    return sprite;
  }

  private drawRidge(
    ctx: CanvasRenderingContext2D,
    ridge: Ridge,
    tone: readonly [string, string],
    cam: Camera,
    horizon: number,
    vw: number,
  ): void {
    const step = 26;
    const offset = cam.x * ridge.parallax;
    const crest = ridge.base + 80;
    const fill = ctx.createLinearGradient(0, horizon - crest, 0, horizon);
    fill.addColorStop(0, tone[0]);
    fill.addColorStop(1, tone[1]);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    for (let sx = 0; sx <= vw + step; sx += step) {
      const i = Math.floor((sx + offset) / step);
      const h = ridge.points[((i % ridge.points.length) + ridge.points.length) % ridge.points.length]!;
      ctx.lineTo(sx, horizon - ridge.base - h);
    }
    ctx.lineTo(vw, horizon);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * The distant forest: flat silhouettes at ridge parallax, so autumn reads as
   * an orange mass on the hills and winter as bare grey scrub, at no per-tree
   * detail cost.
   */
  private drawTreeline(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    horizon: number,
    vw: number,
    flora: FloraPalette,
  ): void {
    const parallax = 0.34;
    const band = vw * 1.8;
    const offset = cam.x * parallax;
    ctx.fillStyle = flora.treeline;
    for (const t of this.farTrees) {
      const x = ((((t.u * band - offset) % band) + band) % band) - band * 0.1;
      if (x < -40 || x > vw + 40) continue;
      const h = 22 + t.scale * 26;
      const w = h * 0.42;
      const y = horizon - 12;
      if (flora.kind === "bare") {
        ctx.fillRect(x - 1, y - h, 2, h);
        ctx.beginPath();
        ctx.moveTo(x - w * 0.5, y - h * 0.55);
        ctx.lineTo(x, y - h);
        ctx.lineTo(x + w * 0.5, y - h * 0.55);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(x - 1.4, y - h * 0.45, 2.8, h * 0.45);
        ctx.beginPath();
        ctx.ellipse(x, y - h * 0.68, w * 0.66, h * 0.36, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /**
   * The near treeline standing on the surface line — the layer that actually
   * announces the season. Four painters keyed off `flora.kind`; a new season
   * reuses one by naming it in its palette.
   */
  private drawTrees(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    horizon: number,
    vw: number,
    flora: FloraPalette,
  ): void {
    if (horizon < -20) return;
    const parallax = 0.55;
    const band = vw * 2.2;
    const offset = cam.x * parallax;
    for (const t of this.nearTrees) {
      const x = ((((t.u * band - offset) % band) + band) % band) - band * 0.1;
      if (x < -60 || x > vw + 60) continue;
      const h = (40 + t.scale * 46) * SEASON.flora.density;
      ctx.save();
      ctx.translate(x, horizon + 2);
      ctx.rotate(t.lean * 0.35);

      // Trunk: a taper, wider at the root.
      ctx.fillStyle = flora.trunk;
      ctx.beginPath();
      ctx.moveTo(-h * 0.055, 0);
      ctx.lineTo(-h * 0.022, -h * 0.62);
      ctx.lineTo(h * 0.022, -h * 0.62);
      ctx.lineTo(h * 0.055, 0);
      ctx.closePath();
      ctx.fill();

      if (flora.kind === "bare") this.paintBare(ctx, h, flora);
      else this.paintCanopy(ctx, t, h, flora);

      ctx.restore();
    }
  }

  /** Winter: stripped branches with snow settled along their upper edges. */
  private paintBare(ctx: CanvasRenderingContext2D, h: number, flora: FloraPalette): void {
    ctx.strokeStyle = flora.trunk;
    ctx.lineCap = "round";
    for (let i = 0; i < 5; i++) {
      const up = 0.34 + i * 0.13;
      const dir = i % 2 === 0 ? 1 : -1;
      const len = h * (0.3 - i * 0.035);
      ctx.lineWidth = Math.max(1, h * (0.022 - i * 0.003));
      ctx.beginPath();
      ctx.moveTo(0, -h * up);
      ctx.lineTo(dir * len, -h * (up + 0.16));
      ctx.stroke();
    }
    if (!flora.accent) return;
    ctx.strokeStyle = flora.accent;
    ctx.lineWidth = Math.max(1, h * 0.014);
    for (let i = 0; i < 5; i++) {
      const up = 0.34 + i * 0.13;
      const dir = i % 2 === 0 ? 1 : -1;
      const len = h * (0.3 - i * 0.035);
      ctx.beginPath();
      ctx.moveTo(0, -h * up - 1.5);
      ctx.lineTo(dir * len, -h * (up + 0.16) - 1.5);
      ctx.stroke();
    }
  }

  /** Spring/summer/autumn: overlapping canopy lobes plus an optional accent. */
  private paintCanopy(
    ctx: CanvasRenderingContext2D,
    t: Tree,
    h: number,
    flora: FloraPalette,
  ): void {
    const lobes = flora.kind === "leafy" ? 6 : 5;
    const spread = flora.kind === "leafy" ? 0.34 : 0.3;
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * Math.PI * 2 + t.seed;
      const lx = Math.cos(a) * h * spread * 0.62;
      const ly = -h * 0.74 + Math.sin(a) * h * spread * 0.4;
      const lr = h * (0.2 + ((t.seed + i * 37) % 10) / 100);
      ctx.fillStyle = flora.canopy[(t.tone + i) % flora.canopy.length]!;
      ctx.beginPath();
      ctx.arc(lx, ly, lr, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!flora.accent) return;
    // Blossom / berry specks scattered over the canopy.
    ctx.fillStyle = flora.accent;
    for (let i = 0; i < 10; i++) {
      const a = t.seed + i * 2.399;
      const rr = h * spread * 0.72 * (0.4 + ((i * 17) % 10) / 16);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rr, -h * 0.74 + Math.sin(a) * rr * 0.62, h * 0.017, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** A distant industrial skyline: derricks, stacks, tanks, cranes. */
  private drawStructures(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    horizon: number,
    time: number,
    vw: number,
    silhouette: string,
  ): void {
    const parallax = 0.3;
    const band = vw * 1.8;
    const offset = cam.x * parallax;
    for (const s of this.structures) {
      const x = ((((s.u * band - offset) % band) + band) % band) - band * 0.1;
      if (x < -70 || x > vw + 70) continue;
      const H = 34 + s.scale * 34; // height above horizon
      const w = 12 + s.scale * 10;
      ctx.save();
      ctx.translate(x, horizon);
      ctx.fillStyle = silhouette;
      ctx.strokeStyle = silhouette;
      if (s.type === 0) {
        // Derrick: a lattice tower tapering to a point.
        ctx.beginPath();
        ctx.moveTo(-w * 0.5, 0);
        ctx.lineTo(-w * 0.16, -H);
        ctx.lineTo(w * 0.16, -H);
        ctx.lineTo(w * 0.5, 0);
        ctx.closePath();
        ctx.fill();
        ctx.lineWidth = 1;
        for (let b = 1; b <= 4; b++) {
          const t = b / 5;
          const y = -H * t;
          const hw = w * (0.5 - 0.34 * t);
          ctx.beginPath();
          ctx.moveTo(-hw, y);
          ctx.lineTo(hw, y);
          ctx.stroke();
        }
        // top marker light
        ctx.fillStyle = "#ffcf7a";
        ctx.fillRect(-1, -H - 3, 2, 2);
      } else if (s.type === 1) {
        // Smokestack: tall taper with a blinking aviation light and smoke.
        ctx.beginPath();
        ctx.moveTo(-w * 0.32, 0);
        ctx.lineTo(-w * 0.2, -H);
        ctx.lineTo(w * 0.2, -H);
        ctx.lineTo(w * 0.32, 0);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.22;
        ctx.drawImage(this.puff, -16 + Math.sin(time * 0.5 + s.blink) * 4, -H - 30, 32, 32);
        ctx.globalAlpha = 1;
        const blink = 0.5 + 0.5 * Math.sin(time * 2 + s.blink);
        ctx.fillStyle = `rgba(255,70,55,${(0.3 + blink * 0.7).toFixed(2)})`;
        ctx.fillRect(-1.5, -H - 3, 3, 3);
      } else if (s.type === 2) {
        // Storage tank: a squat domed cylinder.
        const th = H * 0.6;
        const tw = w * 1.1;
        ctx.beginPath();
        ctx.rect(-tw / 2, -th, tw, th);
        ctx.arc(0, -th, tw / 2, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = "rgba(255,207,122,0.85)";
        ctx.fillRect(-tw / 2 + 3, -th * 0.6, 2, 2);
        ctx.fillRect(tw / 2 - 5, -th * 0.6, 2, 2);
      } else {
        // Gantry crane: mast, jib, and a hanging hook line.
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -H);
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-w * 0.3, -H + 4);
        ctx.lineTo(w * 1.1, -H + 2);
        ctx.stroke();
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(w * 0.9, -H + 3);
        ctx.lineTo(w * 0.9, -H * 0.45);
        ctx.stroke();
        ctx.fillStyle = "#ffcf7a";
        ctx.fillRect(-1, -H - 2, 2, 2);
      }
      ctx.restore();
    }
  }
}

/** Re-alpha a palette colour. Handles the `#rrggbb` and `rgba(...)` forms used here. */
function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#")) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  const nums = color.match(/[\d.]+/g);
  if (!nums || nums.length < 3) return color;
  return `rgba(${nums[0]},${nums[1]},${nums[2]},${alpha})`;
}

export { withAlpha };
