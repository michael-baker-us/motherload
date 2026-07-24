/**
 * The darkness layer. Fills the frame with the biome's fog colour at the
 * current darkness, punches a soft hole for each light, then washes each
 * light's colour back into its halo so the lamp reads as light rather than a
 * cut-out. Runs at native resolution (light positions are screen px).
 *
 * The emissive glows (lava, thruster, beacon crystal, …) are NOT drawn here —
 * the renderer replays them additively *after* this pass so they pierce the
 * dark. This class only shapes the ambient darkness itself.
 */
import { LIGHT } from "../game/config";
import { bakeBeam, bakeHole } from "./bake";
import type { Light } from "./lights";

/** Reference length the beam sprite is baked at; scaled to each light's reach. */
const BEAM_REF = 256;

export class Lighting {
  /** Offscreen buffer the darkness is composited in, sized to the canvas. */
  private readonly buf = document.createElement("canvas");
  /** One soft alpha mask, scaled per light — no per-light gradient allocation. */
  private readonly hole = bakeHole(128);
  /** A warm light cone (apex at left-centre, pointing +x), scaled/rotated per beam. */
  private readonly beam = bakeBeam(BEAM_REF, LIGHT.beam.spread);

  /**
   * Paint the darkness over `ctx`. No-op when it's negligibly bright or there
   * are no lights (the surface stays untouched).
   */
  apply(
    ctx: CanvasRenderingContext2D,
    lights: readonly Light[],
    fog: readonly [number, number, number],
    darkness: number,
    screenW: number,
    screenH: number,
  ): void {
    if (darkness <= 0.01 || lights.length === 0) return;

    const buf = this.buf;
    if (buf.width !== screenW || buf.height !== screenH) {
      buf.width = screenW;
      buf.height = screenH;
    }
    const b = buf.getContext("2d")!;
    b.globalCompositeOperation = "source-over";
    b.clearRect(0, 0, screenW, screenH);
    b.fillStyle = `rgba(${fog[0]},${fog[1]},${fog[2]},${darkness})`;
    b.fillRect(0, 0, screenW, screenH);

    // Carve a hole for each light by removing alpha where the mask is opaque;
    // directional lamps additionally carve a forward cone.
    b.globalCompositeOperation = "destination-out";
    for (const l of lights) {
      const r = l.radius;
      b.globalAlpha = Math.max(0, Math.min(1, l.intensity));
      b.drawImage(this.hole, l.x - r, l.y - r, r * 2, r * 2);
      if (l.beamAngle !== undefined) this.drawBeam(b, l);
    }
    b.globalAlpha = 1;
    b.globalCompositeOperation = "source-over";

    ctx.drawImage(buf, 0, 0);

    // Wash each light's colour into its halo so it feels lit, not just cleared.
    for (const l of lights) {
      const wr = l.radius * 0.58;
      const a = (l.wash ?? 0.1) * darkness;
      if (a <= 0) continue;
      const [r, g, bl] = l.color;
      const grad = ctx.createRadialGradient(l.x, l.y, 8, l.x, l.y, wr);
      grad.addColorStop(0, `rgba(${r},${g},${bl},${a})`);
      grad.addColorStop(1, `rgba(${r},${g},${bl},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(l.x - wr, l.y - wr, wr * 2, wr * 2);
      // Warm tint down the beam so the cone reads as light, not just clearance.
      if (l.beamAngle !== undefined) {
        ctx.globalAlpha = LIGHT.beam.wash * darkness;
        this.drawBeam(ctx, l);
        ctx.globalAlpha = 1;
      }
    }
  }

  /**
   * Blit the baked warm cone for a directional lamp: apex at the light, scaled
   * to its reach, rotated to its aim, and nudged forward so it reads as
   * projecting from the lamp rather than the pod's middle. Caller sets the
   * composite op + alpha.
   */
  private drawBeam(c: CanvasRenderingContext2D, l: Light): void {
    const scale = l.beamLen! / BEAM_REF;
    const bw = this.beam.width * scale;
    const bh = this.beam.height * scale;
    c.save();
    c.translate(l.x, l.y);
    c.rotate(l.beamAngle!);
    c.drawImage(this.beam, l.radius * 0.3, -bh / 2, bw, bh);
    c.restore();
  }
}
