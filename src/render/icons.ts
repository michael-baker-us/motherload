/**
 * Procedural line-art icons for the shop, menu and HUD.
 *
 * These replace the OS emoji the shop used to draw: emoji render in the
 * platform's own colour font, which fights the game's palette and looks
 * different on every machine. Drawing them ourselves keeps the icon set on the
 * same art direction as the rest of the game (see `palette.ts` — warm amber vs.
 * cool anomaly blue against near-black ink) and costs no assets or licences.
 *
 * Every icon is authored on a 24×24 unit grid and scaled at draw time, so the
 * same source works for a 20px shop row and a 12px HUD pill. Canvas consumers
 * blit `iconCanvas()` (baked once per size, like the glow sprites in `bake.ts`);
 * DOM consumers use `iconDataUrl()` as an `<img>` src.
 */
import { palette } from "./palette";

export type IconId =
  // Upgrade tracks
  | "drill"
  | "tank"
  | "cargo"
  | "hull"
  | "engine"
  | "scanner"
  | "shield"
  | "coolant"
  // Modules
  | "turbo"
  | "compactor"
  | "recycler"
  | "plating"
  | "probe"
  // Consumable items
  | "dynamite"
  | "fuelCell"
  | "repairKit"
  | "teleporter"
  // Shop actions
  | "money"
  | "repair"
  | "refuel"
  // Menu / dev-tool actions
  | "sound"
  | "mute"
  | "modules"
  | "pack"
  | "boom";

const GRID = 24;
const STEEL = "#9aa4b2";
const STEEL_DARK = "#59616e";

/** Stroke helper — every icon shares the same weight/joins so the set reads as one family. */
function pen(ctx: CanvasRenderingContext2D, color: string, width = 1.8): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
}

/**
 * One entry per icon, drawing into a 24×24 box with the transform already
 * applied. Shapes stay chunky and closed so they survive being scaled down to
 * HUD size — silhouette first, one bright accent facet second.
 */
const DRAW: Record<IconId, (ctx: CanvasRenderingContext2D) => void> = {
  drill: (ctx) => {
    // Motor body, collar, then the bit — the collar is what stops the shape
    // reading as a plain cone at small sizes.
    ctx.fillStyle = STEEL;
    ctx.fillRect(9, 2.5, 6, 9);
    ctx.fillStyle = STEEL_DARK;
    ctx.fillRect(6.5, 11, 11, 3.5);
    ctx.fillStyle = palette.amber; // bit
    ctx.beginPath();
    ctx.moveTo(8.5, 14.5);
    ctx.lineTo(15.5, 14.5);
    ctx.lineTo(12, 22.5);
    ctx.closePath();
    ctx.fill();
    pen(ctx, "rgba(0,0,0,0.5)", 1.3); // cutting flutes
    ctx.beginPath();
    ctx.moveTo(9.5, 16.5);
    ctx.lineTo(13.5, 17.5);
    ctx.moveTo(10.6, 19.5);
    ctx.lineTo(13, 20);
    ctx.stroke();
  },

  tank: (ctx) => {
    pen(ctx, palette.good);
    ctx.fillStyle = "rgba(95,215,95,0.18)";
    ctx.beginPath();
    ctx.roundRect(6, 5, 12, 16, 2.5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = palette.good; // filler cap + level window
    ctx.fillRect(10, 2.5, 4, 2.5);
    ctx.fillRect(8, 13, 8, 5);
  },

  cargo: (ctx) => {
    // A slatted crate. Deliberately no X-braces — at HUD size crossed
    // diagonals inside a rectangle read as an envelope.
    pen(ctx, palette.amberDim);
    ctx.fillStyle = "rgba(201,160,90,0.2)";
    ctx.beginPath();
    ctx.rect(4, 6, 16, 13);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = palette.amberDim; // lid band
    ctx.fillRect(4, 6, 16, 3);
    ctx.fillStyle = "rgba(201,160,90,0.75)"; // slats
    ctx.fillRect(9, 10, 1.8, 8);
    ctx.fillRect(13.2, 10, 1.8, 8);
  },

  hull: (ctx) => {
    // A hex bolt — the chassis/structure motif.
    pen(ctx, palette.anomalyDim);
    ctx.fillStyle = "rgba(111,183,255,0.18)";
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const px = 12 + Math.cos(a) * 9;
      const py = 12 + Math.sin(a) * 9;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(12, 12, 3.4, 0, Math.PI * 2);
    ctx.stroke();
  },

  engine: (ctx) => {
    // Bell nozzle with a throat band and a two-tone flame, so it reads as a
    // thruster rather than a pen nib.
    ctx.fillStyle = STEEL;
    ctx.beginPath();
    ctx.moveTo(9, 2.5);
    ctx.lineTo(15, 2.5);
    ctx.quadraticCurveTo(16, 8, 18.5, 13);
    ctx.lineTo(5.5, 13);
    ctx.quadraticCurveTo(8, 8, 9, 2.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = STEEL_DARK; // throat band
    ctx.fillRect(8.2, 6.5, 7.6, 2.2);
    ctx.fillStyle = palette.heat; // plume
    ctx.beginPath();
    ctx.moveTo(6.5, 13.5);
    ctx.quadraticCurveTo(12, 23.5, 17.5, 13.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = palette.amber; // hot core
    ctx.beginPath();
    ctx.moveTo(9.5, 13.5);
    ctx.quadraticCurveTo(12, 19.5, 14.5, 13.5);
    ctx.closePath();
    ctx.fill();
  },

  scanner: (ctx) => {
    // Solid dish + mast, with the ping arcs above it — filled rather than
    // stroked so the silhouette survives the downscale.
    ctx.fillStyle = "rgba(142,200,255,0.35)";
    ctx.beginPath();
    ctx.arc(12, 17, 7.5, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    pen(ctx, palette.anomaly, 2);
    ctx.stroke();
    ctx.fillStyle = palette.anomaly;
    ctx.fillRect(10.8, 17, 2.4, 5);
    ctx.fillRect(7, 21, 10, 2);
    pen(ctx, palette.anomaly, 1.8); // ping arcs
    for (const r of [3.5, 6.5]) {
      ctx.beginPath();
      ctx.arc(12, 11, r, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }
  },

  shield: (ctx) => {
    pen(ctx, palette.anomalyDim);
    ctx.fillStyle = "rgba(111,183,255,0.2)";
    ctx.beginPath();
    ctx.moveTo(12, 3);
    ctx.lineTo(20, 7);
    ctx.lineTo(20, 13);
    ctx.quadraticCurveTo(20, 19, 12, 22);
    ctx.quadraticCurveTo(4, 19, 4, 13);
    ctx.lineTo(4, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  },

  coolant: (ctx) => {
    pen(ctx, "#bfe6ff");
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      const dx = Math.cos(a) * 8;
      const dy = Math.sin(a) * 8;
      ctx.beginPath();
      ctx.moveTo(12 - dx, 12 - dy);
      ctx.lineTo(12 + dx, 12 + dy);
      ctx.stroke();
      ctx.beginPath(); // tips
      ctx.arc(12 + dx, 12 + dy, 1.5, 0, Math.PI * 2);
      ctx.arc(12 - dx, 12 - dy, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = "#bfe6ff";
      ctx.fill();
    }
  },

  turbo: (ctx) => {
    ctx.fillStyle = palette.amber;
    ctx.beginPath();
    ctx.moveTo(14, 2);
    ctx.lineTo(6, 13);
    ctx.lineTo(11, 13);
    ctx.lineTo(10, 22);
    ctx.lineTo(18, 10);
    ctx.lineTo(13, 10);
    ctx.closePath();
    ctx.fill();
  },

  compactor: (ctx) => {
    pen(ctx, STEEL);
    ctx.fillStyle = "rgba(154,164,178,0.22)";
    ctx.beginPath(); // the compressed block
    ctx.rect(7, 10, 10, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = STEEL; // press plates closing in
    ctx.fillRect(4, 4, 16, 3);
    ctx.fillRect(4, 18, 16, 3);
    pen(ctx, palette.amber, 1.6);
    ctx.beginPath();
    ctx.moveTo(12, 7.5);
    ctx.lineTo(12, 9.5);
    ctx.moveTo(12, 15.5);
    ctx.lineTo(12, 17.5);
    ctx.stroke();
  },

  recycler: (ctx) => {
    pen(ctx, palette.good, 2);
    ctx.beginPath(); // a broken loop with an arrowhead — "cash back"
    ctx.arc(12, 12, 7.5, Math.PI * 0.35, Math.PI * 1.85);
    ctx.stroke();
    ctx.fillStyle = palette.good;
    ctx.beginPath();
    ctx.moveTo(17.5, 6);
    ctx.lineTo(20.5, 11);
    ctx.lineTo(14.5, 10.5);
    ctx.closePath();
    ctx.fill();
  },

  plating: (ctx) => {
    // Stacked armour plates.
    pen(ctx, palette.anomalyDim, 1.6);
    ctx.fillStyle = "rgba(111,183,255,0.16)";
    for (const y of [5, 11, 17]) {
      ctx.beginPath();
      ctx.roundRect(4, y, 16, 4.5, 1.5);
      ctx.fill();
      ctx.stroke();
    }
  },

  probe: (ctx) => {
    pen(ctx, palette.anomaly);
    ctx.fillStyle = "rgba(142,200,255,0.2)";
    ctx.beginPath(); // drone body
    ctx.roundRect(8, 11, 8, 7, 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath(); // mast
    ctx.moveTo(12, 11);
    ctx.lineTo(12, 6);
    ctx.stroke();
    ctx.fillStyle = palette.anomaly;
    ctx.beginPath();
    ctx.arc(12, 5, 2, 0, Math.PI * 2);
    ctx.fill();
    pen(ctx, palette.anomaly, 1.3); // signal ticks
    ctx.beginPath();
    ctx.arc(12, 5, 5, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  },

  dynamite: (ctx) => {
    pen(ctx, "rgba(0,0,0,0.4)", 1.2);
    ctx.fillStyle = palette.danger;
    ctx.beginPath(); // stick
    ctx.roundRect(8, 8, 8, 14, 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,0.25)"; // binding
    ctx.fillRect(8, 13, 8, 2);
    pen(ctx, "#c9b28a", 1.5); // fuse
    ctx.beginPath();
    ctx.moveTo(12, 8);
    ctx.quadraticCurveTo(16, 6, 15, 3);
    ctx.stroke();
    ctx.fillStyle = palette.amber; // spark
    ctx.beginPath();
    ctx.arc(15, 2.5, 2, 0, Math.PI * 2);
    ctx.fill();
  },

  fuelCell: (ctx) => {
    pen(ctx, palette.good);
    ctx.fillStyle = "rgba(95,215,95,0.16)";
    ctx.beginPath();
    ctx.roundRect(5, 6, 14, 13, 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = palette.good; // terminal
    ctx.fillRect(9, 3.5, 6, 2.5);
    ctx.fillStyle = palette.amber; // charge bolt
    ctx.beginPath();
    ctx.moveTo(13, 8);
    ctx.lineTo(9.5, 13);
    ctx.lineTo(12, 13);
    ctx.lineTo(11, 17.5);
    ctx.lineTo(14.5, 12);
    ctx.lineTo(12, 12);
    ctx.closePath();
    ctx.fill();
  },

  repairKit: (ctx) => {
    pen(ctx, STEEL_DARK, 1.6);
    ctx.fillStyle = "rgba(154,164,178,0.25)";
    ctx.beginPath(); // toolbox
    ctx.roundRect(4, 8, 16, 12, 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath(); // handle
    ctx.moveTo(9, 8);
    ctx.lineTo(9, 5.5);
    ctx.lineTo(15, 5.5);
    ctx.lineTo(15, 8);
    ctx.stroke();
    ctx.fillStyle = palette.good; // med cross
    ctx.fillRect(11, 11, 2, 6);
    ctx.fillRect(9, 13, 6, 2);
  },

  teleporter: (ctx) => {
    pen(ctx, palette.anomaly, 2);
    ctx.beginPath(); // inward spiral
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const a = t * Math.PI * 3.2;
      const r = 9.5 * (1 - t * 0.85);
      const px = 12 + Math.cos(a) * r;
      const py = 12 + Math.sin(a) * r * 0.85;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  },

  money: (ctx) => {
    // Stacked coins, edge-on.
    pen(ctx, "rgba(0,0,0,0.4)", 1.2);
    for (const y of [16, 12, 8]) {
      ctx.fillStyle = palette.moneyGold;
      ctx.beginPath();
      ctx.ellipse(12, y, 8, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(11.2, 5.6, 1.6, 4.8);
  },

  repair: (ctx) => {
    // Wrench laid diagonally. Chunky shaft + a thick open jaw so it stays
    // legible at 20px in the shop rows.
    ctx.save();
    ctx.translate(12, 12);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = STEEL;
    ctx.beginPath();
    ctx.roundRect(-2.3, -5, 4.6, 15, 1.6); // shaft
    ctx.fill();
    pen(ctx, STEEL, 3.4);
    ctx.beginPath(); // open jaw
    ctx.arc(0, -6.5, 4.4, Math.PI * 0.78, Math.PI * 0.22, true);
    ctx.stroke();
    ctx.restore();
  },

  refuel: (ctx) => {
    pen(ctx, palette.good);
    ctx.fillStyle = "rgba(95,215,95,0.16)";
    ctx.beginPath(); // pump body
    ctx.roundRect(5, 4, 11, 17, 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = palette.good;
    ctx.fillRect(7.5, 7, 6, 4.5); // readout
    ctx.beginPath(); // hose arm
    ctx.moveTo(16, 9);
    ctx.lineTo(19.5, 9);
    ctx.lineTo(19.5, 16);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(19.5, 17.5, 1.6, 0, Math.PI * 2);
    ctx.fill();
  },

  sound: (ctx) => {
    ctx.fillStyle = palette.ink;
    ctx.beginPath(); // speaker cone
    ctx.moveTo(4, 9);
    ctx.lineTo(8, 9);
    ctx.lineTo(13, 4);
    ctx.lineTo(13, 20);
    ctx.lineTo(8, 15);
    ctx.lineTo(4, 15);
    ctx.closePath();
    ctx.fill();
    pen(ctx, palette.anomaly, 1.6); // waves
    for (const r of [3.5, 6.5]) {
      ctx.beginPath();
      ctx.arc(14, 12, r, -Math.PI / 3, Math.PI / 3);
      ctx.stroke();
    }
  },

  mute: (ctx) => {
    ctx.fillStyle = "#7f8ba3";
    ctx.beginPath();
    ctx.moveTo(4, 9);
    ctx.lineTo(8, 9);
    ctx.lineTo(13, 4);
    ctx.lineTo(13, 20);
    ctx.lineTo(8, 15);
    ctx.lineTo(4, 15);
    ctx.closePath();
    ctx.fill();
    pen(ctx, palette.danger, 2); // crossed out
    ctx.beginPath();
    ctx.moveTo(15.5, 8.5);
    ctx.lineTo(21, 15.5);
    ctx.moveTo(21, 8.5);
    ctx.lineTo(15.5, 15.5);
    ctx.stroke();
  },

  modules: (ctx) => {
    // Interlocking blocks — the loadout metaphor.
    pen(ctx, palette.anomalyDim, 1.6);
    ctx.fillStyle = "rgba(111,183,255,0.18)";
    for (const [bx, by] of [
      [4, 4],
      [13, 4],
      [4, 13],
    ] as const) {
      ctx.beginPath();
      ctx.roundRect(bx, by, 7, 7, 1.5);
      ctx.fill();
      ctx.stroke();
    }
    pen(ctx, "rgba(255,255,255,0.35)", 1.4); // the empty slot
    ctx.setLineDash([2.5, 2.5]);
    ctx.beginPath();
    ctx.roundRect(13, 13, 7, 7, 1.5);
    ctx.stroke();
    ctx.setLineDash([]);
  },

  pack: (ctx) => {
    // Supply satchel: body, carry handle, one bright buckle. Kept to three
    // shapes — finer detail turns to mud at menu size.
    pen(ctx, STEEL, 1.8);
    ctx.fillStyle = "rgba(154,164,178,0.28)";
    ctx.beginPath();
    ctx.roundRect(3.5, 8, 17, 13, 2.5);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath(); // handle
    ctx.moveTo(8.5, 8);
    ctx.quadraticCurveTo(12, 2.5, 15.5, 8);
    ctx.stroke();
    ctx.fillStyle = STEEL; // flap
    ctx.fillRect(3.5, 11.5, 17, 2.4);
    ctx.fillStyle = palette.amber; // buckle
    ctx.fillRect(10, 13.5, 4, 4.5);
  },

  boom: (ctx) => {
    ctx.fillStyle = palette.danger;
    ctx.beginPath(); // starburst
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = i % 2 === 0 ? 10 : 4.5;
      const px = 12 + Math.cos(a) * r;
      const py = 12 + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = palette.amber;
    ctx.beginPath();
    ctx.arc(12, 12, 3, 0, Math.PI * 2);
    ctx.fill();
  },
};

/** Draw an icon into a canvas context, top-left anchored, scaled to `size` px. */
export function drawIcon(ctx: CanvasRenderingContext2D, id: IconId, x: number, y: number, size: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / GRID, size / GRID);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  DRAW[id](ctx);
  ctx.restore();
}

const canvasCache = new Map<string, HTMLCanvasElement>();
const urlCache = new Map<string, string>();

/**
 * Icon baked to its own canvas at 2× for crisp downscaling, cached per
 * (id, size) — the HUD blits these every frame, so they must not re-path.
 */
export function iconCanvas(id: IconId, size: number): HTMLCanvasElement {
  const key = `${id}@${size}`;
  const hit = canvasCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = size * 2;
  canvas.height = size * 2;
  const ctx = canvas.getContext("2d")!;
  drawIcon(ctx, id, 0, 0, size * 2);
  canvasCache.set(key, canvas);
  return canvas;
}

/** Icon as a data URL, for DOM `<img>` use in the shop/menu overlays. */
export function iconDataUrl(id: IconId, size = 24): string {
  const key = `${id}@${size}`;
  const hit = urlCache.get(key);
  if (hit) return hit;
  const url = iconCanvas(id, size).toDataURL();
  urlCache.set(key, url);
  return url;
}

/** `<img>` element for an icon, sized in CSS pixels. */
export function iconImg(id: IconId, size = 22): HTMLImageElement {
  const img = document.createElement("img");
  img.src = iconDataUrl(id, size);
  img.width = size;
  img.height = size;
  img.alt = "";
  img.style.cssText = `width:${size}px;height:${size}px;display:block;`;
  return img;
}
