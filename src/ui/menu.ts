import type { Game } from "../game/game";

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
      "background:#1c1f24;color:#e8e8e8;border:2px solid #555;border-radius:8px;" +
      "padding:20px 24px;min-width:340px;";

    const title = document.createElement("div");
    title.textContent = "SETTINGS";
    title.style.cssText =
      "font-size:18px;font-weight:bold;margin-bottom:12px;letter-spacing:1px;";
    panel.appendChild(title);

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

    this.button(`Dev mode: ${game.devMode ? "ON" : "OFF"}`, game.devMode ? "#c9762e" : "#2e7d32", () => {
      game.toggleDevMode();
      this.render(game);
    });
    this.line(
      game.devMode
        ? "⚠ unlimited fuel & funds · progress will NOT be saved"
        : "cheats for testing: unlimited fuel & funds (disables saving)",
      game.devMode ? "#ffb060" : "#888",
    );

    this.button("Resume", "#3d5a80", () => this.close());
  }

  private line(text: string, color: string): void {
    const div = document.createElement("div");
    div.textContent = text;
    div.style.cssText = `margin:6px 0 12px;font-size:12px;color:${color};`;
    this.body?.appendChild(div);
  }

  private button(label: string, background: string, onClick: () => void): void {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.cssText =
      "display:block;margin-top:10px;padding:8px 14px;font-family:monospace;font-size:14px;" +
      `cursor:pointer;background:${background};color:#fff;border:none;border-radius:4px;`;
    btn.addEventListener("click", onClick);
    this.body?.appendChild(btn);
  }
}
