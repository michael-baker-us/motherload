import type { SaveStorage } from "../game/save";

export const VIEW_KEY = "motherload-view";

/**
 * Runtime view options. A mutable module singleton (same tradeoff as
 * activeAudio()): the renderer reads it every frame, the menu toggles it,
 * and neither needs a reference threaded through Game.
 */
export const viewPrefs = { depth: true };

export function loadViewPrefs(storage: SaveStorage | null): void {
  try {
    const raw = storage?.getItem(VIEW_KEY);
    if (raw) viewPrefs.depth = (JSON.parse(raw) as { depth?: boolean }).depth !== false;
  } catch {
    // Corrupt prefs: keep defaults.
  }
}

export function toggleDepthView(storage: SaveStorage | null): boolean {
  viewPrefs.depth = !viewPrefs.depth;
  storage?.setItem(VIEW_KEY, JSON.stringify(viewPrefs));
  return viewPrefs.depth;
}
