import type { FxEvent, Game } from "../game/game";
import type { SaveStorage } from "../game/save";
import { clampVolume, saveAudioSettings, VOLUME_STEP, type AudioSettings } from "./settings";
import * as sfx from "./sfx";

/** Seconds between low-fuel warning pings. */
const FUEL_BEEP_INTERVAL = 1.8;
/** Fuel fraction below which the warning starts. */
const FUEL_WARN_FRACTION = 0.25;

let active: AudioEngine | null = null;

/** The engine main.ts registered, if any — how DOM overlays reach audio controls. */
export function activeAudio(): AudioEngine | null {
  return active;
}

interface LoopVoice {
  gain: GainNode;
  filter: BiquadFilterNode;
}

/**
 * Owns the Web Audio graph, mirroring how Renderer owns the canvas: main.ts
 * calls frame() once per rendered frame, reading game state and the fxEvents
 * queue non-destructively (the renderer still drains it afterwards).
 *
 * The AudioContext is created lazily on the first user gesture because
 * browsers refuse to start audio before one.
 */
export class AudioEngine {
  readonly settings: AudioSettings;
  /** One-shots played since boot — cheap probe for tests and debugging. */
  playedCount = 0;

  private readonly storage: SaveStorage | null;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private thrust: LoopVoice | null = null;
  private drill: sfx.DrillVoice | null = null;
  private wind: LoopVoice | null = null;
  private rumble: LoopVoice | null = null;
  private beepTimer = 0;
  private lastTime = 0;

  constructor(settings: AudioSettings, storage: SaveStorage | null = null) {
    this.settings = settings;
    this.storage = storage;
    active = this;
  }

  /** Context state for debugging/tests; null before the first user gesture. */
  get contextState(): AudioContextState | null {
    return this.ctx?.state ?? null;
  }

  /** Unlock audio on the first key press or click, then stop listening. */
  attach(target: Window): void {
    const unlock = (): void => {
      this.ensureContext();
      target.removeEventListener("keydown", unlock);
      target.removeEventListener("pointerdown", unlock);
    };
    target.addEventListener("keydown", unlock);
    target.addEventListener("pointerdown", unlock);
  }

  toggleMuted(): boolean {
    this.settings.muted = !this.settings.muted;
    saveAudioSettings(this.storage, this.settings);
    return this.settings.muted;
  }

  /** Step volume up (+1) or down (−1); unmutes so the change is audible. */
  nudgeVolume(direction: 1 | -1): number {
    this.settings.volume = clampVolume(this.settings.volume + direction * VOLUME_STEP);
    this.settings.muted = false;
    saveAudioSettings(this.storage, this.settings);
    return this.settings.volume;
  }

  /** Read game state and schedule audio for this frame. Safe to call always. */
  frame(game: Game): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const dt = Math.min(0.1, Math.max(0, now - this.lastTime));
    this.lastTime = now;

    // Squaring the 0..1 volume approximates perceived loudness.
    const level = this.settings.muted ? 0 : this.settings.volume * this.settings.volume;
    this.master.gain.setTargetAtTime(level, now, 0.06);

    for (const e of game.fxEvents) this.playFx(e);

    const p = game.player;
    const playing = game.state === "playing";

    this.setLoop(this.thrust, playing && game.isThrusting ? 0.16 : 0, now);
    const digging = playing && p.hasDigTarget;
    if (this.drill) sfx.updateDrillVoice(this.drill, digging, p.digProgress, now);

    // Ambient beds crossfade with depth: wind topside, rumble down deep.
    const depth = game.depth;
    this.setLoop(this.wind, Math.max(0, 1 - depth / 12) * 0.045, now, 0.4);
    this.setLoop(this.rumble, Math.min(1, Math.max(0, (depth - 8) / 30)) * 0.06, now, 0.4);

    if (playing && p.fuel / p.maxFuel < FUEL_WARN_FRACTION && !game.cheats.unlimitedFuel) {
      this.beepTimer -= dt;
      if (this.beepTimer <= 0) {
        sfx.playFuelBeep(ctx, this.master);
        this.playedCount++;
        this.beepTimer = FUEL_BEEP_INTERVAL;
      }
    } else {
      this.beepTimer = 0;
    }
  }

  private playFx(e: FxEvent): void {
    const ctx = this.ctx;
    const out = this.master;
    if (!ctx || !out) return;
    this.playedCount++;
    switch (e.kind) {
      case "dug":
        sfx.playDug(ctx, out);
        break;
      case "pickup":
        sfx.playPickup(ctx, out);
        break;
      case "impact":
        sfx.playImpact(ctx, out, e.power ?? 0);
        break;
      case "explosion":
        sfx.playExplosion(ctx, out);
        break;
      case "upgrade":
        sfx.playUpgrade(ctx, out);
        break;
      case "sell":
        sfx.playSell(ctx, out);
        break;
      case "death":
        sfx.playDeath(ctx, out);
        break;
    }
  }

  /** Ease a loop's gain toward `target`; loops sit silent at 0 between uses. */
  private setLoop(voice: LoopVoice | null, target: number, now: number, tc = 0.08): void {
    voice?.gain.gain.setTargetAtTime(target, now, tc);
  }

  private ensureContext(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    void ctx.resume();
    this.ctx = ctx;
    this.lastTime = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.value = 0; // frame() ramps it to the configured volume
    master.connect(ctx.destination);
    this.master = master;

    // Continuous voices run forever at gain 0; frame() opens them as needed.
    this.thrust = this.makeNoiseLoop("bandpass", 480, 0.9);
    this.drill = sfx.buildDrillVoice(ctx, master);
    this.wind = this.makeNoiseLoop("bandpass", 300, 0.4);
    this.rumble = this.makeNoiseLoop("lowpass", 90, 1);
  }

  private makeNoiseLoop(type: BiquadFilterType, freq: number, playbackRate: number): LoopVoice {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = sfx.noiseBuffer(ctx);
    src.loop = true;
    src.playbackRate.value = playbackRate;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master!);
    src.start();
    return { gain, filter };
  }
}
