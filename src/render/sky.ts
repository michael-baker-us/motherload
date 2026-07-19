import { clamp } from "../engine/math";
import { mulberry32 } from "../game/rng";
import type { Camera } from "../engine/camera";

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
  top: string;
  bottom: string;
  base: number;
}

/**
 * The dusk skybox: gradient, twinkling stars, moon + sun, drifting clouds,
 * horizon haze, and three fog-graded parallax ridges.
 */
export class Sky {
  private readonly stars: Star[] = [];
  private readonly clouds: Cloud[] = [];
  private readonly ridges: Ridge[];
  private readonly cloudSprite: HTMLCanvasElement;

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
    for (let i = 0; i < 5; i++) {
      this.clouds.push({
        u: rand(),
        v: rand(),
        scale: 0.7 + rand() * 1.1,
        alpha: 0.07 + rand() * 0.08,
        speed: 4 + rand() * 7,
      });
    }

    const ridge = (parallax: number, top: string, bottom: string, base: number): Ridge => {
      const points: number[] = [];
      let h = 30 + rand() * 20;
      for (let i = 0; i <= 80; i++) {
        h = clamp(h + (rand() - 0.5) * 22, 8, 78);
        points.push(h);
      }
      return { points, parallax, top, bottom, base };
    };
    // Far → near: hazier and lighter in the distance, darker up close.
    this.ridges = [
      ridge(0.1, "#8a5a48", "#6e4234", 66),
      ridge(0.22, "#6e3a28", "#552c1e", 42),
      ridge(0.4, "#54291c", "#3d1d14", 18),
    ];

    // Soft cloud puff, baked once.
    this.cloudSprite = document.createElement("canvas");
    this.cloudSprite.width = 160;
    this.cloudSprite.height = 56;
    const cctx = this.cloudSprite.getContext("2d")!;
    for (const [cx, cy, r] of [
      [50, 34, 26],
      [85, 26, 30],
      [120, 34, 24],
    ] as const) {
      const g = cctx.createRadialGradient(cx, cy, 2, cx, cy, r);
      g.addColorStop(0, "rgba(255,235,215,0.9)");
      g.addColorStop(1, "rgba(255,235,215,0)");
      cctx.fillStyle = g;
      cctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera, surfaceY: number, time: number): void {
    const vw = cam.viewWidth;
    const vh = cam.viewHeight;
    const horizon = surfaceY - cam.y; // screen y of the surface line

    const grad = ctx.createLinearGradient(0, 0, 0, vh);
    grad.addColorStop(0, "#131b33");
    grad.addColorStop(0.45, "#3c4a6b");
    grad.addColorStop(0.78, "#8a6a70");
    grad.addColorStop(1, "#d98e5f");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, vw, vh);

    // Everything else only matters while the surface is anywhere near view.
    if (horizon < -40) return;

    // Stars, twinkling, fading toward the horizon glow.
    ctx.save();
    for (const s of this.stars) {
      const sx = (((s.u * vw * 1.4 - cam.x * 0.05) % (vw * 1.4)) + vw * 1.4) % (vw * 1.4) - vw * 0.2;
      const sy = s.v * vh * 0.55 - cam.y * 0.05;
      if (sy < -5 || (horizon > 0 && sy > horizon - 30)) continue;
      const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * s.speed + s.phase));
      const horizonFade = clamp(1 - sy / (vh * 0.55), 0.15, 1);
      ctx.globalAlpha = twinkle * horizonFade * 0.9;
      ctx.fillStyle = "#e8ecff";
      ctx.fillRect(sx, sy, s.size, s.size);
    }
    ctx.restore();

    // Setting sun with a warm bloom, plus a small distant moon.
    const sunX = vw * 0.72 - cam.x * 0.08;
    const sunY = horizon - 88 - cam.y * 0.02;
    const bloom = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 110);
    bloom.addColorStop(0, "rgba(255,236,190,0.95)");
    bloom.addColorStop(0.2, "rgba(255,205,150,0.5)");
    bloom.addColorStop(1, "rgba(255,205,150,0)");
    ctx.fillStyle = bloom;
    ctx.fillRect(sunX - 110, sunY - 110, 220, 220);

    const moonX = vw * 0.2 - cam.x * 0.04;
    const moonY = vh * 0.16 - cam.y * 0.04;
    ctx.fillStyle = "rgba(220,225,240,0.75)";
    ctx.beginPath();
    ctx.arc(moonX, moonY, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(19,27,51,0.55)";
    ctx.beginPath();
    ctx.arc(moonX - 3, moonY - 2, 7.5, 0, Math.PI * 2);
    ctx.fill();

    // Drifting cloud wisps.
    for (const c of this.clouds) {
      const cw = 160 * c.scale;
      const range = vw + cw * 2;
      const cx = ((((c.u * range + time * c.speed - cam.x * 0.12) % range) + range) % range) - cw;
      const cy = horizon - 90 - c.v * 150 - cam.y * 0.08;
      if (cy < -60) continue;
      ctx.globalAlpha = c.alpha;
      ctx.drawImage(this.cloudSprite, cx, cy, cw, 56 * c.scale);
    }
    ctx.globalAlpha = 1;

    // Warm haze hugging the horizon.
    if (horizon > 0) {
      const hazeH = 130;
      const haze = ctx.createLinearGradient(0, horizon - hazeH, 0, horizon);
      haze.addColorStop(0, "rgba(217,142,95,0)");
      haze.addColorStop(1, "rgba(230,150,95,0.28)");
      ctx.fillStyle = haze;
      ctx.fillRect(0, horizon - hazeH, vw, hazeH);
    }

    // Parallax ridges, far to near, with vertical fog grading.
    for (const ridge of this.ridges) {
      const step = 26;
      const offset = cam.x * ridge.parallax;
      const crest = ridge.base + 80;
      const fill = ctx.createLinearGradient(0, horizon - crest, 0, horizon);
      fill.addColorStop(0, ridge.top);
      fill.addColorStop(1, ridge.bottom);
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
  }
}
