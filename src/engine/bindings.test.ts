import { beforeEach, describe, expect, it } from "vitest";
import type { SaveStorage } from "../game/save";
import { BINDINGS_KEY, keyLabel, keysFor, loadBindings, rebind, resetBindings } from "./bindings";

function fakeStorage(): SaveStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("key bindings", () => {
  beforeEach(() => resetBindings(null)); // isolate the shared singleton per test

  it("has sensible defaults", () => {
    expect(keysFor("thrust")).toContain("ArrowUp");
    expect(keysFor("drill")).toContain("ArrowDown");
  });

  it("rebinds an action to a single key and persists it", () => {
    const s = fakeStorage();
    rebind("thrust", "KeyR", s);
    expect(keysFor("thrust")).toEqual(["KeyR"]);
    expect(s.getItem(BINDINGS_KEY)).toContain("KeyR");
  });

  it("removes a key from other actions so no key does two jobs", () => {
    rebind("drill", "KeyW", null); // KeyW was a thrust default
    expect(keysFor("thrust")).not.toContain("KeyW");
    expect(keysFor("drill")).toEqual(["KeyW"]);
  });

  it("loads saved bindings over the defaults", () => {
    const s = fakeStorage();
    s.setItem(BINDINGS_KEY, JSON.stringify({ thrust: ["KeyZ"] }));
    loadBindings(s);
    expect(keysFor("thrust")).toEqual(["KeyZ"]);
  });

  it("ignores corrupt saved bindings", () => {
    const s = fakeStorage();
    s.setItem(BINDINGS_KEY, "{ not json");
    loadBindings(s);
    expect(keysFor("thrust")).toContain("ArrowUp"); // defaults kept
  });

  it("resets to defaults", () => {
    rebind("thrust", "KeyR", null);
    resetBindings(null);
    expect(keysFor("thrust")).toContain("ArrowUp");
  });

  it("labels key codes readably", () => {
    expect(keyLabel("ArrowUp")).toBe("↑");
    expect(keyLabel("KeyW")).toBe("W");
    expect(keyLabel("Space")).toBe("Space");
    expect(keyLabel("Digit1")).toBe("1");
  });
});
