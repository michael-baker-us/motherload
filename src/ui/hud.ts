export interface HudData {
  depth: number;
  fuel: number;
  maxFuel: number;
  hull: number;
  maxHull: number;
  money: number;
  cargoUnits: number;
  cargoCapacity: number;
  /** Contextual prompt, e.g. "[E] enter FUEL DEPOT". */
  hint: string | null;
  /** Transient message with remaining seconds, e.g. "CARGO FULL". */
  toast: { text: string; timeLeft: number } | null;
}

const PANEL_W = 178;
const BAR_W = PANEL_W - 62;

function bar(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  frac: number,
  color: string,
): void {
  ctx.font = "bold 10px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillText(label, x, y + 1);
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.beginPath();
  ctx.roundRect(x + 40, y, BAR_W, 9, 4);
  ctx.fill();
  if (frac > 0.01) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x + 40, y, BAR_W * Math.min(1, frac), 9, 4);
    ctx.fill();
  }
}

export function drawHud(ctx: CanvasRenderingContext2D, data: HudData): void {
  ctx.textBaseline = "top";

  // Stat panel.
  ctx.fillStyle = "rgba(14, 10, 8, 0.62)";
  ctx.beginPath();
  ctx.roundRect(10, 10, PANEL_W, 96, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = "bold 17px monospace";
  ctx.fillStyle = "#f0c020";
  ctx.fillText(`$${data.money}`, 22, 20);

  ctx.font = "12px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  const depthText = `${data.depth} m`;
  ctx.fillText(depthText, 10 + PANEL_W - 12 - ctx.measureText(depthText).width, 23);

  const fuelFrac = data.fuel / data.maxFuel;
  bar(ctx, "FUEL", 22, 48, fuelFrac, fuelFrac > 0.5 ? "#5fd75f" : fuelFrac > 0.25 ? "#f0c020" : "#e04a3a");
  const hullFrac = data.hull / data.maxHull;
  bar(ctx, "HULL", 22, 66, hullFrac, hullFrac > 0.35 ? "#6fb7ff" : "#e04a3a");
  bar(ctx, "BAY", 22, 84, data.cargoUnits / data.cargoCapacity, "#c9a05a");

  // Contextual hint pill above the controls line.
  const viewH = ctx.canvas.clientHeight;
  ctx.font = "13px monospace";
  if (data.hint) {
    const w = ctx.measureText(data.hint).width;
    ctx.fillStyle = "rgba(14,10,8,0.7)";
    ctx.beginPath();
    ctx.roundRect(12, viewH - 56, w + 20, 22, 11);
    ctx.fill();
    ctx.fillStyle = "#ffe97a";
    ctx.fillText(data.hint, 22, viewH - 51);
  }
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillText("← → fly/dig · ↑ thrust · ↓ drill · E station", 14, viewH - 26);

  // Toast pill, top-center, fading out.
  if (data.toast) {
    ctx.globalAlpha = Math.min(1, data.toast.timeLeft);
    ctx.font = "bold 15px monospace";
    const w = ctx.measureText(data.toast.text).width;
    const x = (ctx.canvas.clientWidth - w) / 2;
    ctx.fillStyle = "rgba(14,10,8,0.75)";
    ctx.beginPath();
    ctx.roundRect(x - 16, 14, w + 32, 30, 15);
    ctx.fill();
    ctx.fillStyle = "#ffe97a";
    ctx.fillText(data.toast.text, x, 21);
    ctx.globalAlpha = 1;
  }
  ctx.font = "14px monospace";
}
