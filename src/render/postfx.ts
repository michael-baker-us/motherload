/**
 * Post-processing that runs at native resolution after the world + lighting.
 * For now: bloom. Bright emissive sources bleed a soft halo — the hallmark of
 * lava, neon, and crystals in modern 2D games.
 *
 * The bloom source is the same emissive glow decals the renderer already
 * collected (`Emitter[]`), re-blitted into a *downscaled* buffer, blurred once,
 * and added back additively. Working small keeps the (relatively pricey) blur
 * cheap; there's no scene readback, so nothing stalls the GPU pipeline.
 */
import { POST } from "../game/config";
import type { Emitter } from "./lights";

export class PostFX {
  /** Downscaled accumulation of the emissive glows. */
  private readonly buf = document.createElement("canvas");
  /** Blur scratch, same small size as `buf`. */
  private readonly scratch = document.createElement("canvas");
  // Cached full-screen gradients (rebuilt only when size / colour changes).
  private hazeGrad: CanvasGradient | null = null;
  private hazeKey = "";
  private heatGrad: CanvasGradient | null = null;
  private heatKey = "";

  /**
   * Aerial-perspective veil: the biome fog colour thickening toward the bottom
   * of the frame so the depths read as murky and voluminous. `strength` is the
   * peak alpha (typically scaled by the depth darkness), so it fades out near
   * the surface for free.
   */
  depthHaze(
    ctx: CanvasRenderingContext2D,
    fog: readonly [number, number, number],
    strength: number,
    screenW: number,
    screenH: number,
  ): void {
    if (strength <= 0.01) return;
    const key = `${screenW}x${screenH}:${fog[0]},${fog[1]},${fog[2]}`;
    if (this.hazeKey !== key || !this.hazeGrad) {
      const g = ctx.createLinearGradient(0, 0, 0, screenH);
      g.addColorStop(0, `rgba(${fog[0]},${fog[1]},${fog[2]},0.15)`);
      g.addColorStop(1, `rgba(${fog[0]},${fog[1]},${fog[2]},1)`);
      this.hazeGrad = g;
      this.hazeKey = key;
    }
    ctx.save();
    ctx.globalAlpha = Math.min(1, strength);
    ctx.fillStyle = this.hazeGrad;
    ctx.fillRect(0, 0, screenW, screenH);
    ctx.restore();
  }

  /**
   * A subtle warm shimmer rising from the bottom of the frame, its intensity
   * breathing over time — the magma biome's heat made visible without any
   * per-pixel refraction (which Canvas 2D can't do cheaply). Additive.
   */
  heatHaze(
    ctx: CanvasRenderingContext2D,
    strength: number,
    hz: number,
    time: number,
    screenW: number,
    screenH: number,
  ): void {
    const a = strength * (0.55 + 0.45 * Math.sin(time * hz * Math.PI * 2));
    if (a <= 0.004) return;
    const key = `${screenW}x${screenH}`;
    if (this.heatKey !== key || !this.heatGrad) {
      const g = ctx.createLinearGradient(0, screenH, 0, screenH * 0.35);
      g.addColorStop(0, "rgba(255,120,40,1)");
      g.addColorStop(1, "rgba(255,120,40,0)");
      this.heatGrad = g;
      this.heatKey = key;
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = a;
    ctx.fillStyle = this.heatGrad;
    ctx.fillRect(0, 0, screenW, screenH);
    ctx.restore();
  }

  /**
   * Add a bloom halo around the emissive sources. `emitters` are in the world
   * pass's space (camera-relative, pre-zoom); `zoom` + `shakeX/shakeY` map them
   * to screen just as the emissive pass does. No-op when disabled or nothing
   * emissive is on screen.
   */
  bloom(
    ctx: CanvasRenderingContext2D,
    emitters: readonly Emitter[],
    screenW: number,
    screenH: number,
    zoom: number,
    shakeX: number,
    shakeY: number,
  ): void {
    if (!POST.bloom.enabled || emitters.length === 0) return;

    const ds = POST.bloom.downscale;
    const bw = Math.max(1, Math.round(screenW * ds));
    const bh = Math.max(1, Math.round(screenH * ds));

    const buf = this.buf;
    if (buf.width !== bw || buf.height !== bh) {
      buf.width = bw;
      buf.height = bh;
    }
    const b = buf.getContext("2d")!;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.clearRect(0, 0, bw, bh);
    // world → bloom pixels: (world + shake) * zoom * downscale.
    const k = zoom * ds;
    b.setTransform(k, 0, 0, k, shakeX * k, shakeY * k);
    b.globalCompositeOperation = "lighter";
    for (const e of emitters) {
      b.globalAlpha = e.alpha;
      b.drawImage(e.sprite, e.x, e.y, e.w, e.h);
    }
    b.globalAlpha = 1;
    b.setTransform(1, 0, 0, 1, 0, 0);

    // Blur into the scratch buffer (blur radius scaled into downscaled space).
    const scratch = this.scratch;
    if (scratch.width !== bw || scratch.height !== bh) {
      scratch.width = bw;
      scratch.height = bh;
    }
    const s = scratch.getContext("2d")!;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(0, 0, bw, bh);
    s.filter = `blur(${(POST.bloom.blurPx * ds).toFixed(2)}px)`;
    s.drawImage(buf, 0, 0);
    s.filter = "none";

    // Add the blurred halo back over the frame, upscaled.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = POST.bloom.strength;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(scratch, 0, 0, bw, bh, 0, 0, screenW, screenH);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
  }
}
