// Keys whose browser default (scrolling) we suppress while playing.
const PREVENT_DEFAULT = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
]);

export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();

  attach(target: Window): void {
    target.addEventListener("keydown", (e) => {
      if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.held.add(e.code);
      this.pressed.add(e.code);
    });
    target.addEventListener("keyup", (e) => {
      this.held.delete(e.code);
    });
    // Keys can be released while the window is unfocused; don't let them stick.
    target.addEventListener("blur", () => {
      this.held.clear();
    });
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  /** True only on the first frame the key went down. */
  wasPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  /** Call once per update tick, after game logic has read input. */
  endFrame(): void {
    this.pressed.clear();
  }
}
