import { describe, expect, it } from "vitest";
import { claimPlaybackSession, panFor } from "./engine";

describe("iOS audio session", () => {
  it("claims the playback category when the browser exposes one", () => {
    const nav = { audioSession: { type: "auto" } };
    claimPlaybackSession(nav);
    // "playback" is the category that ignores the hardware ring/silent switch.
    expect(nav.audioSession.type).toBe("playback");
  });

  it("is a no-op where the Audio Session API is absent", () => {
    expect(() => claimPlaybackSession({})).not.toThrow();
    expect(() => claimPlaybackSession(undefined)).not.toThrow();
  });

  it("survives a read-only session type rather than killing audio setup", () => {
    const nav = { audioSession: {} };
    Object.defineProperty(nav.audioSession, "type", {
      get: () => "auto",
      set: () => {
        throw new TypeError("read only");
      },
    });
    expect(() => claimPlaybackSession(nav)).not.toThrow();
  });
});

describe("stereo pan", () => {
  it("centers on the listener and pans with world offset", () => {
    expect(panFor(100, 100, 400)).toBe(0); // at the listener → centered
    expect(panFor(300, 100, 400)).toBeCloseTo(0.5); // half-width to the right
    expect(panFor(100, 300, 400)).toBeCloseTo(-0.5); // to the left
  });

  it("clamps to [-1, 1] beyond the half-width", () => {
    expect(panFor(9999, 0, 400)).toBe(1);
    expect(panFor(-9999, 0, 400)).toBe(-1);
  });
});
