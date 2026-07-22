/**
 * First-run onboarding: a short, non-blocking guided descent that teaches the
 * core loop (drill down → fill cargo → sell) by watching what the player does,
 * not by gating input. Pure game state — the renderer draws the current prompt.
 * Only armed for a fresh game; returning players who continue a save skip it.
 */
export interface OnboardCtx {
  depth: number;
  cargoUnits: number;
  soldCargo: boolean;
}

interface Step {
  id: string;
  text: string;
  /** Satisfied → advance to the next step. */
  done: (c: OnboardCtx) => boolean;
}

const STEPS: Step[] = [
  {
    id: "descend",
    // The pod spawns on the station platform (undiggable bedrock), so the first
    // thing a new player must learn is to move off it before drilling.
    text: "Steer off the platform with ← → , then hold ↓ to drill down",
    done: (c) => c.depth >= 3,
  },
  {
    id: "mine",
    text: "Drill through the glowing ore veins to fill your cargo bay",
    done: (c) => c.cargoUnits >= 1,
  },
  {
    id: "sell",
    text: "Thrust back up with ↑ and press E at the Mineral Trader to cash in",
    done: (c) => c.soldCargo,
  },
];

export interface OnboardPrompt {
  text: string;
  /** 1-based index and total, for a step indicator. */
  step: number;
  total: number;
}

export class Onboarding {
  private index = 0;

  /** Advance past every step the player has already satisfied. */
  update(ctx: OnboardCtx): void {
    while (this.index < STEPS.length && STEPS[this.index]!.done(ctx)) {
      this.index += 1;
    }
  }

  get active(): boolean {
    return this.index < STEPS.length;
  }

  /** The current instruction, or null once the guided descent is complete. */
  get prompt(): OnboardPrompt | null {
    const step = STEPS[this.index];
    if (!step) return null;
    return { text: step.text, step: this.index + 1, total: STEPS.length };
  }

  /** Dismiss the rest — for a "skip" control or when the player clearly knows. */
  skip(): void {
    this.index = STEPS.length;
  }
}
