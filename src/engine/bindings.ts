import type { SaveStorage } from "../game/save";

export const BINDINGS_KEY = "motherload-keys";

/** Rebindable gameplay actions. System keys (Esc, Enter-to-confirm, 1–4) stay fixed. */
export type Action = "thrust" | "left" | "right" | "drill" | "interact";

export const ACTIONS: Action[] = ["thrust", "left", "right", "drill", "interact"];

export const ACTION_LABELS: Record<Action, string> = {
  thrust: "Thrust",
  left: "Move left",
  right: "Move right",
  drill: "Drill down",
  interact: "Enter station",
};

const DEFAULTS: Record<Action, string[]> = {
  thrust: ["ArrowUp", "KeyW", "Space"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  drill: ["ArrowDown", "KeyS"],
  interact: ["KeyE", "Enter"],
};

const fresh = (): Record<Action, string[]> =>
  Object.fromEntries(ACTIONS.map((a) => [a, [...DEFAULTS[a]]])) as Record<Action, string[]>;

// Live singleton — the game reads it every frame; the menu rebinds it.
const bindings = fresh();

/** The key codes currently bound to an action. */
export function keysFor(action: Action): string[] {
  return bindings[action];
}

export function loadBindings(storage: SaveStorage | null): void {
  try {
    const raw = storage?.getItem(BINDINGS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<Record<Action, unknown>>;
    for (const a of ACTIONS) {
      const v = saved[a];
      if (Array.isArray(v) && v.length > 0 && v.every((c) => typeof c === "string")) {
        bindings[a] = v as string[];
      }
    }
  } catch {
    // Corrupt bindings: keep defaults.
  }
}

function persist(storage: SaveStorage | null): void {
  storage?.setItem(BINDINGS_KEY, JSON.stringify(bindings));
}

/** Bind `code` to `action`, removing it from any other action so no key does two jobs. */
export function rebind(action: Action, code: string, storage: SaveStorage | null): void {
  for (const a of ACTIONS) {
    if (a !== action) bindings[a] = bindings[a].filter((c) => c !== code);
  }
  bindings[action] = [code];
  persist(storage);
}

export function resetBindings(storage: SaveStorage | null): void {
  for (const a of ACTIONS) bindings[a] = [...DEFAULTS[a]];
  persist(storage);
}

/** A short, human label for a key code, e.g. "ArrowUp" → "↑", "KeyW" → "W". */
export function keyLabel(code: string): string {
  const named: Record<string, string> = {
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Space: "Space",
    Enter: "Enter",
  };
  if (named[code]) return named[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}
