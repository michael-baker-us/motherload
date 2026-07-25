import { keysFor, type Action } from "../engine/bindings";
import type { Input } from "../engine/input";
import { knobOffset, NEUTRAL, stickTilt, type StickTilt } from "../engine/stick";
import type { Game } from "../game/game";
import { ITEM_ORDER, ITEMS } from "../game/items";
import { gamePrefs, type TouchLayout } from "../game/prefs";
import { FONT_UI } from "../render/fonts";
import { iconDataUrl } from "../render/icons";
import {
  isTouchCapable,
  itemsAsRow,
  TAP_MIN,
  TOUCH_EDGE,
  TOUCH_ITEM_SIZE,
} from "./layout";

export { isTouchCapable };

const GLASS = "rgba(10,12,16,0.62)";
const BORDER = "rgba(255,255,255,0.2)";
const ACCENT = "rgba(46,96,150,0.6)"; // primary-action tint for the thrust key

// Kill every long-press affordance: text selection, the iOS copy/paste
// callout, and native tap highlighting. `user-select` alone is ignored by
// iOS Safari — the -webkit-* props are what actually stop the glyph from
// being selectable while a button is held.
const NO_SELECT =
  "user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;" +
  "-webkit-tap-highlight-color:transparent;touch-action:none;";

const BUTTON_BASE =
  "display:flex;align-items:center;justify-content:center;color:#e8e8e8;" +
  `background:${GLASS};border:1px solid ${BORDER};border-radius:16px;` +
  `font-family:${FONT_UI};font-weight:bold;pointer-events:auto;backdrop-filter:blur(6px);` +
  "transition:filter 0.08s,transform 0.08s;" +
  NO_SELECT;

/** Safe-area-aware edge offsets, so nothing lands under a notch or home bar. */
const EDGE = {
  left: `calc(${TOUCH_EDGE}px + env(safe-area-inset-left))`,
  right: `calc(${TOUCH_EDGE}px + env(safe-area-inset-right))`,
  bottom: "calc(20px + env(safe-area-inset-bottom))",
  top: "calc(12px + env(safe-area-inset-top))",
};

/** The first key bound to an action — touch buttons follow rebinds for free. */
function codeFor(action: Action, fallback: string): string {
  return keysFor(action)[0] ?? fallback;
}

/** A short, quiet haptic tick. Absent on iOS Safari; never required for input. */
function buzz(ms: number): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Vibration unsupported or blocked — purely decorative anyway.
  }
}

const STICK_RADIUS = 52;
const STICK_BASE = 132;

/**
 * On-screen controls for touch devices. Every control drives the same `Input`
 * instance the keyboard does by simulating key codes `Game.update` already
 * reads, so there's no separate touch code path in game logic.
 *
 * Two schemes, switchable in the settings menu (`gamePrefs.touchLayout`):
 *
 *  - **pad** (default) — the classic fixed ◀ ▼ ▶ cluster, for the certainty of
 *    a discrete button under the thumb. Suits a grid game, where "dig down"
 *    is a commitment to one direction rather than an analogue lean.
 *  - **stick** — a floating thumbstick materialises wherever the left thumb
 *    lands in the lower-left of the screen and steers, thrusts and drills from
 *    that one contact. Nothing is anchored, so it fits every hand and every
 *    phone, and diagonals (thrust + steer) come free.
 *
 * The right thumb keeps a dedicated THRUST pad in both schemes: this is a game
 * about holding thrust, and a thumb on a button does that better than a thumb
 * holding a stick at full tilt.
 */
export class TouchControls {
  private root: HTMLDivElement | null = null;
  private input: Input | null = null;
  private startOverlay!: HTMLDivElement;
  private startLabel!: HTMLDivElement;
  /** Swapped wholesale when the layout pref changes. */
  private moveLayer: HTMLDivElement | null = null;
  /** The move layer's `display` while playing — "block" for the stick zone,
   *  "flex" for the D-pad row. */
  private moveDisplay = "block";
  private builtLayout: TouchLayout | null = null;
  private thrustBtn!: HTMLButtonElement;
  private interactBtn!: HTMLButtonElement;
  private itemsCluster!: HTMLDivElement;
  /** Which item-cluster placement is currently applied (see `placeItems`). */
  private itemsShort: boolean | null = null;
  private pauseBtn!: HTMLButtonElement;
  private itemBtns: HTMLButtonElement[] = [];

  // Live thumbstick state.
  private stickPointer: number | null = null;
  private stickBase!: HTMLDivElement;
  private stickKnob!: HTMLDivElement;
  private tilt: StickTilt = { ...NEUTRAL };

  mount(input: Input): void {
    if (!isTouchCapable() || this.root) return;
    this.input = input;

    const root = document.createElement("div");
    root.style.cssText =
      "position:fixed;inset:0;z-index:5;pointer-events:none;" + NO_SELECT;
    // Belt-and-braces: no context menu anywhere in the control layer.
    root.addEventListener("contextmenu", (e) => e.preventDefault());
    document.body.appendChild(root);
    this.root = root;

    const { overlay, label } = this.buildStartOverlay(input);
    this.startOverlay = overlay;
    this.startLabel = label;
    root.appendChild(overlay);

    this.buildMoveLayer(input);

    this.thrustBtn = this.buildThrustButton(input);
    root.appendChild(this.thrustBtn);

    this.interactBtn = this.tapButton("E", codeFor("interact", "KeyE"), input, "enter station");
    this.interactBtn.style.cssText +=
      `position:absolute;right:${EDGE.right};bottom:calc(${EDGE.bottom} + 130px);` +
      "width:62px;height:62px;border-radius:31px;font-size:18px;";
    root.appendChild(this.interactBtn);

    this.itemsCluster = this.buildItemsCluster(input);
    this.placeItems(); // needs the field assigned first — see placeItems
    root.appendChild(this.itemsCluster);

    this.pauseBtn = this.tapButton("⏸", "Escape", input, "menu");
    this.pauseBtn.style.cssText +=
      `position:absolute;top:${EDGE.top};right:${EDGE.right};` +
      `width:${TAP_MIN}px;height:${TAP_MIN}px;border-radius:22px;font-size:16px;`;
    root.appendChild(this.pauseBtn);
  }

  /** Called once per render frame to reflect the current game state. */
  sync(game: Game): void {
    if (!this.root) return;
    // The layout pref lives in the settings menu, which has no handle on this
    // object — notice the change here instead of wiring a callback through Game.
    if (this.builtLayout !== gamePrefs.touchLayout && this.input) this.buildMoveLayer(this.input);
    this.placeItems(); // cheap no-op unless the screen changed shape

    const playing = game.state === "playing";
    // Screens that wait on a single confirm: give the whole viewport as a
    // tap target, since there's no keyboard to press Enter on.
    const waiting = game.state === "briefing" || game.state === "dead" || game.state === "won";

    // Restore the layer's own display value, not a hard-coded one — the D-pad
    // cluster is a flex row and would stack vertically as a block.
    if (this.moveLayer) this.moveLayer.style.display = playing ? this.moveDisplay : "none";
    this.thrustBtn.style.display = playing ? "flex" : "none";
    this.interactBtn.style.display = playing ? "flex" : "none";
    this.itemsCluster.style.display = playing ? "flex" : "none";
    this.pauseBtn.style.display = playing ? "flex" : "none";
    this.startOverlay.style.display = waiting ? "flex" : "none";

    if (!playing) {
      // Leaving play with a finger down must not leave a key stuck on.
      if (this.stickPointer !== null) this.releaseStick();
      if (waiting) {
        this.startLabel.textContent =
          game.state === "dead"
            ? "TAP TO LAUNCH REPLACEMENT POD"
            : game.state === "won"
              ? "TAP TO KEEP EXPLORING"
              : "TAP TO BEGIN DESCENT";
      }
      return;
    }

    // The interact key only does anything while parked on a station — dim and
    // disable it otherwise so it reads as contextual, not broken.
    const hint = game.nearbyStationLabel();
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

  // --- Movement: thumbstick or D-pad ---------------------------------------

  /** (Re)build the left-hand movement controls for the current layout pref. */
  private buildMoveLayer(input: Input): void {
    if (!this.root) return;
    this.releaseStick();
    this.moveLayer?.remove();
    const pad = gamePrefs.touchLayout === "pad";
    const layer = pad ? this.buildSteerCluster(input) : this.buildStick(input);
    this.root.appendChild(layer);
    this.moveLayer = layer;
    this.moveDisplay = pad ? "flex" : "block";
    this.builtLayout = gamePrefs.touchLayout;
  }

  /**
   * Floating thumbstick. The touch zone is the whole lower-left quadrant; the
   * ring is only a *hint* of where the stick rests, and re-anchors under the
   * thumb on contact — the standard mobile-shooter idiom, and the reason this
   * works one-handed on a 4" phone and a tablet alike.
   */
  private buildStick(input: Input): HTMLDivElement {
    const zone = document.createElement("div");
    zone.style.cssText =
      "position:absolute;left:0;bottom:0;width:58%;height:46%;pointer-events:auto;" + NO_SELECT;

    const base = document.createElement("div");
    base.style.cssText =
      `position:absolute;width:${STICK_BASE}px;height:${STICK_BASE}px;border-radius:50%;` +
      `left:calc(${EDGE.left} + 4px);bottom:calc(${EDGE.bottom} + 4px);` +
      "border:1px solid rgba(255,255,255,0.16);background:rgba(10,12,16,0.34);" +
      "backdrop-filter:blur(4px);opacity:0.55;transition:opacity 0.15s;" + NO_SELECT;

    const knob = document.createElement("div");
    knob.style.cssText =
      "position:absolute;left:50%;top:50%;width:62px;height:62px;margin:-31px 0 0 -31px;" +
      "border-radius:50%;border:1px solid rgba(255,255,255,0.3);" +
      "background:radial-gradient(circle at 35% 30%,rgba(255,255,255,0.34),rgba(60,80,110,0.55));" +
      "box-shadow:0 6px 18px rgba(0,0,0,0.45);" + NO_SELECT;
    base.appendChild(knob);

    // Compass hint so the stick explains itself the first time it's seen.
    const hint = document.createElement("div");
    hint.textContent = "↑ fly\n← →\n↓ drill";
    hint.style.cssText =
      "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;" +
      `font-family:${FONT_UI};font-size:9px;line-height:1.5;text-align:center;white-space:pre;` +
      "color:rgba(255,255,255,0.5);pointer-events:none;";
    base.insertBefore(hint, knob);

    zone.appendChild(base);
    this.stickBase = base;
    this.stickKnob = knob;

    let originX = 0;
    let originY = 0;

    zone.addEventListener("pointerdown", (e) => {
      if (this.stickPointer !== null) return; // one thumb owns the stick
      e.preventDefault();
      this.stickPointer = e.pointerId;
      try {
        zone.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort; pointerleave covers the rest */
      }
      const rect = zone.getBoundingClientRect();
      originX = e.clientX;
      originY = e.clientY;
      // Re-anchor under the thumb, clamped so the ring stays fully on screen.
      const half = STICK_BASE / 2;
      const cx = clampNum(e.clientX - rect.left, half + 4, rect.width - half - 4);
      const cy = clampNum(e.clientY - rect.top, half + 4, rect.height - half - 4);
      originX = rect.left + cx;
      originY = rect.top + cy;
      base.style.left = `${cx - half}px`;
      base.style.bottom = `${rect.height - cy - half}px`;
      base.style.opacity = "1";
      hint.style.opacity = "0";
      buzz(6);
    });

    const move = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickPointer) return;
      e.preventDefault();
      const dx = e.clientX - originX;
      const dy = e.clientY - originY;
      const k = knobOffset(dx, dy, STICK_RADIUS);
      knob.style.transform = `translate(${k.x}px, ${k.y}px)`;
      this.applyTilt(stickTilt(dx, dy, STICK_RADIUS), input);
    };
    zone.addEventListener("pointermove", move);

    const end = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickPointer) return;
      e.preventDefault();
      this.releaseStick();
      hint.style.opacity = "1";
    };
    zone.addEventListener("pointerup", end);
    zone.addEventListener("pointercancel", end);

    return zone;
  }

  /** Push a new tilt into `Input`, pressing/releasing only what changed. */
  private applyTilt(next: StickTilt, input: Input): void {
    const edge = (
      was: boolean,
      now: boolean,
      action: Action,
      fallback: string,
    ): void => {
      if (was === now) return;
      const code = codeFor(action, fallback);
      if (now) {
        input.press(code);
        buzz(4);
      } else {
        input.release(code);
      }
    };
    edge(this.tilt.left, next.left, "left", "ArrowLeft");
    edge(this.tilt.right, next.right, "right", "ArrowRight");
    edge(this.tilt.up, next.up, "thrust", "ArrowUp");
    edge(this.tilt.down, next.down, "drill", "ArrowDown");
    this.tilt = next;
  }

  /** Drop the stick: release every held direction and park the knob. */
  private releaseStick(): void {
    if (this.input) this.applyTilt({ ...NEUTRAL }, this.input);
    this.stickPointer = null;
    if (this.stickKnob) this.stickKnob.style.transform = "";
    if (this.stickBase) {
      this.stickBase.style.opacity = "0.55";
      this.stickBase.style.left = `calc(${EDGE.left} + 4px)`;
      this.stickBase.style.bottom = `calc(${EDGE.bottom} + 4px)`;
    }
  }

  /** Classic fixed steering row: move/dig left, dig down, move/dig right. */
  private buildSteerCluster(input: Input): HTMLDivElement {
    const el = document.createElement("div");
    el.style.cssText =
      `position:absolute;left:${EDGE.left};bottom:${EDGE.bottom};display:flex;gap:10px;` +
      "align-items:flex-end;pointer-events:none;";

    const key = "width:66px;height:66px;font-size:22px;";
    el.append(
      this.holdButton("◀", codeFor("left", "ArrowLeft"), input, "left", key),
      this.holdButton("▼", codeFor("drill", "ArrowDown"), input, "dig down", key),
      this.holdButton("▶", codeFor("right", "ArrowRight"), input, "right", key),
    );
    return el;
  }

  private buildStartOverlay(input: Input): { overlay: HTMLDivElement; label: HTMLDivElement } {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:absolute;inset:0;display:none;flex-direction:column;align-items:center;" +
      "justify-content:flex-end;gap:12px;padding:0 16px 16vh;pointer-events:auto;" + NO_SELECT;
    const label = document.createElement("div");
    label.style.cssText =
      `color:#ffe97a;font-size:14px;font-weight:bold;letter-spacing:1px;font-family:${FONT_UI};` +
      "text-align:center;padding:14px 22px;border-radius:14px;" +
      `background:${GLASS};border:1px solid ${BORDER};backdrop-filter:blur(6px);`;
    overlay.appendChild(label);
    overlay.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      input.press("Enter");
      input.release("Enter");
      buzz(8);
    });

    return { overlay, label };
  }

  /** Bottom-right primary action: hold to fly up. */
  private buildThrustButton(input: Input): HTMLButtonElement {
    const btn = this.holdButton(
      "",
      codeFor("thrust", "ArrowUp"),
      input,
      "thrust up",
      `position:absolute;right:${EDGE.right};bottom:${EDGE.bottom};width:112px;height:112px;` +
        `border-radius:34px;flex-direction:column;gap:3px;background:${ACCENT};`,
    );
    btn.innerHTML =
      '<span style="font-size:26px;line-height:1;pointer-events:none">▲</span>' +
      '<span style="font-size:13px;letter-spacing:2px;pointer-events:none">THRUST</span>';
    return btn;
  }

  /** Consumables, kept clear of the top-left HUD and the bottom thumb zone. */
  private buildItemsCluster(input: Input): HTMLDivElement {
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;display:none;gap:10px;pointer-events:none;";
    this.itemBtns = ITEM_ORDER.map((id, i) => {
      const btn = this.tapButton("", `Digit${i + 1}`, input, ITEMS[id].name);
      btn.style.cssText +=
        `width:${TOUCH_ITEM_SIZE}px;height:${TOUCH_ITEM_SIZE}px;border-radius:14px;` +
        "flex-direction:column;gap:1px;";
      btn.innerHTML =
        `<img src="${iconDataUrl(id, 22)}" alt="${ITEMS[id].name}" ` +
        'style="width:22px;height:22px;pointer-events:none">' +
        '<span data-count style="font-size:10px;color:#ffe97a;pointer-events:none">×0</span>';
      el.appendChild(btn);
      return btn;
    });
    return el;
  }

  /**
   * The item cluster is the one control with nowhere obvious to live: a tall
   * screen has room for a column down the right edge, but on a short (landscape)
   * one that column runs straight into the station and thrust keys. There, it
   * becomes a row along the top instead, beside the pause button.
   */
  private placeItems(): void {
    // Guard before the memo, not after: `buildItemsCluster` calls this before
    // `mount` has assigned `itemsCluster`, and recording the placement while
    // bailing out would leave the cluster unpositioned forever — it would fall
    // back to the static position and cover the stats panel.
    const el = this.itemsCluster;
    if (!el) return;
    // `itemsAsRow` lives in layout.ts because the canvas HUD reads it too, to
    // know which screen edge it must keep its banners out of.
    const short = itemsAsRow();
    if (short === this.itemsShort) return;
    this.itemsShort = short;
    el.style.flexDirection = short ? "row" : "column";
    el.style.top = short ? EDGE.top : `calc(${EDGE.top} + 56px)`;
    el.style.right = short ? `calc(${EDGE.right} + ${TAP_MIN + 10}px)` : EDGE.right;
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
    btn.style.cssText = BUTTON_BASE + `width:${TAP_MIN + 18}px;height:${TAP_MIN + 18}px;font-size:22px;` + extraCss;
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
      btn.style.transform = "scale(0.96)";
      input.press(code);
      buzz(5);
    };
    const release = (e: PointerEvent): void => {
      e.preventDefault();
      btn.style.filter = "";
      btn.style.transform = "";
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
    btn.style.cssText = BUTTON_BASE + `width:${TAP_MIN}px;height:${TAP_MIN}px;font-size:15px;`;
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      btn.style.filter = "brightness(1.5)";
      btn.style.transform = "scale(0.94)";
      input.press(code);
      input.release(code);
      buzz(7);
    });
    const clear = (): void => {
      btn.style.filter = "";
      btn.style.transform = "";
    };
    btn.addEventListener("pointerup", clear);
    btn.addEventListener("pointercancel", clear);
    btn.addEventListener("pointerleave", clear);
    return btn;
  }
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
