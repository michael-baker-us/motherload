# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser clone of the mining game *Motherload*: fly a pod down through
procedurally generated terrain, drill, collect minerals, manage fuel/hull,
and return to surface stations to sell, refuel, repair, and buy upgrades.
TypeScript + Canvas 2D, no game framework — the loop, camera, tile physics,
and rendering are hand-rolled on purpose (this is a learning project).

## Commands

```bash
npm install
npm run dev         # Vite dev server
npm test             # Vitest, run once
npm run test:watch   # Vitest, watch mode
npm run build        # tsc --noEmit + production build (this is the type-check step — no separate lint command)
npm run preview      # serve the production build
```

Run a single test file: `npx vitest run src/game/physics.test.ts`.
Every `src/game/*.ts` module has a matching `*.test.ts` beside it — that's
where all unit tests live (no separate `test/` tree).

CI (`.github/workflows/ci.yml`) runs `npm test` then `npm run build` on every
push/PR, and deploys `dist/` to GitHub Pages on pushes to `main`. There is no
separate lint job — type-checking via `tsc --noEmit` is the only static gate.

## Architecture

```text
src/
  engine/   game-agnostic: fixed-timestep loop, input, camera, math
  render/   all drawing: pre-rendered tile textures, particles, lighting, sky
  audio/    procedural sound engine + persisted audio settings
  game/     all simulation logic — pure of DOM/canvas, unit-tested
  ui/       HUD, shop overlay, pause/settings menu overlay
```

**The core rule**: `game/` modules never touch the DOM or canvas — they're
plain state + math, so Vitest covers them without a browser. `render/`, `ui/`,
and `audio/` read game state but never write simulation-relevant fields
directly; they call methods on `Game`.

**Tuning lives in one place.** `game/config.ts` holds every game-feel and
balance number (physics, fuel burn, hazard chances, prices, heat) grouped
into named consts (`PHYSICS`, `FUEL`, `ECONOMY`, `DRILL`, `HAZARDS`, `HEAT`,
...). When adjusting game feel, edit `config.ts`, not the module that consumes
it.

### Fixed-timestep loop

`engine/loop.ts` runs simulation at a fixed `STEP = 1/60` via an accumulator,
decoupled from render rate; `render(alpha)` gets the leftover fraction for
interpolation. `main.ts` wires `Loop` to `Game.update()` / `Renderer.render()`
and is the composition root — canvas setup, DPR scaling, resize handling, and
constructing `Input`, `Game`, `Renderer`, `AudioEngine` all happen there. In
dev builds it exposes `window.__game` and `window.__audio` for
console-driving and the `verify` skill.

### `Game` (`game/game.ts`) is the state machine and hub

Owns `world`, `player`, `camera`, `money`, `upgrades`, modules, and `state`
(`"title" | "briefing" | "playing" | "shop" | "menu" | "dead" | "won"`).
`update(dt, input)` is a single big dispatch on `state` — most game logic
(movement, drilling, heat, damage, consumables, stations, autosave) only runs
in `"playing"`; `"shop"`/`"menu"` pause the sim and hand input to their
overlay instead, and `title`/`briefing`/`dead`/`won` are screens that wait for
Enter. Reading this method top-to-bottom is the fastest way to understand how
a frame flows.

The `"won"` screen is the vertical-slice payoff: descend to `SLICE.goalDepth`
(config) and reach the authored `world.anomaly` set-piece. `game.ts` also
exposes `devWarpTo*` and other `dev*` test helpers — see the dev-tools note
under the save system.

**One-shot effects go through `fxEvents`**: `Game.pushFx()` queues
`{kind, x, y, ...}` in world coordinates; `AudioEngine.frame()` reads the
queue non-destructively, then `Renderer.render()` drains it. Order matters —
`main.ts` calls audio before the renderer for exactly this reason. Any new
"thing happened at a point in space" effect (particles, a sound, both) should
go through this queue rather than a direct call into renderer/audio.

### World representation

`game/world.ts`'s `World` is a flat `Uint8Array` of `TileId` (row-major,
60×2000 tiles, no chunking — small enough at this scale). Generation is
seeded (`mulberry32`) and deterministic; a save only needs to store the seed
plus a diff. `World.changes: Map<index, TileId>` records every tile mutated
since generation — `setTile`/`blast` write through this map, but the initial
`generate()` writes the array directly so worldgen itself isn't "a change."
Out-of-bounds reads return `Rock`, so edges behave like bedrock without
special-casing.

### Save system

`game/save.ts` captures `{version, seed, tiles (diff), player, money,
upgrades}` and reconstructs by re-running worldgen from the seed then
replaying the tile diff — never stores the full grid. `SaveStorage` is a
minimal `getItem/setItem/removeItem` interface (not `localStorage` directly)
so tests use a plain object and a future native build can swap in file
storage. Saves are versioned; loaders sanitize missing fields (e.g. `items`)
for forward compatibility with older saves — e.g. a save written before a new
upgrade track existed loads with that track at tier 0.

**Dev tools must never corrupt a real save.** `Game.saveNow()` is a no-op
whenever `devMode` is true, and `devMode` is true if *any* `DevCheats` toggle
is on **or** the run is `tainted`. Every one-shot dev helper (`devMaxUpgrades`,
`devGrantItems`, `devFillCargo`, `devGiveMoney`, the `devWarpTo*` warps, ...)
calls `taint()`, so tinkering with a run permanently blocks its saving until a
genuinely fresh `startNewGame`/`continueGame` clears the flag. Add the same
`taint()` call to any new dev/test affordance.

### Player progression split

Two persistence lifetimes that are easy to conflate:
- **`upgrades`** (tiered tracks) and **modules** (owned/equipped loadout) live
  on `Game`, survive pod loss, and are looked up via `currentTier`/`nextTier`
  (`game/upgrades.ts`) and the module sets.
- **`player`** (`game/player.ts`) is the pod instance — position, fuel, hull,
  heat, cargo, item inventory. `Game.respawn()` discards it and builds a fresh
  one via `createPlayer` + `applyUpgrades` (which pushes owned tier + module
  values onto the new pod's capacities: `maxFuel`, `coolMult`, `scanRange`,
  etc.), while `upgrades`/modules themselves are untouched.

### Content is data-driven

Most content is a small typed table in `game/`, read by sim + render + ui
without those layers hard-coding specifics. To add content, extend the table,
not the consumer:
- **Materials** (`game/tiles.ts`): `TileId` + `TILE_DEFS` (color, hardness,
  value, cargoUnits). `STRATA` picks the filler rock by depth; the ore table
  seeds ores by depth band; hazards (gas, lava) are tiles too.
- **Biomes** (`game/biomes.ts`): depth zones (`minDepth`) layering fog/tint,
  ambient rumble, and ambient `heat` over the material strata; deepest passed
  wins, announced on first entry.
- **Upgrades** (`game/upgrades.ts`): tiered tracks (drill/tank/cargo/hull/
  engine/scanner/shield/coolant), each an array of `{name, cost, value}`.
- **Modules** (`game/modules.ts`): equip-able parts with limited slots
  (`MAX_MODULE_SLOTS`) — a non-linear second progression axis whose effects
  stack multiplicatively/additively via `moduleMult`/`moduleSum`.
- **Items** (`game/items.ts`): consumables used via number keys; inventory
  rides on `player` and is lost with the pod.
- **Heat** (`game/heat.ts`): pure `stepHeat` — a second resource axis. Depth/
  biome push it up, the radiator (coolant upgrade) sheds it faster near the
  surface; overheating cooks the hull.

### Testing conventions

Vitest with `environment: "node"` (see `vite.config.ts`) — no DOM/canvas
available in unit tests, which is exactly why simulation code must stay
framework-free. Tests exercise `game/` modules directly (physics steps,
drilling progress, save round-trips, economy math) rather than through the
`Game` facade or a rendered surface.

To verify a change visually (not just via unit tests), use the **`verify`**
skill — it builds, launches the dev server, and drives the game with
Playwright against `window.__game`.
