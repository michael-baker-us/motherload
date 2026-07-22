import { activeAudio } from "../audio/engine";
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
  private keyHandler = (e: KeyboardEvent): void => {
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
      "box-shadow:0 24px 60px rgba(0,0,0,0.6);padding:20px 24px;width:320px;" +
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
    this.render(game);
  }

  close(): void {
    if (!this.root) return;
    window.removeEventListener("keydown", this.keyHandler);
    this.root.remove();
    this.root = null;
    this.body = null;
    const onClose = this.onClose;
    this.onClose = null;
    onClose?.();
  }

  private render(game: Game): void {
    if (!this.body) return;
    this.body.replaceChildren();

    const ON = "#2f6f9a";
    const OFF = "#33404f";

    this.section("Display");
    this.button(`◧  View  ·  ${viewPrefs.depth ? "2.5D" : "Flat"}`, viewPrefs.depth ? ON : OFF, () => {
      toggleDepthView(window.localStorage);
      this.render(game);
    });
    this.button(
      `✦  Reduce shake & flash  ·  ${viewPrefs.reducedMotion ? "ON" : "OFF"}`,
      viewPrefs.reducedMotion ? ON : OFF,
      () => {
        toggleReducedMotion(window.localStorage);
        this.render(game);
      },
    );

    const audio = activeAudio();
    if (audio) {
      const s = audio.settings;
      this.section("Audio");
      this.buttonRow([
        [`${s.muted ? "🔇" : "🔊"}  Sound  ·  ${s.muted ? "OFF" : "ON"}`, s.muted ? "#7a3040" : ON, () => {
          audio.toggleMuted();
          this.render(game);
        }],
        ["–", OFF, () => {
          audio.nudgeVolume(-1);
          this.render(game);
        }],
        ["+", OFF, () => {
          audio.nudgeVolume(1);
          this.render(game);
        }],
      ]);
      this.line(`volume ${s.muted ? "muted" : `${Math.round(s.volume * 100)}%`}`, "#7f8ba3");
    }

    this.section("Dev · Testing");
    for (const [cheat, label] of CHEAT_LABELS) {
      const on = game.cheats[cheat];
      this.button(`⚙  ${label}  ·  ${on ? "ON" : "OFF"}`, on ? "#c9762e" : OFF, () => {
        game.toggleCheat(cheat);
        this.render(game);
      });
    }
    this.line(
      game.devMode
        ? "⚠ cheats active · progress will NOT be saved"
        : "any active cheat disables saving",
      game.devMode ? "#ffb060" : "#7f8ba3",
    );
    this.button("◈  Warp to anomaly depth", "#3a5a9a", () => {
      game.devWarpToGoal();
      this.close(); // resume so the arrival + payoff play out
    });
    this.button(`▦  Telemetry  ·  ${game.showTelemetry ? "ON" : "OFF"}`, game.showTelemetry ? ON : OFF, () => {
      game.showTelemetry = !game.showTelemetry;
      this.render(game);
    });

    this.section("");
    this.button("▶  Resume", "#2e7d46", () => this.close());
  }

  /** A small uppercase group heading. */
  private section(title: string): void {
    const h = document.createElement("div");
    h.textContent = title.toUpperCase();
    h.style.cssText =
      `margin:${title ? "16px" : "18px"} 0 7px;font-size:9px;letter-spacing:2.5px;` +
      "color:#6f7a91;font-weight:bold;";
    this.body?.appendChild(h);
  }

  private line(text: string, color: string): void {
    const div = document.createElement("div");
    div.textContent = text;
    div.style.cssText = `margin:6px 0 12px;font-size:12px;color:${color};`;
    this.body?.appendChild(div);
  }

  /** Several buttons on one line — used for the compact sound controls. */
  private buttonRow(buttons: Array<[string, string, () => void]>): void {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;";
    const prevBody = this.body;
    this.body = row as HTMLDivElement;
    for (const [label, background, onClick] of buttons) this.button(label, background, onClick);
    this.body = prevBody;
    this.body?.appendChild(row);
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

  private button(label: string, background: string, onClick: () => void): void {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.cssText =
      "display:block;margin-top:10px;padding:9px 16px;font-family:monospace;font-size:14px;" +
      `cursor:pointer;background:${background};color:#fff;border-radius:8px;` +
      "border:1px solid rgba(255,255,255,0.18);transition:filter 0.12s;";
    btn.addEventListener("mouseenter", () => (btn.style.filter = "brightness(1.2)"));
    btn.addEventListener("mouseleave", () => (btn.style.filter = ""));
    btn.addEventListener("click", onClick);
    this.body?.appendChild(btn);
  }
}
