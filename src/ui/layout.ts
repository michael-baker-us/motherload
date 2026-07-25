/**
 * One place that answers "what shape of screen are we on?" — read by the canvas
 * UI (`ui/hud.ts`, the renderer's screens) *and* by the DOM overlays, so both
 * halves of the interface agree about phones.
 *
 * Kept as a mutable singleton refreshed from `main.ts`'s resize handler, same
 * tradeoff as `render/prefs.ts`: it's read every frame by code that has no
 * business owning a reference to it.
 */
export interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const layout = {
  /** Viewport in CSS pixels. */
  vw: 1024,
  vh: 768,
  /** The device can be touched — on-screen controls are mounted. */
  touch: false,
  /** Phone-ish: overlays go full-bleed and canvas UI drops keyboard chrome. */
  compact: false,
  /** Portrait phone specifically — the tightest case for width. */
  portrait: false,
  /**
   * Multiplier for canvas-drawn UI. 1 on desktop; larger on small screens so
   * the HUD's 9px labels stay legible on a phone instead of scaling down with
   * the viewport like the rest of the scene.
   */
  scale: 1,
  /** Display-cutout / home-indicator insets, in CSS pixels. */
  safe: { top: 0, right: 0, bottom: 0, left: 0 } as SafeInsets,
};

export function isTouchCapable(): boolean {
  return (
    typeof window !== "undefined" &&
    ("ontouchstart" in window || navigator.maxTouchPoints > 0)
  );
}

/** Re-measure for the current viewport. Call on boot and on every resize. */
export function measureLayout(vw: number, vh: number): void {
  layout.vw = vw;
  layout.vh = vh;
  layout.touch = isTouchCapable();
  layout.compact = Math.min(vw, vh) < 560;
  layout.portrait = vh > vw && vw < 620;
  // Tiered rather than continuous: desktop stays pixel-identical to before, and
  // each step is a deliberate size for a class of device.
  layout.scale = vw < 420 ? 1.22 : vw < 560 ? 1.14 : vw < 760 ? 1.06 : 1;
  layout.safe = readSafeInsets();
}

/**
 * `env(safe-area-inset-*)` is CSS-only, so read it through a throwaway probe
 * element. Canvas has no other way to learn where the notch is.
 */
function readSafeInsets(): SafeInsets {
  if (typeof document === "undefined") return { top: 0, right: 0, bottom: 0, left: 0 };
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;" +
    "padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);" +
    "padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);";
  document.body.appendChild(probe);
  const s = getComputedStyle(probe);
  const insets = {
    top: parseFloat(s.paddingTop) || 0,
    right: parseFloat(s.paddingRight) || 0,
    bottom: parseFloat(s.paddingBottom) || 0,
    left: parseFloat(s.paddingLeft) || 0,
  };
  probe.remove();
  return insets;
}

// --- Shared overlay chrome ------------------------------------------------
// The three DOM overlays (shop, menu, title) and the crash screen used to each
// hard-code the same panel/button CSS at desktop sizes. They now share these,
// which is also the single place phone sizing gets applied.

/** Minimum comfortable tap target. Below ~44px, fingers miss. */
export const TAP_MIN = 44;

/** Edge length of one consumable button in the touch cluster. */
export const TOUCH_ITEM_SIZE = TAP_MIN + 8;

/** Margin every touch control keeps from the screen edge, before safe insets. */
export const TOUCH_EDGE = 16;

/**
 * True when the consumables cluster lays out as a row along the top rather than
 * a column down the right edge — a short (landscape) screen has no room for the
 * column beside the station and thrust keys.
 */
export function itemsAsRow(): boolean {
  return layout.vh < 520;
}

/**
 * Screen edges the on-screen touch controls occupy, in CSS pixels, which the
 * canvas UI must not draw into. The HUD's banners are centred in what's left,
 * so a toast or objective card never slides under the consumable buttons.
 * All zero when no touch controls are mounted.
 */
export function touchReserve(): { top: number; right: number } {
  if (!layout.touch) return { top: 0, right: 0 };
  const span = TOUCH_EDGE + TOUCH_ITEM_SIZE;
  return itemsAsRow() ? { top: span, right: 0 } : { top: 0, right: span };
}

/** Full-screen dim behind an overlay panel, inset for display cutouts. */
export function overlayRootCss(font: string): string {
  return (
    "position:fixed;inset:0;display:flex;justify-content:center;" +
    // Bottom-aligned on a phone so the panel sits under the thumb, centred
    // otherwise. dvh tracks mobile browser chrome as it slides away; vh is the
    // fallback for engines without it.
    `align-items:${layout.compact ? "flex-end" : "center"};` +
    "padding:env(safe-area-inset-top) env(safe-area-inset-right) " +
    "env(safe-area-inset-bottom) env(safe-area-inset-left);" +
    `background:rgba(0,0,0,0.55);font-family:${font};z-index:10;` +
    "-webkit-tap-highlight-color:transparent;"
  );
}

/** The overlay card itself: fixed width on desktop, full-bleed on a phone. */
export function overlayPanelCss(width: number): string {
  return (
    "position:relative;background:rgba(16,19,26,0.9);backdrop-filter:blur(14px);color:#e8e8e8;" +
    "border:1px solid rgba(255,255,255,0.14);box-shadow:0 24px 60px rgba(0,0,0,0.6);" +
    `width:${width}px;max-width:100%;` +
    (layout.compact
      ? "border-radius:18px 18px 0 0;padding:16px 14px calc(18px + env(safe-area-inset-bottom));" +
        "max-height:92dvh;max-height:92vh;"
      : "border-radius:16px;padding:20px 22px;max-height:88dvh;max-height:88vh;") +
    // Contained so a flick inside the panel never scrolls (or bounces) the page.
    "overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;"
  );
}

/** Square close affordance — the only way out of an overlay without a keyboard. */
export function closeButtonCss(font: string): string {
  const size = layout.touch ? TAP_MIN : 30;
  return (
    `position:absolute;top:${layout.compact ? 12 : 14}px;right:${layout.compact ? 12 : 14}px;` +
    `width:${size}px;height:${size}px;padding:0;z-index:1;` +
    `font-family:${font};font-size:${layout.touch ? 18 : 15}px;line-height:1;cursor:pointer;color:#fff;` +
    "border:1px solid rgba(255,255,255,0.18);border-radius:10px;" +
    "background:rgba(255,255,255,0.08);-webkit-tap-highlight-color:transparent;"
  );
}

/** Row action button (shop "buy", menu toggles) — grows to a tap target on touch. */
export function actionButtonCss(font: string, background: string): string {
  return (
    `flex:none;min-width:${layout.touch ? 68 : 58}px;min-height:${layout.touch ? TAP_MIN : 30}px;` +
    `padding:${layout.touch ? "10px 14px" : "7px 13px"};font-family:${font};` +
    `font-size:${layout.touch ? 13 : 12}px;font-weight:bold;cursor:pointer;color:#fff;` +
    `border:none;border-radius:10px;background:${background};transition:filter 0.12s;` +
    "-webkit-tap-highlight-color:transparent;touch-action:manipulation;"
  );
}
