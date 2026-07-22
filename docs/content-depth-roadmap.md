# Content & Depth Roadmap (II)

_Companion to [pre-production-audit.md](./pre-production-audit.md). Where roadmap I made the
game **feel** like a Steam title, this one gives it **depth to explore** — the content
goals the feel-first pass consciously deferred._

## The read

**Already strong (the base):** feel, visual style, a flexible synth-audio engine,
deterministic data-driven procgen, a DOM-free tested sim. None of it gets rewritten.

**What's thin (the gap):** one diggable material (Dirt), no biomes, four _linear_ upgrade
tracks, plain shop buttons, mono audio. The loop is polished but the **world is uniform**
and the **choices are shallow**.

**The keystone:** materials come first. Biomes, set-pieces, heat, the scanner, and
per-material audio all depend on the world being made of real, distinct materials — so
**A1 unblocks almost everything else.**

Targets original-brief goals **#3 (mining variety), #4 (progression), #5 (world variety),
#6 (shop UX), #7 (positional audio)**. Effort is **M / L**.

---

## The plan, by layer

### A · Materials — the keystone 🪨

| # | Item | Effort | Deps | Why / notes | Files |
|---|------|:------:|------|-------------|-------|
| **A1** | **Diggable material strata** | L | none | The foundation. Replace "Dirt everywhere + depth-scaled hardness" with real materials — topsoil → clay → stone → granite → deep rock, plus specials ice/magma/crystal — each a data-driven def (hardness, colour, particle profile, sound). Drilling finally _feels_ different at each depth. (Brief #3) | `tiles.ts`, `world.ts`, `drilling.ts`, `tileart.ts`, `config.ts` |
| **A2** | **Per-material feedback** | M | A1 | Each material gets its own dig-particle look and a **distinct break sound** (`playDug` is one generic crunch today). Ties material variety to feel + audio. | `sfx.ts`, renderer particles, `game.ts` |

### B · World variety 🌋

| # | Item | Effort | Deps | Why / notes | Files |
|---|------|:------:|------|-------------|-------|
| **B1** | **Depth biomes** | L | A1 | The headline. Depth-zoned biomes — each a coherent combo of dominant materials + palette tint + hazard profile + ambient bed (Topsoil → Caverns → Magma Depths → Crystal Deep). Leans on A1, the palette lock, and the audio ambient layers. (Brief #5) | `biomes.ts` (new), `world.ts`, renderer, `engine.ts` |
| **B2** | **Environmental set-pieces** | M/L | A1, B1 | Features seeded into biomes, reusing the anomaly-stamp system: lava chambers, underground lakes (new water tile + buoyancy/hazard), crystal caverns, abandoned mines / ruins with loot. | `world.ts`, `tiles.ts`, `tileart.ts`, `hazards.ts` |

### C · Progression depth 🔧

| # | Item | Effort | Deps | Why / notes | Files |
|---|------|:------:|------|-------------|-------|
| **C1** | **New upgrade tracks** | M | none | Add the categories the brief lists: **scanner** (reveals nearby ore/hazards — transforms exploration), engine (thrust/speed), shields (hazard mitigation). Data-driven like the existing four. (Brief #4) | `upgrades.ts`, `game.ts`, `player.ts`, renderer |
| **C2** | **Non-linear upgrade choices** | M/L | C1 | Beyond "buy next tier": **branching tiers** (pick one of two per tier) or a module/loadout system with limited slots → real tradeoffs and build identity. The brief's explicit "avoid linear · interesting decisions". | `upgrades.ts`, `shop.ts`, `save.ts` |
| **C3** | **Heat & cooling mechanic** | M | A1 | _New mechanic — needs playtesting._ Drilling + depth build heat; overheating slows/damages; cooling upgrades + surfacing + ice reduce it. A second resource axis beyond fuel; gives cooling, magma-rock, and ice real meaning. | `game.ts`, `config.ts`, `hud.ts`, `tiles.ts`, `upgrades.ts` |

### D · UX & audio for the new content 🎛️

| # | Item | Effort | Deps | Why / notes | Files |
|---|------|:------:|------|-------------|-------|
| **D1** | **Shop upgrade cards** | M | C1/C2 | Replace the plain shop DOM with **upgrade cards**: icon, stat delta (before→after), cost, owned/locked state, hover, and a clear A/B for branching upgrades. (Brief #6) | `shop.ts` (+ palette/menu styling) |
| **D2** | **Positional & biome audio** | M | A2, B1 | Stereo panning by world position (`StereoPanner`), per-material dig timbre (from A2), biome ambient beds (from B1). (Brief #7) | `engine.ts`, `sfx.ts`, `biomes.ts` |

---

## Suggested sequence

`A1 materials → A2 feedback → B1 biomes → C1 scanner/tracks → B2 set-pieces →
C2 non-linear → D1 cards → D2 spatial audio → C3 heat`

Materials first (unblocks the rest), then the biomes + scanner that make descending
rewarding, then the exploration set-pieces and the non-linear/UX layer. **Heat lands
last** — it's the only genuinely new mechanic, so prove the substrate before adding a
second resource to balance.

## Deferred

**#12 controller support** and **#20 haptics** (from roadmap I, Phase 4) are parked for
now — both need real gamepad hardware to verify. Revisit after the content work.
