import type { SaveStorage } from "./save";

export const GAME_PREFS_KEY = "motherload-prefs";

/**
 * Gameplay preferences that outlive a single run and aren't part of a save —
 * a mutable module singleton, same tradeoff as `render/prefs.ts`: the menu
 * toggles it and `Game` reads it, without a reference threaded through both.
 *
 * `tutorials` is OFF by default: the guided descent is a first-run teaching aid,
 * and most players who reach for a new game already know the controls. It's
 * read once, when a new run arms its `Onboarding` — flipping it mid-run does
 * nothing until the next new game, which is why the menu says so.
 */
/**
 * `touchLayout` picks the on-screen control scheme: a floating thumbstick that
 * steers, thrusts and drills from one thumb (default), or the classic fixed
 * D-pad. Stored here rather than in `render/prefs.ts` because it's about input,
 * not what the world looks like.
 */
export type TouchLayout = "stick" | "pad";

export const gamePrefs = { tutorials: false, touchLayout: "stick" as TouchLayout };

export function loadGamePrefs(storage: SaveStorage | null): void {
  try {
    const raw = storage?.getItem(GAME_PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { tutorials?: boolean; touchLayout?: unknown };
      if (typeof p.tutorials === "boolean") gamePrefs.tutorials = p.tutorials;
      if (p.touchLayout === "stick" || p.touchLayout === "pad") gamePrefs.touchLayout = p.touchLayout;
    }
  } catch {
    // Corrupt prefs: keep defaults.
  }
}

export function toggleTouchLayout(storage: SaveStorage | null): TouchLayout {
  gamePrefs.touchLayout = gamePrefs.touchLayout === "stick" ? "pad" : "stick";
  storage?.setItem(GAME_PREFS_KEY, JSON.stringify(gamePrefs));
  return gamePrefs.touchLayout;
}

export function toggleTutorials(storage: SaveStorage | null): boolean {
  gamePrefs.tutorials = !gamePrefs.tutorials;
  storage?.setItem(GAME_PREFS_KEY, JSON.stringify(gamePrefs));
  return gamePrefs.tutorials;
}
