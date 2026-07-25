import { HEAT } from "../game/config";
import { keyLabel, keysFor } from "../engine/bindings";
import { clamp } from "../engine/math";
import { FONT_UI } from "../render/fonts";
import { iconCanvas, type IconId } from "../render/icons";
import { alpha, palette } from "../render/palette";
import { fitFontSize, wrapText } from "../render/text";
import { layout } from "./layout";

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
  /** Station the pod is parked on, e.g. "FUEL DEPOT"; null when there's none. */
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
  items: Array<{ key: string; tag: string; icon: IconId; count: number }>;
  /** The run's season — a permanent, quiet chip so it's never a mystery. */
  season: { label: string; color: string; icon: IconId };
}

const PANEL_W = 190;
const PANEL_H = 118;
const BAR_X = 66;
const BAR_W = PANEL_W - BAR_X - 14;

const MONO = FONT_UI;

/** The key the player would actually press to enter a station, per their bindings. */
function interactKey(): string {
  return keyLabel(keysFor("interact")[0] ?? "KeyE");
}

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
  // Money-gain flash: pops when the banked total jumps (a sale), eases out.
  private lastMoney = -1;
  private moneyFlash = 0;

  /**
   * Draws in "UI units": the canvas is scaled by `layout.scale` and inset by the
   * display cutout first, so every coordinate below is a fixed design size and
   * the whole HUD grows together on a phone. `viewW`/`viewH` are the *usable*
   * size in those units — always use them instead of the raw canvas size.
   */
  draw(ctx: CanvasRenderingContext2D, data: HudData, dt: number): void {
    const s = layout.scale;
    const safe = layout.safe;
    ctx.save();
    ctx.translate(safe.left, safe.top);
    ctx.scale(s, s);
    this.drawScaled(
      ctx,
      data,
      dt,
      (ctx.canvas.clientWidth - safe.left - safe.right) / s,
      (ctx.canvas.clientHeight - safe.top - safe.bottom) / s,
    );
    ctx.restore();
  }

  private drawScaled(
    ctx: CanvasRenderingContext2D,
    data: HudData,
    dt: number,
    viewW: number,
    viewH: number,
  ): void {
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

    // A jump in the banked total pops the money readout.
    if (this.lastMoney >= 0 && data.money > this.lastMoney) this.moneyFlash = 1;
    this.lastMoney = data.money;
    this.moneyFlash = Math.max(0, this.moneyFlash - dt * 2.4);

    ctx.textBaseline = "top";

    // Glass panel: a soft drop shadow lifts it off the (now brighter) world, and
    // a subtle top-to-bottom tint gives it depth.
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;
    const panelBg = ctx.createLinearGradient(0, 12, 0, 12 + PANEL_H);
    panelBg.addColorStop(0, "rgba(16, 20, 26, 0.72)");
    panelBg.addColorStop(1, "rgba(8, 10, 14, 0.72)");
    ctx.fillStyle = panelBg;
    ctx.beginPath();
    ctx.roundRect(12, 12, PANEL_W, PANEL_H, 12);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.beginPath();
    ctx.roundRect(13, 13, PANEL_W - 2, 16, [11, 11, 0, 0]);
    ctx.fill();

    // Money, ticking toward the real value; glows warm when it jumps.
    ctx.save();
    if (this.moneyFlash > 0) {
      ctx.shadowColor = palette.moneyGold;
      ctx.shadowBlur = 12 * this.moneyFlash;
    }
    ctx.font = `bold 18px ${MONO}`;
    ctx.fillStyle = palette.moneyGold;
    ctx.fillText(`$${Math.round(this.shownMoney).toLocaleString()}`, 24, 22);
    ctx.restore();

    // Depth, right-aligned.
    ctx.font = `bold 8px ${MONO}`;
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    const depthLabel = "DEPTH";
    ctx.fillText(depthLabel, 12 + PANEL_W - 14 - ctx.measureText(depthLabel).width, 20);
    ctx.font = `bold 13px ${MONO}`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    const depthText = `${data.depth} m`;
    ctx.fillText(depthText, 12 + PANEL_W - 14 - ctx.measureText(depthText).width, 29);

    // Season chip in the dead row between the depth readout and the first bar:
    // small, tinted to the season, and always on screen so the player never has
    // to guess which season they're running.
    const icon = iconCanvas(data.season.icon, 11);
    ctx.drawImage(icon, 24, 33, 11, 11);
    ctx.font = `bold 8px ${MONO}`;
    ctx.fillStyle = data.season.color;
    ctx.globalAlpha = 0.75;
    ctx.letterSpacing = "1.5px";
    ctx.fillText(data.season.label.toUpperCase(), 39, 42);
    ctx.letterSpacing = "0px";
    ctx.globalAlpha = 1;

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

    // --- The top-of-screen stack -------------------------------------------
    // Toasts, banners and the station hint all want the top-centre. They share
    // it with the stats panel, so lay them out as one column: beside the panel
    // when the screen is wide enough, stacked below it when it isn't (a phone
    // in portrait), and never on top of each other.
    const panelBottom = 12 + PANEL_H + (data.dev ? 30 : 8);
    const roomBeside = viewW - PANEL_W - 36 >= 300;
    /** Centre `w`, but push clear of the panel when the row is level with it. */
    const centred = (w: number, y: number): number => {
      const min = y < panelBottom ? PANEL_W + 24 : 12;
      return Math.round(Math.max(min, Math.min((viewW - w) / 2, viewW - w - 12)));
    };
    let stackY = roomBeside ? 6 : panelBottom;

    // Toast: slides down and fades out. Shrinks to fit rather than running off
    // the sides — some toasts are long ("◈ AUTUMN · THE TURNING").
    if (data.toast) {
      const shown = data.toast.total - data.toast.timeLeft;
      const slide = 1 - Math.pow(1 - clamp(shown / 0.18, 0, 1), 3);
      ctx.globalAlpha = Math.min(1, data.toast.timeLeft) * slide;
      const size = fitFontSize(15, 10, viewW - PANEL_W - 80, (px) => {
        ctx.font = `bold ${px}px ${MONO}`;
        return ctx.measureText(data.toast!.text).width;
      });
      ctx.font = `bold ${size}px ${MONO}`;
      const w = ctx.measureText(data.toast.text).width;
      const y = stackY - 2 + slide * 12;
      const x = centred(w + 36, y) + 18;
      ctx.fillStyle = "rgba(10,12,16,0.8)";
      ctx.beginPath();
      ctx.roundRect(x - 18, y, w + 36, 32, 16);
      ctx.fill();
      ctx.strokeStyle = alpha(palette.amber, 0.3);
      ctx.stroke();
      ctx.fillStyle = palette.amber;
      ctx.fillText(data.toast.text, x, y + 8);
      ctx.globalAlpha = 1;
      stackY += 40;
    }

    // First-run objective banner. The instructions are full sentences, so they
    // wrap to whatever width the screen actually has.
    if (data.onboarding) {
      const o = data.onboarding;
      const label = `GETTING STARTED · ${o.step}/${o.total}`;
      const maxTextW = Math.min(viewW - (roomBeside ? 48 : 60), 520);
      ctx.font = `bold 14px ${MONO}`;
      const lines = wrapText(o.text, maxTextW, (t) => ctx.measureText(t).width);
      const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
      ctx.font = `bold 10px ${MONO}`;
      const cardW = Math.max(textW, ctx.measureText(label).width) + 40;
      const cardH = 34 + lines.length * 17;
      const cardY = Math.round(roomBeside ? Math.max(stackY, viewH * 0.13) : stackY);
      const cardX = centred(cardW, cardY);
      ctx.fillStyle = "rgba(10,12,16,0.82)";
      ctx.beginPath();
      ctx.roundRect(cardX, cardY, cardW, cardH, 12);
      ctx.fill();
      ctx.strokeStyle = alpha(palette.amber, 0.4);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = alpha(palette.amber, 0.75);
      ctx.font = `bold 10px ${MONO}`;
      ctx.fillText(label, cardX + 20, cardY + 10);
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold 14px ${MONO}`;
      lines.forEach((l, i) => ctx.fillText(l, cardX + 20, cardY + 25 + i * 17));
      stackY = cardY + cardH + 8;
    }

    // Vertical-slice objective banner with a depth progress bar.
    if (data.objective) {
      const o = data.objective;
      const label = "◈ REACH THE ANOMALY";
      const prog = `${Math.min(o.current, o.target)} / ${o.target} m`;
      ctx.font = `bold 12px ${MONO}`;
      const cardW = Math.min(
        viewW - 24,
        Math.max(ctx.measureText(label).width + ctx.measureText(prog).width + 60, 300),
      );
      const cardY = Math.round(roomBeside ? Math.max(stackY, viewH * 0.13) : stackY);
      const cardX = centred(cardW, cardY);
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
      stackY = cardY + 50;
    }

    // Station prompt. On touch the bottom of the screen belongs to the
    // on-screen controls, so it joins the top stack instead of sitting under a
    // thumb; with a keyboard it stays down by the controls legend.
    if (data.hint) {
      const text = layout.touch ? `enter ${data.hint}` : `[${interactKey()}] enter ${data.hint}`;
      ctx.font = `13px ${MONO}`;
      const w = ctx.measureText(text).width;
      const hy = layout.touch ? stackY : viewH - 58;
      const hx = layout.touch ? centred(w + 22, hy) : 12;
      ctx.fillStyle = "rgba(10,12,16,0.78)";
      ctx.beginPath();
      ctx.roundRect(hx, hy, w + 22, 26, 13);
      ctx.fill();
      ctx.strokeStyle = alpha(palette.amber, 0.35);
      ctx.stroke();
      ctx.fillStyle = palette.amber;
      ctx.fillText(text, hx + 11, hy + 7);
    }
    if (!layout.touch) {
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.font = `12px ${MONO}`;
      ctx.fillText(
        `← → fly/dig · ↑ thrust · ↓ drill · ${interactKey()} station · 1-4 items · Esc menu`,
        16,
        viewH - 26,
      );

      // Item pills, bottom-right: [1] ⛏icon ×2 — dimmed while the slot is empty.
      // The icon carries the identity, so the pill only spells out key and count.
      // Touch builds get real buttons for these instead (ui/touchControls.ts).
      ctx.font = `bold 11px ${MONO}`;
      const ICON_PX = 15;
      let px = viewW - 14;
      for (let i = data.items.length - 1; i >= 0; i--) {
        const item = data.items[i]!;
        const text = `${item.key}  ×${item.count}`;
        const w = ctx.measureText(text).width + ICON_PX + 20;
        px -= w;
        ctx.globalAlpha = item.count > 0 ? 1 : 0.35;
        ctx.fillStyle = "rgba(10,12,16,0.72)";
        ctx.beginPath();
        ctx.roundRect(px, viewH - 36, w, 23, 11);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.14)";
        ctx.stroke();
        ctx.fillStyle = item.count > 0 ? palette.amber : "#9a9a9a";
        ctx.fillText(item.key, px + 9, viewH - 30);
        const sprite = iconCanvas(item.icon, ICON_PX);
        ctx.drawImage(sprite, px + 19, viewH - 33, ICON_PX, ICON_PX);
        ctx.fillText(`×${item.count}`, px + 19 + ICON_PX + 4, viewH - 30);
        ctx.globalAlpha = 1;
        px -= 6;
      }
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
      const fw = BAR_W * fill;
      // The fill reads as lit: a coloured glow (matching the world's emissive
      // language) under a crisp bar, topped with a glassy sheen.
      ctx.save();
      ctx.shadowColor = c;
      ctx.shadowBlur = low ? 5 + pulse * 5 : 5;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.roundRect(12 + BAR_X, y, fw, 7, 3.5);
      ctx.fill();
      ctx.restore();
      // Sheen along the top of the fill.
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      ctx.beginPath();
      ctx.roundRect(12 + BAR_X + 0.5, y + 0.5, Math.max(0, fw - 1), 2.4, [2.5, 2.5, 1, 1]);
      ctx.fill();
    }
  }
}
