import { biomeAt } from "../game/biomes";
import { SEASON } from "../game/config";
import type { FxEvent, Game } from "../game/game";
import type { SaveStorage } from "../game/save";
import { windAccelAt, type SeasonVoice } from "../game/seasons";
import { clampVolume, saveAudioSettings, VOLUME_STEP, type AudioSettings } from "./settings";
import * as sfx from "./sfx";

/** Seconds between low-fuel warning pings. */
const FUEL_BEEP_INTERVAL = 1.8;
/** Fuel fraction below which the warning starts. */
const FUEL_WARN_FRACTION = 0.25;

/** Slow ambient progression in A minor (Am – F – C – G) — four voices each. */
const PAD_CHORDS = [
  [220.0, 261.63, 329.63, 440.0], // Am  A3 C4 E4 A4
  [174.61, 261.63, 349.23, 440.0], // F   F3 C4 F4 A4
  [261.63, 329.63, 392.0, 523.25], // C   C4 E4 G4 C5
  [196.0, 246.94, 392.0, 493.88], // G   G3 B3 G4 B4
];
const CHORD_SECONDS = 5;

/**
 * Surface ambience by season voice. A table rather than a switch so adding a
 * season that reuses a voice is a data change; only a genuinely new *sound*
 * needs new synthesis. `render/seasons-render.test.ts` asserts every season's
 * voice has an entry here.
 */
export const AMBIENCE: Record<
  SeasonVoice,
  ((ctx: BaseAudioContext, out: AudioNode, gain: number) => void) | null
> = {
  none: null,
  birds: sfx.playBirdCall,
  insects: sfx.playInsectChirp,
  gust: sfx.playWindGust,
};

/** Stereo pan in [-1, 1] for a world-x relative to the listener; ±1 at halfWidth away. */
export function panFor(worldX: number, listenerX: number, halfWidth: number): number {
  return Math.max(-1, Math.min(1, (worldX - listenerX) / Math.max(1, halfWidth)));
}

/**
 * iOS routes a bare AudioContext through the *ambient* audio session, which the
 * hardware ring/silent switch mutes outright: the context reports `running`, the
 * graph runs, `playedCount` climbs, and nothing reaches the speaker. Declaring
 * the session as "playback" opts into the category music and video apps use,
 * which ignores the switch.
 *
 * Affects every browser on iOS — Chrome and Firefox there are WebKit shells and
 * share the same audio stack. Safari 16.4+; a no-op elsewhere, so it's safe to
 * call unconditionally. The tradeoff is deliberate: "playback" takes over the
 * audio session, so it interrupts music playing in another app.
 *
 * Exported for the unit test — nothing else should need to call it.
 */
export function claimPlaybackSession(nav: unknown = globalThis.navigator): void {
  const session = (nav as { audioSession?: { type?: string } } | undefined)?.audioSession;
  if (!session) return;
  try {
    session.type = "playback";
  } catch {
    // Read-only or unsupported value — the default session still plays with
    // the ringer on, so this is a downgrade, not a failure.
  }
}

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
  /** Continuous loops route through this so a big one-shot can duck them. */
  private loopBus: GainNode | null = null;
  private thrust: LoopVoice | null = null;
  private drill: sfx.DrillVoice | null = null;
  private wind: LoopVoice | null = null;
  private rumble: LoopVoice | null = null;
  private pad: sfx.PadVoice | null = null;
  private beepTimer = 0;
  private lastTime = 0;
  private lastState = "";
  private chordIdx = 0;
  private chordTimer = CHORD_SECONDS;
  private arpTimer = 3;
  /** Countdown to the next seasonal surface ambience one-shot. */
  private ambienceTimer = 2;
  /** Last wind filter type applied — AudioParam ramps can't change node type. */
  private windType: BiquadFilterType | null = null;
  // Listener position for stereo panning of one-shots, refreshed each frame.
  private listenerX = 0;
  private listenerHalfW = 400;

  constructor(settings: AudioSettings, storage: SaveStorage | null = null) {
    this.settings = settings;
    this.storage = storage;
    active = this;
  }

  /** Context state for debugging/tests; null before the first user gesture. */
  get contextState(): AudioContextState | null {
    return this.ctx?.state ?? null;
  }

  /**
   * Unlock audio on a user gesture. Mobile browsers (iOS Safari especially)
   * start the context suspended and only let it run from inside a gesture, so
   * we keep listening until it's genuinely `running` — the first `resume()`
   * often no-ops on iOS — and re-resume whenever the tab becomes visible again,
   * since iOS re-suspends the context on lock/tab-away/audio interruptions.
   */
  attach(target: Window): void {
    const unlock = (): void => {
      this.ensureContext();
      if (this.ctx?.state === "running") {
        target.removeEventListener("keydown", unlock);
        target.removeEventListener("pointerdown", unlock);
        target.removeEventListener("touchend", unlock);
      }
    };
    target.addEventListener("keydown", unlock);
    target.addEventListener("pointerdown", unlock);
    target.addEventListener("touchend", unlock);
    target.document.addEventListener("visibilitychange", () => {
      if (target.document.visibilityState !== "visible") return;
      claimPlaybackSession();
      void this.ctx?.resume();
    });
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

    // Listener for stereo panning — set before one-shots fire this frame.
    const p = game.player;
    this.listenerX = p.x + p.width / 2;
    this.listenerHalfW = Math.max(200, game.camera.viewWidth / 2);

    for (const e of game.fxEvents) this.playFx(e);

    const playing = game.state === "playing";

    this.setLoop(this.thrust, playing && game.isThrusting ? 0.16 : 0, now);
    const digging = playing && p.hasDigTarget;
    if (this.drill) sfx.updateDrillVoice(this.drill, digging, p.digProgress, now);

    // Ambient beds crossfade with depth: wind topside, rumble down deep. The
    // season sets the wind's level and tone — autumn howls bright and gusty,
    // summer is a low warm hush — the same way the biome flavours the rumble.
    const depth = game.depth;
    const season = game.season;
    const surfaceW = Math.max(0, 1 - depth / 12);
    // Autumn's bed swells with the *same* gust the physics applies, so the wind
    // you hear and the wind that shoves the pod are one gust.
    const gustPush = Math.abs(windAccelAt(season, depth, game.runTime)) / (SEASON.wind.accel || 1);
    const windGain = surfaceW * 0.045 * season.sound.wind.gain * (1 + gustPush * 0.8);
    this.setLoop(this.wind, windGain, now, 0.4);
    if (this.wind) {
      this.wind.filter.frequency.setTargetAtTime(season.sound.wind.freq, now, 0.6);
      // Filter *type* can't be ramped, so only touch it when it actually changes.
      if (this.windType !== season.sound.wind.type) {
        this.windType = season.sound.wind.type;
        this.wind.filter.type = this.windType;
      }
    }

    // Sporadic surface ambience — birdsong, cicadas, gusts. Table-dispatched so
    // a new season reusing an existing voice needs no code here.
    const voice = AMBIENCE[season.sound.ambience.voice];
    if (playing && voice && depth < season.sound.surfaceDepth) {
      this.ambienceTimer -= dt;
      if (this.ambienceTimer <= 0) {
        this.ambienceTimer =
          SEASON.audio.minGap + Math.random() * (SEASON.audio.maxGap - SEASON.audio.minGap);
        voice(ctx, this.master, season.sound.ambience.gain * SEASON.audio.volume);
        this.playedCount++;
      }
    }
    // Rumble bed flavoured by biome — intensity and tone (magma roars bright,
    // the deep is a low sub-drone).
    const biome = biomeAt(depth);
    const rumbleBase = Math.min(1, Math.max(0, (depth - 8) / 30)) * 0.06;
    this.setLoop(this.rumble, rumbleBase * biome.rumble, now, 0.4);
    this.rumble?.filter.frequency.setTargetAtTime(biome.rumbleFreq, now, 0.6);
    // Musical pad: clearly present at the surface (above the wind bed),
    // swelling further as you descend.
    if (this.pad) {
      this.pad.gain.gain.setTargetAtTime(0.09 + Math.min(1, depth / 80) * 0.07, now, 0.6);
      // Advance the chord progression so the pad evolves, not drones.
      this.chordTimer -= dt;
      if (this.chordTimer <= 0) {
        this.chordTimer = CHORD_SECONDS;
        this.chordIdx = (this.chordIdx + 1) % PAD_CHORDS.length;
        const chord = PAD_CHORDS[this.chordIdx]!;
        this.pad.oscs.forEach((o, i) => o.frequency.setTargetAtTime(chord[i]!, now, 0.9));
      }
      // Sparse twinkling melody from the current chord, an octave up.
      this.arpTimer -= dt;
      if (this.arpTimer <= 0) {
        this.arpTimer = 2.2 + Math.random() * 2.5;
        const chord = PAD_CHORDS[this.chordIdx]!;
        sfx.playPadNote(ctx, this.master, chord[1 + Math.floor(Math.random() * 3)]! * 2);
      }
    }
    // Triumphant sting the instant the objective is reached.
    if (game.state === "won" && this.lastState !== "won") sfx.playAnomalyStinger(ctx, this.master);
    this.lastState = game.state;

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

  /** A short-lived stereo panner into the master, positioned by world-x. */
  private panned(worldX: number): AudioNode {
    const ctx = this.ctx!;
    const pan = ctx.createStereoPanner();
    pan.pan.value = panFor(worldX, this.listenerX, this.listenerHalfW);
    pan.connect(this.master!);
    setTimeout(() => pan.disconnect(), 2500); // longer than any one-shot's tail
    return pan;
  }

  private playFx(e: FxEvent): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.playedCount++;
    const out = this.panned(e.x); // positioned in the stereo field
    switch (e.kind) {
      case "dug":
        sfx.playDug(ctx, out, e.tile);
        break;
      case "pickup":
        sfx.playPickup(ctx, out);
        break;
      case "impact":
        this.duck(ctx.currentTime, 0.5, 0.16);
        sfx.playImpact(ctx, out, e.power ?? 0);
        break;
      case "explosion":
        this.duck(ctx.currentTime, 0.3, 0.22);
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

  /** Dip the loop bus to `to`, then recover toward 1 — sidechain ducking. */
  private duck(now: number, to: number, release: number): void {
    const g = this.loopBus?.gain;
    if (!g) return;
    g.cancelScheduledValues(now);
    g.setValueAtTime(to, now);
    g.setTargetAtTime(1, now + 0.03, release);
  }

  private ensureContext(): void {
    // Claimed before the context exists and again on every unlock: iOS drops the
    // session back to its default after an interruption (a call, another app
    // taking audio), and re-asserting here is what makes the game audible again.
    claimPlaybackSession();
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    // Older iOS Safari exposes only the webkit-prefixed constructor; without
    // this fallback `new AudioContext()` throws and audio silently never starts.
    const Ctor: typeof AudioContext | undefined =
      globalThis.AudioContext ??
      (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    void ctx.resume();
    this.ctx = ctx;
    this.lastTime = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.value = 0; // frame() ramps it to the configured volume

    // Limiter after the volume control: transparent at normal levels, catches
    // peaks when sounds stack (explosion + drill + thrust) so they compress
    // instead of clipping into harsh digital distortion.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    master.connect(limiter).connect(ctx.destination);
    this.master = master;

    // Loops sit behind one-shots: they route through a duck bus that big hits
    // dip momentarily, so an explosion or crash punches through the grind.
    const loopBus = ctx.createGain();
    loopBus.gain.value = 1;
    loopBus.connect(master);
    this.loopBus = loopBus;

    // Continuous voices run forever at gain 0; frame() opens them as needed.
    this.thrust = this.makeNoiseLoop("bandpass", 480, 0.9);
    this.drill = sfx.buildDrillVoice(ctx, loopBus);
    this.wind = this.makeNoiseLoop("bandpass", 300, 0.4);
    this.rumble = this.makeNoiseLoop("lowpass", 90, 1);
    // Music pad plays steady above the SFX duck bus, on the master.
    this.pad = sfx.buildPad(ctx, master);
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
    src.connect(filter).connect(gain).connect(this.loopBus!);
    src.start();
    return { gain, filter };
  }
}
