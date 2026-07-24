/**
 * Cinematic camera behaviour, layered on top of the plain position `Camera`
 * (engine/camera.ts stays a pure clamped-follow rect). This owns everything that
 * makes the camera *feel*: dynamic zoom (with a jolt punch), follow-smoothing,
 * velocity look-ahead, organic sway, and screen shake. The renderer reads the
 * per-frame `zoom` / `shakeX` / `shakeY` outputs; effects feed it via
 * `addShake()` / `punchZoom()`.
 */
import type { Camera } from "../engine/camera";
import { clamp } from "../engine/math";
import { CAMERA, TILE } from "../game/config";
import type { Game } from "../game/game";

export class CameraFX {
  // Outputs read by the renderer each frame.
  zoom = CAMERA.zoom;
  shakeX = 0;
  shakeY = 0;

  // Internal smoothed camera + decaying impulses.
  private camX = 0;
  private camY = 0;
  private ready = false;
  private shakeAmt = 0;
  private zoomPunch = 0;
  private t = 0;

  /** Queue screen shake (magnitude ~0–1); the strongest request this frame wins. */
  addShake(amount: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  /** Punch the zoom in briefly — a jolt of emphasis on impacts/explosions. */
  punchZoom(amount: number): void {
    this.zoomPunch = Math.max(this.zoomPunch, amount);
  }

  /**
   * Advance the camera for one rendered frame: decay impulses, size the view to
   * the current zoom, aim ahead of the pod, ease toward it, and produce the
   * shake offset. Writes `cam.x`/`cam.y` and this frame's `zoom`/`shakeX`/`shakeY`.
   * `px`/`py` are the interpolated pod top-left; `reducedMotion` zeroes shake,
   * zoom-punch, and sway.
   */
  update(
    cam: Camera,
    game: Game,
    px: number,
    py: number,
    dt: number,
    screenW: number,
    screenH: number,
    reducedMotion: boolean,
  ): void {
    this.t += dt;
    const p = game.player;

    // Sustained tremor while the drill bites, then decay shake + zoom punch.
    if (p.hasDigTarget && game.state === "playing") {
      this.shakeAmt = Math.max(this.shakeAmt, 0.06 + clamp(p.digProgress, 0, 1) * 0.14);
    }
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * CAMERA.shakeDecay);
    // Zoom punch decays proportionally (a spring), so the small magnitude eases
    // back over ~0.3s instead of a fixed linear step wiping it out in one frame.
    this.zoomPunch *= Math.exp(-CAMERA.impactZoomDecay * dt);
    if (this.zoomPunch < 0.0005) this.zoomPunch = 0;

    this.zoom = CAMERA.zoom * (1 + (reducedMotion ? 0 : this.zoomPunch));
    // The camera works in world units sized to the (zoomed) viewport, so world
    // culling stays consistent with the magnification.
    cam.resize(screenW / this.zoom, screenH / this.zoom);

    // Aim ahead of the pod's velocity; while drilling, lead past the tile being
    // cut so you see what you're about to break into.
    let lookX = clamp(p.vx * CAMERA.lookX, -80, 80);
    let lookY = clamp(p.vy * CAMERA.lookY, -45, 70);
    if (p.hasDigTarget && game.state === "playing") {
      const podCol = Math.floor((p.x + p.width / 2) / TILE);
      const podRow = Math.floor((p.y + p.height / 2) / TILE);
      if (p.digTargetY > podRow) lookY = Math.max(lookY, 58);
      else if (p.digTargetX < podCol) lookX = Math.min(lookX, -56);
      else if (p.digTargetX > podCol) lookX = Math.max(lookX, 56);
    }

    // Organic sway: a slow drift scaled by speed, so fast flight feels kinetic
    // rather than locked to a rail. Tiny amplitude; suppressed by reduced-motion.
    const speed = Math.hypot(p.vx, p.vy);
    const swayX = reducedMotion ? 0 : Math.sin(this.t * 2.1) * speed * CAMERA.sway;
    const swayY = reducedMotion ? 0 : Math.cos(this.t * 1.7) * speed * CAMERA.sway * 0.5;

    cam.follow(
      px + p.width / 2 + lookX + swayX,
      py + p.height / 2 + lookY + swayY,
      game.world.pixelWidth,
      game.world.pixelHeight,
    );

    if (!this.ready) {
      this.camX = cam.x;
      this.camY = cam.y;
      this.ready = true;
    }
    const ease = 1 - Math.exp(-CAMERA.ease * dt);
    this.camX += (cam.x - this.camX) * ease;
    this.camY += (cam.y - this.camY) * ease;
    cam.x = this.camX;
    cam.y = this.camY;

    const mag = reducedMotion ? 0 : this.shakeAmt * this.shakeAmt * CAMERA.shakeMag;
    this.shakeX = (Math.random() - 0.5) * mag;
    this.shakeY = (Math.random() - 0.5) * mag;
  }
}
