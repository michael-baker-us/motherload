# Pre-Production Feel Audit & Roadmap

_Reviewed as pre-production · ranking axis: first-play experience · feel before features_

## The read

The engine is in strong shape — a fixed-timestep loop with render interpolation, a
DOM-free and unit-tested simulation with rendering fully separated, data-driven
tiles/upgrades/items, and a synthesized audio layer. **The obvious juice is already
in**: alpha-interpolated rendering, an eased look-ahead camera, screen shake,
particles, dig-cracks, and hit-flash.

So the highest-impact work is **not** "add effects." It is three things a reviewer
feels in the first minute:

1. **Onboarding** — there is none. A new player is dropped in cold and doesn't know
   they must be *grounded* to dig, what fuel does, or where to sell.
2. **World coherence** — `world.ts :: rollTile()` draws every tile as an independent
   RNG roll, so ore is isolated speckles and there are no caverns. The world reads as
   noise, not a place.
3. **Audio mix** — sound levels are first-pass guesses, never confirmed by ear. A bad
   mix reads amateur instantly.

**Sequencing principle:** land the six "Now" feel fixes, then build **one shaped
vertical slice** (a hand-tuned 5-minute arc with a goal), and only then chase platform
polish. Don't polish an unshaped demo.

Effort is **S / M / L**. Timing is **Now** (before the slice) / **Slice** (the demo
itself) / **Later** (before it ships).

---

## The 20, ranked by first-play impact

### Now — foundational feel, before the slice

| # | Improvement | Effort | Dependencies | Why it matters |
|---|-------------|:------:|--------------|----------------|
| 1 | **First-run onboarding & control discoverability** | M | none (new light UI layer) | Biggest single conversion lever. No tutorial exists in code; players don't learn the grounded-to-dig rule, fuel, or selling. Fixes the demo's highest drop-off. |
| 2 | **Worldgen coherence — ore veins & carved pockets** | M (veins) / L (caves) | none (isolated to `world.ts`) | `rollTile()` is independent per-tile RNG → TV static. Coherent value/cellular noise clusters ore into veins and opens caverns. Same tiles, coherent placement — not new gameplay. |
| 3 | **Audio mix pass — master limiter & ducking** | S–M | audio engine (exists) | Levels are first-pass guesses; a bad mix reads amateur. One leveling pass + limiter + duck SFX under drill/thrust loops. Synthesis is good; balance is the gap. |
| 4 | **Drill-engagement feel — contact, not a timer** | S | renderer + sfx (exist) | Tiles pop when `digProgress` hits 1. Add a sub-tile "chew": nudge the pod into the target, ramp particle rate and drill-loop pitch with progress, pop shake on break. |
| 5 | **Descent-aware camera framing** | S | renderer camera (exists) | Bias look-ahead downward while falling/digging so you see what's below before committing. Re-check shake and follow lag at 1.6× zoom. |
| 6 | **State-transition polish — no hard cuts** | S | game-state + renderer (exist) | title → play → death → respawn are instant swaps. Add fades / a descend-whoosh, and pace the death screen so loss lands. |

### Vertical slice — the actual demo

| # | Improvement | Effort | Dependencies | Why it matters |
|---|-------------|:------:|--------------|----------------|
| 7 | **Define & build the vertical slice** | L | #2 | The centerpiece. A shaped first five minutes: tuned top band, a guaranteed early "wow" cavern, one first upgrade in reach, a clean stopping point. This is what you put in front of people. |
| 8 | **A concrete demo goal / objective hook** | M | #7 | No win condition today — fine for a sandbox, fatal for a demo. Add a target (reach depth X / recover the first relic) with on-screen tracking and a payoff screen. |
| 9 | **Progression & economy balance pass** | M | #2, #7 | Tune fuel burn, mineral density/value, upgrade costs, and the depth-hardness curve so the first loop has tension and the first upgrade lands ~2–3 min. All knobs live in `config.ts`. |
| 10 | **Ambient bed + music layer** | M | #3 (needs audio direction) | Between SFX it's silent, which feels empty. The audio arch supports layered loops — add a depth-graded ambient bed and a light stinger on milestones. |
| 11 | **Reward juice on economy events** | S | renderer + hud (exist) | The `fxEvents` queue already carries pickup/sell/upgrade kinds. Cash in: number-pops on pickup, animated coin-count on sell, upgrade flourish. |

### Later — platform & expectations

| # | Improvement | Effort | Dependencies | Why it matters |
|---|-------------|:------:|--------------|----------------|
| 12 | **Gamepad / controller support** | M | input abstraction (exists) | Steam players expect a controller. Input is already abstracted — extend with the Gamepad API and swap on-screen glyphs. |
| 13 | **Settings & accessibility** | M | input, menu (exist) | Rebindable keys, reduce-shake and reduce-flash (real photosensitivity risk given the damage vignette + shake), colorblind-safe ore. Table stakes and a safety issue. |
| 14 | **Pause / options UI polish** | S–M | menu (exists), #13 | The Esc menu works but reads utilitarian. Give it layout, transitions, iconography; fold #13's settings into the same surface. |
| 15 | **Title screen / branding moment** | M | sky/renderer (exist) | The storefront-thumbnail first impression. Logo, mood, living backdrop (parallax sky layer already exists). |
| 16 | **Art-direction consistency lock** | M–L | tileart / renderer | Visuals are accreted effects done well; a demo needs one identity. Lock a palette, lighting model, and silhouette language, then reconcile tiles/pod/stations/particles to it. |

### Bedrock — validation & hardening

| # | Improvement | Effort | Dependencies | Why it matters |
|---|-------------|:------:|--------------|----------------|
| 17 | **Performance validation (low-end / high-DPI)** | S–M | none | 120k-tile world + additive particle pass at 1.6× zoom are fine on your machine — confirm 60fps on integrated GPUs and 4K, profile the glow pass. |
| 18 | **Feel telemetry / debug overlay** | S | none (supports #9, #17) | Tune feel with data, not vibes: fps, particle count, dig-rate, fuel-per-descent, death causes. |
| 19 | **Robustness — saves, focus, error boundaries** | S | `save.ts` (exists) | Save-version migration, a top-level error boundary, clean tab focus/visibility handling. A demo crash or wiped save is fatal to word-of-mouth. |
| 20 | **Haptics & touch-control refinement** | S | touchControls, input (exist), #12 | Controller/mobile rumble on impact/drill/explosion + a touch-layout pass. Broadens reach (Steam Deck, mobile web). |

---

## Roadmap to a Steam-demo (~4–6 weeks solo)

| Phase | Est. | Goal | Items |
|-------|------|------|-------|
| **1 · Feel foundation** | ~1 wk | Moving & digging feels good | #3 mix, #4 drill contact, #5 camera, #6 transitions, #2a ore veins |
| **2 · Onboard & shape** | ~1–2 wk | A stranger gets it, and there's a demo | #1 onboarding, #2b caves, #7 build the slice, #8 goal + payoff |
| **3 · Tune & reward** | ~1 wk | The loop is addictive | #18 telemetry, #9 balance, #11 reward juice, #10 ambient + music |
| **4 · Platform & ship** | ~1–2 wk | Reads as a real product | #12 controller, #13/#14 settings + menu, #15/#16 title + art lock, #17/#19/#20 perf, hardening, haptics |

---

## Open verification item

The feel judgments on #4 (drill contact) and #5 (camera) are inferred from code, not
from watching the game run. Confirm them on the rendered surface (via the `verify`
skill) before implementing, so the tuning targets are set against what actually feels
off rather than what looks off in source.
