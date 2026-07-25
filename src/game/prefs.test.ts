import { afterEach, describe, expect, it } from "vitest";
import {
  GAME_PREFS_KEY,
  gamePrefs,
  loadGamePrefs,
  toggleObjective,
  toggleTouchLayout,
  toggleTutorials,
} from "./prefs";
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
  gamePrefs.objective = false;
  gamePrefs.touchLayout = "pad";
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
    expect(gamePrefs.touchLayout).toBe("pad");
    const storage = fakeStorage();
    storage.setItem(GAME_PREFS_KEY, "{not json");
    loadGamePrefs(storage);
    expect(gamePrefs.tutorials).toBe(false);
    expect(gamePrefs.touchLayout).toBe("pad");
  });

  it("defaults the touch layout to the D-pad", () => {
    loadGamePrefs(fakeStorage());
    expect(gamePrefs.touchLayout).toBe("pad");
  });

  it("lets a stored thumbstick choice survive the new default", () => {
    const storage = fakeStorage();
    expect(toggleTouchLayout(storage)).toBe("stick");

    gamePrefs.touchLayout = "pad"; // fresh session starts at the default…
    loadGamePrefs(storage); // …and the player's stored choice wins
    expect(gamePrefs.touchLayout).toBe("stick");
  });

  it("defaults the anomaly objective off — a new run is a sandbox", () => {
    loadGamePrefs(fakeStorage());
    expect(gamePrefs.objective).toBe(false);
  });

  it("toggles the objective and persists the choice", () => {
    const storage = fakeStorage();
    expect(toggleObjective(storage)).toBe(true);

    gamePrefs.objective = false; // fresh session…
    loadGamePrefs(storage); // …reads the stored choice back
    expect(gamePrefs.objective).toBe(true);
  });

  it("ignores an unrecognised stored layout", () => {
    const storage = fakeStorage();
    storage.setItem(GAME_PREFS_KEY, JSON.stringify({ touchLayout: "gyro" }));
    loadGamePrefs(storage);
    expect(gamePrefs.touchLayout).toBe("pad");
  });
});
