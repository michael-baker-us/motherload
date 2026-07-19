import { describe, expect, it } from "vitest";
import type { SaveStorage } from "../game/save";
import {
  AUDIO_KEY,
  clampVolume,
  DEFAULT_AUDIO,
  loadAudioSettings,
  saveAudioSettings,
} from "./settings";

function fakeStorage(initial: Record<string, string> = {}): SaveStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("audio settings", () => {
  it("falls back to defaults with no storage or no saved value", () => {
    expect(loadAudioSettings(null)).toEqual(DEFAULT_AUDIO);
    expect(loadAudioSettings(fakeStorage())).toEqual(DEFAULT_AUDIO);
  });

  it("round-trips through storage", () => {
    const storage = fakeStorage();
    saveAudioSettings(storage, { volume: 0.3, muted: true });
    expect(loadAudioSettings(storage)).toEqual({ volume: 0.3, muted: true });
  });

  it("survives corrupt or out-of-range saved values", () => {
    expect(loadAudioSettings(fakeStorage({ [AUDIO_KEY]: "not json{" }))).toEqual(DEFAULT_AUDIO);
    const weird = fakeStorage({ [AUDIO_KEY]: JSON.stringify({ volume: 47, muted: "yes" }) });
    expect(loadAudioSettings(weird)).toEqual({ volume: 1, muted: false });
  });

  it("clamps and snaps volume to tenths", () => {
    expect(clampVolume(-0.4)).toBe(0);
    expect(clampVolume(1.7)).toBe(1);
    expect(clampVolume(0.4499)).toBe(0.4);
    expect(clampVolume(0.7 + 0.1)).toBe(0.8); // float drift snaps clean
  });
});
