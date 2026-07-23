import { HEAT } from "../game/config";
import { clamp } from "../engine/math";
import { alpha, palette } from "../render/palette";

export interface HudData {
  depth: number;
  fuel: number;
  maxFuel: number;
  hull: number;
  maxHull: number;
  heat: number;
  maxHeat: number;
  money: number;
  cargoUnits: number;
  cargoCapacity: number;
  /** Contextual prompt, e.g. "[E] enter FUEL DEPOT". */
  hint: string | null;
  /** First-run guided objective, centered near the top; null when done. */
  onboarding: { text: string; step: number; total: number } | null;
  /** Vertical-slice objective progress banner; null when there's no goal. */
  objective: { current: number; target: number } | null;
  /** Transient message; total lets the HUD animate the slide-in. */
  toast: { text: string; timeLeft: number; total: number } | null;
  /** Dev cheats active — progress is not being saved. */
  dev: boolean;
  /** Consumables in hotkey order: [key] TAG ×count pills, dimmed when empty. */
  items: Array<{ key: string; tag: string; count: number }>;
}

const PANEL_W = 190;
const PANEL_H = 118;
const BAR_X = 66;
const BAR_W = PANEL_W - BAR_X - 14;

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

/**
 * Stateful HUD: displayed values ease toward the real ones (money ticks up,
 * bars glide), and low fuel/hull pulse a warning. One instance per renderer.
 */
export class Hud {
  private time = 0;
  private shownMoney = -1;
  private shownFuel = -1;
  private shownHull = -1;
  private shownHeat = -1;
  private shownBay = -1;

  draw(ctx: CanvasRenderingContext2D, data: HudData, dt: number): void {
    this.time += dt;
    const ease = 1 - Math.exp(-9 * dt);
    if (this.shownMoney < 0) {
      this.shownMoney = data.money;
      this.shownFuel = data.fuel / data.maxFuel;
      this.shownHull = data.hull / data.maxHull;
      this.shownHeat = data.heat / data.maxHeat;
      this.shownBay = data.cargoUnits / Math.max(1, data.cargoCapacity);
    }
    this.shownMoney += (data.money - this.shownMoney) * Math.min(1, ease * 1.6);
    if (Math.abs(data.money - this.shownMoney) < 1) this.shownMoney = data.money;
    this.shownFuel += (data.fuel / data.maxFuel - this.shownFuel) * ease;
    this.shownHull += (data.hull / data.maxHull - this.shownHull) * ease;
    this.shownHeat += (data.heat / data.maxHeat - this.shownHeat) * ease;
    this.shownBay += (data.cargoUnits / Math.max(1, data.cargoCapacity) - this.shownBay) * ease;

    ctx.textBaseline = "top";

    // Glass panel.
    ctx.fillStyle = "rgba(10, 12, 16, 0.66)";
    ctx.beginPath();
    ctx.roundRect(12, 12, PANEL_W, PANEL_H, 12);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.beginPath();
    ctx.roundRect(13, 13, PANEL_W - 2, 16, [11, 11, 0, 0]);
    ctx.fill();

    // Money, ticking toward the real value.
    ctx.font = `bold 18px ${MONO}`;
    ctx.fillStyle = palette.moneyGold;
    ctx.fillText(`$${Math.round(this.shownMoney).toLocaleString()}`, 24, 22);

    // Depth, right-aligned.
    ctx.font = `bold 8px ${MONO}`;
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    const depthLabel = "DEPTH";
    ctx.fillText(depthLabel, 12 + PANEL_W - 14 - ctx.measureText(depthLabel).width, 20);
    ctx.font = `bold 13px ${MONO}`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    const depthText = `${data.depth} m`;
    ctx.fillText(depthText, 12 + PANEL_W - 14 - ctx.measureText(depthText).width, 29);

    const pulse = 0.55 + 0.45 * Math.sin(this.time * 7);
    this.bar(ctx, "FUEL", 50, this.shownFuel, data.fuel / data.maxFuel < 0.25, palette.good, pulse);
    this.bar(ctx, "HULL", 68, this.shownHull, data.hull / data.maxHull < 0.25, palette.anomalyDim, pulse);
    this.bar(ctx, "HEAT", 86, this.shownHeat, data.heat / data.maxHeat > HEAT.warnFraction, palette.heat, pulse);
    this.bar(ctx, "BAY", 104, this.shownBay, false, palette.amberDim, pulse);

    // Dev-mode badge under the panel: loud on purpose — saves are off.
    if (data.dev) {
      ctx.font = `bold 11px ${MONO}`;
      const text = "DEV MODE · not saving";
      const w = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(200,110,30,0.9)";
      ctx.beginPath();
      ctx.roundRect(12, 118, w + 20, 20, 10);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(text, 22, 123);
    }

    // Contextual hint pill above the controls line.
    const viewH = ctx.canvas.clientHeight;
    ctx.font = `13px ${MONO}`;
    if (data.hint) {
      const w = ctx.measureText(data.hint).width;
      ctx.fillStyle = "rgba(10,12,16,0.72)";
      ctx.beginPath();
      ctx.roundRect(12, viewH - 58, w + 22, 24, 12);
      ctx.fill();
      ctx.strokeStyle = alpha(palette.amber, 0.35);
      ctx.stroke();
      ctx.fillStyle = palette.amber;
      ctx.fillText(data.hint, 23, viewH - 52);
    }
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = `12px ${MONO}`;
    ctx.fillText("← → fly/dig · ↑ thrust · ↓ drill · E station · 1-4 items · Esc menu", 16, viewH - 26);

    // Item pills, bottom-right: [1] DYN ×2 — dimmed while the slot is empty.
    const viewW = ctx.canvas.clientWidth;
    ctx.font = `bold 11px ${MONO}`;
    let px = viewW - 14;
    for (let i = data.items.length - 1; i >= 0; i--) {
      const item = data.items[i]!;
      const text = `${item.key} ${item.tag} ×${item.count}`;
      const w = ctx.measureText(text).width + 16;
      px -= w;
      ctx.globalAlpha = item.count > 0 ? 1 : 0.35;
      ctx.fillStyle = "rgba(10,12,16,0.72)";
      ctx.beginPath();
      ctx.roundRect(px, viewH - 34, w, 20, 10);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.stroke();
      ctx.fillStyle = item.count > 0 ? palette.amber : "#9a9a9a";
      ctx.fillText(text, px + 8, viewH - 29);
      ctx.globalAlpha = 1;
      px -= 6;
    }

    // First-run objective banner, centered near the top.
    if (data.onboarding) {
      const o = data.onboarding;
      const label = `GETTING STARTED · ${o.step}/${o.total}`;
      ctx.font = `bold 14px ${MONO}`;
      const tw = ctx.measureText(o.text).width;
      ctx.font = `bold 10px ${MONO}`;
      const cardW = Math.max(tw, ctx.measureText(label).width) + 40;
      const cardX = Math.round((viewW - cardW) / 2);
      const cardY = Math.round(viewH * 0.13);
      ctx.fillStyle = "rgba(10,12,16,0.82)";
      ctx.beginPath();
      ctx.roundRect(cardX, cardY, cardW, 48, 12);
      ctx.fill();
      ctx.strokeStyle = alpha(palette.amber, 0.4);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = alpha(palette.amber, 0.75);
      ctx.font = `bold 10px ${MONO}`;
      ctx.fillText(label, cardX + 20, cardY + 10);
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold 14px ${MONO}`;
      ctx.fillText(o.text, cardX + 20, cardY + 25);
    }

    // Vertical-slice objective banner with a depth progress bar.
    if (data.objective) {
      const o = data.objective;
      const label = "◈ REACH THE ANOMALY";
      const prog = `${Math.min(o.current, o.target)} / ${o.target} m`;
      ctx.font = `bold 12px ${MONO}`;
      const cardW = Math.max(ctx.measureText(label).width + ctx.measureText(prog).width + 60, 300);
      const cardX = Math.round((viewW - cardW) / 2);
      const cardY = Math.round(viewH * 0.13);
      ctx.fillStyle = "rgba(10,12,16,0.82)";
      ctx.beginPath();
      ctx.roundRect(cardX, cardY, cardW, 42, 12);
      ctx.fill();
      ctx.strokeStyle = alpha(palette.anomaly, 0.4);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = palette.anomaly;
      ctx.fillText(label, cardX + 18, cardY + 9);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.textAlign = "right";
      ctx.fillText(prog, cardX + cardW - 18, cardY + 9);
      ctx.textAlign = "left";
      // progress track + fill
      const barX = cardX + 18;
      const barW = cardW - 36;
      const frac = clamp(o.current / o.target, 0, 1);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath();
      ctx.roundRect(barX, cardY + 28, barW, 6, 3);
      ctx.fill();
      if (frac > 0.01) {
        ctx.fillStyle = palette.anomalyDim;
        ctx.beginPath();
        ctx.roundRect(barX, cardY + 28, barW * frac, 6, 3);
        ctx.fill();
      }
    }

    // Toast: slides down and fades out.
    if (data.toast) {
      const shown = data.toast.total - data.toast.timeLeft;
      const slide = 1 - Math.pow(1 - clamp(shown / 0.18, 0, 1), 3);
      ctx.globalAlpha = Math.min(1, data.toast.timeLeft) * slide;
      ctx.font = `bold 15px ${MONO}`;
      const w = ctx.measureText(data.toast.text).width;
      const x = (ctx.canvas.clientWidth - w) / 2;
      const y = 4 + slide * 14;
      ctx.fillStyle = "rgba(10,12,16,0.8)";
      ctx.beginPath();
      ctx.roundRect(x - 18, y, w + 36, 32, 16);
      ctx.fill();
      ctx.strokeStyle = alpha(palette.amber, 0.3);
      ctx.stroke();
      ctx.fillStyle = palette.amber;
      ctx.fillText(data.toast.text, x, y + 8);
      ctx.globalAlpha = 1;
    }
    ctx.font = `14px ${MONO}`;
  }

  private bar(
    ctx: CanvasRenderingContext2D,
    label: string,
    y: number,
    frac: number,
    low: boolean,
    color: string,
    pulse: number,
  ): void {
    ctx.font = `bold 9px ${MONO}`;
    ctx.fillStyle = low ? alpha(palette.danger, 0.55 + pulse * 0.45) : "rgba(255,255,255,0.5)";
    ctx.fillText(label, 24, y + 1);

    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.beginPath();
    ctx.roundRect(12 + BAR_X, y, BAR_W, 7, 3.5);
    ctx.fill();

    const fill = clamp(frac, 0, 1);
    if (fill > 0.01) {
      const c = low ? palette.danger : color;
      // Soft glow underlay, then the crisp fill.
      ctx.globalAlpha = low ? 0.25 + pulse * 0.3 : 0.28;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.roundRect(12 + BAR_X - 1.5, y - 1.5, BAR_W * fill + 3, 10, 5);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.roundRect(12 + BAR_X, y, BAR_W * fill, 7, 3.5);
      ctx.fill();
    }
  }
}
