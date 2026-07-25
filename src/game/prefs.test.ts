import { afterEach, describe, expect, it } from "vitest";
import { GAME_PREFS_KEY, gamePrefs, loadGamePrefs, toggleTutorials } from "./prefs";
import type { SaveStorage } from "./save";

function fakeStorage(): SaveStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

// The module singleton is shared across tests — put it back the way it shipped.
afterEach(() => {
  gamePrefs.tutorials = false;
});

describe("game prefs", () => {
  it("defaults tutorials off", () => {
    loadGamePrefs(fakeStorage());
    expect(gamePrefs.tutorials).toBe(false);
  });

  it("toggles tutorials and persists the choice", () => {
    const storage = fakeStorage();
    expect(toggleTutorials(storage)).toBe(true);
    expect(gamePrefs.tutorials).toBe(true);

    gamePrefs.tutorials = false; // simulate a fresh session…
    loadGamePrefs(storage); // …that reads the stored choice back
    expect(gamePrefs.tutorials).toBe(true);
  });

  it("keeps defaults when storage is missing or corrupt", () => {
    loadGamePrefs(null);
    expect(gamePrefs.tutorials).toBe(false);
    const storage = fakeStorage();
    storage.setItem(GAME_PREFS_KEY, "{not json");
    loadGamePrefs(storage);
    expect(gamePrefs.tutorials).toBe(false);
  });
});
