import { describe, expect, it } from "vitest";
import type { SaveStorage } from "../game/save";
import { loadViewPrefs, toggleReducedMotion, VIEW_KEY, viewPrefs } from "./prefs";

function fakeStorage(): SaveStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

describe("view prefs", () => {
  it("toggles reduced motion and persists it", () => {
    const storage = fakeStorage();
    const before = viewPrefs.reducedMotion;
    const now = toggleReducedMotion(storage);
    expect(now).toBe(!before);
    expect(viewPrefs.reducedMotion).toBe(now);
    expect(storage.getItem(VIEW_KEY)).toContain("reducedMotion");
  });

  it("lets a stored choice override the default on load", () => {
    const storage = fakeStorage();
    storage.setItem(VIEW_KEY, JSON.stringify({ depth: false, reducedMotion: true }));
    loadViewPrefs(storage);
    expect(viewPrefs.depth).toBe(false);
    expect(viewPrefs.reducedMotion).toBe(true);
  });
});
