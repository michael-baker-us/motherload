import { AudioEngine } from "./audio/engine";
import { loadAudioSettings } from "./audio/settings";
import { Loop } from "./engine/loop";
import { Input } from "./engine/input";
import { Game } from "./game/game";
import { Renderer } from "./render/renderer";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) throw new Error("missing #game canvas");
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("2d context unavailable");

const input = new Input();
input.attach(window);

const game = new Game(window.innerWidth, window.innerHeight, window.localStorage);
const renderer = new Renderer();
const audio = new AudioEngine(loadAudioSettings(window.localStorage), window.localStorage);
audio.attach(window);

// Dev-only handle for debugging and driving the game from the console/tests.
if (import.meta.env.DEV) {
  (window as unknown as { __game: Game }).__game = game;
  (window as unknown as { __audio: AudioEngine }).__audio = audio;
}

function resize(): void {
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

new Loop({
  update(dt) {
    game.update(dt, input);
    input.endFrame();
  },
  render(alpha) {
    // Audio reads fxEvents before the renderer drains them.
    audio.frame(game);
    renderer.render(ctx!, game, alpha);
  },
}).start();
