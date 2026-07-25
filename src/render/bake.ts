/**
 * One-time baked sprites. Building these radial/linear gradients once at
 * startup and blitting the resulting canvas each frame is far cheaper than
 * rebuilding a gradient per draw — the renderer holds one instance of each.
 */
import { TILE } from "../game/config";

/** Baked soft shadow along one edge of a tunnel tile. (dx,dy) points at the wall. */
export function bakeEdge(dx: number, dy: number): HTMLCanvasElement {
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
export function bakeCrust(): HTMLCanvasElement {
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

/** Soft smoke/steam puff, baked once and blitted (no per-frame gradients). */
export function bakePuff(size = 48): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(228,228,232,0.6)");
  grad.addColorStop(1, "rgba(228,228,232,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/** Radial glow sprite for emissive effects (drawn additively over the scene). */
export function bakeGlow(size: number, r: number, g: number, b: number): HTMLCanvasElement {
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

/**
 * A soft warm light *cone* pointing +x, its apex at the left-centre (0, H/2).
 * Baked once at a reference length and scaled per frame. The warm colour +
 * alpha profile serves both jobs: its alpha carves the darkness (destination-out)
 * and its colour tints the beam (a low-alpha source-over wash). Edges are
 * blurred so the cone feathers into the dark instead of ending in a hard wedge.
 */
export function bakeBeam(length: number, spread: number): HTMLCanvasElement {
  const farHalf = Math.tan(spread) * length;
  const pad = 12;
  const w = Math.ceil(length) + pad;
  const h = Math.ceil(farHalf * 2) + pad * 2;
  const oy = h / 2;

  const sharp = document.createElement("canvas");
  sharp.width = w;
  sharp.height = h;
  const s = sharp.getContext("2d")!;
  const grad = s.createRadialGradient(0, oy, 4, 0, oy, length);
  grad.addColorStop(0, "rgba(255,198,124,0.95)");
  grad.addColorStop(0.5, "rgba(255,190,110,0.5)");
  grad.addColorStop(1, "rgba(255,185,105,0)");
  s.save();
  s.beginPath();
  s.moveTo(0, oy);
  s.lineTo(length, oy - farHalf);
  s.lineTo(length, oy + farHalf);
  s.closePath();
  s.clip();
  s.fillStyle = grad;
  s.fillRect(0, 0, w, h);
  s.restore();

  // Feather the wedge edges.
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.filter = "blur(5px)";
  ctx.drawImage(sharp, 0, 0);
  ctx.filter = "none";
  return canvas;
}

/**
 * Soft-edged alpha "hole" mask for carving light out of the darkness overlay.
 * Only the alpha channel matters (used via destination-out); the profile —
 * opaque core, feathered to nothing at the rim — is what shapes the falloff.
 * Scaled to each light's radius at blit time, so one bake serves every light.
 */
export function bakeHole(size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(0,0,0,1)");
  grad.addColorStop(0.6, "rgba(0,0,0,0.78)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}
