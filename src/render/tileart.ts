import { TILE } from "../game/config";
import { mulberry32 } from "../game/rng";
import { TILE_DEFS, TileId } from "../game/tiles";

/**
 * Pre-rendered tile textures: each tile type gets a few 32px variants painted
 * once at startup, then blitted with drawImage. Procedural texture beats flat
 * rects and costs nothing per frame.
 */

export const TILE_VARIANTS = 4;

export type TileTextures = Map<TileId, HTMLCanvasElement[]>;

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  return [canvas, canvas.getContext("2d")!];
}

/** Scale a #rrggbb color's brightness by f (>1 lightens). */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

function paintDirtBase(ctx: CanvasRenderingContext2D, rand: () => number, base: string): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TILE, TILE);
  // Strata: faint horizontal bands.
  for (let i = 0; i < 2; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.05 + rand() * 0.05})`;
    ctx.fillRect(0, Math.floor(rand() * TILE), TILE, 2 + Math.floor(rand() * 3));
  }
  // Speckles: pebbles and grit.
  for (let i = 0; i < 42; i++) {
    const light = rand() > 0.5;
    ctx.fillStyle = light ? `rgba(255,210,170,${0.05 + rand() * 0.1})` : `rgba(20,5,0,${0.08 + rand() * 0.14})`;
    const s = rand() > 0.85 ? 2 : 1;
    ctx.fillRect(Math.floor(rand() * TILE), Math.floor(rand() * TILE), s, s);
  }
}

function paintRock(ctx: CanvasRenderingContext2D, rand: () => number, base: string): void {
  ctx.fillStyle = shade(base, 0.9 + rand() * 0.2);
  ctx.fillRect(0, 0, TILE, TILE);
  // Lighter facets.
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.04 + rand() * 0.05})`;
    const x = rand() * TILE;
    const y = rand() * TILE;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 4 + rand() * 10, y + rand() * 4);
    ctx.lineTo(x + rand() * 8, y + 4 + rand() * 8);
    ctx.closePath();
    ctx.fill();
  }
  // Cracks.
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
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
}

function paintTunnel(ctx: CanvasRenderingContext2D, rand: () => number, base: string): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TILE, TILE);
  const grad = ctx.createLinearGradient(0, 0, 0, TILE);
  grad.addColorStop(0, "rgba(0,0,0,0.25)");
  grad.addColorStop(0.5, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.3)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, TILE, TILE);
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = `rgba(120,80,50,${0.04 + rand() * 0.06})`;
    ctx.fillRect(Math.floor(rand() * TILE), Math.floor(rand() * TILE), 1, 1);
  }
}

function paintMineral(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  dirtBase: string,
  color: string,
): void {
  paintDirtBase(ctx, rand, dirtBase);
  const count = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < count; i++) {
    const cx = 8 + rand() * 16;
    const cy = 8 + rand() * 16;
    const size = 3 + rand() * 4;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rand() * Math.PI);
    // Crystal: dark outline, colored body, bright facet.
    ctx.fillStyle = shade(color, 0.45);
    ctx.fillRect(-size / 2 - 1, -size / 2 - 1, size + 2, size + 2);
    ctx.fillStyle = color;
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.fillStyle = shade(color, 1.6);
    ctx.beginPath();
    ctx.moveTo(-size / 2, -size / 2);
    ctx.lineTo(size / 2, -size / 2);
    ctx.lineTo(-size / 2, size / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function paintLava(ctx: CanvasRenderingContext2D, rand: () => number): void {
  ctx.fillStyle = "#6e1608";
  ctx.fillRect(0, 0, TILE, TILE);
  for (let i = 0; i < 5; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    const r = 4 + rand() * 6;
    ctx.fillStyle = "#e8481a";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffc040";
    ctx.beginPath();
    ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function makeTileTextures(): TileTextures {
  const rand = mulberry32(9001);
  const textures: TileTextures = new Map();
  const dirtBase = TILE_DEFS[TileId.Dirt].color;

  const paint = (tile: TileId, painter: (ctx: CanvasRenderingContext2D, r: () => number) => void): void => {
    const variants: HTMLCanvasElement[] = [];
    for (let v = 0; v < TILE_VARIANTS; v++) {
      const [canvas, ctx] = makeCanvas();
      painter(ctx, rand);
      variants.push(canvas);
    }
    textures.set(tile, variants);
  };

  paint(TileId.Dirt, (ctx, r) => paintDirtBase(ctx, r, shade(dirtBase, 0.92 + r() * 0.16)));
  paint(TileId.Rock, (ctx, r) => paintRock(ctx, r, TILE_DEFS[TileId.Rock].color));
  paint(TileId.Empty, (ctx, r) => paintTunnel(ctx, r, TILE_DEFS[TileId.Empty].color));
  paint(TileId.Lava, (ctx, r) => paintLava(ctx, r));
  for (const tile of [
    TileId.Ironium,
    TileId.Bronzium,
    TileId.Silverium,
    TileId.Goldium,
    TileId.Einsteinium,
    TileId.Diamond,
  ]) {
    paint(tile, (ctx, r) => paintMineral(ctx, r, dirtBase, TILE_DEFS[tile].color));
  }
  // Gas pockets are the trap: pixel-identical to dirt.
  textures.set(TileId.GasPocket, textures.get(TileId.Dirt)!);
  return textures;
}
