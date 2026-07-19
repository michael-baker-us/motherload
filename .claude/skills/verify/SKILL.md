---
name: verify
description: Build, launch, and drive the Motherload browser game to verify changes at the rendered surface.
---

# Verifying Motherload

Browser game (TypeScript + Canvas, Vite). The surface is pixels + keyboard.

## Launch

```bash
npx vite --port 5199 --strictPort   # dev server, background
```

## Drive

Use playwright-core with the locally installed Chrome (no browser download):

```bash
npm install playwright-core   # in a scratch dir, not the repo
```

```js
import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
await page.goto("http://localhost:5199", { waitUntil: "networkidle" });
```

- In dev builds, `window.__game` exposes the `Game` instance (see `src/main.ts`)
  — read `player` position/velocity, `depth`, `minerals` via `page.evaluate`.
- Drive with `page.keyboard.down/up("ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight")`.
  Hold keys for hundreds of ms; digging dirt takes ~0.25 s/tile plus fall time.
- Capture `page.screenshot()` before/after each action and collect
  `pageerror` / console-error events.

## Flows worth driving

- Spawn → grounded on surface at depth 0.
- Hold ArrowUp ~1 s → pod lifts; release → falls back and lands flush.
- Hold ArrowDown ~5 s → shaft appears, depth increases.
- Hold ArrowRight after a shaft → sideways tunnel at the pod's row.
- Resize viewport mid-game → canvas re-fits, no errors.

## Gotchas

- A favicon 404 shows up in console errors; benign, ignore it.
- Screenshots land wherever the driver script's directory is — use the scratchpad.
