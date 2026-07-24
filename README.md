# Motherload

A browser clone of the classic mining game [Motherload](https://en.wikipedia.org/wiki/Motherload_(video_game)):
fly a mining pod, drill down through procedurally generated earth, collect
minerals, and return to surface stations to sell them, refuel, repair, and buy
upgrades. Manage fuel, hull, and heat as you descend through distinct depth
biomes toward a buried anomaly.

Built from scratch in TypeScript with the Canvas 2D API — no game framework.
The game loop, camera, tile physics, procedural audio, and rendering are all
hand-rolled on purpose; this is a learning project as much as a game.

## Play / develop

```bash
npm install
npm run dev         # local dev server
npm test            # unit tests (Vitest, run once)
npm run test:watch  # unit tests in watch mode
npm run build       # type-check (tsc --noEmit) + production build
npm run preview     # serve the production build
```

**Controls:** ← → fly and dig sideways · ↑ thrust · ↓ drill down · 1–4 use
consumables · E enter station · Esc settings

The settings menu (Esc) has a **Dev · Testing** section for playtesting: cheat
toggles (unlimited fuel/funds, no damage, dig anything, no overheating),
one-shot grants (max upgrades, all modules, all items, fill cargo, cash,
refill), warps (to any biome, the anomaly, or the surface), and a telemetry
overlay. Using any dev tool marks the run so it won't overwrite your real save.

Progress autosaves whenever you're at the surface (station visits, respawns,
or just parking topside). The title screen offers Continue / New game.

Pushes to `main` deploy to GitHub Pages via `.github/workflows/ci.yml`
(enable Pages with source "GitHub Actions" in the repo settings).

## Architecture

```text
src/
  engine/       game-agnostic: fixed-timestep loop, input, camera, math
  render/       all drawing: pre-rendered tile textures, particles, lighting, sky
  audio/        procedural (asset-free) sound engine + persisted settings
  game/         all simulation logic — pure of DOM/canvas, unit-tested
    config.ts   every tunable number (physics, world size, balance, heat)
    world.ts    tile grid (Uint8Array), seeded procedural generation
    physics.ts  gravity, thrust, axis-separated AABB-vs-tile collision
    drilling.ts dig targeting and progress
    tiles.ts    materials, strata, and ores (the data behind the terrain)
    biomes.ts   depth zones layering fog/tint/ambient heat over the strata
    heat.ts     second resource axis — depth heats you, the radiator cools you
    upgrades.ts / modules.ts / items.ts   progression, loadout, consumables
    save.ts     versioned save = seed + tile diff + player/economy state
  ui/           HUD, shop overlay, pause/settings menu overlay
```

Two rules keep it maintainable:

1. `game/` modules never touch the DOM or canvas — they're plain state + math,
   so Vitest covers them without a browser.
2. All game-feel numbers live in `config.ts` — tuning is a one-file job.

See [`CLAUDE.md`](CLAUDE.md) for the deeper architecture notes (state machine,
effect queue, the data-driven content tables, and the save-safety invariant).

## Roadmap

- [x] M1 — scaffold, game loop, CI + GitHub Pages deploy
- [x] M2 — movement, digging, worldgen, camera
- [x] M3 — fuel, cargo, surface stations (sell + refuel), money, death/respawn
- [x] M4 — upgrade shop (drill/tank/cargo/hull + repair), gas pockets, lava, fall damage
- [x] M5 — save/load (localStorage autosave at the surface), title screen
- [x] M6 — visual overhaul: textured tiles, dusk sky + parallax hills, headlight
      lighting at depth, particles, camera shake, pod & station sprites
- [x] M7 — polish pass: smooth look-ahead camera, soft tunnel AO, additive
      glow (flame/lava/glints/explosions), starfield + clouds + haze, animated
      glass HUD, damage flash, dust motes in the headlight
- [x] M8 — art pass: 1.6× world zoom, 2× supersampled tile art (gem shards,
      lava crack networks, rubble), detailed station buildings with neon signs
      and props, pod outline/seams/headlamp, glass shop overlays
- [x] Feel pass — onboarding, a vertical-slice objective (descend to the
      authored anomaly + payoff screen), reward juice, procedural ambient music
      and SFX, accessibility (reduce shake/flash, rebindable keys), telemetry
      overlay _(see `docs/pre-production-audit.md`)_
- [x] Content & depth — material variety and depth strata, distinct depth
      biomes, scanner/engine/shield/coolant upgrades, an equip-able module
      system, environmental set-pieces, positional + biome audio, and a
      heat/cooling resource axis _(see `docs/content-depth-roadmap.md`)_
- [ ] Later — Tauri wrapper for a native Linux build (Steam Deck)
