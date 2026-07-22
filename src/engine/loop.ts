export interface LoopCallbacks {
  /** Called at a fixed rate (STEP seconds) — all simulation happens here. */
  update(dt: number): void;
  /** Called once per animation frame. alpha in [0,1) is how far we are between updates. */
  render(alpha: number): void;
}

export const STEP = 1 / 60;

// Longest frame gap we'll simulate. Anything larger (backgrounded tab,
// debugger pause) is dropped rather than fast-forwarded.
const MAX_FRAME = 0.25;

export class Loop {
  private accumulator = 0;
  private last = 0;
  private rafId = 0;
  private running = false;

  constructor(private callbacks: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /**
   * Drop accumulated time and re-anchor to now — call when returning from a
   * long pause (tab hidden) so the sim resumes seamlessly instead of
   * fast-forwarding a MAX_FRAME catch-up burst.
   */
  reset(): void {
    this.last = performance.now();
    this.accumulator = 0;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    const delta = Math.min((now - this.last) / 1000, MAX_FRAME);
    this.last = now;

    this.accumulator += delta;
    while (this.accumulator >= STEP) {
      this.callbacks.update(STEP);
      this.accumulator -= STEP;
    }
    this.callbacks.render(this.accumulator / STEP);

    this.rafId = requestAnimationFrame(this.frame);
  };
}
