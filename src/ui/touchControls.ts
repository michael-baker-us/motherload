import type { Input } from "../engine/input";
import type { Game } from "../game/game";
import { ITEM_ORDER, ITEMS } from "../game/items";

export function isTouchCapable(): boolean {
  return (
    typeof window !== "undefined" &&
    ("ontouchstart" in window || navigator.maxTouchPoints > 0)
  );
}

const GLASS = "rgba(10,12,16,0.66)";
const BORDER = "rgba(255,255,255,0.18)";
const ACCENT = "rgba(46,96,150,0.55)"; // primary-action tint for the thrust key

// Kill every long-press affordance: text selection, the iOS copy/paste
// callout, and native tap highlighting. `user-select` alone is ignored by
// iOS Safari — the -webkit-* props are what actually stop the glyph from
// being selectable while a button is held.
const NO_SELECT =
  "user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;" +
  "-webkit-tap-highlight-color:transparent;touch-action:none;";

const BUTTON_BASE =
  "display:flex;align-items:center;justify-content:center;color:#e8e8e8;" +
  `background:${GLASS};border:1px solid ${BORDER};border-radius:14px;` +
  "font-family:monospace;font-weight:bold;pointer-events:auto;transition:filter 0.08s;" +
  NO_SELECT;

/**
 * On-screen buttons for touch devices. Buttons drive the same `Input`
 * instance the keyboard does by simulating the key codes `Game.update`
 * already reads, so there's no separate touch code path in game logic.
 *
 * Layout: left thumb steers and digs down (◀ ▼ ▶), right thumb holds a big
 * THRUST key to fly up — the two most-held actions sit under opposite thumbs.
 */
export class TouchControls {
  private root: HTMLDivElement | null = null;
  private startOverlay!: HTMLDivElement;
  private startLabel!: HTMLDivElement;
  private newGameBtn!: HTMLButtonElement;
  private steerCluster!: HTMLDivElement;
  private thrustBtn!: HTMLButtonElement;
  private interactBtn!: HTMLButtonElement;
  private itemsCluster!: HTMLDivElement;
  private pauseBtn!: HTMLButtonElement;
  private itemBtns: HTMLButtonElement[] = [];

  mount(input: Input): void {
    if (!isTouchCapable() || this.root) return;

    const root = document.createElement("div");
    root.style.cssText =
      "position:fixed;inset:0;z-index:5;pointer-events:none;" + NO_SELECT;
    // Belt-and-braces: no context menu anywhere in the control layer.
    root.addEventListener("contextmenu", (e) => e.preventDefault());
    document.body.appendChild(root);
    this.root = root;

    const { overlay, label, newGameBtn } = this.buildStartOverlay(input);
    this.startOverlay = overlay;
    this.startLabel = label;
    this.newGameBtn = newGameBtn;
    root.appendChild(overlay);

    this.steerCluster = this.buildSteerCluster(input);
    root.appendChild(this.steerCluster);

    this.thrustBtn = this.buildThrustButton(input);
    root.appendChild(this.thrustBtn);

    this.interactBtn = this.tapButton("E", "Enter", input, "enter station");
    this.interactBtn.style.cssText +=
      "position:absolute;right:18px;bottom:150px;width:58px;height:58px;" +
      "border-radius:29px;font-size:17px;";
    root.appendChild(this.interactBtn);

    this.itemsCluster = this.buildItemsCluster(input);
    root.appendChild(this.itemsCluster);

    this.pauseBtn = this.tapButton("⏸", "Escape", input, "menu");
    this.pauseBtn.style.cssText +=
      "position:absolute;top:14px;right:14px;width:44px;height:44px;" +
      "border-radius:22px;font-size:16px;";
    root.appendChild(this.pauseBtn);
  }

  /** Called once per render frame to reflect the current game state. */
  sync(game: Game): void {
    if (!this.root) return;
    const playing = game.state === "playing";
    const waiting = game.state === "title" || game.state === "dead";

    this.steerCluster.style.display = playing ? "flex" : "none";
    this.thrustBtn.style.display = playing ? "flex" : "none";
    this.interactBtn.style.display = playing ? "flex" : "none";
    this.itemsCluster.style.display = playing ? "flex" : "none";
    this.pauseBtn.style.display = playing ? "flex" : "none";
    this.startOverlay.style.display = waiting ? "flex" : "none";

    if (waiting) {
      this.startLabel.textContent =
        game.state === "dead"
          ? "TAP TO LAUNCH REPLACEMENT POD"
          : game.hasSave
            ? "TAP TO CONTINUE"
            : "TAP TO START DIGGING";
      this.newGameBtn.style.display = game.state === "title" && game.hasSave ? "flex" : "none";
      return;
    }
    if (!playing) return;

    // The interact key only does anything while parked on a station — dim and
    // disable it otherwise so it reads as contextual, not broken.
    const hint = game.stationHint();
    this.interactBtn.style.opacity = hint ? "1" : "0.3";
    this.interactBtn.style.pointerEvents = hint ? "auto" : "none";

    const items = game.player.items;
    ITEM_ORDER.forEach((id, i) => {
      const btn = this.itemBtns[i]!;
      const owned = items[id];
      btn.style.opacity = owned > 0 ? "1" : "0.32";
      btn.style.pointerEvents = owned > 0 ? "auto" : "none";
      const count = btn.querySelector<HTMLSpanElement>("[data-count]");
      if (count) count.textContent = `×${owned}`;
    });
  }

  private buildStartOverlay(
    input: Input,
  ): { overlay: HTMLDivElement; label: HTMLDivElement; newGameBtn: HTMLButtonElement } {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:absolute;inset:0;display:none;flex-direction:column;align-items:center;" +
      "justify-content:flex-end;gap:12px;padding-bottom:16vh;pointer-events:auto;" + NO_SELECT;
    const label = document.createElement("div");
    label.style.cssText =
      "color:#ffe97a;font-size:15px;font-weight:bold;letter-spacing:1px;font-family:monospace;" +
      `padding:14px 22px;border-radius:12px;background:${GLASS};border:1px solid ${BORDER};`;
    overlay.appendChild(label);
    // The tap-anywhere zone must not swallow taps on the new-game button below it.
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target !== overlay && e.target !== label) return;
      e.preventDefault();
      input.press("Enter");
      input.release("Enter");
    });

    const newGameBtn = document.createElement("button");
    newGameBtn.textContent = "NEW GAME (overwrites save)";
    newGameBtn.style.cssText =
      "display:none;color:#d8c9b8;font-size:12px;font-family:monospace;" +
      `padding:10px 18px;border-radius:10px;background:${GLASS};border:1px solid ${BORDER};` +
      "pointer-events:auto;" + NO_SELECT;
    newGameBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      input.press("KeyN");
      input.release("KeyN");
    });
    overlay.appendChild(newGameBtn);

    return { overlay, label, newGameBtn };
  }

  /** Bottom-left steering row: move/dig left, dig down, move/dig right. */
  private buildSteerCluster(input: Input): HTMLDivElement {
    const el = document.createElement("div");
    el.style.cssText =
      "position:absolute;left:18px;bottom:26px;display:none;gap:10px;align-items:flex-end;";

    el.append(
      this.holdButton("◀", "ArrowLeft", input, "left", "width:62px;height:62px;font-size:22px;"),
      this.holdButton(
        "▼",
        "ArrowDown",
        input,
        "dig down",
        "width:62px;height:62px;font-size:22px;",
      ),
      this.holdButton("▶", "ArrowRight", input, "right", "width:62px;height:62px;font-size:22px;"),
    );
    return el;
  }

  /** Bottom-right primary action: hold to fly up. */
  private buildThrustButton(input: Input): HTMLButtonElement {
    const btn = this.holdButton(
      "",
      "ArrowUp",
      input,
      "thrust up",
      "position:absolute;right:18px;bottom:26px;width:108px;height:108px;" +
        `border-radius:26px;flex-direction:column;gap:3px;background:${ACCENT};`,
    );
    btn.innerHTML =
      '<span style="font-size:26px;line-height:1;pointer-events:none">▲</span>' +
      '<span style="font-size:13px;letter-spacing:2px;pointer-events:none">THRUST</span>';
    return btn;
  }

  /** Right-edge vertical stack of consumables (kept clear of the top-left HUD). */
  private buildItemsCluster(input: Input): HTMLDivElement {
    const el = document.createElement("div");
    el.style.cssText =
      "position:absolute;right:12px;top:50%;transform:translateY(-50%);display:none;" +
      "flex-direction:column;gap:9px;";
    this.itemBtns = ITEM_ORDER.map((id, i) => {
      const btn = this.tapButton("", `Digit${i + 1}`, input, ITEMS[id].name);
      btn.style.cssText +=
        "width:52px;height:52px;border-radius:12px;flex-direction:column;gap:1px;";
      btn.innerHTML =
        `<span style="font-size:11px;pointer-events:none">${ITEMS[id].tag}</span>` +
        '<span data-count style="font-size:10px;color:#ffe97a;pointer-events:none">×0</span>';
      el.appendChild(btn);
      return btn;
    });
    return el;
  }

  /** Held while touched — for movement/drilling directions read via `isDown`. */
  private holdButton(
    label: string,
    code: string,
    input: Input,
    ariaLabel: string,
    extraCss = "",
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    if (label) btn.textContent = label;
    btn.setAttribute("aria-label", ariaLabel);
    btn.style.cssText = BUTTON_BASE + "width:62px;height:62px;font-size:22px;" + extraCss;
    const press = (e: PointerEvent): void => {
      e.preventDefault();
      // Capture so a finger sliding off the button still gets its release;
      // best-effort only — the button must still work if it fails.
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      btn.style.filter = "brightness(1.5)";
      input.press(code);
    };
    const release = (e: PointerEvent): void => {
      e.preventDefault();
      btn.style.filter = "";
      input.release(code);
    };
    btn.addEventListener("pointerdown", press);
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointercancel", release);
    // Fallback in case capture above didn't take and the finger drags off.
    btn.addEventListener("pointerleave", release);
    return btn;
  }

  /** One-shot on tap — for actions read via `wasPressed`. */
  private tapButton(label: string, code: string, input: Input, ariaLabel: string): HTMLButtonElement {
    const btn = document.createElement("button");
    if (label) btn.textContent = label;
    btn.setAttribute("aria-label", ariaLabel);
    btn.style.cssText = BUTTON_BASE + "width:52px;height:52px;font-size:14px;";
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      btn.style.filter = "brightness(1.5)";
      input.press(code);
      input.release(code);
    });
    const clear = (): void => void (btn.style.filter = "");
    btn.addEventListener("pointerup", clear);
    btn.addEventListener("pointercancel", clear);
    btn.addEventListener("pointerleave", clear);
    return btn;
  }
}
