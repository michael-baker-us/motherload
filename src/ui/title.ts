import type { Game } from "../game/game";
import { SEASONS } from "../game/seasons";
import { FONT_UI } from "../render/fonts";
import { iconImg, type IconId } from "../render/icons";
import { viewPrefs } from "../render/prefs";

/**
 * The title screen's interactive half. The canvas keeps drawing the living sky
 * and the logo; everything the player can *act on* — start, new game, season,
 * settings — lives here as real buttons so it's clickable, tappable, hoverable
 * and focusable instead of being canvas text with a key hint next to it.
 *
 * Same overlay pattern as ShopOverlay/MenuOverlay, but mounted from `main.ts`
 * (like TouchControls) rather than by `Game`: the title screen is the game's
 * *initial* state, and `game/` must stay constructible without a DOM.
 *
 * The keyboard path in `Game.update` is untouched — Enter/N/◂ ▸ still work, and
 * the buttons call the very same `Game` methods.
 */
export class TitleOverlay {
  private root: HTMLDivElement | null = null;
  private panel: HTMLDivElement | null = null;
  /** Rebuild key — the DOM is only rebuilt when something it shows changes. */
  private signature = "";
  /** New Game asks once before overwriting an existing save. */
  private confirmingNew = false;

  mount(game: Game): void {
    if (this.root) return;
    const root = document.createElement("div");
    // Pointer-events are off on the backdrop so the canvas behind stays live;
    // the panel itself opts back in.
    root.style.cssText =
      "position:fixed;inset:0;z-index:6;display:none;pointer-events:none;" +
      "flex-direction:column;align-items:center;justify-content:flex-end;" +
      `padding:0 16px 5vh;font-family:${FONT_UI};` +
      "user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;";

    const panel = document.createElement("div");
    panel.style.cssText =
      "pointer-events:auto;display:flex;flex-direction:column;align-items:stretch;gap:10px;" +
      "width:420px;max-width:100%;";
    root.appendChild(panel);

    document.body.appendChild(root);
    this.root = root;
    this.panel = panel;
    this.sync(game);
  }

  /** Called once per render frame from `main.ts`, like TouchControls.sync. */
  sync(game: Game): void {
    if (!this.root || !this.panel) return;
    const showing = game.state === "title";
    this.root.style.display = showing ? "flex" : "none";
    if (!showing) {
      // Leaving the title clears the confirm so it never greets a returning player.
      this.confirmingNew = false;
      this.signature = "";
      return;
    }
    // Cheap frame-to-frame guard: only rebuild when what's displayed changed.
    const signature = `${game.hasSave}|${game.titleSeason}|${this.confirmingNew}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.render(game);
  }

  unmount(): void {
    this.root?.remove();
    this.root = null;
    this.panel = null;
  }

  private render(game: Game): void {
    const panel = this.panel;
    if (!panel) return;
    panel.replaceChildren();

    // Primary action: continue the save if there is one, else start fresh.
    panel.appendChild(
      this.button({
        label: game.hasSave ? "▶  CONTINUE" : "▶  START DIGGING",
        hint: "Enter",
        primary: true,
        onClick: () => {
          if (!game.continueGame()) game.startNewGame();
        },
      }),
    );

    // With no save, "new game" *is* the primary action above — don't repeat it.
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:10px;";
    if (game.hasSave) {
      row.appendChild(
        this.button({
          label: this.confirmingNew ? "OVERWRITE SAVE?" : "✦  NEW GAME",
          hint: this.confirmingNew ? "click to confirm" : "N",
          warn: this.confirmingNew,
          grow: true,
          onClick: () => {
            // One click arms, the second commits — a mis-click must not eat a run.
            if (!this.confirmingNew) {
              this.confirmingNew = true;
              this.sync(game);
              return;
            }
            this.confirmingNew = false;
            game.startNewGame();
          },
        }),
      );
    }
    row.appendChild(
      this.button({
        label: "⚙  SETTINGS",
        hint: "controls · audio · tutorials",
        grow: !game.hasSave,
        onClick: () => game.openTitleSettings(),
      }),
    );
    panel.appendChild(row);

    this.seasonPicker(game);

    const controls = document.createElement("div");
    controls.textContent = "← →  move    ↑  thrust    ↓  drill    E  station";
    controls.style.cssText =
      "margin-top:4px;text-align:center;font-size:11px;color:rgba(255,255,255,0.42);";
    panel.appendChild(controls);
  }

  /**
   * Season chips. The picker only ever affects a *new* run — a continued save
   * carries the season its world was generated under — hence the label.
   */
  private seasonPicker(game: Game): void {
    const panel = this.panel;
    if (!panel) return;

    const label = document.createElement("div");
    label.textContent = "NEW GAME SEASON";
    label.style.cssText =
      "margin-top:6px;text-align:center;font-size:9px;font-weight:bold;letter-spacing:3px;" +
      "color:rgba(255,255,255,0.38);";
    panel.appendChild(label);

    const chips = document.createElement("div");
    chips.style.cssText = "display:flex;gap:8px;";
    SEASONS.forEach((season, i) => {
      const on = i === game.titleSeason;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.setAttribute("aria-pressed", String(on));
      chip.style.cssText =
        `flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 4px;` +
        `font-family:${FONT_UI};font-size:10px;font-weight:bold;letter-spacing:1px;cursor:pointer;` +
        `border:1px solid ${on ? season.look.accent : "rgba(255,255,255,0.14)"};border-radius:10px;` +
        `background:${on ? "rgba(255,255,255,0.13)" : "rgba(10,12,18,0.6)"};` +
        `color:${on ? season.look.accent : "rgba(255,255,255,0.6)"};` +
        "backdrop-filter:blur(6px);transition:background 0.12s,color 0.12s;";
      chip.appendChild(iconImg(season.look.iconId as IconId, 18));
      const name = document.createElement("span");
      name.textContent = season.name.toUpperCase();
      chip.appendChild(name);
      chip.addEventListener("mouseenter", () => {
        if (!on) chip.style.background = "rgba(255,255,255,0.08)";
      });
      chip.addEventListener("mouseleave", () => {
        if (!on) chip.style.background = "rgba(10,12,18,0.6)";
      });
      chip.addEventListener("click", () => {
        game.pickTitleSeason(i);
        // Otherwise the chip keeps focus and the next Enter re-clicks it as well
        // as starting the run.
        chip.blur();
        this.sync(game);
      });
      chips.appendChild(chip);
    });
    panel.appendChild(chips);

    const pick = SEASONS[game.titleSeason]!;
    const blurb = document.createElement("div");
    blurb.textContent = `${pick.tagline} — ${pick.summary}`;
    blurb.style.cssText =
      "padding:0 8px;text-align:center;font-size:11px;line-height:1.4;" +
      "color:rgba(255,255,255,0.5);min-height:30px;";
    panel.appendChild(blurb);
  }

  /** A full-width title action: bold label over a dim key/consequence hint. */
  private button(opts: {
    label: string;
    hint: string;
    primary?: boolean;
    warn?: boolean;
    grow?: boolean;
    onClick: () => void;
  }): HTMLButtonElement {
    const skin = opts.warn
      ? { bg: "linear-gradient(180deg,#c9612a,#a34a1c)", border: "rgba(255,180,110,0.5)", fg: "#fff" }
      : opts.primary
        ? { bg: "linear-gradient(180deg,#f0c020,#c98a14)", border: "rgba(255,224,140,0.6)", fg: "#241a05" }
        : { bg: "rgba(12,15,22,0.72)", border: "rgba(255,255,255,0.18)", fg: "#e8e8e8" };

    const btn = document.createElement("button");
    btn.type = "button";
    btn.style.cssText =
      `flex:${opts.primary || opts.grow ? "1" : "0 1 auto"};display:flex;flex-direction:column;` +
      `align-items:center;gap:2px;padding:${opts.primary ? "14px 18px" : "10px 16px"};` +
      `font-family:${FONT_UI};cursor:pointer;border:1px solid ${skin.border};border-radius:12px;` +
      `background:${skin.bg};color:${skin.fg};backdrop-filter:blur(8px);` +
      "box-shadow:0 10px 26px rgba(0,0,0,0.45);transition:filter 0.12s,transform 0.12s;";

    const label = document.createElement("span");
    label.textContent = opts.label;
    label.style.cssText =
      `font-size:${opts.primary ? "18px" : "13px"};font-weight:bold;letter-spacing:1.5px;`;
    const hint = document.createElement("span");
    hint.textContent = opts.hint;
    hint.style.cssText = "font-size:10px;letter-spacing:1px;opacity:0.62;";
    btn.append(label, hint);

    btn.addEventListener("mouseenter", () => {
      btn.style.filter = "brightness(1.15)";
      if (!viewPrefs.reducedMotion) btn.style.transform = "translateY(-1px)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.filter = "";
      btn.style.transform = "";
    });
    btn.addEventListener("click", () => {
      btn.blur(); // don't let a later Enter re-fire this button
      opts.onClick();
    });
    return btn;
  }
}
