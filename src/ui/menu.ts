import { activeAudio } from "../audio/engine";
import type { DevCheats, Game } from "../game/game";
import { toggleDepthView, viewPrefs } from "../render/prefs";

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
      "position:relative;background:rgba(16,19,26,0.82);backdrop-filter:blur(12px);color:#e8e8e8;" +
      "border:1px solid rgba(255,255,255,0.14);border-radius:14px;" +
      "box-shadow:0 18px 50px rgba(0,0,0,0.55);padding:22px 26px;min-width:340px;";

    const title = document.createElement("div");
    title.textContent = "SETTINGS";
    title.style.cssText =
      "font-size:18px;font-weight:bold;margin-bottom:12px;letter-spacing:1px;";
    panel.appendChild(title);
    panel.appendChild(this.closeButton());

    const body = document.createElement("div");
    panel.appendChild(body);

    const hint = document.createElement("div");
    hint.textContent = "[Esc] resume";
    hint.style.cssText = "margin-top:14px;color:#888;font-size:12px;";
    panel.appendChild(hint);

    root.appendChild(panel);
    document.body.appendChild(root);
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

    this.button(`View: ${viewPrefs.depth ? "2.5D" : "Flat"}`, "#3d5a80", () => {
      toggleDepthView(window.localStorage);
      this.render(game);
    });

    const audio = activeAudio();
    if (audio) {
      const s = audio.settings;
      const volLabel = s.muted ? "muted" : `${Math.round(s.volume * 100)}%`;
      this.buttonRow([
        [`Sound: ${s.muted ? "OFF" : "ON"}`, s.muted ? "#7a3040" : "#3d5a80", () => {
          audio.toggleMuted();
          this.render(game);
        }],
        ["Vol −", "#3d5a80", () => {
          audio.nudgeVolume(-1);
          this.render(game);
        }],
        ["Vol +", "#3d5a80", () => {
          audio.nudgeVolume(1);
          this.render(game);
        }],
      ]);
      this.line(`volume ${volLabel}`, "#888");
    }

    for (const [cheat, label] of CHEAT_LABELS) {
      const on = game.cheats[cheat];
      this.button(`${label}: ${on ? "ON" : "OFF"}`, on ? "#c9762e" : "#2e7d32", () => {
        game.toggleCheat(cheat);
        this.render(game);
      });
    }
    this.line(
      game.devMode
        ? "⚠ cheats active · progress will NOT be saved"
        : "dev cheats for testing — any active cheat disables saving",
      game.devMode ? "#ffb060" : "#888",
    );

    // Test shortcut: jump straight to the objective depth to try the payoff.
    this.button("◈ Warp to anomaly depth (dev)", "#3a5a9a", () => {
      game.devWarpToGoal();
      this.close(); // resume so the arrival + payoff play out
    });

    // Live pace readout for tuning the balance by feel.
    this.button(`Telemetry: ${game.showTelemetry ? "ON" : "OFF"}`, "#3a5a9a", () => {
      game.showTelemetry = !game.showTelemetry;
      this.render(game);
    });

    this.button("Resume", "#3d5a80", () => this.close());
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
