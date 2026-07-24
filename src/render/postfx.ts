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
