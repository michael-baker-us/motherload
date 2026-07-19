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

export function drawHud(ctx: CanvasRenderingContext2D, data: HudData): void {
  ctx.font = "14px monospace";
  ctx.textBaseline = "top";

  // Stat panel, top-left.
  const lines = [
    `$${data.money}`,
    `CARGO ${data.cargoUnits}/${data.cargoCapacity}`,
    `DEPTH ${data.depth} m`,
  ];
  const panelWidth = 150;
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(8, 8, panelWidth, 46 + lines.length * 18);

  // Fuel bar, then hull bar beneath it.
  const fuelFrac = Math.max(0, data.fuel / data.maxFuel);
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(16, 16, panelWidth - 16, 10);
  ctx.fillStyle = fuelFrac > 0.5 ? "#5fd75f" : fuelFrac > 0.25 ? "#f0c020" : "#e04a3a";
  ctx.fillRect(16, 16, (panelWidth - 16) * fuelFrac, 10);

  const hullFrac = Math.max(0, data.hull / data.maxHull);
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(16, 30, panelWidth - 16, 10);
  ctx.fillStyle = hullFrac > 0.35 ? "#6fb7ff" : "#e04a3a";
  ctx.fillRect(16, 30, (panelWidth - 16) * hullFrac, 10);

  ctx.fillStyle = "#ffffff";
  lines.forEach((line, i) => {
    ctx.fillText(line, 16, 48 + i * 18);
  });

  // Contextual hint above the controls line.
  const viewH = ctx.canvas.clientHeight;
  if (data.hint) {
    ctx.fillStyle = "#ffe97a";
    ctx.fillText(data.hint, 16, viewH - 46);
  }
  ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
  ctx.fillText("← → fly/dig · ↑ thrust · ↓ drill · E station", 16, viewH - 26);

  // Toast, top-center, fading out.
  if (data.toast) {
    const alpha = Math.min(1, data.toast.timeLeft);
    ctx.globalAlpha = alpha;
    ctx.font = "16px monospace";
    const w = ctx.measureText(data.toast.text).width;
    const x = (ctx.canvas.clientWidth - w) / 2;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x - 10, 14, w + 20, 26);
    ctx.fillStyle = "#ffe97a";
    ctx.fillText(data.toast.text, x, 20);
    ctx.globalAlpha = 1;
    ctx.font = "14px monospace";
  }
}
