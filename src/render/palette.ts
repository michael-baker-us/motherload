/**
 * ART DIRECTION — the locked visual system. One source of truth for colour so
 * the game reads as a designed whole rather than accreted effects.
 *
 * PALETTE — two accent poles against near-black ink:
 *   • warm AMBER/GOLD — money, prompts, highlights, ore glints (the surface world
 *     and headlamp are warm earth: dirt browns, rock greys).
 *   • cool ANOMALY blue — the "signal" mystery: the objective, the beacon, hull.
 *   Semantic GOOD / WARN / DANGER are kept separate from the brand accents.
 *
 * LIGHTING MODEL — depth darkens the world; the pod's warm headlamp and emissive
 *   sources (lava, the beacon, glows) punch holes in that darkness. Emissive art
 *   is drawn additively ("lighter") over baked radial-glow sprites.
 *
 * SILHOUETTE LANGUAGE — readable shapes first: a solid fill with a darker
 *   backing/outline and a single bright facet highlight (ore crystals, the pod,
 *   the beacon). Surface texture stays low-contrast so it doesn't read as noise
 *   at the 1.6× world zoom.
 */
export const palette = {
  // Warm accents
  amber: "#ffe97a", // bright brand accent — prompts, toasts, highlights
  amberDim: "#c9a05a", // muted amber — cargo bar
  gold: "#f0c020", // deep display gold — the logo, goldium ore
  moneyGold: "#ffd75e", // the money readout's coin gold

  // Cool accents ("the signal")
  anomaly: "#8ec8ff", // objective, briefing, payoff, the beacon
  anomalyDim: "#6fb7ff", // hull bar, progress fills

  // Neutrals
  ink: "#e8e8e8", // primary text on panels
  panel: "rgba(12,15,20,0.74)", // canonical dark-glass panel base

  // Semantic (distinct from the brand accents)
  good: "#5fd75f", // fuel, positive
  warn: "#ffb060", // caution — dev/warnings
  danger: "#e04a3a", // damage, low resource, death
  heat: "#ff7a3c", // heat gauge — warm orange, distinct from the amber cargo bar
} as const;

/** `palette` colour at a given alpha, e.g. rgba() for glows and strokes. */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}
