import type { SaveStorage } from "../game/save";

export const VIEW_KEY = "motherload-view";

/**
 * Runtime view options. A mutable module singleton (same tradeoff as
 * activeAudio()): the renderer reads it every frame, the menu toggles it,
 * and neither needs a reference threaded through Game.
 *
 * `reducedMotion` suppresses camera shake and full-screen flashes — an
 * accessibility/photosensitivity safeguard — and defaults to the OS
 * `prefers-reduced-motion` setting.
 */
export const viewPrefs = { depth: true, reducedMotion: false };

export function loadViewPrefs(storage: SaveStorage | null): void {
  // Seed reduced-motion from the OS accessibility preference…
  try {
    if (typeof matchMedia === "function") {
      viewPrefs.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
  } catch {
    // No matchMedia (tests / old engines): keep the default.
  }
  // …then let a stored choice override it.
  try {
    const raw = storage?.getItem(VIEW_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { depth?: boolean; reducedMotion?: boolean };
      viewPrefs.depth = p.depth !== false;
      if (typeof p.reducedMotion === "boolean") viewPrefs.reducedMotion = p.reducedMotion;
    }
  } catch {
    // Corrupt prefs: keep defaults.
  }
}

export function toggleDepthView(storage: SaveStorage | null): boolean {
  viewPrefs.depth = !viewPrefs.depth;
  storage?.setItem(VIEW_KEY, JSON.stringify(viewPrefs));
  return viewPrefs.depth;
}

export function toggleReducedMotion(storage: SaveStorage | null): boolean {
  viewPrefs.reducedMotion = !viewPrefs.reducedMotion;
  storage?.setItem(VIEW_KEY, JSON.stringify(viewPrefs));
  return viewPrefs.reducedMotion;
}
