import { clamp } from "./math";

/**
 * Axis-aligned camera. (x, y) is the top-left corner of the view in world
 * pixels; worldToScreen is just subtraction, done inline by the renderer.
 */
export class Camera {
  x = 0;
  y = 0;

  constructor(
    public viewWidth: number,
    public viewHeight: number,
  ) {}

  resize(viewWidth: number, viewHeight: number): void {
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
  }

  /** Center on (cx, cy), clamped so the view never leaves the world. */
  follow(cx: number, cy: number, worldWidth: number, worldHeight: number): void {
    this.x =
      worldWidth <= this.viewWidth
        ? (worldWidth - this.viewWidth) / 2
        : clamp(cx - this.viewWidth / 2, 0, worldWidth - this.viewWidth);
    this.y =
      worldHeight <= this.viewHeight
        ? (worldHeight - this.viewHeight) / 2
        : clamp(cy - this.viewHeight / 2, 0, worldHeight - this.viewHeight);
  }
}
