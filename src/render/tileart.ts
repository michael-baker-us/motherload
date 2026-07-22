import { TILE } from "../game/config";
import { mulberry32 } from "../game/rng";
import { TILE_DEFS, TileId } from "../game/tiles";

/**
 * Pre-rendered tile textures, painted once at startup and blitted per frame.
 * Baked at 2x supersample so they stay crisp under the world zoom.
 */

export const TILE_VARIANTS = 4;

/** Supersample factor for baked art. */
const S = 2;

export type TileTextures = Map<TileId, HTMLCanvasElement[]>;

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = TILE * S;
  canvas.height = TILE * S;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(S, S); // painters keep working in 32px coordinates
  return [canvas, ctx];
}

/** Scale a #rrggbb color's brightness by f (>1 lightens). */
export function shade(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.min(255, Math.round(r * f))},${Math.min(255, Math.round(g * f))},${Math.min(255, Math.round(b * f))})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** shade() but returning hex-compatible input for rgba(). */
function shadeHex(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  const c = (v: number): string => Math.min(255, Math.round(v * f)).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function paintDirtBase(ctx: CanvasRenderingContext2D, rand: () => number, base: string): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TILE, TILE);
  // Strata: faint horizontal bands.
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.04 + rand() * 0.06})`;
    ctx.fillRect(0, Math.floor(rand() * TILE), TILE, 1.5 + rand() * 3);
  }
  // Grit.
  for (let i = 0; i < 55; i++) {
    const light = rand() > 0.5;
    ctx.fillStyle = light
      ? `rgba(255,210,170,${0.05 + rand() * 0.09})`
      : `rgba(20,5,0,${0.08 + rand() * 0.13})`;
    const s = rand() > 0.85 ? 1.6 : 0.9;
    ctx.fillRect(rand() * TILE, rand() * TILE, s, s);
  }
  // A few subtle embedded pebbles — low contrast so they read as texture,
  // not polka dots.
  for (let i = 0; i < 2 + Math.floor(rand() * 2); i++) {
    const px = rand() * TILE;
    const py = rand() * TILE;
    const pr = 1.2 + rand() * 1.4;
    ctx.fillStyle = rgba(shadeHex(base, 0.75), 0.55);
    ctx.beginPath();
    ctx.ellipse(px, py, pr, pr * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,215,175,0.14)";
    ctx.beginPath();
    ctx.ellipse(px - pr * 0.25, py - pr * 0.3, pr * 0.4, pr * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintRock(ctx: CanvasRenderingContext2D, rand: () => number, base: string): void {
  ctx.fillStyle = shade(base, 0.9 + rand() * 0.2);
  ctx.fillRect(0, 0, TILE, TILE);
  // Angular facets.
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${0.04 + rand() * 0.06})` : `rgba(0,0,0,${0.06 + rand() * 0.08})`;
    const x = rand() * TILE;
    const y = rand() * TILE;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 5 + rand() * 12, y + rand() * 5);
    ctx.lineTo(x + rand() * 10, y + 5 + rand() * 10);
    ctx.closePath();
    ctx.fill();
  }
  // Cracks.
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 2; i++) {
    ctx.beginPath();
    let x = rand() * TILE;
    let y = rand() * TILE;
    ctx.moveTo(x, y);
    for (let s = 0; s < 3; s++) {
      x += (rand() - 0.5) * 14;
      y += rand() * 8;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Bevel: lit top-left, shadowed bottom-right.
  ctx.fillStyle = "rgba(255,255,255,0.11)";
  ctx.fillRect(0, 0, TILE, 2);
  ctx.fillRect(0, 0, 2, TILE);
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.fillRect(0, TILE - 2, TILE, 2);
  ctx.fillRect(TILE - 2, 0, 2, TILE);
}

function paintTunnel(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  base: string,
  rubble: boolean,
): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TILE, TILE);
  const grad = ctx.createLinearGradient(0, 0, 0, TILE);
  grad.addColorStop(0, "rgba(0,0,0,0.28)");
  grad.addColorStop(0.5, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.32)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, TILE, TILE);
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = `rgba(120,80,50,${0.04 + rand() * 0.06})`;
    ctx.fillRect(rand() * TILE, rand() * TILE, 1, 1);
  }
  if (rubble) {
    // Loose spoil left on the tunnel floor.
    for (let i = 0; i < 3; i++) {
      const rx = 4 + rand() * 24;
      const rr = 1.5 + rand() * 2.5;
      ctx.fillStyle = `rgba(58,34,16,0.9)`;
      ctx.beginPath();
      ctx.ellipse(rx, TILE - rr * 0.6, rr, rr * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(150,100,60,0.35)";
      ctx.beginPath();
      ctx.ellipse(rx - rr * 0.3, TILE - rr * 0.9, rr * 0.4, rr * 0.25, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

type OreShape = "needle" | "shard" | "chunk" | "cube" | "hex" | "gem";

/**
 * A distinct crystal silhouette per mineral, so ores are told apart by SHAPE,
 * not just colour — a colour-blindness / low-vision safeguard (and richer art).
 */
const ORE_FORMS: Partial<Record<TileId, { shape: OreShape; count: number; scale: number }>> = {
  [TileId.Ironium]: { shape: "chunk", count: 5, scale: 1 }, // squat metallic lumps
  [TileId.Bronzium]: { shape: "needle", count: 8, scale: 1 }, // fine spikes
  [TileId.Silverium]: { shape: "shard", count: 6, scale: 1 }, // classic kite shards
  [TileId.Goldium]: { shape: "cube", count: 4, scale: 1 }, // boxy nuggets
  [TileId.Einsteinium]: { shape: "hex", count: 4, scale: 1 }, // hexagonal cells
  [TileId.Diamond]: { shape: "gem", count: 1, scale: 2.3 }, // one big brilliant
};

/** Path a unit crystal of the given shape, centred at the origin, scaled by s. */
function oreShapePath(ctx: CanvasRenderingContext2D, shape: OreShape, s: number): void {
  ctx.beginPath();
  if (shape === "needle") {
    ctx.moveTo(0, -7 * s);
    ctx.lineTo(1.2 * s, 0);
    ctx.lineTo(0, 3 * s);
    ctx.lineTo(-1.2 * s, 0);
  } else if (shape === "shard") {
    ctx.moveTo(0, -5.5 * s);
    ctx.lineTo(2.4 * s, 0);
    ctx.lineTo(0, 2.5 * s);
    ctx.lineTo(-2.4 * s, 0);
  } else if (shape === "gem") {
    ctx.moveTo(0, -7 * s);
    ctx.lineTo(5 * s, -1.5 * s);
    ctx.lineTo(0, 7 * s);
    ctx.lineTo(-5 * s, -1.5 * s);
  } else if (shape === "cube") {
    ctx.rect(-3.2 * s, -3.2 * s, 6.4 * s, 6.4 * s); // boxy, obviously not a diamond
  } else if (shape === "chunk") {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const rr = (3 + (i % 2) * 0.9) * s;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr * 0.78; // squashed, blobby
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
  } else {
    // hex
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      i ? ctx.lineTo(Math.cos(a) * 4 * s, Math.sin(a) * 4 * s) : ctx.moveTo(Math.cos(a) * 4 * s, Math.sin(a) * 4 * s);
    }
  }
  ctx.closePath();
}

/** A single facetted crystal: dark backing, colour body, bright facet dot. */
function drawOre(ctx: CanvasRenderingContext2D, shape: OreShape, s: number, color: string): void {
  ctx.fillStyle = shade(color, 0.4);
  oreShapePath(ctx, shape, s * 1.18);
  ctx.fill();
  ctx.fillStyle = color;
  oreShapePath(ctx, shape, s);
  ctx.fill();
  ctx.fillStyle = shade(color, 1.85);
  ctx.beginPath();
  ctx.arc(-1.2 * s, -1.7 * s, 1.0 * s, 0, Math.PI * 2); // facet highlight, top-left
  ctx.fill();
}

function paintMineral(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  dirtBase: string,
  color: string,
  tile: TileId,
): void {
  paintDirtBase(ctx, rand, dirtBase);

  // Soft baked glow so ore reads even in gloom.
  const glow = ctx.createRadialGradient(16, 16, 2, 16, 16, 15);
  glow.addColorStop(0, rgba(color, 0.32));
  glow.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, TILE, TILE);

  const form = ORE_FORMS[tile] ?? { shape: "shard" as OreShape, count: 6, scale: 1 };
  const upright = form.shape === "gem" || form.shape === "hex" || form.shape === "cube";
  for (let i = 0; i < form.count; i++) {
    const cx = form.count === 1 ? 16 : 9 + rand() * 14;
    const cy = form.count === 1 ? 16 : 9 + rand() * 14;
    ctx.save();
    ctx.translate(cx, cy);
    // Boxy/faceted forms stay near-upright so their shape reads; spiky ones spin.
    ctx.rotate(upright ? (rand() - 0.5) * 0.6 : rand() * Math.PI * 2);
    drawOre(ctx, form.shape, form.scale * (0.8 + rand() * 0.5), color);
    ctx.restore();
  }
}

function paintLava(ctx: CanvasRenderingContext2D, rand: () => number): void {
  // Cooled crust with glowing crack network — the runtime pulse lights it up.
  ctx.fillStyle = "#45140a";
  ctx.fillRect(0, 0, TILE, TILE);
  for (let i = 0; i < 24; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.1 + rand() * 0.15})`;
    ctx.fillRect(rand() * TILE, rand() * TILE, 2 + rand() * 3, 1.5 + rand() * 2);
  }
  for (let i = 0; i < 3; i++) {
    let x = rand() * TILE;
    let y = rand() * TILE;
    const path: [number, number][] = [[x, y]];
    for (let s = 0; s < 4; s++) {
      x += (rand() - 0.5) * 20;
      y += (rand() - 0.5) * 20;
      path.push([x, y]);
    }
    const draw = (width: number, style: string): void => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(path[0]![0], path[0]![1]);
      for (const [px, py] of path.slice(1)) ctx.lineTo(px, py);
      ctx.stroke();
    };
    draw(3, "#e8481a");
    draw(1.2, "#ffd040");
  }
  // Molten pool.
  const px = 8 + rand() * 16;
  const py = 8 + rand() * 16;
  const pool = ctx.createRadialGradient(px, py, 1, px, py, 7);
  pool.addColorStop(0, "#ffd040");
  pool.addColorStop(0.5, "#ff7a20");
  pool.addColorStop(1, "rgba(232,72,26,0)");
  ctx.fillStyle = pool;
  ctx.fillRect(px - 7, py - 7, 14, 14);
}

export function makeTileTextures(): TileTextures {
  const rand = mulberry32(9001);
  const textures: TileTextures = new Map();
  const dirtBase = TILE_DEFS[TileId.Dirt].color;

  const paint = (
    tile: TileId,
    painter: (ctx: CanvasRenderingContext2D, r: () => number, variant: number) => void,
  ): void => {
    const variants: HTMLCanvasElement[] = [];
    for (let v = 0; v < TILE_VARIANTS; v++) {
      const [canvas, ctx] = makeCanvas();
      painter(ctx, rand, v);
      variants.push(canvas);
    }
    textures.set(tile, variants);
  };

  paint(TileId.Dirt, (ctx, r) => paintDirtBase(ctx, r, shade(dirtBase, 0.92 + r() * 0.16)));
  paint(TileId.Rock, (ctx, r) => paintRock(ctx, r, TILE_DEFS[TileId.Rock].color));
  paint(TileId.Empty, (ctx, r, v) => paintTunnel(ctx, r, TILE_DEFS[TileId.Empty].color, v % 2 === 1));
  paint(TileId.Lava, (ctx, r) => paintLava(ctx, r));
  for (const tile of [
    TileId.Ironium,
    TileId.Bronzium,
    TileId.Silverium,
    TileId.Goldium,
    TileId.Einsteinium,
    TileId.Diamond,
  ]) {
    paint(tile, (ctx, r) => paintMineral(ctx, r, dirtBase, TILE_DEFS[tile].color, tile));
  }
  // Gas pockets are the trap: pixel-identical to dirt.
  textures.set(TileId.GasPocket, textures.get(TileId.Dirt)!);
  return textures;
}
