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
export const gamePrefs = { tutorials: false };

export function loadGamePrefs(storage: SaveStorage | null): void {
  try {
    const raw = storage?.getItem(GAME_PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { tutorials?: boolean };
      if (typeof p.tutorials === "boolean") gamePrefs.tutorials = p.tutorials;
    }
  } catch {
    // Corrupt prefs: keep defaults.
  }
}

export function toggleTutorials(storage: SaveStorage | null): boolean {
  gamePrefs.tutorials = !gamePrefs.tutorials;
  storage?.setItem(GAME_PREFS_KEY, JSON.stringify(gamePrefs));
  return gamePrefs.tutorials;
}
