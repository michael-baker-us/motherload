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
 * `touchLayout` picks the on-screen control scheme: the classic fixed ◀ ▼ ▶
 * D-pad (default), or a floating thumbstick that steers, thrusts and drills
 * from one thumb. Stored here rather than in `render/prefs.ts` because it's
 * about input, not what the world looks like.
 *
 * The pad is the default because this is a grid game: drilling wants a discrete
 * "dig down" under the thumb, and an analogue stick makes committing to exactly
 * one direction harder than pressing a button does.
 */
export type TouchLayout = "stick" | "pad";

/**
 * `objective` gates the authored vertical slice: the mission-brief card before
 * the first descent, the depth-progress banner, and the "won" payoff screen on
 * reaching the anomaly. OFF by default, which leaves a sandbox — dig, sell,
 * upgrade, with no goal pushed at the player and nothing interrupting a run.
 *
 * Like `tutorials`, it's read once when a run starts, so flipping it mid-run
 * does nothing until the next new game; the menu says so.
 */
export const gamePrefs = {
  tutorials: false,
  objective: false,
  touchLayout: "pad" as TouchLayout,
};

export function loadGamePrefs(storage: SaveStorage | null): void {
  try {
    const raw = storage?.getItem(GAME_PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as {
        tutorials?: boolean;
        objective?: boolean;
        touchLayout?: unknown;
      };
      if (typeof p.tutorials === "boolean") gamePrefs.tutorials = p.tutorials;
      if (typeof p.objective === "boolean") gamePrefs.objective = p.objective;
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

export function toggleObjective(storage: SaveStorage | null): boolean {
  gamePrefs.objective = !gamePrefs.objective;
  storage?.setItem(GAME_PREFS_KEY, JSON.stringify(gamePrefs));
  return gamePrefs.objective;
}

export function toggleTutorials(storage: SaveStorage | null): boolean {
  gamePrefs.tutorials = !gamePrefs.tutorials;
  storage?.setItem(GAME_PREFS_KEY, JSON.stringify(gamePrefs));
  return gamePrefs.tutorials;
}
