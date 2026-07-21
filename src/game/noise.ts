import { hash2d } from "./rng";

/**
 * Deterministic coherent 2D noise, built on the per-coordinate hash so the
 * whole field is a pure function of (x, y, seed) — no sequential RNG state.
 * That keeps worldgen reproducible from a seed and lets us sample any tile in
 * isolation (handy if the world is ever chunked).
 */

const smoothstep = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Value noise in [0, 1): hash the integer lattice, smoothstep-interpolate. */
export function valueNoise2d(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);
  const top = lerp(hash2d(x0, y0, seed), hash2d(x0 + 1, y0, seed), fx);
  const bot = lerp(hash2d(x0, y0 + 1, seed), hash2d(x0 + 1, y0 + 1, seed), fx);
  return lerp(top, bot, fy);
}

/**
 * Fractal (fBm) value noise in [0, 1): a few octaves of value noise summed at
 * doubling frequency and halving amplitude, normalised back to [0, 1). More
 * octaves = more organic, wispy detail on top of the broad shape.
 */
export function fbm2d(x: number, y: number, seed: number, octaves = 3): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    // Offset the seed per octave so the layers don't share a lattice.
    sum += amp * valueNoise2d(x * freq, y * freq, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * Mean of `field(x, y) ** sharp` sampled over a spread of coordinates. The fBm
 * field is spatially stationary, so this mean is effectively constant — we use
 * it to normalise vein/mass placement weights so that biasing ore toward high
 * field values leaves the *average* spawn density unchanged. Sampled at fixed
 * coordinates so it stays deterministic.
 */
export function fieldMeanPow(
  field: (x: number, y: number) => number,
  sharp: number,
  samples = 1024,
): number {
  let sum = 0;
  // A coprime stride over a large span gives good coverage without clustering.
  for (let i = 0; i < samples; i++) {
    const x = (i * 71) % 613;
    const y = (i * 149) % 811;
    sum += field(x, y) ** sharp;
  }
  return sum / samples;
}

/**
 * Sorted (ascending) sample of a field's values, used as an empirical CDF. The
 * fBm field is stationary, so this one sample characterises the whole field —
 * `tailThreshold` then answers "what value does the top `q` fraction start at",
 * which is how we turn a target vein *area fraction* into a mask threshold.
 * Deterministic: fixed sample coordinates.
 */
export function fieldSamples(field: (x: number, y: number) => number, samples = 2048): Float64Array {
  const out = new Float64Array(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = field((i * 71) % 613, (i * 149) % 811);
  }
  return out.sort();
}

/** The field value above which a `tail` fraction (0..1) of the field lies. */
export function tailThreshold(sortedSamples: Float64Array, tail: number): number {
  if (tail <= 0) return Infinity; // nothing qualifies
  if (tail >= 1) return -Infinity; // everything qualifies
  const idx = Math.min(sortedSamples.length - 1, Math.floor((1 - tail) * sortedSamples.length));
  return sortedSamples[idx]!;
}
