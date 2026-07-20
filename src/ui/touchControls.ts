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
const BUTTON_BASE =
  `display:flex;align-items:center;justify-content:center;color:#e8e8e8;` +
  `background:${GLASS};border:1px solid ${BORDER};border-radius:14px;` +
  `font-family:monospace;font-weight:bold;touch-action:none;` +
  `-webkit-tap-highlight-color:transparent;user-select:none;pointer-events:auto;`;

/**
 * On-screen buttons for touch devices. Buttons drive the same `Input`
 * instance the keyboard does by simulating the key codes `Game.update`
 * already reads, so there's no separate touch code path in game logic.
 */
export class TouchControls {
  private root: HTMLDivElement | null = null;
  private startOverlay!: HTMLDivElement;
  private startLabel!: HTMLDivElement;
  private newGameBtn!: HTMLButtonElement;
  private moveCluster!: HTMLDivElement;
  private actionCluster!: HTMLDivElement;
  private pauseBtn!: HTMLButtonElement;
  private interactBtn!: HTMLButtonElement;
  private itemBtns: HTMLButtonElement[] = [];

  mount(input: Input): void {
    if (!isTouchCapable() || this.root) return;

    const root = document.createElement("div");
    root.style.cssText = "position:fixed;inset:0;z-index:5;pointer-events:none;";
    document.body.appendChild(root);
    this.root = root;

    const { overlay, label, newGameBtn } = this.buildStartOverlay(input);
    this.startOverlay = overlay;
    this.startLabel = label;
    this.newGameBtn = newGameBtn;
    root.appendChild(overlay);

    this.moveCluster = this.buildMoveCluster(input);
    root.appendChild(this.moveCluster);

    const { cluster, interactBtn, itemBtns } = this.buildActionCluster(input);
    this.actionCluster = cluster;
    this.interactBtn = interactBtn;
    this.itemBtns = itemBtns;
    root.appendChild(this.actionCluster);

    this.pauseBtn = this.tapButton("⏸", "Escape", input);
    this.pauseBtn.style.cssText +=
      "position:absolute;top:12px;right:12px;width:42px;height:42px;border-radius:21px;font-size:16px;";
    root.appendChild(this.pauseBtn);
  }

  /** Called once per render frame to reflect the current game state. */
  sync(game: Game): void {
    if (!this.root) return;
    const playing = game.state === "playing";
    const waiting = game.state === "title" || game.state === "dead";

    this.moveCluster.style.display = playing ? "grid" : "none";
    this.actionCluster.style.display = playing ? "flex" : "none";
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

    const hint = game.stationHint();
    this.interactBtn.style.opacity = hint ? "1" : "0.35";
    this.interactBtn.style.pointerEvents = hint ? "auto" : "none";

    const items = game.player.items;
    ITEM_ORDER.forEach((id, i) => {
      this.itemBtns[i]!.style.opacity = items[id] > 0 ? "1" : "0.35";
    });
  }

  private buildStartOverlay(
    input: Input,
  ): { overlay: HTMLDivElement; label: HTMLDivElement; newGameBtn: HTMLButtonElement } {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:absolute;inset:0;display:none;flex-direction:column;align-items:center;" +
      "justify-content:flex-end;gap:12px;padding-bottom:16vh;pointer-events:auto;";
    const label = document.createElement("div");
    label.style.cssText =
      `color:#ffe97a;font-size:15px;font-weight:bold;letter-spacing:1px;font-family:monospace;` +
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
      `display:none;color:#d8c9b8;font-size:12px;font-family:monospace;` +
      `padding:10px 18px;border-radius:10px;background:${GLASS};border:1px solid ${BORDER};` +
      "touch-action:none;-webkit-tap-highlight-color:transparent;pointer-events:auto;";
    newGameBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      input.press("KeyN");
      input.release("KeyN");
    });
    overlay.appendChild(newGameBtn);

    return { overlay, label, newGameBtn };
  }

  private buildMoveCluster(input: Input): HTMLDivElement {
    const el = document.createElement("div");
    el.style.cssText =
      "position:absolute;left:18px;bottom:24px;display:none;" +
      "grid-template-columns:60px 60px 60px;grid-template-rows:60px 60px 60px;" +
      'grid-template-areas:". up ." "left . right" ". down .";gap:8px;';

    const up = this.holdButton("▲", "ArrowUp", input);
    up.style.gridArea = "up";
    const left = this.holdButton("◀", "ArrowLeft", input);
    left.style.gridArea = "left";
    const right = this.holdButton("▶", "ArrowRight", input);
    right.style.gridArea = "right";
    const down = this.holdButton("▼", "ArrowDown", input);
    down.style.gridArea = "down";

    el.append(up, left, right, down);
    return el;
  }

  private buildActionCluster(
    input: Input,
  ): { cluster: HTMLDivElement; interactBtn: HTMLButtonElement; itemBtns: HTMLButtonElement[] } {
    const cluster = document.createElement("div");
    cluster.style.cssText =
      "position:absolute;right:18px;bottom:24px;display:none;flex-direction:column;" +
      "align-items:flex-end;gap:10px;";

    const items = document.createElement("div");
    items.style.cssText = "display:flex;gap:8px;";
    const itemBtns = ITEM_ORDER.map((id, i) => {
      const btn = this.tapButton(ITEMS[id].tag, `Digit${i + 1}`, input);
      btn.style.cssText += "width:44px;height:44px;border-radius:10px;font-size:10px;";
      items.appendChild(btn);
      return btn;
    });

    const interactBtn = this.tapButton("E", "Enter", input);
    interactBtn.style.cssText += "width:64px;height:64px;border-radius:32px;font-size:18px;";

    cluster.append(items, interactBtn);
    return { cluster, interactBtn, itemBtns };
  }

  /** Held while touched — for movement/drilling directions read via `isDown`. */
  private holdButton(label: string, code: string, input: Input): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.cssText = BUTTON_BASE + "width:60px;height:60px;font-size:20px;";
    const press = (e: PointerEvent): void => {
      e.preventDefault();
      // Capture so a finger sliding off the button still gets its release;
      // best-effort only — the button must still work if it fails.
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      input.press(code);
    };
    const release = (e: PointerEvent): void => {
      e.preventDefault();
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
  private tapButton(label: string, code: string, input: Input): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.cssText = BUTTON_BASE;
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      input.press(code);
      input.release(code);
    });
    return btn;
  }
}
