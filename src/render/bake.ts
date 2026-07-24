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
