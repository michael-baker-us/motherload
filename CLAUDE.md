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
Tests live beside the module they cover (`*.test.ts`), not in a separate
`test/` tree — near-total coverage in `game/`, plus the framework-free parts
of `engine/`, `render/`, `audio/`, and `ui/layout.ts`.

CI (`.github/workflows/ci.yml`) runs `npm test` then `npm run build` on every
push/PR, and deploys `dist/` to GitHub Pages on pushes to `main`. There is no
separate lint job — type-checking via `tsc --noEmit` is the only static gate.

## Architecture

```text
src/
  engine/   game-agnostic: fixed-timestep loop, input + key bindings, camera, math
  render/   all drawing: baked tile art, lighting, post-FX, sky, weather, particles
  audio/    procedural sound engine + persisted audio settings
  game/     all simulation logic — pure of DOM/canvas, unit-tested
  ui/       HUD, title/shop/menu overlays, touch controls, crash screen
```

**The core rule**: `game/` modules never touch the DOM or canvas — they're
plain state + math, so Vitest covers them without a browser. `render/`, `ui/`,
and `audio/` read game state but never write simulation-relevant fields
directly; they call methods on `Game`.

**One screen model.** `ui/layout.ts` is the single source of truth for the
shape of the device — viewport, touch capability, "compact" (phone) breakpoint,
canvas-UI scale, and the display-cutout insets — refreshed from `main.ts`'s
resize handler. Both halves of the interface read it: the canvas UI (`ui/hud.ts`
and the renderer's title/briefing/death/win screens, which draw in scaled "UI
units" and wrap their text via `render/text.ts`) and the DOM overlays, which
also share their panel/button CSS from there so phone sizing is applied once.
Anything new that positions itself on screen should read `layout`, not
`window.innerWidth`.

**Tuning lives in one place.** `game/config.ts` holds every game-feel, balance
*and visual* number grouped into named consts — sim (`PHYSICS`, `POD`, `FUEL`,
`ECONOMY`, `DRILL`, `HAZARDS`, `HEAT`, `WORLDGEN`, `SLICE`) and render
(`VIEW`, `LIGHT`, `DEPTH`, `FX`, `CAMERA`, `POD_ANIM`, `POST`, `SEASON`).
When adjusting game feel or look, edit `config.ts`, not the module that
consumes it. Dev builds expose the whole module as `window.__config`, so these
are live-tunable from the console.

### Fixed-timestep loop

`engine/loop.ts` runs simulation at a fixed `STEP = 1/60` via an accumulator,
decoupled from render rate; `render(alpha)` gets the leftover fraction for
interpolation. `main.ts` wires `Loop` to `Game.update()` / `Renderer.render()`
and is the composition root — canvas setup, DPR scaling, resize handling,
loading every persisted preference bundle, and constructing `Input`, `Game`,
`Renderer`, `AudioEngine`, `TouchControls`, `TitleOverlay` all happen there.
It also owns the error boundary: `update`/`render` are wrapped in try/catch
and any throw (plus `window.onerror`/`unhandledrejection`) routes to
`ui/crash.ts`, which shows a recoverable overlay rather than freezing on a
black canvas — the save is left intact, with a second button to clear it in
case a corrupt save is what crashes on load. In dev builds it exposes
`window.__game`, `__audio`, `__renderer`, and `__config` for console-driving
and the `verify` skill.

### `Game` (`game/game.ts`) is the state machine and hub

Owns `world`, `player`, `camera`, `money`, `upgrades`, modules, `season`, and
`state`
(`"title" | "briefing" | "playing" | "shop" | "menu" | "dead" | "won"`).
`update(dt, input)` is a single big dispatch on `state` — most game logic
(movement, drilling, heat, damage, consumables, stations, autosave) only runs
in `"playing"`; `"shop"`/`"menu"` pause the sim and hand input to their
overlay instead, and `title`/`briefing`/`dead`/`won` are screens that wait for
Enter. Reading this method top-to-bottom is the fastest way to understand how
a frame flows.

The `"won"` screen is the vertical-slice payoff: descend to `SLICE.goalDepth`
(config) and reach the authored `world.anomaly` set-piece. That whole arc is
**opt-in** — `gamePrefs.objective` (settings menu, default off) gates the
`"briefing"` card, the HUD progress banner and the payoff together. A default
run is a sandbox: `startNewGame` goes straight to `"playing"` and sets
`goalReached` so nothing ever fires. `game.ts` also exposes `devWarpTo*` and
other `dev*` test helpers — see the dev-tools note under the save system.

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

### Seasons — per-run identity

`game/seasons.ts` is the largest content table and the one with the sharpest
invariant. A season (spring/summer/autumn/winter) layers a distinct sky,
treeline, colour grade, weather, ambience, topsoil and small gameplay
modifiers over the depth biomes and material strata. It is **chosen at new
game and fixed for that run**, and the `Season` interface splits its effects
into two fields for exactly that reason:

- **`world`** — baked into terrain at `World` construction, read *once* in
  `world.ts`'s `rollTile`, and captured in the save alongside the seed.
  Because loading re-runs worldgen from the seed, changing this mid-run would
  silently mutate untouched terrain across a save/load.
- **`runtime`** — read fresh every sim step (ambient heat, cooling, burn,
  gust). Safe to change any time; the dev season switcher (`devSetSeason`)
  only touches this half plus the visuals.

Everything downstream — sky, flora, grade, weather, audio voice, HUD chip,
title picker — is table-driven off this row, and `seasons.test.ts` /
`render/seasons-render.test.ts` fail loudly if a new row references an icon,
weather kind or voice that doesn't exist. Adding a fifth season should be
appending a row. Note the title screen previews `SEASONS[game.titleSeason]`
live behind the picker, so the renderer resolves "the season to draw" per
frame rather than reading `game.season` unconditionally.

### Save system and persisted preferences

`game/save.ts` captures `{version, seed, season, tiles (diff), player, money,
upgrades, modules}` and reconstructs by re-running worldgen from the seed then
replaying the tile diff — never stores the full grid. `season` is stored as a
*worldgen input on a par with `seed`*, not as a cosmetic label: the same seed
under a different season rebuilds different terrain. `SaveStorage` is a
minimal `getItem/setItem/removeItem` interface (not `localStorage` directly)
so tests use a plain object and a future native build can swap in file
storage. Saves are versioned with a `MIGRATIONS` table keyed by the version
each step upgrades *from*: bump `CURRENT_SAVE_VERSION` and add a step rather
than silently wiping old saves. A save from a *newer* build is left untouched
instead of being guessed at, and loaders sanitize missing fields (e.g.
`items`) so a save written before a new upgrade track existed loads with that
track at tier 0.

Preferences that outlive a run are *not* in the save — they're four separate
`localStorage` keys, each a mutable module singleton loaded once by `main.ts`
and read directly by its consumers (deliberate: the menu writes, the renderer
or `Game` reads, no reference threaded through both):

| Module | Key | Holds |
| --- | --- | --- |
| `game/prefs.ts` | `motherload-prefs` | `tutorials`, `objective`, `touchLayout` |
| `render/prefs.ts` | `motherload-view` | `depth`, `reducedMotion`, `headlampBeam` |
| `audio/settings.ts` | `motherload-audio` | volumes / mute |
| `engine/bindings.ts` | `motherload-keys` | rebindable action → key codes |

`reducedMotion` defaults from the OS `prefers-reduced-motion` and suppresses
camera shake and full-screen flashes; honour it in any new screen-level effect.

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
- **Seasons** (`game/seasons.ts`): the per-run surface identity — see above.
- **Onboarding** (`game/onboarding.ts`): a step list watching `{depth,
  cargoUnits, soldCargo}`; each step advances when its `done()` predicate
  passes. Non-blocking by design — it never gates input, the renderer just
  draws the current prompt, and it's only armed for a fresh run with
  `gamePrefs.tutorials` on.

### Input and controls

`engine/input.ts` tracks raw key state; `engine/bindings.ts` maps the five
rebindable actions (`thrust`/`left`/`right`/`drill`/`interact`) onto key codes,
each with several defaults (arrows + WASD). System keys — Esc, Enter, 1–4 —
stay fixed and are read directly. Gameplay code should ask about *actions*,
not `ArrowUp`.

Touch is a first-class path, not an afterthought: `ui/touchControls.ts` owns
the pointer events and drawing for two schemes selected by
`gamePrefs.touchLayout` — a fixed D-pad (default, because drilling wants a
discrete "dig down" under the thumb) or a floating thumbstick. The stick's
*feel* — dead zone, travel, which tilt means which held directions — is pure
math in `engine/stick.ts` (DOM-free and unit-tested), resolving to a set of
held directions rather than an analog vector, since pod movement is discrete.

### Render pipeline

`render/renderer.ts` is the biggest file in the repo and its `render()` runs a
fixed sequence of passes. Knowing the order is what makes a visual change land
in the right place:

1. **Effects + camera** — drain `fxEvents`, emit continuous FX, step particles,
   then `camerafx.ts` writes `cam.x/y` plus this frame's zoom and shake.
2. **World albedo** (zoomed + shaken, opaque only) — `sky.ts` → tiles →
   stations → pod → non-additive particles. The pass *collects* lights and
   emissive glows into arrays instead of drawing them inline.
3. **Biome mood wash** — albedo-space tint, pre-lighting.
4. **Lighting** (`lighting.ts`) — fills the frame with fog colour at the
   current darkness, punches a soft hole per light, washes each light's colour
   back in. Dynamic lights are budgeted by distance to the pod, with slots
   reserved for the headlamp and beacon. `lights.ts` holds the (testable) pure
   math and the `Light`/`Emitter` vocabulary.
5. **Depth haze** → **emissive pass** (additive glows over the darkness) →
   **bloom** (`postfx.ts`, blurred in a downscaled buffer) → **heat shimmer**.
6. **Season colour grade** — graded over the *composited* frame, fading out
   with depth so the deep reads as the biome's; then weather tint, vignette,
   damage flash, HUD, arrival fade.

Supporting modules: `bake.ts` bakes one-time gradient sprites (holes, beams,
edge shadows, flecks) so nothing rebuilds a `CanvasGradient` per frame —
follow that pattern for new decals; `tileart.ts` pre-renders tile textures at
2× supersample; `weather.ts` spawns seasonal surface particles through the
same `spawn` callback every other effect uses; `text.ts`, `fonts.ts`, and
`icons.ts` cover canvas text wrapping, shared font stacks, and procedural
icons.

### Testing conventions

Vitest with `environment: "node"` (see `vite.config.ts`) — no DOM/canvas
available in unit tests, which is exactly why simulation code must stay
framework-free. Tests exercise modules directly (physics steps, drilling
progress, save round-trips, economy math, stick tilt, layout breakpoints)
rather than through the `Game` facade or a rendered surface. When a render
concern *is* worth testing, the pattern is to extract the math into a DOM-free
module beside it — `render/lights.ts` and `engine/stick.ts` exist in that shape
for exactly this reason.

To verify a change visually (not just via unit tests), use the **`verify`**
skill — it builds, launches the dev server, and drives the game with
Playwright against `window.__game`.

The `docs/screenshots/` images in the README are captured with that same setup —
regenerate them by driving the game rather than by hand-editing images.
