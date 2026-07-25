import "./assets/fonts.css";
import { AudioEngine } from "./audio/engine";
import { loadAudioSettings } from "./audio/settings";
import { loadBindings } from "./engine/bindings";
import { Loop } from "./engine/loop";
import { Input } from "./engine/input";
import * as config from "./game/config";
import { Game } from "./game/game";
import { loadGamePrefs } from "./game/prefs";
import { loadViewPrefs } from "./render/prefs";
import { Renderer } from "./render/renderer";
import { showCrashScreen } from "./ui/crash";
import { measureLayout } from "./ui/layout";
import { TitleOverlay } from "./ui/title";
import { TouchControls } from "./ui/touchControls";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) throw new Error("missing #game canvas");
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("2d context unavailable");

const input = new Input();
input.attach(window);
// Screen shape is needed before anything builds UI — overlays size themselves
// from it at construction, not just at render time.
measureLayout(window.innerWidth, window.innerHeight);
loadViewPrefs(window.localStorage);
loadGamePrefs(window.localStorage);
loadBindings(window.localStorage);

const game = new Game(window.innerWidth, window.innerHeight, window.localStorage);
const renderer = new Renderer();
const audio = new AudioEngine(loadAudioSettings(window.localStorage), window.localStorage);
audio.attach(window);

const touchControls = new TouchControls();
touchControls.mount(input);

// The title screen's buttons — canvas draws the logo, this layer is clickable.
const titleOverlay = new TitleOverlay();
titleOverlay.mount(game);

// Dev-only handle for debugging and driving the game from the console/tests.
if (import.meta.env.DEV) {
  (window as unknown as { __game: Game }).__game = game;
  (window as unknown as { __audio: AudioEngine }).__audio = audio;
  (window as unknown as { __renderer: Renderer }).__renderer = renderer;
  // Live-tunable render config (LIGHT/POST/FX/…) for console tweaking + verify.
  (window as unknown as { __config: typeof config }).__config = config;
}

function resize(): void {
  // UI layout first: the HUD and screens read it while rendering this frame.
  measureLayout(window.innerWidth, window.innerHeight);
  const dpr = window.devicePixelRatio || 1;
  canvas!.width = Math.round(window.innerWidth * dpr);
  canvas!.height = Math.round(window.innerHeight * dpr);
  // Draw in CSS-pixel coordinates; the transform handles high-DPI scaling.
  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Tile art is baked at 2x supersample, so smoothing on the downscale is
  // what keeps it crisp — nearest-neighbor causes seams under the world zoom.
  ctx!.imageSmoothingEnabled = true;
  game.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", resize);
resize();

const loop = new Loop({
  update(dt) {
    try {
      game.update(dt, input);
      input.endFrame();
    } catch (e) {
      showCrashScreen(e);
    }
  },
  render(alpha) {
    try {
      // Audio reads fxEvents before the renderer drains them.
      audio.frame(game);
      renderer.render(ctx!, game, alpha);
      titleOverlay.sync(game);
      touchControls.sync(game);
    } catch (e) {
      showCrashScreen(e);
    }
  },
});

// Re-anchor the clock when the tab becomes visible so the sim doesn't
// fast-forward a catch-up burst after being backgrounded.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") loop.reset();
});

// Last-resort boundary for anything thrown outside the loop (event handlers).
window.addEventListener("error", (e) => showCrashScreen(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => showCrashScreen(e.reason));

// Kick off web-font loading so canvas text picks them up within a frame or two.
if (typeof document !== "undefined" && "fonts" in document) {
  void Promise.allSettled([
    document.fonts.load('16px "Share Tech Mono"'),
    document.fonts.load('800 24px "Orbitron"'),
  ]);
}

loop.start();
