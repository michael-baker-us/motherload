/**
 * Procedural one-shot sounds — everything is synthesized from oscillators and
 * noise, so there are no audio assets to load or license.
 *
 * Every helper takes (ctx, out) and schedules a short self-cleaning node graph
 * into `out`. Envelopes use exponential decay to 0.001, which reads as silence.
 */

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** One second of white noise, cached per context; loops and one-shots share it. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

interface ToneOpts {
  type: OscillatorType;
  freqFrom: number;
  freqTo?: number;
  gain: number;
  duration: number;
  /** Seconds after "now" to start. */
  at?: number;
}

function tone(ctx: BaseAudioContext, out: AudioNode, o: ToneOpts): void {
  const t0 = ctx.currentTime + (o.at ?? 0);
  const osc = ctx.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.freqFrom, t0);
  if (o.freqTo !== undefined) osc.frequency.exponentialRampToValueAtTime(o.freqTo, t0 + o.duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(o.gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + o.duration);
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + o.duration);
  osc.onended = () => g.disconnect();
}

interface NoiseOpts {
  filter: BiquadFilterType;
  freqFrom: number;
  freqTo?: number;
  gain: number;
  duration: number;
  playbackRate?: number;
  at?: number;
}

function noiseHit(ctx: BaseAudioContext, out: AudioNode, o: NoiseOpts): void {
  const t0 = ctx.currentTime + (o.at ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.playbackRate.value = o.playbackRate ?? 1;
  const filter = ctx.createBiquadFilter();
  filter.type = o.filter;
  filter.frequency.setValueAtTime(o.freqFrom, t0);
  if (o.freqTo !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(o.freqTo, t0 + o.duration);
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(o.gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + o.duration);
  src.connect(filter).connect(g).connect(out);
  src.start(t0, Math.random()); // random offset so repeats don't sound identical
  src.stop(t0 + o.duration);
  src.onended = () => g.disconnect();
}

/** Dirt crunch: filtered noise chunk plus a low thud. */
export function playDug(ctx: BaseAudioContext, out: AudioNode): void {
  noiseHit(ctx, out, {
    filter: "lowpass",
    freqFrom: 1200,
    freqTo: 250,
    gain: 0.4,
    duration: 0.16,
    playbackRate: 0.7 + Math.random() * 0.4,
  });
  tone(ctx, out, { type: "sine", freqFrom: 95, freqTo: 55, gain: 0.3, duration: 0.12 });
}

/** Mineral banked: quick two-note blip rising. */
export function playPickup(ctx: BaseAudioContext, out: AudioNode): void {
  tone(ctx, out, { type: "triangle", freqFrom: 660, gain: 0.22, duration: 0.09 });
  tone(ctx, out, { type: "triangle", freqFrom: 990, gain: 0.22, duration: 0.14, at: 0.07 });
}

/** Hard landing: pitch-dropping thump scaled by impact power. */
export function playImpact(ctx: BaseAudioContext, out: AudioNode, power: number): void {
  const punch = Math.min(1, 0.4 + power / 40);
  tone(ctx, out, { type: "sine", freqFrom: 130, freqTo: 40, gain: 0.5 * punch, duration: 0.25 });
  noiseHit(ctx, out, { filter: "lowpass", freqFrom: 900, freqTo: 150, gain: 0.35 * punch, duration: 0.2 });
}

/** Gas pocket / lava: big filtered-noise boom with a sub-bass drop. */
export function playExplosion(ctx: BaseAudioContext, out: AudioNode): void {
  noiseHit(ctx, out, { filter: "lowpass", freqFrom: 2500, freqTo: 90, gain: 0.7, duration: 0.7 });
  tone(ctx, out, { type: "sine", freqFrom: 90, freqTo: 28, gain: 0.55, duration: 0.5 });
}

/** Upgrade installed: rising three-note arpeggio. */
export function playUpgrade(ctx: BaseAudioContext, out: AudioNode): void {
  const notes = [523, 659, 784];
  notes.forEach((f, i) => {
    tone(ctx, out, { type: "triangle", freqFrom: f, gain: 0.2, duration: 0.16, at: i * 0.09 });
  });
}

/** Ore sold: coin-style double ding. */
export function playSell(ctx: BaseAudioContext, out: AudioNode): void {
  tone(ctx, out, { type: "sine", freqFrom: 1318, gain: 0.25, duration: 0.12 });
  tone(ctx, out, { type: "sine", freqFrom: 1760, gain: 0.25, duration: 0.28, at: 0.08 });
}

/** Pod lost: long falling sweep with a noise tail. */
export function playDeath(ctx: BaseAudioContext, out: AudioNode): void {
  tone(ctx, out, { type: "sawtooth", freqFrom: 220, freqTo: 50, gain: 0.35, duration: 0.9 });
  noiseHit(ctx, out, { filter: "lowpass", freqFrom: 1200, freqTo: 100, gain: 0.3, duration: 0.8, at: 0.1 });
}

/** Low-fuel warning ping. */
export function playFuelBeep(ctx: BaseAudioContext, out: AudioNode): void {
  tone(ctx, out, { type: "sine", freqFrom: 950, gain: 0.2, duration: 0.14 });
  tone(ctx, out, { type: "sine", freqFrom: 950, gain: 0.2, duration: 0.14, at: 0.2 });
}
