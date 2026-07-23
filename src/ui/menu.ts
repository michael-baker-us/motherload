import { activeAudio } from "../audio/engine";
import { BIOMES } from "../game/biomes";
import {
  ACTION_LABELS,
  ACTIONS,
  keyLabel,
  keysFor,
  rebind,
  resetBindings,
  type Action,
} from "../engine/bindings";
import type { DevCheats, Game } from "../game/game";
import { toggleDepthView, toggleReducedMotion, viewPrefs } from "../render/prefs";

const CHEAT_LABELS: Array<[keyof DevCheats, string]> = [
  ["unlimitedFuel", "Unlimited fuel"],
  ["unlimitedFunds", "Unlimited funds"],
  ["noDamage", "No damage"],
  ["digAnything", "Dig anything"],
];

/**
 * Pause/settings overlay (Escape). Same pattern as ShopOverlay: DOM on top,
 * simulation paused underneath, Escape or the Resume button closes it.
 */
export class MenuOverlay {
  private root: HTMLDivElement | null = null;
  private body: HTMLDivElement | null = null;
  private onClose: (() => void) | null = null;
  private game: Game | null = null;
  /** The action awaiting a new key, or null. */
  private rebinding: Action | null = null;
  /** Whether the Dev·Testing group is expanded (collapsed by default). */
  private devOpen = false;
  private keyHandler = (e: KeyboardEvent): void => {
    // While rebinding, the next key press becomes the binding (Escape cancels).
    if (this.rebinding) {
      e.preventDefault();
      if (e.code !== "Escape") rebind(this.rebinding, e.code, window.localStorage);
      this.rebinding = null;
      if (this.game) this.render(this.game);
      return;
    }
    if (e.code === "Escape") {
      e.preventDefault();
      this.close();
    }
  };

  open(game: Game, onClose: () => void): void {
    this.close();
    this.onClose = onClose;

    const root = document.createElement("div");
    root.style.cssText =
      "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;" +
      "background:rgba(0,0,0,0.55);font-family:monospace;z-index:10;";

    const panel = document.createElement("div");
    panel.style.cssText =
      "position:relative;background:rgba(16,19,26,0.86);backdrop-filter:blur(14px);color:#e8e8e8;" +
      "border:1px solid rgba(255,255,255,0.14);border-radius:16px;" +
      "box-shadow:0 24px 60px rgba(0,0,0,0.6);padding:20px 24px;width:560px;max-width:92vw;" +
      // Scroll inside the panel when it's taller than the viewport.
      "max-height:88vh;overflow-y:auto;" +
      // fade/slide in on open (slide skipped under reduced-motion)
      "opacity:0;transition:opacity .18s ease, transform .18s ease;" +
      (viewPrefs.reducedMotion ? "" : "transform:translateY(10px) scale(0.985);");

    const title = document.createElement("div");
    title.textContent = "⏸  PAUSED";
    title.style.cssText =
      "font-size:15px;font-weight:bold;margin-bottom:6px;letter-spacing:2px;color:#cdd6e6;";
    panel.appendChild(title);
    panel.appendChild(this.closeButton());

    const body = document.createElement("div");
    // Two-column grid so the many rows pack wide instead of one long scroll;
    // collapses to a single column on narrow screens.
    body.style.cssText =
      "display:grid;grid-template-columns:repeat(auto-fit,minmax(232px,1fr));" +
      "gap:8px;align-content:start;";
    panel.appendChild(body);

    const hint = document.createElement("div");
    hint.textContent = "[Esc] resume";
    hint.style.cssText = "margin-top:16px;color:#7f8ba3;font-size:11px;letter-spacing:0.5px;";
    panel.appendChild(hint);

    root.appendChild(panel);
    document.body.appendChild(root);
    // Trigger the entrance transition on the next frame.
    requestAnimationFrame(() => {
      panel.style.opacity = "1";
      panel.style.transform = "none";
    });
    window.addEventListener("keydown", this.keyHandler);

    this.root = root;
    this.body = body;
    this.game = game;
    this.rebinding = null;
    this.render(game);
  }

  close(): void {
    if (!this.root) return;
    window.removeEventListener("keydown", this.keyHandler);
    this.root.remove();
    this.root = null;
    this.body = null;
    this.game = null;
    this.rebinding = null;
    const onClose = this.onClose;
    this.onClose = null;
    onClose?.();
  }

  private render(game: Game): void {
    if (!this.body) return;
    this.body.replaceChildren();

    this.section("Display");
    this.card({
      icon: "◧", title: "View", sub: viewPrefs.depth ? "2.5D depth perspective" : "flat side-on",
      actionLabel: viewPrefs.depth ? "2.5D" : "Flat", on: viewPrefs.depth,
      onClick: () => { toggleDepthView(window.localStorage); this.render(game); },
    });
    this.card({
      icon: "✦", title: "Reduce shake & flash", sub: "photosensitivity safe",
      actionLabel: viewPrefs.reducedMotion ? "ON" : "OFF", on: viewPrefs.reducedMotion,
      onClick: () => { toggleReducedMotion(window.localStorage); this.render(game); },
    });

    const audio = activeAudio();
    if (audio) {
      const s = audio.settings;
      this.section("Audio");
      this.card({
        icon: s.muted ? "🔇" : "🔊", title: "Sound", sub: "master audio",
        actionLabel: s.muted ? "OFF" : "ON", on: !s.muted,
        onClick: () => { audio.toggleMuted(); this.render(game); },
      });
      this.volumeRow(
        s.muted ? "muted" : `${Math.round(s.volume * 100)}%`,
        () => { audio.nudgeVolume(-1); this.render(game); },
        () => { audio.nudgeVolume(1); this.render(game); },
      );
    }

    this.section("Controls");
    for (const action of ACTIONS) {
      const listening = this.rebinding === action;
      const keys = keysFor(action).map(keyLabel).join(" / ") || "unbound";
      this.card({
        icon: "⌨", title: ACTION_LABELS[action], sub: listening ? "press any key…" : keys,
        actionLabel: listening ? "…" : "Rebind", on: listening,
        onClick: () => { this.rebinding = action; this.render(game); },
      });
    }
    this.card({
      icon: "↺", title: "Reset controls", sub: "restore defaults",
      actionLabel: "Reset", onClick: () => { resetBindings(window.localStorage); this.render(game); },
    });

    this.collapsibleSection("Dev · Testing", this.devOpen, () => {
      this.devOpen = !this.devOpen;
      this.render(game);
    });
    if (this.devOpen) {
      for (const [cheat, label] of CHEAT_LABELS) {
        const on = game.cheats[cheat];
        this.card({
          icon: "⚙", title: label, sub: "cheat", actionLabel: on ? "ON" : "OFF", warn: on,
          onClick: () => { game.toggleCheat(cheat); this.render(game); },
        });
      }
      this.line(
        game.devMode
          ? "⚠ cheats active · progress will NOT be saved"
          : "any active cheat disables saving",
        game.devMode ? "#ffb060" : "#7f8ba3",
      );
      this.card({
        icon: "◈", title: "Warp to anomaly", sub: "the objective depth", actionLabel: "Warp",
        onClick: () => { game.devWarpToGoal(); this.close(); }, // resume so the payoff plays out
      });
      for (const biome of BIOMES) {
        this.card({
          icon: "◈", title: biome.name, sub: `warp · ${biome.minDepth}m`, actionLabel: "Warp",
          onClick: () => { game.devWarpToDepth(biome.minDepth + 15); this.close(); },
        });
      }
      this.card({
        icon: "▦", title: "Telemetry", sub: "live pace readout",
        actionLabel: game.showTelemetry ? "ON" : "OFF", on: game.showTelemetry,
        onClick: () => { game.showTelemetry = !game.showTelemetry; this.render(game); },
      });
    }

    this.section("");
    this.resumeButton();
  }

  /** A small uppercase group heading spanning the full grid width. */
  private section(title: string): void {
    const h = document.createElement("div");
    h.textContent = title.toUpperCase();
    h.style.cssText =
      "grid-column:1/-1;margin:8px 0 -1px;font-size:9px;letter-spacing:2.5px;" +
      "color:#6f7a91;font-weight:bold;";
    this.body?.appendChild(h);
  }

  /**
   * A collapsible group heading — used for Dev·Testing, which is collapsed by
   * default so its many rows don't dominate the menu's height.
   */
  private collapsibleSection(title: string, open: boolean, onToggle: () => void): void {
    const h = document.createElement("button");
    h.textContent = `${open ? "▾" : "▸"}  ${title.toUpperCase()}`;
    h.style.cssText =
      "grid-column:1/-1;margin:10px 0 -1px;padding:0;text-align:left;cursor:pointer;" +
      "background:none;border:none;font-family:monospace;font-size:9px;letter-spacing:2.5px;" +
      "color:#6f7a91;font-weight:bold;";
    h.addEventListener("mouseenter", () => (h.style.color = "#9aa4b2"));
    h.addEventListener("mouseleave", () => (h.style.color = "#6f7a91"));
    h.addEventListener("click", onToggle);
    this.body?.appendChild(h);
  }

  private line(text: string, color: string): void {
    const div = document.createElement("div");
    div.textContent = text;
    div.style.cssText = `grid-column:1/-1;margin:2px 0;font-size:11px;color:${color};`;
    this.body?.appendChild(div);
  }

  /**
   * A settings row styled like the shop cards: icon · label/detail · action.
   * `on` tints it as an active toggle; `warn` tints it as a caution (cheats).
   */
  private card(opts: {
    icon: string;
    title: string;
    sub: string;
    actionLabel: string;
    on?: boolean;
    warn?: boolean;
    onClick: () => void;
  }): void {
    const accent = opts.warn
      ? { border: "rgba(201,118,46,0.5)", bg: "rgba(80,48,18,0.35)", btn: "linear-gradient(180deg,#d08034,#b5661f)" }
      : opts.on
        ? { border: "rgba(75,214,160,0.5)", bg: "rgba(30,70,56,0.3)", btn: "linear-gradient(180deg,#3fae7a,#2e7d55)" }
        : { border: "rgba(255,255,255,0.1)", bg: "rgba(255,255,255,0.035)", btn: "rgba(255,255,255,0.1)" };

    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;align-items:center;gap:11px;padding:9px 11px;" +
      `border:1px solid ${accent.border};border-radius:10px;background:${accent.bg};`;

    const icon = document.createElement("div");
    icon.textContent = opts.icon;
    icon.style.cssText = "font-size:20px;width:24px;text-align:center;flex:none;";

    const info = document.createElement("div");
    info.style.cssText = "flex:1;min-width:0;";
    const title = document.createElement("div");
    title.textContent = opts.title;
    title.style.cssText = "font-size:13px;font-weight:bold;color:#fff;";
    const sub = document.createElement("div");
    sub.textContent = opts.sub;
    sub.style.cssText = "font-size:11px;color:#9aa4b2;margin-top:1px;";
    info.append(title, sub);

    const btn = document.createElement("button");
    btn.textContent = opts.actionLabel;
    btn.style.cssText =
      "flex:none;min-width:58px;padding:7px 13px;font-family:monospace;font-size:12px;font-weight:bold;" +
      `cursor:pointer;color:#fff;border:none;border-radius:8px;background:${accent.btn};transition:filter 0.12s;`;
    btn.addEventListener("mouseenter", () => (btn.style.filter = "brightness(1.2)"));
    btn.addEventListener("mouseleave", () => (btn.style.filter = ""));
    btn.addEventListener("click", opts.onClick);

    row.append(icon, info, btn);
    this.body?.appendChild(row);
  }

  /** Volume card: a readout flanked by −/+ steppers. */
  private volumeRow(value: string, onMinus: () => void, onPlus: () => void): void {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;align-items:center;gap:11px;padding:9px 11px;" +
      "border:1px solid rgba(255,255,255,0.1);border-radius:10px;background:rgba(255,255,255,0.035);";

    const icon = document.createElement("div");
    icon.textContent = "🔉";
    icon.style.cssText = "font-size:20px;width:24px;text-align:center;flex:none;";

    const info = document.createElement("div");
    info.style.cssText = "flex:1;min-width:0;";
    const title = document.createElement("div");
    title.textContent = "Volume";
    title.style.cssText = "font-size:13px;font-weight:bold;color:#fff;";
    const sub = document.createElement("div");
    sub.textContent = value;
    sub.style.cssText = "font-size:11px;color:#8ec8ff;font-family:monospace;margin-top:1px;";
    info.append(title, sub);

    const step = (label: string, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText =
        "flex:none;width:32px;height:30px;padding:0;font-family:monospace;font-size:16px;line-height:1;" +
        "cursor:pointer;color:#fff;border:none;border-radius:8px;background:rgba(255,255,255,0.1);transition:filter 0.12s;";
      b.addEventListener("mouseenter", () => (b.style.filter = "brightness(1.3)"));
      b.addEventListener("mouseleave", () => (b.style.filter = ""));
      b.addEventListener("click", onClick);
      return b;
    };

    row.append(icon, info, step("–", onMinus), step("+", onPlus));
    this.body?.appendChild(row);
  }

  /** The prominent full-width resume action that closes the menu. */
  private resumeButton(): void {
    const btn = document.createElement("button");
    btn.textContent = "▶  Resume";
    btn.style.cssText =
      "grid-column:1/-1;width:100%;margin-top:4px;padding:11px 16px;font-family:monospace;" +
      "font-size:14px;font-weight:bold;cursor:pointer;color:#fff;border:none;border-radius:10px;" +
      "background:linear-gradient(180deg,#37954f,#2e7d46);transition:filter 0.12s;";
    btn.addEventListener("mouseenter", () => (btn.style.filter = "brightness(1.15)"));
    btn.addEventListener("mouseleave", () => (btn.style.filter = ""));
    btn.addEventListener("click", () => this.close());
    this.body?.appendChild(btn);
  }

  /** Tap/click target for touch devices, which have no Escape key. */
  private closeButton(): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = "✕";
    btn.setAttribute("aria-label", "Close");
    btn.style.cssText =
      "position:absolute;top:14px;right:14px;width:30px;height:30px;padding:0;" +
      "font-family:monospace;font-size:15px;line-height:1;cursor:pointer;color:#fff;" +
      "border:1px solid rgba(255,255,255,0.18);border-radius:8px;" +
      "background:rgba(255,255,255,0.08);";
    btn.addEventListener("click", () => this.close());
    return btn;
  }
}
