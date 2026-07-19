import type { SaveStorage } from "../game/save";

export const AUDIO_KEY = "motherload-audio";

/** Player-facing audio preferences, persisted separately from the game save. */
export interface AudioSettings {
  /** Master volume 0..1 in 0.1 steps; the engine applies a perceptual curve. */
  volume: number;
  muted: boolean;
}

export const DEFAULT_AUDIO: AudioSettings = { volume: 0.7, muted: false };

export const VOLUME_STEP = 0.1;

export function clampVolume(v: number): number {
  const snapped = Math.round(v / VOLUME_STEP) * VOLUME_STEP;
  return Math.min(1, Math.max(0, Number(snapped.toFixed(1))));
}

export function loadAudioSettings(storage: SaveStorage | null): AudioSettings {
  if (!storage) return { ...DEFAULT_AUDIO };
  try {
    const raw = storage.getItem(AUDIO_KEY);
    if (!raw) return { ...DEFAULT_AUDIO };
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      volume: clampVolume(typeof parsed.volume === "number" ? parsed.volume : DEFAULT_AUDIO.volume),
      muted: parsed.muted === true,
    };
  } catch {
    return { ...DEFAULT_AUDIO };
  }
}

export function saveAudioSettings(storage: SaveStorage | null, settings: AudioSettings): void {
  storage?.setItem(AUDIO_KEY, JSON.stringify(settings));
}
