# Motherload

A browser clone of the classic mining game [Motherload](https://en.wikipedia.org/wiki/Motherload_(video_game)):
fly a mining pod, drill down through the earth, collect minerals, and (soon)
return to the surface to sell them and buy upgrades.

Built from scratch in TypeScript with the Canvas 2D API — no game framework.
The game loop, camera, tile physics, and rendering are all hand-rolled on
purpose; this is a learning project as much as a game.

## Play / develop

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (Vitest)
npm run build      # type-check + production build
npm run preview    # serve the production build
```

**Controls:** ← → fly and dig sideways · ↑ thrust · ↓ drill down · E enter station

Progress autosaves whenever you're at the surface (station visits, respawns,
or just parking topside). The title screen offers Continue / New game.

Pushes to `main` deploy to GitHub Pages via `.github/workflows/ci.yml`
(enable Pages with source "GitHub Actions" in the repo settings).

## Architecture

```text
src/
  engine/       game-agnostic: fixed-timestep loop, input, camera
  render/       all drawing: pre-rendered tile textures, particles, lighting
  game/         all simulation logic — pure of DOM/canvas, unit-tested
    config.ts   every tunable number (physics, world size, balance)
    world.ts    tile grid (Uint8Array), seeded procedural generation
    physics.ts  gravity, thrust, axis-separated AABB-vs-tile collision
    drilling.ts dig targeting and progress
  ui/           HUD rendering
```

Two rules keep it maintainable:

1. `game/` modules never touch the DOM or canvas — they're plain state + math,
   so Vitest covers them without a browser.
2. All game-feel numbers live in `config.ts` — tuning is a one-file job.

## Roadmap

- [x] M1 — scaffold, game loop, CI + GitHub Pages deploy
- [x] M2 — movement, digging, worldgen, camera
- [x] M3 — fuel, cargo, surface stations (sell + refuel), money, death/respawn
- [x] M4 — upgrade shop (drill/tank/cargo/hull + repair), gas pockets, lava, fall damage
- [x] M5 — save/load (localStorage autosave at the surface), title screen
- [x] M6 — visual overhaul: textured tiles, dusk sky + parallax hills, headlight
      lighting at depth, particles, camera shake, pod & station sprites
- [ ] Later — Tauri wrapper for a native Linux build (Steam Deck)
