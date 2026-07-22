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

export interface DrillVoice {
  /** Gate for the whole voice; eased to 0 when not digging. */
  gate: GainNode;
  motor: OscillatorNode;
  motorFilter: BiquadFilterNode;
  chatterLfo: OscillatorNode;
}

/**
 * The drill loop, layered like the real thing instead of a raw synth buzz:
 *  - grind: low broadband noise, the bit shearing rock
 *  - chatter: midrange noise amplitude-modulated at strike rate (~24 Hz)
 *  - motor: heavily lowpassed sawtooth hum with slow pitch wobble
 * Everything passes a 2 kHz lowpass — content above that is what reads as
 * "fake" and gets fatiguing. Built against BaseAudioContext so tests can
 * render it through an OfflineAudioContext.
 */
export function buildDrillVoice(ctx: BaseAudioContext, out: AudioNode): DrillVoice {
  const gate = ctx.createGain();
  gate.gain.value = 0;
  // The whole voice pulses at strike rate — sitting inside the gate so the
  // modulation can't leak sound while the drill is idle.
  const body = ctx.createGain();
  body.gain.value = 1;
  const soften = ctx.createBiquadFilter();
  soften.type = "lowpass";
  soften.frequency.value = 2000;
  body.connect(gate);
  gate.connect(soften).connect(out);

  const noise = (): AudioBufferSourceNode => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;
    src.start(0, Math.random());
    return src;
  };

  const grindBP = ctx.createBiquadFilter();
  grindBP.type = "bandpass";
  grindBP.frequency.value = 160;
  grindBP.Q.value = 0.7;
  const grindGain = ctx.createGain();
  grindGain.gain.value = 0.55;
  noise().connect(grindBP).connect(grindGain).connect(body);

  // Chatter: sine LFO swings the midrange band ±0.28 around a 0.3 floor,
  // so the strikes never fully silence the grind underneath.
  const chatterBP = ctx.createBiquadFilter();
  chatterBP.type = "bandpass";
  chatterBP.frequency.value = 720;
  chatterBP.Q.value = 2.2;
  const chatterAmp = ctx.createGain();
  chatterAmp.gain.value = 0.3;
  const chatterLfo = ctx.createOscillator();
  chatterLfo.frequency.value = 24;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.32;
  chatterLfo.connect(lfoDepth).connect(chatterAmp.gain);
  const bodyDepth = ctx.createGain();
  bodyDepth.gain.value = 0.25;
  chatterLfo.connect(bodyDepth).connect(body.gain);
  chatterLfo.start();
  noise().connect(chatterBP).connect(chatterAmp).connect(body);

  const motor = ctx.createOscillator();
  motor.type = "sawtooth";
  motor.frequency.value = 80;
  const motorFilter = ctx.createBiquadFilter();
  motorFilter.type = "lowpass";
  motorFilter.frequency.value = 240;
  const motorGain = ctx.createGain();
  motorGain.gain.value = 0.4;
  motor.connect(motorFilter).connect(motorGain).connect(body);
  motor.start();
  // Two incommensurate wobble rates ≈ quasi-random drift, like load variation.
  for (const [rate, depth] of [
    [0.9, 2.5],
    [5.3, 1.2],
  ] as const) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate;
    const g = ctx.createGain();
    g.gain.value = depth;
    lfo.connect(g).connect(motor.frequency);
    lfo.start();
  }

  return { gate, motor, motorFilter, chatterLfo };
}

export interface PadVoice {
  /** Overall level, eased by depth in the engine. */
  gain: GainNode;
  /** The chord voices — the engine glides these through a progression. */
  oscs: OscillatorNode[];
}

/**
 * A soft ambient music pad: a mid-range A-minor(add9) chord built from pure
 * sine tones (so it reads as music, not a buzz) through a gently drifting,
 * non-resonant lowpass, with per-voice vibrato so it breathes. The engine
 * fades it in with depth. Kept in the mid register so it sits clearly above
 * the low rumble/wind noise beds instead of muddying with them.
 */
export function buildPad(ctx: BaseAudioContext, out: AudioNode): PadVoice {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 950;
  filter.Q.value = 0.6; // no resonant peak — that peak is what buzzes
  filter.connect(gain).connect(out);

  // Slow, gentle cutoff drift gives the pad movement without a melody.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.05;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 300;
  lfo.connect(lfoGain).connect(filter.frequency);
  lfo.start();

  // Four sine voices, initialised to A minor; the engine glides them through a
  // chord progression so the pad evolves instead of sitting on one held chord.
  const start = [220.0, 261.63, 329.63, 440.0]; // A3 · C4 · E4 · A4
  const levels = [0.32, 0.24, 0.2, 0.1];
  const oscs: OscillatorNode[] = [];
  start.forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = i === 3 ? "triangle" : "sine";
    osc.frequency.value = f;
    osc.detune.value = (i - 1.5) * 3; // slight spread so it's not sterile
    const og = ctx.createGain();
    og.gain.value = levels[i]!;
    osc.connect(og).connect(filter);
    osc.start();
    const vib = ctx.createOscillator();
    vib.frequency.value = 0.1 + i * 0.03;
    const vibG = ctx.createGain();
    vibG.gain.value = 2;
    vib.connect(vibG).connect(osc.detune);
    vib.start();
    oscs.push(osc);
  });

  return { gain, oscs };
}

/** A soft, bell-like melodic note over the pad — the sparse ambient melody. */
export function playPadNote(ctx: BaseAudioContext, out: AudioNode, freq: number): void {
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.04); // gentle attack
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.8); // long bell tail
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + 1.9);
  osc.onended = () => g.disconnect();
}

/** The payoff: a triumphant rising arpeggio, high shimmer, and a warm swell. */
export function playAnomalyStinger(ctx: BaseAudioContext, out: AudioNode): void {
  const notes = [392, 523, 659, 784, 1047]; // G4 · C5 · E5 · G5 · C6
  notes.forEach((f, i) => {
    tone(ctx, out, { type: "triangle", freqFrom: f, gain: 0.16, duration: 0.5, at: i * 0.12 });
  });
  tone(ctx, out, { type: "sine", freqFrom: 1568, gain: 0.08, duration: 0.9, at: 0.5 });
  // Warm root swell that fades in then out under the arpeggio.
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 130.81; // C3
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.001, t0);
  g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.3);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.7);
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + 1.8);
  osc.onended = () => g.disconnect();
}

/** Ease the drill toward the current dig state; call once per frame. */
export function updateDrillVoice(
  v: DrillVoice,
  digging: boolean,
  progress: number,
  now: number,
): void {
  v.gate.gain.setTargetAtTime(digging ? 0.45 : 0, now, digging ? 0.05 : 0.12);
  if (!digging) return;
  // Deeper bite: faster strikes, motor revs and brightens slightly.
  v.chatterLfo.frequency.setTargetAtTime(22 + progress * 16, now, 0.08);
  v.motor.frequency.setTargetAtTime(78 + progress * 26, now, 0.08);
  v.motorFilter.frequency.setTargetAtTime(230 + progress * 320, now, 0.06);
}
