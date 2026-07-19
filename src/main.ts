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

// Dev-only handle for debugging and driving the game from the console/tests.
if (import.meta.env.DEV) {
  (window as unknown as { __game: Game }).__game = game;
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas!.width = Math.round(window.innerWidth * dpr);
  canvas!.height = Math.round(window.innerHeight * dpr);
  // Draw in CSS-pixel coordinates; the transform handles high-DPI scaling.
  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx!.imageSmoothingEnabled = false;
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
    renderer.render(ctx!, game, alpha);
  },
}).start();
