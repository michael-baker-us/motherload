# Mission: Push the Canvas 2D Renderer to Modern Indie Quality

## Context

The game is a TypeScript + Canvas 2D *Motherload* clone. The simulation (`game/`) is
solid, but the renderer reads as a browser prototype rather than a premium indie title.
The goal of this phase is purely **visual quality** — no gameplay features — while
staying on the hand-rolled Canvas 2D renderer (no WebGL/Pixi/Phaser). The target look is
SteamWorld Dig / Dome Keeper / Hollow Knight / Ori: atmospheric darkness, colored
emissive lighting, bloom, living world detail.

**Why now:** the renderer already has the *bones* of a cinematic pipeline (a depth
darkness ramp, an offscreen light buffer, additive emissive sprites, baked tile
textures) but they're wired in an order that fights itself, and the lighting model tops
out at two lights. The highest-impact work is to restructure the compositing spine so the
emissive/atmosphere/bloom layers land in the right order, then progressively enrich each
layer.

**The core defect that unlocks everything:** every additive emissive draw (lava glow, ore
glint, dig flare, station neon, thruster, headlamp) happens *inside* the zoomed world pass
at `renderer.ts:195-206`, which runs **before** `applyLighting` (`renderer.ts:219`) paints
the fog-darkness overlay on top. So the deeper you go, the more the darkness *dims the very
glows that should be piercing it*. Only the scanner escapes, because it draws after
lighting. Fixing the draw order is Phase 1 and is prerequisite to real lighting.

**Decisions locked with the user:**
- **Cadence:** land **one phase at a time**, pause for visual review after each.
- **Structure:** **split** the 1588-line `renderer.ts` into peer modules (matching the
  existing `Sky`/`Hud` composition pattern), done incrementally as each phase needs it.

**Hard constraints (unchanged):** `game/` stays renderer-independent; render reads sim
state, never mutates it; keep Canvas 2D; keep the fixed-timestep loop; keep the `fxEvents`
architecture; **all tuning numbers go in `config.ts`** (repo convention — the renderer
currently violates this with hard-coded consts); avoid large rewrites (the module split is
incremental, not a rewrite). Drawing is in CSS pixels (DPR transform in `main.ts`);
`imageSmoothingEnabled` stays ON (tile art is 2× supersampled).

---

## Target architecture (the mission's pipeline)

```
Game Sim → World albedo → Darkness/Lighting → Emissive+Particles → Atmosphere → Bloom(post) → Vignette/Flash/Scanner → HUD/UI
```

`Renderer` keeps frame orchestration + world/tile/pod/station/screen drawing, and composes
new peer classes (like it already composes `Sky` and `Hud`):

| New module | Owns | Lands in phase |
|---|---|---|
| `src/render/bake.ts` | `bakeGlow`/`bakeEdge`/`bakeCrust` (mechanical move from `renderer.ts:1543-1588`) | 1 |
| `src/render/lights.ts` | `Light` type + **pure** collection/flicker helpers (unit-testable in node) | 1–2 |
| `src/render/lighting.ts` | `Lighting` class: darkness overlay + emissive compositing (ex-`applyLighting`) | 1 |
| `src/render/postfx.ts` | bloom, vignette, flash, color-grade, haze | 3 |
| `src/render/camerafx.ts` | zoom / shake / ease / look-ahead / impact-zoom / sway | 7 |

`engine/camera.ts` stays the 32-line pure-position class. This removes ~350 lines from
`renderer.ts` and creates natural test seams for previously-untested render logic.

---

## config.ts additions (repo convention — move hard-coded render consts here)

New named-const blocks in `src/game/config.ts`, mirroring `PHYSICS`/`HEAT` style. These
replace the hard-coded values currently at `renderer.ts:41-52` and inside `applyLighting`:

```ts
export const LIGHT = {
  darkStart: 4, darkRamp: 70, maxDarkness: 0.93,      // renderer.ts 44-46, 1167
  ambientHole: 0.75,                                   // softer lamp falloff (was 0.6 stop)
  headlamp: { radius: 165, color: [255,190,110], intensity: 1 },
  beacon:   { radius: 165, color: [120,230,255], pulse: 0.15, pulseHz: 2 },
  lava:     { radius: 60,  color: [255,120,30],  flicker: 0.35, flickerHz: 2.5 },
  station:  { neonBlur: 7, blinkHz: 2.4, windowColor: [255,233,160] },
  budget: 24,          // max dynamic lights composited per frame
};
export const POST = {
  bloom: { enabled: true, downscale: 0.5, blurPx: 8, strength: 0.6 },
  vignette: 0.3, flash: 0.42,                          // renderer.ts 1336, 1355
};
export const FX = {
  maxParticles: 400, motes: 22,                        // renderer.ts 41, 113
  embers: { biome: "Magma Depths", rateHz: 8 },
  heatHaze: { biome: "Magma Depths", strength: 0.5 },
  depthHaze: { start: 40, strength: 0.35 },
};
export const DEPTH = { backScale: 0.85, face: { ceiling: 0.34, wall: 0.5, floor: 0.68, lip: 1.2 } }; // renderer.ts 50-52
export const CAMERA = { zoom: 1.6, ease: 5.5, lookX: 0.3, lookY: 0.22, shakeDecay: 1.6, shakeMag: 22, impactZoom: 0.04, sway: 0.02 };
```
`VIEW.zoom` stays as an alias of `CAMERA.zoom` so `ZOOM` at `renderer.ts:42` keeps working.

---

## Offscreen buffers & compositing order (the Phase-1 spine)

Three offscreen canvases, allocated once in the ctor and resized on demand exactly like the
existing `lightCanvas` (`renderer.ts:1172-1175`) — no per-frame allocation, no
`getImageData` readback (avoids integrated-GPU stalls):

1. **`darkBuf`** (native res) — repurpose today's `lightCanvas`. Fog-darkness fill with
   `destination-out` radial holes punched per light; blitted source-over onto main.
2. **`bloomBuf`** (downscaled, `POST.bloom.downscale`) — accumulates emissive glow blits for bloom.
3. **`bloomBufB`** (same small size) — scratch for separable blur.

**Prerequisite:** replace the per-axis `Math.random()` shake at `renderer.ts:197` with a
**stored `shakeX/shakeY`** so post passes can re-register with the shaken world (today
lighting/scanner already drift sub-pixel off the world because they don't share the shake).

**New draw order** (replacing `renderer.ts:195-223`):
1. **World albedo** (zoom+shake): sky → tiles → stations → pod → non-additive particles →
   floats. The inline "lighter" emissive blocks are **removed** here; instead each source
   **pushes a `Light`** into `this.lights`.
2. **Darkness** — build `darkBuf` (fog @ darkness), `destination-out` a **baked** radial
   alpha sprite per light (not a fresh `createRadialGradient`), blit source-over to main.
3. **Emissive + light color** (zoom+shared-shake, `"lighter"`) — blit each light's colored
   glow sprite + additive particles + motes. **Now every emissive source punches through the
   darkness — the core defect is fixed.**
4. **Atmosphere** — biome color-grade wash, depth-haze, heat-haze (magma only). *(Phase 4)*
5. **Bloom** — re-blit glows into `bloomBuf` at downscale, blur, add back with `"lighter"`. *(Phase 3)*
6. **Vignette / flash / scanner** — as today (`renderer.ts:220-223`).
7. **HUD / screens** — unchanged.

*Why an authored emissive buffer, not a true scene bright-pass:* Canvas 2D has no cheap
brightness threshold and scene readback stalls the pipeline. Every bright source here is
already a baked-glow blit, so "bright-pass" is implicit and free.

---

## Multi-light system (`lights.ts`)

Replace the hard-coded 2-light `applyLighting` with a data-driven list rebuilt each frame,
collected during passes the renderer **already runs** — so `game/` is never touched:

```ts
interface Light { x:number; y:number; radius:number; color:readonly[number,number,number]; intensity:number; flicker:number; hz:number; }
private lights: Light[] = [];   // cleared at frame top
```
- **Tiles:** in the existing `drawTiles` visible-tile loop (`renderer.ts:500-563`), push a
  light on `TileId.Lava` (edge-only: skip if left/top neighbor is also lava — ~4× fewer),
  on `TILE_DEFS[tile].value > 0` (faint ore glint on its cycle), on `TileId.Anomaly` (beacon).
- **Stations:** `drawStations` loop (`renderer.ts:688`) pushes a neon light per visible station.
- **Pod:** facing-biased headlamp; thruster light when `isThrusting`; dig-flare when `hasDigTarget`.
- **Budget:** if `lights.length > LIGHT.budget`, sort by distance-to-pod, keep nearest N
  (headlamp + beacon always kept).
- **Flicker:** `intensity * (1 - flicker + flicker*(0.5+0.5*sin(time*hz + phase)))`, phase
  seeded from `hash2d(tx,ty)` so lava cells shimmer independently.

Consumed twice: `destination-out` holes in `darkBuf` (alpha = intensity) and additive
colored blits in the emissive pass — both reuse the existing `lavaGlow/warmGlow/anomalyGlow`
baked sprites (tinted where needed).

---

## Phases (one at a time — review after each)

Each phase ends with the **`verify`** skill: build, launch, drive `window.__game` to the
surface **and** to magma depth, screenshot, and read FPS via `showTelemetry`
(`renderer.ts:1285`) to confirm 60fps. `game/` is untouched, so its Vitest suite stays
green; new pure helpers (light collection, flicker) get node-env unit tests.

### Phase 1 — Compositing spine + emissive fix *(highest impact)*
Stored shake offset; extract `bake.ts` + `lighting.ts` (+ `Light` type in `lights.ts`);
relocate the 8 inline emissive blocks (`renderer.ts:457-461, 536-561, 590-595, 743-782,
894-915, 1073-1079`) into the post-darkness emissive pass; land the config blocks and
repoint `renderer.ts:41-52`; soften/warm the headlamp. **Verify:** at depth,
lava/beacon/thruster/neon now pierce the dark (today they're dimmed); surface unchanged; FPS flat.

### Phase 2 — Populate the multi-light list *(colored, flickering lights)*
Implement collection in `drawTiles`/`drawStations`/`drawPod`; lava edge-merge; budget sort;
per-source flicker/pulse. **Perf ⚠ (integrated GPU):** baked-sprite blits only, `LIGHT.budget`
cap, reuse 3 existing glow sprites. **Verify:** descend a lava seam — many independent warm
pools + steady cool beacon; watch FPS at a dense lava wall.

### Phase 3 — Bloom post pass (`postfx.ts`)
`bloomBuf`/`bloomBufB` (downscaled); re-blit glows, blur (`ctx.filter="blur()"` or two-pass
scaled `drawImage`), add back at `POST.bloom.strength`. Dirty-flag: skip when no on-screen
bright + low darkness. **Perf ⚠:** downscale 0.5 (0.25 fallback). **Verify:** glints/beacon/
lava/thruster bloom softly; toggle `POST.bloom.enabled`; 60fps at both downscales.

### Phase 4 — Atmosphere
Depth-haze gradient (cached, vignette-style); formalized biome color-grade; drifting embers
(magma-only additive particles); richer motes (`drawMotes` `renderer.ts:1234`); cheap
scrolling heat-haze warp band (magma only, overlay wobble not per-pixel). **Perf ⚠:** gate
haze/embers by biome so they're no-ops elsewhere. **Verify:** distinct mood per biome; embers
in magma; haze absent at surface.

### Phase 5 — Fake normal / material lighting
Per-tile directional shading against the **dominant** light (headlamp) — keep it O(tiles) by
shading one light only; `FACE_LIGHT` in the 2.5D pass (`renderer.ts:52, 654-682`) becomes
light-direction-aware; precompute the face-color LUT (reuse `faceColors` cache pattern).
Feature-flag via `viewPrefs`. **Perf ⚠ (highest):** measure at a dense wall with depth on.
**Verify:** walls near the lamp read sculpted.

### Phase 6 — Pod + environmental animation
Suspension bob/tilt from `player.vx/vy/grounded`; exhaust + drill flare into the glow buffer;
damage sparks + warning lights at low `player.hull`; a **`death` fxEvent visual** (none today
— add to `consumeFx` `renderer.ts:276`); impact dust from `player.impactSpeed`.
**Verify:** pod feels alive; death has a visual beat.

### Phase 7 — Camera enhancements (`camerafx.ts`)
Move ZOOM/shake/ease/look-ahead out of `renderer.ts:139-197`; add impact-zoom punch (from
`impact`/`explosion` fx) + velocity sway. `engine/camera.ts` untouched. Reduced-motion still
suppresses. **Verify:** landings/explosions give a subtle kick; sway reads at speed.

### Phase 8 — HUD / UI polish
Gauge glow/needle animation, panel bloom consistent with the new light language, transition
polish (`ui/hud.ts`, screen methods `renderer.ts:1362-1536`). Lowest risk, done last.
**Verify:** HUD holds contrast/legibility against the brighter world.

---

## Performance guardrails (60fps on integrated GPUs)

- **Riskiest:** Phase 2 (many lights), 3 (blur), 5 (per-tile lighting), 4 heat-haze.
- All 3 offscreens allocated once, resized only on canvas resize (the `lightCanvas` pattern).
- **Baked sprites over runtime gradients** for darkness holes and light washes — never
  `createRadialGradient` per light per frame.
- Cached gradients via the keyed-cache pattern (`renderer.ts:1322-1342`).
- Bloom downscaled (0.5 → 0.25 fallback); blur only the small buffer.
- Dirty-flag skips: keep `darkness <= 0.01` early-out; skip bloom with no on-screen brights;
  gate heat-haze/embers by biome; feature-flag Phase-5 material lighting.
- Budgets: `LIGHT.budget` (≤24, nearest-first), `FX.maxParticles`, lava edge-merge.

## Verification (end to end)

1. `npm test` — `game/` suite + new `lights.ts`/flicker unit tests stay green.
2. `npm run build` — `tsc --noEmit` type gate.
3. **`verify` skill** per phase: drive `window.__game` to surface and to magma depth,
   screenshot before/after, confirm the phase's specific visual win and 60fps via
   `showTelemetry`. `window.__renderer` (`main.ts:34`) is available for live tweaking.
